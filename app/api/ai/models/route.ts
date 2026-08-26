import { isAiKeyProvider } from "@/lib/ai-providers";
import { discoverAiModels } from "@/lib/server/ai-models";
import { readSettings } from "@/lib/server/settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json"))
      return Response.json({ error: "Send model discovery options as JSON." }, { status: 415 });
    const raw = await request.text();
    if (raw.length > 8_000) return Response.json({ error: "Model discovery options are too large." }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new Error("Model discovery options must be valid JSON."); }
    if (!body || typeof body !== "object") throw new Error("Choose an AI provider.");
    const values = body as Record<string, unknown>;
    if (!isAiKeyProvider(values.provider)) throw new Error("Choose a supported AI provider.");
    const payload = await discoverAiModels(await readSettings(), {
      provider: values.provider,
      apiKey: typeof values.apiKey === "string" ? values.apiKey : undefined,
      baseUrl: typeof values.baseUrl === "string" ? values.baseUrl : undefined,
      refresh: values.refresh === true,
      useSavedKey: values.useSavedKey !== false,
    });
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load provider models." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
