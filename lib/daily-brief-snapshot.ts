import type { BriefCategory, DailyBriefSnapshotSection, LiveFeedResponse, LiveStory, NewsletterFeedResponse, NewsletterTopic, PublicSettings } from "./types";
import { localMentionPriority, newsletterPriority, sortFeedStories } from "./feed-priority";

export const briefCategories = ["industry", "mentions", "newsletters"] as const;
export const defaultBriefSections = { industry: 5, mentions: 5, newsletters: 5 };

export function normalizeBriefSections(value: unknown): PublicSettings["dailyBrief"]["sections"] {
  const incoming = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(briefCategories.map((category) => {
    const number = incoming[category];
    return [category, typeof number === "number" && Number.isFinite(number)
      ? Math.max(0, Math.min(10, Math.round(number))) : defaultBriefSections[category]];
  })) as PublicSettings["dailyBrief"]["sections"];
}

export function buildDailyBriefSnapshot(
  counts: PublicSettings["dailyBrief"]["sections"],
  feeds: Partial<Record<BriefCategory, LiveFeedResponse | NewsletterFeedResponse>>,
  now = Date.now(),
): DailyBriefSnapshotSection[] {
  return briefCategories.filter((category) => counts[category] > 0).map((category) => {
    const feed = feeds[category];
    const hours = category === "industry" ? (feed?.freshnessHours || 24)
      : category === "mentions" ? ("windowDays" in (feed || {}) ? (feed as LiveFeedResponse).windowDays || 7 : 7) * 24
        : feed?.freshnessHours || 36;
    const normalized = (feed?.items || []).map((item) => category === "newsletters"
      ? newsletterPriority(item as NewsletterTopic)
      : category === "mentions" ? localMentionPriority(item as LiveStory) : item);
    const candidates = sortFeedStories(normalized.filter((item) => {
      if (item.workflow?.archiveReason === "user") return false;
      const occurredAt = "receivedAt" in item ? item.receivedAt : item.publishedAt || item.discoveredAt || "";
      const time = Date.parse(occurredAt);
      return Number.isFinite(time) && time >= now - hours * 3_600_000 && time <= now + 10 * 60_000;
    }));
    return {
      category, requestedCount: counts[category], availableCount: candidates.length,
      configured: feed?.configured || false,
      checkedAt: feed?.checkedAt || "",
      stale: !feed?.checkedAt || now - Date.parse(feed.checkedAt) > 60 * 60_000,
      items: candidates.slice(0, counts[category]).map((item) => ({
        id: item.id, title: item.title,
        summary: "aiSummary" in item && item.aiSummary ? item.aiSummary : item.summary,
        url: item.url, importanceScore: item.importanceScore,
        source: "newsletterSources" in item ? item.newsletterSources.join(", ") : item.source,
      })),
    };
  });
}
