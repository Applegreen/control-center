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
  const blocked = await fetch(`http://127.0.0.1:${port}/api/settings`, {
    headers: { Host: "attacker.example", Origin: "http://attacker.example" },
  });
  if (blocked.status !== 403)
    throw new Error(
      `Foreign Host probe returned HTTP ${blocked.status}, expected 403.`,
    );
  console.log(
    "Production smoke test passed: health, home page, and localhost boundary.",
  );
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  await rm(dataDirectory, { recursive: true, force: true });
}
