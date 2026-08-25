import type { DatabaseSync } from "node:sqlite";
import {
  canonicalizeIndustryUrl,
  isWatchedIndustryDiscovery,
  normalizeIndustryTitle,
  stableIndustryDiscoveryId,
  type IndustryDiscoveryLike,
} from "./industry-curation";

export const DEFAULT_INDUSTRY_DISCOVERY_RETENTION_DAYS = 90;

export type StoredIndustryDiscovery<T extends IndustryDiscoveryLike = IndustryDiscoveryLike> = {
  discoveryId: string;
  canonicalUrl: string;
  normalizedTitle: string;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  item: T;
};

export type ListIndustryDiscoveryOptions = {
  since?: string;
  until?: string;
  collectionScopes?: readonly string[];
  limit?: number;
};

export type IndustryDiscoveryUpsertResult<T extends IndustryDiscoveryLike> = {
  inserted: number;
  updated: number;
  records: StoredIndustryDiscovery<T>[];
};

export type PruneIndustryDiscoveryOptions = {
  now?: string | Date;
  retentionDays?: number;
};

type IndustryDiscoveryRow = {
  discovery_id: string;
  canonical_url: string;
  normalized_title: string;
  source: string;
  payload_json: string;
  first_seen_at: string;
  last_seen_at: string;
};

function isoTimestamp(value: string | Date | undefined) {
  const parsed = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) throw new Error("Industry discovery timestamps must be valid dates.");
  return parsed.toISOString();
}

function publicationTimestamp(item: IndustryDiscoveryLike) {
  const value = item.publishedAt || item.discoveredAt || "";
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

export function initializeIndustryStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS industry_discoveries (
      discovery_id TEXT PRIMARY KEY,
      canonical_url TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT,
      collection_scope TEXT,
      published_at TEXT,
      payload_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS industry_discoveries_recent_idx
      ON industry_discoveries (last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS industry_discoveries_published_idx
      ON industry_discoveries (published_at DESC);
    CREATE INDEX IF NOT EXISTS industry_discoveries_scope_idx
      ON industry_discoveries (collection_scope, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS industry_discoveries_canonical_idx
      ON industry_discoveries (canonical_url);
    CREATE INDEX IF NOT EXISTS industry_discoveries_title_idx
      ON industry_discoveries (normalized_title, published_at);
  `);
  return database;
}

function storedRecord<T extends IndustryDiscoveryLike>(row: IndustryDiscoveryRow): StoredIndustryDiscovery<T> | null {
  try {
    return {
      discoveryId: row.discovery_id,
      canonicalUrl: row.canonical_url,
      normalizedTitle: row.normalized_title,
      source: row.source,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      item: JSON.parse(row.payload_json) as T,
    };
  } catch {
    return null;
  }
}

export function upsertIndustryDiscoveries<T extends IndustryDiscoveryLike>(
  database: DatabaseSync,
  items: readonly T[],
  now?: string | Date,
): IndustryDiscoveryUpsertResult<T> {
  if (!items.length) return { inserted: 0, updated: 0, records: [] };
  const seenAt = isoTimestamp(now);
  const existing = database.prepare(`
    SELECT discovery_id, first_seen_at
    FROM industry_discoveries
    WHERE discovery_id = ?
  `);
  const upsert = database.prepare(`
    INSERT INTO industry_discoveries (
      discovery_id, canonical_url, normalized_title, source, kind,
      collection_scope, published_at, payload_json, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discovery_id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      normalized_title = excluded.normalized_title,
      source = excluded.source,
      kind = excluded.kind,
      collection_scope = excluded.collection_scope,
      published_at = excluded.published_at,
      payload_json = excluded.payload_json,
      last_seen_at = excluded.last_seen_at
  `);
  const uniqueItems = new Map<string, T>();
  for (const item of items) {
    const discoveryId = stableIndustryDiscoveryId(item);
    const current = uniqueItems.get(discoveryId);
    if (!current ||
      (isWatchedIndustryDiscovery(item) && !isWatchedIndustryDiscovery(current)) ||
      (isWatchedIndustryDiscovery(item) === isWatchedIndustryDiscovery(current) &&
        (item.summary || "").length > (current.summary || "").length)) {
      uniqueItems.set(discoveryId, item);
    }
  }
  let inserted = 0;
  let updated = 0;
  const records: StoredIndustryDiscovery<T>[] = [];

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [discoveryId, item] of uniqueItems) {
      const prior = existing.get(discoveryId) as unknown as { discovery_id: string; first_seen_at: string } | undefined;
      const canonicalUrl = canonicalizeIndustryUrl(item.url);
      const normalizedTitle = normalizeIndustryTitle(item.title, item.source);
      upsert.run(
        discoveryId,
        canonicalUrl,
        normalizedTitle,
        item.source,
        item.kind || null,
        item.collectionScope || null,
        publicationTimestamp(item),
        JSON.stringify(item),
        seenAt,
        seenAt,
      );
      if (prior) updated += 1;
      else inserted += 1;
      records.push({
        discoveryId,
        canonicalUrl,
        normalizedTitle,
        source: item.source,
        firstSeenAt: prior?.first_seen_at || seenAt,
        lastSeenAt: seenAt,
        item,
      });
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { inserted, updated, records };
}

export function pruneIndustryDiscoveries(
  database: DatabaseSync,
  options: PruneIndustryDiscoveryOptions = {},
) {
  const now = Date.parse(isoTimestamp(options.now));
  const retentionDays = Math.max(
    1,
    Math.min(
      3_650,
      Math.round(options.retentionDays ?? DEFAULT_INDUSTRY_DISCOVERY_RETENTION_DAYS),
    ),
  );
  const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1_000).toISOString();
  const result = database.prepare(`
    DELETE FROM industry_discoveries
    WHERE last_seen_at < ?
  `).run(cutoff);
  return Number(result.changes);
}

function safeDateFilter(value: string | undefined, label: string) {
  if (!value) return "";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${label} must be a valid date.`);
  return timestamp.toISOString();
}

export function listIndustryDiscoveries<T extends IndustryDiscoveryLike>(
  database: DatabaseSync,
  options: ListIndustryDiscoveryOptions = {},
): StoredIndustryDiscovery<T>[] {
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  const since = safeDateFilter(options.since, "Industry discovery since");
  const until = safeDateFilter(options.until, "Industry discovery until");
  if (since) {
    clauses.push("COALESCE(NULLIF(published_at, ''), first_seen_at) >= ?");
    parameters.push(since);
  }
  if (until) {
    clauses.push("COALESCE(NULLIF(published_at, ''), first_seen_at) <= ?");
    parameters.push(until);
  }
  if (options.collectionScopes) {
    const scopes = [...new Set(options.collectionScopes.map((scope) => scope.trim()).filter(Boolean))];
    if (!scopes.length) return [];
    clauses.push(`collection_scope IN (${scopes.map(() => "?").join(", ")})`);
    parameters.push(...scopes);
  }
  const limit = Math.max(1, Math.min(10_000, Math.round(options.limit ?? 5_000)));
  parameters.push(limit);
  const rows = database.prepare(`
    SELECT discovery_id, canonical_url, normalized_title, source,
      payload_json, first_seen_at, last_seen_at
    FROM industry_discoveries
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY COALESCE(NULLIF(published_at, ''), first_seen_at) DESC,
      last_seen_at DESC, discovery_id ASC
    LIMIT ?
  `).all(...parameters) as unknown as IndustryDiscoveryRow[];
  return rows.flatMap((row) => {
    const record = storedRecord<T>(row);
    return record ? [record] : [];
  });
}
