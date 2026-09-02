import {
  deleteContact,
  deleteLead,
  getContact,
  getLead,
  updateContact,
  updateLead,
} from "@/lib/server/crm-db";

export const runtime = "nodejs";

type Context = { params: Promise<{ kind: string; id: string }> };

/** One route for both record types - the path segment picks the handler set. */
function handlers(kind: string) {
  if (kind === "leads") {
    return { get: getLead, update: updateLead, remove: deleteLead, key: "lead" as const };
  }
  if (kind === "contacts") {
    return {
      get: getContact,
      update: updateContact,
      remove: deleteContact,
      key: "contact" as const,
    };
  }
  return null;
}

export async function GET(_request: Request, context: Context) {
  const { kind, id } = await context.params;
  const handler = handlers(kind);
  if (!handler) return Response.json({ error: "Unknown record type." }, { status: 404 });

  const record = handler.get(id);
  if (!record) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ [handler.key]: record });
}

export async function PATCH(request: Request, context: Context) {
  const { kind, id } = await context.params;
  const handler = handlers(kind);
  if (!handler) return Response.json({ error: "Unknown record type." }, { status: 404 });

  try {
    const body = await request.json();
    const record = handler.update(id, body);
    if (!record) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ [handler.key]: record });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { kind, id } = await context.params;
  const handler = handlers(kind);
  if (!handler) return Response.json({ error: "Unknown record type." }, { status: 404 });

  if (!handler.remove(id)) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ ok: true });
}
