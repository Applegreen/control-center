import { createHash } from "node:crypto";

export function collectionScope(namespace: string, signals: string[]) {
  const normalized = [...new Set(
    signals.map((signal) => signal.normalize("NFKC").trim()).filter(Boolean),
  )].sort();
  const digest = createHash("sha256")
    .update([namespace, ...normalized].join("\u0000"))
    .digest("hex")
    .slice(0, 20);
  return `${namespace}:${digest}`;
}
