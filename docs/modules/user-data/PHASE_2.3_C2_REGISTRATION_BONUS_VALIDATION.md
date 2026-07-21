# Phase 2.3-C2 注册赠送权益验证记录

## 1. 背景

当前项目已接入微信用户体系，用户身份链路为：

小程序 -> 微信登录 -> Node.js API -> MySQL 用户表。

用户注册后需要自动获得体验权益。本阶段目标是验证：

微信登录 -> 创建用户 -> 初始化权益账户 -> 写入权益流水。

本记录是 Phase 2.3-C2 注册赠送权益的开发验收记录，不是教程。本文档只记录本次已完成和已验证的结果，不记录未执行的假设性验证结论。

## 2. 本次验证环境

服务器：

- Ubuntu 云服务器
- Node.js API 服务
- MySQL 数据库

服务：

- PM2 管理
- 服务名称：`pictographic-english-api-module3`

数据库：

- `baxiaota`

## 3. 验证前准备

已备份数据库：

- `before_entitlement_migration.sql`

已清理旧测试账号相关数据，清理范围包括：

- `users`
- `wechat_user_bindings`
- `user_entitlements`
- `entitlement_transactions`
- `user_recent_words`
- `user_favorites`

说明：本记录只保留清理范围，不在文档中固化具体删除 SQL，避免误用到非测试账号。

## 4. 验证流程

1. 删除旧测试账号。
2. 小程序重新微信登录。
3. 服务端创建新 `users` 记录。
4. `ensureRegistrationBonusForUser` 自动执行。
5. 创建 `user_entitlements` 权益快照。
6. 写入 `entitlement_transactions` 权益流水。

## 5. 数据库验证结果

本节记录本次验收已确认的数据库结果。

### users

字段：

- `id`
- `status`

结果：

```text
id = 4
status = active
```

### user_entitlements

字段：

- `user_id`
- `quota_balance`
- `quota_total_granted`
- `quota_total_consumed`
- `quota_total_expired`

结果：

```text
user_id = 4
quota_balance = 30
quota_total_granted = 30
quota_total_consumed = 0
quota_total_expired = 0
```

### entitlement_transactions

字段：

- `transaction_type`
- `amount`
- `balance_after`
- `source`
- `idempotency_key`

结果：

```text
transaction_type = REGISTER_BONUS
amount = 30
balance_after = 30
source = registration
idempotency_key = registration_bonus:4
```

结论：

注册赠送 30 次体验额度成功。

## 6. 验证 SQL

以下 SQL 用于保留本次验收所需检查项。

检查用户记录：

```sql
SELECT
  id,
  status
FROM users
WHERE id = 4;
```

检查权益快照：

```sql
SELECT
  user_id,
  quota_balance,
  quota_total_granted,
  quota_total_consumed,
  quota_total_expired
FROM user_entitlements
WHERE user_id = 4;
```

检查注册赠送权益流水：

```sql
SELECT
  transaction_type,
  amount,
  balance_after,
  source,
  source_id,
  expires_at,
  idempotency_key,
  operator_type,
  operator_id,
  reason,
  created_at
FROM entitlement_transactions
WHERE user_id = 4
  AND transaction_type = 'REGISTER_BONUS'
  AND idempotency_key = 'registration_bonus:4';
```

检查重复赠送防护：

```sql
SELECT
  COUNT(*) AS bonus_count,
  COALESCE(SUM(amount), 0) AS total_bonus
FROM entitlement_transactions
WHERE user_id = 4
  AND transaction_type = 'REGISTER_BONUS'
  AND idempotency_key = 'registration_bonus:4';
```

期望：

```text
bonus_count = 1
total_bonus = 30
```

## 7. 幂等性验证说明

系统通过以下幂等键防止重复发放注册赠送额度：

```text
registration_bonus:${userId}
```

本次测试用户的实际幂等键为：

```text
registration_bonus:4
```

作用：

- 防止用户重复登录导致重复赠送额度。
- 防止注册赠送在网络重试或接口重复调用时重复执行。
- 支持异常恢复：如果用户已创建但注册赠送未成功，后续登录仍会尝试确保注册赠送存在；如果流水已经存在，则不会重复发放。

当前验证：

- 新用户首次注册生成一次 `REGISTER_BONUS` 流水。
- 权益快照 `quota_balance` 与流水 `balance_after` 均为 `30`。

## 8. 当前完成状态

| 功能 | 状态 |
| --- | --- |
| 用户创建 | ✅完成 |
| 微信绑定 | ✅完成 |
| 权益账户初始化 | ✅完成 |
| 注册赠送30次额度 | ✅完成 |
| 权益流水记录 | ✅完成 |
| 重复赠送防护 | ✅完成 |

## 9. 当前未完成部分

- 前端我的页面展示剩余次数
- 用户权益查询 API
- 查词/视频访问扣减额度
- 会员权益系统
- 支付购买额度
- 订单系统

## 10. 下一阶段计划

Phase 2.3-C3：

实现：

```http
GET /api/user/entitlement
```

返回：

```json
{
  "quotaBalance": 30,
  "membershipStatus": "none"
}
```

让小程序可以展示剩余体验次数。

## 11. 注意事项

- 当前数据库数据为开发测试数据。
- 正式上线前需要增加数据备份策略。
- 正式上线前需要增加权益异常监控。
- 正式上线前需要补充订单和支付流水设计。
- 当前阶段只完成注册赠送权益，不包含完整内容访问扣减、会员购买、支付和后台权益管理。
