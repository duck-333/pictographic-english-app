# 用户认证系统部署记录

日期：
2026-07-16

## 一、今日完成内容

### 1. 用户认证系统上线

完成：

- 微信登录接口部署
- 用户 session/token 验证链路打通
- `/api/me` 用户身份验证接口验证通过

验证结果：

curl 请求：

```http
GET /api/me
```

返回：

```json
{
  "ok": true,
  "user": {
    "id": "1"
  }
}
```

### 2. PM2 环境变量整理

完成生产环境变量配置：

包括：

- `JWT_SECRET`
- `PHONE_HASH_SECRET`
- `WECHAT_MINIAPP_APPID`
- `WECHAT_MINIAPP_SECRET`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

当前生产 API：

PM2 管理：

```text
pictographic-english-api-module21
```

运行：

```text
Node.js
```

端口：

```text
3010
```

验证：

```bash
curl http://127.0.0.1:3010/api/health
```

返回：

```json
{
  "ok": true,
  "service": "pictographic-english-api"
}
```

### 3. 数据库用户体系

当前已有：

```text
users
```

作用：
保存用户基础信息。

```text
wechat_user_bindings
```

作用：
保存微信身份绑定关系。

当前验证：

登录后可以获取对应 user id。

## 二、部署过程中遇到的问题及解决

### 1. PM2 环境变量未继承

问题：

新 PM2 进程启动后缺少：

- `JWT_SECRET`
- WeChat 配置
- `PHONE_HASH_SECRET`

导致：

微信登录接口返回：

```text
WECHAT_CONFIG_MISSING
PHONE_HASH_SECRET_MISSING
```

解决：

重新整理 `ecosystem.config.cjs`。

删除旧 PM2 进程。

重新启动：

```bash
pm2 start ecosystem.config.cjs
```

确认环境变量生效。

### 2. API 端口冲突

问题：

旧服务占用了：

```text
3002
```

导致：

```text
EADDRINUSE
```

解决：

统一生产 API 使用：

```text
3010
```

并验证：

```bash
lsof -i :3010
```

确认 Node 服务监听。

### 3. 数据库连接问题

问题：

出现：

```text
USER_DB_ERROR
```

原因：

新 PM2 进程环境变量缺失。

解决：

补充：

```text
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME
DB_USER
DB_PASSWORD
```

恢复数据库连接。

## 三、当前系统状态

已经完成：

- ✅ 用户登录身份识别
- ✅ JWT token 验证
- ✅ 微信/手机号登录服务端链路
- ✅ 数据库用户表基础结构
- ✅ 生产环境变量管理

## 四、当前未完成事项

注意：

目前以下数据仍然是本地存储：

- 收藏单词
- 最近查看记录
- 查词次数统计

当前状态：

用户登录身份已经存在，

但是用户行为数据还没有绑定 `user_id`。

后续需要：

新增用户行为数据表，例如：

- `user_word_favorites`
- `user_word_history`
- `user_search_records`

并将小程序端：

```text
local storage
```

逐步迁移为：

```text
小程序
↓
API
↓
MySQL
```

## 五、下一阶段计划

1. 用户收藏数据云端化
2. 最近查看记录云端化
3. 查词次数统计云端化
4. 用户会员/权限系统开发
5. 数据看板建设

注意：

本次只记录文档，不修改任何代码。
