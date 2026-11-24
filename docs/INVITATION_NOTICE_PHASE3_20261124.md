# 邀请第三阶段：受邀提示局部体验优化

最新状态：用户已确认本轮弹窗优化通过独立复审，会话隔离P2已关闭，并授权本地暂存、提交。新版安卓/iPhone真机仍待验。最新构建和模拟器证据见文末P2章节；下方开发期间“待复审／未暂存未提交”等表述及初版构建截图保留为历史记录，不代表当前复审状态。

日期：2026-11-24；分支 `codex/membership-monthly-yearly`，基线 `de23f21471670e920decea69b5c186035eb25bd5`。本轮未暂存、未提交、未上传，不部署服务器。此前工作区文档修改和未跟踪材料保留，未读取或修改 `docs/competition/`。

## 已有真机证据

用户本轮提供的5张截图及操作说明确认：B（19558330953，沙箱账号11）为邀请人，A（19106858322）为受邀人；A已完成本次沙箱手机号注册并获得注册30次；B余额30→60、邀请进度1/5、累计邀请到账30次。记录为首次注册发奖主流程已跑通，不清理账号或删除历史记录重造新人。此证据针对改版前体验版，不能代替本轮新弹窗的真机验收。

## 视觉及交互

- 固定定位的居中弹窗，半透明深蓝遮罩；浅蓝至白色卡片、26px圆角，使用现有“象”字品牌标识，暖黄色权益区域强调30次。最大宽度340px，左右24px留白，小高度屏幕隐藏品牌装饰和副说明、收紧间距并计入安全区。独立关闭按钮44px点击区。
- 标题“好友邀你体验象形英语”；说明“首次完成手机号注册，可获30次查词权益。”；权益区域“30次／首次注册赠送／查词权益”；主操作“去完成注册”，次操作“先逛逛”。不表达受邀额外再得30次，不预先宣称领取成功。
- 仅当本次邀请成功保存、仍在有效期、没有其他待保存邀请，且当前账号尚无手机号绑定时展示引导。普通启动从存储恢复邀请时保留注册能力，不重新弹窗。
- 关闭及“先逛逛”只更新共享界面状态，不写邀请存储、不删除回执、不改变归属；两页共同消费该关闭状态。相同已保存凭证的重复App/页面钩子不会重弹；新的有效邀请允许一次新引导。
- 主操作先关闭引导。首页导航到现有“我的”手机号入口；在“我的”滚动到现有手机号授权按钮。弹窗自身不请求手机号，不和系统授权弹窗叠加。原候选完成后注册及分别取新微信code的逻辑保持。
- 遮罩阻止触摸移动和点击穿透，覆盖原底部导航；关闭后移除整个遮罩，无页面级滚动锁残留。各页onHide/onUnload停用本页提示，隐藏页不显示浮层。
- 注册后删除顶部常驻结果行。本人注册权益反馈使用无蒙层、固定于底部导航之上的轻提示，可关闭、8秒自动消失，离页即清除。REWARD_GRANTED/REWARD_PENDING依据已确认的首次注册事务显示本人30次已到账，分别补充好友奖励已到账或待到账；MANUAL_REVIEW、老用户、失效、满额、无法确认等单独文案，不推断本人新赠额，提示查看本页余额。普通无邀请登录沿用登录成功提示。
- 候选网络失败采用可关闭的非模态浮动重试卡；关闭不丢待保存邀请，原注册链路仍先完成保存。明确无效/过期提示不弹强制注册引导，不覆盖已有有效回执。页面可见时按原expiresAt定时更新过期状态。

## 实际改动

- `components/InvitationNotice.vue`：共享居中引导、固定轻提示、重试、关闭和有效期刷新；根节点高度0，不占原布局。
- `common/invitation-state.js`：新增仅在内存中的展示/关闭状态及只读UI投影，保留原邀请存储结构、顺序和并发控制。
- `common/invitation-feedback.js`：按真实注册响应生成受邀方结果文案；不依赖客户端isNew或余额推断赠额。
- `pages/index/index.vue`、`pages/mine/index.vue`：可见生命周期、复用原注册入口、替换顶部常驻提示。
- 两项P2保留：候选wx.login返回后、HTTP发送前操作有效性检查未改；手机号登录成功后仍await $nextTick，再刷新现有InvitationCard。
- 新增定向测试 `scripts/test-miniapp-invitation-notice.mjs` 和本地模拟器脚本 `scripts/verify-invitation-notice-simulator.mjs`。服务器、数据库、接口、API配置、AppID、Vue2入口、奖励规则及邀请人卡片均未修改。

## 编译和验证

最终应用代码开发构建：HBuilderX 5.07 / Vue2 / mp-weixin，2026-11-24北京时间13:55:18.908开始，13:55:28.875收到DONE Build complete，随后主动结束本次watch进程；不把主动结束watch当作编译器自然退出0。初次尝试因沙箱临时目录含“!”及非原生Windows路径被Webpack拒绝，改用独立原生绝对输出路径后成功；保留既有Browserslist过期提示，没有安装或升级依赖。

独立产物及证据：`artifacts/invitation-notice-20261124/`，含build.log、build-evidence.json、result.json和screenshots。该包明确连接 `http://127.0.0.1:3019` 本地fixture，AppID仍为wxf9a29e671fac34d2，**仅用于本地验收，不作为体验版上传包**。正式及沙箱API配置均未改。本轮截图均晚于最终应用代码构建，无后续应用代码修改。

定向命令：

```text
node --test scripts/test-miniapp-invitation-notice.mjs scripts/test-miniapp-invitation-p2.mjs scripts/test-miniapp-invitations.mjs
node scripts/test-miniapp-auth-phone-login.mjs
node scripts/verify-invitation-notice-simulator.mjs
```

定向测试最终7/7通过；源码测试覆盖关闭不丢回执、跨页和重复进入不重弹、恢复存储不重弹、过期/已注册不引导、网络失败及重试、无效新邀请保留原回执、不同结果文案；已有P2、邀请链路及手机号登录回归通过。同账号P2仍验证当前页面、一次统计刷新及可准备邀请。

最终编译模拟器于北京时间13:58:23至13:58:45通过：冷启动有效邀请、关闭存储完全保留、跨页不重弹、主操作进入原注册入口、原handlePhoneLogin链路提交保留回执及独立新code、同一Vue页面uid=21注册前后不变、现有邀请卡刷新并显示已注册、结果可关闭、网络503显示重试且恢复后引导正常。匿名转正式账号会触发原auth订阅及显式刷新两次统计；没有调整原刷新逻辑，不与同账号P2的一次刷新混淆。

截图（Pixel 9模拟器，工具当前缩放35%，原始图片218×488）：

1. `screenshots/00-home-baseline.png`：无提示首页。
2. `screenshots/01-invitation-guide.png`：受邀注册引导弹窗。
3. `screenshots/02-home-after-close.png`：关闭后首页；人工对照基准，品牌、搜索框、游戏浮窗、导航位置一致。
4. `screenshots/03-mine-no-repeat.png`：从首页切到“我的”无重复引导及顶部占位。
5. `screenshots/04-registration-feedback.png`：本人注册30次反馈、余额及现有邀请卡。
6. `screenshots/05-result-dismissed.png`：关闭结果后无残留。
7. `screenshots/06-network-retry.png`：网络异常重试轻提示。

模拟器脚本通过最终产物的真实组件方法、编译__e tap派发及原注册页面方法进行验证；wx.login/手机号code/服务响应均为本地假值，不调用真实微信、不访问沙箱或生产数据库、不生成真实奖励。结束恢复模拟器原本地会话/邀请存储及wx.login方法。自动化中的原生SelectorQuery尺寸回调超时，最终以真实前后截图人工核对布局，不宣称通过自动尺寸断言；截图及其时间以result.json为准。此前失败截图只作排障，不作验收证据。

## 尚待真机复验

本轮未执行新版iPhone/安卓真机。需要验证系统手机号授权弹窗出现/取消后的衔接，手指遮罩防穿透、关闭后的实际滚动/点击，320px小屏及不同安全区/字体大小、切后台恢复和真实分享重入。Pixel 9模拟器与源码方法回归不能代替这些项目。旧版用户真机主链路成功记录保留，不因UI修改重做账号首次资格。

本批保持未暂存、未提交，供独立复审；未上传、审核、发布或部署。

## 2026-11-24：独立复审P2——结果提示绑定本次登录会话

### 修改范围与方式

本次应用源码仅继续修改 `miniapp-uni/word-app1/pages/mine/index.vue`，保留此前所有UI改动；不修改全局会话通知规则、邀请候选、手机号注册顺序、邀请卡实现、服务器、数据库、发奖逻辑或API配置。

- 复用现有 `captureAuthSession` / `isAuthSessionCurrent`。`loginWithWechatPhone`成功返回（其内部已保存会话）后、`$nextTick`及后续网络刷新前记录本次会话快照。邀请卡刷新后先检查快照；收藏等刷新完成后，在清除任何已有结果或计时器之前，再同时检查页面可见状态和会话快照。失效旧任务直接返回，不碰新会话提示；成功后刷新阶段若抛错，同样不让失效旧任务显示错误反馈。
- 快照包含现有会话版本，退出后重登同一user ID甚至相同测试token也会因原版本变化而使旧任务失效；没有仅比较user ID，也没有调整同账号正常续期的通知政策。
- 页面onLoad复用 `subscribeAuthSession`，会话退出或切换立即调用原结果清理方法，取消计时器、将计时器句柄和结果置null。订阅初始化有去重保护。
- onUnload和beforeDestroy共用可重复调用的清理方法：停用本页提示、清理结果/计时器并解除订阅；隐藏页仍沿用原onHide清理，不因页面返回重复订阅。
- 保留原同账号手机号登录成功后的 `$nextTick` + `InvitationCard.refresh()` P2，以及候选code返回后、候选HTTP发送前的有效性检查。没有重构登录系统或扩大业务范围。

新增 `scripts/test-miniapp-invitation-result-session.mjs`、`scripts/verify-invitation-result-session-simulator.mjs`；更新本文件和Documentation.md的状态记录。

### 先复现，再验证

新增源码回归先运行于修复前实际页面：8项测试中7失败、1通过。收藏/邀请统计两种延迟点下，退出、切换及退出后同号重登共6项都复现旧到账提示覆盖当前状态；已有提示在外部退出/切换时不立即清理也失败。页面隐藏/销毁不显示结果的原有路径通过。未以mock页面登录方法替代实际handlePhoneLogin。

修复后新增8/8通过，覆盖：

1. 实际handlePhoneLogin调用原登录客户端及真实InvitationCard.refresh / refreshData，分别挂起 `/favorites` 和 `/summary` 请求；退出后释放旧响应，结果保持null，未创建新8秒计时器。
2. 两种延迟点等待期间切换账号，旧任务不覆盖或清除新会话的提示与计时器。新会话提示/计时器由用例放置为独立测试对象，旧任务继续走真实handlePhoneLogin链，用于直接检测其是否越权修改当前展示。
3. 退出后重登同一账号，同user ID且使用相同假token；原会话版本变化使旧任务仍失效，当前提示和计时器保持不变。
4. 正常结果已显示时，从会话模块直接退出或切换，结果及计时器立即清理，不只依赖页面handleLogout手动清理。
5. 正常登录可显示本人注册30次反馈；现有邀请卡registered=true，正常同账号场景仍为一次统计请求。
6. 隐藏或卸载页面后释放旧请求不恢复提示；onUnload/beforeDestroy重复清理后，后续会话变化没有页面订阅回调。

计时器用可控8秒假计时器断言创建/取消与对象归属，其他请求和会话超时保持原计时能力。该用例不创建真实账号或奖励。

实际执行：

```text
node --test scripts/test-miniapp-invitation-result-session.mjs scripts/test-miniapp-invitation-p2.mjs scripts/test-miniapp-invitation-notice.mjs scripts/test-miniapp-invitations.mjs
node scripts/test-miniapp-auth-phone-login.mjs
node --check scripts/test-miniapp-invitation-result-session.mjs
node --check scripts/verify-invitation-result-session-simulator.mjs
git diff --check
```

合计15/15测试通过，手机号登录回归通过；提取最终mine SFC的script、移除import/export壳后用Node vm.Script解析通过，两个新增脚本语法检查及git diff --check通过。未重跑服务器或数据库回归。

### 本次最终构建与模拟器证据

- HBuilderX 5.07 / Vue2 / mp-weixin开发编译：北京时间2026-11-24 **14:14:28.986开始，14:14:38.327 DONE Build complete**。随后主动终止本次watch；构建驱动退出0，不据此声称编译器watch自然退出0。只有既有Browserslist数据过期提示，没有新依赖。
- 新独立根目录：`artifacts/invitation-notice-p2-20261124/`。包含build.log、build-evidence.json、result.json及screenshots；AppID仍为wxf9a29e671fac34d2，测试API为 `http://127.0.0.1:3020`，**仅本地模拟验收，不是体验版上传包**。此前13:55构建/13:58截图不作为本项P2修复证据。
- 微信开发者工具自动化9423、本地fixture3020；运行 `node scripts/verify-invitation-result-session-simulator.mjs`，北京时间 **14:18:05.737开始，14:18:15.295通过**。本次截图全部晚于14:14:38最终构建，之后没有修改应用源码。
- 正常手机号登录调用实际页面方法，假微信code和假手机号授权code走原客户端；结果存在且计时器有效，InvitationCard已注册且统计已刷新。已显示结果时调用退出，立即无提示/计时器。
- 挂起实际收藏请求后退出：退出前同一页面uid=9、authLoading=true、已登录；释放旧响应并等待原handlePhoneLogin完成，uid仍为9，loggedIn=false、result=null、timerActive=false，卡片未注册且无统计。
- 挂起实际邀请统计请求后退出：同一页面uid=13；释放旧响应后同样保持未登录、result=null、timerActive=false。以上等待均由fixture服务器暂缓响应控制，没有用静态页面状态替代登录/刷新链路。

本次实际截图：

| 文件（位于新根目录） | 北京时间 | 内容 |
| --- | --- | --- |
| screenshots/01-normal-login-result.png | 14:18:08.278 | 正常登录本人权益结果及现有邀请卡 |
| screenshots/02-logout-during-favorites-final.png | 14:18:11.998 | 收藏刷新等待期间退出，旧请求结束后的最终页面 |
| screenshots/03-logout-during-card-refresh-final.png | 14:18:15.295 | 邀请卡刷新等待期间退出，旧请求结束后的最终页面 |

三张截图已实际查看：正常状态展示结果；两种退出后的页面均无旧到账提示或蒙层。模拟器调用真实编译页面方法，手机号授权及网络响应使用本地假值，没有真实微信授权、沙箱/生产数据库或真实发奖。脚本结束恢复该独立模拟器原会话/邀请存储及wx.login方法。

### 真机待验及交付边界

本项P2仍需在新版安卓/iPhone真机慢网环境，验证手机号授权后收藏或邀请卡仍在刷新时退出、切换及退出后同账号重登，不恢复旧到账提示；另补验已有提示退出时消失及页面返回。此前列出的系统授权衔接、小屏/安全区、手指触摸等新版UI项目继续待验；既有B邀请A真机主流程成功记录不改写为本项P2已真机通过。

所有既有工作区修改保留，docs/competition/未读取未修改；不清理账号、不改服务器或数据库，不上传、部署、暂存或提交。停在本项P2待单点复审。
