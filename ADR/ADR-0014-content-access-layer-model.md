# ADR-0014: 内容访问分层模型

Status: Accepted

Date: 2026-07-09

## 背景

当前 `GET /api/words/:id` 返回 published 词条详情。随着手机号登录、查词额度、会员和视频权益进入规划，系统需要明确不同用户能看到哪些词条字段。

现有内容记录中已经包含基础释义、音标、象形解释、拆解、例句、同族词、插图、发音音频和视频字段。未来不能只依靠小程序页面中的条件判断控制访问范围。

## 问题

如果没有内容访问分层模型，后续实现容易变成：

```text
word-detail.vue
  -> if login
  -> if has quota
  -> if member
  -> if has video
```

这会带来几个风险：

- 游客可见字段和登录用户可见字段边界不清。
- 查词扣次接口返回内容不明确。
- VOD 会员权限可能被误认为前端视频按钮控制。
- 服务端公开 API 可能继续返回过多字段。
- 未来会员、课程包、买书权益难以统一接入。

## 决策

建立单词内容访问分层模型。

第一版访问层级：

```text
public_basic
  游客和未扣次用户可见的基础内容

user_full
  已登录且通过 quota 判断后的完整学习内容

member_media
  未来会员、买书或课程权益控制的媒体/课程内容
```

访问控制必须以服务端判断为准，小程序页面只负责展示服务端返回的结果。

## 方案

字段分层方向：

```text
public_basic
  id
  word
  phonetic
  meaning
  level

user_full
  public_basic fields
  explanation
  pictographic breakdown
  examples
  related words
  illustration summary or allowed illustration
  pronunciation audio if allowed as learning content

member_media
  video clips
  full video entry
  course-related media
  future signed media access data
```

API 语义方向：

```text
GET /api/words
  search/list published words
  no quota deduction
  returns public/basic list fields

GET /api/words/:id
  read published word basic detail
  no quota deduction
  returns public_basic

POST /api/words/:id/view
  authenticated full detail view
  checks quota/entitlement
  deducts word_lookup quota when required
  writes quota log
  returns user_full and remaining quota
```

接口迁移分三阶段执行，避免破坏当前已经上线的小程序详情链路。

### Phase A: 兼容提示阶段

保持当前 `GET /api/words/:id` 对小程序详情页的兼容返回，不立即截断既有字段。

在响应中增加访问提示字段：

```text
accessLevel
requiresLogin
requiresQuota
availableAccessLevels
```

该阶段目标：

- 不破坏现有详情页。
- 让前端和服务端开始感知访问层级。
- 为新增 `POST /api/words/:id/view` 做兼容准备。

### Phase B: 新详情入口阶段

新增 `POST /api/words/:id/view`，小程序完整详情改走该接口。

该接口负责：

- 校验用户 session。
- 校验 `word_lookup` 余额或未来 entitlement。
- 使用 `requestId` / `idempotency_key` 防止重复扣减。
- 写入 `user_quota_logs`。
- 返回 `user_full` 内容和 quota 摘要。

此阶段 `GET /api/words/:id` 仍保持兼容，作为回退和灰度保护。

### Phase C: 公开接口降级阶段

在确认小程序稳定使用 `POST /api/words/:id/view` 后，再把 `GET /api/words/:id` 收敛为真正的 `public_basic`。

该阶段之后：

- `GET /api/words/:id` 无副作用，只返回基础公开字段。
- `POST /api/words/:id/view` 是完整学习内容入口。
- 会员或课程媒体继续由 `member_media` 访问层控制。

未来媒体访问：

```text
member_media
  -> server checks entitlement
  -> returns allowed media metadata or signed/controlled media access
```

服务端策略方向：

```text
request context
  -> user context
  -> quota / entitlement state
  -> content access policy
  -> response projection
```

## 影响范围

涉及模块：

- 单词内容模块。
- 用户身份体系升级。
- 用户权益模型。
- 查词额度消耗链路。
- 视频/VOD 模块。
- 数据存储模块。

涉及未来文件边界：

- `server/index.mjs`
- `server/word-store.mjs`
- 未来可新增 `server/content-access-policy.mjs`
- 未来可新增 `server/quota-store.mjs`
- `miniapp-uni/word-app1/common/word-api-client.js`
- `miniapp-uni/word-app1/common/word-repository.js`
- `miniapp-uni/word-app1/pages/word-detail/index.vue`
- `miniapp-uni/word-app1/common/content-schema.js`

## 替代方案

本 ADR 仅记录最终确认方案。未采用方案不在本文件展开。

当前确认的过渡方式是保留现有公开 published 读取能力，但后续实现查词扣次前，必须先把 `GET /api/words/:id` 调整为无副作用的基础详情语义，并把完整详情放到 `POST /api/words/:id/view`。

## 后续影响

- `POST /api/words/:id/view` 不能在内容字段边界未确认前开发。
- 当前完整 published 详情公开返回的行为必须按 Phase A -> Phase B -> Phase C 迁移，不得一次性硬切。
- 视频/VOD 权限不能依赖客户端裁剪或隐藏按钮，必须服务端判断。
- 内容 schema 和模块文档需要在实现阶段记录字段分层结果。
- 小程序详情页未来应按服务端返回的 access level 和字段渲染，不应自行决定敏感字段可见性。
