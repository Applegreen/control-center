import { NextResponse, type NextRequest } from "next/server";

const REALM = 'Basic realm="Control Center", charset="UTF-8"';

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

// CSRF check: the Origin's host must equal the host the browser asked for.
// Comparing hosts avoids the URL-mutation traps (the `host` setter keeps any
// existing port, and request.url is the internal http://127.0.0.1:3311 form).
function isSameOrigin(value: string, request: NextRequest) {
  try {
    const host = request.headers.get("host");
    if (!host) return false;
    return new URL(value).host === host;
  } catch {
    return false;
  }
}

function credentialsMatch(header: string | null) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password) return false;
  if (!header || !header.toLowerCase().startsWith("basic ")) return false;
  let decoded = "";
  try { decoded = atob(header.slice(6).trim()); } catch { return false; }
  const i = decoded.indexOf(":");
  if (i === -1) return false;
  return decoded.slice(0, i) === user && decoded.slice(i + 1) === password;
}

export function proxy(request: NextRequest) {
  if (!credentialsMatch(request.headers.get("authorization"))) return unauthorized();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    if (origin && !isSameOrigin(origin, request)) {
      return NextResponse.json({ error: "Cross-site requests are blocked." }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
