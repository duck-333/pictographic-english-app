# Architecture v1

Date: 2026-07-09

This document records the current architecture and the confirmed direction. It is intentionally v1. Do not try to make it perfect in one pass. Update it after major architecture changes.

## System Context

```text
WeChat Mini Program
  |
  | public APIs / auth APIs
  v
Node API on HTTPS domain
  |
  | content read/write
  v
server word store

Node API
  |
  | user login data
  v
MySQL users + identity bindings

Admin Portal
  |
  | admin login + admin APIs
  v
Node API
```

## Runtime Components

### Mini Program

Path: `miniapp-uni/word-app1`

Technology:

- uni-app
- Vue2 entry style
- HBuilderX build
- WeChat Developer Tools preview

Responsibilities:

- Search words.
- Show public/published word detail.
- Play pronunciation audio when available.
- Show illustration when available.
- Play configured video clips when available.
- Show local learning data.
- Perform current WeChat identity login.

Non-responsibilities:

- No content management.
- No admin operations.
- No secrets.
- No direct database access.

### Admin Portal

Path: `admin-portal/pictographic-admin`

Technology:

- uni-app web admin portal
- server-side admin login
- local browser storage for drafts/workbench state

Responsibilities:

- Admin login.
- Word list and editing.
- Draft/published/unpublished/archive workflows.
- Bulk import and pending review queue.
- Homepage featured word management.
- Audio, video, and illustration metadata management.

Non-responsibilities:

- Not a mini program page.
- Not a public user-facing feature.
- Not a complete role-based admin system yet.

### Server API

Path: `server`

Technology:

- Node.js native `http`
- `mysql2/promise` for user database
- local JSON file store for current word content path

Responsibilities:

- Public published content APIs.
- Admin authenticated write APIs.
- Admin session login.
- WeChat mini program login.
- Server-side WeChat `jscode2session`.
- User token creation.

### Content Data

Current content store:

- `server/local-data/words.json` for server-managed content.
- `content-seed` for seed/import examples.
- `miniapp-uni/word-app1/common/mock-data.js` for bundled fallback/development content.

Longer-term direction:

- Move content to a real database or cloud store when operational needs require it.
- Keep `word-repository.js` as the mini program content access boundary.

### User Data

Current implemented tables:

```text
users
wechat_user_bindings
```

Confirmed next direction:

```text
user_phone_bindings
user_quota_accounts
user_quota_logs
```

Reserved next direction:

```text
user_entitlements
```

Later:

```text
learning_records
memberships
orders
book_activations
payment_records
```

Confirmed identity direction:

```text
users.id
  -> wechat_user_bindings.openid / unionid
  -> user_phone_bindings.phone_hash / phone_masked
  -> user_quota_accounts
  -> user_quota_logs
  -> future user_entitlements
```

## Module Map

The module docs under `docs/modules/` document the current implementation as it exists today. They are an index for future development, not a redesign or refactor plan.

| Module | Module docs | Primary source areas | Main API/storage boundaries |
| --- | --- | --- | --- |
| Word content | `docs/modules/word-content/PRINCIPLE.md`, `docs/modules/word-content/IMPLEMENTATION.md` | `miniapp-uni/word-app1/common/word-repository.js`, `miniapp-uni/word-app1/common/content-schema.js`, `miniapp-uni/word-app1/pages/index/index.vue`, `miniapp-uni/word-app1/pages/word-detail/index.vue`, `server/word-store.mjs` | `GET /api/words`, `GET /api/words/:id`, `GET /api/homepage/featured-word`, `POST /api/admin/words`, `server/local-data/words.json` |
| User auth | `docs/modules/user-auth/PRINCIPLE.md`, `docs/modules/user-auth/IMPLEMENTATION.md` | `miniapp-uni/word-app1/common/auth-api-client.js`, `miniapp-uni/word-app1/common/auth-store.js`, `miniapp-uni/word-app1/pages/mine/index.vue`, `server/auth.mjs`, `server/wechat-login.mjs`, `server/user-store.mjs` | `POST /api/auth/wechat-login`, `POST /api/admin/login`, `GET /api/admin/auth/check`, MySQL `users`, MySQL `wechat_user_bindings` |
| Video/VOD | `docs/modules/video-vod/PRINCIPLE.md`, `docs/modules/video-vod/IMPLEMENTATION.md` | `miniapp-uni/word-app1/pages/word-detail/index.vue`, `miniapp-uni/word-app1/common/content-schema.js`, `admin-portal/pictographic-admin/pages/index/index.vue`, `scripts/dev-preview-bridge.mjs`, `scripts/check-production-ready.mjs` | Media fields inside word records, `POST /api/admin/words`, public word APIs, local preview bridge `127.0.0.1:8787` for development only |
| Admin portal | `docs/modules/admin-portal/PRINCIPLE.md`, `docs/modules/admin-portal/IMPLEMENTATION.md` | `admin-portal/pictographic-admin/pages/index/index.vue`, `admin-portal/pictographic-admin/common/api-client.js`, `server/index.mjs`, `server/auth.mjs`, `server/word-store.mjs` | Admin session token, `POST /api/admin/login`, `POST /api/admin/words`, `GET/POST /api/admin/homepage-featured`, browser localStorage drafts |
| Data storage | `docs/modules/data-storage/PRINCIPLE.md`, `docs/modules/data-storage/IMPLEMENTATION.md` | `server/word-store.mjs`, `server/user-store.mjs`, `miniapp-uni/word-app1/common/user-store.js`, `miniapp-uni/word-app1/common/auth-store.js`, `content-seed`, `scripts/validate-content.mjs` | Service JSON word store, MySQL user tables, mini program storage, admin localStorage, seed JSON, dev preview generated files |

Cross-module rules:

- Public mini program content must still be filtered by `status === "published"` on the server.
- Admin functionality remains outside the user mini program.
- `users.id` remains the core user identity.
- Phone quick login and identity binding are one user identity system upgrade, not two disconnected features.
- Phone numbers must be searched by backend HMAC lookup and displayed only as masked values.
- Quota and entitlement are separate concepts:
  - Quota is consumable, such as `word_lookup`.
  - Entitlement is qualification-based, such as future member video/course access.
- Public word detail and full paid/entitled word detail must be separated by the content access layer.
- Video clipping remains a playback experience, not an entitlement boundary.
- Production database changes still require ADR, migration plan, rollback plan, and backup verification.

## Confirmed Next-Phase Module Map

The next development phase is architectural design first. These modules are confirmed direction, not implemented code yet.

| Module | ADR | Main responsibility | Implementation status |
| --- | --- | --- | --- |
| User identity system upgrade | `ADR/ADR-0010-user-identity-system-upgrade.md`, `ADR/ADR-0011-identity-binding-conflict-rules.md` | Phone quick login, WeChat binding, phone binding, conflict rules, `users.id` ownership | Not implemented |
| User entitlement model | `ADR/ADR-0012-user-entitlement-model.md` | Separate consumable quota from qualification entitlement; define `word_lookup` quota | Not implemented |
| Content access layer | `ADR/ADR-0014-content-access-layer-model.md` | Define `public_basic`, `user_full`, and future `member_media` content projections | Not implemented |
| Admin user entitlement query | `ADR/ADR-0013-admin-user-entitlement-query.md` | Minimal admin user list/detail, masked identity display, quota balance and ledger lookup | Not implemented |

## Current Data Flows

### Public Word Search

```text
miniapp search input
  -> word-repository.js
  -> GET /api/words?q=...
  -> server word-store published filter
  -> miniapp search results
```

Rules:

- Public responses must only include `status === "published"`.
- Remote empty result is authoritative.
- Bundled fallback is used only after explicit remote failure.

### Word Detail

```text
miniapp detail page
  -> GET /api/words/:id
  -> normalize public word
  -> detail rendering
```

Rules:

- Draft/unpublished/archived records must not render as public detail.
- Unsafe local/mock/example media must not be returned or rendered as production media.

### Admin Publish

```text
admin login
  -> POST /api/admin/login
  -> admin session token
  -> POST /api/admin/words
  -> server validation
  -> word store
  -> public API can read only if published
```

### Current WeChat Login

```text
miniapp uni.login()
  -> POST /api/auth/wechat-login
  -> server calls WeChat jscode2session
  -> openid/unionid
  -> find or create users row
  -> bind openid in wechat_user_bindings
  -> return project token
```

Rules:

- Mini program must not receive `openid`, `session_key`, app secret, DB password, or signing secret.
- `wechat_user_bindings.openid` is the WeChat identity lookup source.
- `users.id` is the internal account identity.

## Planned Entitlement Data Flow

Phone quick login, quota, entitlement, and content access enforcement are not implemented yet. The confirmed intended identity flow is:

```text
user taps phone quick login button
  -> getPhoneNumber returns phone code
  -> uni.login returns login code
  -> backend exchanges login code for openid
  -> backend exchanges phone code for phone number
  -> backend creates/finds user_id
  -> backend binds openid and phone
  -> backend applies identity conflict rules
  -> backend can grant register quota once after identity is resolved
  -> backend returns token + user + quota summary
```

Lookup quota intended flow:

```text
user enters full word detail
  -> backend verifies token
  -> backend checks quota balance
  -> backend deducts one lookup
  -> backend writes quota log
  -> backend returns full detail and new balance
```

Content access intended flow:

```text
GET /api/words/:id
  -> published filter
  -> public_basic projection
  -> no quota deduction

POST /api/words/:id/view
  -> user authentication
  -> quota / entitlement check
  -> word_lookup deduction when required
  -> user_full projection
  -> quota summary
```

Product rule:

- Each entry into a full word detail view costs one lookup.
- Re-entering the same word later costs again.
- Duplicate retries for the same request must be idempotent and must not double charge.
- Video/member media remains a future `member_media` access layer and cannot rely on client-side clipping as access control.

## API Surface

Current public APIs:

- `GET /api/health`
- `GET /api/homepage/featured-word`
- `GET /api/words`
- `GET /api/words/:id`

Current auth APIs:

- `POST /api/auth/wechat-login`

Current admin APIs:

- `POST /api/admin/login`
- `GET /api/admin/auth/check`
- `POST /api/admin/words`
- `GET /api/admin/homepage-featured`
- `POST /api/admin/homepage-featured`

Expected future APIs:

- `POST /api/auth/wechat-phone-login`
- `GET /api/me`
- `GET /api/me/quota`
- `POST /api/words/:id/view`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `GET /api/admin/users/:id/quota-logs`
- `POST /api/admin/users/:id/quota-adjustments`

Future APIs require ADR and schema design before implementation.

Confirmed future API semantics:

- `GET /api/words/:id` remains a read-only public/basic detail endpoint.
- `POST /api/words/:id/view` is the side-effecting full-detail view endpoint that may deduct `word_lookup` quota.
- Admin user APIs must require admin session auth and must not return phone plaintext, raw `session_key`, or full sensitive identity values.

## Security Architecture

- Secrets must stay server-side.
- Admin credentials are configured through server environment variables.
- User tokens and admin tokens must be signed with a production `JWT_SECRET`.
- Production must use HTTPS.
- WeChat legal domains must include the production API/media domains.
- Public content APIs must filter published status at the server.
- The mini program may apply client-side filters too, but server filtering is mandatory.
- Phone numbers must not be treated as ordinary display text. Store masked values and backend-queryable HMAC hashes; add encryption only when key management is real.
- Backend phone search must normalize input and query `phone_hash`; documentation, logs, and admin UI must not expose phone plaintext.
- Quota adjustments must be auditable.
- Full content and future video/course access must be decided server-side by a content access policy.

## Architecture Decision Records

Current ADR set:

- `ADR/ADR-0001-project-mainline-and-directory-boundaries.md`
- `ADR/ADR-0002-admin-extension-principles.md`
- `ADR/ADR-0003-user-id-core-identity.md`
- `ADR/ADR-0004-phone-quick-login-entitlement-entry.md`
- `ADR/ADR-0005-word-lookup-quota-deduction.md`
- `ADR/ADR-0006-quota-account-and-ledger.md`
- `ADR/ADR-0007-database-change-standard.md`
- `ADR/ADR-0008-ai-collaboration-standard.md`
- `ADR/ADR-0009-production-safety-standard.md`
- `ADR/ADR-0010-user-identity-system-upgrade.md`
- `ADR/ADR-0011-identity-binding-conflict-rules.md`
- `ADR/ADR-0012-user-entitlement-model.md`
- `ADR/ADR-0013-admin-user-entitlement-query.md`
- `ADR/ADR-0014-content-access-layer-model.md`

## Known Architecture Gaps

- Server docs and `.env.example` may lag the current admin username/password session login implementation.
- User login currently has no phone binding.
- Learning records remain local on device.
- Quota is not implemented.
- Entitlement is only reserved in architecture and not implemented.
- Content access layering is confirmed in ADR but not implemented.
- Admin user management is not implemented.
- Database migration process is not yet encoded in scripts.
- The admin portal page is large and should be split carefully when a clear module boundary appears.
- Module documentation now exists under `docs/modules/`, but it must be kept in sync when APIs, storage, or file ownership changes.
