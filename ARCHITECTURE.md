# Architecture

日期：2026-07-17

本文件记录当前仓库已确认的系统架构状态。

## 当前项目结构

小程序：

```text
miniapp-uni/word-app1
```

服务端 API：

```text
server
```

管理后台：

```text
admin-portal/pictographic-admin
```

数据库迁移：

```text
database/migrations
```

安全与部署记录：

```text
security
```

## 用户认证层状态

Module 2.1 用户认证层已完成：

- 微信登录
- 手机号登录
- `users` 用户表
- `wechat_user_bindings`
- `user_phone_bindings`
- user token
- `requireUserAuth()`
- `/api/me`

用户 token 的 `sub` 字段保存 `users.id` 字符串语义。服务端业务层通过 `authResult.userId` 使用当前用户身份。

## 用户行为数据状态

当前用户行为数据仍在小程序本地 storage：

```text
pictographic:userState
```

字段：

- `recentWordIds`
- `favoriteWordIds`
- `searchCount`
- `streakDays`

当前状态：

| 行为数据 | 当前来源 | 是否绑定 `users.id` |
|---|---|---:|
| 收藏单词 | `pictographic:userState.favoriteWordIds` | 否 |
| 最近查看 | `pictographic:userState.recentWordIds` | 否 |
| 查词次数 | `pictographic:userState.searchCount` | 否 |
| 连续天数 | `pictographic:userState.streakDays` | 否 |

## User Favorites Cloud Storage Decision

用户数据云端化 Phase 1 已确认以收藏云端化为边界。

确认架构：

```text
登录用户
  -> Authorization: Bearer <token>
  -> requireUserAuth()
  -> authResult.userId
  -> user_favorites
```

```text
未登录用户
  -> pictographic:userState.favoriteWordIds
  -> uni storage
```

确认约束：

- 登录用户收藏保存服务器。
- 未登录用户收藏继续保存在本地 storage。
- 不做游客收藏自动迁移。
- 收藏 API 返回 `wordId`，不返回完整词条。
- `word_id` 使用字符串类型。
- API 保持幂等。

ADR：

```text
docs/adr/0016-user-favorites-cloud-storage.md
```

开发方案：

```text
docs/modules/user-data/user-favorites-cloud-plan.md
```

## Phase 1 开发边界

允许涉及：

- `database/migrations`
- `server/index.mjs`
- `server/user-favorites-store.mjs`
- `miniapp-uni/word-app1/common/user-store.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages/mine/index.vue`
- `scripts/test-*.mjs`

禁止涉及：

- 登录流程
- JWT/token 格式
- `/api/me`
- 用户认证逻辑
- quota
- entitlement
- 会员系统
- VOD
- 后台管理
- 视频功能
- 单词数据结构
