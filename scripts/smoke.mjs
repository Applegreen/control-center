import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = 3210;
const dataDirectory = await mkdtemp(
  path.join(os.tmpdir(), "control-center-smoke-"),
);
const server = spawn(
  process.execPath,
  [
    path.join("node_modules", "next", "dist", "bin", "next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONTROL_CENTER_DATA_DIR: dataDirectory,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
const exited = new Promise((resolve) =>
  server.once("exit", (code, signal) => resolve({ code, signal })),
);

try {
  const deadline = Date.now() + 30_000;
  let response;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve(null), 200)),
    ]);
    if (result)
      throw new Error(
        `Server exited before startup (${result.code ?? result.signal}).\n${output}`,
      );
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) break;
    } catch {
      // Keep polling until the startup deadline.
    }
  }
  if (!response?.ok)
    throw new Error(`Health endpoint did not become ready.\n${output}`);
  const health = await response.json();
  if (health.service !== "control-center")
    throw new Error("Health endpoint returned the wrong service identity.");
  const home = await fetch(`http://127.0.0.1:${port}/`);
  if (!home.ok || !(await home.text()).includes("Control Center"))
    throw new Error("The dashboard home page did not render.");
  const getJson = async (pathname) => {
    const result = await fetch(`http://127.0.0.1:${port}${pathname}`);
    if (!result.ok)
      throw new Error(`${pathname} returned HTTP ${result.status}.`);
    return result.json();
  };
  const settings = await getJson("/api/settings");
  if (
    settings.general?.workspaceName !== "Control Center" ||
    settings.industry?.sources?.length !== 0 ||
    settings.industry?.keywords?.length !== 0 ||
    settings.mentions?.terms?.length !== 0 ||
    settings.mentions?.websites?.length !== 0 ||
    settings.mentions?.identityAnchors?.length !== 0 ||
    settings.audience?.accounts?.length !== 0 ||
    settings.newsletters?.connected !== false
  ) {
    throw new Error(
      "A fresh install exposed personalized or preconfigured settings.",
    );
  }
  const workspace = await getJson("/api/workspace");
  if (
    workspace.initialized !== false ||
    workspace.tasks?.length !== 0 ||
    workspace.reminders?.length !== 0
  ) {
    throw new Error("A fresh install did not start with an empty workspace.");
  }
  for (const pathname of [
    "/api/live/industry",
    "/api/live/mentions",
    "/api/live/audience",
  ]) {
    const live = await getJson(pathname);
    if (live.configured !== false || live.items?.length !== 0) {
      throw new Error(`${pathname} did not start in generic setup mode.`);
    }
  }
  const blocked = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    headers: { Host: "attacker.example", Origin: "http://attacker.example" },
  });
  if (blocked.status !== 403)
    throw new Error(
      `Foreign Host probe returned HTTP ${blocked.status}, expected 403.`,
    );
  console.log(
    "Production smoke test passed: health, home page, generic empty first run, and localhost boundary.",
  );
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  await rm(dataDirectory, { recursive: true, force: true });
}
