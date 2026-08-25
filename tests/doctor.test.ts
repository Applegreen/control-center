import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("doctor reports a corrupt workspace without changing the saved rows", async () => {
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "control-center-doctor-test-"),
  );
  const databasePath = path.join(dataDirectory, "control-center.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE workspace_state (
      state_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const insert = database.prepare(
    "INSERT INTO workspace_state VALUES (?, ?, ?)",
  );
  insert.run("reminders", "not-json", "2026-08-25T00:00:00Z");
  insert.run("tasks", "[]", "2026-08-25T00:00:00Z");
  database.close();

  try {
    const result = await new Promise<{
      code: string | number | null | undefined;
      output: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        [path.resolve("scripts/doctor.mjs")],
        {
          cwd: process.cwd(),
          env: { ...process.env, CONTROL_CENTER_DATA_DIR: dataDirectory },
        },
        (error, stdout, stderr) =>
          resolve({ code: error?.code, output: `${stdout}${stderr}` }),
      );
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /Workspace: could not be read safely/i);

    const readback = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(
      readback
        .prepare(
          "SELECT payload_json FROM workspace_state WHERE state_key = 'reminders'",
        )
        .get()?.payload_json,
      "not-json",
    );
    readback.close();
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("doctor reports corrupt audience history without replacing it", async () => {
  const dataDirectory = await mkdtemp(
    path.join(os.tmpdir(), "control-center-doctor-audience-test-"),
  );
  const snapshotsPath = path.join(dataDirectory, "snapshots.json");
  const corruptHistory = JSON.stringify({
    account: { total: "many", checkedAt: "today" },
  });
  await writeFile(snapshotsPath, corruptHistory);

  try {
    const result = await new Promise<{
      code: string | number | null | undefined;
      output: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        [path.resolve("scripts/doctor.mjs")],
        {
          cwd: process.cwd(),
          env: { ...process.env, CONTROL_CENTER_DATA_DIR: dataDirectory },
        },
        (error, stdout, stderr) =>
          resolve({ code: error?.code, output: `${stdout}${stderr}` }),
      );
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /Audience history: could not be read safely/i);
    assert.equal(await readFile(snapshotsPath, "utf8"), corruptHistory);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
