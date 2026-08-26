import assert from "node:assert/strict";
import test from "node:test";
import { boundedMentionEvidence, cacheMentionCuration, mentionCurationKey, validateMentionCurations, type MentionCuration, type MentionCurationCacheEntry } from "../lib/mention-curation";
import type { LiveStory } from "../lib/types";

const story: LiveStory = {
  id: "verified-one", kind: "mention", title: "Cedar Farms discussed in a harvest report",
  summary: "A trade publication reports on harvest conditions.", url: "https://trade.example/harvest",
  source: "Trade Journal", publishedAt: "2026-08-25T12:00:00Z", matchedTerm: "Cedar Farms",
  confidence: "high", matchReasons: ["Official website appears with the exact company name"], collectionScope: "agriculture",
};

test("mention AI input requires accepted direct-page evidence and bounds identity-local context", () => {
  assert.equal(boundedMentionEvidence({ story: { ...story, confidence: undefined }, pageText: "Cedar Farms" }), null);
  assert.equal(boundedMentionEvidence({ story: { ...story, kind: "feed" }, pageText: "Cedar Farms" }), null);
  assert.equal(boundedMentionEvidence({ story, pageText: "" }), null);
  const input = boundedMentionEvidence({ story, pageText: `${"Navigation ".repeat(600)}Cedar Farms reports a record harvest. contact@cedar.example https://cedar.example/private?token=private ${"More detail ".repeat(500)}` })!;
  assert.ok(input.evidence.length <= 4_200);
  assert.match(input.evidence, /Cedar Farms reports a record harvest/);
  assert.doesNotMatch(input.evidence, /contact@cedar.example|token=private/);
  assert.equal("url" in input, false);
});

test("mention curation validates IDs and fields, drops invented URLs, and cannot edit identity", () => {
  const valid = { id: story.id, summary: "The trade publication covers Cedar Farms' harvest conditions and local supply.", score: 85, reason: "A substantive report focused on the tracked company." };
  const result = validateMentionCurations({ mentions: [
    { ...valid, id: "invented" },
    { ...valid, score: "100" },
    { ...valid, summary: "Read https://invented.example/source for details about the company." },
    { ...valid, confidence: "medium", url: "https://invented.example", matchedTerm: "Different Company" },
    valid,
  ] }, new Set([story.id]));
  assert.deepEqual(result, [{ id: story.id, aiSummary: valid.summary, importanceScore: 85, importanceReason: valid.reason }]);
  assert.equal("confidence" in result[0], false);
  assert.equal("url" in result[0], false);
  assert.throws(() => validateMentionCurations({}, new Set([story.id])), /summaries list/);
});

test("mention AI cache changes with evidence or settings but not arbitrary run timestamps", () => {
  const evidence = boundedMentionEvidence({ story, pageText: "Cedar Farms reports a record harvest." })!;
  const key = mentionCurationKey("provider/model/niche", evidence);
  assert.equal(mentionCurationKey("provider/model/niche", evidence), key);
  assert.notEqual(mentionCurationKey("new provider", evidence), key);
  assert.notEqual(mentionCurationKey("provider/model/niche", { ...evidence, evidence: "Changed harvest evidence" }), key);
});

test("mention cache evicts omitted and rejected summaries while retaining successful IDs", async () => {
  const cache = new Map<string, MentionCurationCacheEntry>();
  const success: MentionCuration = { id: "good", aiSummary: "A grounded page summary.", importanceScore: 70, importanceReason: "Substantive tracked-company coverage." };
  const results = [Promise.resolve(success), Promise.resolve(null), Promise.reject(new Error("provider failed"))];
  results.forEach((result, index) => cacheMentionCuration(cache, String(index), result, 100_000));
  await Promise.allSettled(results);
  assert.equal(cache.size, 1);
  assert.equal(await cache.get("0")?.result, success);
  assert.equal(cache.has("1"), false);
  assert.equal(cache.has("2"), false);
});

test("a late missing summary cannot evict a newer successful cache entry", async () => {
  const cache = new Map<string, MentionCurationCacheEntry>();
  let settleOld!: (value: MentionCuration | null) => void;
  const old = new Promise<MentionCuration | null>((resolve) => { settleOld = resolve; });
  const success = Promise.resolve<MentionCuration | null>({ id: "one", aiSummary: "A newer grounded page summary.", importanceScore: 75, importanceReason: "A directly relevant update." });
  cacheMentionCuration(cache, "one", old, 100_000);
  cacheMentionCuration(cache, "one", success, 200_000);
  settleOld(null);
  await Promise.all([old, success]);
  assert.equal(cache.get("one")?.result, success);
  assert.equal(cache.get("one")?.expiresAt, 200_000);
});
