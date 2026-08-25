import type { LiveStory } from "@/lib/types";

export function combineIndustryDiscoveries(siteItems: LiveStory[], topicItems: LiveStory[]) {
  const combined = [...new Map(
    [...siteItems, ...topicItems].map((item) => [item.url || item.id, item]),
  ).values()];
  combined.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  return combined;
}

export function prioritizeIndustryItems(items: LiveStory[], limit = 100) {
  if (limit <= 0) return [];
  const watched = items.filter((item) => item.kind !== "topic");
  const topics = items.filter((item) => item.kind === "topic");
  return [...watched, ...topics].slice(0, limit);
}
