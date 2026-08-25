import type { SettingsUpdate } from "@/lib/types";
import { disconnectGmail, readSettings, toPublicSettings, updateSettings } from "@/lib/server/settings";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(toPublicSettings(await readSettings()));
}

export async function PUT(request: Request) {
  try {
    const update = await request.json() as SettingsUpdate;
    return Response.json(await updateSettings(update));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save settings." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("connection") !== "gmail") return Response.json({ error: "Unknown connection." }, { status: 400 });
  await disconnectGmail();
  return Response.json({ ok: true });
}
