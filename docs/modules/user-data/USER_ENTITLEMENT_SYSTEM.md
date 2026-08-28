# 用户权益系统设计文档

日期：2026-07-24

## 1. 系统定位

用户权益系统用于管理账号级完整内容访问资格，解决“用户是否可以查看完整学习内容、查看后是否需要扣减次数、后台如何人工调整额度”等问题。

当前系统已经覆盖：

- 新用户注册后自动获得体验查词额度。
- 登录用户主动打开完整单词详情时扣减额度。
- 用户在“我的”页面查询当前权益。
- 管理员在后台搜索用户、查看余额、增加额度、扣除额度和查看流水。

后续可继续扩展：

- 微信支付购买会员或查词额度。
- 购买课程后发放对应权益。
- 活动赠送、分享奖励、兑换码兑换。
- 淘宝购书赠会员。
- 客服人工补偿和异常修正。

## 2. 当前系统架构

当前权益系统建立在 `users.id` 之上：

```text
用户账号
  ↓
users
  ↓
user_entitlements
  ↓
entitlement_transactions
```

职责划分：

- `users`：用户身份主表，提供账号基础身份。
- `user_entitlements`：用户当前权益快照，用于快速读取当前余额、累计获得、累计消耗和会员状态。
- `entitlement_transactions`：用户权益事实流水，用于审计、追踪和解释每一次权益变化。

核心原则：

- 日常查询读取 `user_entitlements`，避免每次扫描完整流水。
- 真实事实来源是 `entitlement_transactions`。
- 所有发放、扣减、过期、后台调整都必须写流水，并在同一事务中更新快照。

## 3. 数据库设计

### users

用途：

- 保存项目用户基础身份。
- `users.id` 是权益系统的账号身份主键。

相关绑定表：

- `wechat_user_bindings`：微信身份绑定。
- `user_phone_bindings`：手机号绑定和手机号脱敏/哈希查询。

权益系统不接受前端传入 `user_id` 判断普通用户身份，用户侧接口必须通过 `Authorization: Bearer <token>` 解析出 `authResult.userId`。

### user_entitlements

用途：

保存用户当前权益快照。该表用于快速查询，不是权益事实来源。

主要字段：

| 字段 | 作用 |
|---|---|
| `id` | 快照行主键。 |
| `user_id` | 对应 `users.id`，一个用户只有一条快照。 |
| `quota_balance` | 当前可用完整内容访问次数。 |
| `quota_total_granted` | 累计获得额度，包括注册赠送、后台赠送、未来分享奖励等。 |
| `quota_total_consumed` | 累计消耗额度，当前主要来自 `CONTENT_ACCESS`。 |
| `quota_total_expired` | 累计过期额度。 |
| `membership_type` | 当前会员类型，MVP 默认为 `none`，未来可扩展 `monthly` 等。 |
| `membership_status` | 当前会员状态，MVP 默认为 `none`，未来可扩展 `active`、`expired`、`cancelled`。 |
| `membership_started_at` | 当前会员开始时间。 |
| `membership_expire_at` | 当前会员到期时间。 |
| `last_transaction_id` | 最近一次影响快照的 `entitlement_transactions.id`。 |
| `created_at` | 快照创建时间。 |
| `updated_at` | 快照更新时间。 |

约束和索引：

- `UNIQUE KEY uk_user_entitlements_user_id (user_id)` 保证一个用户只有一条权益快照。
- 会员状态和到期时间有组合索引，便于未来查询会员状态。

### entitlement_transactions

用途：

保存权益变化事实流水。流水应按追加方式处理，不作为普通业务的可变状态字段使用。

主要字段：

| 字段 | 作用 |
|---|---|
| `id` | 流水行主键。 |
| `transaction_id` | 业务流水 ID，用于外部引用和审计。 |
| `user_id` | 对应 `users.id`。 |
| `transaction_type` | 流水类型。 |
| `amount` | 权益变化数量，正数表示发放，负数表示扣减，0 可用于会员类状态变化。 |
| `balance_after` | 本次流水发生后的额度余额。 |
| `source` | 来源类别，例如 `registration`、`full_content_access`、`admin_portal`。 |
| `source_id` | 来源记录 ID，例如单词 ID、订单 ID、活动 ID 或后台操作 ID。 |
| `expires_at` | 额度型权益的过期时间。 |
| `grant_transaction_id` | 消费或扣除时对应的额度来源流水。 |
| `root_learning_object_id` | 主动进入的 root Learning Object。 |
| `current_learning_object_id` | 当前访问或展开的 Learning Object。 |
| `access_context_json` | 内容访问上下文，例如入口、root/current、幂等来源。 |
| `idempotency_key` | 幂等键，防止重复发放、重复扣减和重复回调处理。 |
| `operator_type` | 操作来源类型，例如 `system`、`admin`、`payment_callback`。 |
| `operator_id` | 操作者标识，例如后台管理员 ID 或系统任务 ID。 |
| `reason` | 人类可读的操作原因或后台备注。 |
| `metadata_json` | 白名单扩展元数据，不存储 token、openid、手机号明文等敏感信息。 |
| `created_at` | 流水创建时间。 |

当前已实际使用或可由现有服务产生的流水类型：

- `REGISTER_BONUS`：注册赠送 30 次完整内容访问额度。
- `CONTENT_ACCESS`：用户访问完整内容扣减额度。
- `ADMIN_GRANT`：管理员增加额度。
- `ADMIN_DEDUCT`：管理员扣除额度。
- `EXPIRE_DEDUCT`：额度来源过期后由服务层生成过期扣减。

当前已在模型中预留的类型：

- `SHARE_REWARD`
- `TAOBAO_BOOK_MEMBERSHIP_GRANT`
- `MEMBERSHIP_ACTIVATED`
- `REFUND_RESTORE`

未来可继续规划的类型：

- `PURCHASE`
- `MEMBERSHIP_RENEW`
- `ACTIVITY_REWARD`
- `REDEEM_CODE_GRANT`

## 4. 后端接口说明

### 用户侧：GET /api/user/entitlements

作用：

- 查询当前登录用户的权益快照。
- 当 `users` 存在但快照不存在时，服务端会通过注册赠送初始化能力补齐权益账户。

权限要求：

- 必须携带 `Authorization: Bearer <token>`。
- 服务端通过 `requireUserAuth()` 获取 `authResult.userId`。
- 不接受 query/body 中的 `user_id`。

返回内容：

```json
{
  "ok": true,
  "quotaBalance": 30,
  "quotaTotalGranted": 30,
  "quotaTotalConsumed": 0,
  "membershipType": "none",
  "membershipStatus": "none",
  "membershipExpireAt": null
}
```

错误：

- `401`：未登录或 token 无效。
- `500`：服务端或数据库异常，接口不应泄露 SQL 细节。

### 内容访问：GET /api/words/:id

作用：

- 查询已发布单词详情。
- 未携带登录态时保持原有体验，返回词条且不扣次数。
- 携带有效用户 token 时，视为完整内容访问入口，调用 `consumeQuota()` 扣减 1 次。

处理顺序：

```text
查询词条
  ↓
词条不存在返回 404，不扣权益
  ↓
无 Authorization：返回词条，不扣权益
  ↓
有 Authorization：requireUserAuth()
  ↓
ensureRegistrationBonus()
  ↓
consumeQuota()
  ↓
额度足够：写 CONTENT_ACCESS，返回词条和 remainingQuota
  ↓
额度不足：返回 QUOTA_INSUFFICIENT
```

幂等：

- 小程序详情页应传 `x-client-request-id`。
- 服务端生成幂等键：`content_access:${userId}:${wordId}:${clientRequestId}`。
- 缺少 `clientRequestId` 时服务端使用按分钟分桶的 fallback，并记录日志。

### 后台：GET /api/admin/entitlements/users?q=

作用：

- 管理员搜索用户。
- 当前支持 `user_id` 搜索，并保留手机号 hash 搜索能力。

权限要求：

- 必须使用 `Authorization: Bearer <ADMIN_API_TOKEN>`。
- 必须通过 `requireAdminAuth()`。

返回内容：

```json
{
  "ok": true,
  "count": 1,
  "users": [
    {
      "id": "4",
      "phoneMasked": "138****0000",
      "status": "active",
      "createdAt": "2026-07-23 12:00:00",
      "hasWechatBinding": true,
      "hasPhoneBinding": true
    }
  ]
}
```

不返回：

- openid
- session_key
- token
- 手机号明文

### 后台：GET /api/admin/entitlements/users/:userId

作用：

- 查询指定用户的基础信息和权益快照。
- 若快照不存在，会复用注册赠送初始化能力补齐。

权限要求：

- Admin API Token。

返回内容：

```json
{
  "ok": true,
  "user": {
    "id": "4",
    "phoneMasked": "138****0000",
    "status": "active",
    "createdAt": "2026-07-23 12:00:00",
    "hasWechatBinding": true,
    "hasPhoneBinding": true
  },
  "entitlement": {
    "quotaBalance": 30,
    "quotaTotalGranted": 30,
    "quotaTotalConsumed": 0,
    "quotaTotalExpired": 0,
    "membershipType": "none",
    "membershipStatus": "none",
    "membershipExpireAt": null
  }
}
```

### 后台：GET /api/admin/entitlements/users/:userId/transactions

作用：

- 查询指定用户权益流水。
- 支持分页和类型筛选。

查询参数：

| 参数 | 作用 |
|---|---|
| `limit` | 每页数量，服务端最大限制为 100。 |
| `offset` | 偏移量。 |
| `type` | 按 `transaction_type` 筛选。 |

返回内容：

```json
{
  "ok": true,
  "count": 20,
  "transactions": [
    {
      "id": "34",
      "transactionId": "ent_...",
      "userId": "4",
      "transactionType": "CONTENT_ACCESS",
      "amount": -1,
      "balanceAfter": 29,
      "source": "full_content_access",
      "sourceId": "apple",
      "operatorType": "system",
      "operatorId": "word-detail-api",
      "reason": null,
      "createdAt": "2026-07-24 10:00:00"
    }
  ]
}
```

### 后台：POST /api/admin/entitlements/users/:userId/grant

作用：

- 管理员给用户增加额度。
- 服务端调用 `grantQuota()`，写入 `ADMIN_GRANT` 流水并更新快照。

请求示例：

```json
{
  "amount": 50,
  "reason": "测试账号补充额度",
  "source": "admin_portal",
  "operatorType": "admin"
}
```

返回内容：

```json
{
  "ok": true,
  "transaction": {
    "transactionType": "ADMIN_GRANT",
    "amount": 50,
    "balanceAfter": 80
  },
  "entitlement": {
    "quotaBalance": 80,
    "quotaTotalGranted": 80
  }
}
```

要求：

- `amount` 必须是正整数。
- `reason` 必填。
- 必须记录 `operator_type`、`operator_id` 和 `reason`。
- 不允许绕过流水直接改余额。

### 后台：POST /api/admin/entitlements/users/:userId/deduct

作用：

- 管理员扣除用户额度。
- 服务端调用 `deductQuota()`，写入 `ADMIN_DEDUCT` 流水并更新快照。

请求示例：

```json
{
  "amount": 10,
  "reason": "测试账号扣除额度",
  "source": "admin_portal",
  "operatorType": "admin"
}
```

要求：

- `amount` 必须是正整数。
- `reason` 必填。
- 不允许扣成负数。
- 使用 FIFO by `expires_at` 分配额度来源。

## 5. 当前后台功能

后台项目路径：

```text
admin-portal/pictographic-admin
```

当前已经支持：

- 后台使用 Admin API Token 登录。
- 与 workbench、dashboard 同级的“用户权益管理”模块。
- 通过手机号或 `user_id` 搜索用户。
- 查看用户基本信息。
- 查看当前剩余查词次数。
- 查看累计获得次数。
- 查看累计消耗次数。
- 查看会员状态。
- 管理员手动增加额度。
- 管理员手动扣除额度。
- 填写操作原因。
- 查看最近 5 条权益流水。
- 进入独立权益流水详情页。
- 完整流水分页展示。
- 按交易类型筛选流水的预留区域。

后台前端调用封装位于：

```text
admin-portal/pictographic-admin/common/api-client.js
```

主要页面：

```text
admin-portal/pictographic-admin/pages/index/index.vue
admin-portal/pictographic-admin/pages/entitlement-transactions/index.vue
```

## 6. 权益变化流程

### 用户查看完整内容

```text
用户打开单词详情
  ↓
服务端先检查词条是否存在
  ↓
未登录：返回词条，不扣次数
  ↓
已登录：验证 Authorization token
  ↓
ensureRegistrationBonus()
  ↓
consumeQuota()
  ↓
会员有效：允许访问，不扣普通额度
  ↓
普通用户额度足够：写 CONTENT_ACCESS 流水
  ↓
更新 user_entitlements.quota_balance 和 quota_total_consumed
  ↓
返回词条和 remainingQuota
```

当前规则：

- `GET /api/words?q=` 搜索列表不扣费。
- 只有完整单词详情访问进入扣减链路。
- 前端通过 `clientRequestId` 防止同一次详情页请求重复扣减。

### 管理员赠送额度

```text
后台提交增加额度
  ↓
requireAdminAuth()
  ↓
校验用户存在
  ↓
grantQuota()
  ↓
写 ADMIN_GRANT 流水
  ↓
更新 user_entitlements.quota_balance 和 quota_total_granted
  ↓
返回最新快照
```

### 管理员扣除额度

```text
后台提交扣除额度
  ↓
requireAdminAuth()
  ↓
校验用户存在
  ↓
deductQuota()
  ↓
检查余额和可用额度来源
  ↓
按 expires_at FIFO 分配扣除来源
  ↓
写 ADMIN_DEDUCT 流水
  ↓
更新 user_entitlements.quota_balance
  ↓
返回最新快照
```

### 注册赠送额度

```text
微信登录或微信手机号登录成功
  ↓
服务端获得 users.id
  ↓
ensureRegistrationBonus()
  ↓
幂等键 registration_bonus:{userId}
  ↓
首次执行写 REGISTER_BONUS +30
  ↓
初始化或更新 user_entitlements
```

注册赠送当前默认：

- 额度：30 次。
- 有效期：1 年。
- 来源：`registration`。
- 操作者：`system/auth-registration`。

## 7. 当前完成状态

已完成：

| 功能 | 状态 |
|---|---|
| 数据库结构 | ✅ 完成 |
| 权益快照 `user_entitlements` | ✅ 完成 |
| 权益流水 `entitlement_transactions` | ✅ 完成 |
| 注册赠送 30 次额度 | ✅ 完成 |
| 用户权益查询接口 | ✅ 完成 |
| 内容访问扣减 `CONTENT_ACCESS` | ✅ 完成 |
| 后台用户搜索 | ✅ 完成 |
| 后台查询权益余额 | ✅ 完成 |
| 后台增加额度 `ADMIN_GRANT` | ✅ 完成 |
| 后台扣除额度 `ADMIN_DEDUCT` | ✅ 完成 |
| 后台最近流水 | ✅ 完成 |
| 后台完整流水详情页面 | ✅ 完成 |
| 后台流水分页 | ✅ 完成 |
| 会员 grant、固定 30 天排期与顺序叠加 | ✅ 完成 |
| 有效会员访问完整内容免扣额度 | ✅ 完成 |
| 后台赠送固定 30 天会员 | ✅ 完成 |
| 购书福利码签发与兑换 30 天会员 | ✅ 完成 |

未完成：

| 功能 | 状态 |
|---|---|
| 注册赠送规则配置化和老用户补发策略 | ⬜ 未完成 |
| 微信支付订单 | ⬜ 未完成 |
| 会员购买 | ⬜ 未完成 |
| 自动续费 | ⬜ 第一版不开发 |
| 活动奖励 | ⬜ 未完成 |
| 分享邀请关系、资格判断与自动奖励 | ⬜ 未完成 |
| 订单查询、支付状态同步与退款联动 | ⬜ 未完成 |
| 权益异常监控和快照重算工具 | ⬜ 未完成 |

## 8. 设计原则

- 所有权益变化必须产生 `entitlement_transactions` 流水。
- 不直接修改 `quota_balance` 而绕过流水。
- `user_entitlements` 是当前状态快照。
- `entitlement_transactions` 是历史事实记录。
- 管理员操作必须记录 `operator_type`、`operator_id` 和 `reason`。
- 用户侧接口只能根据 token 解析当前用户身份，不能接受前端传入 `user_id`。
- 小程序不能自行判断剩余额度、扣减次数或会员状态。
- `pictographic:userState.searchCount` 不能作为账号权益依据。
- `user_recent_words` 只表示最近学习列表，不参与权益判断。
- `user_favorites` 只表示收藏资产，不参与权益判断。
- 不设计永久解锁表，会员过期后重新按普通权益规则判断。

## 9. 后续扩展建议

### 注册

当前 `REGISTER_BONUS` 已实现基础发放。后续建议：

- 将默认 30 次和 1 年有效期配置化。
- 明确老用户是否补发。
- 增加注册赠送异常监控。

### 购买

第一版购买规则已经锁定，但订单、支付和购买页面尚未实现：

- 商品暂定 30 元，单次购买固定 `30 × 24` 小时，不做自动连续包月。
- 允许多次购买，按照现有会员 grant 排期顺序叠加。
- 购买入口位于未来统一“获取学习权益”页，并进入独立购买确认页。
- 商品价格、时长和订单金额由 server 确定，不能信任客户端。
- 一次性会员采用虚拟支付道具直购，`wx.requestVirtualPayment` 使用 `mode=short_series_goods`；不使用普通微信 JSAPI `wx.requestPayment`、代币充值或自动续费订阅。
- Android、鸿蒙、Windows 先使用普通虚拟支付沙箱；iOS 仍走道具直购并由官方接口进入 Apple 支付，但 Apple 支付不支持沙箱，需留到受控现网阶段。

支付完成后不应直接修改 `user_entitlements`。目标流程：

```text
支付平台服务端通知或主动查单确认成功
  ↓
支付回调幂等校验
  ↓
orders/payments 记录支付事实并幂等调用会员发放
  ↓
更新 user_entitlements
```

### 会员

当前数据库和服务层已经实现会员字段、固定 30 天会员 grant、排期叠加和会员访问免扣。后续接入购买时：

- 会员有效期间完整内容访问不扣普通额度。
- 会员到期不删除历史流水。
- 多次购买或赠送会员应顺延，不缩短已有有效期。
- 支付订单应使用稳定来源 ID 关联对应会员 grant、流水和快照。
- 后台不能人工把订单改为支付成功；补单只能在支付平台查单成功后执行。
- 超时未支付订单由 server 自动关闭。

### 活动

活动奖励可通过权益流水类型实现，例如：

- `ACTIVITY_REWARD`
- `SHARE_REWARD`
- `REDEEM_CODE_GRANT`

活动系统负责校验活动资格和防刷，权益系统负责发放和审计。

第一版分享拉新规则已经锁定但尚未实现：有效新人必须从 7 天内有效邀请进入并通过手机号快捷登录最终创建新的 `users`；注册前采用最后一次有效邀请，注册后永久锁定；邀请者获得一年有效的 `SHARE_REWARD +30`，累计最多 5 次。新人继续使用现有一年有效的 `REGISTER_BONUS +30`。

### 后台

后台已有固定赠送 30 天会员和购书福利码管理能力。后续可扩展：

- 订单查询、支付状态同步和权益发放结果查询。
- 查询用户权益异常。
- 导出用户权益流水。
- 按时间范围、来源、交易类型组合筛选。
- 通过补偿流水修正异常，不直接改快照。

## 10. 2026-08-28 已锁定后续规则与外部确认项

完整产品规则以 `docs/CONTENT_ACCESS_POLICY.md` 的 F、J 节为准。本节仅记录实现状态和开发门槛。

尚未实现的页面包括统一“获取学习权益”页、邀请规则页和会员购买确认页。“我的”页未来增加“获取学习权益”常驻入口；详情页额度不足按钮进入该统一页面。页面中会员购买为主入口，邀请好友得 30 次为次入口。

30 天会员属于数字虚拟权益。虚拟支付订单需要区分环境、渠道和平台，并关联平台订单、支付、发货、退款和会员 grant 发放结果；当前这些订单能力均尚未实现。

产品负责人于 2026-08-28 通过微信后台确认：虚拟支付已开通，AppID 与商户号已绑定，OfferID 已生成，沙箱和现网 AppKey 已生成，苹果 IAP 支付显示已开通，Android/鸿蒙/Windows 当前费率显示为 1%，iOS 当前费率显示为 12%。代码审查没有登录后台独立验证；费率属于时效性政策，不得硬编码为永久规则。

开发或现网开放前仍待确认：30 天会员商品配置、审核及沙箱/现网发布状态，支付和退款消息推送，小程序简称，当前服务类目，数字学习会员销售资格，iOS 现网可用性，以及相关运营合规要求。

当前虚拟支付核心鉴权依赖小程序 `access_token`、虚拟支付 AppKey、`session_key` 用户态签名和相关消息推送，不以普通微信支付商户 API v3 直连为默认核心依赖。未来接入其他渠道时，再单独确认 API v3 密钥、商户私钥和证书要求。

当前 `code2Session()` 尚未向支付初始化链路提供用户态签名所需的 `session_key`。后续应由服务端使用新的 `wx.login` code 临时取得，不返回客户端、不长期明文保存；具体实现需单独审查。该缺口阻断支付初始化和普通端沙箱联调。

当前会员免扣访问没有记录可靠的服务端会员使用事实，无法执行“生效 24 小时内且未使用可退款”的判断。该缺口不阻断基础支付沙箱、查单和会员发放联调，但在正式退款或现网购买开放前必须解决；本轮不锁定复用现有流水或新增独立记录。

个人收款码、站外付款引导、将虚拟权益按实体商品申报、审核后远程改变支付入口等替代路径存在审核、支付权限、消费者纠纷和账号处罚风险，当前不是已批准方案。开发不得自行实现、隐藏或远程开启；这些路径仅保留为等待平台规则核实和产品负责人另行决策的风险备选。

退款规则已经锁定：非 Apple IAP 渠道中，未生效可全退；生效 24 小时内且未使用可全退；已经使用则不退款且不撤销。使用是指对应会员时间生效后至少成功访问一次原本需要扣减次数的完整学习内容，并必须由可靠的服务端事实判断。Apple IAP 退款以平台结果为准；平台已退款时撤销尚未使用的剩余权益。退款同步、支付退款状态和会员 grant 撤销必须幂等且可追溯。

## 11. 验收记录

日期：

```text
2026-07-24
```

当前已验证或已完成的能力：

- `ADMIN_GRANT` 增加额度成功。
- `ADMIN_DEDUCT` 扣除额度成功。
- `GET /api/admin/entitlements/users/:userId/transactions` 流水查询成功。
- 后台用户权益管理页面可以展示用户余额。
- 后台详情页默认展示最近 5 条流水。
- 独立流水详情页可以分页查看完整流水。

本文件只记录当前用户权益系统的长期维护视图，不改变任何代码、数据库结构或接口契约。
