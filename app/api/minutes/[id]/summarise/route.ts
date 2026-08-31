import { getMinute } from "@/lib/server/minutes-db";
import { summariseMinute } from "@/lib/server/minutes-ai";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/**
 * Returns a proposed summary and task list WITHOUT saving them.
 *
 * The operator reviews and edits in the browser, then saves through the normal
 * PATCH route. A local model writing straight into a client meeting record
 * unreviewed is not something we want, and it matches how sending works in the
 * Email tab: the machine drafts, the person commits.
 */
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  const minute = getMinute(id);
  if (!minute) return Response.json({ error: "Minute not found." }, { status: 404 });

  try {
    const result = await summariseMinute(minute);
    return Response.json({ ...result, saved: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Summarisation failed.";
    const aborted = /abort/i.test(message);
    return Response.json(
      {
        error: aborted
          ? "Summarisation timed out. The transcript may be too long for this hardware."
          : message,
      },
      { status: aborted ? 504 : 502 },
    );
  }
}
