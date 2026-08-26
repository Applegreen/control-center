import type { LiveFeedResponse, LiveStory } from "@/lib/types";
import { readSettings } from "@/lib/server/settings";
import { parseFeed } from "@/lib/server/rss";
import { isFeedDocument } from "@/lib/feed-discovery";
import { safeFetchText } from "@/lib/server/safe-fetch";
import {
  buildMentionQueryPlans,
  canonicalizeMentionUrl,
  evaluateMention,
  isFreshMentionEvidence,
  MENTION_COLLECTION_VERSION,
  mentionIdentity,
} from "@/lib/mention-filter";
import { getDatabase, syncContentItems } from "@/lib/server/database";
import { googleNewsArticleId, resolveGoogleNewsUrl } from "@/lib/server/google-news";
import { collectionScope } from "@/lib/collection-scope";
import {
  configuredMentionIdentities,
  MENTION_SEARCH_CONCURRENCY,
  settleMentionWork,
} from "@/lib/mention-work";
import {
  isOwnedMentionUrl,
  readVerifiedMentionPage,
  type VerifiedMentionPage,
} from "@/lib/server/mention-page";
import { researchMentionsWithAi } from "@/lib/server/mention-research";
import {
  readCollectorSnapshot,
  writeCollectorSnapshot,
} from "@/lib/collector-cache";

export const runtime = "nodejs";

const MENTION_WINDOW_DAYS = 7;
const searchProviders = ["Google News", "Bing News"] as const;
type SearchProvider = typeof searchProviders[number];

type SearchTask = {
  provider: SearchProvider;
  primary: string;
  query: string;
  queryContexts: string[];
};

function providerUrl(provider: SearchProvider, query: string) {
  if (provider === "Google News") {
    return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  }
  const bingQuery = query.replace(/\s+when:\d+d\s*$/i, "");
  return `https://www.bing.com/news/search?q=${encodeURIComponent(bingQuery)}&format=rss`;
}

function isSearchWrapper(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "news.google.com" || hostname === "bing.com" || hostname.endsWith(".bing.com");
  } catch {
    return true;
  }
}

function mergeMention(existing: LiveStory | undefined, incoming: LiveStory) {
  if (!existing) return incoming;
  const preferred = existing.confidence === "high" || incoming.confidence !== "high" ? existing : incoming;
  const alternate = preferred === existing ? incoming : existing;
  return {
    ...alternate,
    ...preferred,
    url: !isSearchWrapper(incoming.url) ? incoming.url : existing.url,
    matchReasons: [...new Set([...(existing.matchReasons || []), ...(incoming.matchReasons || [])])],
  };
}

async function readVerifiedPages(urls: string[]) {
  const pages = new Map<string, VerifiedMentionPage | null>();
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(8, urls.length) }, async () => {
    while (nextIndex < urls.length) {
      const url = urls[nextIndex++];
      pages.set(url, await readVerifiedMentionPage(url));
    }
  });
  await Promise.all(workers);
  return pages;
}

async function collectMentions(
  settings: Awaited<ReturnType<typeof readSettings>>,
) {
  const checkedAt = new Date().toISOString();
  const freshSince = new Date(Date.parse(checkedAt) - MENTION_WINDOW_DAYS * 86_400_000).toISOString();
  const freshUntil = new Date(Date.parse(checkedAt) + 10 * 60 * 1000).toISOString();
  const terms = configuredMentionIdentities(
    settings.mentions.terms,
    settings.mentions.websites,
  );
  const mentionScope = terms.length ? collectionScope(MENTION_COLLECTION_VERSION, [
    `strict:${settings.mentions.strictMode}`,
    ...settings.mentions.terms.map((term) => `term:${term}`),
    ...settings.mentions.websites.map((website) => `website:${website}`),
    ...settings.mentions.identityAnchors.map((anchor) => `anchor:${anchor}`),
    ...settings.mentions.negativeTerms.map((term) => `exclude:${term}`),
    `exclude-owned:${settings.mentions.excludeOwnedSites}`,
    ...settings.industry.keywords.map((keyword) => `niche:${keyword}`),
  ]) : "";
  if (!terms.length) {
    const saved = syncContentItems<LiveStory>("mentions", [], { freshSince, freshUntil, activeScopes: [] });
    const hasSavedLibrary = saved.archived.length > 0;
    return Response.json({
      configured: hasSavedLibrary,
      checkedAt,
      items: [],
      archivedItems: saved.archived,
      archiveCount: saved.archived.length,
      errors: hasSavedLibrary ? ["Tracking is paused because no Mention identities are configured. Saved history remains available."] : [],
      filteredOut: 0,
      reviewCount: 0,
      windowDays: MENTION_WINDOW_DAYS,
      providerStatuses: [],
    } satisfies LiveFeedResponse);
  }

  const identitySignals = terms;
  const nicheContexts = [...new Set([...settings.mentions.identityAnchors, ...settings.industry.keywords])];
  const tasks: SearchTask[] = terms.flatMap((primary) => {
    const queryPlans = buildMentionQueryPlans(primary, {
      identitySignals,
      identityAnchors: settings.mentions.identityAnchors,
      nicheContexts: settings.industry.keywords,
      strictMode: settings.mentions.strictMode,
      windowDays: MENTION_WINDOW_DAYS,
    });
    return searchProviders.flatMap((provider) => queryPlans.map(({ query, queryContexts }) => ({
      provider,
      primary,
      query,
      queryContexts,
    })));
  });

  const results = await settleMentionWork(tasks, MENTION_SEARCH_CONCURRENCY, async (task) => {
    const endpoint = providerUrl(task.provider, task.query);
    const response = await safeFetchText(endpoint);
    if (!isFeedDocument(response.text)) throw new Error("Search provider returned a non-feed response.");
    return { ...task, endpoint, items: parseFeed(response.text, task.provider) };
  });

  const errors: string[] = [];
  const filteredCounts = { rejected: 0, outsideWindow: 0 };
  const providerSummary = new Map<SearchProvider, { requests: number; successes: number; candidates: number }>(
    searchProviders.map((provider) => [provider, { requests: 0, successes: 0, candidates: 0 }]),
  );
  const candidates: Array<{ task: SearchTask; item: LiveStory }> = [];

  results.forEach((result, index) => {
    const task = tasks[index];
    const summary = providerSummary.get(task.provider)!;
    summary.requests += 1;
    if (result.status === "rejected") {
      errors.push(`${task.provider}: ${result.reason instanceof Error ? result.reason.message : "mention search failed"}`);
      return;
    }
    summary.successes += 1;
    summary.candidates += result.value.items.length;
    for (const item of result.value.items) {
      candidates.push({ task, item });
    }
  });

  const googleUrls = [...new Set(candidates.map(({ item }) => item.url).filter((url) => googleNewsArticleId(url)))].slice(0, 40);
  const googleResolutionResults = await Promise.allSettled(googleUrls.map((url) => resolveGoogleNewsUrl(url)));
  const resolvedUrls = new Map<string, string>();
  googleResolutionResults.forEach((result, index) => {
    if (result.status === "fulfilled") resolvedUrls.set(googleUrls[index], result.value);
  });
  const resolvedCandidates = candidates.map(({ task, item }) => ({
    task,
    item,
    canonicalUrl: canonicalizeMentionUrl(resolvedUrls.get(item.url) || item.url),
  }));
  let aiResearch: Awaited<ReturnType<typeof researchMentionsWithAi>> | null = null;
  let aiProviderStatus: NonNullable<LiveFeedResponse["providerStatuses"]>[number];
  if (settings.ai.provider === "none") {
    aiProviderStatus = {
      provider: "Broad web research",
      state: "disabled",
      message: "AI web research is off; Google News and Bing News remain active.",
    };
  } else {
    try {
      aiResearch = await researchMentionsWithAi(settings, {
        now: Date.parse(checkedAt),
        windowDays: MENTION_WINDOW_DAYS,
      });
      aiProviderStatus = {
        provider: `${aiResearch.provider} web research`,
        state: aiResearch.failedIdentityCount ? "degraded" : "live",
        message: `${aiResearch.urls.length} candidate URLs found across ${aiResearch.completedIdentityCount}/${aiResearch.totalIdentityCount} configured identities; each is independently checked for direct-page evidence.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI web research failed";
      errors.push(`Broad web research: ${message}`);
      aiProviderStatus = {
        provider: `${settings.ai.provider} web research`,
        state: "degraded",
        message,
      };
    }
  }
  const readableUrls = [...new Set([
    ...resolvedCandidates.map(({ canonicalUrl }) => canonicalUrl),
    ...(aiResearch?.urls || []),
  ].filter((url) => url && !isSearchWrapper(url)))].slice(0, 60);
  const pages = await readVerifiedPages(readableUrls);

  const byId = new Map<string, LiveStory>();
  for (const { task, item, canonicalUrl } of resolvedCandidates) {
    const page = canonicalUrl ? pages.get(canonicalUrl) : null;
    if (
      !canonicalUrl ||
      !page ||
      (settings.mentions.excludeOwnedSites &&
        isOwnedMentionUrl(page.url, settings.mentions.websites))
    ) {
      filteredCounts.rejected += 1;
      continue;
    }
    const verifiedUrl = page.url;
    const publishedAt = page?.publishedAt || item.publishedAt;
    if (!isFreshMentionEvidence({
      publishedAt,
      firstDiscoveredAt: checkedAt,
      canonicalPageVerified: Boolean(page?.pageText),
    }, { now: checkedAt, windowDays: MENTION_WINDOW_DAYS })) {
      filteredCounts.outsideWindow += 1;
      continue;
    }
    const evaluation = evaluateMention(
      { ...item, publishedAt },
      task.primary,
      identitySignals,
      settings.mentions.identityAnchors,
      settings.mentions.strictMode,
      {
        canonicalUrl: verifiedUrl,
        publisher: page?.source || item.source,
        pageText: page?.pageText || "",
        nicheContexts,
        negativeTerms: settings.mentions.negativeTerms,
      },
    );
    if (!evaluation.accepted) {
      filteredCounts.rejected += 1;
      continue;
    }
    const id = mentionIdentity({ ...item, publishedAt, canonicalUrl: verifiedUrl, publisher: page.source || item.source });
    const normalized: LiveStory = {
      ...item,
      id,
      url: verifiedUrl,
      publishedAt,
      discoveredAt: checkedAt,
      kind: "mention",
      matchedTerm: task.primary,
      confidence: evaluation.confidence,
      matchReasons: evaluation.reasons,
      collectionScope: mentionScope,
    };
    byId.set(id, mergeMention(byId.get(id), normalized));
  }

  let aiVerified = 0;
  for (const researchUrl of aiResearch?.urls || []) {
    const page = pages.get(researchUrl);
    if (
      !page ||
      (settings.mentions.excludeOwnedSites &&
        isOwnedMentionUrl(page.url, settings.mentions.websites))
    ) {
      filteredCounts.rejected += 1;
      continue;
    }
    if (!isFreshMentionEvidence({
      publishedAt: page.publishedAt,
      firstDiscoveredAt: checkedAt,
      canonicalPageVerified: true,
    }, { now: checkedAt, windowDays: MENTION_WINDOW_DAYS })) {
      filteredCounts.outsideWindow += 1;
      continue;
    }
    const item: LiveStory = {
      id: page.url,
      title: page.title,
      summary: page.summary || `Direct-page mention verified on ${page.source}.`,
      url: page.url,
      source: page.source,
      publishedAt: page.publishedAt,
      discoveredAt: checkedAt,
      kind: "mention",
    };
    let accepted: { primary: string; evaluation: ReturnType<typeof evaluateMention> } | null = null;
    for (const primary of terms) {
      const evaluation = evaluateMention(
        item,
        primary,
        identitySignals,
        settings.mentions.identityAnchors,
        settings.mentions.strictMode,
        {
          canonicalUrl: page.url,
          publisher: page.source,
          pageText: page.pageText,
          nicheContexts,
          negativeTerms: settings.mentions.negativeTerms,
        },
      );
      if (evaluation.accepted) {
        accepted = { primary, evaluation };
        break;
      }
    }
    if (!accepted) {
      filteredCounts.rejected += 1;
      continue;
    }
    const id = mentionIdentity({ ...item, canonicalUrl: page.url, publisher: page.source });
    const normalized: LiveStory = {
      ...item,
      id,
      matchedTerm: accepted.primary,
      confidence: accepted.evaluation.confidence,
      matchReasons: ["Found by broad web research", ...accepted.evaluation.reasons],
      collectionScope: mentionScope,
    };
    byId.set(id, mergeMention(byId.get(id), normalized));
    aiVerified += 1;
  }
  if (aiResearch) {
    const incomplete = aiResearch.failedIdentityCount
      ? ` ${aiResearch.failedIdentityCount} identities could not be searched in this pass.`
      : "";
    aiProviderStatus.message = `${aiResearch.urls.length} candidate URLs found across ${aiResearch.completedIdentityCount}/${aiResearch.totalIdentityCount} configured identities; ${aiVerified} passed direct-page identity and freshness checks.${incomplete}`;
  }

  const discovered = [...byId.values()].sort((left, right) =>
    Date.parse(right.publishedAt || right.discoveredAt || "") -
    Date.parse(left.publishedAt || left.discoveredAt || ""));
  const saved = syncContentItems<LiveStory>("mentions", discovered, { freshSince, freshUntil, activeScopes: [mentionScope] });
  const providerStatuses: NonNullable<LiveFeedResponse["providerStatuses"]> = searchProviders.map((provider) => {
    const summary = providerSummary.get(provider)!;
    const complete = summary.requests > 0 && summary.successes === summary.requests;
    return {
      provider,
      state: complete ? "live" as const : "degraded" as const,
      message: summary.successes > 0
        ? `${summary.candidates} candidates across ${summary.successes}/${summary.requests} successful searches`
        : `All ${summary.requests} searches failed`,
    };
  });
  providerStatuses.push(aiProviderStatus);
  const items = saved.active;
  const uniqueErrors = [...new Set(errors)].slice(0, 10);
  return Response.json({
    configured: true,
    checkedAt,
    items,
    archivedItems: saved.archived,
    archiveCount: saved.archived.length,
    errors: uniqueErrors,
    filteredOut: filteredCounts.rejected + filteredCounts.outsideWindow,
    reviewCount: items.filter((item) => item.confidence === "medium").length,
    windowDays: MENTION_WINDOW_DAYS,
    providerStatuses,
  } satisfies LiveFeedResponse);
}

function mentionsCacheScope(
  settings: Awaited<ReturnType<typeof readSettings>>,
) {
  return collectionScope("mentions-response-v1", [
    `strict:${settings.mentions.strictMode}`,
    ...settings.mentions.terms.map((term) => `term:${term}`),
    ...settings.mentions.websites.map((website) => `website:${website}`),
    ...settings.mentions.identityAnchors.map((anchor) => `anchor:${anchor}`),
    ...settings.mentions.negativeTerms.map((term) => `exclude:${term}`),
    `exclude-owned:${settings.mentions.excludeOwnedSites}`,
    ...settings.industry.keywords.map((keyword) => `niche:${keyword}`),
    `ai:${settings.ai.provider}:${settings.ai.model}`,
  ]);
}

export async function GET(request: Request) {
  const settings = await readSettings();
  const scope = mentionsCacheScope(settings);
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (!forceRefresh) {
    const cached = readCollectorSnapshot<LiveFeedResponse>(
      getDatabase(),
      "mentions",
      scope,
    );
    if (cached) {
      return Response.json(cached.payload, {
        headers: { "X-Control-Center-Cache": "hit" },
      });
    }
  }
  const response = await collectMentions(settings);
  if (response.ok) {
    const payload = await response.clone().json() as LiveFeedResponse;
    const saved = writeCollectorSnapshot(
      getDatabase(),
      "mentions",
      scope,
      payload,
      payload.checkedAt,
    );
    return Response.json(saved, {
      headers: { "X-Control-Center-Cache": "refresh" },
    });
  }
  response.headers.set("X-Control-Center-Cache", "refresh");
  return response;
}
