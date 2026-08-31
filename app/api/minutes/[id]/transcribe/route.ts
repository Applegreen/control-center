import { getMinute } from "@/lib/server/minutes-db";
import { startTranscription } from "@/lib/server/minutes-ai";

export const runtime = "nodejs";

/** Recordings are large; anything past this is almost certainly a mistake.
 *  An hour of decent-quality m4a is roughly 30MB. */
const MAX_BYTES = 300 * 1024 * 1024;

const ALLOWED = /\.(mp3|m4a|mp4|wav|webm|ogg|oga|flac|aac|mov|mkv)$/i;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const minute = getMinute(id);
  if (!minute) return Response.json({ error: "Minute not found." }, { status: 404 });
  if (minute.status === "transcribing") {
    return Response.json(
      { error: "This meeting is already being transcribed." },
      { status: 409 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "No audio file was uploaded." }, { status: 400 });
    }
    if (file.size === 0) {
      return Response.json({ error: "That file is empty." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json(
        { error: `That file is ${Math.round(file.size / 1e6)}MB. The limit is 300MB.` },
        { status: 413 },
      );
    }
    if (!ALLOWED.test(file.name)) {
      return Response.json(
        { error: "Unsupported file type. Use mp3, m4a, wav, webm, ogg, flac, mp4 or mov." },
        { status: 415 },
      );
    }

    const audio = new Uint8Array(await file.arrayBuffer());

    // Returns immediately - transcription continues in the background and the
    // UI polls for status. See the note in minutes-ai.ts about nginx timeouts.
    startTranscription(id, audio, file.name);

    return Response.json({
      ok: true,
      status: "transcribing",
      note: "Transcription started. On this hardware expect roughly 45 minutes per hour of audio.",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not start transcription." },
      { status: 400 },
    );
  }
}
