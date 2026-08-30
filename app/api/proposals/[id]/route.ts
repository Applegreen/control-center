import {
  deleteProposal,
  duplicateProposal,
  getProposal,
  updateProposal,
} from "@/lib/server/proposals-db";
import type { UpdateProposalInput } from "@/lib/server/proposals-db";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const proposal = getProposal(id);
  if (!proposal) return Response.json({ error: "Proposal not found." }, { status: 404 });
  return Response.json({ proposal });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as UpdateProposalInput;
    const proposal = updateProposal(id, body);
    if (!proposal) return Response.json({ error: "Proposal not found." }, { status: 404 });
    return Response.json({ proposal });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save the proposal." },
      { status: 400 },
    );
  }
}

/** POST to an existing proposal duplicates it - handy for repeat clients. */
export async function POST(_request: Request, context: Context) {
  const { id } = await context.params;
  const copy = duplicateProposal(id);
  if (!copy) return Response.json({ error: "Proposal not found." }, { status: 404 });
  return Response.json({ proposal: copy }, { status: 201 });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const removed = deleteProposal(id);
  if (!removed) return Response.json({ error: "Proposal not found." }, { status: 404 });
  return Response.json({ ok: true });
}
