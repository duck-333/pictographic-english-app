# Development Log v1

This file records durable project progress. Every completed feature block must update this file.

Use this format:

```text
## YYYY-MM-DD: Short Title

Scope:
- ...

Changed:
- ...

Verified:
- ...

Docs:
- ...

Risks / Follow-up:
- ...
```

## 2026-07-08: Long-term Maintenance Documentation v1

Scope:

- Created the long-term documentation framework requested by the user.
- No business code was modified.
- No database was modified.
- No server, mini program, admin portal, or package files were modified.

Changed:

- Added `PROJECT_RULES.md`.
- Added `PROJECT_OVERVIEW.md`.
- Added `ARCHITECTURE.md`.
- Added `DEVELOPMENT_LOG.md`.
- Added initial ADR files under `ADR/`.

Context captured:

- The current mini program entry is `miniapp-uni/word-app1`.
- The current admin portal entry is `admin-portal/pictographic-admin`.
- The current Node API is under `server`.
- The root `src` directory is an older React/Vite demo, not the active mini program.
- WeChat login first version is implemented through `/api/auth/wechat-login`.
- Phone quick login, quota accounting, and admin user management are not implemented yet.

Verified:

- Pre-existing target docs did not exist before creation.
- Initial worktree status was clean.
- This documentation pass intentionally did not run code tests because no business code changed.

Docs:

- This log entry is the documentation record for the V1 rules phase.

Risks / Follow-up:

- Review and confirm the V1 rules before starting implementation work.
- After confirmation, the next architecture work should design phone quick login and quota schema before coding.
- Some older docs still describe admin token behavior and should be reconciled in a later documentation cleanup task after user approval.

## Prior State Summary Before This Log

This summary was derived from the read-only audit completed on 2026-07-08:

- Public content APIs and admin content publishing exist.
- Homepage featured word management exists.
- Audio, illustration, and manual VOD metadata paths exist.
- Admin username/password session login exists in code.
- WeChat identity login exists in code.
- User phone binding, quota account, quota ledger, membership, order, payment, and book activation do not exist yet.

