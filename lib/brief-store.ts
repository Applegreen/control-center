import type { DatabaseSync } from "node:sqlite";
import type { DailyBriefItem } from "./types";

const retentionMilliseconds = 45 * 86_400_000;

export type BriefSourceRun = {
  source: string;
  state: "live" | "error";
  message?: string;
  attemptedAt: string;
  items: DailyBriefItem[];
};

export function normalizeBriefSource(source: string) {
  return source.trim().toLocaleLowerCase("en-US");
}

function createBriefTables(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS daily_brief_items (
      source_key TEXT NOT NULL,
      item_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      due_at TEXT,
      url TEXT,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (source_key, item_id)
    );
    CREATE INDEX IF NOT EXISTS daily_brief_synced_at ON daily_brief_items(synced_at DESC);
    CREATE INDEX IF NOT EXISTS daily_brief_source ON daily_brief_items(source_key, synced_at DESC);
    CREATE TABLE IF NOT EXISTS daily_brief_source_runs (
      source_key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      last_attempt_at TEXT NOT NULL,
      last_success_at TEXT,
      state TEXT NOT NULL,
      message TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function backfillBriefSourceRuns(database: DatabaseSync) {
  database.exec(`
    INSERT INTO daily_brief_source_runs (
      source_key, source, last_attempt_at, last_success_at,
      state, message, item_count
    )
    SELECT source_key, MAX(source), MAX(synced_at), MAX(synced_at),
      'live', '', COUNT(*)
    FROM daily_brief_items
    GROUP BY source_key
    ON CONFLICT(source_key) DO NOTHING;
  `);
}

function migrateLegacyBriefTable(database: DatabaseSync) {
  const table = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_brief_items'",
    )
    .get();
  if (!table) return;
  const columns = database
    .prepare("PRAGMA table_info(daily_brief_items)")
    .all() as unknown as Array<{ name: string }>;
  if (columns.some((column) => column.name === "source_key")) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    const legacyRows = database
      .prepare(
        `SELECT item_id, source, title, summary, kind,
          occurred_at, due_at, url, synced_at
         FROM daily_brief_items`,
      )
      .all() as unknown as Array<{
      item_id: string;
      source: string;
      title: string;
      summary: string;
      kind: string;
      occurred_at: string;
      due_at: string | null;
      url: string | null;
      synced_at: string;
    }>;
    database.exec(`
      ALTER TABLE daily_brief_items RENAME TO daily_brief_items_legacy;
      CREATE TABLE daily_brief_items (
        source_key TEXT NOT NULL,
        item_id TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        kind TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        due_at TEXT,
        url TEXT,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (source_key, item_id)
      );
    `);
    const insertLegacyItem = database.prepare(`
      INSERT INTO daily_brief_items (
        source_key, item_id, source, title, summary, kind,
        occurred_at, due_at, url, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of legacyRows) {
      insertLegacyItem.run(
        normalizeBriefSource(row.source),
        row.item_id,
        row.source,
        row.title,
        row.summary,
        row.kind,
        row.occurred_at,
        row.due_at,
        row.url,
        row.synced_at,
      );
    }
    database.exec(`
      DROP TABLE daily_brief_items_legacy;
      CREATE INDEX daily_brief_synced_at ON daily_brief_items(synced_at DESC);
      CREATE INDEX daily_brief_source ON daily_brief_items(source_key, synced_at DESC);
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function purgeExpiredBriefItems(
  database: DatabaseSync,
  now = Date.now(),
) {
  database
    .prepare("DELETE FROM daily_brief_items WHERE synced_at < ?")
    .run(new Date(now - retentionMilliseconds).toISOString());
}

export function purgeDisabledBriefSources(
  database: DatabaseSync,
  enabledSources: string[],
) {
  const sourceKeys = [
    ...new Set(enabledSources.map(normalizeBriefSource).filter(Boolean)),
  ];
  if (!sourceKeys.length) {
    database.exec(
      "DELETE FROM daily_brief_items; DELETE FROM daily_brief_source_runs;",
    );
    return;
  }
  const placeholders = sourceKeys.map(() => "?").join(", ");
  database
    .prepare(
      `DELETE FROM daily_brief_items WHERE source_key NOT IN (${placeholders})`,
    )
    .run(...sourceKeys);
  database
    .prepare(
      `DELETE FROM daily_brief_source_runs WHERE source_key NOT IN (${placeholders})`,
    )
    .run(...sourceKeys);
}

export function initializeBriefStore(database: DatabaseSync) {
  migrateLegacyBriefTable(database);
  createBriefTables(database);
  backfillBriefSourceRuns(database);
  purgeExpiredBriefItems(database);
  return database;
}

const upsertItemSql = `
  INSERT INTO daily_brief_items (
    source_key, item_id, source, title, summary, kind,
    occurred_at, due_at, url, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_key, item_id) DO UPDATE SET
    source = excluded.source,
    title = excluded.title,
    summary = excluded.summary,
    kind = excluded.kind,
    occurred_at = excluded.occurred_at,
    due_at = excluded.due_at,
    url = excluded.url,
    synced_at = excluded.synced_at
`;

export function syncBriefSources(
  database: DatabaseSync,
  runs: BriefSourceRun[],
) {
  const upsertItem = database.prepare(upsertItemSql);
  database.exec("BEGIN IMMEDIATE");
  try {
    purgeExpiredBriefItems(database);
    for (const run of runs) {
      const sourceKey = normalizeBriefSource(run.source);
      if (!sourceKey) continue;
      if (run.state === "error") {
        const itemCount = (
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM daily_brief_items WHERE source_key = ?",
            )
            .get(sourceKey) as unknown as { count: number }
        ).count;
        database
          .prepare(
            `
            INSERT INTO daily_brief_source_runs (
              source_key, source, last_attempt_at, last_success_at,
              state, message, item_count
            ) VALUES (?, ?, ?, NULL, 'error', ?, ?)
            ON CONFLICT(source_key) DO UPDATE SET
              source = excluded.source,
              last_attempt_at = excluded.last_attempt_at,
              state = 'error',
              message = excluded.message,
              item_count = excluded.item_count
          `,
          )
          .run(
            sourceKey,
            run.source,
            run.attemptedAt,
            (run.message || "Connector sync failed.").slice(0, 500),
            itemCount,
          );
        continue;
      }

      const uniqueItems = [
        ...new Map(run.items.map((item) => [item.id, item])).values(),
      ];
      for (const item of uniqueItems) {
        upsertItem.run(
          sourceKey,
          item.id,
          run.source,
          item.title,
          item.summary,
          item.kind,
          item.occurredAt,
          item.dueAt || null,
          item.url || null,
          item.syncedAt,
        );
      }
      if (uniqueItems.length) {
        const placeholders = uniqueItems.map(() => "?").join(", ");
        database
          .prepare(
            `DELETE FROM daily_brief_items
             WHERE source_key = ? AND item_id NOT IN (${placeholders})`,
          )
          .run(sourceKey, ...uniqueItems.map((item) => item.id));
      } else {
        database
          .prepare("DELETE FROM daily_brief_items WHERE source_key = ?")
          .run(sourceKey);
      }
      database
        .prepare(
          `
          INSERT INTO daily_brief_source_runs (
            source_key, source, last_attempt_at, last_success_at,
            state, message, item_count
          ) VALUES (?, ?, ?, ?, 'live', '', ?)
          ON CONFLICT(source_key) DO UPDATE SET
            source = excluded.source,
            last_attempt_at = excluded.last_attempt_at,
            last_success_at = excluded.last_success_at,
            state = 'live',
            message = '',
            item_count = excluded.item_count
        `,
        )
        .run(
          sourceKey,
          run.source,
          run.attemptedAt,
          run.attemptedAt,
          uniqueItems.length,
        );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function upsertBriefItems(
  database: DatabaseSync,
  items: DailyBriefItem[],
) {
  const attemptedAt = items[0]?.syncedAt || new Date().toISOString();
  const bySource = new Map<string, DailyBriefItem[]>();
  for (const item of items) {
    const sourceKey = normalizeBriefSource(item.source);
    const sourceItems = bySource.get(sourceKey) || [];
    sourceItems.push(item);
    bySource.set(sourceKey, sourceItems);
  }
  syncBriefSources(
    database,
    [...bySource.values()].map((sourceItems) => ({
      source: sourceItems[0].source,
      state: "live",
      attemptedAt,
      items: sourceItems,
    })),
  );
}

export function listBriefItems(
  database: DatabaseSync,
  since: string,
  limit = 250,
  enabledSources?: string[],
): DailyBriefItem[] {
  purgeExpiredBriefItems(database);
  const sourceKeys = enabledSources
    ? [...new Set(enabledSources.map(normalizeBriefSource).filter(Boolean))]
    : [];
  if (enabledSources && !sourceKeys.length) return [];
  const sourceFilter = sourceKeys.length
    ? `AND source_key IN (${sourceKeys.map(() => "?").join(", ")})`
    : "";
  const rows = database
    .prepare(
      `
      SELECT source_key, item_id, source, title, summary, kind,
        occurred_at, due_at, url, synced_at
      FROM daily_brief_items
      WHERE synced_at >= ? ${sourceFilter}
      ORDER BY
        CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
        due_at ASC,
        occurred_at DESC
      LIMIT ?
    `,
    )
    .all(since, ...sourceKeys, limit) as unknown as Array<{
    source_key: string;
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
    id: `${row.source_key}:${row.item_id}`,
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

export function briefSourceStatuses(
  database: DatabaseSync,
  enabledSources?: string[],
) {
  purgeExpiredBriefItems(database);
  const sourceKeys = enabledSources
    ? [...new Set(enabledSources.map(normalizeBriefSource).filter(Boolean))]
    : [];
  if (enabledSources && !sourceKeys.length) return [];
  const sourceFilter = sourceKeys.length
    ? `WHERE source_key IN (${sourceKeys.map(() => "?").join(", ")})`
    : "";
  return database
    .prepare(
      `
      SELECT source, last_attempt_at, last_success_at, state, message, item_count
      FROM daily_brief_source_runs
      ${sourceFilter}
      ORDER BY source COLLATE NOCASE
    `,
    )
    .all(...sourceKeys) as unknown as Array<{
    source: string;
    last_attempt_at: string;
    last_success_at: string | null;
    state: "live" | "error";
    message: string;
    item_count: number;
  }>;
}
