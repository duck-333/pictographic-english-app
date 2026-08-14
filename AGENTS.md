# Project Agent Instructions

本文件是本项目的长期协作记忆。任何 Codex、子代理或开发同事在改代码前，都要先读这里。

## 项目定位

- 项目名称：象形英语 / Pictographic English 小程序。
- 当前主线：在已有 demo 基础上，用 HBuilderX + uni-app 跑通微信小程序 MVP。
- 当前优先级：先保证“查词首页 -> 单词详情页 -> 我的页面/学习数据雏形”稳定可运行，再扩展后台、账号、云端、视频和内容管理。
- 当前真正要运行的小程序目录：`miniapp-uni/word-app1`。
- 管理后台必须是独立后台项目或独立 Web 后台入口，不允许作为普通小程序页面或隐藏入口暴露给用户。

## 安全规则

- 禁止批量删除文件或目录。
- 不要使用 `del /s`、`rd /s`、`rmdir /s`、`Remove-Item -Recurse`、`rm -rf`。
- 需要删除文件时，只能一次删除一个明确路径的文件，例如：`Remove-Item "C:\path\to\file.txt"`。
- 如果需要批量删除文件，必须停止操作，让用户手动确认和处理。
- 不要回滚、覆盖、格式化用户已有改动，除非用户明确要求。
- 最小充分防御规则：默认不新增 hash、冻结 contract、baseline 或 gate。只有能明确说出一个具体失败场景，并说明 Git、版本号、主键、事务、唯一约束、类型和普通测试为什么不足时，才允许加入。
- 不要为了简化而删除已有安全措施。门禁只放在不可逆、跨系统、安全或正式发布边界。前置检查不得挤掉真正的代码执行、模拟或测量。

## 运行和测试

- 根目录 React/Vite demo：
  - 安装依赖：`npm i`
  - 本地预览：`npm run dev`
  - 构建检查：`npm run build`
- 微信小程序 MVP：
  - 在 HBuilderX 打开 `miniapp-uni/word-app1`。
  - 用 HBuilderX 执行：`运行 -> 运行到小程序模拟器 -> 微信开发者工具`。
  - 微信开发者工具只负责预览 HBuilderX 编译后的项目，不要手动把源码目录当微信原生项目导入。
  - 如果必须手动导入微信开发者工具，应导入编译产物：`miniapp-uni/word-app1/unpackage/dist/dev/mp-weixin`。
- 轻量静态检查：
  - `node --check miniapp-uni/word-app1/common/mock-data.js`
  - `node --check miniapp-uni/word-app1/common/user-store.js`
  - `node --check miniapp-uni/word-app1/common/content-schema.js`
  - `node --check miniapp-uni/word-app1/common/word-repository.js`
  - `npm.cmd run validate:content`（Windows PowerShell 下优先用这个，避免 `npm.ps1` 执行策略拦截）
- 当前没有完整自动化测试套件。完成前至少要做微信开发者工具手动验收，并记录无法自动验证的部分。

## 改代码边界

- 小程序业务代码优先改：
  - `miniapp-uni/word-app1/pages`
  - `miniapp-uni/word-app1/components`
  - `miniapp-uni/word-app1/common`
  - `miniapp-uni/word-app1/pages.json`
  - `miniapp-uni/word-app1/manifest.json`
- 最小后台数据准备优先改：
  - `content-seed`
  - `scripts/validate-content.mjs`
  - `BackendDataModel.md`
  - `admin-portal`
- 不要在 `miniapp-uni/word-app1/pages` 里新增可由普通用户访问的内容录入、词库管理、资料管理页面。后台录入应放到独立后台项目，并通过管理员登录和权限控制访问。
- `miniapp-uni/word-app1/main.js` 当前必须保持 Vue2 版 uni-app 入口：`import Vue from 'vue'`、`App.mpType = 'app'`、`new Vue({ ...App }).$mount()`。不要改成 Vue3 `createSSRApp`，除非明确执行整项目升级。
- 根目录 `src` 是原 React demo/参考实现。除非任务明确要求，不要把它和小程序实现混在一起改。
- `miniapp-uni` 外层旧项目容易造成运行路径混乱。除非任务明确要求迁移或清理，不要主动改外层旧项目。
- 原始课件、Word、PPT、截图素材通常在 `E:\象形英语` 或桌面/图片目录，默认只读参考。需要改这些文件时必须先说明原因。

## 不要动的目录

- `.git`
- `node_modules`
- `dist`
- `miniapp-uni/unpackage`
- `miniapp-uni/.hbuilderx`
- `miniapp-uni/node_modules`
- `miniapp-uni/word-app1/unpackage`
- `admin-portal/pictographic-admin/unpackage`
- `admin-portal/pictographic-admin/.hbuilderx`
- `admin-portal/pictographic-admin/node_modules`
- 任何 HBuilderX、微信开发者工具自动生成的编译产物，除非任务就是排查编译产物。

## 依赖边界

- MVP 小程序阶段尽量不新增 npm 依赖。
- 不要新增 UI 框架、状态管理库、图标库、富文本解析库、视频 SDK、云服务 SDK 或原生插件，除非用户明确批准。
- 不要因为一个小问题引入大依赖。优先用 uni-app / 微信小程序内置能力和少量本地工具函数。
- 如果确实需要新依赖，先写清楚：
  - 解决什么问题
  - 替代方案是什么
  - 包体积和维护风险
  - 是否影响微信小程序审核或性能

## 什么算完成

- 功能能在 HBuilderX 编译，并在微信开发者工具里看到预期页面。
- 核心路径没有阻塞性控制台错误。
- 用户能完成对应任务，例如搜索 `study`、进入详情页、返回首页、切换底部导航。
- 修改没有破坏既有页面、路由、AppID 配置或 mock 数据。
- 相关文档已同步更新：目标变化写 `Prompt.md`，阶段变化写 `Plan.md`，状态/决策写 `Documentation.md`。
- 最终回复要说明改了什么、怎么验证、还有哪些风险或未验证事项。

## 长任务协作协议

- 主代理负责统一管理：拆任务、分配边界、整合结果、最终验收。
- 子代理只做被分配的明确范围，不要顺手重构无关文件。
- UI 子代理只改页面结构、样式和组件体验。
- 功能子代理只改搜索、详情、导航、状态、数据读写等逻辑。
- 内容/数据子代理只改 mock 数据、内容结构和资料说明。
- 测试子代理优先只读和验证，除非明确让它修测试。
- 审查子代理默认只读，输出风险、bug、缺失测试和建议，不直接改代码。
- 多个子代理并行时必须写清楚各自文件边界，避免同时改同一个文件。
