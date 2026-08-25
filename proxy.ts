import { NextResponse, type NextRequest } from "next/server";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(value: string) {
  try {
    return loopbackHosts.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  if (!isLoopback(`http://${host}`)) {
    return NextResponse.json(
      { error: "Control Center only accepts requests from this computer." },
      { status: 403 },
    );
  }
  const origin = request.headers.get("origin");
  if (origin && !isLoopback(origin)) {
    return NextResponse.json(
      { error: "Cross-site requests are blocked." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
