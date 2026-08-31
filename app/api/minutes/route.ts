import {
  createMinute,
  listCompanies,
  listMinutes,
  listOpenTasks,
  setTaskDone,
} from "@/lib/server/minutes-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({
      minutes: listMinutes(),
      openTasks: listOpenTasks(),
      companies: listCompanies(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read minutes." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      company?: string;
      title?: string;
      meetingDate?: string;
    };
    return Response.json({ minute: createMinute(body) }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create the minute." },
      { status: 400 },
    );
  }
}

/** Tick or untick a single task from the cross-company deadline list, where no
 *  meeting editor is open to submit the whole task list. */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { taskId?: string; done?: boolean };
    if (!body.taskId || typeof body.done !== "boolean") {
      return Response.json({ error: "A task ID and done state are required." }, { status: 400 });
    }
    if (!setTaskDone(body.taskId, body.done)) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }
    return Response.json({ ok: true, openTasks: listOpenTasks(), minutes: listMinutes() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update the task." },
      { status: 400 },
    );
  }
}
