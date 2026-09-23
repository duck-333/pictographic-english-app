# ADR-0023: Phase 2.3-B 权益服务层架构决策

日期：2026-07-21

状态：Proposed

## 背景

Phase 2.3-A 已确定用户权益数据库模型：

- `user_entitlements`：用户当前权益快照，用于快速读取。
- `entitlement_transactions`：用户权益事实流水，记录所有额度变化和会员变化。

Phase 2.3-B 需要在数据库模型之上设计服务层边界，作为后续 server store、API、小程序接入和后台运营能力的实现依据。

本 ADR 只记录服务层架构决策，不修改代码，不创建 migration，不修改 API 实现。

## 1. 权益服务职责边界

后续应设计独立的 entitlement service/store，统一处理用户权益相关读写。

它负责：

- 查询用户当前权益。
- 判断会员状态。
- 判断普通额度是否足够。
- 消耗普通额度。
- 发放普通额度。
- 发放会员。
- 更新 `user_entitlements` 快照。
- 写入 `entitlement_transactions` 流水。
- 按幂等键处理重复请求。
- 为后台运营查询提供快照和流水读取能力。

它不负责：

- 微信登录。
- token 解析。
- 小程序页面展示。
- 支付订单创建。
- 微信支付回调验签。
- 学习统计。
- 最近学习列表。
- 收藏资产。

用户身份仍沿用当前链路：

```text
小程序
  -> authSession
  -> Authorization: Bearer <token>
  -> requireUserAuth()
  -> authResult.userId
  -> users.id
  -> entitlement service/store
```

小程序不能传 `user_id`。服务端只能从 `requireUserAuth()` 的 `authResult.userId` 取得当前用户身份。

### 事实来源和快照关系

`entitlement_transactions` 是事实来源。

它记录：

- 注册赠送。
- 完整内容访问扣减。
- 分享奖励。
- 管理员赠送。
- 淘宝购书赠会员。
- 会员开通。
- 退款恢复。
- 额度过期扣减。

`user_entitlements` 是读取优化。

它用于：

- 快速读取剩余额度。
- 快速判断当前会员状态。
- 后台快速查看用户当前权益。
- 避免每次访问完整内容时扫描全量流水。

任何快照变化都必须能由一条或多条 `entitlement_transactions` 解释。若快照与流水不一致，应以流水为准，并通过重算或修复任务校正快照。

## 2. Access Check API 设计

未来建议新增用户完整内容访问检查 API：

```text
POST /api/user/content-access/check
```

用途：

用户进入完整 Learning Object 前，由服务端判断是否允许访问。

该 API 的职责是权益判断和必要的额度扣减，不负责页面逻辑、内容渲染或跳转决策。

### 请求示例

基础请求：

```json
{
  "learningObjectId": "apple",
  "accessContext": {
    "type": "root"
  }
}
```

实际实现时，扣减路径必须携带客户端生成的请求幂等标识：

```json
{
  "learningObjectId": "apple",
  "clientRequestId": "content-access-apple-20260721T120000-8f4c",
  "accessContext": {
    "type": "root",
    "rootLearningObjectId": "apple",
    "currentLearningObjectId": "apple",
    "relationType": "self",
    "accessReason": "search_enter"
  }
}
```

服务端必须忽略请求体中的任何 `userId` / `user_id` 字段。当前用户只能来自 token 鉴权结果。

### 允许访问：普通额度扣减

```json
{
  "allowed": true,
  "reason": "quota_consumed",
  "remainingQuota": 29
}
```

说明：

- 用户不是有效会员。
- 用户有未过期普通额度。
- 服务端在同一事务内扣减一次额度。
- 服务端写入 `CONTENT_ACCESS` 流水。
- 服务端更新 `user_entitlements.quota_balance`。

### 允许访问：会员有效

```json
{
  "allowed": true,
  "reason": "membership_active",
  "membershipExpireAt": "2026-08-21T23:59:59+08:00"
}
```

说明：

- 用户会员有效。
- 不消耗普通额度。
- 不产生永久解锁。
- 可按后续需要记录访问事件，但不能把会员访问转成永久访问资产。

### 不允许访问：额度不足

```json
{
  "allowed": false,
  "reason": "quota_insufficient"
}
```

说明：

- 用户不是有效会员。
- 用户没有可用普通额度。
- 服务端不写扣减流水。
- 小程序可展示内容锁定页、会员入口和获取免费额度入口。

### API 边界

该 API 不负责：

- 判断页面层级。
- 根据页面路径扣减。
- 根据 `word_id` 特殊规则扣减。
- 处理 `decompose` 内部展开。
- 处理 `related` / `recommend` 的页面跳转逻辑。
- 返回完整词条内容。

调用方必须根据 Learning Object Access Model 传入正确的 root access context。服务端仍需要校验该上下文是否符合允许的访问类型。

## 3. 权益扣减事务设计

核心规则：

```text
一次 root Learning Object 完整内容访问只能扣一次普通额度
```

幂等链路：

```text
client_request_id
  -> server normalized idempotency key
  -> entitlement_transactions.idempotency_key
```

建议服务端幂等键格式：

```text
content_access:{user_id}:{root_learning_object_id}:{client_request_id}
```

后台赠送幂等键格式可使用：

```text
admin_grant:{admin_operation_id}
taobao_membership_grant:{admin_operation_id}
registration_bonus:{user_id}
```

### 事务步骤

后续 server 实现必须用数据库事务保证原子性：

```text
1. 根据 idempotency_key 检查是否已有流水
2. 若已有流水，返回已有结果或按已有快照构造幂等响应
3. 锁定或读取用户当前 user_entitlements 快照
4. 判断会员状态
5. 判断可用额度
6. 写入 entitlement_transactions
7. 更新 user_entitlements 快照
8. 提交事务
```

事务要求：

- 网络重试不能重复扣额度。
- 小程序重复请求不能重复扣额度。
- 后台重复提交不能重复赠送。
- 支付回调重复通知不能重复发放会员或额度。
- 流水和快照必须同时成功或同时失败。

若写流水成功但更新快照失败，事务必须整体回滚。不能出现只有流水或只有快照的半成功状态。

## 4. 注册赠送流程设计

用户首次创建账号后，触发注册赠送初始化。

目标流程：

```text
users 创建成功
  -> 初始化 user_entitlements
  -> 写 REGISTER_BONUS +30
  -> 设置 expires_at = 当前时间 + 配置有效期
  -> 更新 quota_balance = 30
  -> 更新 quota_total_granted = 30
```

注册赠送规则：

- 默认赠送 30 次完整内容访问额度。
- 有效期暂定一年，但必须配置化。
- 一个用户只能领取一次。
- 不做永久解锁。
- 必须写 `entitlement_transactions`。
- 必须更新 `user_entitlements`。

建议幂等键：

```text
registration_bonus:{user_id}
```

重试策略：

- 如果初始化时网络或进程异常，重试同一幂等键。
- 如果 `REGISTER_BONUS` 流水已存在，不能再次发放。
- 如果快照缺失但流水存在，应进入修复流程，根据流水重建快照。

## 5. 后台运营能力预留

后续后台需要查询：

- 用户当前额度。
- 用户累计发放额度。
- 用户累计消耗额度。
- 用户累计过期额度。
- 会员类型。
- 会员状态。
- 会员开始时间。
- 会员过期时间。
- 权益流水。

后续后台需要操作：

- 手动赠送额度。
- 手动赠送会员。
- 淘宝购书赠会员。
- 活动奖励。
- 异常修复或退款恢复。

每次后台操作都必须写入 `entitlement_transactions`，并包含：

- `operator_type`
- `operator_id`
- `reason`
- `source`
- `source_id`
- `metadata_json`

后台不能直接修改 `user_entitlements` 快照。快照只能在写入权益流水的同一事务中更新。

淘宝购书赠会员建议记录：

- 来源：`taobao_book`
- 类型：`TAOBAO_BOOK_MEMBERSHIP_GRANT`
- 操作人：后台管理员 id。
- 备注：客服核验说明。
- 元数据：淘宝订单摘要，不存订单截图原图，不存手机号明文。

## 6. 与未来支付系统边界

订单支付系统负责：

- 商品配置。
- 用户购买。
- 订单状态。
- 微信支付创建。
- 微信支付回调。
- 退款状态。

权益系统负责：

- 用户获得什么权益。
- 用户消耗什么权益。
- 用户当前是否可访问完整内容。
- 权益流水审计。
- 当前权益快照。

二者不能混表。

支付成功后，订单系统不能直接修改 `user_entitlements`。正确流程是：

```text
支付成功
  -> 订单系统确认订单状态
  -> 调用权益服务发放会员或额度
  -> 权益服务写 entitlement_transactions
  -> 权益服务更新 user_entitlements
```

退款或异常处理也必须通过权益流水记录，不能直接删除会员或改余额。

## 7. 小程序接入原则

未来小程序可以展示：

- 当前剩余额度。
- 是否会员。
- 会员到期时间。
- 额度不足提示。
- 开通会员入口。
- 获取免费额度入口。

小程序不能：

- 自己计算剩余额度。
- 自己扣减额度。
- 本地缓存并信任会员状态。
- 本地缓存并信任额度余额。
- 使用 `pictographic:userState.searchCount` 作为权益依据。
- 使用 `user_recent_words` 作为额度依据。
- 传 `user_id` 给服务端。

小程序每次进入新的 root Learning Object 完整内容前，都应调用服务端权益检查 API。

当前 root Learning Object 内部 `decompose` 展开不重复调用扣减接口。`related` / `recommend` 进入新的 Learning Object 时重新调用权益检查 API。

## 后续影响

后续进入服务端实现前，需要先确认：

- 注册赠送触发点。
- 默认额度和有效期配置来源。
- `clientRequestId` 生成规则。
- 幂等响应格式。
- 快照行锁或事务隔离策略。
- 老用户是否补发注册赠送。
- 后台管理员身份来源。

以上问题不影响本 ADR 的核心决策：权益判断和扣减必须服务端完成，流水是事实来源，快照是读取优化，完整内容访问以 root Learning Object 为扣减单位。

## 2026-08-28 后续状态与服务边界

本节记录 2026-08-28 当时的实现状态和已经锁定但尚未实施的后续规则，不改写原 ADR 的历史决策。2026-09-23 的当前状态和新版邀请规则见本文后续新增决策记录。

### 当前已经实现

- 注册赠送 `REGISTER_BONUS +30` 及 `registration_bonus:{user_id}` 幂等保护。
- 完整内容访问扣减、会员有效时免扣、权益流水和快照事务更新。
- 后台固定赠送 30 天会员。
- 购书福利码兑换固定 30 天会员。
- 会员 grant 固定 `30 × 24` 小时并按现有排期顺序叠加。

### 当前尚未实现

- 统一“获取学习权益”页、邀请规则页和会员购买确认页。
- 分享 token、邀请关系、最后一次有效邀请、手机号新人资格判断和 `SHARE_REWARD` 自动发放。
- 虚拟支付业务订单、支付与退款事实、`wx.requestVirtualPayment`、AppKey 支付签名和 `session_key` 用户态签名。
- 支付与退款通知、主动查单、发货确认、补偿任务、自动关单和支付订单后台。
- 可靠的服务端会员使用事实记录。
- Android、鸿蒙、Windows 普通虚拟支付沙箱接入，以及 iOS 受控现网接入。

### 分享奖励服务边界

邀请业务服务负责验证有效 token、最后一次有效邀请、手机号最终是否创建新 `users`、自邀、单新人唯一奖励和邀请者累计 5 次上限。只有资格确认成功后，才能调用权益服务发放一年有效的 `SHARE_REWARD +30`。

分享、打开链接和普通页面访问都不能触发奖励。手机号注册成功后，邀请关系必须永久锁定；注册后不允许补录或覆盖。邀请资格确认、关系锁定和奖励发放必须具备事务边界或可验证的幂等恢复流程。

### 会员购买服务边界

订单/支付服务负责服务端商品定价、创建订单、渠道下单、通知验签、主动查单、订单状态、自动关单和退款状态。它不能直接修改 `user_entitlements`。

支付平台通过服务端通知或主动查单确认成功后，订单/支付服务以稳定订单 ID 和幂等键调用现有会员发放事务。通知处理、主动查单和后台补单必须进入同一个幂等发放入口；客户端支付成功回调只用于界面提示、触发查单或刷新展示，不是发放依据。后台补单只能主动查询支付平台并确认真实支付成功，不能人工把订单状态改成成功。

同一数据库事务至少应锁定业务订单，记录已确认支付事实，调用 `grantMembershipDurationInTransaction()` 生成会员 grant 和权益流水，更新权益快照并记录发放结果；事务提交后才能向渠道确认发货完成。通知丢失时由主动查单补偿，重复通知和重复查单不能重复发放。

订单/支付服务必须按环境、`payment_channel` 和 `platform` 隔离渠道实现。第一版 30 天会员采用虚拟支付道具直购 `mode=short_series_goods`；Android、鸿蒙、Windows 先走普通虚拟支付沙箱，iOS 由同一官方接口进入 Apple 支付且不支持沙箱。第一版不使用普通微信 JSAPI、代币或自动续费订阅。

当前 `code2Session()` 没有向支付初始化链路提供本次签名所需的 `session_key`。支付初始化后续应使用新的 `wx.login` code，由服务端临时取得并用于用户态签名；不得返回客户端或长期明文保存。具体实现需在代码开发前单独审查，这一缺口阻断支付初始化和普通端沙箱联调。

### 退款与会员使用判断

非 Apple IAP 渠道执行已锁定的商户退款规则：未生效可全退；生效 24 小时内且未使用可全退；已经使用则不退款且不撤销。会员使用判断必须来自可靠的服务端完整内容访问事实，不能由客户端上报决定。当前会员免扣访问尚未记录该事实，这不阻断基础支付沙箱、查单和会员发放联调，但阻断正式退款和现网购买开放；后续需要比较复用现有流水和新增独立使用事实记录两种方案。

Apple IAP 的最终退款结果由 Apple 平台决定。系统同步到成功退款后，应幂等撤销对应订单尚未使用的剩余会员权益。退款事实、grant 撤销流水和最终快照必须保持可追溯。

## 2026-09-23 后续决策记录：邀请注册编排与失败补偿

本节明确取代 2026-08-28 记录中“手机号最终是否创建新 `users`”这一邀请新人判断。现行规则以手机号是否首次完成手机号快捷注册为准；普通微信登录和手机号快捷注册是不同业务事实，只有微信绑定的空壳 `users` 不自动丧失邀请新人资格。

### 当前实现状态修正

- 统一“获取学习权益”页中的会员购买和本机购买记录已经实现。
- 邀请卡片、邀请进度、邀请落地页、活动规则页、邀请凭证、候选邀请、邀请关系、资格判断和 `SHARE_REWARD` 自动发放仍未实现。
- 第一批邀请开发前仍需核对身份 store 与权益 store 是否共享同一连接池，以及事务内身份解析、普通新人权益和额度发放如何复用同一数据库连接。现有独立事务入口不能未经审查直接串接。

### 服务边界

邀请业务服务负责：

- 验证邀请人已经完成手机号快捷注册；
- 创建和验证 7 天有效邀请 token；
- 维护注册前最后一次有效候选，拒绝用过期、撤销或无效邀请覆盖仍有效候选；
- 在可信手机号解析后判断该手机号是否首次完成注册，而不是仅检查是否新建 `users`；
- 处理已有手机号、新微信身份合并、自邀、单新人唯一关系和邀请人累计 5 次上限；
- 永久锁定注册后的邀请关系并驱动奖励补偿。

权益服务继续负责写入一年有效的 `REGISTER_BONUS +30` 和 `SHARE_REWARD +30` 流水、更新余额快照及严格校验幂等回放。邀请奖励是在邀请人原余额上增加 30 次，不是重置余额。

### 两张表与 bearer credential

推荐使用“邀请分享凭证表 + 邀请注册关系表”两张表。前者承载 token 生命周期，后者承载候选、最终关系、资格、上限占位、奖励状态、权益流水关联、失败和人工复核事实。`entitlement_transactions` 不能替代邀请业务事实。

邀请 token 和 `candidateReceipt` 都是 bearer credential：必须使用密码学安全随机数高熵生成，服务端数据库只保存带独立密钥的摘要，不保存明文；两类邀请密钥不得复用 JWT、手机号、支付、兑换码或其他业务密钥。客户端只可暂存待提交凭证，不得成为邀请资格或奖励事实来源。

### 两阶段幂等状态机

推荐流程：

```text
微信 code2Session / 手机号换取（数据库事务外）
  -> 第一事务：解析手机号身份
  -> 确认手机号首次注册事实
  -> 写入或幂等确认 REGISTER_BONUS
  -> 永久锁定邀请关系并原子预留 5 次上限
  -> REWARD_PENDING
  -> 提交并允许用户正常登录
  -> 第二事务：严格幂等写 SHARE_REWARD +30
  -> 同事务关联权益流水并转 REWARD_GRANTED
```

第二事务失败时必须保留可重试的 `REWARD_PENDING` 状态，由当前请求重试、后续请求或补偿任务恢复；达到自动重试边界后进入可审计的人工复核状态。正常登录不能因为邀请奖励临时交付失败而永久受阻。

同一新人唯一约束防止多邀请人竞争；邀请人用户行或等效稳定聚合锁用于串行化 5 次上限预留。第 6 位及之后的新用户仍正常完成首次手机号注册并获得 `REGISTER_BONUS +30`，只是不再为邀请人创建奖励资格。

相同或不同请求标识的重试都必须收敛到稳定 invitation id；邀请奖励使用该 invitation id 生成独立幂等键，并严格核对用户、类型、金额、来源、`source_id` 和有效期，不能只核对用户与流水类型。

数据库死锁或锁等待仅允许对完整数据库事务做有界重试。所有微信外部 HTTP 必须在开始事务和获取行锁之前完成，重试数据库事务时不得重复消费微信临时凭证。
