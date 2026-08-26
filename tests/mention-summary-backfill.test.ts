import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { initializeContentStore, listContentItems, setContentArchived, upsertContentItems } from "../lib/archive-store";
import {
  preserveSavedMentionCuration,
  revalidateMentionSummaryBackfill,
  selectMentionSummaryBackfill,
  type MentionBackfillPage,
} from "../lib/mention-summary-backfill";
import type { LiveStory } from "../lib/types";

const now = "2026-08-25T15:00:00Z";
const options = { scope: "current-scope", provider: "openai" as const, now, windowDays: 7 };
const validation = {
  ...options, identities: ["Cedar Farms", "cedarfarms.example"], identityAnchors: [],
  nicheContexts: ["agriculture"], negativeTerms: ["football"], strictMode: true,
  excludeOwnedSites: true, websites: ["https://cedarfarms.example"],
};
const source: LiveStory = {
  id: "saved-one", kind: "mention", title: "Cedar Farms reports new harvest findings",
  summary: "Cedar Farms (cedarfarms.example) is discussed in a harvest report.",
  url: "https://trade.example/harvest", source: "Trade Journal", publishedAt: "2026-08-24T12:00:00Z",
  discoveredAt: "2026-08-24T13:00:00Z", confidence: "high", matchedTerm: "Cedar Farms",
  matchReasons: ["Exact company name and official domain"], collectionScope: options.scope,
};
const page: MentionBackfillPage = {
  url: source.url, title: "Cedar Farms shares its harvest findings", summary: "New agricultural findings from Cedar Farms.",
  source: "trade.example", publishedAt: source.publishedAt,
  pageText: "Cedar Farms (cedarfarms.example) announced agricultural harvest findings and discussed local crop conditions.",
};

test("summary backfill considers retained active mentions absent from the latest discovery, bounded to 24", () => {
  const saved = Array.from({ length: 35 }, (_, index) => ({ ...source, id: `saved-${index}`, url: `https://trade.example/story-${index}` }));
  const selected = selectMentionSummaryBackfill(saved, [saved[0]], options);
  assert.equal(selected.length, 24);
  assert.ok(selected.every((story) => story.id !== saved[0].id));
  assert.ok(selected.every((story) => story.discoveredAt === source.discoveredAt));
  assert.equal(selectMentionSummaryBackfill([source], [{ ...source, id: "different-discovery-id" }], options).length, 0);
});

test("archived, expired, future, removed-scope and already-curated same-provider mentions never enter backfill", () => {
  const variations: LiveStory[] = [
    { ...source, id: "archived", workflow: { archiveReason: "user", restoreEligible: true } },
    { ...source, id: "expired", publishedAt: "2026-08-01T12:00:00Z" },
    { ...source, id: "future", publishedAt: "2026-08-26T12:00:00Z" },
    { ...source, id: "removed", collectionScope: "removed-scope" },
    { ...source, id: "curated", aiSummary: "A previously grounded page summary.", curationMode: "openai" },
    { ...source, id: "undated-old", publishedAt: "", discoveredAt: "2026-08-01T12:00:00Z" },
    { ...source, id: "wrapper", url: "https://news.google.com/rss/articles/wrapper" },
  ];
  assert.equal(selectMentionSummaryBackfill(variations, [], options).length, 0);
  assert.equal(selectMentionSummaryBackfill([{ ...source, aiSummary: "A previous provider's grounded summary.", curationMode: "gemini" }], [], options).length, 1);
});

test("saved archive state and current scope exclude backfill without altering local content", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const archived = { ...source, id: "archived", url: "https://trade.example/archived" };
  upsertContentItems(database, "mentions", [source, archived, { ...source, id: "old-scope", url: "https://trade.example/old", collectionScope: "removed-scope" }]);
  setContentArchived(database, "mentions", archived.id, true, now);
  const saved = listContentItems<LiveStory>(database, "mentions", { freshSince: "2026-08-18T15:00:00Z", freshUntil: now, activeScopes: [options.scope] });
  assert.deepEqual(selectMentionSummaryBackfill(saved.active, [], options).map((story) => story.id), [source.id]);
  assert.equal(saved.archived.length, 2);
  assert.equal(database.prepare("SELECT archived_at FROM content_items WHERE external_id = ?").get(archived.id)?.archived_at, now);
});

test("backfill revalidates only freshly fetched identity evidence, not an old saved title or summary", () => {
  assert.equal(revalidateMentionSummaryBackfill(source, null, validation), null);
  assert.equal(revalidateMentionSummaryBackfill(source, { ...page, title: "Regional news", summary: "Today's regional headlines", pageText: "No tracked identity appears on this page anymore." }, validation), null);
  assert.equal(revalidateMentionSummaryBackfill(source, { ...page, pageText: `${page.pageText} The story concerns football.` }, validation), null);
  assert.equal(revalidateMentionSummaryBackfill(source, { ...page, url: "https://cedarfarms.example/harvest" }, validation), null);
  assert.equal(revalidateMentionSummaryBackfill(source, { ...page, publishedAt: "2026-08-01T12:00:00Z" }, validation), null);
  assert.equal(revalidateMentionSummaryBackfill({ ...source, collectionScope: "removed" }, page, validation), null);
  const accepted = revalidateMentionSummaryBackfill(source, page, validation)!;
  assert.equal(accepted.story.id, source.id);
  assert.equal(accepted.story.discoveredAt, source.discoveredAt);
  assert.equal(accepted.story.publishedAt, source.publishedAt);
  assert.equal(accepted.story.collectionScope, source.collectionScope);
  assert.equal(accepted.story.confidence, "high");
});

test("undated backfill keeps original discovery and cannot refresh stale dates", () => {
  const accepted = revalidateMentionSummaryBackfill({ ...source, publishedAt: "" }, { ...page, publishedAt: "" }, validation)!;
  assert.equal(accepted.story.discoveredAt, source.discoveredAt);
  assert.equal(accepted.story.publishedAt, "");
  assert.equal(revalidateMentionSummaryBackfill({ ...source, publishedAt: "", discoveredAt: "2026-08-01T12:00:00Z" }, page, validation), null);
});

test("rediscovery preserves grounded saved summaries until a successful replacement and never restores removed-scope metadata", () => {
  const saved = { ...source, aiSummary: "A grounded summary from a previous successful pass.", importanceScore: 72, importanceReason: "Substantive tracked-company coverage.", curationMode: "gemini" as const };
  const rediscovered = { ...source, discoveredAt: now };
  const preserved = preserveSavedMentionCuration([rediscovered], [saved], options.scope)[0];
  assert.equal(preserved.aiSummary, saved.aiSummary);
  assert.equal(preserved.importanceScore, 72);
  assert.equal(preserved.curationMode, "gemini");
  assert.equal(preserved.discoveredAt, source.discoveredAt);
  const replaced = preserveSavedMentionCuration([{ ...rediscovered, aiSummary: "A newly grounded summary.", curationMode: "openai" }], [saved], options.scope)[0];
  assert.equal(replaced.aiSummary, "A newly grounded summary.");
  assert.equal(replaced.curationMode, "openai");
  assert.equal(preserveSavedMentionCuration([rediscovered], [{ ...saved, collectionScope: "removed-scope" }], options.scope)[0].aiSummary, undefined);
  assert.equal(preserveSavedMentionCuration([rediscovered], [{ ...saved, workflow: { archiveReason: "user", restoreEligible: true } }], options.scope)[0].aiSummary, undefined);
});
