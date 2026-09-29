# Prompt

## 2026-09-29：v14当前工作区验证状态

- v14使用MySQL 8.0.46、Docker Client/Server 29.6.2和全新容器`pictographic-invitation-mysql-20260929-v14`；只绑定`127.0.0.1:3309`，使用匿名MySQL数据卷、随机root测试密码及destructive gate `local-docker-invitation-only`。只执行一次`npm.cmd run test:invitation-mysql-integration`且没有重跑，输出`invitation isolated MySQL integration tests passed`，退出码0。
- v14是当前工作区最新版完整成功证据，覆盖随机临时数据库、migration/runtime随机临时用户、最小权限/runtime DDL拒绝、001～011真实迁移链、正式HTTP→service→共享事务→Identity/Entitlement/Invitation Store→MySQL，以及JWT/receipt降级、A/B冲突回滚、邀请人手机号资格重检、missing-inviter、默认`REPEATABLE READ`确定性cross barrier与locking/current read、phone race、same-openid、direct Store replay、邀请人100槽位/rollback/第五与第六位竞争和上限、208/210互邀、幂等、约束、并发及清理门禁。
- v7～v13仍是历史失败/修复过程，v13总退出码保持1，不能改写为成功。脚本内部数据库、migration/runtime用户清理及健康检查随退出码0完成；v14容器和匿名卷已删除，3309监听数量为0，测试变量已清除。Git为22个已跟踪修改、22个未跟踪文件，暂存区为空，`miniapp-uni`无修改。
- 尚未暂存、提交、推送或创建PR；011未执行到生产数据库，未连接生产数据库，未部署。小程序邀请页面/分享入口尚未接入，`SHARE_REWARD`实际发放仍未实现且本批只预留`REWARD_PENDING`。当前不是production-ready，必须完成最终独立复审后才能暂存。

## 2026-09-29：v13旧直连Store资格fixture失败后的状态

- v13真实MySQL已通过正式HTTP全链、missing-inviter、确定性cross、phone race和same-openid，随后旧并发重放断言出现FINAL=1、distinct reward slot=0（预期1）并退出1。根因是邀请人110没有active手机号测试资格；审计同时发现100、208、210的后续正向fixture也缺资格。
- 本轮只在正式HTTP、missing-inviter、cross、phone-race、same-openid及前置资格不足/约束场景完成后，旧直连正向奖励测试开始前，使用局部helper为100/110/208/210各插入一条唯一、有效active手机号绑定，严格检查每次affectedRows和最终每人active COUNT=1。较早的`finalB`不受资格fixture影响；不会为501/502/508或其他用户补写，不调用注册流程、不发奖励、不创建邀请关系。
- 原重放、槽位上限、rollback和208/210双方`REWARD_PENDING`断言全部保留，正式业务与迁移未改。v13全部临时资源已清理，不能记为通过；当前修复只有离线证据，须先独立复审，再使用全新v14。未暂存、未迁移、未部署、非production-ready。

## 2026-09-29：cross默认REPEATABLE READ资格可见性收口

- v12已通过正式HTTP全链和missing-inviter，但后续cross失败使整体退出码仍为1。继续审计发现普通手机号资格SELECT可能读取锁前一致性快照，因此旧的一pending、一phone-required断言不能视为已经证明。
- Invitation Store现于邀请人统一用户锁、凭证锁和关系锁之后使用`FOR UPDATE` current read严格复核恰好一条active手机号，再决定是否扫描槽位；资格不足仍为`FINAL/NO_REWARD/INVITER_PHONE_REGISTRATION_REQUIRED`且槽为空，不影响注册与+30。
- cross门禁增加默认关闭、只能由显式测试依赖启用的锁前hook和有界双事务barrier，保证两边先完成锁前读取，再由升序用户锁串行，等待者的current read可见先提交者手机号。正式手机号写路径仍先锁用户，没有反向锁序、第二连接或跨邀请表locking join。
- 当前只有离线证据，尚未运行修复后的MySQL。必须先通过下一次独立复审，不能直接创建全新v13；未暂存、未迁移、未部署、非production-ready。

## 2026-09-29：v12后续直连fixture审计与收口状态

- v12正式HTTP→service→共享事务→三个真实Store→MySQL全链已通过，v11 missing-inviter动态用户fixture也已通过；随后旧cross fixture因缺少候选会话userId/openid连续性而失败。审计还发现phone-race缺连续性且505/506无手机号资格，same-openid作为全新openid竞争不应携带邀请候选。三者都是测试fixture滞后，不是正式业务缺陷。
- cross现在对501/502使用各自真实绑定，并断言2个FINAL中恰好1个pending槽和1个`INVITER_PHONE_REGISTRATION_REQUIRED`无奖励；phone-race改由已具手机号资格的501/502邀请503/504并补齐连续性；same-openid删除专用分享与候选，只验证身份并发收敛、唯一+30，以及零FINAL/零槽。
- v12退出码仍为1且全部数据库、用户、容器、匿名卷、3309端口和变量已经清理。本轮未改业务语义或迁移，修复后尚未运行MySQL；必须先独立复审，再使用全新v13环境。当前未暂存、未部署、非production-ready。

## 2026-09-29：v11旧直连fixture失败后的当前状态

- v11已完成临时用户与最小权限核验、runtime DDL拒绝、001～011，并且正式HTTP→service→共享事务→三个真实Store→MySQL调用完整返回。随后旧缺失邀请人直连fixture因未提供当前必需的候选会话userId/openid连续性事实而安全降级，旧断言得到`null !== FINAL`；这是fixture陈旧，不是已证明的正式业务缺陷，v11不能标记为通过。
- fixture现动态建立真实用户和对应微信绑定，严格解析affectedRows/insertId并以字符串保留BIGINT，再把同一服务端openid及动态用户ID传入共享事务；保留首次手机号、+30、FINAL、`INVITER_NOT_FOUND`、不占槽和零分享奖励断言，不改变业务语义。
- v11所有临时资源已清理。修复后仍只有离线证据、尚未重新运行MySQL；独立复审通过后下一次必须使用全新v12。未暂存、未迁移、未部署、非production-ready。

## 2026-09-28：v10过期凭证fixture失败后的当前状态

- v10已完成测试用户创建、权限核验、runtime DDL拒绝和001～011迁移，正式HTTP→service→三个真实Store→MySQL已启动并运行多个场景。随后测试直接构造过期凭证时只改expires_at、未同步created_at，违反`chk_invitation_share_expiry`而停止；这不是正式业务写路径缺陷，后续场景未全部执行。
- fixture现于同一参数化SQL中使用数据库`UTC_TIMESTAMP(3)`原子设置过期时间及其前严格7天的创建时间，并回读验证“已过期 + 严格七天”；id和affectedRows断言不变，011、Store和业务语义未改。
- v10数据库、用户、容器、卷、端口和变量均已清理。修复后尚未运行MySQL；下一次必须使用全新v11，不能重用v10。未暂存、未部署、非production-ready。

## 2026-09-28：v9 Docker NAT账号host失败后的当前状态

- v9已通过CREATE USER和SHOW GRANTS，migration/runtime用户均成功创建和核验；随后migration user连接因MySQL观察来源为`172.17.0.1`而账号仅创建为`@127.0.0.1`，返回`ER_ACCESS_DENIED_ERROR / 1045`。001～011、正式HTTP和业务断言尚未运行，v9全部临时资源已清理。
- 测试入口现在先用root的`USER()`解析服务端观察host，只接受规范loopback/RFC1918 IPv4；同一精确值用于两个账号的CREATE、GRANT、SHOW动态列、残留查询和DROP。对外连接目标仍是`127.0.0.1:3309`，不创建`@%`、不做多个host回退、不改变权限或destructive gate。
- 修复后尚未重新运行MySQL；下一次必须使用全新v10，不能重用v9。当前未暂存、未迁移、未部署、非production-ready。

## 2026-09-28：v8后首次独立复审收口状态

- 复审确认原`SHOW GRANTS` row shape仍过宽，并存在getter/Proxy异常泄漏风险。当前只接受动态精确列名`Grants for user@host`及单个own data property；不执行accessor，拒绝错误列名、Symbol、额外/零字段和继承字段。
- 完整解析链已进入统一try/catch；只有模块私有WeakMap品牌能保留白名单分类和安全计数，伪造code或携带敏感内容的外部异常统一重建，不设置cause或保存原始错误。
- v8历史不变。修复后仍仅有离线证据、尚未重新运行MySQL；下一次仍须全新v9。复审通过前不得创建容器或暂存，未迁移、未部署、非production-ready。

## 2026-09-28：v8 SHOW GRANTS失败后的当前状态

- v8隔离MySQL 8.0.46成功创建migration/runtime用户，证明v7的`CREATE USER query(sql, [password])`修复有效。随后`assertExactDatabaseGrants()`因旧解析器只支持单引号account格式而无法识别MySQL真实反引号输出，在权限断言阶段失败；001～011、正式HTTP场景及业务断言尚未开始。
- 当前严格解析一条``GRANT USAGE ON *.* TO `user`@`127.0.0.1` ``和一条精确目标数据库授权；完整核验反引号解码后的schema/user/host，权限顺序无关但集合必须全等。额外/重复/缺失权限或行、其他范围、ALL、PROCESS、grant option、角色、代理、动态权限、未知子句及异常row shape全部拒绝，错误不回显grant或随机账号。
- v8非系统数据库和用户残留均为0，容器、匿名卷、端口及测试环境变量已清理。修复后的代码尚未重新运行MySQL；下一次必须使用全新v9环境，不能把v8写成通过。未执行生产011、未部署、非production-ready。

## 2026-09-28：v7 CREATE USER失败（历史：已由v8确认关闭）

- v7在隔离MySQL 8.0.46首次执行正式门禁时，于创建migration user阶段收到`ER_PARSE_ERROR / 1064 / 42000`。原因是mysql2 `execute()`采用服务端prepared statement，而MySQL不接受该`CREATE USER ... IDENTIFIED BY ?`位置的参数标记。001～011迁移、正式HTTP场景和业务断言均未开始，v7不得写成通过。
- migration/runtime用户现在共用`query(sql, [password])`安全路径；账号只来自固定前缀、随机十六进制后缀、严格校验和固定`127.0.0.1`，密码只存在于values并由mysql2 text protocol转义。创建失败会在资源函数边界重建脱敏错误，不传播可能包含格式化密码的原始SQL、sqlMessage、message或cause；uncertain、created、collision及精确清理规则保持原样。
- v7失败后的临时数据库、用户、容器、匿名卷、端口和测试环境变量均已清理；后续全新v8已成功创建migration/runtime用户，确认该1064问题关闭。v7不能写成通过，v8后续失败状态见文档顶部。

## 2026-09-28：正式接入MySQL门禁结构（v7运行前快照）

- 第三次独立复审已确认方案A收口通过；后续定向复审的4个P2与2个P3均限定在正式HTTP→MySQL测试基础设施，不授权修改既有业务语义。
- `test:invitation-mysql-integration`现包含正式`createApiHandler → JWT/session → 两个邀请API → registration service → 共享事务 → 三个真实Store → MySQL`场景结构；微信外部换码是唯一业务外部替身，测试请求不能提交openid、userId、inviterId、摘要或槽位作为可信事实。
- 新结构覆盖正常闭环/重放、A/B冲突、JWT与receipt降级、邀请人手机号失效和既有NO_REWARD规则；真实表验证手机号绑定、REGISTER_BONUS幂等、FINAL/槽位、零SHARE_REWARD和回滚。原真实并发及清理覆盖保留。
- 隔离脚本继续要求`127.0.0.1:3309`与`local-docker-invitation-only`。随机空库使用明确最小bootstrap后顺序执行一次仓库`001～011`；migration/runtime随机用户分离，正式handler只使用DML-only runtime用户并以`SHOW GRANTS`严格校验。HTTP监督、四态资源清理、全错误聚合和严格数据库整数解析均纳入离线门禁；011规范LF哈希仍为`9ce82a0c87d2bdad877c326aa6ef52d34983af648a78a49968447e2bd1d0eb1b`，没有012或账户退役表。
- HTTP handler Promise监督必须有界且关闭不等待原始pending Promise；迁移目录实际集合必须与冻结001～011 manifest全等；runtime用户DDL只接受严格权限拒绝三元组`ER_TABLEACCESS_DENIED_ERROR/1142/42000`并确认测试表不存在。数据库及两个测试用户均覆盖CREATE已生效后`ECONNRESET`的uncertain精确清理闭环。
- HTTP专项必须先由deferred证明handler已进入，再分别验证未结束响应与客户端timeout；迁移目录的每个Dirent必须是严格规范普通SQL文件，不能忽略README、系统文件、目录或备份。正式MySQL场景显式声明request/response/handler/close为`3000/3000/5000/3000ms`，离线测试通过注入adapter捕获并校验。
- 本节是v7运行前结构快照；v7随后在创建migration user阶段失败，未执行迁移或正式HTTP链。2026-09-26历史结果不能作为当前通过证据；当前修复后仍待全新v8隔离环境实跑和下一轮独立复审。未执行生产迁移、未部署、非production-ready。

## 2026-09-27：邀请注册正式服务端接入复审修复当前状态

- 邀请JWT/receipt失败安全降级和邀请人FINAL前active手机号资格重检已经关闭。空壳自动合并P2明确未关闭并已从本批撤回：微信用户A与手机号用户B不同时稳定`IDENTITY_CONFLICT`并整事务回滚，不迁移绑定或业务事实。
- 2个P3已关闭：当前明确是单AppID数据契约，候选主体采用`wechat-miniapp-v1`加UTF-8字节长度分隔，appId和openid都只来自服务端；新增脚本化connection正式全链测试，穿过正式API、service、事务组合和三个真实Store。
- 当前不宣称“新微信自动合并旧手机号”已经交付。后续前置批次建议命名为`user account retirement/write-guard protocol`；本批没有创建012、账户退役表或统一写门禁。
- 邀请人失去手机号时仍允许新人注册、+30和FINAL，但结果为`NO_REWARD / INVITER_PHONE_REGISTRATION_REQUIRED`、槽位为空。011当前规范LF SHA-256为`9ce82a0c87d2bdad877c326aa6ef52d34983af648a78a49968447e2bd1d0eb1b`，上一批历史哈希`b4bc751f1f21a6ea1b472b9ff3d7db883bd94545d737681d62d2afcb9f283f87`继续保留。
- 单AppID契约中`wechat_user_bindings`没有appId列；appId只来自服务端唯一配置并做prepared/config一致性断言，不是数据库行级AppID条件。appId/openid均按1..128 UTF-8字节校验，主体继续使用版本号和字节长度分隔。
- 后续v7隔离MySQL尝试只到创建migration user即失败，001～011和正式HTTP链均未执行；当前修复后仍待全新v8和下一轮独立复审。011仍未执行。不得暂存、提交、推送、创建PR、执行迁移、连接真实数据库或部署，不代表production-ready。

## 2026-09-26：v6隔离MySQL验证状态（历史：已由PR #46合并）

- v6验证READY复用封闭用户范围P2修复后的当前代码：允许范围为`existingUserScope ∪ createdUserIds`，`lockedUserIds`只代表真实锁定结果。环境为`pictographic-invitation-mysql-20260926-v6`、MySQL 8.0.46、Docker Client/Server 29.6.2、仅`127.0.0.1:3309`、随机root测试密码、匿名卷和显式破坏性门禁，未连接默认、远程或生产数据库。初始化前5次宿主机认证未就绪，第6次成功，不属于集成测试失败。
- `2026-09-26 v6基础层快照`的完整集成脚本单次预检退出码0且`V6_SINGLE_GATE_PASSED=True`；随后连续5次压力复跑退出码均为0，`V6_MYSQL_TEST_PASS_COUNT=5`、失败轮次/退出码均为0、`V6_ALL_FIVE_TESTS_PASSED=True`、`V6_MYSQL_STRESS_GATE_PASSED=True`。两阶段临时数据库和临时用户残留均为0，测试后MySQL 8.0.46健康；单次加压力复跑共完整运行6次。该结果不覆盖2026-09-28正式HTTP→service→真实Store链。
- 真实三Store缺失邀请人场景随完整脚本执行并通过6次：注册前删除已建立分享与候选的邀请人users行，其ID仍在首次`existingUserScope`但不在`lockedUserIds`；后续复用不误判扩展，新人身份和唯一`REGISTER_BONUS +30`成功，关系为`FINAL + NO_REWARD / INVITER_NOT_FOUND`、槽位为空、邀请人奖励流水为0、允许注册并正常commit。这是隔离MySQL证据，不是生产验证。
- 完整脚本继续覆盖phone/wechat强制竞争、统一锁范围和受控创建、注册奖励严格幂等、A↔B交叉邀请、同手机号/openid收敛、第5/6位、rollback、自邀/非新人、7天/严格一年、迁移约束和best-effort清理。barrier timeout、abort及错误保留仅为离线单元测试证据。
- 清理确认容器和匿名卷删除、3309监听数为0且端口释放，全部`INVITATION_TEST_*`变量和`TestPassword`清除，项目文件未被清理修改，暂存区为空。
- 事务探针、最小权限与1213死锁失败历史以及v2/v3/v4/v5证据完整保留；v5是allowMissing修复前的历史成功证据，v6仅是`2026-09-26`版本快照的真实MySQL证据，不覆盖`2026-09-28`正式HTTP链。当前等待新的独立复审，复审通过前不得暂存。
- 当前仍只是数据与服务端基础层，未接正式手机号登录、邀请HTTP API、小程序分享按钮/卡片/落地页或生产奖励，未执行生产迁移、连接生产数据库或部署；不代表production-ready，也不允许部署。

## 2026-09-26：READY缺失成员复用P2修复（已由v6验证）

- 最新独立复审发现1个P2：READY复用只检查`lockedUserIds`，把首次`allowMissing:true`已经纳入`existingUserScope`但实际不存在的邀请人错误判定为锁范围扩展。现明确`existingUserScope`是首次封闭的全部既有用户候选，`lockedUserIds`只是真实已锁用户，`createdUserIds`只是本事务受控创建用户。
- READY扩展判断改为`existingUserScope ∪ createdUserIds`；返回值只包含`lockedUserIds`中的真实锁定子集。范围内缺失ID在`allowMissing:true`时可安全复用且不重新查询，在`allowMissing:false`时返回`DATABASE_TRANSACTION_USER_NOT_FOUND`；范围外ID仍返回`DATABASE_TRANSACTION_USER_LOCK_EXPANSION_FORBIDDEN`，缺失ID不会被伪装成已锁。
- 离线状态机与真实invitation Store组合测试证明：邀请人users行缺失不会回滚新人注册，新人身份和`REGISTER_BONUS +30`成功，邀请关系为`FINAL + NO_REWARD`、原因为`INVITER_NOT_FOUND`、不占奖励槽且`registrationAllowed=true`。对应真实三Store场景随后已由v6隔离MySQL单次及连续5次运行验证。
- v2/v3/v4/v5历史完整保留；v5是后续P2修复前的真实历史证据，`2026-09-26 / v6`结果见对应历史节，且不覆盖`2026-09-28`正式HTTP链。
- 当前仍只是数据与服务端基础层，不接正式手机号登录、邀请HTTP API、小程序分享按钮/卡片/落地页或生产奖励，不执行生产迁移、生产连接或部署；不代表production-ready，也不允许部署。

## 2026-09-26：v5隔离MySQL验证状态（历史：本轮P2修复前）

- v5验证v4后续两个P2修复后的当时代码：受控用户INSERT必须先显式完成统一锁范围初始化；测试专用barrier已具备有界timeout、abort和异常释放。环境为`pictographic-invitation-mysql-20260926-v5`、MySQL 8.0.46、Docker Client/Server 29.6.2、仅`127.0.0.1:3309`、随机root测试密码、匿名卷和显式破坏性门禁，未连接默认、远程或生产数据库。初始化前5次认证未就绪，第6次成功，不属于集成测试失败。
- `2026-09-26 v5基础层快照`的完整集成脚本单次预检退出码0且`V5_SINGLE_GATE_PASSED=True`；随后连续5次压力复跑退出码均为0，`V5_MYSQL_TEST_PASS_COUNT=5`、失败轮次/退出码均为0、`V5_ALL_FIVE_TESTS_PASSED=True`、`V5_MYSQL_STRESS_GATE_PASSED=True`。临时数据库和临时用户残留均为0，测试后MySQL 8.0.46健康。该结果不覆盖2026-09-28正式HTTP→service→真实Store链。
- 单次加5次压力复跑共完整运行6次，每次覆盖真实迁移、三Store组合、并发、幂等、约束及清理；phone/wechat正常双参与方竞争屏障继续真实执行。barrier单方超时、主动abort、cause和多错误保留由离线单元测试覆盖，没有声称在真实MySQL中故意触发超时。
- 清理确认容器和匿名卷删除、3309监听数为0且端口释放，全部`INVITATION_TEST_*`变量和`TestPassword`清除，项目文件未被清理修改，暂存区为空。
- v2/v3为更早历史，v4为当时两个P2修复前的历史成功证据；v5证明那两个P2修复后的当时版本通过真实MySQL门禁。后续复审发现READY复用缺失范围成员的新P2，因此当前状态见文档顶部。
- 当前仍只是数据与服务端基础层，未接正式手机号登录、邀请HTTP API、小程序分享按钮/卡片/落地页或生产奖励，未执行生产迁移、连接生产数据库或部署；不代表production-ready，也不允许部署。

## 2026-09-26：v4后续两个P2定向修复（已由v5验证）

- 最新独立复审没有P1，发现两个P2：受控`users` INSERT没有强制统一用户锁范围先初始化；原MySQL测试`twoPartyBarrier`在单方未抵达时可能永久等待并阻断清理。
- 共享事务现在以模块私有状态区分未初始化、显式空范围和非空范围。首次`lockDatabaseUsersInTransaction()`封闭全部预定位既有用户范围；即使没有既有用户也必须先调用空范围初始化。未初始化时INSERT稳定返回`DATABASE_USER_LOCK_SCOPE_REQUIRED`，且不执行INSERT或`LAST_INSERT_ID()`；创建成功后才登记数据库生成的新用户，后续不得扩展既有用户范围。
- barrier已抽为测试专用模块，提供有界timeout、主动abort、统一拒绝、settled/aborted状态、clearTimeout、超额抵达拒绝及稳定错误码；abort保留原始cause。phone/wechat并发分支提前失败会主动释放对端，finally总会取消未完成屏障并清除active hook，意外分支错误以`AggregateError`完整保留，正式默认路径仍不启用test hook。
- 离线测试新增未初始化空列表和INSERT拒绝、零SQL、显式空/非空范围后创建、identity不可绕过、创建后扩展拒绝、失效context，以及屏障正常、超时、abort、重复abort、cause、定时器、第三方抵达、finally及双错误保留场景。
- v4单次和连续5次真实MySQL通过保留为本轮两个P2修复前的历史成功证据，不能证明修复后代码。两个P2修复版本随后已由v5单次预检及连续5次压力复跑验证；当前等待新的独立复审，复审通过前不得暂存。
- 批次仍只是数据与服务端基础层，未接正式手机号登录编排、邀请HTTP API、小程序邀请卡片/按钮/落地页或生产奖励，不迁移、不连接生产、不部署，也不代表production-ready。

## 2026-09-26：v4隔离MySQL验证状态（历史：本轮两个P2修复前）

- v4验证对象是当时已完成独立复审4个P2与3个P3修复的代码。隔离容器为`pictographic-invitation-mysql-20260926-v4`，使用`mysql:8.0.46`、仅绑定`127.0.0.1:3309`、随机root测试密码、匿名MySQL数据卷及显式破坏性门禁；未连接默认、远程或生产数据库。
- 单次`npm.cmd run test:invitation-mysql-integration`预检以`V4_MYSQL_INTEGRATION_TEST_EXIT=0`和`V4_SINGLE_GATE_PASSED=True`通过。随后连续5次压力复跑退出码均为0，`V4_MYSQL_TEST_PASS_COUNT=5`、失败轮次和失败退出码均为0、`V4_ALL_FIVE_TESTS_PASSED=True`、`V4_MYSQL_STRESS_GATE_PASSED=True`；临时数据库和临时用户残留均为0，测试后MySQL 8.0.46健康。
- 脚本内置且不依赖外部开关的`twoPartyBarrier`强制真实唯一键竞争：同手机号的两个连接均在phone binding INSERT前抵达屏障，arrivals为2，一个成功、一个稳定返回`IDENTITY_CONFLICT`且不返回`ER_DUP_ENTRY`，最终只有一条手机号绑定、一份`REGISTER_BONUS`、一条`FINAL`和一个奖励槽；相同新openid的两个连接均在wechat binding INSERT前抵达屏障，arrivals为2，两请求成功收敛到同一user ID，最终只有一条微信绑定、一条手机号绑定、一份`REGISTER_BONUS`、一条`FINAL`和一个奖励槽。两类场景在单次预检加5次完整复跑中各真实执行并通过6次，不是普通串行收敛。
- 清理确认目标有效、容器停止并删除、匿名卷删除、3309监听数为0且端口释放，`V4_CLEANUP_CONFIRMED=True`；所有`INVITATION_TEST_*`变量和`TestPassword`均已清除。
- v2五次通过和v3单次及五次通过均保留为更早历史证据；v2覆盖范围较旧，v3发生在4个P2与3个P3修复之前。`2026-09-26 v4基础层快照`在当时通过真实MySQL，但后续复审发现锁范围初始化和无界barrier两个P2，当前状态见文档顶部。该结果不覆盖2026-09-28正式HTTP→service→真实Store链。
- 当前仍只是数据与服务端基础层：尚未接正式手机号登录或正式邀请HTTP API，尚未修改小程序邀请卡片、分享按钮或邀请落地页，未在生产发放`REGISTER_BONUS`/`SHARE_REWARD`，未执行生产迁移、连接生产数据库或部署；不代表production-ready，也不允许部署。

## 2026-09-26：最新独立复审4个P2与3个P3修复（已由v4验证）

- 新用户锁状态只能由共享事务模块成功执行受控`users` INSERT，并核对严格affectedRows、数据库insertId与同连接`LAST_INSERT_ID()`后自动建立；已删除任意ID登记接口，外部Store和callback不能修改锁集合。
- REGISTER_BONUS严格回读不再使用宽松`toInteger`，而是对原始流水、余额、ID、快照、SUM和COUNT执行范围明确的BigInt解析，异常统一`IDEMPOTENCY_KEY_CONFLICT`。发放与到期使用005秒级DATETIME及同连接数据库时间，严格一年边界改为±1秒。
- 手机号和微信绑定唯一键竞争均使用内部码整事务重试，最多3次耗尽后只返回脱敏`IDENTITY_CONFLICT`；未知重复键不误分类。测试脚本以默认关闭的同步屏障强制真实INSERT竞争。
- 011不再ALTER既有权益流水表，只新增邀请基础结构；用户ID限制在BIGINT UNSIGNED范围。release失败会quarantine并destroy连接，保留独立错误字段且禁止复用。
- v3单次与5次压力复跑是该轮修改前的历史证据；4个P2与3个P3修复代码随后由v4单次预检及连续5次压力复跑验证。更晚发现的两个P2和该阶段待v5状态已由文档顶部的v5结果取代；批次仍只是数据与服务端基础层，生产和后续功能边界不变。

## 2026-09-26：v3基础层隔离MySQL验证状态（历史：本轮修改前）

- 4个P2与1个非阻塞P3修复完成后，用户在全新`pictographic-invitation-mysql-20260926-v3`容器中验证`2026-09-26 v3基础层快照`：MySQL 8.0.46仅绑定`127.0.0.1:3309`，使用随机密码、匿名卷和显式破坏性门禁。宿主机认证在第4次初始化等待尝试成功，前三次连接失败不计为集成测试失败。该结果不覆盖2026-09-28正式HTTP→service→真实Store链。
- 当时版本的真实完整组合脚本单次预检退出码0，随后连续5次压力复跑退出码全部为0；临时数据库和临时用户残留均为0，测试后MySQL健康，暂存区为空。该结果是本轮修改前的历史证据，当前状态见上一节。
- v3覆盖真实identity、user-entitlement、invitation Store及共享事务组合，包括A↔B交叉邀请、同手机号并发收敛、注册奖励严格幂等、数据库严格一年、第5/6位竞争、回滚、候选、约束和best-effort清理。v2五次通过继续作为旧覆盖范围的真实历史，但不再用于证明完整三Store组合。
- 清理最终确认容器、匿名卷、3309监听和全部测试环境变量均无残留；首次停止后的端口未释放结果属于瞬时TCP检查，并已由后续只读复核关闭。
- 本批仍仅为数据与服务端基础层，未接正式登录或邀请HTTP API，未完成小程序邀请卡片、微信分享或落地页，未执行生产011、生产奖励、生产连接或部署，不代表production-ready。

## 2026-09-25：邀请基础层第二轮完整组合修复（历史：当时等待复跑）

- 独立复审发现4个P2与1个P3：identity预先持锁破坏完整组合顺序、同手机号并发未整事务收敛、REGISTER_BONUS幂等事实过宽、注册奖励一年语义/时间源错误，以及release错误字段误名。本轮只定向关闭这些问题。
- 每次完整组合尝试先非锁定定位微信用户、手机号用户与邀请人，再在共享不可伪造context中按BIGINT数值升序一次性锁定；identity锁后重读，新增用户登记到context，邀请reserve复用锁集合且禁止后续扩张。
- 预期手机号唯一键竞争使用专用稳定码，并仅在整事务rollback后从预解析开头重跑；与死锁和锁等待共用最多3次总尝试。其他重复键不重试，旧context不复用。
- 当时REGISTER_BONUS采用数据库`UTC_TIMESTAMP(3)`和毫秒期限，并由011修改既有流水列；本轮已撤销该ALTER、改为005秒级DATETIME并进一步收紧原始数值校验。release字段历史修复仍保留。
- MySQL脚本新增真实identity＋entitlement＋invitation完整组合的交叉邀请和同手机号竞争。v2五次通过保留为旧脚本历史证据，但不再宣称覆盖完整共享事务；该阶段修复后的真实MySQL门禁尚未运行，后续`2026-09-26 v3基础层快照`结果见对应记录。该结果不覆盖2026-09-28正式HTTP→service→真实Store链。
- 本批仍不接正式手机号登录、邀请HTTP API、小程序分享或落地页，不执行生产011、生产奖励、部署或任何生产连接。

## 2026-09-24：邀请基础层首轮复审定向修复

- 首轮独立复审发现 1 个 P1、5 个 P2、2 个 P3；当时按该范围记录为已修复，但2026-09-25复审确认完整组合与注册奖励事实仍有缺口，当前结论以上一节为准。
- 引入服务端可信候选主体、数据库当前候选唯一边界和 `SUPERSEDED` 历史状态；新候选 receipt 只能由服务端生成，旧 receipt 不得锁定旧邀请。
- 最终预留先非锁定定位，再按BIGINT数值升序一次锁定新人和邀请人用户行，随后按凭证主键→关系主键→奖励槽顺序加锁；身份、权益和邀请一致性函数只接受共享 `withDatabaseTransaction` 创建且仍有效的模块私有品牌context，并复用其唯一底层连接。
- 首次真实 MySQL 运行证明8.0.46不支持 `@@session.in_transaction`；`performance_schema.events_transactions_current` 需要额外全局读取权限，`information_schema.innodb_trx` 需要 `PROCESS` 权限，两种替代方案均被否决且未给生产业务账号扩权，因此改为生命周期受控、不可伪造的应用层事务上下文。
- 第二次真实 MySQL 运行在第5/6位奖励槽竞争中触发1213死锁；InnoDB报告确认锁定JOIN造成“关系→凭证”与“凭证→关系”反向。reserve改为非锁定定位后按数值升序锁用户，再按“分享凭证→注册关系”主键顺序锁定并复核；事务入口仅对死锁和锁等待超时进行最多3次完整重放。
- 最终P2/P3修复前的第三轮曾在仅绑定 `127.0.0.1:3309` 的 MySQL 8.0.46临时Docker容器中连续5次通过邀请集成测试，随机测试数据库和临时测试用户残留均为0；该结果保留为上一版历史证据。
- 最终复审要求将邀请私有事务能力上移为身份、权益、邀请共享的不可伪造事务context；拒绝同connection重入，rollback失败保留双错误并隔离连接，并提供同一事务内“手机号首次注册事实→REGISTER_BONUS→邀请FINAL→奖励槽预留”的测试编排。该编排仅供内部测试，未接正式路由。
- reserve锁顺序统一为：非锁定定位→参与用户按BIGINT数值升序一次锁定→用户锁下快速回读FINAL→凭证主键锁→关系主键锁→锁后事实复核→锁定回读FINAL→槽位扫描→写FINAL。第一次FINAL查询不是关系行锁，不存在旧的“候选关系→邀请人用户行”，也不使用跨表锁定JOIN。
- 完成共享事务、身份/权益组合、connection重入拒绝、rollback失败隔离、密钥和分层清理代码后，用户曾在全新的 `pictographic-invitation-mysql-20260924-v2` 隔离容器中对`2026-09-24 / v2`代码快照连续执行5次真实MySQL 8.0.46集成测试，5次退出码均为0；临时数据库和临时用户残留均为0，测试后MySQL健康检查通过。该历史快照不覆盖`2026-09-28`正式HTTP链；容器、匿名卷、3309端口和测试环境变量均已清理。
- v2隔离MySQL门禁只在当时脚本覆盖范围内通过；后续复审确认未包含真实三Store完整组合。该缺口曾由`2026-09-26 / v3`快照验证，但不覆盖`2026-09-28`正式HTTP链。批次仍仅为数据与服务端基础层，生产与后续功能边界不变。
- 收紧虚拟支付 AppKey 密钥隔离、canonical base64url、一年有效期和补偿元数据状态约束。

## 2026-09-23：邀请奖励批次1——数据与服务端基础层

- 在 `feature/invitation-data-foundation` 上新增 011 双目录迁移、独立邀请凭证安全模块和事务型邀请 store，不接正式 HTTP 路由。
- token 与 `candidateReceipt` 均使用 32 字节安全随机源，只保存各自独立密钥计算的 HMAC-SHA-256 摘要；配置缺失、过短、占位或复用时 fail closed。
- 候选关系只允许有效邀请覆盖；最终关系按新人唯一并永久锁定。邀请人用户行锁与 1..5 唯一奖励槽共同保护上限，第 6 位只形成 `NO_REWARD`，不表达为注册失败。
- 本批只预留 `REWARD_PENDING`，不修改手机号登录流程，不发放 `REGISTER_BONUS` 或 `SHARE_REWARD`，不修改权益 store。
- 只运行离线测试及具备强门禁的本地临时 MySQL 测试；不连接生产数据库，不迁移、部署、暂存、提交或推送。

## 2026-09-23：邀请新用户注册成功得30次——规则文档修订

- 功能正式名称统一为“邀请新用户注册成功得30次”，不得使用“分享即得30次”。本阶段只修订开发文档，不修改正式业务代码、数据库迁移、小程序代码、测试或 `package.json`。
- 新人资格以同一用户是否首次完成手机号快捷注册为准，不要求本次新建 `users`。普通微信登录和手机号快捷注册是不同业务事实；若微信绑定用户与既有手机号用户不同，当前稳定冲突并回滚，不自动合并。
- 有效新人获得一年有效的 `REGISTER_BONUS +30`；邀请人获得在原余额上增加的一年有效 `SHARE_REWARD +30`。邀请人最多成功获得 5 次、累计 150 次，第 6 位及之后的新用户仍正常领取自己的新人权益。
- 注册前最后一次有效邀请生效，无效、撤销或过期邀请不得覆盖此前仍有效候选；拒绝手机号授权不锁定关系；手机号注册成功后永久锁定且不得补录、替换或覆盖。
- 保留“两张表 + 两阶段幂等状态机”为推荐技术方案。token 与 `candidateReceipt` 均为高熵 bearer credential，只保存使用独立密钥计算的摘要；第一批开发前必须核对身份事务、权益事务和数据库连接复用方式。
- 本轮修改完成后只执行 Git 和文本只读检查，不暂存、不提交、不推送、不创建 PR、不连接数据库或服务器、不迁移、不部署，等待独立复审。

## 2026-09-04：批次9订单找回目标

- 支持用户重新登录后从服务端找回当前JWT用户的待处理订单，覆盖换设备和storage清空。
- 新增只读GET /api/user/virtual-payment/orders/recovery及可选orderNo游标，复用009表和索引，不改状态机/migration/支付或发货语义。
- 发现记录只作恢复索引，强制mayHaveInvoked=true；不会自动新建或重新拉起旧单，只有主动查询才进入现有安全恢复。明确另购保留双单风险确认。
- 本批不实现主动关单、邀请奖励或后台人工处理；不修三个既有门禁问题。完成代码与隔离测试后停止等待独立审查，不提交或部署。

## 2026-06-23：生产 API 切换到一级域名

- 小程序生产环境统一请求 `https://baxiaota.com/api/...`。
- 后台生产环境继续使用同源相对路径 `/api/...`。
- 不改变 Admin Token、published 过滤、首页推荐、视频禁用及审核安全边界。

## 2026-06-22：第二版文字词条动态链路

- 本轮目标是让后台发布的 `published` 文字词条通过线上 API 动态进入小程序搜索和详情页。
- 生产小程序固定请求 `https://baxiaota.com` 的公开词条 API。
- 公开端和小程序端都必须严格过滤 `status === "published"`；缺省或其他状态一律不可公开。
- 本轮不接视频、登录、会员、收费、兑换码、分享奖励或虚拟支付。
- 保留少量本地 published 词条仅作为远程请求失败时的明确备用内容，不能在远程正常空结果时覆盖服务器状态。

## 2026-06-23：首页每日象形词推荐

- 首页“今日象形词”由后台维护的 published 推荐池驱动，不再写死 `study / word-study`。
- 支持按日期自动轮播和管理员手动指定。
- 推荐词下架后公开接口必须跳过；推荐池为空或请求失败时首页隐藏推荐模块。
- 本阶段仍不接视频、登录、会员、收费、兑换码或分享奖励。

## 2026-06-23：单词示意图

- 词条支持可选 `illustrationImage` 媒体字段，当前通过后台填写正式 HTTPS 图片 URL。
- 后台可预览和清空；小程序详情页有图才显示，加载失败不影响页面。
- 本轮不接 COS/VOD SDK 或文件上传服务，只保留未来迁移字段。

## 一句话目标

把“象形英语”已有 demo 逐步做成一个可上线的微信小程序 MVP，让零基础用户可以查英文单词、看象形/词根讲解、收藏或记录学习，并为后续后台、账号、云端视频和课程资料扩展留好架构。

## 当前阶段目标

- 先在 `miniapp-uni/word-app1` 跑通小程序。
- 先使用本地 mock 数据，不急着接云服务。
- 优先还原已有 demo 的核心体验：查词首页、单词详情、我的页面。
- MVP 底部导航只保留“查词”和“我的”。关系网、单词库、课堂、更多图标和复杂入口放到后续迭代。
- 所有复杂能力先做“可替换接口”，不要一次性做重后台、重视频、重账号。

## 产品约束

- 用户是英语学习者，页面要清楚、轻快、适合手机阅读。
- 现阶段用户是新手开发者本人，开发流程必须可解释、可回退、可验证。
- MVP 不追求功能全，追求核心闭环稳定。
- 内容结构以后会很多，当前先用少量高质量示例词验证体验。

## 技术约束

- 小程序主项目：`miniapp-uni/word-app1`。
- 开发工具：HBuilderX。
- 预览工具：微信开发者工具。
- 版本管理：GitHub Desktop + Git。
- 当前不新增后端服务，除非任务明确进入账号/后台/云存储阶段。
- 当前不新增大依赖，除非用户明确批准。

## 开发原则

- 先小步跑通，再逐步增强。
- 先修路径和状态，再修视觉细节。
- 先用 mock 数据验证交互，再接后台。
- 每次任务都要留下可读的状态记录。
- 遇到 HBuilderX / 微信开发者工具路径问题，先确认运行目录，再改代码。

## 参考来源

- OpenAI 官方长任务建议：把目标、计划、状态沉到仓库文件中，让长任务可以跨会话、跨代理持续推进。
- 官方文章：[Run long-horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)
- 官方 AGENTS 说明：[AGENTS.md](https://developers.openai.com/codex/guides/agents-md)

## 2026-09-02 当前开发目标

- 完成微信虚拟支付批次7：仅在批次5可信paid事实和批次6会员权益完整性均通过后，可靠调用 `notify_provide_goods`。
- 仅完整空白2xx算notify成功；当前明确拒绝白名单为空，其他传输、HTTP、读取、超限、解析和未知响应全部进入uncertain，永不自动再次notify。
- 用持久化、单执行者、operation/sequence/version绑定的query claim补偿确认；迟到查询不得覆盖新查询、新attempt、delivered或manual review。
- 真正dispatch前在同一短事务中重新验证paid canonical证据、会员grant/流水/快照/账本和完整attempt/query历史，提交并释放connection后才调用HTTP。
- 本批不重新发放会员、不实现消息推送webhook、不调用真实微信、不运行生产migration或部署。

### 2026-09-04 批次7第三轮边界

- 仅修复终态活动query、成功来源和时间证据、204/资源清理、持久化canonical及010精确结构与部分迁移恢复，并补真实MySQL攻击验收。
- 保持批次5/6规则和UI不变，不创建011，不修既有CRLF/Word API/购书福利门禁问题；完成后停止，等待第三次独立复审，禁止提交。

### 2026-09-04 批次7第四轮边界

- 只修generated expression的引号感知比较，以及server/index.mjs监听前复用schema检查；不扩展数据模型、一致性理论攻击范围或既有门禁修复。专项验收后停止，等待独立复审，不提交或部署。

### 2026-09-04 批次8：小程序 sandbox 购买接入

- 第二轮仅按正式服务端响应补齐各端点字段/类型/关系校验和测试，不重构已通过的归并或生命周期，不修改服务端语义，完成后等待独立复审。

- 第一次审查修复边界：仅修重复恢复记录重付风险、GET缺deliveryStatus仍推进、pause/resume/onUnload旧异步复活；不修改服务端/数据库/商品/批次1～7，不增加密码学签名或新接口。完整构建及微信预览继续作为sandbox联调前置，不伪造完成。

- 在批次7已合入的基线51897c4ef2b5e0cc64d794773f8650e8f6722001上开发；一个获取学习权益页面加购买确认弹窗，入口为我的及详情额度不足，详情保留页面栈。不展示邀请奖励。
- 固定30天会员、3000分、CNY、数量1、非自动续费；有效会员可主动再次购买并由服务端顺延。
- 仅复用正式订单、reconcile、entitlement、delivery及权益接口，不改批次1～7安全语义、不新增服务端接口或依赖。
- 未确认旧单默认查询；明确另购须二次确认、新clientRequestId、新订单，保留旧单；取消/超时不是failed/closed。已可能调用微信的订单不再拉起原单。
- 仅android/harmony/windows开发版或体验版sandbox；release及配置缺失、生产回退、非微信环境禁止购买。多订单恢复记录按用户、sandbox及后端隔离，只存必要安全字段。
- granted立即刷新权益，发货确认中不否定会员、不重复发会员、不永久阻止另购。跨设备或清空storage找回订单列为批次9上线前待完成能力。
- 本轮只实现和离线验收，禁止真实支付/发货、部署、生产migration、暂存、提交和推送；完成后等待独立审查。

### 2026-09-10 sandbox 双商品兼容

- 在不修改或停用既有30元商品的前提下，为独立sandbox新增可显式启停的1元测试商品；两者productId独立，固定CNY、数量1和30天会员权益。
- 服务端必须权威选择并校验商品，客户端不提交金额；小程序仅在development连接指定sandbox域名且测试开关开启时展示1元。
- 停测通过关闭开关和停用微信后台测试道具完成，历史订单及全部审计证据保留。本阶段只开发和自动测试，不提交、推送、部署或创建真实支付订单。

### 2026-09-11 旧后台子域名退役

- 从 `bc4216b1c41c279065cdb9884e532ebc38eadfae` 的干净 `master` 建立独立域名分支，退役 `admin.baxiaota.com`；正式后台继续使用 `https://baxiaota.com/admin/`，正式 API 继续使用 `https://baxiaota.com/api/...`。
- 域名任务不得部署本次已合入但尚未部署的支付双商品代码，不运行 migration，不修改 sandbox 支付配置、商品或订单，也不发起新的 ¥1/¥30 支付。
- 退役过程中必须保留 `baxiaota.com`、`sandbox-api.baxiaota.com`、主域名 DNS、沙箱 DNS 和主域名证书；任何 DNS、Nginx 或证书清理均只针对已明确核验的旧 admin 资源。

### 2026-09-14：虚拟支付发货消息推送接收链路

- 新增独立于用户 JWT 的 `GET/POST /api/wechat/virtual-payment/message`，本批只允许显式启用的 development+sandbox+Env=1+明文 JSON。
- GET 严格执行微信 Token SHA-1 URL 校验；POST 必须先验签，再以独立字节上限读取 JSON，并严格校验 `xpay_goods_deliver_notify`、身份、订单和商品事实。
- `GoodsInfo` 只依赖已确认的 `ProductId`、`Quantity`、`Attach` 和可选嵌套 `TeamInfo`；`Attach` 必须是非空安全字符串，并在事务中严格等于锁定订单的 `orderNo`，同时进入 canonical fact/hash。`TeamInfo` 的 ActivityId/TeamId 使用非空、128字符上限和控制字符门禁，TeamType/TeamAction 必须为安全整数，未知扩展字段忽略；不把 `OrigPrice`、`ActualPrice` 假定为官方推送字段。可选 `WeChatPayInfo` 的 `MchOrderNo`、`TransactionId`、`PaidTime` 必须保留为可重建证据。
- 复用现有事件表和订单号会员幂等键，在一个数据库事务内完成事件去重、支付恢复、会员发放和 delivered 收口；成功推送不再调用 `notify_provide_goods`。
- 消息推送启用时，用户 `/delivery` 先保留固定 60 秒消息主路径窗口；到期后才允许既有 `notify_provide_goods` 作为兜底。任一活动发货 attempt 已存在时，消息回调必须失败且不得改写该 attempt。
- 不新增迁移或依赖，不写入真实 Token、OpenID、订单号或原始消息；AES 安全模式和生产启用仍是上线前限制。

### 2026-09-15：虚拟支付发货消息 AES 传输适配

- 在现有沙箱明文 JSON 回调之外增加显式 `plaintext|aes` 模式；AES 仅负责 POST 查询、`msg_signature`、解密/AppID校验及成功响应加密，解密后继续复用同一消息规范化与 Store 事务。
- AES 使用 Node 内置 crypto、AES-256-CBC、EncodingAESKey派生IV和微信32字节PKCS#7规则；严格校验Base64、长度、UTF-8、JSON与AppID，不增加依赖、迁移或新的支付状态。
- AES外层必须显式携带并匹配 `ToUserName`；完整解密缓冲区必须为32字节整数倍。成功兼容性测试使用独立生成并硬编码的假值密文/签名，响应由测试端独立验签和解包，避免生产实现自证。
- 本批只开发和离线测试 development+sandbox+Env=1，不部署、不改变微信后台配置，也不据此启用生产支付。

### 2026-09-15：EncodingAESKey 非规范 Base64 兼容

- 兼容微信后台生成的43位标准Base64字符EncodingAESKey：补`=`后可解码且结果恰为32字节即可，不再要求未使用低位为零；`=`、空白、控制字符、URL-safe字符和错误长度仍拒绝。
- 仅调整Key文本解码兼容性，密文严格Base64、AES、签名、padding、AppID、沙箱门禁和支付业务流程保持不变。

### 2026-09-15：虚拟支付 production / Env=0 支持

- 以 `VIRTUAL_PAYMENT_ENV` 作为唯一权威环境来源：sandbox固定派生请求/消息 `Env=1` 与查询响应 `env_type=2`，production固定派生 `Env=0` 与 `env_type=1`。
- production只在 `NODE_ENV=production` 下启用，只允许现有¥30会员商品，不读取sandbox用户白名单，并要求消息推送为JSON AES模式；sandbox现有¥1/¥30、明文/AES及备用发货行为保持兼容。
- 同一套签名、session、Client、Service、Store、对账、发货和消息业务按环境事实参数化，不复制状态机、会员事务或回调业务；本批只做本地开发和离线验收，不部署、不访问微信或真实数据库。
