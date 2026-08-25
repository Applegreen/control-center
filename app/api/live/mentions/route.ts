import type { LiveFeedResponse, LiveStory } from "@/lib/types";
import { readSettings } from "@/lib/server/settings";
import { parseFeed } from "@/lib/server/rss";
import { safeFetchText } from "@/lib/server/safe-fetch";
import {
  buildMentionQueryPlans,
  canonicalizeMentionUrl,
  evaluateMention,
  isWithinMentionWindow,
  mentionIdentity,
} from "@/lib/mention-filter";
import { syncContentItems } from "@/lib/server/database";
import { googleNewsArticleId, resolveGoogleNewsUrl } from "@/lib/server/google-news";
import { collectionScope } from "@/lib/collection-scope";

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

function readablePageText(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250_000);
}

function isSearchWrapper(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "news.google.com" || hostname === "bing.com" || hostname.endsWith(".bing.com");
  } catch {
    return true;
  }
}

async function optionalPageText(canonicalUrl: string) {
  if (!canonicalUrl || isSearchWrapper(canonicalUrl)) return "";
  try {
    const response = await safeFetchText(canonicalUrl, { timeoutMs: 8_000 });
    return readablePageText(response.text);
  } catch {
    return "";
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

export async function GET() {
  const settings = await readSettings();
  const checkedAt = new Date().toISOString();
  const freshSince = new Date(Date.parse(checkedAt) - MENTION_WINDOW_DAYS * 86_400_000).toISOString();
  const freshUntil = new Date(Date.parse(checkedAt) + 10 * 60 * 1000).toISOString();
  const terms = [...new Set([...settings.mentions.terms, ...settings.mentions.websites])];
  const mentionScope = terms.length ? collectionScope("mentions-v4", [
    `strict:${settings.mentions.strictMode}`,
    ...settings.mentions.terms.map((term) => `term:${term}`),
    ...settings.mentions.websites.map((website) => `website:${website}`),
    ...settings.mentions.identityAnchors.map((anchor) => `anchor:${anchor}`),
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

  const results = await Promise.allSettled(tasks.map(async (task) => {
    const endpoint = providerUrl(task.provider, task.query);
    const response = await safeFetchText(endpoint);
    return { ...task, endpoint, items: parseFeed(response.text, task.provider) };
  }));

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
      if (!isWithinMentionWindow(item.publishedAt, { now: checkedAt, windowDays: MENTION_WINDOW_DAYS })) {
        filteredCounts.outsideWindow += 1;
        continue;
      }
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
  const pageTexts = new Map<string, string>();
  const readableUrls = [...new Set(resolvedCandidates.map(({ canonicalUrl }) => canonicalUrl).filter((url) => url && !isSearchWrapper(url)))].slice(0, 30);
  const pageResults = await Promise.allSettled(readableUrls.map((url) => optionalPageText(url)));
  pageResults.forEach((result, index) => pageTexts.set(readableUrls[index], result.status === "fulfilled" ? result.value : ""));

  const byId = new Map<string, LiveStory>();
  for (const { task, item, canonicalUrl } of resolvedCandidates) {
    const evaluation = evaluateMention(
      item,
      task.primary,
      identitySignals,
      settings.mentions.identityAnchors,
      settings.mentions.strictMode,
      {
        canonicalUrl,
        publisher: item.source,
        pageText: pageTexts.get(canonicalUrl) || "",
        queryMatched: true,
        queryContexts: task.queryContexts,
        nicheContexts,
      },
    );
    if (!evaluation.accepted) {
      filteredCounts.rejected += 1;
      continue;
    }
    const id = mentionIdentity({ ...item, canonicalUrl, publisher: item.source });
    const normalized: LiveStory = {
      ...item,
      id,
      url: canonicalUrl || item.url,
      kind: "mention",
      matchedTerm: task.primary,
      confidence: evaluation.confidence,
      matchReasons: evaluation.reasons,
      collectionScope: mentionScope,
    };
    byId.set(id, mergeMention(byId.get(id), normalized));
  }

  const discovered = [...byId.values()].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const saved = syncContentItems<LiveStory>("mentions", discovered, { freshSince, freshUntil, activeScopes: [mentionScope] });
  const providerStatuses = searchProviders.map((provider) => {
    const summary = providerSummary.get(provider)!;
    const live = summary.successes > 0;
    return {
      provider,
      state: live ? "live" as const : "degraded" as const,
      message: live
        ? `${summary.candidates} candidates across ${summary.successes}/${summary.requests} successful searches`
        : `All ${summary.requests} searches failed`,
    };
  });
  const items = saved.active.slice(0, 100);
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
