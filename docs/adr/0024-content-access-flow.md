# ADR-0024: 完整内容访问流程与状态转换

日期：2026-07-21

状态：Proposed

## 背景

Phase 2.3 已经确定用户权益系统的核心模型：

- `entitlement_transactions` 是权益事实流水。
- `user_entitlements` 是用户当前权益快照。
- 完整内容访问基于 Learning Object Access Model。
- 普通用户访问新的 root Learning Object 需要消耗一次额度。
- 会员有效期内访问完整内容不消耗普通额度。
- 不设计永久解锁。

本 ADR 补充完整内容访问时的端到端流程和状态转换，作为 Phase 2.3-C 进入服务端和小程序接入前的行为依据。

本 ADR 只记录架构和流程，不修改代码，不创建 migration，不修改 API 实现。

## 1. 用户进入完整 Learning Object 流程

完整内容包括：

- 象形拆解。
- 视频讲解。
- 示意图。
- 专属教学内容。

### 未登录用户

未登录用户不能访问完整内容。

流程：

```text
用户进入 Learning Object
  -> 尝试查看完整内容
  -> 小程序检查本地登录状态
  -> 未登录
  -> 不调用扣减接口或调用后得到 unauthorized
  -> 展示登录引导
```

规则：

- 未登录用户不能消耗额度。
- 未登录用户不能获得账号权益。
- 未登录用户不能依赖本地 `searchCount` 绕过权益判断。
- 未登录用户不能通过传 `user_id` 访问账号权益。

### 登录用户

登录用户查看完整内容时，必须走服务端权益判断。

流程：

```text
用户进入 Learning Object
  -> 判断是否为 root Learning Object 完整内容访问
  -> 请求 POST /api/user/content-access/check
  -> 携带 Authorization: Bearer <token>
  -> 携带 learningObjectId、clientRequestId、accessContext
  -> 服务端判断权益
  -> 返回访问结果
  -> 小程序根据结果展示完整内容或锁定状态
```

小程序只负责展示结果，不负责判断余额、扣减额度或判断会员有效性。

## 2. 服务端判断顺序

服务端处理完整内容访问检查时，应按固定顺序执行。

### 第一步：验证用户身份

服务端必须先通过：

```text
Authorization: Bearer <token>
  -> requireUserAuth()
  -> authResult.userId
```

取得当前用户身份。

规则：

- 请求体中的 `user_id` / `userId` 必须忽略。
- token 无效、缺失或过期时返回 `unauthorized`。
- 未通过身份验证时不能读取或修改 `user_entitlements`。
- 未通过身份验证时不能写 `entitlement_transactions`。

### 第二步：判断 Learning Object 是否为 root access

服务端需要确认本次请求是否代表用户主动进入新的 root Learning Object。

root access 示例：

```text
搜索 apple -> 进入 apple 完整内容
related application -> 进入 application 完整内容
recommend study -> 进入 study 完整内容
```

非 root access 示例：

```text
apple 内部展开 ap
apple 内部展开 pl
apple 内部展开 e
```

规则：

- root access 才进入权益判断和扣减流程。
- 当前 root Learning Object 内部 `decompose` 展开不重复扣减。
- `related` / `recommend` 指向新的 Learning Object 时，应作为新的 root access 重新判断。
- 不按页面路径、`word-detail` 页面、组件层级或 `word_id` 特殊规则判断扣减。

### 第三步：判断会员状态

服务端读取 `user_entitlements` 快照，判断：

```text
membership_status == active
membership_expire_at > now
```

若会员有效：

- 允许访问完整内容。
- 返回 `membership_active`。
- 不消耗普通额度。
- 不写普通额度扣减流水。
- 不产生永久解锁。

会员有效结果：

```json
{
  "allowed": true,
  "reason": "membership_active",
  "membershipExpireAt": "2026-08-21T23:59:59+08:00"
}
```

### 第四步：判断额度

若会员无效，服务端判断普通额度。

规则：

- 只使用服务端 `user_entitlements.quota_balance` 和未过期额度流水。
- 不使用本地 `pictographic:userState.searchCount`。
- 不使用 `user_recent_words`。
- 不使用 `user_favorites`。

若额度不足：

- 返回 `quota_insufficient`。
- 不写扣减流水。
- 不更新快照。

额度不足结果：

```json
{
  "allowed": false,
  "reason": "quota_insufficient"
}
```

### 第五步：写 `entitlement_transactions`

若普通用户额度足够，服务端写入 `CONTENT_ACCESS` 流水。

流水要求：

- `transaction_type = CONTENT_ACCESS`
- `amount = -1`
- `balance_after` 记录扣减后的余额。
- `root_learning_object_id` 记录本次主动进入的 root Learning Object。
- `current_learning_object_id` 记录当前 Learning Object。
- `access_context_json` 记录 root/current/relation/access_reason。
- `idempotency_key` 必填且唯一。

示例：

```text
CONTENT_ACCESS -1
root_learning_object_id = apple
current_learning_object_id = apple
access_context_json = { relation_type: "self", access_reason: "search_enter" }
```

### 第六步：更新 `user_entitlements`

写入扣减流水后，服务端在同一事务内更新快照：

```text
quota_balance = quota_balance - 1
quota_total_consumed = quota_total_consumed + 1
last_transaction_id = <CONTENT_ACCESS transaction id>
updated_at = now
```

事务必须保证：

- 写流水和更新快照同时成功。
- 写流水和更新快照同时失败。
- 不能出现只有流水或只有快照的半成功状态。

扣减成功结果：

```json
{
  "allowed": true,
  "reason": "quota_consumed",
  "remainingQuota": 29
}
```

## 3. 结果状态

### `membership_active`

含义：

- 用户已登录。
- 当前会员有效。
- 允许访问完整内容。
- 不消耗普通额度。

前端行为：

- 展示完整内容。
- 可展示会员到期时间。
- 不本地更新额度。

### `quota_consumed`

含义：

- 用户已登录。
- 当前不是有效会员。
- 普通额度足够。
- 服务端已成功扣减一次额度。

前端行为：

- 展示完整内容。
- 使用服务端返回的 `remainingQuota` 更新展示。
- 不本地自行扣减。

### `quota_insufficient`

含义：

- 用户已登录。
- 当前不是有效会员。
- 普通额度不足。
- 未扣减额度。

前端行为：

- 展示内容锁定状态。
- 提供开通会员入口。
- 提供获取免费额度入口。

### `unauthorized`

含义：

- token 缺失、无效或过期。
- 用户身份无法确认。

前端行为：

- 引导登录。
- 不展示完整内容。
- 不本地写账号权益状态。

## 4. 并发与幂等

完整内容访问会遇到重复提交：

- 用户重复点击。
- 网络重试。
- 小程序重复发送同一请求。
- 服务端超时后客户端重试。

必须通过幂等键防止重复扣减。

幂等链路：

```text
clientRequestId
  -> server normalized idempotency_key
  -> entitlement_transactions.idempotency_key UNIQUE NOT NULL
```

建议格式：

```text
content_access:{user_id}:{root_learning_object_id}:{clientRequestId}
```

规则：

- 同一用户、同一 root Learning Object、同一 `clientRequestId` 只能产生一次扣减流水。
- 重复请求命中同一 `idempotency_key` 时，不再扣减。
- 重复请求应返回与首次成功请求一致的业务结果，或返回可由已有流水和当前快照解释的幂等结果。
- 后台赠送、注册赠送、支付回调也必须使用稳定幂等键。

幂等键示例：

```text
registration_bonus:{user_id}
content_access:{user_id}:apple:{clientRequestId}
admin_grant:{admin_operation_id}
taobao_membership_grant:{admin_operation_id}
payment_membership:{payment_transaction_id}
```

并发写入要求：

- 服务端必须使用数据库事务。
- 扣减前需要读取并保护当前快照状态。
- 快照余额不能被并发请求扣成负数。
- 如果并发请求竞争同一幂等键，只允许一个请求写入流水。
- 如果并发请求使用不同幂等键，应按事务顺序逐次判断余额。

## 5. 内容加载失败边界

MVP 阶段采用简单策略：

```text
权益判断成功
  -> 扣减或会员放行完成
  -> 小程序加载完整内容
  -> 如果内容加载失败，不自动回滚额度
```

原因：

- 权益系统判断的是“完整内容访问许可”，不是内容加载成功率统计。
- 自动回滚会引入复杂的补偿和滥用风险。
- 内容加载失败可能来自网络、资源 CDN、播放器、客户端中断等多种原因，MVP 阶段不做精细归因。

MVP 行为：

- 若权益检查成功但内容加载失败，前端展示加载失败或重试提示。
- 重试同一个访问请求时必须复用同一个 `clientRequestId`，避免重复扣减。
- 如果用户重新主动进入同一个 root Learning Object 且生成新的 `clientRequestId`，服务端会按新的访问请求重新判断。

未来可扩展：

- 记录内容加载失败事件。
- 对明确的服务端内容缺失做人工补偿。
- 后台按流水和失败事件排查异常用户。
- 通过客服或后台补偿流水恢复额度。

禁止：

- 小程序本地自行恢复额度。
- 小程序本地认为加载失败就取消扣减。
- 直接删除 `CONTENT_ACCESS` 流水。

## 6. 会员过期

会员过期判断基于：

```text
membership_status
membership_expire_at
```

规则：

- 会员流水不删除。
- 会员开通、赠送和过期都应保留在 `entitlement_transactions` 中。
- 会员有效性按 `membership_expire_at` 与当前服务端时间判断。
- 会员过期后恢复普通额度规则。
- 会员期间访问过的 Learning Object 不永久解锁。

过期后访问流程：

```text
用户进入 root Learning Object
  -> 服务端检查会员
  -> membership_expire_at <= now
  -> 会员不再有效
  -> 检查普通额度
  -> 额度足够则扣减
  -> 额度不足则返回 quota_insufficient
```

如果用户仍有未过期普通额度：

- 可以继续按普通额度访问完整内容。

如果用户没有有效普通额度：

- 返回 `quota_insufficient`。
- 引导开通会员或获取免费额度。

会员过期不等同于额度过期：

- 会员状态由 `membership_expire_at` 判断。
- 普通额度由各额度流水的 `expires_at` 和快照余额判断。
- 额度过期应通过 `EXPIRE_DEDUCT` 流水记录，不应静默减少余额。

## 7. 状态转换摘要

```text
未登录
  -> unauthorized
  -> 登录引导

已登录 + 会员有效
  -> membership_active
  -> 展示完整内容
  -> 不扣普通额度

已登录 + 非会员 + 额度足够
  -> CONTENT_ACCESS transaction
  -> user_entitlements quota_balance - 1
  -> quota_consumed
  -> 展示完整内容

已登录 + 非会员 + 额度不足
  -> quota_insufficient
  -> 内容锁定
  -> 会员入口 / 获取免费额度入口
```

## 8. 后续实现前检查点

进入 Phase 2.3-C 前，需要确认：

- `clientRequestId` 由小程序生成，并在同一次访问重试中复用。
- 服务端如何校验 `accessContext`。
- 服务端事务隔离和快照锁定方式。
- 幂等命中时的响应格式。
- 内容加载失败时的前端重试策略。
- 会员过期状态是否由读时判断，还是定时任务补写 `MEMBERSHIP_EXPIRED` 流水。

本 ADR 的核心约束是：完整内容访问必须服务端判断，root Learning Object 才是扣减单位，普通额度扣减必须写流水并更新快照，会员不产生永久解锁。
