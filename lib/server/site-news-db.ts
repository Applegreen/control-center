import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "@/lib/server/settings";
import {
  NEWS_CATEGORIES,
  categoriseStory,
  resolveNewsItems,
  type NewsCategory,
  type SiteNewsItem,
} from "@/lib/site-news";

// Own SQLite file, same reasoning as proposals, minutes and crm: upstream
// migrations run against control-center.sqlite and must never touch this table.

declare global {
  var controlCenterSiteNewsDatabase: DatabaseSync | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS site_news (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'industry-news',
  published_at TEXT NOT NULL DEFAULT '',
  approved_at  TEXT NOT NULL,
  pin          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS site_news_approved ON site_news(approved_at DESC);
`;

export function getSiteNewsDatabase() {
  if (!globalThis.controlCenterSiteNewsDatabase) {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(path.join(directory, "sitenews.sqlite"));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    database.exec(SCHEMA);
    globalThis.controlCenterSiteNewsDatabase = database;
  }
  return globalThis.controlCenterSiteNewsDatabase;
}

type Row = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  category: string;
  published_at: string;
  approved_at: string;
  pin: number;
};

function mapRow(row: Row): SiteNewsItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source: row.source,
    category: (NEWS_CATEGORIES as readonly string[]).includes(row.category)
      ? (row.category as NewsCategory)
      : "industry-news",
    publishedAt: row.published_at,
    approvedAt: row.approved_at,
    pin: Number(row.pin) || 0,
  };
}

/** Everything a person has approved, newest first, duplicates removed. */
export function listPublishedNews(): SiteNewsItem[] {
  const rows = getSiteNewsDatabase()
    .prepare("SELECT * FROM site_news ORDER BY approved_at DESC")
    .all() as unknown as Row[];
  return resolveNewsItems(rows.map(mapRow));
}

export function publishedIds(): string[] {
  return (
    getSiteNewsDatabase().prepare("SELECT id FROM site_news").all() as unknown as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

export type PublishInput = {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  category?: string;
  publishedAt?: string;
  pin?: number;
};

/**
 * Approve a story. A snapshot of the text is stored rather than a reference to
 * the live feed, because feed items expire out of the Industry queue after a
 * day and the homepage should not lose a story the moment that happens.
 */
export function publishStory(input: PublishInput, now = new Date()): SiteNewsItem {
  const title = (input.title || "").trim();
  if (!title) throw new Error("A story needs a title before it can be published.");

  const category = (NEWS_CATEGORIES as readonly string[]).includes(input.category || "")
    ? (input.category as NewsCategory)
    : categoriseStory(title, input.summary || "");

  const item: SiteNewsItem = {
    id: input.id,
    title,
    summary: (input.summary || "").trim(),
    url: (input.url || "").trim(),
    source: (input.source || "").trim(),
    category,
    publishedAt: input.publishedAt || now.toISOString(),
    approvedAt: now.toISOString(),
    pin: Number(input.pin) || 0,
  };

  getSiteNewsDatabase()
    .prepare(
      `INSERT INTO site_news (id, title, summary, url, source, category, published_at, approved_at, pin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, summary = excluded.summary, url = excluded.url,
         source = excluded.source, category = excluded.category,
         published_at = excluded.published_at, pin = excluded.pin`,
    )
    .run(
      item.id,
      item.title,
      item.summary,
      item.url,
      item.source,
      item.category,
      item.publishedAt,
      item.approvedAt,
      item.pin,
    );

  return item;
}

/** Un-approve. Returns true when a row was actually removed. */
export function unpublishStory(id: string): boolean {
  const result = getSiteNewsDatabase().prepare("DELETE FROM site_news WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

/**
 * Drop approved items older than `days`. Called by the publisher so the
 * homepage cannot quietly go stale: an item nobody refreshed ages out.
 */
export function pruneOldNews(days = 90, now = new Date()): number {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = getSiteNewsDatabase()
    .prepare("DELETE FROM site_news WHERE pin = 0 AND approved_at < ?")
    .run(cutoff);
  return Number(result.changes) || 0;
}
