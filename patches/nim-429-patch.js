const fs = require("fs");
let applied = 0, skipped = 0;

function edit(file, find, replace, label) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(replace)) { console.log(`  = ${label}`); skipped++; return; }
  if (!src.includes(find)) {
    console.error(`\n  !! ${label}: anchor not found in ${file}\n`);
    process.exit(1);
  }
  fs.writeFileSync(file, src.replace(find, replace));
  console.log(`  + ${label}`);
  applied++;
}

const OLD_FN = `async function runNvidia(key: string, model: string, options: AiRunOptions) {
  if (options.webSearch) throw new Error("NVIDIA NIM does not provide built-in web research. The built-in public-source collectors continue to run.");
  return chatCompletionText(await providerFetch("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: \`Bearer \${key}\`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: options.prompt }],
      max_tokens: boundedTokens(options.maxOutputTokens),
      temperature: 0.2,
      stream: false,
    }),
  }));
}`;

const NEW_FN = `async function runNvidia(key: string, model: string, options: AiRunOptions) {
  if (options.webSearch) throw new Error("NVIDIA NIM does not provide built-in web research. The built-in public-source collectors continue to run.");
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: options.prompt }],
    max_tokens: boundedTokens(options.maxOutputTokens),
    temperature: 0.2,
    stream: false,
  });
  // NIM rate-limits bursts. Back off and retry rather than dropping the item.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; ; attempt++) {
    try {
      return chatCompletionText(await providerFetch("nvidia", "https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: \`Bearer \${key}\`, "Content-Type": "application/json" },
        body,
      }));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 429 || attempt >= MAX_ATTEMPTS - 1) throw error;
      const waitMs = 2_000 * 2 ** attempt + Math.floor(Math.random() * 750);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}`;

console.log("Making NVIDIA NIM survive rate limits...\n");
edit("lib/server/ai.ts", OLD_FN, NEW_FN, "server/ai.ts  runNvidia retry/backoff on 429");
edit("lib/server/newsletter-collector.ts",
  `await settleWithConcurrency(currentIds, 4, async (id) => {`,
  `await settleWithConcurrency(currentIds, 1, async (id) => {`,
  "newsletter-collector.ts  message concurrency 4 -> 1");

console.log(`\n${applied} applied, ${skipped} already in place.`);
