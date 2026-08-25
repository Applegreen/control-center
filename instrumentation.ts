export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLocalCollectorScheduler } = await import("./lib/server/scheduler");
  startLocalCollectorScheduler();
}
