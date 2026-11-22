import http from 'node:http'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const output = resolve(process.argv[2] || 'miniapp-uni/word-app1/unpackage/invitation-qa-20261122')
mkdirSync(output, { recursive: true })
const requests = []
let stats = { successfulInvitations: 2, totalRewardQuota: 30, pendingRewards: 1, remainingRewardSlots: 3, limitReached: false }
const entitlement = { quotaBalance: 0, quotaTotalGranted: 30, quotaTotalConsumed: 30, membershipType: 'none', membershipStatus: 'none', membershipActive: false }
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  requests.push({ path, method: req.method })
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.end(); return }
  let data = { ok: true }
  if (path.endsWith('/invitations/summary')) data = { ok: true, ...stats }
  else if (path.endsWith('/share-credentials')) data = { ok: true, token: 'ivt1.simulator-local-only', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 604800000).toISOString() }
  else if (path.endsWith('/entitlements')) data = { ok: true, ...entitlement }
  else if (path.endsWith('/favorites')) data.favorites = []
  else if (path.endsWith('/recent-words')) data.recentWords = []
  else if (path.includes('/virtual-payment/')) { res.statusCode = 503; data = { ok: false, code: 'VIRTUAL_PAYMENT_DISABLED' } }
  else if (path.includes('/featured-word')) data.word = null
  else data.words = []
  res.end(JSON.stringify(data))
})
server.listen(3019, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
console.log('Local-only simulator API listening on 127.0.0.1:3019; waiting for DevTools automation port 9420')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket
for (let i = 0; i < 120; i++) {
  try {
    socket = new WebSocket('ws://127.0.0.1:9420')
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    break
  } catch (error) { if (i === 119) { server.close(); throw error }; await delay(500) }
}
let sequence = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const value = JSON.parse(event.data), item = pending.get(value.id)
  if (item) { pending.delete(value.id); clearTimeout(item.timer); value.error ? item.reject(value.error) : item.resolve(value.result) }
})
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)) }, 10000)
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
})
const run = async (body, args = []) => (await call('App.callFunction', { functionDeclaration: 'function(){var p=getCurrentPages().slice(-1)[0].$vm;' + body + '}', args })).result
const shot = async name => { const image = await call('App.captureScreenshot'); writeFileSync(resolve(output, name + '.png'), Buffer.from(image.data, 'base64')) }
let previousSession
try {
  previousSession = await run("return wx.getStorageSync('pictographic:authSession') || null")
  await run("wx.setStorageSync('pictographic:authSession',{token:'local-simulator-only',expiresAt:'2099-01-01T00:00:00Z',user:{id:'101',hasWechatBinding:true,hasPhoneBinding:true,phoneMasked:'138****0000'}});wx.reLaunch({url:'/pages/mine/index'});return true")
  for (let i = 0; i < 60; i++) {
    const ready = await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return p.$scope.route==='pages/mine/index' && c && c.summary && c.summary.successfulInvitations===2")
    if (ready) break
    if (i === 59) throw new Error('Invitation card did not load local summary')
    await delay(100)
  }
  const initial = await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return {summary:c.summary,ready:c.shareReady,quota:p.quotaBalanceText}")
  assert.equal(initial.summary.successfulInvitations, 2); assert.equal(initial.summary.pendingRewards, 1); assert.equal(initial.summary.totalRewardQuota, 30)
  await run("wx.pageScrollTo({selector:'#invitation-section',duration:0});return true")
  await delay(400)
  await shot('mine-pending')
  await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return c.prepare().then(()=>c.shareReady)")
  const share = await run("return p.$children.find(c=>typeof c.shareMessage==='function').shareMessage()")
  assert(share.path.includes('invitationToken=ivt1.simulator-local-only'))
  stats = { successfulInvitations: 5, totalRewardQuota: 120, pendingRewards: 1, remainingRewardSlots: 0, limitReached: true }
  await run("return p.$children.find(c=>typeof c.shareMessage==='function').refresh()")
  await shot('mine-cap')
  assert.equal(await run("return p.$children.find(c=>typeof c.shareMessage==='function').summary.limitReached"), true)
  await run("wx.navigateTo({url:'/pages/learning-benefits/index?invite=1'});return true")
  for (let i=0;i<60;i++) {
    const ready=await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return p.$scope.route==='pages/learning-benefits/index' && c && !!c.summary")
    if (ready) break
    await delay(100)
  }
  await delay(400)
  const benefits = await run("var c=p.$children.find(c=>typeof c.shareMessage==='function');return {route:p.$scope.route,summary:c&&c.summary}")
  assert.equal(benefits.route, 'pages/learning-benefits/index'); assert.equal(benefits.summary.limitReached, true)
  await shot('benefits-cap')
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ initial, share, benefits, requests, nativeWechatShareOrPhoneAuthorization: 'not tested' }, null, 2))
  console.log('Compiled DevTools invitation UI passed: local request/summary, pending/paid separation, credential, capped state, shared benefits component. Screenshots: ' + output)
} catch (error) {
  console.error(JSON.stringify({requests, page:await run("return {route:p.$scope.route,auth:p.authSession,children:p.$children.map(c=>({keys:Object.keys(c.$data),message:c.message,registered:c.registered,summary:c.summary}))}").catch(()=>null)}))
  await shot('failure').catch(()=>{})
  throw error
} finally {
  await run("var original=arguments[0];if(original && original.token!=='local-simulator-only')wx.setStorageSync('pictographic:authSession',original);else wx.removeStorageSync('pictographic:authSession');return true", [previousSession]).catch(()=>{})
  socket.close(); server.close()
}
