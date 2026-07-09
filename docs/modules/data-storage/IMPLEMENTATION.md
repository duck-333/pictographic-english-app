# 数据存储模块实现

## 文件路径

服务端内容存储：

- `server/word-store.mjs`
- `server/local-data/words.json`（运行时数据文件，可能不存在于 Git）

用户数据库访问：

- `server/user-store.mjs`

小程序本地存储：

- `miniapp-uni/word-app1/common/user-store.js`
- `miniapp-uni/word-app1/common/auth-store.js`

后台本地存储：

- `admin-portal/pictographic-admin/pages/index/index.vue`
- `admin-portal/pictographic-admin/common/api-client.js`

内容种子和校验：

- `content-seed/words.example.json`
- `content-seed/word-entry-template.json`
- `content-seed/letter-c-import.json`
- `content-seed/letter-c-import-paste-ready.json`
- `scripts/validate-content.mjs`

开发预览桥：

- `scripts/dev-preview-bridge.mjs`
- `miniapp-uni/word-app1/common/dev-preview-data.js`
- `content-seed/dev-preview-words.json`（开发期生成）
- `content-seed/dev-preview-videos/`（开发期生成）
- `content-seed/dev-preview-audios/`（开发期生成）

## 核心文件职责

- `word-store.mjs`：读写服务端内容 JSON、维护首页推荐配置、公开读取时过滤 published。
- `user-store.mjs`：连接 MySQL，查找或创建 `users` 和 `wechat_user_bindings`。
- `user-store.js`：小程序最近查看、收藏、查词次数、连续学习天数和 pending word ID。
- `auth-store.js`：小程序用户 session 本地持久化。
- `admin index.vue`：后台本地草稿、未上传导入队列、媒体预览状态。
- `admin api-client.js`：后台 session token 和 API base URL 的 localStorage 管理。
- `validate-content.mjs`：读取内容 JSON，校验结构、重复 ID、引用和视频时间。
- `dev-preview-bridge.mjs`：开发期写入预览数据和本地媒体文件。

## 核心函数/方法名称

服务端内容 store：

- `createWordStore(options)`
- `replaceWords(words)`
- `listWords(options)`
- `getWordCount()`
- `findWordById(id, options)`
- `saveWord(sourceWord)`
- `getHomepageFeaturedConfig()`
- `saveHomepageFeaturedConfig(sourceConfig, options)`
- `resolveHomepageFeaturedWord(options)`

用户 store：

- `createUserStore(options)`
- `findOrCreateWechatUser(identity)`
- 内部方法：`getPool()`、`findWechatBinding()`、`createWechatUser()`、`updateExistingLogin()`

小程序本地 storage：

- `getUserState()`
- `saveUserState(state)`
- `addRecentWord(wordId, options)`
- `toggleFavorite(wordId)`
- `getRecentWords()`
- `getFavoriteWords()`
- `clearUserData()`
- `savePendingWordId(wordId)`
- `getPendingWordId()`
- `getAuthSession(options)`
- `saveAuthSession(value)`
- `clearAuthSession()`

后台本地 storage：

- `loadDraft()`
- `saveDraft()`
- `persistWordsToStorage()`
- `persistPendingWords()`
- `getAdminSessionToken(options)`
- `saveAdminSessionToken(token)`

校验和预览：

- `validateFile(inputFile)`
- `validateRecordShape(records, errors)`
- `validateUniqueIds(records, errors)`
- `validateReferences(records, recordById, errors)`
- `validateVideoSegments(content, recordById, errors)`
- `writePreviewWords(words)`
- `saveRuntimeAsset(asset, wordId)`
- `saveRuntimeAudioAsset(asset, wordId)`

## API 入口

数据存储本身不直接暴露 API，但被这些服务端接口读写：

- `GET /api/health`
- `GET /api/words`
- `GET /api/words/:id`
- `GET /api/homepage/featured-word`
- `POST /api/admin/words`
- `GET /api/admin/homepage-featured`
- `POST /api/admin/homepage-featured`
- `POST /api/auth/wechat-login`

## 数据流

内容持久化：

```text
admin POST /api/admin/words
  -> validateWordRecord()
  -> word-store.saveWord()
  -> server/local-data/words.json
  -> public APIs read same file with published filtering
```

用户身份：

```text
POST /api/auth/wechat-login
  -> code2Session()
  -> user-store.findOrCreateWechatUser()
  -> MySQL users
  -> MySQL wechat_user_bindings
  -> signed user session
```

小程序学习状态：

```text
word detail / search / mine
  -> user-store.js
  -> uni storage key pictographic:userState
  -> recentWordIds / favoriteWordIds / searchCount / streakDays
```

后台本地草稿：

```text
admin workbench
  -> localStorage / uni storage wrapper
  -> pictographic-admin:words-draft
  -> pictographic-admin:pending-imports
  -> only becomes server content after admin API save
```

开发预览桥：

```text
admin sync button
  -> 127.0.0.1:8787/sync-word
  -> content-seed/dev-preview-words.json
  -> miniapp common/dev-preview-data.js
  -> development repository reads DEV_PREVIEW_WORDS
```

## 模块依赖关系

- 服务端内容 store 依赖 Node `fs/promises`。
- 用户 store 依赖 `mysql2/promise`。
- 小程序本地状态依赖 `uni.getStorageSync`、`uni.setStorageSync`、`uni.removeStorageSync`。
- 后台 session 和草稿依赖浏览器 `localStorage`。
- 开发预览桥依赖 Node HTTP、本地文件系统和本地端口 `8787`。

## 当前风险/未知

- 内容、用户、学习记录和后台草稿分散在多种存储中，需要文档持续保持同步。
- 服务端 JSON 文件适合 MVP 和测试，不是长期高并发/审计型内容库。
- 数据库迁移脚本尚未形成正式流程。
- 小程序本地学习数据还没有云端同步或跨设备合并策略。
- 开发预览生成文件和素材需要避免误入生产路径。

