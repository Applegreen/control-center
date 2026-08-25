import "server-only";

import { canonicalizeMentionUrl } from "@/lib/mention-filter";
import { safeFetchText } from "@/lib/server/safe-fetch";

export type VerifiedMentionPage = {
  url: string;
  title: string;
  summary: string;
  pageText: string;
  source: string;
  publishedAt: string;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)));
}

export function readableMentionPageText(html: string) {
  return decodeHtml(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300_000);
}

function tagAttributes(tag: string) {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

function metaContent(html: string, names: string[]) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const name = (attributes.get("property") || attributes.get("name") || "").toLowerCase();
    if (wanted.has(name) && attributes.get("content"))
      return attributes.get("content")!.trim();
  }
  return "";
}

function validPublishedAt(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function htmlPublishedAt(html: string) {
  const metadata = metaContent(html, [
    "article:published_time",
    "datepublished",
    "publishdate",
    "pub_date",
    "parsely-pub-date",
  ]);
  if (metadata) return validPublishedAt(metadata);
  const jsonLd = html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1];
  if (jsonLd) return validPublishedAt(decodeHtml(jsonLd));
  const time = html.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i)?.[1];
  return time ? validPublishedAt(decodeHtml(time)) : "";
}

function htmlTitle(html: string) {
  return (
    metaContent(html, ["og:title", "twitter:title"]) ||
    decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, 500);
}

function htmlSummary(html: string) {
  return metaContent(html, ["og:description", "twitter:description", "description"])
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function sourceFor(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Public web";
  }
}

function oEmbedEndpoint(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtu.be")
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`;
  if (host === "instagram.com")
    return `https://www.instagram.com/oembed/?omitscript=true&url=${encodeURIComponent(url.toString())}`;
  if (host === "tiktok.com")
    return `https://www.tiktok.com/oembed?url=${encodeURIComponent(url.toString())}`;
  return "";
}

async function readOEmbed(url: URL, endpoint: string) {
  try {
    const response = await safeFetchText(endpoint, {
      timeoutMs: 10_000,
      maxBytes: 1_000_000,
      headers: { Accept: "application/json" },
    });
    const payload = JSON.parse(response.text) as Record<string, unknown>;
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const author = typeof payload.author_name === "string" ? payload.author_name.trim() : "";
    const html = typeof payload.html === "string" ? readableMentionPageText(payload.html) : "";
    const pageText = [title, author, html].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!pageText) return null;
    return {
      url: canonicalizeMentionUrl(url.toString()),
      title: title || `Public post by ${author || sourceFor(url.toString())}`,
      summary: author ? `Public post by ${author}.` : "Public post verified through the platform oEmbed endpoint.",
      pageText,
      source: sourceFor(url.toString()),
      publishedAt: "",
    } satisfies VerifiedMentionPage;
  } catch {
    return null;
  }
}

export function isOwnedMentionUrl(value: string, officialWebsites: string[]) {
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return officialWebsites.some((website) => {
    try {
      const official = new URL(
        website.includes("://") ? website : `https://${website}`,
      ).hostname.toLowerCase().replace(/^www\./, "");
      return hostname === official || hostname.endsWith(`.${official}`);
    } catch {
      return false;
    }
  });
}

export async function readVerifiedMentionPage(value: string) {
  const canonicalUrl = canonicalizeMentionUrl(value);
  if (!canonicalUrl) return null;
  const url = new URL(canonicalUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "facebook.com" || host.endsWith(".facebook.com")) return null;
  const oEmbed = oEmbedEndpoint(url);
  if (oEmbed) {
    const verified = await readOEmbed(url, oEmbed);
    if (verified) return verified;
  }
  try {
    const response = await safeFetchText(canonicalUrl, {
      timeoutMs: 10_000,
      maxBytes: 5_000_000,
    });
    const pageText = readableMentionPageText(response.text);
    if (!pageText) return null;
    const finalUrl = canonicalizeMentionUrl(response.finalUrl) || canonicalUrl;
    return {
      url: finalUrl,
      title: htmlTitle(response.text) || `Mention on ${sourceFor(finalUrl)}`,
      summary: htmlSummary(response.text),
      pageText,
      source: sourceFor(finalUrl),
      publishedAt: htmlPublishedAt(response.text),
    } satisfies VerifiedMentionPage;
  } catch {
    return null;
  }
}
