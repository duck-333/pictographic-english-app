# User Auth Module Status

日期：2026-07-17

## 已完成

Module 2.1 用户认证层已完成：

- 微信登录
- 手机号登录
- `users` 用户表
- `wechat_user_bindings`
- `user_phone_bindings`
- user token
- `requireUserAuth()`
- `/api/me`

## 当前用户身份边界

服务端用户身份以 `users.id` 为准。

user token 中：

```text
payload.sub = users.id
payload.role = user
```

业务接口通过：

```text
requireUserAuth() -> authResult.userId
```

获取当前登录用户。

## 与 user_favorites Phase 1 的关系

收藏云端化使用现有用户认证层：

- 使用现有 user token。
- 使用现有 `requireUserAuth()`。
- 使用 `authResult.userId` 作为 `user_favorites.user_id`。

本阶段不修改：

- 登录流程
- JWT/token 格式
- `/api/me`
- 用户认证逻辑

## 后台管理员权限说明

日期：2026-07-23

后台用户额度管理属于管理员操作，不使用普通用户 token，也不允许通过小程序用户身份执行。

当前后台管理员接口的身份边界：

```text
Authorization: Bearer <ADMIN_API_TOKEN>
  -> requireAdminAuth()
  -> admin operation
```

当前后台管理员登录机制：

- 服务端已有 `requireAdminAuth()`。
- 管理员 API 使用 `ADMIN_API_TOKEN` 鉴权。
- 开发环境可使用默认开发 token。
- 生产环境必须配置正式 `ADMIN_API_TOKEN`。

后台额度管理 MVP 的权限要求：

- 管理员操作必须先通过 `requireAdminAuth()`。
- 管理员不能通过前端传入普通用户 token 冒充用户操作额度。
- 被调整的目标用户可以通过用户 ID、手机号等后台查询能力定位，但实际额度变更必须由服务端管理员接口执行。
- 每次额度调整都必须写入操作来源：`operator_type = admin`，`operator_id = 管理员ID或后台操作身份`。
