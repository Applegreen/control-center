"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";

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

  const items = (data?.items || []).filter(
    (message) => account === "all" || message.accountId === account,
  );

  return (
    <>
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Mailbox triage</p>
          <h1>Email</h1>
          <p className="page-description">
            Recent arrivals across your mailboxes, read-only. Compose and reply in webmail.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} /> {loading ? "Checking…" : "Check mail"}
        </button>
      </div>

      {data && !data.configured && (
        <section className="panel reveal">
          <p>
            No mailboxes configured. Add <code>MAIL_HOST</code>, <code>MAIL_USER_1</code> and{" "}
            <code>MAIL_PASS_1</code> to <code>/etc/control-center.env</code>, then restart the service.
          </p>
        </section>
      )}

      {error && (
        <section className="panel reveal">
          <p>{error}</p>
        </section>
      )}

      {data?.errors?.length ? (
        <section className="panel reveal">
          <b>Some mailboxes could not be read</b>
          {data.errors.map((message) => (
            <p key={message}>
              <small>{message}</small>
            </p>
          ))}
        </section>
      ) : null}

      {data?.accounts?.length ? (
        <div className="source-grid reveal">
          {data.accounts.map((summary) => (
            <section className="panel" key={summary.id}>
              <b>
                <Mail size={14} /> {summary.label}
              </b>
              <p>
                <small>{summary.user}</small>
              </p>
              <p>
                {summary.ok ? `${summary.unread} unread of ${summary.count}` : "Unavailable"}
              </p>
            </section>
          ))}
        </div>
      ) : null}

      {data?.accounts?.length ? (
        <div className="reveal" style={{ margin: "18px 0" }}>
          <label htmlFor="mail-account-filter">Mailbox&nbsp;</label>
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

      <section className="panel reveal">
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
            {message.unread ? <span className="mail-unread">NEW</span> : null}
          </article>
        ))}
      </section>
    </>
  );
}
