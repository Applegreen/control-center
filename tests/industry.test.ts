import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { combineIndustryDiscoveries, prioritizeIndustryItems } from "../lib/industry";
import {
  filterSitemapEntriesForSource,
  isUrlWithinSourcePath,
  newSitemapEntries,
  nextSitemapSnapshotUrls,
  observeUndatedFeedStories,
  parseFeed,
  parseSitemap,
  readBoundedResponseText,
  sitemapCoverageMessage,
  sourceContentPath,
  walkSitemap,
  walkSitemapRoots,
  writeFileAtomically,
  type SitemapFetcher,
} from "../lib/sitemap";

function urlset(entries: Array<{ loc: string; lastmod?: string }>) {
  return `<urlset>${entries.map((entry) => `<url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`).join("")}</urlset>`;
}

function sitemapIndex(urls: string[]) {
  return `<sitemapindex>${urls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("")}</sitemapindex>`;
}

test("watched-site updates remain additive when topic discovery is configured", () => {
  const watchedSite = {
    id: "site-update",
    title: "A new page whose title does not contain the configured topic",
    summary: "New page detected in the configured sitemap.",
    url: "https://example.com/releases/spring-catalog",
    source: "Example",
    publishedAt: "2026-08-24T15:00:00Z",
    kind: "sitemap" as const,
  };
  const topicNews = {
    id: "topic-update",
    title: "Circular packaging research",
    summary: "A topic-news result.",
    url: "https://news.example.org/circular-packaging",
    source: "News Example",
    publishedAt: "2026-08-24T16:00:00Z",
    kind: "topic" as const,
  };

  const combined = combineIndustryDiscoveries([watchedSite], [topicNews]);
  assert.deepEqual(combined.map((item) => item.id), ["topic-update", "site-update"]);
});

test("topic discovery cannot crowd watched-site updates out of the response limit", () => {
  const watched = Array.from({ length: 90 }, (_, index) => ({
    id: `watched-${index}`,
    title: `Watched ${index}`,
    summary: "",
    url: `https://watched.example/${index}`,
    source: "Watched",
    publishedAt: new Date(Date.UTC(2026, 7, 24, 10, index)).toISOString(),
    kind: "feed" as const,
  }));
  const topics = Array.from({ length: 150 }, (_, index) => ({
    id: `topic-${index}`,
    title: `Topic ${index}`,
    summary: "",
    url: `https://news.example/${index}`,
    source: "Topic",
    publishedAt: `2026-08-24T11:${String(index % 60).padStart(2, "0")}:00Z`,
    kind: "topic" as const,
  }));

  const selected = prioritizeIndustryItems([...topics, ...watched], 100);
  assert.equal(selected.length, 100);
  assert.deepEqual(selected.slice(0, 90).map((item) => item.id), watched.map((item) => item.id));
  assert.equal(selected.filter((item) => item.kind === "topic").length, 10);
});

test("RSS 1.0 RDF items and dc:date are parsed as feed stories", () => {
  const stories = parseFeed(`
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel><title>Independent Architecture</title></channel>
      <item rdf:about="https://example.com/journal/passive-house-retrofit">
        <title>Passive house retrofit lessons</title>
        <link>/journal/passive-house-retrofit</link>
        <description>Measured heating demand after one winter.</description>
        <dc:date>2026-08-24T15:30:00Z</dc:date>
      </item>
    </rdf:RDF>
  `, "Fallback", "https://example.com/feed.rdf");

  assert.equal(stories.length, 1);
  assert.equal(stories[0].source, "Independent Architecture");
  assert.equal(stories[0].url, "https://example.com/journal/passive-house-retrofit");
  assert.equal(stories[0].publishedAt, "2026-08-24T15:30:00Z");
  assert.equal(stories[0].kind, "feed");
  assert.match(stories[0].id, /^[a-f0-9]{20}$/);
});

test("feed stories are sorted before the safety cap is applied", () => {
  const items = Array.from({ length: 251 }, (_, index) => `<item><guid>story-${index}</guid><title>Story ${index}</title><link>https://example.com/story-${index}</link><pubDate>${new Date(Date.UTC(2026, 7, 1, 0, index)).toUTCString()}</pubDate></item>`).reverse().join("");
  const stories = parseFeed(`<rss><channel><title>Large feed</title>${items}</channel></rss>`, "Fallback");
  assert.equal(stories.length, 250);
  assert.equal(stories[0].title, "Story 250");
  assert.equal(stories.at(-1)?.title, "Story 1");
});

test("configured content paths scope sitemap URLs while feed endpoints remain unscoped", () => {
  assert.equal(sourceContentPath("https://example.com/journal"), "/journal");
  assert.equal(sourceContentPath("https://example.com/journal/feed.xml"), "");
  assert.equal(isUrlWithinSourcePath("https://www.example.com/journal/story", "https://example.com/journal"), true);
  assert.equal(isUrlWithinSourcePath("https://example.com/jobs/story", "https://example.com/journal"), false);

  const filtered = filterSitemapEntriesForSource([
    { loc: "https://example.com/journal/story", lastmod: "" },
    { loc: "https://example.com/jobs/opening", lastmod: "" },
  ], "https://example.com/journal");
  assert.deepEqual(filtered.map((entry) => entry.loc), ["https://example.com/journal/story"]);
});

test("recursive sitemap walking reads children beyond 30 and nested indexes", async () => {
  const root = "https://example.com/sitemap.xml";
  const childUrls = Array.from({ length: 35 }, (_, index) => `https://example.com/sitemaps/child-${index}.xml`);
  const documents = new Map<string, string>([[root, sitemapIndex(childUrls)]]);
  childUrls.forEach((url, index) => {
    documents.set(url, index === 34
      ? sitemapIndex(["https://example.com/sitemaps/nested.xml"])
      : urlset([{ loc: `https://example.com/journal/story-${index}` }]));
  });
  documents.set("https://example.com/sitemaps/nested.xml", urlset([{ loc: "https://example.com/journal/story-34" }]));
  const fetcher: SitemapFetcher = async (url) => {
    const text = documents.get(url);
    if (!text) throw new Error(`Missing fixture ${url}`);
    return { text, finalUrl: url };
  };

  const result = await walkSitemap(root, fetcher, { concurrency: 4, maxDocuments: 100 });
  assert.equal(result.entries.length, 35);
  assert.equal(result.documentsRead, 37);
  assert.equal(result.documentsFailed, 0);
  assert.equal(result.truncated, false);
  assert.ok(result.entries.some((entry) => entry.loc.endsWith("story-34")));
});

test("all robots-declared sitemap roots are merged before standard-location fallback", async () => {
  const posts = "https://example.com/post-sitemap.xml";
  const pages = "https://example.com/page-sitemap.xml";
  const documents = new Map([
    [posts, urlset([{ loc: "https://example.com/posts/one" }])],
    [pages, urlset([{ loc: "https://example.com/about" }])],
  ]);
  const result = await walkSitemapRoots([posts, pages], async (url) => {
    const text = documents.get(url);
    if (!text) throw new Error(`Unexpected fallback request: ${url}`);
    return { text, finalUrl: url };
  });

  assert.deepEqual(result.entries.map((entry) => entry.loc).sort(), [
    "https://example.com/about",
    "https://example.com/posts/one",
  ]);
  assert.equal(result.documentsRead, 2);
  assert.equal(result.documentsFailed, 0);
});

test("undated feeds establish a quiet baseline and only emit later observations", () => {
  const checkedAt = "2026-08-24T12:00:00Z";
  const dated = {
    id: "dated",
    title: "Dated update",
    summary: "",
    url: "https://example.com/dated",
    source: "Example",
    publishedAt: "2026-08-24T10:00:00Z",
    kind: "feed" as const,
  };
  const oldUndated = { ...dated, id: "old-undated", title: "Old undated", url: "https://example.com/old-undated", publishedAt: "" };
  const initial = observeUndatedFeedStories([dated, oldUndated], undefined, checkedAt);
  assert.deepEqual(initial.items.map((item) => item.id), [dated.id]);
  assert.equal(initial.baselineCount, 1);

  const newUndated = { ...oldUndated, id: "new-undated", title: "New undated", url: "https://example.com/new-undated" };
  const later = observeUndatedFeedStories([dated, oldUndated, newUndated], initial.nextSeenUrls, "2026-08-24T13:00:00Z");
  assert.deepEqual(later.items.map((item) => item.id), [dated.id, newUndated.id]);
  assert.equal(later.items[1].publishedAt, "2026-08-24T13:00:00Z");
  assert.equal(later.items[1].discoveredAt, "2026-08-24T13:00:00Z");
  assert.equal(later.newlyObservedCount, 1);
});

test("recursive sitemap walking preserves readable entries and reports partial coverage", async () => {
  const root = "https://example.com/sitemap.xml";
  const good = "https://example.com/sitemaps/good.xml";
  const unavailable = "https://example.com/sitemaps/unavailable.xml";
  const fetcher: SitemapFetcher = async (url) => {
    if (url === root) return { text: sitemapIndex([good, unavailable]), finalUrl: url };
    if (url === good) return { text: urlset([{ loc: "https://example.com/journal/current" }]), finalUrl: url };
    throw new Error("HTTP 503 Service Unavailable");
  };

  const result = await walkSitemap(root, fetcher);
  assert.deepEqual(result.entries, [{ loc: "https://example.com/journal/current", lastmod: "" }]);
  assert.equal(result.documentsRead, 2);
  assert.equal(result.documentsFailed, 1);
  assert.deepEqual(result.failures, [{ url: unavailable, message: "HTTP 503 Service Unavailable" }]);
  assert.match(sitemapCoverageMessage(result, 1, 1), /partial coverage: 2\/3 sitemap documents read, 1 failed \(HTTP 503 Service Unavailable\)/);
});

test("sitemap walking resolves relative child and content URLs against final URLs", async () => {
  const root = "https://example.com/sitemap.xml";
  const fetcher: SitemapFetcher = async (url) => {
    if (url === root) return { text: sitemapIndex(["parts/current.xml"]), finalUrl: "https://www.example.com/maps/root.xml" };
    assert.equal(url, "https://www.example.com/maps/parts/current.xml");
    return { text: urlset([{ loc: "../../journal/today", lastmod: "2026-08-24" }]), finalUrl: url };
  };
  const result = await walkSitemap(root, fetcher);
  assert.deepEqual(result.entries, [{ loc: "https://www.example.com/journal/today", lastmod: "2026-08-24" }]);
  assert.equal(result.rootFinalUrl, "https://www.example.com/maps/root.xml");
});

test("first sitemap baselines remain quiet", () => {
  const entries = [{ loc: "https://example.com/journal/current", lastmod: "2026-08-24" }];
  assert.deepEqual(newSitemapEntries(entries), []);
});

test("partial sitemap coverage preserves seen URLs and defers an incomplete first baseline", () => {
  const previouslySeen = {
    "https://example.com/journal/current": "2026-08-23",
    "https://example.com/journal/temporarily-unreadable": "2026-08-22",
  };
  const partialEntries = [
    { loc: "https://example.com/journal/current", lastmod: "2026-08-24" },
    { loc: "https://example.com/journal/new", lastmod: "2026-08-24" },
  ];

  assert.equal(nextSitemapSnapshotUrls(partialEntries, undefined, false), null);
  const partialSnapshot = nextSitemapSnapshotUrls(partialEntries, previouslySeen, false);
  assert.deepEqual(partialSnapshot, {
    ...previouslySeen,
    "https://example.com/journal/current": "2026-08-24",
    "https://example.com/journal/new": "2026-08-24",
  });
  assert.deepEqual(newSitemapEntries([
    ...partialEntries,
    { loc: "https://example.com/journal/temporarily-unreadable", lastmod: "2026-08-22" },
  ], partialSnapshot || undefined), []);
});

test("bounded response reading enforces streamed and declared limits", async () => {
  const withinLimit = new Response("12345");
  assert.equal(await readBoundedResponseText(withinLimit, 5), "12345");

  const streamed = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123"));
      controller.enqueue(new TextEncoder().encode("456"));
      controller.close();
    },
  }));
  await assert.rejects(readBoundedResponseText(streamed, 5), /larger than 5 bytes/);
  await assert.rejects(readBoundedResponseText(new Response("small", { headers: { "content-length": "6" } }), 5), /larger than 5 bytes/);
});

test("ordinary gzip sitemap files are decoded with a decompressed size bound", async () => {
  const xml = urlset([{ loc: "https://example.com/journal/new", lastmod: "2026-08-24" }]);
  const decoded = await readBoundedResponseText(new Response(gzipSync(xml), {
    headers: { "content-type": "application/gzip" },
  }), Buffer.byteLength(xml));
  assert.deepEqual(parseSitemap(decoded), {
    kind: "urls",
    entries: [{ loc: "https://example.com/journal/new", lastmod: "2026-08-24" }],
  });

  const compressedBomb = gzipSync("x".repeat(1_000));
  assert.ok(compressedBomb.byteLength < 100);
  await assert.rejects(
    readBoundedResponseText(new Response(compressedBomb), 100),
    /larger than 100 bytes after decompression/,
  );
});

test("parallel atomic writes never collide or leave a partial snapshot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "control-center-industry-"));
  const target = path.join(directory, "industry-snapshots.json");
  const payloads = Array.from({ length: 20 }, (_, index) => `${JSON.stringify({ writer: index, urls: Array.from({ length: 100 }, (__, item) => `${index}-${item}`) })}\n`);
  try {
    await Promise.all(payloads.map((payload) => writeFileAtomically(target, payload)));
    const final = await readFile(target, "utf8");
    assert.ok(payloads.includes(final));
    assert.doesNotThrow(() => JSON.parse(final));
    assert.deepEqual((await readdir(directory)).sort(), ["industry-snapshots.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
