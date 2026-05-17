# 象形英语项目说明

这是“象形英语 / Pictographic English”的总项目仓库。当前仓库采用一个 Git 管理多个相关项目的方式：微信小程序、内容上传后台、词库数据和校验脚本都放在同一个仓库里。

当前阶段建议先保持这种结构。小程序和后台虽然是两个独立项目，但它们共享同一套词库字段和内容流程，放在一个仓库里更容易保证版本一致。

## 先看这里

如果你只是想运行小程序，打开：

```text
miniapp-uni/word-app1
```

如果你只是想运行内容上传后台，打开：

```text
admin-portal/pictographic-admin
```

如果你只是想改单词内容数据，看：

```text
content-seed
```

## 项目结构

```text
pictographic-english-app/
  miniapp-uni/
    word-app1/                     # 当前真正要运行的微信小程序项目
    App.vue                        # 旧小程序尝试文件，当前不是主线
    pages.json                     # 旧小程序配置，当前不是主线

  admin-portal/
    pictographic-admin/            # 当前内容上传后台项目
    README.md                      # 后台规划说明
    AccessControl.md               # 后台权限设计
    AdminRoadmap.md                # 后台建设路线
    DataFlow.md                    # 内容流转说明
    ImportWorkflow.md              # 内容导入流程

  content-seed/                    # 词库种子数据和导入用 JSON
    letter-c-import.json
    letter-c-import-paste-ready.json
    word-entry-template.json
    words.example.json

  scripts/
    audit-project.mjs              # 项目结构和引用检查脚本
    validate-content.mjs           # 内容数据格式检查脚本

  src/                             # 早期 React/Vite demo，当前不是小程序主线
  public/                          # 早期 demo 静态资源
  dist/                            # 构建产物，不建议手动改

  BackendDataModel.md              # 后台和词库数据模型说明
  Documentation.md                 # 当前状态和重要决策记录
  Plan.md                          # 阶段计划
  Prompt.md                        # 需求和目标变化记录
  AGENTS.md                        # Codex 协作规则
```

## 当前主线

当前真正的产品主线是：

```text
微信小程序 MVP
  查词首页
  单词详情页
  我的页面 / 学习数据雏形

内容上传后台
  本地录入单词
  编辑释义和拆解
  演练视频上传流程
  准备后续发布到数据库
```

后台必须是独立后台项目，不能作为普通小程序页面藏在用户端里面。

## 怎么运行

### 微信小程序

1. 打开 HBuilderX。
2. 打开目录：

```text
miniapp-uni/word-app1
```

3. 在 HBuilderX 里运行：

```text
运行 -> 运行到小程序模拟器 -> 微信开发者工具
```

微信开发者工具只负责预览 HBuilderX 编译后的项目。不要直接把源码目录当微信原生项目导入。

如果必须手动导入微信开发者工具，应导入编译产物：

```text
miniapp-uni/word-app1/unpackage/dist/dev/mp-weixin
```

### 内容上传后台

1. 打开 HBuilderX。
2. 打开目录：

```text
admin-portal/pictographic-admin
```

3. 作为独立 Web 后台运行和预览。

后台里的视频上传目前是“真实流程演练”：可以选择本地视频文件、校验格式和大小、生成上传进度和视频资产字段，但不会真正把文件传到云端。正式上线时，把演练上传函数替换成云存储/对象存储上传即可。

## 交付检查

在根目录运行完整检查：

```text
npm.cmd run check
```

这个命令会检查：

- 小程序和后台的项目入口是否存在。
- `pages.json` 里登记的页面是否都有真实 `.vue` 文件。
- 小程序和后台的本地引用、`@/` 静态资源引用是否能找到。
- `content-seed` 里的 JSON 是否能解析。
- 词库示例和 C 字母导入数据是否符合当前内容结构。
- 小程序核心 JS 文件和后台入口 JS 是否有语法错误。

## 内容数据检查

在根目录运行：

```text
npm.cmd run validate:content
```

也可以单独检查小程序核心 JS 文件：

```text
node --check miniapp-uni/word-app1/common/mock-data.js
node --check miniapp-uni/word-app1/common/user-store.js
node --check miniapp-uni/word-app1/common/content-schema.js
node --check miniapp-uni/word-app1/common/word-repository.js
```

## Git 管理建议

当前建议继续使用一个 Git 仓库管理：

```text
小程序 + 后台 + 内容数据 + 校验脚本
```

这样做的好处是：

- 小程序和后台使用同一套内容字段，不容易版本错位。
- 词库数据、导入脚本和页面展示可以一起保存。
- 当前阶段操作更简单，不需要同时管理多个仓库。

以后如果后台变成完整独立产品，再考虑拆成多个仓库：

```text
pictographic-miniapp       # 微信小程序
pictographic-admin         # 内容管理后台
pictographic-content       # 词库内容或导入数据
```

现在先不要急着拆。

## 不要手动改这些目录

这些目录通常是依赖或编译产物，不是日常业务代码：

```text
node_modules
dist
miniapp-uni/word-app1/unpackage
admin-portal/pictographic-admin/unpackage
```

如果只是做业务功能，优先改这些地方：

```text
miniapp-uni/word-app1/pages
miniapp-uni/word-app1/components
miniapp-uni/word-app1/common
admin-portal/pictographic-admin
content-seed
scripts/validate-content.mjs
```

## 当前一句话总结

这个仓库现在是一个总工作区：小程序负责给用户学习，后台负责给管理员录入内容，`content-seed` 负责准备词库数据。当前先统一放在一个 Git 仓库里保存，等后台真正独立上线后，再考虑拆分版本管理。
