import type { DatabaseSync } from "node:sqlite";
import { mergeNewsletterTopics, normalizeNewsletterTitle, type NewsletterMentionRecord } from "./newsletter-intelligence";
import type { NewsletterTopic } from "./types";

export type NewsletterIssueRecord = {
  messageId: string;
  mailbox: string;
  sender: string;
  subject: string;
  receivedAt: string;
  gmailUrl: string;
  bodyHash: string;
  processedAt: string;
  processorVersion: number;
  processorScope?: string;
};

export function initializeNewsletterStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_issues (
      message_id TEXT NOT NULL,
      mailbox TEXT NOT NULL,
      sender TEXT NOT NULL,
      subject TEXT NOT NULL,
      received_at TEXT NOT NULL,
      gmail_url TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      processor_version INTEGER NOT NULL DEFAULT 1,
      processor_scope TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (mailbox, message_id)
    );
    CREATE INDEX IF NOT EXISTS newsletter_issues_mailbox_received_idx
      ON newsletter_issues (mailbox, received_at DESC);
    CREATE TABLE IF NOT EXISTS newsletter_mentions (
      mention_id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      mailbox TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      context TEXT NOT NULL,
      publisher TEXT NOT NULL,
      newsletter_sender TEXT NOT NULL,
      newsletter_subject TEXT NOT NULL,
      received_at TEXT NOT NULL,
      gmail_url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      FOREIGN KEY (mailbox, issue_id) REFERENCES newsletter_issues(mailbox, message_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS newsletter_mentions_mailbox_received_idx
      ON newsletter_mentions (mailbox, received_at DESC);
    CREATE INDEX IF NOT EXISTS newsletter_mentions_canonical_idx
      ON newsletter_mentions (mailbox, canonical_url);
    CREATE TABLE IF NOT EXISTS newsletter_topic_keys (
      mailbox TEXT NOT NULL,
      story_key TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (mailbox, story_key)
    );
  `);
  const issueColumns = database.prepare("PRAGMA table_info(newsletter_issues)")
    .all() as unknown as Array<{ name: string }>;
  if (!issueColumns.some((column) => column.name === "processor_version"))
    database.exec("ALTER TABLE newsletter_issues ADD COLUMN processor_version INTEGER NOT NULL DEFAULT 1;");
  if (!issueColumns.some((column) => column.name === "processor_scope"))
    database.exec("ALTER TABLE newsletter_issues ADD COLUMN processor_scope TEXT NOT NULL DEFAULT '';");
  return database;
}

export function knownNewsletterIssueIds(
  database: DatabaseSync,
  mailbox: string,
  messageIds: string[],
  processorVersion = 1,
  processorScope = "",
) {
  if (!messageIds.length) return new Set<string>();
  const known = new Set<string>();
  for (let index = 0; index < messageIds.length; index += 200) {
    const batch = messageIds.slice(index, index + 200);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = database.prepare(`
      SELECT message_id
      FROM newsletter_issues
      WHERE mailbox = ? AND processor_version >= ?
        AND (? = '' OR processor_scope = ?) AND message_id IN (${placeholders})
    `).all(mailbox, processorVersion, processorScope, processorScope, ...batch) as unknown as Array<{ message_id: string }>;
    rows.forEach((row) => known.add(row.message_id));
  }
  return known;
}

export function saveNewsletterIssue(
  database: DatabaseSync,
  issue: NewsletterIssueRecord,
  mentions: NewsletterMentionRecord[],
) {
  const issueStatement = database.prepare(`
    INSERT INTO newsletter_issues (
      message_id, mailbox, sender, subject, received_at, gmail_url, body_hash,
      processed_at, processor_version, processor_scope
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (mailbox, message_id) DO UPDATE SET
      sender = excluded.sender,
      subject = excluded.subject,
      received_at = excluded.received_at,
      gmail_url = excluded.gmail_url,
      body_hash = excluded.body_hash,
      processed_at = excluded.processed_at,
      processor_version = excluded.processor_version,
      processor_scope = excluded.processor_scope
  `);
  const mentionStatement = database.prepare(`
    INSERT INTO newsletter_mentions (
      mention_id, issue_id, mailbox, canonical_url, url, title, context,
      publisher, newsletter_sender, newsletter_subject, received_at,
      gmail_url, first_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (mention_id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      url = excluded.url,
      title = excluded.title,
      context = excluded.context,
      publisher = excluded.publisher,
      newsletter_sender = excluded.newsletter_sender,
      newsletter_subject = excluded.newsletter_subject,
      received_at = excluded.received_at,
      gmail_url = excluded.gmail_url
  `);
  database.exec("BEGIN IMMEDIATE");
  try {
    issueStatement.run(
      issue.messageId,
      issue.mailbox,
      issue.sender,
      issue.subject,
      issue.receivedAt,
      issue.gmailUrl,
      issue.bodyHash,
      issue.processedAt,
      issue.processorVersion,
      issue.processorScope || "",
    );
    database.prepare("DELETE FROM newsletter_mentions WHERE mailbox = ? AND issue_id = ?")
      .run(issue.mailbox, issue.messageId);
    for (const mention of mentions) {
      mentionStatement.run(
        mention.id,
        mention.issueId,
        issue.mailbox,
        mention.canonicalUrl,
        mention.url,
        mention.title,
        mention.context,
        mention.publisher,
        mention.newsletterSender,
        mention.newsletterSubject,
        mention.receivedAt,
        mention.gmailUrl,
        mention.firstSeenAt,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listNewsletterMentions(
  database: DatabaseSync,
  options: { mailbox: string; since: string; limit?: number; processorVersion?: number; processorScope?: string },
) {
  const rows = database.prepare(`
    SELECT mention.mention_id, mention.issue_id, mention.canonical_url,
      mention.url, mention.title, mention.context, mention.publisher,
      mention.newsletter_sender, mention.newsletter_subject, mention.received_at,
      mention.gmail_url, mention.first_seen_at
    FROM newsletter_mentions mention
    JOIN newsletter_issues issue
      ON issue.mailbox = mention.mailbox AND issue.message_id = mention.issue_id
    WHERE mention.mailbox = ? AND mention.received_at >= ?
      AND issue.processor_version >= ?
      AND (? = '' OR issue.processor_scope = ?)
    ORDER BY mention.received_at DESC
    LIMIT ?
  `).all(
    options.mailbox,
    options.since,
    options.processorVersion || 1,
    options.processorScope || "",
    options.processorScope || "",
    Math.max(1, Math.min(20_000, options.limit || 10_000)),
  ) as unknown as Array<{
    mention_id: string;
    issue_id: string;
    canonical_url: string;
    url: string;
    title: string;
    context: string;
    publisher: string;
    newsletter_sender: string;
    newsletter_subject: string;
    received_at: string;
    gmail_url: string;
    first_seen_at: string;
  }>;
  return rows.map((row): NewsletterMentionRecord => ({
    id: row.mention_id,
    issueId: row.issue_id,
    canonicalUrl: row.canonical_url,
    url: row.url,
    title: row.title,
    context: row.context,
    publisher: row.publisher,
    newsletterSender: row.newsletter_sender,
    newsletterSubject: row.newsletter_subject,
    receivedAt: row.received_at,
    gmailUrl: row.gmail_url,
    firstSeenAt: row.first_seen_at,
  }));
}

export function newsletterStoreStats(
  database: DatabaseSync,
  options: { mailbox: string; since: string; processorVersion?: number; processorScope?: string },
) {
  const row = database.prepare(`
    SELECT
      COUNT(DISTINCT issue.message_id) AS issue_count,
      COUNT(DISTINCT issue.sender) AS newsletter_count,
      COUNT(mention.mention_id) AS mention_count
    FROM newsletter_issues issue
    LEFT JOIN newsletter_mentions mention
      ON mention.mailbox = issue.mailbox AND mention.issue_id = issue.message_id
    WHERE issue.mailbox = ? AND issue.received_at >= ?
      AND issue.processor_version >= ?
      AND (? = '' OR issue.processor_scope = ?)
  `).get(options.mailbox, options.since, options.processorVersion || 1,
    options.processorScope || "", options.processorScope || "") as unknown as {
    issue_count: number;
    newsletter_count: number;
    mention_count: number;
  };
  return {
    issueCount: Number(row.issue_count || 0),
    newsletterCount: Number(row.newsletter_count || 0),
    mentionCount: Number(row.mention_count || 0),
  };
}

export function pruneNewsletterEvidence(
  database: DatabaseSync,
  options: { before: string },
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM newsletter_mentions WHERE received_at < ?")
      .run(options.before);
    database.prepare("DELETE FROM newsletter_issues WHERE received_at < ?")
      .run(options.before);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function assignNewsletterTopicIdentities(
  database: DatabaseSync,
  mailbox: string,
  topics: NewsletterTopic[],
  now = new Date().toISOString(),
  preserveSavedCopy = true,
) {
  const lookup = database.prepare(`
    SELECT topic_id, first_seen_at FROM newsletter_topic_keys
    WHERE mailbox = ? AND story_key = ?
  `);
  const save = database.prepare(`
    INSERT INTO newsletter_topic_keys (mailbox, story_key, topic_id, first_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (mailbox, story_key) DO UPDATE SET topic_id = excluded.topic_id
  `);
  const hasContentStore = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_items'",
  ).get());
  const archived = hasContentStore ? database.prepare(`
    SELECT 1 FROM content_items
    WHERE category = 'newsletters' AND external_id = ? AND archived_at IS NOT NULL
  `) : null;
  const identified = topics.map((topic) => {
    const keys = [...new Set(topic.sourceLinks.flatMap((link) => [
      `url:${link.url}`,
      `title:${normalizeNewsletterTitle(link.title)}`,
    ]))];
    const matches = keys.flatMap((key) => {
      const match = lookup.get(mailbox, key) as unknown as
        { topic_id: string; first_seen_at: string } | undefined;
      return match ? [match] : [];
    }).sort((left, right) =>
      Number(Boolean(archived?.get(right.topic_id))) - Number(Boolean(archived?.get(left.topic_id))) ||
      left.first_seen_at.localeCompare(right.first_seen_at) || left.topic_id.localeCompare(right.topic_id));
    const id = matches[0]?.topic_id || topic.id;
    for (const priorId of new Set(matches.map((match) => match.topic_id))) {
      if (priorId !== id) database.prepare(
        "UPDATE newsletter_topic_keys SET topic_id = ? WHERE mailbox = ? AND topic_id = ?",
      ).run(id, mailbox, priorId);
    }
    for (const key of keys) save.run(mailbox, key, id, now);
    return { ...topic, id };
  });
  // Later groups can merge identities seen earlier in this same pass.
  const groups = new Map<string, NewsletterTopic[]>();
  for (const topic of identified) {
    const key = `url:${topic.sourceLinks[0]?.url || topic.url}`;
    const latest = lookup.get(mailbox, key) as unknown as { topic_id: string } | undefined;
    const id = latest?.topic_id || topic.id;
    groups.set(id, [...(groups.get(id) || []), { ...topic, id }]);
  }
  return [...groups.values()].map((group) => {
    const topic = mergeNewsletterTopics(group);
    if (!preserveSavedCopy || !hasContentStore) return topic;
    const saved = database.prepare(
      "SELECT payload_json FROM content_items WHERE category = 'newsletters' AND external_id = ?",
    ).get(topic.id) as unknown as { payload_json: string } | undefined;
    if (!saved) return topic;
    try {
      const copy = JSON.parse(saved.payload_json) as Partial<NewsletterTopic>;
      return {
        ...topic,
        title: typeof copy.title === "string" ? copy.title : topic.title,
        summary: typeof copy.summary === "string" ? copy.summary : topic.summary,
      };
    } catch { return topic; }
  })
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
}
