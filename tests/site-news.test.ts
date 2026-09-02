import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeedPayload,
  categoriseStory,
  categoryLabel,
  dedupeNewsItems,
  resolveNewsItems,
  hostLabel,
  sortNewsItems,
  trimSummary,
  type SiteNewsItem,
} from "../lib/site-news.ts";

function story(over: Partial<SiteNewsItem> = {}): SiteNewsItem {
  return {
    id: "a",
    title: "A headline",
    summary: "A summary.",
    url: "https://example.com/a",
    source: "Example",
    category: "industry-news",
    publishedAt: "2026-09-01T10:00:00.000Z",
    approvedAt: "2026-09-01T12:00:00.000Z",
    pin: 0,
    ...over,
  };
}

// ---------------------------------------------------------------- categories

test("funding language beats the AI rule when both appear", () => {
  // A tender for AI work is a tender first - that is what you would act on.
  assert.equal(
    categoriseStory("NFVF opens call for proposals on AI-assisted animation"),
    "funding",
  );
});

test("AI stories are filed as AI even when African", () => {
  assert.equal(categoriseStory("Sora 2 lands in South African studios"), "ai-animation");
});

test("African stories with no AI or funding angle fall to africa", () => {
  assert.equal(categoriseStory("Nollywood animation slate expands"), "africa");
});

test("broadcast commissions are recognised", () => {
  assert.equal(categoriseStory("Netflix commissions a new series"), "broadcast");
});

test("anything unmatched falls back rather than guessing", () => {
  assert.equal(categoriseStory("Quarterly results announced"), "industry-news");
  assert.equal(categoryLabel("nonsense"), "Industry News");
});

// ---------------------------------------------------------------- trimming

test("short summaries pass through untouched", () => {
  assert.equal(trimSummary("Short and done."), "Short and done.");
});

test("long summaries cut at a sentence end when there is one", () => {
  const text = `${"x".repeat(150)}. ${"y".repeat(200)}`;
  const out = trimSummary(text, 260);
  assert.ok(out.endsWith("."), "should end on the sentence break");
  assert.ok(out.length <= 260);
});

test("without a sentence break it cuts on a word, never mid-word", () => {
  const out = trimSummary(`${"word ".repeat(120)}`, 100);
  assert.ok(out.endsWith("…"));
  assert.ok(!/\bwor…$/.test(out), "must not slice through a word");
});

test("whitespace is collapsed so feed formatting does not leak through", () => {
  assert.equal(trimSummary("a\n\n  b\tc"), "a b c");
});

// ---------------------------------------------------------------- hosts

test("host labels drop the www", () => {
  assert.equal(hostLabel("https://www.screenafrica.com/x"), "screenafrica.com");
  assert.equal(hostLabel("not a url"), "");
});

// ---------------------------------------------------------------- ordering

test("pinned items sort above newer unpinned ones", () => {
  const out = sortNewsItems([
    story({ id: "new", publishedAt: "2026-09-02T00:00:00.000Z" }),
    story({ id: "pinned", publishedAt: "2026-08-01T00:00:00.000Z", pin: 1 }),
  ]);
  assert.deepEqual(
    out.map((i) => i.id),
    ["pinned", "new"],
  );
});

test("otherwise newest first", () => {
  const out = sortNewsItems([
    story({ id: "old", publishedAt: "2026-08-01T00:00:00.000Z" }),
    story({ id: "new", publishedAt: "2026-09-02T00:00:00.000Z" }),
  ]);
  assert.deepEqual(
    out.map((i) => i.id),
    ["new", "old"],
  );
});

test("items with no usable publish date fall back to approval order", () => {
  const out = sortNewsItems([
    story({ id: "first", publishedAt: "", approvedAt: "2026-09-01T00:00:00.000Z" }),
    story({ id: "second", publishedAt: "", approvedAt: "2026-09-03T00:00:00.000Z" }),
  ]);
  assert.equal(out[0].id, "second");
});

// ---------------------------------------------------------------- dedupe

test("the same URL twice keeps only the first", () => {
  const out = dedupeNewsItems([
    story({ id: "a", url: "https://example.com/x" }),
    story({ id: "b", url: "https://example.com/x/" }),
    story({ id: "c", url: "https://example.com/x?utm_source=rss" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "a");
});

test("the same headline from two outlets collapses", () => {
  const out = dedupeNewsItems([
    story({ id: "a", title: "Studio wins award!", url: "https://one.com/a" }),
    story({ id: "b", title: "Studio wins award", url: "https://two.com/b" }),
  ]);
  assert.equal(out.length, 1);
});

test("when two outlets carry the same story, the one approved first wins", () => {
  // Deduping a display-sorted list made this arbitrary. It should be the copy
  // the person ticked first, not whichever the sort left on top.
  const out = resolveNewsItems([
    story({
      id: "later",
      title: "Netflix commissions two African series",
      url: "https://deadline.com/y",
      source: "Deadline",
      approvedAt: "2026-09-01T14:00:00.000Z",
    }),
    story({
      id: "earlier",
      title: "Netflix commissions two African series!",
      url: "https://variety.com/x",
      source: "Variety",
      approvedAt: "2026-09-01T09:00:00.000Z",
    }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "Variety");
});

test("resolveNewsItems still sorts for display after deduping", () => {
  const out = resolveNewsItems([
    story({ id: "old", title: "Old", url: "https://a.com/1", publishedAt: "2026-08-01T00:00:00.000Z", approvedAt: "2026-09-01T00:00:00.000Z" }),
    story({ id: "new", title: "New", url: "https://a.com/2", publishedAt: "2026-09-02T00:00:00.000Z", approvedAt: "2026-09-02T00:00:00.000Z" }),
  ]);
  assert.deepEqual(out.map((i) => i.id), ["new", "old"]);
});

test("different stories survive dedupe", () => {
  const out = dedupeNewsItems([
    story({ id: "a", title: "One", url: "https://one.com/a" }),
    story({ id: "b", title: "Two", url: "https://two.com/b" }),
  ]);
  assert.equal(out.length, 2);
});

// ---------------------------------------------------------------- payload

test("the payload respects the limit and is ordered", () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    story({
      id: `s${i}`,
      title: `Story ${i}`,
      url: `https://example.com/${i}`,
      publishedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    }),
  );
  const payload = buildFeedPayload(items, { limit: 5 });
  assert.equal(payload.items.length, 5);
  assert.equal(payload.items[0].t, "Story 11", "newest first");
});

test("the payload carries a human category label, not the slug", () => {
  const payload = buildFeedPayload([story({ category: "ai-animation" })]);
  assert.equal(payload.items[0].cat, "AI Animation Trends");
});

test("a missing source falls back to the host so a row is never blank", () => {
  const payload = buildFeedPayload([
    story({ source: "", url: "https://www.varietv.com/piece" }),
  ]);
  assert.equal(payload.items[0].src, "varietv.com");
});

test("an empty approval list produces a valid empty feed", () => {
  const payload = buildFeedPayload([]);
  assert.deepEqual(payload.items, []);
  assert.ok(Date.parse(payload.generatedAt) > 0);
});

test("the payload is JSON-serialisable with no undefined leaking in", () => {
  const payload = buildFeedPayload([story()]);
  const round = JSON.parse(JSON.stringify(payload));
  assert.deepEqual(round, payload);
});
