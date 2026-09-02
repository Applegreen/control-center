import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "@/lib/server/settings";
import {
  CONTACT_CONSENT,
  LEAD_KINDS,
  LEAD_SOURCES,
  LEAD_STAGES,
  type Contact,
  type ContactConsent,
  type Lead,
  type LeadKind,
  type LeadSource,
  type LeadStage,
  type LeadSummaryRow,
} from "@/lib/crm";

// Own SQLite file, same reasoning as proposals and minutes: upstream migrations
// run against control-center.sqlite and should never touch these tables.

declare global {
  var controlCenterCrmDatabase: DatabaseSync | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT '',
  company    TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  linkedin   TEXT NOT NULL DEFAULT '',
  origin     TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  consent    TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  company         TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL DEFAULT 'animation',
  stage           TEXT NOT NULL DEFAULT 'new',
  source          TEXT NOT NULL DEFAULT 'manual',
  source_url      TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  estimated_value INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'ZAR',
  due_date        TEXT NOT NULL DEFAULT '',
  next_action     TEXT NOT NULL DEFAULT '',
  next_action_date TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lead_contacts (
  lead_id    TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  PRIMARY KEY (lead_id, contact_id)
);

CREATE INDEX IF NOT EXISTS leads_stage ON leads (stage, due_date);
CREATE INDEX IF NOT EXISTS contacts_company ON contacts (company, name);
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_url
  ON leads (source_url) WHERE source_url != '';
`;

export function getCrmDatabase() {
  if (!globalThis.controlCenterCrmDatabase) {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(path.join(directory, "crm.sqlite"));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    database.exec(SCHEMA);
    globalThis.controlCenterCrmDatabase = database;
  }
  return globalThis.controlCenterCrmDatabase;
}

// ---------- helpers ----------

const pick = <T extends string>(allowed: readonly T[], value: string, fallback: T): T =>
  (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

type ContactRow = {
  id: string; name: string; role: string; company: string; email: string;
  phone: string; linkedin: string; origin: string; notes: string;
  consent: string; created_at: string; updated_at: string;
};

type LeadRow = {
  id: string; title: string; company: string; kind: string; stage: string;
  source: string; source_url: string; description: string; estimated_value: number;
  currency: string; due_date: string; next_action: string; next_action_date: string;
  notes: string; created_at: string; updated_at: string;
};

function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    company: row.company,
    email: row.email,
    phone: row.phone,
    linkedin: row.linkedin,
    origin: row.origin,
    notes: row.notes,
    consent: pick<ContactConsent>(CONTACT_CONSENT, row.consent, "unknown"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function contactIdsFor(leadId: string): string[] {
  return getCrmDatabase()
    .prepare("SELECT contact_id FROM lead_contacts WHERE lead_id = ?")
    .all(leadId)
    .map((row) => (row as unknown as { contact_id: string }).contact_id);
}

function mapLead(row: LeadRow, contactIds: string[]): Lead {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    kind: pick<LeadKind>(LEAD_KINDS, row.kind, "animation"),
    stage: pick<LeadStage>(LEAD_STAGES, row.stage, "new"),
    source: pick<LeadSource>(LEAD_SOURCES, row.source, "manual"),
    sourceUrl: row.source_url,
    description: row.description,
    estimatedValue: Number(row.estimated_value) || 0,
    currency: row.currency || "ZAR",
    dueDate: row.due_date,
    nextAction: row.next_action,
    nextActionDate: row.next_action_date,
    notes: row.notes,
    contactIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- contacts ----------

export function listContacts(): Contact[] {
  return (
    getCrmDatabase()
      .prepare("SELECT * FROM contacts ORDER BY company, name")
      .all() as unknown as ContactRow[]
  ).map(mapContact);
}

export function getContact(id: string): Contact | null {
  const row = getCrmDatabase()
    .prepare("SELECT * FROM contacts WHERE id = ?")
    .get(id) as unknown as ContactRow | undefined;
  return row ? mapContact(row) : null;
}

export type ContactInput = Partial<Omit<Contact, "id" | "createdAt" | "updatedAt">>;

export function createContact(input: ContactInput = {}): Contact {
  const database = getCrmDatabase();
  const iso = new Date().toISOString();
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO contacts (id, name, role, company, email, phone, linkedin, origin, notes,
                             consent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      (input.name || "").trim(),
      (input.role || "").trim(),
      (input.company || "").trim(),
      (input.email || "").trim(),
      (input.phone || "").trim(),
      (input.linkedin || "").trim(),
      (input.origin || "").trim(),
      (input.notes || "").trim(),
      pick<ContactConsent>(CONTACT_CONSENT, input.consent || "", "unknown"),
      iso,
      iso,
    );
  return getContact(id) as Contact;
}

const CONTACT_COLUMNS: Record<string, string> = {
  name: "name", role: "role", company: "company", email: "email",
  phone: "phone", linkedin: "linkedin", origin: "origin", notes: "notes",
};

export function updateContact(id: string, patch: ContactInput): Contact | null {
  const database = getCrmDatabase();
  if (!database.prepare("SELECT id FROM contacts WHERE id = ?").get(id)) return null;

  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, column] of Object.entries(CONTACT_COLUMNS)) {
    const value = (patch as Record<string, unknown>)[key];
    if (typeof value === "string") {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (patch.consent && (CONTACT_CONSENT as string[]).includes(patch.consent)) {
    sets.push("consent = ?");
    values.push(patch.consent);
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString(), id);
  database.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getContact(id);
}

export function deleteContact(id: string) {
  const database = getCrmDatabase();
  database.prepare("DELETE FROM lead_contacts WHERE contact_id = ?").run(id);
  return Number(database.prepare("DELETE FROM contacts WHERE id = ?").run(id).changes) > 0;
}

// ---------- leads ----------

export function listLeads(): LeadSummaryRow[] {
  const rows = getCrmDatabase()
    .prepare("SELECT * FROM leads ORDER BY updated_at DESC")
    .all() as unknown as LeadRow[];
  return rows.map((row) => {
    const ids = contactIdsFor(row.id);
    const lead = mapLead(row, ids);
    const { notes: _notes, description: _description, ...rest } = lead;
    return { ...rest, contactCount: ids.length };
  });
}

export function getLead(id: string): Lead | null {
  const row = getCrmDatabase()
    .prepare("SELECT * FROM leads WHERE id = ?")
    .get(id) as unknown as LeadRow | undefined;
  return row ? mapLead(row, contactIdsFor(row.id)) : null;
}

/** Used when promoting a collected item, so the same opportunity is not added twice. */
export function findLeadBySourceUrl(url: string): Lead | null {
  if (!url) return null;
  const row = getCrmDatabase()
    .prepare("SELECT * FROM leads WHERE source_url = ?")
    .get(url) as unknown as LeadRow | undefined;
  return row ? mapLead(row, contactIdsFor(row.id)) : null;
}

export type LeadInput = Partial<Omit<Lead, "id" | "createdAt" | "updatedAt">>;

export function createLead(input: LeadInput = {}): Lead {
  const existing = findLeadBySourceUrl((input.sourceUrl || "").trim());
  if (existing) return existing;

  const database = getCrmDatabase();
  const iso = new Date().toISOString();
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO leads (id, title, company, kind, stage, source, source_url, description,
                          estimated_value, currency, due_date, next_action, next_action_date,
                          notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      (input.title || "").trim(),
      (input.company || "").trim(),
      pick<LeadKind>(LEAD_KINDS, input.kind || "", "animation"),
      pick<LeadStage>(LEAD_STAGES, input.stage || "", "new"),
      pick<LeadSource>(LEAD_SOURCES, input.source || "", "manual"),
      (input.sourceUrl || "").trim(),
      (input.description || "").trim(),
      Math.round(Number(input.estimatedValue) || 0),
      (input.currency || "ZAR").trim(),
      (input.dueDate || "").trim(),
      (input.nextAction || "").trim(),
      (input.nextActionDate || "").trim(),
      (input.notes || "").trim(),
      iso,
      iso,
    );
  if (Array.isArray(input.contactIds)) linkContacts(id, input.contactIds);
  return getLead(id) as Lead;
}

const LEAD_COLUMNS: Record<string, string> = {
  title: "title", company: "company", sourceUrl: "source_url",
  description: "description", currency: "currency", dueDate: "due_date",
  nextAction: "next_action", nextActionDate: "next_action_date", notes: "notes",
};

export function updateLead(id: string, patch: LeadInput): Lead | null {
  const database = getCrmDatabase();
  if (!database.prepare("SELECT id FROM leads WHERE id = ?").get(id)) return null;

  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, column] of Object.entries(LEAD_COLUMNS)) {
    const value = (patch as Record<string, unknown>)[key];
    if (typeof value === "string") {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  for (const [key, column, allowed] of [
    ["kind", "kind", LEAD_KINDS],
    ["stage", "stage", LEAD_STAGES],
    ["source", "source", LEAD_SOURCES],
  ] as const) {
    const value = (patch as Record<string, unknown>)[key];
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (typeof patch.estimatedValue === "number" && Number.isFinite(patch.estimatedValue)) {
    sets.push("estimated_value = ?");
    values.push(Math.max(0, Math.round(patch.estimatedValue)));
  }
  sets.push("updated_at = ?");
  values.push(new Date().toISOString(), id);
  database.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  if (Array.isArray(patch.contactIds)) linkContacts(id, patch.contactIds);
  return getLead(id);
}

export function linkContacts(leadId: string, contactIds: string[]) {
  const database = getCrmDatabase();
  database.prepare("DELETE FROM lead_contacts WHERE lead_id = ?").run(leadId);
  const insert = database.prepare(
    "INSERT OR IGNORE INTO lead_contacts (lead_id, contact_id) VALUES (?, ?)",
  );
  for (const contactId of contactIds) {
    if (contactId) insert.run(leadId, contactId);
  }
}

export function deleteLead(id: string) {
  const database = getCrmDatabase();
  database.prepare("DELETE FROM lead_contacts WHERE lead_id = ?").run(id);
  return Number(database.prepare("DELETE FROM leads WHERE id = ?").run(id).changes) > 0;
}

export function listCompanies(): string[] {
  const database = getCrmDatabase();
  const names = new Set<string>();
  for (const table of ["leads", "contacts"]) {
    for (const row of database
      .prepare(`SELECT DISTINCT company FROM ${table} WHERE company != ''`)
      .all()) {
      names.add((row as unknown as { company: string }).company);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
