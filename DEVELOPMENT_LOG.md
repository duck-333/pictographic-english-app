# Development Log

## 2026-07-17

### 用户数据云端化 Phase 1 文档确认

已确认 Module 2.1 用户认证层完成：

- 微信登录
- 手机号登录
- `users` 用户表
- user token
- `requireUserAuth()`
- `/api/me`

已确认当前用户行为数据仍在小程序本地 storage：

```text
pictographic:userState
```

包含：

- `recentWordIds`
- `favoriteWordIds`
- `searchCount`
- `streakDays`

已确认用户数据云端化 Phase 1 范围：

```text
user_favorites 收藏云端化
```

已新增：

- `docs/modules/user-data/user-favorites-cloud-plan.md`
- `docs/adr/0016-user-favorites-cloud-storage.md`

本次记录只涉及文档，不包含业务代码实现，不执行数据库迁移。

## 2026-07-23

### 后台用户额度管理 MVP 规划

新增后台额度管理规划。

原因：

开发测试阶段需要方便对测试账号人工增加或扣除查词额度。目前如果只能直接操作数据库，容易产生余额和流水不一致，也不利于后续排查。

当前决定：

- 采用管理员操作生成权益流水的方式管理额度。
- 管理员增加额度写入 `entitlement_transactions` 的 `ADMIN_GRANT` 流水。
- 管理员扣除额度写入 `entitlement_transactions` 的 `ADMIN_DEDUCT` 流水。
- 同步更新 `user_entitlements` 作为当前快照。
- 不直接修改 `user_entitlements.quota_balance` 作为主要方案。

本次记录只涉及开发文档，不包含业务代码实现，不创建 migration，不调整当前权益扣减逻辑。
