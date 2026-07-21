# ADR-0019: Phase 2.3 用户权益系统架构设计

日期：2026-07-21

状态：Proposed

## 背景

项目已经完成微信手机号登录、用户 token 鉴权、收藏云端化、最近学习云端化，以及生产环境 `JWT_SECRET` 保护。当前登录用户身份链路为：

```text
小程序 authSession
  -> Authorization: Bearer <user token>
  -> requireUserAuth()
  -> authResult.userId
  -> users.id
  -> 用户业务数据表
```

下一阶段准备进入商业化能力建设。当前产品模型包括：

- 新用户注册后获得免费完整词条查看额度，例如注册赠送 30 次。
- 用户查看完整词条内容时消耗额度。
- 完整内容可能包括象形拆解、视频讲解、示意图和专属内容。
- 免费额度消耗完后，用户可以购买会员、通过分享邀请获得额外额度，或参加活动获得额度。
- 后台未来需要查看用户当前权益、查看额度消耗记录、人工赠送额度和发放活动奖励。

权益系统属于账号级可信业务数据，直接影响付费、内容访问和用户资产。它不能复用现有本地学习状态、最近学习列表或收藏表，否则会造成扣减口径不可信、跨设备不一致、审计不可追溯和后续会员体系返工。

## 当前已有数据边界

### `pictographic:userState`

职责：

- 保存本机游客状态和轻量展示状态。
- 当前包含 `recentWordIds`、`favoriteWordIds`、`searchCount`、`streakDays`、`lastActiveDate`。
- 可用于未登录体验和页面轻量展示。

不能作为权益来源：

- 本地 storage 可被清理、重装、换设备或异常覆盖。
- `searchCount` 只是本机轻量计数，不是服务端可信查词消耗记录。
- `streakDays` 依赖本机日期，不适合表示账号权益。
- 小程序本地状态无法满足后台审计、退款恢复、活动补发或人工调整。

### `user_recent_words`

职责：

- 保存登录用户最近查看过哪些单词。
- 同一用户同一 `word_id` 只保留一行，重复查看会更新 `viewed_at`。
- 用于“最近学习列表”和跨设备展示。

不能作为权益来源：

- 它不是行为日志，重复查看同一词会覆盖时间，无法还原每次访问。
- 它不区分免费预览、完整词条查看、视频播放或专属内容访问。
- 它不能表达额度扣减、会员免扣、分享奖励或管理员赠送。
- 它不应参与查词次数、连续学习、权益扣减或付费访问控制。

### `user_favorites`

职责：

- 保存登录用户主动收藏的单词资产。
- 表达用户想保留或复习的内容。

不能作为权益来源：

- 收藏代表主动保存，不代表已查看完整内容。
- 收藏不代表学习完成、掌握程度或可访问权限。
- 取消收藏也不应改变用户权益余额。
- 收藏资产和付费权益生命周期不同，不能混在同一张表里。

## 架构原则

### 1. 权益不能使用本地 `pictographic:userState.searchCount`

`searchCount` 是设备本地轻量状态，不具备账号级可信性。它不能跨设备同步，不能防篡改，不能审计，也不能解释余额变化原因。

商业化场景中的“剩余完整查词次数”必须由服务端根据用户账号、会员状态、额度账户和权益流水计算或维护。

### 2. 权益不能使用 `user_recent_words`

`user_recent_words` 是最近列表，不是完整访问日志，也不是消耗记录。它的设计目标是快速展示最近看过的单词，而不是记录每一次权益判定。

查看同一个词条多次、会员免扣、活动赠送、后台补发、退款恢复等场景都无法从最近列表中准确表达。

### 3. 权益不能使用 `user_favorites`

`user_favorites` 是用户资产中的收藏资产。收藏、取消收藏不等于获得权益或消耗权益。

权益系统可以参考收藏数据做产品体验，但不能让收藏表承担付费访问、额度扣减或会员资格判断。

### 4. 权益系统与学习数据系统必须分层

学习数据系统回答：

```text
用户学了什么、什么时候学、学习了多少、掌握到什么程度
```

权益系统回答：

```text
用户拥有什么访问资格、还剩多少额度、为什么增加或减少、是否允许访问完整内容
```

两者可以由同一个用户身份 `users.id` 关联，但不能混用数据表和职责。

建议边界：

- `learning_events` 记录学习行为。
- `user_daily_learning_stats` 聚合学习统计。
- `user_word_progress` 记录单词学习状态。
- `user_entitlements` 记录当前权益状态。
- `entitlement_transactions` 记录权益变化流水。
- `orders` / `payments` 记录购买和支付过程。

### 5. 权益判断必须由服务端完成

完整词条访问涉及付费权益和额度消耗。判断流程必须在服务端完成：

```text
小程序请求完整内容
  -> Authorization: Bearer <user token>
  -> requireUserAuth()
  -> authResult.userId
  -> 查询用户权益
  -> 判断是否允许访问
  -> 必要时原子扣减额度
  -> 返回可访问内容或权益不足状态
```

服务端必须使用 token 派生的 `authResult.userId`，不能接受小程序传入 `user_id`。

### 6. 小程序不能自行判断剩余额度

小程序可以展示服务端返回的权益摘要，但不能自行决定：

- 用户是否还有额度。
- 是否扣减额度。
- 是否是会员。
- 是否可以访问完整词条。
- 是否发放分享奖励。

原因：

- 客户端环境不可信。
- 本地缓存可能过期。
- 权益变更可能来自支付回调、后台操作、活动任务或退款。
- 多设备同时访问需要服务端统一处理并发和原子扣减。

## 学习对象访问模型

项目中的内容不是简单的单词详情页，而是存在层级学习关系。例如：

```text
apple（学习对象）
  ├── ap
  ├── pl
  └── e

pl（学习对象）
  ├── p
  └── l
```

同一个内容片段在不同上下文中可能承担不同角色：

- 用户搜索 `apple` 后进入 `apple`，`apple` 是用户主动开始学习的对象。
- 用户在 `apple` 内部展开 `pl`，`pl` 是 `apple` 学习过程中的内部拆解内容。
- 用户直接搜索 `pl` 后进入 `pl`，`pl` 又是一个独立学习对象。

因此，权益扣减不能根据页面层级、页面路径或某些单词 id 的特殊规则判断，而应根据“用户主动开始学习的对象”判断。

定义：

- 每个可独立搜索并进入学习的内容，都是一个 Learning Object。
- Learning Object 可以是单词、词根、字母拆解，或未来其他教学内容。
- Learning Object 之间可以存在拆解、关联、推荐等关系。
- 权益系统关注本次完整内容访问的 root Learning Object，而不是页面上展示了多少内部节点。

## 权益扣减规则

### 1. 用户主动搜索并进入某个学习对象时扣减

用户主动搜索并进入一个 Learning Object，产生一次完整内容访问，需要消耗一次权益额度。

示例：

```text
搜索 apple -> 进入 apple -> 扣 1 次
搜索 pl    -> 进入 pl    -> 扣 1 次
搜索 p     -> 进入 p     -> 扣 1 次
```

这里的扣减对象不是固定的 `word_id`，而是本次用户主动开始学习的 Learning Object。

### 2. 当前学习对象内部展开内容不重复扣减

用户进入 `apple` 后已经为 `apple` 的完整学习过程完成一次权益判断和扣减。

在 `apple` 页面内部查看：

```text
apple
  ├── ap
  ├── pl
  └── e
```

这些属于 `apple` 学习过程中的内部展开，不额外扣减。

### 3. 关联内容不属于内部展开

关联、推荐、跳转到另一个可独立学习的对象时，需要重新进行权益判断。

示例：

```text
apple 页面
  -> 关联 fruit
  -> 用户点击 fruit
  -> fruit 是新的 Learning Object
  -> 重新判断权益
```

`fruit` 是否在视觉上出现在 `apple` 页面不重要；关键是用户是否进入了新的独立学习对象。

### 4. 不设计永久解锁

禁止把完整访问设计成永久解锁模型，例如：

- `user_unlocked_words`
- `word_unlock_records`
- 按词条永久授权的访问表

原因：

- 当前商业规则不是“买断某个词条”，而是按访问资格和会员状态判断。
- 会员结束后，用户不能继续无限访问会员期间看过的全部完整内容。
- 永久解锁会让免费额度、会员权益、退款和活动奖励的边界变复杂。

### 5. 会员期间不扣额度，也不产生永久解锁

会员期间：

- 完整内容访问不扣普通额度。
- 不产生永久解锁记录。
- 可以记录访问流水或学习事件，但不能把访问过的对象变成永久可访问资产。

会员过期后：

- 重新按照普通权益规则判断。
- 如果用户仍有免费额度或活动额度，可以继续按额度访问。
- 如果没有有效权益，则不能访问完整内容。

## `access_context`

权益判断需要显式区分“用户当前主动进入的学习对象”和“当前正在展示的内部内容”。

建议未来服务端概念：

| 字段 | 含义 |
| --- | --- |
| `rootLearningObject` | 用户本次主动开始学习的对象 |
| `currentLearningObject` | 当前正在展示或展开的对象 |
| `relationType` | 当前对象相对 root 的关系，例如 `self`、`decompose`、`related`、`recommend` |
| `accessReason` | 访问原因，例如 `search_enter`、`internal_expand`、`related_click` |

情况 A：搜索 `apple`

```json
{
  "rootLearningObject": "apple",
  "currentLearningObject": "apple",
  "relationType": "self",
  "accessReason": "search_enter"
}
```

结果：主动进入 root 学习对象，扣减。

情况 B：`apple` 内部点击 `pl`

```json
{
  "rootLearningObject": "apple",
  "currentLearningObject": "pl",
  "relationType": "decompose",
  "accessReason": "internal_expand"
}
```

结果：属于 `apple` 的内部拆解学习过程，不额外扣减。

情况 C：搜索 `pl`

```json
{
  "rootLearningObject": "pl",
  "currentLearningObject": "pl",
  "relationType": "self",
  "accessReason": "search_enter"
}
```

结果：`pl` 是本次主动进入的 root 学习对象，扣减。

情况 D：从 `apple` 点击关联 `fruit`

```json
{
  "rootLearningObject": "fruit",
  "currentLearningObject": "fruit",
  "relationType": "self",
  "accessReason": "related_click"
}
```

结果：`fruit` 成为新的 root 学习对象，重新判断权益。

## 决策

Phase 2.3 用户权益系统应采用独立服务端模型，不复用本地状态、最近学习或收藏表。

推荐未来数据流：

```text
权益来源
  -> entitlement_transactions 权益流水
  -> user_entitlements 当前权益状态
  -> 服务端访问判定
  -> 完整内容返回或权益不足响应
```

其中权益来源包括：

- 注册赠送。
- 查词消耗。
- 分享邀请奖励。
- 活动奖励。
- 管理员赠送。
- 购买会员。
- 退款或人工恢复。

`entitlement_transactions` 是审计来源，`user_entitlements` 是当前状态快照。不能只保存一个余额数字而没有流水。

权益扣减基准采用 Learning Object Access Model：

- 主动进入 root Learning Object 时进行权益判断。
- root Learning Object 内部拆解展开不重复扣减。
- 关联、推荐或跳转到新的 Learning Object 时重新判断。
- 不使用永久解锁模型。
- 会员期间不扣普通额度，也不产生永久解锁。

## 后果

正向影响：

- 额度、会员、活动奖励、后台赠送有统一模型。
- 每一次增加和扣减都可追溯。
- 未来可支持退款恢复、人工调整、异常排查和用户投诉处理。
- 学习统计和权益扣减不会互相污染。
- 多设备和并发访问可以在服务端统一处理。

成本：

- 初期需要比本地计数更复杂的数据模型和服务端事务。
- 完整词条访问接口需要服务端权限判断。
- 后台需要读取权益摘要和流水。

## 当前不做

本 ADR 只做架构决策，不创建 migration，不修改 API，不修改小程序页面，不实现支付、会员、邀请奖励或后台管理。
