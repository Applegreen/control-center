import type { AudiencePrimaryMetric } from "./types";

export type AudienceSnapshot = {
  total: number;
  checkedAt: string;
  fingerprint?: string;
  handle?: string;
  secondaryLabel?: string;
  secondaryValue?: number;
  source?: string;
  primaryLabel?: AudiencePrimaryMetric;
  previousTotal?: number;
  previousCheckedAt?: string;
};

export function parseAudienceSnapshots(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Audience snapshots must be an object.");
  for (const snapshot of Object.values(value)) {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      typeof (snapshot as AudienceSnapshot).total !== "number" ||
      !Number.isFinite((snapshot as AudienceSnapshot).total) ||
      typeof (snapshot as AudienceSnapshot).checkedAt !== "string"
    ) throw new Error("Audience snapshot entries are invalid.");
  }
  return value as Record<string, AudienceSnapshot>;
}

export function audienceGrowthFromSnapshot(snapshot: AudienceSnapshot) {
  const hasComparison =
    typeof snapshot.previousTotal === "number" &&
    Number.isFinite(snapshot.previousTotal);
  return {
    change: hasComparison ? snapshot.total - snapshot.previousTotal! : null,
    changeComparedAt: hasComparison ? snapshot.previousCheckedAt : undefined,
  };
}

export function nextAudienceSnapshot(
  current: Omit<AudienceSnapshot, "previousTotal" | "previousCheckedAt">,
  prior?: AudienceSnapshot,
): AudienceSnapshot {
  const comparablePrior =
    prior?.primaryLabel && prior.primaryLabel === current.primaryLabel
      ? prior
      : undefined;
  return {
    ...current,
    previousTotal: comparablePrior?.total,
    previousCheckedAt: comparablePrior?.checkedAt,
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
