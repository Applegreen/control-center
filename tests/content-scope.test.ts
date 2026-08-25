import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeContentStore, listContentItems, setContentArchived, upsertContentItems } from "../lib/archive-store";
import type { LiveStory } from "../lib/types";

function item(id: string, url: string): LiveStory {
  return { id, url, title: id, summary: "", source: "Fixture", publishedAt: "2026-08-24T10:00:00Z" };
}

test("active collection results are scoped to the current sweep while history remains durable", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const oldSource = item("old-source", "https://old.example/story");
  const currentSource = item("current-source", "https://current.example/story");
  upsertContentItems(database, "industry", [oldSource, currentSource], "2026-08-24T11:00:00Z");
  const lists = listContentItems<LiveStory>(database, "industry", {
    activeExternalIds: [currentSource.id],
    activeUrls: [currentSource.url],
  });
  assert.deepEqual(lists.active.map(({ id }) => id), [currentSource.id]);
  assert.equal(lists.archived.find(({ id }) => id === oldSource.id)?.workflow?.archiveReason, "not-current");
});

test("recent event streams survive a later empty sweep but not a configuration change", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const recent = { ...item("recent", "https://current.example/recent"), collectionScope: "source:current" };
  upsertContentItems(database, "industry", [recent], "2026-08-24T11:00:00Z");

  const sameConfiguration = listContentItems<LiveStory>(database, "industry", {
    freshSince: "2026-08-23T12:00:00Z",
    activeScopes: ["source:current"],
  });
  assert.deepEqual(sameConfiguration.active.map(({ id }) => id), [recent.id]);

  const changedConfiguration = listContentItems<LiveStory>(database, "industry", {
    freshSince: "2026-08-23T12:00:00Z",
    activeScopes: ["source:other"],
  });
  assert.equal(changedConfiguration.active.length, 0);
  assert.equal(changedConfiguration.archived[0].workflow?.archiveReason, "not-current");
});

test("future-dated stored events are excluded by the upper freshness bound", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const future = { ...item("future", "https://current.example/future"), publishedAt: "2099-01-01T00:00:00Z", collectionScope: "source:current" };
  upsertContentItems(database, "industry", [future], "2026-08-24T11:00:00Z");
  const lists = listContentItems<LiveStory>(database, "industry", {
    freshSince: "2026-08-23T12:00:00Z",
    freshUntil: "2026-08-24T12:10:00Z",
    activeScopes: ["source:current"],
  });
  assert.equal(lists.active.length, 0);
  assert.equal(lists.archived[0].workflow?.archiveReason, "expired");
});

test("an archived item from a removed collection scope cannot be falsely restored", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const archived = { ...item("archived-old-scope", "https://old.example/archived"), collectionScope: "source:old" };
  upsertContentItems(database, "industry", [archived], "2026-08-24T11:00:00Z");
  setContentArchived(database, "industry", archived.id, true, "2026-08-24T11:05:00Z");
  const lists = listContentItems<LiveStory>(database, "industry", {
    freshSince: "2026-08-23T12:00:00Z",
    activeScopes: ["source:new"],
  });
  assert.equal(lists.archived[0].workflow?.archiveReason, "user");
  assert.equal(lists.archived[0].workflow?.restoreEligible, false);
});

test("an archived canonical URL never resurfaces when a provider changes its external ID", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const original = item("provider-a", "https://publisher.example/story");
  upsertContentItems(database, "mentions", [original]);
  setContentArchived(database, "mentions", original.id, true);
  const rediscovered = { ...original, id: "provider-b", title: "Updated headline" };
  upsertContentItems(database, "mentions", [rediscovered]);
  const lists = listContentItems<LiveStory>(database, "mentions", {
    activeExternalIds: [rediscovered.id],
    activeUrls: [rediscovered.url],
  });
  assert.equal(lists.active.length, 0);
  assert.equal(lists.archived.length, 1);
  assert.equal(lists.archived[0].title, "Updated headline");
  assert.equal(lists.archived[0].workflow?.archiveReason, "user");
});
