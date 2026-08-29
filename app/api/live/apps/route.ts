import { APP_LINKS } from "@/lib/apps";

export const runtime = "nodejs";

async function probe(url: string) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
    });
    // Any HTTP answer means the service is listening and responding.
    return { ok: response.status > 0, status: response.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - started };
  }
}

export async function GET() {
  const items = await Promise.all(
    APP_LINKS.map(async (app) => {
      const result = await probe(app.check);
      return {
        id: app.id,
        name: app.name,
        description: app.description,
        href: app.href,
        ...result,
      };
    }),
  );
  return Response.json({ checkedAt: new Date().toISOString(), items });
}
