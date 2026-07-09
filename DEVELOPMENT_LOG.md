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

## 2026-07-09: Project Rules Module Lifecycle Update

Scope:

- Updated `PROJECT_RULES.md` to formalize future Codex and human module development workflow.
- Added module lifecycle, single-module development principle, AI development rules, and module review mechanism.
- No business code was modified.
- No database was created or changed.
- No API was implemented.

Changed:

- Updated `PROJECT_RULES.md`.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Read current project rules and development log before editing.

Docs:

- This log entry records the project rules update.

Risks / Follow-up:

- Future development tasks should follow the lifecycle and review mechanism before entering implementation.

## 2026-07-09: ADR Review Revisions

Scope:

- Revised next-phase ADRs based on architecture review.
- Kept the work documentation-only.
- No business code was modified.
- No database was created or changed.
- No API was implemented.

Changed:

- Updated `ADR/ADR-0006-quota-account-and-ledger.md` to standardize `quota_type` as `word_lookup` and expand quota ledger audit fields.
- Updated `ADR/ADR-0010-user-identity-system-upgrade.md` with HMAC-SHA256 phone hashing, `hash_version`, and phone binding lifecycle fields.
- Updated `ADR/ADR-0012-user-entitlement-model.md` with quota/source type separation, ledger audit fields, and `balance_before` / `balance_after` requirements.
- Updated `ADR/ADR-0014-content-access-layer-model.md` with the three-phase migration from `GET /api/words/:id` to `POST /api/words/:id/view`.
- Added `docs/database/DATABASE_CHANGE_PLAN.md` as a design plan only.

Verified:

- Read required project rules and architecture documentation before editing.
- Ran `git diff --check`.

Docs:

- `docs/database/DATABASE_CHANGE_PLAN.md` explicitly states that it is not an executed migration, not a migration script, and not approval to change production database structure.

Risks / Follow-up:

- Database implementation still requires human confirmation, migration script, rollback plan, backup verification, and tests under ADR-0007.
- Phone quick login, quota accounting, content access enforcement, and admin user entitlement query remain unimplemented.

## 2026-07-09: Next-Phase ADR Design

Scope:

- Entered ADR design stage for the confirmed next development phase.
- Documented final confirmed architecture direction for user identity upgrade, identity binding conflicts, user entitlement model, admin user entitlement query, and content access layering.
- Updated `ARCHITECTURE.md` with the next-phase module map, confirmed future API semantics, identity/quota/content-access flows, and ADR index.
- No business code was modified.
- No implementation code was created.
- No database structure was changed.

Changed:

- Added `ADR/ADR-0010-user-identity-system-upgrade.md`.
- Added `ADR/ADR-0011-identity-binding-conflict-rules.md`.
- Added `ADR/ADR-0012-user-entitlement-model.md`.
- Added `ADR/ADR-0013-admin-user-entitlement-query.md`.
- Added `ADR/ADR-0014-content-access-layer-model.md`.
- Updated `ARCHITECTURE.md`.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Read `PROJECT_RULES.md`, `PROJECT_OVERVIEW.md`, `ARCHITECTURE.md`, `DEVELOPMENT_LOG.md`, `ADR/*`, and `AGENTS.md` before editing.
- This was a documentation-only architecture decision pass, so implementation tests, HBuilderX validation, server checks, and database migration checks were not run.

Docs:

- The new ADRs record final confirmed architecture direction only.
- Unadopted alternatives were intentionally not expanded in the ADRs.

Risks / Follow-up:

- Phone quick login, phone binding, quota tables, content access policy, and admin user entitlement pages remain unimplemented.
- Before implementation, each database change still requires schema, migration, rollback, backup, and test plans under ADR-0007.
- Future implementation must update module docs under `docs/modules/` after code and API behavior change.

## 2026-07-09: Module Documentation Map

Scope:

- Created module-level documentation under `docs/modules/`.
- Documented current real implementation for word content, user auth, video/VOD, admin portal, and data storage.
- Captured the project phase transition from fast MVP development to long-term maintenance.
- Updated `ARCHITECTURE.md` with a module map.
- Updated `PROJECT_OVERVIEW.md` with the long-term maintenance development flow.
- No business code, database structure, API behavior, or project directory structure was changed.

Changed:

- Added `docs/modules/word-content/PRINCIPLE.md`.
- Added `docs/modules/word-content/IMPLEMENTATION.md`.
- Added `docs/modules/user-auth/PRINCIPLE.md`.
- Added `docs/modules/user-auth/IMPLEMENTATION.md`.
- Added `docs/modules/video-vod/PRINCIPLE.md`.
- Added `docs/modules/video-vod/IMPLEMENTATION.md`.
- Added `docs/modules/admin-portal/PRINCIPLE.md`.
- Added `docs/modules/admin-portal/IMPLEMENTATION.md`.
- Added `docs/modules/data-storage/PRINCIPLE.md`.
- Added `docs/modules/data-storage/IMPLEMENTATION.md`.
- Added `docs/modules/README.md`.
- Updated `ARCHITECTURE.md`.
- Updated `PROJECT_OVERVIEW.md`.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Read `PROJECT_RULES.md`, `PROJECT_OVERVIEW.md`, `ARCHITECTURE.md`, `DEVELOPMENT_LOG.md`, `ADR/*`, `AGENTS.md`, and relevant local docs before editing.
- Inspected the current mini program, server, admin portal, content seed, and validation scripts.
- This was a documentation-only pass, so HBuilderX/WeChat manual validation and code behavior tests were not run.

Docs:

- This log entry records the module documentation phase.

Risks / Follow-up:

- The admin portal main page remains large and contains duplicate method names that should only be addressed in a confirmed refactor task.
- Phone quick login, quota, membership, payment, cloud learning records, and real VOD permission enforcement remain unimplemented.
- Keep `docs/modules/` synchronized when APIs, storage, routes, or module ownership change.

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
