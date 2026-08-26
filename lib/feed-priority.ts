import type { LiveStory, NewsletterTopic } from "./types";

export type FeedSortOrder = "priority" | "newest" | "oldest";

type PrioritizedItem = {
  id: string;
  importanceScore?: number;
  publishedAt?: string;
  discoveredAt?: string;
  receivedAt?: string;
};

function timestamp(item: PrioritizedItem) {
  const value = item.receivedAt || item.publishedAt || item.discoveredAt || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareDates(left: PrioritizedItem, right: PrioritizedItem, oldest = false) {
  const a = timestamp(left);
  const b = timestamp(right);
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return oldest ? a - b : b - a;
}

export function boundedPriority(value: unknown, fallback = 50) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

export function sortFeedStories<T extends PrioritizedItem>(
  items: readonly T[],
  order: FeedSortOrder = "priority",
): T[] {
  return [...items].sort((left, right) =>
    (order === "priority"
      ? boundedPriority(right.importanceScore, 0) - boundedPriority(left.importanceScore, 0)
      : 0) ||
    compareDates(left, right, order === "oldest") ||
    left.id.localeCompare(right.id));
}

export function newsletterSourceOptions(items: readonly NewsletterTopic[]) {
  const sources = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const rawName of item.newsletterSources) {
      const name = rawName.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const existing = sources.get(key);
      sources.set(key, { name: existing?.name || name, count: (existing?.count || 0) + 1 });
    }
  }
  return [...sources.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function selectNewsletterTopics(
  items: readonly NewsletterTopic[],
  options: {
    sortOrder?: FeedSortOrder;
    sources?: readonly string[];
    query?: string;
  } = {},
) {
  const sources = new Set((options.sources || []).map((source) => source.trim().toLowerCase()).filter(Boolean));
  const query = (options.query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = items.filter((topic) => {
    if (sources.size && !topic.newsletterSources.some((name) => sources.has(name.trim().toLowerCase())))
      return false;
    if (!query.length) return true;
    const text = [topic.title, topic.summary, ...topic.newsletterSources,
      ...topic.sourceLinks.map((source) => source.publisher)].join(" ").toLowerCase();
    return query.every((term) => text.includes(term));
  });
  // The caller limits the rendered list after filtering, so counts and options
  // always describe the entire saved collection, not just the first screen.
  return sortFeedStories(filtered, options.sortOrder || "priority");
}

export function localMentionPriority(story: LiveStory): LiveStory {
  if (typeof story.importanceScore === "number" && Number.isFinite(story.importanceScore))
    return { ...story, importanceScore: boundedPriority(story.importanceScore) };
  const exactInHeadline = Boolean(story.matchedTerm &&
    story.title.toLowerCase().includes(story.matchedTerm.toLowerCase()));
  const score = (story.confidence === "high" ? 65 : 48) +
    (exactInHeadline ? 15 : 0) + Math.min(8, (story.matchReasons?.length || 0) * 2);
  return {
    ...story,
    importanceScore: score,
    importanceReason: exactInHeadline
      ? "The tracked identity appears in the headline, with independently checked page evidence."
      : "Ranked by verified identity evidence; newer mentions break ties.",
    curationMode: "local",
  };
}

export function newsletterPriority(topic: NewsletterTopic): NewsletterTopic {
  const newsletters = new Set(topic.newsletterSources.map((name) => name.trim().toLowerCase()).filter(Boolean)).size;
  if (typeof topic.importanceBaseScore === "number" && Number.isFinite(topic.importanceBaseScore)) {
    const coverageBoost = Math.min(18, Math.max(0, newsletters - 1) * 6);
    return {
      ...topic,
      importanceScore: boundedPriority(topic.importanceBaseScore + coverageBoost),
    };
  }
  if (typeof topic.importanceScore === "number" && Number.isFinite(topic.importanceScore))
    return { ...topic, importanceScore: boundedPriority(topic.importanceScore) };
  const score = Math.min(84, 50 + Math.min(24, Math.max(0, newsletters - 1) * 6) +
    Math.min(10, Math.max(0, topic.sourceLinks.length - 1) * 2));
  return {
    ...topic,
    importanceScore: score,
    importanceReason: newsletters > 1
      ? `Independently reported by ${newsletters} newsletters; broader coverage raises its priority.`
      : "Ranked by supporting coverage; newer stories break ties.",
    curationMode: "local",
  };
}
