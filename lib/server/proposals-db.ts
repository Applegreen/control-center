import "server-only";

import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "@/lib/server/settings";
import {
  DEFAULT_SECTIONS,
  DEFAULT_TERMS,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  lineTotal,
  proposalTotals,
  type Proposal,
  type ProposalItem,
  type ProposalKind,
  type ProposalSection,
  type ProposalStatus,
  type ProposalSummary,
  type RateCardEntry,
} from "@/lib/proposals";

// Proposals live in their own SQLite file rather than in control-center.sqlite.
// Control Center runs versioned migrations keyed to PRAGMA user_version and takes
// backups when the version moves; keeping these tables out of that file means an
// upstream migration can never touch them, and pulling upstream stays painless.

declare global {
  var controlCenterProposalsDatabase: DatabaseSync | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS proposals (
  id             TEXT PRIMARY KEY,
  token          TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL DEFAULT 'proposal',
  number         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft',
  client_name    TEXT NOT NULL DEFAULT '',
  client_contact TEXT NOT NULL DEFAULT '',
  client_email   TEXT NOT NULL DEFAULT '',
  project_title  TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  currency       TEXT NOT NULL DEFAULT 'ZAR',
  vat_rate       REAL NOT NULL DEFAULT 15,
  discount_rate  REAL NOT NULL DEFAULT 0,
  valid_until    TEXT NOT NULL DEFAULT '',
  terms          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  sent_at        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS proposal_items (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  quantity    REAL NOT NULL DEFAULT 1,
  unit        TEXT NOT NULL DEFAULT 'item',
  unit_rate   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposal_sections (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  heading     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS rate_card (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  unit         TEXT NOT NULL DEFAULT 'item',
  default_rate INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS proposal_items_parent ON proposal_items (proposal_id, position);
CREATE INDEX IF NOT EXISTS proposal_sections_parent ON proposal_sections (proposal_id, position);
CREATE INDEX IF NOT EXISTS proposals_created ON proposals (created_at DESC);
`;

export function getProposalsDatabase() {
  if (!globalThis.controlCenterProposalsDatabase) {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(path.join(directory, "proposals.sqlite"));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    database.exec(SCHEMA);
    globalThis.controlCenterProposalsDatabase = database;
  }
  return globalThis.controlCenterProposalsDatabase;
}

// ---------- row mapping ----------

type ProposalRow = {
  id: string; token: string; kind: string; number: string; status: string;
  client_name: string; client_contact: string; client_email: string;
  project_title: string; summary: string; currency: string;
  vat_rate: number; discount_rate: number; valid_until: string; terms: string;
  created_at: string; updated_at: string; sent_at: string;
};

function toKind(value: string): ProposalKind {
  return (PROPOSAL_KINDS as string[]).includes(value) ? (value as ProposalKind) : "proposal";
}

function toStatus(value: string): ProposalStatus {
  return (PROPOSAL_STATUSES as string[]).includes(value) ? (value as ProposalStatus) : "draft";
}

function mapProposal(row: ProposalRow, sections: ProposalSection[], items: ProposalItem[]): Proposal {
  return {
    id: row.id,
    token: row.token,
    kind: toKind(row.kind),
    number: row.number,
    status: toStatus(row.status),
    clientName: row.client_name,
    clientContact: row.client_contact,
    clientEmail: row.client_email,
    projectTitle: row.project_title,
    summary: row.summary,
    currency: row.currency || "ZAR",
    vatRate: Number(row.vat_rate) || 0,
    discountRate: Number(row.discount_rate) || 0,
    validUntil: row.valid_until,
    terms: row.terms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    sections,
    items,
  };
}

function readSections(id: string): ProposalSection[] {
  return getProposalsDatabase()
    .prepare("SELECT id, position, heading, body FROM proposal_sections WHERE proposal_id = ? ORDER BY position")
    .all(id)
    .map((row) => {
      const record = row as unknown as { id: string; position: number; heading: string; body: string };
      return { id: record.id, position: Number(record.position) || 0, heading: record.heading, body: record.body };
    });
}

function readItems(id: string): ProposalItem[] {
  return getProposalsDatabase()
    .prepare(
      "SELECT id, position, description, detail, quantity, unit, unit_rate FROM proposal_items WHERE proposal_id = ? ORDER BY position",
    )
    .all(id)
    .map((row) => {
      const record = row as unknown as {
        id: string; position: number; description: string; detail: string;
        quantity: number; unit: string; unit_rate: number;
      };
      return {
        id: record.id,
        position: Number(record.position) || 0,
        description: record.description,
        detail: record.detail,
        quantity: Number(record.quantity) || 0,
        unit: record.unit || "item",
        unitRate: Number(record.unit_rate) || 0,
      };
    });
}

// ---------- reads ----------

export function listProposals(): ProposalSummary[] {
  const database = getProposalsDatabase();
  const rows = database
    .prepare("SELECT * FROM proposals ORDER BY created_at DESC")
    .all() as unknown as ProposalRow[];
  return rows.map((row) => {
    const items = readItems(row.id);
    const totals = proposalTotals({
      items,
      vatRate: Number(row.vat_rate) || 0,
      discountRate: Number(row.discount_rate) || 0,
    });
    return {
      id: row.id,
      token: row.token,
      kind: toKind(row.kind),
      number: row.number,
      status: toStatus(row.status),
      clientName: row.client_name,
      projectTitle: row.project_title,
      currency: row.currency || "ZAR",
      validUntil: row.valid_until,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sentAt: row.sent_at,
      total: totals.total,
      itemCount: items.length,
    };
  });
}

export function getProposal(id: string): Proposal | null {
  const row = getProposalsDatabase()
    .prepare("SELECT * FROM proposals WHERE id = ?")
    .get(id) as unknown as ProposalRow | undefined;
  if (!row) return null;
  return mapProposal(row, readSections(row.id), readItems(row.id));
}

export function getProposalByToken(token: string): Proposal | null {
  if (!token || token.length < 16) return null;
  const row = getProposalsDatabase()
    .prepare("SELECT * FROM proposals WHERE token = ?")
    .get(token) as unknown as ProposalRow | undefined;
  if (!row) return null;
  return mapProposal(row, readSections(row.id), readItems(row.id));
}

/** DC-2026-001, continuing from the highest number already used this year. */
export function nextProposalNumber(kind: ProposalKind, now = new Date()) {
  const year = now.getFullYear();
  const prefix = kind === "quote" ? "DCQ" : "DCP";
  const rows = getProposalsDatabase()
    .prepare("SELECT number FROM proposals WHERE number LIKE ?")
    .all(`${prefix}-${year}-%`) as unknown as { number: string }[];
  let highest = 0;
  for (const row of rows) {
    const match = /-(\d+)$/.exec(row.number || "");
    if (match) highest = Math.max(highest, Number.parseInt(match[1], 10) || 0);
  }
  return `${prefix}-${year}-${String(highest + 1).padStart(3, "0")}`;
}

// ---------- writes ----------

export type CreateProposalInput = {
  kind?: ProposalKind;
  clientName?: string;
  projectTitle?: string;
};

export function createProposal(input: CreateProposalInput = {}): Proposal {
  const database = getProposalsDatabase();
  const now = new Date();
  const iso = now.toISOString();
  const id = randomUUID();
  const kind = input.kind === "quote" ? "quote" : "proposal";
  const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  database
    .prepare(
      `INSERT INTO proposals
        (id, token, kind, number, status, client_name, client_contact, client_email,
         project_title, summary, currency, vat_rate, discount_rate, valid_until, terms,
         created_at, updated_at, sent_at)
       VALUES (?, ?, ?, ?, 'draft', ?, '', '', ?, '', 'ZAR', 15, 0, ?, ?, ?, ?, '')`,
    )
    .run(
      id,
      randomBytes(24).toString("base64url"),
      kind,
      nextProposalNumber(kind, now),
      (input.clientName || "").trim(),
      (input.projectTitle || "").trim(),
      validUntil,
      DEFAULT_TERMS,
      iso,
      iso,
    );

  const insertSection = database.prepare(
    "INSERT INTO proposal_sections (id, proposal_id, position, heading, body) VALUES (?, ?, ?, ?, ?)",
  );
  DEFAULT_SECTIONS.forEach((section, index) => {
    insertSection.run(randomUUID(), id, index, section.heading, section.body);
  });

  return getProposal(id) as Proposal;
}

export type UpdateProposalInput = Partial<
  Omit<Proposal, "id" | "token" | "createdAt" | "updatedAt" | "sections" | "items">
> & {
  sections?: Omit<ProposalSection, "id">[] | ProposalSection[];
  items?: Omit<ProposalItem, "id">[] | ProposalItem[];
};

const TEXT_COLUMNS: Record<string, string> = {
  clientName: "client_name",
  clientContact: "client_contact",
  clientEmail: "client_email",
  projectTitle: "project_title",
  summary: "summary",
  currency: "currency",
  validUntil: "valid_until",
  terms: "terms",
  number: "number",
  sentAt: "sent_at",
};

export function updateProposal(id: string, patch: UpdateProposalInput): Proposal | null {
  const database = getProposalsDatabase();
  const existing = database.prepare("SELECT id FROM proposals WHERE id = ?").get(id);
  if (!existing) return null;

  const assignments: string[] = [];
  const values: (string | number)[] = [];

  for (const [key, column] of Object.entries(TEXT_COLUMNS)) {
    const value = (patch as Record<string, unknown>)[key];
    if (typeof value === "string") {
      assignments.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (patch.kind && (PROPOSAL_KINDS as string[]).includes(patch.kind)) {
    assignments.push("kind = ?");
    values.push(patch.kind);
  }
  if (patch.status && (PROPOSAL_STATUSES as string[]).includes(patch.status)) {
    assignments.push("status = ?");
    values.push(patch.status);
    if (patch.status === "sent") {
      assignments.push("sent_at = ?");
      values.push(new Date().toISOString());
    }
  }
  if (typeof patch.vatRate === "number" && Number.isFinite(patch.vatRate)) {
    assignments.push("vat_rate = ?");
    values.push(Math.max(0, Math.min(100, patch.vatRate)));
  }
  if (typeof patch.discountRate === "number" && Number.isFinite(patch.discountRate)) {
    assignments.push("discount_rate = ?");
    values.push(Math.max(0, Math.min(100, patch.discountRate)));
  }

  assignments.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  database.prepare(`UPDATE proposals SET ${assignments.join(", ")} WHERE id = ?`).run(...values);

  // Sections and items are replaced wholesale. The editor always submits the full list,
  // so this keeps ordering honest without a diffing dance.
  if (Array.isArray(patch.sections)) {
    database.prepare("DELETE FROM proposal_sections WHERE proposal_id = ?").run(id);
    const insert = database.prepare(
      "INSERT INTO proposal_sections (id, proposal_id, position, heading, body) VALUES (?, ?, ?, ?, ?)",
    );
    patch.sections.forEach((section, index) => {
      insert.run(randomUUID(), id, index, String(section.heading ?? ""), String(section.body ?? ""));
    });
  }

  if (Array.isArray(patch.items)) {
    database.prepare("DELETE FROM proposal_items WHERE proposal_id = ?").run(id);
    const insert = database.prepare(
      `INSERT INTO proposal_items (id, proposal_id, position, description, detail, quantity, unit, unit_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    patch.items.forEach((item, index) => {
      insert.run(
        randomUUID(),
        id,
        index,
        String(item.description ?? ""),
        String(item.detail ?? ""),
        Number(item.quantity) || 0,
        String(item.unit ?? "item"),
        Math.round(Number(item.unitRate) || 0),
      );
    });
  }

  return getProposal(id);
}

export function deleteProposal(id: string) {
  const database = getProposalsDatabase();
  database.prepare("DELETE FROM proposal_items WHERE proposal_id = ?").run(id);
  database.prepare("DELETE FROM proposal_sections WHERE proposal_id = ?").run(id);
  const result = database.prepare("DELETE FROM proposals WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

export function duplicateProposal(id: string): Proposal | null {
  const source = getProposal(id);
  if (!source) return null;
  const copy = createProposal({ kind: source.kind, clientName: source.clientName, projectTitle: source.projectTitle });
  return updateProposal(copy.id, {
    clientContact: source.clientContact,
    clientEmail: source.clientEmail,
    summary: source.summary,
    currency: source.currency,
    vatRate: source.vatRate,
    discountRate: source.discountRate,
    terms: source.terms,
    sections: source.sections,
    items: source.items,
  });
}

// ---------- rate card ----------

export function listRateCard(): RateCardEntry[] {
  return getProposalsDatabase()
    .prepare("SELECT id, category, description, unit, default_rate FROM rate_card ORDER BY category, description")
    .all()
    .map((row) => {
      const record = row as unknown as {
        id: string; category: string; description: string; unit: string; default_rate: number;
      };
      return {
        id: record.id,
        category: record.category,
        description: record.description,
        unit: record.unit || "item",
        defaultRate: Number(record.default_rate) || 0,
      };
    });
}

export function replaceRateCard(entries: Omit<RateCardEntry, "id">[]) {
  const database = getProposalsDatabase();
  database.prepare("DELETE FROM rate_card").run();
  const insert = database.prepare(
    "INSERT INTO rate_card (id, category, description, unit, default_rate) VALUES (?, ?, ?, ?, ?)",
  );
  for (const entry of entries) {
    insert.run(
      randomUUID(),
      String(entry.category ?? ""),
      String(entry.description ?? ""),
      String(entry.unit ?? "item"),
      Math.round(Number(entry.defaultRate) || 0),
    );
  }
  return listRateCard();
}

export { lineTotal, proposalTotals };
