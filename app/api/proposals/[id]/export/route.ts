import { getProposal } from "@/lib/server/proposals-db";
import {
  exportFilename,
  renderProposalDocx,
  renderProposalPdf,
  renderProposalPptx,
} from "@/lib/server/proposal-render";

export const runtime = "nodejs";

const FORMATS = {
  pdf: {
    extension: "pdf",
    type: "application/pdf",
    render: renderProposalPdf,
  },
  docx: {
    extension: "docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    render: renderProposalDocx,
  },
  pptx: {
    extension: "pptx",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    render: renderProposalPptx,
  },
} as const;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const requested = new URL(request.url).searchParams.get("format") || "pdf";
  const format = FORMATS[requested as keyof typeof FORMATS];

  if (!format) {
    return Response.json(
      { error: `Unknown format '${requested}'. Use pdf, docx or pptx.` },
      { status: 400 },
    );
  }

  const proposal = getProposal(id);
  if (!proposal) return Response.json({ error: "Proposal not found." }, { status: 404 });

  try {
    const body = await format.render(proposal);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": format.type,
        "Content-Disposition": `attachment; filename="${exportFilename(proposal, format.extension)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // Rendering failures are worth surfacing rather than serving a corrupt file.
    return Response.json(
      {
        error: `Could not build the ${requested.toUpperCase()}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      },
      { status: 500 },
    );
  }
}
