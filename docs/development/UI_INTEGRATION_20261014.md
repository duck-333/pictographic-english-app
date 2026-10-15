# 首页推荐卡片安全集成第一轮（2026-10-14）

## 第二轮修复交付记录（2026-10-14，待独立复审）

本节取代下文第一轮“本地完成等待审查”的当前状态：第一轮独立审查不通过，P2推荐刷新失效与P3字段冗余现已做最小修复，尚未经过第二轮复审。唯一写入工作区、分支及HEAD与第一轮一致。

### A / E：刷新根因、实现与时效

- 原实现仅onShow获取；前台长期停留无法感知轮换/手动切换/下架，刷新等待时也没有清空旧卡片。
- 保留模板和样式。本轮只增加首页可见状态、在途标志和单个setTimeout。首次/重新进入立即请求；同一可见期重复onShow若已有在途请求则合并。隐藏/销毁清定时器、清卡片并递增原请求序号，使旧回复无法更新或安排新定时器。
- 每次完成后安排5分钟刷新，若上海午夜更近则优先午夜。每小时约12次，不持续高频轮询；手动修改/下架在前台正常运行时约5分钟内触发，另加原请求超时最多7秒。系统挂起/计时器延迟不承诺严格墙钟上限，重新进入立即清空并获取。
- 每次刷新开始即清空推荐；等待时不显示旧拆解/完整意象。失败、429或空池保持空白，不恢复缓存，在下个低频周期重试。跨日开始的迟到回复拒绝，1ms后重新请求。上海日期仅用于调度，不在客户端选择推荐词；服务端仍是唯一选择来源，无免费权限凭证。

### B / C：字段及修改边界

- 模板消费word/phonetic、parts.text/meaning、explanation；status用于published校验，id用于原详情导航。基本信封仍复用既有toBasicWord/toPublicWord，为既有共享basic缓存及普通查词/历史消费者保留，普通白名单未动。
- 专用附加字段严格为parts/explanation。每个part仅text/meaning；按content-schema既有格式保留label→text、title→meaning输入兼容，输出不再含label/title/targetId/color/bgColor/borderColor。输出校验和HTTP输入校验各保留两项直接映射，不引入第二模型或新依赖。
- 本轮改动8个文件：pages/index/index.vue（生命周期和刷新）；server/word-access-policy.mjs、common/homepage-featured-word.js（收窄parts）；scripts/test-homepage-featured-display.mjs（独立字段预期、实际页面时钟及HTTP回归）；Prompt.md、Plan.md、Documentation.md、本文（范围、阶段、证据）。首轮word-api-client、word-repository、server/index等已有变更保留，本轮未编辑。

### D / F：实际执行结果

HTTP测试沿用首轮临时内存registerHooks，只读解析原仓库既有mysql2/mysql2/promise；不安装依赖、不连接数据库。HTTP只绑定127.0.0.1随机端口；后台更新使用隔离JSON库；页面用模拟时钟执行实际Vue方法。

| 命令/脚本 | 最终退出码 | 本轮证据 |
| --- | --- | --- |
| node scripts/test-homepage-featured-display.mjs（同首轮mysql2解析器） | 0 | HTTP实际更新/手动切换/下架/选池轮换/空池；页面持续停留上海午夜及5分钟调度、等待清空、失败、空结果、跨日迟到回复、隐藏后返回的旧回复、重复onShow合并、销毁后不更新；两侧独立显式parts及basic+展示顶层字段预期；429/no-store、会话切换/重登/续期、basic-only缓存及不持久化意象。 |
| node scripts/test-content-api-security.mjs（同解析器） | 0 | 原字段投影、限频先于扣次、最后额度、重放、会员、no-store与peer IP回归。 |
| node scripts/test-content-session-isolation.mjs（同解析器） | 0 | 实际详情/我的页脚本：退出、换号、重登、续期、过期/401、旧书籍回复及公共缓存回归。 |
| node scripts/test-server-word-api-link.mjs（同解析器） | 0 | 后台推荐选择/上下架/空池及普通查询接口回归。 |
| node scripts/test-baxiaota-entry.mjs | 0 | 浮窗、首页异步测量、生命周期和导航回归。 |
| npm.cmd run check:miniapp | 0 | 原小程序静态检查及其中购买流程/学习权益/手机登录/音频schema模拟测试。没有真实支付调用。 |
| npm.cmd run validate:content | 0 | 3份既有种子数据通过。 |
| node --check server/word-access-policy.mjs / common/homepage-featured-word.js / scripts/test-homepage-featured-display.mjs | 0 | 新改JS语法无报错；实际Vue脚本由专项测试执行。 |
| git diff --check | 0 | 无空白错误。 |

真实初始失败：3个HTTP测试在沙箱内退出1（本地TCP EACCES/fetch failed）；申请执行许可后重跑。专项首次沙箱外退出1，原因是原fixture含非生产插图URL、缺少可保存释义，saveWord返回校验失败，原测试未断言保存成功；修正fixture保存输入并明确断言ok后最终退出0。其他HTTP重跑退出0；会话隔离和浮窗在沙箱内即退出0。失败运行finally也清理了本轮临时JSON。

### G / H：残留和最终状态

- 已有server/local-data/content-release-verifier-abJUb2保持原样。只读核实27个文件（18 JSON、6 JS、3模拟PNG），包括clean/非法结构/开发依赖/私有文本测试清单，内容及命名与scripts/test-content-security-release-verifier.mjs生成规则对应；该脚本mkdtemp无清理，首轮TEMP设置到local-data，故判断为首轮发行扫描fixture残留。未删除、移动或重跑该脚本。
- 执行前后server/local-data文件清单一致；本轮临时JSON由各脚本finally逐个unlink，无额外持久测试文件/目录。已有未跟踪结果JSON保留为首轮历史，本节记录本轮实际结果，不冒充新构建结果。
- 分支codex/ui-integration-20261014，HEAD d8a7137b043c8d48e23db8d61c774a0c631ffb0c；8个已跟踪修改、33个未跟踪文件，暂存区为空。无提交/推送/合并/部署，无其他工作区写入或生产连接。
- 本轮未运行HBuilderX新编译、微信开发者工具或真机UI验收，第一轮构建成功证据不能证明本轮。页面布局代码未改；原生定时器、前后台切换及真实页面展示仍需后续验收。停止等待第二轮独立复审。

状态：本地实施与验证完成，等待独立审查。未暂存、提交、推送、合并、部署。唯一写入目录为 D:/english-app/pictographic-english-app-ui-integration；分支 codex/ui-integration-20261014，HEAD 保持 d8a7137b043c8d48e23db8d61c774a0c631ffb0c。

## A. 文件与修改目的

| 文件 | 目的 |
| --- | --- |
| miniapp-uni/word-app1/pages/index/index.vue | 只迁移旧UI首页补丁：拆解尺寸／配色、全文换行、空音标隐藏、完整意象及原始字段。保留其他首页业务。 |
| server/word-access-policy.mjs | 增加单个当前推荐词展示投影，复用toBasicWord，仅追加parts公开字符串字段和explanation。原toBasicWord／toFullWord不改。 |
| server/index.mjs | 只改导入及首页推荐响应，使用专用投影和no-store；限频、普通查询、完整详情、会员／扣次、VOD路径不改。 |
| miniapp-uni/word-app1/common/homepage-featured-word.js（新） | 客户端专用响应投影，复用toPublicWord，保留首页两项，忽略其他完整字段及伪造full访问标记；独立拷贝parts。 |
| miniapp-uni/word-app1/common/word-api-client.js | 仅首页端点调用专用投影，并捕获会话快照拒绝旧会话迟到成功。请求超时、429解析、详情鉴权及会话更新逻辑保留。 |
| miniapp-uni/word-app1/common/word-repository.js | 首页保留专用响应，避免再次basic化误删；先调用原cacheRemoteWords，只向共享缓存存basic。其他返回路径不改。 |
| scripts/test-homepage-featured-display.mjs（新） | 单词大小写／空音标、同记录及更新／轮换、仅当前词、普通字段隔离、429／no-store、缓存、会话竞争和实际首页方法测试。 |
| Prompt.md、Plan.md、Documentation.md | 记录本轮授权范围、阶段及安全决策；不复制旧UI关于免费权益的记录。 |
| 本文及UI_INTEGRATION_*_RESULTS_20261014.json | 迁移说明、真实命令结果及初始失败／修复证据。 |

## B. 已迁移UI与同源行为

首页Vue补丁从已核验备份按单文件Git补丁应用（git apply --include=miniapp-uni/word-app1/pages/index/index.vue），没有重放旧服务端／安全模块。字体、颜色、间距、自然高度、长内容换行、小卡片放大和等级标签移除全部保留。原始单词大小写保持，有音标才显示；拆解读取当前todayWord.parts（不维护todayParts副本），完整意象读取同一词条explanation，按详情同一trim规则展示全文及换行。点击仍传当前推荐词ID进入原详情流程。

后台resolveHomepageFeaturedWord／featuredWordIds／manualWordId／dailyRotation代码没有修改。不存在单独维护的首页词条，空池不兜底到其他词。

## C–D. 字段路径与安全兼容

服务端已发布词条 → 原后台选择当前词 → toHomepageFeaturedWord（原basic＋公开parts字段＋explanation）→ 首页no-store响应 → 客户端专用投影 → 首页当前状态。

客户端同一次推荐请求的cacheRemoteWords仍经原toPublicWord和原basic缓存规则；普通搜索、普通详情、listWords／getWordById和共享存储不保留展示全文，响应也不授予canAccessFull。没有将首页展示数据提升为full或把整个推荐池公开。server/word-store.mjs、common/public-word.js、auth-store.js、内容限频、详情权益及VOD代码均未改。

原安全基线已有的退出／换号清理、详情迟到响应保护继续保留；首页请求额外复用已有captureAuthSession／isAuthSessionCurrent，不新增会话版本或权限系统。相同账号正常续期仍可接受响应，退出再登入及换号的旧响应被拒绝。页面已有todayWordRequestId确保后发先回后旧回复不会覆盖当前卡片。

## E. 验证命令与结果

所有HTTP仅为127.0.0.1临时端口，使用隔离JSON测试库／内存适配器；没有数据库连接或VOD请求。工作区没有安装依赖；测试用Node24原生registerHooks临时只读解析相邻原仓库既有mysql2，不修改任何node_modules。TEMP／TMP／TMPDIR指向Integration内。测试保留的临时产物已在Integration内移动到忽略的构建证据目录，没有批量删除。

| 验证命令 | 最终退出码 | 结果 |
| --- | --- | --- |
| node scripts/test-homepage-featured-display.mjs（使用下述临时mysql2解析器） | 0 | 本地HTTP同记录／更新／选池轮换、单词大小写和音标、只当前词、basic字段、no-store／429及Retry-After、缓存／共享存储、换号／重新登入／续期、实际首页方法及请求乱序通过。 |
| node scripts/test-content-api-security.mjs（同解析器） | 0 | 原字段白名单、权限、最后额度／重放、先限频再扣次、会员、no-store保持。 |
| node scripts/test-content-session-isolation.mjs（同解析器） | 0 | 原详情／我的页实际方法，清理、换号、重新登入、401／失效与旧回复保护通过。 |
| node scripts/test-server-word-api-link.mjs（同解析器） | 0 | 原后台选择／上下架／空池、客户端查询和接口回归通过。 |
| node scripts/test-membership-entitlement-mvp.mjs（同解析器） | 0 | 原会员与次数流程本地回归通过。 |
| node scripts/test-baxiaota-entry.mjs（同解析器） | 0 | 原首页浮窗／导航／异步测量回归通过；不等同原生触摸验收。 |
| node scripts/test-content-security-release-verifier.mjs（同解析器） | 0 | 原发行扫描器21项子进程退出码／结论测试通过。 |
| npm.cmd run check:miniapp | 0 | 小程序既有检查通过。 |
| npm.cmd run validate:content | 0 | 原内容校验通过。 |
| node --check（两个服务端文件、三个客户端JS文件） | 0 | 语法通过。 |
| HBuilderX自带Node18.20.0：Vue CLI Service uni-build，watch=false/minimize=true/clean=false | 0 | mp-weixin发行构建成功；不启动HBuilderX发布器或微信预览，不上传。 |
| node scripts/verify-content-security-release.mjs miniapp-uni/word-app1/unpackage/dist/build/mp-weixin miniapp-uni/word-app1/unpackage/ui-integration-validation/module-inventory.json | 0 | 18个JS／26条开发完整样例文本未包含；真实95个顶层编译模块图排除dev-preview-data／development-full-word-data，游戏／教程公开资源存在。 |

测试执行器的实际形式为 node --input-type=module --eval '<临时mysql2解析器; await import(测试路径)>'；解析器只对mysql2和mysql2/promise调用createRequire('D:/english-app/pictographic-english-app/package.json')，预先resolve为file URL后使用registerHooks，其他模块走默认解析。每个测试独立子进程，实际stdout／stderr与退出码保存在UI_INTEGRATION_TEST_RESULTS_20261014.json；静态记录在UI_INTEGRATION_STATIC_RESULTS_20261014.json。

构建直接加载已安装的plugins/uniapp-cli/node_modules/@vue/cli-service，VUE_CLI_CONTEXT和UNI_CLI_CONTEXT使用该编译器的Windows绝对路径，UNI_INPUT_DIR为Integration内word-app1，UNI_OUTPUT_DIR为其unpackage/dist/build/mp-weixin，NODE_ENV=production、UNI_PLATFORM=mp-weixin，清除UNI_USING_CACHE。临时内存插件仅在compiler.hooks.done导出实际module inventory和stats，不写业务配置。构建记录见UI_INTEGRATION_BUILD_RESULTS_20261014.json；产物与依赖图位于Integration内miniapp-uni/word-app1/unpackage/，没有启动产物运行时。

真实中间失败保留：新增测试第一次直接把内部原始parts（含privateNote）与公开投影比较，测试断言错误，修正为比较公开投影后通过；不是业务代码泄漏。系统Node24与编译器旧插件util.isRegExp不兼容退出1；改用内置Node18后一次Windows上下文路径格式错误退出1；规范化路径后构建退出0。未通过修改依赖或业务代码解决这些构建调用问题。

## F. 未验证事项

不连接生产API、数据库或生产视频服务，因此真实后台词条内容、线上发布效果、VOD实际播放以及真机布局／字体／交互均未验收。本地测试记录与布局实现不能替代真实数据验收；此次不打开微信生产预览。发行扫描检查构建内容及图，不验证独立审查或源提交绑定，不把它写为正式发布通过。

## G–H. 状态、冗余及风险

所有变更留在Integration未暂存，HEAD不变。原UI Worktree、原仓库和外部备份保持只读，结束前再次核对。没有新增数据库表、词库、权限系统、依赖或生产配置；专用客户端投影是被word-api-client实际调用的函数，未新增展示缓存或另一套会话逻辑。服务端与客户端分别做同样公开字段列表投影，是跨HTTP边界的输出／输入校验，复用各自既有basic函数，没有复制普通basic白名单。风险是未来parts结构扩展时需同步两侧投影；测试已覆盖结构一致性。本轮停在待独立审查。


## 结束核对

首页Vue文本与外部备份完全一致（仅忽略CRLF／LF表示差异）；普通basic投影、auth-store、完整详情页、word-store、content-rate-limit及权益存储等保护模块没有差异。git diff --check退出0，暂存区为空。Integration为8个已跟踪修改文件、6个未跟踪新文件（本文、3个结果JSON、客户端专用投影、新增专项测试），全部14个文件未提交。

原UI仍为codex/ui-refresh-20261013、HEAD9ab54e25a824b89d532e9953be47a54bc6e1b2e7，7改＋1未跟踪及8个文件摘要／字节与备份一致，备份补丁摘要保持。原仓库master／HEAD仍为d8a7137b043c8d48e23db8d61c774a0c631ffb0c，原两个未跟踪参赛说明文件及摘要与创建集成区前记录完全一致。未写入这些只读目录。
