import http from 'node:http'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve(process.argv[2] || 'artifacts/invitation-notice-20261124')
const build = JSON.parse(readFileSync(join(root, 'build-evidence.json'), 'utf8'))
const output = join(root, 'screenshots')
const requests = [], screenshots = []
const session = phone => ({ token: 'notice-simulator-only', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'notice-fixture', hasWechatBinding: true, hasPhoneBinding: phone, phoneMasked: phone ? '138****0000' : '' } })
const startedAt = new Date().toISOString()
let offline = false
const server = http.createServer(async (req, res) => {
  let text = ''; for await (const part of req) text += part
  const path = new URL(req.url, 'http://127.0.0.1').pathname, data = text ? JSON.parse(text) : {}
  requests.push({ path, method: req.method, loginCode: data.loginCode, candidateReceipt: data.candidateReceipt })
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*')
  let body = { ok: true }
  if (path.endsWith('/candidates')) {
    if (offline) { res.statusCode = 503; body = { ok: false, code: 'INVITATION_SERVICE_UNAVAILABLE' } }
    else Object.assign(body, { candidateReceipt: 'notice-fixture-receipt', expiresAt: '2099-01-01T00:00:00Z' })
  } else if (path.endsWith('/wechat-phone-login')) body = { ok: true, ...session(true), invitation: { status: 'REWARD_GRANTED' } }
  else if (path.endsWith('/summary')) Object.assign(body, { successfulInvitations: 0, totalRewardQuota: 0, pendingRewards: 0, remainingRewardSlots: 5, limitReached: false })
  else if (path.endsWith('/entitlements')) Object.assign(body, { quotaBalance: 30, quotaTotalGranted: 30, quotaTotalConsumed: 0, membershipType: 'none', membershipStatus: 'none', membershipActive: false })
  else if (path.endsWith('/favorites')) body.favorites = []
  else if (path.endsWith('/recent-words')) body.recentWords = []
  else if (path.includes('/virtual-payment/')) { res.statusCode = 503; body = { ok: false, code: 'VIRTUAL_PAYMENT_DISABLED' } }
  else if (path.includes('/featured-word')) body.word = null
  else body.words = []
  res.end(JSON.stringify(body))
})
server.listen(3019, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
const socket = new WebSocket('ws://127.0.0.1:9422')
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let sequence = 0
const pending = new Map()
socket.addEventListener('message', event => { const v = JSON.parse(event.data), item = pending.get(v.id); if (item) { pending.delete(v.id); clearTimeout(item.timer); v.error ? item.reject(v.error) : item.resolve(v.result) } })
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout ' + method)) }, 15000); pending.set(id, { resolve, reject: error => reject(Error(method + ': ' + JSON.stringify(error))), timer }); socket.send(JSON.stringify({ id, method, params })) })
const run = async (body, args = []) => (await call('App.callFunction', { functionDeclaration: 'function(){var p=getCurrentPages().slice(-1)[0].$vm;var n=p.$children.find(c=>typeof c.goRegister===\'function\');' + body + '}', args })).result
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = async body => { for (let i = 0; i < 80; i++) { if (await run(body)) return; await delay(150) } throw Error('Wait failed: ' + body) }
const shot = async name => { await delay(250); const image = await call('App.captureScreenshot'); mkdirSync(output, { recursive: true }); const file = join(output, name + '.png'); writeFileSync(file, Buffer.from(image.data, 'base64')); screenshots.push({ file, capturedAt: new Date().toISOString() }) }
const dispatch = method => run("n.$scope.__e({type:'tap',currentTarget:{dataset:{eventOpts:[['tap',[[arguments[0],['$event']]]]]}},target:{dataset:{}}});return true", [method])
let original, mocked = false
try {
  original = await run("return {auth:wx.getStorageSync('pictographic:authSession')||null,invitation:wx.getStorageSync('pictographic:pendingInvitation')||null}")
  await call('App.mockWxMethod', { method: 'login', result: { code: 'notice-fixture-candidate-code' } }); mocked = true
  await run("wx.removeStorageSync('pictographic:authSession');wx.removeStorageSync('pictographic:pendingInvitation');wx.reLaunch({url:'/pages/index/index'});return true")
  await waitFor("return n&&p.$scope.route==='pages/index/index'&&n.active")
  await shot('00-home-baseline')
  await run("wx.reLaunch({url:'/pages/index/index?invitationToken=notice-fixture-one'});return true")
  await waitFor('return n&&n.active&&n.state.guideVisible')
  await shot('01-invitation-guide')
  const beforeClose = await run("return wx.getStorageSync('pictographic:pendingInvitation')")
  await dispatch('dismiss')
  await waitFor('return n&&!n.state.guideVisible')
  assert.deepEqual(await run("return wx.getStorageSync('pictographic:pendingInvitation')"), beforeClose)
  await shot('02-home-after-close')
  await run("wx.navigateTo({url:'/pages/mine/index'});return true")
  await waitFor("return n&&p.$scope.route==='pages/mine/index'&&n.active")
  assert.equal(await run('return n.state.guideVisible'), false)
  await shot('03-mine-no-repeat')
  await run("wx.navigateBack();return true")
  await waitFor("return n&&p.$scope.route==='pages/index/index'&&n.active")
  await run("wx.reLaunch({url:'/pages/index/index?invitationToken=notice-fixture-two'});return true")
  await waitFor('return n&&n.state.guideVisible')
  await dispatch('goRegister')
  await waitFor("return n&&p.$scope.route==='pages/mine/index'&&n.active")
  assert.equal(await run('return n.state.guideVisible'), false)
  const before = await run("return {uid:p._uid,registered:p.hasPhoneBinding}")
  const summariesBefore = requests.filter(r => r.path.endsWith('/summary')).length
  await call('App.mockWxMethod', { method: 'login', result: { code: 'notice-fixture-registration-code' } })
  await run("return p.handlePhoneLogin({detail:{code:'notice-fixture-phone-code'}}).then(()=>true)")
  const after = await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return {uid:p._uid,registered:p.hasPhoneBinding,result:p.invitationResult,cardRegistered:c.registered,summary:c.summary,balance:p.entitlement.quotaBalance}")
  assert.equal(after.uid, before.uid); assert.equal(after.registered, true); assert.equal(after.cardRegistered, true)
  // Anonymous -> registered also notifies auth subscribers. Same-user P2's
  // exactly-once refresh is covered by test-miniapp-invitation-p2.mjs.
  const summaryRequestsAfterLogin = requests.filter(r => r.path.endsWith('/summary')).length - summariesBefore
  assert(summaryRequestsAfterLogin >= 1 && summaryRequestsAfterLogin <= 2)
  assert.match(after.result.title, /30次.*已到账/)
  const registration = requests.find(r => r.path.endsWith('/wechat-phone-login'))
  assert.equal(registration.candidateReceipt, 'notice-fixture-receipt')
  const candidate = requests.filter(r => r.path.endsWith('/candidates')).at(-1)
  assert.notEqual(registration.loginCode, candidate.loginCode)
  await shot('04-registration-feedback')
  await run('n.closeFeedback();return true')
  assert.equal(await run('return p.invitationResult'), null)
  await shot('05-result-dismissed')
  // Retry uses a fresh anonymous fixture, never clears a real sandbox account.
  offline = true
  await run("p.handleLogout();wx.reLaunch({url:'/pages/index/index?invitationToken=notice-fixture-network'});return true")
  await waitFor('return n&&n.state.feedbackVisible&&n.state.pending')
  await shot('06-network-retry')
  offline = false
  await run('return n.retry().then(()=>true)')
  await waitFor('return n&&n.state.guideVisible')
  await dispatch('dismiss')
  const checkedAt = new Date().toISOString()
  writeFileSync(join(root, 'result.json'), JSON.stringify({ build, startedAt, checkedAt, before, after, summaryRequestsAfterLogin, screenshots, requests, layoutVerification: 'Compare actual baseline and closed-page screenshots', realWechatAuthorization: false, simulatorOnly: true }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', root, checkedAt, screenshots }))
} catch (error) { await shot('failure').catch(() => {}); console.error(error); process.exitCode = 1 }
finally {
  if (mocked) await call('App.restoreWxMethod', { method: 'login' }).catch(() => {})
  if (original) await run("for(var k of ['auth','invitation']){var key=k==='auth'?'pictographic:authSession':'pictographic:pendingInvitation';if(arguments[0][k])wx.setStorageSync(key,arguments[0][k]);else wx.removeStorageSync(key)}wx.reLaunch({url:'/pages/index/index'});return true", [original]).catch(() => {})
  socket.close(); server.close()
}
