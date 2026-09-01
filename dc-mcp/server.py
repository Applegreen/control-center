"""
Digital Characters — Control Center MCP server.

Exposes the dashboard's own data to Hermes over MCP so it can be queried from
Telegram. Read-only throughout.

Design notes:

- Four tools, not fourteen. Hermes already puts 25 tools and 77 skills in front
  of the model; a 2B model picking from ninety options will pick badly. Each
  tool here answers one question a person would actually ask their phone.

- Reads the SQLite files directly rather than calling Control Center's API,
  because /api/live/* triggers a full collection run (fetch every feed, then AI
  curation) on each request. Direct reads are instant and trigger nothing.

- Every connection sets PRAGMA query_only = 1. This process cannot write to the
  dashboard's data under any circumstance, including a bug in this file.
"""

import json
import os
import sqlite3
from datetime import date, datetime
from typing import Any

from mcp.server.fastmcp import FastMCP

DATA_DIR = os.environ.get("CC_DATA_DIR", "/data")
MAX_CHARS = 4000  # keep replies inside a small model's context

mcp = FastMCP("digital-characters", host="0.0.0.0", port=8000)


# ---------------------------------------------------------------- helpers

def _open(filename: str) -> sqlite3.Connection:
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"{filename} is not present yet.")
    con = sqlite3.connect(path, timeout=5.0)
    con.execute("PRAGMA query_only = 1")  # this reader can never write
    con.row_factory = sqlite3.Row
    return con


def _money(cents: Any, currency: str = "ZAR") -> str:
    try:
        amount = (int(cents) or 0) / 100
    except (TypeError, ValueError):
        return ""
    return f"{currency} {amount:,.2f}".replace(",", " ")


def _days_until(iso: str) -> int | None:
    if not iso:
        return None
    try:
        due = datetime.strptime(iso[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    return (due - date.today()).days


def _due(iso: str) -> str:
    days = _days_until(iso)
    if days is None:
        return "no date"
    if days < -1:
        return f"{abs(days)} days overdue"
    if days == -1:
        return "yesterday"
    if days == 0:
        return "today"
    if days == 1:
        return "tomorrow"
    return f"in {days} days"


def _clip(text: str) -> str:
    return text if len(text) <= MAX_CHARS else text[:MAX_CHARS] + "\n… (truncated)"


# ---------------------------------------------------------------- tools

@mcp.tool()
def dashboard_status() -> str:
    """Check the Digital Characters dashboard: which sections are collecting,
    when each last refreshed, and how many items each holds. Use this when
    asked whether the dashboard is working or up to date."""
    try:
        con = _open("control-center.sqlite")
    except FileNotFoundError as exc:
        return str(exc)
    try:
        rows = con.execute(
            "SELECT collector, payload_json, checked_at FROM collector_snapshots"
        ).fetchall()
    finally:
        con.close()

    if not rows:
        return "The dashboard has not collected anything yet."

    lines = ["Digital Characters dashboard:"]
    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except Exception:
            lines.append(f"- {row['collector']}: unreadable snapshot")
            continue
        items = payload.get("items") or []
        checked = str(payload.get("checkedAt") or row["checked_at"] or "")[:16]
        state = "configured" if payload.get("configured", True) else "NOT configured"
        lines.append(f"- {row['collector']}: {state}, {len(items)} items, checked {checked}")
        for error in (payload.get("errors") or [])[:2]:
            lines.append(f"    error: {str(error)[:120]}")
    return _clip("\n".join(lines))


@mcp.tool()
def open_tasks() -> str:
    """List every open task and deadline from meeting minutes across all
    companies, soonest first. Use this when asked what is outstanding, what is
    due, or what needs doing."""
    try:
        con = _open("minutes.sqlite")
    except FileNotFoundError as exc:
        return str(exc)
    try:
        rows = con.execute(
            """SELECT t.description, t.owner, t.due_date, m.company, m.title
                 FROM minute_tasks t JOIN minutes m ON m.id = t.minute_id
                WHERE t.done = 0 AND m.status != 'archived'"""
        ).fetchall()
    finally:
        con.close()

    if not rows:
        return "No open tasks."

    # Dated first, soonest first; undated last.
    ordered = sorted(rows, key=lambda r: (not r["due_date"], r["due_date"] or ""))
    lines = [f"{len(ordered)} open task(s):"]
    for row in ordered:
        who = f" — {row['owner']}" if row["owner"] else ""
        where = row["company"] or row["title"] or ""
        lines.append(f"- {row['description']}{who} ({_due(row['due_date'])}){f' · {where}' if where else ''}")
    return _clip("\n".join(lines))


@mcp.tool()
def sales_pipeline() -> str:
    """Show the current sales pipeline: open leads with their stage, estimated
    value and deadline. Use this when asked about leads, opportunities, work
    coming in, or the pipeline."""
    try:
        con = _open("crm.sqlite")
    except FileNotFoundError as exc:
        return str(exc)
    try:
        rows = con.execute(
            """SELECT title, company, stage, kind, estimated_value, currency, due_date, next_action
                 FROM leads
                WHERE stage IN ('new','qualifying','pitching','proposal')
                ORDER BY CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date"""
        ).fetchall()
    finally:
        con.close()

    if not rows:
        return "No open leads in the pipeline."

    total = sum(int(r["estimated_value"] or 0) for r in rows)
    lines = [f"{len(rows)} open lead(s), pipeline value {_money(total)}:"]
    for row in rows:
        value = _money(row["estimated_value"], row["currency"] or "ZAR")
        bits = [row["stage"], value if row["estimated_value"] else "", _due(row["due_date"])]
        lines.append(f"- {row['title']} · {row['company'] or 'no company'} ({', '.join(b for b in bits if b)})")
        if row["next_action"]:
            lines.append(f"    next: {row['next_action']}")
    return _clip("\n".join(lines))


@mcp.tool()
def recent_proposals() -> str:
    """List recent proposals and quotations with their status and total value.
    Use this when asked what has been quoted, sent, won or is outstanding."""
    try:
        con = _open("proposals.sqlite")
    except FileNotFoundError as exc:
        return str(exc)
    try:
        rows = con.execute(
            """SELECT p.id, p.number, p.kind, p.status, p.client_name, p.project_title,
                      p.currency, p.vat_rate, p.discount_rate, p.valid_until
                 FROM proposals p ORDER BY p.created_at DESC LIMIT 15"""
        ).fetchall()
        totals = {}
        for row in rows:
            items = con.execute(
                "SELECT quantity, unit_rate FROM proposal_items WHERE proposal_id = ?",
                (row["id"],),
            ).fetchall()
            subtotal = sum(round((i["quantity"] or 0) * (i["unit_rate"] or 0)) for i in items)
            discount = round(subtotal * (row["discount_rate"] or 0) / 100)
            net = subtotal - discount
            totals[row["id"]] = net + round(net * (row["vat_rate"] or 0) / 100)
    finally:
        con.close()

    if not rows:
        return "No proposals yet."

    lines = [f"{len(rows)} recent proposal(s):"]
    for row in rows:
        label = "Quotation" if row["kind"] == "quote" else "Proposal"
        lines.append(
            f"- {row['number']} · {label} · {row['status']} · "
            f"{row['client_name'] or 'no client'} · {row['project_title'] or 'untitled'} · "
            f"{_money(totals.get(row['id'], 0), row['currency'] or 'ZAR')}"
        )
    return _clip("\n".join(lines))


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
