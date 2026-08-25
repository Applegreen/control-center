import type { ReminderItem, TaskItem, WorkspaceState } from "@/lib/types";
import { getDatabase } from "@/lib/server/database";
import { hasWorkspaceState, readWorkspaceState, writeWorkspaceState } from "@/lib/workspace-store";

export const runtime = "nodejs";

function cleanId(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : crypto.randomUUID();
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function cleanReminders(value: unknown): ReminderItem[] {
  if (!Array.isArray(value)) throw new Error("Reminders must be a list.");
  if (value.length > 10_000) throw new Error("The reminder list is too large.");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<ReminderItem>;
    const title = cleanText(candidate.title).trim();
    if (!title) return [];
    return [{
      id: cleanId(candidate.id),
      type: cleanText(candidate.type, candidate.url ? "Link" : "Saved"),
      title,
      source: cleanText(candidate.source, "Manual"),
      note: cleanText(candidate.note, "Saved for later."),
      accent: cleanText(candidate.accent, "teal"),
      url: cleanText(candidate.url) || undefined,
      createdAt: cleanText(candidate.createdAt) || undefined,
      archivedAt: cleanText(candidate.archivedAt) || undefined,
      added: cleanText(candidate.added) || undefined,
    }];
  });
}

function cleanTasks(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) throw new Error("Tasks must be a list.");
  if (value.length > 10_000) throw new Error("The task list is too large.");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<TaskItem>;
    const title = cleanText(candidate.title).trim();
    if (!title) return [];
    return [{
      id: cleanId(candidate.id),
      title,
      description: cleanText(candidate.description, "No additional details."),
      due: cleanText(candidate.due, "Today"),
      recurrence: cleanText(candidate.recurrence, "One-time"),
      priority: cleanText(candidate.priority, "Normal"),
      done: candidate.done === true,
      createdAt: cleanText(candidate.createdAt) || undefined,
    }];
  });
}

export async function GET() {
  try {
    const database = getDatabase();
    return Response.json({ ...readWorkspaceState(database), initialized: hasWorkspaceState(database) });
  } catch {
    return Response.json(
      { error: "Tasks and reminders could not be read safely. Restore the local database from a backup before making changes." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Partial<WorkspaceState>;
    const state: WorkspaceState = {
      reminders: cleanReminders(body.reminders),
      tasks: cleanTasks(body.tasks),
    };
    return Response.json(writeWorkspaceState(getDatabase(), state));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the local workspace." }, { status: 400 });
  }
}
