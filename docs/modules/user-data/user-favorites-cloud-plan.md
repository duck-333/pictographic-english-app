# User Favorites Cloud Plan

日期：2026-07-17

范围：`user_favorites` 收藏云端化开发方案。当前执行拆分为 Phase 1 服务端收藏闭环和 Phase 2 小程序接入。

本文件只记录开发方案，不包含代码实现，不创建数据库迁移，不改变现有登录链路。

## 0. 开发执行约束

收藏云端化必须分阶段执行，不允许一次性同时修改数据库、服务端 API 和小程序页面。

当前仅允许进入服务端收藏闭环阶段。必须等待明确指令“开始执行 Phase 1”后，才允许修改代码。

### Phase 1：服务端收藏闭环

允许修改：

- `database/migrations/002_create_user_favorites.sql`
- `server/index.mjs`
- `server/user-favorites-store.mjs`
- `scripts/test-user-favorites-api.mjs`

目标：

- 完成 `user_favorites` 数据库设计。
- 完成服务端收藏 Store。
- 完成收藏 API 路由。
- 完成 API 测试。

验证要求：

- API 可以正常创建收藏。
- API 可以取消收藏。
- API 查询收藏正常。
- 用户隔离正常。
- 幂等逻辑正常。

Phase 1 禁止修改：

- `miniapp-uni`
- `miniapp-uni/word-app1/common/user-store.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages/mine/index.vue`

### Phase 2：小程序接入

只有 Phase 1 API 验证通过后，才允许进入小程序接入阶段。

Phase 2 允许修改：

- `miniapp-uni/word-app1/common/user-store.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages/mine/index.vue`

目标：

- 登录用户收藏读写走服务器 API。
- 未登录用户继续使用本地 `uni` storage。
- 不导入、不合并、不关联登录前游客收藏。

任何超出当前阶段范围的发现，只记录，不顺手修复。

## 1. 当前问题分析

Module 2.1 用户认证层已经完成：

- 微信登录
- 手机号登录
- `users` 用户主表
- user token
- `requireUserAuth()`
- `/api/me`

用户行为数据尚未绑定 `users.id`。

当前小程序通过 `pictographic:userState` 保存行为数据：

- `recentWordIds`
- `favoriteWordIds`
- `searchCount`
- `streakDays`

收藏数据仍在本机 storage 中。用户登录后，收藏不会跟随账号；换设备、清理缓存或重新安装后，收藏数据会丢失。

本阶段只处理收藏云端化，不处理最近查看、学习统计、quota、entitlement、会员系统。

## 2. 当前数据流分析

当前收藏数据流：

```text
word-detail/index.vue
  -> isFavorite(word.id)
  -> toggleFavorite(word.id)
  -> common/user-store.js
  -> pictographic:userState.favoriteWordIds
  -> uni.getStorageSync / uni.setStorageSync
```

当前我的页收藏展示：

```text
mine/index.vue
  -> getFavoriteWords()
  -> common/user-store.js
  -> pictographic:userState.favoriteWordIds
  -> word-repository cache 补全词条展示
```

当前问题：

- 收藏数据没有 `user_id`
- 服务端没有收藏 API
- 数据库没有 `user_favorites`
- `/api/me` 只验证身份，不返回收藏
- 登录用户和游客使用同一份本机收藏数据

## 3. 目标架构

收藏云端化目标：

```text
登录用户
  -> token
  -> requireUserAuth()
  -> authResult.userId
  -> user_favorites
```

```text
未登录用户
  -> pictographic:userState.favoriteWordIds
  -> uni storage
```

确认原则：

- 登录用户收藏以服务器为准。
- 未登录用户收藏继续使用本地 storage。
- 不做游客数据自动迁移。
- 登录前的本机收藏不自动导入账号。
- 收藏 API 返回 `wordId`，不返回完整词条。
- 小程序继续通过现有词库读取展示用词条详情。
- 执行顺序必须先完成服务端闭环，再接入小程序。

## 4. 数据库设计

新增表：

```text
user_favorites
```

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `BIGINT UNSIGNED AUTO_INCREMENT` | 主键 |
| `user_id` | `BIGINT UNSIGNED NOT NULL` | 对应 `users.id` |
| `word_id` | `VARCHAR(191) NOT NULL` | 词条 id，使用字符串类型 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 收藏创建时间 |

索引与约束：

| 名称 | 类型 | 字段 | 说明 |
|---|---|---|---|
| `PRIMARY` | primary key | `id` | 主键 |
| `uk_user_favorites_user_word` | unique | `user_id`, `word_id` | 防止重复收藏 |
| `idx_user_favorites_user_created` | index | `user_id`, `created_at` | 用户收藏列表排序 |
| `idx_user_favorites_word_id` | index | `word_id` | 按词条排查收藏数据 |

删除策略：

- 取消收藏时硬删除对应行。
- API 保持幂等，重复删除不存在的收藏也返回成功。

外键策略：

- Phase 1 不强制新增数据库外键。
- 服务端仍以 `user_favorites.user_id` 作为 `users.id` 的业务关联。
- 该策略与当前 `user_phone_bindings` migration 的外键边界保持一致。

## 5. API 设计

所有接口都使用：

```text
Authorization: Bearer <user token>
```

服务端统一通过：

```js
const authResult = requireUserAuth(req, userAuthOptions)
const userId = authResult.userId
```

### GET /api/user/favorites

用途：获取当前登录用户收藏 wordId 列表。

返回：

```json
{
  "ok": true,
  "favorites": [
    {
      "wordId": "asia",
      "createdAt": "2026-07-17T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

说明：

- 不返回完整词条。
- 小程序使用 `wordId` 通过现有词库能力补全展示。

### POST /api/user/favorites

用途：收藏一个词条。

请求：

```json
{
  "wordId": "asia"
}
```

返回：

```json
{
  "ok": true,
  "favorite": {
    "wordId": "asia",
    "createdAt": "2026-07-17T00:00:00.000Z"
  }
}
```

幂等规则：

- 已收藏时再次 POST 仍返回 `ok: true`。
- 不因为重复收藏报错。

### DELETE /api/user/favorites/:wordId

用途：取消收藏。

返回：

```json
{
  "ok": true,
  "wordId": "asia",
  "deleted": true
}
```

幂等规则：

- 未收藏时 DELETE 仍返回 `ok: true`。
- `deleted` 可用于表达本次是否实际删除了数据库行。

### 错误约定

| 场景 | HTTP | code |
|---|---:|---|
| 未带 token | 401 | `UNAUTHORIZED` |
| token 无效 | 403 | `UNAUTHORIZED` |
| wordId 为空 | 400 | `WORD_ID_REQUIRED` |
| wordId 超长 | 400 | `WORD_ID_INVALID` |
| 数据库不可用 | 503 | `USER_FAVORITES_DB_ERROR` |

## 6. 小程序改造方案

本节属于 Phase 2。当前 Phase 1 服务端闭环完成并验证通过前，不修改小程序代码。

允许修改范围：

- `miniapp-uni/word-app1/common/user-store.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages/mine/index.vue`

登录态来源：

- `miniapp-uni/word-app1/common/auth-store.js`
- 读取 `pictographic:authSession`

### common/user-store.js

职责调整：

- 保留本地 storage 收藏能力，服务未登录用户。
- 增加登录用户收藏 API 读写能力。
- 登录用户不自动读取或导入本机 `favoriteWordIds`。

建议函数边界：

```text
isFavorite(wordId)
toggleFavorite(wordId)
getFavoriteWords()
```

在 Phase 2 中需要支持异步服务器读写。页面层需要配合处理 loading 与错误提示。

### word-detail/index.vue

改造点：

- 页面加载词条后，登录用户从服务器收藏列表判断是否已收藏。
- 未登录用户继续调用本地 `isFavorite(word.id)`。
- 点击收藏时：
  - 登录用户调用收藏 API。
  - 未登录用户继续写入本地 storage。
- 失败时保留当前页面状态并提示用户。

### mine/index.vue

改造点：

- 登录用户展示服务器收藏列表。
- 未登录用户展示本地收藏列表。
- “本机记录”与登录状态文案保持当前用户边界，不做游客收藏迁移。

## 7. 测试方案

### Phase 1 服务端测试

新增脚本：

```text
scripts/test-user-favorites-api.mjs
```

覆盖：

- 未登录访问收藏 API 返回 401。
- 无效 token 返回 403。
- POST 收藏成功。
- 重复 POST 保持幂等。
- GET 返回当前用户收藏。
- DELETE 收藏成功。
- 重复 DELETE 保持幂等。
- 用户 A 与用户 B 收藏隔离。
- 数据库错误返回安全错误，不暴露内部 SQL。

Phase 1 完成标准：

- 可以通过 node test script 验证收藏 API 闭环。
- 可以使用 curl 或同等 API 请求验证真实服务端行为。
- 不依赖小程序页面改造完成情况。

### Phase 2 小程序测试

覆盖：

- 未登录收藏仍写入 `pictographic:userState.favoriteWordIds`。
- 登录后收藏调用服务器 API。
- 登录后不自动导入本地游客收藏。
- 退出登录后，本地游客收藏仍可使用。
- 我的页收藏数量和列表按当前模式显示。

### 回归检查

执行现有检查：

```bash
npm.cmd run check:server
npm.cmd run check:miniapp
```

## 8. 部署方案

部署顺序：

### Phase 1 服务端部署

1. 备份生产数据库。
2. 人工 review `user_favorites` migration。
3. 在生产数据库执行 migration。
4. 部署服务端代码。
5. 重启 PM2。
6. 验证 `/api/health`。
7. 使用真实登录 token 验证收藏 API。

生产验证：

```bash
curl https://baxiaota.com/api/health
```

收藏 API 验证需要携带真实用户 token：

```bash
curl https://baxiaota.com/api/user/favorites \
  -H "Authorization: Bearer <token>"
```

### Phase 2 小程序发布

Phase 1 服务端 API 验证通过后，再发布小程序测试版或体验版。

## 9. 回滚方案

代码回滚：

- Phase 1 回滚服务端收藏 API 相关代码。
- Phase 2 如已接入小程序，再回滚小程序收藏调用逻辑。
- 未登录本地收藏不受影响。

数据库回滚：

- `user_favorites` 表可保留，不影响现有登录与词条 API。
- 如需删除表，必须先确认没有线上代码继续读写该表，并完成数据导出。

业务回滚：

- 登录用户收藏功能回退到本地 storage 行为。
- 不涉及登录流程、JWT、`/api/me`、quota、entitlement、VOD、后台管理或视频功能。

## 严格开发边界

当前 Phase 1 只允许涉及：

数据库：

- `database/migrations/002_create_user_favorites.sql`

服务端：

- `server/index.mjs`
- 新增 `server/user-favorites-store.mjs`

测试：

- `scripts/test-user-favorites-api.mjs`

Phase 1 明确禁止修改小程序目录。小程序接入属于 Phase 2，必须等待 Phase 1 API 验证通过后再执行。

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
