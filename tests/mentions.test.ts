import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  buildMentionQueries,
  buildMentionQueryPlans,
  canonicalizeMentionUrl,
  evaluateMention,
  isWithinMentionWindow,
  MENTION_COLLECTION_VERSION,
  mentionIdentity,
  normalizeSignal,
} from "../lib/mention-filter";
import { initializeContentStore, listContentItems, setContentArchived, upsertContentItems } from "../lib/archive-store";
import type { LiveStory } from "../lib/types";

function story(overrides: Partial<LiveStory> = {}): LiveStory {
  return {
    id: "candidate",
    title: "An update",
    summary: "",
    url: "https://publisher.example/update",
    source: "Publisher",
    publishedAt: "2026-08-24T12:00:00Z",
    ...overrides,
  };
}

test("builds a seven-day exact query plus optional user-configured context passes", () => {
  const options = {
    identitySignals: ["Alex Morgan", "@northstaralex", "northstar.example"],
    identityAnchors: ["robotics founder"],
    nicheContexts: ["automation", "robotics"],
  };
  const queries = buildMentionQueries("Alex Morgan", options);
  const plans = buildMentionQueryPlans("Alex Morgan", options);
  assert.equal(queries[0], '"Alex Morgan" when:7d');
  assert.ok(queries.some((query) => query.includes('"@northstaralex" OR "northstar.example"')));
  assert.ok(queries.some((query) => query.includes('"robotics founder" OR "automation" OR "robotics"')));
  assert.ok(queries.every((query) => query.endsWith("when:7d")));
  assert.deepEqual(plans[0].queryContexts, []);
  assert.deepEqual(
    plans.find(({ query }) => query.includes('"robotics founder" OR "automation" OR "robotics"'))?.queryContexts,
    ["robotics founder", "automation", "robotics"],
  );
  assert.equal(buildMentionQueries("@northstaralex")[0], '"@northstaralex" when:7d');
  assert.equal(buildMentionQueries("@northstar.alex")[0], '"@northstar.alex" when:7d');
});

test("keeps non-Latin configured identities matchable", () => {
  assert.equal(normalizeSignal("株式会社ミライ"), "株式会社ミライ");
  assert.equal(evaluateMention(
    story({ title: "株式会社ミライ launches a robotics lab" }),
    "株式会社ミライ",
    ["株式会社ミライ", "mirai.example"],
    [],
    false,
  ).accepted, true);
});

test("rejects an uncorroborated common namesake but accepts direct identity evidence", () => {
  const signals = ["Alex Morgan", "Northstar Robotics", "@northstaralex"];
  const namesake = evaluateMention(story({ title: "Alex Morgan joins a local sports club" }), "Alex Morgan", signals, [], true);
  assert.equal(namesake.accepted, false);
  assert.match(namesake.reasons.at(-1) || "", /lacked corroboration/i);

  const verified = evaluateMention(
    story({ title: "Alex Morgan explains a new model" }),
    "Alex Morgan",
    signals,
    [],
    true,
    { pageText: "Alex Morgan is the founder of Northstar Robotics." },
  );
  assert.equal(verified.accepted, true);
  assert.equal(verified.confidence, "high");
  assert.equal(verified.review, false);
});

test("does not infer unique identity from name length or erase configured handle syntax", () => {
  const ordinaryName = evaluateMention(
    story({ title: "Michael joins a neighborhood board" }),
    "Michael",
    ["Michael"],
    [],
    true,
  );
  assert.equal(ordinaryName.accepted, false);

  const handleWithoutAt = evaluateMention(
    story({ title: "Michael joins a neighborhood board" }),
    "@michael",
    ["@michael"],
    [],
    true,
  );
  assert.equal(handleWithoutAt.accepted, false);

  const ordinaryNameWithAtInArticle = evaluateMention(
    story({ title: "Interview with @michael" }),
    "Michael",
    ["Michael"],
    [],
    true,
  );
  assert.equal(ordinaryNameWithAtInArticle.accepted, false);

  const literalHandle = evaluateMention(
    story({ title: "Interview with @michael" }),
    "@michael",
    ["@michael"],
    [],
    true,
  );
  assert.equal(literalHandle.accepted, true);
  assert.equal(literalHandle.confidence, "high");

  const normalizedBareHandle = evaluateMention(
    story({ title: "Interview with @mreflow" }),
    "mreflow",
    ["mreflow"],
    [],
    true,
  );
  assert.equal(normalizedBareHandle.accepted, true);
  assert.equal(normalizedBareHandle.confidence, "high");

  assert.equal(evaluateMention(
    story({ title: "Interview with @michael.creator" }),
    "@michael.creator",
    ["@michael.creator"],
    [],
    true,
  ).confidence, "high");
});

test("rejects provider query hits when the result contains no literal identity evidence", () => {
  const result = evaluateMention(
    story({ title: "Robotics founders to follow this year", summary: "A search-feed headline and publisher only." }),
    "Alex Morgan",
    ["Alex Morgan", "@northstaralex"],
    [],
    true,
    { queryMatched: true, queryContexts: ["robotics"], nicheContexts: ["robotics"] },
  );
  assert.equal(result.accepted, false);
  assert.equal(result.confidence, "medium");
  assert.equal(result.review, false);
  assert.match(result.reasons.join(" "), /no literal identity evidence/i);
  assert.doesNotMatch(result.reasons.join(" "), /exact-query|query context/i);

  const uncorroborated = evaluateMention(
    story({ title: "Unrelated weekly roundup" }),
    "Alex Morgan",
    ["Alex Morgan"],
    [],
    true,
    { queryMatched: true },
  );
  assert.equal(uncorroborated.accepted, false);
});

test("rejects the reported Future Tools false positives without observed brand evidence", () => {
  const candidates = [
    story({ title: "The ROI of Enterprise Wearable App Development: What CTOs Should Measure", summary: "A mobile development guide." }),
    story({ title: "Lookism Filter Technology: How AI Is Changing Photo Editing", summary: "Future tools may make editing easier." }),
    story({ title: "Google's $10M Bet on Spirit Airlines Data Raises AI Privacy Fears", summary: "A story about shaping future tools." }),
  ];

  for (const candidate of candidates) {
    const result = evaluateMention(
      candidate,
      "Future Tools",
      ["Future Tools", "@futuretools", "futuretools.io"],
      [],
      true,
      { queryMatched: true, queryContexts: ["AI"], nicheContexts: ["AI"] },
    );
    assert.equal(result.accepted, false, candidate.title);
    assert.doesNotMatch(result.reasons.join(" "), /exact-query|query context/i);
  }
});

test("a literal ambiguous brand needs strong configured corroboration in strict mode", () => {
  const candidate = story({ title: "Future Tools publishes its annual roundup", summary: "The creator software directory and Futurepedia competitor reviewed new releases." });
  const withoutAnchor = evaluateMention(
    candidate,
    "Future Tools",
    ["Future Tools"],
    [],
    true,
    { queryMatched: true, nicheContexts: ["AI"] },
  );
  const withAnchor = evaluateMention(
    candidate,
    "Future Tools",
    ["Future Tools"],
    ["creator software directory", "Futurepedia competitor"],
    true,
    { queryMatched: true, nicheContexts: ["AI"] },
  );

  assert.equal(withoutAnchor.accepted, false);
  assert.equal(withAnchor.accepted, true);
  assert.match(withAnchor.reasons.join(" "), /Identity context: creator software directory/);
});

test("the evidence-version scope retires prior permissive mention results", () => {
  assert.equal(MENTION_COLLECTION_VERSION, "mentions-v5");
});

test("strict review evidence must be local to the identity and preserve configured brand casing", () => {
  const signals = ["Alex Morgan", "Northstar Tools"];
  const relevantPerson = evaluateMention(
    story({ title: "Creators worth following" }),
    "Alex Morgan",
    signals,
    [],
    true,
    { queryMatched: true, pageText: "Alex Morgan is an AI educator sharing practical automation guidance.", nicheContexts: ["AI"] },
  );
  assert.equal(relevantPerson.accepted, false);
  assert.equal(relevantPerson.confidence, "medium");

  const distantNamesake = evaluateMention(
    story({ title: "A transportation update" }),
    "Alex Morgan",
    signals,
    [],
    true,
    { queryMatched: true, pageText: `AI appears in an unrelated navigation menu. ${"filler ".repeat(300)}Alex Morgan reports on diesel engines.`, nicheContexts: ["AI"] },
  );
  assert.equal(distantNamesake.accepted, false);

  const genericPhrase = evaluateMention(
    story({ title: "A product forecast" }),
    "Northstar Tools",
    signals,
    [],
    true,
    {
      queryMatched: true,
      queryContexts: ["AI"],
      pageText: "Future northstar tools may make this workflow faster with AI.",
      nicheContexts: ["AI"],
    },
  );
  assert.equal(genericPhrase.accepted, false);
});

test("treats configured handles and canonical domains as strong direct identities", () => {
  const handle = evaluateMention(
    story({ title: "Interview with @northstaralex" }),
    "@northstaralex",
    ["@northstaralex"],
    [],
    true,
  );
  assert.equal(handle.accepted, true);
  assert.equal(handle.confidence, "high");

  const domain = evaluateMention(
    story({ title: "A new release", url: "https://northstar.example/releases/new" }),
    "northstar.example",
    ["northstar.example"],
    [],
    true,
    { canonicalUrl: "https://northstar.example/releases/new" },
  );
  assert.equal(domain.accepted, true);
  assert.equal(domain.confidence, "high");
});

test("unwraps changing Bing links and removes tracking before identity is stored", () => {
  const publisher = "https://www.publisher.example/story?id=4&utm_source=alerts";
  const first = `https://www.bing.com/news/apiclick.aspx?ref=FexRss&tid=first&url=${encodeURIComponent(publisher)}&c=1`;
  const second = `https://www.bing.com/news/apiclick.aspx?ref=FexRss&tid=second&url=${encodeURIComponent("https://www.publisher.example/story?utm_medium=rss&id=4#section")}&c=2`;
  assert.equal(canonicalizeMentionUrl(first), "https://www.publisher.example/story?id=4");
  assert.equal(canonicalizeMentionUrl(second), "https://www.publisher.example/story?id=4");

  const base = story({ title: "A specific reported story", source: "Publisher", publishedAt: "2026-08-24T10:00:00Z" });
  assert.equal(
    mentionIdentity({ ...base, url: first, canonicalUrl: canonicalizeMentionUrl(first), publisher: "Publisher" }),
    mentionIdentity({ ...base, id: "different-provider-id", url: second, canonicalUrl: canonicalizeMentionUrl(second), publisher: "Publisher" }),
  );

  assert.notEqual(
    mentionIdentity({ ...base, url: "https://publisher.example/first", canonicalUrl: "https://publisher.example/first" }),
    mentionIdentity({ ...base, id: "second-story", url: "https://publisher.example/second", canonicalUrl: "https://publisher.example/second" }),
  );

  assert.equal(
    mentionIdentity({ ...base, url: "https://www.publisher.example/story?utm_source=feed&id=4", canonicalUrl: "https://www.publisher.example/story?utm_source=feed&id=4" }),
    mentionIdentity({ ...base, id: "canonical-variant", title: "A corrected headline", url: "http://publisher.example/story?id=4#top", canonicalUrl: "http://publisher.example/story?id=4#top" }),
  );

  const googleWrapper = "https://news.google.com/rss/articles/provider-token?oc=5&utm_source=alerts";
  assert.equal(
    mentionIdentity({ ...base, url: googleWrapper }),
    mentionIdentity({ ...base, id: "same-wrapper", title: "A corrected headline", url: "https://news.google.com/rss/articles/provider-token?hl=en-US" }),
  );
  assert.notEqual(
    mentionIdentity({ ...base, url: googleWrapper }),
    mentionIdentity({ ...base, id: "other-wrapper", url: "https://news.google.com/rss/articles/other-token?oc=5" }),
  );
});

test("archiving one story does not suppress a distinct same-title publisher URL", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const first = story({ title: "Daily Briefing", url: "https://publisher.example/first" });
  first.id = mentionIdentity(first);
  const second = story({ id: "second", title: first.title, url: "https://publisher.example/second" });
  second.id = mentionIdentity(second);

  upsertContentItems(database, "mentions", [first]);
  setContentArchived(database, "mentions", first.id, true);
  upsertContentItems(database, "mentions", [second]);

  const saved = listContentItems<LiveStory>(database, "mentions");
  assert.deepEqual(saved.active.map(({ url }) => url), [second.url]);
  assert.deepEqual(saved.archived.map(({ url }) => url), [first.url]);
});

test("an unresolved Google News wrapper cannot resurface an archived publisher story", () => {
  const database = initializeContentStore(new DatabaseSync(":memory:"));
  const publisherStory = story({
    title: "A specific reported story",
    source: "Publisher",
    publishedAt: "2026-08-24T10:00:00Z",
    url: "https://publisher.example/reported-story",
  });
  publisherStory.id = mentionIdentity(publisherStory);
  upsertContentItems(database, "mentions", [publisherStory]);
  setContentArchived(database, "mentions", publisherStory.id, true);

  const unresolvedWrapper = story({
    id: "google-provider-id",
    title: "A specific reported story - Publisher",
    source: "Publisher",
    publishedAt: publisherStory.publishedAt,
    url: "https://news.google.com/rss/articles/provider-token?oc=5",
  });
  unresolvedWrapper.id = mentionIdentity(unresolvedWrapper);
  upsertContentItems(database, "mentions", [unresolvedWrapper]);

  const saved = listContentItems<LiveStory>(database, "mentions");
  assert.equal(saved.active.length, 0);
  assert.equal(saved.archived.length, 1);
  assert.equal(saved.archived[0].id, publisherStory.id);
  assert.equal(saved.archived[0].url, publisherStory.url);
  assert.equal(saved.archived[0].workflow?.archiveReason, "user");
});

test("uses inclusive seven-day and bounded future publication windows", () => {
  const now = "2026-08-24T12:00:00Z";
  assert.equal(isWithinMentionWindow("2026-08-17T12:00:00Z", { now }), true);
  assert.equal(isWithinMentionWindow("2026-08-17T11:59:59Z", { now }), false);
  assert.equal(isWithinMentionWindow("2026-08-25T12:00:00Z", { now }), true);
  assert.equal(isWithinMentionWindow("2026-08-25T12:00:01Z", { now }), false);
  assert.equal(isWithinMentionWindow("not-a-date", { now }), false);
});

test("configured negative context rejects an otherwise strong candidate", () => {
  const result = evaluateMention(
    story({ title: "Alex Morgan wins another golf tournament" }),
    "Alex Morgan",
    ["Alex Morgan", "@northstaralex"],
    [],
    true,
    { pageText: "Follow @northstaralex for details", negativeTerms: ["golf"] },
  );
  assert.equal(result.accepted, false);
  assert.match(result.reasons[0], /Excluded context: golf/);
});
