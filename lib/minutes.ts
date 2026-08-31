// Shared types for meeting minutes. No server imports - used by the API routes,
// the transcription client and the browser UI alike.

export type MinuteStatus = "draft" | "transcribing" | "ready" | "archived";

export const MINUTE_STATUSES: MinuteStatus[] = [
  "draft",
  "transcribing",
  "ready",
  "archived",
];

export type MinuteTask = {
  id: string;
  position: number;
  description: string;
  /** Free text - the person responsible. Not tied to a user account. */
  owner: string;
  /** ISO date (YYYY-MM-DD), or empty when there is no deadline. */
  dueDate: string;
  done: boolean;
};

export type Minute = {
  id: string;
  /** The grouping key for the whole tab. Free text so a new client needs no setup. */
  company: string;
  title: string;
  /** ISO date (YYYY-MM-DD). */
  meetingDate: string;
  attendees: string;
  location: string;
  /** Original filename of the uploaded recording, for reference only. */
  audioFilename: string;
  /** Seconds, as reported by the transcription service. */
  audioDuration: number;
  transcript: string;
  summary: string;
  notes: string;
  status: MinuteStatus;
  createdAt: string;
  updatedAt: string;
  tasks: MinuteTask[];
};

export type MinuteSummaryRow = Pick<
  Minute,
  | "id"
  | "company"
  | "title"
  | "meetingDate"
  | "attendees"
  | "status"
  | "createdAt"
  | "updatedAt"
> & {
  taskCount: number;
  openTaskCount: number;
  /** Soonest incomplete deadline, for sorting and for the overdue badge. */
  nextDueDate: string;
  hasTranscript: boolean;
};

/** An open task lifted out of its meeting, for the cross-company deadline view. */
export type OpenTask = MinuteTask & {
  minuteId: string;
  company: string;
  meetingTitle: string;
  meetingDate: string;
};

// ---------- helpers ----------

export function statusLabel(status: MinuteStatus) {
  return {
    draft: "Draft",
    transcribing: "Transcribing",
    ready: "Ready",
    archived: "Archived",
  }[status];
}

export function formatMeetingDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDuration(seconds: number) {
  const total = Math.round(Number(seconds) || 0);
  if (total <= 0) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
}

/** Days until due. Negative means overdue. Null when there is no date. */
export function daysUntil(dueDate: string, now = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export function dueLabel(dueDate: string, now = new Date()) {
  const days = daysUntil(dueDate, now);
  if (days === null) return "";
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return "Yesterday";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 14) return `In ${days} days`;
  return formatMeetingDate(dueDate);
}

export function dueTone(dueDate: string, done: boolean, now = new Date()) {
  if (done) return "done";
  const days = daysUntil(dueDate, now);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days <= 2) return "soon";
  return "later";
}

/** Group minutes by company, companies ordered by most recent meeting. */
export function groupByCompany<T extends { company: string; meetingDate: string }>(
  rows: T[],
): { company: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = (row.company || "").trim() || "Unfiled";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return [...groups.entries()]
    .map(([company, list]) => ({
      company,
      rows: [...list].sort((a, b) => (b.meetingDate || "").localeCompare(a.meetingDate || "")),
    }))
    .sort((a, b) => {
      const latest = (group: { rows: T[] }) => group.rows[0]?.meetingDate || "";
      return latest(b).localeCompare(latest(a));
    });
}

/** Prompt used to turn a transcript into a summary and proposed tasks.
 *  Kept here so the wording is visible and editable, not buried in a route. */
export function summarisationPrompt(minute: Pick<Minute, "company" | "title" | "attendees">) {
  return [
    "You are minuting a meeting for Digital Characters, a Johannesburg animation studio.",
    minute.company ? `The meeting is with: ${minute.company}.` : "",
    minute.title ? `Meeting: ${minute.title}.` : "",
    minute.attendees ? `Attendees: ${minute.attendees}.` : "",
    "",
    "From the transcript below, produce JSON only, with no commentary, in exactly this shape:",
    '{"summary": "...", "tasks": [{"description": "...", "owner": "...", "dueDate": "YYYY-MM-DD"}]}',
    "",
    "Rules:",
    "- summary: 3 to 6 sentences covering what was decided and why.",
    "- tasks: only things someone actually committed to doing. If none, use an empty array.",
    "- owner: the name as spoken, or an empty string if unclear. Never guess.",
    "- dueDate: only if a specific date or deadline was stated. Otherwise an empty string.",
    "- Do not invent decisions, names, figures or dates that are not in the transcript.",
  ]
    .filter(Boolean)
    .join("\n");
}
