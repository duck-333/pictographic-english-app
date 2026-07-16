# 用户认证模块实现

## Module 1 Final Status

```text
Module 1: 用户身份体系升级 - Completed
```

Completed implementation blocks:

- Module 1.1 identity-store:
  - `server/identity-store.mjs`
  - `database/migrations/001_create_user_phone_bindings.sql`
  - `scripts/test-identity-store.mjs`
- Module 1.2 wechat-phone-login API:
  - `POST /api/auth/wechat-phone-login`
  - `server/index.mjs`
  - `server/wechat-login.mjs`
  - `scripts/test-wechat-phone-login-api.mjs`
- Module 1.3.1 auth client:
  - `miniapp-uni/word-app1/common/auth-api-client.js`
  - `miniapp-uni/word-app1/common/auth-store.js`
  - `scripts/test-miniapp-auth-phone-login.mjs`
- Module 1.3.2 Mine 页面入口:
  - `miniapp-uni/word-app1/pages/mine/index.vue`
- Module 1 收尾安全修复:
  - phone login API maps raw MySQL/connection errors to safe public error codes.
  - mini program auth test is connected to `npm.cmd run check:miniapp`.

Production validation:

- 2026-07-15: production MySQL executed `database/migrations/001_create_user_phone_bindings.sql`.
- Production table `user_phone_bindings` exists.
- Production WeChat phone quick login has been verified.
- Verified production flow:
  - WeChat `getPhoneNumber`.
  - `POST /api/auth/wechat-phone-login`.
  - Server-side phone hash.
  - `user_phone_bindings`.
  - `users`.
  - Project session returned to the mini program.
- Data check found a production test binding:
  - `user_id=1`
  - `phone_masked=195****0953`
  - `status=active`
- Database backups were saved outside the repository:
  - `~/backups/baxiaota_before_phone_binding_20260715.sql`
  - `~/backups/baxiaota_after_phone_binding_20260715.sql`

Current remaining items:

- The word API guard failure is an independent legacy issue outside Module 1.
- User token verification for protected user APIs is not implemented yet.
- Local favorites, recent words, `searchCount`, and `streakDays` remain stored only in mini program cache under `pictographic:userState`.
- User learning data sync is the next design-stage module and is covered by `ADR/ADR-0015-user-learning-data-sync.md`.

## 文件路径

小程序用户登录：

- `miniapp-uni/word-app1/common/auth-api-client.js`
- `miniapp-uni/word-app1/common/auth-store.js`
- `miniapp-uni/word-app1/pages/mine/index.vue`

服务端用户认证：

- `server/index.mjs`
- `server/auth.mjs`
- `server/wechat-login.mjs`
- `server/user-store.mjs`
- `server/identity-store.mjs`

认证相关测试：

- `scripts/test-identity-store.mjs`
- `scripts/test-wechat-phone-login-api.mjs`
- `scripts/test-miniapp-auth-phone-login.mjs`

后台管理员认证：

- `admin-portal/pictographic-admin/common/api-client.js`
- `admin-portal/pictographic-admin/pages/index/index.vue`
- `server/auth.mjs`
- `server/index.mjs`

本地学习状态相关：

- `miniapp-uni/word-app1/common/user-store.js`

未来用户学习数据同步相关：

- 未来可新增服务端用户 token 校验能力：`verifyUserSessionToken()` / `requireUserAuth()`。
- 未来可新增服务端学习数据存储边界：例如 `server/learning-store.mjs`。
- 未来可新增小程序学习数据 API 客户端：例如 `miniapp-uni/word-app1/common/learning-api-client.js`。
- 未来可新增小程序学习数据同步层：例如 `miniapp-uni/word-app1/common/learning-store.js`。

## 核心文件职责

- `auth-api-client.js`：小程序端调用 `uni.login()` 获取 login code；旧链路请求 `/api/auth/wechat-login`，手机号快捷登录请求 `/api/auth/wechat-phone-login`。
- `auth-store.js`：保存、读取、校验和清除小程序用户 auth session，只保留 token、过期时间和安全 user 摘要。
- `mine/index.vue`：手机号快捷登录入口、退出按钮、登录状态展示、masked phone 展示、本地学习数据展示。
- `wechat-login.mjs`：服务端调用 WeChat `jscode2session`、获取服务端 `access_token`、交换手机号 code，并映射 WeChat 错误。
- `user-store.mjs`：旧 WeChat 登录路径的 MySQL 用户和 WeChat 绑定读写。
- `identity-store.mjs`：手机号快捷登录路径的身份绑定存储边界，处理手机号 normalize、HMAC hash、mask、绑定查询和冲突规则。
- `auth.mjs`：管理员和用户 session token 创建、签名和管理员 token 校验。
- `admin api-client.js`：后台登录、保存 session token、构造管理员 API Authorization header。
- `user-store.js`：当前只负责本机学习状态，包括收藏、最近查看、查词次数和连续学习天数；它尚未与 `users.id` 绑定。

## 核心函数/方法名称

小程序端：

- `loginWithWechat(options)`
- `loginWithWechatPhone(phoneCode, options)`
- `getAuthSession(options)`
- `saveAuthSession(value)`
- `clearAuthSession()`
- `isAuthSessionValid(session)`
- `handlePhoneLogin(event)`
- `handleLogout()`

服务端：

- `createWechatLoginClient(options)`
- `code2Session(jsCode)`
- `phoneCode2Number(phoneCode)`
- `createUserStore(options)`
- `findOrCreateWechatUser(identity)`
- `createIdentityStore(options)`
- `resolveWechatPhoneIdentity(identity)`
- `normalizePhone(value, options)`
- `hashPhone(phone, options)`
- `maskPhone(phone, options)`
- `resolveIdentityConflict(input)`
- `createUserSessionToken(userId, options)`
- 未来：`verifyUserSessionToken(token, options)`
- 未来：`requireUserAuth(req, options)`
- `createAdminSessionToken(username, options)`
- `verifyAdminCredentials(username, password, options)`
- `verifyAdminSessionToken(token, options)`
- `requireAdminAuth(req, options)`

后台端：

- `loginAdmin(credentials, options)`
- `checkAdminAuth(token, options)`
- `getAdminSessionToken(options)`
- `saveAdminSessionToken(token)`
- `loadAdminApiToken()`
- `unlockAdmin()`
- `lockAdmin()`
- `handleAdminUnauthorized()`

## API 入口

用户认证：

- `POST /api/auth/wechat-login`
- `POST /api/auth/wechat-phone-login`

管理员认证：

- `POST /api/admin/login`
- `GET /api/admin/auth/check`

## 数据流

小程序 WeChat 登录：

```text
Mine page
  -> loginWithWechat()
  -> uni.login({ provider: "weixin" })
  -> POST /api/auth/wechat-login { code }
  -> createWechatLoginClient().code2Session()
  -> createUserStore().findOrCreateWechatUser()
  -> createUserSessionToken(users.id)
  -> auth-store saves pictographic:authSession
```

小程序手机号快捷登录：

```text
Mine page
  -> button open-type="getPhoneNumber"
  -> getPhoneNumber event.detail.code as phoneCode
  -> loginWithWechatPhone(phoneCode)
  -> uni.login({ provider: "weixin" }) as loginCode
  -> POST /api/auth/wechat-phone-login { loginCode, phoneCode, requestId }
  -> createWechatLoginClient().code2Session()
  -> createWechatLoginClient().phoneCode2Number()
  -> createIdentityStore().resolveWechatPhoneIdentity()
  -> createUserSessionToken(users.id)
  -> auth-store saves token + safe user summary
  -> Mine page displays phoneMasked
```

当前本机学习状态：

```text
favorite / recent / search count / streak
  -> miniapp user-store.js
  -> uni storage pictographic:userState
  -> Mine page and homepage counters
```

Current storage fields:

```text
recentWordIds
favoriteWordIds
searchCount
streakDays
lastActiveDate
```

Current limitations:

- These fields are not associated with `users.id`.
- Logging out only clears `pictographic:authSession`; it does not clear `pictographic:userState`.
- Clearing mini program storage deletes the learning data.
- This local `searchCount` is not a real quota balance and must not be used as commercial entitlement.

Planned user learning data sync:

```text
miniapp Authorization: Bearer <user token>
  -> server verifies user token
  -> users.id
  -> user_favorites
  -> user_word_views
  -> user_learning_daily_stats
  -> server returns learning state
```

Planned visitor migration:

```text
local pictographic:userState
  -> user logs in
  -> miniapp asks for explicit confirmation
  -> POST /api/me/learning-state/import
  -> server merges favorites and recent words under users.id
  -> local cache becomes visitor/offline fallback, not the only source for logged-in users
```

服务端用户查找/创建：

```text
openid
  -> SELECT wechat_user_bindings WHERE openid = ?
  -> existing: update users.last_login_at / binding.unionid
  -> missing: INSERT users, INSERT wechat_user_bindings
  -> return users.id
```

服务端手机号绑定：

```text
openid / unionid + WeChat phone response
  -> normalize phone
  -> HMAC-SHA256(normalized phone, PHONE_HASH_SECRET)
  -> phone_masked
  -> SELECT wechat_user_bindings WHERE openid = ?
  -> SELECT user_phone_bindings WHERE phone_hash = ?
  -> apply ADR-0011 conflict rules
  -> INSERT/UPDATE users, wechat_user_bindings, user_phone_bindings in transaction
  -> return users.id + phoneMasked
```

管理员登录：

```text
admin portal login form
  -> POST /api/admin/login
  -> verifyAdminCredentials(ADMIN_USERNAME, ADMIN_PASSWORD)
  -> createAdminSessionToken()
  -> localStorage pictographic:adminSessionToken
  -> admin APIs with Authorization: Bearer <token>
```

## 模块依赖关系

- 小程序端依赖 uni-app 的 `uni.login`、`uni.request` 和 storage API。
- 服务端依赖 WeChat `jscode2session` HTTPS API 和手机号 code 交换 API。
- 用户存储依赖 `mysql2/promise`。
- 管理后台依赖浏览器 `localStorage` 和 `fetch`。
- token 签名依赖 Node `crypto`。
- 手机号 hash 依赖服务端 `PHONE_HASH_SECRET`。

## 当前风险/未知

- 当前 `JWT_SECRET` 缺失时会使用进程内随机 secret，重启会导致既有 token 失效；生产必须显式配置。
- 生产 `user_phone_bindings` 已完成迁移和验证；未来 staging、新生产副本或灾备环境仍需按 ADR-0007 单独执行迁移、回滚方案和备份验证。
- 生产数据库备份文件位于服务器 `~/backups/`，不得提交到 Git。
- User session token creation exists, but protected user API verification is not implemented yet.
- User learning data sync is design-only; `user_favorites`, `user_word_views`, and `user_learning_daily_stats` do not exist yet.
- 配额账户和配额流水尚未实现。
- 小程序本地学习数据尚未绑定账号同步。
- 管理员只有单一 username/password session，没有完整角色权限系统。

## 2026-07-15 Production Verification Update

Status:

- Module 1 phone quick login is verified on the production server.
- The production database contains `user_phone_bindings`.
- The verified test data confirms phone masking and active binding status.

Production verified data:

```text
table: user_phone_bindings
user_id: 1
phone_masked: 195****0953
status: active
```

Backup records:

```text
~/backups/baxiaota_before_phone_binding_20260715.sql
~/backups/baxiaota_after_phone_binding_20260715.sql
```

Operational notes:

- Backup files are not repository artifacts and must not be committed.
- Future environments must not assume the production migration state; each target database still needs reviewed migration execution and backup verification.
## Module 1.1 Implementation Update

Status:

- Implemented identity storage boundary only.
- No API route was added.
- No mini program UI was changed.
- No WeChat phone API exchange was implemented.
- No token, quota, permission, membership, or VOD logic was added.

New server file:

- `server/identity-store.mjs`

Core responsibilities:

- Normalize phone input before storage lookup.
- Hash normalized phone with HMAC-SHA256.
- Produce masked phone display values.
- Find WeChat and phone identity bindings.
- Resolve identity binding conflicts according to ADR-0011.
- Handle duplicate-key races by rolling back, re-querying identity bindings, and returning a stable identity result or sanitized conflict.
- Create or update `user_phone_bindings` rows through the storage boundary.
- Provide a future API-layer entry point, `createIdentityStore().resolveWechatPhoneIdentity()`, that accepts already-exchanged WeChat identity and phone data.

Core functions:

- `normalizePhone(value, options)`
- `hashPhone(phone, options)`
- `maskPhone(phone, options)`
- `findIdentityBinding(connection, identity)`
- `resolveIdentityConflict(input)`
- `createOrUpdatePhoneBinding(connection, userId, phoneIdentity, options)`
- `createIdentityStore(options)`
- `resolveWechatPhoneIdentity(identity)`

Boundary rules:

- `identity-store.mjs` does not generate user tokens.
- `identity-store.mjs` does not call WeChat APIs.
- `identity-store.mjs` does not implement quota, entitlement, content access, or permission logic.
- Existing `server/user-store.mjs` and `POST /api/auth/wechat-login` remain unchanged.

Current integration after Module 1.2:

```text
POST /api/auth/wechat-phone-login
  -> exchange loginCode outside identity-store.mjs
  -> exchange phoneCode outside identity-store.mjs
  -> identity-store.resolveWechatPhoneIdentity()
  -> auth.mjs creates project user session token outside identity-store.mjs
```

## Module 1.2 Implementation Update

Status:

- Implemented server-side `POST /api/auth/wechat-phone-login`.
- No mini program UI or phone authorization button was added.
- No quota, membership, VOD permission, admin user management, or content access logic was added.
- No database migration was executed.
- Existing `POST /api/auth/wechat-login` remains on the original `user-store.findOrCreateWechatUser()` path.

Changed server files:

- `server/index.mjs`
- `server/wechat-login.mjs`
- `scripts/test-wechat-phone-login-api.mjs`
- `package.json`

New API:

- `POST /api/auth/wechat-phone-login`

Request body:

```json
{
  "loginCode": "uni.login returned code",
  "phoneCode": "getPhoneNumber returned code",
  "requestId": "client trace id"
}
```

Success response:

```json
{
  "ok": true,
  "token": "project user session token",
  "tokenType": "Bearer",
  "expiresAt": "ISO timestamp",
  "user": {
    "id": "users.id",
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

Data flow:

```text
POST /api/auth/wechat-phone-login
  -> read loginCode / phoneCode / requestId
  -> wechat-login.code2Session(loginCode)
  -> wechat-login.phoneCode2Number(phoneCode)
  -> identity-store.resolveWechatPhoneIdentity()
  -> auth.createUserSessionToken(users.id)
  -> return project token + safe user summary
```

Core responsibilities:

- `server/index.mjs`: route orchestration only. It does not call WeChat HTTP directly, hash phone numbers, or implement identity conflict rules.
- `server/wechat-login.mjs`: WeChat communication only. It handles `code2Session`, server-side access token retrieval, single-process in-memory access token cache, and phone code exchange.
- `server/identity-store.mjs`: remains responsible for phone normalization, HMAC hashing, masked phone generation, binding lookup, and ADR-0011 conflict rules.
- `server/auth.mjs`: remains the single user session token generation boundary through `createUserSessionToken()`.

Security rules implemented:

- WeChat `access_token` is server-only and cached only in process memory.
- `requestId` is only normalized for tracing/logging and is not used as database idempotency.
- The new API does not return MySQL raw errors, WeChat secrets, WeChat `access_token`, `session_key`, phone plaintext, or `openid`.
- Phone plaintext exists only transiently between the WeChat phone response and `identity-store`.

Tests:

- `scripts/test-wechat-phone-login-api.mjs` verifies the new API with fake WeChat and fake identity store.
- The test does not call real WeChat and does not connect to a production database.
- The test verifies raw MySQL-style errors are mapped to safe public error codes before returning to the mini program.

## Module 1.3.1 Implementation Update

Status:

- Implemented the mini program frontend auth capability layer.
- Added `loginWithWechatPhone(phoneCode, options)` in `auth-api-client.js`.
- Extended `auth-store.js` to persist `hasPhoneBinding` and `phoneMasked` safely.
- Did not implement quota, membership, VOD permission, admin user management, content access, payment, or orders.
- Did not execute any database migration.

Changed mini program files:

- `miniapp-uni/word-app1/common/auth-api-client.js`
- `miniapp-uni/word-app1/common/auth-store.js`

Current auth client behavior:

- `loginWithWechatPhone(phoneCode)` calls `uni.login()` to get `loginCode`.
- The client posts `{ loginCode, phoneCode, requestId }` to `/api/auth/wechat-phone-login`.
- `auth-store` saves only:
  - `token`
  - `tokenType`
  - `expiresAt`
  - `user.id`
  - `user.hasWechatBinding`
  - `user.hasPhoneBinding`
  - `user.phoneMasked`
- `auth-store` does not save `openid`, `session_key`, `access_token`, phone plaintext, or WeChat secrets.
- Old sessions without `hasPhoneBinding` and `phoneMasked` remain compatible; missing fields normalize to `false` and an empty string.

Tests:

- `scripts/test-miniapp-auth-phone-login.mjs` verifies the mini program auth client/store with fake `uni`.
- `npm.cmd run check:miniapp` runs the phone login auth test.

## Module 1.3.2 Implementation Update

Status:

- Implemented the Mine page phone authorization entry.
- Did not modify server APIs, database, quota, membership, VOD permission, admin user management, content access, payment, or orders.

Changed mini program file:

- `miniapp-uni/word-app1/pages/mine/index.vue`

Current Mine page display:

- Logged-out Mine page uses `button open-type="getPhoneNumber"`.
- The `getPhoneNumber` event provides `event.detail.code` as `phoneCode`.
- Logged-out state shows "手机号快捷登录".
- Logged-in phone-bound state shows masked phone only, such as `138****8000`.
- Logout clears the stored auth session, including phone binding state.
- Local favorites, recent words, and learning counters remain local-only.

## Module 1 Closing Safety Update

Status:

- Completed Module 1 final safety cleanup.
- `POST /api/auth/wechat-phone-login` does not return raw MySQL error codes to the mini program.
- Raw MySQL/connection errors are mapped to safe public error codes, such as `USER_DB_ERROR`.
- Server logs keep request-level debugging information without logging phone plaintext, `openid`, `session_key`, or access token values.
- Success response structure remains unchanged.
