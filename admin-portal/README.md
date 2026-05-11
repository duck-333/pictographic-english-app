# 象形英语独立管理后台

这个目录用于记录“管理后台”的独立项目方案。它不是用户小程序的一部分，也不应该被注册到 `miniapp-uni/word-app1/pages.json`。

## 核心原则

- 用户小程序只负责学习：查词、看详情、收藏、最近查看、缺词反馈。
- 管理后台只给你和管理人员使用：新增单词、修改释义、维护拆解、管理视频片段、处理反馈。
- 后台必须有管理员登录和权限控制，不能靠“隐藏入口”来保护。
- 小程序未来只读取 `published` 状态的内容，不能写入正式词库。
- 后台可以读写 `draft`、`published`、`archived` 状态的内容。

## 推荐项目形态

第一阶段推荐在 HBuilderX 中新建独立后台项目：

1. 项目名称建议：`pictographic-admin`。
2. 项目类型建议：uni-app / uni-admin 管理后台。
3. 运行端建议：Web 管理后台，不是微信小程序。
4. 云服务建议：先本地做后台页面和录入流程，等功能成型后再购买/绑定 uniCloud 服务空间。
5. 登录建议：使用 uni-id / 管理员角色权限，不做公开注册。

如果 HBuilderX 中没有合适的 uni-admin 模板，也可以先建普通 uni-app Web 项目，再逐步接入 uniCloud、登录和数据库。

## 未来目录关系

推荐仓库结构：

```text
pictographic-english-app/
  miniapp-uni/
    word-app1/              # 用户小程序
  admin-portal/             # 后台方案文档和后续后台项目说明
  content-seed/             # 可导入数据库的内容种子
  scripts/
    validate-content.mjs    # 内容校验脚本
```

如果后续把真实后台代码也放进当前仓库，建议新建：

```text
admin-portal/pictographic-admin/
```

并且把它作为独立项目打开和运行，不从小程序里跳转进入。

注意：`pictographic-admin` 必须是完整的 HBuilderX/uni-app 项目，至少包含 `pages.json`、`manifest.json`、`main.js`、`App.vue` 和 `pages/`。如果某个分支或工作区里只有 `pages/index/index.vue` 页面原型文件，它不能单独运行，需要先放入完整后台项目骨架中。

## HBuilderX 新建后台项目步骤

1. 打开 HBuilderX。
2. 点击 `文件 -> 新建 -> 项目`。
3. 选择 `uni-app`，如果有 `uni-admin` 模板优先选 `uni-admin`。
4. 项目名填写 `pictographic-admin`。
5. 项目位置建议放在当前仓库的 `admin-portal` 下面。
6. 如果还没有购买服务空间，可以先跳过绑定，先做本地后台原型。
7. 先不要发布到公网，先本地运行 Web 端。
8. 建好后，把数据库集合和页面按 `AdminRoadmap.md` 逐步补齐。

## 当前原型状态

- 已在用户 F 盘完整后台项目 `admin-portal/pictographic-admin/pages/index/index.vue` 建立本地版“象形英语内容工作台”。
- 当前页面不调用 `uniCloud`，在完整后台项目内不需要购买服务空间即可运行到浏览器预览。
- 当前数据先保存在浏览器本地缓存：`pictographic-admin:words-draft`。
- 当前支持：词条列表、A-Z 首字母分类筛选、搜索、新增、编辑单词基本信息、编辑拆解卡片、保存为草稿、发布当前词条、发布全部草稿、发布前二次确认、手机卡片预览、复制当前词条 JSON。
- 后续接云时，把本地保存逻辑替换为云数据库 `words` 集合读写。

## 最小后台页面

- 登录页：管理员登录，不开放普通用户注册。
- 单词列表：搜索、筛选、查看发布状态。
- 单词编辑：编辑单词、音标、短释义、大段释义、例句、书中页码。
- 拆解编辑：配置 `parts`，让 `study -> s/tud/y` 这类链路可维护。
- 节点库：维护字母、词根、前缀、后缀等可复用节点。
- 视频片段：录入视频地址、开始秒数、结束秒数、片段标题。
- 缺词反馈：查看用户提交的缺词，把有效反馈转成待补充词条。

## 当前不做

- 不把后台入口放到小程序“我的”页面。
- 不在用户小程序内新增“内容管理”页面。
- 不做假登录保护正式数据。
- 不接支付、会员、课程商城。
- 不接真实视频打点工具，先预留字段。
