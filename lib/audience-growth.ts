import type { AudiencePrimaryMetric } from "./types";

export const AUDIENCE_SNAPSHOT_VERSION = 2 as const;
export const AUDIENCE_SAMPLE_BUCKET_MS = 12 * 60 * 60 * 1000;
export const AUDIENCE_COMPARISON_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const AUDIENCE_COMPARISON_MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const AUDIENCE_HISTORY_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
export const AUDIENCE_COMPARISON_WINDOW_LABEL = "24–36h change";
const AUDIENCE_HISTORY_MAX_SAMPLES =
  Math.ceil(AUDIENCE_HISTORY_RETENTION_MS / AUDIENCE_SAMPLE_BUCKET_MS) + 2;

export type AudienceSample = {
  total: number;
  checkedAt: string;
  handle?: string;
  secondaryLabel?: string;
  secondaryValue?: number;
  source?: string;
  primaryLabel?: AudiencePrimaryMetric;
};

export type AudienceAccountHistory = {
  fingerprint: string;
  latest: AudienceSample;
  samples: AudienceSample[];
};

export type AudienceSnapshotHistory = {
  version: typeof AUDIENCE_SNAPSHOT_VERSION;
  accounts: Record<string, AudienceAccountHistory>;
};

type LegacyAudienceSnapshot = AudienceSample & {
  fingerprint?: string;
  previousTotal?: number;
  previousCheckedAt?: string;
};

const primaryMetrics = new Set<AudiencePrimaryMetric>([
  "followers",
  "subscribers",
  "page likes",
]);

function sampleTime(sample: Pick<AudienceSample, "checkedAt">) {
  return Date.parse(sample.checkedAt);
}

function sampleBucket(sample: Pick<AudienceSample, "checkedAt">) {
  return Math.floor(sampleTime(sample) / AUDIENCE_SAMPLE_BUCKET_MS);
}

function parseSample(value: unknown): AudienceSample {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Audience snapshot entries are invalid.");
  const sample = value as Partial<AudienceSample>;
  if (
    typeof sample.total !== "number" ||
    !Number.isFinite(sample.total) ||
    sample.total < 0 ||
    typeof sample.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(sample.checkedAt)) ||
    (sample.primaryLabel !== undefined &&
      !primaryMetrics.has(sample.primaryLabel)) ||
    (sample.secondaryValue !== undefined &&
      (typeof sample.secondaryValue !== "number" ||
        !Number.isFinite(sample.secondaryValue) ||
        sample.secondaryValue < 0)) ||
    (sample.handle !== undefined && typeof sample.handle !== "string") ||
    (sample.secondaryLabel !== undefined &&
      typeof sample.secondaryLabel !== "string") ||
    (sample.source !== undefined && typeof sample.source !== "string")
  )
    throw new Error("Audience snapshot entries are invalid.");
  return {
    total: sample.total,
    checkedAt: sample.checkedAt,
    ...(sample.handle === undefined ? {} : { handle: sample.handle }),
    ...(sample.secondaryLabel === undefined
      ? {}
      : { secondaryLabel: sample.secondaryLabel }),
    ...(sample.secondaryValue === undefined
      ? {}
      : { secondaryValue: sample.secondaryValue }),
    ...(sample.source === undefined ? {} : { source: sample.source }),
    ...(sample.primaryLabel === undefined
      ? {}
      : { primaryLabel: sample.primaryLabel }),
  };
}

function uniqueBucketSamples(samples: AudienceSample[]) {
  const sorted = [...samples].sort(
    (left, right) => sampleTime(left) - sampleTime(right),
  );
  const buckets = new Set<number>();
  return sorted.filter((sample) => {
    const bucket = sampleBucket(sample);
    if (buckets.has(bucket)) return false;
    buckets.add(bucket);
    return true;
  });
}

function parseV2History(value: Record<string, unknown>) {
  if (
    value.version !== AUDIENCE_SNAPSHOT_VERSION ||
    !value.accounts ||
    typeof value.accounts !== "object" ||
    Array.isArray(value.accounts)
  )
    throw new Error("Audience snapshot history is invalid.");
  const accounts: Record<string, AudienceAccountHistory> = {};
  for (const [accountId, rawHistory] of Object.entries(value.accounts)) {
    if (
      !rawHistory ||
      typeof rawHistory !== "object" ||
      Array.isArray(rawHistory)
    )
      throw new Error("Audience snapshot history contains an invalid account.");
    const history = rawHistory as Partial<AudienceAccountHistory>;
    if (
      typeof history.fingerprint !== "string" ||
      !Array.isArray(history.samples) ||
      history.samples.length === 0
    )
      throw new Error("Audience snapshot history contains an invalid account.");
    accounts[accountId] = {
      fingerprint: history.fingerprint,
      latest: parseSample(history.latest),
      samples: uniqueBucketSamples(history.samples.map(parseSample)),
    };
  }
  return {
    version: AUDIENCE_SNAPSHOT_VERSION,
    accounts,
  } satisfies AudienceSnapshotHistory;
}

function migrateLegacyHistory(value: Record<string, unknown>) {
  const accounts: Record<string, AudienceAccountHistory> = {};
  for (const [accountId, rawSnapshot] of Object.entries(value)) {
    const latest = parseSample(rawSnapshot);
    const legacy = rawSnapshot as LegacyAudienceSnapshot;
    const hasPreviousTotal = legacy.previousTotal !== undefined;
    const hasPreviousDate = legacy.previousCheckedAt !== undefined;
    if (
      hasPreviousTotal !== hasPreviousDate ||
      (hasPreviousTotal &&
        (typeof legacy.previousTotal !== "number" ||
          !Number.isFinite(legacy.previousTotal) ||
          legacy.previousTotal < 0 ||
          typeof legacy.previousCheckedAt !== "string" ||
          !Number.isFinite(Date.parse(legacy.previousCheckedAt))))
    )
      throw new Error("Audience snapshot entries are invalid.");
    const samples: AudienceSample[] = [];
    if (hasPreviousTotal && hasPreviousDate) {
      samples.push({
        total: legacy.previousTotal!,
        checkedAt: legacy.previousCheckedAt!,
        ...(latest.primaryLabel
          ? { primaryLabel: latest.primaryLabel }
          : {}),
      });
    }
    samples.push(latest);
    accounts[accountId] = {
      fingerprint:
        typeof legacy.fingerprint === "string" ? legacy.fingerprint : "",
      latest,
      samples: uniqueBucketSamples(samples),
    };
  }
  return {
    version: AUDIENCE_SNAPSHOT_VERSION,
    accounts,
  } satisfies AudienceSnapshotHistory;
}

export function parseAudienceSnapshots(value: unknown): AudienceSnapshotHistory {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Audience snapshots must be an object.");
  const record = value as Record<string, unknown>;
  return "version" in record ? parseV2History(record) : migrateLegacyHistory(record);
}

export function audienceGrowthFromHistory(history: AudienceAccountHistory) {
  const latestTime = sampleTime(history.latest);
  const latestMetric = history.latest.primaryLabel;
  if (!Number.isFinite(latestTime) || !latestMetric)
    return { change: null, changeComparedAt: undefined };
  const minimumTime = latestTime - AUDIENCE_COMPARISON_MAX_AGE_MS;
  const maximumTime = latestTime - AUDIENCE_COMPARISON_MIN_AGE_MS;
  const baseline = history.samples
    .filter((sample) => {
      const checkedAt = sampleTime(sample);
      return (
        sample.primaryLabel === latestMetric &&
        checkedAt >= minimumTime &&
        checkedAt <= maximumTime
      );
    })
    .sort((left, right) => sampleTime(right) - sampleTime(left))[0];
  return {
    change: baseline ? history.latest.total - baseline.total : null,
    changeComparedAt: baseline?.checkedAt,
  };
}

export function audienceComparisonLabel(
  checkedAt: string,
  changeComparedAt?: string,
) {
  if (!changeComparedAt) return "Waiting for 24–36h baseline";
  const elapsedMs = Date.parse(checkedAt) - Date.parse(changeComparedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
    return "vs 24–36h baseline";
  const elapsedHours = Math.round((elapsedMs / (60 * 60 * 1000)) * 10) / 10;
  return `vs ${elapsedHours}h baseline`;
}

export function nextAudienceHistory(
  current: AudienceSample,
  fingerprint: string,
  prior?: AudienceAccountHistory,
): AudienceAccountHistory {
  const currentTime = sampleTime(current);
  if (!Number.isFinite(currentTime))
    throw new Error("Audience snapshot entries are invalid.");
  const comparable =
    prior?.fingerprint === fingerprint &&
    Boolean(current.primaryLabel) &&
    prior.latest.primaryLabel === current.primaryLabel;
  const cutoff = currentTime - AUDIENCE_HISTORY_RETENTION_MS;
  const samples = comparable
    ? prior.samples.filter((sample) => {
        const checkedAt = sampleTime(sample);
        return (
          sample.primaryLabel === current.primaryLabel &&
          checkedAt >= cutoff &&
          checkedAt <= currentTime
        );
      })
    : [];
  if (!samples.some((sample) => sampleBucket(sample) === sampleBucket(current)))
    samples.push(current);
  return {
    fingerprint,
    latest: current,
    samples: uniqueBucketSamples(samples).slice(-AUDIENCE_HISTORY_MAX_SAMPLES),
  };
}

export function combineAudienceChanges(
  metrics: Array<{ change: number | null }>,
) {
  const comparable = metrics.filter(
    (metric): metric is { change: number } => metric.change !== null,
  );
  return {
    change: comparable.reduce((sum, metric) => sum + metric.change, 0),
    comparisonCount: comparable.length,
  };
}
