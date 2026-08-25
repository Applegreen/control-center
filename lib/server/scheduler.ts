import "server-only";

const COLLECTION_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 5_000;

declare global {
  var controlCenterCollectorTimer: NodeJS.Timeout | undefined;
  var controlCenterCollectorStartupTimer: NodeJS.Timeout | undefined;
  var controlCenterCollectorRunning: boolean | undefined;
}

function localBaseUrl() {
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

async function refreshAllCollectors() {
  if (globalThis.controlCenterCollectorRunning) return;
  globalThis.controlCenterCollectorRunning = true;
  try {
    const baseUrl = localBaseUrl();
    await Promise.allSettled([
      "/api/live/industry",
      "/api/live/mentions",
      "/api/live/audience",
      "/api/live/newsletters",
    ].map((path) => fetch(`${baseUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) })));
  } finally {
    globalThis.controlCenterCollectorRunning = false;
  }
}

export function startLocalCollectorScheduler() {
  if (globalThis.controlCenterCollectorTimer || globalThis.controlCenterCollectorStartupTimer) return;
  globalThis.controlCenterCollectorStartupTimer = setTimeout(() => {
    globalThis.controlCenterCollectorStartupTimer = undefined;
    void refreshAllCollectors();
    globalThis.controlCenterCollectorTimer = setInterval(() => void refreshAllCollectors(), COLLECTION_INTERVAL_MS);
    globalThis.controlCenterCollectorTimer.unref();
  }, STARTUP_DELAY_MS);
  globalThis.controlCenterCollectorStartupTimer.unref();
}
