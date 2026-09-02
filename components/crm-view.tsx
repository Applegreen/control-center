"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTACT_CONSENT,
  LEAD_KINDS,
  LEAD_SOURCES,
  LEAD_STAGES,
  consentLabel,
  consentNote,
  groupByStage,
  isActive,
  kindLabel,
  pipelineValue,
  sourceLabel,
  stageLabel,
  wonValue,
  type Contact,
  type ContactConsent,
  type Lead,
  type LeadKind,
  type LeadSource,
  type LeadStage,
  type LeadSummaryRow,
} from "@/lib/crm";
import { formatMoney, parseMoneyToCents } from "@/lib/proposals";
import { dueLabel, dueTone, formatMeetingDate } from "@/lib/minutes";

const STAGE_CLASS: Record<LeadStage, string> = {
  new: "label",
  qualifying: "label label-brief",
  pitching: "label label-watch",
  proposal: "label label-watch",
  won: "label label-positive",
  lost: "label",
  parked: "label",
};

const TONE_CLASS: Record<string, string> = {
  overdue: "label label-high",
  soon: "label label-watch",
  later: "label",
  none: "label",
  done: "label label-positive",
};

export function CrmView() {
  const [leads, setLeads] = useState<LeadSummaryRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [tab, setTab] = useState<"pipeline" | "contacts">("pipeline");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/crm");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load.");
      setLeads(payload.leads || []);
      setContacts(payload.contacts || []);
      setCompanies(payload.companies || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load.");
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

  async function create(type: "lead" | "contact") {
    setBusy(true);
    try {
      const response = await fetch("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create.");
      if (type === "lead") setLead(payload.lead);
      else setContact(payload.contact);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create.");
    } finally {
      setBusy(false);
    }
  }

  async function open(kind: "leads" | "contacts", id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/crm/${kind}/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not open.");
      if (kind === "leads") setLead(payload.lead);
      else setContact(payload.contact);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open.");
    } finally {
      setBusy(false);
    }
  }

  async function save(kind: "leads" | "contacts", record: Lead | Contact) {
    setBusy(true);
    try {
      const response = await fetch(`/api/crm/${kind}/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save.");
      if (kind === "leads") setLead(payload.lead);
      else setContact(payload.contact);
      setNotice("Saved.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: "leads" | "contacts", id: string) {
    setBusy(true);
    try {
      await fetch(`/api/crm/${kind}/${id}`, { method: "DELETE" });
      if (kind === "leads" && lead?.id === id) setLead(null);
      if (kind === "contacts" && contact?.id === id) setContact(null);
      setConfirmDelete("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(
    () => ({ open: pipelineValue(leads), won: wonValue(leads) }),
    [leads],
  );
  const grouped = useMemo(() => groupByStage(leads), [leads]);

  // ---------- lead editor ----------

  if (lead) {
    const patch = (changes: Partial<Lead>) =>
      setLead((current) => (current ? { ...current, ...changes } : current));
    const linked = new Set(lead.contactIds);

    return (
      <div className="view">
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {kindLabel(lead.kind)} · {sourceLabel(lead.source)}
            </p>
            <h1>{lead.title || "Untitled lead"}</h1>
            <p className="page-description">
              {lead.company || "No company"} · {stageLabel(lead.stage)}
            </p>
          </div>
          <div className="toolbar-actions">
            <button className="button button-ghost" onClick={() => setLead(null)}>
              Back
            </button>
            <button className="button button-primary" disabled={busy} onClick={() => save("leads", lead)}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {error ? <p className="error-notice">{error}</p> : null}
        {notice ? <p className="save-notice">{notice}</p> : null}

        <div className="panel dc-proposal-panel">
          <div className="panel-header">
            <h3>Opportunity</h3>
          </div>
          <div className="dc-field-grid">
            <label className="settings-field">
              <span>Title</span>
              <input value={lead.title} onChange={(e) => patch({ title: e.target.value })} />
            </label>
            <label className="settings-field">
              <span>Company</span>
              <input
                list="dc-crm-companies"
                value={lead.company}
                onChange={(e) => patch({ company: e.target.value })}
              />
              <datalist id="dc-crm-companies">
                {companies.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="settings-field">
              <span>Work type</span>
              <select value={lead.kind} onChange={(e) => patch({ kind: e.target.value as LeadKind })}>
                {LEAD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Stage</span>
              <select value={lead.stage} onChange={(e) => patch({ stage: e.target.value as LeadStage })}>
                {LEAD_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Where it came from</span>
              <select value={lead.source} onChange={(e) => patch({ source: e.target.value as LeadSource })}>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Estimated value</span>
              <input
                className="dc-rate"
                defaultValue={(lead.estimatedValue / 100).toFixed(2)}
                onBlur={(e) => {
                  const cents = parseMoneyToCents(e.target.value);
                  e.target.value = (cents / 100).toFixed(2);
                  patch({ estimatedValue: cents });
                }}
              />
            </label>
            <label className="settings-field">
              <span>Deadline</span>
              <input type="date" value={lead.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} />
            </label>
            <label className="settings-field">
              <span>Next action</span>
              <input
                value={lead.nextAction}
                placeholder="e.g. Send the deck"
                onChange={(e) => patch({ nextAction: e.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>Next action date</span>
              <input
                type="date"
                value={lead.nextActionDate}
                onChange={(e) => patch({ nextActionDate: e.target.value })}
              />
            </label>
          </div>
          <label className="settings-field">
            <span>Source link — the tender, call or article this came from</span>
            <input
              value={lead.sourceUrl}
              placeholder="https://…"
              onChange={(e) => patch({ sourceUrl: e.target.value })}
            />
          </label>
          <label className="settings-field">
            <span>What the opportunity is</span>
            <textarea rows={4} value={lead.description} onChange={(e) => patch({ description: e.target.value })} />
          </label>
        </div>

        <div className="panel dc-proposal-panel">
          <div className="panel-header">
            <h3>People</h3>
            <span className="dc-sub">{linked.size} linked</span>
          </div>
          {contacts.length === 0 ? (
            <p className="empty-state">No contacts yet — add them in the Contacts tab.</p>
          ) : (
            <div className="dc-contact-picker">
              {contacts.map((row) => (
                <label key={row.id} className="dc-pick">
                  <input
                    type="checkbox"
                    checked={linked.has(row.id)}
                    onChange={(e) => {
                      const next = new Set(linked);
                      if (e.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      patch({ contactIds: [...next] });
                    }}
                  />
                  <span>
                    <strong>{row.name || "(unnamed)"}</strong>
                    <span className="dc-sub">
                      {[row.role, row.company].filter(Boolean).join(" · ") || "—"}
                      {row.consent === "do-not-contact" ? " · DO NOT CONTACT" : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="panel dc-proposal-panel">
          <div className="panel-header">
            <h3>Notes</h3>
          </div>
          <textarea rows={5} value={lead.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>
    );
  }

  // ---------- contact editor ----------

  if (contact) {
    const patch = (changes: Partial<Contact>) =>
      setContact((current) => (current ? { ...current, ...changes } : current));

    return (
      <div className="view">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Contact</p>
            <h1>{contact.name || "New contact"}</h1>
            <p className="page-description">
              {[contact.role, contact.company].filter(Boolean).join(" · ") || "No company"}
            </p>
          </div>
          <div className="toolbar-actions">
            <button className="button button-ghost" onClick={() => setContact(null)}>
              Back
            </button>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => save("contacts", contact)}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {error ? <p className="error-notice">{error}</p> : null}
        {notice ? <p className="save-notice">{notice}</p> : null}

        <div className="panel dc-proposal-panel">
          <div className="panel-header">
            <h3>Details</h3>
          </div>
          <div className="dc-field-grid">
            <label className="settings-field">
              <span>Name</span>
              <input value={contact.name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <label className="settings-field">
              <span>Role</span>
              <input
                value={contact.role}
                placeholder="e.g. Commissioning Editor"
                onChange={(e) => patch({ role: e.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>Company</span>
              <input
                list="dc-crm-companies-c"
                value={contact.company}
                onChange={(e) => patch({ company: e.target.value })}
              />
              <datalist id="dc-crm-companies-c">
                {companies.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="settings-field">
              <span>Email</span>
              <input type="email" value={contact.email} onChange={(e) => patch({ email: e.target.value })} />
            </label>
            <label className="settings-field">
              <span>Phone</span>
              <input value={contact.phone} onChange={(e) => patch({ phone: e.target.value })} />
            </label>
            <label className="settings-field">
              <span>LinkedIn</span>
              <input value={contact.linkedin} onChange={(e) => patch({ linkedin: e.target.value })} />
            </label>
          </div>
        </div>

        <div className="panel dc-proposal-panel dc-consent">
          <div className="panel-header">
            <div>
              <h3>How you got this contact</h3>
              <p className="page-description">{consentNote}</p>
            </div>
          </div>
          <div className="dc-field-grid">
            <label className="settings-field">
              <span>Basis for contact</span>
              <select
                value={contact.consent}
                onChange={(e) => patch({ consent: e.target.value as ContactConsent })}
              >
                {CONTACT_CONSENT.map((c) => (
                  <option key={c} value={c}>
                    {consentLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Where specifically</span>
              <input
                value={contact.origin}
                placeholder="e.g. DISCOP 2026, or referred by Neo"
                onChange={(e) => patch({ origin: e.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="panel dc-proposal-panel">
          <div className="panel-header">
            <h3>Notes</h3>
          </div>
          <textarea rows={5} value={contact.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
      </div>
    );
  }

  // ---------- list ----------

  return (
    <div className="view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Business development</p>
          <h1>Leads &amp; contacts</h1>
          <p className="page-description">
            Opportunities you are pursuing and the people attached to them. Open leads are worth{" "}
            <strong>{formatMoney(totals.open)}</strong>
            {totals.won > 0 ? `, won ${formatMoney(totals.won)}` : ""}.
          </p>
        </div>
        <div className="toolbar-actions">
          <button className="button button-ghost" disabled={busy} onClick={() => create("contact")}>
            New contact
          </button>
          <button className="button button-primary" disabled={busy} onClick={() => create("lead")}>
            New lead
          </button>
        </div>
      </div>

      {error ? <p className="error-notice">{error}</p> : null}
      {notice ? <p className="save-notice">{notice}</p> : null}

      <div className="dc-minutes-tabs">
        <button className={tab === "pipeline" ? "active" : ""} onClick={() => setTab("pipeline")}>
          Pipeline ({leads.filter((l) => isActive(l.stage)).length})
        </button>
        <button className={tab === "contacts" ? "active" : ""} onClick={() => setTab("contacts")}>
          Contacts ({contacts.length})
        </button>
      </div>

      {loading ? (
        <div className="panel dc-proposal-panel">
          <p className="empty-state">Loading…</p>
        </div>
      ) : tab === "contacts" ? (
        <div className="panel dc-proposal-panel">
          {contacts.length === 0 ? (
            <p className="empty-state">
              No contacts yet. Add the people you meet at markets and festivals, and record how you
              met them — that is what makes later contact defensible under POPIA.
            </p>
          ) : (
            <table className="dc-proposal-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Basis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contacts.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button className="text-button" onClick={() => open("contacts", row.id)}>
                        {row.name || "(unnamed)"}
                      </button>
                    </td>
                    <td>{row.role || <span className="dc-sub">—</span>}</td>
                    <td>{row.company || <span className="dc-sub">—</span>}</td>
                    <td>{row.email || <span className="dc-sub">—</span>}</td>
                    <td>
                      <span
                        className={
                          row.consent === "do-not-contact"
                            ? "label label-high"
                            : row.consent === "unknown"
                              ? "label label-watch"
                              : "label label-positive"
                        }
                      >
                        {consentLabel(row.consent)}
                      </span>
                    </td>
                    <td className="dc-row-actions">
                      {confirmDelete === row.id ? (
                        <>
                          <button className="text-button dc-danger" onClick={() => remove("contacts", row.id)}>
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
      ) : leads.length === 0 ? (
        <div className="panel dc-proposal-panel">
          <p className="empty-state">
            No leads yet. Add one by hand, or paste a tender or funding call link into a new lead to
            start tracking it.
          </p>
        </div>
      ) : (
        grouped.map((group) => (
          <div className="panel dc-proposal-panel" key={group.stage}>
            <div className="panel-header">
              <h3>{stageLabel(group.stage)}</h3>
              <span className="dc-sub">
                {group.leads.length} · {formatMoney(group.leads.reduce((s, l) => s + l.estimatedValue, 0))}
              </span>
            </div>
            {group.leads.length === 0 ? (
              <p className="empty-state">Nothing at this stage.</p>
            ) : (
              <table className="dc-proposal-table">
                <thead>
                  <tr>
                    <th>Opportunity</th>
                    <th>Company</th>
                    <th>Type</th>
                    <th className="dc-num">Value</th>
                    <th>Deadline</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.leads.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button className="text-button" onClick={() => open("leads", row.id)}>
                          {row.title || "Untitled"}
                        </button>
                        {row.nextAction ? <span className="dc-sub">Next: {row.nextAction}</span> : null}
                      </td>
                      <td>{row.company || <span className="dc-sub">—</span>}</td>
                      <td>
                        <span className="label">{kindLabel(row.kind)}</span>
                      </td>
                      <td className="dc-num">
                        {row.estimatedValue ? formatMoney(row.estimatedValue, row.currency) : "—"}
                      </td>
                      <td>
                        {row.dueDate ? (
                          <span className={TONE_CLASS[dueTone(row.dueDate, !isActive(row.stage))]}>
                            {dueLabel(row.dueDate)}
                          </span>
                        ) : (
                          <span className="dc-sub">—</span>
                        )}
                      </td>
                      <td className="dc-row-actions">
                        {confirmDelete === row.id ? (
                          <>
                            <button className="text-button dc-danger" onClick={() => remove("leads", row.id)}>
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
        ))
      )}
    </div>
  );
}

export default CrmView;
