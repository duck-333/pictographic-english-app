# Pictographic English Local API

## Admin published-word refresh (2026-10-03)

`GET /api/admin/words` requires the existing Admin API Token and returns every published word as a complete normalized record. It uses `publishedOnly: true` without the public 20-item limit. It does not return draft, unpublished, or archived records and does not mutate word data.

The admin workbench uses this endpoint only when an administrator clicks `从服务器刷新`. Local drafts and pending imports stay local; the refresh does not publish, unpublish, archive, or delete server records.

## Invitation registration v14 verification status (2026-09-29)

- The current-worktree invitation gate passed once, without a rerun, on MySQL 8.0.46 with Docker Client/Server 29.6.2. The fresh container was `pictographic-invitation-mysql-20260929-v14`, bound only to `127.0.0.1:3309`, with an anonymous MySQL data volume, a random root test password, and destructive gate `local-docker-invitation-only`. `npm.cmd run test:invitation-mysql-integration` printed `invitation isolated MySQL integration tests passed` and exited 0.
- This v14 result covers a random temporary database; random migration/runtime users; exact least privileges and runtime DDL denial; the real 001-011 migration chain; and formal HTTP-to-service-to-shared-transaction-to-Identity/Entitlement/Invitation-Store-to-MySQL execution. Covered scenarios include JWT/receipt downgrade, atomic A/B identity-conflict rollback, inviter-phone revalidation, missing inviter, the deterministic cross barrier and locking/current eligibility read under default `REPEATABLE READ`, phone race, same-openid convergence, direct-Store replay, inviter 100's first-five slots/rollback/fifth-sixth competition/reward cap, the 208/210 mutual invitation, and idempotency, constraints, concurrency, and cleanup gates.
- v7 through v13 remain historical failed runs and repair evidence; v13 still exited 1. Only v14 is the complete successful real-MySQL evidence for the current worktree. The script completed temporary-database and migration/runtime-user cleanup plus its health check with exit 0. The v14 container and anonymous volume were then deleted, the port-3309 listener count was zero, and test environment variables were cleared.
- Git remains at 22 tracked modifications and 22 untracked files, with an empty index and no `miniapp-uni` change. Nothing has been staged, committed, pushed, or opened as a PR. Migration 011 has not run in production, no production database was connected, and nothing was deployed. The mini-program invitation page/share entry and actual `SHARE_REWARD` grant remain unimplemented; this batch reserves only `REWARD_PENDING`. This is not production-ready and must pass final independent review before staging.

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

### GET /api/admin/words

Returns all published words as complete normalized records for the authenticated admin refresh workflow. Unlike the public list, this endpoint has no 20-item cap. It excludes draft, unpublished, archived, review, pending, unknown, and missing-status records.

Requires:

```text
Authorization: Bearer <ADMIN_API_TOKEN>
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
- Invitation foundation code requires separate `INVITATION_TOKEN_HMAC_SECRET` and `INVITATION_CANDIDATE_HMAC_SECRET` values of at least 32 bytes. Generate each independently with `openssl rand -hex 32`. They must differ from each other and from JWT, phone, campaign, admin, redemption-code, book-order, `WECHAT_SECRET`, `WECHAT_MINIAPP_SECRET`, `WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY`, and `WECHAT_VIRTUAL_PAYMENT_PRODUCTION_APP_KEY`. Obvious placeholders, low-diversity values, and repeated patterns are rejected. Only HMAC digests and key-version markers are stored; plaintext invitation tokens and candidate receipts are returned once and must never be logged. Candidate ownership uses the internal length-delimited `wechat-miniapp-v1` subject derived from the one server-configured mini-program AppID and a server-side binding or current `code2Session` openid; a client receipt or openid is never accepted as an ownership fact. This is a single-AppID data contract: `wechat_user_bindings` does not store or query an AppID and must not be described as multi-AppID capable.
- Identity, entitlement, and invitation consistency methods accept only the shared active context supplied by `withDatabaseTransaction(connection, callback)` or its pool-owning wrapper. The wrapper begins the supplied connection, commits on success, rolls back on error, and permanently invalidates each module-private branded context after its attempt. A context exposes only `execute` and controlled `query`; it does not expose transaction lifecycle, release, pool, or connection-acquisition methods. Raw connections, caller-created objects, and expired contexts fail closed.
- A connection is exclusively occupied before begin for the whole retry cycle. Nested or concurrent entry fails with `DATABASE_TRANSACTION_CONNECTION_BUSY` without a second begin. Rollback failure produces `DATABASE_TRANSACTION_CLEANUP_FAILED` with both `originalError` and `rollbackError`, destroys and permanently quarantines the connection, and prevents pool release or later reuse (`DATABASE_TRANSACTION_CONNECTION_UNUSABLE`).
- Pool release failure uses the separate `releaseError` field and never masquerades as `rollbackError`; it immediately quarantines the connection, makes one best-effort `destroy` call, never releases or reuses it again, and keeps original, rollback, release, and destroy failures distinguishable.
- Complete invited-phone registration first locates all currently known WeChat, phone, and inviter user IDs without locking, then initializes one sealed `existingUserScope` and locks the deduplicated IDs once in numeric BIGINT ascending order (without JavaScript `Number` conversion). The sealed scope includes IDs allowed to be missing from that first query; `lockedUserIds` contains only rows actually locked, while `createdUserIds` contains only users created and locked through the controlled transaction insert. READY reuse may request only `existingUserScope ∪ createdUserIds`, returns only the actually locked subset, never re-queries a previously missing scoped ID, and reports a scoped missing ID as `DATABASE_TRANSACTION_USER_NOT_FOUND` when `allowMissing` is false rather than as lock expansion. Even a transaction with no existing participants must explicitly initialize an empty scope before creating a user; uninitialized scope fails closed before any `users` INSERT. IDs must be canonical values from 1 through `18446744073709551615`. Existing users enter the private lock set only through the sorted `FOR UPDATE`; a new user enters only after the shared module executes a controlled `users` INSERT with no caller-supplied ID, verifies strict affectedRows/database insertId, and locks the matching `LAST_INSERT_ID()` row. The existing-user scope cannot be expanded after initialization. Identity facts are reread before mutation. If the WeChat binding belongs to A and the phone binding belongs to a different user B, the current release fails closed with `IDENTITY_CONFLICT` and rolls back the whole shared transaction. It never moves the WeChat binding, deletes A, transfers entitlements, grants `REGISTER_BONUS`, finalizes an invitation, or reserves a reward slot. Automatic shell merge is intentionally deferred until a separate `user account retirement/write-guard protocol` batch; no 012 migration or retirement table exists in this release. Invitation reserve reuses the same scope, locks share credential before relation, revalidates all facts, and then rechecks exactly one current active inviter phone binding before any slot query. A missing inviter finalizes as `NO_REWARD/INVITER_NOT_FOUND`; a phone-ineligible inviter finalizes as `NO_REWARD/INVITER_PHONE_REGISTRATION_REQUIRED`. Neither case blocks registration or the invitee's bonus.
- `withDatabaseTransaction` makes at most three total attempts. Its defaults retry only `ER_LOCK_DEADLOCK` or `ER_LOCK_WAIT_TIMEOUT`; the invited-registration owner additionally whitelists only classified phone/WeChat binding races and changed-participant facts. Exhausted internal identity races become a stable, sanitized `IDENTITY_CONFLICT`. Every retry starts at non-locking participant discovery after a successful rollback with a fresh context. Unrelated duplicate keys and other failures are never retried. The callback must contain only replay-safe database work—no HTTP, payment, messages, logging side effects, or other irreversible actions—and only the committed attempt's result may be returned.
- `REGISTER_BONUS` follows migration 005's existing second-precision `DATETIME` columns. It obtains grant and expiry timestamps from one transaction-connection query using `UTC_TIMESTAMP()` and MySQL `DATE_ADD(..., INTERVAL 1 YEAR)`. Replay strictly parses raw integer facts for the transaction, previous/latest balances, snapshot, SUM, and COUNT, then validates exact registration facts, the historical row's own one-year relation, and ledger/snapshot chains; malformed facts fail with `IDEMPOTENCY_KEY_CONFLICT`. Migration 011 does not alter the existing entitlement table; invitation tables keep their own `DATETIME(3)` fields.
- `POST /api/user/invitations/share-credentials` requires a user Bearer JWT, re-locks the authenticated user, and revalidates an active phone binding before returning a seven-day plaintext share token once. `POST /api/user/invitations/candidates` also requires a user JWT, requires exactly one valid server-side openid binding for that user under the single-AppID contract, and returns a server-generated candidate receipt once. Zero, multiple, blank, whitespace-containing, or otherwise invalid openids fail closed. Neither route accepts user IDs, inviter IDs, openids, digests, database keys, or reward slots; neither route grants an entitlement.
- One valid share token may create candidates for multiple distinct trusted WeChat subjects. Each subject receives its own candidate receipt, while the database stores only independent HMAC digests. Invalid, revoked, or expired share credentials fail before candidate replacement and therefore cannot overwrite a still-valid candidate.
- Phone-login orchestration finishes WeChat HTTP exchange and prepares its module-branded trusted phone identity before opening one top-level shared database transaction. Missing candidate receipts preserve the existing client flow. A supplied receipt may use a valid Bearer JWT only as optional invitation-session continuity evidence: missing, expired, incorrectly signed, invalid-sub, or discontinuous JWTs disable invitation matching but never return an invitation-caused 401/403 and never block phone identity or an eligible `REGISTER_BONUS`. Candidate format, existence, ownership, expiry, or revocation failures have the same safe downgrade. Strict body-field rejection remains in force for client-supplied user IDs, inviter IDs, openids, digests, keys, or slots.
- The shared phone-registration context carries only replay-safe database work for the first-phone-registration fact, invitee `REGISTER_BONUS`, invitation `FINAL`, and inviter reward-slot reservation before one commit. Plain WeChat login, word access, and entitlement reads do not grant `REGISTER_BONUS`; only first phone registration does. Share responses, candidate responses, and phone-login responses use no-store caching and public-field/error allowlists; logs never include invitation tokens, candidate receipts, openids, phone values, digests, or secret material.
- The invitation MySQL gate bootstraps only `users` and `wechat_user_bindings` because no repository base-table migrations exist for them, then executes repository migrations 001 through 011 exactly once in order. It separates a target-database migration user from the DML-only runtime user used by the formal HTTP handler and verifies exact grants. Its supervised HTTP adapter bounds requests and shutdown, observes handler failures and incomplete or duplicate responses, tracks sockets, and always reaches cleanup. Resource ownership is tracked as not attempted, uncertain, created, or collision so an exact preflight-absent random name can be cleaned after an uncertain result while a collided pre-existing object is never deleted. Current real-run status and incomplete coverage are recorded below; these test-gate guarantees are not production evidence.
- The handler promise itself has a supervision deadline; shutdown observes but never awaits a permanently pending raw handler promise, and removes its timers, temporary listeners, response listeners, and socket listeners. The actual migration directory must exactly equal the frozen 001-011 manifest before bootstrap SQL runs. Before formal HTTP scenarios, the DML-only runtime account must receive exactly `ER_TABLEACCESS_DENIED_ERROR` / errno 1142 / SQLSTATE 42000 when creating a strictly named random probe table, and a root inspection must confirm that table is absent. Offline lifecycle tests cover confirmation loss after successful database, migration-user, and runtime-user creation using `ECONNRESET`, followed by exact uncertain-state cleanup.
- Adapter tests use explicit deferred entry barriers: an incomplete response is asserted only after the handler was observed, while client timeout is a separate case. Each migration-directory entry must be a regular file matching `^\d{3}_[a-z0-9_]+\.sql$`; unrelated files, directories, backups, missing files, duplicate versions, or extras fail before bootstrap. Formal MySQL HTTP scenarios explicitly use 3000ms request, 3000ms response, 5000ms handler, and 3000ms close deadlines; an offline injected-adapter test captures these values.
- The first 2026-09-28 v7 run against isolated MySQL 8.0.46 stopped while creating the migration user with `ER_PARSE_ERROR` / errno 1064 / SQLSTATE 42000: mysql2 `execute()` used a server prepared statement, whose marker is not accepted in the `CREATE USER ... IDENTIFIED BY ?` password position. No repository migration, formal HTTP scenario, or business assertion ran. The temporary database, users, container, anonymous volume, port, and test environment variables were cleaned. v7 is a failed run, not passing evidence.
- Migration and runtime users share one safe text-protocol creation path: `query(sql, [password])`. The controlled account literal still comes only from the validated random prefixed username and fixed `127.0.0.1` host; the password is never concatenated into SQL. A text-query failure is rebuilt before leaving the resource lifecycle module so driver `sql`, `sqlMessage`, formatted query text, raw message, password-bearing cause, and original error are not propagated. Only a validated driver code, strict non-negative safe errno, valid SQLSTATE, and stable internal code may survive. The uncertain/created/collision state transitions and exact cleanup rules are unchanged. A fresh v8 run successfully created both users, confirming this v7 defect is closed.
- The same v8 run then stopped in `assertExactDatabaseGrants()` before migrations or formal HTTP/business scenarios. MySQL 8.0.46 returned backtick-quoted accounts in `SHOW GRANTS`, while the old parser expected the single-quoted account literal used in the query. All non-system databases/users, the container, anonymous volume, port, and test environment variables were cleaned; v8 is not passing evidence.
- Grant verification now parses only the exact MySQL 8.0.46 shapes `GRANT USAGE ON *.* TO \`user\`@\`127.0.0.1\`` and one ``GRANT ... ON `database`.* TO `user`@`127.0.0.1` `` row. It decodes doubled backticks, compares the full schema/user/host, and compares normalized privilege sets without relying on order. Missing, extra, or duplicate privileges/rows; other schemas; global/table/column grants; ALL, PROCESS, grant option, roles, proxies, dynamic privileges, unknown suffixes, and malformed rows fail closed. Errors contain only a stable code, category, and optional safe count, never the raw grant or random account. This fix has only offline evidence and must next run in a fresh v9 environment.
- The first independent review after v8 further required each mysql2 row to have exactly one own string key equal to the dynamic `Grants for user@host` column and one own non-empty string data property. The verifier uses `Reflect.ownKeys()` and `Object.getOwnPropertyDescriptor()` and never evaluates an accessor. Wrong/empty/case-mismatched columns, another account, getters/setters, Symbols, extra/zero/inherited fields, and Proxy failures fail closed. All reflection, extraction, parsing, and set verification share one catch boundary. A private WeakMap brand distinguishes internal whitelist violations; spoofed codes and arbitrary exceptions are rebuilt without cause or original error data. This remains offline-only evidence: MySQL has not been rerun, the next environment must be fresh v9, and no container or staging is allowed before review approval.
- A fresh v9 run passed CREATE USER and SHOW GRANTS for both migration and runtime users, confirming the v7/v8 fixes. The first migration-user connection then failed with `ER_ACCESS_DENIED_ERROR` / 1045: Docker NAT made MySQL observe the client as `172.17.0.1`, while v9 had created only `@127.0.0.1`. Migrations 001-011, formal HTTP scenarios, and business assertions did not start. The temporary database/users, container, anonymous volume, port, and test variables were cleaned; v9 is not passing evidence.
- Before creating either test user, the root connection now executes `SELECT SUBSTRING_INDEX(USER(), '@', -1) AS clientHost`. The result must be one row with one own non-empty string data property named `clientHost`, and `node:net` `isIP()` plus canonical text checks allow only IPv4 loopback or RFC1918 addresses. That one exact host is shared by migration/runtime CREATE, GRANT, SHOW GRANTS row-key verification, `mysql.user` residual queries, and DROP. No wildcard or alternate-host fallback account is created. The connection target remains exactly `127.0.0.1:3309`; it is distinct from the server-observed account source. A fresh v10 run confirmed this host fix before encountering the later fixture failure below.
- A fresh v10 run completed test-user creation, least-privilege verification, runtime DDL denial, and migrations 001-011. The formal HTTP-to-service-to-three-real-Stores-to-MySQL chain started and completed multiple scenarios, then stopped when a test-only direct UPDATE made a credential expired by changing only `expires_at`. That fixture violated `chk_invitation_share_expiry` because `created_at` no longer remained exactly seven days earlier; the production Store path did not create invalid data, and later scenarios did not all run. All v10 temporary resources were cleaned.
- Both expired-credential fixtures now share one parameterized UPDATE that atomically sets `expires_at` to database `UTC_TIMESTAMP(3)` minus one second and `created_at` to exactly seven days before that same expression. The exact credential id predicate and strict affectedRows=1 check remain, followed by a readback proving expiry and the seven-day relation. Migrations, Store logic, validity rules, privileges, and production configuration are unchanged. This fix has not been rerun against MySQL and requires a fresh v11 environment.
- A fresh v11 run completed temporary-user setup, exact Docker-NAT host and grant verification, runtime DDL denial, and repository migrations 001-011. The formal HTTP-to-service-to-shared-transaction-to-three-real-Stores-to-MySQL call returned successfully. A later legacy direct-three-Store missing-inviter fixture then expected `FINAL` while omitting the current `candidateSessionUserId` and `candidateOpenid` continuity facts, so invitation matching safely downgraded and the run exited 1. This is a stale fixture failure, not passing evidence and not a demonstrated production-path defect. All v11 temporary resources were cleaned.
- That fixture now creates a dynamic real user plus the matching WeChat binding, strictly parses affectedRows and insertId without `Number()`, supplies the same server-side user/openid continuity facts, and asserts that registration remains on that dynamic user. Its existing first-phone, `REGISTER_BONUS`, `FINAL`, `NO_REWARD/INVITER_NOT_FOUND`, no-slot, and zero-`SHARE_REWARD` checks remain. This change has offline evidence only; MySQL has not been rerun, and after independent review the next run must use a fresh v12 environment. The work remains unstaged, production migration has not run, and this is not production-ready.
- A fresh v12 run passed the formal HTTP chain and the repaired dynamic missing-inviter fixture. It later stopped at the legacy cross-registration fixture, which still omitted candidate-session user/openid continuity. A complete read-only audit found the same omission in phone-race, whose old inviters 505/506 also lacked active phone registration, while same-openid intentionally races creation of a brand-new openid and therefore cannot prove an existing candidate-session user. These are stale direct-fixture assumptions, not demonstrated production-path defects; v12 exited 1 and is not passing evidence.
- The direct fixtures are now aligned in one change. Cross supplies the real 501/502 WeChat subjects and asserts, without assuming completion order, two phone bindings, two bonuses, two FINAL relations, exactly one pending non-null slot, and exactly one no-reward/null-slot relation with `INVITER_PHONE_REGISTRATION_REQUIRED`. Phone-race uses phone-qualified inviters 501/502, supplies the real 503/504 subjects, and retains exactly one success plus one sanitized `IDENTITY_CONFLICT`, with the success explicitly pending and reserved. Same-openid carries no invitation candidate and retains only its new-openid insert race, convergence, unique phone/binding/bonus, and zero FINAL/slot assertions.
- No formal handler, service, transaction, Store, migration, privilege, or business rule changed. All v12 temporary databases, users, container, anonymous volume, port 3309, and test variables were cleaned. This repair has offline evidence only and MySQL has not been rerun; independent review must precede a single run in a fresh v13 environment. The work remains unstaged and is not production-ready.
- A later concurrency review found that the cross fixture's one-pending/one-phone-required expectation was not yet guaranteed under MySQL's default `REPEATABLE READ`: a plain inviter-phone eligibility SELECT could reuse the transaction's pre-lock consistent-read snapshot even after waiting for the unified user lock. The Store now performs that exact inviter/status/limit query as `LIMIT 2 FOR UPDATE`, after the inviter user, credential, and candidate relation locks and before any reward-slot scan. This current read preserves the existing zero/multiple-binding no-reward result and does not change isolation, qualification, registration bonus, or reward rules.
- The cross MySQL fixture now uses the existing bounded two-party barrier through a minimal dependency test hook placed after all pre-lock reads and immediately before the unified user lock. The hook is inert unless `enableTestHooks: true` is supplied directly by test code; production services, requests, and environment variables cannot enable it. Both cross attempts establish their pre-lock read views before racing the same BIGINT-ordered user lock, so the waiter must use the locking eligibility read after the first commit. Offline tests verify hook ordering and default-off behavior.
- Formal phone-binding writes were audited: the shared Identity Store requires the unified user-lock scope before registration writes, and there is no formal unbind/migration path or phone-binding-lock-to-user-lock reversal. Credential, relation, eligibility, and slot ordering remains unchanged; no second connection or cross-invitation-table locking join was added. This fix has only offline evidence and has not run against MySQL. Independent review is required before any fresh v13 environment is created; the work remains unstaged, unmigrated, undeployed, and not production-ready.
- A fresh v13 run passed the formal HTTP chain, dynamic missing-inviter, deterministic cross, phone-race, and same-openid scenarios. It then failed in the legacy direct-Store concurrent replay assertion with one FINAL relation but zero distinct reward slots instead of one. The inviter for that replay, user 110, had no active phone-binding fixture. The run exited 1 and is not overall passing evidence; all v13 database, user, container, anonymous-volume, port-3309, and test-variable resources were cleaned.
- The same read-only audit found that legacy positive fixtures for inviter 100 (first five slots, rollback, and cap) and inviters 208/210 (mutual pending rewards) also lacked phone qualification. A local test-only helper now inserts exactly one independent active binding for each of 100, 110, 208, and 210 only after formal HTTP, missing-inviter, cross, phone-race, same-openid, and the preceding ineligible/constraint scenarios have completed, immediately before the legacy positive direct-Store reward tests. Thus the earlier `finalB` remains phone-ineligible. The helper verifies every affectedRows value, then verifies one active row per user in a single grouped query. It does not write 501, 502, 508, or any other user, invoke registration, grant a bonus, or create an invitation relation.
- Existing replay-slot, cap, rollback, and mutual-pending assertions remain strict. No production invitation/transaction code, migration, HTTP contract, or product rule changed. This fixture repair has offline evidence only and MySQL has not been rerun; independent review must approve before a fresh v14 environment is created. v13 must remain recorded as a failed run, and the work remains unstaged, unmigrated, undeployed, and not production-ready.
- Development may use `http://127.0.0.1:3001` or `http://SERVER_IP:3001`.
- Production must use a filed HTTPS domain configured in the WeChat mini program allowed request domains.
- `npm.cmd run check:production` blocks local HTTP API bases in production or unknown runtime.
- `npm.cmd run check:production` also verifies that production admin auth rejects empty/default tokens.
- `npm.cmd run check:production` also verifies that production user JWT auth rejects missing `JWT_SECRET`.
- `npm.cmd run check:production` also verifies the required length and non-reuse contract for `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET` with test-only values.
