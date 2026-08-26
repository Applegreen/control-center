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
