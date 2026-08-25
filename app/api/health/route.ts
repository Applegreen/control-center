import { getDatabase } from "@/lib/server/database";

export const runtime = "nodejs";

export async function GET() {
  try {
    getDatabase().prepare("SELECT 1").get();
    return Response.json({
      service: "control-center",
      status: "ready",
      version: "0.3.0",
    });
  } catch {
    return Response.json(
      { service: "control-center", status: "unhealthy", version: "0.3.0" },
      { status: 503 },
    );
  }
}
