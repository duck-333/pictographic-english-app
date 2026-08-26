# 购书用户 30 天会员福利：未绑定兑换码模型

## 业务边界

管理员根据官方客服平台中的购书核验结果签发兑换码。签发时不搜索、不选择也不绑定小程序用户，不读取用户手机号或活动手机号身份。兑换码在首次成功兑换前属于 bearer code，可以转交；首个成功兑换且满足活动资格约束的账号获得固定 30 天会员权益。

本模型不提供一单多码、批量生成、库存系统、独立作废接口、支付、截图上传、对象存储或客服聊天同步。购买截图和聊天内容继续只保留在官方客服平台。

## 五张业务表

迁移 007 建立：

1. `book_benefit_campaigns`：固定活动配置。
2. `book_benefit_issuances`：客服核验通过后形成的一条签发链，不表示用户申请。
3. `book_benefit_codes`：只保存兑换码 HMAC、版本、代次、状态与补发关系。
4. `book_benefit_redemptions`：首次成功兑换记录。
5. `book_benefit_audit_events`：签发、补发和兑换的最小审计事件。

`book_benefit_issuances` 不含用户 ID、手机号身份、截图、聊天内容、完整订单号或自由 metadata。`book_benefit_codes` 不含明文码或可恢复密文。

## 订单核验与 issuance

标准订单对渠道和订单号做确定性规范化后计算：

```text
HMAC-SHA256(BOOK_ORDER_CLAIM_HASH_SECRET, normalized_channel + "|" + normalized_order_number)
```

数据库只保存 32 字节订单 claim HMAC、版本和非敏感渠道。唯一约束 `UNIQUE(campaign_id, approved_order_claim_hash)` 保证同一活动中的标准订单只能成功建立一条 issuance；多个 `NULL` 仍遵循 MySQL 唯一索引语义。

人工例外先在同一事务中创建 issuance，取得真实 ID 后再计算：

```text
HMAC-SHA256(BOOK_ORDER_CLAIM_HASH_SECRET, "manual-exception:" + campaign_id + ":" + issuance_id)
```

人工例外 claim 只提供该 issuance 的稳定占位，不能自动识别裁剪、重拍或重复提交的历史凭证，仍由客服人工判断。

## 未绑定签发事务

`issueUnassignedBookBenefitCode()` 锁定并校验固定活动，在一个事务中创建 `approved` issuance、第一代 `issued` code 和 `unassigned_code_issued` 审计事件。签发输入不接受 `userId`、locator、手机号或任何手机号 hash，也不调用管理员账号定位 helper。

同一 `operationId` 安全重放只返回已有 issuance/code 状态，不恢复明文。首次事务成功才返回一次明文码；日志、API 审计和数据库均不得保存明文、完整订单号或其 HMAC。

`getBookBenefitIssueOperationStatus()` 是只读恢复入口，返回 issuance ID/编号、code ID、有效期、状态及适用的 replacement code ID，不返回用户信息或明文，也不执行写入。

## 补发

补发在一个事务中锁定原 code、issuance 和 campaign，要求原码仍为 `issued`、未兑换、未过期、未被替换，且活动状态和签发时间窗口仍有效。事务原子作废旧码、创建下一代码、建立 replacement 关系并写入 `issued_code_replaced` 审计事件。

同一 issuance 同时最多一个 `issued` 码，由 `active_issuance_id` 生成列和唯一索引保证。最多三代；补发首次成功才返回新明文。当前不提供独立作废能力。

## 兑换与资格占用

兑换用户 ID 来自 JWT，当前可信手机号活动身份来自事务内手机号绑定 helper。兑换不比较签发时的“申请人”，因为签发阶段没有绑定用户。

code、issuance、campaign、redemption、会员 Grant、权益流水、权益快照和 code 状态在同一事务中处理。只有兑换成功时才占用：

- 同一码一次资格；
- 同活动账号一次资格；
- 同活动当前可信手机号一次资格。

数据库唯一约束与事务冲突映射共同处理并发。同一兑换 `operationId` 的幂等恢复还会核对当前可信手机号身份；不一致或数据损坏时失败关闭。会员期间及次数余额行为沿用既有会员事务核心，购书福利固定增加 30 天且不改变 `quotaBalance`。

## 稳定手机号身份

可信手机号仍复用 `server/identity-store.mjs` 的规范化流程，并以独立 `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET` 计算：

```text
campaign-phone-identity:v1|<normalized_phone>
```

结果为 32 字节 HMAC-SHA256 Buffer，版本为 `v1`。密钥不得与其他已知密钥复用。`user_phone_bindings.campaign_phone_identity_hash` 仅建立普通查询索引；活动内账号和手机号防重复由 redemption 唯一约束负责。旧绑定为 `NULL` 时只能通过再次完成可信手机号验证补齐，不能从旧 hash、masked phone、用户 ID 或客户端输入推导。

生产部署必须提供独立的 `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET`，长度至少 32 字节；建议用 `openssl rand -hex 32` 生成。不得复用 `PHONE_HASH_SECRET`、`JWT_SECRET`、`ADMIN_API_TOKEN`、`REDEMPTION_CODE_HASH_SECRET`、`BOOK_ORDER_CLAIM_HASH_SECRET` 或 `WECHAT_MINIAPP_SECRET`。一旦生产已写入手机号活动身份数据，未经审批的数据迁移方案不得轮换该密钥。

## 迁移策略

Canonical 与发布副本必须逐字一致：

- `database/migrations/007_create_book_benefit_redemption_foundation.sql`
- `server/migrations/007_create_book_benefit_redemption_foundation.sql`
- `database/migrations/008_extend_book_benefit_issuance_review.sql`
- `server/migrations/008_extend_book_benefit_issuance_review.sql`

007 创建五张最终表并为 `user_phone_bindings` 添加活动身份列；008 只扩展 campaign 的 `rules_version` 以及 issuance 的规则版本、销售方核验和客服渠道字段与查询索引。部署顺序固定为 007 后 008。

`CREATE TABLE IF NOT EXISTS` 不会修复同名残缺表，007/008 的 `ALTER TABLE` 也不是天然可重复执行。部署前必须运行迁移注释中的 `INFORMATION_SCHEMA` preflight：结构完全缺失时执行、完全精确时跳过、部分存在或定义不同时停止。发现旧模型同名结构时必须停止，不能用兼容列或动态 SQL 掩盖不一致。

## 隔离 MySQL 验收

集成脚本只允许连接 `127.0.0.1:3310` 的专用 MySQL 8.0.46 环境，使用专用环境变量和明确破坏性测试确认值，不读取通用 `DB_*`、`.env`、PM2 或生产配置。脚本只创建由严格名称模式和当前进程 owned set 保护的随机测试数据库，并在 `finally` 中清理。

验收范围包括 revised 007→008 首次执行、精确 preflight、部分/错误结构停止、旧结构不兼容识别、生成列、多 `NULL` 与唯一索引语义、同订单/同码/同账号/同手机号约束，以及 canonical/server 副本一致性。隔离测试不替代生产执行前的备份、只读 schema 核对和人工审批。

## 风险提示

bearer code 在兑换前可转交，也意味着明文泄露者可能抢先兑换。客服必须通过受控渠道交付并提醒用户尽快兑换；系统不保存明文，因此响应丢失只能查询状态或按规则补发，不能恢复原码。当前没有独立作废、批量发码、一单多码、库存或支付能力。
