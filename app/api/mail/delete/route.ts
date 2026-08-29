import { moveMessageToTrash } from "@/lib/server/mail-delete";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim().slice(0, 40) : "";
  const uid = Number(body.uid);
  if (!accountId || !Number.isSafeInteger(uid) || uid <= 0)
    return Response.json({ error: "Mailbox and message reference are required." }, { status: 400 });

  try {
    const result = await moveMessageToTrash(accountId, uid);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Delete failed." },
      { status: 502 },
    );
  }
}
