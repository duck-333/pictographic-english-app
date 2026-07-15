# API 服务端口迁移记录

日期：2026-07-15

## 背景

2026-07-15 完成生产 API 服务迁移，将新的生产 API 服务正式接管旧服务。

本记录只描述已完成的服务器部署状态，不包含任何真实密钥、密码或服务器私有环境变量值。

## 迁移原因

将新的生产 API 服务正式接管旧服务。

## 迁移前

```text
PM2: pictographic-english-api-full
端口: 3001
状态: 旧生产服务
```

## 迁移后

```text
PM2: pictographic-english-api-new
端口: 3002
状态: 当前生产服务
```

## Nginx 修改

文件：

```text
/etc/nginx/sites-enabled/baxiaota.com
```

修改：

```nginx
proxy_pass http://127.0.0.1:3001;
```

改为：

```nginx
proxy_pass http://127.0.0.1:3002;
```

当前生产访问链路：

```text
https://baxiaota.com/api/*
  -> Nginx /etc/nginx/sites-enabled/baxiaota.com
  -> proxy_pass http://127.0.0.1:3002
  -> PM2 pictographic-english-api-new
```

## 验证结果

1. 本机 API 健康检查：

```bash
curl http://127.0.0.1:3002/api/health
```

结果：

```text
ok=true
```

2. 生产 HTTPS API 健康检查：

```bash
curl https://baxiaota.com/api/health
```

结果：

```text
ok=true
```

3. PM2 进程状态：

```bash
pm2 list
```

当前：

```text
pictographic-english-api-new online
```

4. PM2 进程表保存：

```bash
pm2 save
```

结果：

```text
已执行成功
```

## 当前生产部署口径

- 当前生产 API PM2 进程名：`pictographic-english-api-new`
- 当前生产 API 本机端口：`3002`
- 旧生产 API PM2 进程名：`pictographic-english-api-full`
- 旧生产 API 本机端口：`3001`
- 生产外部入口仍是：`https://baxiaota.com/api/*`
- 小程序和后台不应直接访问 `3002`，仍应通过 HTTPS 域名访问。

## 边界

- 本记录不表示修改了仓库业务代码。
- 本记录不表示修改了仓库内服务器配置文件。
- 实际服务器 Nginx 和 PM2 变更已在服务器上完成，本仓库只记录部署事实。
