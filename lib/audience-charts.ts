import type {
  AudienceAccountInput,
  AudienceMetric,
  AudiencePlatform,
  AudiencePrimaryMetric,
} from "./types";
import {
  AUDIENCE_HISTORY_RETENTION_MS,
  type AudienceSnapshotHistory,
} from "./audience-growth";
import { audienceAccountFingerprint } from "./public-metrics";

export const AUDIENCE_CHART_MAX_GAP_MS = 36 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AudienceChartRange = 7 | 30;
export type AudienceChartMode = "growth" | "total";
export type AudienceHistoryPoint = { total: number; checkedAt: string };

/** Public history DTO. Never include credentials, fingerprints, or removed accounts. */
export type AudienceHistorySeries = {
  id: string;
  platform: AudiencePlatform;
  primaryLabel: AudiencePrimaryMetric;
  samples: AudienceHistoryPoint[];
  latest?: AudienceHistoryPoint;
};

export type AudienceChartPoint = AudienceHistoryPoint & {
  timestamp: number;
  change: number;
  percentChange: number | null;
};

export type AudienceChartSeries = {
  id: string;
  label: string;
  platform: AudiencePlatform;
  primaryLabel: AudiencePrimaryMetric;
  points: AudienceChartPoint[];
  segments: AudienceChartPoint[][];
  change: number | null;
  percentChange: number | null;
  elapsedMs: number;
  hasGaps: boolean;
  lastKnown: boolean;
};

type AccountIdentity = Pick<
  AudienceAccountInput,
  "id" | "platform" | "profileUrl" | "username" | "accountId"
>;

function validPoint(point: AudienceHistoryPoint) {
  return (
    Number.isFinite(point.total) &&
    point.total >= 0 &&
    Number.isFinite(Date.parse(point.checkedAt))
  );
}

function cleanPoint(point: AudienceHistoryPoint): AudienceHistoryPoint {
  return { total: point.total, checkedAt: point.checkedAt };
}

/** Read only the history belonging to each configured canonical account identity. */
export function configuredAudienceHistory(
  accounts: AccountIdentity[],
  snapshots: AudienceSnapshotHistory,
  now = Date.now(),
): AudienceHistorySeries[] {
  const cutoff = now - AUDIENCE_HISTORY_RETENTION_MS;
  return accounts.flatMap((account) => {
    const stored = snapshots.accounts[account.id];
    if (
      !stored ||
      stored.fingerprint !== audienceAccountFingerprint(account) ||
      !stored.latest.primaryLabel ||
      !validPoint(stored.latest)
    ) return [];
    const primaryLabel = stored.latest.primaryLabel;
    const samples = stored.samples
      .filter((sample) => {
        const timestamp = Date.parse(sample.checkedAt);
        return validPoint(sample) && sample.primaryLabel === primaryLabel &&
          timestamp >= cutoff && timestamp <= now;
      })
      .map(cleanPoint)
      .sort((left, right) => Date.parse(left.checkedAt) - Date.parse(right.checkedAt));
    const latestTime = Date.parse(stored.latest.checkedAt);
    return [{
      id: account.id,
      platform: account.platform,
      primaryLabel,
      samples,
      ...(latestTime >= cutoff && latestTime <= now
        ? { latest: cleanPoint(stored.latest) }
        : {}),
    }];
  });
}

export function audienceHistoryPoints(
  history: AudienceHistorySeries,
  days: AudienceChartRange,
  now: number,
): AudienceChartPoint[] {
  const cutoff = now - days * DAY_MS;
  const byTimestamp = new Map<number, AudienceHistoryPoint>();
  // The latest verified reading can be newer than the fixed 12-hour snapshot.
  // It is a real endpoint, not another scheduled sample or an interpolated value.
  for (const point of [...history.samples, ...(history.latest ? [history.latest] : [])]) {
    if (!validPoint(point)) continue;
    const timestamp = Date.parse(point.checkedAt);
    if (timestamp < cutoff || timestamp > now) continue;
    byTimestamp.set(timestamp, cleanPoint(point));
  }
  const sorted = [...byTimestamp.entries()].sort(([left], [right]) => left - right);
  const baseline = sorted[0]?.[1].total;
  if (baseline === undefined) return [];
  return sorted.map(([timestamp, point]) => ({
    ...point,
    timestamp,
    change: point.total - baseline,
    percentChange: baseline > 0 ? ((point.total - baseline) / baseline) * 100 : null,
  }));
}

export function splitAudienceChartGaps(points: AudienceChartPoint[]) {
  const segments: AudienceChartPoint[][] = [];
  for (const point of points) {
    const segment = segments.at(-1);
    const previous = segment?.at(-1);
    if (!segment || !previous || point.timestamp - previous.timestamp > AUDIENCE_CHART_MAX_GAP_MS) {
      segments.push([point]);
    } else {
      segment.push(point);
    }
  }
  return segments;
}

export function buildAudienceChartSeries(
  items: AudienceMetric[],
  history: AudienceHistorySeries[],
  days: AudienceChartRange,
  now: number,
): AudienceChartSeries[] {
  const byId = new Map(history.map((entry) => [entry.id, entry]));
  return items.map((item) => {
    const stored = byId.get(item.id);
    const compatible = stored?.platform === item.platform &&
      stored.primaryLabel === item.primaryLabel;
    const points = compatible ? audienceHistoryPoints(stored, days, now) : [];
    const segments = splitAudienceChartGaps(points);
    const first = points[0];
    const last = points.at(-1);
    const comparable = points.length >= 2 && first && last;
    return {
      id: item.id,
      label: item.label,
      platform: item.platform,
      primaryLabel: item.primaryLabel || "followers",
      points,
      segments,
      change: comparable ? last.change : null,
      percentChange: comparable ? last.percentChange : null,
      elapsedMs: comparable ? last.timestamp - first.timestamp : 0,
      hasGaps: segments.length > 1,
      lastKnown: Boolean(item.error || item.stale),
    };
  });
}

export function audienceChartValue(point: AudienceChartPoint, mode: AudienceChartMode) {
  return mode === "growth" ? point.percentChange : point.total;
}

export function audienceChartDomain(series: AudienceChartSeries[], mode: AudienceChartMode) {
  const values = series.flatMap((entry) => entry.points
    .map((point) => audienceChartValue(point, mode))
    .filter((value): value is number => value !== null && Number.isFinite(value)));
  if (!values.length) return mode === "growth" ? [-1, 1] as const : [0, 1] as const;
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const padding = Math.max((maximum - minimum) * 0.14, mode === "growth" ? 0.01 : 1);
  return [mode === "growth" ? minimum - padding : 0, maximum + padding] as const;
}

export function summarizeAudienceMetrics(items: AudienceMetric[]) {
  const known = items.filter((item) => item.total !== null && Number.isFinite(item.total) && item.total >= 0);
  const comparable = known.filter((item) => !item.error && !item.stale && item.change !== null && Number.isFinite(item.change));
  return {
    total: known.length ? known.reduce((sum, item) => sum + item.total!, 0) : null,
    knownCount: known.length,
    lastKnownCount: known.filter((item) => item.stale || item.error).length,
    change: comparable.length ? comparable.reduce((sum, item) => sum + item.change!, 0) : null,
    comparisonCount: comparable.length,
  };
}
