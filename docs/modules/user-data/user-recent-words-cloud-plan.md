# User Recent Words Cloud Plan

日期：2026-07-20

范围：Phase 2.2 最近学习云端化小程序接入。

## 1. 当前问题

小程序最近学习当前保存在本地：

```text
pictographic:userState.recentWordIds
```

读写位置：

```text
miniapp-uni/word-app1/common/user-store.js
```

当前本地结构：

```js
{
  recentWordIds: []
}
```

该结构只有单词 id 列表，没有 `viewedAt`。数组顺序表示最近查看顺序，最多保留 12 条。

## 2. 目标规则

登录用户：

```text
authSession
  -> Authorization: Bearer <token>
  -> POST /api/user/recent-words
  -> GET /api/user/recent-words
  -> user_recent_words
```

未登录用户：

```text
addRecentWord()
  -> pictographic:userState.recentWordIds
```

确认规则：

- 登录用户最近学习保存到云端。
- 未登录用户继续使用本地最近学习。
- 不自动迁移游客最近学习。
- 登录用户最近学习不写入本地 `recentWordIds`。
- `searchCount`、`streakDays` 暂时仍保留本地统计。

## 3. 已有服务端能力

数据库表：

```text
user_recent_words
```

字段：

- `id`
- `user_id`
- `word_id`
- `viewed_at`
- `created_at`

约束：

- `UNIQUE(user_id, word_id)`
- `INDEX(user_id, viewed_at)`
- `INDEX(word_id)`

API：

- `GET /api/user/recent-words`
- `POST /api/user/recent-words`

服务端逻辑：

- 同一用户重复查看同一个单词时，不新增记录。
- 只更新 `viewed_at`。
- 服务端通过 `requireUserAuth()` 从 token 获取 `userId`。

## 4. 小程序接入结果

新增：

```text
miniapp-uni/word-app1/common/user-recent-words-api-client.js
```

修改：

```text
miniapp-uni/word-app1/common/user-store.js
miniapp-uni/word-app1/pages/word-detail/index.vue
miniapp-uni/word-app1/pages/index/index.vue
miniapp-uni/word-app1/pages/mine/index.vue
```

### user-store.js

保留：

- `addRecentWord()`
- `getRecentWords()`
- `getRecentWordIds()`
- `clearRecentWords()`
- `removeRecentWord()`
- `replaceRecentWordId()`

新增：

- `recordLearningActivity()`

用途：

- 登录态记录最近学习时，不写本地 `recentWordIds`。
- 继续维护当前本地 `searchCount` 和 `streakDays`。

### word-detail/index.vue

词条加载完成后：

- 未登录：继续调用 `addRecentWord()`。
- 已登录：调用 `recordUserRecentWord()` 写云端，同时调用 `recordLearningActivity()` 保留当前本地统计。

### index/index.vue

首页搜索、今日推荐、最近学习入口打开详情时：

- 未登录：继续写本地 `recentWordIds`。
- 已登录：写云端 `user_recent_words`，不写本地 `recentWordIds`。

首页最近学习下拉：

- 未登录：读取本地最近学习。
- 已登录：读取云端最近学习。

当前服务端没有清空最近学习 API，因此登录态点击“清除历史记录”时不清除云端数据。

### mine/index.vue

我的页最近学习：

- 未登录：读取本地 `getRecentWords()`。
- 已登录：读取 `GET /api/user/recent-words`，再通过现有词库能力补全词条展示。

退出登录后：

- 清空账号云端 recent 展示状态。
- 恢复显示本机游客 recent。

## 5. 不涉及范围

本阶段未修改：

- `server/**`
- `database/**`
- 登录流程
- `auth-store.js`
- `auth-api-client.js`
- `api-config.js`
- `word-repository.js`
- 收藏 Phase 2.1 逻辑
- 首页推荐词生成逻辑
- 视频播放逻辑
- 词条数据结构

## 6. 风险与后续

- 云端最近学习当前不支持用户主动清空。
- `user_recent_words` 是最近列表表，不是完整学习行为日志。
- `searchCount` 和 `streakDays` 仍是本地统计，后续需要单独云端化。
- 真实账号 A/B 数据隔离和跨设备同步需要真机与数据库环境验收。
