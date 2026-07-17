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
