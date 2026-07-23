# ADR-0025: 后台用户额度管理 MVP

日期：2026-07-23

状态：Proposed

## 背景

项目已经完成内容访问权益系统：

- `users` 用户系统
- `user_entitlements` 用户当前权益快照
- `entitlement_transactions` 用户权益事实流水
- 注册赠送额度流程
- 用户主动打开完整单词详情时扣减额度

开发测试阶段需要频繁为测试账号增加或扣除查词额度。当前如果直接操作数据库，容易造成快照和流水不一致，也无法清晰追踪操作原因和操作人。

## 问题

后台额度管理 MVP 需要解决：

- 管理员可以查看用户当前额度。
- 管理员可以给用户增加测试额度。
- 管理员可以扣除用户额度。
- 所有管理员操作都必须可审计。
- 权益变化需要继续支持未来购买会员、充值、活动赠送和人工调整。

## 决策

采用“权益流水驱动”的额度管理方式。

管理员操作不是直接修改 `user_entitlements.quota_balance`，而是创建新的 `entitlement_transactions` 流水，并由服务端在同一个事务中更新 `user_entitlements` 快照。

管理员增加额度：

```text
transaction_type: ADMIN_GRANT
amount: +50
source: admin
reason: 测试账号补充额度
operator_type: admin
operator_id: 管理员ID
```

管理员扣除额度：

```text
transaction_type: ADMIN_DEDUCT
amount: -10
source: admin
reason: 测试账号扣除额度
operator_type: admin
operator_id: 管理员ID
```

服务端处理规则：

- 先校验管理员身份。
- 再校验目标用户存在。
- 创建权益流水。
- 更新用户权益快照。
- 返回最新用户额度。
- 不允许无流水修改余额。
- 不允许扣成负数。

## 优点

- 保留完整权益变化历史。
- 便于排查测试账号和生产账号的额度异常。
- 与现有 `CONTENT_ACCESS`、`REGISTER_BONUS` 流水模型一致。
- 后续可以平滑扩展到购买会员、充值、活动赠送、兑换码和人工补偿。
- `user_entitlements` 继续作为快速读取快照，避免日常查询扫描完整流水。

## 后续扩展方向

后台额度管理 MVP 后续可以继续扩展：

- 查询用户当前权益。
- 查询用户权益流水。
- 管理员赠送会员。
- 管理员批注操作备注。
- 活动奖励发放。
- 订单支付完成后发放会员或额度。
- 兑换码兑换权益。

本 ADR 仅记录后台额度管理的数据与权限方案，不包含代码实现、API 实现或数据库 migration。
