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
