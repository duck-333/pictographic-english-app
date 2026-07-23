# 内容访问权益扣减规则

## 1. 核心消费单位

定义：

一次用户主动打开完整单词详情页 = 一次内容权益消费。

消费入口：

- 搜索结果进入单词详情
- 首页推荐进入单词详情
- 收藏列表进入单词详情
- 最近学习进入单词详情

以上行为均属于用户主动查看完整内容，需要扣减次数。

---

## 2. 不消费场景

以下请求只用于列表展示或预加载，不应该扣减：

- 搜索列表加载
- 首页推荐列表加载
- 收藏列表展示
- 最近学习列表展示

原因：

这些只是展示摘要信息，不代表用户主动消费完整内容。

---

## 3. 当前技术实现规则

小程序端：

`miniapp-uni/word-app1/common/word-api-client.js`

`fetchServerWordById()` 默认不携带 `Authorization`。

只有主动内容访问时：

```js
accessContent: true
```

才携带用户 `Authorization`。

详情页：

`miniapp-uni/word-app1/pages/word-detail/index.vue`

调用：

```js
fetchWordById(raw, {
  clientRequestId,
  accessContent: true
})
```

作为唯一内容消费入口。

---

## 4. 幂等设计

每次详情打开生成 `clientRequestId`。

作用：

防止：

- 网络重试
- 重复请求

导致一次访问重复扣减。

---

## 5. 当前待确认产品规则

词根拆解、关联词跳转：

当前行为：

点击关联词会进入新的详情页，并按照主动访问处理，会扣减一次。

未来需要产品确认：

方案 A：

所有详情页访问均消费。

方案 B：

词根/关联词属于当前单词学习过程，不额外消费。

当前暂不修改代码，保留现状。

---

## 6. 本次修改记录

修改文件：

`miniapp-uni/word-app1/common/word-api-client.js`

修改：

限制 `Authorization` 自动注入条件。

`miniapp-uni/word-app1/pages/word-detail/index.vue`

修改：

详情页主动访问时增加 `accessContent: true`。

目的：

避免首页、收藏、最近学习等非主动访问触发权益扣减。
