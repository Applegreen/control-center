import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readBoundedResponseText } from "@/lib/sitemap";
import { isNonPublicIpAddress } from "@/lib/server/public-address";

const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;

export async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP and HTTPS sources are supported.");
  if (url.username || url.password) throw new Error("Source URLs cannot contain credentials.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa")
  ) throw new Error("Local network sources are blocked.");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isNonPublicIpAddress(address)))
    throw new Error("Private or non-public network sources are blocked.");
  return url;
}

type SafeFetchOptions = {
  headers?: HeadersInit;
  timeoutMs?: number;
  maxBytes?: number;
};

export async function safeFetchText(value: string, options: SafeFetchOptions = {}) {
  let currentUrl = (await assertPublicUrl(value)).toString();
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetch(currentUrl, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
      headers: {
        "User-Agent": "ControlCenter/1.0 (+self-hosted feed reader)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...options.headers,
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("Source returned a redirect without a destination.");
    currentUrl = (await assertPublicUrl(new URL(location, currentUrl).toString())).toString();
  }
  if (!response) throw new Error("Source could not be requested.");
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("Source redirected too many times.");
  if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
  await assertPublicUrl(currentUrl);
  const text = await readBoundedResponseText(response, options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  return { text, contentType: response.headers.get("content-type") || "", finalUrl: currentUrl };
}
