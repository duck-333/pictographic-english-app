# 管理后台模块实现

## 文件路径

后台项目：

- `admin-portal/pictographic-admin/main.js`
- `admin-portal/pictographic-admin/App.vue`
- `admin-portal/pictographic-admin/pages.json`
- `admin-portal/pictographic-admin/manifest.json`
- `admin-portal/pictographic-admin/pages/index/index.vue`
- `admin-portal/pictographic-admin/common/api-client.js`
- `admin-portal/pictographic-admin/common/theme.scss`
- `admin-portal/pictographic-admin/common/uni.css`
- `admin-portal/pictographic-admin/common/admin-icons.css`

后台说明文档：

- `admin-portal/README.md`
- `admin-portal/AdminRoadmap.md`
- `admin-portal/AccessControl.md`
- `admin-portal/DataFlow.md`
- `admin-portal/ImportWorkflow.md`

服务端配套：

- `server/index.mjs`
- `server/auth.mjs`
- `server/word-store.mjs`

## 核心文件职责

- `pages/index/index.vue`：后台主工作台，包含登录、词条列表、编辑表单、发布/撤下/归档、批量操作、导入、媒体编辑、首页推荐和预览同步。
- `common/api-client.js`：封装后台登录、鉴权检查、词条保存、公开词条查询、首页推荐读取和保存。
- `server/index.mjs`：提供 admin API 路由。
- `server/auth.mjs`：校验管理员账号密码，创建和验证管理员 session token。
- `server/word-store.mjs`：保存词条和首页推荐配置。

## 核心函数/方法名称

后台 API client：

- `getAdminApiBaseUrl(options)`
- `loginAdmin(credentials, options)`
- `checkAdminAuth(token, options)`
- `getAdminSessionToken(options)`
- `saveAdminSessionToken(token)`
- `saveAdminWordToServer(word, options)`
- `getPublicWordFromServer(idOrWord, options)`
- `searchPublicWordsFromServer(query, options)`
- `getAdminHomepageFeatured(options)`
- `saveAdminHomepageFeatured(config, options)`

后台页面认证：

- `loadAdminApiToken()`
- `unlockAdmin()`
- `lockAdmin()`
- `handleAdminUnauthorized()`

后台页面内容工作台：

- `loadDraft()`
- `saveDraft()`
- `saveCurrentAsDraft()`
- `createWord()`
- `selectWord(id)`
- `persistFormToList()`
- `validateCurrent(options)`
- `validateAllWords()`
- `buildServerWordPayload(sourceWord)`
- `syncWordToServer(word, successMessage)`
- `publishCurrent()`
- `unpublishCurrent()`
- `archiveCurrent()`
- `publishAllDrafts()`
- `syncPublishedStatusesFromServer()`

批量和导入：

- `toggleWordSelection(word)`
- `toggleSelectAllVisible()`
- `runBatchAction()`
- `batchMoveUploadedWordsToDraft(selectedWords)`
- `batchArchiveDraftWords(selectedWords)`
- `batchDeleteArchivedWords(selectedWords)`
- `importWordsFromJson()`
- `parseImportPayload(text)`
- `normalizeImportedWord(raw)`
- `validateImportedWords(words)`
- `commitCurrentPendingToDraft()`
- `commitPendingWordsToDrafts()`

首页推荐：

- `loadHomepageFeaturedConfig()`
- `applyHomepageFeaturedResponse(data, options)`
- `setHomepageFeaturedMode(mode)`
- `addHomepageFeaturedWord(id)`
- `removeHomepageFeaturedWord(id)`
- `moveHomepageFeaturedWord(index, offset)`
- `changeHomepageManualWord(event)`
- `refreshHomepageFeaturedPreview()`
- `saveHomepageFeaturedConfig()`

媒体和预览：

- `commitCurrentVideoClip()`
- `previewVideoClip(clip)`
- `handleVideoFileChange(eventOrFile)`
- `handleAudioFileChange(eventOrFile)`
- `clearVideoAsset()`
- `clearPronunciationAudioAsset()`
- `syncCurrentToMiniappPreview()`
- `syncAllToMiniappPreview()`

## API 入口

后台认证：

- `POST /api/admin/login`
- `GET /api/admin/auth/check`

后台内容：

- `POST /api/admin/words`

后台首页推荐：

- `GET /api/admin/homepage-featured`
- `POST /api/admin/homepage-featured`

后台也会读取公开接口做服务器状态核对：

- `GET /api/words`
- `GET /api/words/:id`

## 数据流

管理员登录：

```text
admin login form
  -> loginAdmin()
  -> POST /api/admin/login
  -> ADMIN_USERNAME / ADMIN_PASSWORD verification
  -> session token saved in localStorage
  -> admin APIs use Authorization header
```

词条发布：

```text
admin form
  -> validateCurrent()
  -> buildServerWordPayload()
  -> saveAdminWordToServer()
  -> POST /api/admin/words
  -> server validateWordRecord()
  -> word-store.saveWord()
  -> public APIs expose only published records
```

首页推荐：

```text
dashboard homepage manager
  -> getAdminHomepageFeatured()
  -> edit featuredWordIds / mode / manualWordId
  -> saveAdminHomepageFeatured()
  -> server validates published IDs only
  -> miniapp reads /api/homepage/featured-word
```

## 模块依赖关系

- 后台前端依赖浏览器 `fetch`、`localStorage`、`FileReader` 和 `URL.createObjectURL`。
- 后台服务端依赖 `server/auth.mjs`、`server/word-store.mjs` 和共享 `content-schema.js`。
- 本地预览同步依赖 `scripts/dev-preview-bridge.mjs`。
- 生产发布依赖管理员环境变量和 `JWT_SECRET`。

## 当前风险/未知

- `admin-portal/pictographic-admin/pages/index/index.vue` 体量很大，多个后台子领域集中在一个文件。
- 文件中存在同名方法定义，例如 `publishCurrent`、`unpublishCurrent`、`publishAllDrafts`，当前运行以对象中后定义的方法为准；未来整理时需要先做行为回归确认。
- Dashboard 用户统计相关 API 目前是占位说明，不是已实现后端能力。
- 当前管理员权限是单管理员 session，未实现角色、审计和操作历史。

