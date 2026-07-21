# ADR-0018: Phase 2.3 学习数据架构设计

日期：2026-07-21

状态：Proposed

## 背景

用户认证层、收藏云端化和最近学习云端化已经完成。当前登录用户已经可以通过：

```text
小程序 authSession
  -> Authorization: Bearer <user token>
  -> requireUserAuth()
  -> users.id
  -> 用户业务数据表
```

访问账号级数据。

随着账号体系可用，后续需要记录用户学习行为，为学习统计、学习进度、视频学习记录和学习报告打基础。

但当前已有的收藏和最近学习并不是学习统计表：

- 收藏表示用户主动保存的学习资产。
- 最近学习表示最近查看过哪些单词。
- 本地学习次数和连续学习天数只是当前设备上的轻量状态。

如果直接复用这些数据做学习统计，后续会导致统计口径混乱、跨设备不一致和学习报告难以修正。因此 Phase 2.3 需要先明确学习数据的职责边界。

## 当前已有数据边界

### `user_favorites`

职责：

- 保存登录用户账号级收藏资产。
- 一个用户收藏一个 `word_id` 最多一行。
- 收藏和取消收藏保持幂等。

不负责：

- 学习完成状态。
- 掌握程度。
- 学习次数。
- 学习报告。

### `user_recent_words`

职责：

- 保存登录用户最近学习列表。
- 同一用户同一单词只保留一行。
- 重复查看同一个单词时更新 `viewed_at`。

不负责：

- 完整行为日志。
- 学习次数统计。
- 连续学习天数。
- 单词掌握状态。
- 视频观看记录。

### `pictographic:userState`

职责：

- 保存未登录用户的本机最近学习体验。
- 保存本机轻量状态，例如 `searchCount`、`streakDays`、`lastActiveDate`。
- 保留历史字段 `favoriteWordIds`，但当前未登录用户不再创建新收藏。

不负责：

- 登录账号的可信学习统计。
- 跨设备同步后的学习报告。
- 会员权益或付费额度判断。

## 架构原则

1. 不使用 `user_recent_words` 作为学习统计来源。

   原因：它只保存最近列表，重复查看会覆盖 `viewed_at`，不会保存完整行为，也无法还原某一天学了多少次。

2. 不使用 `user_favorites` 表示学习进度。

   原因：收藏代表用户主动保存，不代表学习完成、理解或掌握。

3. 不直接信任本地 `searchCount` / `streakDays` 作为账号数据。

   原因：本地 storage 无法跨设备同步，用户清缓存或换设备后会丢失，也可能与服务端数据不一致。

4. 不把词条中的视频字段当作观看记录。

   原因：`videoSegment` / `videoClips` 描述内容资源和播放片段，不描述某个用户看到了哪里。

5. 未来学习数据采用分层模型：

   ```text
   行为事件
     -> 统计聚合
     -> 用户状态
   ```

   原始行为用于审计和重算，聚合数据用于页面和报表，用户状态用于快速展示当前学习进度。

6. 所有账号级学习数据必须继续使用服务端身份。

   小程序不传 `user_id`，服务端统一通过 `requireUserAuth() -> authResult.userId` 写入用户数据。

## 推荐未来模型

本 ADR 只做设计，不创建数据库表，不新增 migration，不修改 API。

### `learning_events`

用途：

- 记录用户发生过的原始学习行为。
- 为后续每日统计、学习报告、学习进度和视频学习记录提供可追溯来源。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | `users.id` |
| `event_type` | 行为类型 |
| `word_id` | 词条 id，可为空 |
| `query_text` | 搜索词，可为空 |
| `source` | 行为入口，例如首页搜索、最近学习、我的收藏 |
| `video_clip_id` | 视频片段 id，可为空 |
| `video_asset_id` | 视频资源 id，可为空 |
| `duration_sec` | 观看或播放时长，可为空 |
| `position_sec` | 视频播放位置，可为空 |
| `client_event_id` | 客户端事件 id，用于防重复 |
| `event_date` | 按 Asia/Shanghai 计算的日期 |
| `occurred_at` | 行为发生时间 |
| `created_at` | 服务端写入时间 |
| `meta_json` | 少量白名单扩展信息 |

建议事件类型：

- `word_search_submitted`
- `word_detail_viewed`
- `favorite_added`
- `favorite_removed`
- `pronunciation_audio_played`
- `video_clip_started`
- `video_clip_progress`
- `video_clip_completed`

MVP 优先事件：

- 搜索单词。
- 打开详情。
- 收藏。
- 取消收藏。

视频相关事件可以等正式视频学习链路稳定后再接入。

### `user_daily_learning_stats`

用途：

- 保存每日聚合统计。
- 服务未来学习报告、连续学习、我的页统计和运营分析。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | `users.id` |
| `stat_date` | 统计日期，Asia/Shanghai |
| `search_count` | 搜索次数 |
| `detail_view_count` | 打开详情次数 |
| `learned_word_count` | 当天学习去重单词数 |
| `new_word_count` | 当天首次学习新词数 |
| `reviewed_word_count` | 当天复习旧词数 |
| `favorite_add_count` | 收藏次数 |
| `video_watch_seconds` | 视频观看秒数 |
| `video_complete_count` | 完成视频片段数 |
| `first_event_at` | 当天首次学习时间 |
| `last_event_at` | 当天最后学习时间 |
| `created_at` / `updated_at` | 记录时间 |

生成方式：

- MVP 可以在写入 `learning_events` 后同步 upsert 当天统计。
- 后续可以增加离线校准任务，从 `learning_events` 重算最近 N 天数据。

### `user_word_progress`

用途：

- 保存用户对单个单词的学习状态快照。
- 支持掌握状态、复习体系和单词级学习记录。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | `users.id` |
| `word_id` | 词条 id |
| `first_viewed_at` | 首次查看时间 |
| `last_viewed_at` | 最近查看时间 |
| `last_viewed_date` | 最近查看日期 |
| `view_count` | 详情查看次数 |
| `search_open_count` | 从搜索进入次数 |
| `video_watch_seconds` | 单词下视频累计观看秒数 |
| `video_complete_count` | 单词下视频完成次数 |
| `mastery_status` | `new` / `learning` / `reviewing` / `mastered` |
| `mastery_level` | 掌握等级，后续可用 |
| `created_at` / `updated_at` | 记录时间 |

关系：

- `learning_events` 是原始流水。
- `user_word_progress` 是由学习行为更新出的当前状态。
- 收藏状态仍然由 `user_favorites` 负责，不能合并到学习进度表中。

### `user_video_progress`

用途：

- 保存用户对视频或视频片段的学习进度。
- 支持未来视频学习记录、断点续播、视频完成状态和视频学习报告。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | `users.id` |
| `word_id` | 词条 id |
| `video_clip_id` | 视频片段 id |
| `video_asset_id` | 视频资源 id |
| `provider` | 视频来源，例如 VOD、COS、cloud-storage |
| `last_position_sec` | 最近播放位置 |
| `max_position_sec` | 到达过的最大播放进度 |
| `watch_seconds` | 累计观看秒数 |
| `completed_count` | 完成次数 |
| `completed_at` | 最近完成时间 |
| `first_started_at` | 首次开始时间 |
| `last_played_at` | 最近播放时间 |
| `created_at` / `updated_at` | 记录时间 |

说明：

- 当前视频字段属于内容资源配置。
- `user_video_progress` 才属于用户观看记录。
- 如果正式上线需要付费视频保护，应由服务端短时效 URL、VOD 鉴权或短片段资源控制，不能只依赖前端播放进度。

## MVP 与未来边界

Phase 2.3 的 MVP 不要求一次实现全部模型。

优先级建议：

1. 建立 `learning_events` 行为记录。
2. 基于事件维护最小每日统计。
3. 基于详情查看维护单词学习进度。
4. 等视频学习产品形态稳定后再接入视频进度。

当前不做：

- 学习报告。
- 我的页面新增统计展示。
- 连续学习展示。
- 排行榜。
- 会员权益统计。
- 复杂 BI。

## 后果

- 学习数据有独立来源，不污染收藏和最近学习表。
- 后续可以从事件重算统计，降低口径错误后的修复成本。
- 页面读取可以走聚合表，避免每次查询扫描事件表。
- 初期实现复杂度会比直接累加本地计数更高，但能避免后续返工。
