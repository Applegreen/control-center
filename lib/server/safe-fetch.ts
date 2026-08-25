import "server-only";

import { readBoundedResponseText } from "@/lib/sitemap";
import { fetchPinned } from "@/lib/server/pinned-fetch";

export { assertPublicUrl } from "@/lib/server/pinned-fetch";

const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;

type SafeFetchOptions = {
  headers?: HeadersInit;
  timeoutMs?: number;
  maxBytes?: number;
};

export async function safeFetchText(value: string, options: SafeFetchOptions = {}) {
  let currentUrl = new URL(value).toString();
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetchPinned(currentUrl, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
      headers: {
        "User-Agent": "ControlCenter/1.0 (+self-hosted feed reader)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...options.headers,
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Source returned a redirect without a destination.");
    }
    if (redirects === 5) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Source redirected too many times.");
    }
    await response.body?.cancel().catch(() => undefined);
    currentUrl = new URL(location, currentUrl).toString();
  }
  if (!response) throw new Error("Source could not be requested.");
  if (!response.ok) {
    const message = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    await response.body?.cancel().catch(() => undefined);
    throw new Error(message);
  }
  const text = await readBoundedResponseText(response, options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  return { text, contentType: response.headers.get("content-type") || "", finalUrl: currentUrl };
}
