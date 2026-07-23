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

## 后台额度管理模块设计

日期：2026-07-23

后台额度管理 MVP 用于开发测试阶段和后续运营阶段的用户权益调整。当前目标不是实现支付、会员商品或复杂运营系统，而是让管理员可以基于现有用户权益模型，对指定用户进行额度增加或扣除，并保留完整可审计记录。

### 与现有权益表的关系

当前用户权益系统继续保持两层模型：

```text
entitlement_transactions = 权益事实流水
user_entitlements = 当前权益快照
```

后台额度管理必须复用该模型：

- 管理员增加额度时，写入一条 `entitlement_transactions` 流水，并同步更新 `user_entitlements` 快照。
- 管理员扣除额度时，写入一条 `entitlement_transactions` 流水，并同步更新 `user_entitlements` 快照。
- `user_entitlements.quota_balance` 只作为读取优化，不作为管理员操作的唯一事实来源。
- 不允许无流水地直接修改 `quota_balance` 作为主要方案。

### 管理员操作额度流程

管理员增加额度：

```text
管理员登录后台
  -> 查询用户
  -> 输入增加额度、原因
  -> 服务端校验管理员身份
  -> 写 entitlement_transactions: ADMIN_GRANT
  -> 更新 user_entitlements 快照
  -> 返回用户最新额度
```

管理员扣除额度：

```text
管理员登录后台
  -> 查询用户
  -> 输入扣除额度、原因
  -> 服务端校验管理员身份
  -> 写 entitlement_transactions: ADMIN_DEDUCT
  -> 更新 user_entitlements 快照
  -> 返回用户最新额度
```

### 管理原则

- 所有后台额度调整都必须记录 `operator_type`、`operator_id` 和 `reason`。
- 后台只管理用户权益，不直接修改微信登录、收藏、最近学习或内容访问记录。
- 后续购买会员、充值、活动赠送、兑换码等商业化能力，应继续通过权益流水解释用户权益变化。
