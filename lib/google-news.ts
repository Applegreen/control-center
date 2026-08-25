const googleNewsHost = "news.google.com";
const articlePathPrefix = "/rss/articles/";

export type GoogleNewsDecodeParameters = {
  articleId: string;
  signature: string;
  timestamp: number;
};

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${escapePattern(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((value) => value !== undefined) || "";
}

export function googleNewsArticleId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== googleNewsHost || !url.pathname.startsWith(articlePathPrefix)) return "";
    return url.pathname.slice(articlePathPrefix.length).split("/")[0] || "";
  } catch {
    return "";
  }
}

export function extractGoogleNewsDecodeParameters(html: string, articleId: string): GoogleNewsDecodeParameters | null {
  const tag = (html.match(/<div\b[^>]*data-n-a-id\s*=\s*(?:"[^"]+"|'[^']+')[^>]*>/gi) || [])
    .find((candidate) => attribute(candidate, "data-n-a-id") === articleId);
  if (!tag) return null;
  const signature = attribute(tag, "data-n-a-sg");
  const timestamp = Number(attribute(tag, "data-n-a-ts"));
  return signature && Number.isFinite(timestamp) ? { articleId, signature, timestamp } : null;
}

export function parseGoogleNewsBatchResponse(value: string) {
  for (const line of value.split("\n")) {
    if (!line.trim().startsWith("[[")) continue;
    try {
      const outer = JSON.parse(line) as Array<[string, string, string]>;
      const payload = JSON.parse(outer[0]?.[2] || "") as [string, string];
      const resolved = payload[1];
      if (typeof resolved === "string" && /^https?:\/\//i.test(resolved)) return resolved;
    } catch {
      // Google may include non-RPC bookkeeping lines before the response payload.
    }
  }
  return "";
}
