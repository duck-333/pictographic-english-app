【第二批最终验收状态】

最终状态（2026-10-12，用户已确认）：17:36:14.965 开发预览版用户真机验收通过；20:04:18.265 开发版／20:06:37.797 本地发行版的最新修复源码针对性复审通过，教程图片重试 P2 已关闭，实际编译事件派发回归通过。

版本边界：最新 P2 异常分支的证据为源码复审及编译派发回归，不扩大为新版本异常分支全部经真机验收。旧二维码对应17:36版，不包含最新修复，本轮未生成新二维码。

历史记录与各版本证据保留；下文“待复审／待真机复验”等表述为当时状态，以本段最终状态为准。本批已进入待本地提交阶段，仅按已核对清单暂存，不提交、推送、合并或正式发布。

---

> 本文保留第二批首次实施记录。独立审查后的修复、用户追加布局、新版本证据和当前待针对性复审状态，以 [审查修复记录](BAXIAOTA_GAME_BATCH2_REVIEW_FIX_2026-10-12.md) 为准；原交付GIF已替换，首次截图不作为修复后验收依据。

# 巴小塔第二批完整游戏迁移

日期：2026-10-12（北京时间）。状态：**实施及本地验证完成，待独立审查；真机验收待完成**。本轮不暂存、不提交、不推送、不正式上传或发布。

## 基线与边界

开始时 master 工作区干净，HEAD、master、origin/master 均为 `65694dbacd8763c2ff71f72f9d9270ec788f2721`，历史包含第一批 `2ef2dd593ca4c6b5d150db55e3b757d0a9f003f6`。从该基线创建 `codex/baxiaota-game-migration`，本轮 HEAD 保持不变。

仅替换普通 `game-baxiaota` 分包容器并增加其场景、控制器、内容、组件和资源；复用 `common/navigation.js` 的既有返回首页方法。首页浮窗、首页业务、其他模块、pages.json、Vue2 main.js、manifest 的原配置不变，不增加依赖。HBuilderX 改写 manifest 换行时，仅在确认规范化文本与 HEAD 完全一致后恢复仓库原CRLF工作区格式；最终manifest不在修改清单中。

效果准稿为 `D:\小程序相关\小程序交互游戏设计\baxiaota-handoff.zip` 内完整新版 HTML，compact 为源码参考，沿用同目录开发交接方案。完整 HTML 的内嵌紧凑内容与 compact 相符。ZIP、HTML 未进入运行包。

## 文件安排

以下路径相对仓库根目录：

| 文件 | 责任 |
| --- | --- |
| miniapp-uni/word-app1/game-baxiaota/pages/index.vue | 页面、生命周期、总结切换、右侧点击/左推入口、重玩、既有查词导航 |
| game-baxiaota/common/game-controller.js（同小程序根） | 状态、手势命中和阈值、演示、统一动画/等待/文案延迟、暂停继续 |
| game-baxiaota/common/scene-renderer.js | 原型路径与变换的 Canvas 2D 绘制、远景矢量、静止角色 |
| game-baxiaota/common/game-assets.js | 本地资源清单及可失效的异步加载 |
| game-baxiaota/common/game-content.js | 原型文案与教学段落 |
| game-baxiaota/components/GameScene.vue | 节点/尺寸请求序号、DPR、重绘、单触点事件、加载重试 |
| game-baxiaota/components/GameLearning.vue | 当前阶段教学、详情展开、静止角色 |
| game-baxiaota/components/GameReview.vue | 总结三列、静止阅读角色、四张完整教程图与开始查词 |
| game-baxiaota/static/* | 九张原型栅格图，保留 PNG/JPEG/WebP 编码 |
| scripts/extract-baxiaota-reference.mjs | 从 compact 提取资源/内容，无新增依赖；只执行隔离的字面内容片段 |
| scripts/test-baxiaota-game.mjs | 实际控制器及 Vue 方法的可控异步/计时回归 |
| scripts/verify-baxiaota-simulator.mjs | 本地自动化协议执行真实编译页面方法并采集截图 |
| Prompt.md / Plan.md / Documentation.md / 本文件 | 目标、阶段、实现决策及验收记录 |

## 手动流程与参数

逻辑坐标 390×310；按实际 Canvas rect 映射，物理像素乘 DPR。原生 Canvas x/y 使用局部坐标，clientX/clientY 路径减去 rect.left/top。Canvas 与页面外层保留原型相对布局。

1. 点 A：旋转 2800ms，旋转 tween 为线性进度；图形内部变换仍使用 `t*t*(3-2*t)`。
2. 成弧：圆心 (195,230)，半径 `hypot(48,121)`，起角 `2*atan2(48,121)`，拖动角度映射到半圆。端点命中半径36，松手进度 >0.98 完成。
3. 成弧等待：2000ms 后出现上拉入口；橙/蓝颜色按原 CSS 的2秒 ease-in-out 过渡，原提示延迟650ms及两轮1300ms脉冲保留。
4. 第一次上拉：顶部 (195,230-radius) 命中半径32，拉动85逻辑px；松手 >0.93 完成拱门，顶部移至 (195,50)，进入等待。
5. **拱门完成后必须松手，再独立第二次上拉**：顶部命中半径36，上拉距离严格 >18 才触发建筑浮现1700ms；等待期间不会自行进入建筑阶段。
6. 建筑浮现完成后下拉135逻辑px，松手 >0.94 完成远景；保留建筑、弧、拱门、小旗、道路、配色和角色阶段显隐。

演示保留 arc1300/lift1100/reveal1700（兼容剩余 reveal1000）/zoom1600ms，普通阶段等待900ms，拱门等待1800ms，成弧额外等待4700+900ms。除 tilt 线性外，图形 tween 使用 `1-(1-t)^3`；内部图形变换保留 smooth。暂停保存任务原 from/to、elapsed；继续从累计时间推进，不从当前画面重建端点。文案延迟190/200/650ms也由同一循环管理。

## 统一暂停、接管与异步清理

- 单一帧循环和任务 Map 管理动画、等待、颜色、提示、文案；暂停使旧帧票据失效，继续只启动一条新循环。重玩/卸载清除任务并使旧帧无效。
- 只有支持拖动的阶段才能接管并取消对应 main 自动任务。旋转及未完成建筑浮现不允许拖动接管；详情暂停后“继续”完成原任务，保留累计时间。
- 展开详情暂停；关闭详情保持暂停。总结与回看保持暂停，不自动继续演示。onHide 暂停，onShow 重新确认 Canvas 节点、尺寸及图片，以保留进度重绘；窗口尺寸改变也暂停并重测。
- Canvas 请求序号在 nextTick 前捕获，节点回调和图片加载完成都检查最新序号及页面有效性。hide/unload/retry/replay 使旧请求失效；页级重玩/教程重试 nextTick 也有序号检查。
- Canvas 单触点按 identifier 跟踪，多触点取消当前拖动。右侧入口最大位移95px，左推超过42px打开，位移超过8px抑制本次后续 tap；支持单独点击。
- 教程使用 widthFix，完整显示四张图，不裁剪。图片失败可重试；开始查词调用原有返回函数，首页在栈内 navigateBack，否则 reLaunch。

## 已完成的专项回归

`node scripts/test-baxiaota-game.mjs` 通过。测试运行实际 controller 和从 Vue 文件提取的实际 options/methods；计时、nextTick、SelectorQuery 和图片 Promise 的返回顺序可控，没有用同步固定测量证明异步安全。

| 覆盖项 | 证据 |
| --- | --- |
| 完整手动阶段 | 成弧1999/2000ms边界、两次上拉分离、第二次18/18.1px阈值、建筑及最终下拉 |
| 缓动/暂停继续 | 旋转1000/2800线性，reveal680/1700三次缓出，原端点与 elapsed 保留，继续完成旋转/建筑 |
| 手动接管 | 弧阶段接管取消main；自动旋转、未完成建筑拒绝接管 |
| 单循环/旧帧 | 运行帧数量断言；暂停继续后迟到取消帧、重玩和卸载旧帧不改状态 |
| 节点测量乱序 | 新节点先返回/旧节点后返回；旧nextTick不发起查询；隐藏/卸载旧请求无效 |
| 图片乱序和重试 | 新图片先完成/旧图片后完成、卸载后完成、失败后重试，不覆盖新节点 |
| 页面生命周期 | 实际onHide/onShow/onUnload、总结回看保持暂停；旧教程重试/重玩nextTick失效 |
| 多触点 | 实际GameScene两个触点开始和拖动中加入第二触点均cancel；不同identifier不move。只证明方法处理，真机触摸派发待验 |
| 总结入口 | 实际左推方法及随后tap抑制、回看、重玩 |

`node scripts/test-baxiaota-entry.mjs`、`npm.cmd run check:miniapp`、`npm.cmd run validate:content`、八个相关 JS/MJS 语法检查通过；Git空白检查无错误。未运行与本批无关的服务端数据库/生产发布门禁。

## 编译、模拟器与交付证据

环境：HBuilderX5.07、微信开发者工具本地模拟器，基础库3.12.1，390px逻辑宽的 iPhone 样式模拟器。最终编译时间与包体积补记于下方完成核对段落。开发模式和本地发行均成功；发行显式 `--appid wxf9a29e671fac34d2 --upload false`，日志提示“请点击上传”未执行。既有 caniuse-lite/punycode 提示不阻断编译。

模拟器验证方式：通过本地自动化 App.callFunction 调用**真实编译 Vue GameScene 的 start/move/end**，传入局部坐标事件；不是直接写进度，也不是手机手势。实际 Canvas 绘制、节点查询、图片读取、详情/总结页面切换、真实页面栈和导航均运行。桌面鼠标工具遇到窗口遮挡，未把该操作当作成功证据。

最终版本手动全过程、自动演示、旋转暂停继续、建筑详情暂停继续、总结回看重取节点保持暂停、重玩及开始查词返回 `pages/index/index` 均通过。模拟器曾保留旧运行代码，退出工具后重新加载，并检查最终 controller/状态字段再采证。

证据目录（工作区外，不打入小程序包）：
`C:/Users/Lenovo/.codex/visualizations/2026/10/11/01a12b67-0384-7310-adfc-60cda5ffe082/baxiaota-batch2/`

- 01-angle、02-angle-rotated、03-arc-wait、04-arc-ready、05-arch-second-pull-wait、06-reveal-detail-paused、07-building、08-final：关键阶段PNG。
- 09-review：三列总结及静止阅读角色；10-tutorial/11-tutorial-detail/12-tutorial-video-home：四张完整教程图及查词按钮。
- simulator-results.json：完整流程实际断言结果。
- demo-simulator.gif、demo-frames.json、demo-*.png：模拟器自动演示连续截图记录，按实际时间间隔合成GIF；约1.1–1.4秒采一帧，不能作为60fps/性能验收证据，不是原生视频编码录屏。

## 资源与包体积口径

九张资源直接来自准稿：gate.jpg65587、wave.png50473、compass.png56018、celebrate.png50146、reading.png58022、guide-search.webp31832、guide-results.webp43836、guide-detail.webp38316、guide-video.webp50864 bytes，合计445094 bytes。原远景SVG824 bytes的路径/旗/道路以Canvas绘制，不另加载SVG图片。静止PNG没有序列帧。

编译产物中这九张图均位于 game-baxiaota/static，主包仅保留第一批entry.png32603 bytes；HTML/base64未进入代码包。普通分包归属不变，无independent或新预下载配置。

统计方法与第一批编译目录记录一致：递归求文件字节，排除 `.map` 与根目录 `project.*`，按 game-baxiaota 前缀分包。**不是微信压缩代码包分析值**，不与第一批预览上传统计混算。

| 模式 | 第一批主包 | 本批主包 | 第一批游戏分包 | 本批游戏分包 | 本批合计 |
| --- | ---: | ---: | ---: | ---: | ---: |
| dev | 1,111,543 | 1,111,961 | 37,838 | 644,319 | 1,756,280 |
| build | 413,290 | 413,513 | 4,672 | 496,249 | 909,762 |

相对第一批记录，dev合计增加606899 bytes，build合计增加491800 bytes；发行游戏分包增加491577 bytes。主包文件字节变化223 bytes（dev418）属于编译目录对比，不能据此断言首页业务有变更；首页及其他模块源码diff为空。第一批表为历史编译记录，未重编旧基线，不承诺编译器编号/模块索引逐字节不变。

最终开发成功：北京时间2026-10-12 **10:54:31.681**，输出dev/mp-weixin；本地发行成功：**10:56:23.819**，10:56:27.899导出build/mp-weixin。最后模拟器验收先检查实际 `controller.pause` 含旧帧票据失效代码，再运行完整流程：建筑详情暂停保留reveal=0.8066635279869734，旋转暂停保留tilt=0.3967857142857143，恢复完成；最终返回pages/index/index。截图和演示GIF以该开发产物重新采集。

## 待真机与内容审校

待真机：真实点击/拖动命中及两次上拉、双指取消/触摸派发、Canvas与页面滚动冲突、不同DPR/安全区/窄屏、首进图片与重试、切后台恢复和尺寸重测、演示流畅度/内存、详情展开/继续、总结往返重绘/教程加载、既有首页导航。第一批iPhone12验收不能代替第二批完整游戏验收，本轮尚无第二批手机证据。

内容沿准稿迁移，未把教学助记认定为语言学事实；Arctic与arc关联、arch/archa及archaeology等词源/释义须由内容负责人审校。四张教程图属于已有准稿资料，需要内容负责人确认素材授权及与当前产品界面的一致性。本轮未擅改稿件措辞。

交付停在待独立审查。审查通过后再做真机补验及后续版本操作，均需用户后续授权。

最终核对：当前分支codex/baxiaota-game-migration，HEAD/master/origin/master仍为65694dbacd8763c2ff71f72f9d9270ec788f2721；第一批提交为祖先。暂存区空，git diff --check退出0（仅现有换行转换提示）。只有上述分包、脚本及开发文档存在工作区变更，未提交/推送/合并/上传/发布。最终演示GIF为16帧、约19.88秒，依据demo-frames.json实际采样间隔合成。


## 后续真机反馈（2026-10-12）

本轮删除右缘入口/左推，使用最终“查看总结”按钮；教程改用保留原资源的PNG兼容副本并修复真实重试；箭头实心、总结长词单行、游戏底栏固定。当前依据为 BAXIAOTA_GAME_BATCH2_DEVICE_FEEDBACK_2026-10-12.md，开发16:25:34.984/本地发行16:39:40.188/二维码16:41:46。专项与模拟器通过，待针对性复审及本轮手机补验，保持未暂存、未提交。本文此前截图/GIF为前一版本历史证据。
