import {
  listPublishedNews,
  publishStory,
  publishedIds,
  unpublishStory,
  type PublishInput,
} from "@/lib/server/site-news-db";
import { buildFeedPayload } from "@/lib/site-news";

export const runtime = "nodejs";

/**
 * GET  -> what is currently approved, plus the id list the Industry tab uses to
 *         show which stories are already live.
 * GET ?preview=1 -> exactly the JSON the publisher will upload, so you can see
 *         what the site will show without waiting for the next cron run.
 */
export async function GET(request: Request) {
  try {
    const items = listPublishedNews();
    if (new URL(request.url).searchParams.get("preview")) {
      return Response.json(buildFeedPayload(items));
    }
    return Response.json({ items, ids: publishedIds() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read published news." },
      { status: 500 },
    );
  }
}

/**
 * Approve or un-approve a story for the website.
 *
 * This is the only way an item reaches digitalcharacters.africa. There is no
 * automatic path from the Industry feed to the homepage - a person ticks it or
 * it never appears.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return Response.json({ error: "A story id is required." }, { status: 400 });
    }

    if (body.published === false) {
      const removed = unpublishStory(id);
      return Response.json({ published: false, removed, ids: publishedIds() });
    }

    const item = publishStory({
      id,
      title: typeof body.title === "string" ? body.title : "",
      summary: typeof body.summary === "string" ? body.summary : "",
      url: typeof body.url === "string" ? body.url : "",
      source: typeof body.source === "string" ? body.source : "",
      category: typeof body.category === "string" ? body.category : undefined,
      publishedAt: typeof body.publishedAt === "string" ? body.publishedAt : undefined,
      pin: typeof body.pin === "number" ? body.pin : 0,
    } satisfies PublishInput);

    return Response.json({ published: true, item, ids: publishedIds() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not publish that story." },
      { status: 400 },
    );
  }
}
