import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewsletterTopics,
  gmailMessageText,
  prepareNewsletterForAi,
  validateNewsletterAiStories,
  isNewsletterHousekeepingSubject,
  canonicalizeNewsletterUrl,
  likelyNewsletterRedirect,
  applyNewsletterAiGroups,
  applyNewsletterAiPriorities,
  mergeNewsletterTopics,
  type NewsletterMentionRecord,
} from "../lib/newsletter-intelligence";

function gmailData(value: string) {
  return Buffer.from(value).toString("base64url");
}

function mention(
  overrides: Partial<NewsletterMentionRecord>,
): NewsletterMentionRecord {
  return {
    id: "mention-one",
    issueId: "issue-one",
    canonicalUrl: "https://example.com/news/story",
    url: "https://example.com/news/story?utm_source=letter",
    title: "Acme launches a major new research model",
    context: "Acme launched a major new research model this morning.",
    publisher: "example.com",
    newsletterSender: "Daily Brief",
    newsletterSubject: "Today's news",
    receivedAt: "2026-08-25T16:00:00.000Z",
    gmailUrl: "https://mail.google.com/mail/u/test@example.com/#all/issue-one",
    firstSeenAt: "2026-08-25T17:00:00.000Z",
    ...overrides,
  };
}

test("Gmail multipart bodies are decoded before AI evidence is prepared", () => {
  const html = '<h1>Today</h1><a href="https://example.com/story?utm_source=email">Acme launches its new research model</a>';
  const body = gmailMessageText({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: gmailData("Plain newsletter") } },
      { mimeType: "text/html", body: { data: gmailData(html) } },
    ],
  });
  assert.equal(body.text, "Plain newsletter");
  assert.equal(body.html, html);
  assert.deepEqual(prepareNewsletterForAi(body).links.map(({ url, title }) => ({ url, title })), [
    {
      url: "https://example.com/story?utm_source=email",
      title: "Acme launches its new research model",
    },
  ]);
});

test("the same story from multiple newsletters becomes one cross-reported topic", () => {
  const topics = buildNewsletterTopics([
    mention({}),
    mention({
      id: "mention-two",
      issueId: "issue-two",
      canonicalUrl: "https://example.com/news/story",
      title: "Acme launches a major new research model today",
      newsletterSender: "Research Roundup",
      receivedAt: "2026-08-25T18:00:00.000Z",
      firstSeenAt: "2026-08-25T18:05:00.000Z",
    }),
  ], "scope-one");
  assert.equal(topics.length, 1);
  assert.equal(topics[0].coverageCount, 2);
  assert.equal(topics[0].newsletterCount, 2);
  assert.deepEqual(topics[0].newsletterSources, ["Daily Brief", "Research Roundup"]);
  assert.equal(topics[0].sourceLinks.length, 1);
});

test("near-identical headlines cluster while unrelated stories remain separate", () => {
  const topics = buildNewsletterTopics([
    mention({}),
    mention({
      id: "mention-two",
      issueId: "issue-two",
      canonicalUrl: "https://another.example/acme-model",
      title: "Acme launches major new model for research",
      newsletterSender: "Another Brief",
    }),
    mention({
      id: "mention-three",
      issueId: "issue-three",
      canonicalUrl: "https://markets.example/quarterly-results",
      title: "Globex reports quarterly revenue and profit growth",
      newsletterSender: "Markets Daily",
    }),
  ], "scope-one");
  assert.equal(topics.length, 2);
  assert.ok(topics.some((topic) => topic.coverageCount === 2));
  assert.ok(topics.some((topic) => topic.title.includes("Globex")));
});

test("a topic keeps its stable ID when a later report is added", () => {
  const initial = mention({});
  const initialId = buildNewsletterTopics([initial], "scope-one")[0].id;
  const laterId = buildNewsletterTopics([
    initial,
    mention({
      id: "mention-two",
      issueId: "issue-two",
      newsletterSender: "Later Brief",
      receivedAt: "2026-08-26T16:00:00.000Z",
      firstSeenAt: "2026-08-26T17:00:00.000Z",
    }),
  ], "scope-one")[0].id;
  assert.equal(laterId, initialId);
});

test("AI newsletter evidence masks subscriber URLs and email addresses", () => {
  const prepared = prepareNewsletterForAi({
    html: '<p>Hello reader@example.com</p><a href="https://click.example/news?id=secret-subscriber">Acme launches new research model</a>',
  });
  assert.match(prepared.bodyText, /\[L1\]/);
  assert.doesNotMatch(prepared.bodyText, /secret-subscriber|reader@example.com|https:\/\//);
  assert.equal(prepared.links[0].url, "https://click.example/news?id=secret-subscriber");
  const visibleUrl = prepareNewsletterForAi({
    html: '<a href="https://click.example/secret">https://click.example/secret?email=reader@example.com</a>',
  });
  assert.doesNotMatch(JSON.stringify(visibleUrl.links.map(({ id, title }) => ({ id, title }))), /click.example|reader@example.com/);
});

test("AI extraction accepts only observed links and substantive non-sponsored stories", () => {
  const links = [{ id: "L1", url: "https://example.com/news", title: "Observed article" }];
  const stories = validateNewsletterAiStories({ stories: [
    { title: "Acme launches a research model", summary: "Acme launched a new model for research teams.", linkIds: ["L1", "invented"], score: 90, sponsored: false },
    { title: "A sponsored product promotion", summary: "This is a paid promotion for a product.", linkIds: ["L1"], score: 90, sponsored: true },
    { title: "A low-signal newsletter item", summary: "This is not substantive industry news.", linkIds: ["L1"], score: 20, sponsored: false },
    { title: "An invented external source", summary: "This story points to a source not in the email.", linkIds: ["https://invented.example"], score: 90, sponsored: false },
  ] }, links);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].url, links[0].url);
  assert.equal(stories[0].importanceScore, 90);
  assert.throws(() => validateNewsletterAiStories({}, links), /stories list/);
});

test("account alerts and signup messages never enter newsletter news extraction", () => {
  for (const subject of ["Security alert", "Verify your email", "Your verification code", "Welcome to Daily Brief"])
    assert.equal(isNewsletterHousekeepingSubject(subject), true);
  assert.equal(isNewsletterHousekeepingSubject("Google expands enterprise security platform"), false);
});

test("newsletter tracking identifiers do not split canonical sources", () => {
  assert.equal(canonicalizeNewsletterUrl("https://academy.example/?_bhlid=subscriber&utm_source=letter"), "https://academy.example/");
  assert.equal(likelyNewsletterRedirect("https://elink983.newsletter.example/ss/c/token"), true);
  assert.equal(likelyNewsletterRedirect("https://writer.substack.com/p/editorial-story"), false);
});

test("newsletter extraction priority survives topic clustering and repeated merges", () => {
  const topics = buildNewsletterTopics([
    mention({ importanceScore: 74, importanceReason: "A material research release for the configured industry.", curationMode: "ollama" }),
    mention({ id: "mention-two", issueId: "issue-two", newsletterSender: "Second Brief", importanceScore: 78, importanceReason: "A consequential release for researchers.", curationMode: "ollama" }),
  ], "scope-one");
  assert.equal(topics[0].importanceBaseScore, 78);
  assert.equal(topics[0].importanceScore, 84);
  assert.equal(topics[0].curationMode, "ollama");
  assert.equal(mergeNewsletterTopics([topics[0], topics[0]]).importanceScore, 84);
  assert.equal(mergeNewsletterTopics([mergeNewsletterTopics([topics[0]])]).importanceScore, 84);
});

test("AI newsletter group validation rejects unknown IDs and cross-scope grouping", () => {
  const first = buildNewsletterTopics([mention({})], "scope-one")[0];
  const second = { ...first, id: "second", url: "https://other.example/story", collectionScope: "scope-two" };
  const group = { ids: [first.id, second.id], title: "Acme releases its new research model", summary: "Acme announced the model for research teams to use.", score: 83, reason: "A significant release for research teams." };
  assert.equal(applyNewsletterAiGroups({ groups: [group] }, [first, second], "openai").length, 2);
  assert.equal(applyNewsletterAiGroups({ groups: [{ ...group, ids: [first.id, second.id, "invented"] }] }, [first, { ...second, collectionScope: "scope-one" }], "openai").length, 2);
  assert.throws(() => applyNewsletterAiGroups({}, [first, second], "openai"), /groups list/);
});

test("AI group metadata and archived topic identity survive deduplication", () => {
  const first = buildNewsletterTopics([mention({})], "scope-one")[0];
  const archived = { ...first, id: "archived-topic", newsletterSources: ["Second Brief"], workflow: { archiveReason: "user" as const, archivedAt: "2026-08-25T18:00:00Z", restoreEligible: true } };
  const result = applyNewsletterAiGroups({ groups: [{
    ids: [first.id, archived.id], title: "Acme releases its new research model",
    summary: "Acme announced the model for research teams to use.", score: 83, reason: "A significant release for research teams.",
  }] }, [first, archived], "xai");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, archived.id);
  assert.equal(result[0].workflow?.archiveReason, "user");
  assert.equal(result[0].importanceBaseScore, 83);
  assert.equal(result[0].importanceScore, 89);
  assert.equal(result[0].curationMode, "xai");
  assert.deepEqual(result[0].sourceLinks, first.sourceLinks);
});

test("saved newsletter AI ranking preserves source URLs, scope, dates, and archive state", () => {
  const source = buildNewsletterTopics([mention({})], "scope-one")[0];
  const result = applyNewsletterAiPriorities({ priorities: [
    { id: "invented", score: 100, reason: "A fabricated extra topic." },
    { id: source.id, score: 88, reason: "A meaningful development supported by the saved story.", title: "Model must not replace headline", url: "https://invented.example" },
    { id: source.id, score: 100, reason: "Duplicate ID cannot override the first valid response." },
  ] }, [source], "lmstudio");
  assert.equal(result.length, 1);
  assert.equal(result[0].importanceScore, 88);
  assert.equal(result[0].title, source.title);
  assert.equal(result[0].url, source.url);
  assert.equal(result[0].collectionScope, source.collectionScope);
  assert.equal(result[0].receivedAt, source.receivedAt);
  assert.equal(result[0].curationMode, "lmstudio");
});
