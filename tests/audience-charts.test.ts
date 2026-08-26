import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIENCE_CHART_MAX_GAP_MS,
  audienceChartDomain,
  audienceHistoryPoints,
  buildAudienceChartSeries,
  configuredAudienceHistory,
  splitAudienceChartGaps,
  summarizeAudienceMetrics,
  type AudienceHistorySeries,
} from "../lib/audience-charts";
import { nextAudienceHistory, type AudienceSnapshotHistory } from "../lib/audience-growth";
import { audienceAccountFingerprint } from "../lib/public-metrics";
import type { AudienceAccountInput, AudienceMetric } from "../lib/types";

const now = Date.parse("2026-08-25T12:00:00Z");
const account: AudienceAccountInput = {
  id: "garden-youtube", platform: "youtube", label: "Garden studio",
  username: "garden", accountId: "", profileUrl: "https://youtube.com/@garden",
};
const metric: AudienceMetric = {
  id: account.id, label: account.label, platform: account.platform, handle: "@garden",
  total: 130, change: 20, primaryLabel: "subscribers", checkedAt: new Date(now).toISOString(),
};
const history: AudienceHistorySeries = {
  id: account.id, platform: account.platform, primaryLabel: "subscribers",
  samples: [
    { total: 100, checkedAt: "2026-08-23T12:00:00Z" },
    { total: 110, checkedAt: "2026-08-24T12:00:00Z" },
  ],
  latest: { total: 130, checkedAt: "2026-08-25T12:00:00Z" },
};

test("audience chart history is chronological, deduplicates timestamps, and preserves a real latest endpoint", () => {
  const points = audienceHistoryPoints({
    ...history,
    samples: [...history.samples].reverse().concat({ total: 125, checkedAt: "2026-08-25T12:00:00Z" }),
  }, 7, now);
  assert.deepEqual(points.map((point) => point.total), [100, 110, 130]);
  assert.deepEqual(points.map((point) => point.change), [0, 10, 30]);
  assert.deepEqual(points.map((point) => point.percentChange), [0, 10, 30]);
  assert.equal(points[2].checkedAt, history.latest?.checkedAt);
});

test("7-day and 30-day charts use only saved history inside their window", () => {
  const older = { ...history, samples: [
    { total: 50, checkedAt: "2026-07-24T12:00:00Z" },
    { total: 75, checkedAt: "2026-08-05T12:00:00Z" },
    ...history.samples,
  ] };
  const week = audienceHistoryPoints(older, 7, now);
  const month = audienceHistoryPoints(older, 30, now);
  assert.deepEqual(week.map((point) => point.total), [100, 110, 130]);
  assert.deepEqual(month.map((point) => point.total), [75, 100, 110, 130]);
  assert.equal(week[0].checkedAt, "2026-08-23T12:00:00Z", "no synthetic point at the start of the selected window");
  assert.equal(month.at(-1)?.change, 55);
});

test("invalid, future, and missing counts never turn into zero readings", () => {
  const points = audienceHistoryPoints({ ...history, samples: [
    ...history.samples,
    { total: Number.NaN, checkedAt: "2026-08-25T00:00:00Z" },
    { total: -1, checkedAt: "2026-08-25T01:00:00Z" },
    { total: Infinity, checkedAt: "2026-08-25T02:00:00Z" },
    { total: 100, checkedAt: "invalid" },
    { total: 999, checkedAt: "2026-08-26T12:00:00Z" },
  ] }, 7, now);
  assert.deepEqual(points.map((point) => point.total), [100, 110, 130]);
});

test("zero is a valid count but cannot be used as a percentage-growth baseline", () => {
  const points = audienceHistoryPoints({ ...history, samples: [{ total: 0, checkedAt: "2026-08-24T12:00:00Z" }] }, 7, now);
  assert.deepEqual(points.map((point) => point.total), [0, 130]);
  assert.deepEqual(points.map((point) => point.percentChange), [null, null]);
  assert.equal(points.at(-1)?.change, 130);
});

test("chart lines break over missed-check gaps instead of connecting invented continuity", () => {
  const points = audienceHistoryPoints({ ...history, samples: [
    { total: 50, checkedAt: "2026-08-20T12:00:00Z" },
    { total: 70, checkedAt: "2026-08-21T12:00:00Z" },
    { total: 100, checkedAt: "2026-08-24T12:00:00Z" },
  ] }, 7, now);
  const segments = splitAudienceChartGaps(points);
  assert.deepEqual(segments.map((segment) => segment.map((point) => point.total)), [[50, 70], [100, 130]]);
  const boundary = points.slice(0, 2).map((point, index) => ({ ...point, timestamp: now + index * AUDIENCE_CHART_MAX_GAP_MS }));
  assert.equal(splitAudienceChartGaps(boundary).length, 1, "36h cadence is still comparable");
});

test("public history DTO includes only configured identity-matching accounts and safe fields", () => {
  const stored = nextAudienceHistory({
    total: 130, checkedAt: new Date(now).toISOString(), primaryLabel: "subscribers",
    handle: "@garden", source: "provider metadata", secondaryValue: 42,
  }, audienceAccountFingerprint(account));
  const snapshots: AudienceSnapshotHistory = { version: 2, accounts: {
    [account.id]: stored,
    "removed-account": { ...stored, fingerprint: "private old identity" },
  } };
  const result = configuredAudienceHistory([account], snapshots, now);
  assert.deepEqual(result, [{
    id: account.id, platform: "youtube", primaryLabel: "subscribers",
    samples: [{ total: 130, checkedAt: new Date(now).toISOString() }],
    latest: { total: 130, checkedAt: new Date(now).toISOString() },
  }]);
  assert.ok(!JSON.stringify(result).includes("fingerprint"));
  assert.ok(!JSON.stringify(result).includes("provider metadata"));
});

test("changing a configured account identity cannot reuse the previous profile history", () => {
  const snapshots: AudienceSnapshotHistory = { version: 2, accounts: {
    [account.id]: nextAudienceHistory({ total: 130, checkedAt: new Date(now).toISOString(), primaryLabel: "subscribers" }, audienceAccountFingerprint(account)),
  } };
  assert.deepEqual(configuredAudienceHistory([{ ...account, username: "flowers", profileUrl: "https://youtube.com/@flowers" }], snapshots, now), []);
  assert.deepEqual(configuredAudienceHistory([{ ...account, accountId: "different-channel" }], snapshots, now), []);
});

test("metric changes do not mix follower and page-like counts in public history", () => {
  const stored = nextAudienceHistory({ total: 130, checkedAt: new Date(now).toISOString(), primaryLabel: "subscribers" }, audienceAccountFingerprint(account));
  stored.samples.push({ total: 1200, checkedAt: "2026-08-24T12:00:00Z", primaryLabel: "page likes" });
  const result = configuredAudienceHistory([account], { version: 2, accounts: { [account.id]: stored } }, now);
  assert.equal(result[0].samples.length, 1);
  assert.equal(result[0].samples[0].total, 130);
});

test("history DTO ignores samples beyond retention and timestamps in the future", () => {
  const stored = nextAudienceHistory({ total: 130, checkedAt: new Date(now).toISOString(), primaryLabel: "subscribers" }, audienceAccountFingerprint(account));
  stored.samples.push(
    { total: 12, checkedAt: "2026-06-01T12:00:00Z", primaryLabel: "subscribers" },
    { total: 90, checkedAt: "2026-08-26T12:00:00Z", primaryLabel: "subscribers" },
  );
  const result = configuredAudienceHistory([account], { version: 2, accounts: { [account.id]: stored } }, now);
  assert.equal(result[0].samples.length, 1);
});

test("chart models match account and metric, retain display order, and skip unrelated history", () => {
  const items = [metric, { ...metric, id: "other", platform: "instagram" as const, primaryLabel: "followers" as const }];
  const result = buildAudienceChartSeries(items, [history, { ...history, id: "other" }, { ...history, id: "removed" }], 7, now);
  assert.deepEqual(result.map((entry) => entry.id), [account.id, "other"]);
  assert.equal(result[0].change, 30);
  assert.equal(result[0].elapsedMs, 48 * 60 * 60 * 1000);
  assert.equal(result[1].points.length, 0);
  assert.equal(result[1].change, null);
});

test("one reading is a baseline, not measured zero growth", () => {
  const result = buildAudienceChartSeries([metric], [{ ...history, samples: [], latest: history.latest }], 7, now)[0];
  assert.equal(result.points.length, 1);
  assert.equal(result.change, null);
  assert.equal(result.percentChange, null);
  assert.equal(result.elapsedMs, 0);
});

test("failed checks preserve old history without adding a fresh timestamp or filling a zero", () => {
  const stored = { ...history, latest: { total: 110, checkedAt: "2026-08-24T12:00:00Z" } };
  const result = buildAudienceChartSeries([{ ...metric, stale: true, error: "Provider unavailable", lastSuccessfulAt: stored.latest.checkedAt }], [stored], 7, now)[0];
  assert.equal(result.lastKnown, true);
  assert.equal(result.points.at(-1)?.checkedAt, "2026-08-24T12:00:00Z");
  assert.equal(result.points.at(-1)?.total, 110);
  assert.equal(result.points.length, 2);
});

test("negative growth remains negative and flat growth remains genuinely zero", () => {
  const decline = buildAudienceChartSeries([metric], [{ ...history, latest: { total: 80, checkedAt: new Date(now).toISOString() } }], 7, now)[0];
  assert.equal(decline.change, -20);
  assert.equal(decline.percentChange, -20);
  const flat = buildAudienceChartSeries([metric], [{ ...history, samples: [{ total: 130, checkedAt: "2026-08-24T12:00:00Z" }] }], 7, now)[0];
  assert.equal(flat.change, 0);
  assert.equal(flat.percentChange, 0);
});

test("domains are finite, include growth zero, and count axes do not imply negative audience", () => {
  const result = buildAudienceChartSeries([metric], [history], 7, now);
  const growth = audienceChartDomain(result, "growth");
  assert.ok(growth[0] < 0 && growth[1] > 30);
  const counts = audienceChartDomain(result, "total");
  assert.equal(counts[0], 0);
  assert.ok(counts[1] > 130);
  assert.deepEqual(audienceChartDomain([], "growth"), [-1, 1]);
  assert.deepEqual(audienceChartDomain([], "total"), [0, 1]);
});

test("summary labels last-known totals and excludes stale or unavailable daily changes", () => {
  const summary = summarizeAudienceMetrics([
    metric,
    { ...metric, id: "stale", total: 100, change: 500, stale: true, error: "Provider blocked" },
    { ...metric, id: "missing", total: null, change: null, error: "Unavailable" },
    { ...metric, id: "zero", total: 0, change: -5 },
  ]);
  assert.deepEqual(summary, { total: 230, knownCount: 3, lastKnownCount: 1, change: 15, comparisonCount: 2 });
  assert.deepEqual(summarizeAudienceMetrics([{ ...metric, total: null, change: null, error: "Unavailable" }]), {
    total: null, knownCount: 0, lastKnownCount: 0, change: null, comparisonCount: 0,
  });
  assert.equal(summarizeAudienceMetrics([{ ...metric, total: null, change: 20 }]).change, null, "a missing verified total cannot contribute a daily change");
});
