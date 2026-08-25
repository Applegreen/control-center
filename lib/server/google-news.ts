import "server-only";

import { assertPublicUrl, safeFetchText } from "@/lib/server/safe-fetch";
import {
  extractGoogleNewsDecodeParameters,
  googleNewsArticleId,
  parseGoogleNewsBatchResponse,
} from "@/lib/google-news";

export { googleNewsArticleId } from "@/lib/google-news";

export async function resolveGoogleNewsUrl(value: string) {
  const articleId = googleNewsArticleId(value);
  if (!articleId) return value;
  const page = await safeFetchText(value, {
    timeoutMs: 8_000,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127.0 Safari/537.36" },
  });
  const parameters = extractGoogleNewsDecodeParameters(page.text, articleId);
  if (!parameters) return value;
  const request = [
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    parameters.articleId,
    parameters.timestamp,
    parameters.signature,
  ];
  const body = new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", JSON.stringify(request)]]]) });
  const endpoint = (await assertPublicUrl("https://news.google.com/_/DotsSplashUi/data/batchexecute")).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/127.0 Safari/537.36",
    },
    body,
  });
  if (!response.ok) return value;
  const resolved = parseGoogleNewsBatchResponse(await response.text());
  if (!resolved) return value;
  await assertPublicUrl(resolved);
  return resolved;
}
