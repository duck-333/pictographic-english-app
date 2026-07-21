# Phase 2.3 用户权益系统规划

日期：2026-07-21

状态：Planning

## 1. 定义

Phase 2.3 用户权益系统，是在用户登录、token 鉴权、收藏云端化、最近学习云端化和生产 `JWT_SECRET` 保护完成之后，为商业化能力建立的账号级权益基础。

本阶段规划的核心问题是：

```text
用户是否有资格查看完整词条内容？
如果需要消耗额度，应该如何扣减、记录和审计？
如果用户获得奖励、购买会员或后台赠送，应该如何入账？
```

当前产品设想：

- 新用户注册后获得免费完整查词额度，例如 30 次。
- 用户查看完整词条内容时消耗额度。
- 完整内容包括象形拆解、视频讲解、示意图和专属内容。
- 额度耗尽后，用户可以购买会员、分享邀请获得额度，或参加活动获得额度。
- 后台未来需要查看当前权益、额度消耗记录、管理员赠送记录和活动奖励记录。

## 2. 目标

Phase 2.3 用户权益系统的目标：

- 建立账号级可信权益模型。
- 支持免费查词额度、会员权益、活动赠送额度。
- 支持完整词条访问前的服务端权益判断。
- 支持权益增加、消耗、恢复和人工调整的完整流水。
- 为后续订单支付、邀请奖励、后台管理提供清晰边界。

本阶段不是直接开发任务。本文件只规划数据模型和开发顺序，不创建 migration，不修改 server，不修改小程序，不修改 API。

## 3. 当前不应复用的数据

### `pictographic:userState.searchCount`

不能用作权益余额或消耗次数。

原因：

- 它是本机 storage，不是账号数据。
- 不能跨设备同步。
- 不能防篡改。
- 不能解释每一次增加或扣减的业务原因。
- 不能给后台、支付、退款和客服排查使用。

### `user_recent_words`

不能用作完整查词次数或权益扣减依据。

原因：

- 它只表示最近查看列表。
- 同一用户同一单词只保留一行，重复查看会覆盖 `viewed_at`。
- 它不区分免费预览和完整内容访问。
- 它不记录会员免扣、活动奖励、后台赠送或退款恢复。

### `user_favorites`

不能用作会员权益、学习进度或完整访问资格。

原因：

- 收藏是用户主动保存的资产。
- 收藏不代表用户已消费完整内容。
- 取消收藏不应恢复额度。
- 收藏状态不等于付费权益。

## 4. 推荐数据模型

以下模型只做规划，不在本阶段创建数据库表。

## 4.1 `user_entitlements`

职责：

- 记录用户当前拥有的权益状态。
- 作为服务端快速判断用户是否可访问完整内容的状态快照。
- 与 `entitlement_transactions` 配合使用；它不是唯一事实来源。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `user_id` | `users.id` |
| `entitlement_type` | 权益类型，例如 `full_word_quota`、`membership` |
| `quota_total` | 当前累计可用额度总量，适用于次数型权益 |
| `quota_used` | 当前已使用额度，适用于次数型权益 |
| `quota_remaining` | 当前剩余额度，可由 `quota_total - quota_used` 维护或查询计算 |
| `membership_plan` | 会员计划，例如 `monthly`、`annual`，非会员为空 |
| `membership_status` | `none`、`active`、`expired`、`cancelled` |
| `valid_from` | 权益生效时间 |
| `valid_until` | 权益失效时间，永久或次数型可为空 |
| `source` | 当前权益主要来源，例如 `registration_grant`、`purchase`、`campaign` |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

建议约束和索引：

- `user_id + entitlement_type` 唯一，便于快速读取某类当前权益。
- `user_id + membership_status` 索引，便于后台筛选会员用户。
- `valid_until` 索引，便于后续处理会员过期。

设计说明：

- `user_entitlements` 是当前状态快照，用于快速读。
- 不建议只在 `users` 表加 `balance` 字段，因为用户权益会包含免费额度、会员、活动奖励、后台赠送、退款恢复等多个来源和类型。
- 如果未来权益类型增多，可以把次数型额度、会员权益、活动权益按 `entitlement_type` 分行保存。

## 4.2 `entitlement_transactions`

职责：

- 记录所有权益变化流水。
- 作为权益审计、余额重算、客服排查、后台查看和异常恢复的事实来源。
- 每一次增加、消耗、恢复和人工调整都必须写入流水。

建议字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `transaction_id` | 全局唯一业务流水号 |
| `user_id` | `users.id` |
| `entitlement_type` | 权益类型，例如 `full_word_quota`、`membership` |
| `transaction_type` | 流水类型 |
| `delta` | 权益变化量，增加为正，消耗为负 |
| `balance_after` | 本次变化后的余额快照，便于审计 |
| `related_word_id` | 相关单词 id，查词消耗时使用 |
| `related_order_id` | 相关订单 id，购买或退款时使用 |
| `related_invite_id` | 相关邀请记录 id，分享奖励时使用 |
| `campaign_id` | 活动 id，活动奖励时使用 |
| `admin_id` | 管理员 id 或操作人标识，后台赠送时使用 |
| `idempotency_key` | 幂等键，防止重复扣减或重复发放 |
| `reason` | 简短原因说明 |
| `metadata_json` | 少量白名单扩展信息 |
| `occurred_at` | 业务发生时间 |
| `created_at` | 服务端写入时间 |

建议 `transaction_type`：

| 类型 | 含义 |
| --- | --- |
| `registration_grant` | 注册赠送，例如 +30 |
| `full_word_view_consumed` | 查看完整词条消耗，例如 -1 |
| `invite_reward` | 分享邀请奖励，例如 +5 |
| `campaign_reward` | 活动奖励 |
| `admin_grant` | 管理员人工赠送 |
| `admin_adjustment` | 管理员人工调整 |
| `purchase_grant` | 购买后发放权益 |
| `refund_restore` | 退款或异常处理恢复额度 |
| `expire_deduct` | 权益过期扣除或失效记录 |
| `membership_activated` | 会员开通 |
| `membership_expired` | 会员过期 |

建议约束和索引：

- `transaction_id` 唯一。
- `idempotency_key` 唯一或按业务域唯一。
- `user_id + created_at` 索引，用于后台查看用户流水。
- `user_id + entitlement_type + created_at` 索引，用于某类权益流水查询。
- `related_order_id` 索引，用于支付和退款排查。

设计说明：

- 权益余额不能只存一个数字，必须保留流水。
- `balance_after` 不是唯一事实来源，但能显著降低客服和后台排查成本。
- 扣减额度时，应在服务端数据库事务中完成“判断可用 -> 写流水 -> 更新当前状态”。
- 小程序网络重试时必须依赖 `idempotency_key` 防止重复扣减。

## 4.3 `orders` / `payments`

职责边界：

订单支付系统负责：

- 微信支付下单。
- 商品购买。
- 会员订单。
- 支付回调。
- 退款回调。
- 订单状态。

权益系统负责：

- 用户获得什么权益。
- 用户消耗什么权益。
- 当前是否允许访问完整内容。
- 权益变化是否可审计。

二者不能混在一起。

建议未来 `orders` 字段方向：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `order_no` | 订单号 |
| `user_id` | `users.id` |
| `product_type` | 商品类型，例如 `membership`、`quota_pack` |
| `product_id` | 商品 id |
| `amount_cents` | 金额，单位分 |
| `currency` | 币种 |
| `status` | `pending`、`paid`、`closed`、`refunded` |
| `created_at` / `updated_at` | 时间 |

建议未来 `payments` 字段方向：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增主键 |
| `payment_no` | 支付流水号 |
| `order_id` | 订单 id |
| `provider` | `wechat_pay` 等 |
| `provider_trade_no` | 微信支付交易号 |
| `amount_cents` | 支付金额 |
| `status` | 支付状态 |
| `paid_at` | 支付完成时间 |
| `callback_payload_hash` | 回调内容摘要，避免存敏感大字段 |
| `created_at` / `updated_at` | 时间 |

支付到权益的推荐流程：

```text
支付成功回调
  -> 校验订单和支付状态
  -> 标记订单 paid
  -> 写 entitlement_transactions
  -> 更新 user_entitlements
```

订单系统不直接承担“当前是否能看完整词条”的判断；权益系统不直接承担支付网关状态。

## 5. 典型业务流程

### 新用户注册赠送 30 次完整查词额度

```text
用户首次创建
  -> 服务端初始化 full_word_quota
  -> entitlement_transactions: registration_grant +30
  -> user_entitlements: quota_total +30, quota_remaining 30
```

注意：

- 赠送必须服务端执行。
- 不使用本地 `searchCount`。
- 需要幂等，避免同一用户重复初始化多次。

### 查看完整词条消耗 1 次额度

```text
小程序请求完整词条
  -> requireUserAuth()
  -> 查询会员状态
  -> 如果会员有效，允许访问，可不扣次数
  -> 如果非会员，检查 full_word_quota 剩余
  -> 剩余充足：写消耗流水并扣减
  -> 剩余不足：返回权益不足
```

注意：

- 权益判断必须在服务端。
- 扣减必须原子化。
- 同一次完整词条访问是否重复扣减，需要产品策略单独确定。例如同一用户同一单词当天只扣一次，或每次打开完整内容都扣一次。

### 分享邀请奖励

```text
邀请关系确认有效
  -> entitlement_transactions: invite_reward +N
  -> user_entitlements 增加对应额度
```

注意：

- 邀请奖励需要单独的邀请记录或活动记录支撑。
- 防刷策略不应写进权益余额表，应由邀请/活动模块判定后再发放权益。

### 管理员人工赠送

```text
管理员后台操作
  -> 校验管理员权限
  -> entitlement_transactions: admin_grant +N
  -> user_entitlements 增加对应额度
```

注意：

- 必须记录操作人、原因和时间。
- 不允许直接手改 `user_entitlements` 而不写流水。

### 退款恢复或扣回

```text
退款回调或客服处理
  -> 校验订单状态
  -> entitlement_transactions: refund_restore 或 admin_adjustment
  -> 更新 user_entitlements
```

注意：

- 退款和权益恢复不一定是简单反向操作。
- 如果用户已经消耗购买权益，需要产品策略决定是否允许退款、是否扣回剩余额度或冻结账号权益。

## 6. MVP 与未来扩展边界

### MVP 必须明确

- 权益只属于登录用户。
- 权益判断只由服务端完成。
- 小程序不传 `user_id`。
- 小程序不自行扣减或计算剩余额度。
- 余额变化必须写 `entitlement_transactions`。
- `user_entitlements` 只作为当前状态快照。
- 免费额度和会员权益需要统一判定入口。

### MVP 可以先不做

- 微信支付。
- 真实会员购买。
- 邀请奖励。
- 活动任务系统。
- 后台复杂筛选。
- 退款自动化。
- 风控防刷系统。

### 未来扩展

- `quota_packages`：额度包商品定义。
- `membership_plans`：会员计划定义。
- `invite_rewards`：邀请关系和奖励发放记录。
- `campaign_rewards`：活动奖励规则和发放记录。
- `admin_entitlement_operations`：后台操作审计增强。
- `entitlement_locks`：处理并发扣减或长事务场景。

## 7. 与学习数据系统的关系

学习数据系统可以记录：

- 用户搜索了什么。
- 用户打开了哪个单词。
- 用户观看了哪个视频。
- 用户学习了多少天。
- 用户掌握了哪些词。

权益系统可以记录：

- 用户是否能看完整词条。
- 用户剩余多少完整查词额度。
- 用户是否是有效会员。
- 用户为什么获得或消耗权益。

二者可以在服务端同一次请求中同时发生，但必须写入不同模块：

```text
查看完整词条
  -> 权益系统：判断并扣减额度
  -> 学习数据系统：记录 word_detail_viewed 或 full_content_viewed
  -> 最近学习系统：更新 user_recent_words
```

不能把任一模块的数据当作另一个模块的事实来源。

## 8. 建议开发顺序

### Phase 2.3-E1：权益架构落地准备

- 审核本 ADR 和计划文档。
- 确定完整词条的产品定义。
- 确定注册赠送次数，例如 30 次。
- 确定扣减策略：每次完整查看扣一次，还是同一单词某时间窗口内只扣一次。
- 确定会员是否不限次数，以及会员期内是否保留免费额度。

### Phase 2.3-E2：基础权益表和服务端 Store

- 新增 `user_entitlements` migration。
- 新增 `entitlement_transactions` migration。
- 新增服务端 store，所有写入使用 `requireUserAuth()` 派生的 `user_id`。
- 实现注册赠送初始化幂等逻辑。

### Phase 2.3-E3：完整词条访问判定 API

- 设计完整词条访问接口。
- 服务端判断是否会员或有额度。
- 原子写入消耗流水并更新当前状态。
- 返回完整内容或权益不足状态。

### Phase 2.3-E4：小程序接入最小闭环

- 小程序只请求服务端完整内容。
- 小程序展示服务端返回的剩余额度或权益不足提示。
- 小程序不自行扣减额度。

### Phase 2.3-E5：后台查看和人工赠送

- 后台查看用户当前权益。
- 后台查看权益流水。
- 后台人工赠送额度，必须写流水。

### Phase 2.3-E6：订单支付和会员

- 新增订单和支付模块。
- 接入微信支付。
- 支付成功后通过权益系统发放会员或额度。
- 支付和权益保持模块边界。

## 9. 明确禁止事项

- 不使用 `pictographic:userState.searchCount` 作为权益余额。
- 不使用 `pictographic:userState.streakDays` 作为活动奖励可信依据。
- 不使用 `user_recent_words` 作为查词扣减来源。
- 不使用 `user_favorites` 表示完整内容访问资格。
- 不在 `users` 表直接增加一个 `balance` 字段承载所有权益。
- 不让小程序传入 `user_id`。
- 不让小程序本地自行判断会员或剩余额度。
- 不只更新 `user_entitlements` 而不写 `entitlement_transactions`。
- 不把订单支付状态和权益余额混在同一张表里。

## 10. 验收方向

未来真正开发时，最小验收应包括：

- 新用户只获得一次注册赠送额度。
- 登录用户完整查看词条时由服务端扣减。
- 额度不足时服务端拒绝完整内容访问。
- 会员有效时按产品策略允许访问。
- 每一次额度变化都有流水。
- 幂等键可以防止小程序重试导致重复扣减。
- 多账号数据隔离。
- 后台能根据流水解释当前余额。
