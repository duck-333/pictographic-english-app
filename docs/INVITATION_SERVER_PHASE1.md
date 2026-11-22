# 邀请首次手机号注册：服务器第一阶段（2026-11-19）

本轮为本地开发和隔离测试，未暂存、提交、推送、合并或部署。小程序页面、微信开发者工具和真机接入留到下一阶段。线上运行版本、迁移011实际执行情况、两个邀请HMAC配置和平台审核结论均待核实。

## 实现与数据依据

- 保留原手机号注册入口和身份冲突处理。无邀请新人仍只获一次注册30次；邀请合格时另给邀请人30次。
- 首次资格在身份事务内按最终账号判断：本次手机号无历史绑定，且账号无任何手机号历史绑定（包括非active）和REGISTER_BONUS流水。已有微信空壳账号仍可合格；老账号换新号码、新微信使用已有号码均不合格。既有A/B账号冲突仍返回409。
- 当前绑定实现保留手机号记录，不覆盖旧号码历史；REGISTER_BONUS作为账号历史补充。若生产曾人工删除全部手机号历史和注册流水，当前数据无法还原，需上线前核实，不能由前端isNew补足。
- 011的候选invitee_user_id可空，故保存候选不需创建账号。现有单新人唯一、active subject唯一、(inviter,reward_slot)唯一和1至5约束足够，本轮没有新增或改写迁移。
- 邀请凭证独立生成并固定7天到期；生成时核验手机号资格和已占名额，生成本身不占名额。注册时在邀请人用户锁内再次竞争名额，数据库唯一约束兜底。待发、已发及MANUAL_REVIEW均占用名额，永不因消费、过期、日期变化或重新生成凭证恢复。

## 前端接口约定

均返回JSON，敏感响应为no-store；只接受列明的body字段，拒绝客户端userId、inviterId、openid等字段。邀请路由复用本地限频实现及可信IP口径：每IP容量10、每分钟补充30，跨进程不共享；限频返回429 / INVITATION_RATE_LIMITED和Retry-After。

### POST /api/user/invitations/share-credentials

- Authorization: Bearer 当前登录token；body为 `{}`。
- 成功：`{ ok:true, token, createdAt, expiresAt }`，日期为UTC ISO时间。
- 未登录401；未完成手机号注册409 / INVITATION_PHONE_REGISTRATION_REQUIRED；名额已满409 / INVITER_REWARD_LIMIT_REACHED；数据库/邀请配置错误503 / INVITATION_SERVICE_UNAVAILABLE。
- 新凭证不会改变旧凭证期限，凭证期限不代表奖励到账期限。

### POST /api/user/invitations/candidates

- 注册前推荐请求：`{ token:分享凭证, loginCode:本次wx.login返回的全新code }`，无需Authorization。
- 服务端code2Session核验微信身份，仅保存候选；不调用微信身份建号接口。兼容旧的已登录 `{token}` 请求，但不要求前端先走此路径。
- 成功：`{ ok:true, candidateReceipt, candidateCapturedAt, expiresAt }`。2026-11-22接入最小补充：expiresAt直接来自原分享凭证的服务器到期时间，不能按候选捕获时间再加7天；既有字段不变。
- 回执为服务器随机生成的高熵凭证，数据库只存HMAC摘要；subject为服务器确认的 `appid + openid` 无歧义编码，再用候选专用密钥摘要。客户端不传用户/邀请人ID。
- 已完成手机号注册409 / INVITATION_RELATION_LOCKED。无效、撤销、过期分享凭证统一400 / INVITATION_CREDENTIAL_INVALID，事务回滚保留旧有效候选；微信code无效400 / WECHAT_CODE_INVALID；微信限频429 / WECHAT_RATE_LIMITED；其他服务故障503。
- 注册前最后一次有效捕获取代此前候选。即使客户端提交该身份的较早真实回执，也从数据库当前候选决定归属。跨微信身份回执无效。

**微信临时code只能消费一次**：候选请求使用code A；手机号授权成功时再次wx.login取code B，配合phoneCode提交原手机号登录接口。不得复用code A，不需要额外完成账号登录。候选失败不应清空此前保存的有效回执；拒绝手机号授权时保留候选。

### POST /api/auth/wechat-phone-login

- 请求：`{ loginCode:全新的code B, phoneCode, requestId?:字符串, candidateReceipt?:回执 }`；不需要已登录token。
- 原有用户、Bearer token及过期时间返回不变，新增 `invitation:{status,reason}`。
- status为REWARD_GRANTED时邀请奖励已到账；REWARD_PENDING时已确认并占名额但尚未到账；NO_REWARD时未奖励，reason区分CANDIDATE_MISSING、CANDIDATE_INVALID、NOT_FIRST_PHONE_REGISTRATION、SELF_INVITE、INVITATION_EXPIRED、INVITATION_REVOKED、INVITER_REWARD_LIMIT_REACHED、INVITER_NOT_FOUND、INVITER_PHONE_REGISTRATION_REQUIRED等。MANUAL_REVIEW为已有记录需要人工处理的待发状态。
- 邀请配置不可用时仍允许原注册，返回NO_REWARD / INVITATION_UNAVAILABLE；没有确认归属的记录不能据此显示奖励到账。
- 不合格邀请不使正常注册失败；第6位新人仍获原注册30次。正式注册后不能补录或更换邀请人。注册响应中的isNew仍是原有建号标记，不作为邀请资格依据。

### GET /api/user/invitations/summary

- 必须Authorization: Bearer；只以当前用户取数，query中的用户ID不参与查询。
- 成功：`{ok:true,successfulInvitations,totalRewardQuota,pendingRewards,remainingRewardSlots,limitReached}`。
- successfulInvitations：已确认且占名额的人数，包含待发及人工复核。
- totalRewardQuota：REWARD_GRANTED金额合计，只计实际邀请到账，不含REGISTER_BONUS，消费或过期不扣减。
- pendingRewards：REWARD_PENDING和MANUAL_REVIEW数量。
- remainingRewardSlots：5减已占名额；limitReached表示累计已满5。
- 未登录401；查询失败503 / INVITATION_SERVICE_UNAVAILABLE，不返回伪造的零统计。
- 余额继续调用GET /api/user/entitlements，统计接口不计算可用余额。

## 事务与恢复

1. 注册事务在有序用户锁范围内判定首次资格，同时提交身份绑定、REGISTER_BONUS、FINAL归属和REWARD_PENDING名额；账号历史使用FOR UPDATE当前读，避免REPEATABLE READ旧快照把同账号并发换号判成两次首次。错误统一回滚。
2. 注册提交后调用发奖服务。发奖事务先锁邀请人，再锁邀请记录，复用现有权益写入；余额增加、SHARE_REWARD流水、REWARD_GRANTED标记同事务提交。稳定幂等键为 `invitation-reward:<invitation_id>`，流水source=share、source_id为该invitation_id，严格核验回放类型、用户、金额、来源及日历年期限。
3. 到账时间取数据库UTC_TIMESTAMP()秒精度，与既有流水一致；到期取DATE_ADD(到账时间, INTERVAL 1 YEAR)，包含闰年口径。重试读取原流水时间，不刷新到期。已确认待发不再检查分享凭证到期。
4. 发奖失败回滚第二事务，注册仍成功；另外持久化错误码、retry_count和next_retry_at，不释放名额。延迟从60秒指数增加、最高3600秒；即时报送和恢复使用同一deliver逻辑并遵守next_retry_at。流水提交成功但响应丢失时，后续重试读取已发事实，不再加额。
5. startServer沿用两个邀请HMAC设置的配置启用方式：两个设置都存在才启动恢复；未配置不启动。不自动迁移、不引入Redis或队列。恢复启动即扫描，其后每批结束60秒再扫描，每批最多20笔，同实例不重叠；多进程靠数据库锁和唯一幂等键收敛。server close停止定时器。可通过注入选项invitationRewardsEnabled=false停止后台扫描（不作为生产新环境变量）。恢复任务启动/扫描/发奖故障仅记录脱敏码，不阻断HTTP登录服务。
6. 临时故障持续重试，不自动释放或删除已占名额；数据库不可用时扫描也保持60秒间隔。本阶段没有客户端自行领奖入口。

## 验证记录与后续

本轮使用本机Docker MySQL 8.0.46，仅绑定127.0.0.1:3309，随机临时库，复用现有迁移/运行分权用户、001至011正式迁移链及测试清理。未连接生产。真实事务和并发结果以本轮执行为准，不引用历史版本测试作为本轮通过证据。

- `test-invitation-mysql-integration.mjs`：原HTTP/身份/注册/约束/并发场景，加invitation-reward-mysql-scenarios，覆盖匿名候选和正式注册、账号/号码历史、跨身份回执、最后有效候选、同账号并发两号码、发奖中途失败原子回滚、持久化退避、重启恢复和即时发奖竞争、丢响应回放、最后名额竞争、第6人正常注册、统计及消费/过期、到期精确边界及闰年日历年。
- 相关邀请单元/HTTP、共享事务、身份、普通登录、会员权益、恢复生命周期及内容访问回归，执行结果记入Documentation.md。
- 脚本连接mock只验证编排和错误分支，不作为事务隔离、唯一约束或并发通过证据。
- 下一阶段接小程序分享参数、匿名候选捕获、双wx.login code流程、手机号注册结果、本人进度和余额刷新，并在HBuilderX/微信开发者工具及真机验证授权、取消、重开与网络失败路径。
