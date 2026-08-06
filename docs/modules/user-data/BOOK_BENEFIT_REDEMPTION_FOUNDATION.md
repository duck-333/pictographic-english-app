# 购书用户 30 天会员兑换活动：第一阶段基础说明

## 本阶段边界

本阶段只提供稳定活动手机号身份、订单占位 HMAC、5 张 MVP 业务表及静态测试。不包含 API、管理后台、小程序页面、兑换码生成、兑换处理、截图上传、客服聊天同步或会员事务改造。

## 稳定手机号身份

手机号继续复用 `server/identity-store.mjs` 的可信手机号规范化规则，统一得到 E.164。工具不判断手机号来源，后续调用方只能传入已经由微信或其他可信服务端流程验证的手机号。活动身份输入固定为：

```text
campaign-phone-identity:v1|<normalized_phone>
```

服务端使用独立的 `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET` 计算 HMAC-SHA256，输出 32 字节 Buffer，并保存版本 `v1`。输入不包含 `user_id`、手机号绑定记录 ID 或 `campaign_id`，因此账号或绑定记录变化不会改变同一手机号的活动身份。

该密钥至少 32 字节，且不得与 `PHONE_HASH_SECRET`、`JWT_SECRET`、`ADMIN_API_TOKEN`、`BOOK_ORDER_CLAIM_HASH_SECRET` 或未来的 `REDEMPTION_CODE_HASH_SECRET` 相同。缺失、空值、过短或复用时工具会失败关闭。测试只能显式注入测试密钥。

`user_phone_bindings` 新增以下可空字段：

- `campaign_phone_identity_hash BINARY(32)`
- `campaign_phone_hash_version VARCHAR(16)`

`campaign_phone_identity_hash` 只建立普通查询索引 `idx_user_phone_bindings_campaign_identity`，验收时 `NON_UNIQUE` 必须为 `1`。它只是当前绑定身份缓存，不作为永久手机号历史的全局唯一边界；活动内防重复继续由申请表和兑换表的 `(campaign_id, phone_identity_hash)` 唯一约束负责。

不能从既有 `phone_hash` 反推出新身份。旧用户需要在后续流程重新验证可信手机号后才能补齐；本阶段不提供该 API 或页面。

## 订单占位

标准订单先对渠道和订单号做确定性规范化：渠道执行 NFKC、去除首尾空白并转为小写，只接受 ASCII 字母、数字、下划线和连字符；订单号执行 NFKC、移除空白并转为大写，同时拒绝分隔符 `|` 和控制字符。随后计算：

```text
HMAC-SHA256(BOOK_ORDER_CLAIM_HASH_SECRET, normalized_channel + "|" + normalized_order_number)
```

数据库只保存批准后的 32 字节 HMAC、版本和非敏感渠道，不保存完整订单号。

人工例外使用服务端生成的不可变输入：

```text
manual-exception:{campaign_id}:{application_id}
```

人工例外占位只保证该申请拥有稳定且不可变的订单占位，不能识别裁剪、重拍或重复提交的历史截图。历史凭证重复仍需客服人工判断。本阶段不保存截图、截图 URL、对象存储 key 或聊天内容。

## 迁移 007

Canonical 文件为 `database/migrations/007_create_book_benefit_redemption_foundation.sql`，发布副本为 `server/migrations/007_create_book_benefit_redemption_foundation.sql`，静态测试要求两者逐字一致。

迁移新增：

1. `book_benefit_campaigns`
2. `book_benefit_applications`
3. `book_benefit_codes`
4. `book_benefit_redemptions`
5. `book_benefit_audit_events`

迁移不声明外键。原因是生产 `users.id` 已记录为有符号 `BIGINT`，而现有绑定、权益和会员迁移使用 `BIGINT UNSIGNED`；在类型统一及生命周期策略确认前，关系通过明确类型、索引和服务层校验维护。`membership_grant_id` 对齐 `membership_grants.id` 的 `BIGINT UNSIGNED`，`entitlement_transaction_id` 对齐业务键 `entitlement_transactions.transaction_id` 的 `VARCHAR(64)`，操作人标识沿用 `VARCHAR(191)`。

`book_benefit_codes.active_application_id` 是 MySQL 8 虚拟生成列：仅 `status='issued'` 时等于 `application_id`，其他状态为 `NULL`。唯一索引保证同一申请不能同时存在两个 issued 代码；原代码改为 voided 后可签发新代码，redeemed、voided、expired 记录利用 MySQL 唯一索引允许多个 NULL 的语义互不冲突。

## ALTER 重复执行边界

5 张新表使用 `CREATE TABLE IF NOT EXISTS`。MySQL 8.0.46 的 `ALTER TABLE` 不支持 `ADD COLUMN IF NOT EXISTS`，因此 `user_phone_bindings` 加列不能假装天然幂等。

执行前必须运行迁移文件头部提供的 `INFORMATION_SCHEMA.COLUMNS` 和 `INFORMATION_SCHEMA.STATISTICS` 只读查询：

- 两列和索引均不存在：执行一次 ALTER。
- 两列和索引均存在且定义完全一致：跳过 ALTER。
- 只存在部分结构或定义不同：停止执行并人工审查。

## 隔离验收状态

2026-08-06 已在全新本地 Docker MySQL 8.0.46 容器中执行 canonical `007`，验证生成列、普通索引、唯一约束多 `NULL` 语义、ALTER preflight、仅重复执行 `CREATE TABLE IF NOT EXISTS`、残缺同名表识别及既有手机号绑定测试行不变。测试使用随机数据库并在结束时完成清理；该结果不替代生产执行前的备份、只读 schema 核对和人工审批。

## 隔离 MySQL 集成测试

独立命令 `npm.cmd run test:book-benefit-mysql-integration` 只允许连接 `127.0.0.1:3308`，且必须显式提供以下测试专用环境变量：

- `BOOK_BENEFIT_TEST_DB_HOST`
- `BOOK_BENEFIT_TEST_DB_PORT`
- `BOOK_BENEFIT_TEST_DB_USER`
- `BOOK_BENEFIT_TEST_DB_PASSWORD`
- `BOOK_BENEFIT_TEST_ALLOW_DESTRUCTIVE=local-docker-book-benefit-only`

脚本不会读取通用 `DB_*`、`.env`、PM2 或生产配置。每次运行只创建随机命名的 `book_benefit_test_*` 和 `book_benefit_partial_*` 数据库，并在 `finally` 中清理；数据库名称、host、port、安全确认值和本进程所有权任一校验失败时均拒绝执行 `DROP DATABASE`。该命令不加入普通 `npm check`。
