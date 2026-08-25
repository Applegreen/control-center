import assert from "node:assert/strict";
import test from "node:test";
import { buildMentionQuery, evaluateMention } from "../lib/mention-filter";
import { parsePublicCount } from "../lib/public-metrics";
import { filterPlausiblyDatedStories, isFreshTimestamp } from "../lib/freshness";
import { isValidPublicProfileUrl, parseThreadsPublicProfile, resolvePublicProfileUrl } from "../lib/public-metrics";
import { newSitemapEntries, parseSitemap, sitemapStoryTimes } from "../lib/sitemap";
import type { LiveStory } from "../lib/types";
import { DatabaseSync } from "node:sqlite";
import { initializeContentStore, listContentItems, setContentArchived, upsertContentItems } from "../lib/archive-store";
import { hasWorkspaceState, initializeWorkspaceStore, readWorkspaceState, writeWorkspaceState } from "../lib/workspace-store";

function story(title: string, summary = ""): LiveStory {
  return { id: "test", title, summary, url: "https://example.com/story", source: "Test", publishedAt: "2026-08-21T00:00:00Z" };
}

test("parses URL sets and sitemap indexes", () => {
  const urlset = parseSitemap(`<urlset><url><loc>https://example.com/a</loc><lastmod>2026-08-21</lastmod></url></urlset>`);
  assert.deepEqual(urlset, { kind: "urls", entries: [{ loc: "https://example.com/a", lastmod: "2026-08-21" }] });
  const index = parseSitemap(`<sitemapindex><sitemap><loc>https://example.com/posts.xml</loc></sitemap></sitemapindex>`);
  assert.deepEqual(index, { kind: "index", entries: [{ loc: "https://example.com/posts.xml", lastmod: "" }] });
});

test("sitemap baselines only emit newly added pages", () => {
  const entries = [{ loc: "https://example.com/old", lastmod: "" }, { loc: "https://example.com/new", lastmod: "2026-08-21" }];
  assert.deepEqual(newSitemapEntries(entries), []);
  assert.deepEqual(newSitemapEntries(entries, { "https://example.com/old": "" }), [{ loc: "https://example.com/new", lastmod: "2026-08-21" }]);
});

test("new sitemap pages are fresh from discovery time even when lastmod is old", () => {
  assert.deepEqual(sitemapStoryTimes("2026-03-25", "2026-08-24T12:00:00Z"), {
    publishedAt: "2026-08-24T12:00:00Z",
    discoveredAt: "2026-08-24T12:00:00Z",
    lastModifiedAt: "2026-03-25",
  });
});

test("strict mentions reject an uncorroborated common name", () => {
  const signals = ["Alex Morgan", "Northstar Robotics", "northstaralex", "northstar.example"];
  assert.equal(evaluateMention(story("Alex Morgan joins a local sports club"), "Alex Morgan", signals, [], true).accepted, false);
  assert.equal(evaluateMention(story("Alex Morgan of Northstar Robotics explains a new model"), "Alex Morgan", signals, [], true).accepted, true);
  assert.equal(evaluateMention(story("Alex Morgan discusses automation"), "Alex Morgan", signals, ["automation", "robotics"], true).accepted, false);
  assert.equal(evaluateMention(story("Alex Morgan discusses automation in robotics"), "Alex Morgan", signals, ["automation", "robotics"], true).accepted, true);
});

test("strict mentions accept a unique handle but reject loose word overlap", () => {
  const signals = ["Northstar Robotics", "@northstaralex"];
  assert.equal(evaluateMention(story("Interview with @northstaralex"), "@northstaralex", signals, [], true).accepted, true);
  assert.equal(evaluateMention(story("How to navigate by the north star with basic tools"), "Northstar Robotics", signals, [], true).accepted, false);
  assert.match(buildMentionQuery("Northstar Robotics", signals, true), /"Northstar Robotics"/);
});

test("public metric counts support displayed compact numbers", () => {
  assert.equal(parsePublicCount("997K"), 997_000);
  assert.equal(parsePublicCount("11,526,894"), 11_526_894);
  assert.equal(parsePublicCount("1.2M"), 1_200_000);
  assert.equal(parsePublicCount("not public"), null);
});

test("industry freshness excludes old or undated feed entries", () => {
  const now = Date.parse("2026-08-24T12:00:00Z");
  assert.equal(isFreshTimestamp("2026-08-24T08:00:00Z", 24, now), true);
  assert.equal(isFreshTimestamp("2026-03-25T08:00:00Z", 24, now), false);
  assert.equal(isFreshTimestamp("", 24, now), false);
  assert.equal(isFreshTimestamp("2026-08-24T12:10:00Z", 24, now), true);
  assert.equal(isFreshTimestamp("2026-08-24T12:10:01Z", 24, now), false);
  assert.equal(isFreshTimestamp("2099-01-01T00:00:00Z", 24, now), false);

  const implausiblyFuture = { ...story("Bad publisher clock"), id: "future", publishedAt: "2099-01-01T00:00:00Z" };
  assert.deepEqual(filterPlausiblyDatedStories([
    story("Current"),
    implausiblyFuture,
  ], now).map((item) => item.title), ["Current"]);
});

test("invalid social profile values fall back to a configured handle", () => {
  assert.equal(isValidPublicProfileUrl("youtube", "alex@example.com"), false);
  assert.equal(isValidPublicProfileUrl("youtube", "https://www.youtube.com/watch?v=abc"), false);
  assert.equal(resolvePublicProfileUrl("youtube", "alex@example.com", "northstaralex"), "https://www.youtube.com/@northstaralex");
});

test("Threads public metadata exposes rounded follower and post counts", () => {
  const html = '<meta property="og:description" content="107.9K Followers &#x2022; 150 Threads" />';
  assert.deepEqual(parseThreadsPublicProfile(html), { followers: 107_900, threads: 150 });
});

test("collector refreshes preserve archive state in the local content store", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const current = story("Current story");
  upsertContentItems(database, "industry", [current], "2026-08-24T12:00:00Z");
  assert.deepEqual(listContentItems<LiveStory>(database, "industry").active.map((item) => item.title), ["Current story"]);
  assert.equal(setContentArchived(database, "industry", current.id, true, "2026-08-24T12:05:00Z"), true);
  upsertContentItems(database, "industry", [{ ...current, summary: "Updated upstream" }], "2026-08-24T12:10:00Z");
  const saved = listContentItems<LiveStory>(database, "industry");
  assert.equal(saved.active.length, 0);
  assert.equal(saved.archived[0].summary, "Updated upstream");
});

test("canonical URLs preserve one archived record when a title and external ID change", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const original = { ...story("Original title"), id: "old-id" };
  upsertContentItems(database, "industry", [original]);
  setContentArchived(database, "industry", original.id, true);
  upsertContentItems(database, "industry", [{ ...original, id: "new-id", title: "Corrected title" }]);
  const saved = listContentItems<LiveStory>(database, "industry");
  assert.equal(saved.active.length, 0);
  assert.equal(saved.archived.length, 1);
  assert.equal(saved.archived[0].id, "old-id");
  assert.equal(saved.archived[0].title, "Corrected title");
});

test("manual archives restore only while an Industry item is still fresh", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const fresh = { ...story("Fresh"), id: "fresh", url: "https://example.com/fresh", publishedAt: "2026-08-24T10:00:00Z" };
  const expired = { ...story("Expired"), id: "expired", url: "https://example.com/expired", publishedAt: "2026-08-22T10:00:00Z" };
  upsertContentItems(database, "industry", [fresh, expired], "2026-08-24T12:00:00Z");
  setContentArchived(database, "industry", fresh.id, true, "2026-08-24T12:05:00Z");
  setContentArchived(database, "industry", expired.id, true, "2026-08-24T12:05:00Z");
  const archived = listContentItems<LiveStory>(database, "industry", { freshSince: "2026-08-23T12:00:00Z" }).archived;
  assert.equal(archived.find((item) => item.id === fresh.id)?.workflow?.restoreEligible, true);
  assert.equal(archived.find((item) => item.id === expired.id)?.workflow?.restoreEligible, false);
  setContentArchived(database, "industry", fresh.id, false, "2026-08-24T12:06:00Z");
  setContentArchived(database, "industry", expired.id, false, "2026-08-24T12:06:00Z");
  const restored = listContentItems<LiveStory>(database, "industry", { freshSince: "2026-08-23T12:00:00Z" });
  assert.deepEqual(restored.active.map((item) => item.id), [fresh.id]);
  assert.equal(restored.archived[0].workflow?.archiveReason, "expired");
});

test("the local archive library does not hide history after 500 items", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const items = Array.from({ length: 501 }, (_, index) => ({ ...story(`Story ${index}`), id: `story-${index}`, url: `https://example.com/story-${index}` }));
  upsertContentItems(database, "mentions", items);
  for (const item of items) setContentArchived(database, "mentions", item.id, true);
  assert.equal(listContentItems<LiveStory>(database, "mentions").archived.length, 501);
});

test("reminders and tasks persist in SQLite and tolerate one corrupt row", () => {
  const database = initializeWorkspaceStore(new DatabaseSync(":memory:"));
  assert.equal(hasWorkspaceState(database), false);
  writeWorkspaceState(database, {
    reminders: [{ id: "reminder-1", type: "Link", title: "Read later", source: "example.com", note: "Useful", accent: "teal" }],
    tasks: [{ id: "task-1", title: "Follow up", description: "Send notes", due: "2026-08-25", recurrence: "One-time", priority: "Normal", done: false }],
  });
  assert.equal(hasWorkspaceState(database), true);
  assert.equal(readWorkspaceState(database).reminders[0].title, "Read later");
  database.prepare("UPDATE workspace_state SET payload_json = ? WHERE state_key = 'tasks'").run("not-json");
  const recovered = readWorkspaceState(database);
  assert.equal(recovered.reminders.length, 1);
  assert.deepEqual(recovered.tasks, []);
});
