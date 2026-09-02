// Items approved in the Industry tab for publication on digitalcharacters.africa.
//
// Nothing here touches the database or the network, so it can be unit tested
// directly. The one rule worth stating: an item is only ever published because
// a person ticked it. There is no automatic path from the feed to the homepage.

export const NEWS_CATEGORIES = [
  "industry-news",
  "ai-animation",
  "funding",
  "broadcast",
  "africa",
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  "industry-news": "Industry News",
  "ai-animation": "AI Animation Trends",
  funding: "Funding & Tenders",
  broadcast: "Broadcast & Streaming",
  africa: "African Animation",
};

export type SiteNewsItem = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  category: NewsCategory;
  publishedAt: string;
  approvedAt: string;
  /** Higher sorts first within the same day. 0 means "use the date only". */
  pin: number;
};

/** What actually gets written to news.json and read by the website. */
export type NewsFeedPayload = {
  generatedAt: string;
  items: Array<{
    t: string;
    s: string;
    url: string;
    src: string;
    cat: string;
    date: string;
  }>;
};

// ---------------------------------------------------------------- categories

// Ordered: the first rule that matches wins, so the more specific patterns
// have to come before the general ones.
const CATEGORY_RULES: Array<{ category: NewsCategory; pattern: RegExp }> = [
  { category: "funding", pattern: /\b(tender|grant|funding|fund|bursary|rebate|incentive|call for (?:proposals|entries)|nfvf|idc|dtic)\b/i },
  { category: "ai-animation", pattern: /\b(ai|artificial intelligence|generative|machine learning|sora|veo|runway|seedance|midjourney|diffusion|llm)\b/i },
  { category: "africa", pattern: /\b(africa|african|south africa|nigeria|kenya|ghana|nollywood|mzansi|sabc)\b/i },
  { category: "broadcast", pattern: /\b(netflix|disney|showmax|amazon|prime video|hbo|broadcast|streaming|commission(?:ed|s)?|greenlit|slate)\b/i },
];

/**
 * Best-effort category from the headline and summary. Deliberately conservative:
 * anything that does not clearly match falls back to Industry News rather than
 * being filed under a label that would misrepresent it.
 */
export function categoriseStory(title: string, summary = ""): NewsCategory {
  const haystack = `${title} ${summary}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return "industry-news";
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as NewsCategory] || CATEGORY_LABELS["industry-news"];
}

// ---------------------------------------------------------------- text

/**
 * Trim a summary to something that reads as a complete thought on the homepage.
 * Cuts at a sentence end when one is available inside the limit, and at a word
 * boundary otherwise - never mid-word, which looks like a bug.
 */
export function trimSummary(summary: string, limit = 260): string {
  const clean = (summary || "").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;

  const window = clean.slice(0, limit);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentenceEnd > limit * 0.5) return window.slice(0, sentenceEnd + 1);

  const wordEnd = window.lastIndexOf(" ");
  return `${(wordEnd > 0 ? window.slice(0, wordEnd) : window).replace(/[,;:]$/, "")}…`;
}

/** Reading hosts is how a person judges whether a link is worth a click. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- ordering

export function sortNewsItems(items: readonly SiteNewsItem[]): SiteNewsItem[] {
  return [...items].sort((left, right) => {
    if (right.pin !== left.pin) return right.pin - left.pin;
    const byPublished = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    if (Number.isFinite(byPublished) && byPublished !== 0) return byPublished;
    return Date.parse(right.approvedAt) - Date.parse(left.approvedAt);
  });
}

/**
 * Two stories about the same event from different outlets look like padding.
 * Drop the later duplicate when the URL repeats, or when the normalised
 * headline repeats.
 *
 * Keeps the FIRST occurrence, so callers must dedupe in approval order and sort
 * afterwards - see approvalOrder() below. Deduping a display-sorted list makes
 * the surviving outlet arbitrary, which is how this was written first.
 */
export function dedupeNewsItems(items: readonly SiteNewsItem[]): SiteNewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const kept: SiteNewsItem[] = [];
  for (const item of items) {
    const url = (item.url || "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
    const title = item.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (url && seenUrls.has(url)) continue;
    if (title && seenTitles.has(title)) continue;
    if (url) seenUrls.add(url);
    if (title) seenTitles.add(title);
    kept.push(item);
  }
  return kept;
}

// ---------------------------------------------------------------- payload

/**
 * Build the file the website downloads. Keys are short because this is fetched
 * on every homepage visit; the shape is flat so the page needs no parsing logic
 * beyond JSON.parse.
 */
/**
 * Oldest approval first. Deduping in this order means that when the same story
 * arrives from two outlets, the copy you approved first is the one that stays -
 * a deliberate choice rather than whatever the display sort happened to leave
 * on top.
 */
export function approvalOrder(items: readonly SiteNewsItem[]): SiteNewsItem[] {
  return [...items].sort(
    (left, right) => Date.parse(left.approvedAt) - Date.parse(right.approvedAt),
  );
}

/** Dedupe by approval order, then sort for display. Order matters here. */
export function resolveNewsItems(items: readonly SiteNewsItem[]): SiteNewsItem[] {
  return sortNewsItems(dedupeNewsItems(approvalOrder(items)));
}

export function buildFeedPayload(
  items: readonly SiteNewsItem[],
  options: { limit?: number; now?: Date } = {},
): NewsFeedPayload {
  const limit = options.limit ?? 8;
  const ordered = resolveNewsItems(items).slice(0, limit);
  return {
    generatedAt: (options.now || new Date()).toISOString(),
    items: ordered.map((item) => ({
      t: item.title,
      s: trimSummary(item.summary),
      url: item.url,
      src: item.source || hostLabel(item.url),
      cat: categoryLabel(item.category),
      date: item.publishedAt,
    })),
  };
}
