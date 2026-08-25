export type AudienceSnapshot = {
  total: number;
  checkedAt: string;
  fingerprint?: string;
  handle?: string;
  secondaryLabel?: string;
  secondaryValue?: number;
  source?: string;
  previousTotal?: number;
  previousCheckedAt?: string;
};

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
  return {
    ...current,
    previousTotal: prior?.total,
    previousCheckedAt: prior?.checkedAt,
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
