import assert from "node:assert/strict";
import test from "node:test";
import {
  localMentionPriority,
  newsletterPriority,
  newsletterSourceOptions,
  selectNewsletterTopics,
  sortFeedStories,
} from "../lib/feed-priority";
import type { LiveStory, NewsletterTopic } from "../lib/types";

function topic(id: string, overrides: Partial<NewsletterTopic> = {}): NewsletterTopic {
  return {
    id, kind: "newsletter-topic", title: `Research update ${id}`, summary: "A verified development relevant to this industry.",
    receivedAt: "2026-08-25T12:00:00.000Z", url: `https://example.com/${id}`,
    gmailUrl: `https://mail.google.com/#all/${id}`, coverageCount: 1, newsletterCount: 1,
    newsletterSources: ["Daily Brief"], evidenceIssueIds: [id], collectionScope: "scope",
    sourceLinks: [{ url: `https://example.com/${id}`, title: `Research update ${id}`, publisher: "example.com" }],
    ...overrides,
  };
}

test("priority sorting is deterministic, does not mutate input, and handles invalid dates", () => {
  const items = [
    topic("older", { importanceScore: 80, receivedAt: "2026-08-24T12:00:00Z" }),
    topic("newer", { importanceScore: 50 }),
    topic("no-date", { importanceScore: 50, receivedAt: "invalid" }),
    topic("top", { importanceScore: 90 }),
  ];
  assert.deepEqual(sortFeedStories(items).map(({ id }) => id), ["top", "older", "newer", "no-date"]);
  assert.deepEqual(sortFeedStories(items, "oldest").map(({ id }) => id), ["older", "newer", "top", "no-date"]);
  assert.deepEqual(sortFeedStories(items, "newest").map(({ id }) => id), ["newer", "top", "older", "no-date"]);
  assert.equal(items[0].id, "older");
});

test("newsletter filters combine newsletter OR selection with all query terms", () => {
  const items = [
    topic("one", { newsletterSources: ["Daily Brief", "Research Roundup"], importanceScore: 90 }),
    topic("two", { newsletterSources: ["Markets Daily"], title: "Market earnings update", importanceScore: 80 }),
    topic("three", { newsletterSources: ["Research Roundup"], importanceScore: 70 }),
  ];
  assert.deepEqual(selectNewsletterTopics(items, { sources: ["research roundup", "Markets Daily"], query: "research update" })
    .map(({ id }) => id), ["one", "three"]);
  assert.equal(selectNewsletterTopics(items, { sources: ["not configured"] }).length, 0);
  assert.equal(selectNewsletterTopics(items, { query: "example.com" }).length, 3);
  assert.equal(selectNewsletterTopics(items, { query: "   " }).length, 3);
});

test("newsletter source counts describe the full collection and count each topic once", () => {
  const items = Array.from({ length: 75 }, (_, index) => topic(String(index), {
    newsletterSources: index === 0 ? ["Daily Brief", "daily brief", "Research Roundup"] : ["Daily Brief"],
  }));
  assert.deepEqual(newsletterSourceOptions(items), [
    { name: "Daily Brief", count: 75 }, { name: "Research Roundup", count: 1 },
  ]);
  assert.equal(selectNewsletterTopics(items, { sources: ["Daily Brief"] }).length, 75);
});

test("cross-newsletter coverage boosts AI priority once, never once per refresh", () => {
  const source = topic("one", {
    importanceBaseScore: 72, importanceScore: 72, curationMode: "openai",
    newsletterSources: ["First", "Second", "Third"],
  });
  const ranked = newsletterPriority(source);
  assert.equal(ranked.importanceScore, 84);
  assert.deepEqual(newsletterPriority(ranked), ranked);
  assert.equal(newsletterPriority({ ...ranked, newsletterSources: Array.from({ length: 30 }, (_, i) => String(i)) }).importanceScore, 90);
});

test("older saved newsletter topics get transparent local fallback and retain archive state", () => {
  const archived = topic("archived", { workflow: { archiveReason: "user", archivedAt: "2026-08-25T12:00:00Z", restoreEligible: true } });
  const ranked = newsletterPriority(archived);
  assert.equal(ranked.curationMode, "local");
  assert.equal(ranked.importanceScore, 50);
  assert.deepEqual(ranked.workflow, archived.workflow);
  assert.equal(selectNewsletterTopics([ranked], { query: "research" })[0].workflow?.archiveReason, "user");
});

test("built-in mention priority is niche-independent and never upgrades confidence", () => {
  const mention: LiveStory = {
    id: "one", kind: "mention", title: "Cedar Farms discusses regional harvests", summary: "A report about the harvest.",
    url: "https://journal.example/harvest", source: "Journal", publishedAt: "2026-08-25T12:00:00Z",
    matchedTerm: "Cedar Farms", confidence: "medium", matchReasons: ["Direct identity evidence"],
  };
  const ranked = localMentionPriority(mention);
  assert.equal(ranked.confidence, "medium");
  assert.equal(ranked.importanceScore, 65);
  assert.equal(ranked.curationMode, "local");
  assert.equal(ranked.url, mention.url);
  assert.equal(localMentionPriority({ ...mention, importanceScore: 91, curationMode: "ollama" }).importanceScore, 91);
});
