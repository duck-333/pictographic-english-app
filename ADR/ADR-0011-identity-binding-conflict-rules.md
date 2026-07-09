# ADR-0011: 用户身份绑定冲突规则

Status: Accepted

Date: 2026-07-09

## 背景

ADR-0003 已确认 `users.id` 是项目内部核心身份，外部身份通过绑定表连接到用户主体。

下一阶段手机号快捷登录会同时带来 WeChat 身份和手机号身份。现有系统已经可能存在只绑定 WeChat 的用户；未来也会存在手机号绑定、换微信、换手机号、客服查询和权益归属场景。

## 问题

当一次登录同时拿到 WeChat 身份和手机号身份时，可能出现以下绑定状态：

- WeChat 和手机号都没有绑定。
- WeChat 已绑定，手机号未绑定。
- 手机号已绑定，WeChat 未绑定。
- WeChat 和手机号都已绑定到同一个 `users.id`。
- WeChat 和手机号分别绑定到不同 `users.id`。

如果没有明确规则，系统可能创建重复用户、把权益发给错误用户，或者在冲突时静默合并账号。

## 决策

身份绑定冲突必须在服务端集中处理。

确认规则：

- `wechat_user_bindings.openid` 必须唯一。
- `user_phone_bindings.phone_hash` 必须唯一。
- 业务数据和权益数据只能引用 `users.id`。
- 当 WeChat 绑定和手机号绑定指向同一个 `users.id` 时，允许登录继续。
- 当只有一个绑定存在时，允许把另一个身份绑定到同一个 `users.id`。
- 当两个绑定都不存在时，创建新的 `users.id`，再写入两个绑定。
- 当 WeChat 绑定和手机号绑定指向不同 `users.id` 时，不允许静默合并，必须返回明确冲突状态。

## 方案

服务端身份解析流程：

```text
openid / unionid + phone_hash
  -> find wechat binding by openid
  -> find phone binding by phone_hash
  -> no binding:
       create users.id
       bind wechat
       bind phone
  -> only wechat binding:
       bind phone to wechat.user_id
  -> only phone binding:
       bind wechat to phone.user_id
  -> both bindings same user_id:
       update login metadata
       return existing users.id
  -> both bindings different user_id:
       return identity_conflict
```

冲突返回语义：

```text
409 identity_conflict
```

响应只允许包含安全提示和内部排查 ID，不返回手机号明文、openid、session_key 或另一个账号的敏感信息。

冲突处理原则：

- 第一版不做自动账号合并。
- 第一版不做小程序端自助合并。
- 后续如需合并，必须单独设计人工客服/后台审计流程。

幂等原则：

- 同一次登录请求重复提交时，不应创建多个用户。
- 绑定写入应依赖唯一约束和事务。
- 冲突状态重复出现时应稳定返回同一类错误。

## 影响范围

涉及模块：

- 用户身份体系升级。
- 用户权益模型。
- 后台用户权益查询。
- 数据存储。

涉及未来文件边界：

- `server/user-store.mjs`
- 未来可新增 `server/identity-store.mjs`
- `server/index.mjs`
- `server/auth.mjs`

涉及未来数据库：

- `users`
- `wechat_user_bindings`
- `user_phone_bindings`
- 未来权益表必须引用 `users.id`

## 替代方案

本 ADR 仅记录最终确认方案。未采用方案不在本文件展开。

当前确认的处理方式是：冲突时阻止登录完成并返回明确冲突状态，后续再通过单独确认的客服或后台流程处理。

## 后续影响

- 手机号登录实现必须先具备绑定冲突判断，不得先上线“只绑定手机号”的半成品。
- 后台用户详情需要能展示绑定关系摘要，用于人工排查，但不得展示敏感原始身份。
- 如未来支持账号合并，必须新增 ADR，定义合并权限、审计、回滚、权益迁移和客服流程。
- 数据库迁移必须为绑定唯一性和事务安全提供约束。
