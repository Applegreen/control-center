import { deleteMinute, getMinute, updateMinute } from "@/lib/server/minutes-db";
import type { UpdateMinuteInput } from "@/lib/server/minutes-db";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const minute = getMinute(id);
  if (!minute) return Response.json({ error: "Minute not found." }, { status: 404 });
  return Response.json({ minute });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as UpdateMinuteInput;
    const minute = updateMinute(id, body);
    if (!minute) return Response.json({ error: "Minute not found." }, { status: 404 });
    return Response.json({ minute });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save the minute." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!deleteMinute(id)) return Response.json({ error: "Minute not found." }, { status: 404 });
  return Response.json({ ok: true });
}
