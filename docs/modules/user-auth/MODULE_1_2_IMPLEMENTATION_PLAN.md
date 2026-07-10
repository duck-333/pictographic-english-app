# Module 1.2 Implementation Plan

Status: Design only. Not approved for coding until human confirmation.

Date: 2026-07-10

## Goal

Module 1.2 adds the server-side phone quick login API:

```text
POST /api/auth/wechat-phone-login
```

The API will:

- Receive WeChat `loginCode`, WeChat phone `phoneCode`, and client `requestId`.
- Exchange `loginCode` for WeChat `openid` / `unionid` on the Node server.
- Exchange `phoneCode` for phone information on the Node server.
- Pass exchanged identity data to `identity-store.resolveWechatPhoneIdentity()`.
- Return the existing project user session token format.
- Preserve the current `/api/auth/wechat-login` behavior.

## Out Of Scope

Module 1.2 does not include:

- Mini program UI or `getPhoneNumber` button implementation.
- Quota, register bonus, membership, VOD permission, or content access logic.
- Admin user management.
- `GET /api/me`, `GET /api/me/quota`, or `POST /api/words/:id/view`.
- Production database migration execution.
- User token verification middleware for protected APIs.
- Cross-network login idempotency backed by a database table.

## Planned Modified Files

- `server/index.mjs`
  - Add `POST /api/auth/wechat-phone-login`.
  - Inject or create `identityStore`.
  - Keep `POST /api/auth/wechat-login` unchanged.

- `server/wechat-login.mjs`
  - Add server-side WeChat access token retrieval.
  - Add single-process memory cache for WeChat access token.
  - Add phone-code exchange helper for WeChat phone number API.
  - Map WeChat phone API errors to safe project errors.

- `package.json`
  - Add Module 1.2 tests to `check:server`.

- `docs/modules/user-auth/IMPLEMENTATION.md`
  - Update after implementation with the new API and real data flow.

- `DEVELOPMENT_LOG.md`
  - Record implementation and verification results.

Optional documentation update after implementation:

- `server/README.md`
  - Add the new API request/response contract and environment notes.

## Planned New Files

- `scripts/test-wechat-phone-login-api.mjs`
  - Server API tests using fake `wechatLoginClient` and fake `identityStore`.
  - Must not call real WeChat.
  - Must not connect to production database.

## API Design

Request:

```json
{
  "loginCode": "uni.login returned code",
  "phoneCode": "getPhoneNumber event.detail.code",
  "requestId": "client-generated request id"
}
```

Success response:

```json
{
  "ok": true,
  "token": "server-signed-user-token",
  "tokenType": "Bearer",
  "expiresAt": "2026-07-10T00:00:00.000Z",
  "user": {
    "id": "1",
    "hasWechatBinding": true,
    "hasPhoneBinding": true,
    "phoneMasked": "138****8000",
    "isNew": false
  }
}
```

Error response:

```json
{
  "ok": false,
  "code": "ERROR_CODE",
  "message": "safe message"
}
```

## RequestId Rules

In the first version, `requestId` is used only for:

- Request tracing.
- Log investigation.
- Error location.

Module 1.2 must not:

- Treat `requestId` as a database idempotency key.
- Add a login request table.
- Implement cross-network idempotency based on `requestId`.

Retry safety for identity creation remains based on database uniqueness and Module 1.1 duplicate-key handling.

## WeChat Access Token Rules

WeChat `access_token` is server-only.

Rules:

- Only the Node server may request and use it.
- It may use only single-process memory cache.
- It must not be written to database.
- It must not be written to files.
- It must not be returned to the frontend.
- It must not introduce Redis or other new infrastructure.

Current PM2 single-instance deployment is sufficient for this version.

## User Session Token Compatibility

Module 1.2 must not change the existing user session token format.

Rules:

- Continue using `createUserSessionToken()`.
- Keep the token response structure compatible with `POST /api/auth/wechat-login`.
- Do not add `verifyUserSessionToken()`.
- Do not expand user permission verification scope.

Future `/api/me`, quota, and content permission modules must design token verification separately.

## WeChat Phone Code Flow

Mini program flow for a future UI module:

```text
uni.login()
  -> loginCode

button open-type=getPhoneNumber
  -> event.detail.code
  -> phoneCode

POST /api/auth/wechat-phone-login
```

Server flow in Module 1.2:

```text
loginCode
  -> code2Session()
  -> openid / unionid

phoneCode
  -> get server-side access_token
  -> call WeChat phone number API
  -> phoneNumber / purePhoneNumber / countryCode

identity-store
  -> normalize phone
  -> HMAC-SHA256
  -> bind / conflict check
  -> return users.id + phoneMasked

auth.mjs
  -> createUserSessionToken(users.id)
```

## Environment Variables

No new environment variables are planned.

Required existing variables:

```text
WECHAT_MINIAPP_APPID=
WECHAT_MINIAPP_SECRET=
PHONE_HASH_SECRET=
JWT_SECRET=
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_CONNECTION_LIMIT=
USER_SESSION_TTL_MS=
```

Rules:

- `PHONE_HASH_SECRET` must be configured before enabling phone login.
- `JWT_SECRET` must be stable and private in production.
- WeChat secrets and phone hash secrets must remain server-side.

## Database Impact

Module 1.2 does not add database schema and does not execute migrations.

Runtime dependency:

- `user_phone_bindings` from Module 1.1 must exist in the target database before the real API can complete phone binding.

If the table is missing, the API must return a safe error and must not expose raw SQL errors.

## Security Requirements

The API must not return:

- MySQL raw errors.
- WeChat app secret.
- WeChat `access_token`.
- WeChat `session_key`.
- Phone plaintext.
- `openid`.

The API may return:

- Project user id.
- Project user session token.
- `phoneMasked`.
- Safe project error code and safe message.

Phone plaintext is allowed only as transient server memory between WeChat response and `identity-store` normalization/hash/mask.

## Effect On Existing WeChat Login

`POST /api/auth/wechat-login` must remain compatible.

Implementation rules:

- Keep existing `userStore.findOrCreateWechatUser()` path.
- Keep existing response structure.
- Do not reroute the old endpoint through `identity-store`.
- Add the phone login API as a separate endpoint.

## Error Codes

Expected error examples:

- `WECHAT_CODE_REQUIRED`
- `WECHAT_PHONE_CODE_REQUIRED`
- `WECHAT_CODE_INVALID`
- `WECHAT_PHONE_CODE_INVALID`
- `WECHAT_CONFIG_MISSING`
- `WECHAT_PHONE_NUMBER_FAILED`
- `WECHAT_TIMEOUT`
- `PHONE_HASH_SECRET_MISSING`
- `USER_DB_CONFIG_MISSING`
- `IDENTITY_CONFLICT`
- `INTERNAL_SERVER_ERROR`

All errors must use:

```json
{
  "ok": false,
  "code": "ERROR_CODE",
  "message": "safe message"
}
```

## Test Plan

Required checks after implementation:

```text
node --check server/wechat-login.mjs
node --check server/index.mjs
node --check server/identity-store.mjs
node scripts/test-identity-store.mjs
node scripts/test-wechat-phone-login-api.mjs
npm.cmd run check:server
```

Test cases:

- Success returns token and user summary.
- Response does not include `openid`.
- Response does not include `session_key`.
- Response does not include phone plaintext.
- Missing `loginCode` returns safe 400.
- Missing `phoneCode` returns safe 400.
- WeChat config missing returns safe 503.
- `PHONE_HASH_SECRET` missing returns safe 503.
- Identity conflict returns safe 409.
- Existing `/api/auth/wechat-login` response remains unchanged.

Known existing check issue:

- `npm.cmd run check:server` may still fail in `scripts/test-server-word-api-link.mjs` with `remote empty search results must not silently fall back to bundled words`.
- If the failure remains there, it is not a Module 1.2 failure.

## Rollback Plan

Code rollback:

- Remove `POST /api/auth/wechat-phone-login` handling from `server/index.mjs`.
- Remove phone number API helper and access token cache from `server/wechat-login.mjs`.
- Remove Module 1.2 test script and `package.json` check additions.
- Revert related documentation updates.

Database rollback:

- No Module 1.2 database migration is executed.
- Do not delete `user_phone_bindings` as part of Module 1.2 rollback.

## ADR Impact

No ADR update is required for these constraints.

Reason:

- The constraints stay within ADR-0010 and ADR-0011.
- No durable architecture decision changes.
- No new database schema is introduced in Module 1.2.
