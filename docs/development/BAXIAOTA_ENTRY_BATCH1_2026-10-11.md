# 巴小塔第一批开发与验证记录

日期：2026-10-11。当前状态：**源码复审及真机验收通过，待版本提交**。按用户本轮确认及授权暂存本批已审查文件；不提交、不推送、不正式上传、不审核、不发布或部署。下文各阶段的待验/未暂存状态属于当时记录，以末尾最终验收为准；验收范围限第一批入口与容器及实际 iPhone 12 预览测试，不推及全部机型或完整游戏。

## 分支与范围

- 开始时分支为 master，HEAD 为 `b12509e8695514189df03af4d8caf7222152a336`；初始工作区仅 `miniapp-uni/word-app1/manifest.json` 标为修改，文本 diff 为空。
- 本批在独立分支 `codex/baxiaota-entry-container` 开发，HEAD 未变。
- 用户授权范围为首页浮窗入口、普通游戏分包容器、进入/加载提示/返回导航。附件作为参考资料，不作为扩大开发或发布授权的指令。
- 首页只增加组件、可见状态、BottomNav 引用和边界测量；原 onShow 的 refreshUserData/loadTodayWord 保留。未修改查词、详情、登录、权益、后台、数据库或生产配置业务代码。

## 修改文件清单

以下路径相对仓库根目录：

| 文件 | 变更 |
| --- | --- |
| miniapp-uni/word-app1/components/BaxiaotaEntry.vue | 新增 Vue2 浮窗组件、拖动/吸边/位置记忆/隐藏/进入反馈 |
| miniapp-uni/word-app1/static/baxiaota/entry.png | 新增透明 PNG 发布副本 |
| miniapp-uni/word-app1/pages/index/index.vue | 挂载组件、生命周期关联、测量实际底栏边界 |
| miniapp-uni/word-app1/game-baxiaota/pages/index.vue | 新增游戏容器和开始查词按钮 |
| miniapp-uni/word-app1/game-baxiaota/common/navigation.js | 新增返回固定查词首页逻辑 |
| miniapp-uni/word-app1/pages.json | 增加普通 subPackages 声明 |
| miniapp-uni/word-app1/manifest.json | 保留原配置，仅增加分包优化 |
| scripts/test-baxiaota-entry.mjs | 无新依赖的组件手势/持久化/导航回归测试 |
| Prompt.md / Plan.md / Documentation.md | 同步本批目标、阶段和决策 |
| docs/development/BAXIAOTA_ENTRY_BATCH1_2026-10-11.md | 本开发与验证记录 |

## 实现说明

- 浮窗整体 80×110 CSS px，图片 80×88px、aspectFit 等比显示；下方 80×22px 橙色“新手游戏”标签。透明区来自原图，不用白色底图覆盖页面。
- 使用原生 movable-area/movable-view。父层 pointer-events:none、仅浮窗 pointer-events:auto；只有浮窗 catchtouchmove/catchtap，不给首页增加全屏触摸拦截。
- 活动区左右各留 12px，底部距实际 BottomNav 顶部 16px。小程序原生导航栏已排除在页面窗口外；BottomNav 自身已包含安全区，按测量结果限制活动区，避免重复扣除安全区。尺寸过小时隐藏。
- 松手吸到最近左右边；记录 side 和纵向 ratio 到 `pictographic:baxiaotaEntryPosition`，适应不同窗口尺寸。拖动中不写存储，松手稳定后写一次。
- 从起点的最大位移超过 6px 后，本手势及其延迟 tap 不进入游戏；移出再移回、取消、多触点也不误打开。下一次独立点按正常进入。
- 搜索聚焦、键盘高度大于零、首页隐藏时移除入口；页面重新显示时恢复位置并解除进入锁。
- 进入采用 uni.navigateTo `/game-baxiaota/pages/index`，提供 loading 和失败提示，避免重复进入。
- 返回固定 `/pages/index/index`：首页在栈中则 navigateBack 对应 delta；不在栈中则 reLaunch。无 switchTab，无重复 navigateTo 首页。
- 容器本批只显示准备中说明和开始查词按钮；未迁移完整场景、教学流程、暂停逻辑。
- 原生验证中发现 movable-area 的动态对象 style 在当前 Vue2 编译链未形成有效尺寸，已改为 CSS 字符串，并在活动区布局完成后挂载 movable-view。最终产物包含这项修复。

## 配置差异（单列）

pages.json 新增：

```json
"subPackages": [{
  "root": "game-baxiaota",
  "pages": [{
    "path": "pages/index",
    "style": {
      "navigationBarTitleText": "巴小塔 · 象形探索",
      "navigationBarBackgroundColor": "#f0f9ff",
      "navigationBarTextStyle": "black"
    }
  }]
}]
```

manifest.json 仅在 mp-weixin 下增量加入：

```json
"optimization": {
  "subPackages": true
}
```

原 AppID `wxf9a29e671fac34d2` 和原有字段保留。未添加 independent、预下载、tabBar、权限或新的 npm 依赖。中间一次 HBuilderX publish 未显式传 AppID 导致 CLI 将其写为 null，已恢复原值；最终发行编译显式传入原 AppID，复核最终 diff 仅有上述三个新增行。

## 图片优化

| 项目 | 原图 | 发布副本 |
| --- | --- | --- |
| 路径 | D:\小程序相关\小程序交互游戏设计\巴小塔2 浮窗.png | miniapp-uni/word-app1/static/baxiaota/entry.png |
| 像素 | 1749×2176 | 212×264 |
| 文件大小 | 928,418 bytes | 32,603 bytes |
| 透明度 | Alpha | Alpha 保留 |

采用高质量双三次等比缩小，文件约减少 96.5%；264px 高度覆盖 88px 显示高度的 3 倍像素。未改写原图。已检查透明背景和等比显示。主包首页使用该图，因此此图归属主包；完整游戏资源尚未迁入。

## 编译与资源归属

环境：HBuilderX 5.07；微信开发者工具 2.02.2609212 Nightly；模拟器 iPhone 12/13，运行库日志显示 3.12.1。

- 最终开发编译：22:15:04 编译成功，输出 `unpackage/dist/dev/mp-weixin`。
- 最终本地发行编译：22:17:56 编译成功并导出 `unpackage/dist/build/mp-weixin`。使用 `publish mp-weixin --appid wxf9a29e671fac34d2 --upload false`，没有执行上传；日志最后的“请点击上传”未执行。
- 两种 app.json 都含 `game-baxiaota` 普通分包，入口为 `pages/index`。
- 分包包含 `pages/index.js/.json/.wxml/.wxss` 和 `common/vendor.js`；返回导航实现位于分包 vendor 中。首页组件和入口 PNG 位于主包。未打包 ZIP HTML 或旧版 HTML。
- 运行期入口和游戏容器没有观察到阻塞错误。编译有既有 caniuse-lite 过期提示；工具另有 preload、punycode、crashpad 管道提示，编译/打开最终成功。开发环境原有 `sandbox.invalid` 请求失败使首页线上词卡为空，未修改 API 配置来消除提示。

编译目录文件字节统计（排除 .map 与 project.*，不是微信上传压缩包/代码包分析值）：

| 模式 | 主包文件 | 游戏分包文件 | 合计 |
| --- | ---: | ---: | ---: |
| dev | 1,111,543 | 37,838 | 1,149,381 |
| build | 413,290 | 4,672 | 417,962 |

发行分包明细：common/vendor.js 1,174；pages/index.js 1,942；index.json 166；index.wxml 618；index.wxss 772 bytes。未取得同口径改动前编译目录，故不声明主包增量精确值。

## 操作验证记录

微信模拟器原生自动化协议操作真实编译页面，并读取页面栈/原生布局/存储；另用桌面鼠标操作最终发行预览。自动化结果不等于真机验收。

| 项目 | 操作与结果 | 结论 |
| --- | --- | --- |
| 初始布局 | 390px 页面宽度；入口实际 80×110，right=378；BottomNav.top=663.67，入口 bottom=647.67，间距16px | 通过 |
| 左右吸边 | 原生 touchstart/move/end 从右下拖到左侧，x=0、y=337.7；再拖到右侧 x=286 | 通过 |
| 拖动不打开 | 超过6px释放后仍只有首页；额外延迟 tap 未进入；下一次完整点按正常进入 | 通过 |
| 本地记忆 | 保存 left/ratio=0.628084…；返回及 reLaunch 重建首页后恢复 x=0、y=337.7 | 通过 |
| 进入 | 完整点按后栈为首页 pageId=3 + game-baxiaota/pages/index pageId=4；看到容器 | 通过 |
| 返回已有首页 | 点击开始查词，回到原 pageId=3，页面栈仅首页，未创建重复首页 | 通过 |
| 无首页返回 | reLaunch 到游戏，栈仅游戏 pageId=6；点按钮后栈仅首页 pageId=7 | 通过 |
| 搜索聚焦 | 原生点按 input，focused=true、visible=false，截图不显示浮窗 | 通过 |
| 浮窗外词卡 | 开发环境仅内存注入 published 的 study 测试词卡，在浮窗外点按；进入原 word-detail?id=word-study | 通过，未验线上词库内容 |
| 页面可滚动 | 内存长词卡让 scrollHeight=1038，pageScrollTo 后原生 scrollTop=200 | 程序化滚动通过 |
| 已滚动页拖浮窗 | scrollTop=200 时拖浮窗，位置变为 x=0/y=257.7，scrollTop 仍200，页面栈仍首页 | 通过 |
| 最终发行鼠标操作 | 从右下拖至左侧，首页内容未跟随移动、未打开；点击橙色标签进入，再点开始查词返回，左侧位置保留 | 通过 |
| 浮窗外手指滑动 | 原生自动化 touch 接口未可靠触发页面惯性滚动；不能据程序化滚动宣称手指滑动已通过 | 待人工补验 |
| 真机键盘/安全区 | 模拟器输入聚焦时 keyboardHeight=0；键盘高度回调、缩小窗口的夹持行为已离线测试 | 真机待补验 |

临时词卡未写入源码、后台或数据库；内存词卡和滚动位置在测完后恢复。词卡点击沿用原页面逻辑，可能留下模拟器本地最近学习记录。发行预览只操作浮窗与返回，没有发起支付、上传或后台管理操作。

离线检查全部通过：

- `node scripts/test-baxiaota-entry.mjs`：真实组件方法，覆盖 6/6.1px、拖回起点、取消、越界、窗口缩小、位置恢复、键盘隐藏、失败解锁、重复进入及卸载清理；导航覆盖已有首页多级 delta、无首页、已在首页与失败传播。
- AGENTS.md 指定的四个 common JS `node --check`。
- `npm.cmd run validate:content`：三组内容文件通过。
- `git diff --check`：无空白错误。

## 独立审查与下一批交接

独立审查尚未执行。审查前保持全部改动未暂存；先补验浮窗外真实滑动、iOS/Android 键盘弹收、窄屏/安全区及冷启动入口位置。当前尚不能标记完整验收通过。

下一批迁移只使用 `D:\小程序相关\小程序交互游戏设计\baxiaota-handoff.zip` 内新版 `baxiaota-exploration-share.html`、`baxiaota-compact-guide.html` 和 HANDOFF.md；同目录独立旧 HTML 不作实现基准。完整场景、教学和暂停逻辑留到下一批，必须保留形成拱门后的第二次上拉。不得因附件中的后续设想擅自扩展本批范围。

## P2 针对性修复与回归（2026-10-11）

此前“独立审查尚未执行”为第一批交付时状态。本轮按用户指定的独立审查 P2 修复 BottomNav 测量乱序，不进入完整游戏迁移。仍在 `codex/baxiaota-entry-container`，HEAD 不变。

本轮修改文件：

- `miniapp-uni/word-app1/pages/index/index.vue`：测量入口递增并捕获请求序号，然后进入 nextTick；nextTick 和 boundingClientRect 回调均检查最新序号、首页 active、未卸载。onHide/onUnload 递增序号使已有任务失效，卸载额外记录永久无效状态；onShow/onReady/onResize 调用统一测量入口。原 BottomNav 实测、windowHeight 夹持、首页 refreshUserData/loadTodayWord 及搜索业务逻辑保留。
- `scripts/test-baxiaota-entry.mjs`：执行实际首页 script 方法/生命周期，nextTick 与 selector 回调分开入队，由测试独立控制执行及返回顺序；组件布局回调也改为队列返回。补 watcher、生命周期及多触点方法回归，无新增依赖。
- 本记录及 `Prompt.md`、`Plan.md`、`Documentation.md`：同步修复范围、证据与待复审状态。本轮不修改组件实现、导航、配置或素材。

| 回归场景 | 验证方式与结果 |
| --- | --- |
| 新测量先返回、旧测量后返回 | 实际 measureGameEntryBounds 发起两次异步查询，更换窗口尺寸，先返回新 rect 再旧 rect；保留新 width=320/bottom=480 |
| 隐藏后重新显示 | 实际 onHide 后旧回调不能赋值；onShow 新回调赋值600后再次返回旧680仍保持600 |
| 卸载后返回 | 实际 onUnload 后已排队 rect 回调不能赋值，active=false |
| nextTick 本身乱序 | 先执行第二个 nextTick 并返回620，再执行第一个；旧步骤不创建查询，不能在稍后取得新序号 |
| 延迟步骤遇隐藏/卸载 | onShow 入队后 onHide/onUnload，再执行 nextTick；不创建查询 |
| 原边界夹持与业务调用 | rect.top=999 时仍夹持至 windowHeight=700；onShow 仍调用两个原业务方法（测试仅替换这些方法的网络副作用） |
| 搜索隐藏与恢复 | 执行首页实际 handleSearchFocus/handleSearchBlur 和可控失焦计时器，将 focused 传入组件，显式调用实际 visible watcher；隐藏取消手势/清除 positionReady，失焦后布局队列返回恢复显示 |
| 键盘隐藏与恢复 | 调用 mounted 注册的实际 keyboardListener，再显式分发 visible watcher；height=250 隐藏并取消手势，height=0 和布局回调后恢复 |
| 首页隐藏与重显 | 执行实际 onHide/onShow，传递 active 并显式调用 active/visible watcher；重显恢复 positionReady 并解除 opening 锁 |
| 多触点防误开 | 分别覆盖起始两触点、单触点开始后 move 增加第二触点；end/延迟 tap 不导航，下一次独立单触点可进入 |

上述 watcher 分发由离线 harness 显式调用实际 Vue options watcher，不等于验证 Vue 调度器、原生触摸派发或真机布局。多触点结论仅限列出的两个方法事件序列；真实双指触摸、交替抬指等原生序列仍待真机补验。测量乱序结论来自受控异步回调队列，不使用同步固定回调证明异步安全。

验证结果：

- `node scripts/test-baxiaota-entry.mjs`、脚本语法检查、AGENTS.md 指定四个 common JS 语法检查、`npm.cmd run validate:content`、`git diff --check` 均通过。
- HBuilderX 开发重新编译：北京时间22:47:48成功；本地发行重新编译22:48:30成功、22:48:31导出成功。发行命令显式指定原AppID及 `--upload false`，没有点击上传。
- dev/build 的首页编译JS均包含请求序号、隐藏/卸载失效及延迟回调校验；两种 app.json 保留 game-baxiaota 普通分包。manifest diff仍仅为第一批的分包优化增量，AppID保留。
- 初次普通权限CLI调用未连接主程序；沙箱外调用后编译成功。保留既有 caniuse-lite 过期、punycode 和 crashpad 管道提示；开发者工具最终 open 成功。这些提示不作为运行期验收证据。
- 本轮没有重新执行模拟器交互或真机操作；第一批模拟器操作记录属于此前版本，不能直接替代本次运行期验收。

仍缺真机证据：浮窗外真实手指滚动、iOS/Android 键盘弹收、窄屏和安全区、冷启动定位、多触点原生手势。修复完成停在待针对性复审；所有改动未暂存、未提交、未推送、未上传、未部署。

## P2 最终版本手机预览准备（2026-10-11）

- 用户授权仅生成真机预览，不进行正式上传审核或发布。保持 `codex/baxiaota-entry-container`，未暂存、未提交、未推送、未正式上传、未审核、未发布或部署。微信 `preview` 发送了预览代码包，因此此前“未上传”描述为生成预览前的状态，不应理解为未发生预览传输。
- 本次从当前源码重新生成本地发行产物：北京时间 **2026-10-11 23:02:03.014 编译成功，23:02:03.501 导出成功**。HBuilderX 命令显式指定原 AppID `wxf9a29e671fac34d2`、`--upload false`。
- 二维码使用的明确项目路径：`D:\english-app\pictographic-english-app\miniapp-uni\word-app1\unpackage\dist\build\mp-weixin`。不是旧开发产物或源码目录。
- 生成二维码前读取最终首页编译 JS，确认入口递增测量序号、隐藏/卸载失效及 active/unloaded 校验均存在；产物修改时间晚于页面源码。编译 app.json 保留游戏分包，project.config.json 保留原 AppID；专项回归再次通过。
- 微信开发者工具 CLI `preview` 返回成功；二维码保存在 `C:\Users\Lenovo\.codex\visualizations\2026\10\11\01a12b67-0384-7310-adfc-60cda5ffe082\baxiaota-p2-preview.png`，同目录 `baxiaota-p2-preview-info.json` 保存工具返回的包大小：合计417,692 bytes，主包413,096 bytes，游戏分包4,596 bytes（微信预览口径，与此前编译目录统计不同）。
- 真机结果尚待用户反馈。请覆盖冷启动入口位置、拖动防误开与吸边、浮窗外滑动、搜索/键盘弹收、进入返回、切后台后恢复及多触点；反馈手机型号/系统及具体异常。待反馈后记录，不提前标为通过。

### 用户真机反馈：iPhone 12

- 用户在上述 P2 最终版本预览后反馈，设备为“ip12”（iPhone 12）；iOS 与微信版本未提供。
- 用户确认通过：拖动吸边、浮窗外滑动、搜索与键盘显隐、进入返回；双指触摸无响应，用户确认符合预期。此为用户手动验收反馈，非代理直接观察。
- 防误开、切后台恢复：解释测试步骤后，用户补充确认“两项没问题”，记为 iPhone 12 手动验证通过。与上述反馈对应同一份北京时间2026-10-11 23:02:03编译的 P2 最终预览版本。
- 其他设备、iOS/微信具体版本、窄屏/不同安全区、单独冷启动定位及更多原生多触点序列仍无明确验收证据；这些限制不扩充为本批所有机型均已验收的结论。

### 第一批最终验收与暂存授权

- 用户最终明确确认：“页面正常滚动，浮窗保持屏幕位置，不误打开游戏；其他本轮真机项目也已通过”，并要求将第一批状态改为 **源码复审及真机验收通过，待版本提交**。源码复审通过按用户确认记录，非本轮另行执行新的审查。
- 实际测试设备：iPhone 12；iOS/微信具体版本未提供。对应预览版本：北京时间 **2026-10-11 23:02:03** 编译的最终发行产物，含 P2 测量序号修复，由微信 CLI preview 生成二维码。
- 本轮真机确认通过：页面正常滚动且浮窗保持屏幕位置、拖动吸边与位置保持、防误开、搜索与键盘隐藏/恢复、进入返回、双指触摸无响应、切后台恢复。均为用户手动反馈。
- 暂存前核对：分支 `codex/baxiaota-entry-container`，HEAD `b12509e8695514189df03af4d8caf7222152a336`；暂存区原为空，工作区仅本批代码、资源、测试与文档。manifest.json 文本 diff 仅增加 `mp-weixin.optimization.subPackages=true` 三行；原 AppID 和其他配置保留，初始修改标记未含其他文本增量。
- 暂存范围为修改文件清单中的12个明确文件路径，不含自动生成编译产物、二维码或其他业务模块。暂存后以 `git diff --cached --name-status`、`--stat`、`--check` 核对；仅暂存，不提交、不推送、不正式上传审核或发布，不进入下一批完整游戏迁移。
