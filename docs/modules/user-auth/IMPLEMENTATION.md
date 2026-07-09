# 用户认证模块实现

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

后台管理员认证：

- `admin-portal/pictographic-admin/common/api-client.js`
- `admin-portal/pictographic-admin/pages/index/index.vue`
- `server/auth.mjs`
- `server/index.mjs`

本地学习状态相关：

- `miniapp-uni/word-app1/common/user-store.js`

## 核心文件职责

- `auth-api-client.js`：小程序端调用 `uni.login()` 获取 code，并请求 `/api/auth/wechat-login`。
- `auth-store.js`：保存、读取、校验和清除小程序用户 auth session。
- `mine/index.vue`：登录/退出按钮、登录状态展示、本地学习数据展示。
- `wechat-login.mjs`：服务端调用 WeChat `jscode2session`，映射 WeChat 错误。
- `user-store.mjs`：MySQL 用户和 WeChat 绑定读写。
- `auth.mjs`：管理员和用户 session token 创建、签名和管理员 token 校验。
- `admin api-client.js`：后台登录、保存 session token、构造管理员 API Authorization header。

## 核心函数/方法名称

小程序端：

- `loginWithWechat(options)`
- `getAuthSession(options)`
- `saveAuthSession(value)`
- `clearAuthSession()`
- `isAuthSessionValid(session)`
- `handleWechatLogin()`
- `handleLogout()`

服务端：

- `createWechatLoginClient(options)`
- `code2Session(jsCode)`
- `createUserStore(options)`
- `findOrCreateWechatUser(identity)`
- `createUserSessionToken(userId, options)`
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

服务端用户查找/创建：

```text
openid
  -> SELECT wechat_user_bindings WHERE openid = ?
  -> existing: update users.last_login_at / binding.unionid
  -> missing: INSERT users, INSERT wechat_user_bindings
  -> return users.id
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
- 服务端依赖 WeChat `jscode2session` HTTPS API。
- 用户存储依赖 `mysql2/promise`。
- 管理后台依赖浏览器 `localStorage` 和 `fetch`。
- token 签名依赖 Node `crypto`。

## 当前风险/未知

- 当前 `JWT_SECRET` 缺失时会使用进程内随机 secret，重启会导致既有 token 失效；生产必须显式配置。
- 手机号绑定、配额账户和配额流水尚未实现。
- 小程序本地学习数据尚未绑定账号同步。
- 管理员只有单一 username/password session，没有完整角色权限系统。

