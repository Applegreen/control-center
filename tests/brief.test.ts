import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  briefSourceStatuses,
  initializeBriefStore,
  listBriefItems,
  purgeDisabledBriefSources,
  syncBriefSources,
  upsertBriefItems,
} from "../lib/brief-store";
import type { DailyBriefItem } from "../lib/types";
import { isDailyBriefItemInWindow } from "../lib/brief-window";

function item(
  id: string,
  source: string,
  syncedAt: string,
  title = id,
): DailyBriefItem {
  return {
    id,
    source,
    title,
    summary: "",
    kind: "info",
    occurredAt: syncedAt,
    syncedAt,
  };
}

test("daily brief connector items upsert by source-scoped stable ID", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const now = new Date().toISOString();
  upsertBriefItems(database, [
    item("thread-1", "Slack", now, "Approve the launch copy"),
    item("event-1", "Google Calendar", now, "Partner call"),
  ]);
  upsertBriefItems(database, [
    item("thread-1", "Slack", now, "Approve the final launch copy"),
  ]);

  const items = listBriefItems(
    database,
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  assert.equal(items.length, 2);
  assert.equal(
    items.find((entry) => entry.id === "slack:thread-1")?.title,
    "Approve the final launch copy",
  );
  assert.deepEqual(
    briefSourceStatuses(database).map((status) => [
      status.source,
      status.item_count,
    ]),
    [
      ["Google Calendar", 1],
      ["Slack", 1],
    ],
  );
  database.close();
});

test("identical provider IDs remain separate across Daily Brief sources", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const now = new Date().toISOString();
  upsertBriefItems(database, [
    item("123", "Slack", now),
    item("123", "Gmail", now),
  ]);
  assert.deepEqual(
    listBriefItems(database, new Date(0).toISOString())
      .map((entry) => entry.id)
      .sort(),
    ["gmail:123", "slack:123"],
  );
  database.close();
});

test("successful source sweeps reconcile missing items and record empty health", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const first = new Date(Date.now() - 1_000).toISOString();
  const second = new Date().toISOString();
  upsertBriefItems(database, [
    item("done", "Slack", first),
    item("keep", "Slack", first),
  ]);
  syncBriefSources(database, [
    {
      source: "Slack",
      state: "live",
      attemptedAt: second,
      items: [],
    },
  ]);
  assert.deepEqual(listBriefItems(database, new Date(0).toISOString()), []);
  assert.deepEqual({ ...briefSourceStatuses(database)[0] }, {
    source: "Slack",
    last_attempt_at: second,
    last_success_at: second,
    state: "live",
    message: "",
    item_count: 0,
  });
  database.close();
});

test("failed source sweeps preserve the last successful items and expose failure", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const first = new Date(Date.now() - 1_000).toISOString();
  const second = new Date().toISOString();
  upsertBriefItems(database, [item("message-1", "Gmail", first)]);
  syncBriefSources(database, [
    {
      source: "Gmail",
      state: "error",
      message: "Authorization expired.",
      attemptedAt: second,
      items: [],
    },
  ]);
  assert.deepEqual(
    listBriefItems(database, new Date(0).toISOString()).map(
      (entry) => entry.id,
    ),
    ["gmail:message-1"],
  );
  assert.equal(briefSourceStatuses(database)[0].state, "error");
  assert.equal(
    briefSourceStatuses(database)[0].message,
    "Authorization expired.",
  );
  assert.equal(briefSourceStatuses(database)[0].last_success_at, first);
  database.close();
});

test("disabled Daily Brief sources are purged from items and health", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const now = new Date().toISOString();
  upsertBriefItems(database, [
    item("one", "Slack", now),
    item("two", "Gmail", now),
  ]);
  purgeDisabledBriefSources(database, ["Slack"]);
  assert.deepEqual(
    listBriefItems(database, new Date(0).toISOString()).map(
      (entry) => entry.id,
    ),
    ["slack:one"],
  );
  assert.deepEqual(
    briefSourceStatuses(database).map((status) => status.source),
    ["Slack"],
  );
  database.close();
});

test("daily brief retention is enforced during reads without a later sync", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const old = new Date(Date.now() - 46 * 86_400_000).toISOString();
  database
    .prepare(
      `INSERT INTO daily_brief_items (
        source_key, item_id, source, title, summary, kind,
        occurred_at, due_at, url, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .run("gmail", "old", "Gmail", "Old", "", "info", old, old);
  assert.deepEqual(listBriefItems(database, new Date(0).toISOString()), []);
  const count = database
    .prepare("SELECT COUNT(*) AS count FROM daily_brief_items")
    .get() as unknown as { count: number };
  assert.equal(count.count, 0);
  database.close();
});

test("legacy Daily Brief tables migrate to source-scoped identities", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE daily_brief_items (
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
  `);
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO daily_brief_items (
        item_id, source, title, summary, kind, occurred_at, synced_at
      ) VALUES (?, ?, ?, '', 'info', ?, ?)`,
    )
    .run("legacy", "Slack", "Legacy item", now, now);
  initializeBriefStore(database);
  assert.deepEqual(
    listBriefItems(database, new Date(0).toISOString()).map(
      (entry) => entry.id,
    ),
    ["slack:legacy"],
  );
  const columns = database
    .prepare("PRAGMA table_info(daily_brief_items)")
    .all() as unknown as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "source_key"));
  assert.deepEqual(
    briefSourceStatuses(database).map((status) => [
      status.source,
      status.state,
      status.item_count,
    ]),
    [["Slack", "live", 1]],
  );
  database.close();
});

test("Daily Brief Week view uses a bounded seven-day window", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  assert.equal(
    isDailyBriefItemInWindow(
      { occurredAt: "2026-08-17T11:59:59.000Z" },
      "week",
      now,
    ),
    false,
  );
  assert.equal(
    isDailyBriefItemInWindow(
      {
        occurredAt: "2026-08-10T12:00:00.000Z",
        dueAt: "2026-08-31T12:00:00.000Z",
      },
      "week",
      now,
    ),
    true,
  );
  assert.equal(
    isDailyBriefItemInWindow(
      {
        occurredAt: "2026-08-10T12:00:00.000Z",
        dueAt: "2026-09-02T12:00:00.000Z",
      },
      "week",
      now,
    ),
    false,
  );
});
