# Architecture v1

Date: 2026-07-15

This document records the current architecture and the confirmed direction. It is intentionally v1. Do not try to make it perfect in one pass. Update it after major architecture changes.

## Current Module Status

```text
Module 1: 用户身份体系升级 - Completed
```

Completed scope:

- Module 1.1: `server/identity-store.mjs` identity storage boundary.
- Module 1.2: `POST /api/auth/wechat-phone-login` server API.
- Module 1.3.1: mini program auth client/store phone login capability.
- Module 1.3.2: Mine page `button open-type="getPhoneNumber"` entry.
- Module 1 closing fix: safe error mapping for phone-login API responses.

Production validation:

- `database/migrations/001_create_user_phone_bindings.sql` has been executed in production MySQL.
- Production `user_phone_bindings` exists.
- WeChat phone quick login has been verified on the production server.
- A production test binding exists in `user_phone_bindings` with `user_id=1`, `phone_masked=195****0953`, and `status=active`.
- Before/after production backups were saved under `~/backups/`.
- The word API guard failure remains an independent legacy issue outside Module 1.

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

## Production API Deployment

Current production API deployment, as of 2026-07-15:

```text
https://baxiaota.com/api/*
  -> Nginx /etc/nginx/sites-enabled/baxiaota.com
  -> proxy_pass http://127.0.0.1:3002
  -> PM2 pictographic-english-api-new
```

Migration record:

- `docs/deployment/API_PORT_MIGRATION_2026-07-15.md`

Previous production API deployment:

```text
PM2 pictographic-english-api-full
port 3001
status: old production service
```

Current production API deployment:

```text
PM2 pictographic-english-api-new
port 3002
status: current production service
```

The public API base remains `https://baxiaota.com`; mini program and admin clients should not call the local PM2 port directly.

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
- Perform WeChat identity login and phone quick login.

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
- Server-side WeChat phone code exchange.
- User identity binding through WeChat and phone bindings.
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

Current implemented user tables/code paths:

```text
users
wechat_user_bindings
```

Module 1 phone binding storage is implemented in production:

```text
user_phone_bindings
```

Confirmed next learning data sync direction:

```text
user_favorites
user_word_views
user_learning_daily_stats
```

Confirmed commercial rights direction:

```text
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
  -> user_favorites
  -> user_word_views
  -> user_learning_daily_stats
  -> user_quota_accounts
  -> user_quota_logs
  -> future user_entitlements
```

Learning behavior and commercial rights are separate:

```text
learning data
  -> favorites
  -> word views
  -> daily learning stats

commercial rights
  -> quota accounts
  -> quota logs
  -> entitlements
```

The mini program's local `pictographic:userState` remains the current implementation for favorites, recent words, `searchCount`, and `streakDays`. It is planned to become visitor-mode cache and offline fallback after server-side learning data sync is implemented. Local `searchCount` must not be treated as a real quota balance.

## Module Map

The module docs under `docs/modules/` document the current implementation as it exists today. They are an index for future development, not a redesign or refactor plan.

| Module | Module docs | Primary source areas | Main API/storage boundaries |
| --- | --- | --- | --- |
| Word content | `docs/modules/word-content/PRINCIPLE.md`, `docs/modules/word-content/IMPLEMENTATION.md` | `miniapp-uni/word-app1/common/word-repository.js`, `miniapp-uni/word-app1/common/content-schema.js`, `miniapp-uni/word-app1/pages/index/index.vue`, `miniapp-uni/word-app1/pages/word-detail/index.vue`, `server/word-store.mjs` | `GET /api/words`, `GET /api/words/:id`, `GET /api/homepage/featured-word`, `POST /api/admin/words`, `server/local-data/words.json` |
| User auth | `docs/modules/user-auth/PRINCIPLE.md`, `docs/modules/user-auth/IMPLEMENTATION.md` | `miniapp-uni/word-app1/common/auth-api-client.js`, `miniapp-uni/word-app1/common/auth-store.js`, `miniapp-uni/word-app1/pages/mine/index.vue`, `server/auth.mjs`, `server/wechat-login.mjs`, `server/user-store.mjs`, `server/identity-store.mjs` | `POST /api/auth/wechat-login`, `POST /api/auth/wechat-phone-login`, `POST /api/admin/login`, `GET /api/admin/auth/check`, MySQL `users`, MySQL `wechat_user_bindings`, MySQL `user_phone_bindings` |
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

## Completed And Next-Phase Module Map

Module 1 is complete for the confirmed user identity scope. The remaining modules below are future development targets and require their own design, implementation, review, and tests.

| Module | ADR | Main responsibility | Implementation status |
| --- | --- | --- | --- |
| User identity system upgrade | `ADR/ADR-0010-user-identity-system-upgrade.md`, `ADR/ADR-0011-identity-binding-conflict-rules.md` | Phone quick login, WeChat binding, phone binding, conflict rules, `users.id` ownership | Completed; production migration and phone login validation completed on 2026-07-15 |
| User learning data sync | `ADR/ADR-0015-user-learning-data-sync.md` | Server-side favorites, word views, daily learning stats, visitor cache migration rules | Not implemented; design stage only |
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

### Current Phone Quick Login

```text
Mine page button open-type=getPhoneNumber
  -> event.detail.code as phoneCode
  -> miniapp uni.login() as loginCode
  -> POST /api/auth/wechat-phone-login
  -> server calls WeChat jscode2session
  -> server exchanges phoneCode through WeChat phone API
  -> identity-store normalizes phone
  -> HMAC-SHA256(phone, PHONE_HASH_SECRET)
  -> find or create users.id
  -> bind openid in wechat_user_bindings
  -> bind phone_hash / phone_masked in user_phone_bindings
  -> return project token + safe user summary
  -> auth-store saves token, expiresAt, user.id, hasWechatBinding, hasPhoneBinding, phoneMasked
```

Rules:

- Mini program must not receive `openid`, `session_key`, WeChat `access_token`, phone plaintext, app secret, DB password, or signing secret.
- Phone plaintext exists only transiently on the server between WeChat phone response and identity-store normalization/hash/mask.
- Production phone login uses the migrated `user_phone_bindings` table. Any new target database still requires reviewed migration execution, rollback planning, and backup verification under ADR-0007 before real traffic.
- Binding conflicts follow ADR-0011 and must not be auto-merged.

### Current Local Learning Data

```text
miniapp favorites / recent words / counters
  -> miniapp user-store.js
  -> uni storage pictographic:userState
  -> Mine page and homepage counters
```

Current fields:

```text
favoriteWordIds
recentWordIds
searchCount
streakDays
lastActiveDate
```

Rules:

- This data is not bound to `users.id` yet.
- Logging out clears `pictographic:authSession`, but does not clear `pictographic:userState`.
- Clearing mini program storage removes this learning data.
- The next module must make logged-in learning data server-owned while keeping local storage for visitor mode and offline fallback.
- Visitor data migration must require explicit user confirmation after login.

### Planned User Learning Data Sync

```text
logged-in miniapp user
  -> Authorization: Bearer <user token>
  -> server verifies user token
  -> users.id
  -> user_favorites
  -> user_word_views
  -> user_learning_daily_stats
  -> miniapp renders account learning state
```

Planned visitor migration:

```text
local pictographic:userState
  -> user logs in
  -> miniapp asks for confirmation
  -> server imports local favorites / recent words under users.id
  -> server returns latest learning state
```

## Planned Entitlement Data Flow

Quota, entitlement, and content access enforcement are not implemented yet. Phone quick login now provides the user identity foundation that those future modules must reference through `users.id`.

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
- `POST /api/auth/wechat-phone-login`

Current admin APIs:

- `POST /api/admin/login`
- `GET /api/admin/auth/check`
- `POST /api/admin/words`
- `GET /api/admin/homepage-featured`
- `POST /api/admin/homepage-featured`

Expected future APIs:

- `GET /api/me`
- `GET /api/me/learning-state`
- `POST /api/me/learning-state/import`
- `GET /api/me/favorites`
- `POST /api/me/favorites`
- `DELETE /api/me/favorites/:wordId`
- `GET /api/me/word-views`
- `POST /api/me/word-views`
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
- `ADR/ADR-0015-user-learning-data-sync.md`

## Known Architecture Gaps

- Server docs and `.env.example` may lag the current admin username/password session login implementation.
- Module 1 user identity code path, production `user_phone_bindings` migration, and production WeChat phone quick login validation are completed.
- Future staging or production-like databases still require reviewed/manual `user_phone_bindings` migration execution before real phone binding traffic.
- `npm.cmd run check:server` still has an independent word API guard failure in `scripts/test-server-word-api-link.mjs`.
- Learning records remain local on device.
- User learning data sync is design-only; `user_favorites`, `user_word_views`, and `user_learning_daily_stats` do not exist yet.
- Quota is not implemented.
- Entitlement is only reserved in architecture and not implemented.
- Content access layering is confirmed in ADR but not implemented.
- Admin user management is not implemented.
- Database migration process is not yet encoded in scripts.
- The admin portal page is large and should be split carefully when a clear module boundary appears.
- Module documentation now exists under `docs/modules/`, but it must be kept in sync when APIs, storage, or file ownership changes.
