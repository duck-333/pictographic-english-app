# 我的页学习权益：两行两列局部修复（2026-11-24）

基线：codex/membership-monthly-yearly / eab9b1885414c14e67b2071e1bbb4a2d14132f74。本次权益布局修复已独立复审通过，用户授权局部暂存和本地提交；原部署文档及其他未提交内容保留，docs/competition/未读取未修改。

最终验收口径：据复审报告，所附安卓普通用户截图显示两行两列，无明显裁切或横向溢出；截图未带构建标识，不能据此严格对应本地构建。会员真机、窄屏、字体放大及实际触摸效果未补充证据，不标为全部通过。此前B→A真实首次注册发奖成功记录保留，不因本次布局修复而撤销或扩展其验证范围。

## 定位证据与边界

用户安卓截图显示：整行摘要正常，下面四项各保留约半行宽，但自动换行后全部靠左。首先核对源码和eab9b1885414沙箱包实际WXSS，确认没有编译丢失或额外同名权益样式覆盖：

```css
.entitlement-grid { display: flex; flex-wrap: wrap; gap: 16rpx; }
.entitlement-item { flex: 0 0 calc(50% - 8rpx); min-width: 0; box-sizing: border-box; padding: 20rpx; }
```

上方membership-summary是单独兄弟节点，不在四项容器中。四项文字的display:block及全局border-box均已编入WXSS。

将旧沙箱包复制到独立before目录，在微信开发者工具测量原生元素：容器宽344.666687px，卡片各168.333344px，行列gap各8px，flex-basis实际为calc(50% - 4px)，flex-grow=0、容器wrap。两张卡片宽度加间距刚好占满容器，没有余量；两列顺序完全依赖自动换行判定，若不同环境最终布局占用稍大即会将第二项移到下一行，并维持半行宽。**已定位的布局薄弱点是这种自动换行与精确宽度预算的耦合；当前模拟器仍呈两列，没有复现手机堆叠。手机端具体是否由rpx/小数舍入、字体或其他设备运行时行为触发，尚无该手机实际尺寸证据，不能宣称某个CSS特性不兼容或已证实某种引擎缺陷。**

原生SelectorQuery测量在该自动化上下文中出现对象克隆错误，最终改用开发者工具Page.getElements、Element.getDOMProperties、Element.getOffset、Element.getStyles读实际元素。没有把无法读取的尺寸当作通过。before/result.json保留旧包测量。

## 最小实现

应用源码仅修改miniapp-uni/word-app1/pages/mine/index.vue的权益模板和局部样式：

- 为现有四项增加两行容器，第一行累计获得/已消耗，第二行会员类型/会员状态。
- 行内两项使用flex:1及min-width:0平分扣除间距后的空间，不再使用半宽calc和flex-wrap推断行数；右项左边距16rpx，第二行上边距16rpx，横纵间距一致。
- 保留现有内边距、圆角和颜色。文字允许自然换行并提供1.5行高，不使用固定高度、截断、隐藏溢出或省略号。
- 上方剩余次数/会员有效期摘要保持原模板和样式，继续整行。
- 最终页面script与HEAD对应script逐字比对（仅忽略CRLF/LF）一致，邀请关闭状态、注册顺序、候选处理、会话隔离P2、注册后邀请卡刷新、权益数据及API环境均未改动。

新增scripts/verify-entitlement-layout-simulator.mjs，独立模拟器中注入普通/会员布局假数据及展示弹窗状态，读取真实编译元素及截图。它不是新人资格、授权或发奖端到端测试。结束恢复该模拟器原会话和request mock并回首页，不操作服务器账号。

## 最终构建与实际验证

从eab9b1885414导出独立源码，仅叠加最终mine页面修改。HBuilderX 5.07 / Vue2 / mp-weixin开发构建，北京时间2026-11-24 **19:19:59.023开始，19:20:09.964收到DONE Build complete**，随后主动结束watch。存在既有Browserslist过期提示，未安装依赖。源码副本与最终工作区页面内容一致。

沙箱包导入目录：

```text
D:\english-app\pictographic-english-app\artifacts\entitlement-layout-20261124\sandbox\mp-weixin
```

AppID：wxf9a29e671fac34d2。执行该包vendor内API配置模块，默认API实际为https://sandbox-api.baxiaota.com；没有修改为本地QA地址。构建及产物检查见sandbox/build-evidence.json、build.log、artifact-check.json、source-changes.patch。

定向验证：

```text
node --test scripts/test-miniapp-invitation-result-session.mjs scripts/test-miniapp-invitation-p2.mjs
node --check scripts/verify-entitlement-layout-simulator.mjs
node scripts/verify-entitlement-layout-simulator.mjs artifacts/entitlement-layout-20261124/after 9425
git diff --check
```

会话隔离、同账号注册后邀请卡刷新及候选有效性检查等10项回归全部通过；布局脚本语法与diff空白检查通过。未重复服务器或数据库回归。

最终包模拟器于北京时间 **19:24:04至19:24:10** 采集最终截图并通过测量：普通和会员均为2×2；卡片宽168.333344px完全相等，横纵间距8px；普通摘要宽344.666687px、高69.333336px，会员摘要宽相同、高90.666672px，保持整行。四项高度随文字行高为63.5px，没有固定高度。两种身份下弹窗打开、关闭前后，四张卡片的left/top/width/height逐项完全一致。

最终截图（全部晚于最终应用构建）及测量位于artifacts/entitlement-layout-20261124/after：

| 文件 | 内容 |
| --- | --- |
| 01-ordinary.png | 普通用户剩余次数整行，下面两行两列 |
| 02-member.png | 会员有效期整行，下面两行两列 |
| 03-ordinary-dialog-open.png / 04-member-dialog-open.png | 布局展示假数据下覆盖邀请弹窗，背景卡片不位移 |
| 05-ordinary-dialog-closed.png / 06-member-dialog-closed.png | 关闭后两行两列保持 |
| result.json | 原生坐标、尺寸、生效样式与截图时间 |

普通、会员及弹窗截图已实际查看；数据是模拟器展示fixture，不代表手机账号实际余额或会员状态。没有真实注册、发奖、账号清理或数据库写入。

## 真机证据及仍待补验

当前安卓手机需导入/手动分发本轮新包后复验：四项为固定两行两列，上方摘要整行；系统/微信字体放大、较窄屏幕下文字自然换行而不裁切，行内等宽且间距一致；邀请弹窗开关前后权益布局稳定、滚动/点击正常。会员展示可用已有会员账号复验，不调整当前用户权益来制造测试条件。

本轮实际模拟器未切换到窄屏型号或系统大字体，相关真机项目均保留待验；不能将模拟器正常写成用户手机故障已消失。用户已提供的新弹窗能在接收方安卓出现的证据保留，不扩大为本次布局修复已真机通过。

独立复审已通过；本次按用户授权局部暂存并本地提交，复用上述已通过的构建、模拟器和回归记录，不重复执行。安卓普通用户截图证据与构建标识的限制以上方最终验收口径为准；会员真机、窄屏、字体放大及实际触摸仍待补证。

本次提交仅纳入mine权益模板/样式、本交付文档及共享文档中的本轮记录。布局验证脚本、artifacts/和其他部署材料保持未提交，不读取或暂存docs/competition/。未上传、提审、发布、推送或部署。
