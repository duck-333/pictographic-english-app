# Phase 2.3-B 用户权益服务层开发计划

日期：2026-07-21

状态：Planning

## 1. 目标

本计划记录 Phase 2.3-B 用户权益服务层的后续实现顺序。

当前只做架构设计和文档整理，不修改 server、不修改 database、不创建 migration、不修改小程序、不实现 API。

Phase 2.3-B 的目标是建立服务端权益判断能力：

- 当前用户权益查询。
- 会员状态判断。
- 普通额度判断。
- 完整内容访问扣减。
- 注册赠送初始化。
- 后台赠送和运营操作预留。
- 流水与快照一致性保障。

## 2. 开发阶段

### Phase 2.3-B1：服务层骨架

范围：

- 新增 entitlement store/service。
- 封装 `user_entitlements` 读取。
- 封装 `entitlement_transactions` 写入。
- 统一 transaction type、source、membership status 常量。
- 统一幂等键生成规则。

不包含：

- 小程序页面改造。
- 后台 UI。
- 微信支付。
- 学习报告。

验收点：

- 服务层不接收前端传入的 `user_id`。
- 服务层调用方必须传入已认证的 `authResult.userId`。
- 写流水和更新快照必须在同一事务中完成。

### Phase 2.3-B2：注册赠送初始化

范围：

- 在用户首次创建账号后初始化 `user_entitlements`。
- 写入 `REGISTER_BONUS +30` 流水。
- 设置注册赠送有效期。
- 更新 `quota_balance` 和 `quota_total_granted`。
- 使用 `registration_bonus:{user_id}` 幂等键。

需要确认：

- 注册赠送触发点是用户创建时还是首次登录后补初始化。
- 默认 30 次和一年有效期的配置来源。
- 既有老用户是否补发。

验收点：

- 一个用户只能领取一次注册赠送。
- 重试不会重复发放。
- 快照和流水保持一致。

### Phase 2.3-B3：完整内容访问检查与扣减

范围：

- 实现 root Learning Object 访问权益判断。
- 会员有效时允许访问，不扣普通额度。
- 普通用户额度足够时扣减一次。
- 额度不足时返回不允许访问。
- 写入 `CONTENT_ACCESS` 流水。
- 更新 `quota_balance` 和 `quota_total_consumed`。
- 使用 `clientRequestId` 生成幂等键。

验收点：

- 网络重试不会重复扣减。
- 同一个 `clientRequestId` 重复请求返回幂等结果。
- `decompose` 内部展开不触发扣减。
- `related` / `recommend` 新 root Learning Object 重新判断。

### Phase 2.3-B4：当前权益查询

范围：

- 提供当前用户权益查询能力。
- 返回剩余额度、会员状态、会员到期时间。
- 只读取 `user_entitlements` 快照。

验收点：

- 未登录用户不能查询账号权益。
- 返回数据不包含内部流水元数据。
- 小程序只展示服务端返回结果，不本地计算余额或会员状态。

### Phase 2.3-B5：后台运营接口预留

范围：

- 设计后台查询用户权益。
- 设计后台查看权益流水。
- 设计后台赠送额度。
- 设计后台赠送会员。
- 设计淘宝购书赠会员。
- 设计活动奖励发放。

每次后台操作必须记录：

- `operator_type`
- `operator_id`
- `reason`
- `source`
- `source_id`
- `metadata_json`

验收点：

- 后台不能直接修改快照。
- 后台赠送必须写流水。
- 重复提交通过幂等键防重。

### Phase 2.3-B6：支付系统接入预留

范围：

- 明确订单支付和权益发放边界。
- 支付成功后通过权益服务发放会员或额度。
- 退款通过权益流水记录恢复、扣回或调整。

不包含：

- 微信支付实现。
- 商品管理。
- 订单表实现。

验收点：

- 支付系统不直接改 `user_entitlements`。
- 支付回调重复通知不会重复发放权益。

## 3. API 规划

### 当前权益查询

建议接口：

```text
GET /api/user/entitlements
```

用途：

- 小程序展示当前剩余额度。
- 小程序展示会员状态。
- 小程序展示会员到期时间。

认证：

- 必须使用 `Authorization: Bearer <token>`。
- 必须通过 `requireUserAuth()` 获取 `authResult.userId`。

### 完整内容访问检查

建议接口：

```text
POST /api/user/content-access/check
```

用途：

- 用户进入 root Learning Object 完整内容前检查权益。
- 普通用户额度足够时在服务端扣减一次。
- 会员用户允许访问但不扣普通额度。
- 额度不足时返回锁定原因。

请求字段建议：

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

响应字段建议：

```json
{
  "allowed": true,
  "reason": "quota_consumed",
  "remainingQuota": 29
}
```

可能的 `reason`：

- `quota_consumed`
- `membership_active`
- `quota_insufficient`
- `invalid_access_context`
- `auth_required`

说明：

- API 不负责页面跳转。
- API 不返回完整内容。
- API 不接受前端传入的 `user_id`。

### 后台权益查询

建议接口方向：

```text
GET /api/admin/users/:userId/entitlements
GET /api/admin/users/:userId/entitlement-transactions
```

用途：

- 查看用户当前权益。
- 查看权益流水。
- 客服排查额度问题。

### 后台赠送

建议接口方向：

```text
POST /api/admin/users/:userId/entitlement-grants
POST /api/admin/users/:userId/membership-grants
```

用途：

- 管理员赠送额度。
- 管理员赠送会员。
- 淘宝购书赠会员。
- 活动奖励。

要求：

- 必须传后台操作备注。
- 必须生成幂等键。
- 必须写 `entitlement_transactions`。
- 必须在同一事务内更新 `user_entitlements`。

## 4. 测试计划

### 服务层单元测试

覆盖：

- 注册赠送初始化。
- 重复注册赠送幂等。
- 普通用户额度足够扣减。
- 普通用户额度不足不扣减。
- 会员有效时不扣普通额度。
- 会员过期后恢复普通规则。
- 重复 `clientRequestId` 不重复扣减。
- 后台赠送额度幂等。
- 后台赠送会员幂等。

### 数据一致性测试

覆盖：

- 写流水后快照同步更新。
- 事务失败时流水和快照同时回滚。
- 快照可从流水重算。
- `quota_total_granted`、`quota_total_consumed`、`quota_total_expired` 与流水一致。

### API 集成测试

覆盖：

- 未登录请求被拒绝。
- 已登录用户只能访问自己的权益。
- 请求体传 `user_id` 不生效。
- `POST /api/user/content-access/check` 返回三类核心结果：
  - `quota_consumed`
  - `membership_active`
  - `quota_insufficient`

### Learning Object 规则测试

覆盖：

- root Learning Object 访问扣一次。
- root 内部 `decompose` 不重复扣。
- `related` / `recommend` 新 root 重新判断。
- 不按页面路径、`word-detail` 或 `word_id` 特殊规则扣减。

### 回归测试

覆盖：

- Phase 2.1 收藏云端化不受影响。
- Phase 2.2 最近学习云端化不受影响。
- 登录 token 鉴权不受影响。
- 未登录用户不能产生账号权益数据。

## 5. 回滚策略

### 服务层发布前

- 先完成数据库 migration 人工审核。
- 先完成测试环境执行。
- 先验证注册赠送、扣减、会员免扣、幂等和快照一致性。
- 小程序接入前可以只发布服务层内部能力，不开放用户入口。

### 服务层发布后

若发现问题：

- 暂停小程序调用完整内容访问检查接口。
- 保留 `entitlement_transactions` 流水用于审计。
- 不手动删除流水。
- 通过修复脚本或后台工具重算 `user_entitlements` 快照。
- 对异常用户通过补偿流水恢复额度或会员状态。

### 数据回滚原则

- 不直接修改余额。
- 不直接删除流水。
- 不静默减少额度。
- 任何补偿都写新的 `entitlement_transactions`。

## 6. 当前不做范围

Phase 2.3-B 不实现：

- 小程序内容锁定页。
- 我的页面权益展示。
- 后台 UI。
- 微信支付。
- 订单系统。
- 分享防刷系统。
- 学习报告。
- 排行榜。
- 永久解锁。

## 7. 开发前决策清单

进入代码实现前需要确认：

- 注册赠送是否对老用户补发。
- 注册赠送有效期配置来源。
- `clientRequestId` 由小程序生成还是服务端生成。
- 幂等响应返回原始流水结果还是当前快照结果。
- 会员续费是否顺延。
- 会员赠送和会员购买是否共用 `MEMBERSHIP_ACTIVATED`。
- 淘宝购书赠会员的会员时长。
- 后台管理员身份和操作审计来源。

## 8. 与已有模块关系

`user_favorites`：

- 继续只表示收藏资产。
- 不表示学习进度。
- 不表示权益。

`user_recent_words`：

- 继续只表示最近学习列表。
- 不表示学习统计。
- 不表示额度消耗。

`pictographic:userState`：

- 继续作为游客状态和本机轻量状态。
- `searchCount` 不能作为账号权益依据。

权益系统只能基于服务端用户身份、`user_entitlements` 快照和 `entitlement_transactions` 流水完成判断。
