"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SECTIONS,
  PROPOSAL_STATUSES,
  PROPOSAL_UNITS,
  formatMoney,
  formatProposalDate,
  kindLabel,
  lineTotal,
  parseMoneyToCents,
  proposalIsExpired,
  proposalTotals,
  statusLabel,
  type Proposal,
  type ProposalItem,
  type ProposalKind,
  type ProposalSection,
  type ProposalStatus,
  type ProposalSummary,
} from "@/lib/proposals";

type Draft = Proposal;

const STATUS_CLASS: Record<ProposalStatus, string> = {
  draft: "label",
  sent: "label label-brief",
  accepted: "label label-positive",
  declined: "label label-watch",
};

export function ProposalsView() {
  const [list, setList] = useState<ProposalSummary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/proposals");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load proposals.");
      setList(payload.proposals || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load proposals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function create(kind: ProposalKind) {
    setBusy(true);
    try {
      const response = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create.");
      setDraft(payload.proposal);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create.");
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/proposals/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not open.");
      setDraft(payload.proposal);
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
      const response = await fetch(`/api/proposals/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save.");
      setDraft(payload.proposal);
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
      await fetch(`/api/proposals/${id}`, { method: "DELETE" });
      if (draft?.id === id) setDraft(null);
      setConfirmDelete("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/proposals/${id}`, { method: "POST" });
      const payload = await response.json();
      if (response.ok) {
        setDraft(payload.proposal);
        setNotice("Duplicated.");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function patch(changes: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  const totals = useMemo(
    () =>
      draft
        ? proposalTotals(draft)
        : { subtotal: 0, discount: 0, net: 0, vat: 0, total: 0 },
    [draft],
  );

  // ---------- list ----------

  if (!draft) {
    return (
      <div className="view">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Business development</p>
            <h1>Proposals &amp; quotes</h1>
            <p className="page-description">
              Build a proposal or quotation, then export it as a PDF, Word document,
              PowerPoint deck, or share it as a link.
            </p>
          </div>
          <div className="toolbar-actions">
            <button className="button button-ghost" disabled={busy} onClick={() => create("quote")}>
              New quotation
            </button>
            <button className="button button-primary" disabled={busy} onClick={() => create("proposal")}>
              New proposal
            </button>
          </div>
        </div>

        {error ? <p className="error-notice">{error}</p> : null}

        <div className="panel dc-proposal-panel">
          {loading ? (
            <p className="empty-state">Loading proposals…</p>
          ) : list.length === 0 ? (
            <p className="empty-state">
              No proposals yet. Create one above — it starts from the Digital Characters
              company boilerplate, so you only fill in the client and the scope.
            </p>
          ) : (
            <table className="dc-proposal-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Client</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th className="dc-num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button className="text-button" onClick={() => open(row.id)}>
                        {row.number}
                      </button>
                      <span className="dc-sub">{kindLabel(row.kind)}</span>
                    </td>
                    <td>{row.clientName || <span className="dc-sub">—</span>}</td>
                    <td>{row.projectTitle || <span className="dc-sub">—</span>}</td>
                    <td>
                      <span className={STATUS_CLASS[row.status]}>{statusLabel(row.status)}</span>
                      {proposalIsExpired(row) && row.status === "sent" ? (
                        <span className="label label-watch">Expired</span>
                      ) : null}
                    </td>
                    <td className="dc-num">{formatMoney(row.total, row.currency)}</td>
                    <td className="dc-row-actions">
                      <button className="text-button" onClick={() => duplicate(row.id)}>
                        Duplicate
                      </button>
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
          )}
        </div>
      </div>
    );
  }

  // ---------- editor ----------

  const shareUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/p/${draft.token}`;

  return (
    <div className="view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {kindLabel(draft.kind)} · {draft.number}
          </p>
          <h1>{draft.projectTitle || "Untitled"}</h1>
          <p className="page-description">
            {draft.clientName ? `For ${draft.clientName}. ` : ""}
            Last saved {formatProposalDate(draft.updatedAt)}.
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
          <h3>Client &amp; document</h3>
        </div>
        <div className="dc-field-grid">
          <label className="settings-field">
            <span>Client name</span>
            <input value={draft.clientName} onChange={(e) => patch({ clientName: e.target.value })} />
          </label>
          <label className="settings-field">
            <span>Contact person</span>
            <input value={draft.clientContact} onChange={(e) => patch({ clientContact: e.target.value })} />
          </label>
          <label className="settings-field">
            <span>Contact email</span>
            <input type="email" value={draft.clientEmail} onChange={(e) => patch({ clientEmail: e.target.value })} />
          </label>
          <label className="settings-field">
            <span>Project title</span>
            <input value={draft.projectTitle} onChange={(e) => patch({ projectTitle: e.target.value })} />
          </label>
          <label className="settings-field">
            <span>Status</span>
            <select value={draft.status} onChange={(e) => patch({ status: e.target.value as ProposalStatus })}>
              {PROPOSAL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>Valid until</span>
            <input type="date" value={draft.validUntil} onChange={(e) => patch({ validUntil: e.target.value })} />
          </label>
        </div>
        <label className="settings-field">
          <span>Client postal address — one line each, shown in the &ldquo;To:&rdquo; block</span>
          <textarea
            rows={4}
            value={draft.clientAddress}
            placeholder={"Glen Manor Office Park, 138\nFrikkie De Beer Street\nSuite 1/G Building 4, Menlyn\nPretoria 0081"}
            onChange={(e) => patch({ clientAddress: e.target.value })}
          />
        </label>
        <label className="settings-field">
          <span>One-line summary</span>
          <textarea rows={2} value={draft.summary} onChange={(e) => patch({ summary: e.target.value })} />
        </label>
      </div>

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Narrative</h3>
          <button
            className="button button-ghost"
            onClick={() =>
              patch({
                sections: [
                  ...draft.sections,
                  { id: `new-${Date.now()}`, position: draft.sections.length, heading: "", body: "" },
                ],
              })
            }
          >
            Add section
          </button>
        </div>
        {draft.sections.length === 0 ? (
          <p className="empty-state">
            No sections.{" "}
            <button
              className="text-button"
              onClick={() =>
                patch({
                  sections: DEFAULT_SECTIONS.map((section, index) => ({
                    id: `default-${index}`,
                    position: index,
                    ...section,
                  })),
                })
              }
            >
              Restore the standard set
            </button>
            .
          </p>
        ) : (
          draft.sections.map((section, index) => (
            <div className="dc-section-row" key={section.id}>
              <div className="dc-section-head">
                <input
                  className="dc-heading-input"
                  value={section.heading}
                  placeholder="Section heading"
                  onChange={(e) => {
                    const sections = [...draft.sections];
                    sections[index] = { ...section, heading: e.target.value };
                    patch({ sections });
                  }}
                />
                <button
                  className="text-button dc-danger"
                  onClick={() =>
                    patch({ sections: draft.sections.filter((_, i) => i !== index) })
                  }
                >
                  Remove
                </button>
              </div>
              <textarea
                rows={4}
                value={section.body}
                placeholder="Write this section…"
                onChange={(e) => {
                  const sections = [...draft.sections];
                  sections[index] = { ...section, body: e.target.value };
                  patch({ sections });
                }}
              />
            </div>
          ))
        )}
      </div>

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Line items</h3>
          <button
            className="button button-ghost"
            onClick={() =>
              patch({
                items: [
                  ...draft.items,
                  {
                    id: `new-${Date.now()}`,
                    position: draft.items.length,
                    description: "",
                    detail: "",
                    quantity: 1,
                    unit: "item",
                    unitRate: 0,
                  },
                ],
              })
            }
          >
            Add item
          </button>
        </div>

        {draft.items.length === 0 ? (
          <p className="empty-state">No line items yet.</p>
        ) : (
          <table className="dc-proposal-table dc-items">
            <thead>
              <tr>
                <th>Description</th>
                <th className="dc-num">Qty</th>
                <th>Unit</th>
                <th className="dc-num">Rate</th>
                <th className="dc-num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item, index) => {
                const update = (changes: Partial<ProposalItem>) => {
                  const items = [...draft.items];
                  items[index] = { ...item, ...changes };
                  patch({ items });
                };
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        value={item.description}
                        placeholder="e.g. 2D animation production"
                        onChange={(e) => update({ description: e.target.value })}
                      />
                      <input
                        className="dc-detail-input"
                        value={item.detail}
                        placeholder="Optional detail shown beneath"
                        onChange={(e) => update({ detail: e.target.value })}
                      />
                    </td>
                    <td className="dc-num">
                      <input
                        className="dc-qty"
                        type="number"
                        step="0.25"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => update({ quantity: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <select value={item.unit} onChange={(e) => update({ unit: e.target.value })}>
                        {PROPOSAL_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="dc-num">
                      <input
                        className="dc-rate"
                        defaultValue={(item.unitRate / 100).toFixed(2)}
                        onBlur={(e) => {
                          const cents = parseMoneyToCents(e.target.value);
                          e.target.value = (cents / 100).toFixed(2);
                          update({ unitRate: cents });
                        }}
                      />
                    </td>
                    <td className="dc-num dc-amount">{formatMoney(lineTotal(item), draft.currency)}</td>
                    <td>
                      <button
                        className="text-button dc-danger"
                        onClick={() => patch({ items: draft.items.filter((_, i) => i !== index) })}
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

        <div className="dc-totals">
          <div className="dc-rate-inputs">
            <label className="settings-field">
              <span>Discount %</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={draft.discountRate}
                onChange={(e) => patch({ discountRate: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="settings-field">
              <span>VAT %</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={draft.vatRate}
                onChange={(e) => patch({ vatRate: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <dl className="dc-total-lines">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(totals.subtotal, draft.currency)}</dd>
            </div>
            {totals.discount > 0 ? (
              <div>
                <dt>Discount</dt>
                <dd>−{formatMoney(totals.discount, draft.currency)}</dd>
              </div>
            ) : null}
            <div>
              <dt>VAT ({draft.vatRate}%)</dt>
              <dd>{formatMoney(totals.vat, draft.currency)}</dd>
            </div>
            <div className="dc-grand">
              <dt>Total</dt>
              <dd>{formatMoney(totals.total, draft.currency)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Terms</h3>
        </div>
        <textarea
          rows={7}
          value={draft.terms}
          onChange={(e) => patch({ terms: e.target.value })}
        />
      </div>

      <div className="panel dc-proposal-panel">
        <div className="panel-header">
          <h3>Export &amp; share</h3>
        </div>
        <p className="page-description">
          Save first — exports are generated from the saved version, not what is on screen.
        </p>
        <div className="dc-export-row">
          <a className="button button-primary" href={`/api/proposals/${draft.id}/export?format=pdf`}>
            PDF
          </a>
          <a className="button button-ghost" href={`/api/proposals/${draft.id}/export?format=docx`}>
            Word
          </a>
          <a className="button button-ghost" href={`/api/proposals/${draft.id}/export?format=pptx`}>
            PowerPoint
          </a>
          <a className="button button-ghost" href={`/p/${draft.token}`} target="_blank" rel="noreferrer">
            Open web version
          </a>
        </div>
        <label className="settings-field">
          <span>Shareable link — anyone with this URL can view the proposal</span>
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
        </label>
      </div>
    </div>
  );
}

export default ProposalsView;
