import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const execFileAsync = promisify(execFile);

async function assertPrivateBackup(destination: string) {
  assert.equal((await stat(destination)).mode & 0o777, 0o700);
  for (const filename of [
    "control-center.sqlite",
    "settings.json",
    "snapshots.json",
    "industry-snapshots.json",
    "BACKUP.txt",
  ]) assert.equal((await stat(path.join(destination, filename))).mode & 0o777, 0o600, filename);
}

test(
  "backup makes an existing custom destination and every artifact private",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "control-center-backup-test-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "existing-destination");
    await mkdir(source, { mode: 0o755 });
    await mkdir(destination, { mode: 0o755 });

    const database = new DatabaseSync(path.join(source, "control-center.sqlite"));
    database.exec("CREATE TABLE fixture (id INTEGER PRIMARY KEY)");
    database.close();
    for (const filename of ["settings.json", "snapshots.json", "industry-snapshots.json"])
      await writeFile(path.join(source, filename), "[]", { mode: 0o644 });

    await execFileAsync(process.execPath, [
      path.resolve("scripts/backup.mjs"),
      `--to=${destination}`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CONTROL_CENTER_DATA_DIR: source },
    });
    await assertPrivateBackup(destination);

    const newDestination = path.join(root, "new-destination");
    await execFileAsync(process.execPath, [
      path.resolve("scripts/backup.mjs"),
      `--to=${newDestination}`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CONTROL_CENTER_DATA_DIR: source },
    });
    await assertPrivateBackup(newDestination);
  },
);
