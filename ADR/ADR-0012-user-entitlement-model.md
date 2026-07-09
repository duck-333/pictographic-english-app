# ADR-0012: 用户权益模型

Status: Accepted

Date: 2026-07-09

## 背景

当前产品方向从普通查词工具升级为带用户权益的学习服务。未来用户可能拥有不同来源的权益：

- 注册赠送查词次数。
- 买书获得查词次数。
- 活动赠送查词次数。
- 会员获得视频或课程访问资格。
- 儿童版会员或课程包。

ADR-0005 已确认完整单词详情查看需要扣减查词次数。ADR-0006 已确认额度应采用账户加流水，而不是单一计数器。

## 问题

查词次数不是唯一权益。系统需要同时支持：

- 消耗型权益：例如查词次数，用一次少一次。
- 资格型权益：例如会员、视频权限、课程包，有开始时间、结束时间或状态。

如果只把所有权益实现成一个 `search_count` 字段，后续视频权限、会员权限、买书权益和后台客服解释都会出现扩展困难。

## 决策

用户权益模型分为两个概念：

```text
quota
  消耗型权益
  回答：用户还可以使用多少次？

entitlement
  资格型权益
  回答：用户是否有资格访问某类内容或功能？
```

第一阶段实现重点是 quota：

```text
user_quota_accounts
user_quota_logs
```

同时在架构上预留 entitlement：

```text
user_entitlements
```

初始查词额度类型采用：

```text
word_lookup
```

`quota_type` 和 `source_type` 必须分开：

- `quota_type` 表示哪一种余额，例如 `word_lookup`。
- `source_type` 表示余额变化原因，例如 `register_bonus`、`word_detail_view`、`admin_adjust`。
- `membership` 可以作为未来 quota 来源，但会员资格本身属于 entitlement，不属于 quota。

## 方案

Quota account 结构方向：

```text
user_quota_accounts
  id
  user_id
  quota_type
  balance
  total_granted
  total_used
  created_at
  updated_at
```

Quota log 结构方向：

```text
user_quota_logs
  id
  user_id
  quota_type
  delta
  balance_before
  balance_after
  source_type
  source_key
  request_id
  idempotency_key
  related_word_id
  operator_id
  remark
  metadata_json
  created_at
```

初始 quota type：

```text
word_lookup
```

初始 source type：

```text
register_bonus
word_detail_view
admin_adjust
```

未来 source type：

```text
book_activation
membership
payment_order
campaign_bonus
share_reward
```

Entitlement 预留结构方向：

```text
user_entitlements
  id
  user_id
  entitlement_key
  status
  starts_at
  expires_at
  source_type
  source_id
  created_at
  updated_at
```

额度发放和扣减规则：

- 注册赠送额度只允许发放一次。
- 所有额度变化必须写入 `user_quota_logs`。
- `user_quota_logs` 必须记录 `balance_before` 和 `balance_after`。
- `word_detail_view` 扣减必须记录 `request_id`、`idempotency_key` 和 `related_word_id`。
- 扣减必须由服务端事务完成。
- 重试和重复请求必须通过 `source_key` 或 request id 保证幂等。
- 后台人工调整必须要求原因备注。

## 影响范围

涉及模块：

- 用户身份体系升级。
- 查词额度消耗链路。
- 内容访问控制。
- 后台用户权益查询。
- 数据存储。

涉及未来文件边界：

- 未来可新增 `server/quota-store.mjs`
- 未来可新增 `server/entitlement-store.mjs`
- `server/index.mjs`
- `server/auth.mjs`
- `admin-portal/pictographic-admin/common/api-client.js`
- 未来后台用户权益页面。

涉及未来数据库：

- `user_quota_accounts`
- `user_quota_logs`
- 未来 `user_entitlements`

## 替代方案

本 ADR 仅记录最终确认方案。未采用方案不在本文件展开。

当前确认的实施顺序是：先实现 `word_lookup` quota account 和 ledger，再按独立阶段接入 entitlement。

## 后续影响

- ADR-0006 和后续实现统一使用 `word_lookup` 作为 quota type。
- `POST /api/words/:id/view` 必须依赖 quota 模型，不允许只在前端扣本地次数。
- 后台用户权益查询必须以账户和流水为基础展示，不应只显示一个孤立余额。
- 未来 VOD、会员、课程包应优先接入 entitlement，不应混入查词 quota。
- 所有生产数据库变更必须遵循 ADR-0007。
