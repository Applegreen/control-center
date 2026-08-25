import { readFile } from "node:fs/promises";

const fileArgument = process.argv
  .find((value) => value.startsWith("--file="))
  ?.slice(7);
const urlArgument = process.argv
  .find((value) => value.startsWith("--url="))
  ?.slice(6);
const endpoint =
  `${urlArgument || "http://127.0.0.1:3000"}`.replace(/\/$/, "") + "/api/brief";
const input = fileArgument
  ? await readFile(fileArgument, "utf8")
  : await new Promise((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        value += chunk;
      });
      process.stdin.on("end", () => resolve(value));
      process.stdin.on("error", reject);
    });

let payload;
try {
  payload = JSON.parse(input);
} catch {
  console.error(
    "Daily Brief input must be valid JSON. Use --file=/absolute/path/items.json or pipe JSON to this command.",
  );
  process.exit(1);
}
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: new URL(endpoint).origin,
  },
  body: JSON.stringify(Array.isArray(payload) ? { items: payload } : payload),
});
const result = await response.json();
if (!response.ok) {
  console.error(
    result.error || `Daily Brief sync failed with HTTP ${response.status}.`,
  );
  process.exit(1);
}
console.log(`Daily Brief sync accepted ${result.accepted || 0} item(s).`);
console.log(
  `${result.sourcesProcessed || 0} source report(s) were recorded.`,
);
console.log(
  `${result.items?.length || 0} item(s) are available in the configured lookback window.`,
);
