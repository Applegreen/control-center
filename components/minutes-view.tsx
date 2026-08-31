"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MINUTE_STATUSES,
  dueLabel,
  dueTone,
  formatDuration,
  formatMeetingDate,
  groupByCompany,
  statusLabel,
  type Minute,
  type MinuteStatus,
  type MinuteSummaryRow,
  type MinuteTask,
  type OpenTask,
} from "@/lib/minutes";

const STATUS_CLASS: Record<MinuteStatus, string> = {
  draft: "label",
  transcribing: "label label-watch",
  ready: "label label-positive",
  archived: "label",
};

const TONE_CLASS: Record<string, string> = {
  overdue: "label label-high",
  soon: "label label-watch",
  later: "label",
  none: "label",
  done: "label label-positive",
};

type UploadProgress = { percent: number; loaded: number; total: number };

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}KB`;
  return `${bytes}B`;
}

/**
 * fetch() gives no upload progress - there is no onprogress equivalent and the
 * request streams opaquely. XMLHttpRequest still does, so it is the right tool
 * here despite being the older API.
 */
function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ note?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress({
        percent: Math.round((event.loaded / event.total) * 100),
        loaded: event.loaded,
        total: event.total,
      });
    };
    xhr.onload = () => {
      let payload: { note?: string; error?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        // A non-JSON body means something upstream rejected it - nginx returns
        // an HTML page for 413 Request Entity Too Large, for instance.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else if (xhr.status === 413)
        reject(new Error("The server rejected the file as too large."));
      else reject(new Error(payload.error || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — the connection dropped."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    // Raw body, not multipart: the server streams it straight to disk without
    // buffering, so file size is limited by disk rather than memory.
    xhr.send(file);
  });
}

export function MinutesView() {
  const [minutes, setMinutes] = useState<MinuteSummaryRow[]>([]);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [draft, setDraft] = useState<Minute | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [tab, setTab] = useState<"meetings" | "deadlines">("meetings");
  const [proposed, setProposed] = useState<{ summary: string; tasks: Omit<MinuteTask, "id" | "position" | "done">[] } | null>(null);
  const [upload_, setUpload] = useState<UploadProgress | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/minutes");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load minutes.");
      setMinutes(payload.minutes || []);
      setOpenTasks(payload.openTasks || []);
      setCompanies(payload.companies || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load minutes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Poll while anything is transcribing. Whisper runs in the background, so this
  // is how the UI learns it finished.
  const anyTranscribing =
    minutes.some((row) => row.status === "transcribing") || draft?.status === "transcribing";
  useEffect(() => {
    if (!anyTranscribing) return;
    const timer = setInterval(() => {
      void refresh();
      if (draft) {
        void fetch(`/api/minutes/${draft.id}`)
          .then((r) => r.json())
          .then((p) => {
            if (p.minute) setDraft((current) => (current?.id === p.minute.id ? p.minute : current));
          })
          .catch(() => {});
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [anyTranscribing, draft, refresh]);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create.");
      setDraft(payload.minute);
      setProposed(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create.");
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setBusy(true);
    setProposed(null);
    try {
      const response = await fetch(`/api/minutes/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not open.");
      setDraft(payload.minute);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/minutes/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save.");
      setDraft(payload.minute);
      setNotice("Saved.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/minutes/${id}`, { method: "DELETE" });
      if (draft?.id === id) setDraft(null);
      setConfirmDelete("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(taskId: string, done: boolean) {
    const response = await fetch("/api/minutes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, done }),
    });
    const payload = await response.json();
    if (response.ok) {
      setOpenTasks(payload.openTasks || []);
      setMinutes(payload.minutes || []);
    }
  }

  async function upload(file: File) {
    if (!draft) return;
    setBusy(true);
    setError("");
    setUpload({ percent: 0, loaded: 0, total: file.size });
    try {
      const payload = await uploadWithProgress(
        `/api/minutes/${draft.id}/transcribe?filename=${encodeURIComponent(file.name)}`,
        file,
        setUpload,
      );
      setNotice(payload.note || "Transcription started.");
      await open(draft.id);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setBusy(false);
      setUpload(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function summarise() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/minutes/${draft.id}/summarise`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Summarisation failed.");
      setProposed({ summary: payload.summary || "", tasks: payload.tasks || [] });
      setNotice("Draft ready — review it before saving.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Summarisation failed.");
    } finally {
      setBusy(false);
    }
  }

  function patch(changes: Partial<Minute>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  const grouped = useMemo(() => groupByCompany(minutes), [minutes]);

  // ---------- list ----------

  if (!draft) {
    return (
      <div className="view">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Meetings</p>
            <h1>Minutes</h1>
            <p className="page-description">
              Meeting records filed by company, with the tasks and deadlines that came out
              of them. Upload a recording and it is transcribed on this server.
            </p>
          </div>
          <div className="toolbar-actions">
            <button className="button button-primary" disabled={busy} onClick={create}>
              New meeting
            </button>
          </div>
        </div>

        {error ? <p className="error-notice">{error}</p> : null}
        {notice ? <p className="save-notice">{notice}</p> : null}

        <div className="dc-minutes-tabs">
          <button
            className={tab === "meetings" ? "active" : ""}
            onClick={() => setTab("meetings")}
          >
            By company
          </button>
          <button
            className={tab === "deadlines" ? "active" : ""}
            onClick={() => setTab("deadlines")}
          >
            Deadlines ({openTasks.length})
          </button>
        </div>

        {tab === "deadlines" ? (
          <div className="panel dc-proposal-panel">
            {openTasks.length === 0 ? (
              <p className="empty-state">
                No open tasks. They appear here as you add them to meetings, soonest
                deadline first.
              </p>
            ) : (
              <ul className="dc-task-list">
                {openTasks.map((task) => (
                  <li key={task.id}>
                    <label className="dc-task-check">
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={(e) => toggleTask(task.id, e.target.checked)}
                      />
                      <span>
                        <strong>{task.description}</strong>
                        <span className="dc-sub">
                          {task.company || "Unfiled"}
                          {task.meetingTitle ? ` · ${task.meetingTitle}` : ""}
                          {task.owner ? ` · ${task.owner}` : ""}
                        </span>
                      </span>
                    </label>
                    <div className="dc-task-right">
                      {task.dueDate ? (
                        <span className={TONE_CLASS[dueTone(task.dueDate, task.done)]}>
                          {dueLabel(task.dueDate)}
                        </span>
                      ) : (
                        <span className="dc-sub">No date</span>
                      )}
                      <button className="text-button" onClick={() => open(task.minuteId)}>
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : loading ? (
          <div className="panel dc-proposal-panel">
            <p className="empty-state">Loading…</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="panel dc-proposal-panel">
            <p className="empty-state">
              No meetings recorded yet. Create one above, then either upload a recording
              or paste in notes you already have.
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <div className="panel dc-proposal-panel" key={group.company}>
              <div className="panel-header">
                <h3>{group.company}</h3>
                <span className="dc-sub">
                  {group.rows.length} meeting{group.rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <table className="dc-proposal-table">
                <thead>
                  <tr>
                    <th>Meeting</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Open tasks</th>
                    <th>Next deadline</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button className="text-button" onClick={() => open(row.id)}>
                          {row.title || "Untitled meeting"}
                        </button>
                        {row.attendees ? <span className="dc-sub">{row.attendees}</span> : null}
                      </td>
                      <td>{formatMeetingDate(row.meetingDate)}</td>
                      <td>
                        <span className={STATUS_CLASS[row.status]}>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td>
                        {row.openTaskCount > 0 ? (
                          `${row.openTaskCount} of ${row.taskCount}`
                        ) : row.taskCount > 0 ? (
                          <span className="label label-positive">All done</span>
                        ) : (
                          <span className="dc-sub">—</span>
                        )}
                      </td>
                      <td>
                        {row.nextDueDate ? (
                          <span className={TONE_CLASS[dueTone(row.nextDueDate, false)]}>
                            {dueLabel(row.nextDueDate)}
                          </span>
                        ) : (
                          <span className="dc-sub">—</span>
                        )}
                      </td>
                      <td className="dc-row-actions">
                        {confirmDelete === row.id ? (
                          <>
                            <button className="text-button dc-danger" onClick={() => remove(row.id)}>
                              Confirm
                            </button>
                            <button className="text-button" onClick={() => setConfirmDelete("")}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button className="text-button" onClick={() => setConfirmDelete(row.id)}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    );
  }

  // ---------- editor ----------

  const transcribing = draft.status === "transcribing";

  return (
    <div className="view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {draft.company || "Unfiled"} · {formatMeetingDate(draft.meetingDate)}
          </p>
          <h1>{draft.title || "Untitled meeting"}</h1>
          <p className="page-description">
            {draft.audioFilename ? `${draft.audioFilename} · ` : ""}
            {draft.audioDuration ? `${formatDuration(draft.audioDuration)} · ` : ""}
            Last saved {formatMeetingDate(draft.updatedAt.slice(0, 10))}.
          </p>
        </div>
        <div className="toolbar-actions">
          <button className="button button-ghost" onClick={() => setDraft(null)}>
            Back
          </button>
          <button className="button button-primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error ? <p className="error-notice">{error}</p> : null}
      {notice ? <p className="save-notice">{notice}</p> : null}

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Meeting</h3>
          <span className={STATUS_CLASS[draft.status]}>{statusLabel(draft.status)}</span>
        </div>
        <div className="dc-field-grid">
          <label className="settings-field">
            <span>Company</span>
            <input
              list="dc-minute-companies"
              value={draft.company}
              placeholder="e.g. SABC Education"
              onChange={(e) => patch({ company: e.target.value })}
            />
            <datalist id="dc-minute-companies">
              {companies.map((company) => (
                <option key={company} value={company} />
              ))}
            </datalist>
          </label>
          <label className="settings-field">
            <span>Meeting title</span>
            <input
              value={draft.title}
              placeholder="e.g. Season 2 commissioning discussion"
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label className="settings-field">
            <span>Date</span>
            <input
              type="date"
              value={draft.meetingDate}
              onChange={(e) => patch({ meetingDate: e.target.value })}
            />
          </label>
          <label className="settings-field">
            <span>Location</span>
            <input
              value={draft.location}
              placeholder="e.g. Teams / Media Mill"
              onChange={(e) => patch({ location: e.target.value })}
            />
          </label>
          <label className="settings-field">
            <span>Status</span>
            <select
              value={draft.status}
              onChange={(e) => patch({ status: e.target.value as MinuteStatus })}
            >
              {MINUTE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="settings-field">
          <span>Attendees</span>
          <input
            value={draft.attendees}
            placeholder="Comma separated"
            onChange={(e) => patch({ attendees: e.target.value })}
          />
        </label>
      </div>

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Recording &amp; transcript</h3>
          <div className="toolbar-actions">
            <input
              ref={fileInput}
              type="file"
              className="dc-hidden-file"
              accept=".mp3,.m4a,.mp4,.wav,.webm,.ogg,.flac,.aac,.mov,.mkv,audio/*,video/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              className="button button-ghost"
              disabled={busy || transcribing}
              onClick={() => fileInput.current?.click()}
            >
              {upload_ ? "Uploading…" : transcribing ? "Transcribing…" : "Upload recording"}
            </button>
            <button
              className="button button-ghost"
              disabled={busy || transcribing || !draft.transcript.trim()}
              onClick={summarise}
            >
              Draft summary &amp; tasks
            </button>
          </div>
        </div>

        {upload_ ? (
          <div className="dc-upload">
            <div className="dc-upload-head">
              <span>
                {upload_.percent < 100
                  ? "Uploading recording"
                  : "Upload complete — starting transcription"}
              </span>
              <strong>{upload_.percent}%</strong>
            </div>
            <div
              className="dc-upload-track"
              role="progressbar"
              aria-valuenow={upload_.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`dc-upload-fill${upload_.percent >= 100 ? " is-done" : ""}`}
                style={{ width: `${upload_.percent}%` }}
              />
            </div>
            <p className="dc-sub">
              {formatBytes(upload_.loaded)} of {formatBytes(upload_.total)}
              {upload_.percent >= 100
                ? " · the server is reading the file, this can take a moment for large recordings"
                : ""}
            </p>
          </div>
        ) : null}

        {transcribing ? (
          <p className="empty-state">
            Transcribing on the server. Roughly 45 minutes per hour of audio on this
            hardware — you can leave this page and come back, it keeps running.
          </p>
        ) : null}

        <label className="settings-field">
          <span>Transcript — edit freely, speaker labels are a starting point</span>
          <textarea
            rows={12}
            value={draft.transcript}
            placeholder="Upload a recording, or paste a transcript you already have."
            onChange={(e) => patch({ transcript: e.target.value })}
          />
        </label>
      </div>

      {proposed ? (
        <div className="panel dc-proposal-panel dc-proposed">
          <div className="panel-header">
            <div>
              <h3>Proposed by the model</h3>
              <p className="page-description">
                Nothing here is saved yet. Accept what is right, ignore what is not.
              </p>
            </div>
            <button className="text-button" onClick={() => setProposed(null)}>
              Dismiss
            </button>
          </div>
          {proposed.summary ? (
            <>
              <p className="dc-proposed-text">{proposed.summary}</p>
              <button
                className="button button-ghost"
                onClick={() => {
                  patch({ summary: proposed.summary });
                  setNotice("Summary copied in — remember to save.");
                }}
              >
                Use this summary
              </button>
            </>
          ) : (
            <p className="empty-state">The model did not produce a summary.</p>
          )}

          {proposed.tasks.length > 0 ? (
            <>
              <ul className="dc-task-list dc-proposed-tasks">
                {proposed.tasks.map((task, index) => (
                  <li key={index}>
                    <span>
                      <strong>{task.description}</strong>
                      <span className="dc-sub">
                        {task.owner || "no owner"}
                        {task.dueDate ? ` · due ${formatMeetingDate(task.dueDate)}` : " · no date"}
                      </span>
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        patch({
                          tasks: [
                            ...draft.tasks,
                            {
                              id: `proposed-${Date.now()}-${index}`,
                              position: draft.tasks.length,
                              description: task.description,
                              owner: task.owner,
                              dueDate: task.dueDate,
                              done: false,
                            },
                          ],
                        })
                      }
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
              <button
                className="button button-ghost"
                onClick={() =>
                  patch({
                    tasks: [
                      ...draft.tasks,
                      ...proposed.tasks.map((task, index) => ({
                        id: `proposed-all-${Date.now()}-${index}`,
                        position: draft.tasks.length + index,
                        description: task.description,
                        owner: task.owner,
                        dueDate: task.dueDate,
                        done: false,
                      })),
                    ],
                  })
                }
              >
                Add all {proposed.tasks.length}
              </button>
            </>
          ) : (
            <p className="empty-state">The model found no commitments in this transcript.</p>
          )}
        </div>
      ) : null}

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Summary</h3>
        </div>
        <textarea
          rows={6}
          value={draft.summary}
          placeholder="What was decided, and why."
          onChange={(e) => patch({ summary: e.target.value })}
        />
      </div>

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Tasks &amp; deadlines</h3>
          <button
            className="button button-ghost"
            onClick={() =>
              patch({
                tasks: [
                  ...draft.tasks,
                  {
                    id: `new-${Date.now()}`,
                    position: draft.tasks.length,
                    description: "",
                    owner: "",
                    dueDate: "",
                    done: false,
                  },
                ],
              })
            }
          >
            Add task
          </button>
        </div>

        {draft.tasks.length === 0 ? (
          <p className="empty-state">No tasks yet.</p>
        ) : (
          <table className="dc-proposal-table dc-items">
            <thead>
              <tr>
                <th>Done</th>
                <th>What</th>
                <th>Owner</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.tasks.map((task, index) => {
                const update = (changes: Partial<MinuteTask>) => {
                  const tasks = [...draft.tasks];
                  tasks[index] = { ...task, ...changes };
                  patch({ tasks });
                };
                return (
                  <tr key={task.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="dc-task-box"
                        checked={task.done}
                        onChange={(e) => update({ done: e.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        value={task.description}
                        placeholder="e.g. Send revised budget"
                        onChange={(e) => update({ description: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={task.owner}
                        placeholder="Who"
                        onChange={(e) => update({ owner: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        value={task.dueDate}
                        onChange={(e) => update({ dueDate: e.target.value })}
                      />
                      {task.dueDate && !task.done ? (
                        <span className={TONE_CLASS[dueTone(task.dueDate, task.done)]}>
                          {dueLabel(task.dueDate)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <button
                        className="text-button dc-danger"
                        onClick={() => patch({ tasks: draft.tasks.filter((_, i) => i !== index) })}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Notes</h3>
        </div>
        <textarea
          rows={4}
          value={draft.notes}
          placeholder="Anything else worth keeping with this record."
          onChange={(e) => patch({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}

export default MinutesView;
