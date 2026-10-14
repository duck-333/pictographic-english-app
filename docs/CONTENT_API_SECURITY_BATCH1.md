# 批次①：本地内容接口安全实现与未验证边界

2026-10-13，基线 master / 9ab54e25a824b89d532e9953be47a54bc6e1b2e7，功能分支 feature/content-api-security。未跟踪 docs/competition/ 不读取、不暂存、不删除。该批不得在独立审查通过前暂存、提交或推送；没有部署、生产数据库/服务器/云端操作。

## 本地实现

- 沿用 server/word-access-policy.mjs 的白名单：basic 不再返回 intro、教学 illustrationImage/图注；meaning 优先 basicMeaning。image 是既有基础封面字段，基础释义、公开发音和已允许的小游戏/教程保留。原有 meaning 回退继续兼容旧数据；生产各词类的释义语义仍需内容核对，不能把完整解释写入基础释义。
- 客户端 public-word.js 做相同公开投影；归一化之后再投影，不能通过默认值、完整响应、关联或缓存合并补回私有字段和 full 标志。搜索/推荐及非 accessContent 的请求均强制basic。共享缓存只存basic；完整响应仅交给当前详情页。
- 详情与含完整内容的管理员词条/首页配置路由在入口设置禁止缓存头，涵盖未登录、拒绝、429、404、异常和保存校验错误。管理员原已有no-store保留。线上代理/CDN覆盖与旧缓存未验证。
- auth-store 集中会话通知：退出、换账号、过期、当前认证拒绝清理受保护页面和共享缓存；会话版本防止退出后重登同账号的旧响应污染。有效同账号续期不换版本和访问请求ID。全文请求及详情加载均核对会话与加载序号；页面卸载也丢弃迟到响应。收藏/最近/权益读取的认证拒绝同样走当前请求会话失效通知，旧Token拒绝不清除已续期或新账号会话。没有改变支付或会员事务。
- 完整mock保存在 scripts/fixtures/development-full-word-data.mjs，正式小程序mock只留公开基础数据。开发桥数据依赖使用编译时development条件；正式产物需检查依赖图和私有文字。公开小游戏与教程图不移除。
- createLocalContentRateLimiter 是单进程本地开发/测试适配器，默认账号30次/分钟、容量10；全文IP600/分钟、容量100；basic IP1200/分钟、容量200。可通过构造参数调整。桶闲置回收、容量有界；请求超限返回429/Retry-After/no-store，不触发consumeQuota。只用socket对端IP，统一IPv4映射地址，忽略所有客户端转发头。startServer只在明确development环境自动接入；production未接入该Map。createApiHandler可注入限频适配器用于本地验证，未来生产适配器必须基于实际拓扑确认。

## 生产限频：待验证，不能据本地Map宣布完成

现有 server/index.mjs 只说明一个HTTP启动入口；历史资料同时出现PM2和沙箱systemd。不能据此判断当前生产单/多实例。没有加入Redis、逐请求数据库写入或改生产配置。

需要脱敏补证：

1. 每个实际API服务的systemd单位名称及ExecStart指向、实例数，或PM2 exec_mode/instances；主机/负载均衡实例数量。不要提供Environment或环境文件内容。
2. Node实际监听地址/端口，是否公网可直连，入口域名到Nginx/CDN/LB/Node的链路。
3. 精确内容location的proxy_pass、proxy_set_header、real_ip_header、set_real_ip_from、real_ip_recursive、proxy_cache及现有限频配置；脱敏实际服务器地址，保持链路结构。
4. 若有共享计数设施，只给设施种类、是否既有、原子计数能力和覆盖实例范围，不给连接串或凭据。

收到证据后：单实例才选择生产进程内账号桶；多实例复用已存在的共享原子计数。IP可在实际统一入口Nginx共享zone做限频，但多台Nginx不会自动全局同步。可信IP只能接受实际可信对端覆盖的规范IP，不能直接相信XFF最左值或所有私网。阈值需用正常快速点击、同NAT多账号和最近列表批量加载校准，会员同样受限频但不改变扣次规则。此处是后续步骤，本轮没有实施生产接入。

## 教学图片：代码证据与精确补证

代码事实：

- admin-portal/pictographic-admin/pages/index/index.vue 的教学图表单直接输入 illustrationImage.url/title/alt，并用该URL预览；common/api-client.js归一化后随词条POST保存。未发现教学图上传接口、COS SDK、私有图片签名服务或图片鉴权出口。
- server/word-store.mjs 读写词条JSON。production通过WORD_DATA_PATH使用发行目录外的词条数据文件，不从本报告读取实际文件；illustrationImage字段还有provider、assetId、uploadStatus、uploadedAt，但这些文本元数据不能证明存储权限。
- common/content-schema.js 的图片URL校验是HTTPS及部分危险地址过滤，不验证bucket权限或签名。小程序用image.src和uni.previewImage直接访问保存的URL。
- 测试中 cdn.baxiaota.com/images/{词条}.png 是fixture，不能当作真实生产图片域名/路径证据。代码未固定教学图源站；真实域名、存储桶、原件/派生图目录和旧地址均未验证。

补证清单（不含密钥、Token或完整签名URL）：

| 所需证据 | 脱敏形式 | 用途 |
|---|---|---|
| 当前教学图记录 | 词条ID、字段名、URL的hostname和脱敏路径形状；查询参数只给名称，删除值；provider/assetId是否存在 | 建立原图/封面映射，不收全文或签名 |
| 存储与CDN | 服务商、区域、桶/源站脱敏名称、bucket/object公开读状态、CDN鉴权及缓存规则截图/导出摘要 | 判断匿名可读及入口缓存绕过 |
| 原件及派生图 | 原件、缩略图、WebP/PNG/JPEG派生对象路径清单，旧路径及备用域名对应关系 | 防止只封当前图但旧图仍公开 |
| 单条自有测试图 | 经确认允许测试的词条和自有图；匿名访问结果、授权访问结果、过期/篡改后的HTTP状态和类型，不提供完整签名URL | 受控验证实际访问边界 |

整改顺序：先区分公开封面/演示与受保护教学图；对受保护原件和全部派生对象关闭匿名读取；复用实际存储已有短效签名能力或服务端鉴权图片出口，只在完整详情授权成功后提供访问方式；同步封闭旧路径、备用域名与原件直链并处理CDN旧缓存。失败必须关闭，不能退回旧公开图。验收匿名拒绝、有效授权可读、篡改/过期拒绝，分别覆盖原件和派生图。只删basic URL不算图片访问控制完成，图片已经交付后仍可被保存。

## 回归与交付状态

本轮修改文件清单：

| 范围 | 文件 |
|---|---|
| 服务端 | server/index.mjs、server/word-access-policy.mjs、server/content-rate-limit.mjs（新增） |
| 公共投影与会话 | miniapp-uni/word-app1/common/public-word.js（新增）、auth-store.js、word-repository.js、mock-data.js |
| 请求客户端 | 同common目录的word-api-client.js、user-favorites-api-client.js、user-recent-words-api-client.js、user-entitlements-api-client.js、book-benefit-api-client.js |
| 页面 | miniapp-uni/word-app1/pages/word-detail/index.vue、pages/mine/index.vue（仅会话保护） |
| 测试及开发数据 | scripts/test-content-api-security.mjs、test-content-quota-core.mjs、test-content-session-isolation.mjs、verify-content-security-release.mjs（均新增）；scripts/fixtures/development-full-word-data.mjs（新增）；scripts/test-server-word-api-link.mjs、test-book-benefit-delivery-ui.mjs |
| 项目文档 | Prompt.md、Plan.md、Documentation.md、docs/CONTENT_ACCESS_POLICY.md、本文件 |

实际通过：上述三个新增专项、发行产物核验、原词条API/收藏/最近/会员权益/福利UI回归、check:miniapp、validate:content、check:production、git diff --check。HBuilderX最终发行编译正常退出，实际依赖图148项无开发预览/完整fixture，18个JS中26条私有样例文字缺失。独立只读代码审查通过，无阻塞问题；没有暂存、提交或推送。

沿用项目外 TEXT_API_SECURITY_MINIMAL_PLAN_2026-10-13.md 验收表。

- test-content-api-security：真实本机HTTP+内存权益适配器，验证basic字段、详情缓存头、拒绝/异常、最后额度full、同ID重试、响应丢失后429及恢复幂等、会员不扣次、转发IP不能换桶。不是生产DB并发证明。
- test-content-quota-core：执行未修改的consumeQuota，对严格内存SQL适配器验证余额1→0、同ID幂等、新ID拒绝及会员免扣；没有连接真实MySQL。
- test-content-session-isolation：执行实际Vue详情脚本（原生UI副作用stub）和实际repository/API/auth模块，验证退出/换号/重登迟到响应、续期ID、过期/401与公共缓存不留full。不是微信真机验收。
- 独立审查指出旧福利请求迟到认证拒绝可清掉新会话；仅修正book-benefit客户端及mine页的会话判定，未改变兑换事务。新增实际mine脚本四组迟到响应回归（换号401、续期403、重登401、换号成功），并补管理员写入200/400/500及首页配置GET/POST缓存头覆盖。
- verify-content-security-release：扫描新编译mp-weixin发行产物，检查开发私有样例与依赖残留，确认公开教程/小游戏素材仍在。产物存项目外，不覆盖unpackage，不上传。
- 尚需微信开发者工具/Android/iPhone交互验收、真实并发事务及实际生产入口/图片存储证据；不宣称整批已具备上线条件。独立审查结果及最终测试记录见Documentation.md。

## 2026-10-14：发行核验P2修正与用法

最终提交补审指出：省略依赖清单时原脚本会跳过图检查但仍输出完整成功结论。本轮仅修正核验脚本、增加针对性测试和使用说明，不改业务或重新构建。

必须同时传入发行目录与同次编译导出的模块清单：

```powershell
node scripts/verify-content-security-release.mjs "<mp-weixin发行目录>" "<compiler-module-inventory.json>"
node scripts/test-content-security-release-verifier.mjs
```

沿用已有编译导出格式：顶层非空JSON数组；每项有非空name、chunks数组（非空字符串名或非负整数ID，数组本身可为空）；可选modules为嵌套模块数组，嵌套项必须有name，若提供chunks也按相同规则校验。识别禁止开发依赖的规则仍为dev-preview-data或development-full-word-data，并在解析后检查以覆盖JSON转义名称。

省略清单、文件不存在/无法读取、非JSON、空数组或模块格式不符，均报错并非零退出。只有实际执行清单检查、私有样例扫描和公开素材检查后才能输出完整通过；输出明确说明不验证源提交绑定。测试使用仓库外的隔离生成样例，验证退出码及没有虚假完整通过结论；不批量删除临时文件。

已搜索scripts、package.json及相关使用文档，仓库中没有自动调用该核验脚本的入口；既有手动双参数命令可继续使用。旧发行目录和旧清单的扫描通过不能证明对应目标提交d5085c42a2c00709f804629fb5ffc21ee9293be3。产物与目标SHA的证明、生产限频/图片权限及线上/真机验收继续待验证。独立针对性复审以本轮项目外报告为准，不回填之前的无问题结论。
