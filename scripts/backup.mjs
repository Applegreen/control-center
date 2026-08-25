import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { loadLocalEnvironment, resolveDataDirectory } from "./paths.mjs";

loadLocalEnvironment();
const sourceDirectory = resolveDataDirectory();
const stamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d{3}Z$/, "Z");
const requestedDestination = process.argv
  .find((value) => value.startsWith("--to="))
  ?.slice(5);
const destination = path.resolve(
  requestedDestination ||
    path.join(os.homedir(), "Documents", "Control Center Backups", stamp),
);
await mkdir(destination, { recursive: true, mode: 0o700 });
await chmod(destination, 0o700);

async function makePrivate(filename) {
  await chmod(path.join(destination, filename), 0o600);
}

const databasePath = path.join(sourceDirectory, "control-center.sqlite");
if (existsSync(databasePath)) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  await backup(database, path.join(destination, "control-center.sqlite"));
  database.close();
  await makePrivate("control-center.sqlite");
}

for (const filename of [
  "settings.json",
  "snapshots.json",
  "industry-snapshots.json",
]) {
  const source = path.join(sourceDirectory, filename);
  if (existsSync(source)) {
    await copyFile(source, path.join(destination, filename));
    await makePrivate(filename);
  }
}
await writeFile(
  path.join(destination, "BACKUP.txt"),
  `Control Center backup\nCreated: ${new Date().toISOString()}\nSource: ${sourceDirectory}\n\nThis private backup may contain OAuth tokens. Keep it secure.\n`,
  { mode: 0o600 },
);
await makePrivate("BACKUP.txt");

console.log(`Backup created: ${destination}`);
console.log(
  "This is a private full backup and may contain OAuth tokens. Keep it secure.",
);
