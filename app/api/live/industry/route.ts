import type { IndustrySourceStatus, LiveFeedResponse, LiveStory } from "@/lib/types";
import { readSettings } from "@/lib/server/settings";
import { parseFeed, readIndustrySnapshots, readSource, writeIndustrySnapshots } from "@/lib/server/rss";
import { INDUSTRY_FRESHNESS_HOURS } from "@/lib/freshness";
import { syncContentItems } from "@/lib/server/database";
import { safeFetchText } from "@/lib/server/safe-fetch";
import { combineIndustryDiscoveries, prioritizeIndustryItems, splitIndustryLibrary } from "@/lib/industry";
import { collectionScope } from "@/lib/collection-scope";

export const runtime = "nodejs";
const INDUSTRY_RESPONSE_LIMIT = 500;

declare global {
  var controlCenterIndustryQueue: Promise<void> | undefined;
}

function topicQueries(keywords: string[]) {
  const cleaned = [...new Set(keywords.map((keyword) => keyword.replaceAll('"', "").trim()).filter(Boolean))].slice(0, 24);
  const queries: string[] = [];
  for (let index = 0; index < cleaned.length; index += 6) {
    const group = cleaned.slice(index, index + 6).map((keyword) => `"${keyword}"`).join(" OR ");
    queries.push(`${group.length ? `(${group}) ` : ""}when:1d`);
  }
  return queries;
}

async function readTopicNews(keywords: string[]) {
  const queries = topicQueries(keywords);
  const results = await Promise.allSettled(queries.map(async (query) => {
    const endpoint = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await safeFetchText(endpoint);
    return { endpoint, items: parseFeed(response.text, "Google News").map((item) => ({ ...item, kind: "topic" as const })) };
  }));
  const items: LiveStory[] = [];
  const errors: string[] = [];
  let endpoint = "https://news.google.com/";
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      endpoint = result.value.endpoint;
      items.push(...result.value.items);
    } else {
      errors.push(`Topic discovery: ${result.reason instanceof Error ? result.reason.message : "Google News could not be read"}`);
    }
  });
  const uniqueItems = [...new Map(items.map((item) => [item.url || item.id, item])).values()];
  return { items: uniqueItems, errors, endpoint, queryCount: queries.length };
}

async function collectIndustry() {
  const settings = await readSettings();
  const checkedAt = new Date().toISOString();
  const freshSince = new Date(Date.parse(checkedAt) - INDUSTRY_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
  const freshUntil = new Date(Date.parse(checkedAt) + 10 * 60 * 1000).toISOString();
  const sourceScopes = new Map(settings.industry.sources.map((source) => [
    source.id,
    collectionScope("industry-source-v2", [source.id, source.url]),
  ]));
  const topicScope = settings.industry.keywords.length
    ? collectionScope("industry-topics-v2", settings.industry.keywords)
    : "";
  const activeScopes = [...sourceScopes.values(), ...(topicScope ? [topicScope] : [])];
  if (!settings.industry.sources.length && !settings.industry.keywords.length) {
    const saved = syncContentItems<LiveStory>("industry", [], { freshSince, freshUntil, activeScopes });
    const hasSavedLibrary = saved.active.length + saved.archived.length > 0;
    const { archivedItems, historyItems } = splitIndustryLibrary(saved.archived);
    return Response.json({ configured: hasSavedLibrary, checkedAt, items: saved.active, archivedItems, archiveCount: archivedItems.length, historyItems, historyCount: historyItems.length, errors: hasSavedLibrary ? ["Tracking is paused because no Industry sources are configured. Saved history remains available."] : [], sourceStatuses: [], freshnessHours: INDUSTRY_FRESHNESS_HOURS } satisfies LiveFeedResponse);
  }
  const snapshots = await readIndustrySnapshots();
  const nextSnapshots = { ...snapshots };
  const [sourceResults, topicResult] = await Promise.all([
    Promise.allSettled(settings.industry.sources.map((source) => readSource(source, snapshots[source.id]))),
    settings.industry.keywords.length ? readTopicNews(settings.industry.keywords) : Promise.resolve({ items: [] as LiveStory[], errors: [] as string[], endpoint: "", queryCount: 0 }),
  ]);
  const siteItems: LiveStory[] = [];
  const errors: string[] = [];
  const sourceStatuses: IndustrySourceStatus[] = [];
  let snapshotsUpdated = false;
  sourceResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const scope = sourceScopes.get(settings.industry.sources[index].id)!;
      siteItems.push(...result.value.items.map((item) => ({ ...item, collectionScope: scope })));
      sourceStatuses.push(result.value.status);
      if (result.value.snapshot) {
        nextSnapshots[settings.industry.sources[index].id] = result.value.snapshot;
        snapshotsUpdated = true;
      }
    }
    else errors.push(`${settings.industry.sources[index].name || settings.industry.sources[index].url}: ${result.reason instanceof Error ? result.reason.message : "Failed to read source"}`);
  });
  if (snapshotsUpdated) await writeIndustrySnapshots(nextSnapshots);
  if (settings.industry.keywords.length) {
    sourceStatuses.push({ sourceId: "topic-discovery", source: "Topic discovery", mode: "topics", endpoint: topicResult.endpoint, state: "live", message: `${topicResult.items.length} current stories across ${settings.industry.keywords.length} configured topic${settings.industry.keywords.length === 1 ? "" : "s"}` });
  }
  errors.push(...topicResult.errors);
  const topicItems = topicScope
    ? topicResult.items.map((item) => ({ ...item, collectionScope: topicScope }))
    : [];
  const currentItems = combineIndustryDiscoveries(siteItems, topicItems);
  const saved = syncContentItems<LiveStory>("industry", currentItems, { freshSince, freshUntil, activeScopes });
  const { archivedItems, historyItems } = splitIndustryLibrary(saved.archived);
  return Response.json({ configured: true, checkedAt, items: prioritizeIndustryItems(saved.active, INDUSTRY_RESPONSE_LIMIT), archivedItems, archiveCount: archivedItems.length, historyItems, historyCount: historyItems.length, errors, sourceStatuses, freshnessHours: INDUSTRY_FRESHNESS_HOURS } satisfies LiveFeedResponse);
}

export async function GET() {
  const previous = globalThis.controlCenterIndustryQueue ?? Promise.resolve();
  let release = () => {};
  globalThis.controlCenterIndustryQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await collectIndustry();
  } finally {
    release();
  }
}
