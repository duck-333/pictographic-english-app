import http from 'node:http'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve(process.argv[2] || 'artifacts/invitation-notice-p2-20261124')
const build = JSON.parse(readFileSync(join(root, 'build-evidence.json'), 'utf8'))
const requests = [], screenshots = [], cases = []
const session = phone => ({ token: 'result-session-simulator-only', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'result-session-fixture', hasWechatBinding: true, hasPhoneBinding: phone, phoneMasked: phone ? '138****0000' : '' } })
const startedAt = new Date().toISOString()
let holdPath = '', held = null
const server = http.createServer(async (req, res) => {
  for await (const part of req) { /* Ignore fixture input; never log credentials. */ }
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  requests.push({ path, method: req.method, at: new Date().toISOString() })
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*')
  let body = { ok: true }
  if (path.endsWith('/wechat-phone-login')) body = { ok: true, ...session(true), invitation: { status: 'REWARD_GRANTED' } }
  else if (path.endsWith('/summary')) Object.assign(body, { successfulInvitations: 0, totalRewardQuota: 0, pendingRewards: 0, remainingRewardSlots: 5, limitReached: false })
  else if (path.endsWith('/entitlements')) Object.assign(body, { quotaBalance: 30, quotaTotalGranted: 30, quotaTotalConsumed: 0, membershipType: 'none', membershipStatus: 'none', membershipActive: false })
  else if (path.endsWith('/favorites')) body.favorites = []
  else if (path.endsWith('/recent-words')) body.recentWords = []
  else if (path.includes('/virtual-payment/')) { res.statusCode = 503; body = { ok: false, code: 'VIRTUAL_PAYMENT_DISABLED' } }
  else body.words = []
  const finish = () => res.end(JSON.stringify(body))
  if (holdPath && path.endsWith(holdPath)) held = { path, finish }
  else finish()
})
server.listen(3020, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
let socket, original, mocked = false
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let sequence = 0
const pending = new Map()
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(Error('Timeout ' + method)) }, 15000)
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
})
const run = async (body, args = []) => (await call('App.callFunction', { functionDeclaration: 'function(){var p=getCurrentPages().slice(-1)[0].$vm;' + body + '}', args })).result
const waitFor = async body => { for (let i = 0; i < 60; i++) { if (await run(body)) return; await delay(100) } throw Error('Wait failed: ' + body) }
const shot = async name => {
  await delay(250); const image = await call('App.captureScreenshot'), file = join(root, 'screenshots', name + '.png')
  mkdirSync(join(root, 'screenshots'), { recursive: true }); writeFileSync(file, Buffer.from(image.data, 'base64')); screenshots.push({ file, capturedAt: new Date().toISOString() })
}
const stateBody = "var c=p.$children.find(c=>typeof c.shareMessage==='function');return {uid:p._uid,active:p.invitationNoticeActive,loggedIn:p.authLoggedIn,result:p.invitationResult,timerActive:p.invitationResultTimer!==null,cardRegistered:c.registered,summary:c.summary}"
async function resetPage() {
  holdPath = ''; held = null
  await run("wx.setStorageSync('pictographic:authSession',arguments[0]);wx.removeStorageSync('pictographic:pendingInvitation');wx.reLaunch({url:'/pages/mine/index'});return true", [session(false)])
  await waitFor("return p.$scope.route==='pages/mine/index'&&p.invitationNoticeActive&&!p.hasPhoneBinding&&!p.authLoading")
  await delay(400)
}
try {
  socket = new WebSocket('ws://127.0.0.1:9423')
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => { const v = JSON.parse(event.data), item = pending.get(v.id); if (item) { pending.delete(v.id); clearTimeout(item.timer); v.error ? item.reject(Error(JSON.stringify(v.error))) : item.resolve(v.result) } })
  original = await run("return {auth:wx.getStorageSync('pictographic:authSession')||null,invitation:wx.getStorageSync('pictographic:pendingInvitation')||null}")
  await call('App.mockWxMethod', { method: 'login', result: { code: 'result-session-fixture-code' } }); mocked = true
  await resetPage()
  await run("return p.handlePhoneLogin({detail:{code:'result-session-phone-fixture'}}).then(()=>true)")
  const normal = await run(stateBody)
  assert.match(normal.result.title, /30次.*已到账/); assert.equal(normal.timerActive, true); assert.equal(normal.cardRegistered, true); assert(normal.summary)
  await shot('01-normal-login-result')
  await run('p.handleLogout();return true')
  const cleared = await run(stateBody)
  assert.equal(cleared.result, null); assert.equal(cleared.timerActive, false)
  cases.push({ scenario: 'visible-result-logout', state: cleared })
  for (const path of ['/favorites', '/summary']) {
    await resetPage(); holdPath = path
    await run("p.resultSessionTestTask=p.handlePhoneLogin({detail:{code:'result-session-phone-fixture'}});return true")
    for (let i = 0; i < 50 && !held; i++) await delay(50)
    assert(held, 'the actual refresh request must be held')
    const beforeLogout = await run('return {uid:p._uid,loading:p.authLoading,loggedIn:p.authLoggedIn,result:p.invitationResult}')
    assert.equal(beforeLogout.loading, true); assert.equal(beforeLogout.loggedIn, true)
    await run('p.handleLogout();return true')
    holdPath = ''; held.finish(); held = null
    await run('return p.resultSessionTestTask.then(()=>true)')
    const final = await run(stateBody)
    assert.equal(final.uid, beforeLogout.uid); assert.equal(final.loggedIn, false); assert.equal(final.result, null); assert.equal(final.timerActive, false)
    await delay(1600) // Let the ordinary logout toast disappear before the final screenshot.
    await shot(path === '/favorites' ? '02-logout-during-favorites-final' : '03-logout-during-card-refresh-final')
    cases.push({ scenario: 'logout-during-' + path.slice(1), beforeLogout, final })
  }
  const checkedAt = new Date().toISOString()
  writeFileSync(join(root, 'result.json'), JSON.stringify({ build, startedAt, checkedAt, normal, cases, screenshots, requests, simulatorOnly: true, realWechatAuthorization: false }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', root, startedAt, checkedAt, screenshots, cases }))
} catch (error) { if (socket?.readyState === WebSocket.OPEN) await shot('failure').catch(() => {}); console.error(error); process.exitCode = 1 }
finally {
  if (held) held.finish()
  if (mocked) await call('App.restoreWxMethod', { method: 'login' }).catch(() => {})
  if (original) await run("for(var k of ['auth','invitation']){var key=k==='auth'?'pictographic:authSession':'pictographic:pendingInvitation';if(arguments[0][k])wx.setStorageSync(key,arguments[0][k]);else wx.removeStorageSync(key)}wx.reLaunch({url:'/pages/index/index'});return true", [original]).catch(() => {})
  socket?.close(); server.close()
}
