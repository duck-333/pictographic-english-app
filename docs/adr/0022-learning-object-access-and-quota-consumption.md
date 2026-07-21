# ADR-0022: Learning Object Access 与额度扣减规则

日期：2026-07-21

状态：Proposed

## 背景

Phase 2.3 用户权益系统已经形成三层文档：

- ADR-0019：用户权益系统架构设计。
- ADR-0020：用户权益系统数据库模型设计。
- ADR-0021：用户权益系统业务规则设计。

本 ADR 对 Learning Object Access Model 与额度扣减规则做最终收口，作为后续数据库、服务端 API、小程序访问控制和后台运营能力开发时的业务依据。

本 ADR 只记录架构和业务规则，不修改代码，不创建 migration，不修改 API。

## 决策摘要

权益判断对象不是页面，而是 Learning Object。

完整内容访问扣减不是：

- 页面路径访问。
- `word-detail` 页面进入。
- 某个 `word_id` 的硬编码规则。
- 曾经访问过某词条后的永久解锁。

完整内容访问扣减是：

```text
用户主动进入 root Learning Object 的完整内容访问
```

## Learning Object 定义

Learning Object 是可独立搜索、独立进入、独立学习的内容对象。

未来可成为 Learning Object 的对象包括：

- 单词卡片。
- 词根卡片。
- 字母卡片。
- 未来其他教学内容。

不能假设只有 `word` 才是可扣减对象。后续实现应使用 Learning Object 概念，而不是只使用 `word_id` 作为业务判断边界。

## 明确禁止

权益判断禁止使用以下方式：

- 根据页面路径扣次数。
- 根据进入 `word-detail` 页面扣次数。
- 根据 `word_id` 硬编码特殊规则。
- 根据页面层级判断是否扣次数。
- 根据用户是否曾经访问过某内容做永久解锁。

禁止设计以下永久解锁表：

- `user_unlocked_words`
- `word_unlock_records`

## 普通用户访问完整内容流程

用户主动搜索并进入一个 Learning Object 的完整内容时，执行服务端权益判断。

流程：

```text
搜索
  -> 进入 root Learning Object
  -> 服务端检查用户权益
  -> 如果会员有效
       -> 允许访问
       -> 不扣普通额度
  -> 如果非会员
       -> 检查可用额度
       -> 额度足够
            -> 扣减一次额度
            -> 记录 entitlement transaction
            -> 允许访问
       -> 额度不足
            -> 返回权益不足状态
            -> 进入权益不足提示页面
```

服务端必须通过用户 token 派生用户身份：

```text
Authorization: Bearer <token>
  -> requireUserAuth()
  -> authResult.userId
```

小程序不能传 `user_id`，不能本地计算额度，不能本地判断会员有效性。

## 会员访问完整内容流程

会员有效期内：

- 完整内容访问无限制。
- 不消耗普通额度。
- 不产生永久解锁。
- 可以记录访问流水或学习事件，但不能把访问过的 Learning Object 变成永久可访问资产。

会员过期后：

- 重新按照普通权益规则判断。
- 如果用户仍有有效普通额度，可以继续消耗额度访问完整内容。
- 如果没有有效普通额度，则进入权益不足流程。

## 当前 Learning Object 内部拆解不重复扣减

root Learning Object 内部的 `decompose` 结构属于当前学习对象的内部学习过程，不重复消耗额度。

示例：

```text
apple Learning Object
  ├── ap
  ├── pl
  └── e
```

用户路径：

```text
进入 apple
  -> 查看 ap
  -> 查看 pl
  -> 查看 e
```

扣减规则：

- 进入 `apple` 完整内容时进行一次权益判断。
- 如果普通用户额度足够，扣 1 次。
- 查看 `ap`、`pl`、`e` 属于 `apple` 内部 `decompose` 展开，不重复扣额度。

原因：

- `ap`、`pl`、`e` 在这个上下文中是 `apple` 的内部学习结构。
- 用户没有主动开始一个新的 root Learning Object。
- 重复扣减会让一个完整学习过程被拆成多次收费，体验不清晰。

## 关联内容重新判断

`related` / `recommend` 指向新的 Learning Object 时，需要重新执行权益判断。

示例：

```text
apple
  -> related: application
```

用户进入 `application`：

```text
application 成为新的 root Learning Object
  -> 重新检查会员或额度
  -> 非会员额度足够时扣 1 次
  -> 额度不足时进入权益不足提示页面
```

原因：

- `application` 是新的独立学习对象。
- 它不是 `apple` 内部的 `decompose` 学习结构。
- 新 root Learning Object 必须重新判断权益。

## 搜索对象规则

未来所有可学习对象都可能通过搜索进入。

包括：

- 单词卡片。
- 词根卡片。
- 字母卡片。

规则：

- 用户搜索 `apple` 并进入 `apple`，`apple` 是 root Learning Object。
- 用户搜索 `pl` 并进入 `pl`，`pl` 是 root Learning Object。
- 用户搜索 `p` 并进入 `p`，`p` 是 root Learning Object。

同一个对象在不同上下文中可以有不同访问含义：

- `pl` 在 `apple` 内部展开时，是 `apple` 的 `decompose` 内容，不重复扣减。
- `pl` 被用户主动搜索进入时，是新的 root Learning Object，需要权益判断。

## Access Context

后续实现应显式携带或服务端推导访问上下文。

建议概念：

| 字段 | 含义 |
| --- | --- |
| `root_learning_object_id` | 用户本次主动进入的 Learning Object |
| `current_learning_object_id` | 当前展示或展开的 Learning Object |
| `relation_type` | `self`、`decompose`、`related`、`recommend` |
| `access_reason` | `search_enter`、`internal_expand`、`related_click`、`recommend_click` |

示例 A：搜索 `apple`

```json
{
  "root_learning_object_id": "apple",
  "current_learning_object_id": "apple",
  "relation_type": "self",
  "access_reason": "search_enter"
}
```

结果：执行权益判断。

示例 B：`apple` 内部查看 `pl`

```json
{
  "root_learning_object_id": "apple",
  "current_learning_object_id": "pl",
  "relation_type": "decompose",
  "access_reason": "internal_expand"
}
```

结果：不重复扣减。

示例 C：搜索 `pl`

```json
{
  "root_learning_object_id": "pl",
  "current_learning_object_id": "pl",
  "relation_type": "self",
  "access_reason": "search_enter"
}
```

结果：执行权益判断。

示例 D：从 `apple` 点击 `application`

```json
{
  "root_learning_object_id": "application",
  "current_learning_object_id": "application",
  "relation_type": "self",
  "access_reason": "related_click"
}
```

结果：`application` 是新的 root Learning Object，执行权益判断。

## 不设计永久解锁

普通额度只是完整内容访问权限消耗，不是买断。

禁止通过以下方式实现权益：

- 用户访问过某个词后永久解锁该词。
- 会员期间访问过某个词后永久解锁该词。
- 使用 `user_unlocked_words` 记录永久可访问词条。
- 使用 `word_unlock_records` 记录永久可访问词条。

会员期间：

- 可以无限访问完整内容。
- 不扣普通额度。
- 不产生永久解锁。

会员过期后：

- 重新按照普通权益规则判断。
- 需要有效普通额度或重新开通会员才能访问完整内容。

## 与后台和运营的关系

未来后台和运营能力需要支持：

- 查看用户权益。
- 查看额度扣减流水。
- 管理员赠送额度。
- 管理员赠送会员。
- 淘宝购书赠会员。

这些能力必须遵守同一套权益模型：

- 赠送额度和会员必须归属到 `users.id`。
- 赠送和扣减都必须记录 entitlement transaction。
- 后台人工操作必须记录操作人、时间和备注。
- 淘宝购书赠会员属于后台人工赠送会员流程，不绕过权益流水。
- 后台查看当前权益应读取快照，同时可追溯到流水。

## 与现有模块的边界

`user_favorites`：

- 只表示用户收藏资产。
- 不表示完整内容访问资格。
- 不参与额度扣减。

`user_recent_words`：

- 只表示最近学习列表。
- 不表示完整内容访问次数。
- 不参与权益判断。

`pictographic:userState`：

- 只表示本地轻量状态或游客体验状态。
- 不作为账号可信权益来源。

## 后续实现要求

后续实现权益检查 API、数据库 migration、小程序访问控制和后台管理时，应以本 ADR 为准：

- 权益判断在服务端完成。
- 用户身份来自 token，不来自前端 `user_id`。
- 额度扣减写入 `entitlement_transactions`。
- 快照更新写入 `user_entitlements`。
- 内部 `decompose` 不重复扣减。
- 新 root Learning Object 重新判断权益。
- 不实现永久解锁。

## 当前不做

本 ADR 不修改代码，不创建 migration，不修改 server，不修改 API，不修改小程序。
