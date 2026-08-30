import {
  createProposal,
  listProposals,
  listRateCard,
  replaceRateCard,
} from "@/lib/server/proposals-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ proposals: listProposals(), rateCard: listRateCard() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read proposals." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      clientName?: string;
      projectTitle?: string;
      rateCard?: { category?: string; description?: string; unit?: string; defaultRate?: number }[];
    };

    // The same endpoint saves the rate card, since it is a single shared list rather
    // than a per-proposal resource.
    if (Array.isArray(body.rateCard)) {
      return Response.json({
        rateCard: replaceRateCard(
          body.rateCard.map((entry) => ({
            category: String(entry.category ?? ""),
            description: String(entry.description ?? ""),
            unit: String(entry.unit ?? "item"),
            defaultRate: Math.round(Number(entry.defaultRate) || 0),
          })),
        ),
      });
    }

    const proposal = createProposal({
      kind: body.kind === "quote" ? "quote" : "proposal",
      clientName: body.clientName,
      projectTitle: body.projectTitle,
    });
    return Response.json({ proposal }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create the proposal." },
      { status: 400 },
    );
  }
}
