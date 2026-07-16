# ADR-0015: 用户学习数据同步

Status: Accepted

Date: 2026-07-15

## Context

Module 1 用户身份体系升级已经完成，生产环境已验证微信手机号快捷登录，并且 `users`、`wechat_user_bindings` 和 `user_phone_bindings` 已能把 WeChat 身份和手机号身份绑定到项目内部 `users.id`。

当前小程序仍把学习行为数据保存在本机缓存：

```text
pictographic:userState
  recentWordIds
  favoriteWordIds
  searchCount
  streakDays
  lastActiveDate
```

这些数据覆盖：

- 收藏单词。
- 最近查看。
- 连续学习天数。
- 查词统计。

这带来几个问题：

- 用户换设备、清空缓存或重装小程序后，学习数据会丢失。
- 登录用户的数据没有真正跟随账号，手机号身份绑定无法承载学习记录。
- 后台无法查询用户学习行为、收藏和最近查看。
- 未来查词额度、会员、买书权益、分享奖励等权益系统无法与学习行为形成清晰边界。
- 本地 `searchCount` 容易被误用为真实权益余额，但它目前只是本机统计。

## Decision

用户学习数据同步作为手机号身份体系完成后的下一个独立模块设计，不改变现有微信手机号登录链路。

### 1. 用户身份

所有登录用户学习数据必须关联到项目内部主身份：

```text
users.id
```

外部身份仍只作为绑定关系：

```text
users.id
  -> wechat_user_bindings.openid / unionid
  -> user_phone_bindings.phone_hash / phone_masked
```

学习数据不得直接引用 `openid`、`unionid` 或手机号。

### 2. 学习数据服务器化

下一阶段计划新增服务器端学习数据表：

```text
user_favorites
user_word_views
user_learning_daily_stats
```

职责划分：

- `user_favorites`：保存用户收藏状态。
- `user_word_views`：保存用户查看过的词条聚合，用于最近查看和查看次数。
- `user_learning_daily_stats`：保存用户每日学习活跃聚合，用于连续学习和学习统计。

这些表是学习行为数据，不是商业权益数据。

### 3. 本地缓存定位

小程序本地 `pictographic:userState` 降级为：

- 未登录游客模式缓存。
- 网络异常或离线时的 fallback。
- 登录后迁移前的本机待同步数据来源。

登录用户的数据展示和后续跨设备同步应以服务器学习数据为准。本地缓存不再作为登录用户唯一数据源。

### 4. 游客数据迁移

游客数据迁移采用显式确认策略：

```text
用户未登录产生本机收藏/最近查看
  -> 用户登录手机号账号
  -> 小程序检测本机未归属学习数据
  -> 提示用户是否同步到当前账号
  -> 用户确认后才调用导入接口
  -> 服务端按 users.id 合并数据
```

不得在登录成功后静默自动合并本机数据。

原因：

- 同一设备可能被多个用户使用。
- 退出登录不代表用户希望把本机缓存归属给下一个登录账号。
- 静默合并会造成收藏、历史和后续权益归属争议。

### 5. 权益系统边界

学习行为和商业权益必须分离：

```text
learning data
  favorites
  views
  daily stats

commercial rights
  quota
  entitlement
```

`searchCount` 不能作为真实权益余额。

真实查词次数必须由未来 quota 模型承载：

```text
user_quota_accounts
user_quota_logs
```

未来会员、买书、课程包和视频权限由 entitlement 模型承载：

```text
user_entitlements
```

学习行为可以为后台分析、用户学习报告和产品体验服务，但不能替代配额流水或会员资格判断。

## Planned API Direction

具体 API 需要在实现任务中确认，当前方向如下：

```text
GET /api/me/learning-state
POST /api/me/learning-state/import
GET /api/me/favorites
POST /api/me/favorites
DELETE /api/me/favorites/:wordId
GET /api/me/word-views
POST /api/me/word-views
```

这些 API 必须使用服务端用户 session 校验：

```text
Authorization: Bearer <user token>
  -> verify user token
  -> role must be user
  -> sub is users.id
```

当前代码只有用户 session token 创建能力，尚未实现用户 token 校验中间层。用户学习数据同步开发前必须先补齐这一认证边界。

## Consequences

- 学习数据同步成为独立模块，不混入手机号登录模块。
- 小程序需要区分游客本地数据和登录用户服务器数据。
- 数据库变更必须遵循 ADR-0007，需要迁移脚本、回滚方案、备份验证和人工确认。
- 后续查词额度开发不得复用本地 `searchCount` 作为余额。
- 未来后台用户查询可以基于 `users.id` 查看收藏、最近查看和学习统计，但不得展示手机号明文或原始 WeChat 身份。

## Not Implemented In This ADR

本 ADR 只记录架构决策，不表示已经实现：

- 没有创建数据库迁移。
- 没有新增服务端 API。
- 没有修改小程序本地缓存逻辑。
- 没有修改微信手机号登录链路。
- 没有实现 quota、entitlement、支付、会员或内容访问扣次。
