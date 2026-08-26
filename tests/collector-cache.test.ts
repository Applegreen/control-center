import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  initializeCollectorCache,
  readCollectorSnapshot,
  updateCollectorSnapshotArchive,
  writeCollectorSnapshot,
} from "../lib/collector-cache";
import {
  applyArchiveToPayload,
  type CachedFeedItem,
} from "../lib/live-response";
import { initializeContentStore, setContentArchived, upsertContentItems } from "../lib/archive-store";

test("collector snapshots are scope-aware and survive a later read", () => {
  const database = initializeCollectorCache(new DatabaseSync(":memory:"));
  const payload = { checkedAt: "2026-08-25T12:00:00Z", items: [{ id: "one" }] };
  writeCollectorSnapshot(database, "industry", "scope-a", payload, payload.checkedAt);
  assert.deepEqual(
    readCollectorSnapshot<typeof payload>(database, "industry", "scope-a")?.payload,
    payload,
  );
  assert.equal(readCollectorSnapshot(database, "industry", "scope-b"), null);
});

test("archive mutations update a cached feed without recollecting sources", () => {
  const database = initializeCollectorCache(new DatabaseSync(":memory:"));
  const payload = {
    items: [{ id: "one", title: "One" }, { id: "two", title: "Two" }],
    archivedItems: [] as Array<{
      id: string;
      title: string;
      workflow?: CachedFeedItem["workflow"];
    }>,
    archiveCount: 0,
  };
  writeCollectorSnapshot(database, "mentions", "scope", payload);
  assert.equal(
    updateCollectorSnapshotArchive(
      database,
      "mentions",
      "one",
      true,
      "2026-08-25T12:05:00Z",
    ),
    true,
  );
  const archived = readCollectorSnapshot<typeof payload>(
    database,
    "mentions",
    "scope",
  )!.payload;
  assert.deepEqual(archived.items.map(({ id }) => id), ["two"]);
  assert.equal(archived.archiveCount, 1);
  assert.deepEqual(archived.archivedItems[0].workflow, {
    archiveReason: "user",
    archivedAt: "2026-08-25T12:05:00Z",
    restoreEligible: true,
  });

  const restored = applyArchiveToPayload(archived, "one", false);
  assert.deepEqual(restored.items.map(({ id }) => id), ["one", "two"]);
  assert.equal(restored.archiveCount, 0);
  assert.equal("workflow" in restored.items[0], false);
});

test("a collector finishing after an archive cannot overwrite the newer user action", () => {
  const database = initializeCollectorCache(initializeContentStore(new DatabaseSync(":memory:")));
  const item = { id: "one", title: "One", url: "https://example.com/one" };
  upsertContentItems(database, "industry", [item]);
  setContentArchived(database, "industry", "one", true, "2026-08-25T12:00:00Z");
  writeCollectorSnapshot(database, "industry", "scope", { items: [item], archivedItems: [], archiveCount: 0 });
  const saved = readCollectorSnapshot<{ items: typeof item[]; archivedItems: typeof item[] }>(database, "industry")!.payload;
  assert.equal(saved.items.length, 0);
  assert.equal(saved.archivedItems[0].id, "one");
});
