# Control Center

A local-first business dashboard for industry updates, strict brand mentions, newsletter monitoring, public audience totals, reminders, and tasks.

Every fresh install starts empty. There are no built-in names, companies, websites, social profiles, API keys, or demo records. Each user tailors the dashboard to their own niche in **Settings**.

## Install and open

Requirements: [Node.js 24.19 or newer](https://nodejs.org/en/download), npm, and a modern desktop browser.

```bash
git clone https://github.com/mreflow/control-center.git
cd control-center
npm run launch
```

`npm run launch` is the golden path. It installs the locked dependencies when needed, builds the app when source files change, starts one loopback-only server, waits for a health check, and opens `http://127.0.0.1:3000` in the default browser. Keep that terminal window open; press `Ctrl+C` to stop.

Prefer a ZIP? Download **Code → Download ZIP** on GitHub, extract it, open a terminal in the extracted folder, and run `npm run launch`. Git is only required for the clone/update workflow.

Useful commands:

```bash
npm run doctor                 # verify runtime, settings, build, and SQLite health
npm run backup                 # make a consistent private backup
npm run launch -- --no-open    # start without opening a browser
npm run launch -- --port=3001  # use another local port
```

## First-run setup

The Today page shows the four live areas and links directly to the right Settings section.

1. **Industry:** add any public homepage, RSS/Atom feed, and optional topic phrases.
2. **Mentions:** add exact names, brands, handles, official domains, and distinguishing identity anchors.
3. **Audience:** add exact public profile URLs or handles for the platforms you use.
4. **Newsletters (optional):** connect any Gmail account with a read-only OAuth client and choose the Gmail search query.

Collectors run shortly after startup, every 15 minutes while the app remains open, whenever a live page is opened, and when **Refresh** is pressed.

## Industry collection

Each configured URL is treated independently and can belong to any niche.

1. The collector checks an explicit feed, page feed metadata, and common RSS/Atom paths.
2. If no feed is readable, it merges sitemap locations from `robots.txt` and common sitemap paths, including recursive sitemap indexes.
3. A first sitemap scan records a quiet baseline. Later scans report newly discovered pages.

A blocked homepage does not stop feed or sitemap discovery. Active Industry cards are limited to items published or newly discovered in the last 24 hours; older saved items remain under **Archive & history**. Undated feed entries establish a baseline instead of being presented as fresh news.

Topic phrases add broader Google News discovery, while watched-site updates remain prioritized independently.

## Mentions

Mention discovery searches Google News and Bing News across the previous seven days. Multi-word names and brands are searched as complete phrases, never as loose individual words.

Strict mode requires identity evidence:

- unique handles and official domains can qualify directly;
- common names and broad brand phrases need a second configured signal;
- roles, products, locations, collaborators, and niche topics can serve as anchors;
- weak namesakes and broad word overlap are rejected as noise;
- contextual matches are separated for review.

Canonical story identities are stored locally. Once a result is archived, later scans do not resurface the same story through a search-provider wrapper or tracking URL.

Public search is useful discovery, not complete web coverage.

## Audience tracking

Supported public profiles: YouTube, X, Instagram, Facebook, LinkedIn, Threads, and TikTok.

Public pages are checked first and do not require platform API keys. Optional official credentials remain collapsed under advanced settings for providers that support a fallback. Successful metrics must match the configured account identity; a count from an unrelated page is rejected.

Public collection is provider-controlled and best effort. A platform can change or block signed-out metadata without notice. A failed check is shown as unavailable or limited, never as a false zero; a prior verified value is clearly labeled as last known. Combined totals are sums across platforms, not deduplicated people.

## Newsletter Gmail

The newsletter mailbox can be completely separate from any Gmail account used elsewhere.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the Gmail API and configure the OAuth consent screen.
3. Create a **Web application** OAuth client.
4. Copy the exact redirect URI shown under **Settings → Newsletters** into the OAuth client.
5. Paste the client ID and secret, customize the Gmail search query if desired, and choose **Save & choose Gmail account**.

The requested scope is Gmail read-only. The app never sends, labels, deletes, marks as read, or archives Gmail messages. Dashboard archive state is local only.

Google classifies `gmail.readonly` as a restricted scope. A personal OAuth project left in External/Testing mode can require periodic reauthorization; production distribution of shared OAuth credentials requires Google verification. This project intentionally uses bring-your-own OAuth credentials rather than shipping a universal secret.

## Local data and privacy

The server binds to `127.0.0.1` and rejects API requests with foreign Host or Origin headers. Do not expose it through a network proxy without adding authentication.

Fresh installs store durable data outside the application folder:

| Platform | Default data directory                            |
| -------- | ------------------------------------------------- |
| macOS    | `~/Library/Application Support/Control Center`    |
| Windows  | `%LOCALAPPDATA%\Control Center`                   |
| Linux    | `${XDG_DATA_HOME:-~/.local/share}/control-center` |

Existing installations that already contain `./.control-center` continue using that directory automatically, so this update does not make their data appear missing. An optional absolute `CONTROL_CENTER_DATA_DIR` can be set in `.env.local`.

Stored files include:

- `settings.json`: configuration and provider tokens, owner-readable on POSIX systems;
- `control-center.sqlite`: content, archive state, reminders, and tasks;
- snapshot JSON files: sitemap and audience baselines.

Secrets never return through the Settings API. They remain local, but they are not encrypted at rest. Protect the operating-system account and any backups.

## Backup and recovery

```bash
npm run backup
```

This creates a consistent SQLite backup plus settings and snapshot files under `~/Documents/Control Center Backups/<timestamp>`. It is a private full backup and may contain OAuth tokens.

To choose another destination:

```bash
npm run backup -- --to=/absolute/path/to/backup-folder
```

If startup safely stops on a local-data error, run `npm run doctor`. The app fails closed: it will not render editable empty defaults or overwrite settings, tasks, or reminders after a failed initial read.

## Updates

For a Git clone:

```bash
git pull --ff-only
npm run launch
```

The setup path compares the installed dependency tree to the committed lockfile and performs a clean install when it changes. User data is outside a fresh checkout, so replacing a ZIP with a newer version does not replace that data directory.

## Development and verification

```bash
npm run setup
npm run dev
npm run check
npm run smoke
```

`npm run check` runs lint, the regression suite, and a production build. `npm run smoke` starts the production build with an isolated temporary data directory and verifies the health endpoint, rendered home page, and localhost request boundary. GitHub Actions runs the documented setup, full check, and smoke path on Linux, macOS, and Windows.

## Private connector bridge

The standalone dashboard does not automatically inherit private Codex connectors. Instead, **Settings → Integrations** provides a portable local bridge for Gmail, Slack, Granola, Google Calendar, Apple Messages, Computer History, or any other user-approved source.

Add the source labels, save, and choose **Copy bridge prompt**. The generated prompt tells Codex to use the installed connectors read-only, minimize private content, and send stable action/meeting/message items to the loopback-only Daily Brief endpoint. The Today page then provides Today/Week views and can turn any item into a task. Scripts can use `npm run ingest` with the same JSON contract.

The bridge makes connector-backed overviews portable without shipping anyone's account access. A connector automation still needs to be created by each user because those permissions belong to that user's Codex/provider accounts. See [docs/CONNECTOR_BRIDGE.md](docs/CONNECTOR_BRIDGE.md).

See [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) for release and project details.
