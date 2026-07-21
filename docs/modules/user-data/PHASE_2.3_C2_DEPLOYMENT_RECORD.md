# PHASE 2.3 C2 注册赠送权益部署记录

## 1. 部署时间

部署验证日期：

- 2026-07-21

## 2. 部署环境

服务器环境：

- Ubuntu
- Node.js API 服务
- Node.js 版本：本次部署记录未保留 `node -v` 的具体输出，后续维护时应在服务器执行 `node -v` 补充。
- PM2 管理方式

当前运行目录：

```text
/home/ubuntu/pictographic-english-app-release-20260717-module3
```

PM2 服务名称：

```text
pictographic-english-api-module3
```

服务入口：

```text
server/index.mjs
```

## 3. 数据库变更记录

本阶段新增的数据表：

- `user_entitlements`
- `entitlement_transactions`

用途说明：

- `user_entitlements`：保存用户权益余额、累计赠送、累计消耗、累计过期和会员状态快照。
- `entitlement_transactions`：记录权益变化流水，例如 `REGISTER_BONUS`。

已执行过的 migration：

- `001_create_user_phone_bindings.sql`
- `002_create_user_favorites.sql`
- `003_create_user_recent_words.sql`
- `004_create_user_entitlements.sql`
- `005_create_entitlement_transactions.sql`

说明：

- 本记录只记录本次部署验证涉及的数据库变更结果。
- 本次不新增 migration，不修改数据库结构。

## 4. 数据库验证结果

验证 SQL：

```sql
SHOW TABLES;
```

确认存在以下数据表：

- `users`
- `wechat_user_bindings`
- `user_phone_bindings`
- `user_favorites`
- `user_recent_words`
- `user_entitlements`
- `entitlement_transactions`

测试用户验证：

测试用户：

```text
id = 4
```

`users`：

```text
成功创建
```

`user_entitlements`：

```text
quota_balance = 30
quota_total_granted = 30
```

`entitlement_transactions`：

```text
transaction_type = REGISTER_BONUS
amount = 30
```

结论：

- 测试用户已成功创建。
- 注册赠送权益已成功初始化。
- 注册赠送 30 次额度已写入权益快照和权益流水。

## 5. 注册赠送逻辑验证

用户首次注册流程：

```text
微信登录
↓
创建 users 用户
↓
绑定微信身份
↓
ensureRegistrationBonusForUser()
↓
创建用户权益账户
↓
写入 REGISTER_BONUS 流水
```

当前注册赠送规则：

- 赠送类型：`REGISTER_BONUS`
- 赠送额度：`30`
- 来源：`registration`
- 幂等键：`registration_bonus:${userId}`

说明：

- 注册赠送由服务端执行。
- 小程序不传 `user_id`。
- 重复登录不应重复赠送。

## 6. 服务验证

执行：

```bash
node --check server/index.mjs
```

结果：

```text
通过
```

执行：

```bash
pm2 restart pictographic-english-api-module3
```

结果：

```text
online
```

执行：

```bash
curl http://127.0.0.1:3001/api/health
```

结果：

```text
返回 ok=true
```

## 7. 测试账号清理记录

部署验证前存在 3 个测试账号。

处理方式：

- 删除测试数据。
- 重新使用测试手机登录。
- 生成新的测试用户。

说明：

- 后续测试优先采用重新注册方式验证权益初始化。
- 后续测试不应通过人工补发权益来替代注册赠送链路验证。

## 8. 当前完成状态

完成：

- ✅ 注册用户创建
- ✅ 微信身份绑定
- ✅ 注册赠送30次权益
- ✅ 权益账户初始化
- ✅ 权益流水记录
- ✅ 服务部署验证

## 9. 后续计划

待完成：

- 用户权益查询接口
- 小程序展示剩余次数
- 查词次数扣减
- 会员体系
- 支付订单体系

## 10. 维护注意事项

- 本记录中的测试用户数据属于开发测试数据。
- 正式上线前应确认数据库备份策略。
- 正式上线前应补充权益异常监控。
- 后续订单、支付、会员相关功能需要继续保持权益流水可审计。
