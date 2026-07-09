# 单词内容模块原则

## 模块目标

单词内容模块负责把“查词 -> 单词详情 -> 象形拆解 -> 例句/同族词/首页推荐”的学习内容稳定交付给小程序用户。

当前目标不是建设完整 CMS，而是在已有 MVP 中保持内容读取边界清晰：

- 小程序页面不直接依赖原始 mock 数据。
- 后台可维护词条草稿、发布状态和首页推荐。
- 服务端公开 API 只返回可公开展示的内容。

## 业务规则

- 用户小程序只能读取 `status === "published"` 的词条。
- `draft`、`unpublished`、`archived`、`review`、`pending` 或缺失状态的内容不得通过公开 API 展示。
- 搜索结果为空时，如果远端 API 成功返回空结果，这个空结果是权威结果，不能静默回落到本地 mock。
- 本地 bundled 内容只作为开发/离线 fallback，且只在远端请求失败时显式使用。
- 单词 `id` 必须稳定，用户历史、收藏、关联词和后台推荐都依赖它。
- 单词正文、拆解卡片、例句、同族词、发音音频、示意图、视频片段都属于同一条内容记录的展示字段。
- 插图 URL 面向生产公开展示时必须是合法 HTTPS 地址，不能是 localhost、127.0.0.1、mock、blob、data 或 example 域名。

## 当前设计原则

- `miniapp-uni/word-app1/common/word-repository.js` 是小程序内容读取边界。
- `miniapp-uni/word-app1/common/content-schema.js` 是当前共享内容结构和校验边界，服务端和后台都复用或对齐它。
- 服务端 `server/word-store.mjs` 对公开读接口做 published 过滤，前端过滤只能作为补充。
- 后台内容写入通过服务端 admin API 完成，不从小程序页面写正式词库。
- 首页推荐由服务端配置和解析，小程序只读 `/api/homepage/featured-word`。

## 为什么采用当前方案

当前项目处于微信小程序 MVP 阶段，需要同时满足：

- 小程序在没有完整云端内容库时仍可运行。
- 后台和服务端已经能承接真实内容发布流程。
- 页面层尽量不感知数据来自本地 mock、开发预览桥还是生产 API。
- published 过滤必须在服务端兜底，避免草稿泄露到用户端。

因此当前采用“页面 -> repository -> public API / explicit fallback”的方式，而不是让页面直接读 `mock-data.js` 或直接拼接服务端请求。

## 与其他模块关系

- 管理后台模块：负责编辑、发布、撤下、归档词条，并维护首页推荐池。
- 数据存储模块：当前服务端内容存储在 `server/local-data/words.json`，种子数据在 `content-seed`，小程序 fallback 在 `mock-data.js`。
- 视频/VOD 模块：视频片段、发音音频和插图都是内容记录字段，由内容 schema 标准化。
- 用户认证模块：当前公开查词不依赖登录；未来配额或完整详情权限接入时，需要由认证和配额模块接管访问控制。

