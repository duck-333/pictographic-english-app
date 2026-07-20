# Phase 2.2 最近学习云端化验收记录

日期：2026-07-20

## 1. 功能目标

Phase 2.2 的目标是将“最近学习”从小程序本地 storage 迁移为登录账号级云端数据。

目标包括：

- 登录用户的最近学习记录跟随账号保存。
- 同一账号支持跨设备读取最近学习。
- 不同用户之间最近学习数据隔离。
- 未登录用户继续保留本机游客最近学习体验。

## 2. 当前数据架构

登录用户数据链路：

```text
微信登录
  ↓
authSession
  ↓
Authorization: Bearer token
  ↓
user_id
  ↓
user_recent_words
```

数据库表：

```text
user_recent_words
```

字段：

- `id`
- `user_id`
- `word_id`
- `viewed_at`
- `created_at`

设计说明：

- 同一个用户同一个单词只保留一条记录。
- 重复查看同一个单词时更新 `viewed_at`。
- `user_recent_words` 用于展示最近学习列表。
- `user_recent_words` 不是学习行为统计日志。

## 3. 小程序数据流程

登录状态：

```text
getAuthSession()
  ↓
判断 token
  ↓
获取 user_id
```

已登录用户查看单词：

```text
查看单词
  ↓
POST /api/user/recent-words
  ↓
MySQL user_recent_words
```

我的页面：

```text
GET /api/user/recent-words
  ↓
wordId 补全词条
  ↓
展示最近学习
```

未登录用户：

```text
pictographic:userState.recentWordIds
```

未登录用户继续使用本机游客最近学习记录，不自动迁移到账号。

## 4. API 接入

### GET /api/user/recent-words

用途：

- 获取当前登录用户最近学习。

### POST /api/user/recent-words

用途：

- 记录当前登录用户学习过的单词。

鉴权说明：

- 接口使用登录 token 鉴权。
- 小程序通过 `Authorization: Bearer <token>` 请求接口。
- `user_id` 不由前端传递，而由服务端根据 token 获取。

## 5. 验收测试记录

### 测试 1：云端写入

结果：

通过。

说明：

打开单词详情后，数据库出现对应 `word_id`。

### 测试 2：跨设备读取

结果：

通过。

说明：

同一个账号：

设备 A 学习：

- Asia
- Australia
- Inauguration
- airplane

设备 B 登录后：

- 可以正常显示最近学习。

### 测试 3：第二账号隔离

结果：

通过。

数据库验证示例：

账号 1：

- Asia
- Australia
- Inauguration
- airplane

账号 2：

- cool
- transport

结论：

两个账号数据互不影响。

## 6. MySQL 验证

验证 SQL：

```sql
USE baxiaota;

SELECT * FROM user_recent_words;
```

验证结果：

数据库存在以下字段：

- `user_id`
- `word_id`
- `viewed_at`

用户最近学习数据按照 `user_id` 隔离。

## 7. 与 Phase 2.3 学习统计的边界

当前 `user_recent_words` 只负责：

- 最近学习展示。

当前 `user_recent_words` 不负责：

- 学习次数统计。
- 学习时长。
- 学习行为分析。
- 用户画像。

未来学习统计需要独立设计，例如：

```text
learning_events
```

该边界用于避免污染最近学习表。

## 8. 当前状态

Phase 2.2 最近学习云端化已完成。

已验证：

- 登录用户云端保存。
- 跨设备读取。
- 第二账号数据隔离。
- MySQL 写入。

后续：

- 进入 Phase 2.3 学习数据统计设计。
