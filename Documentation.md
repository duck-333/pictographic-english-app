# Documentation

### 2026-07-21: Phase 2.3 entitlement business rules planning

Decision:
- Phase 2.3 user entitlement business rules are now documented before implementation.
- Entitlement types are defined as registration bonus quota, monthly membership, and operational grants such as Taobao book purchase membership, share rewards, and admin grants.
- Registration bonus defaults to 30 complete-content accesses, with configurable expiry and no permanent unlock.
- Monthly membership allows unlimited complete-content access during the active period, does not consume ordinary quota, and does not create permanent unlocks.
- Complete-content access continues to use the Learning Object Access Model: active root Learning Object entries require entitlement checks, internal `decompose` expansion does not repeat deduction, and `related` / `recommend` navigation to a new Learning Object requires a new check.
- Quota deduction must be completed by the server; the mini program must not calculate remaining quota or membership validity locally.
- Insufficient quota should lead to a locked-content state with membership and free-quota acquisition entries.
- Taobao book purchase membership is planned as a manual customer-service and admin-grant flow with operation records.
- Backend entitlement management requirements now include querying current entitlements, viewing entitlement transactions, granting membership, granting quota, and recording operation notes.

Touched files:
- `docs/adr/0021-user-entitlement-business-rules.md`
- `docs/modules/user-data/phase-2.3-entitlement-business-plan.md`
- `Documentation.md`

### 2026-07-21: Phase 2.3 entitlement learning object access model

Decision:
- User entitlement checks are based on the user's active root Learning Object, not on simple page visits or visible page hierarchy.
- A Learning Object is any independently searchable and enterable learning unit, such as a word, root, letter decomposition, or future teaching content.
- Entering a root Learning Object through search or an equivalent active entry consumes entitlement quota for non-member users.
- Expanding decomposition content inside the current root Learning Object does not consume additional quota.
- Clicking related or recommended content enters a new Learning Object and must trigger a new server-side entitlement check.
- The entitlement model does not use permanent unlock records such as `user_unlocked_words` or `word_unlock_records`.
- Active membership allows complete-content access without quota deduction, but does not permanently unlock previously viewed Learning Objects.
- Future implementation should use Learning Object + Relation concepts, not hardcoded `word_id` rules, special cases such as `apple/pl/p`, or page-path checks.

Touched files:
- `docs/adr/0019-user-entitlement-architecture.md`
- `docs/modules/user-data/phase-2.3-user-entitlement-plan.md`
- `Documentation.md`

### 2026-07-21: production JWT_SECRET fail-closed guard

Decision:
- User session JWT signing now fails closed in production when `JWT_SECRET` is missing or empty.
- `NODE_ENV=production` requires a private, stable `JWT_SECRET` before the API starts listening.
- Development can still omit `JWT_SECRET`; the server uses a process-local temporary secret for local testing, so development tokens are intentionally invalid after process restart.
- `startServer()` validates user auth configuration during startup, before opening the HTTP port.
- `check:production` now includes a user JWT auth guard check in addition to the existing Admin API Token guard.
- PM2 deployment must pass `NODE_ENV=production` and `JWT_SECRET` through the process environment. `pm2 describe <process-name>` should be used to confirm the effective environment after restart.

Touched files:
- `server/auth.mjs`
- `server/index.mjs`
- `scripts/check-production-ready.mjs`
- `.env.example`
- `server/README.md`
- `security/SECURITY_HARDENING_LOG_2026-07-08.md`
- `Documentation.md`

### 2026-07-21: Phase 2.3 learning data architecture planning

Decision:
- Phase 2.3 is defined as learning data foundation work, not a user-facing report or dashboard feature.
- Future account-level learning data should use a layered model: behavior events -> statistical aggregation -> user state.
- `user_recent_words` remains a recent-list table only and must not be reused for learning counts, mastery, reports, quota, entitlement, or video progress.
- `user_favorites` remains a favorites asset table only and must not represent learning completion or mastery.
- Local `pictographic:userState.searchCount` and `pictographic:userState.streakDays` remain device-local lightweight state and must not be directly promoted to trusted account statistics.
- Future video learning progress should use a dedicated user progress model; word content `videoSegment` / `videoClips` remains content configuration.
- Phase 2.3 planning currently excludes Mine page statistics, learning reports, streak display, rankings, membership entitlement statistics, AI recommendations, and complex BI.

Touched files:
- `docs/adr/0018-learning-data-architecture.md`
- `docs/modules/user-data/phase-2.3-learning-data-plan.md`
- `Documentation.md`

### 2026-07-20: Phase 2.2 user recent words cloud integration

Decision:
- Logged-in users now record recent learning through `POST /api/user/recent-words` with `Authorization: Bearer <user token>`.
- Logged-in recent learning is displayed from `GET /api/user/recent-words`.
- Unauthenticated users continue to use local `pictographic:userState.recentWordIds`.
- Guest recent words are not imported, merged, or associated with a login account.
- Logged-in recent words are not written back to local `recentWordIds`, avoiding account history leakage after logout.
- `user_recent_words` stores recent-list state only: one row per `user_id + word_id`, with `viewed_at` updated on repeated views.
- `user_recent_words` is not a behavior event log, learning report table, or quota/entitlement source.

Touched files:
- `miniapp-uni/word-app1/common/user-recent-words-api-client.js`
- `miniapp-uni/word-app1/common/user-store.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages/index/index.vue`
- `miniapp-uni/word-app1/pages/mine/index.vue`
- `docs/adr/0017-user-recent-words-cloud-storage.md`
- `docs/modules/user-data/user-recent-words-cloud-plan.md`

### 2026-07-20: Phase 2.1 user favorites cloud integration

Decision:
- Mini program favorites are now account-owned learning data.
- Logged-in users read and write favorites through `GET /api/user/favorites`, `POST /api/user/favorites`, and `DELETE /api/user/favorites/:wordId` with `Authorization: Bearer <user token>`.
- Logged-in favorites are stored by the server in `user_favorites` through `users.id`.
- Unauthenticated users do not create new favorite records. Tapping the favorite button shows “收藏功能需要登录学习账号” and sends the user to the existing Mine page login flow.
- Existing local `pictographic:userState.favoriteWordIds` is not imported, merged, or associated with a login account.
- The Mine page shows cloud favorites only for logged-in users; logged-out users do not see old local favorite history.

Touched files:
- `miniapp-uni/word-app1/common/user-favorites-api-client.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages/mine/index.vue`
- `docs/adr/0016-user-favorites-cloud-storage.md`
- `docs/modules/user-data/user-favorites-cloud-plan.md`

### 2026-06-23: explicit public illustration projection

Decision:
- Public word responses now pass through `normalizePublicWord()` in `server/word-store.mjs`.
- Search, detail, and homepage featured responses explicitly include a cleaned `illustrationImage` for published words.
- Existing `words.json` records are cleaned at read time: only production HTTPS image URLs survive; HTTP, localhost, loopback, blob, data, and mock URLs become an empty image object.
- Published status filtering and all non-image word fields remain unchanged.

### 2026-06-23: production API moved to apex domain

Decision:
- Change the production mini program API base from the former admin subdomain to `https://baxiaota.com`.
- Keep all public endpoint paths unchanged: `/api/homepage/featured-word`, `/api/words`, and `/api/words/:id`.
- Keep the production admin portal on same-origin relative `/api/...` requests. Development-only API overrides and Admin Token handling remain unchanged.
- Published filtering, homepage featured-word resolution, and request timeout/error handling remain unchanged.

### 2026-06-23: optional word illustration image

Decision:
- Add optional `illustrationImage` to the shared word schema with `url`, `title`, `alt`, `provider`, `assetId`, `uploadStatus`, and `uploadedAt`.
- Treat an empty URL as no illustration. Only public HTTPS URLs are accepted; local, temporary, data, blob, mock, and example-domain addresses are rejected or normalized away.
- Reuse the existing Admin word write and public word read APIs. No upload endpoint, COS SDK, VOD SDK, dependency, or new storage service is introduced.
- The admin editor supports URL/title/alt fields, HTTPS validation, image preview, thumbnail preview, and clearing the image.
- The mini program detail page renders the illustration card between complete imagery and examples only when the normalized URL is valid. It uses `uni.previewImage` and shows a bounded load-error state.
- Published filtering and homepage featured-word resolution remain unchanged; illustration data follows the same published word record.

Future extension:
- Replace the manually entered URL with a COS upload result while retaining `provider`, `assetId`, `uploadStatus`, and `uploadedAt`.

### 2026-06-23: server-managed homepage featured word

Decision:
- Store `homepageFeatured` beside `words` in the existing server JSON payload. Word saves preserve the homepage configuration.
- Configuration fields are `featuredWordIds`, `mode`, `manualWordId`, `updatedAt`, and `updatedBy`.
- Add public `GET /api/homepage/featured-word` and Admin Token-protected `GET/POST /api/admin/homepage-featured`.
- Only published IDs can be saved. Public resolution filters status again so later unpublish/archive operations cannot leak content.
- Daily rotation uses the Asia/Shanghai calendar-day number modulo the ordered published recommendation pool; no cron job or daily write is needed.
- Manual mode uses the published `manualWordId`; if it becomes unavailable, resolution falls back to the published pool rotation.
- An empty valid pool returns `word: null, source: "empty"` rather than selecting arbitrary content.
- The admin dashboard provides published-word search, add/remove, ordering, mode selection, manual selection, saving, and current homepage preview.
- The mini program homepage no longer initializes from `TODAY_WORD_ID` or `word-study`; it hides the recommendation section when the public API returns empty or fails.

Safety:
- The mini program calls only the public homepage endpoint and filters `status === "published"` again.
- Video remains disabled. No login, membership, payment, redemption, or sharing-reward functionality is added.

### 2026-06-22: production published text API enabled

Decision:
- The mini program API base defaults to `https://baxiaota.com` in production, test, and development. Development may still use an explicitly configured local HTTP/HTTPS API for local server testing.
- API address rules:
  - `NODE_ENV=development`: use `VUE_APP_WORD_API_BASE_URL` / `UNI_APP_WORD_API_BASE_URL` / `WORD_API_BASE_URL` when explicitly configured to a valid `http(s)://` URL; otherwise use `https://baxiaota.com`.
  - `NODE_ENV=test`: use `https://baxiaota.com` and ignore local overrides.
  - `NODE_ENV=production` or missing `NODE_ENV`: use `https://baxiaota.com` and ignore local overrides.
- Reuse `GET /api/words?q=...` for search and `GET /api/words/:id` for detail. Public list responses are capped at 20 records.
- Public server reads explicitly request `publishedOnly: true`. Store normalization treats a missing status as `draft`, and strict equality excludes draft, unpublished, archived, review, pending, unknown, and missing statuses.
- The mini program filters remote payloads again with strict `status === "published"` checks.
- A normal remote empty result is authoritative and does not fall back to bundled data. Bundled published content is used only after an explicit request failure and is visibly labeled as local backup content.
- Mini program word requests time out after 7 seconds. Search and detail pages restore loading state and show distinct network-failure, empty, unpublished, and removed states.
- The admin publish/status chain remains: Admin Token check -> `POST /api/admin/words` -> server word store -> public published APIs. Publish, unpublish, and archive actions now synchronize their status to the server. No Admin Token is included in mini program code.
- The second-release text-only build keeps `ENABLE_VIDEO_MODULE = false`; no login, membership, payment, redemption, or sharing-reward work is included.

Verification:
- Server integration tests cover public exclusion of draft, unpublished, archived, review, pending, and missing status records.
- Production checks require the official HTTPS API base and require the detail-page video feature flag to remain disabled.
- WeChat must configure `https://baxiaota.com` as a request legal domain before real-device testing or release.

### 2026-06-08: admin unlock page and publish action hierarchy

Decision:
- Split the admin portal into an admin unlock card and the content workbench.
- The workbench is hidden until `GET /api/admin/auth/check` verifies the saved or entered Admin API Token.
- The admin portal stores the development token in `localStorage` as `pictographic:adminApiToken`; clicking `锁定/退出` clears it and returns to the unlock card.
- Remove the main `保存到服务器测试 API` button wording from the workbench. Server writes now happen through publishing actions.
- `发布当前词条` sets the current word to `published` and writes it to `POST /api/admin/words`.
- `撤下当前词条` sets the current word to `unpublished` and writes it to `POST /api/admin/words`.
- `发布全部本地草稿到服务器` writes each local draft as `published` to `POST /api/admin/words`, then marks local drafts as published after the server writes succeed.
- `保存全部本地草稿` and `保存为草稿` remain local-only actions.
- `归档当前词条` remains a local/admin list action for now; server archive semantics are not expanded in this round.
- This is still not a complete account system, not WeChat login, not role-based access control, and not an audit/session system. It is the minimum management password layer for the current admin API.

Reason:
- The previous token input lived inside the editing form, which made the admin token feel like a content field instead of a gate to management tools.
- The previous `保存到服务器测试 API` button made the flow look like "test first, publish second", which was confusing for production-like use.
- Publishing should be the user-facing server write action. Testing details belong in development docs, not the main admin workflow.

### 2026-06-08: minimum admin API auth guard

Decision:
- Add a minimal Bearer-token guard for `POST /api/admin/words`.
- The server reads `ADMIN_API_TOKEN`; local development can use the explicit fallback token `dev-admin-token`.
- Production fails closed: when `NODE_ENV=production`, missing/empty `ADMIN_API_TOKEN` and the default `dev-admin-token` are rejected.
- `GET /api/health`, `GET /api/words`, and `GET /api/words/:id` remain public read APIs for development mini program lookup.
- The admin frontend can save a local development token in `localStorage` as `pictographic:adminApiToken` and sends it as `Authorization: Bearer <token>` when saving to the server test API.
- This is not a complete admin login system, not WeChat login, and not role-based access control. It is only the smallest safety layer for the current admin write API.

Reason:
- The admin save API writes to `server/local-data/words.json`, so it should not stay as an unauthenticated write endpoint.
- A simple environment-configured token lets development continue without introducing a user table, sessions, OAuth, or cloud identity before the backend shape is stable.
- Production should never depend on a hardcoded default token or an empty token.

### 2026-06-07: server API production guard follow-up

Decision:
- Production word API config now uses `NODE_ENV === 'production'` as the only production switch. The mini program runtime `uni.request` must not bypass production fail-closed behavior.
- `check:production` covers production default API config, configured local HTTP API bases, and simulated mini program `uni.request` runtime.
- PR #7 accidentally removed tracked legacy `dist/assets/index-CINJZRAz.css` and `dist/assets/index-DqCEp0Mw.js` while leaving `dist/index.html` pointing at ignored local build hashes. The fix restores the previously tracked `dist` files instead of committing new build hashes.

Reason:
- Development can still use `http://127.0.0.1:3001`, but production mini program builds must wait for a filed HTTPS domain and WeChat request-domain configuration.
- `dist/` should be handled deliberately in a future cleanup; this fix only restores the repository's existing tracked-asset state and does not delete ignored local build outputs.

### 2026-06-07: minimum server API integration link

Decision:
- Add a minimal Node HTTP API under `server/` for development and server testing before the WeChat mini program has a filed HTTPS domain.
- Keep the existing local preview bridge. It remains the fastest way to sync local video/audio preview data into WeChat Developer Tools.
- Let the admin page save the current word to `POST /api/admin/words` for test publishing into the server-side local store.
- Let the mini program development runtime try the server API for words, then fall back to existing local preview/mock data when the API is unavailable.
- Do not store admin tokens or secrets in frontend code. This is not a production admin auth system.

Minimum API:
- `GET /api/health`: service status and local word count.
- `GET /api/words`: published word list, with optional `?q=keyword` filtering.
- `GET /api/words/:id`: one published word by stable id.
- `POST /api/admin/words`: development-only admin upsert for one word record.

Development flow:
- Start API from the repository root with `npm.cmd run dev:api`.
- Admin HBuilderX project: open `admin-portal/pictographic-admin`, edit a word, then click `保存到服务器测试 API`.
- Mini program HBuilderX project: open `miniapp-uni/word-app1`, run to WeChat Developer Tools, then search a word saved by the admin page.
- API test data is written to `server/local-data/words.json`, which is ignored by Git.

Production boundary:
- Local HTTP API bases such as `http://127.0.0.1:3001`, `http://localhost:3001`, and `http://SERVER_IP:3001` are development-only.
- Production must wait for a filed HTTPS domain and WeChat allowed request domain configuration.
- `npm.cmd run check:production` now also verifies that production or unknown runtime does not enable local HTTP API bases.
- Existing media guards still block `127.0.0.1`, `localhost`, `mock-cloud://`, `blob:`, `data:`, and example URLs in production content paths.

### 2026-05-25: homepage search hero layout
- Move the home search box lower inside the hero so the title area and search action have more breathing room.
- Use a dark search base (`#09314F`) and a warm search button (`#FFAB50`) to make search feel like the primary action.
- Show recent history as a semi-floating overlay attached to the search box instead of pushing the study card and other home content downward.
- Use one shared search overlay with two states:
  - no input -> recent history
  - typed input -> suggested results
- Do not render a separate search-results block in the page body anymore.

### 2026-05-24：首页搜索作为第一主入口

决策：
- 首页首屏强化搜索框，把它设计成用户第一眼能理解的主操作区。
- 热门搜索不再作为首页正文或搜索下拉内容展示，减少首屏干扰。
- 最近查看不再作为正文常驻模块展示，改为用户点击搜索框后出现的搜索下拉内容。
- 最近查看右侧提供“清除历史记录”入口，点击后直接清空最近查看，不弹二次确认，不删除收藏、昵称、反馈等其他本地数据。
- 搜索下拉内容仍复用现有本地最近查看数据，不新增后台结构、不改 preview bridge。

原因：
- 首页默认状态更干净，用户更容易理解“先输入一个英语单词开始查词”。
- 最近查看本质上是搜索辅助信息，放到搜索动作之后出现，比常驻在首页更符合查词路径。
- 第一版 MVP 先稳定“搜索 -> 详情 -> 视频/拆解/我的”的主链路，避免首页堆太多未闭环入口。

### 2026-05-18：本地 mock 视频闭环方案

决策：
- 小程序用户端优先读取词条的 `videoClips` 数组；如果没有 `videoClips`，但存在旧字段 `videoSegment` 或 `video`，则在 `content-schema.js` 中兼容成一个视频片段。
- 当前只在 `miniapp-uni/word-app1/common/mock-data.js` 给 `study` 配置本地 mock 视频片段，用于验证“详情页展示视频片段列表 -> 点击片段 -> 跳到 startSec 播放 -> 到 endSec 暂停”的客户视角闭环。
- mock 数据结构保持和后台导出的 `videoClips` 一致，字段包含 `clipId`、`title`、`segmentTitle`、`focus`、`targetPart`、`note`、`url/videoUrl`、`startSec`、`endSec`、`provider`、`assetId`、`storagePath`。
- mock 视频地址使用外部 HTTPS 测试视频；微信开发者工具本地预览时如果被合法域名限制拦截，需要临时关闭域名校验或替换成已配置合法域名的视频地址。
- 当前不接云服务器、不做真实上传、不改后台页面；后续接云端时优先替换 `word-repository.js` 的数据来源，让页面继续读取统一的 `word.videoClips`。

原因：
- 这样可以先验证用户端学习体验，不被云存储、合法域名、上传鉴权和视频成本拖慢。
- `videoClips` 可以支持同一个视频截多个片段，也可以支持不同视频片段组合到同一个词条。
- 页面层只依赖统一后的 `videoClips`，未来从 `mock-data.js` 迁移到 `content-seed`、uniCloud 或其他数据库时，不需要重写详情页交互。

### 2026-05-07：管理后台必须独立，不放进用户小程序

决策：
- 不在 `miniapp-uni/word-app1` 中注册内容录入、词库管理、资料管理等后台页面。
- 用户小程序只做查词、详情、我的、反馈等学习闭环。
- 后台后续新建独立项目，优先按 HBuilderX + uni-admin / uniCloud 管理后台路线推进。
- 小程序未来只读取已发布内容；新增、编辑、发布内容只能由管理员后台完成。

原因：
- 如果把后台入口放进用户小程序，普通用户可能访问或逆向发现管理入口，存在内容被误改或恶意提交的风险。
- 后台需要管理员登录、角色权限、审计和发布流程，这些不应混在面向用户的小程序里。
- 前后台分离后，后续接云数据库、账号体系和视频资料管理会更清晰。

### 2026-05-08：新增 `admin-portal` 独立后台骨架

决策：
- 新增 `admin-portal/README.md`，说明后台不是用户小程序的一部分，并记录 HBuilderX 新建后台项目步骤。
- 新增 `admin-portal/AdminRoadmap.md`，拆分后台骨架、管理员权限、单词管理、视频片段、缺词反馈五个阶段。
- 新增 `admin-portal/AccessControl.md`，定义 `admin`、`editor`、`reviewer` 三类后台角色。
- 新增 `admin-portal/DataFlow.md`，说明当前本地数据流和未来云数据库数据流。
- 更新 `.gitignore` 和 `AGENTS.md`，避免未来后台项目的 HBuilderX 产物、依赖目录进入版本管理。

原因：
- 用户确认后台不能从小程序进入，因此必须把后台作为独立项目管理。
- 先写清楚权限和数据流，比马上写一个没有真实权限的假后台更安全。
- 后续在 HBuilderX 新建 `pictographic-admin` 时，可以按 `admin-portal` 文档一步步落地。

### 2026-05-07：最小后台方案先落地为“内容种子 + 校验工具”

决策：
- 暂时不直接接真实云数据库，避免在前台查词链路还在快速变化时增加服务器和云配置复杂度。
- 新增 `content-seed/words.example.json` 作为后台录入后的目标数据形态。
- 新增 `content-seed/word-entry-template.json` 作为单词录入模板。
- 新增 `scripts/validate-content.mjs` 和 `npm.cmd run validate:content`，录入内容先通过校验，再进入小程序或未来云数据库。
- 稳定测试命令已同步到 `AGENTS.md`，后续代理不用每次重新问。

原因：
- 后续会有几千个单词，先把数据标准和校验器做好，比马上做漂亮后台页面更稳。
- 这个方案不会产生云费用，也不会影响当前 HBuilderX 预览。
- 未来接 uniCloud 时，可以把 `content-seed` 的结构映射到云数据库集合。

## 当前项目状态

- 仓库根目录：`F:\Word Learning App(Clone)\pictographic-english-app`
- 当前小程序主目录：`miniapp-uni/word-app1`
- 当前运行方式：HBuilderX 打开 `word-app1`，运行到微信开发者工具。
- 当前数据方式：本地 mock 数据。
- 当前后端状态：未接后端，未接正式云服务。
- 当前账号状态：未做正式账号体系。
- 当前视频状态：后台已开始支持本地视频预览打点和 `videoClips` 多片段录入演练；未接真实云上传和用户端多片段连续播放。

## 当前已知事实

- 根目录是 React/Vite demo 和参考资料。
- `miniapp-uni/word-app1` 是目前应该继续开发的小程序项目。
- `miniapp-uni/word-app1/unpackage` 是 HBuilderX 编译产物，不应手写维护。
- 微信开发者工具如果直接打开源码目录，容易出现 `app.json` 找不到或空白页面。
- 微信开发者工具如果记住了旧的编译模式或启动页，可能继续打开已从 MVP 入口移除的页面，例如 `pages/network/index`，导致 `index.wxml/index.wxss` 找不到。
- 杀毒软件实时监控项目目录会拖慢 HBuilderX 编译；只把项目目录加入排除名单通常可以接受，但不要排除整盘或下载目录。

## 重要决策记录

### 2026-05-06：建立项目记忆文档

决策：
- 新增 `AGENTS.md`、`Prompt.md`、`Plan.md`、`Documentation.md`。
- 稳定规则写入 `AGENTS.md`。
- 产品目标写入 `Prompt.md`。
- 阶段拆解和验收写入 `Plan.md`。
- 当前状态和决策写入 `Documentation.md`。

原因：
- 项目已经进入跨会话、跨工具、跨角色协作阶段。
- 只靠聊天记录容易丢上下文。
- 长任务需要让主代理、子代理、测试和审查读取同一套事实。

### 2026-05-06：当前不新增复杂依赖

决策：
- 小程序 MVP 阶段尽量不新增 npm 依赖。
- 不新增 UI 框架、视频 SDK、富文本解析库、状态管理库，除非用户批准。

原因：
- 用户是开发新手，依赖越多越难排错。
- 微信小程序包体积、兼容性和审核都有额外风险。
- 当前需求可以先用 uni-app / 微信小程序内置能力完成。

### 2026-05-06：先本地 mock，再接云

决策：
- 当前查词、详情、学习记录先使用本地 mock 和本地存储。
- 后台、账号、云端收藏、视频资料管理放到后续阶段。

原因：
- 先验证核心学习体验。
- 避免过早购买服务器或引入高成本云架构。
- 后续可按 openid / 登录账号逐步迁移。

### 2026-05-06：采用小块开发和并行审查

决策：
- 后续开发按“小块开发 -> 并行审查 -> 验证 -> 更新记忆”的节奏推进。
- 每完成一个功能块，启动一个审查子代理只读审查本块改动。
- 允许清理冗余代码，但必须遵守 `AGENTS.md` 的删除安全规则。
- 连续完成多个功能块或上下文过长时，提醒用户压缩上下文或重新开窗口。

原因：
- 项目对新手来说已经足够复杂，小步推进更容易定位问题。
- 并行审查能及时发现误改目录、引入依赖、破坏运行路径等风险。
- 及时更新记忆文档，可以让新窗口和后续代理继续接上项目状态。

### 2026-05-06：首版底部导航只保留查词和我的

决策：
- MVP 首版底部导航只保留“查词”和“我的”两个入口。
- 单词详情页作为查词流程的子页面保留，但不作为底部入口。
- 关系网、单词库、课堂只作为隐藏占位页注册，避免微信开发者工具旧启动页缓存导致白屏；不作为用户入口。
- 更多 icon 和复杂导航放到后续迭代版本。

原因：
- 首版目标是先把查词和个人学习记录做好并上线。
- 过早加入多个入口会分散开发和测试精力。
- 小程序审核和用户体验都更适合先做清晰、稳定的核心闭环。

### 2026-05-06：旧页面注册为隐藏占位页以防微信工具白屏

决策：
- `pages/network/index`、`pages/word-list/index`、`pages/classroom/index` 暂时保留在 `pages.json` 中。
- 这些页面不放进 `NAV_ITEMS`，所以底部导航仍然只有“查词”和“我的”。
- 如果微信开发者工具误启动旧页面，占位页会显示“回到查词”，不会因为找不到 `wxml/wxss` 白屏。

原因：
- 微信开发者工具可能缓存旧的启动页，例如 `pages/network/index`。
- 用户当前是开发新手，开发阶段优先保证“不白屏、能回家”，比完全不注册旧页面更稳。

### 2026-05-06：先修 study 拆解点击闭环

决策：
- 本轮先修查词闭环，不做大范围 UI 重绘。
- `study` 详情页的 `s`、`tud`、`y` 拆解卡可以进入下一级卡片。
- `tud` 详情页继续拆成 `t`、`u`、`d`，并且这三个字母卡也可以进入详情。
- 首页继续保留“今日象形词 study”作为示例入口，但搜索框仍然是主入口；后续有更多词后再做轮换。
- 小程序模板里避免 `@tap="openDetail(item.id)"`、`@focus="focused = true"` 这类内联表达式，改用显式事件处理函数和 `data-*` 参数。

原因：
- 用户需要先看到“搜索 -> 单词卡 -> 拆解卡 -> 下一级卡片”的真实学习路径。
- 首页示例卡能帮助新用户理解产品，但不应替代搜索主链路。
- 之前出现过 `e0/e1` 和详情页空白报错，显式事件处理更适合微信小程序编译环境。

### 2026-05-06：主链路暂时不用自定义 Vue 组件

决策：
- `pages/index/index.vue`、`pages/word-detail/index.vue`、`pages/mine/index.vue` 暂时不再引用 `components/EmptyState.vue` 和 `components/BottomNav.vue`。
- 空状态和两项底部导航先写成页面内原生结构。
- 共用样式放到 `miniapp-uni/word-app1/App.vue`。
- `components` 目录保留，不批量删除，等主链路稳定后再决定是否重新组件化。

原因：
- 微信开发者工具出现 `TypeError: Object(...) is not a function at EmptyState.vue`，导致 `pages/index/index` 未注册并白屏。
- 当前优先级是让“首页 -> 搜索 study -> 详情卡 -> 拆解下钻”稳定跑通。
- 对新手开发阶段来说，少一层组件编译风险，比过早抽象更重要。

### 2026-05-06：word-app1 使用 Vue2 版 uni-app 入口

决策：
- `miniapp-uni/word-app1/main.js` 使用 `import Vue from 'vue'`、`App.mpType = 'app'`、`new Vue({ ...App }).$mount()`。
- 不使用 Vue3 的 `createSSRApp` 入口，除非后续明确把整个 `word-app1` 升级为 Vue3 项目。

原因：
- 当前 HBuilderX 编译出的 `mp-weixin/common/vendor.js` 是 Vue2 版 uni-app 运行时。
- Vue3 入口会导致页面实例缺少 `$mp`，微信开发者工具在 `onLoad` 执行 `this.$vm.$mp.query = query` 时会报 `Cannot set property 'query' of undefined`。
- 入口和运行时必须保持一致，否则页面会出现白屏、详情页无法加载等连锁问题。

### 2026-05-07：我的页先做本地数据闭环

决策：
- 我的页第一版使用本地缓存展示头像昵称、查词次数、最近查看、收藏单词、缺词反馈和清除记录。
- 缺词反馈提交后，不只显示数量，也在我的页展示最近反馈记录、页码提示、提交日期和“待补充”状态。
- 缺词反馈单词格式限制为英文单词，长度不超过 45 位。
- 暂不接账号、openid、云数据库和消息通知；后续接云端时复用当前本地数据结构。

原因：
- MVP 阶段先证明用户能查词、收藏、留下反馈，避免一开始被账号和云端复杂度拖慢。
- 用户主动提交缺词后需要看到反馈记录，否则会感觉“点了没反应”。
- 本地闭环跑稳后，再接云同步和管理后台更安全。

### 2026-05-07：先建立后台数据契约和前台仓库接口

决策：
- 新增 `BackendDataModel.md`，记录后台最小数据模型、管理页面清单和视频片段字段。
- 新增 `miniapp-uni/word-app1/common/content-schema.js`，定义内容集合名、发布状态、单词草稿、视频片段和基础校验。
- 新增 `miniapp-uni/word-app1/common/word-repository.js`，让首页、详情页、我的页相关数据先通过统一仓库读取。
- 当前仓库仍读取本地 `mock-data.js`，不接真实云服务，不新增依赖，不影响离线运行。
- 后续接 uniCloud / 云数据库时，优先替换 `word-repository.js` 内部实现，尽量不重写页面。

原因：
- 后续会录入几千个单词，不能长期把内容写死在小程序页面或散落文件里。
- 后台要能编辑大段释义，数据结构必须提前预留 `richTextHtml` / `pictograph` 这类可编辑字段。
- 先建立数据边界，再优化 UI，可以避免漂亮页面做好后又被后台接入推倒重来。

### 2026-05-08：后台词条列表改为字母折叠目录

决策：
- 后台左侧词条列表从 A-Z 方块筛选，调整为 26 个字母纵向折叠目录。
- 每个字母行显示该分类下当前匹配的词条数量，可展开查看词条，可再次点击收起。
- 搜索框保留；搜索时自动展开有匹配词条的字母，避免用户搜到内容但列表折叠看不见。
- 词条行按内容类型做视觉区分：字母、词根、单词分别使用不同标签和颜色。
- 编辑区新增“内容类型”选择，避免后续几千个词条只靠长度和拆解数量自动猜类型。
- 后台校验要求单词 ID 和单词展示名必须以英文字母开头，避免出现统计到了但不在 A-Z 目录里显示的隐藏词条。
- 如果历史本地草稿里已有非 A-Z 开头的异常词条，后台会临时显示“其他”分组，方便先点进去修正；正常录入仍按 A-Z 管理。

原因：
- 后续会录入几千个词条，单纯卡片列表会越来越难找。
- 字母折叠目录比方块筛选更接近用户提供的参考图，也更适合大量内容管理。
- 字母、词根、单词需要在后台一眼分清，避免内容录入时把节点类型混在一起。
- A-Z 目录天然要求英文首字母，录入阶段就限制格式，比后期清理异常数据更省心。

### 2026-05-08：后台加入批量导入和视频元数据

决策：
- 后台新增“批量导入”区域，支持粘贴 `{ "words": [...] }` 或 `[...]` 格式 JSON。
- 批量导入内容默认保存为草稿，不直接发布；已有 ID 更新，新 ID 新增。
- 更新已有词条时采用保守合并：导入里的空字段不会清空旧字段，避免只导入部分字段时误删拆解、音标、视频等内容。
- 词条模型增加 `video` 字段，先记录 `url`、`title`、`startSec`、`endSec`，不在本地后台直接上传视频文件。
- 导入时校验视频时间点：开始秒/结束秒必须为非负数字，结束秒不能小于开始秒。
- 新增 `admin-portal/ImportWorkflow.md`，记录“书本/Markdown/Excel -> AI -> JSON -> 后台导入”的内容生产流程和 AI 提示词模板。

原因：
- 未来会录入几百到几千个词条，不能靠后台一个个手填。
- Word 原稿适合作为内容来源，但不适合直接一键入库；先转成 Markdown/Excel/JSON 更容易校验。
- 视频成本和体积都高，MVP 先存视频地址和时间点，后续再接云存储或对象存储。

### 2026-05-18：后台视频改为“视频资产 + 多片段列表”方向

决策：
- 后台词条保留旧字段 `video` 作为兼容字段，指向第一个可播放片段。
- 新增 `videoClips` 作为真正的多片段列表，一个词条可以关联同一个视频的多段，也可以关联不同视频的多段。
- 当前后台页面里，`form.video` 表示“正在打点/待添加的当前片段草稿”，点击“添加当前片段”后写入 `form.videoClips`。
- 每个片段新增 `focus`、`targetPart`、`note`，用于说明这段具体讲什么、关联哪个拆解节点、用户端应该看到什么提示。
- 后台右侧新增“用户视角连续预览”，用时间轴模拟多个片段按顺序播放时的讲解结构。
- 当前阶段不先做完整可复用视频库，先把单词卡片的多片段录入闭环跑通；未来再把 `videoAsset`、`videoClip`、`clipRefs` 拆成独立集合。

原因：
- 用户经常需要展示一个视频里的开头 10 秒和中间 30 秒，单个 `startSec/endSec` 不够用。
- 一个单词卡片可能需要两个不同视频的片段，一个视频也可能服务多个单词卡片。
- 如果所有片段都叫“cold 的象形讲解”，用户不知道当前在看 c、col 还是 d；片段级标题和焦点能避免讲解路径混乱。
- 先用 `videoClips` 数组落地，后台操作更直观，也不会马上推翻小程序旧读取逻辑。

### 2026-05-18：后台管理员上传视频的用户旅程

目标用户：
- 内容管理员，不一定懂代码，核心任务是把一个词条的文字、拆解节点和讲解视频片段整理成可发布内容。

当前推荐流程：
- 找词：在左侧词条列表搜索或按字母展开，先确认正在编辑的词条。
- 补文字：检查单词、音标、中文释义、一句话讲解和拆解卡片。
- 选视频：选择本地视频文件，在后台预览中定位开始秒和结束秒。
- 标片段：每个片段必须填写片段标题、讲解焦点、关联拆解节点和用户端提示说明。
- 组顺序：把同一词条需要的多个片段按用户观看顺序排列，可来自同一个视频或不同视频。
- 预览：用“用户视角连续预览”检查片段衔接是否清楚，确认用户知道当前讲的是哪一块。
- 发布：先保存草稿，确认预览无误后再发布当前词条。

产品优化方向：
- 左侧词条栏要优先保证单词完整可读，释义最多两行，不再把 `camel`、`cold` 这类词截成 `ca...`。
- 视频片段区应更像“剪辑清单”，而不是一组散落输入框；管理员需要看见每段的标题、焦点、节点、视频来源和时间范围。
- 后台需要持续降低“点错词、覆盖旧片段、忘记保存、片段标题重复”的风险，后续可增加未保存提醒、重复片段提示和发布前检查清单。
- 视频片段保存规则收紧：`videoClips` 必须有可播放来源（`url`、`assetId`、`storagePath` 或运行态 `localPreviewUrl`），不能只靠 `fileName` 当作有效片段。
- “清除视频资产”应同时清空 `video` 和 `videoClips`，避免管理员以为已清除但保存后旧片段又同步回来的误解。

### 2026-05-11：后台批量导入改为“未上传待检查队列”

决策：
- 后台批量导入支持两种入口：选择 `.json` 文件，或复制粘贴 JSON 文本。
- 新增“一键清除”只清空导入输入框，不影响已经保存的词条。
- 批量导入不再直接写入已上传草稿库，而是先进入左侧“未上传”列表。
- 左侧词条列表分为“已上传”和“未上传”：已上传表示当前本地草稿库，未上传表示刚导入、等待人工检查的队列。
- 未上传词条可以逐条点开，在右侧编辑区检查和修改。
- “批量加入草稿”只把未上传队列合并到已上传草稿库，不等于最终发布。
- 顶部“发布全部草稿”仍然是最终发布动作，并且会二次确认。

原因：
- 用户未来可能一次导入几十到几百个词条，直接进草稿库会很难区分哪些已经人工检查。
- “未上传 -> 草稿 -> 发布”三段式更接近真实内容生产流程，能减少 AI 生成内容直接上线的风险。
- 文件上传入口比只靠复制粘贴更适合批量 JSON 文件，但仍保留粘贴入口，方便调试和小批量试跑。

### 2026-05-12：合并两个 Codex 工作树的救援改动

决策：
- 两个工作树的未提交现场先分别保存为救援分支：`codex/rescue-3b4d-20260512` 和 `codex/rescue-4eb4-20260512`。
- 新建整合分支 `codex/merge-rescued-worktrees-20260512`，以 `4eb4` 的后台交互为底，保留左侧字母折叠目录和“未上传 -> 草稿 -> 发布”流程。
- 从 `3b4d` 补回 JSON 导入容错：支持 `{ "words": [...] }`、数组、单个词条对象，并允许单条复制时末尾多一个逗号。
- 从 `3b4d` 补回保守合并规则：导入对象没有提供的字段不会覆盖旧内容，视频时间点支持从 `video.startSec/endSec` 或顶层 `startSec/endSec` 读取。
- 从 `3b4d` 补回 `content-seed/letter-c-import.json`，作为第三课字母 C 的批量导入样例。

原因：
- 后一个工作树包含更符合用户最新想法的后台列表交互，前一个工作树包含更稳的导入解析和 C 课数据，两边都不能丢。
- 先救援提交再整合，可以避免继续手动复制时把某一边改动覆盖掉。

## 风险清单

- 运行目录风险：HBuilderX、微信开发者工具、GitHub Desktop 看起来都打开了项目，但可能不是同一个目录。
- 启动页缓存风险：微信开发者工具可能沿用旧编译模式打开 `pages/network/index` 等未注册页面；应切回“普通编译”或显式启动 `pages/index/index`。
- 编译产物风险：误改 `unpackage` 后，下一次编译会被覆盖。
- 编码风险：PowerShell 可能显示中文乱码，不一定代表文件真实损坏；以 HBuilderX 和微信开发者工具显示为准。
- 依赖风险：随便安装包会增加包体积、构建问题和维护成本。
- 云成本风险：视频资料多时，主要成本来自存储和流量，不是普通数据库。
- 内容生产风险：5000 个词的视频时间点和讲解资料录入工作量很大，需要后台和打点工具。

## 下次继续时先做什么

1. 先打开 `Plan.md`，确认当前阶段。
2. 如果继续小程序页面开发，优先检查 `miniapp-uni/word-app1` 是否能在 HBuilderX 跑起来。
3. 如果页面报错，先看微信开发者工具 Console，再看 HBuilderX 编译日志。
4. 如果要开长任务，先写清本次目标和允许改的文件，再分配子代理。
### 2026-05-15：项目结构交付级整理检查

决策：
- 当前仍采用一个 Git 仓库管理小程序、后台、内容数据和校验脚本。
- 新增 `scripts/audit-project.mjs`，用于检查真实小程序和后台入口、页面路由、本地引用和静态资源引用。
- `scripts/validate-content.mjs` 支持一次校验多个内容文件。
- 根目录 `package.json` 新增 `npm.cmd run check` 作为当前交付前的统一轻量检查入口。
- 修正 `content-seed/letter-c-import.json` 的拆解项字段，使其与 `letter-c-import-paste-ready.json` 一样符合当前内容结构。

原因：
- 项目里仍有早期 React/Vite demo、外层旧 `miniapp-uni` 和已跟踪 `dist`，这些属于历史/参考区域；按照项目安全规则，暂不批量删除。
- 在不批量删除文件的前提下，先把真实交付入口和可重复检查命令固定下来，降低后续误改旧项目或错误目录的风险。
- 后续如需物理清理历史目录，应先列出清单，由用户手动确认后逐项处理。

### 2026-05-15：视频上传先做真实流程演练，不直接购买云服务器

决策：
- 后台 `admin-portal/pictographic-admin` 增加视频上传演练流程：选择本地视频、校验格式和大小、显示上传进度、生成视频资产 ID、未来存储路径和播放地址占位。
- 当前演练使用 `mock-cloud://` 地址和 `local-upload-rehearsal` provider，不会把视频文件真正写入云端。
- 小程序详情页接入真实 `video` 组件：当词条有 `https://` 视频地址时直接播放；当只有上传演练资产信息时显示“待接入”状态。
- 内容结构支持从后台 `video` 字段映射到小程序 `videoSegment` 字段，后续接云存储时不用重做词条结构。

原因：
- 用户希望提前跑通“后台上传视频 -> 保存视频信息 -> 小程序播放”的真实操作链路，先暴露文件格式、大小、字段保存、播放地址、合法域名等卡点。
- 当前阶段不需要云服务器；真正上线更适合使用云存储/对象存储保存视频文件，再把可播放 HTTPS 地址或云文件临时链接写入词条。
- 只有在需要自建上传接口、转码服务、权限服务时，才考虑云服务器。
## 2026-05-19：后台到小程序本地预览桥

- 本地预览里，`mock-cloud://` 只是后台上传演练生成的占位地址，不能被小程序 `video` 组件直接播放。
- 只有后台当前会话还持有 `blob:`/`data:` 本地视频预览地址时，桥接脚本才能把视频文件临时写入 `content-seed/dev-preview-videos`，并替换成 `http://127.0.0.1:8787/videos/...`。
- 为了避免浏览器把大视频转成 base64 时卡死，本地桥当前只临时写入 80MB 以下的视频；超过 80MB 时只同步词条和片段信息，视频仍会显示待同步源。
- 浏览器刷新、重新打开后台或切换机器后，出于浏览器安全限制，后台无法自动重新读取用户本机 MP4；这时词条和时间点仍可同步，但视频本体不会同步。
- 如果小程序显示“待同步源”或仍看到 `mock-cloud://` 占位状态，需要在后台重新点击“选择文件”，选择同一个本地视频，再点击“同步到小程序预览”或“同步全部词条”。
- 正式上线时不能依赖本地桥，也不能下发 `mock-cloud://`；需要把视频上传到云存储/对象存储，并在 `videoClips` 中写入可播放 HTTPS 地址、云文件临时链接或服务端生成的短片段地址。
- 新增本地桥接命令 `npm run dev:preview-bridge`，用于把后台当前词条同步到小程序预览数据，不接云服务器、不真实上传。
- 后台点击“同步到小程序预览”后，会把当前词条和 `videoClips` 发送到 `http://127.0.0.1:8787/sync-word`，桥接脚本写入 `miniapp-uni/word-app1/common/dev-preview-data.js`。
- 小程序 `word-repository.js` 会优先读取 `dev-preview-data.js`，没有同步数据时再回退到 `mock-data.js`。
- 如果视频片段仍保留后台当前会话的 `blob:` 本地预览地址，桥接脚本会把视频临时保存到 `content-seed/dev-preview-videos` 并生成 `http://127.0.0.1:8787/videos/...` 播放地址。
- 本地视频预览仅适合电脑本机的微信开发者工具模拟器调试；真机里 `127.0.0.1` 指向手机自身，正式上线也必须走云存储 HTTPS 地址，并在小程序后台配置合法域名。
- 桥接脚本默认端口固定为 `8787`，后台同步按钮也按这个端口连接；开发阶段不建议改端口，避免 HBuilderX 和后台按钮不一致。
- 小程序用户端当前只做“片段试看”体验：隐藏原生完整视频控制条，只显示自定义片段播放按钮和片段进度；没有有效 `endSec` 的片段不会播放，避免误放完整视频。
- 后台支持“同步当前词条”和“同步全部词条”两种本地预览方式：前者适合调单个视频片段，后者适合批量验证一批单词卡和视频内容在小程序里的展示效果。
- 重要边界：前端用 `startSec/endSec` 控制只能改善体验，不能作为付费防护。正式上线如需“试看片段免费、完整视频付费”，应由云端生成短片段文件或短时效鉴权 URL，不能把完整视频长期直链直接下发给普通用户。
- 后台视频录入流程收口为“选择视频来源 -> 设置开始/结束秒 -> 填写片段说明 -> 保存为片段 -> 管理片段清单 -> 最后同步小程序预览”；同步按钮不再放在片段草稿区中间，避免管理员误点后丢失还没保存的说明文字。
- 一个词条的 `videoClips` 可以包含多个片段；每个片段都保留自己的 `url`、`assetId`、`storagePath`、`fileName` 和本地预览源，因此后续可以支持不同视频来源组合到同一个单词卡片。
- 2026-05-20 调整后台视频区 UI：顶部不再放“小程序同步”入口，同步统一收口到片段清单底部；如果当前草稿或正在编辑的片段还没保存，同步前必须先保存片段或取消同步，避免说明文字被误刷新。
- 2026-05-20 小程序端视频控制使用自定义“片段内播放控件”：支持播放/暂停和在当前 `startSec/endSec` 范围内拖动进度，不打开原生完整视频进度条，避免用户直接拖到完整视频其他部分。

## 2026-05-26：单词发音音频字段与播放入口

- 小程序详情页新增发音播放能力：只有词条存在可播放 `pronunciationAudio.url` / `audioUrl` 时，音标旁才显示小喇叭；没有上传音频时不显示按钮，避免用户误点。
- 发音播放使用 `uni.createInnerAudioContext()`，页面隐藏或卸载时会停止/销毁音频上下文，避免切页后继续播放。
- 后台 `admin-portal/pictographic-admin` 在音标字段后新增“发音音频”上传演练：支持选择 `mp3`、`wav`、`m4a`、`aac`、`ogg`、`webm` 等音频文件，限制 10MB，并写入 `pronunciationAudio` 字段。
- 本地预览桥 `npm run dev:preview-bridge` 支持把后台当前会话的本地音频写入 `content-seed/dev-preview-audios`，并生成 `http://127.0.0.1:8787/audios/...` 供微信开发者工具模拟器调试。
- 正式上线时不能依赖 `127.0.0.1` 或 `mock-cloud://`；发音音频需要上传到云存储/对象存储，并写入可播放 HTTPS 地址或由服务端换取的临时 URL。

## 2026-05-29：生产环境保护与上线前检查

决策：
- `miniapp-uni/word-app1/common/dev-preview-data.js` 保留为空壳文件，Git 仓库中必须保持 `export const DEV_PREVIEW_WORDS = []`。
- 开发环境继续允许后台本地 preview bridge 写入 `dev-preview-data.js`，用于 HBuilderX 和微信开发者工具预览。
- 生产环境强制忽略 `dev-preview-data.js`，即使该文件被本地预览桥写入临时词条，正式包也不能读取这些预览词条。
- 正式环境下音频和视频播放地址只允许 HTTPS 或后续云存储/对象存储合法地址；禁止 `127.0.0.1`、`localhost`、`mock-cloud://`、`example.com` 进入生产播放链路。
- 开发预览能力继续保留：后台上传演练、`mock-cloud://` 占位、本地 preview bridge、`http://127.0.0.1:8787/...` 临时音视频地址都只限本机开发调试。
- 新增上线前检查命令：`npm.cmd run check:production`。正式打包前必须运行，预期输出包含 `Production readiness check passed`；总检查 `npm.cmd run check` 也会自动串联这一步，降低漏跑风险。

验证方法：
- 运行 `npm.cmd run check:production`，确认 `dev-preview-data.js` 为空、生产环境会忽略预览数据、published 词条不含本地/mock/example 地址、生产媒体保护会阻断本地/mock/example 地址。
- 运行 `npm.cmd run check`，确认原有内容校验、小程序静态检查和后台入口检查没有被破坏。
- 在微信开发者工具里验证开发环境仍可通过本地 preview bridge 预览；正式验收时所有音视频请求必须是 HTTPS/云存储合法域名。

原因：
- `dev-preview-data.js` 是本地预览桥的临时中转数据，不是生产词库。删除它会导致小程序静态 import 失败，保留空壳更稳定。
- 生产包必须和开发预览数据隔离，避免把未发布词条、本机视频地址或 mock 占位地址发给真实用户。
- 视频和音频是上线成本与审核风险最高的部分，必须在打包前用命令自动拦截明显不合规的地址。

## 2026-06-20：第一版最小可审核上线版 P0 决策

- 小程序第一版生产运行模式改为离线已发布词库；只有明确 `status === "published"` 的原始词条可进入列表和详情，缺省状态按 `draft` 处理。
- 小程序 API 地址在 production、test、development 默认使用 `https://baxiaota.com`；development 可通过显式配置本地 HTTP/HTTPS API 地址进行本地联调。
- 内置词条移除第三方测试视频和开发 provider 信息；没有正式自有媒体资源时，前台不显示视频模块。
- 注销关系网、单词库、课堂三个未完成页面路由，不删除页面文件。
- “我的”页不采集头像、昵称、手机号、openid 或 unionid，只保留本机学习统计、最近查看、收藏和清除本机记录。
- 移除会员、升级、购买、兑换等权益暗示，以及仅保存在本机却显示“提交”的缺词反馈功能。
- `scripts/check-production-ready.mjs` 与 server API 联调测试同步到第一版生产离线策略。
- `package-lock.json` 的既有未提交改动不属于本轮，保持不动。

## 2026-08-25 手机号登录误报 IDENTITY_CONFLICT 故障

### 现象与日志

- 手机号快捷登录返回 HTTP 409、公开错误码 `IDENTITY_CONFLICT`，小程序因此提示账号绑定冲突。
- 服务端脱敏日志显示 `rawCode=IDENTITY_STORE_ERROR publicCode=IDENTITY_CONFLICT status=409`。
- 故障恢复后确认这不是微信身份与手机号身份真实指向不同用户造成的冲突。

### 根因与误导链路

- 生产运行环境缺少购书活动手机号身份所需的 `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET`。
- `book-benefit-foundation.mjs` 已产生精确的缺失配置错误，但 `identity-store.mjs` 曾将 foundation 异常统一改写为 `IDENTITY_STORE_ERROR`。
- `index.mjs` 又曾以宽泛的 `^IDENTITY_` 规则把所有身份前缀错误映射为公开 409 `IDENTITY_CONFLICT`。因此基础设施/配置故障被误报为用户账号冲突，排查方向被带偏。

### 已排除事项

- 未发现需要修改身份绑定模型、手机号 hash 输入、数据库结构、007/008 migration、购书权益规则或小程序 UI 的证据。
- 本次修复不执行账号合并、身份迁移、数据删除、Token 失效或生产数据修改。

### 修复内容

- 身份存储层仅对白名单内的 campaign secret 缺失、过短、复用错误保留精确内部错误码，同时使用通用安全错误消息，避免敏感配置细节进入公开响应。
- 手机号登录公共映射只允许精确的 `IDENTITY_CONFLICT` 返回 409；通用 `IDENTITY_STORE_ERROR` 返回 500，已知 campaign secret 配置错误返回 503，二者公开错误码均为 `INTERNAL_SERVER_ERROR`。
- 数据库错误继续映射为 503 `USER_DB_ERROR`，微信错误映射规则保持不变。
- 生产必须配置独立且至少 32 字节的 `CAMPAIGN_PHONE_IDENTITY_HASH_SECRET`。建议用 `openssl rand -hex 32` 生成；不得与其他服务密钥复用，生产数据形成后未经迁移审批不得轮换。

### 后续排障原则

- 首先查看服务端脱敏日志中的 `rawCode`，再参考 `publicCode` 和 HTTP 状态；公开错误码是面向客户端的安全归类，不能代替内部根因。
- 只有内部 `rawCode` 精确为 `IDENTITY_CONFLICT` 时，才按真实账号绑定冲突调查。`IDENTITY_STORE_ERROR` 或 campaign secret 配置码应优先检查服务配置与依赖可用性。
- 日志不得记录 secret 原值、手机号、openid、unionid、Token、SQL、完整异常或 stack。

排障必须按以下固定顺序执行：

1. 先查看 `rawCode`。
2. 定位 `rawCode` 的产生位置。
3. 检查 `rawCode` → `publicCode` 的映射逻辑。
4. 检查 `rawCode` 产生前是否存在被 `catch`、`wrap` 或 `normalize` 吞掉的原始异常。
5. 只有在 `rawCode` 本身明确表示业务冲突时，才检查数据库中的业务数据冲突。

机械执行链：

```text
rawCode
→ rawCode 产生位置
→ rawCode 到 publicCode 的映射
→ 是否存在被吞掉的原始异常
→ 最后才检查业务数据冲突
```

本次反例中，公开结果和内部日志分别是：

```text
publicCode=IDENTITY_CONFLICT
rawCode=IDENTITY_STORE_ERROR
```

不能因为 `publicCode` 名称看起来像“账号冲突”，就优先检查用户表、绑定表、Docker、数据库实例或历史账号。应先沿 `rawCode` 追踪：

```text
IDENTITY_STORE_ERROR
→ createIdentityStoreError 默认 code
→ resolveCampaignPhoneIdentity catch
→ book-benefit-foundation
→ CAMPAIGN_PHONE_IDENTITY_HASH_SECRET
```

## 2026-09-02：微信虚拟支付批次7发货确认

- 使用微信官方支付轮询分支：批次5可信 `query_order` paid事实、批次6会员权益完成后，批次7才允许调用服务端 `notify_provide_goods`。
- `notify_provide_goods`固定为官方HTTPS host/path，参数只放Query String：`access_token`、服务端订单号 `order_id`、沙箱 `env=1`；无业务JSON正文，不套用批次3的 `pay_sig`。
- 只有完整读取、未超64 KiB且正文为空或仅空白的2xx响应才是成功。传输、TLS/socket、超时、请求中止、HTTP非2xx、读取失败、截断、超限、HTML、畸形JSON、未知JSON和任何非空2xx正文一律属于 `uncertain`。
- 当前官方资料没有提供能够证明请求在被接受前失败的公共错误码，因此明确拒绝白名单为空；非零 `errcode` 也不能恢复自动notify资格。
- notify响应使用真正的有界流读取：先检查可信Content-Length，再逐块累计字节，越限立即取消reader；不保存或向日志、错误及HTTP响应传播token或正文。
- 010同时保存delivery attempt和持久化query operation。随机operation、每单递增attempt/query sequence、订单version绑定、租约和活动生成列唯一约束分别序列化notify与query；不保存token、URL、请求正文或微信原始响应。
- 发货分为三个短阶段：事务内领取、事务外HTTP、事务内完成/记录不确定。任何数据库连接和行锁都不会跨越微信HTTP。
- 网络不确定进入 `confirming`，用户点击、进程重启、租约到期或查到状态2都不能再次notify。只允许当前持久化query operation落库；租约接管产生更高sequence，旧operation的迟到结果只能作为stale丢弃。
- 状态4且有效 `provide_time`完成delivered；状态2/3继续有界确认并最终进入manual review；退款、关闭、未知或无法安全确认的状态直接进入manual review。明确拒绝白名单为空期间不会创建第二笔notify attempt。
- Store在真正dispatch前的同一短事务内重新锁定订单和完整attempt/query历史，独立重建paid及delivery canonical摘要，并再次调用 `verifyMembershipGrantInTransaction()`验证grant、会员流水、快照与完整账本；事务提交并释放connection后才允许HTTP。
- 010为attempt/order、attempt/event以及query/order、query/attempt、query/event建立RESTRICT外键，并为活动claim、租约、历史扫描和operation/sequence建立索引及唯一约束。
- delivery流程只调用批次6的 `verifyMembershipGrantInTransaction()`，不调用会员发放入口；MySQL测试逐表确认grant、会员流水、快照和quota累计字段不变。
- 本批不实现 `xpay_goods_deliver_notify` webhook，不调用真实微信，不运行生产migration，不部署。

### 2026-09-04：批次7第三轮定向修复与验收

- 终态转换先在订单锁、同一事务/connection中关闭活动query（stale、completed_at、清空lease），再推进订单version。历史query保留原operation/sequence/version；manual_review/delivered不允许活动query。确认窗口耗尽后迟到状态2/4均stale，四张支付表快照不变；并发转换只增加一次version。
- 010增加attempt `completion_source`、`claimed_at`、`finished_at`。direct_notify必须无query事件、query_count=0、success及合法dispatch/response/finish；query_confirmation必须绑定同attempt的applied状态4事件、正provide_time和独立重算的摘要。校验claimed <= dispatch <= finish、query claim <= observation <= completed；完成无活动lease。
- Query持久化并独立重算：user_id、observed_environment、request_env、response_env_type、observed_currency、observed_order_no、observed_provider_order_id、observed_provider_transaction_id、wechat_status、order_type、order_amount_fen、paid_amount_fen、paid_at_seconds、provided_at_seconds、queried_at_seconds、operation_id、query_sequence、claimed_order_version、observation_id；另校验order_id/attempt_id关联。21个独立字段/关联篡改fixture均被拒绝，恢复原值后历史可正常读取。
- Client接受原生204/null body、200空正文/空白正文；非法Content-Length、声明/读取超限、reader失败、非2xx均取消未消费资源；UTF-8错误在完整消费并释放后返回uncertain。cancel抛错不泄漏敏感值；真实ReadableStream超时取消/释放各一次、locked=false。
- 正式只读schema验收为 `npm run check:virtual-payment-delivery-schema`，并通过 `predev:api`接入标准API启动（虚拟支付关闭时不连接DB）。Store发货前也在已有connection检查。直接执行server/index.mjs会绕过npm启动钩子，因此不得作为绕过验收的发布方式；本轮未部署/启动实际API。
- `applyDeliveryMigration(connection)`只创建缺失表，前后执行exact-schema检查；已有错误结构返回固定 `PAYMENT_DELIVERY_SCHEMA_MISMATCH`，要求受控人工恢复，不自动DROP/ALTER。覆盖列顺序/类型/null/default、生成列表达式及STORED、索引唯一性/列顺序/可见性/方向、五个外键和引用/规则、引擎/排序规则。
- MySQL 8.0.46仅127.0.0.1:3308随机数据库实跑：第二表故障后第一表精确残留，修复故障重跑与全新SHOW CREATE TABLE一致；仅第二表场景可续跑；缺字段/错误索引/缺外键/错误生成表达式/两表之一不完整均拒绝，正式启动验收函数亦拒绝。两份010逐字一致、UTF-8有效且无BOM。
- MySQL还覆盖direct/query成功来源混淆、状态2伪成功、finished早于dispatch、跨订单关联、活动query终态关闭的affectedRows/commit/rollback故障（四表无部分推进）、release故障、同单并发、connectionLimit=1及不同用户不全局阻塞。会员权益快照/流水不变。
- 离线：批次1～7、认证/手机号/identity、会员MVP（含管理员赠送）、migration/DATETIME/事务核心、购书福利其余回归通过；`check:server:delivery`、修改/新增MJS语法、package解析及git diff --check通过。
- 既有问题不修复：`check:server`在membership-grant-schedule:525的LF/CRLF断言失败；单独Word API测试在:466 Object.keys(undefined/null)失败；book-benefit-production-preflight:120的LF断言失败。book-benefit-schema-manifest和production-exact-schema本次单独实跑通过，不把历史失败描述成本轮失败。
- 状态：第三轮定向修复完成，等待第三次独立攻击性复审。全局check:server不宣称通过；未运行HBuilderX/微信开发者工具，未调用真实微信。独立复审明确通过前禁止暂存、提交、推送、合并和部署。
- 清理已核验：随机测试数据库无残留；本轮容器及同名volume `codex-vp7-r3-f2c21ac9c386`已移除，3308无监听。两个旧容器保持原退出状态，未启动/停止/修改。分支仍为feature/virtual-payment-delivery-confirmation，HEAD/master/origin/master均为8077e5c91dc355db7ed3cb0ca48dfd39afdbacf1，暂存区为空。

### 2026-09-04：批次7第四轮最小修复

- 仅修改generated expression比较与真实启动入口，不调整状态机、attempt/query/canonical或010，不新增表、状态、011或依赖。
- 表达式按引号感知token比较：字面量、反引号标识符内容（空格/大小写/转义）原样保留；引号外忽略空白并统一关键字大小写。仅兼容MySQL输出的_utf8mb4字面量引导符、转义的字面量定界符、整个表达式/完整WHEN条件的冗余括号，IN列表和其他token保持精确比较。
- 正式assertDeliverySchema离线fixture：原始表达式与外部空白变化通过；claim ed、前后空格、Claimed、另一状态值、CASE条件、返回列、引用标识符内容和转义字面量变化均以固定脱敏schema mismatch拒绝。大小写采用更保守的精确合同比较，不依赖当前case-insensitive collation放宽。
- 覆盖上一轮启动说明：server/index.mjs实际直接启动路径在listen之前await同一个checkVirtualPaymentDeliverySchema，失败固定输出API_STARTUP_CHECK_FAILED并非零退出。遵循既有VIRTUAL_PAYMENT_ENABLED；移除predev:api重复钩子，保留独立只读验收命令和Store同connection检查。未运行migration或自动修表。
- 隔离MySQL8.0.46/127.0.0.1:3308测试：实际ALTER generated expression为claim ed后正式校验器与Store拒绝，notify=0，恢复后通过。npm run dev:api、直接Node、PM2等价直接Node（不是安装PM2）均实跑正确schema监听、缺010表/错误表达式/缺外键/数据库错误不监听且非零退出，输出不含测试凭据、token、SQL或连接串。
- connection清理：离线注入查询错误后唯一connection结束一次；真实启动检查完成后数据库PROCESSLIST不残留启动连接。测试服务使用随机本地端口并在结束后释放；Windows测试需允许终止其专用子进程树。
- 本轮专项离线及原有批次7MySQL套件通过；check:server:delivery、MJS语法、package解析、git diff --check通过。check:server仍在会员525行LF/CRLF断言失败；单独复跑Word466行Object.keys异常、购书福利preflight120行CRLF断言仍失败，未修改。
- 完成后等待下一次独立复审，不暂存、提交、推送、合并、部署；未调用真实微信或连接生产数据库。
- 第四轮最终套件通过（Store明确返回schema mismatch，Service按既有规则映射为PAYMENT_SERVICE_UNAVAILABLE，notify=0）。随机测试数据库已清理；本轮专用容器/volume为codex-vp7-r4-ae8d1047，验收后移除。首轮沙箱禁止taskkill导致的测试子进程已经精确核对父子关系后清理，没有操作其他Node进程。

### 2026-09-04：批次8小程序购买接入（等待独立审查）

#### 第一次审查后的三项最小修复

第二轮端点契约补齐（覆盖上一轮“必要字段”尚不完整的描述）：
- 只补客户端校验与fixture；记录归并、epoch/pause/resume/dispose和页面隔离未重构。create进入编排即复用validatePaymentParams检查mode、signData和两个64位小写hex签名的严格字符串类型及原有payload约束，原生调用前仍复用同一函数；不改字符串、不补默认值。
- entitlement增加membershipStartedAt/membershipExpiresAt严格toISOString字符串格式及start < end，idempotent严格boolean；不要求deliveryStatus、不重新计算30天账本。delivery增加四个严格boolean，confirming/manualReview/retryable分别且仅当状态为confirming/manual_review/retryable_failed时为true，其余状态三者全false。
- 表驱动非法fixture：create 43、GET 18、reconcile 18、entitlement 29、delivery 49项全部拒绝，拒绝响应后新增网络/原生调用全部为0。完整购买测试中的累计invoke/reconcile/entitlement/refresh/delivery分别为0/0/0/0/0、1/0/0/0/0、1/1/0/0/0、1/1/1/0/0、1/1/1/1/1；delivery收到错误前会员已可靠granted并刷新，保留该事实、不写delivered成功。
- 正常四种delivery状态、支付参数原样传递、所有原重复记录/生命周期fixture保持通过。第二轮仅修改两个实现JS、两个测试MJS及项目文档。check:miniapp、check:server:delivery、三份专项、JS/MJS与Vue脚本语法、package解析及git diff --check通过；三个既有门禁问题仍保留，HBuilderX/微信预览仍待sandbox联调前验证。未改服务端/migration、未暂存提交推送部署或真实微信调用。

- 恢复记录先校验整个集合，再按clientRequestId归并并反向检查orderNo唯一归属。同意图允许空orderNo与已知orderNo归并；mayHaveInvoked取OR、创建时间取最早、更新时间取最新，冲突提示重建为unknown。完整校验后才写回规范集合，写回失败停止；冲突/损坏不删除，固定提示“本地购买记录异常，请查询订单或联系客服”。
- 原始true/false攻击fixture两种顺序及三条重复记录均规范为一条true；包括首次支付在内原生调用总数始终为1。两种ID映射冲突、归属/类型损坏、归并写回失败均在创建/支付前拒绝；正常多订单仍通过。
- 按端点拆分编排所需响应校验：create/GET/reconcile要求orderNo及paymentStatus、entitlementStatus、deliveryStatus，校验枚举和跨状态关系；entitlement只要求其正式orderNo、paid/granted，不要求deliveryStatus；delivery要求paid/granted和合法deliveryStatus。支付参数仍在原生调用前按既有规则校验，不补缺省状态。
- GET paid/granted但deliveryStatus缺失、类型错、未知或矛盾时固定安全失败；测试中reconcile、entitlement、权益刷新、delivery和成功展示均为0，本地不写成功。
- Controller使用epoch和每run身份：pause递增代次并取消自有请求/原生回调等待计时器，resume不复活旧代次；dispose永久停用。每个异步返回后检查代次，失效结果安静结束；finally仅能释放自己持有的共享锁。中止客户端等待不意味着取消服务端订单或关闭原生支付弹窗。
- 页面分别记录隐藏/卸载和代次。卸载后旧run的catch/finally不再修改loading、message、records、成功状态或reloadRecords；旧GET在pause/resume后不得reconcile，新run可独立查询且锁不受旧finally影响。新增测试覆盖迟到GET、login code、create、grant、refresh、delivery及原生success/fail回调。
- 本轮check:miniapp、三份专项测试、check:server:delivery、登录API、会员MVP、entitlement service/routes、购书福利兑换/UI回归通过；JS/MJS及Vue脚本语法、package解析和diff空白检查通过。三个既有失败仍为会员525行CRLF、Word466行Object.keys、购书福利preflight120行CRLF，未修改。
- 本轮仅改三个批次8实现文件、三份专项测试及三份项目文档；没有改server/migration/package.json或引入依赖。HBuilderX完整构建/微信开发者工具仍是sandbox联调前置，未宣称完成；未调用真实微信、未部署、未暂存/提交/推送/合并，等待聚焦独立复审。

- 基线51897c4ef2b5e0cc64d794773f8650e8f6722001，分支feature/virtual-payment-miniapp-purchase。服务端及migration未修改，未新增依赖。
- 新增pages/learning-benefits/index.vue，复用现有蓝白样式；我的学习权益区域及详情额度不足以navigateTo进入。详情返回复用原查词请求ID刷新权限。页面展示30天/¥30.00/非自动续费/会员不限次数；有效会员提示顺延30天，无邀请入口。
- virtual-payment-api-client.js使用现有auth session及同一个明确配置的开发后端，缺配置/生产域名回退/release均fail closed；不改变全局回退规则。购买前校验微信运行时、android/harmony/windows和requestVirtualPayment能力；devtools不冒充android。auth-api-client仅导出已有微信login code帮助函数。
- 正式时序：确认弹窗→新login code→保存购买意图→创建/幂等恢复订单→保存orderNo→持久化mayHaveInvoked→原样传递服务端signData及签名→所有回调仅作为查询提示→GET→必要时新login code reconcile→可靠paid后entitlement→granted立即刷新权益→delivery。每次只有一个共享购买Promise，不后台新建或重新支付。
- 每次查询最多一次GET、一次必要reconcile及必要发放/发货请求，无无限轮询。HTTP有超时，原生回调等待有界；离页后不继续推进后续请求，回到页面按本地记录手动恢复。granted后跳过reconcile及entitlement；delivery confirming显示“会员已到账，订单确认中”，manual_review仅显示安全处理提示，仍允许主动另购。实际微信弹窗生命周期及长时间无回调必须后续真机验证。
- 本地key按sandbox、后端URL和项目userId隔离。记录白名单为userId/environment/clientRequestId/orderNo/mayHaveInvoked/createdAt/updatedAt/hint；不存loginCode/paymentParams/signData/签名/openid/sessionKey/密钥/token/provider交易号/原始错误。写入后读回验证，任何调用支付前必要保存失败均不拉起微信；不静默淘汰未确认旧单，本批不自动清理历史记录。
- cancel和未知保留原单，不标failed/closed；默认“查询上次购买结果”。“仍要另购30天会员”显示用户确认的双单可能分别到账并顺延警告，取消弹窗不创建；确认才生成新意图，新旧记录互不覆盖。创建响应中断且未可能调用微信时复用原clientRequestId；可能调用标记一旦写入，即使崩溃发生在真正调用前也只能查旧单。
- 自动测试：test-miniapp-virtual-payment-client.mjs、test-miniapp-virtual-payment-purchase.mjs、test-miniapp-learning-benefits.mjs已接入test:miniapp:purchase和check:miniapp。覆盖请求契约、精确空正文、原签名字符串透传、敏感字段不落盘、三处存储失败、单Promise、防自动重付、取消/明确另购/恢复、数值2/3拒绝、grant响应中断恢复、granted跳过重复操作、用户/环境隔离、平台限制、页面脚本及生命周期。
- check:miniapp（含原手机号登录及音频检查）、check:server:delivery、会员MVP（含管理员）及购书福利兑换/UI测试通过。check:server在既有会员test-membership-grant-schedule.mjs:525 LF/CRLF断言失败；单独Word API:466 Object.keys(undefined/null)、购书福利production-preflight:120 CRLF断言仍失败，均未修复。
- Vue脚本通过node语法检查，但未运行HBuilderX完整uni-app构建、微信开发者工具页面预览或sandbox真机交易。本轮没有调用真实微信、部署、运行migration、操作MySQL或提交/推送。后续需验证页面导航/返回权益刷新、微信弹窗成功/取消/挂起、Android/鸿蒙/Windows能力及iOS/devtools禁用行为。
- 跨设备或清空storage后的订单找回：批次9上线前必需能力，本批不实现；本地恢复不承诺覆盖这些情况。当前仅交付代码与离线验证，等待独立审查。
