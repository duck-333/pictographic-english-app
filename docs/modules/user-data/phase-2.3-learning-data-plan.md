# Phase 2.3 学习数据基础建设计划

日期：2026-07-21

状态：Planning

## 1. 定义

Phase 2.3 学习数据基础建设，是在已完成用户认证、收藏云端化和最近学习云端化之后，为用户学习行为建立可扩展的数据基础。

本阶段的核心不是做展示页，而是先建立稳定的数据分层：

```text
学习行为记录
  -> 学习统计聚合
  -> 用户学习状态
```

当前用户身份链路继续沿用：

```text
小程序
  -> pictographic:authSession
  -> Authorization: Bearer <user token>
  -> requireUserAuth()
  -> users.id
  -> 用户学习数据表
```

## 2. 目标

Phase 2.3 的目标：

- 建立登录用户学习行为记录能力。
- 为后续学习统计、学习报告、连续学习和复习体系保留可靠数据来源。
- 明确收藏、最近学习、学习事件、学习统计、学习进度之间的边界。
- 避免复用 `user_recent_words`、`user_favorites` 或本地 storage 导致统计口径混乱。

## 3. 不包含范围

当前阶段不实现：

- 我的页面新增统计。
- 学习报告。
- 连续学习展示。
- 学习排行榜。
- 会员权益统计。
- AI 推荐。
- 复杂埋点分析。
- 后台 BI 看板。

原因：

当前产品优先验证用户是否愿意持续使用核心功能：

- 查词。
- 学习。
- 收藏。
- 最近学习。
- 视频讲解。

学习数据基础建设只为这些核心功能留下可扩展的数据底座。

## 4. 当前已有基础

### `user_favorites`

已完成：

- 登录用户收藏云端保存。
- 未登录用户不能收藏。
- 多账号隔离。
- 跨设备同步。

职责：

- 收藏资产。

不承担：

- 学习进度。
- 掌握程度。
- 学习统计。

### `user_recent_words`

已完成：

- 登录用户最近学习云端保存。
- 未登录用户继续使用本地 `pictographic:userState.recentWordIds`。
- 多账号隔离。
- 跨设备同步。

职责：

- 最近学习列表。

不承担：

- 学习次数。
- 掌握程度。
- 学习统计。
- 视频观看。

### `pictographic:userState`

当前字段：

- `recentWordIds`
- `favoriteWordIds`
- `searchCount`
- `streakDays`
- `lastActiveDate`

职责：

- 游客状态。
- 本机轻量状态。

不直接升级为：

- 账号级可信学习统计。
- 跨设备连续学习记录。

## 5. 建议拆分

### Phase 2.3-A：学习行为记录基础

未来模型：

```text
learning_events
```

目标：

- 记录用户发生过的学习行为。
- 所有登录用户学习行为都归属 `users.id`。
- 为后续统计和进度提供原始数据。

建议先记录：

- 搜索单词。
- 打开详情。
- 收藏。
- 取消收藏。

未来可记录：

- 播放发音音频。
- 开始播放视频片段。
- 视频播放进度。
- 完成视频片段。

建议事件类型：

| event_type | 含义 |
| --- | --- |
| `word_search_submitted` | 用户提交搜索 |
| `word_detail_viewed` | 用户打开词条详情 |
| `favorite_added` | 用户收藏单词 |
| `favorite_removed` | 用户取消收藏 |
| `pronunciation_audio_played` | 用户播放发音音频 |
| `video_clip_started` | 用户开始播放视频片段 |
| `video_clip_progress` | 用户上报视频进度 |
| `video_clip_completed` | 用户完成视频片段 |

建议字段方向：

- `user_id`
- `event_type`
- `word_id`
- `query_text`
- `source`
- `video_clip_id`
- `video_asset_id`
- `duration_sec`
- `position_sec`
- `client_event_id`
- `event_date`
- `occurred_at`
- `created_at`
- `meta_json`

MVP 注意：

- `client_event_id` 用于处理小程序网络重试导致的重复上报。
- `event_date` 应由服务端按 Asia/Shanghai 统一生成或校准。
- `meta_json` 只能存白名单字段，不存敏感身份信息。

### Phase 2.3-B：学习统计能力

未来模型：

```text
user_daily_learning_stats
```

目标：

- 聚合用户每天学习数据。
- 为学习报告、连续学习、我的页统计等后续功能提供快速读取能力。

可能字段：

- `user_id`
- `stat_date`
- `search_count`
- `detail_view_count`
- `learned_word_count`
- `new_word_count`
- `reviewed_word_count`
- `favorite_add_count`
- `video_watch_seconds`
- `video_complete_count`
- `first_event_at`
- `last_event_at`
- `created_at`
- `updated_at`

生成方式：

- MVP：写入 `learning_events` 后同步 upsert 当天统计。
- 后续：增加离线校准任务，从 `learning_events` 重算最近 N 天。

使用场景：

- 学习报告。
- 连续学习。
- 数据展示。
- 后台轻量运营观察。

### Phase 2.3-C：学习进度

未来模型：

```text
user_word_progress
```

目标：

- 记录用户对每个单词的当前学习状态。
- 支持后续掌握状态、复习体系、个性化学习路径。

可能字段：

- `user_id`
- `word_id`
- `first_viewed_at`
- `last_viewed_at`
- `last_viewed_date`
- `view_count`
- `search_open_count`
- `video_watch_seconds`
- `video_complete_count`
- `mastery_status`
- `mastery_level`
- `created_at`
- `updated_at`

与 `learning_events` 的关系：

- `learning_events` 是原始行为流水。
- `user_word_progress` 是由行为流水更新出的单词状态快照。

使用场景：

- 掌握状态。
- 复习体系。
- 单词级学习记录。

### Phase 2.3-D：视频学习记录

未来模型：

```text
user_video_progress
```

目标：

- 记录用户对视频片段的学习进度。
- 支持未来断点续播、视频完成状态和视频学习报告。

可能字段：

- `user_id`
- `word_id`
- `video_clip_id`
- `video_asset_id`
- `provider`
- `last_position_sec`
- `max_position_sec`
- `watch_seconds`
- `completed_count`
- `completed_at`
- `first_started_at`
- `last_played_at`
- `created_at`
- `updated_at`

与内容字段的关系：

- 词条里的 `videoSegment` / `videoClips` 是内容配置。
- `user_video_progress` 是用户观看状态。

MVP 注意：

- 如果正式视频学习还没有稳定上线，可以先不实现这张表。
- 视频付费保护不能依赖前端进度，应由服务端鉴权和资源策略控制。

## 6. 当前不做范围

Phase 2.3 当前不做：

- 学习统计页面。
- 今日学习数量展示。
- 连续学习天数展示。
- 学习排行榜。
- AI 推荐。
- 复杂埋点分析。
- 会员权益统计。
- 付费视频防护。

原因：

- 当前阶段优先验证用户是否愿意使用产品。
- 过早做复杂展示会增加页面和数据口径负担。
- 先有可靠数据底座，再做学习报告和商业化能力更稳。

## 7. 实施建议

后续真正开发时建议按顺序执行：

1. 新增 ADR 和计划文档审阅通过。
2. 设计 `learning_events` migration。
3. 增加服务端 Store 和 API，继续沿用 `requireUserAuth()`。
4. 为小程序新增最小 API client。
5. 只在已有触发点上报最小事件。
6. 增加 API 测试，验证鉴权、幂等和用户隔离。
7. 再考虑每日统计和单词进度。

## 8. 验收方向

Phase 2.3-A 的最小验收：

- 未登录用户不上报账号级学习事件。
- 登录用户事件写入时由 token 决定 `user_id`。
- 前端不传 `user_id`。
- 同一 `client_event_id` 重试不会重复计数。
- 用户 A 和用户 B 事件隔离。
- 不影响收藏和最近学习现有行为。

Phase 2.3-B/C/D 的验收在对应阶段另行补充。

## 9. 明确禁止事项

- 不复用 `user_recent_words` 做学习统计。
- 不复用 `user_favorites` 表示学习进度。
- 不把本地 `searchCount` / `streakDays` 当成账号级可信数据。
- 不把视频内容字段当成用户观看记录。
- 不在小程序请求里传 `user_id`。
- 不在事件 metadata 中保存 openid、手机号、token 或其他敏感信息。
