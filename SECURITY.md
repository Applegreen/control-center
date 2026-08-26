# Security policy

## Supported version

Security fixes are applied to the latest release on `main`.

## Reporting a vulnerability

Please use GitHub's private **Report a vulnerability** flow for this repository. Do not include OAuth tokens, private email content, local database files, or other personal data in a public issue.

## Local security model

Control Center is designed to run on one trusted user's computer. It binds to loopback and rejects foreign API Host/Origin headers, but it has no account login. Do not expose it to a LAN or the public internet without an authenticated reverse proxy and a separate security review.

OAuth credentials, optional audience-provider tokens, and optional AI provider keys are stored in the local data directory and are not encrypted at rest. They are written owner-readable on POSIX systems and are never returned by the public Settings response. Protect the operating-system account and treat full backups as secret-bearing files.

Only the AI provider explicitly selected in Settings can be called. Environment variables remain inert until the matching provider is selected. Industry prompts contain configured niche text and bounded public discovery metadata; Mention prompts contain configured public identity signals and ask the provider to search the public web. Daily Brief, task, reminder, and private connector content is not sent to these jobs.

Newsletter intelligence requires an AI key. Matching Gmail issue text is read with the user-authorized read-only scope and sent only to the selected provider for story extraction and deduplication. Email addresses are masked and subscriber-specific source URLs are replaced with internal link references before the model request; model-returned references must match an observed email link. Raw bodies are not written to SQLite. The local database stores issue metadata, a body hash, extracted story summaries/source links, and deduplicated topic state. Public tracking redirects are resolved with the same DNS validation and address pinning used by Industry sources.

User-configured Industry sources are limited to public HTTP and HTTPS addresses. DNS answers are validated and the request is pinned to the validated public address; redirects repeat the same validation. Private, loopback, local-link, and reserved network destinations are rejected. These controls are defense in depth for a local application, not authorization to expose the dashboard as a public URL-fetching service.
