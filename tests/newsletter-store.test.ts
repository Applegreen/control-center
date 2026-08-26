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
