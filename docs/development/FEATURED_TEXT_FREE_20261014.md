# 当前推荐词完整文字免费批次（2026-10-14）

状态：本地开发/隔离测试完成，待独立代码审查。用户已确认前置首页UI第二轮复审通过、P2/P3关闭。本批未暂存、提交、推送、合并或部署；唯一写入工作区为D:/english-app/pictographic-english-app-ui-integration，分支codex/ui-integration-20261014，HEAD d8a7137b043c8d48e23db8d61c774a0c631ffb0c。

## A. 本批修改文件与目的

| 文件 | 必要性 |
| --- | --- |
| server/word-store.mjs | 同次读取详情与推荐上下文，抽出共享查找/轮换算法；手动池校验及历史回退。 |
| server/index.mjs | 详情统一入口判定当前词；完成安全校验后免消费返回；匿名全文限频及无适配器503。 |
| server/word-access-policy.mjs | 增加明确文字投影，复用basic及full access，保留普通完整内容投影。 |
| admin-portal/pictographic-admin/pages/index/index.vue | 手动选项、保存检查、历史本地预览均限制池内published词。 |
| scripts/test-featured-text-access.mjs（新） | 本批隔离HTTP、真实store快照、投影、实际后台计算/验证及客户端basic缓存/文字显示测试。 |
| scripts/test-content-api-security.mjs、scripts/test-membership-entitlement-mvp.mjs | 原普通词测试适配器实现新的详情上下文接口，featuredWordId为null，仍测试普通权限；不在生产实现兼容回退。 |
| scripts/test-homepage-featured-display.mjs（原未跟踪） | 原普通basic详情断言改用池内非当前词；保留前轮展示/刷新测试，本批免费详情由新专项覆盖。 |
| Prompt.md、Plan.md、Documentation.md、docs/CONTENT_ACCESS_POLICY.md、本文（新） | 同步目标、阶段、业务例外及真实交付证据。 |

共13个本批编辑/新增文件。此前word-api-client、word-repository、首页Vue、客户端首页投影及首轮结果/报告等既有内容未覆盖或重写。

## B. 判定位置、同快照与安全

详情GET /api/words/:id保留原IP准入及private,no-store；findWordDetailContext一次readPayload取得词条与homepageFeatured，过滤published后用共享findWordInRecords查canonical ID，用共享resolveFeaturedFromRecords计算当前ID。该方法不返回免费缓存、配置版本或第二词库；路由只以目标status及两ID相等判定。原findWordById和首页推荐解析共用上述算法，搜索接口仍basic。

匿名普通词直接basic；匿名当前词在原basicIp之后追加fullIp。携带Token的详情仍先fullIp、验Token、account和用户存在校验；无效Token401/403不降级匿名。免费分支要求有效限频器，否则503 CONTENT_RATE_LIMIT_UNAVAILABLE；未修改生产配置或普通词缺适配器时的原行为。X-Client-Request-Id沿用原规范化/缺失/非法校验，不作为免费凭证。

上述检查成功后免费分支直接返回toFeaturedTextWord，不进入权益存储可用性检查、consumeQuota、余额查询或流水写入。access固定FEATURED_WORD_FREE/full/charged=false/chargeAmount=0/remainingQuota=null/membershipActive=false/membershipType=none；这些值表达本次不使用会员/余额，不能拿作账号会员查询结果。

每次新请求都重新读取。单次快照及其一次日期为本请求判定时点；期间后台写入不混用下一份配置或词条，已经取得快照的在途请求可以按原快照完成。下一个请求看到已保存修改，读失败500或缺词404，不用缓存授予免费。底层JSON原有直接writeFile并发写入行为未重构，半写/非法JSON会使请求失败；本批未加hash/gate/事务系统。

## C. 免费文字与零扣次测试

新专项使用真实createWordStore、隔离JSON和127.0.0.1随机端口HTTP；权益适配器只在内存计数/流水，不连接数据库。匿名/普通/会员/零额度当前词全文测试在任何普通请求之前验证consumeQuota调用0、ledger新增0、原余额未变；首页ID、搜索ID、大小写直接词名均由详情服务端同一判定。其他池成员及池外词保持basic/额度不足/会员分支。

相同请求ID：当前词免费不写幂等消费记录；手动切换后旧词普通用户请求扣1、写1条内存流水；重试不再扣；再次成为当前词后不再调用consumeQuota，即使之前已有同ID付费记录。零额度旧词新请求拒绝完整权限。实际MySQL流水与锁未在本批验证，零消费依据为实际路由分支不调用消费函数及适配器调用/流水断言。

同快照测试执行真实word-store源码，只在内存替换其readFile导入。首次读取后可读数据切换为“旧词下架+新配置”，当前调用仍只读1次并保持词/配置同源；下一调用读第2份数据并看到下架及新当前词。没有修改测试版生产源码或新增运行时测试后门。

## D. 实际执行与普通权益回归

HTTP测试运行形式与前轮一致：node --input-type=module --eval '<仅解析mysql2/mysql2/promise的registerHooks; await import(专项路径)>'。依赖使用createRequire('D:/english-app/pictographic-english-app/package.json')只读resolve，再转file URL；其他模块默认解析。未安装依赖、未修改原仓库。沙箱已知拒绝本地TCP，HTTP命令通过工具执行许可在沙箱外运行；会话隔离及静态检查在沙箱内。

| 命令 | 最终退出码 | 结果 |
| --- | --- | --- |
| node scripts/test-featured-text-access.mjs（上述解析器） | 0 | 免费用户矩阵、0消费/流水、三入口ID、午夜/手动/移出/下架/新入池、错误Token/用户/请求ID、429/Retry-After/no-store、无适配器503、同ID切换、单次读取、文字/视频白名单、失败不授权、实际后台与客户端方法。 |
| node scripts/test-homepage-featured-display.mjs（同解析器） | 0 | 原卡片投影/5分钟及上海午夜刷新/生命周期/缓存/会话回归。 |
| node scripts/test-content-api-security.mjs（同解析器） | 0 | 普通字段、限频先于消费、最后额度、重放、会员、no-store、peer IP。 |
| node scripts/test-membership-entitlement-mvp.mjs（同解析器） | 0 | 原会员、次数及授权完整视频回归，内存权益适配器。 |
| node scripts/test-server-word-api-link.mjs（同解析器） | 0 | 原后台保存、推荐轮换/下架/空池和客户端查询。 |
| node scripts/test-content-session-isolation.mjs（同解析器） | 0 | 实际详情/我的页：公共缓存、退出/换号/重登/续期/过期/401、迟到回复。 |
| npm.cmd run check:miniapp | 0 | 原静态、模拟支付/权益/登录和音频schema检查；没有真实支付。 |
| npm.cmd run validate:content | 0 | 三份种子内容通过。 |
| node --check server/index.mjs、server/word-store.mjs、server/word-access-policy.mjs、scripts/test-featured-text-access.mjs | 0 | JS语法通过；后台/详情Vue脚本也由专项实际加载执行。 |
| git diff --check | 0 | 无空白错误。 |

真实中间失败均为新测试预期/测试桩：首次退出1，非法Token原逻辑返回403而测试只期待401，调整为401/403；第二次退出1，后台测试调用了不存在的方法名，改用实际refreshHomepageFeaturedPreview；第三次退出1，详情Vue测试未提供BottomNav桩，补齐后通过。没有以放宽业务鉴权或改变生产代码消除这些失败。后续新增独立顶层白名单及无适配器已登录断言后再执行专项。

## E. 视频隔离及本批边界

toFeaturedTextWord为明确允许字段投影，不把完整记录spread后靠少数URL删字段。保留原公开basic信封，当前详情文字字段meaning/tip/explanation/intro/pictograph、拆解展示/关联/颜色、例句文字及siblingIds；未知根字段和嵌套parts/examples字段不透传。raw richTextHtml没有现有详情消费者，本批不返回，避免嵌入video源地址；不新增HTML解析器或教学图片免费权益。

视频仅videoTitle及videoClips内clipId/title/segmentTitle/focus/targetPart/note/startSec/endSec，由当前页面片段清单及标题消费。不输出videoUrl/url/video_url、video/videoSegment等旧容器、fileId/assetId/storagePath/播放凭证或其他未知视频别名；真实词库归一化已将旧视频容器转成videoClips。专项独立预期明确验证顶层/片段字段及原始地址、凭证不出现。客户端原normalize/clone只补空URL，实际computed验证文字区解锁但hasPlayableFullVideo=false；共享缓存仍basic、不持久化完整文字或元数据。

普通toFullWord未改，普通获权词仍得到原视频地址。当前免费词即使会员/有次数，本批也只走文字分支，不为获得视频额外扣次。短期签名、凭证、源站鉴权和免费完整视频均未实现；既有长期视频URL源站风险没有据本批字段隔离宣称解决。公开基础字段和文本仍要求正确内容语义，不能在正文/公开封面/发音字段误放受保护资源。

## F. 后台池与历史兼容

手动下拉只列池内published词；前端保存及服务端保存都拒绝池外手动ID，服务端runtime也检查属于池，不只依赖界面。历史手动ID池外/下架/缺失时不重写原配置，按当前上海日序在剩余已发布池轮换；无可用池返回empty，不放行池外词。用户需要修正手动选择后才能保存。正常添加/移除池成员、下架过滤及日轮换顺序不变，新增已发布成员确实参与轮换及手动选择。

## G. Git与测试产物

初始8个已跟踪修改、33个未跟踪文件全部保留；27个content-release-verifier-abJUb2夹具无读写清理/移动/暂存。其他原6个未跟踪集成文件保留，其中专项测试作针对性增量修改，旧报告和3份JSON仍为历史。

本批新增1个测试脚本和本文2个交付文件；最终13个已跟踪修改、35个未跟踪文件，暂存区为空。未跟踪分类：27旧夹具、6旧集成文件、2本批交付文件；夹具不在本批交付/后续暂存清单内。临时featured-text-test-<pid>.json和原接口临时JSON由各脚本finally按明确单文件unlink清理，不清理任何已有文件；server/local-data最终只剩原27个夹具，未产生额外持久测试残留。

## H. 维护成本、风险及未验证

新增一个store详情上下文方法及同模块文字投影；抽出共享查找/推荐内部算法减少重复。无新API/DB表/依赖/缓存/免费名单/权限模块，不改支付或消费实现。后续扩展详情文字字段需同时补投影及独立测试预期；明确输出字段是本批防视频别名泄漏的实际HTTP边界，不是额外版本/hash门禁。

没有运行本轮HBuilderX编译、微信开发者工具或真机验收，源码/模拟测试不代表原生验收；前轮UI构建证据不代替本轮。生产缺限频适配器时当前免费文字返回503，需后续核实生产拓扑/接入后才能开放；本批没有改生产配置。外置词库/视频源站的真实语义、并发写入及真实数据库流水未现场验证。已停止等待独立代码审查。
