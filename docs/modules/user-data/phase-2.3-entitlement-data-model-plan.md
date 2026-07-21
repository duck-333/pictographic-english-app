# Phase 2.3 用户权益数据库模型开发计划

日期：2026-07-21

状态：Planning

## 1. 目标

本计划用于 Phase 2.3 用户权益系统的数据库模型落地准备。

当前只做架构文档设计，不创建 SQL，不新增 migration，不修改 `server/**`、`database/**`、`miniapp-uni/**`、API 或 `package.json`。

目标能力：

- 注册赠送免费完整内容访问额度，例如 30 次，有效期暂定一年。
- 用户主动访问 root Learning Object 完整内容时消耗额度。
- root Learning Object 内部 `decompose` 展开不重复消耗。
- `related` / `recommend` 跳转到新的 Learning Object 时重新判断权益。
- 月会员有效期内完整内容访问无限制，不消耗普通额度，不产生永久解锁。
- 支持注册赠送、分享奖励、管理员赠送、会员、退款恢复等多来源权益。

## 2. 数据模型原则

### 不直接扩展 `users` 做余额表

不设计：

- `users.free_count`
- `users.vip_status`
- `users.search_balance`

原因：

- `users` 应保持用户身份主表职责。
- 权益来源会持续增加。
- 单个字段无法表达有效期、来源、订单、退款、管理员操作和流水审计。
- 快照异常时无法从单个字段重算。

### 不设计永久解锁表

不设计：

- `user_unlocked_words`
- `word_unlock_records`
- 永久解锁 Learning Object 的访问表

原因：

- 当前商业规则不是买断词条。
- 会员期间看过的完整内容不会在会员过期后永久可访问。
- 免费额度、会员、退款和活动奖励都应按当前权益规则判断。

### 权益判断基于 Learning Object + Access Context

不使用：

- `word_id` 硬编码规则。
- `apple` / `pl` / `p` 这类特殊规则。
- 页面路径判断。
- 页面层级判断。

应该基于：

```text
root_learning_object_id
current_learning_object_id
relation_type
access_reason
```

判断本次访问是否是新的 root Learning Object 完整内容访问。

## 3. 推荐表关系

核心关系：

```text
users
  1 -> 1 user_entitlements
  1 -> N entitlement_transactions

orders/payments
  1 -> N entitlement_transactions

Learning Object
  1 -> N entitlement_transactions
```

说明：

- `users.id` 是所有账号权益数据的归属主键。
- `user_entitlements` 是当前状态快照。
- `entitlement_transactions` 是事实流水。
- `orders` / `payments` 只负责支付和订单状态，通过流水给用户发放权益。
- Learning Object 不应通过永久解锁表关联用户，而是在访问时通过权益判断。

## 4. 表设计方向

### `entitlement_transactions`

定位：事实来源。

记录：

- 注册赠送 `REGISTER_BONUS +30`
- 访问完整内容 `CONTENT_ACCESS -1`
- 分享奖励 `SHARE_REWARD +N`
- 管理员赠送 `ADMIN_GRANT +N`
- 购买会员 `MEMBERSHIP_ACTIVATED`
- 退款恢复 `REFUND_RESTORE`
- 额度过期 `EXPIRE_DEDUCT`

字段方向：

- `id`
- `transaction_id`
- `user_id`
- `entitlement_type`
- `transaction_type`
- `amount`
- `balance_after`
- `source`
- `source_id`
- `expires_at`
- `related_object_type`
- `related_object_id`
- `root_learning_object_id`
- `current_learning_object_id`
- `access_context_json`
- `grant_transaction_id`
- `idempotency_key`
- `operator_type`
- `operator_id`
- `reason`
- `metadata_json`
- `occurred_at`
- `created_at`

索引方向：

- `transaction_id` 唯一。
- `idempotency_key` 唯一或按业务域唯一。
- `user_id + created_at`。
- `user_id + entitlement_type + created_at`。
- `source + source_id`。
- `root_learning_object_id`。
- `expires_at`。

### `user_entitlements`

定位：当前状态快照。

字段方向：

- `id`
- `user_id`
- `quota_balance`
- `quota_total_granted`
- `quota_total_consumed`
- `quota_total_expired`
- `membership_type`
- `membership_status`
- `membership_started_at`
- `membership_expire_at`
- `last_transaction_id`
- `created_at`
- `updated_at`

索引方向：

- `user_id` 唯一。
- `membership_status + membership_expire_at`。
- `updated_at`。

规则：

- 不能只更新快照而不写流水。
- 快照和流水不一致时，以流水为准。
- 完整内容访问时优先读取快照，但扣减必须在事务内写流水并更新快照。

## 5. 权益过期策略

所有额度型权益都应支持 `expires_at`。

默认规划：

- `REGISTER_BONUS`：一年有效。
- `ADMIN_GRANT`：一年有效或后台配置。
- `SHARE_REWARD`：未来按活动配置。
- `CAMPAIGN_REWARD`：未来按活动配置。
- `PURCHASE_GRANT`：未来按商品配置。

注意：

- 有效期不能写死在表结构里。
- 额度发放流水记录 `expires_at`。
- 额度过期时产生 `EXPIRE_DEDUCT` 流水。
- 会员过期由 `membership_expire_at` 判断，不等同于额度过期。

## 6. 多来源额度消费策略

推荐：

```text
FIFO by expires_at
优先消耗最早过期的有效额度
```

示例：

```text
注册赠送 30 次，2027-07-21 过期
分享奖励 10 次，2026-10-21 过期
管理员赠送 50 次，2027-07-21 过期
```

用户访问完整内容时，优先消耗 2026-10-21 过期的分享奖励。

记录要求：

- `CONTENT_ACCESS` 流水记录 `root_learning_object_id` 和 `access_context_json`。
- 如果消耗来自某一笔赠送，记录 `grant_transaction_id`。
- 如果未来一次消耗跨多批额度，在 `metadata_json.consumed_allocations` 记录分摊明细，或引入额度批次快照表。

本阶段只记录方向，不新增批次表。

## 7. 与 Phase 2.1 / Phase 2.2 的关系

### Phase 2.1 `user_favorites`

保持不变。

职责仍然是账号收藏资产。

不能用于：

- 完整内容访问资格。
- 额度余额。
- 学习对象解锁。
- 会员状态。

### Phase 2.2 `user_recent_words`

保持不变。

职责仍然是最近学习列表。

不能用于：

- 查词次数统计。
- 权益扣减。
- 额度余额。
- 永久解锁。

### 与学习数据系统

未来同一次访问可能写入多个模块：

```text
主动进入 apple 完整内容
  -> entitlement_transactions: CONTENT_ACCESS -1
  -> user_entitlements: quota_balance 更新
  -> user_recent_words: 记录最近学习 apple
  -> learning_events: 记录学习行为
```

各模块职责不同，不能混用事实来源。

## 8. 未来开发阶段

### 第一阶段：数据库 migration

目标：

- 设计 `user_entitlements` migration。
- 设计 `entitlement_transactions` migration。
- 明确索引、唯一约束和字段类型。
- 明确是否需要外键；如果暂不加外键，需要在文档中解释原因。
- 确认与现有 `users.id` 类型一致。

验收方向：

- 新表可以支持用户当前权益查询。
- 新表可以支持注册赠送、内容访问消耗、管理员赠送和会员开通流水。
- 不创建永久解锁表。
- 不修改 `user_favorites` / `user_recent_words`。

### 第二阶段：server store

目标：

- 新增权益 Store。
- 所有用户写入通过 `requireUserAuth()` 派生的 `authResult.userId`。
- 实现注册赠送初始化幂等逻辑。
- 实现快照读取。
- 实现流水写入。
- 实现事务内“判断 -> 写流水 -> 更新快照”。

验收方向：

- 同一用户不会重复获得注册赠送。
- 同一 `idempotency_key` 不会重复扣减或重复发放。
- 多账号隔离。
- 快照异常时可以从流水解释和重算。

### 第三阶段：权益检查 API

目标：

- 新增完整内容访问前的权益检查能力。
- 服务端识别 root Learning Object 和 `access_context`。
- 会员有效时允许访问，不扣普通额度。
- 非会员有额度时扣减。
- 额度不足时返回权益不足。

验收方向：

- 小程序不传 `user_id`。
- 小程序不自行判断余额。
- `decompose` 内部展开不重复扣减。
- `related` / `recommend` 新对象重新判断。
- 不产生永久解锁记录。

### 第四阶段：小程序完整内容访问控制

目标：

- 小程序请求服务端完整内容或权益检查结果。
- 小程序只展示服务端返回的可访问状态、剩余额度或会员状态。
- 小程序不本地扣减。
- 小程序不依赖页面路径判断是否扣减。

验收方向：

- 搜索 `apple` 进入完整内容扣 1 次。
- `apple` 内部展开 `ap/pl/e` 不重复扣。
- 搜索 `pl` 进入完整内容扣 1 次。
- 从 `apple` 关联到 `fruit` 重新判断权益。

### 第五阶段：后台权益管理

目标：

- 后台查看用户当前权益快照。
- 后台查看用户权益流水。
- 后台人工赠送额度。
- 后台调整或恢复权益。
- 后台操作必须写流水。

验收方向：

- 管理员赠送 +N 后，用户快照和流水一致。
- 后台能解释当前余额。
- 后台能按用户、来源、时间查看流水。
- 后台不能直接绕过流水修改余额。

## 9. 后续订单和会员阶段

订单支付模块另行规划。

边界：

- `orders` / `payments` 负责微信支付、商品购买、会员订单状态和支付回调。
- `entitlement_transactions` 负责把支付结果转化为用户权益。
- `user_entitlements` 负责当前会员状态和普通额度快照。

推荐顺序：

1. 先完成免费额度闭环。
2. 再完成后台赠送。
3. 再接入会员状态。
4. 最后接入微信支付和订单回调。

原因：

- 免费额度可以验证核心扣减模型。
- 后台赠送可以验证多来源加额。
- 会员状态可以验证“有效期内不扣普通额度”。
- 支付接入复杂度最高，应在权益模型稳定后进行。

## 10. 明确禁止事项

- 不创建 `user_unlocked_words`。
- 不创建 `word_unlock_records`。
- 不设计永久解锁表。
- 不在 `users` 表增加 `free_count`、`vip_status`、`search_balance` 承担权益。
- 不用 `word_id` 硬编码权益规则。
- 不用页面路径判断扣减。
- 不把 `user_recent_words` 当作权益来源。
- 不把 `user_favorites` 当作权益来源。
- 不把订单支付状态和权益余额混在同一张表。
- 不只保存余额数字而没有流水。

## 11. 当前不做

本计划不创建 migration，不写 SQL，不修改业务代码，不修改 API，不修改小程序页面，不提交 git。
