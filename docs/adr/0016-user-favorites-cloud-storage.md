# ADR-0016: User Favorites Cloud Storage

日期：2026-07-17

状态：Accepted

## Context

Module 2.1 用户认证层已经完成：

- 微信登录
- 手机号登录
- `users` 用户表
- user token
- `requireUserAuth()`
- `/api/me`

当前收藏数据仍保存在小程序本地：

```text
pictographic:userState.favoriteWordIds
```

该方式导致登录用户收藏无法跟随账号。换设备、清理缓存或重新安装后，收藏会丢失。

## Decision

1. 登录用户收藏保存到服务器。

   服务端使用 `users.id` 作为用户身份主键，通过 `user_favorites.user_id` 关联收藏。

2. 未登录用户继续使用本地 storage。

   未登录时继续读写 `pictographic:userState.favoriteWordIds`。

3. 不做游客数据自动迁移。

   登录前的本地收藏不自动导入、不合并、不关联到登录账号。

4. 收藏 API 返回 `wordId`，不返回完整词条。

   小程序继续通过现有词库能力根据 `wordId` 补全展示。

5. `word_id` 使用字符串类型。

   当前词条 id 是字符串语义，`user_favorites.word_id` 使用 `VARCHAR` 类型，不使用数字 id。

6. 收藏 API 保持幂等。

   重复收藏不报错，重复取消收藏不报错。

7. 不改变用户认证层。

   Phase 1 不修改登录流程、JWT/token 格式、`requireUserAuth()`、`/api/me`。

## Consequences

- 登录用户收藏以服务器数据为准。
- 游客收藏继续以本机 storage 为准。
- 收藏云端化与 quota、entitlement、会员系统保持隔离。
- 收藏接口和小程序展示之间通过 `wordId` 解耦。
