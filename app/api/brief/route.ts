import { createHash } from "node:crypto";
import {
  briefSourceStatuses,
  listBriefItems,
  upsertBriefItems,
} from "@/lib/brief-store";
import { getDatabase } from "@/lib/server/database";
import { readSettings } from "@/lib/server/settings";
import type { DailyBriefItem, DailyBriefResponse } from "@/lib/types";

export const runtime = "nodejs";

const kinds = new Set<DailyBriefItem["kind"]>([
  "action",
  "meeting",
  "message",
  "info",
]);

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanDate(value: unknown, fallback?: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 2_000);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function responsePayload(): Promise<DailyBriefResponse> {
  const settings = await readSettings();
  const since = new Date(
    Date.now() - settings.dailyBrief.lookbackDays * 86_400_000,
  ).toISOString();
  const database = getDatabase();
  const items = listBriefItems(database, since);
  const storedStatuses = new Map(
    briefSourceStatuses(database, since).map((status) => [
      status.source.toLowerCase(),
      status,
    ]),
  );
  const sourceStatuses = settings.dailyBrief.sourceLabels.map((source) => {
    const status = storedStatuses.get(source.toLowerCase());
    return {
      source,
      lastSyncedAt: status?.last_synced_at || "",
      itemCount: status?.item_count || 0,
    };
  });
  return {
    configured: settings.dailyBrief.sourceLabels.length > 0,
    checkedAt: new Date().toISOString(),
    items,
    sourceStatuses,
  };
}

export async function GET() {
  return Response.json(await responsePayload());
}

export async function POST(request: Request) {
  try {
    const settings = await readSettings();
    if (!settings.dailyBrief.sourceLabels.length) {
      return Response.json(
        {
          error:
            "Add at least one Daily Brief source in Settings before syncing connector data.",
        },
        { status: 400 },
      );
    }
    const configuredSources = new Map(
      settings.dailyBrief.sourceLabels.map((source) => [
        source.toLowerCase(),
        source,
      ]),
    );
    const body = (await request.json()) as { items?: unknown[] } | unknown[];
    const values = Array.isArray(body) ? body : body.items;
    if (!Array.isArray(values))
      throw new Error("Send a JSON array or an object with an items array.");
    if (values.length > 500)
      throw new Error(
        "A single Daily Brief sync can contain at most 500 items.",
      );
    const syncedAt = new Date().toISOString();
    const items = values.map((value, index): DailyBriefItem => {
      if (!value || typeof value !== "object")
        throw new Error(`Item ${index + 1} must be an object.`);
      const candidate = value as Record<string, unknown>;
      const requestedSource = cleanText(candidate.source, 80);
      const source = configuredSources.get(requestedSource.toLowerCase());
      if (!source)
        throw new Error(
          `Item ${index + 1}: source "${requestedSource || "(missing)"}" is not enabled in Daily Brief Settings.`,
        );
      const title = cleanText(candidate.title, 300);
      if (!title) throw new Error(`Item ${index + 1}: title is required.`);
      const occurredAt = cleanDate(candidate.occurredAt, syncedAt)!;
      const kind = cleanText(candidate.kind, 20) as DailyBriefItem["kind"];
      const normalizedKind = kinds.has(kind) ? kind : "info";
      const url = cleanUrl(candidate.url);
      const requestedId = cleanText(candidate.id, 200);
      const id =
        requestedId ||
        createHash("sha256")
          .update([source, title, url || "", occurredAt].join("\u0000"))
          .digest("hex");
      return {
        id,
        source,
        title,
        summary: cleanText(candidate.summary, 2_000),
        kind: normalizedKind,
        occurredAt,
        dueAt: cleanDate(candidate.dueAt),
        url,
        syncedAt,
      };
    });
    upsertBriefItems(getDatabase(), items);
    return Response.json({
      ...(await responsePayload()),
      accepted: items.length,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Daily Brief sync failed.",
      },
      { status: 400 },
    );
  }
}
