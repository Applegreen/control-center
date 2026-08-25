import "server-only";

import type { AiKeyProvider } from "@/lib/types";
import {
  configuredAiApiKey,
  type StoredSettings,
} from "@/lib/server/settings";

const DEFAULT_MODELS: Record<AiKeyProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-3.7-flash",
};

export type AiRunOptions = {
  prompt: string;
  webSearch?: boolean;
  maxOutputTokens?: number;
};

export type AiRunResult = {
  provider: AiKeyProvider;
  model: string;
  text: string;
};

export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

function modelFor(settings: StoredSettings, provider: AiKeyProvider) {
  return settings.ai.model.trim() || DEFAULT_MODELS[provider];
}

function boundedTokens(value = 4_000) {
  return Math.min(8_000, Math.max(500, Math.round(value)));
}

async function providerFetch(
  provider: AiKeyProvider,
  url: string,
  init: RequestInit,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `${provider} returned HTTP ${response.status}. Check the saved key, model, and provider access.`,
      );
    }
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(`${provider} timed out before completing the background task.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function openAiText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    return content.flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("\n");
}

function anthropicText(payload: Record<string, unknown>) {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const text = (block as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  }).join("\n");
}

function geminiText(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") return [];
    const parts = Array.isArray((content as { parts?: unknown }).parts)
      ? (content as { parts: unknown[] }).parts
      : [];
    return parts.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("\n");
}

async function runOpenAi(
  key: string,
  model: string,
  options: AiRunOptions,
) {
  const payload = await providerFetch("openai", "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: options.prompt,
      store: false,
      max_output_tokens: boundedTokens(options.maxOutputTokens),
      ...(/^(?:gpt-5|o\d)/i.test(model)
        ? { reasoning: { effort: "low" } }
        : {}),
      ...(options.webSearch ? { tools: [{ type: "web_search" }] } : {}),
    }),
  });
  return openAiText(payload);
}

async function runAnthropic(
  key: string,
  model: string,
  options: AiRunOptions,
) {
  const body = {
    model,
    max_tokens: boundedTokens(options.maxOutputTokens),
    messages: [{ role: "user", content: options.prompt }],
    ...(options.webSearch
      ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }] }
      : {}),
  };
  let payload = await providerFetch("anthropic", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (payload.stop_reason === "pause_turn" && Array.isArray(payload.content)) {
    payload = await providerFetch("anthropic", "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        messages: [
          ...body.messages,
          { role: "assistant", content: payload.content },
        ],
      }),
    });
  }
  return anthropicText(payload);
}

async function runGemini(
  key: string,
  model: string,
  options: AiRunOptions,
) {
  const safeModel = encodeURIComponent(model);
  const payload = await providerFetch(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: boundedTokens(options.maxOutputTokens),
        },
        ...(options.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
      }),
    },
  );
  return geminiText(payload);
}

export async function runConfiguredAi(
  settings: StoredSettings,
  options: AiRunOptions,
): Promise<AiRunResult> {
  const provider = settings.ai.provider;
  if (provider === "none")
    throw new AiNotConfiguredError("AI curation is off in Settings.");
  const key = configuredAiApiKey(settings, provider);
  if (!key)
    throw new AiNotConfiguredError(
      `${provider} is selected, but no API key is available in Settings or the local environment.`,
    );
  const model = modelFor(settings, provider);
  const text = provider === "openai"
    ? await runOpenAi(key, model, options)
    : provider === "anthropic"
      ? await runAnthropic(key, model, options)
      : await runGemini(key, model, options);
  if (!text.trim()) throw new Error(`${provider} returned no usable text.`);
  return { provider, model, text };
}

export function parseAiJson<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [trimmed, fenced].filter((value): value is string => Boolean(value));
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace)
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket)
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next bounded JSON representation.
    }
  }
  throw new Error("The AI provider returned invalid JSON.");
}
