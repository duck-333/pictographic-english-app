# Plan

## 2026-09-26：v6最新版隔离MySQL门禁通过（等待独立复审）

- 在`pictographic-invitation-mysql-20260926-v6`中验证READY缺失成员复用P2修复后的当前代码：MySQL 8.0.46、Docker Client/Server 29.6.2、仅`127.0.0.1:3309`、随机root测试密码、匿名MySQL卷及显式破坏性门禁；未连接默认、远程或生产数据库。初始化前5次宿主机认证未就绪，第6次成功，不计为测试失败。
- 当前完整集成脚本单次预检以`V6_MYSQL_INTEGRATION_TEST_EXIT=0`、`V6_SINGLE_GATE_PASSED=True`通过；随后连续5次压力复跑退出码均为0，`V6_MYSQL_TEST_PASS_COUNT=5`、失败轮次和失败退出码均为0、`V6_ALL_FIVE_TESTS_PASSED=True`、`V6_MYSQL_STRESS_GATE_PASSED=True`。两阶段临时数据库和临时用户残留均为0，测试后MySQL 8.0.46健康；共完整运行最新版脚本6次。
- 缺失邀请人真实三Store场景在每次完整运行中均执行：先建立邀请人、分享凭证和候选，注册前删除邀请人users行；其ID保留在首次`existingUserScope`但不进入`lockedUserIds`，后续复用不再误判扩展。新人身份与唯一`REGISTER_BONUS +30`成功，关系为`FINAL + NO_REWARD / INVITER_NOT_FOUND`、`reward_slot=NULL`、邀请人奖励流水为0、`registrationAllowed=true`并正常commit；该场景在v6隔离MySQL中通过6次。
- 完整脚本还覆盖身份双参与方竞争、受控新用户、严格幂等、交叉邀请、身份收敛、第5/6位槽竞争、rollback、自邀/非新人、7天/严格一年、迁移约束及best-effort清理。barrier timeout、abort和错误保留仅由离线单元测试验证，不宣称在MySQL中故意触发。
- v6清理确认目标有效、容器和匿名卷删除、3309监听数为0且端口释放，全部`INVITATION_TEST_*`变量及`TestPassword`清除；项目文件未因清理改变，暂存区为空。
- v2/v3/v4及历史失败继续保留，v5明确为allowMissing修复前的历史证据，v6为当前最新版真实MySQL证据。当前等待新的独立复审，复审通过前不得暂存。
- 本批仍只实现数据与服务端基础层，不接正式手机号登录、邀请HTTP API或小程序邀请界面，不执行生产迁移、生产奖励、生产连接或部署；不代表production-ready，也不允许部署。

## 2026-09-26：READY缺失成员复用P2修复（已由v6验证）

- 修复READY状态错误只用`lockedUserIds`判定范围扩展的问题。`existingUserScope`保留首次统一查询封闭的全部既有用户候选，包含`allowMissing:true`下没有查到的ID；`lockedUserIds`只表达真实锁定结果；`createdUserIds`只表达本事务受控创建结果。READY允许集合固定为`existingUserScope ∪ createdUserIds`，实际返回集合固定为请求与`lockedUserIds`的交集。
- 范围内缺失成员在`allowMissing:true`时不报扩展、不重新查询且不伪装成已锁；`allowMissing:false`返回稳定`DATABASE_TRANSACTION_USER_NOT_FOUND`。范围外成员继续返回`DATABASE_TRANSACTION_USER_LOCK_EXPANSION_FORBIDDEN`，四态状态机、一次性锁范围及新建用户后禁止增加既有用户范围保持不变。
- 离线直接测试覆盖首次`[10,20]`只锁到20、READY重复/子集、严格缺失、范围外、受控创建、INITIALIZING/FAILED/失效context和零额外锁查询。真实invitation Store组合覆盖缺失邀请人时新人身份和`REGISTER_BONUS`成功、关系`FINAL + NO_REWARD / INVITER_NOT_FOUND`、无奖励槽且允许注册。
- MySQL集成脚本加入“先创建有效分享与候选、注册前删除无其他依赖的邀请人users行、执行真实三Store完整组合”的v6场景，并断言手机号绑定、唯一新人奖励、FINAL不奖励状态、空reward slot及零邀请人奖励；该场景随后已由v6隔离MySQL单次及连续5次运行验证。
- v2/v3/v4/v5均按原证据保留；v5明确为本轮P2修复前的历史成功证据，当前最新版v6结论见文档顶部。
- 本批仍只实现数据与服务端基础层，不接正式手机号登录、邀请HTTP API或小程序邀请界面，不执行生产迁移、生产奖励、生产连接或部署；不代表production-ready，也不允许部署。

## 2026-09-26：v5隔离MySQL门禁通过（历史：本轮P2修复前）

- 在`pictographic-invitation-mysql-20260926-v5`中验证当时两个P2修复后的代码：MySQL 8.0.46、Docker Client/Server 29.6.2、仅`127.0.0.1:3309`、随机root测试密码、匿名卷及显式破坏性门禁，未连接默认、远程或生产数据库。初始化前5次认证未就绪，第6次成功；不计为测试失败。
- 最新版完整集成脚本单次预检以`V5_MYSQL_INTEGRATION_TEST_EXIT=0`、`V5_SINGLE_GATE_PASSED=True`通过；随后连续5次压力复跑退出码均为0，`V5_MYSQL_TEST_PASS_COUNT=5`、失败轮次和失败退出码均为0、`V5_ALL_FIVE_TESTS_PASSED=True`、`V5_MYSQL_STRESS_GATE_PASSED=True`。两阶段临时数据库和临时用户残留均为0，测试后MySQL 8.0.46健康。
- 共6次完整运行均覆盖真实迁移、三Store组合、并发、幂等、约束和清理；phone/wechat正常双参与方屏障继续走真实MySQL路径。单方超时、主动abort、错误cause和多错误保留属于离线单元测试覆盖，没有宣称真实MySQL运行故意触发超时。
- v5清理确认目标有效、容器和匿名卷删除、3309监听数为0且端口释放，全部`INVITATION_TEST_*`变量及`TestPassword`清除；项目文件未因清理改变，暂存区为空。
- v2/v3保留为更早历史，v4保留为当时两个P2修复前的历史成功证据；v5证明那两个P2修复后的当时版本通过MySQL门禁。后续复审发现READY复用缺失成员的新P2，因此当前状态改由文档顶部记录。
- 本批仍只实现数据与服务端基础层，不接正式手机号登录、邀请HTTP API或小程序邀请界面，不执行生产迁移、生产奖励、生产连接或部署；不代表production-ready，也不允许部署。

## 2026-09-26：v4后续两个P2修复（已由v5验证）

- 修复受控用户INSERT可绕过统一锁范围初始化的问题：事务私有状态显式区分未初始化、已初始化空范围和非空范围；锁范围首次调用后封闭，空范围也必须显式建立，不能在创建新用户后追加既有用户。
- `insertDatabaseUserInTransaction()`在任何INSERT前强制检查范围初始化，未初始化固定`DATABASE_USER_LOCK_SCOPE_REQUIRED`且不执行INSERT或`LAST_INSERT_ID()`；受控创建成功后才把数据库生成的新ID登记为已锁。完整注册入口继续先预定位身份与邀请人，再统一按BIGINT升序锁定；零既有参与者也调用空范围初始化。
- 将MySQL脚本的双参与方屏障抽为独立测试辅助模块，加入有界timeout、abort/cause、统一拒绝、状态、clearTimeout和超额抵达门禁。phone/wechat分支提前失败时主动abort，finally无条件取消未完成屏障并清空active hook，意外多错误以`AggregateError`保留，保证最外层数据库清理可达。
- 离线测试覆盖空/非空锁范围、identity绕过、失败与context失效，以及屏障正常完成、单方超时、主动abort、重复abort、原始错误保留、定时器清理、第三方抵达和active hook finally清理；屏障与测试hook不进入正式默认路径。
- v4单次及连续5次通过保留为本轮两个P2修复前的历史证据。两个P2修复后的当时代码随后已由v5单次预检及连续5次压力复跑验证；更晚的READY复用P2及当前状态见文档顶部。
- 本批仍只实现数据与服务端基础层，不接正式登录编排、邀请HTTP API或小程序邀请界面，不执行生产迁移、生产奖励、生产连接或部署；不代表production-ready。

## 2026-09-26：v4隔离MySQL门禁通过（历史：本轮两个P2修复前）

- v4验证当时已完成独立复审4个P2与3个P3修复的代码。环境为`pictographic-invitation-mysql-20260926-v4`、`mysql:8.0.46`、仅`127.0.0.1:3309`、随机root测试密码、匿名数据卷及显式破坏性门禁；未连接默认、远程或生产数据库。
- `npm.cmd run test:invitation-mysql-integration`单次预检以`V4_MYSQL_INTEGRATION_TEST_EXIT=0`、`V4_SINGLE_GATE_PASSED=True`通过；随后连续5次压力复跑退出码全部为0，汇总为`V4_MYSQL_TEST_PASS_COUNT=5`、失败轮次和失败退出码均为0、`V4_ALL_FIVE_TESTS_PASSED=True`及`V4_MYSQL_STRESS_GATE_PASSED=True`。两阶段测试后的临时数据库和临时用户残留均为0，MySQL 8.0.46保持健康。
- 内置`twoPartyBarrier`在每次完整运行中强制两个连接同时抵达目标INSERT。同手机号竞争的arrivals严格为2，一个请求成功、一个脱敏为`IDENTITY_CONFLICT`且不返回`ER_DUP_ENTRY`，最终只有一条手机号绑定、一份`REGISTER_BONUS`、一条`FINAL`和一个奖励槽；相同新openid竞争的arrivals严格为2，两请求成功收敛到同一user ID，最终只有一条微信绑定、一条手机号绑定、一份`REGISTER_BONUS`、一条`FINAL`和一个奖励槽。单次预检加5次压力复跑使两类强制竞争各真实执行并通过6次，不是普通串行收敛。
- 精确清理已确认：目标有效、容器停止并删除、匿名卷删除、3309监听数为0且端口已释放；`V4_CLEANUP_CONFIRMED=True`，全部`INVITATION_TEST_*`变量和`TestPassword`已清除。
- v2/v3继续保留为更早历史证据，其中v2覆盖范围较旧，v3发生在4个P2与3个P3修复之前；v4在当时是最新版证据。后续复审发现锁范围初始化和无界barrier两个P2，该阶段待v5状态已由文档顶部的v5结果取代。
- 本批仍只实现数据与服务端基础层，不接正式手机号登录或邀请HTTP API，不修改小程序分享卡片、分享按钮或邀请落地页，不执行生产迁移、生产奖励、生产连接或部署；不代表production-ready，也不允许部署。

## 2026-09-26：最新4个P2与3个P3修复（已由v4验证）

- 删除公开任意用户ID锁登记，改为共享模块执行受控真实`users` INSERT，并以严格affectedRows、数据库insertId和同连接`LAST_INSERT_ID()`锁定回读后自动登记；外部不能修改锁集合，失败/rollback/失效context不留状态。
- REGISTER_BONUS回放对原始amount、余额、ID、快照、SUM和COUNT使用严格BigInt解析，异常统一`IDEMPOTENCY_KEY_CONFLICT`。时间遵循005现有秒级DATETIME，以同连接`UTC_TIMESTAMP()`和`DATE_ADD`实现严格一年，边界为±1秒。
- 手机号与微信唯一键竞争分别分类、整事务有界重试并在耗尽时归一化为安全`IDENTITY_CONFLICT`；未知重复键不重试。MySQL脚本增加默认关闭的测试同步屏障，用于证明两个连接实际到达目标INSERT竞争点。
- 011移除既有权益表ALTER，只新增邀请基础表；用户ID严格限制在BIGINT UNSIGNED范围。release失败立即quarantine、destroy且禁止复用或二次release，错误字段保持分离。
- v3单次及连续5次通过保留为该轮修改前的真实历史证据。4个P2与3个P3修复代码随后由v4单次预检及连续5次压力复跑验证；更晚发现的两个P2及该阶段待v5状态已由文档顶部的v5结果取代。
- 本批仍只实现数据与服务端基础层，不接正式登录、邀请HTTP API、小程序分享或落地页，不执行生产迁移、生产奖励、生产连接或部署。

## 2026-09-26：最新版v3隔离MySQL门禁通过（历史：本轮修改前）

- 在4个P2与1个非阻塞P3修复完成后，新建`pictographic-invitation-mysql-20260926-v3`隔离容器（MySQL 8.0.46、仅`127.0.0.1:3309`、随机密码、匿名卷、显式破坏性门禁）。宿主机认证在第4次初始化等待尝试成功；此前3次连接失败不是集成测试失败。
- 当时版本的真实完整组合脚本先单次预检通过，再连续5次压力复跑通过，全部退出码为0；临时数据库和临时用户残留均为0，测试后MySQL健康。该证据后来被更新复审限定为本轮修改前的历史结果，当前状态见上一节。
- v3覆盖真实三Store、共享事务组合、A↔B交叉邀请、同手机号并发收敛、严格注册奖励幂等、数据库严格一年、原第5/6位竞争、回滚、候选与约束场景。v2五次通过仍保留为真实历史，但仅代表当时未覆盖完整三Store组合的脚本范围。
- 清理最终确认容器和匿名卷不存在、3309无TCP条目或监听器、全部测试环境变量不存在。第一次停止后的`V3_PORT_3309_RELEASED=False`只是瞬时TCP检查结果，不是遗留故障。
- 当前仍只是数据与服务端基础层；不接正式登录、邀请HTTP API、小程序邀请卡片、微信分享或落地页，不执行生产011、生产奖励、生产连接或部署，也不宣称production-ready。

## 2026-09-25：完整组合并发与REGISTER_BONUS严格事实修复（历史：当时等待真实MySQL复跑）

- 修复身份阶段先持有单用户导致的交叉邀请反向锁：每次尝试先非锁定定位全部已知身份用户与邀请人，再由共享context按BigInt升序一次锁定；锁后重读身份事实，邀请reserve复用同一不可扩张锁集合。
- 仅将明确命中手机号哈希唯一约束的重复键分类为专用并发冲突；顶层完整组合与死锁/锁等待共享最多3次整事务尝试，每次从参与者定位开始重跑。普通重复键不重试。
- 当时REGISTER_BONUS改用同一connection数据库时间并由011提升既有流水列为DATETIME(3)；本轮因缺少生产DDL证据撤销该ALTER，改为005既有秒级DATETIME，当前状态见最新节。
- release失败改用独立`releaseError`，不再伪装成rollback失败；rollback隔离行为保持不变。
- 隔离MySQL脚本新增真实三Store交叉邀请与同手机号竞争完整组合，并保留原并发、回滚和清理门禁。2026-09-24 v2五次通过仅为旧脚本历史证据；该阶段最新版真实MySQL完整组合测试尚未运行，后续v3实跑结果见2026-09-26记录。
- 当前只允许离线验证并保持未暂存。未接正式登录、HTTP API、小程序、微信分享或生产奖励，未迁移、部署。

## 2026-09-24：首轮复审修复（等待再次独立复审）

- 当时记录为已处理 P1-01、P2-01 至 P2-05、P3-01 至 P3-02；2026-09-25后续复审确认完整组合用户锁序、手机号竞争和注册奖励严格事实仍需修复，当前状态以上一节为准。
- 迁移当时新增当前候选生成列唯一键、候选历史状态与更严格CHECK；共享context已建立，但当时用户锁顺序只覆盖邀请reserve内部，尚未覆盖identity预先持锁，现已补齐。
- 首次真实 MySQL 运行确认8.0.46不支持 `@@session.in_transaction`；`performance_schema.events_transactions_current` 需要额外全局读取权限，`information_schema.innodb_trx` 需要 `PROCESS` 权限，两种替代方案均因最小权限原则被否决，未给生产业务账号扩权。
- 第二次真实 MySQL 运行在第5/6位并发竞争中发现1213死锁，InnoDB报告确认关系记录与分享凭证的反向锁链。修复采用受控不可伪造事务上下文、用户主键数值升序锁定、分享凭证主键优先于注册关系主键，以及仅覆盖死锁/锁等待超时的最多3次整事务尝试。
- 最终复审前的第三轮曾在仅绑定 `127.0.0.1:3309` 的 MySQL 8.0.46临时容器中连续5次通过邀请集成测试，随机测试数据库及临时测试用户残留均为0；该结果保留为上一版历史证据。
- 最终复审后改用身份、权益、邀请共享的事务context，增加connection排他/quarantine、事务内手机号身份与REGISTER_BONUS接口、组合故障重放以及MySQL清理汇总；邀请密钥新增 `WECHAT_SECRET` 隔离和周期重复拒绝。完成这些5个P2与1个P3修复后，已在全新容器 `pictographic-invitation-mysql-20260924-v2`（MySQL 8.0.46、仅 `127.0.0.1:3309`、随机密码、匿名卷、显式破坏性门禁）对最新代码连续复跑5次，5次退出码均为0；数据库和临时用户残留均为0，测试后MySQL版本与健康检查通过。
- v2隔离容器、匿名卷、3309端口及全部测试环境变量已经清理；五次通过只代表当时脚本范围，不覆盖后来新增的真实三Store完整组合。该缺口后来已由2026-09-26最新版v3门禁验证。本批仍仅为数据与服务端基础层，不代表production-ready或允许部署。

## 2026-09-23：邀请奖励批次1基础层（等待独立复审）

已完成范围：

- 新增 `011_create_invitation_reward_foundation.sql`，在 canonical 与 server 迁移目录保持逐字节一致。
- 新增邀请 token / `candidateReceipt` 独立 HMAC 安全模块及受控事务上下文的事务型 store。
- 实现 7 天凭证、最后一次有效候选、永久关系锁、自邀/过期/撤销/非新人/达到上限的审计终态、`REWARD_PENDING` 和 1..5 奖励槽。
- 新增迁移静态测试、凭证/store 单元测试和强门禁隔离 MySQL 集成脚本。

本批边界：

- 未接入 `/api/auth/wechat-phone-login` 或任何新路由，未调用权益发放，未修改小程序。
- MySQL 集成只允许 `127.0.0.1:3309`、随机测试库和显式确认值；没有 Docker 时不得连接其他数据库替代。
- 完成专项回归、敏感信息搜索和 Git 检查后停止，保留全部改动为未暂存状态。

## 2026-09-23：邀请规则文档修订（等待独立复审）

目标：

- 以 `docs/CONTENT_ACCESS_POLICY.md` F 节作为“邀请新用户注册成功得30次”的权威产品规则。
- 将新人资格从“本次新建 `users`”修订为“手机号首次完成手机号快捷注册”，明确空壳微信账号不自动失去资格。
- 统一 30 次、一年有效、每位邀请人最多 5 次、原余额增加而非重置、第 6 位新人仍正常注册和领取新人权益等规则。
- 将会员购买及本机购买记录标记为已经实现，将邀请卡片、邀请进度、邀请落地页和活动规则页标记为尚未实现。
- 在 ADR 中保留历史语境，通过 2026-09-23 后续决策明确取代旧新人定义，并将“+5”“10 次、三个月有效”标为历史示例。
- 固化“两张表 + 两阶段幂等状态机”、bearer credential 高熵生成与摘要存储、独立密钥、事务连接复用核对等开发前约束。

本阶段边界：

- 只允许修改开发文档；以指定的七个核心 Markdown 文档为主，并可为检索到的早期 Phase 2.3 示例补充明确的历史说明。
- 不创建 011，不修改 `server/**`、`database/**`、`miniapp-uni/**`、`scripts/**`、测试或 `package.json`。
- 完成文本搜索、`git diff --check` 和修改范围检查后停止，不暂存、不提交、不推送、不迁移、不部署，等待独立复审。

## 2026-09-04：批次9完成代码与隔离验收

- 已实现JWT用户订单发现、20条稳定游标分页、客户端强制true合并、页面首入发现/手动加载更多，复用原锁与epoch。
- 现有009字段与user_created索引足够，不新增migration；仅订单表只读，恢复仍需用户主动查询。
- Store/Service/Route和小程序离线回归、真实MySQL8.0.46订单套件与EXPLAIN通过，测试数据库/容器/volume及3308监听已清理。详细结果见Documentation。
- 等待独立审查；HBuilderX完整编译、微信开发者工具及真机sandbox仍待授权联调。禁止提交、推送、合并、部署及真实微信调用。

## 2026-06-23：一级域名 API 切换

- 小程序生产 API 基地址切换为 `https://baxiaota.com`。
- 首页推荐、搜索和详情继续复用原有公开 API 路径。
- 后台 H5 生产环境保持同源相对 `/api/...` 请求。
- 完成生产检查、服务端联调测试和全量检查后重新发行小程序。

## 当前小块：最小后台方案落地

目标：
- 先不买服务器、不接真实云数据库。
- 建立后台录入数据的标准模板。
- 建立内容校验脚本，防止几千个单词录入后出现 ID 重复、拆解卡片断链、视频时间点错误。
- 明确后台不放进用户小程序，后续新建独立后台项目，并用管理员权限保护。

验收：
- `content-seed/words.example.json` 能表达 `study -> s/tud/y -> t/u/d`。
- `content-seed/word-entry-template.json` 能作为新增单词模板。
- `npm.cmd run validate:content` 能通过。
- 不影响 `miniapp-uni/word-app1` 当前小程序预览。
- `miniapp-uni/word-app1` 不注册内容管理、词条编辑、资料管理等后台页面。
- `admin-portal` 记录独立后台项目骨架、权限边界和数据流。

## 长任务执行方式

这个项目适合按“主代理统一管理 + 3-5 个子代理分工 + 审查代理把关”的方式推进。每次开长任务前，先确认本文件的阶段和验收条件，再分配具体文件边界。

## 建议团队分工

- 主代理 / 架构负责人：维护 `Prompt.md`、`Plan.md`、`Documentation.md`，拆任务，合并结果，最终验收。
- UI 前端子代理：负责页面还原、组件、视觉层级、移动端适配。主要目录：`miniapp-uni/word-app1/pages`、`miniapp-uni/word-app1/components`、`miniapp-uni/word-app1/uni.scss`。
- 功能开发子代理：负责搜索、详情跳转、底部导航、学习记录、收藏、mock 数据读写。主要目录：`miniapp-uni/word-app1/common` 和相关页面脚本。
- 内容/数据子代理：负责单词数据结构、示例词、视频字段、富文本/讲解字段的 MVP 数据模型。主要目录：`miniapp-uni/word-app1/common/content-schema.js`、`miniapp-uni/word-app1/common/word-repository.js`、`miniapp-uni/word-app1/common/mock-data.js` 和产品文档。
- 测试子代理：负责手动验收清单、控制台错误、路由检查、构建检查。默认不改业务代码。
- 审查子代理：负责代码审查、安全风险、依赖风险、目录误改、完成标准确认。默认只读。

## 阶段 0：开发环境稳定

目标：
- HBuilderX 能打开 `miniapp-uni/word-app1`。
- 微信开发者工具能由 HBuilderX 拉起。
- AppID 已写入 `manifest.json`。
- 明确不要手动导入源码目录。

验收：
- HBuilderX 底部日志显示 `word-app1 编译成功`。
- 微信开发者工具可看到首页。
- 控制台没有阻塞启动的红色错误。

状态：
- 基本完成，但仍要警惕运行错外层 `miniapp-uni` 或导入错目录。

## 阶段 1：本地查词 MVP

目标：
- 首页能搜索单词。
- 热门词能点击。
- 搜索结果能进入详情页。
- 详情页能显示单词、音标、释义、构词讲解、例句/相关词。
- 底部导航先只保留“查词”和“我的”，能在这两个入口之间切换。
- 关系网、单词库、课堂不进入首版底部导航，后续迭代再加。

验收：
- 搜索 `study`、`student`、`transport` 至少三个词都能出结果。
- 点击结果进入详情页有内容，不是空白。
- 返回首页后搜索状态正常。
- 底部导航只有“查词”和“我的”两个入口。
- 微信开发者工具控制台无阻塞性错误。
- `node --check miniapp-uni/word-app1/common/mock-data.js` 通过。

状态：
- 进行中。

## 阶段 2：我的页面和本地学习记录

目标：
- 本地保存最近查看。
- 本地保存收藏或学习状态。
- 我的页面展示最近查看、收藏、学习统计雏形。
- 明确提示数据暂存在本设备，后续账号同步。

验收：
- 打开详情页后，最近查看自动更新。
- 收藏按钮点击后状态可保存。
- 清楚标注本地数据风险。
- 不依赖云服务也能运行。

状态：
- 进行中。

## 阶段 3：内容结构和视频字段

目标：
- 定义单词内容数据结构。
- 先采用 `rich_text` 或简化结构，避免前端过早变成复杂富文本引擎。
- 为视频片段预留字段：`video_url`、`start_sec`、`end_sec`、`segment_title`。
- 为单词发音预留字段：`pronunciationAudio.url` / `audioUrl`，用于详情页音标旁的小喇叭。
- 详情页预留“重放本词”和“同视频词列表”的交互位置。

验收：
- mock 数据能表达文字讲解、图片占位、视频片段信息。
- 后台上传发音音频后，详情页才显示小喇叭；没有音频时不显示，避免用户误点。
- 前端不需要为过多内容块写复杂渲染逻辑。
- 后续接后台时数据结构可迁移。

状态：
- 进行中：已新增内容数据契约和前台仓库接口，下一步接后台/云数据库。

## 阶段 4：后台和账号方案设计

目标：
- 设计最小管理后台：内容录入、词条管理、视频打点、资料管理。
- 设计用户账号体系：openid 匿名用户 -> 登录用户。
- 设计云端存储：历史、收藏、掌握单词、反馈。

验收：
- 有数据库表草案。
- 有管理后台页面清单。
- 有视频打点工具流程。
- 有云成本预估和分阶段启用方案。

状态：
- 进行中：已新增 `BackendDataModel.md` 数据库草案和 `admin-portal` 独立后台骨架；后台录入不放进用户小程序。
- 进行中：已把两个 Codex 工作树的改动分别保存到救援分支，并在 `codex/merge-rescued-worktrees-20260512` 整合后台字母折叠目录、未上传队列、JSON 容错导入和 C 课内容样例。

## 阶段 5：云服务接入和上线准备

目标：
- 决定 uniCloud / 微信云开发 / 自建服务的阶段性方案。
- 接入真实内容接口。
- 完成微信小程序审核所需的隐私、权限、内容安全说明。

验收：
- 小程序真机预览可用。
- 线上数据读写可用。
- 关键页面加载速度可接受。
- 有回滚方案。

状态：
- 待开始。

## 2026-06-20：第一版体验版 P0 收口

目标：
- 第一版仅保留查词、已发布词条详情、本机收藏、最近查看和基础学习记录。
- 正式包使用内置已发布词库，不请求远程词条 API。
- 隐藏视频、登录、头像昵称、收费权益、缺词反馈和未完成页面。

验收：
- `npm.cmd run audit`
- `npm.cmd run validate:content`
- `npm.cmd run check:miniapp`
- `npm.cmd run check:production`
- `npm.cmd run check`
- HBuilderX 编译后在微信开发者工具和真机体验版完成手动验收。

状态：
- 代码和自动检查已完成，等待 HBuilderX/微信开发者工具真机验收。

## 2026-06-22：第二版前后台文字词条动态跑通

目标：
- 后台通过受 Admin Token 保护的 `POST /api/admin/words` 发布或撤下词条。
- 小程序生产环境通过 `GET /api/words?q=...` 搜索，并通过 `GET /api/words/:id` 获取详情。
- 公开 API 与小程序仓储层均只允许 `published`；远程正常返回空结果时不使用本地旧内容。
- 网络请求 7 秒超时，失败后恢复 loading，并明确提示远程失败或本地备用状态。
- 第二版继续关闭视频模块，不新增登录、会员、收费、兑换码或未完成页面入口。

验收：
- `npm.cmd run audit`
- `npm.cmd run validate:content`
- `npm.cmd run check:miniapp`
- `npm.cmd run check:production`
- `npm.cmd run check:server`
- `npm.cmd run check`
- HBuilderX 编译并在微信开发者工具、真机体验版验证搜索、详情、未收录、下架和断网状态。

状态：
- 代码和自动检查已完成；等待 HBuilderX、微信开发者工具和真机体验版手动验收。

## 2026-06-23：首页每日象形词推荐管理

目标：
- 后台维护已发布词条推荐池、自动每日轮播模式和手动指定模式。
- 后端公开接口只返回当天有效的 published 推荐词；推荐池为空时返回空状态。
- 小程序首页通过公开 API 加载推荐，不再使用静态 `study / word-study`。
- 推荐接口失败或返回空时隐藏模块，搜索功能继续可用。

验收：
- 单词池单项、双项跨日轮播、手动指定、推荐词下架回退、空池。
- Admin API 鉴权和未发布词条配置拒绝。
- `npm.cmd run validate:content`
- `npm.cmd run check:miniapp`
- `npm.cmd run check:production`
- `npm.cmd run check:server`
- `npm.cmd run check`

状态：
- 代码和自动检查完成后，等待 server/admin 部署以及 HBuilderX 真机体验版验收。

## 2026-06-23：单词示意图媒体字段

目标：
- 后台为词条填写、预览和删除结构化示意图信息。
- 服务端保存并通过现有 published 公开 API 返回示意图。
- 小程序详情页仅在有效 HTTPS 图片存在时显示“示意图”，支持点击预览和加载失败提示。
- 不新增上传服务、媒体 SDK、视频、登录、会员或收费能力。

验收：
- 无图完全隐藏、有图显示并可预览、清空后隐藏、非法地址拒绝。
- 搜索、详情、首页推荐、发布/撤下及 published 过滤不受影响。
- 运行完整项目检查与生产安全扫描。

## 2026-09-02：虚拟支付批次7发货确认

目标：
- 在可信paid订单和已验证会员权益之后，通过可靠三阶段流程通知微信发货。
- 用010 attempt与query-operation持久化租约模型处理并发、进程中断、迟到响应和网络不确定。
- 空白2xx之外的notify结果默认不确定；当前明确拒绝白名单为空，任何不确定结果都不得自动重发，只能由序列化查单确认delivered或进入有限确认/manual review。
- dispatch提交前必须在同一事务连接上重新验证完整paid证据、会员grant/流水/快照/账本和attempt/query历史；HTTP只能发生在事务及connection释放后。

验收：
- 客户端按字节有界流式读取，超限立即停止；HTTP、读取、解析及未知响应均进入uncertain。
- 同订单同一时刻最多一个持久化query claim；租约接管后旧operation/version结果不得落库，query count只能由当前有效结果增加一次。
- attempt号、状态组合、retry/query计数、归属和provider event均从完整历史重新验证，不能靠篡改计数或摘要恢复预算。
- Client、状态机、migration、Store、Service和Route离线测试。
- 批次1～7虚拟支付回归、身份登录、会员赠送和购书福利回归。
- 隔离MySQL 8.0.46覆盖并发、唯一attempt、lease、回滚、affectedRows、commit/rollback/release、迟到响应、查单补偿和会员数据零变化。
- 不调用真实微信，不运行生产migration，不暂存、提交、推送、合并或部署。

状态：
- 代码和自动化验收完成，等待独立攻击性复审。
- 2026-09-04第三轮定向修复：终态关闭query、成功来源/时间、204清理、canonical逐字段校验、010精确结构及第二表失败恢复已实现并经隔离MySQL验收。批次7专项门禁通过；全局门禁保留既有失败，详见Documentation。等待第三次独立攻击性复审，不暂存/提交/推送/合并/部署。
- 2026-09-04第四轮最小修复：只补引号感知generated expression比较和直接Node入口schema门禁；使用正式fixture、三种真实子进程入口及隔离MySQL验证。不扩大范围，完成后等待下一次独立复审。

## 每次长任务的标准流程

### 2026-09-04 批次8实施与验收状态

- 第二轮聚焦修复：补create支付参数早期校验、entitlement时间/boolean、delivery boolean与状态对应关系；表驱动非法响应全部停止，已通过的记录归并和生命周期保持原实现。等待下一次聚焦独立复审，不提交。

- 第一次审查定向修复：完成记录全集归并/双向唯一映射、端点响应状态校验、Controller和页面生命周期代次隔离。原true+false重付、GET缺deliveryStatus、pause/resume/卸载迟到结果与共享锁fixture通过。只等待聚焦独立复审，不扩大服务端或安全设计。

- 已实现：学习权益页面及两处入口、sandbox支付Client、单操作购买编排、多订单本地恢复、明确另购确认、原支付参数透传和granted优先刷新。
- 每次操作只执行有限的GET及必要reconcile/entitlement/delivery，不设置后台无限轮询；离页后停止后续请求，回来手动查询。已标记可能拉起支付的订单只查询。
- 三份新增离线测试接入test:miniapp:purchase及check:miniapp，覆盖方法/鉴权/正文、保存失败、取消/未知/明确另购、多单及用户环境隔离、幂等恢复、平台限制及页面生命周期。
- check:miniapp、check:server:delivery、会员MVP和购书福利兑换/UI回归通过。全局check:server与三个既有失败的具体结果记录在Documentation，不修无关问题。
- 本轮仅完成JS/MJS和Vue脚本语法验证，未执行HBuilderX完整编译或微信开发者工具预览；后续必须按正确源码目录编译并验证页面与sandbox真机行为，不把离线测试描述为真机验收。
- 批次9上线前必须补跨设备/清空storage的服务端订单找回能力。当前等待独立代码审查，未暂存、提交、推送或部署。

1. 主代理读取 `AGENTS.md`、`Prompt.md`、`Plan.md`、`Documentation.md`。
2. 主代理确认本次只做哪个阶段、哪些文件可以改。
3. 如需并行，主代理分配 3-5 个子代理，并写清每个子代理的文件边界。
4. 子代理完成后，主代理整合，不直接相信结果。
5. 测试子代理或主代理运行检查。
6. 审查子代理做代码审查。
7. 主代理更新 `Documentation.md`。
8. 最终回复用户：改了什么、怎么验证、哪些还没做。

## 小块开发节奏

- 每次只做一个小功能块或一个小修复块，不把多个方向混在一起。
- 每块开始前说明本块目标、允许修改的文件、不会触碰的目录。
- 每块改完后，立即启动一个审查子代理并行审查本块改动。
- 审查子代理默认只读，重点看 bug、目录误改、依赖风险、完成标准和缺失测试。
- 主代理在审查同时运行轻量验证，审查回来后再决定是否补修。
- 冗余代码可以删除，但必须遵守 `AGENTS.md` 的删除安全规则：不批量删除，不碰自动生成目录，不删除不确定来源的用户改动。
- 删除文件时一次只删除一个明确路径文件；如果需要批量删除，停止操作并让用户手动确认。
- 每完成一块，都要向用户说明改动、验证结果、审查结论和下一块建议。
- 适当时候更新项目记忆：目标变更写 `Prompt.md`，计划/验收变更写 `Plan.md`，状态/决策/风险写 `Documentation.md`。

## 2026-09-10 sandbox 双商品兼容验收

- 验证默认及生产路径仍固定30元商品，sandbox测试开关默认关闭。
- 验证独立sandbox开启后新订单固定为1元、CNY、30天且使用独立productId；客户端请求不能传入金额或productId。
- 验证100分的签名、query_order金额、权益幂等发放和delivery查询均按同一订单快照校验，3000分既有路径不回归。
- 验证客户端只有development＋精确sandbox域名＋显式开关才显示¥1.00；生产或其他域名无可用1元入口。
- 自动测试通过后保持未提交，进入独立复审；未经复审不部署、不创建真实订单。
- 当聊天上下文变长、工具输出过多、或连续完成 3-5 个功能块后，主代理要提醒用户压缩上下文或重新开一个窗口，并确保 `Documentation.md` 已记录当前状态。

## 2026-09-11：退役 `admin.baxiaota.com`

目标：
- 正式后台只由 `https://baxiaota.com/admin/` 提供，正式 API 只由 `https://baxiaota.com/api/...` 提供。
- 移除微信 request 合法域名、DNS 和 Nginx 中仅用于旧地址跳转的 admin 子域名资源。
- 主域名、sandbox、支付代码、支付配置、订单和数据库保持不变。

已完成：
- 合并后全仓复查 `admin.baxiaota.com` 为 0 命中；生产后台静态目录、API 发布目录及 PM2 环境同样为 0 命中。
- 微信 request 合法域名已移除旧 admin 域名，保留 `https://baxiaota.com` 和 `https://sandbox-api.baxiaota.com`；登录和会员权益读取回归正常。
- DNSPod 的 `admin` A 记录已删除；Cloudflare、Google、阿里公共 DNS 均返回名称不存在，主域名和 sandbox A 记录保持正常。
- `/etc/nginx/sites-enabled/pictographic-admin` 单一软链接已停用；`nginx -t` 成功后平滑 reload，Nginx 状态 active，生效配置无 admin vhost。
- 公网回归：主站、`/admin/`、正式 `/api/health`、sandbox `/api/health` 均为 200 且 TLS 正常。

剩余收尾：
- 评估并单独清理只服务旧证书验证的 `_dnsauth.admin` TXT，禁止误删 `_dnsauth`、`@` 或 `sandbox-api`。
- 保留 `/etc/nginx/sites-available/pictographic-admin` 和旧证书文件，直到回退窗口结束；之后再分别取得授权清理。
- 主域名免费证书已独立重新申请并部署：覆盖 `baxiaota.com`、`www.baxiaota.com`，北京时间 2026-12-10 11:59:59 到期；公网证书、首页、`/admin/` 和 `/api/health` 已验证正常。该免费证书不自动续期，后续必须在到期前再次人工申请并部署。
- 新旧主域名证书的回滚备份和上传暂存副本目前保留；确认回退窗口结束后，再分别取得授权清理，不与旧 admin 证书材料混合操作。

## 2026-09-14：`xpay_goods_deliver_notify` 开发与验收

- 路由层：公开入口与 `/api/user/virtual-payment/*` 明确隔离；严格配置、查询参数、恒定时间签名、Content-Type、UTF-8 和 16 KiB 原始正文门禁，所有响应 `no-store`。
- 事实层：独立规范化 `GoodsInfo` 和可选 `WeChatPayInfo`；`Attach` 必须等于锁定订单号并进入 canonical fact/hash，可选 `TeamInfo` 的四个已知字段按官方类型验证。事件键只由事件类型和已验证订单号语义生成，摘要由可从订单与事件列重建的可信事实生成，不混入 nonce 或原始正文。
- Store 层：entitlement、message callback、delivery claim/recovery 及共享 helper 全部统一按订单行 → 会员调度/会员记录 → delivery attempt/query → payment event 的顺序加锁；活动 attempt 直接冲突回滚。无活动 attempt 时，同事务校验 Attach 和重复事实、插入或递增事件、补齐 paid、按 orderNo 发放一次会员并写 delivered，提交前不返回成功。
- 主备仲裁：消息功能有效启用时，`/delivery` 首次只写 `pending + next_retry_at=now+60s`，窗口内不建 attempt、不调用微信；到期后才创建既有主动发货 attempt。消息先完成则兜底只读 delivered，兜底先取得 attempt 则消息失败。
- 测试：validation、Store transaction、route 三套离线测试覆盖 Attach/TeamInfo、官方最小/嵌套消息、扩展字段、MchOrderNo、重复/冲突/并发、活动 attempt、OPTIONS、正文中断与敏感信息；隔离 MySQL 8.0.46 脚本对 settled rejection 逐层检查数据库错误和显式业务码，使用两个真实连接验证 entitlement/message、message/到期 fallback 及同用户1元+30元两订单真并发，验证连续60天会员区间、生产 Service 形成 uncertain、四种活动 attempt 不覆盖以及会员写入后注入失败的完整回滚，并断言相关表均为 InnoDB、无死锁或锁等待超时。
- 限制：不运行生产迁移、不访问服务器或微信真实接口；真实 MySQL 门禁只允许在无共享卷、随机测试库的本地临时容器中执行并清理。生产启用及 AES 安全模式必须后续单独实现和复审。

## 2026-09-15：消息回调 AES 安全模式

- 新增独立 crypto 传输模块，配置必须显式选择 plaintext 或 aes；aes要求合法43字符EncodingAESKey和小程序AppID，继续受 development+sandbox+Env=1 门禁约束。
- 路由在AES模式完成外层查询/密文验签、解密和可选openid绑定后，复用现有身份、订单、消息规范化和Store流程；业务成功JSON按同一AppID封装规则加密返回。明文路径保持原响应。
- 专项测试覆盖独立硬编码成功向量、签名、Base64、padding、32字节总长度、AppID、UTF-8/JSON、重复参数、必填外层ToUserName、路由Store单次调用及测试端独立成功响应验签/解密；不重做Store并发架构，不访问数据库或真实微信。

## 2026-09-15：EncodingAESKey 兼容修复

- EncodingAESKey继续要求字符串、43位标准Base64字符且补`=`后严格得到32字节，但允许最后字符的未使用低位非零，不再以规范重编码文本相等作为有效性条件。
- 增加全假值非规范Key的独立解码、配置接入及加解密回归；其余AES传输与支付链路不变。

## 2026-09-15：虚拟支付 production / Env=0 开发验收

- 参数化权威环境映射及服务器签名、session、微信Client、Service、Store、对账、发货和AES消息链路；production订单固定为production/0/¥30，sandbox保持sandbox/1及双商品能力。
- 小程序production仅允许release包、正式API域名、Env=0和¥30，恢复记录按环境隔离；sandbox继续允许development下develop/trial及Env=1。
- 扩展production preflight，在支付启用时检查production三项支付配置、禁用¥1开关及JSON AES消息必需配置，不输出秘密，也不接入普通健康检查。
- 使用全假值离线测试覆盖Env映射、错环境拒绝、生产AES固定向量及响应独立验签解密；Store变更需在可用的隔离MySQL环境执行集成门禁。全部修改保持未暂存、未提交并等待独立复审。
