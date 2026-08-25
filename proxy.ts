import { NextResponse, type NextRequest } from "next/server";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(value: string) {
  try {
    return loopbackHosts.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isSameOrigin(value: string, request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    requestUrl.host = request.headers.get("host") || requestUrl.host;
    return new URL(value).origin === requestUrl.origin;
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
  if (origin && !isSameOrigin(origin, request)) {
    return NextResponse.json(
      { error: "Cross-site requests are blocked." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
