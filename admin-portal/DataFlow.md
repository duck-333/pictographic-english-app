# 前后台数据流

## 当前本地阶段

```text
content-seed/words.example.json
        |
        v
scripts/validate-content.mjs
        |
        v
miniapp-uni/word-app1/common/mock-data.js
        |
        v
miniapp-uni/word-app1/common/word-repository.js
        |
        v
首页 / 详情页 / 我的页
```

当前没有真实后台，也没有真实数据库。这样做是为了先保证查词体验稳定。

## 后台接入后的目标阶段

```text
管理后台 pictographic-admin
        |
        v
管理员登录和权限校验
        |
        v
云数据库 words / word_nodes / video_segments / feedbacks
        |
        v
word-repository.js 读取 published 内容
        |
        v
用户小程序
```

## 关键边界

- 后台写入数据库。
- 小程序读取数据库。
- 小程序不直接写正式词库。
- 缺词反馈是用户可写数据，但只能进入 `feedbacks`，不能直接变成正式词条。

## 从本地数据迁移到云端

1. 先用 `npm.cmd run validate:content` 校验 `content-seed/words.example.json`。
2. 把通过校验的数据导入云数据库。
3. 后台能编辑这些数据。
4. 小程序 `word-repository.js` 从云端读取 `published` 内容。
5. 保留本地 mock 作为离线 fallback，方便开发排错。
