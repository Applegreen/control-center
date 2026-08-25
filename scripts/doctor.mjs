import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadLocalEnvironment, resolveDataDirectory } from "./paths.mjs";

loadLocalEnvironment();
const dataDirectory = resolveDataDirectory();
const settingsPath = path.join(dataDirectory, "settings.json");
const databasePath = path.join(dataDirectory, "control-center.sqlite");
let healthy = true;

console.log(`Node.js: ${process.versions.node}`);
console.log(`Platform: ${process.platform} ${process.arch}`);
console.log(`Local data: ${dataDirectory}`);
console.log(
  `Production build: ${existsSync(path.join(process.cwd(), ".next", "BUILD_ID")) ? "ready" : "not built yet (npm run launch will build it)"}`,
);

if (existsSync(settingsPath)) {
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    console.log(
      `Settings: readable (${settings.industry?.sources?.length || 0} industry sources, ${settings.audience?.accounts?.length || 0} audience accounts)`,
    );
  } catch (error) {
    healthy = false;
    console.error(
      `Settings: invalid JSON (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
} else {
  console.log("Settings: first run (no settings file yet)");
}

if (existsSync(databasePath)) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const result = database.prepare("PRAGMA quick_check").get();
    const status = String(result?.quick_check || "unknown");
    console.log(`Database: ${status}`);
    healthy = healthy && status === "ok";

    const workspaceTable = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'workspace_state'")
      .get();
    if (workspaceTable) {
      try {
        const rows = database
          .prepare("SELECT state_key, payload_json FROM workspace_state WHERE state_key IN ('reminders', 'tasks')")
          .all();
        if (rows.length === 1)
          throw new Error("one of the two workspace rows is missing");
        for (const row of rows) {
          let payload;
          try {
            payload = JSON.parse(row.payload_json);
          } catch {
            throw new Error(`${row.state_key} contains invalid JSON`);
          }
          if (!Array.isArray(payload))
            throw new Error(`${row.state_key} is not stored as a list`);
        }
        console.log(
          rows.length === 0
            ? "Workspace: first run"
            : "Workspace: reminders and tasks are readable",
        );
      } catch (error) {
        healthy = false;
        console.error(
          `Workspace: could not be read safely (${error instanceof Error ? error.message : "unknown error"})`,
        );
      }
    }
  } catch (error) {
    healthy = false;
    console.error(
      `Database: could not be checked (${error instanceof Error ? error.message : "unknown error"})`,
    );
  } finally {
    database?.close();
  }
} else {
  console.log("Database: first run (no database yet)");
}

console.log(
  healthy ? "\nDoctor result: ready" : "\nDoctor result: needs attention",
);
process.exit(healthy ? 0 : 1);
