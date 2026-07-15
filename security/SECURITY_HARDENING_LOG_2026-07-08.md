# 服务器网络安全排查与加固记录

项目：巴小塔 / 象形英语小程序与网站  
服务器：腾讯云轻量应用服务器 Ubuntu  
用途：网站、后台、Node API、MySQL、小程序接口  
记录日期：2026-07-08  
记录目的：排查服务器是否被入侵，确认数据库和后台接口是否存在裸露风险，并完成基础加固，方便后续继续安全加固与复盘。

> 注意：本文档不记录真实密码、数据库密码、微信小程序 Secret、JWT Secret、后台管理员密码等敏感信息。后续存档时也不要把真实密钥写入文档。

---

## 2026-07-15 生产 API 端口迁移补充

2026-07-15 已完成生产 API 服务迁移，新生产 API 服务正式接管旧服务。

本节记录当前生产状态；下方 2026-07-08 的 `3001`、`pictographic-english-api-full` 和 Nginx 反代记录保留为当日历史排查事实。

迁移前：

```text
PM2: pictographic-english-api-full
端口: 3001
状态: 旧生产服务
```

迁移后：

```text
PM2: pictographic-english-api-new
端口: 3002
状态: 当前生产服务
```

Nginx 修改：

```text
文件: /etc/nginx/sites-enabled/baxiaota.com
```

```nginx
proxy_pass http://127.0.0.1:3001;
```

已改为：

```nginx
proxy_pass http://127.0.0.1:3002;
```

验证结果：

```bash
curl http://127.0.0.1:3002/api/health
```

结果：

```text
ok=true
```

```bash
curl https://baxiaota.com/api/health
```

结果：

```text
ok=true
```

```bash
pm2 list
```

当前：

```text
pictographic-english-api-new online
```

```bash
pm2 save
```

结果：

```text
已执行成功
```

当前生产安全口径：

| 检查项 | 当前状态 |
|---|---|
| 生产 API PM2 | `pictographic-english-api-new` |
| 生产 API 本机端口 | `127.0.0.1:3002` |
| 旧生产 API PM2 | `pictographic-english-api-full` |
| 旧生产 API 本机端口 | `127.0.0.1:3001` |
| Nginx 反代 | `https://baxiaota.com/api/*` -> `http://127.0.0.1:3002` |
| PM2 进程表 | 已执行 `pm2 save` |

详细迁移记录见：

```text
docs/deployment/API_PORT_MIGRATION_2026-07-15.md
```

---

## 一、触发原因

收到腾讯云邮件/告警，提示服务器存在异常 SSH 连接风险。担心服务器、网站、后台、数据库被黑，因此进行安全排查。

---

## 二、初始风险判断

排查前发现以下风险点：

```text
SSH 端口 22 对全部 IPv4 地址开放
服务器存在大量 SSH 暴力破解失败记录
root 远程 SSH 登录开启
密码登录开启
Node API 3001 监听 0.0.0.0
MySQL 需要确认是否裸露公网
后台账号密码需要确认是否只是前端拦截，还是后端真实鉴权
```

主要风险包括：

```text
1. 公网 IP 被机器人自动扫描
2. SSH 22 被持续暴力破解
3. root 账号允许远程登录，风险较高
4. 密码登录开启，存在被爆破风险
5. Node API 监听 0.0.0.0，虽然云防火墙未开放 3001，但仍不够规范
6. 需要确认 MySQL 3306 是否公网开放
7. 需要确认后台 API 是否能绕过登录直接写入
```

---

## 三、腾讯云防火墙检查

进入路径：

```text
腾讯云控制台
→ 轻量云服务器
→ 服务器实例
→ 防火墙
```

初始规则：

| 端口 | 来源 | 判断 |
|---|---|---|
| 80 | 全部 IPv4 | 正常，网站 HTTP 需要 |
| 443 | 全部 IPv4 | 正常，网站 HTTPS 需要 |
| 22 | 全部 IPv4 | 风险较高 |
| ICMP / Ping | 全部 IPv4 | 非必要，可后续关闭 |

处理结果：

```text
将 Linux 登录 22 端口来源从“全部 IPv4 地址”改为“当前本人公网 IP/32”。
保留 80 和 443。
未开放 3001、3306、8787 等高风险端口。
```

结果判断：

```text
SSH 暴力破解入口已明显收紧。
数据库和 Node API 未从腾讯云防火墙层面对公网开放。
```

---

## 四、服务器端口监听检查

执行命令：

```bash
sudo ss -lntp
```

排查结果：

| 服务 | 原始监听情况 | 判断 |
|---|---|---|
| Nginx 80 | `0.0.0.0:80` | 正常 |
| Nginx 443 | `0.0.0.0:443` | 正常 |
| SSH 22 | `0.0.0.0:22` | 已通过腾讯云防火墙限制来源 IP |
| MySQL 3306 | `127.0.0.1:3306` | 安全，未监听公网 |
| MySQL 33060 | `127.0.0.1:33060` | 本机监听，问题不大 |
| Node API 3001 | 原为 `0.0.0.0:3001` | 后续已加固为 `127.0.0.1:3001` |

结论：

```text
MySQL 数据库没有裸露公网。
Node API 初始监听所有网卡，但腾讯云防火墙未开放 3001；后续已改为只监听本机。
```

---

## 五、SSH 登录记录检查

执行命令：

```bash
sudo grep "Accepted" /var/log/auth.log | tail -50
sudo grep "Failed password" /var/log/auth.log | tail -50
```

发现：

```text
存在大量 Failed password 记录，说明服务器确实被外部机器人持续尝试 SSH 暴力破解。
```

成功登录记录中出现的 IP 经确认是本人当前公网 IP：

```text
Accepted password for ubuntu from 本人公网 IP
```

未发现陌生 IP 成功登录。

结论：

```text
目前没有看到明确的陌生人成功登录证据。
风险主要是 SSH 暴露公网后被机器人爆破。
```

---

## 六、SSH 配置检查与加固

检查命令：

```bash
sudo sshd -T | grep -E "passwordauthentication|permitrootlogin|pubkeyauthentication|port"
```

初始状态：

```text
port 22
permitrootlogin yes
pubkeyauthentication yes
passwordauthentication yes
```

风险判断：

| 配置 | 原状态 | 风险 |
|---|---|---|
| port 22 | 默认端口 | 容易被扫描 |
| permitrootlogin yes | root 可远程登录 | 高风险 |
| passwordauthentication yes | 密码登录开启 | 存在爆破风险 |
| pubkeyauthentication yes | 支持密钥登录 | 正常 |

执行加固：

### 1. 备份 SSH 配置

```bash
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%F-%H%M)
```

### 2. 编辑配置

```bash
sudo nano /etc/ssh/sshd_config
```

将：

```text
PermitRootLogin yes
```

改为：

```text
PermitRootLogin no
```

### 3. 检查配置语法

```bash
sudo sshd -t
```

### 4. 重新加载 SSH

```bash
sudo systemctl reload ssh
```

### 5. 再次确认

```bash
sudo sshd -T | grep -E "passwordauthentication|permitrootlogin|pubkeyauthentication|port"
```

加固后结果：

```text
port 22
permitrootlogin no
pubkeyauthentication yes
passwordauthentication yes
```

结论：

```text
root 远程 SSH 登录已关闭。
密码登录暂时保留，后续配置好 SSH 密钥后再关闭。
```

---

## 七、安装 fail2ban

执行命令：

```bash
sudo apt update
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
sudo systemctl status fail2ban
```

确认状态：

```bash
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

结果：

```text
fail2ban active (running)
Jail list: sshd
```

结论：

```text
fail2ban 已安装并启动，会对多次 SSH 登录失败的 IP 进行自动封禁。
因为腾讯云防火墙已经限制 22 端口来源，目前 banned 数量为 0 属于正常。
```

---

## 八、后台 API 鉴权测试

目标：确认后台账号密码是否真的在后端生效，而不是只做了前端登录页。

测试方式：在本地 Windows PowerShell 执行。

### 1. 测试健康接口

```powershell
curl.exe -i https://baxiaota.com/api/health
```

结果：

```text
HTTP/1.1 200 OK
```

说明 API 服务正常。

### 2. 测试公开词条接口

```powershell
curl.exe -i https://baxiaota.com/api/words
```

结果：

```text
HTTP/1.1 200 OK
返回 published 词条数据
```

判断：

```text
/api/words 是小程序前台公开接口，返回 published 数据属于正常。
但后续内容变多后，需要做防爬、分页、限流、权限控制。
```

### 3. 测试登录接口

```powershell
curl.exe -i -X POST https://baxiaota.com/api/admin/login -H "Content-Type: application/json" -d "{}"
```

结果：

```text
HTTP/1.1 401 Unauthorized
{"ok":false,"message":"Unauthorized"}
```

判断：

```text
登录接口存在，空账号密码不能登录，正常。
```

### 4. 测试后台写入接口，不带 token

```powershell
curl.exe -i -X POST https://baxiaota.com/api/admin/words -H "Content-Type: application/json" -d "{}"
```

结果：

```text
HTTP/1.1 401 Unauthorized
{"ok":false,"message":"Unauthorized"}
```

判断：

```text
未登录不能访问后台写入接口。
```

### 5. 测试后台写入接口，使用假 token

```powershell
curl.exe -i -X POST https://baxiaota.com/api/admin/words -H "Content-Type: application/json" -H "Authorization: Bearer fake-token" -d "{}"
```

结果：

```text
HTTP/1.1 403 Forbidden
{"ok":false,"message":"Unauthorized"}
```

判断：

```text
假 token 不能绕过后台鉴权。
后台 API 确实在后端校验登录态，不是只做了前端样子。
```

---

## 九、后台入口检查

测试：

```powershell
curl.exe -i https://baxiaota.com/admin/
curl.exe -i https://baxiaota.com/api/health
curl.exe -i https://baxiaota.com/api/words
curl.exe -i -X POST https://baxiaota.com/api/admin/login -H "Content-Type: application/json" -d "{}"
```

结果：

```text
后台入口使用 https://baxiaota.com/admin/
API 入口使用 https://baxiaota.com/api/*
```

判断：

```text
后台统一入口是 https://baxiaota.com/admin/。
API 实际走 https://baxiaota.com/api/*。
```

---

## 十、Node API 3001 加固

### 1. 发现问题

初始检查：

```bash
sudo ss -lntp | grep 3001
```

发现：

```text
0.0.0.0:3001
```

说明 Node API 监听所有网卡。

虽然腾讯云防火墙没有开放 3001，但更规范的做法是让 Node API 只监听本机。

### 2. 检查 PM2 进程

执行：

```bash
pm2 list
pm2 describe pictographic-english-api-full
```

确认线上实际进程：

```text
name: pictographic-english-api-full
script path: /home/ubuntu/pictographic-english-app-release-20260702/server-full-20260702/server-entry.mjs
exec cwd: /home/ubuntu/pictographic-english-app-release-20260702/server-full-20260702
node env: production
```

说明：

```text
线上实际运行的是 release 目录下的 server-full-20260702/server-entry.mjs，
不是本地 D 盘项目里的 server/index.mjs。
```

### 3. 检查 Nginx 反代

执行：

```bash
sudo grep -R "proxy_pass" /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/nginx/nginx.conf 2>/dev/null
```

结果：

```text
proxy_pass http://127.0.0.1:3001/api/;
proxy_pass http://127.0.0.1:3001;
```

判断：

```text
Nginx 已经是本机反代到 127.0.0.1:3001。
因此 Node 改为只监听 127.0.0.1 不会影响网站和小程序访问。
```

### 4. 检查 PM2 环境变量

执行：

```bash
pm2 env 0 | grep -E "HOST|PORT|NODE_ENV|DB_"
```

发现原来：

```text
HOST: 0.0.0.0
PORT: 3001
NODE_ENV: production
DB_HOST: 127.0.0.1
DB_PORT: 3306
```

判断：

```text
3001 监听 0.0.0.0 的原因是 PM2 环境变量 HOST=0.0.0.0。
```

### 5. 修改 PM2 环境变量

执行：

```bash
HOST=127.0.0.1 pm2 restart pictographic-english-api-full --update-env
```

验证：

```bash
sudo ss -lntp | grep 3001
```

目标结果：

```text
127.0.0.1:3001
```

再验证线上 API：

```bash
curl -i https://baxiaota.com/api/health
curl -i https://baxiaota.com/api/words
```

结果正常。

保存 PM2 配置：

```bash
pm2 save
```

结果：

```text
[PM2] Successfully saved in /home/ubuntu/.pm2/dump.pm2
```

最终环境变量确认：

```bash
pm2 env 0 | grep -E "HOST|PORT|NODE_ENV"
```

结果：

```text
HOST: 127.0.0.1
PORT: 3001
NODE_ENV: production
```

结论：

```text
Node API 3001 已从 0.0.0.0 收回到 127.0.0.1。
公网无法直接访问 3001，只能通过 Nginx 的 HTTPS 入口访问。
```

---

## 十一、最终安全状态

| 检查项 | 当前状态 |
|---|---|
| 网站 80 / 443 | 正常开放 |
| SSH 22 | 已限制为本人公网 IP |
| root SSH 登录 | 已禁用 |
| SSH 密码登录 | 暂时开启，后续配密钥后关闭 |
| fail2ban | 已启动 |
| MySQL 3306 | 只监听 127.0.0.1 |
| Node API 3001 | 只监听 127.0.0.1 |
| Nginx 反代 | 正常，转发到 127.0.0.1:3001 |
| 后台登录接口 | 空账号密码返回 401 |
| 后台写接口 | 无 token 返回 401 |
| 假 token | 返回 403 |
| 陌生成功 SSH 登录 | 暂未发现 |
| SSH 爆破 | 曾经存在，目前已通过防火墙收紧 |

总体结论：

```text
目前没有看到明显被陌生人成功登录或数据库被入侵的证据。
服务器之前主要风险是 SSH 22 对公网开放，导致被机器人持续暴力破解。
已完成基础加固，当前服务器不再处于明显裸奔状态。
```

---

## 十二、后续待办

### P0 / 尽快做

1. 配置 SSH 密钥登录。
2. 确认密钥登录成功后关闭密码登录。

目标最终状态：

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

注意：

```text
关闭密码登录前，一定要先确认新窗口可以用 SSH 密钥登录。
不要直接改，避免把自己锁在服务器外面。
```

---

### P1 / 建议近期做

1. 轮换敏感密钥。

因为排查过程中曾在终端输出过敏感环境变量，建议后续统一轮换：

```text
数据库密码
后台管理员密码
JWT_SECRET
WECHAT_MINIAPP_SECRET
```

2. 检查是否有异常用户、后门、定时任务。

建议执行：

```bash
cut -d: -f1,3,7 /etc/passwd | sort -t: -k2 -n | tail -30
sudo ls -la /home/ubuntu/.ssh
sudo cat /home/ubuntu/.ssh/authorized_keys 2>/dev/null
sudo ls -la /root/.ssh 2>/dev/null
sudo cat /root/.ssh/authorized_keys 2>/dev/null
sudo crontab -l
sudo ls -la /etc/cron.d /var/spool/cron/crontabs 2>/dev/null
ps aux --sort=-%cpu | head -30
```

3. 数据库备份。

确保 MySQL 有每日备份，并且备份文件不要放在 Web 目录。

---

### P2 / 后续优化

1. 公开接口防爬。

目前：

```text
/api/words
```

公开返回 published 词条，这是小程序业务需要，不是漏洞。

但后续内容增加后，建议加：

```text
分页
关键词搜索限制
频率限制
登录后查看更多
核心内容权限控制
视频播放鉴权
```

2. 关闭 Ping ICMP。

腾讯云防火墙中的 Ping 规则不是必需，可后续删除，减少暴露面。

3. 自动安全更新。

后续可开启 Ubuntu 安全更新，降低系统漏洞风险。

---

## 十三、关键命令备忘

### 查监听端口

```bash
sudo ss -lntp
```

### 查 SSH 配置

```bash
sudo sshd -T | grep -E "passwordauthentication|permitrootlogin|pubkeyauthentication|port"
```

### 查 SSH 成功登录

```bash
sudo grep "Accepted" /var/log/auth.log | tail -50
```

### 查 SSH 失败登录

```bash
sudo grep "Failed password" /var/log/auth.log | tail -50
```

### 查 fail2ban

```bash
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

### 查 PM2

```bash
pm2 list
pm2 describe pictographic-english-api-full
pm2 env 0 | grep -E "HOST|PORT|NODE_ENV"
```

### 查 Nginx 反代

```bash
sudo grep -R "proxy_pass" /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/nginx/nginx.conf 2>/dev/null
```

### 验证 API

```bash
curl -i https://baxiaota.com/api/health
curl -i https://baxiaota.com/api/words
```

### 测后台接口鉴权

```powershell
curl.exe -i -X POST https://baxiaota.com/api/admin/login -H "Content-Type: application/json" -d "{}"

curl.exe -i -X POST https://baxiaota.com/api/admin/words -H "Content-Type: application/json" -d "{}"

curl.exe -i -X POST https://baxiaota.com/api/admin/words -H "Content-Type: application/json" -H "Authorization: Bearer fake-token" -d "{}"
```

---

## 十四、建议存放位置

建议文件名：

```text
SECURITY_HARDENING_LOG_2026-07-08.md
```

建议项目内存放路径：

```text
docs/security/SECURITY_HARDENING_LOG_2026-07-08.md
```

如果暂时不想放进项目，也可以先放在本地公司资料目录中，例如：

```text
D:\english-app\security-notes\SECURITY_HARDENING_LOG_2026-07-08.md
```

后续继续加固时，可以在本文档末尾追加新日期记录。
