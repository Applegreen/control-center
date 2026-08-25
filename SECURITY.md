# Security policy

## Supported version

Security fixes are applied to the latest release on `main`.

## Reporting a vulnerability

Please use GitHub's private **Report a vulnerability** flow for this repository. Do not include OAuth tokens, private email content, local database files, or other personal data in a public issue.

## Local security model

Control Center is designed to run on one trusted user's computer. It binds to loopback and rejects foreign API Host/Origin headers, but it has no account login. Do not expose it to a LAN or the public internet without an authenticated reverse proxy and a separate security review.

Provider tokens are stored in the local data directory and are not encrypted at rest. Protect the operating-system account and treat full backups as secret-bearing files.
