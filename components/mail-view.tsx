"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Send, Trash2, X } from "lucide-react";

type MailAccountSummary = {
  id: string;
  label: string;
  user: string;
  count: number;
  unread: number;
  ok: boolean;
};

type MailMessage = {
  accountId: string;
  accountLabel: string;
  uid: number;
  from: string;
  fromName: string;
  subject: string;
  messageId: string;
  date: string;
  unread: boolean;
  flagged: boolean;
};

type MailResponse = {
  configured: boolean;
  checkedAt: string;
  accounts: MailAccountSummary[];
  items: MailMessage[];
  errors: string[];
};

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const difference = Date.now() - date.getTime();
  if (difference < 60 * 60 * 1000)
    return `${Math.max(1, Math.round(difference / 60_000))} min ago`;
  if (difference < 24 * 60 * 60 * 1000)
    return `${Math.round(difference / (60 * 60 * 1000))} hr ago`;
  return date.toLocaleDateString();
}

export function MailView() {
  const [data, setData] = useState<MailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [account, setAccount] = useState("all");
  const [draft, setDraft] = useState<{
    accountId: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/live/mail", { cache: "no-store" });
      if (!response.ok) throw new Error(`Mailbox check failed (${response.status}).`);
      setData((await response.json()) as MailResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mailbox check failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(async () => {
    if (!draft) return;
    setSending(true);
    setSendResult("");
    try {
      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Send failed.");
      setSendResult("Sent.");
      setDraft(null);
    } catch (caught) {
      setSendResult(caught instanceof Error ? caught.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }, [draft]);

  const remove = useCallback(
    async (accountId: string, uid: number) => {
      const key = `${accountId}-${uid}`;
      setDeleting(key);
      setSendResult("");
      try {
        const response = await fetch("/api/mail/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, uid }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Delete failed.");
        setConfirmDelete("");
        setData((current) =>
          current
            ? { ...current, items: current.items.filter((item) => `${item.accountId}-${item.uid}` !== key) }
            : current,
        );
        setSendResult("Moved to Trash.");
      } catch (caught) {
        setSendResult(caught instanceof Error ? caught.message : "Delete failed.");
      } finally {
        setDeleting("");
      }
    },
    [],
  );

  const items = (data?.items || []).filter(
    (message) => account === "all" || message.accountId === account,
  );

  return (
    <div className="view">
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Mailbox triage</p>
          <h1>Email</h1>
          <p className="page-description">
            Recent arrivals across your mailboxes. You write and you send — nothing goes out
            on its own.
          </p>
        </div>
        <div className="mail-actions">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              setSendResult("");
              setDraft({
                accountId: data?.accounts?.[0]?.id || "",
                to: "",
                subject: "",
                text: "",
                inReplyTo: "",
              });
            }}
            disabled={!data?.accounts?.length}
          >
            <Send size={15} /> Compose
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={15} /> {loading ? "Checking…" : "Check mail"}
          </button>
        </div>
      </div>

      {data && !data.configured && (
        <section className="panel reveal mail-panel">
          <p>
            No mailboxes configured. Add <code>MAIL_HOST</code>, <code>MAIL_USER_1</code> and{" "}
            <code>MAIL_PASS_1</code> to <code>/etc/control-center.env</code>, then restart the service.
          </p>
        </section>
      )}

      {error && (
        <section className="panel reveal mail-panel">
          <p>{error}</p>
        </section>
      )}

      {data?.errors?.length ? (
        <section className="panel reveal mail-panel">
          <b>Some mailboxes could not be read</b>
          {data.errors.map((message) => (
            <p key={message}>
              <small>{message}</small>
            </p>
          ))}
        </section>
      ) : null}

      {data?.accounts?.length ? (
        <div className="source-status-grid reveal">
          {data.accounts.map((summary) => (
            <div
              className={`source-status ${summary.ok ? "" : "status-changed"}`}
              key={summary.id}
            >
              <span>
                <Mail size={13} />
                <b>{summary.label}</b>
              </span>
              <span>{summary.ok ? `${summary.unread} unread` : "Unavailable"}</span>
              <p>
                {summary.user}
                {summary.ok ? ` · ${summary.count} recent` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {data?.accounts?.length ? (
        <div className="feed-sort-bar reveal">
          <label htmlFor="mail-account-filter">Mailbox</label>
          <select
            id="mail-account-filter"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          >
            <option value="all">All mailboxes</option>
            {data.accounts.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {summary.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {sendResult && !draft ? (
        <section className="panel reveal mail-panel">
          <p>{sendResult}</p>
        </section>
      ) : null}

      {draft ? (
        <section className="panel reveal mail-composer">
          <div className="mail-composer-head">
            <b>New message</b>
            <button type="button" className="text-button" onClick={() => setDraft(null)}>
              <X size={13} /> Discard
            </button>
          </div>
          <label htmlFor="mail-from">From</label>
          <select
            id="mail-from"
            value={draft.accountId}
            onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}
          >
            {(data?.accounts || []).map((summary) => (
              <option key={summary.id} value={summary.id}>
                {summary.user}
              </option>
            ))}
          </select>
          <label htmlFor="mail-to">To</label>
          <input
            id="mail-to"
            type="email"
            autoComplete="off"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
          <label htmlFor="mail-subject">Subject</label>
          <input
            id="mail-subject"
            type="text"
            autoComplete="off"
            value={draft.subject}
            onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
          />
          <label htmlFor="mail-body">Message</label>
          <textarea
            id="mail-body"
            rows={9}
            value={draft.text}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          />
          {sendResult ? <p>{sendResult}</p> : null}
          <button
            type="button"
            className="button button-primary"
            onClick={() => void send()}
            disabled={sending || !draft.to || !draft.subject || !draft.text}
          >
            <Send size={15} /> {sending ? "Sending…" : "Send"}
          </button>
        </section>
      ) : null}

      <section className="panel reveal mail-list">
        {loading && !data ? <p>Opening mailboxes…</p> : null}
        {!loading && data?.configured && !items.length ? <p>Nothing recent.</p> : null}
        {items.map((message) => (
          <article key={`${message.accountId}-${message.uid}`} className="mail-row">
            <div>
              <b>{message.fromName}</b>{" "}
              <small>
                {message.accountLabel} · {when(message.date)}
              </small>
              <p>{message.subject}</p>
            </div>
            <div className="mail-row-actions">
              {message.unread ? <span className="mail-unread">NEW</span> : null}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSendResult("");
                  setDraft({
                    accountId: message.accountId,
                    to: message.from,
                    subject: message.subject.toLowerCase().startsWith("re:")
                      ? message.subject
                      : `Re: ${message.subject}`,
                    text: "",
                    inReplyTo: message.messageId,
                  });
                }}
              >
                Reply
              </button>
              {confirmDelete === `${message.accountId}-${message.uid}` ? (
                <>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={deleting === `${message.accountId}-${message.uid}`}
                    onClick={() => void remove(message.accountId, message.uid)}
                  >
                    {deleting === `${message.accountId}-${message.uid}`
                      ? "Moving…"
                      : "Confirm"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setConfirmDelete("")}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="text-button danger"
                  aria-label="Move to Trash"
                  onClick={() => setConfirmDelete(`${message.accountId}-${message.uid}`)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
