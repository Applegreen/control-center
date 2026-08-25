import type { DatabaseSync } from "node:sqlite";
import { isMentionProviderWrapper, mentionStoryAlias } from "@/lib/mention-filter";

export type ContentCategory = "industry" | "mentions" | "newsletters";

type ContentItem = {
  id: string;
  title?: string;
  source?: string;
  publishedAt?: string;
  receivedAt?: string;
  url?: string;
  gmailUrl?: string;
  collectionScope?: string;
};

type ExistingContentRow = {
  external_id: string;
  payload_json: string;
};

type StoredContentRow = {
  external_id: string;
  payload_json: string;
  first_seen_at: string;
  archived_at: string | null;
  archive_reason: string | null;
};

export type ContentLists<T> = {
  active: T[];
  archived: T[];
};

export function initializeContentStore(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS content_items (
      category TEXT NOT NULL,
      external_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      archived_at TEXT,
      archive_reason TEXT,
      PRIMARY KEY (category, external_id)
    );
    CREATE INDEX IF NOT EXISTS content_items_workflow_idx
      ON content_items (category, archived_at, last_seen_at DESC);
  `);
  return database;
}

export function upsertContentItems<T extends ContentItem>(database: DatabaseSync, category: ContentCategory, items: T[], now = new Date().toISOString()) {
  if (!items.length) return;
  const statement = database.prepare(`
    INSERT INTO content_items (category, external_id, payload_json, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (category, external_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      last_seen_at = excluded.last_seen_at
  `);
  const canonicalLookup = database.prepare(`
    SELECT external_id, payload_json
    FROM content_items
    WHERE category = ?
      AND json_valid(payload_json)
      AND (json_extract(payload_json, '$.url') = ? OR json_extract(payload_json, '$.gmailUrl') = ?)
    LIMIT 1
  `);
  const categoryRows = database.prepare(`
    SELECT external_id, payload_json
    FROM content_items
    WHERE category = ? AND json_valid(payload_json)
  `);
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      const canonicalUrl = item.url || item.gmailUrl || "";
      let existing = canonicalUrl
        ? canonicalLookup.get(category, canonicalUrl, canonicalUrl) as unknown as ExistingContentRow | undefined
        : undefined;
      if (!existing && category === "mentions" && item.title && item.source && item.publishedAt && item.url) {
        const incomingAlias = mentionStoryAlias({
          title: item.title,
          source: item.source,
          publishedAt: item.publishedAt,
          url: item.url,
        });
        if (incomingAlias) {
          const incomingIsWrapper = isMentionProviderWrapper(item.url);
          const rows = categoryRows.all(category) as unknown as ExistingContentRow[];
          existing = rows.find((row) => {
            let stored: ContentItem;
            try {
              stored = JSON.parse(row.payload_json) as ContentItem;
            } catch {
              return false;
            }
            if (!stored.title || !stored.source || !stored.publishedAt || !stored.url) return false;
            if (!incomingIsWrapper && !isMentionProviderWrapper(stored.url)) return false;
            return mentionStoryAlias({
              title: stored.title,
              source: stored.source,
              publishedAt: stored.publishedAt,
              url: stored.url,
            }) === incomingAlias;
          });
        }
      }
      const externalId = existing?.external_id || item.id;
      let payload: T = externalId === item.id ? item : { ...item, id: externalId };
      if (category === "mentions" && existing && item.url && isMentionProviderWrapper(item.url)) {
        try {
          const stored = JSON.parse(existing.payload_json) as T;
          if (stored.url && !isMentionProviderWrapper(stored.url)) payload = { ...item, id: externalId, url: stored.url };
        } catch {
          // The normal upsert below replaces an unreadable payload safely.
        }
      }
      statement.run(category, externalId, JSON.stringify(payload), now, now);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function itemTimestamp(item: ContentItem, firstSeenAt = "") {
  return item.publishedAt || item.receivedAt || firstSeenAt;
}

type ListContentOptions = {
  freshSince?: string;
  freshUntil?: string;
  activeExternalIds?: Iterable<string>;
  activeUrls?: Iterable<string>;
  activeScopes?: Iterable<string>;
};

export function listContentItems<T extends ContentItem>(database: DatabaseSync, category: ContentCategory, options: ListContentOptions = {}): ContentLists<T> {
  const rows = database.prepare(`
    SELECT external_id, payload_json, first_seen_at, archived_at, archive_reason
    FROM content_items
    WHERE category = ?
    ORDER BY last_seen_at DESC
  `).all(category) as unknown as StoredContentRow[];
  const freshSince = options.freshSince ? Date.parse(options.freshSince) : Number.NEGATIVE_INFINITY;
  const freshUntil = options.freshUntil ? Date.parse(options.freshUntil) : Number.POSITIVE_INFINITY;
  const activeExternalIds = options.activeExternalIds ? new Set(options.activeExternalIds) : null;
  const activeUrls = options.activeUrls ? new Set(options.activeUrls) : null;
  const activeScopes = options.activeScopes ? new Set(options.activeScopes) : null;
  const currentSweepOnly = activeExternalIds !== null || activeUrls !== null;
  const active: T[] = [];
  const archived: T[] = [];
  for (const row of rows) {
    let item: T;
    try {
      item = JSON.parse(row.payload_json) as T;
    } catch {
      continue;
    }
    const timestamp = Date.parse(itemTimestamp(item, row.first_seen_at));
    const expired = (Number.isFinite(freshSince) && (!Number.isFinite(timestamp) || timestamp < freshSince)) ||
      (Number.isFinite(freshUntil) && (!Number.isFinite(timestamp) || timestamp > freshUntil));
    const canonicalUrl = item.url || item.gmailUrl || "";
    const inCurrentSweep = !currentSweepOnly || Boolean(activeExternalIds?.has(row.external_id) || (canonicalUrl && activeUrls?.has(canonicalUrl)));
    const inActiveScope = activeScopes === null || Boolean(item.collectionScope && activeScopes.has(item.collectionScope));
    if (row.archived_at || expired || !inCurrentSweep || !inActiveScope) {
      archived.push({
        ...item,
        workflow: {
          archiveReason: row.archived_at ? "user" : expired ? "expired" : "not-current",
          archivedAt: row.archived_at || undefined,
          restoreEligible: Boolean(row.archived_at) && !expired && inCurrentSweep && inActiveScope,
        },
      });
    } else {
      active.push(item);
    }
  }
  const sort = (left: T, right: T) => Date.parse(itemTimestamp(right)) - Date.parse(itemTimestamp(left));
  active.sort(sort);
  archived.sort(sort);
  return { active, archived };
}

export function setContentArchived(database: DatabaseSync, category: ContentCategory, externalId: string, archived: boolean, now = new Date().toISOString()) {
  const result = database.prepare(`
    UPDATE content_items
    SET archived_at = ?, archive_reason = ?
    WHERE category = ? AND external_id = ?
  `).run(archived ? now : null, archived ? "user" : null, category, externalId);
  return Number(result.changes) > 0;
}
