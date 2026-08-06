# 服务器网络安全排查与加固记录

项目：巴小塔 / 象形英语小程序与网站

用途：网站、后台、Node API、MySQL、小程序接口

> 注意：本文档不记录真实密码、数据库密码、微信小程序 Secret、JWT Secret、后台管理员密码等敏感信息。后续存档时也不要把真实密钥写入文档。

---

## 2026-07-21 JWT_SECRET 生产启动保护

### 背景

用户登录、收藏云端化、最近学习云端化已经依赖用户 JWT token。进入权益/额度/会员开发前，生产环境不能继续依赖进程内随机 fallback secret。

### 决策

- `NODE_ENV=production` 时，API 启动必须显式配置 `JWT_SECRET`。
- 如果 `JWT_SECRET` 缺失或为空，`server/index.mjs` 会在监听 HTTP 端口前失败退出。
- 开发环境仍允许不配置 `JWT_SECRET`，使用进程级临时密钥方便本地测试；该模式下重启后旧 token 失效是预期行为。
- PM2 部署必须确认进程环境中同时存在 `NODE_ENV=production` 和 `JWT_SECRET`。

### PM2 检查

部署或重启后检查：

```bash
pm2 describe <process-name>
```

确认环境变量包含：

```text
NODE_ENV=production
JWT_SECRET=<private-stable-secret>
```

不要把真实 `JWT_SECRET` 写入仓库、文档或截图。

### 验证

本地安全验证应覆盖：

```bash
npm.cmd run check:production
```

以及生产缺失密钥时的启动失败：

```bash
NODE_ENV=production JWT_SECRET= node server/index.mjs
```

预期结果：进程退出，并显示 `JWT_SECRET is required when NODE_ENV=production`。

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
---

## Node.js ESM API 入口启动规范

### 背景

2026-07-17 生产 API 部署排查过程中，发现 Node.js 服务出现启动异常。

### 现象

- PM2 显示进程 online
- 但是 3001 端口没有监听
- Nginx 访问 `/api/health` 返回 `502 Bad Gateway`
- 手动执行 `node server/index.mjs` 时，出现 `SyntaxError` 或启动异常，需要继续排查入口代码

### 最终发现

`server/index.mjs` 原入口：

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
}
```

在当前生产部署方式（PM2 + Node.js ESM）下存在入口判断不稳定风险。

生产 API 服务入口应保持：

```js
startServer()
```

原因：

- `server/index.mjs` 当前职责是 API 服务启动入口，不是通用模块库。
- PM2 负责管理进程生命周期，入口文件应该明确启动服务。
- 依赖 `process.argv` 和 `import.meta.url` 判断可能因为 PM2 启动方式、Node.js ESM 路径解析、环境差异而失效。

导致：

- 代码执行但没有监听端口
- PM2 显示 online 但实际服务不可用
- Nginx 反向代理返回 502

### 后续遇到 API 无法访问时排查顺序

以后服务器 API 异常时，按照以下顺序检查。

#### 1. 检查 PM2

命令：

```bash
pm2 list
```

确认：

- `status` 是否 online
- 是否频繁 restart

#### 2. 检查启动入口

命令：

```bash
pm2 describe <process-name>
```

确认：

- `script path` 是否正确
- `exec cwd` 是否正确
- Node version 是否正确

#### 3. 手动启动验证

进入项目目录：

```bash
node server/index.mjs
```

确认是否出现：

```text
Pictographic English API running at http://0.0.0.0:3001
```

#### 4. 检查端口

命令：

```bash
ss -lntp | grep 3001
```

正常应该看到 Node 占用 3001。

#### 5. 检查本机接口

命令：

```bash
curl http://127.0.0.1:3001/api/health
```

正常返回：

```json
{
  "ok": true
}
```

#### 6. 检查 Nginx

命令：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

然后：

```bash
curl https://baxiaota.com/api/health
```

---

## 文档使用原则

该安全文档用于记录：

- 服务器安全检查
- 部署异常原因
- 修复过程
- 后续排查方法
- 生产环境注意事项

以后遇到问题，先搜索本文档关键词，例如：

```text
API
502
PM2
nginx
MySQL
SSH
端口
部署
```

优先按照已有故障记录排查。

如果发现新的问题：

1. 先恢复服务。
2. 再补充本文件。
3. 记录原因和解决方式。

目标：

```text
让服务器维护从“依靠个人记忆”变成“可重复执行的运维流程”。
```

## 2026-07-22 生产环境恢复与稳定性验证

### 完成事项

- 修复 PM2 环境变量丢失问题。
- 恢复：
  - `JWT_SECRET`
  - DB 配置
  - 微信小程序配置
  - `PHONE_HASH_SECRET`
- 微信登录恢复测试成功。
- 用户权益接口恢复。
- 新用户登录赠送 30 次额度验证成功。

### 生产环境配置恢复经验

问题原因：

2026-07-22 部署调整过程中，误删除 PM2 应用进程。由于环境变量依赖 PM2 进程配置，重新启动后部分生产变量丢失。

影响：

- 微信手机号登录接口异常。
- 用户权益接口无法正常验证。

改进：

1. 禁止直接删除生产 PM2 进程。
2. 修改前先执行：

   ```bash
   pm2 save
   ```

3. 生产环境变量统一维护于：

   ```text
   ecosystem.config.cjs
   ```

4. 后续部署流程：

   ```text
   修改代码 -> pm2 restart/reload
   ```

   不直接 `delete`。

### 数据库

- 完成 MySQL 数据库备份。

备份文件：

```text
/home/ubuntu/backups/mysql/baxiaota_2026-07-22.sql
```

### PM2

执行：

```bash
pm2 save
```

确认：

```text
服务器重启后 PM2 自动恢复。
```

### 重启测试

执行：

```bash
sudo reboot
```

验证：

```bash
pm2 list
```

状态：

```text
online
```

执行：

```bash
curl https://baxiaota.com/api/health
```

返回：

```json
{
  "ok": true
}
```

结论：

```text
生产环境基础恢复能力验证通过。
```

## 2026-07-31 access-control 正式切换与服务器收尾记录

### 新版本与正式代理

- 新版本目录：

  ```text
  /home/ubuntu/pictographic-english-app-release-20260729-access-control
  ```

- 新版 PM2 进程：

  ```text
  pictographic-english-api-access-control-candidate
  ```

- 新版监听端口：

  ```text
  3002
  ```

- Nginx 当前正式代理：

  ```text
  /api/ -> http://127.0.0.1:3002
  ```

### 正式切换前验证

- 新版在 3002 端口独立启动测试通过。
- `/api/health` 返回 HTTP 200。
- `wordCount` 为 61。
- 新版成功连接正式 MySQL。
- 用户权限管理接口查询正常。
- 数据库切换前备份成功。
- Nginx 原配置已备份。
- 小程序体验版 1.0.6 真机验收通过。
- 登录、查词、扣次数、收藏、最近浏览、后台权益管理均正常。

### 稳定观察结果

- 新服务连续运行超过 25 小时。
- PM2 重启次数为 0。
- PM2 `error.log` 无异常。
- MySQL 和 PM2 最近 24 小时无错误。
- Nginx、公网接口和本机 3002 健康检查均正常。
- 公网无法直接访问 3001、3002、3306。
- MySQL 仅监听 `127.0.0.1:3306`。

### 旧服务处理

- 旧 PM2 进程 `pictographic-english-api-module3` 已停止。
- 旧端口 3001 已关闭。
- 公网在旧服务停止后仍正常返回 HTTP 200。
- 旧 PM2 进程已删除。

### 最终状态

- PM2 中只保留新服务。
- 已执行 `pm2 save`。
- `/home/ubuntu/.pm2/dump.pm2` 中只保存 1 个进程。
- `pm2-ubuntu` 为 enabled 和 active。
- 服务器重启后不会恢复旧服务。
- 新进程名称虽然仍带 `candidate`，但仅为显示名称，不影响运行、安全或开机恢复，暂不为改名而重启正式服务。

### 相关备份

- 数据库备份：

  ```text
  /home/ubuntu/backups/before-access-control-20260730-081955.sql
  ```

- Nginx 配置备份：

  ```text
  /etc/nginx/sites-available/baxiaota.com.before-access-control-20260730-163839
  ```

### 当前结论

```text
access-control 新版本已正式承接生产流量，旧服务已完成下线清理，PM2、Nginx、MySQL、端口防护和开机恢复状态均已验证正常。
```

## 2026-08-03 MySQL 自动备份与恢复验证

### 数据库备份配置

- 已创建 MySQL 自动备份脚本：

  ```text
  /home/ubuntu/scripts/mysql-backup.sh
  ```

- 备份目标目录：

  ```text
  /home/ubuntu/backups/mysql
  ```

- 备份数据库：`baxiaota`。
- 使用数据库账号：`app_user`。
- 已配置 cron 定时任务：每天 03:00 自动执行数据库备份。
- 备份保留策略：删除超过 30 天的旧备份。

### 备份验证

实际验证流程：

1. 手动执行备份脚本。
2. 成功生成备份文件：

   ```text
   baxiaota_2026-08-03.sql
   ```

3. 创建临时恢复数据库：

   ```text
   baxiaota_restore_test
   ```

4. 导入备份文件进行恢复测试。
5. 验证恢复结果。

恢复后的数据库包含：

- `entitlement_transactions`
- `user_entitlements`
- `user_favorites`
- `user_phone_bindings`
- `user_recent_words`
- `users`
- `wechat_user_bindings`

同时确认 `users` 表存在数据，共 4 条记录。

6. 验证完成后删除恢复测试数据库 `baxiaota_restore_test`。

### 当前服务器状态

- 系统磁盘：
  - 设备：`/dev/vda2`
  - 总容量：约 69 GB
  - 已使用：约 9.7 GB
  - 使用率：15%
- 数据库备份目录：
  - 路径：`/home/ubuntu/backups`
  - 当前占用：约 19 MB
- PM2 日志目录：
  - 路径：`~/.pm2/logs`
  - 当前占用：约 48 KB

### 安全结论

当前生产环境已具备基础数据库灾备能力：

- 自动备份已启用。
- 备份文件可正常生成。
- 备份文件已完成恢复测试。
- 数据库恢复流程验证通过。

备注：本次仅记录运维安全措施，不涉及代码逻辑调整。

## 2026-08-04～2026-08-06 后台鉴权、会员权益与数据库备份修复记录

记录日期：2026-08-06（服务器本地时间）

### 后台鉴权恢复

- 实际运行的 PM2 进程为 `pictographic-english-api-access-control`。
- 服务入口为 `/home/ubuntu/pictographic-english-app-release-20260729-access-control/server/index.mjs`，监听端口为 `3002`。
- 旧进程 `pictographic-english-api-full` 已不存在。
- 管理后台使用 Admin API Token 鉴权，并通过 `GET /api/admin/auth/check` 校验。
- 新 PM2 进程最初缺少 `ADMIN_API_TOKEN`，导致后台登录失败。
- 已生成新的随机 Admin API Token，注入 PM2 环境并执行 `pm2 save`，后台登录随后恢复正常。
- 本记录不包含 Admin API Token 的实际值。

### PM2 环境变量恢复与持久化

已检查、恢复并保存以下运行所需变量：

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `WECHAT_MINIAPP_APPID`
- `WECHAT_MINIAPP_SECRET`
- `JWT_SECRET`
- `USER_SESSION_TTL_MS`
- `PHONE_HASH_SECRET`

已确认的非敏感配置如下：

- `DB_HOST=127.0.0.1`
- `DB_PORT=3306`
- `DB_NAME=baxiaota`
- `DB_USER=app_user`
- `USER_SESSION_TTL_MS=2592000000`，即 30 天。

其余敏感变量仅记录名称，不记录实际值。恢复 `PHONE_HASH_SECRET` 后，管理后台按手机号查询用户的能力恢复正常。手机号绑定信息保存在 `user_phone_bindings` 表中，使用 `phone_hash` 和 `phone_masked`，不保存明文手机号。

### 数据库与用户数据核查

- 核查数据库：`baxiaota`。
- `users` 表共有 4 条记录，当前用户 ID 为 `4`、`5`、`6`、`7`。
- 已核查的相关表包括：
  - `users`
  - `wechat_user_bindings`
  - `user_phone_bindings`
  - `user_entitlements`
  - `entitlement_transactions`
  - `user_favorites`
  - `user_recent_words`
- 本次核查未删除或重建任何数据。
- `users.id` 类型为 `BIGINT`；`user_entitlements.user_id` 和 `entitlement_transactions.user_id` 类型为 `BIGINT UNSIGNED`。
- 当前用户 ID 均为正数，不存在负数或 `0`。
- 上述字段存在历史类型不完全一致的情况，本次未调整表结构。

### 会员赠送故障一：缺少 membership_grants 迁移

- 管理员赠送 30 天会员首次失败的根因是生产数据库缺少 `membership_grants` 表。
- 执行迁移前已完成数据库备份，并确认备份非空且包含 `Dump completed` 完成标记。
- 已审查项目内的规范迁移脚本，核对字段类型、唯一约束、索引、FIFO 叠加逻辑和安全边界。
- 已创建 `membership_grants` 表，过程中未执行 `DROP`、`TRUNCATE`、`DELETE` 或 `REPLACE`，未修改已有用户与权益数据。
- 迁移后确认：
  - `membership_grants` 表存在，初始记录数为 `0`。
  - 表包含主键、3 个唯一索引和 3 个普通索引。
  - 既有业务表记录数保持不变。

### 会员赠送故障二：MySQL DATETIME 写入格式

- 第二次失败错误为 `ER_TRUNCATED_WRONG_VALUE`，错误号 `1292`，SQL State 为 `22007`。
- 根因是 ISO 时间字符串（格式如 `YYYY-MM-DDTHH:mm:ss.sssZ`）被直接写入 MySQL `DATETIME` 字段 `membership_started_at`。
- 已在写入前通过 `normalizeDate()` 将开始时间转换为 `Date`，并使用 `membershipStartedAtDate` 作为 SQL 参数。
- 无效日期会抛出明确业务错误 `MEMBERSHIP_STARTED_AT_INVALID`。
- 已验证失败事务会完整回滚，不留下 `membership_grants` 或权益流水记录。
- 修改线上文件前已创建带时间戳的回滚备份。
- 修复后已通过 `node --check`，重启 PM2，并完成端口 `3002` 健康检查。

### 30 天会员最终验收

- 管理员固定赠送 30 天会员成功。
- `membership_grants` 产生一条 `admin_gift / granted / 30天` 记录。
- `user_entitlements` 更新为 `membership_type=monthly`、`membership_status=active`。
- `entitlement_transactions` 产生 `transaction_type=MEMBERSHIP_GRANT`、`amount=0` 的流水。
- 用户原有查词次数余额保持不变。
- 小程序刷新后可识别并展示会员状态。
- 有效会员访问完整词条时不会扣减查词次数。
- 会员开始时间与到期时间相差 `30 × 24` 小时。
- 失败事务可能已消耗 `AUTO_INCREMENT` 序号，因此出现序号间隙属于正常现象，不代表存在隐藏记录。

### 本地代码与 Git 收口

- 功能开发分支：`feature/membership-entitlements-mvp`。
- 功能提交标题：`feat: complete user entitlement management and 30-day membership grants`。
- Pull Request：`#16`。
- 已合并到 `master`，合并提交为 `7f9cc42`。
- GitHub 检查已通过，合并过程无冲突。
- 本地 `master` 已同步，归档前工作区为干净状态。

本次合并内容包括：

- 管理后台用户权益查询、额度增加与扣除。
- 管理员固定赠送 30 天会员。
- `membership_grants` 数据库迁移。
- `membership_started_at` 的 DATETIME 写入修复。
- 小程序会员状态展示。
- 有效会员查词免扣次数。
- 会员 MVP、迁移、DATETIME 回归测试及生产检查精确白名单。

已知基线问题：`npm check` 在 `scripts/test-server-word-api-link.mjs:466` 对空 `illustrationImage` 执行 `Object.keys()` 时失败；该问题已在干净 `master` 上复现，属于既有基线，本次未修改。

### MySQL 自动备份加固

当前 cron 任务为：

```cron
0 3 * * * /home/ubuntu/scripts/mysql-backup.sh >> /home/ubuntu/backups/mysql/backup.log 2>&1
```

该任务每天 `03:00` 自动执行。

原备份脚本存在以下问题：

- 定义了 `DB_USER`，但 `mysqldump` 未显式使用对应认证配置。
- 未启用 `set -e`，命令失败后仍可能继续执行。
- 失败时仍可能输出完成提示。
- 直接写入最终备份文件，可能留下不完整文件。
- 未检查文件非空及 `Dump completed` 完成标记。

认证与权限已加固：

- MySQL 客户端认证文件为 `/home/ubuntu/.my.cnf`。
- 使用 `[client]`、`user=app_user`、`host=localhost` 配置；本文不记录密码。
- `/home/ubuntu/.my.cnf` 权限已由 `644` 调整为 `600`。

新备份脚本已采用以下措施：

- 启用 `set -Eeuo pipefail` 和 `umask 077`。
- 使用 `--defaults-extra-file` 读取客户端认证配置。
- 使用 `--single-transaction`、`--quick` 和 `--no-tablespaces`。
- 先写入临时文件，失败时清理临时文件。
- 检查备份文件非空及 `Dump completed` 完成标记。
- 验证通过后原子移动为最终文件。
- 删除超过 30 天的旧备份。
- 备份脚本权限为 `700`。
- 原脚本已创建带时间戳的备份，权限为 `600`。

加固后验收结果：

- 新备份生成成功，文件约 `121 KB`，权限为 `600`。
- 文件末尾包含 `Dump completed`。
- 备份内容包含 `membership_grants`。
- 执行后未残留临时文件。
- `/home/ubuntu/backups/mysql` 目录权限为 `700`。
- 历史 `.sql` 备份文件权限均为 `600`。
- `backup.log` 权限为 `600`。

### 后续人工检查项

以下事项仅作为后续建议，本次未执行：

1. 次日 `03:00` 后检查 `backup.log`、新备份文件、文件非空状态及 `Dump completed` 完成标记。
2. 后续单独修复 `scripts/test-server-word-api-link.mjs:466` 对空 `illustrationImage` 的既有基线问题。
3. 后续部署应从已合并的 `master` 构建，避免覆盖 DATETIME 修复。
4. 在至少一个稳定版本运行完成前，不删除迁移前数据库备份、线上 `user-entitlement-store` 回滚备份和旧 MySQL 备份脚本备份。

备注：本章节仅归档已经完成的安全、部署与验收操作；未修改业务代码、配置或服务器。
