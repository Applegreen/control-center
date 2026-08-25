import type { DailyBriefItem } from "./types";

const dayMilliseconds = 86_400_000;

export function isDailyBriefItemInWindow(
  item: Pick<DailyBriefItem, "occurredAt" | "dueAt">,
  window: "today" | "week",
  now: number,
) {
  const due = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
  const occurred = Date.parse(item.occurredAt);
  const dayBoundary = now + dayMilliseconds;
  if (window === "week") {
    const weekStart = now - 7 * dayMilliseconds;
    const weekEnd = now + 7 * dayMilliseconds;
    return (
      (Number.isFinite(due) && due >= weekStart && due <= weekEnd) ||
      (Number.isFinite(occurred) &&
        occurred >= weekStart &&
        occurred <= dayBoundary)
    );
  }
  return (
    (Number.isFinite(due) && due <= dayBoundary) ||
    (Number.isFinite(occurred) && occurred >= now - dayMilliseconds)
  );
}
