/**
 * Publish approved Industry stories to digitalcharacters.africa.
 *
 * Push, not pull. The website downloads a plain news.json from its own origin,
 * which means:
 *   - no CORS, no auth, no public dashboard endpoint to secure
 *   - the VPS is never exposed to public web traffic
 *   - if the VPS is down the site still renders yesterday's file
 *
 * Run with Node 24+ (type stripping, node:sqlite):
 *   node --experimental-strip-types scripts/publish-news.ts
 *
 * Credentials come from the environment, never from this file:
 *   DC_FTP_HOST   ftp host for the website account
 *   DC_FTP_USER   an FTP user scoped to public_html, not the panel login
 *   DC_FTP_PASS   that user's password
 *   DC_DATA_DIR   where sitenews.sqlite lives (defaults to ./data)
 *   DC_NEWS_LIMIT how many stories to publish (default 8)
 *
 * --dry-run writes the file and prints it without uploading.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { buildFeedPayload, type SiteNewsItem } from "../lib/site-news.ts";

const run = promisify(execFile);

const DRY_RUN = process.argv.includes("--dry-run");
const DATA_DIR = process.env.DC_DATA_DIR || path.join(process.cwd(), "data");
const LIMIT = Number(process.env.DC_NEWS_LIMIT || 8);

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

function readApproved(): SiteNewsItem[] {
  const file = path.join(DATA_DIR, "sitenews.sqlite");
  // Read-only: the publisher must never be able to change what was approved.
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database
      .prepare("SELECT * FROM site_news ORDER BY approved_at DESC")
      .all() as unknown as Row[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      url: row.url,
      source: row.source,
      category: row.category as SiteNewsItem["category"],
      publishedAt: row.published_at,
      approvedAt: row.approved_at,
      pin: Number(row.pin) || 0,
    }));
  } finally {
    database.close();
  }
}

async function upload(localPath: string) {
  const host = process.env.DC_FTP_HOST;
  const user = process.env.DC_FTP_USER;
  const pass = process.env.DC_FTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "DC_FTP_HOST, DC_FTP_USER and DC_FTP_PASS must be set. " +
        "Create a dedicated FTP user in DirectAdmin scoped to public_html - " +
        "do not reuse the control panel login.",
    );
  }

  // --ssl-reqd refuses to fall back to plaintext FTP. Credentials go through
  // stdin-free argv only for the URL; the password is passed with -u, which is
  // visible in `ps`, so this script should be root-owned and chmod 700.
  await run("curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--ssl-reqd",
    "--upload-file",
    localPath,
    `ftp://${host}/public_html/news.json`,
    "--user",
    `${user}:${pass}`,
  ]);
}

async function main() {
  const items = readApproved();
  const payload = buildFeedPayload(items, { limit: LIMIT });

  const directory = mkdtempSync(path.join(tmpdir(), "dc-news-"));
  const localPath = path.join(directory, "news.json");
  writeFileSync(localPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`${payload.items.length} of ${items.length} approved stories -> ${localPath}`);
  for (const item of payload.items) {
    console.log(`  [${item.cat}] ${item.t.slice(0, 72)}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: not uploaded");
    return;
  }

  if (!payload.items.length) {
    // Still upload. An empty file is how the site learns a story was pulled;
    // skipping the upload would leave a withdrawn story live indefinitely.
    console.log("nothing approved - uploading an empty feed so the site clears");
  }

  await upload(localPath);
  console.log("uploaded to public_html/news.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
