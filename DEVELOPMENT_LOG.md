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

## 2026-07-10: Module 1.2 WeChat Phone Login API

Scope:

- Implemented Module 1.2 only.
- Added server-side `POST /api/auth/wechat-phone-login`.
- Kept the existing `POST /api/auth/wechat-login` behavior unchanged.
- Did not modify the mini program.
- Did not add phone authorization UI.
- Did not implement quota, membership, VOD permission, admin user management, or content access logic.
- Did not execute any database migration.

Changed:

- Updated `server/index.mjs` with the new phone login route orchestration.
- Updated `server/wechat-login.mjs` with WeChat access token retrieval, single-process in-memory cache, and phone code exchange.
- Added `scripts/test-wechat-phone-login-api.mjs`.
- Updated `package.json` so `check:server` runs the Module 1.2 API test.
- Updated `docs/modules/user-auth/IMPLEMENTATION.md`.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Ran `node --check server/wechat-login.mjs`.
- Ran `node --check server/index.mjs`.
- Ran `node --check server/identity-store.mjs`.
- Ran `node --check scripts/test-wechat-phone-login-api.mjs`.
- Ran `node scripts/test-identity-store.mjs`.
- Ran `node scripts/test-wechat-phone-login-api.mjs`.
- Ran `git diff --check`; it passed with LF/CRLF warnings only.
- Ran `npm.cmd run check:server`; Module 1.2 syntax checks and tests passed, then the existing `scripts/test-server-word-api-link.mjs` assertion failed with `remote empty search results must not silently fall back to bundled words`.

Docs:

- User auth implementation docs now record the new phone login API, data flow, file responsibilities, security rules, and test coverage.
- No ADR update was required because implementation follows ADR-0010 and ADR-0011 without changing durable architecture decisions.

Risks / Follow-up:

- `user_phone_bindings` must exist in the target database before the real API can complete phone binding. The migration file still has not been executed.
- The mini program still has no phone authorization UI, so the new API is not yet reachable from the user client.
- Real WeChat phone code exchange still requires production WeChat configuration and manual integration validation.
- `npm.cmd run check:server` still has the pre-existing word API guard failure outside Module 1.2.
- Work stops here for human review and must not continue into Module 1.3 automatically.

## 2026-07-10: Module 1.2 Implementation Plan Constraints

Scope:

- Added Module 1.2 implementation plan constraints for the planned WeChat phone quick login API.
- Kept the work documentation-only.
- Did not modify business code.
- Did not create or execute any database migration.
- Did not implement any API route.

Changed:

- Added `docs/modules/user-auth/MODULE_1_2_IMPLEMENTATION_PLAN.md`.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Read `PROJECT_RULES.md`, `DEVELOPMENT_LOG.md`, and `docs/modules/user-auth/IMPLEMENTATION.md` before editing.
- Reviewed current ADR file list before deciding no ADR update is required.

Docs:

- The Module 1.2 plan records requestId tracing-only rules, WeChat access token cache constraints, user session token compatibility, and safe API error response format.
- No ADR update is required because the constraints stay within ADR-0010 and ADR-0011 and do not change durable architecture decisions.

Risks / Follow-up:

- Module 1.2 implementation still requires explicit human confirmation before coding.
- Future coding must keep `POST /api/auth/wechat-login` compatible and must not add token verification or permission expansion in Module 1.2.

## 2026-07-10: Module 1.1 Review Fixes

Scope:

- Fixed Module 1.1 review findings only.
- Did not enter Module 1.2.
- Did not add an API route.
- Did not modify the mini program.
- Did not execute any database migration.

Changed:

- Updated `server/identity-store.mjs` so `resolveWechatPhoneIdentity()` handles MySQL duplicate-key races by rolling back, re-querying bindings, and returning a stable identity result or sanitized identity conflict.
- Updated `package.json` so `npm.cmd run check:server` includes `server/identity-store.mjs` syntax check and `scripts/test-identity-store.mjs`.
- Updated `docs/modules/user-auth/IMPLEMENTATION.md`.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Ran `node --check server/identity-store.mjs`.
- Ran `node scripts/test-identity-store.mjs`.
- Ran `npm.cmd run check:server`; identity-store syntax checks and offline tests passed, then the existing `scripts/test-server-word-api-link.mjs` assertion failed with `remote empty search results must not silently fall back to bundled words`.

Docs:

- User auth implementation docs now mention duplicate-key race handling inside the identity storage boundary.

Risks / Follow-up:

- If `npm.cmd run check:server` still fails in `scripts/test-server-word-api-link.mjs`, treat it as the existing word-content guard failure unless the failure moves into `identity-store`.
- Module 1.2 still requires separate confirmation.

## 2026-07-09: Module 1.1 Identity Storage Boundary

Scope:

- Implemented Module 1.1 for the user identity system upgrade.
- Added identity data access and binding-rule storage boundary for future phone quick login.
- Added a reviewable MySQL migration file for `user_phone_bindings`.
- Added offline tests for phone normalization, HMAC hash stability, masking, and conflict decisions.
- Did not add an API route.
- Did not modify the mini program.
- Did not call WeChat phone APIs.
- Did not add token generation, quota, permission, membership, VOD, admin user management, or content access logic.
- Did not execute any database migration.

Changed:

- Added `server/identity-store.mjs`.
- Added `database/migrations/001_create_user_phone_bindings.sql`.
- Added `scripts/test-identity-store.mjs`.
- Updated `docs/modules/user-auth/IMPLEMENTATION.md`.
- Updated `docs/modules/data-storage/IMPLEMENTATION.md`.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Ran `node --check server/identity-store.mjs`.
- Ran `node --check scripts/test-identity-store.mjs`.
- Ran `node scripts/test-identity-store.mjs`.
- Ran `git diff --check`; it passed with LF/CRLF warnings for edited Markdown files.
- Ran `npm.cmd run check:server`; syntax checks passed, but the existing `scripts/test-server-word-api-link.mjs` assertion failed with `remote empty search results must not silently fall back to bundled words`. This failure is outside Module 1.1 and no word-content code was changed.

Docs:

- User auth implementation docs now record `identity-store.mjs` responsibilities, core functions, and boundaries.
- Data storage implementation docs now record the migration file, schema fields, index plan, no-FK decision, and phone privacy rules.
- No new ADR was required because this implementation follows ADR-0010 and ADR-0011 without changing durable architecture decisions.

Risks / Follow-up:

- `database/migrations/001_create_user_phone_bindings.sql` has not been executed and still requires human review, backup verification, rollback approval, and target database confirmation before use.
- The migration does not declare a foreign key because the project has no unified foreign key policy and the production `users.id` column type is not captured in repository schema files.
- `server/identity-store.mjs` is not connected to any API yet. Module 1.2 must be confirmed separately before API integration.
- Work stops here for human review and must not continue into Module 1.2 automatically.

## 2026-07-09: Module 1 Implementation Preparation

Scope:

- Recorded "Module 1进入实施阶段准备" after Module 1 implementation design review.
- Defined Module 1.1 as the first implementation block for identity storage and the phone binding database boundary.
- Kept the work documentation-only.
- No business code was modified.
- No database was created or changed.
- No API was implemented.

Changed:

- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Read `PROJECT_RULES.md`, `PROJECT_OVERVIEW.md`, `ARCHITECTURE.md`, `DEVELOPMENT_LOG.md`, relevant ADRs, and relevant module/database docs before editing.
- Confirmed ADR-0003, ADR-0007, ADR-0010, and ADR-0011 already cover the current Module 1.1 architecture decisions.
- Implementation tests were not run because no code changed.

Docs:

- No new ADR is required for Module 1.1 if the scope stays within the accepted user identity, phone binding, conflict handling, and database change rules.
- Confirmed Module 1.1 implementation constraints:
  - `identity-store.mjs` may only handle identity data access and binding rules.
  - `identity-store.mjs` must not include token generation, WeChat API calls, quota logic, or permission logic.
  - `user-store.mjs` must remain compatible with the current WeChat login flow and must not be refactored broadly.
  - Database work may only create a migration file; it must not execute database changes.
  - The migration file must include up plan, rollback plan, field descriptions, and index descriptions.
  - Phone handling must follow input phone -> normalize -> HMAC-SHA256 -> store hash and masked phone.
  - Phone plaintext must not be stored or printed in logs.
  - After Module 1.1 is completed, work must stop for human review and must not continue into Module 1.2 automatically.

Risks / Follow-up:

- Module 1.1 still requires explicit human confirmation before coding.
- Production database execution still requires migration script review, rollback plan, backup confirmation, and human approval under ADR-0007.
- If implementation scope expands to account merge, phone unbinding, quota grants, admin user management, or content access enforcement, a new ADR or ADR update is required before coding.

## 2026-07-09: Environment and Server Documentation Consistency

Scope:

- Fixed environment variable and server deployment documentation consistency.
- Kept the work documentation-only.
- No business code was modified.
- No database was created or changed.
- No API was implemented.

Changed:

- Updated `.env.example` from the old admin API token example to admin username/password, session, JWT, and phone hash secret placeholders.
- Updated `server/README.md` to describe the current admin username/password login and Bearer session token flow.
- Added `PHONE_HASH_SECRET=` documentation for HMAC-SHA256 phone identity hashing.
- Updated `DEVELOPMENT_LOG.md`.

Verified:

- Read `PROJECT_RULES.md`, `.env.example`, `server/README.md`, `DEVELOPMENT_LOG.md`, and current server auth code before editing.
- Ran `git diff --check`.

Docs:

- This entry records the environment variable and server README consistency fix.

Risks / Follow-up:

- `PHONE_HASH_SECRET` is documented for the planned phone identity system, but phone login is still not implemented.
- No actual server environment variables were changed by this documentation update.

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
