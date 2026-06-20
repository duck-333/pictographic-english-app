# Documentation

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
- 生产环境固定关闭远程词条 API；只有显式 `NODE_ENV=development` 且配置 API 地址时才启用开发联调。
- 内置词条移除第三方测试视频和开发 provider 信息；没有正式自有媒体资源时，前台不显示视频模块。
- 注销关系网、单词库、课堂三个未完成页面路由，不删除页面文件。
- “我的”页不采集头像、昵称、手机号、openid 或 unionid，只保留本机学习统计、最近查看、收藏和清除本机记录。
- 移除会员、升级、购买、兑换等权益暗示，以及仅保存在本机却显示“提交”的缺词反馈功能。
- `scripts/check-production-ready.mjs` 与 server API 联调测试同步到第一版生产离线策略。
- `package-lock.json` 的既有未提交改动不属于本轮，保持不动。
