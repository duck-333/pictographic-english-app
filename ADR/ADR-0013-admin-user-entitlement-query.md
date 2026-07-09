# ADR-0013: 后台用户权益查询

Status: Accepted

Date: 2026-07-09

## 背景

当前后台已经实现内容管理、发布状态、首页推荐、媒体字段维护和管理员登录。后台用户管理尚未实现。

下一阶段手机号登录和用户权益模型上线后，后台需要支持客服和运营查看用户身份绑定、查词额度和额度流水。

ADR-0002 已确认后台应按模块扩展，不应继续把所有新能力堆进现有内容工作台。

## 问题

如果在用户数据尚未形成前建设完整后台用户系统，会产生空壳功能和范围膨胀。如果直接把用户、额度、会员、订单、VOD 权限全部塞入现有 `pages/index/index.vue`，会进一步放大当前后台单文件复杂度。

同时，后台查询用户权益会接触手机号、绑定关系和额度流水，必须明确隐私边界。

## 决策

后台用户权益查询第一版只做最小查询能力，不做完整用户运营系统。

第一版范围：

- 用户列表。
- 用户详情。
- `user_id`。
- 手机号 masked 展示。
- WeChat 绑定摘要展示。
- 注册时间。
- 最近登录时间。
- `word_lookup` 剩余额度。
- 额度流水。

第一版不做：

- 删除用户。
- 修改手机号。
- 合并用户。
- 修改会员。
- 复杂角色权限系统。
- 订单管理。
- VOD 权限管理。

后台用户权益能力必须作为后台独立模块新增，不继续塞进现有内容工作台页面。

## 方案

后台页面方向：

```text
admin-portal/pictographic-admin/pages/users/index.vue
admin-portal/pictographic-admin/pages/users/detail.vue
```

后台 API 方向：

```text
GET /api/admin/users
GET /api/admin/users/:id
GET /api/admin/users/:id/quota-logs
```

后续确认后再增加：

```text
POST /api/admin/users/:id/quota-adjustments
```

列表展示：

```text
user_id
phone_masked
created_at
last_login_at
word_lookup_balance
status
```

详情展示：

```text
user summary
identity bindings summary
quota accounts
quota logs
```

隐私规则：

- 后台不展示手机号明文。
- 后台不展示 `openid` 全量值。
- 后台不展示 `session_key`。
- 后台搜索手机号时，必须由服务端对输入手机号做标准化和 HMAC 后查询 `phone_hash`。
- API 响应只返回 masked 或摘要字段。

## 影响范围

涉及模块：

- 管理后台模块。
- 用户身份体系升级。
- 用户权益模型。
- 数据存储。

涉及未来文件边界：

- `admin-portal/pictographic-admin/pages.json`
- `admin-portal/pictographic-admin/common/api-client.js`
- 未来 `admin-portal/pictographic-admin/pages/users/index.vue`
- 未来 `admin-portal/pictographic-admin/pages/users/detail.vue`
- `server/index.mjs`
- `server/auth.mjs`
- `server/user-store.mjs`
- 未来 `server/quota-store.mjs`

涉及未来数据库：

- `users`
- `wechat_user_bindings`
- `user_phone_bindings`
- `user_quota_accounts`
- `user_quota_logs`

## 替代方案

本 ADR 仅记录最终确认方案。未采用方案不在本文件展开。

当前确认的扩展方式是在现有后台项目内新增用户权益查询模块，复用现有管理员登录和 Bearer session token。

## 后续影响

- 该模块应在手机号登录和 quota 数据形成后开发。
- 后台用户权益查询上线前，需要确认管理员 API 的鉴权失败、分页、手机号搜索和隐私字段测试。
- 如果后续增加额度调整，必须记录操作者、原因、变更前后余额和流水。
- 如果后续引入多管理员或角色权限，应新增单独 ADR。
