import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyBriefSnapshot, normalizeBriefSections } from "../lib/daily-brief-snapshot";
import type { LiveFeedResponse, NewsletterFeedResponse } from "../lib/types";

const now = Date.parse("2026-08-25T15:00:00Z");
const story = (id: string, score: number, publishedAt = "2026-08-25T12:00:00Z") => ({
  id, title: `Story ${id}`, summary: "Evidence summary", url: `https://example.com/${id}`,
  source: "Example", importanceScore: score, publishedAt,
});
const feed: LiveFeedResponse = {
  configured: true, checkedAt: "2026-08-25T14:45:00Z", errors: [],
  items: [story("low", 30), story("high", 90), story("middle", 60), story("old", 100, "2026-08-20T12:00:00Z")],
};

test("daily snapshot honors per-tab limits, priority, freshness and disabled tabs", () => {
  const result = buildDailyBriefSnapshot({industry: 2, mentions: 0, newsletters: 0}, {industry: feed, mentions: feed}, now);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].items.map(({id}) => id), ["high", "middle"]);
  assert.equal(result[0].availableCount, 3);
  assert.equal(result[0].stale, false);
});

test("brief snapshots exclude archives and future items and prefer grounded AI summaries", () => {
  const result = buildDailyBriefSnapshot({industry: 5, mentions: 0, newsletters: 0}, {industry: {
    ...feed, items: [{...story("archived", 100), workflow: {archiveReason:"user", restoreEligible:true}},
      {...story("kept", 90), aiSummary:"Grounded summary"}, story("future", 100, "2027-01-01T00:00:00Z")],
  }}, now);
  assert.deepEqual(result[0].items.map(({id}) => id), ["kept"]);
  assert.equal(result[0].items[0].summary, "Grounded summary");
});

test("missing caches produce honest empty sections instead of launching collectors", () => {
  const result = buildDailyBriefSnapshot({industry: 5, mentions: 5, newsletters: 5}, {}, now);
  assert.equal(result.length, 3);
  assert.ok(result.every((section) => section.items.length === 0 && section.stale && !section.configured));
});

test("newsletter snapshot uses saved priority and its own reading window", () => {
  const newsletter: NewsletterFeedResponse = {
    configured:true, connected:true, checkedAt:feed.checkedAt, archiveCount:0, archivedItems:[], errors:[],
    items:[{id:"news",kind:"newsletter-topic",title:"News",summary:"Reported news",url:"https://example.com/news",gmailUrl:"https://mail.google.com/",receivedAt:"2026-08-24T09:00:00Z",importanceScore:90,coverageCount:2,newsletterCount:2,newsletterSources:["A","B"],sourceLinks:[],collectionScope:"test"}],
  };
  assert.equal(buildDailyBriefSnapshot({industry:0,mentions:0,newsletters:5},{newsletters:newsletter},now)[0].items.length,1);
});

test("brief settings migrate to five per tab and normalize limits without changing zero", () => {
  assert.deepEqual(normalizeBriefSections(undefined), {industry:5,mentions:5,newsletters:5});
  assert.deepEqual(normalizeBriefSections({industry:0,mentions:500,newsletters:-2}), {industry:0,mentions:10,newsletters:0});
  assert.equal(normalizeBriefSections({industry:NaN}).industry,5);
});

test("brief matches the newsletter tab's fallback coverage ranking for legacy caches", () => {
  const topic = {id:"newer",kind:"newsletter-topic" as const,title:"Newer",summary:"News",url:"https://example.com/news",gmailUrl:"https://mail.google.com/",receivedAt:"2026-08-25T14:00:00Z",coverageCount:1,newsletterCount:1,newsletterSources:["A"],sourceLinks:[],collectionScope:"test"};
  const newsletters: NewsletterFeedResponse = {
    configured:true,connected:true,checkedAt:feed.checkedAt,archiveCount:0,archivedItems:[],errors:[],
    items:[topic,{...topic,id:"cross-reported",receivedAt:"2026-08-25T13:00:00Z",newsletterSources:["A","B","C"]}],
  };
  const result = buildDailyBriefSnapshot({industry:0,mentions:0,newsletters:1},{newsletters},now);
  assert.equal(result[0].items[0].id,"cross-reported");
});

test("brief breaks equal-priority undated mentions by their real discovery time", () => {
  const mentions = {...feed,items:[
    {...story("a",70,""),discoveredAt:"2026-08-25T10:00:00Z"},
    {...story("z",70,""),discoveredAt:"2026-08-25T14:00:00Z"},
  ]};
  const result = buildDailyBriefSnapshot({industry:0,mentions:1,newsletters:0},{mentions},now);
  assert.equal(result[0].items[0].id,"z");
});
