import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  initializeNewsletterStore,
  assignNewsletterTopicIdentities,
  knownNewsletterIssueIds,
  listNewsletterMentions,
  newsletterStoreStats,
  pruneNewsletterEvidence,
  saveNewsletterIssue,
} from "../lib/newsletter-store";
import { initializeContentStore, setContentArchived, upsertContentItems } from "../lib/archive-store";
import type { NewsletterTopic } from "../lib/types";

test("newsletter evidence is normalized per mailbox and can be pruned", () => {
  const database = initializeNewsletterStore(new DatabaseSync(":memory:"));
  saveNewsletterIssue(database, {
    messageId: "message-one",
    mailbox: "reader@example.com",
    sender: "Daily Brief",
    subject: "Today",
    receivedAt: "2026-08-25T16:00:00.000Z",
    gmailUrl: "https://mail.google.com/mail/u/reader@example.com/#all/message-one",
    bodyHash: "hash",
    processedAt: "2026-08-25T17:00:00.000Z",
    processorVersion: 2,
  }, [{
    id: "mention-one",
    issueId: "message-one",
    canonicalUrl: "https://example.com/story",
    url: "https://example.com/story?utm_source=email",
    title: "Acme launches its new research model",
    context: "Acme launched a new model.",
    publisher: "example.com",
    newsletterSender: "Daily Brief",
    newsletterSubject: "Today",
    receivedAt: "2026-08-25T16:00:00.000Z",
    gmailUrl: "https://mail.google.com/mail/u/reader@example.com/#all/message-one",
    firstSeenAt: "2026-08-25T17:00:00.000Z",
    importanceScore: 87,
    importanceReason: "A substantial research release.",
    curationMode: "gemini",
  }]);

  assert.deepEqual(
    [...knownNewsletterIssueIds(database, "reader@example.com", ["message-one", "missing"], 2)],
    ["message-one"],
  );
  assert.equal(
    knownNewsletterIssueIds(database, "different@example.com", ["message-one"], 2).size,
    0,
  );
  assert.equal(knownNewsletterIssueIds(database, "reader@example.com", ["message-one"], 3).size, 0);
  assert.equal(listNewsletterMentions(database, {
    mailbox: "reader@example.com",
    since: "2026-08-01T00:00:00.000Z",
  }).length, 1);
  const stored = listNewsletterMentions(database, {
    mailbox: "reader@example.com", since: "2026-08-01T00:00:00.000Z",
  })[0];
  assert.equal(stored.importanceScore, 87);
  assert.equal(stored.importanceReason, "A substantial research release.");
  assert.equal(stored.curationMode, "gemini");
  assert.deepEqual(newsletterStoreStats(database, {
    mailbox: "reader@example.com",
    since: "2026-08-01T00:00:00.000Z",
  }), { issueCount: 1, newsletterCount: 1, mentionCount: 1 });

  pruneNewsletterEvidence(database, { before: "2026-08-26T00:00:00.000Z" });
  assert.equal(listNewsletterMentions(database, {
    mailbox: "reader@example.com",
    since: "2026-08-01T00:00:00.000Z",
  }).length, 0);
});

test("newsletter priority column migration preserves old evidence and is idempotent", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE newsletter_mentions (
    mention_id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, mailbox TEXT NOT NULL,
    canonical_url TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, context TEXT NOT NULL,
    publisher TEXT NOT NULL, newsletter_sender TEXT NOT NULL, newsletter_subject TEXT NOT NULL,
    received_at TEXT NOT NULL, gmail_url TEXT NOT NULL, first_seen_at TEXT NOT NULL
  ); INSERT INTO newsletter_mentions VALUES ('legacy', 'one', 'mailbox', 'https://example.com',
    'https://example.com', 'A previous story', 'Previously saved summary', 'example.com', 'Daily Brief',
    'Today', '2026-08-25T12:00:00Z', 'https://mail.google.com/#all/one', '2026-08-25T13:00:00Z');`);
  initializeNewsletterStore(database);
  initializeNewsletterStore(database);
  const row = database.prepare("SELECT title, importance_score, importance_reason, curation_mode FROM newsletter_mentions WHERE mention_id = 'legacy'").get();
  assert.equal(row?.title, "A previous story");
  assert.equal(row?.importance_score, null);
  assert.equal(row?.importance_reason, null);
  assert.equal(row?.curation_mode, null);
});

test("saved AI priority and merged copy survive rebuilding without another Gmail read", () => {
  const database = initializeNewsletterStore(initializeContentStore(new DatabaseSync(":memory:")));
  const topic: NewsletterTopic = {
    id: "original-topic", kind: "newsletter-topic", title: "Acme launches new research model",
    summary: "Acme announced a new model for researchers.", receivedAt: "2026-08-25T16:00:00Z",
    url: "https://first.example/story", gmailUrl: "https://mail.google.com/#all/one",
    coverageCount: 1, newsletterCount: 1, newsletterSources: ["First Brief"],
    evidenceIssueIds: ["one"], collectionScope: "scope",
    sourceLinks: [{ url: "https://first.example/story", title: "Acme launches new research model", publisher: "first.example" }],
    importanceBaseScore: 72, importanceScore: 72, importanceReason: "A saved AI priority reason.", curationMode: "openai",
  };
  const initial = assignNewsletterTopicIdentities(database, "mailbox", [topic]);
  upsertContentItems(database, "newsletters", initial);
  const rebuilt = assignNewsletterTopicIdentities(database, "mailbox", [{
    ...topic, importanceBaseScore: undefined, importanceScore: undefined, importanceReason: undefined,
    newsletterSources: ["First Brief", "Second Brief"], newsletterCount: 2,
  }]);
  assert.equal(rebuilt[0].importanceBaseScore, 72);
  assert.equal(rebuilt[0].importanceScore, 78);
  assert.equal(rebuilt[0].importanceReason, "A saved AI priority reason.");
  const changedScope = assignNewsletterTopicIdentities(database, "mailbox", [{
    ...topic, collectionScope: "different-niche", importanceBaseScore: 65, importanceScore: 65,
  }]);
  assert.equal(changedScope[0].importanceBaseScore, 65);
});

test("persistent newsletter aliases preserve identity and archived state across later coverage", () => {
  const database = initializeNewsletterStore(initializeContentStore(new DatabaseSync(":memory:")));
  const topic: NewsletterTopic = {
    id: "original-topic", kind: "newsletter-topic", title: "Acme launches new research model",
    summary: "Acme announced a new model for researchers.", receivedAt: "2026-08-25T16:00:00Z",
    url: "https://first.example/story", gmailUrl: "https://mail.google.com/#all/one",
    coverageCount: 1, newsletterCount: 1, newsletterSources: ["First Brief"],
    evidenceIssueIds: ["one"], collectionScope: "scope",
    sourceLinks: [{ url: "https://first.example/story", title: "Acme launches new research model", publisher: "first.example" }],
  };
  const initial = assignNewsletterTopicIdentities(database, "mailbox", [topic], "2026-08-25T17:00:00Z");
  upsertContentItems(database, "newsletters", initial);
  setContentArchived(database, "newsletters", initial[0].id, true);
  const later = assignNewsletterTopicIdentities(database, "mailbox", [{
    ...topic, id: "newly-computed-id", url: "https://second.example/same-event",
    sourceLinks: [{ url: "https://second.example/same-event", title: topic.title, publisher: "second.example" }],
  }], "2026-08-26T17:00:00Z");
  assert.equal(later[0].id, "original-topic");
});
