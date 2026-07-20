# ADR-0017: User Recent Words Cloud Storage

日期：2026-07-20

状态：Accepted

## Context

Module 2.1 用户认证层已经完成，Phase 2.1 收藏云端化已经完成。

当前最近学习仍主要依赖小程序本地 storage：

```text
pictographic:userState.recentWordIds
```

该方式会导致登录用户的最近学习只存在于当前设备，无法跟随账号，也容易在退出登录后继续展示上一个账号的学习痕迹。

最近学习和收藏不同：

- 收藏是明确的用户学习资产，只允许登录用户保存。
- 最近学习是被动学习行为记录，未登录用户仍需要本机体验。

## Decision

1. 登录用户最近学习保存到服务器。

   小程序使用 `pictographic:authSession` 中的 user token，请求 `POST /api/user/recent-words` 和 `GET /api/user/recent-words`。

2. 未登录用户继续使用本地 storage。

   未登录用户仍通过 `pictographic:userState.recentWordIds` 保存本机最近学习。

3. 不做游客数据自动迁移。

   登录前的本机最近学习不自动导入、不合并、不关联到登录账号。

4. 登录用户最近学习不写入本地 `recentWordIds`。

   登录态下只保留本地 `searchCount`、`streakDays` 等尚未云端化的轻量统计，不把账号最近学习写入本机最近学习列表。

5. `user_recent_words` 只保存最近列表语义。

   同一用户同一单词只保留一行，通过更新 `viewed_at` 表示最近查看时间。

6. `user_recent_words` 不作为完整行为统计表。

   未来如果需要行为流水、学习报告或权益统计，应单独设计事件日志、每日统计或 quota/entitlement 表，不复用最近学习列表表。

7. 当前 MVP 不实现云端清空最近学习。

   服务端当前只有 `GET /api/user/recent-words` 和 `POST /api/user/recent-words`。登录态首页“清除历史记录”不清除云端数据。

## Consequences

- 登录用户最近学习可以跟随账号。
- 未登录用户仍有本机最近学习体验。
- 退出登录后，小程序不继续展示上一个账号的云端最近学习。
- 登录态最近学习展示依赖云端 API 可用性。
- 云端最近学习暂不支持用户主动清空。
