# Module 1.3 Implementation Plan

Status: Design only. Not approved for coding until human confirmation.

Date: 2026-07-13

## Goal

Module 1.3 connects the mini program Mine page to the server-side phone quick login API implemented in Module 1.2:

```text
POST /api/auth/wechat-phone-login
```

The goal is to let a user actively authorize phone quick login in the mini program, receive a project user session token, and store only the safe session summary needed by the client.

## Out Of Scope

Module 1.3 does not include:

- Quota.
- Register bonus.
- Membership.
- VOD permissions.
- Admin user query.
- Content access control.
- Cloud learning record sync.
- Database migration execution.
- Account merge.
- Silent phone binding or silent phone refresh.

## Planned Modified Files

- `miniapp-uni/word-app1/common/auth-api-client.js`
  - Add a phone quick login client function.
  - Keep the existing `loginWithWechat()` path compatible.

- `miniapp-uni/word-app1/common/auth-store.js`
  - Extend safe session normalization.
  - Keep old session compatibility when phone fields are missing.

- `miniapp-uni/word-app1/pages/mine/index.vue`
  - Replace the main login action with a WeChat phone authorization button.
  - Update login status copy and error messages.
  - Display only masked phone when available.

- `package.json`
  - Add Module 1.3 mini program auth tests to `check:miniapp` if a new script is added.

- `docs/modules/user-auth/IMPLEMENTATION.md`
  - Update after implementation with the actual Module 1.3 mini program flow.

- `DEVELOPMENT_LOG.md`
  - Record implementation and verification results after coding.

## Planned New Files

- `scripts/test-miniapp-auth-phone-login.mjs`
  - Tests mini program auth client/store behavior with fake `uni`.
  - Must not call real WeChat.
  - Must not call the real production API.

## Required Login Flow

The login flow is fixed:

```text
button open-type="getPhoneNumber"
  -> getPhoneNumber event.detail.code as phoneCode
  -> uni.login({ provider: "weixin" }) as loginCode
  -> POST /api/auth/wechat-phone-login
  -> save safe auth session
```

Rules:

- The UI must use `button open-type="getPhoneNumber"`.
- Phone authorization must not be triggered by ordinary `click` / `tap`.
- Login must be actively triggered by the user.
- The client must not silently re-fetch phone authorization.
- If the user cancels or denies phone authorization, the client must not call `uni.login()` and must not call the backend.

## API Call Design

New mini program client function:

```text
loginWithWechatPhone(phoneCode, options)
```

Request:

```json
{
  "loginCode": "uni.login returned code",
  "phoneCode": "getPhoneNumber returned code",
  "requestId": "client trace id"
}
```

Target:

```text
POST /api/auth/wechat-phone-login
```

Existing compatibility:

- `loginWithWechat()` must remain available.
- `loginWithWechat()` must continue to call `POST /api/auth/wechat-login`.
- Module 1.3 should not change old login API behavior.

## Auth Store Rules

`auth-store` may save only:

- `token`
- `expiresAt`
- `user.id`
- `user.hasWechatBinding`
- `user.hasPhoneBinding`
- `user.phoneMasked`

`auth-store` must not save:

- Phone plaintext.
- `openid`.
- `session_key`.
- `access_token`.
- WeChat app secret.
- Database fields other than the safe user summary.

Old session compatibility:

- Missing `hasPhoneBinding` must normalize to `false`.
- Missing `phoneMasked` must normalize to an empty string.
- Existing sessions with only `token`, `expiresAt`, `user.id`, and `hasWechatBinding` must remain valid.

## Mine Page Behavior

Logged out state:

- Show phone quick login as the main login action.
- Use `button open-type="getPhoneNumber"`.
- Explain that phone authorization is used to create a stable account identity.
- Do not claim that phone number is not collected once phone login is enabled.

Loading state:

- Reuse the current auth loading guard.
- Prevent duplicate submissions while login is in progress.

Logged in state:

- If `hasPhoneBinding` is true and `phoneMasked` exists, display the masked phone only.
- Do not display phone plaintext.
- Continue to show local learning records as local-only until a later sync module exists.

Logout:

- `clearAuthSession()` must clear token and all user summary fields, including `hasPhoneBinding` and `phoneMasked`.

Session restore:

- Reopening the mini program must restore a valid saved session through `getAuthSession()`.
- Restored session may include `hasPhoneBinding` and `phoneMasked`.
- Restored old sessions without phone fields must still work with default values.

## Error Handling

Expected client-safe handling:

- User denies phone authorization:
  - Show a friendly message.
  - Do not call backend.

- Missing phone code:
  - Show a friendly message.
  - Do not call backend.

- `WECHAT_CODE_INVALID` / `WECHAT_PHONE_CODE_INVALID`:
  - Ask user to retry.

- `IDENTITY_CONFLICT`:
  - Tell user the account needs manual handling.
  - Do not attempt client-side merge.

- `WECHAT_CONFIG_MISSING`, `USER_DB_CONFIG_MISSING`, `PHONE_HASH_SECRET_MISSING`:
  - Show service unavailable / not configured message.

- Network timeout:
  - Show retry message.

## Test Plan

Required checks after implementation:

```text
node --check miniapp-uni/word-app1/common/auth-api-client.js
node --check miniapp-uni/word-app1/common/auth-store.js
node --check scripts/test-miniapp-auth-phone-login.mjs
node scripts/test-miniapp-auth-phone-login.mjs
npm.cmd run check:miniapp
git diff --check
```

Required test cases:

- Phone quick login uses `POST /api/auth/wechat-phone-login`.
- Request body includes `loginCode`, `phoneCode`, and `requestId`.
- User cancellation does not call `uni.login()`.
- User cancellation does not call backend API.
- Successful login saves `token`, `expiresAt`, `user.id`, `hasWechatBinding`, `hasPhoneBinding`, and `phoneMasked`.
- Successful login does not save phone plaintext.
- Successful login does not save `openid`, `session_key`, or `access_token`.
- Logout clears phone binding state and masked phone from storage.
- Reopening the mini program restores a valid saved session including phone fields.
- Old saved sessions without `hasPhoneBinding` and `phoneMasked` remain valid with default values.
- Existing `loginWithWechat()` still calls `/api/auth/wechat-login`.

Manual verification:

- Build with HBuilderX.
- Preview in WeChat Developer Tools.
- Validate phone authorization success.
- Validate phone authorization denial.
- Validate logout and reopen session restore.
- Validate Mine page no longer contains stale "no phone number collected" copy after implementation.

## Risks

- Real `getPhoneNumber` behavior must be validated in WeChat runtime; browser-only testing is not enough.
- Target database must have `user_phone_bindings` migrated before real phone login can succeed.
- Production WeChat app ID, app secret, phone API permission, legal domain, and `PHONE_HASH_SECRET` must be configured.
- If `POST /api/auth/wechat-phone-login` is deployed without database readiness, the client must show a safe service error.
- Existing `npm.cmd run check:server` may still fail on the unrelated word API guard and should not be treated as Module 1.3 failure unless the failure moves into auth code.

## ADR Impact

No ADR update is required for Module 1.3 if implementation stays within this plan.

Reason:

- The module is the mini program client integration for ADR-0010 and ADR-0011.
- It does not change identity ownership.
- It does not change conflict rules.
- It does not add database schema.
- It does not introduce quota, membership, content access, or admin user management.
