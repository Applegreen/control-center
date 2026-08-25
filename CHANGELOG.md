# Changelog

## 0.2.1 - 2026-08-25

- Split automatically expired Industry history from items a user manually archived, added deterministic newest/oldest/watched-site sorting, and stopped stale feed backlogs from appearing as new discoveries.
- Tightened seven-day mention matching so provider query terms never count as observed evidence and ambiguous names require configured identity corroboration in strict mode.
- Persisted follower and subscriber changes between successful audience checks while keeping post, video, and thread counts as separate content metadata.
- Added immutable dated completion records for repeating tasks while advancing the active series to its next due date.
- Expanded production smoke coverage for personalized-data-free first runs and verified the one-command launcher from a clean clone with an unrelated industry niche.

## 0.2.0 - 2026-08-25

- Added a one-command local launcher with health wait, browser opening, rebuild detection, and single-instance protection.
- Moved fresh-install data to stable per-user operating-system directories while preserving existing repo-local installs.
- Added fail-closed startup, ordered workspace saves, visible persistence errors, SQLite schema versioning, and serialized settings/token writes.
- Added a local request boundary, production smoke test, diagnostics, and consistent private backups.
- Hardened public-source network validation, Windows-safe atomic snapshots, private backup permissions, and cross-platform CI pinning.
- Added a provider-neutral Daily Brief bridge for user-approved Codex connectors, local scripts, and Today/Week action overviews.
- Added authoritative per-source Daily Brief syncs with empty-run health, failure reporting, source-scoped IDs, privacy cleanup, and bounded Week filtering.
- Made task/reminder corruption fail closed and fixed Unicode Daily Brief migrations plus future Today/Week event windows.
- Improved first-run deep links, live-load error handling, audience duplicate protection, valid profile examples, and configurable Gmail newsletter search.
- Hardened Industry, Mentions, and Audience collectors for feed/sitemap fallbacks, strict identity, archive deduplication, and public-account attribution.

## 0.1.0 - 2026-08-21

- Initial local Control Center dashboard and settings-driven collectors.
