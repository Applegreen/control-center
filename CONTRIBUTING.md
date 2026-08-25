# Contributing

Control Center is a local-first Next.js application. Changes should preserve three invariants:

1. A fresh install contains no user, brand, source, account, credential, or preview data.
2. Collector failures are explicit and never become false success, false freshness, or false zero.
3. Existing local settings, archives, tasks, reminders, and snapshots remain safe across retries and updates.

## Local workflow

```bash
npm run setup
npm run dev
```

Before opening a pull request:

```bash
npm run check
npm run smoke
```

Add focused regression tests for collector, archive, identity, persistence, or request-boundary changes. Do not commit `.control-center/`, `.env.local`, `.next/`, `node_modules/`, backups, OAuth credentials, or copied private content.

Please keep pull requests scoped and explain the user-visible behavior, failure mode, and verification evidence.
