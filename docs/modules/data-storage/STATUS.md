# Data Storage Module Status

日期：2026-07-17

## 当前本地用户行为数据

小程序当前使用：

```text
pictographic:userState
```

保存用户行为数据：

- `recentWordIds`
- `favoriteWordIds`
- `searchCount`
- `streakDays`

读写位置：

```text
miniapp-uni/word-app1/common/user-store.js
```

读写方式：

- `uni.getStorageSync`
- `uni.setStorageSync`
- `uni.removeStorageSync`

## 当前数据库用户相关表

当前代码已使用的用户相关表：

- `users`
- `wechat_user_bindings`
- `user_phone_bindings`

当前仓库中的数据库迁移文件：

```text
database/migrations/001_create_user_phone_bindings.sql
```

## user_favorites Phase 1 数据边界

收藏云端化确认新增服务端数据表：

```text
user_favorites
```

确认字段：

- `id`
- `user_id`
- `word_id`
- `created_at`

确认约束：

- `UNIQUE(user_id, word_id)`
- `word_id` 使用字符串类型
- 取消收藏硬删除对应行

确认模式：

- 登录用户收藏保存服务器。
- 未登录用户收藏继续保存本机 storage。
- 不做游客数据自动迁移。

## 后台额度管理数据设计

日期：2026-07-23

后台额度管理继续复用 Phase 2.3 用户权益表：

- `user_entitlements`
- `entitlement_transactions`

设计原则：

- `entitlement_transactions` 是权益事实流水。
- `user_entitlements` 是当前权益快照。
- 管理员操作不能无记录地直接修改 `quota_balance`。
- 每一次额度增加或扣除都必须保留完整流水。
- 该模型需要支持未来购买会员、充值、活动赠送、兑换码和人工调整。

### 管理员增加额度

示例流水：

```text
entitlement_transactions

transaction_type: ADMIN_GRANT
amount: +50
source: admin
reason: 测试账号补充额度
operator_type: admin
operator_id: 管理员ID
```

处理要求：

- 写入 `entitlement_transactions`。
- 更新 `user_entitlements.quota_balance`。
- 更新 `user_entitlements.quota_total_granted`。
- 保留 `reason` 和管理员操作身份。

### 管理员扣除额度

示例流水：

```text
entitlement_transactions

transaction_type: ADMIN_DEDUCT
amount: -10
source: admin
reason: 测试账号扣除额度
operator_type: admin
operator_id: 管理员ID
```

处理要求：

- 写入 `entitlement_transactions`。
- 更新 `user_entitlements.quota_balance`。
- 不允许扣成负数。
- 保留 `reason` 和管理员操作身份。

### 后续扩展

后续商业化能力仍应通过流水解释权益变化：

- 购买会员
- 充值查词额度
- 活动赠送
- 分享奖励
- 兑换码
- 管理员人工调整
