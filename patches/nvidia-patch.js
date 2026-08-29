// Adds NVIDIA NIM as a first-class AI provider in Control Center.
// Safe to re-run: each edit is skipped if already present.
const fs = require("fs");
let applied = 0, skipped = 0;

function edit(file, find, replace, label) {
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(replace)) { console.log(`  = ${label}`); skipped++; return; }
  if (!src.includes(find)) {
    console.error(`\n  !! ${label}: anchor not found in ${file}`);
    console.error("     Upstream has changed. Stopping without writing further edits.\n");
    process.exit(1);
  }
  fs.writeFileSync(file, src.replace(find, replace));
  console.log(`  + ${label}`);
  applied++;
}

console.log("Adding NVIDIA NIM provider...\n");

edit("lib/types.ts",
  `"xai" | "lmstudio"`,
  `"xai" | "nvidia" | "lmstudio"`,
  "types.ts  AiProvider union");

edit("lib/ai-providers.ts",
  `["openai", "anthropic", "gemini", "xai", "lmstudio", "ollama"]`,
  `["openai", "anthropic", "gemini", "xai", "nvidia", "lmstudio", "ollama"]`,
  "ai-providers.ts  AI_KEY_PROVIDERS");

edit("lib/ai-providers.ts",
  `  xai: "xAI · Grok",`,
  `  xai: "xAI · Grok",\n  nvidia: "NVIDIA NIM",`,
  "ai-providers.ts  label");

edit("lib/ai-providers.ts",
  `  xai: "grok-4.6",`,
  `  xai: "grok-4.6",\n  nvidia: "deepseek-ai/deepseek-v4-pro-0813",`,
  "ai-providers.ts  default model");

edit("lib/ai-providers.ts",
  `    xai: environment.XAI_API_KEY,`,
  `    xai: environment.XAI_API_KEY,\n    nvidia: environment.NVIDIA_API_KEY || environment.NVIDIA_NIM_API_KEY,`,
  "ai-providers.ts  environment key");

edit("lib/ai-providers.ts",
  `  return provider !== "none" && !isLocalAiProvider(provider);`,
  `  return provider !== "none" && provider !== "nvidia" && !isLocalAiProvider(provider);`,
  "ai-providers.ts  aiSupportsWebSearch (NIM has no web-search tool)");

edit("lib/ai-model-discovery.ts",
  `  const endpoint = provider === "openai"\n    ? "https://api.openai.com/v1/models"`,
  `  const endpoint = provider === "nvidia"\n    ? "https://integrate.api.nvidia.com/v1/models"\n    : provider === "openai"\n    ? "https://api.openai.com/v1/models"`,
  "ai-model-discovery.ts  NIM /v1/models");

edit("lib/server/ai.ts",
  `async function runXai(key: string, model: string, options: AiRunOptions) {`,
  `async function runNvidia(key: string, model: string, options: AiRunOptions) {
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
}

async function runXai(key: string, model: string, options: AiRunOptions) {`,
  "server/ai.ts  runNvidia()");

edit("lib/server/ai.ts",
  `        : provider === "xai"\n          ? await runXai(key, model, options)\n          : await runLocalAi(`,
  `        : provider === "xai"\n          ? await runXai(key, model, options)\n          : provider === "nvidia"\n            ? await runNvidia(key, model, options)\n            : await runLocalAi(`,
  "server/ai.ts  dispatch");

edit("lib/server/settings.ts",
  `apiKeys: { openai: "", anthropic: "", gemini: "", xai: "", lmstudio: "", ollama: "" }`,
  `apiKeys: { openai: "", anthropic: "", gemini: "", xai: "", nvidia: "", lmstudio: "", ollama: "" }`,
  "server/settings.ts  apiKeys record");

edit("lib/server/settings.ts",
  `        xai: Boolean(configuredAiApiKey(settings, "xai")),`,
  `        xai: Boolean(configuredAiApiKey(settings, "xai")),\n        nvidia: Boolean(configuredAiApiKey(settings, "nvidia")),`,
  "server/settings.ts  keySet record");

edit("lib/server/settings.ts",
  `        xai: aiKeySource("xai"),`,
  `        xai: aiKeySource("xai"),\n        nvidia: aiKeySource("nvidia"),`,
  "server/settings.ts  keySource record");

edit("components/control-center.tsx",
  `keySet: { openai: false, anthropic: false, gemini: false, xai: false, lmstudio: false, ollama: false }`,
  `keySet: { openai: false, anthropic: false, gemini: false, xai: false, nvidia: false, lmstudio: false, ollama: false }`,
  "control-center.tsx  keySet record");

edit("components/control-center.tsx",
  `keySource: { openai: "none", anthropic: "none", gemini: "none", xai: "none", lmstudio: "none", ollama: "none" }`,
  `keySource: { openai: "none", anthropic: "none", gemini: "none", xai: "none", nvidia: "none", lmstudio: "none", ollama: "none" }`,
  "control-center.tsx  keySource record");

edit("tests/ai-providers.test.ts",
  `xai: false, lmstudio: false, ollama: false`,
  `xai: false, nvidia: false, lmstudio: false, ollama: false`,
  "tests/ai-providers  noKeys");

edit("tests/ai-runtime.test.ts",
  `xai: "xai-test-key", lmstudio: ""`,
  `xai: "xai-test-key", nvidia: "nvidia-test-key", lmstudio: ""`,
  "tests/ai-runtime  apiKeys");

console.log(`\n${applied} applied, ${skipped} already in place.`);
