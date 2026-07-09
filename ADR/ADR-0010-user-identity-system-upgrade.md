# ADR-0010: 用户身份体系升级

Status: Accepted

Date: 2026-07-09

## 背景

当前项目已经实现 WeChat `uni.login()` 第一版登录链路：

```text
mini program
  -> POST /api/auth/wechat-login
  -> WeChat jscode2session
  -> users
  -> wechat_user_bindings
  -> project user token
```

下一阶段产品目标是把用户从匿名/弱身份访问升级为可承载查词额度、未来会员、买书权益、课程包和客服查询的稳定账号体系。

ADR-0003 已确认 `users.id` 是项目内部核心身份，`openid`、`unionid` 和手机号只能作为外部身份绑定。

## 问题

手机号快捷登录不能只被视为一个孤立登录入口。它同时涉及：

- WeChat 身份交换。
- 手机号授权和手机号交换。
- `users.id` 查找或创建。
- `wechat_user_bindings` 绑定。
- `user_phone_bindings` 绑定。
- 注册赠送额度的触发入口。
- 后续用户权益和后台查询的基础身份。

如果把手机号登录和身份绑定拆开实现，可能出现手机号登录已经上线但账号冲突、重复用户、权益归属和客服查询规则不完整的问题。

## 决策

下一阶段将“手机号快捷登录”和“用户身份绑定”作为一个整体模块推进，模块名称为：

```text
用户身份体系升级
```

该模块的核心原则：

- `users.id` 仍然是唯一项目主体身份。
- WeChat `openid` / `unionid` 仍然只存放在 `wechat_user_bindings`。
- 手机号只存放在 `user_phone_bindings`，不作为 `users` 主字段。
- 手机号查找值必须使用 `HMAC-SHA256(normalized_phone, server_secret)` 生成，不允许使用普通 SHA256。
- 手机号 hash 必须记录 `hash_version`，用于未来 HMAC secret 轮换和兼容旧数据。
- 小程序端不得接收 `openid`、`session_key`、WeChat secret、手机号明文、数据库凭据或签名密钥。
- 手机号登录必须通过用户主动点击的 WeChat 手机号授权能力触发。
- 服务端负责交换 WeChat 登录 code 和手机号 code。
- 服务端返回项目自己的 user session token 和最小必要用户摘要。

## 方案

新增身份升级登录入口：

```text
POST /api/auth/wechat-phone-login
```

预期请求信息：

```text
loginCode     WeChat uni.login() 返回的 code
phoneCode     WeChat getPhoneNumber 返回的 code
requestId     前端生成的请求 ID，用于幂等和排查
```

服务端处理流程：

```text
receive loginCode + phoneCode
  -> exchange loginCode for openid / unionid
  -> exchange phoneCode for phone number
  -> normalize phone number
  -> HMAC-SHA256 normalized phone number into phone_hash
  -> assign hash_version
  -> create phone_masked
  -> find existing wechat binding
  -> find existing phone binding
  -> apply binding conflict rules from ADR-0011
  -> find or create users.id
  -> bind wechat identity
  -> bind phone identity
  -> return project user session
```

手机号存储规则：

```text
user_phone_bindings
  id
  user_id
  phone_hash
  phone_masked
  hash_version
  country_code
  status
  bound_at
  unbound_at
  verified_at
  last_verified_at
  created_at
  updated_at
```

字段规则：

- `phone_hash` 使用 `HMAC-SHA256(normalized_phone, server_secret)`。
- `hash_version` 第一版可固定为 `v1`，但必须入库，便于未来密钥轮换。
- `phone_masked` 只用于展示，例如 `138****8000`。
- `status` 第一版至少支持 `active`；未来解除绑定时使用 `unbound`。
- `bound_at` 记录首次绑定时间。
- `unbound_at` 仅在未来解除绑定流程中写入。
- `verified_at` / `last_verified_at` 记录手机号从 WeChat 授权验证的时间。
- 第一版不提供用户自助解绑；解绑或换绑必须单独设计流程和审计规则。

手机号查询规则：

```text
admin inputs full phone number
  -> backend normalizes phone
  -> backend HMAC-SHA256(phone, server_secret) with current hash_version
  -> query user_phone_bindings.phone_hash
  -> return phone_masked only
```

后台、日志和 API 响应不得展示手机号明文。

## 影响范围

涉及模块：

- 用户认证模块。
- 数据存储模块。
- 后台用户权益查询模块。
- 查词额度和权益模块。
- 内容访问控制模块。

涉及未来文件边界：

- `miniapp-uni/word-app1/common/auth-api-client.js`
- `miniapp-uni/word-app1/common/auth-store.js`
- `miniapp-uni/word-app1/pages/mine/index.vue`
- `server/index.mjs`
- `server/auth.mjs`
- `server/wechat-login.mjs`
- `server/user-store.mjs`
- 未来可新增 `server/identity-store.mjs`

涉及未来数据库：

- `users`
- `wechat_user_bindings`
- `user_phone_bindings`

## 替代方案

本 ADR 仅记录最终确认方案。未采用方案不在本文件展开。

当前确认的过渡方式是保留现有 `POST /api/auth/wechat-login` 作为当前已实现的 WeChat 登录入口；新增手机号快捷登录后，承载权益的账号入口以 `POST /api/auth/wechat-phone-login` 为准。

## 后续影响

- 实施前必须完成 `user_phone_bindings` schema、迁移计划、回滚计划和备份确认。
- 实施前必须确认手机号 HMAC secret 的环境变量、生产配置方式和轮换策略。
- 手机号登录上线前必须更新 Mine 页文案，不能继续暗示系统不采集手机号。
- 注册赠送额度应挂在身份体系升级流程之后，但额度发放规则由 ADR-0012 管理。
- 身份绑定冲突处理必须遵循 ADR-0011，不能在实现中静默合并账号。
- 生产环境必须配置稳定私密的手机号 HMAC secret 和 `JWT_SECRET`。
