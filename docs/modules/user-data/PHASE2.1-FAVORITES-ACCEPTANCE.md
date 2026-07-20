# Phase 2.1 用户收藏云端化验收记录

日期：2026-07-20

## 功能目标

Phase 2.1 的目标是将小程序收藏功能从本地 storage 收藏，调整为登录用户账号级云端数据。

调整后：

- 收藏不再作为游客本地学习资产保存。
- 登录用户通过账号 token 访问收藏 API。
- 收藏数据写入服务端 `user_favorites` 表。
- “我的”页面登录后展示账号收藏列表。

## 数据归属规则

- 收藏数据属于登录用户账号。
- 未登录用户不能保存收藏。
- 未登录用户点击收藏时，提示“收藏功能需要登录学习账号”，并进入已有“我的”页面登录流程。
- 不进行游客收藏迁移。
- 登录前本机历史 `pictographic:userState.favoriteWordIds` 不自动导入、不合并、不关联到登录账号。

## 已完成

### 收藏功能

已完成：

- 登录后收藏单词。
- 登录后取消收藏。
- 登录后查看收藏列表。
- 详情页收藏状态按账号收藏数据同步。

### 用户隔离测试

验收记录：

账号 A 收藏：

- authentic
- Asia
- autumn

账号 B：

- 无法看到账号 A 的收藏数据。

结论：

用户数据隔离正常。

### 跨设备测试

验收记录：

- 同一账号在不同设备登录后，收藏数据可以同步展示。

结论：

收藏数据已经按账号归属，不再依赖单一设备本地缓存。

### 数据库验证

验收记录：

- `user_favorites` 表正常写入收藏记录。
- 收藏、取消收藏、重新查询收藏列表链路正常。

## 当前架构

```text
小程序
  ↓
auth token
  ↓
Node API
  ↓
MySQL user_favorites
```

当前接口：

- `GET /api/user/favorites`
- `POST /api/user/favorites`
- `DELETE /api/user/favorites/:wordId`

当前小程序涉及文件：

- `miniapp-uni/word-app1/common/user-favorites-api-client.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages/mine/index.vue`

## 验证命令

已执行：

```bash
npm.cmd run check:miniapp
```

结果：

```text
miniapp auth phone login tests passed
test:audio-schema passed
```

## 后续计划

- 最近学习云端化。
- 查询历史。
- 学习进度。
- 会员权益。
