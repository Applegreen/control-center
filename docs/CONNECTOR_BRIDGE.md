# Daily Brief connector bridge

Control Center cannot inherit private Codex connectors from a different user's installation. Instead, it exposes a provider-neutral localhost endpoint so a user-approved Codex automation, script, or local tool can send a minimized daily overview.

## Setup

1. Run Control Center and open **Settings → Integrations**.
2. Add the exact source labels the automation will use, such as `Gmail`, `Slack`, `Granola`, `Google Calendar`, `Apple Messages`, or `Computer History`.
3. Save Settings.
4. Choose **Copy bridge prompt** and paste it into Codex, or use the JSON contract below from another local automation.

The generated prompt requires read-only connector access and asks the automation to report failures instead of returning an invented empty success.

## JSON contract

POST to the local endpoint shown in Settings, normally `http://127.0.0.1:3000/api/brief`:

```json
{
  "sources": [
    { "source": "Slack", "status": "success" },
    {
      "source": "Gmail",
      "status": "error",
      "error": "Connector authorization expired."
    }
  ],
  "items": [
    {
      "id": "slack:workspace:thread-123",
      "source": "Slack",
      "title": "Approve the launch copy",
      "summary": "A teammate needs a decision before tomorrow morning.",
      "kind": "action",
      "occurredAt": "2026-08-24T17:30:00Z",
      "dueAt": "2026-08-25T16:00:00Z",
      "url": "https://example.invalid/original-item"
    }
  ]
}
```

Fields:

- `sources`: every connector attempted in this sweep. Use `success` even when that source has zero items. Use `error` with a short error message when it could not be read.
- `id`: required stable provider identity. IDs only need to be unique within their source; reusing one updates the item instead of duplicating it.
- `source`: must exactly match one enabled source label, ignoring case.
- `title`: required, concise, and safe to display.
- `summary`: optional minimized context; do not send full private message bodies.
- `kind`: `action`, `meeting`, `message`, or `info`.
- `occurredAt`: ISO timestamp; defaults to sync time when omitted or invalid.
- `dueAt`: optional ISO timestamp.
- `url`: optional public/provider link using HTTP or HTTPS.

Each successful source is authoritative: items missing from its next successful sweep are removed. A failed source preserves its last successful items and shows a failed health state. At most 500 items and 100 source reports are accepted per sync.

Stored items expire 45 days after their last successful sync. Expiration is enforced whenever the database opens or the Daily Brief is read, even if automations have stopped. Removing a source from Settings also removes its stored items on the next Daily Brief read.

## Local ingest command

With the dashboard running:

```bash
npm run ingest -- --file=/absolute/path/daily-brief.json
```

For a non-default local port:

```bash
npm run ingest -- --file=/absolute/path/daily-brief.json --url=http://127.0.0.1:3001
```

JSON can also be piped through standard input. The endpoint is protected by the same loopback Host/Origin boundary as the other APIs and is not intended for network exposure.
