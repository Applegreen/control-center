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

edit("lib/server/ai.ts",
  `timeoutMs: isLocalAiProvider(provider) ? 120_000 : 45_000`,
  `timeoutMs: isLocalAiProvider(provider) ? 600_000 : 45_000`,
  "server/ai.ts  local provider timeout 120s -> 600s");

edit("lib/server/ai.ts",
  `: { options: { num_predict: outputTokens, num_ctx: contextLength }, truncate: false, shift: false }`,
  `: { options: { num_predict: outputTokens, num_ctx: contextLength }, truncate: false, shift: false, think: false }`,
  "server/ai.ts  disable Ollama thinking mode");

console.log(`\n${applied} applied, ${skipped} already in place.`);
