import "server-only";

import { getMinute, updateMinute } from "@/lib/server/minutes-db";
import { summarisationPrompt, type Minute, type MinuteTask } from "@/lib/minutes";

// Two external calls live here: the Whisper container for transcription, and
// Ollama for summarisation. Both are loopback-only services on this host.
//
// Transcription runs in the BACKGROUND. On these two cores Whisper `base` runs at
// roughly 0.7x real time, so an hour of audio takes about 45 minutes - well past
// nginx's 900s proxy_read_timeout. Holding the upload request open would guarantee
// a 504 on anything longer than about twenty minutes of audio. Instead the upload
// returns immediately, the row is marked "transcribing", and the UI polls.

const WHISPER_URL = (process.env.WHISPER_URL || "http://127.0.0.1:9000").replace(/\/+$/, "");
const WHISPER_KEY = (process.env.WHISPER_API_KEY || "").trim();
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = (process.env.MINUTES_SUMMARY_MODEL || "qwen3.5-2b-ctx16k:latest").trim();

/** Guard against a runaway job pinning the CPU forever. Four hours covers a very
 *  long recording at this speed and still terminates. */
const TRANSCRIBE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SUMMARY_TIMEOUT_MS = 15 * 60 * 1000;

export type TranscriptionResult = { text: string; duration: number };

export async function transcribeAudio(
  audio: Uint8Array,
  filename: string,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", new Blob([audio as BlobPart]), filename || "recording.m4a");
  form.append("model", "whisper-1");
  // verbose_json gives us the duration and per-segment speaker labels.
  form.append("response_format", "verbose_json");

  const response = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
    method: "POST",
    headers: WHISPER_KEY ? { Authorization: `Bearer ${WHISPER_KEY}` } : undefined,
    body: form,
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Transcription failed (${response.status}). ${detail.slice(0, 300)}`.trim(),
    );
  }

  const payload = (await response.json()) as {
    text?: string;
    duration?: number;
    segments?: { text?: string; speaker?: string }[];
  };

  // Rebuild the transcript with a speaker label each time the speaker changes,
  // rather than on every segment - much easier to read and to correct by hand.
  let text = (payload.text || "").trim();
  if (Array.isArray(payload.segments) && payload.segments.length) {
    const lines: string[] = [];
    let current = "";
    for (const segment of payload.segments) {
      const body = (segment.text || "").trim();
      if (!body) continue;
      const speaker = (segment.speaker || "").trim();
      if (speaker && speaker !== current) {
        current = speaker;
        lines.push(`\n[${speaker}] ${body}`);
      } else {
        lines.push(body);
      }
    }
    const rebuilt = lines.join(" ").replace(/\n /g, "\n").trim();
    if (rebuilt) text = rebuilt;
  }

  return { text, duration: Number(payload.duration) || 0 };
}

/** Fire-and-forget. Marks the minute as transcribing, then writes the result
 *  (or an error note) when Whisper finishes. */
export function startTranscription(minuteId: string, audio: Uint8Array, filename: string) {
  updateMinute(minuteId, { status: "transcribing", audioFilename: filename });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);

  void (async () => {
    try {
      const result = await transcribeAudio(audio, filename, controller.signal);
      updateMinute(minuteId, {
        transcript: result.text,
        audioDuration: result.duration,
        status: "ready",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed.";
      const existing = getMinute(minuteId);
      updateMinute(minuteId, {
        status: "draft",
        notes: [existing?.notes, `Transcription failed: ${message}`]
          .filter(Boolean)
          .join("\n\n"),
      });
    } finally {
      clearTimeout(timer);
    }
  })();
}

// ---------- summarisation ----------

export type SummaryResult = {
  summary: string;
  tasks: Omit<MinuteTask, "id" | "position" | "done">[];
};

/** Models wrap JSON in prose and fences however they like. Pull out the first
 *  balanced object rather than trusting the whole reply to parse. */
function extractJson(raw: string): unknown {
  const text = raw.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = text.indexOf("{");
  if (start === -1) throw new Error("The model did not return any JSON.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("The model returned incomplete JSON.");
}

export async function summariseMinute(minute: Minute): Promise<SummaryResult> {
  const transcript = (minute.transcript || "").trim();
  if (!transcript) throw new Error("There is no transcript to summarise yet.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: summarisationPrompt(minute) },
          { role: "user", content: transcript.slice(0, 24_000) },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Ollama returned ${response.status}. ${detail.slice(0, 300)}`.trim());
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const parsed = extractJson(payload.message?.content || "") as {
      summary?: string;
      tasks?: { description?: string; owner?: string; dueDate?: string }[];
    };

    return {
      summary: String(parsed.summary || "").trim(),
      tasks: (Array.isArray(parsed.tasks) ? parsed.tasks : [])
        .map((task) => ({
          description: String(task.description || "").trim(),
          owner: String(task.owner || "").trim(),
          // Only accept a real ISO date; models like to invent "next Friday".
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(task.dueDate || ""))
            ? String(task.dueDate)
            : "",
        }))
        .filter((task) => task.description),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function transcriptionServiceUrl() {
  return WHISPER_URL;
}
