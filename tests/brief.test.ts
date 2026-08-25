import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  briefSourceStatuses,
  initializeBriefStore,
  listBriefItems,
  upsertBriefItems,
} from "../lib/brief-store";

test("daily brief connector items upsert by stable ID and report source health", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const now = new Date().toISOString();
  upsertBriefItems(database, [
    {
      id: "slack:thread-1",
      source: "Slack",
      title: "Approve the launch copy",
      summary: "A teammate needs a decision.",
      kind: "action",
      occurredAt: now,
      dueAt: now,
      syncedAt: now,
    },
    {
      id: "calendar:event-1",
      source: "Google Calendar",
      title: "Partner call",
      summary: "Prepare the agenda.",
      kind: "meeting",
      occurredAt: now,
      syncedAt: now,
    },
  ]);
  upsertBriefItems(database, [
    {
      id: "slack:thread-1",
      source: "Slack",
      title: "Approve the final launch copy",
      summary: "The same thread has an updated request.",
      kind: "action",
      occurredAt: now,
      dueAt: now,
      syncedAt: now,
    },
  ]);

  const items = listBriefItems(
    database,
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  assert.equal(items.length, 2);
  assert.equal(
    items.find((item) => item.id === "slack:thread-1")?.title,
    "Approve the final launch copy",
  );
  assert.deepEqual(
    briefSourceStatuses(
      database,
      new Date(Date.now() - 86_400_000).toISOString(),
    ).map((status) => [status.source, status.item_count]),
    [
      ["Google Calendar", 1],
      ["Slack", 1],
    ],
  );
  database.close();
});

test("daily brief retention removes connector payloads older than 45 days", () => {
  const database = initializeBriefStore(new DatabaseSync(":memory:"));
  const old = new Date(Date.now() - 46 * 86_400_000).toISOString();
  const now = new Date().toISOString();
  upsertBriefItems(database, [
    {
      id: "old",
      source: "Gmail",
      title: "Old",
      summary: "",
      kind: "info",
      occurredAt: old,
      syncedAt: old,
    },
    {
      id: "new",
      source: "Gmail",
      title: "New",
      summary: "",
      kind: "message",
      occurredAt: now,
      syncedAt: now,
    },
  ]);
  assert.deepEqual(
    listBriefItems(database, new Date(0).toISOString()).map((item) => item.id),
    ["new"],
  );
  database.close();
});
