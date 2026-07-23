# PHASE 2.3 D1 单词详情访问权益扣减设计

## 1. 背景

当前已经完成：

- 用户登录已完成。
- `user_entitlements` 已存在，用于保存用户当前权益快照。
- `entitlement_transactions` 已存在，用于保存权益事实流水。
- `consumeQuota()` 已存在，可用于权益扣减、写流水和更新快照。
- 小程序「我的」页面已展示剩余次数。

当前缺失：

用户访问完整单词详情时，没有触发权益消费。登录用户可以查看完整单词详情，但不会减少 `quota_balance`，也不会写入 `CONTENT_ACCESS` 消费流水。

## 2. 目标

实现：

登录用户打开完整单词详情时消耗 1 次权益。

结果：

- `user_entitlements.quota_balance` 减 1。
- `user_entitlements.quota_total_consumed` 增 1。
- `entitlement_transactions` 写入一条 `CONTENT_ACCESS` 流水。
- 小程序「我的」页面后续刷新时可以看到剩余次数变化。

## 3. 设计原则

- 不修改数据库结构。
- 不影响微信登录流程。
- 不影响后台管理系统。
- 不影响视频逻辑。
- 不影响未登录用户当前体验。
- 不影响搜索接口。
- `GET /api/words?q=...` 不扣费，避免搜索联想误扣。
- `GET /api/words/:id` 作为权益消费入口。
- 权益扣减必须由服务端完成。
- 前端不能自行判断或扣减权益。
- 继续保持 `entitlement_transactions` 是事实流水，`user_entitlements` 是当前快照。

## 4. 数据流程

```text
用户打开详情页
↓
小程序请求 GET /api/words/:id
↓
登录用户携带 Authorization: Bearer <token>
↓
服务端检查词条是否存在
↓
服务端验证用户 token
↓
服务端调用 consumeQuota()
↓
写 entitlement_transactions CONTENT_ACCESS
↓
更新 user_entitlements
↓
返回完整单词内容和剩余额度
```

未登录用户流程：

```text
用户打开详情页
↓
小程序请求 GET /api/words/:id
↓
未携带 Authorization
↓
服务端保持当前公开详情逻辑
↓
不扣权益
↓
返回完整单词内容
```

词条不存在流程：

```text
请求 GET /api/words/:id
↓
服务端未找到词条
↓
返回 404
↓
不扣权益
```

额度不足流程：

```text
登录用户请求 GET /api/words/:id
↓
词条存在
↓
consumeQuota() 返回 quota_insufficient
↓
服务端不返回完整内容
↓
返回 QUOTA_INSUFFICIENT
```

建议响应：

```json
{
  "ok": false,
  "code": "QUOTA_INSUFFICIENT",
  "message": "剩余查词次数不足",
  "remainingQuota": 0
}
```

建议状态码：

```text
403
```

## 5. 幂等设计

前端需要为一次详情页访问生成 `clientRequestId`。

后端生成权益扣减幂等键：

```text
content_access:${userId}:${wordId}:${clientRequestId}
```

作用：

- 防止网络重试重复扣减。
- 防止同一次页面加载重复请求导致重复扣减。
- 保留用户再次主动打开同一个单词详情时正常扣减的能力。

规则：

- 同一次详情页加载内，重复请求使用同一个 `clientRequestId`。
- 用户重新主动进入同一个单词详情页，应生成新的 `clientRequestId`。
- 不使用 `userId + wordId` 作为唯一幂等键，否则会变成永久解锁。
- 不由服务端每次随机生成幂等键，否则网络重试无法防重复扣减。

## 6. consumeQuota() 接入参数建议

登录用户访问 `GET /api/words/:id` 且词条存在时：

```js
consumeQuota({
  userId: authResult.userId,
  amount: 1,
  rootLearningObjectId: word.id,
  currentLearningObjectId: word.id,
  accessContext: {
    type: 'root',
    entry: 'word_detail'
  },
  idempotencyKey: `content_access:${authResult.userId}:${word.id}:${clientRequestId}`,
  source: 'full_content_access',
  sourceId: word.id,
  operatorType: 'system',
  operatorId: 'word-detail-api',
  reason: 'Complete word detail access.'
})
```

返回处理：

- `allowed: true`：返回完整词条内容。
- `reason: membership_active`：允许访问，不扣普通额度。
- `reason: quota_consumed`：允许访问，普通额度已扣减。
- `allowed: false` 且 `reason: quota_insufficient`：返回额度不足，不返回完整词条内容。

## 7. 不包含内容

本阶段不做：

- 每日额度刷新。
- 权益规则配置系统。
- 会员购买。
- 支付。
- 后台运营配置。
- 排行榜。
- 学习报告。
- 视频观看权益扣减。
- 搜索联想扣减。
- 永久解锁。

## 8. 需要修改的文件

预计最小修改范围：

- `server/index.mjs`
  - 在 `GET /api/words/:id` 接口中增加登录用户权益扣减。
  - 未登录用户保持当前逻辑。
  - 不修改 `GET /api/words?q=...` 搜索接口。

- `miniapp-uni/word-app1/common/word-api-client.js`
  - 登录态请求详情时携带 `Authorization`。
  - 支持传入 `clientRequestId`。

- `miniapp-uni/word-app1/common/word-repository.js`
  - 让 `fetchWordById()` 支持透传详情访问上下文。
  - 不让 `fetchWordByWord()` 默认触发扣费。

- `miniapp-uni/word-app1/pages/word-detail/index.vue`
  - 每次页面加载生成一次 `clientRequestId`。
  - 调用 `fetchWordById()` 时传入 `clientRequestId`。
  - 处理额度不足提示。

不需要修改：

- `database/migrations/**`
- 微信登录流程
- 收藏逻辑
- 最近学习逻辑
- 后台管理系统
- 视频播放逻辑

## 9. 验收标准

- 登录用户打开完整单词详情扣 1 次。
- 登录用户扣减后，`user_entitlements.quota_balance` 正确减少。
- 登录用户扣减后，`user_entitlements.quota_total_consumed` 正确增加。
- 登录用户扣减后，`entitlement_transactions` 正确写入 `CONTENT_ACCESS` 流水。
- 未登录用户保持原逻辑，不扣次数。
- `GET /api/words?q=...` 搜索联想不扣次数。
- 额度不足时返回明确提示，不返回完整内容。
- 网络重试或同一次详情页重复请求不会重复扣减。
- 小程序「我的」页面刷新后可以看到剩余次数变化。

## 10. 验证建议

登录用户：

```text
打开单词详情
↓
quota_balance - 1
↓
entitlement_transactions 新增 CONTENT_ACCESS
↓
我的页面显示最新剩余次数
```

未登录用户：

```text
打开单词详情
↓
正常展示
↓
不写 entitlement_transactions
```

搜索联想：

```text
输入搜索词
↓
请求 GET /api/words?q=...
↓
不扣权益
```

额度不足：

```text
quota_balance = 0
↓
打开单词详情
↓
返回 QUOTA_INSUFFICIENT
↓
不新增 CONTENT_ACCESS 扣减流水
```
