import type { NewsletterFeedResponse, NewsletterItem } from "@/lib/types";
import { getGmailAccessToken, gmailJson } from "@/lib/server/gmail";
import { readSettings } from "@/lib/server/settings";
import { syncContentItems } from "@/lib/server/database";

export const runtime = "nodejs";

type GmailList = { messages?: Array<{ id: string }>; nextPageToken?: string };
type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

async function settleWithConcurrency<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
) {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        try {
          results[index] = {
            status: "fulfilled",
            value: await operation(values[index]),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

export async function GET() {
  const settings = await readSettings();
  if (!settings.newsletters.refreshToken) {
    const saved = syncContentItems<NewsletterItem>("newsletters", []);
    const hasSavedLibrary = saved.active.length + saved.archived.length > 0;
    return Response.json({
      configured: hasSavedLibrary,
      connected: false,
      checkedAt: new Date().toISOString(),
      items: saved.active.slice(0, 100),
      archivedItems: saved.archived,
      archiveCount: saved.archived.length,
      errors: hasSavedLibrary
        ? [
            "Gmail is disconnected. Saved newsletter items remain available locally.",
          ]
        : [],
    } satisfies NewsletterFeedResponse);
  }
  try {
    const token = await getGmailAccessToken();
    const query = encodeURIComponent(settings.newsletters.gmailQuery);
    const messageIds: string[] = [];
    let pageToken = "";
    for (let page = 0; page < 5; page += 1) {
      const list = await gmailJson<GmailList>(
        `/messages?maxResults=100&q=${query}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        token,
      );
      messageIds.push(...(list.messages || []).map(({ id }) => id));
      pageToken = list.nextPageToken || "";
      if (!pageToken) break;
    }
    const messageResults = await settleWithConcurrency(messageIds, 10, (id) =>
      gmailJson<GmailMessage>(
        `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`,
        token,
      ),
    );
    const messages = messageResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const errors = messageResults.some((result) => result.status === "rejected")
      ? [
          `${messageResults.filter((result) => result.status === "rejected").length} Gmail message${messageResults.filter((result) => result.status === "rejected").length === 1 ? " was" : "s were"} skipped because metadata could not be read.`,
        ]
      : [];
    const items: NewsletterItem[] = messages.map((message) => {
      const headers = new Map(
        (message.payload?.headers || []).map((header) => [
          header.name.toLowerCase(),
          header.value,
        ]),
      );
      return {
        id: `${settings.newsletters.connectedEmail}:${message.id}`,
        sender: headers.get("from") || "Unknown sender",
        subject: headers.get("subject") || "Untitled newsletter",
        snippet: message.snippet || "",
        receivedAt: new Date(
          Number(message.internalDate || Date.now()),
        ).toISOString(),
        gmailUrl: `https://mail.google.com/mail/u/${encodeURIComponent(settings.newsletters.connectedEmail)}/#all/${message.id}`,
      };
    });
    const saved = syncContentItems<NewsletterItem>("newsletters", items);
    return Response.json({
      configured: true,
      connected: true,
      checkedAt: new Date().toISOString(),
      items: saved.active.slice(0, 100),
      archivedItems: saved.archived,
      archiveCount: saved.archived.length,
      errors,
    } satisfies NewsletterFeedResponse);
  } catch (error) {
    const saved = syncContentItems<NewsletterItem>("newsletters", []);
    return Response.json({
      configured: true,
      connected: true,
      checkedAt: new Date().toISOString(),
      items: saved.active.slice(0, 100),
      archivedItems: saved.archived,
      archiveCount: saved.archived.length,
      errors: [
        error instanceof Error ? error.message : "Newsletter sync failed",
      ],
    } satisfies NewsletterFeedResponse);
  }
}
