# 2026-07-17 生产部署恢复记录

## 背景

本次部署：

```text
pictographic-english-app-release-20260717-module3
```

目标：

```text
同步最新代码并确认生产 API 稳定运行。
```

## 遇到的问题

部署完成后：

```text
PM2 显示 online。
```

但是：

```bash
curl http://127.0.0.1:3001/api/health
```

返回：

```text
wordCount: 0
```

原因排查：

发现当前 release：

```text
server/local-data 不存在。
```

原因：

```text
server/local-data/*.json 被加入 .gitignore，不随 Git 提交。
```

因此：

```text
代码同步成功，但生产内容数据没有同步。
```

## 恢复过程

检查服务器历史备份：

发现：

```text
/home/ubuntu/pictographic-english-app-release-20260715-module2.1/server/local-data/words.json
```

存在。

确认：

```bash
wc -l words.json
```

与旧备份一致。

恢复：

复制：

```text
server/local-data
```

到：

```text
20260717-module3/server/local-data
```

## 服务恢复

执行：

```bash
pm2 restart pictographic-english-api-module3
```

检查：

```bash
pm2 status
```

确认：

```text
status: online
```

健康检查：

```bash
curl http://127.0.0.1:3001/api/health
```

结果：

```text
ok: true
wordCount: 61
```

## 经验总结

生产部署必须区分：

### 1. 代码数据

Git 管理：

- server 代码
- miniapp 代码
- 文档

### 2. 生产数据

独立管理：

- server/local-data
- MySQL 数据
- 视频/VOD 资源

不要把生产数据直接提交 Git。

## 后续发布流程规范

每次新 release：

1. 拉取 Git 最新代码
2. 检查生产数据是否恢复
3. 检查环境变量
4. 启动 PM2
5. health API 检查
6. 确认前端访问

## 文档使用方式

以后出现：

- PM2 online 但是接口异常
- 数据为空
- 新版本部署后功能缺失

优先阅读：

```text
security 目录下：

SECURITY_HARDENING_LOG
DEPLOYMENT_RECOVERY_LOG
```

根据历史问题排查。
