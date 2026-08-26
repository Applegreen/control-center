import { createHash } from "node:crypto";
import { boundedPriority } from "./feed-priority";
import type { LiveStory } from "./types";

export type VerifiedMentionEvidence = { story: LiveStory; pageText: string };
export type MentionCuration = {
  id: string;
  aiSummary: string;
  importanceScore: number;
  importanceReason: string;
};

export type MentionCurationCacheEntry = {
  expiresAt: number;
  result: Promise<MentionCuration | null>;
};

export function cacheMentionCuration(
  cache: Map<string, MentionCurationCacheEntry>,
  key: string,
  result: Promise<MentionCuration | null>,
  expiresAt: number,
) {
  cache.set(key, { expiresAt, result });
  const evictCurrent = () => {
    if (cache.get(key)?.result === result) cache.delete(key);
  };
  // Missing/invalid per-ID output is retryable on the next pass, just like a
  // rejected request. Only successful grounded summaries keep the long TTL.
  void result.then((curation) => { if (!curation) evictCurrent(); }, evictCurrent);
}

function maskIdentifiers(value: string) {
  return value.replace(/https?:\/\/[^\s<>]+/gi, "[source link]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email address]");
}

export function boundedMentionEvidence({ story, pageText }: VerifiedMentionEvidence) {
  if (story.kind !== "mention" || !story.confidence || !story.matchedTerm ||
      !story.matchReasons?.length || !pageText.trim()) return null;
  const identityOffset = pageText.toLowerCase().indexOf(story.matchedTerm.toLowerCase());
  const excerpt = identityOffset > 600
    ? `${pageText.slice(0, 450)} … ${pageText.slice(Math.max(0, identityOffset - 700), identityOffset + 3_300)}`
    : pageText.slice(0, 4_000);
  return {
    id: story.id,
    title: maskIdentifiers(story.title).slice(0, 350),
    source: story.source.slice(0, 200),
    matchedTerm: maskIdentifiers(story.matchedTerm).slice(0, 150),
    confidence: story.confidence,
    identityReasons: story.matchReasons.slice(0, 6).map((reason) => maskIdentifiers(reason).slice(0, 200)),
    evidence: maskIdentifiers(excerpt).slice(0, 4_200),
  };
}

export function mentionCurationKey(scope: string, evidence: NonNullable<ReturnType<typeof boundedMentionEvidence>>) {
  return createHash("sha256").update(JSON.stringify({ scope, evidence })).digest("hex");
}

export function validateMentionCurations(value: unknown, allowedIds: ReadonlySet<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Array.isArray((value as { mentions?: unknown }).mentions))
    throw new Error("Mention AI did not return a summaries list.");
  const seen = new Set<string>();
  return (value as { mentions: unknown[] }).mentions.flatMap((entry): MentionCuration[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as { id?: unknown; summary?: unknown; score?: unknown; reason?: unknown };
    if (typeof item.id !== "string" || !allowedIds.has(item.id) || seen.has(item.id) ||
        typeof item.summary !== "string" || item.summary.trim().length < 20 ||
        typeof item.score !== "number" || !Number.isFinite(item.score) ||
        typeof item.reason !== "string" || item.reason.trim().length < 10 ||
        /https?:\/\//i.test(`${item.summary} ${item.reason}`)) return [];
    seen.add(item.id);
    return [{
      id: item.id,
      aiSummary: item.summary.trim().slice(0, 700),
      importanceScore: boundedPriority(item.score),
      importanceReason: item.reason.trim().slice(0, 240),
    }];
  });
}
