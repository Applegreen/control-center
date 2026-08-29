import { sendMail } from "@/lib/server/mail-send";

export const runtime = "nodejs";

function field(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const accountId = field(body.accountId, 40);
  const to = field(body.to, 320);
  const subject = field(body.subject, 300);
  const text = field(body.text, 50_000);
  const inReplyTo = field(body.inReplyTo, 320);

  if (!accountId || !to || !subject || !text)
    return Response.json(
      { error: "Mailbox, recipient, subject and message are all required." },
      { status: 400 },
    );
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
    return Response.json({ error: "Enter a valid recipient address." }, { status: 400 });

  try {
    const result = await sendMail({
      accountId,
      to,
      subject,
      text,
      inReplyTo: inReplyTo || undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Send failed." },
      { status: 502 },
    );
  }
}
