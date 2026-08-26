import { collectAudience, readAudienceHistory } from "@/lib/server/audience";
import { readSettings } from "@/lib/server/settings";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const settings = await readSettings();
  if (!settings.audience.accounts.length) return Response.json({ configured: false, checkedAt: new Date().toISOString(), items: [], history: [] });
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const items = await collectAudience(settings, { forceRefresh });
  const history = await readAudienceHistory(settings);
  return Response.json({ configured: true, checkedAt: new Date().toISOString(), items, history });
}
