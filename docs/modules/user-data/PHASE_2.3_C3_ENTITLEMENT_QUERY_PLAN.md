# PHASE 2.3 C3 用户权益查询展示开发计划

## 1. 背景

当前已完成 Phase 2.3 C2：

- 微信登录用户创建
- `wechat_user_bindings` 绑定
- `user_entitlements` 权益账户初始化
- 注册赠送 30 次查词额度
- `entitlement_transactions` 记录 `REGISTER_BONUS` 流水

当前问题：

数据库已经有用户权益数据，但小程序用户无法查看自己的权益状态。

Phase 2.3 C3 的工作是在不改变权益扣减规则的前提下，提供用户自己的权益查询能力，并在小程序「我的」页面展示剩余权益。

## 2. C3 开发目标

目标：

让登录用户可以在小程序「我的」页面看到自己的权益信息。

展示内容包括：

- 剩余查词次数 `quota_balance`
- 累计获得次数 `quota_total_granted`
- 已消耗次数 `quota_total_consumed`
- 会员类型 `membership_type`
- 会员状态 `membership_status`

本阶段只做查询和展示，不做额度扣减、会员购买、支付、订单和后台管理。

## 3. 后端接口设计

规划新增接口：

```http
GET /api/user/entitlements
```

请求：

- 使用当前用户登录 token。
- 请求头使用 `Authorization: Bearer <token>`。
- 服务端通过 `requireUserAuth()` 解析当前 `user_id`。
- 请求参数不接收 `user_id`。

查询：

- 读取 `user_entitlements` 当前权益快照。
- 不扫描 `entitlement_transactions` 作为日常查询来源。
- 如果用户已有账号但缺少权益快照，不能直接返回空数据。

权益快照不存在时的处理规则：

- `users` 存在但 `user_entitlements` 不存在时，应复用现有权益初始化能力。
- 可复用 `ensureRegistrationBonusForUser()` 或对应 store 方法，例如 `ensureRegistrationBonus(userId)`。
- 初始化必须创建 `user_entitlements` 快照。
- 初始化必须同时写入 `entitlement_transactions` 的 `REGISTER_BONUS` 流水。
- 完成后再返回当前用户权益，保证权益系统形成“账号 -> 快照 -> 流水”的数据闭环。

返回示例：

```json
{
  "quotaBalance": 30,
  "quotaTotalGranted": 30,
  "quotaTotalConsumed": 0,
  "membershipType": "none",
  "membershipStatus": "none"
}
```

不要暴露：

- `openid`
- `session_key`
- session token
- 手机号明文
- 数据库内部自增 `id`
- `last_transaction_id`
- `entitlement_transactions` 明细

接口响应状态码：

- `200`：正常返回当前用户权益。
- `401`：用户未登录或 `Authorization` token 无效。
- `500`：服务器或数据库异常。

## 4. 服务端设计分析

需要复用：

- 当前用户认证机制
- `requireUserAuth()`
- 当前 MySQL 访问方式
- `server/user-entitlement-store.mjs` 中的权益快照读取能力

可能涉及文件：

- `server/index.mjs`
  - 新增 `GET /api/user/entitlements` 路由。
  - 通过 `requireUserAuth(req, userAuthOptions)` 获取 `authResult.userId`。
  - 调用权益 store 查询当前用户权益。

- `server/user-entitlement-store.mjs`
  - 复用 `getUserEntitlement(userId)`。
  - 如现有返回字段不足，补充安全的响应字段映射。
  - 不改变 `entitlement_transactions` 事实流水规则。

- `server/auth.mjs`
  - 预计不需要修改。
  - 仅复用已有 `requireUserAuth()`。

服务端响应字段建议采用 camelCase：

- `quotaBalance`
- `quotaTotalGranted`
- `quotaTotalConsumed`
- `membershipType`
- `membershipStatus`
- 可选：`membershipExpireAt`

错误处理建议：

- 正常返回当前用户权益：`200`
- 未登录或 token 无效：`401`
- 服务器或数据库异常：`500`
- 不返回内部 SQL 错误细节。

## 5. 小程序端设计分析

真实页面路径：

- `miniapp-uni/word-app1/pages/mine/index.vue`

现有相关能力：

- `miniapp-uni/word-app1/common/auth-store.js` 保存 `pictographic:authSession`。
- `miniapp-uni/word-app1/common/user-favorites-api-client.js` 已有登录态 API client 风格。
- `miniapp-uni/word-app1/common/user-recent-words-api-client.js` 已有登录态 API client 风格。

规划新增或调整：

- 可新增 `miniapp-uni/word-app1/common/user-entitlements-api-client.js`，保持与收藏、最近学习 API client 一致的请求风格。
- 在 `pages/mine/index.vue` 中，登录用户打开页面时请求 `/api/user/entitlements`。
- 未登录用户不请求权益接口。

我的页面展示：

当前：

- 页面已有用户登录状态、收藏、最近学习等展示。
- 本地轻量状态中存在查询次数概念，但不能作为账号权益来源。

改为：

- 展示服务端返回的剩余查词次数。
- 文案建议从“查询次数”调整为“剩余查词次数”。
- 只展示当前登录用户自己的权益。

本阶段不做：

- 内容锁定页
- 查词扣减
- 会员购买入口
- 支付入口
- 后台赠送入口

## 6. 数据流程

```text
用户打开我的页面
↓
检查登录状态
↓
读取 pictographic:authSession
↓
请求 GET /api/user/entitlements
↓
服务端验证 Authorization Bearer token
↓
requireUserAuth() 得到 authResult.userId
↓
查询 user_entitlements
↓
返回权益数据
↓
我的页面展示剩余查词次数和会员状态
```

## 7. 权限和安全注意事项

- 用户只能查询自己的权益。
- 禁止通过 `user_id` 参数查询其他用户。
- 服务端必须根据 token 获取 `user_id`。
- 小程序不能自行计算剩余额度。
- 小程序不能使用本地 `searchCount` 作为账号权益依据。
- 接口不返回敏感字段。
- 接口不返回 `entitlement_transactions` 全量流水。
- 会员状态以服务端返回为准，前端只展示，不本地缓存为可信状态。

## 8. 验收标准

新用户：

```text
注册
↓
自动获得 30 次额度
↓
GET /api/user/entitlements 返回 quotaBalance = 30
↓
我的页面显示 30
```

已有用户：

```text
登录
↓
GET /api/user/entitlements 返回当前 user_entitlements 快照
↓
我的页面正确显示当前余额
```

未登录异常：

```text
未登录访问接口
↓
返回 401
```

安全验收：

- 请求体或 query 中传入 `user_id` 不应生效。
- 返回结果不包含 `openid`、`session_key`、手机号明文、token 或数据库内部主键。
- 不影响 Phase 2.1 收藏云端化。
- 不影响 Phase 2.2 最近学习云端化。
- 不影响 Phase 2.3 C2 注册赠送权益。

建议验证命令：

```bash
node --check server/index.mjs
node --check server/user-entitlement-store.mjs
```

如新增小程序 API client，建议补充：

```bash
node --check miniapp-uni/word-app1/common/user-entitlements-api-client.js
```

## 9. 后续规划

C4：

- 查词次数扣减。
- 接入 Learning Object Access Model。
- 用户主动进入完整 Learning Object 时服务端判断并扣减额度。

C5：

- 会员购买和权益增加。
- 支付订单体系。
- 支付成功后通过权益系统发放会员或额度。

后续仍需保持：

- `entitlement_transactions` 是事实流水。
- `user_entitlements` 是当前快照。
- 前端不直接判断权益。
- 服务端不使用 `user_recent_words`、`user_favorites` 或本地 `searchCount` 作为权益依据。
