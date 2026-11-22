import http from 'node:http'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const compiled = resolve(process.argv[2] || 'miniapp-uni/word-app1/unpackage/dist/invitation-p2-final-20261122-1943/mp-weixin')
const output = resolve(process.argv[3] || 'miniapp-uni/word-app1/unpackage/invitation-p2-qa-20261122-1943')
const build = JSON.parse(readFileSync(join(compiled, '../build-evidence.json'), 'utf8'))
const startedAt = new Date().toISOString()
const requests = [], screenshots = []
const stats = { successfulInvitations: 0, totalRewardQuota: 0, pendingRewards: 0, remainingRewardSlots: 5, limitReached: false }
const authSession = phone => ({ token: 'p2-simulator-only', expiresAt: '2099-01-01T00:00:00Z', user: { id: '101', hasWechatBinding: true, hasPhoneBinding: phone, phoneMasked: phone ? '138****0000' : '' } })
const server = http.createServer(async (req, res) => {
  let text = ''; for await (const part of req) text += part
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  requests.push({ path, method: req.method })
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*')
  let body = { ok: true }
  if (path.endsWith('/wechat-phone-login')) { const data=JSON.parse(text); assert(data.loginCode); assert(data.phoneCode); body={ok:true,...authSession(true),invitation:{status:'NO_REWARD',reason:'CANDIDATE_MISSING'}} }
  else if (path.endsWith('/summary')) Object.assign(body, stats)
  else if (path.endsWith('/share-credentials')) Object.assign(body, {token:'ivt1.p2-local-only',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+604800000).toISOString()})
  else if (path.endsWith('/entitlements')) Object.assign(body,{quotaBalance:30,quotaTotalGranted:30,quotaTotalConsumed:0,membershipType:'none',membershipStatus:'none',membershipActive:false})
  else if (path.endsWith('/favorites')) body.favorites=[]
  else if (path.endsWith('/recent-words')) body.recentWords=[]
  else if (path.includes('/virtual-payment/')) {res.statusCode=503;body={ok:false,code:'VIRTUAL_PAYMENT_DISABLED'}}
  else if (path.includes('/featured-word')) body.word=null
  else body.words=[]
  res.end(JSON.stringify(body))
})
server.listen(3019,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve))
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let socket
try {
  socket=new WebSocket('ws://127.0.0.1:9421')
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
} catch(error) {server.close();throw error}
let sequence=0
const pending=new Map()
socket.addEventListener('message',event=>{const value=JSON.parse(event.data),item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(value.error):item.resolve(value.result)}})
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timeout '+method))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
const run=async(body,args=[])=>(await call('App.callFunction',{functionDeclaration:'function(){var p=getCurrentPages().slice(-1)[0].$vm;'+body+'}',args})).result
const waitFor=async body=>{for(let i=0;i<100;i++){if(await run(body))return;await delay(100)}throw new Error('Timed out waiting for '+body)}
const shot=async name=>{await delay(400);const result=await call('App.captureScreenshot');mkdirSync(output,{recursive:true});const file=join(output,name+'.png');writeFileSync(file,Buffer.from(result.data,'base64'));screenshots.push({file,capturedAt:new Date().toISOString()})}
let originalSession,loginMocked=false
try {
  originalSession=await run("return wx.getStorageSync('pictographic:authSession')||null")
  await run("wx.setStorageSync('pictographic:authSession',arguments[0]);wx.reLaunch({url:'/pages/mine/index'});return true",[authSession(false)])
  await waitFor("var c=p.$children.find(c=>typeof c.shareMessage==='function');return p.$scope.route==='pages/mine/index'&&p.authSession&&p.authSession.user.hasPhoneBinding===false&&c&&c.registered===false")
  const before=await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return {uid:p._uid,userId:p.authSession.user.id,registered:c.registered,summary:c.summary}")
  assert.equal(requests.filter(item=>item.path.endsWith('/summary')).length,0)
  await shot('same-account-before-phone')
  await call('App.mockWxMethod',{method:'login',result:{code:'p2-simulator-login-code'}});loginMocked=true
  const after=await run("return p.handlePhoneLogin({detail:{code:'p2-simulator-phone-code'}}).then(function(){var c=p.$children.find(c=>typeof c.shareMessage==='function');return {uid:p._uid,route:p.$scope.route,userId:p.authSession.user.id,phone:p.authSession.user.hasPhoneBinding,registered:c.registered,summary:c.summary}})")
  assert.equal(after.uid,before.uid);assert.equal(after.userId,before.userId);assert.equal(after.phone,true);assert.equal(after.registered,true)
  assert.equal(after.route,'pages/mine/index');assert.deepEqual(after.summary,{ok:true,...stats})
  assert.equal(requests.filter(item=>item.path.endsWith('/summary')).length,1)
  await run("wx.pageScrollTo({selector:'#invitation-section',duration:0});return true")
  await shot('mine-instant-after-phone')
  await run("return p.$children.find(c=>typeof c.shareMessage==='function').prepare()")
  const share=await run("return p.$children.find(c=>typeof c.shareMessage==='function').shareMessage()")
  assert(share.path.includes('invitationToken=ivt1.p2-local-only'))
  await run("wx.navigateTo({url:'/pages/word-detail/index?id=p2-local-word'});return true")
  await waitFor("return p.$scope.route==='pages/word-detail/index'")
  // Inject only the existing exhausted-quota view state. No content or permissions are unlocked.
  await run("p.word=null;p.loading=false;p.quotaInsufficientFallback=true;p.notFoundTitle='剩余查词次数不足';p.notFoundDescription='本地测试：查词次数已用尽';return true")
  await shot('quota-invitation-entry')
  await run("p.openInvitation();return true")
  await waitFor("var c=p.$children.find(c=>typeof c.shareMessage==='function');return p.$scope.route==='pages/learning-benefits/index'&&c&&c.registered&&c.summary")
  const benefits=await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return {route:p.$scope.route,registered:c.registered,summary:c.summary}")
  await run("wx.pageScrollTo({selector:'#invitation-section',duration:0});return true")
  await shot('quota-benefits-invitation-card')
  const checkedAt=new Date().toISOString()
  mkdirSync(output,{recursive:true});writeFileSync(join(output,'result.json'),JSON.stringify({build,compiled,startedAt,checkedAt,before,after,share,benefits,screenshots,requests,realWechatAuthorization:'not tested; login and phone code are local fixtures'},null,2))
  console.log('P2 compiled simulator checks passed: same user and same page, phone registration -> one summary query -> invitation ready; mine and exhausted-quota entries displayed.')
  console.log(JSON.stringify({compiled,output,startedAt,checkedAt,screenshots}))
} catch(error) {
  console.error(JSON.stringify({requests,page:await run("return {route:p.$scope.route,children:p.$children.map(c=>({keys:Object.keys(c.$data),registered:c.registered,message:c.message}))}").catch(()=>null)}))
  await shot('failure').catch(()=>{});throw error
} finally {
  if(loginMocked)await call('App.restoreWxMethod',{method:'login'}).catch(()=>{})
  await run("var original=arguments[0];if(original&&original.token!=='p2-simulator-only')wx.setStorageSync('pictographic:authSession',original);else wx.removeStorageSync('pictographic:authSession');return true",[originalSession]).catch(()=>{})
  socket.close();server.close()
}
