import type { DatabaseSync } from "node:sqlite";
import type { DailyBriefItem } from "./types";

export function initializeBriefStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS daily_brief_items (
      item_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      due_at TEXT,
      url TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS daily_brief_synced_at ON daily_brief_items(synced_at DESC);
    CREATE INDEX IF NOT EXISTS daily_brief_source ON daily_brief_items(source, synced_at DESC);
  `);
  return database;
}

export function upsertBriefItems(
  database: DatabaseSync,
  items: DailyBriefItem[],
) {
  const statement = database.prepare(`
    INSERT INTO daily_brief_items (
      item_id, source, title, summary, kind, occurred_at, due_at, url, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      source = excluded.source,
      title = excluded.title,
      summary = excluded.summary,
      kind = excluded.kind,
      occurred_at = excluded.occurred_at,
      due_at = excluded.due_at,
      url = excluded.url,
      synced_at = excluded.synced_at
  `);
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      statement.run(
        item.id,
        item.source,
        item.title,
        item.summary,
        item.kind,
        item.occurredAt,
        item.dueAt || null,
        item.url || null,
        item.syncedAt,
      );
    }
    database
      .prepare("DELETE FROM daily_brief_items WHERE synced_at < ?")
      .run(new Date(Date.now() - 45 * 86_400_000).toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listBriefItems(
  database: DatabaseSync,
  since: string,
  limit = 250,
): DailyBriefItem[] {
  const rows = database
    .prepare(
      `
      SELECT item_id, source, title, summary, kind, occurred_at, due_at, url, synced_at
      FROM daily_brief_items
      WHERE synced_at >= ?
      ORDER BY
        CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
        due_at ASC,
        occurred_at DESC
      LIMIT ?
    `,
    )
    .all(since, limit) as unknown as Array<{
    item_id: string;
    source: string;
    title: string;
    summary: string;
    kind: DailyBriefItem["kind"];
    occurred_at: string;
    due_at: string | null;
    url: string | null;
    synced_at: string;
  }>;
  return rows.map((row) => ({
    id: row.item_id,
    source: row.source,
    title: row.title,
    summary: row.summary,
    kind: row.kind,
    occurredAt: row.occurred_at,
    dueAt: row.due_at || undefined,
    url: row.url || undefined,
    syncedAt: row.synced_at,
  }));
}

export function briefSourceStatuses(database: DatabaseSync, since: string) {
  return database
    .prepare(
      `
      SELECT source, MAX(synced_at) AS last_synced_at, COUNT(*) AS item_count
      FROM daily_brief_items
      WHERE synced_at >= ?
      GROUP BY source
      ORDER BY source COLLATE NOCASE
    `,
    )
    .all(since) as unknown as Array<{
    source: string;
    last_synced_at: string;
    item_count: number;
  }>;
}
