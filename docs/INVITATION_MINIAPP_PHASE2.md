# 邀请第二阶段：小程序交付（2026-11-22）

## 2026-11-22 第二阶段独立复审 P2 定向修复

- P2-1：common/invitation-state.js将既有epoch与会话快照组合成isOperationCurrent并传入候选API；common/invitation-api-client.js在wx.login返回后、候选HTTP发送前检查，失效则直接结束。保留完成后检查，finally仅由当前task清理和通知，旧A不发送、不重试、不改写B的状态。
- P2-2：pages/mine/index.vue在实际手机号登录成功、会话保存后等待$nextTick，再显式调用现有InvitationCard.refresh；同账号hasPhoneBinding变化即刷新注册状态和统计。InvitationCard及saveAuthSession通知规则未改。
- 新增scripts/test-miniapp-invitation-p2.mjs：修复前两项均复现失败；修复后，与既有test-miniapp-invitations.mjs一起运行，3/3测试通过。A的wx.login人为延迟，在B保存成功/进行中/失败三种状态再释放A，断言候选HTTP只有B且B回执、进行中、错误不变；P2-2走父页面handlePhoneLogin真实成功链，$nextTick后ref才可用，同user ID通知数0、统计请求1、组件registered=true且可准备邀请。
- 定向命令：node --test scripts/test-miniapp-invitation-p2.mjs scripts/test-miniapp-invitations.mjs。两客户端/状态模块、mine SFC、两定向脚本语法及git diff --check通过；未跑服务器或数据库回归，原资格/事务/发奖/expiresAt结论保持。
- 最终HBuilderX 5.07 Vue2/mp-weixin开发版构建：北京时间2026-11-22 19:43:31开始，19:43:39.761完成；产物miniapp-uni/word-app1/unpackage/dist/invitation-p2-final-20261122-1943/mp-weixin。build-evidence.json与build.log位于其父目录。首次启动被Webpack Windows路径格式检查拒绝，改用本机原生绝对路径后成功；没有改应用源码或依赖来绕过编译。仅既有Browserslist数据过期提示。
- 新增scripts/verify-miniapp-invitation-p2-simulator.mjs，使用该最终产物、DevTools自动化9421及127.0.0.1:3019模拟接口；北京时间19:45:53.990开始、19:46:00.916检查通过。同一页面Vue uid、userId=101，模拟手机号登录实际handlePhoneLogin返回后卡片registered从false变true，恰好1次统计查询，可准备邀请；另检查次数用尽按钮经实际openInvitation到共享权益卡。
- 最新截图和result.json：miniapp-uni/word-app1/unpackage/invitation-p2-qa-20261122-1943。same-account-before-phone.png（19:45:55.975）、mine-instant-after-phone.png（19:45:57.386）、quota-invitation-entry.png（19:45:59.156）、quota-benefits-invitation-card.png（19:46:00.916）；均晚于最终构建，已人工查看。此前invitation-qa-20261122截图仅保留历史记录，不作为本次最终入口验收依据。
- 模拟器运行命令：node scripts/verify-miniapp-invitation-p2-simulator.mjs [编译目录] [截图目录]；测试会话及wx.login mock在结束恢复。没有执行真实分享、真实手机号授权、安卓/iPhone真机或生产验收，仍待验。
- 本轮应用只改上述3个文件，另增2个定向脚本并更新本交付说明和Documentation.md。原第二阶段改动、docs/competition/均保留，未读取competition；未暂存、提交、推送、上传发布、部署或连接生产。


基线：codex/membership-monthly-yearly / e5a6ab0296b41a2fb87c6ed3f511eb9ddc6e5b56。本轮未暂存、未提交，也未上传、部署或连接生产。docs/competition/原样保留。

## 文件与实现

- miniapp-uni/word-app1/common/auth-request.js：从原auth-api-client抽出原有JSON请求、超时和wx.login封装，供注册及邀请复用，无新依赖；auth-api-client.js继续保留原有导出及无邀请请求格式。
- common/invitation-api-client.js：使用实际接口获取凭证、捕获候选及查询本人统计；共享规则、按钮和结果文案；没有HMAC密钥或客户端加额。
- common/invitation-state.js：串行捕获、服务器回执到期、存储/重试、注册等待、账号变更清理和迟到响应隔离。
- components/InvitationCard.vue、InvitationNotice.vue：两个入口共用邀请组件、统计/满额/待发显示、凭证准备及候选保存提示。
- App.vue、pages/index/index.vue：onLaunch/onShow及落地onLoad接收invitationToken，覆盖冷启动及已打开再次进入。
- pages/mine/index.vue：学习权益下邀请区域；复用原手机号登录，显示服务器返回的邀请结果；原会员、购书和学习记录保持原实现。
- pages/word-detail/index.vue：现有次数用尽锁定卡片及错误兜底中增加“邀请好友，得30次”，转到现有权益页邀请锚点；视频组件/权益访问判断不改。
- pages/learning-benefits/index.vue：复用同一InvitationCard及规则，保留普通分享与会员购买。页面原生view锚点用于从次数用尽入口滚动定位。
- scripts/test-miniapp-invitations.mjs：实际SFC脚本/生命周期行为模拟；test-miniapp-learning-benefits.mjs适配新增组件导入和页面契约。package.json增加test:miniapp:invitations。
- scripts/verify-miniapp-invitations-simulator.mjs：只绑定127.0.0.1:3019的fixture接口，通过DevTools 9420检查实际编译组件并保存截图；不生成真实奖励、不发送分享，结束恢复测试前会话。

## 实际接口及必要服务器补充（单独复审）

- POST /api/user/invitations/share-credentials：当前Bearer身份，body={}；取token、createdAt、expiresAt。没有准备好的有效凭证时不显示open-type=share按钮；按下后仍再次校验期限及当前身份。
- 分享卡片：/pages/index/index?invitationToken=<服务器凭证>。仅点击专用按钮才使用邀请卡片；普通分享菜单/原普通按钮保留普通首页卡片。
- POST /api/user/invitations/candidates：body={token,loginCode}，不先建号。原响应没有凭证到期时间，无法从candidateCapturedAt推导旧分享的剩余有效期；本轮仅在server/invitation-store.mjs返回原share.expires_at，并由server/index.mjs响应追加expiresAt，另补两个相关测试。资格规则、奖励事务、表和迁移均不修改。
- POST /api/auth/wechat-phone-login：原loginCode、phoneCode、requestId；有有效候选时额外传candidateReceipt。候选先独立wx.login(code A)；候选落库完成后注册再wx.login(code B)，不复用code；取code期间若有新邀请到达，会先保存新候选再取新的注册code。
- 候选失败不是邀请成功。网络/服务故障保留incoming并显示重试，注册不会默默丢掉邀请继续；服务器明确无效/过期/已注册时结束该候选处理，允许正常注册，仍由服务器决定赠额。无效新邀请不清空此前有效回执。
- 响应invitation.status使用REWARD_PENDING、REWARD_GRANTED、NO_REWARD、MANUAL_REVIEW，按reason显示过期、老用户、名额满等；不将pending称作到账，不以本地isNew或分享回调判资格。
- GET /api/user/invitations/summary：本人Bearer统计；successfulInvitations含待发占位，totalRewardQuota只取实际到账，pendingRewards单独显示。失败显示未知/错误，不显示伪造0。GET /api/user/entitlements继续负责余额。
- 页显示、登录/账号变更和主动刷新更新数据；没有常驻轮询。退出/切换清空本地凭证与回执；服务器仍核验回执与注册微信身份一致。凭证使用原expiresAt，注册后的归属/奖励由服务器管理。
- 本轮前端需要本轮新增expiresAt响应；较早服务器未提供时，提示重试并保留候选，不自行猜测期限。上线前需把这一最小补充一起复审和部署；本轮没有部署。

## 验证证据及范围

- 通过：node scripts/test-miniapp-invitations.mjs；node scripts/test-miniapp-auth-phone-login.mjs；node scripts/test-miniapp-learning-benefits.mjs；支付client与purchase两项既有回归；服务器仅test-invitation-registration-api与test-invitation-store。
- 通过：已安装HBuilderX 5.07的uni-app Vue2 mp-weixin本地编译，production和development；仅保留既有Browserslist数据过期提示，没有安装/升级依赖。production产物不打开联网；供模拟器使用的development明确注入http://127.0.0.1:3019。
- 编译产物：miniapp-uni/word-app1/unpackage/dist/invitation-local-20261122/mp-weixin及invitation-dev-local-20261122/mp-weixin，均不入提交。
- DevTools真实编译组件自动化通过：本人2/5、到账30、待发1；凭证准备和分享path；5/5满额且待发仍占位；权益页共用组件。已检查截图，无邀请文字、按钮遮挡/裁切。开发者工具fixture不证明微信授权或真实发奖。
- 截图/result.json：miniapp-uni/word-app1/unpackage/invitation-qa-20261122。开发版可在微信开发者工具导入编译产物，运行上述verify脚本复现本地fixture检查；不要将源码目录当作原生微信项目导入。
- 未执行：真实发送/取消分享、真实wx.login/code2Session与getPhoneNumber授权、安卓/iPhone真机、微信平台审核。线上版本、011执行、两项邀请HMAC配置和平台审核仍待核实。

## 安卓/iPhone真机验收（两端分别执行）

1. 使用经批准的测试环境及已审服务器，邀请人完成手机号注册。在“我的”确认统计与余额，点“邀请好友，得30次”准备后再次点击发送卡片；取消或仅返回时统计与余额不应增加。原普通分享仍是普通首页卡片。
2. 用符合首次资格的测试微信分别从小程序关闭状态、已打开状态进入卡片，看到邀请保存提示；到“我的”完成手机号授权，检查候选和注册各用新的code，注册30次与邀请人30次以服务器事实为准。
3. 断网进入或保存候选后断网授权：看到重试提示，恢复网络重试成功后再授权；拒绝授权不锁定资格。不应出现“邀请已成功”或本地加额。
4. 让服务器测试fixture产生一笔待发，邀请人刷新看到占位和“待到账”，只在已发后更新到账次数及余额；达到5笔后显示“奖励名额已满”。失败统计应显示未知及重试。
5. 验证旧用户重登、过期/无效邀请、最后有效邀请、自邀、满额以及退出/换账号；均不串用旧回执、不会重复领取注册赠额，不合格邀请不阻止正常登录。
6. 在次数用尽的详情提示点击同一邀请入口，确认可见邀请区域，原购买、返回、视频结束提示和底部导航仍可正常操作。返回后刷新权益，不依赖分享事件发奖。
