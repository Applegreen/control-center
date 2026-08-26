import { localMentionPriority, sortFeedStories } from "./feed-priority";
import {
  canonicalizeMentionUrl,
  evaluateMention,
  isFreshMentionEvidence,
  isMentionProviderWrapper,
} from "./mention-filter";
import type { AiKeyProvider, LiveStory } from "./types";

export type MentionBackfillOptions = {
  scope: string;
  provider: AiKeyProvider;
  now: string;
  windowDays: number;
  limit?: number;
};

export function selectMentionSummaryBackfill(
  saved: readonly LiveStory[],
  discovered: readonly LiveStory[],
  options: MentionBackfillOptions,
) {
  const currentIds = new Set(discovered.map((story) => story.id));
  const currentUrls = new Set(discovered.map((story) => canonicalizeMentionUrl(story.url)));
  const limit = Math.max(0, Math.min(24, Math.round(options.limit ?? 24)));
  return sortFeedStories(saved.filter((story) => {
    const url = canonicalizeMentionUrl(story.url);
    return story.kind === "mention" && story.collectionScope === options.scope &&
      !story.workflow?.archiveReason && Boolean(url) && !isMentionProviderWrapper(url) &&
      !currentIds.has(story.id) && !currentUrls.has(url) &&
      (!story.aiSummary?.trim() || story.curationMode !== options.provider) &&
      isFreshMentionEvidence({
        publishedAt: story.publishedAt,
        firstDiscoveredAt: story.discoveredAt,
        canonicalPageVerified: true,
      }, { now: options.now, windowDays: options.windowDays, futureToleranceHours: 1 / 6 });
  }).map(localMentionPriority)).slice(0, limit);
}

export function preserveSavedMentionCuration(
  discovered: readonly LiveStory[],
  saved: readonly LiveStory[],
  scope: string,
) {
  const eligible = saved.filter((story) => story.collectionScope === scope && !story.workflow?.archiveReason);
  const byId = new Map(eligible.map((story) => [story.id, story]));
  const byUrl = new Map(eligible.map((story) => [canonicalizeMentionUrl(story.url), story]));
  return discovered.map((story): LiveStory => {
    if (story.collectionScope !== scope) return story;
    const prior = byId.get(story.id) || byUrl.get(canonicalizeMentionUrl(story.url));
    if (!prior) return story;
    return {
      ...story,
      ...(prior.discoveredAt ? { discoveredAt: prior.discoveredAt } : {}),
      ...(prior.aiSummary?.trim() && !story.aiSummary?.trim() ? {
        aiSummary: prior.aiSummary,
        importanceScore: prior.importanceScore,
        importanceReason: prior.importanceReason,
        curationMode: prior.curationMode,
      } : {}),
    };
  });
}

export type MentionBackfillPage = {
  url: string;
  title: string;
  summary: string;
  pageText: string;
  source: string;
  publishedAt: string;
};

export function revalidateMentionSummaryBackfill(
  story: LiveStory,
  page: MentionBackfillPage | null | undefined,
  options: MentionBackfillOptions & {
    identities: string[];
    identityAnchors: string[];
    nicheContexts: string[];
    negativeTerms: string[];
    strictMode: boolean;
    excludeOwnedSites: boolean;
    websites: string[];
  },
) {
  if (!page?.pageText.trim() || story.collectionScope !== options.scope || story.workflow?.archiveReason)
    return null;
  const url = canonicalizeMentionUrl(page.url);
  if (!url || isMentionProviderWrapper(url)) return null;
  if (options.excludeOwnedSites) {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const owned = options.websites.some((website) => {
      try {
        const official = new URL(website.includes("://") ? website : `https://${website}`)
          .hostname.toLowerCase().replace(/^www\./, "");
        return hostname === official || hostname.endsWith(`.${official}`);
      } catch { return false; }
    });
    if (owned) return null;
  }
  if (!isFreshMentionEvidence({
    publishedAt: story.publishedAt,
    firstDiscoveredAt: story.discoveredAt,
    canonicalPageVerified: true,
  }, { now: options.now, windowDays: options.windowDays, futureToleranceHours: 1 / 6 })) return null;
  if (!isFreshMentionEvidence({
    publishedAt: page.publishedAt || story.publishedAt,
    firstDiscoveredAt: story.discoveredAt,
    canonicalPageVerified: true,
  }, { now: options.now, windowDays: options.windowDays, futureToleranceHours: 1 / 6 })) return null;
  // Previously stored titles and summaries cannot prove today's page identity.
  // Evaluate only freshly fetched text, using exactly the collector's identity rules.
  const fresh: LiveStory = {
    ...story,
    title: page.title,
    summary: page.summary,
    url,
    source: page.source,
    publishedAt: story.publishedAt || page.publishedAt,
  };
  for (const primary of options.identities) {
    const evaluation = evaluateMention(
      fresh, primary, options.identities, options.identityAnchors, options.strictMode,
      {
        canonicalUrl: url,
        publisher: page.source,
        pageText: page.pageText,
        nicheContexts: options.nicheContexts,
        negativeTerms: options.negativeTerms,
      },
    );
    if (!evaluation.accepted) continue;
    return {
      story: {
        ...fresh,
        id: story.id,
        discoveredAt: story.discoveredAt,
        matchedTerm: primary,
        confidence: evaluation.confidence,
        matchReasons: evaluation.reasons,
      },
      pageText: page.pageText,
    };
  }
  return null;
}
