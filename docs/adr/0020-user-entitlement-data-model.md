# ADR-0020: Phase 2.3 用户权益系统数据库模型设计

日期：2026-07-21

状态：Proposed

## 背景

Phase 2.1 已完成 `user_favorites`，负责账号收藏资产。

Phase 2.2 已完成 `user_recent_words`，负责最近学习列表。

Phase 2.3 已确定用户权益系统架构，核心规则包括：

- 注册赠送免费完整内容访问次数，例如 30 次。
- 注册赠送额度有效期暂定一年，但期限不能写死。
- 用户主动访问 root Learning Object 的完整内容时消耗权益。
- root Learning Object 内部 `decompose` 展开不重复消耗。
- `related` / `recommend` 跳转到新的 Learning Object 时重新判断权益。
- 月会员有效期内完整内容访问无限制，不消耗普通额度，不产生永久解锁。
- 会员过期后重新按照普通权益规则判断。
- 未来权益来源包括 `REGISTER_BONUS`、`SHARE_REWARD`、`ADMIN_GRANT`、`MEMBERSHIP`、`REFUND` 等。

本 ADR 只设计数据库模型，不创建 SQL，不新增 migration，不修改服务端、小程序或 API。

## 为什么不能直接在 `users` 表增加字段

不采用以下设计：

```text
users.free_count
users.vip_status
users.search_balance
users.full_content_balance
```

原因：

1. 权益来源会持续增加。

   当前已知来源包括注册赠送、分享奖励、管理员赠送、会员购买、活动奖励、退款恢复。未来还可能有兑换码、课程包、企业赠送、限时活动等。如果把余额和会员状态直接塞进 `users`，会让 `users` 从身份主表膨胀为商业状态表。

2. 需要可审计流水。

   用户询问“为什么少了一次”“为什么没收到赠送”“退款后为什么没恢复”时，单个余额字段无法解释原因。权益变化必须有时间、来源、操作人、关联订单、关联 Learning Object 和变化后余额。

3. 需要支持有效期和多来源消费。

   注册赠送一年有效，管理员赠送一年有效，分享奖励未来可能配置不同有效期。单个 `search_balance` 无法表达每一批额度的过期时间，也无法按 FIFO 消费即将过期的额度。

4. 需要和订单支付解耦。

   `users.vip_status` 无法表达订单状态、支付回调、退款、续费、补发、人工调整等完整生命周期。会员订单归订单系统，用户当前可访问资格归权益系统。

5. 需要避免永久解锁误导。

   当前规则不是“用户永久买断某个词条”，而是按当前权益访问完整内容。直接在 `users` 或解锁表里记录访问过的词条，会和会员过期后的重新判断规则冲突。

## 核心模型

推荐使用两个核心模型：

```text
entitlement_transactions  权益流水，事实来源
user_entitlements         当前权益快照，读取优化
```

流水是真实来源。快照是查询优化。任何权益增加、消耗、恢复、过期、会员开通或会员失效，都必须先能在流水中解释，再更新快照。

## `entitlement_transactions`

职责：

- 记录所有权益变化。
- 作为审计、余额重算、客服排查、后台查看和异常修复的事实来源。
- 支持多来源额度、过期时间、FIFO 消费和 Learning Object Access 追踪。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `transaction_id` | 全局唯一业务流水号 |
| `user_id` | `users.id` |
| `entitlement_type` | 权益类型，例如 `FULL_CONTENT_QUOTA`、`MEMBERSHIP` |
| `transaction_type` | 流水类型，例如 `REGISTER_BONUS`、`CONTENT_ACCESS`、`ADMIN_GRANT` |
| `amount` | 权益变化量；增加为正，消耗为负；会员状态型流水可为 0 |
| `balance_after` | 本次流水写入后的该权益余额快照 |
| `source` | 来源类型，例如 `registration`、`share`、`admin`、`order`、`refund` |
| `source_id` | 来源记录 id，例如订单 id、邀请 id、活动 id、后台操作 id |
| `expires_at` | 本笔增加额度的过期时间；消耗流水可为空 |
| `related_object_type` | 关联对象类型，例如 `learning_object`、`order`、`campaign` |
| `related_object_id` | 关联对象 id，例如 `apple` |
| `root_learning_object_id` | 本次主动进入的 root Learning Object |
| `current_learning_object_id` | 当前展示或访问的 Learning Object |
| `access_context_json` | `root/current/relation/access_reason` 等访问上下文 |
| `grant_transaction_id` | 消耗流水实际消耗的赠送/奖励来源流水 id，简单消费时可为空 |
| `idempotency_key` | 幂等键，防止重复发放或重复扣减 |
| `operator_type` | `system`、`admin`、`payment_callback` 等 |
| `operator_id` | 操作人或系统来源标识 |
| `reason` | 简短业务原因 |
| `metadata_json` | 白名单扩展信息，不存 token、手机号、openid 等敏感信息 |
| `occurred_at` | 业务发生时间 |
| `created_at` | 服务端写入时间 |

建议 `transaction_type`：

| 类型 | amount | 说明 |
| --- | --- | --- |
| `REGISTER_BONUS` | 正数 | 注册赠送，例如 +30 |
| `CONTENT_ACCESS` | 负数 | 主动访问 root Learning Object 完整内容，例如 -1 |
| `SHARE_REWARD` | 正数 | 分享邀请奖励 |
| `ADMIN_GRANT` | 正数 | 管理员人工赠送 |
| `ADMIN_ADJUSTMENT` | 正数或负数 | 管理员人工调整 |
| `CAMPAIGN_REWARD` | 正数 | 活动奖励 |
| `PURCHASE_GRANT` | 正数 | 购买额度包后发放 |
| `MEMBERSHIP_ACTIVATED` | 0 | 会员开通 |
| `MEMBERSHIP_EXPIRED` | 0 | 会员过期 |
| `REFUND_RESTORE` | 正数或负数 | 退款、异常处理或权益恢复 |
| `EXPIRE_DEDUCT` | 负数 | 额度到期失效记录 |

为什么所有增加和消耗都必须产生流水：

- 可以解释当前余额从哪里来、到哪里去。
- 可以支持后台按用户查看权益明细。
- 可以支持按订单、邀请、活动、管理员操作追踪来源。
- 可以在快照异常时从流水重算。
- 可以处理用户投诉、退款恢复和异常补偿。
- 可以支持未来风控、活动统计和财务对账。

示例：

注册赠送：

```text
transaction_type: REGISTER_BONUS
amount: +30
source: registration
expires_at: 注册时间 + 1 年
related_object_id: null
```

访问 `apple`：

```text
transaction_type: CONTENT_ACCESS
amount: -1
source: full_content_access
related_object_type: learning_object
related_object_id: apple
root_learning_object_id: apple
current_learning_object_id: apple
access_context_json: { relation_type: "self", access_reason: "search_enter" }
```

管理员赠送：

```text
transaction_type: ADMIN_GRANT
amount: +50
source: admin
expires_at: 赠送时间 + 1 年或后台配置时间
operator_type: admin
operator_id: <admin-id>
reason: 手动补偿
```

## `user_entitlements`

职责：

- 保存用户当前权益状态，服务端请求时快速读取。
- 避免每次完整内容访问都扫描全部流水。
- 与 `entitlement_transactions` 保持一致，但不是事实来源。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | `users.id` |
| `quota_balance` | 当前可用普通完整内容访问额度 |
| `quota_total_granted` | 历史累计发放额度，便于后台展示 |
| `quota_total_consumed` | 历史累计消耗额度，便于后台展示 |
| `quota_total_expired` | 历史累计过期额度，便于后台展示 |
| `membership_type` | 会员类型，例如 `monthly` |
| `membership_status` | `none`、`active`、`expired`、`cancelled` |
| `membership_started_at` | 当前会员开始时间 |
| `membership_expire_at` | 当前会员到期时间 |
| `last_transaction_id` | 最近一次影响快照的流水 id |
| `updated_at` | 更新时间 |
| `created_at` | 创建时间 |

说明：

- `quota_balance` 是读取优化，不能绕过流水直接修改。
- 任何快照变化都必须能追溯到 `entitlement_transactions`。
- 如果快照和流水不一致，以流水为准，并通过重算修复快照。
- 会员状态和普通额度共存在同一个快照中，便于完整内容访问时一次读取。

为什么需要快照：

- 完整内容访问是高频路径，不能每次都聚合全部历史流水。
- 后台查看用户当前权益需要快速响应。
- 会员有效性和普通额度余额通常需要一起判断。
- 快照可以降低读路径复杂度，但不能替代流水审计。

## 权益过期设计

所有额度型权益都应支持 `expires_at`。

示例：

- 注册赠送：默认一年有效。
- 管理员赠送：默认一年有效，也可由后台配置。
- 分享奖励：未来可按活动配置有效期。
- 活动奖励：由活动规则配置有效期。
- 购买额度包：由商品规则配置有效期。

设计原则：

- 不把有效期写死在代码或表结构里。
- 额度增加流水必须记录该批额度的 `expires_at`。
- 额度消费时只消费未过期额度。
- 额度过期时应产生 `EXPIRE_DEDUCT` 流水，而不是静默减少余额。
- 会员过期不等同于额度过期；会员到期由 `membership_expire_at` 判断，普通额度仍按各自 `expires_at` 判断。

## 多来源额度消费策略

如果用户同时拥有：

```text
注册赠送 30 次，一年有效
分享奖励 10 次，三个月有效
管理员赠送 50 次，一年有效
```

推荐消费策略：

```text
FIFO by expires_at
优先消耗最早过期的有效额度
```

原因：

- 对用户更公平，减少临近过期额度浪费。
- 规则简单，客服和后台容易解释。
- 能自然支持不同来源、不同有效期的额度。
- 不需要为每一种来源写特殊扣减规则。

消费记录要求：

- `CONTENT_ACCESS` 流水必须记录本次消耗的 root Learning Object。
- 如果一次消费只消耗一批额度，可以记录 `grant_transaction_id`。
- 如果未来一次消费可能跨多批额度，应在 `metadata_json.consumed_allocations` 中记录分摊明细，或进一步引入独立的额度批次快照表。

本阶段不强制引入独立批次表，但必须在设计上保留从流水追踪“消耗了哪一批额度”的能力。

## Learning Object + Access Context

权益判断必须基于 Learning Object + Access Context。

不使用：

- `word_id` 硬编码判断。
- `apple` / `pl` / `p` 这类特殊规则。
- 页面路径判断。
- 页面层级判断。
- `user_unlocked_words`。
- `word_unlock_records`。

推荐记录：

```text
root_learning_object_id
current_learning_object_id
relation_type
access_reason
```

扣减规则：

- `root_learning_object_id == current_learning_object_id` 且用户主动进入时，进行权益判断。
- root 内部 `decompose` 展开不额外扣减。
- `related` / `recommend` 跳转到新的 Learning Object 时，新对象成为新的 root，重新判断权益。
- 会员有效时允许访问，不扣普通额度，也不产生永久解锁。

## 与订单系统边界

`orders` / `payments` 负责：

- 微信支付。
- 商品购买。
- 会员订单状态。
- 支付回调。
- 退款回调。
- 支付金额、交易号和订单生命周期。

`entitlement` 负责：

- 用户拥有什么权益。
- 用户消耗多少权益。
- 用户是否能访问完整内容。
- 权益发放、消耗、过期和恢复流水。

边界原则：

- 支付成功不等于直接改用户余额，必须通过权益流水发放权益。
- 订单退款不等于直接删会员或改余额，必须通过权益流水记录恢复、扣回或调整。
- 订单表不判断用户能否访问完整内容。
- 权益表不保存支付网关细节。

推荐支付到权益流程：

```text
支付成功回调
  -> orders/payments 校验并记录支付状态
  -> entitlement_transactions 写 PURCHASE_GRANT 或 MEMBERSHIP_ACTIVATED
  -> user_entitlements 更新快照
```

## 后果

正向影响：

- 当前余额可以快速读取。
- 所有权益变化可追溯、可重算、可解释。
- 支持注册赠送、分享奖励、管理员赠送、会员、退款等多来源。
- 支持不同来源额度的有效期。
- 支持按 Learning Object Access 扣减，而不是页面访问或永久解锁。
- 为未来后台权益管理、订单支付、会员续费、客服排查留下稳定基础。

成本：

- 实现时需要事务保证流水和快照一致。
- 消费 FIFO 比单个余额字段复杂。
- 后台需要同时展示快照和流水。
- 需要设计幂等键，避免网络重试导致重复扣减或重复发放。

## 当前不做

本 ADR 不创建 SQL，不新增 migration，不修改 `server/**`、`database/**`、`miniapp-uni/**`、API 或 `package.json`。
