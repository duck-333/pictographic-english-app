# Pictographic English Local API

This folder contains the smallest development API used to connect:

- admin content editor
- mini program word repository
- local/server test storage

It is for development and server testing before the mini program has a filed HTTPS domain.

## Run

From the repository root:

```text
npm.cmd run dev:api
```

Default endpoint:

```text
http://127.0.0.1:3001
```

Development admin token:

```text
dev-admin-token
```

To test from another device or a server, expose port `3001` and use:

```text
http://SERVER_IP:3001
```

To use a custom admin token during development, set `ADMIN_API_TOKEN` before starting the API:

```text
$env:ADMIN_API_TOKEN="replace-with-a-private-token"
npm.cmd run dev:api
```

Production must set a private `ADMIN_API_TOKEN`. If `NODE_ENV=production` and `ADMIN_API_TOKEN` is missing, empty, or `dev-admin-token`, admin write APIs fail closed.

Production user tokens also require a private, stable `JWT_SECRET`. If `NODE_ENV=production` and `JWT_SECRET` is missing or empty, the API exits during startup before listening on the HTTP port. Development can omit `JWT_SECRET`; in that case the API uses a process-local temporary secret for convenience, and tokens become invalid after process restart.

For PM2 deployment, make sure the process environment includes at least:

```js
env: {
  NODE_ENV: 'production',
  JWT_SECRET: 'replace-with-a-private-stable-secret',
  ADMIN_API_TOKEN: 'replace-with-a-private-admin-token'
}
```

After changing PM2 environment variables, restart or reload the process with the updated environment and verify `/api/health`.

## Admin Unlock Flow

The admin portal is protected by the same minimal Bearer token guard:

1. Open `admin-portal/pictographic-admin`.
2. Enter the Admin API Token on the admin login card.
3. The portal calls `GET /api/admin/auth/check`.
4. Only a valid token unlocks the content workbench.
5. The token is stored locally in `localStorage` as `pictographic:adminApiToken` for development convenience.
6. Click `锁定/退出` to clear the local token and return to the login card.

This is still not a complete user/account system. It is a minimum management password layer for the current admin API.

## Data

For tests and development, the API uses this local default file when `WORD_DATA_PATH` is not configured:

```text
server/local-data/words.json
```

This default file is ignored by Git and is only for tests and development. In production, `WORD_DATA_PATH` is required and must be an absolute path to a persistent JSON file outside the release directory. Startup fails before the server listens if that file is missing, unreadable, malformed, has an unsupported root structure, or has no valid published word.

Formal word data, including the production `words.json`, must remain outside Git and must not be copied into a release or committed to this repository.

## API

### GET /api/health

Returns API status and word count.

### GET /api/words

Returns published words only.

Optional query:

```text
GET /api/words?q=study
```

### GET /api/words/:id

Returns one published word by stable `id`.

Published search and detail responses explicitly pass through `normalizePublicWord()` in `server/word-store.mjs`. A valid stored `illustrationImage` is returned with the word:

```json
{
  "illustrationImage": {
    "url": "https://cdn.baxiaota.com/images/student.png",
    "title": "student 示意图",
    "alt": "student 象形讲解"
  }
}
```

If the stored image URL is empty or is not a production HTTPS URL, the public response uses an empty `illustrationImage` object. Unsafe stored URLs are never returned to the mini program.

### GET /api/homepage/featured-word

Returns the current published homepage recommendation:

```json
{
  "ok": true,
  "word": null,
  "source": "empty"
}
```

`source` is `manual`, `dailyRotation`, or `empty`. The endpoint never returns draft, unpublished, archived, review, pending, unknown, or missing-status words.

When `word` is present, it uses the same `normalizePublicWord()` projection as public search and detail responses, including the cleaned `illustrationImage`.

### GET /api/admin/auth/check

Checks whether the provided admin token can access management APIs.

Requires:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
```

Responses:

```json
{ "ok": true }
```

Missing token:

```json
{ "ok": false, "message": "Unauthorized" }
```

Wrong token:

```json
{ "ok": false, "message": "Unauthorized" }
```

### POST /api/admin/words

Saves or updates one admin-managed word. The admin portal uses this endpoint directly for `发布当前词条`, `撤下当前词条`, `归档当前词条`, and `发布全部本地草稿到服务器`.

Requires:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
```

For local development, use:

```text
Authorization: Bearer dev-admin-token
```

Request body:

```json
{
  "word": {
    "id": "word-study",
    "word": "study",
    "status": "published",
    "meaning": "learn; research",
    "pictograph": "..."
  }
}
```

The server reuses `miniapp-uni/word-app1/common/content-schema.js` to normalize and validate records.

Word records may include an optional illustration image:

```json
{
  "illustrationImage": {
    "url": "https://cdn.baxiaota.com/images/study.png",
    "title": "study 示意图",
    "alt": "展示 study 的象形拆解关系",
    "provider": "cos",
    "assetId": "images/study.png",
    "uploadStatus": "ready",
    "uploadedAt": "2026-06-23T00:00:00.000Z"
  }
}
```

An empty URL means no public illustration. Non-string URLs and non-production addresses are rejected by the Admin write API. Public records only retain HTTPS image URLs that are not local, temporary, mock, or example-domain addresses.

### GET /api/admin/homepage-featured

Returns the saved homepage recommendation configuration, the currently resolved word, and published words available for selection.

Requires:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
```

### POST /api/admin/homepage-featured

Saves the homepage recommendation configuration:

```json
{
  "featuredWordIds": ["tud", "cool"],
  "mode": "dailyRotation",
  "manualWordId": ""
}
```

The stored configuration is:

```json
{
  "featuredWordIds": ["tud", "cool"],
  "mode": "dailyRotation",
  "manualWordId": "",
  "updatedAt": "2026-06-23T00:00:00.000Z",
  "updatedBy": "admin-api"
}
```

Only published word IDs can be saved. Daily rotation uses the Asia/Shanghai calendar-day number modulo the number of currently published pool words. Manual mode returns `manualWordId` when it is still published; otherwise it falls back to the published recommendation pool. An empty valid pool returns `word: null`.

## WeChat virtual payment environments

`VIRTUAL_PAYMENT_ENV` is the authoritative environment selector when
`VIRTUAL_PAYMENT_ENABLED=true`:

- `sandbox` derives request/message `Env=1` and `query_order env_type=2`. It uses the
  existing sandbox Offer ID, Product ID, AppKey, user allowlist, and optional ¥1 test
  product configuration.
- `production` requires `NODE_ENV=production`, derives request/message `Env=0` and
  `query_order env_type=1`, and uses only the ¥30 product configured by
  `WECHAT_VIRTUAL_PAYMENT_PRODUCTION_OFFER_ID`,
  `WECHAT_VIRTUAL_PAYMENT_PRODUCTION_PRODUCT_ID`, and
  `WECHAT_VIRTUAL_PAYMENT_PRODUCTION_APP_KEY`. It does not read the sandbox user
  allowlist and rejects the sandbox ¥1 test-product switch.

Production message delivery additionally requires the existing message endpoint to
be enabled with JSON and AES mode, including its Token, original ID, mini-program
AppID, and EncodingAESKey environment variables. `npm.cmd run check:production`
validates these requirements only when virtual payment is enabled and never prints
secret values. This is a code/configuration readiness boundary; it does not mean the
production payment feature has been deployed or validated against WeChat.

## Safety Boundaries

- Production mini programs read published text entries from `https://baxiaota.com/api/words` and `https://baxiaota.com/api/words/:id`.
- Public word APIs use strict `status === "published"` filtering. Missing or any other status is treated as non-public.
- `illustrationImage.url` is normalized through the shared content schema. Public mini program rendering accepts production HTTPS images only.
- The public homepage recommendation API applies the same strict published filtering at response time, so later unpublish/archive actions take effect without rewriting the recommendation configuration.
- `GET /api/words` returns at most 20 matching records per request.
- Admin write APIs require a Bearer token. This is the minimum guard for development and deployment testing, not a complete admin login system.
- `GET /api/admin/auth/check` uses the same token guard so the admin portal can verify a token before showing the workbench.
- The frontend may store a local development token in `localStorage` under `pictographic:adminApiToken`. Do not treat it as a real account session.
- Do not commit real `.env` files or real `ADMIN_API_TOKEN` values.
- Production must set `ADMIN_API_TOKEN` to a private, non-default value.
- Production must set `NODE_ENV=production` and `JWT_SECRET` before starting the API. Missing `JWT_SECRET` fails startup intentionally.
- Production must set an independent `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET` of at least 32 bytes before phone login is enabled. Generate a new value with `openssl rand -hex 32`; do not reuse `PHONE_HASH_SECRET`, `JWT_SECRET`, `ADMIN_API_TOKEN`, `REDEMPTION_CODE_HASH_SECRET`, `BOOK_ORDER_CLAIM_HASH_SECRET`, or `WECHAT_MINIAPP_SECRET`. Once production phone identity data exists, do not rotate this secret without an approved data migration plan.
- Invitation foundation code requires separate `INVITATION_TOKEN_HMAC_SECRET` and `INVITATION_CANDIDATE_HMAC_SECRET` values of at least 32 bytes. Generate each independently with `openssl rand -hex 32`. They must differ from each other and from JWT, phone, campaign, admin, redemption-code, book-order, `WECHAT_SECRET`, `WECHAT_MINIAPP_SECRET`, `WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY`, and `WECHAT_VIRTUAL_PAYMENT_PRODUCTION_APP_KEY`. Obvious placeholders, low-diversity values, and repeated patterns are rejected. Only HMAC digests and key-version markers are stored; plaintext invitation tokens and candidate receipts are returned once and must never be logged. Candidate ownership must come from the internal `trustedCandidateSubject` derived from a verified server session; a client receipt is never accepted as an ownership fact or as a caller-selected first insert value.
- Identity, entitlement, and invitation consistency methods accept only the shared active context supplied by `withDatabaseTransaction(connection, callback)` or its pool-owning wrapper. The wrapper begins the supplied connection, commits on success, rolls back on error, and permanently invalidates each module-private branded context after its attempt. A context exposes only `execute` and controlled `query`; it does not expose transaction lifecycle, release, pool, or connection-acquisition methods. Raw connections, caller-created objects, and expired contexts fail closed.
- A connection is exclusively occupied before begin for the whole retry cycle. Nested or concurrent entry fails with `DATABASE_TRANSACTION_CONNECTION_BUSY` without a second begin. Rollback failure produces `DATABASE_TRANSACTION_CLEANUP_FAILED` with both `originalError` and `rollbackError`, destroys and permanently quarantines the connection, and prevents pool release or later reuse (`DATABASE_TRANSACTION_CONNECTION_UNUSABLE`).
- Pool release failure uses the separate `releaseError` field and never masquerades as `rollbackError`; it immediately quarantines the connection, makes one best-effort `destroy` call, never releases or reuses it again, and keeps original, rollback, release, and destroy failures distinguishable.
- Complete invited-phone registration first locates all currently known WeChat, phone, and inviter user IDs without locking, then initializes one sealed `existingUserScope` and locks the deduplicated IDs once in numeric BIGINT ascending order (without JavaScript `Number` conversion). The sealed scope includes IDs allowed to be missing from that first query; `lockedUserIds` contains only rows actually locked, while `createdUserIds` contains only users created and locked through the controlled transaction insert. READY reuse may request only `existingUserScope ∪ createdUserIds`, returns only the actually locked subset, never re-queries a previously missing scoped ID, and reports a scoped missing ID as `DATABASE_TRANSACTION_USER_NOT_FOUND` when `allowMissing` is false rather than as lock expansion. Even a transaction with no existing participants must explicitly initialize an empty scope before creating a user; uninitialized scope fails closed before any `users` INSERT. IDs must be canonical values from 1 through `18446744073709551615`. Existing users enter the private lock set only through the sorted `FOR UPDATE`; a new user enters only after the shared module executes a controlled `users` INSERT with no caller-supplied ID, verifies strict affectedRows/database insertId, and locks the matching `LAST_INSERT_ID()` row. The existing-user scope cannot be expanded after initialization. Identity facts are reread before mutation; invitation reserve reuses the same scope and actual lock result, then locks share-credential before registration-relation and revalidates all facts without a cross-table locking join. A missing inviter therefore finalizes as `NO_REWARD/INVITER_NOT_FOUND` without blocking normal registration or the invitee's registration bonus.
- `withDatabaseTransaction` makes at most three total attempts. Its defaults retry only `ER_LOCK_DEADLOCK` or `ER_LOCK_WAIT_TIMEOUT`; the invited-registration owner additionally whitelists only classified phone/WeChat binding races and changed-participant facts. Exhausted internal identity races become a stable, sanitized `IDENTITY_CONFLICT`. Every retry starts at non-locking participant discovery after a successful rollback with a fresh context. Unrelated duplicate keys and other failures are never retried. The callback must contain only replay-safe database work—no HTTP, payment, messages, logging side effects, or other irreversible actions—and only the committed attempt's result may be returned.
- `REGISTER_BONUS` follows migration 005's existing second-precision `DATETIME` columns. It obtains grant and expiry timestamps from one transaction-connection query using `UTC_TIMESTAMP()` and MySQL `DATE_ADD(..., INTERVAL 1 YEAR)`. Replay strictly parses raw integer facts for the transaction, previous/latest balances, snapshot, SUM, and COUNT, then validates exact registration facts, the historical row's own one-year relation, and ledger/snapshot chains; malformed facts fail with `IDEMPOTENCY_KEY_CONFLICT`. Migration 011 does not alter the existing entitlement table; invitation tables keep their own `DATETIME(3)` fields.
- Future phone-login orchestration must finish WeChat HTTP exchange and prepare its module-branded trusted phone identity before opening one top-level shared database transaction. That context then carries only replay-safe database work for the first-phone-registration fact, invitee `REGISTER_BONUS`, invitation `FINAL`, and inviter reward-slot reservation before one commit. This batch adds internal transaction interfaces and a test-only composition but does not change the phone-login route or issue either entitlement in production.
- Development may use `http://127.0.0.1:3001` or `http://SERVER_IP:3001`.
- Production must use a filed HTTPS domain configured in the WeChat mini program allowed request domains.
- `npm.cmd run check:production` blocks local HTTP API bases in production or unknown runtime.
- `npm.cmd run check:production` also verifies that production admin auth rejects empty/default tokens.
- `npm.cmd run check:production` also verifies that production user JWT auth rejects missing `JWT_SECRET`.
- `npm.cmd run check:production` also verifies the required length and non-reuse contract for `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET` with test-only values.
