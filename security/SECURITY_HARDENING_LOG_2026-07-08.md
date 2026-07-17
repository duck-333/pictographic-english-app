# 服务器网络安全排查与加固记录

项目：巴小塔 / 象形英语小程序与网站

用途：网站、后台、Node API、MySQL、小程序接口

> 注意：本文档不记录真实密码、数据库密码、微信小程序 Secret、JWT Secret、后台管理员密码等敏感信息。后续存档时也不要把真实密钥写入文档。

---

## 2026-07-17 生产 API 故障排查与恢复记录

### 问题现象

访问：

```text
https://baxiaota.com/api/health
```

返回：

```text
502 Bad Gateway
```

### 排查过程

1. 检查 Node 服务。

确认：

```bash
curl http://127.0.0.1:3001/api/health
```

返回正常。

2. 检查端口监听。

```bash
ss -lntp | grep 3001
```

发现 Node 已监听：

```text
0.0.0.0:3001
```

3. 检查 Nginx 反向代理。

发现：

```nginx
proxy_pass http://127.0.0.1:3010;
```

实际 Node 服务端口：

```text
3001
```

### 修复

修改 Nginx 反向代理端口：

```text
3010 -> 3001
```

执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 验证

```bash
curl https://baxiaota.com/api/health
```

返回：

```text
ok:true
```

### 当前状态

API 服务恢复正常。

---

## 2026-07-17 Node 服务启动异常排查记录

### 问题背景

生产部署过程中，多次出现：

- PM2 显示进程 online
- Node 进程存在
- 但 3001 端口没有监听
- Nginx 访问 `/api/health` 返回 `502 Bad Gateway`

### 排查过程

发现问题集中在：

```text
server/index.mjs
```

启动入口代码：

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
}
```

该写法用于判断当前文件是否被直接执行。

但是在 PM2 启动环境中：

```text
process.argv[1]
import.meta.url
pathToFileURL(process.argv[1]).href
```

可能存在路径格式差异，导致判断条件不成立。

结果：

- Node 进程启动
- PM2 显示 online
- 但是 `startServer()` 没有执行
- HTTP 服务没有监听端口

### 临时修复方式

将：

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
}
```

修改为：

```js
startServer()
```

修改后 Node 正常监听：

```text
0.0.0.0:3001
```

验证：

```bash
ss -lntp | grep 3001
```

返回：

```text
LISTEN ... 0.0.0.0:3001
```

API 测试：

```bash
curl http://127.0.0.1:3001/api/health
```

返回：

```json
{
  "ok": true,
  "service": "pictographic-english-api"
}
```

### 后续建议

不要在生产入口文件中使用复杂的自动执行判断。

对于当前项目：

```text
server/index.mjs 即 API 唯一入口
PM2 直接启动该文件
```

因此保持：

```js
startServer()
```

更加稳定。

### 其他相关踩坑

生产修改 `server/index.mjs` 时，需要注意：

- 花括号 `{}` 是否匹配
- 对象属性后是否缺少逗号

例如：

错误：

```js
{
  PORT: 3001
  JWT_SECRET: "xxx"
}
```

正确：

```js
{
  PORT: 3001,
  JWT_SECRET: "xxx"
}
```

修改后必须先本地检查：

```bash
node server/index.mjs
```

确认看到：

```text
Pictographic English API running at http://0.0.0.0:3001
```

再交给 PM2。

### 当前结论

本次问题不是服务器资源问题，也不是 MySQL 问题。

根因：

- Node 服务入口未真正执行 `startServer()`
- Nginx 反向代理端口与 Node 实际监听端口不一致
- 手动修改生产文件时出现语法错误风险

当前状态：

```text
已恢复。
```

---

## 2026-07-17 部署流程漏洞复盘

### 暴露的问题

本次故障暴露出部署流程漏洞。

以前流程类似：

```text
改 server/index.mjs
上传服务器
pm2 restart
看 pm2 online
认为成功
```

但 PM2 online 不代表服务真的启动成功。

### 建议固定上线检查清单

以后建议固定流程：

```bash
node server/index.mjs
```

确认看到：

```text
Pictographic English API running at http://0.0.0.0:3001
```

然后：

```bash
pm2 restart xxx
ss -lntp | grep 3001
curl https://baxiaota.com/api/health
```

这四步形成上线检查清单：

1. 直接运行 Node 入口，确认入口会启动 HTTP 服务。
2. 交给 PM2 重启。
3. 检查端口真实监听。
4. 从 HTTPS 入口验证 Nginx 反代和 API 健康状态。
