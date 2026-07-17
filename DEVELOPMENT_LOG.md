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
