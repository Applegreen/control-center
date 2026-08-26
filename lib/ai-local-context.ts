import { AI_PROVIDER_LABELS } from "./ai-providers";
import type { LocalAiProvider } from "./types";

// There is no shared tokenizer across arbitrary local models. One token per
// UTF-8 byte deliberately overestimates ordinary prose; reserve extra space for
// the chat template plus all requested output. This is a safety budget, not an
// exact token count, and never truncates evidence or changes model allocation.
export function localAiContextBudget(prompt: string, outputTokens: number) {
  return new TextEncoder().encode(prompt).byteLength + outputTokens + 1_024;
}

export function assertLocalAiContext(
  provider: LocalAiProvider,
  contextLength: number | undefined,
  prompt: string,
  outputTokens: number,
) {
  const label = AI_PROVIDER_LABELS[provider];
  if (!contextLength || !Number.isSafeInteger(contextLength) || contextLength <= 0)
    throw new Error(`${label} did not report the loaded model's actual context capacity. Update the local server, load a text model with a reported context window, then choose Reload models. No evidence was sent for inference.`);
  const budget = localAiContextBudget(prompt, outputTokens);
  if (budget > contextLength)
    throw new Error(`${label} reports a ${contextLength.toLocaleString("en-US")}-token loaded context, below this request's conservative ${budget.toLocaleString("en-US")}-token safety budget. Reload the model with a larger context window or choose a cloud provider, then Reload models. No evidence was truncated or sent for inference.`);
  return contextLength;
}
