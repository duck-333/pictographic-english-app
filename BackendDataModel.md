# 象形英语后台数据模型草案

本文件用于把“小程序前台展示”和“后台内容录入”先对齐。当前第一块只定义数据契约和前端读取边界，还没有真正接入云数据库。

## 当前结论

- 前台页面不要直接依赖 `mock-data.js`，统一从 `miniapp-uni/word-app1/common/word-repository.js` 读取。
- `mock-data.js` 暂时仍是本地假数据来源，保证小程序不用云服务也能跑。
- 后续接 uniCloud / 云数据库时，优先替换 `word-repository.js` 内部实现，尽量不大改首页和详情页。
- 大段释义先用 `richTextHtml` / `pictograph` 两个字段承载，避免前端过早做复杂富文本组件引擎。
- 视频不进数据库正文，数据库只存视频地址、开始秒数、结束秒数和片段标题。
- 内容录入后台不能放在用户小程序里。后台应做成独立项目，并通过管理员账号、角色权限和访问控制保护。

## 后台项目边界

- 用户小程序：只负责查词、看详情、收藏、最近查看、缺词反馈等学习行为。
- 管理后台：只给你和管理人员使用，负责新增/编辑单词、修改大段释义、维护拆解卡片、管理视频片段和处理缺词反馈。
- 数据库：小程序和后台共用同一套内容数据，但权限不同。小程序只读已发布内容，后台可读写草稿和发布内容。
- 推荐落地方式：在 HBuilderX 里新建一个独立后台项目，优先考虑 `uni-admin` / uniCloud 管理后台路线；如果后续选择自建服务器，也仍然保持“后台 Web 项目”和“小程序前台项目”分离。
- 安全底线：不要把“新增词条”“编辑释义”“发布内容”这类入口注册进 `miniapp-uni/word-app1/pages.json`，也不要从“我的”页面暴露管理入口。

## 建议集合

### `words`

保存可搜索的单词主卡片。

| 字段 | 用途 |
| --- | --- |
| `id` | 稳定 ID，例如 `word-study` |
| `word` | 查询词，例如 `study` |
| `kind` | 内容类型，例如 `word` |
| `status` | `draft`、`published`、`archived` |
| `cardType` | 前台展示类型，例如“单词” |
| `phonetic` | 音标 |
| `pronunciationAudio` | 发音音频对象，给音标旁小喇叭播放 |
| `audioUrl` | 发音音频播放地址兼容字段，优先由 `pronunciationAudio.url` 派生 |
| `meaning` | 短释义 |
| `level` | 难度或教材层级 |
| `bookPage` | 书中页码 |
| `tip` | 一句话记忆提示 |
| `pictograph` | 当前详情页使用的大段象形释义 |
| `richTextHtml` | 后台富文本编辑后的 HTML，后续替代或补充 `pictograph` |
| `parts` | 拆解卡片数组 |
| `examples` | 例句数组 |
| `siblingIds` | 同族词或关联节点 ID |
| `videoSegment` | 当前词对应视频片段 |

`pronunciationAudio` 建议字段：

| 字段 | 用途 |
| --- | --- |
| `url` / `audioUrl` | 可播放音频地址；小程序端只有存在可播放地址时才显示小喇叭 |
| `provider` | 存储来源，例如 cloud-storage、vod、local-preview-bridge |
| `assetId` | 云存储或后台资产 ID |
| `storagePath` | 未来云端保存路径 |
| `fileName` | 原始或安全化后的文件名 |
| `mimeType` | 音频格式，例如 `audio/mpeg` |
| `size` | 文件大小 |
| `durationSec` | 音频时长，后续可用于后台校验 |
| `uploadStatus` | 上传状态 |
| `uploadedAt` | 上传时间 |

### `word_nodes`

保存可复用的字母、词根、前缀、后缀节点。结构基本与 `words` 一致，但 `kind` 可为 `letter`、`root`、`prefix`、`suffix`。

例子：`node-tud` 可以继续拆成 `node-t`、`node-u`、`node-d`。

### `video_segments`

保存视频资料和单词时间点。

| 字段 | 用途 |
| --- | --- |
| `id` | 片段 ID |
| `wordId` | 对应 `words` 或 `word_nodes` 的 ID |
| `videoUrl` | 视频地址 |
| `startSec` | 开始秒数 |
| `endSec` | 结束秒数 |
| `segmentTitle` | 片段标题 |
| `provider` | 存储来源，例如 cloud-storage、vod |
| `assetId` | 云存储或点播资源 ID |

### `feedbacks`

保存用户缺词反馈。当前前台已经有本地结构，后续可迁移到云端。

| 字段 | 用途 |
| --- | --- |
| `id` | 反馈 ID |
| `openid` | 后续接微信身份后写入 |
| `missingWord` | 用户反馈的英文单词 |
| `bookPageHint` | 用户填写的页码提示 |
| `note` | 备注 |
| `status` | `pending`、`accepted`、`rejected`、`published` |
| `createdAt` | 提交时间 |

## 后台最小页面清单

- 单词列表：搜索、筛选、查看发布状态。
- 新增/编辑单词：编辑单词、音标、短释义、大段释义、例句、书中页码。
- 拆解编辑器：为一个词配置 `parts`，每个 part 可以指向另一个节点。
- 节点库：管理字母、词根、前缀、后缀。
- 视频片段：录入视频地址、开始秒数、结束秒数、片段标题。
- 缺词反馈：查看用户提交的缺词，转成待补充词条。

## 本轮已落地的代码边界

- `content-schema.js`：定义集合名、状态、字段规范、基础校验。
- `word-repository.js`：统一前台读取入口，当前读本地 mock，后续可换云端。
- 页面 import 已从 `mock-data.js` 改为 `word-repository.js`。

## 2026-05-07 最小后台落地第一步

本轮新增了“后台录入前的数据准备层”，还没有接真实云数据库：

- `content-seed/words.example.json`：可导入数据库的示例内容包，包含 `study -> s/tud/y -> t/u/d` 的最小链路。
- `content-seed/word-entry-template.json`：新增单词时可复制的草稿模板。
- `scripts/validate-content.mjs`：内容校验脚本，用来检查字段、重复 ID、拆解卡片引用和视频片段时间点。
- `npm.cmd run validate:content`：默认校验 `content-seed/words.example.json`，Windows PowerShell 下优先用这个命令。

后台真实页面后续可以分三步做：

1. 在独立后台项目里做内容管理页面：单词列表、新增/编辑单词、拆解卡片、长释义、视频片段字段。
2. 接管理员登录和权限：只有管理员角色能进入后台和保存内容。
3. 再接 uniCloud 云数据库：后台保存到云端，小程序 `word-repository.js` 从云端只读已发布内容。

## 2026-05-08 独立后台骨架

本轮新增 `admin-portal`，用于承载后台项目说明和后续独立后台代码：

- `admin-portal/README.md`：后台项目定位、HBuilderX 新建步骤、最小页面清单。
- `admin-portal/AdminRoadmap.md`：后台分阶段实施路线。
- `admin-portal/AccessControl.md`：管理员、编辑、校对角色和权限边界。
- `admin-portal/DataFlow.md`：当前本地阶段和未来云端阶段的数据流。

重要边界：`admin-portal` 是后台项目区域，不是小程序页面目录。不要把它注册进 `miniapp-uni/word-app1/pages.json`。
