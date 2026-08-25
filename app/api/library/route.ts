import { getDatabase, setContentArchived, type ContentCategory } from "@/lib/server/database";

export const runtime = "nodejs";

const categories = new Set<ContentCategory>(["industry", "mentions", "newsletters"]);

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { category?: ContentCategory; id?: string; archived?: boolean };
    if (!body.category || !categories.has(body.category) || !body.id || typeof body.archived !== "boolean") {
      return Response.json({ error: "Category, item ID, and archived state are required." }, { status: 400 });
    }
    const updated = setContentArchived(getDatabase(), body.category, body.id, body.archived);
    if (!updated) return Response.json({ error: "Saved item was not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the archive." }, { status: 400 });
  }
}
