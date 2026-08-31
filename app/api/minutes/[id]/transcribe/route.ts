import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import { getMinute } from "@/lib/server/minutes-db";
import { startTranscription } from "@/lib/server/minutes-ai";
import { dataDirectory } from "@/lib/server/settings";

export const runtime = "nodejs";

/** 2GB. An hour of uncompressed WAV is roughly 600MB and a screen recording of a
 *  call can be larger still, so the ceiling is about catching mistakes rather
 *  than saving memory — the body is streamed to disk, never held in RAM. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

const ALLOWED = /\.(mp3|m4a|mp4|wav|webm|ogg|oga|flac|aac|mov|mkv|aiff|aif|wma)$/i;

type Context = { params: Promise<{ id: string }> };

function safeName(raw: string) {
  const base = path.basename(raw || "").replace(/[^\w.\- ]+/g, "_").trim();
  return base.slice(0, 180) || "recording.m4a";
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const minute = getMinute(id);
  if (!minute) return Response.json({ error: "Minute not found." }, { status: 404 });
  if (minute.status === "transcribing") {
    return Response.json({ error: "This meeting is already being transcribed." }, { status: 409 });
  }

  const filename = safeName(new URL(request.url).searchParams.get("filename") || "");
  if (!ALLOWED.test(filename)) {
    return Response.json(
      { error: "Unsupported file type. Use mp3, m4a, wav, webm, ogg, flac, mp4, mov or mkv." },
      { status: 415 },
    );
  }
  if (!request.body) {
    return Response.json({ error: "No audio was uploaded." }, { status: 400 });
  }

  // Declared size, when the browser sends it, lets us reject early rather than
  // after writing gigabytes to disk.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > MAX_BYTES) {
    return Response.json(
      { error: `That file is ${Math.round(declared / 1e6)}MB. The limit is 2GB.` },
      { status: 413 },
    );
  }

  const uploadDir = path.join(dataDirectory(), "minute-uploads");
  const target = path.join(uploadDir, `${id}-${randomUUID()}-${filename}`);

  try {
    await mkdir(uploadDir, { recursive: true, mode: 0o700 });

    // Stream request -> disk. Memory stays flat regardless of file size.
    let written = 0;
    const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on("data", (chunk: Buffer) => {
      written += chunk.length;
      if (written > MAX_BYTES) source.destroy(new Error("TOO_LARGE"));
    });
    await pipeline(source, createWriteStream(target, { mode: 0o600 }));

    const info = await stat(target);
    if (info.size === 0) {
      await unlink(target).catch(() => {});
      return Response.json({ error: "That file is empty." }, { status: 400 });
    }

    startTranscription(id, target, filename);

    return Response.json({
      ok: true,
      status: "transcribing",
      bytes: info.size,
      note: "Transcription started. On this hardware expect roughly 45 minutes per hour of audio.",
    });
  } catch (error) {
    await unlink(target).catch(() => {});
    const message = error instanceof Error ? error.message : "Upload failed.";
    if (message === "TOO_LARGE") {
      return Response.json({ error: "That file is over the 2GB limit." }, { status: 413 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
