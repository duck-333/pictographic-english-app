# 单词内容模块实现

## 文件路径

小程序内容入口：

- `miniapp-uni/word-app1/common/word-repository.js`
- `miniapp-uni/word-app1/common/word-api-client.js`
- `miniapp-uni/word-app1/common/api-config.js`
- `miniapp-uni/word-app1/common/content-schema.js`
- `miniapp-uni/word-app1/common/mock-data.js`
- `miniapp-uni/word-app1/common/dev-preview-data.js`
- `miniapp-uni/word-app1/common/part-visual-style.js`
- `miniapp-uni/word-app1/pages/index/index.vue`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/pages.json`

服务端内容入口：

- `server/index.mjs`
- `server/word-store.mjs`

后台和内容准备入口：

- `admin-portal/pictographic-admin/pages/index/index.vue`
- `admin-portal/pictographic-admin/common/api-client.js`
- `content-seed/words.example.json`
- `content-seed/word-entry-template.json`
- `scripts/validate-content.mjs`
- `scripts/test-server-word-api-link.mjs`

## 核心文件职责

- `word-repository.js`：小程序内容仓库，负责合并远端 published 结果、本地 fallback、开发预览数据和缓存的远端记录。
- `word-api-client.js`：封装小程序端 `uni.request` 请求，调用公开内容 API。
- `api-config.js`：确定小程序 API base URL。生产或未知环境默认使用 `https://baxiaota.com`。
- `content-schema.js`：定义内容集合名、状态、词条类型、字段规范、视频片段、发音音频、示意图和校验规则。
- `mock-data.js`：小程序 bundled fallback 内容。
- `index.vue`：查词首页，读取首页推荐、搜索结果和最近查看。
- `word-detail/index.vue`：单词详情页，渲染词条、拆解、示意图、例句、同族词、音频和视频片段。
- `server/index.mjs`：HTTP API 路由入口。
- `server/word-store.mjs`：服务端内容读写、published 过滤、首页推荐解析。
- `validate-content.mjs`：校验内容 JSON、重复 ID、拆解引用和视频时间段。

## 核心函数/方法名称

小程序仓库：

- `getContentRepositoryInfo()`
- `listWords()`
- `searchWords(query)`
- `fetchWords(query)`
- `fetchHomepageFeaturedWord()`
- `fetchWordById(id)`
- `fetchWordByWord(word)`
- `getWordById(id)`
- `getWordByWord(word)`
- `getRelatedWords(word)`
- `getCachedPublishedRemoteWordById(id)`
- `isPlayableMediaUrl(url, options)`

内容 schema：

- `normalizeWordRecord(record)`
- `validateWordRecord(record)`
- `createWordDraft(overrides)`
- `normalizeWordQuery(query)`
- `normalizeVideoSegment(segment)`
- `normalizeVideoClips(recordOrClips)`
- `normalizePronunciationAudio(audio)`
- `normalizeIllustrationImage(image)`
- `isProductionIllustrationImageUrl(value)`

服务端：

- `createApiHandler(options)`
- `startServer(options)`
- `createWordStore(options)`
- `listWords(options)`
- `findWordById(id, options)`
- `saveWord(sourceWord)`
- `resolveHomepageFeaturedWord(options)`
- `saveHomepageFeaturedConfig(sourceConfig, options)`

页面方法：

- 首页：`loadTodayWord()`、`updateSuggestionState(word)`、`submitSearch()`、`openDetail(id, countSearch, options)`、`refreshRecentWordsFromServer()`
- 详情页：`loadWord(options)`、`applyLoadedWord(word)`、`toggleBookmark()`、`handlePartTap(event)`、`previewIllustrationImage()`、`openDetail(id)`

## API 入口

公开 API：

- `GET /api/health`
- `GET /api/homepage/featured-word`
- `GET /api/words`
- `GET /api/words?q=...`
- `GET /api/words/:id`

管理 API：

- `POST /api/admin/words`
- `GET /api/admin/homepage-featured`
- `POST /api/admin/homepage-featured`

## 数据流

搜索：

```text
pages/index/index.vue
  -> fetchWords(query)
  -> word-api-client.js GET /api/words?q=...
  -> server/index.mjs
  -> word-store.listWords({ publishedOnly: true, limit: 20 })
  -> published words only
  -> page results
```

详情：

```text
pages/word-detail/index.vue
  -> fetchWordById(id) / fetchWordByWord(word)
  -> GET /api/words/:id or GET /api/words?q=...
  -> word-store.findWordById({ publishedOnly: true })
  -> normalize public word
  -> detail rendering
```

首页推荐：

```text
pages/index/index.vue
  -> fetchHomepageFeaturedWord()
  -> GET /api/homepage/featured-word
  -> word-store.resolveHomepageFeaturedWord()
  -> published manual word or daily rotation pool
```

后台发布：

```text
admin portal form
  -> buildServerWordPayload()
  -> saveAdminWordToServer()
  -> POST /api/admin/words
  -> validateWordRecord()
  -> word-store.saveWord()
  -> server/local-data/words.json
  -> public API can read only if status is published
```

## 模块依赖关系

- 依赖 uni-app 的 `uni.request`、`uni.navigateTo`、`uni.showToast` 等小程序能力。
- 依赖服务端 Node HTTP API。
- 依赖 `content-schema.js` 维持前后端字段一致。
- 依赖 `server/local-data/words.json` 作为当前服务端内容存储文件。
- 依赖 `content-seed` 和 `scripts/validate-content.mjs` 做导入前内容校验。

## 当前风险/未知

- `mock-data.js`、`content-seed`、服务端 `words.json` 可能出现内容不一致，需要以服务端 published 内容为准。
- 后台页面存在大量内容处理逻辑集中在单文件中，后续继续扩展会增加维护成本。
- 公开详情目前仍是“有 published 即可看”，尚未接入登录、配额或付费权限。

