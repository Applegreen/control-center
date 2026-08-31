import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "@/lib/server/settings";
import {
  MINUTE_STATUSES,
  type Minute,
  type MinuteStatus,
  type MinuteSummaryRow,
  type MinuteTask,
  type OpenTask,
} from "@/lib/minutes";

// Own SQLite file, same reasoning as proposals: Control Center runs versioned
// migrations on control-center.sqlite, and these tables should never be caught
// up in one.

declare global {
  var controlCenterMinutesDatabase: DatabaseSync | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS minutes (
  id             TEXT PRIMARY KEY,
  company        TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  meeting_date   TEXT NOT NULL DEFAULT '',
  attendees      TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  audio_filename TEXT NOT NULL DEFAULT '',
  audio_duration REAL NOT NULL DEFAULT 0,
  transcript     TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS minute_tasks (
  id          TEXT PRIMARY KEY,
  minute_id   TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  owner       TEXT NOT NULL DEFAULT '',
  due_date    TEXT NOT NULL DEFAULT '',
  done        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS minute_tasks_parent ON minute_tasks (minute_id, position);
CREATE INDEX IF NOT EXISTS minutes_company ON minutes (company, meeting_date DESC);
CREATE INDEX IF NOT EXISTS minute_tasks_due ON minute_tasks (done, due_date);
`;

export function getMinutesDatabase() {
  if (!globalThis.controlCenterMinutesDatabase) {
    const directory = dataDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(path.join(directory, "minutes.sqlite"));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    database.exec(SCHEMA);
    globalThis.controlCenterMinutesDatabase = database;
  }
  return globalThis.controlCenterMinutesDatabase;
}

// ---------- mapping ----------

type MinuteRow = {
  id: string; company: string; title: string; meeting_date: string;
  attendees: string; location: string; audio_filename: string; audio_duration: number;
  transcript: string; summary: string; notes: string; status: string;
  created_at: string; updated_at: string;
};

function toStatus(value: string): MinuteStatus {
  return (MINUTE_STATUSES as string[]).includes(value) ? (value as MinuteStatus) : "draft";
}

function readTasks(minuteId: string): MinuteTask[] {
  return getMinutesDatabase()
    .prepare(
      "SELECT id, position, description, owner, due_date, done FROM minute_tasks WHERE minute_id = ? ORDER BY position",
    )
    .all(minuteId)
    .map((row) => {
      const record = row as unknown as {
        id: string; position: number; description: string;
        owner: string; due_date: string; done: number;
      };
      return {
        id: record.id,
        position: Number(record.position) || 0,
        description: record.description,
        owner: record.owner,
        dueDate: record.due_date,
        done: Number(record.done) === 1,
      };
    });
}

function mapMinute(row: MinuteRow, tasks: MinuteTask[]): Minute {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    meetingDate: row.meeting_date,
    attendees: row.attendees,
    location: row.location,
    audioFilename: row.audio_filename,
    audioDuration: Number(row.audio_duration) || 0,
    transcript: row.transcript,
    summary: row.summary,
    notes: row.notes,
    status: toStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tasks,
  };
}

// ---------- reads ----------

export function listMinutes(): MinuteSummaryRow[] {
  const database = getMinutesDatabase();
  const rows = database
    .prepare("SELECT * FROM minutes ORDER BY meeting_date DESC, created_at DESC")
    .all() as unknown as MinuteRow[];

  return rows.map((row) => {
    const tasks = readTasks(row.id);
    const open = tasks.filter((task) => !task.done);
    const nextDue = open
      .map((task) => task.dueDate)
      .filter(Boolean)
      .sort()[0] || "";
    return {
      id: row.id,
      company: row.company,
      title: row.title,
      meetingDate: row.meeting_date,
      attendees: row.attendees,
      status: toStatus(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      taskCount: tasks.length,
      openTaskCount: open.length,
      nextDueDate: nextDue,
      hasTranscript: Boolean((row.transcript || "").trim()),
    };
  });
}

export function getMinute(id: string): Minute | null {
  const row = getMinutesDatabase()
    .prepare("SELECT * FROM minutes WHERE id = ?")
    .get(id) as unknown as MinuteRow | undefined;
  if (!row) return null;
  return mapMinute(row, readTasks(row.id));
}

/** Every incomplete task across all meetings, soonest deadline first.
 *  Tasks with no date sort last rather than first. */
export function listOpenTasks(): OpenTask[] {
  const rows = getMinutesDatabase()
    .prepare(
      `SELECT t.id, t.position, t.description, t.owner, t.due_date, t.done,
              m.id AS minute_id, m.company, m.title AS meeting_title, m.meeting_date
         FROM minute_tasks t
         JOIN minutes m ON m.id = t.minute_id
        WHERE t.done = 0 AND m.status != 'archived'`,
    )
    .all()
    .map((row) => {
      const record = row as unknown as {
        id: string; position: number; description: string; owner: string;
        due_date: string; done: number; minute_id: string; company: string;
        meeting_title: string; meeting_date: string;
      };
      return {
        id: record.id,
        position: Number(record.position) || 0,
        description: record.description,
        owner: record.owner,
        dueDate: record.due_date,
        done: false,
        minuteId: record.minute_id,
        company: record.company,
        meetingTitle: record.meeting_title,
        meetingDate: record.meeting_date,
      };
    });

  return rows.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

export function listCompanies(): string[] {
  return getMinutesDatabase()
    .prepare("SELECT DISTINCT company FROM minutes WHERE company != '' ORDER BY company")
    .all()
    .map((row) => (row as unknown as { company: string }).company);
}

// ---------- writes ----------

export function createMinute(input: { company?: string; title?: string; meetingDate?: string } = {}): Minute {
  const database = getMinutesDatabase();
  const iso = new Date().toISOString();
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO minutes (id, company, title, meeting_date, attendees, location,
                            audio_filename, audio_duration, transcript, summary, notes,
                            status, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '', '', 0, '', '', '', 'draft', ?, ?)`,
    )
    .run(
      id,
      (input.company || "").trim(),
      (input.title || "").trim(),
      (input.meetingDate || iso.slice(0, 10)).trim(),
      iso,
      iso,
    );
  return getMinute(id) as Minute;
}

const TEXT_COLUMNS: Record<string, string> = {
  company: "company",
  title: "title",
  meetingDate: "meeting_date",
  attendees: "attendees",
  location: "location",
  audioFilename: "audio_filename",
  transcript: "transcript",
  summary: "summary",
  notes: "notes",
};

export type UpdateMinuteInput = Partial<
  Omit<Minute, "id" | "createdAt" | "updatedAt" | "tasks">
> & { tasks?: (Omit<MinuteTask, "id"> | MinuteTask)[] };

export function updateMinute(id: string, patch: UpdateMinuteInput): Minute | null {
  const database = getMinutesDatabase();
  if (!database.prepare("SELECT id FROM minutes WHERE id = ?").get(id)) return null;

  const assignments: string[] = [];
  const values: (string | number)[] = [];

  for (const [key, column] of Object.entries(TEXT_COLUMNS)) {
    const value = (patch as Record<string, unknown>)[key];
    if (typeof value === "string") {
      assignments.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (patch.status && (MINUTE_STATUSES as string[]).includes(patch.status)) {
    assignments.push("status = ?");
    values.push(patch.status);
  }
  if (typeof patch.audioDuration === "number" && Number.isFinite(patch.audioDuration)) {
    assignments.push("audio_duration = ?");
    values.push(Math.max(0, patch.audioDuration));
  }

  assignments.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  database.prepare(`UPDATE minutes SET ${assignments.join(", ")} WHERE id = ?`).run(...values);

  // Tasks are replaced wholesale - the editor always submits the full list.
  if (Array.isArray(patch.tasks)) {
    database.prepare("DELETE FROM minute_tasks WHERE minute_id = ?").run(id);
    const insert = database.prepare(
      "INSERT INTO minute_tasks (id, minute_id, position, description, owner, due_date, done) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    patch.tasks.forEach((task, index) => {
      insert.run(
        randomUUID(),
        id,
        index,
        String(task.description ?? ""),
        String(task.owner ?? ""),
        String(task.dueDate ?? ""),
        task.done ? 1 : 0,
      );
    });
  }

  return getMinute(id);
}

/** Toggle a single task without rewriting the whole meeting - used by the
 *  cross-company deadline list, where there is no open editor. */
export function setTaskDone(taskId: string, done: boolean) {
  const database = getMinutesDatabase();
  const result = database
    .prepare("UPDATE minute_tasks SET done = ? WHERE id = ?")
    .run(done ? 1 : 0, taskId);
  if (Number(result.changes) > 0) {
    database
      .prepare(
        "UPDATE minutes SET updated_at = ? WHERE id = (SELECT minute_id FROM minute_tasks WHERE id = ?)",
      )
      .run(new Date().toISOString(), taskId);
  }
  return Number(result.changes) > 0;
}

export function deleteMinute(id: string) {
  const database = getMinutesDatabase();
  database.prepare("DELETE FROM minute_tasks WHERE minute_id = ?").run(id);
  const result = database.prepare("DELETE FROM minutes WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}
