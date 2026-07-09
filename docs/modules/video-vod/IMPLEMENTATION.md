# 视频/VOD 模块实现

## 文件路径

共享字段和校验：

- `miniapp-uni/word-app1/common/content-schema.js`
- `miniapp-uni/word-app1/common/word-repository.js`
- `scripts/validate-content.mjs`
- `scripts/check-production-ready.mjs`

小程序播放：

- `miniapp-uni/word-app1/pages/word-detail/index.vue`

后台编辑和预览：

- `admin-portal/pictographic-admin/pages/index/index.vue`
- `admin-portal/pictographic-admin/common/api-client.js`
- `scripts/dev-preview-bridge.mjs`

内容数据：

- `content-seed/words.example.json`
- `content-seed/letter-c-import.json`
- `content-seed/letter-c-import-paste-ready.json`
- `miniapp-uni/word-app1/common/dev-preview-data.js`

## 核心文件职责

- `content-schema.js`：标准化 `videoSegment`、`videoClips`、`pronunciationAudio`，校验视频时间段。
- `word-repository.js`：提供 `isPlayableMediaUrl()`，区分生产和开发可播放媒体。
- `word-detail/index.vue`：渲染视频区、片段播放器、完整视频入口、发音音频按钮和插图预览。
- `admin index.vue`：编辑视频 URL、时间点、片段列表、发音音频和本地模拟上传。
- `dev-preview-bridge.mjs`：开发期把后台 blob/data 媒体转成 `http://127.0.0.1:8787/...` 可预览地址，并生成 `dev-preview-data.js`。
- `check-production-ready.mjs`：检查生产媒体 guard、禁止本地/mock/example 媒体进入发布路径。

## 核心函数/方法名称

字段标准化：

- `normalizeVideoSegment(segment)`
- `normalizeVideoClips(recordOrClips)`
- `normalizePronunciationAudio(audio)`
- `validateWordRecord(record)`
- `validateVideoSegments(content, recordById, errors)`
- `isPlayableMediaUrl(url, options)`
- `hasBlockedProductionMediaSource(url)`

小程序详情页：

- `videoClips()`
- `displayVideoClips()`
- `hasVideoData()`
- `hasPlayableVideo()`
- `hasPlayableFullVideo()`
- `selectVideoClip(event)`
- `toggleVideoPlayback()`
- `toggleActiveClipPlayback()`
- `toggleFullVideoPlayback()`
- `handleVideoLoadedMetadata()`
- `handleVideoTimeUpdate(event)`
- `handleVideoPlay()`
- `handleVideoPause()`
- `handleVideoEnded()`
- `getVideoContext()`
- `togglePronunciationAudio()`
- `getPronunciationAudioContext()`

后台工作台：

- `normalizeVideoClip(raw, index)`
- `normalizePronunciationAudio(raw)`
- `validateVideoTime(item, rowNumber)`
- `commitCurrentVideoClip()`
- `loadVideoClipForEditing(index)`
- `moveVideoClip(index, direction)`
- `removeVideoClip(index)`
- `handleVideoFileChange(eventOrFile)`
- `validateVideoFile(file)`
- `simulateVideoUpload(file)`
- `completeVideoUpload(file, uploadJob)`
- `clearVideoAsset()`
- `handleAudioFileChange(eventOrFile)`
- `validateAudioFile(file)`
- `simulateAudioUpload(file)`
- `completeAudioUpload(file, uploadJob)`
- `clearPronunciationAudioAsset()`
- `syncCurrentToMiniappPreview()`
- `syncAllToMiniappPreview()`

预览桥：

- `handleSyncWord(request, response)`
- `buildMiniappWord(payload)`
- `saveRuntimeAsset(asset, wordId)`
- `saveRuntimeAudioAsset(asset, wordId)`
- `handleVideo(request, response, pathname)`
- `handleAudio(request, response, pathname)`

## API 入口

当前没有独立 VOD API。媒体字段随词条 API 传递：

- `GET /api/words`
- `GET /api/words/:id`
- `POST /api/admin/words`

开发预览桥入口：

- `GET http://127.0.0.1:8787/status`
- `POST http://127.0.0.1:8787/sync-word`
- `GET http://127.0.0.1:8787/videos/:file`
- `GET http://127.0.0.1:8787/audios/:file`

## 数据流

后台保存媒体字段到服务端：

```text
admin video/audio editor
  -> normalizeVideoClip() / normalizePronunciationAudio()
  -> buildServerWordPayload()
  -> POST /api/admin/words
  -> validateWordRecord()
  -> server/local-data/words.json
  -> public word API returns published record
  -> miniapp detail page renders media if URL passes guard
```

本地预览桥：

```text
admin blob/data preview media
  -> syncCurrentToMiniappPreview()
  -> POST 127.0.0.1:8787/sync-word
  -> scripts/dev-preview-bridge.mjs writes dev-preview media files
  -> generates miniapp common/dev-preview-data.js
  -> development runtime reads DEV_PREVIEW_WORDS
```

详情页片段播放：

```text
word.videoClips
  -> activeVideo
  -> video component initial-time=startSec
  -> timeupdate enforces endSec boundary
  -> user can switch clips or play full URL when available
```

## 模块依赖关系

- 依赖小程序 `<video>` 组件和 `uni.createVideoContext()`。
- 发音音频依赖 `uni.createInnerAudioContext()`。
- 依赖 `content-schema.js` 的字段标准化。
- 依赖 `word-repository.js` 的生产/开发媒体 URL guard。
- 本地预览桥依赖 Node HTTP 和本地文件写入。

## 当前风险/未知

- 当前没有真实 VOD 服务、转码流程、签名 URL 或会员鉴权。
- 客户端 `endSec` 裁剪可被绕过，不能作为付费内容保护。
- 后台模拟上传会生成本地或 mock 语义字段，必须通过生产检查和正式 HTTPS 资源替换后才能上线。
- 视频/音频/插图字段和内容字段在后台单文件页面中耦合较重。

