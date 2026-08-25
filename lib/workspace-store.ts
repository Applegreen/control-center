import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceState } from "./types";

const emptyWorkspace: WorkspaceState = { reminders: [], tasks: [] };

export function initializeWorkspaceStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspace_state (
      state_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

export function readWorkspaceState(database: DatabaseSync): WorkspaceState {
  const rows = database.prepare("SELECT state_key, payload_json FROM workspace_state WHERE state_key IN ('reminders', 'tasks')").all() as unknown as Array<{ state_key: keyof WorkspaceState; payload_json: string }>;
  if (rows.length === 1) {
    throw new Error("The saved workspace is incomplete. Restore it from a backup before making changes.");
  }
  const state = structuredClone(emptyWorkspace);
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload_json);
      if (!Array.isArray(parsed)) throw new Error("Workspace rows must contain lists.");
      state[row.state_key] = parsed;
    } catch (error) {
      throw new Error(
        `The saved ${row.state_key} data is corrupt. Restore it from a backup before making changes.`,
        { cause: error },
      );
    }
  }
  return state;
}

export function hasWorkspaceState(database: DatabaseSync) {
  const row = database.prepare("SELECT COUNT(*) AS count FROM workspace_state WHERE state_key IN ('reminders', 'tasks')").get() as unknown as { count: number };
  return Number(row.count) > 0;
}

export function writeWorkspaceState(database: DatabaseSync, state: WorkspaceState, now = new Date().toISOString()) {
  const statement = database.prepare(`
    INSERT INTO workspace_state (state_key, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (state_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  database.exec("BEGIN IMMEDIATE");
  try {
    statement.run("reminders", JSON.stringify(state.reminders), now);
    statement.run("tasks", JSON.stringify(state.tasks), now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return state;
}
