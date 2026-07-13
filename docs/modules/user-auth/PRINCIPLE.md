# 用户认证模块原则

## 模块目标

用户认证模块负责建立项目自己的用户身份，并把外部 WeChat 身份和手机号身份绑定到内部 `users.id`。

当前已实现 WeChat `uni.login()` 身份登录第一版，以及 Module 1 手机号快捷登录代码链路。`user_phone_bindings` 迁移文件已创建但尚未执行；配额、会员、支付和权益系统尚未实现。

## 当前模块状态

```text
Module 1: 用户身份体系升级 - Completed
```

已完成范围：

- Module 1.1：`server/identity-store.mjs` 身份存储层。
- Module 1.2：`POST /api/auth/wechat-phone-login` 服务端手机号快捷登录 API。
- Module 1.3.1：小程序 `auth-api-client.js` / `auth-store.js` 认证能力层。
- Module 1.3.2：Mine 页面手机号授权入口。
- Module 1 收尾：手机号登录错误响应安全映射，避免向前端暴露 MySQL 原始错误 code。

未包含范围：

- 查词额度。
- 会员/VOD 权限。
- 后台用户管理。
- 支付、订单、图书激活。
- 内容访问分层。

## 业务规则

- `users.id` 是项目内部核心用户身份。
- `openid`、`unionid` 和手机号都只能作为外部身份绑定。
- 小程序不能接收 `openid`、`session_key`、WeChat app secret、数据库密码或签名密钥。
- WeChat 登录由服务端调用 `jscode2session`。
- 手机号快捷登录必须由用户主动点击 `button open-type="getPhoneNumber"` 触发。
- 手机号只能在服务端短暂处理，持久化时必须保存 HMAC-SHA256 hash 和 masked phone，不能保存明文。
- 当前 Mine 页登录建立 WeChat 身份、手机号绑定和本地 auth session，不会同步本地收藏/最近查看。
- 管理员登录和普通用户登录是两套不同身份体系。
- 管理后台必须通过管理员账号密码和服务端 session token 访问，不能作为隐藏小程序页面。

## 当前设计原则

- 小程序端只拿到项目 token 和最小 user 信息。
- 旧 WeChat 登录服务端通过 `wechat_user_bindings.openid` 查找或创建用户。
- 手机号快捷登录服务端通过 `identity-store.mjs` 集中处理 WeChat/手机号绑定、冲突判断和手机号 hash/mask。
- `users.openid` 只作为兼容字段处理，不作为身份查找来源。
- token 签名由 `server/auth.mjs` 完成，生产必须配置稳定且私密的 `JWT_SECRET`。
- 本地学习数据仍由 `user-store.js` 存在设备本地，不属于账号云同步数据。

## 为什么采用当前方案

WeChat `openid` 能让 MVP 建立用户身份，但它不适合作为长期业务主键。未来会接入手机号、配额、订单、会员、图书激活和客服查询，因此必须先把内部 `users.id` 作为稳定身份，再把 WeChat 身份作为绑定关系。

当前方案先完成最小身份链路，并把手机号作为 `users.id` 的外部绑定。这样后续查词额度、订单、会员和客服查询都可以引用稳定的内部用户身份，而不是直接依赖 `openid` 或手机号。

## 与其他模块关系

- 数据存储模块：认证依赖 MySQL `users`、`wechat_user_bindings` 和待人工执行的 `user_phone_bindings` 迁移。
- 单词内容模块：当前公开查词不强制登录；未来完整详情配额扣减会依赖用户身份。
- 管理后台模块：后台管理员登录使用同一 `auth.mjs` token 工具，但认证对象和权限边界不同。
- 视频/VOD 模块：当前视频播放不依赖认证；未来会员/付费视频不能依靠客户端裁剪，需要服务端权限。
