import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = new URL('../miniapp-uni/word-app1/', import.meta.url)
const future = '2099-01-01T00:00:00.000Z'
const storage = new Map()
const calls = [], codes = [], toasts = [], navigations = []
let respond
let nextCode = 0
function session(id = '1') { return { ok: true, token: 'token-' + id, expiresAt: future, user: { id, hasWechatBinding: true, hasPhoneBinding: true } } }
const summary = { ok: true, successfulInvitations: 2, totalRewardQuota: 30, pendingRewards: 1, remainingRewardSlots: 3, limitReached: false }
const response = (request, data, statusCode = 200) => request.success({ statusCode, data })
respond = request => {
  if (request.url.endsWith('/candidates')) response(request, { ok: true, candidateReceipt: 'receipt-' + request.data.token, expiresAt: future })
  else if (request.url.endsWith('/wechat-phone-login')) response(request, { ...session(), invitation: { status: 'REWARD_PENDING', reason: null } })
  else if (request.url.endsWith('/summary')) response(request, summary)
  else if (request.url.endsWith('/share-credentials')) response(request, { ok: true, token: 'ivt1.server-token', createdAt: new Date().toISOString(), expiresAt: future })
  else throw new Error('unexpected URL ' + request.url)
}
const normalRespond = respond
globalThis.uni = {
  getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
  login(options) { const code = 'fresh-code-' + (++nextCode); codes.push(code); options.success({ code }) },
  request(options) { calls.push(options); respond(options); return { abort() {} } },
  showToast(value) { toasts.push(value) }, navigateTo(value) { navigations.push(value) }, pageScrollTo() {}
}
const auth = await import(new URL('common/auth-store.js', base))
const api = await import(new URL('common/auth-api-client.js', base))
const invite = await import(new URL('common/invitation-state.js', base))
const messages = await import(new URL('common/invitation-api-client.js', base))
const options = { nodeEnv: 'development', apiBaseUrl: 'http://127.0.0.1:9999' }
const reset = () => { auth.clearAuthSession(); invite.clearPendingInvitation(); calls.length = 0; codes.length = 0; respond = normalRespond }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
async function component(path) {
  const source = await readFile(new URL(path, base), 'utf8')
  // Resolve imports against this SFC's location, including components' ../common imports.
  const executable = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import (\w+) from '[^']+\.vue'/g, 'const $1 = {}')
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, new URL(path, base)).href}'`)
  return (await import('data:text/javascript,' + encodeURIComponent(executable))).default
}
function instance(definition) {
  const value = definition.data ? definition.data() : {}
  value.$refs = {}
  value.$emit = () => {}
  for (const [name, method] of Object.entries(definition.methods || {})) value[name] = method.bind(value)
  for (const [name, getter] of Object.entries(definition.computed || {})) Object.defineProperty(value, name, { get: () => getter.call(value) })
  return value
}

// Cold launch and warm re-entry use the actual App hooks; duplicated launch/show dedupes.
reset()
const app = await component('App.vue')
app.onLaunch({ query: { invitationToken: 'cold' } })
app.onShow({ query: { invitationToken: 'cold' } })
await invite.saveIncomingInvitation(options)
assert.equal(calls.filter(c => c.url.endsWith('/candidates')).length, 1)
assert(invite.invitationState().candidate)
app.onShow({ query: { invitationToken: 'warm' } })
await invite.saveIncomingInvitation(options)
const login = await api.loginWithWechatPhone('phone-code', options)
assert.equal(calls.at(-1).data.candidateReceipt, 'receipt-warm')
assert.notEqual(calls.at(-1).data.loginCode, calls.at(-2).data.loginCode)
assert.equal(login.invitation.status, 'REWARD_PENDING')
assert.equal(auth.getAuthSession().invitation, undefined, 'reward result is not a stored balance or session entitlement')
assert(!invite.invitationState().candidate)
assert(!storage.has('pictographic:pendingInvitation'))

// The phone endpoint cannot run while candidate persistence is outstanding.
reset()
let candidateRequest
respond = request => request.url.endsWith('/candidates') ? (candidateRequest = request) : normalRespond(request)
const capturing = invite.receiveInvitation({ invitationToken: 'delayed' }, options)
await flush()
const registering = api.loginWithWechatPhone('phone-code', options)
await flush()
assert.equal(calls.filter(c => c.url.endsWith('/wechat-phone-login')).length, 0)
response(candidateRequest, { ok: true, candidateReceipt: 'delayed-receipt', expiresAt: future })
await capturing
await registering
assert.equal(calls.at(-1).data.candidateReceipt, 'delayed-receipt')
assert.equal(new Set(codes).size, codes.length)

// Invalid new invitation preserves the earlier server-valid receipt.
reset()
await invite.receiveInvitation({ invitationToken: 'valid' }, options)
respond = request => request.url.endsWith('/candidates') ? response(request, { ok: false, code: 'INVITATION_CREDENTIAL_INVALID' }, 400) : normalRespond(request)
await invite.receiveInvitation({ invitationToken: 'invalid-new' }, options)
assert(invite.invitationState().message.includes('此前有效邀请已保留'))
await api.loginWithWechatPhone('phone-code', options)
assert.equal(calls.at(-1).data.candidateReceipt, 'receipt-valid')

// Network failure remains retryable and cannot silently register without its receipt.
reset()
respond = request => request.fail({ errMsg: 'network unavailable' })
await assert.rejects(invite.receiveInvitation({ invitationToken: 'retry' }, options))
await assert.rejects(api.loginWithWechatPhone('phone-code', options), error => error.code === 'INVITATION_CAPTURE_RETRY')
assert(invite.invitationState().pending)
assert.equal(calls.filter(c => c.url.endsWith('/wechat-phone-login')).length, 0)
respond = normalRespond
await invite.saveIncomingInvitation(options)
await api.loginWithWechatPhone('phone-code', options)
assert.equal(calls.at(-1).data.candidateReceipt, 'receipt-retry')

// A late response after logout/account switch cannot restore another account's receipt.
reset()
respond = request => { candidateRequest = request }
const late = invite.receiveInvitation({ invitationToken: 'old-account' }, options)
await flush()
auth.saveAuthSession(session('2'))
response(candidateRequest, { ok: true, candidateReceipt: 'stolen', expiresAt: future })
await late
assert(!invite.invitationState().candidate)
assert(!invite.invitationState().pending)

// Server-expired receipt is cleaned locally; returning users follow server NO_REWARD.
reset()
respond = request => request.url.endsWith('/candidates') ? response(request, { ok: true, candidateReceipt: 'expired', expiresAt: '2000-01-01T00:00:00Z' }) : normalRespond(request)
await invite.receiveInvitation({ invitationToken: 'expired' }, options)
assert(!invite.invitationState().candidate)
respond = request => request.url.endsWith('/wechat-phone-login') ? response(request, { ...session(), invitation: { status: 'NO_REWARD', reason: 'NOT_FIRST_PHONE_REGISTRATION' } }) : normalRespond(request)
await api.loginWithWechatPhone('phone-code', options)
assert.equal(calls.at(-1).data.candidateReceipt, undefined)
assert(messages.invitationRegistrationMessage({ status: 'NO_REWARD', reason: 'INVITER_REWARD_LIMIT_REACHED' }).includes('名额已满'))
assert(messages.invitationRegistrationMessage({ status: 'REWARD_GRANTED' }).includes('已到账'))
assert(messages.invitationRegistrationMessage({ status: 'REWARD_PENDING' }).includes('待到账'))

// Same card controller, actual methods: pending/paid stats, preparation, safe sharing and cap.
reset()
auth.saveAuthSession(session())
const cardDefinition = await component('components/InvitationCard.vue')
const card = instance(cardDefinition)
// Component API defaults are kept local by this test's uni request adapter.
await card.refresh()
assert.deepEqual(card.summary, summary)
assert.equal(card.summary.totalRewardQuota, 30)
assert.equal(card.shareReady, false)
await card.prepare()
assert(card.shareReady)
const share = card.shareMessage()
assert(share.path.includes('invitationToken=ivt1.server-token'))
assert.equal(card.summary.totalRewardQuota, 30, 'sharing does not award quota')
for (const pagePath of ['pages/mine/index.vue', 'pages/learning-benefits/index.vue']) {
  const page = await component(pagePath)
  assert.deepEqual(page.onShareAppMessage.call({ $refs: { invitationCard: card } }, { from: 'button', target: { dataset: { invitationShare: true } } }), share)
  assert.deepEqual(page.onShareAppMessage.call({ $refs: { invitationCard: card } }, { from: 'menu' }), messages.ORDINARY_SHARE)
}
card.credential.expiresAt = '2000-01-01'
assert.deepEqual(card.shareMessage(), messages.ORDINARY_SHARE, 'expired credentials cannot produce an invitation card')
card.pause()
respond = request => request.url.endsWith('/summary') ? response(request, { ...summary, limitReached: true, successfulInvitations: 5, remainingRewardSlots: 0 }) : normalRespond(request)
await card.refresh()
const countBefore = calls.length
await card.prepare()
assert.equal(calls.length, countBefore)
respond = request => request.fail({ errMsg: 'offline' })
await card.refresh()
assert.equal(card.summary, null, 'failed stats never become zero stats')
assert(card.message)
card.pause()
respond = normalRespond
await card.refresh()
let shareRequest
respond = request => { shareRequest = request }
const lateShare = card.prepare()
await flush()
auth.clearAuthSession()
response(shareRequest, { ok: true, token: 'old-identity-token', expiresAt: future })
await lateShare
assert.equal(card.shareReady, false)
card.pause()

// A WeChat-only session must still have the phone registration button at the top.
reset()
auth.saveAuthSession({ ...session(), user: { id: 'shell', hasWechatBinding: true, hasPhoneBinding: false } })
await card.refresh()
assert.equal(card.registered, false)
assert.equal(card.summary, null)
assert((await readFile(new URL('pages/mine/index.vue', base), 'utf8')).includes('v-if="!authLoggedIn || !hasPhoneBinding"'))
card.pause()

// Existing quota and video layout stays in place; only an invitation button/route is added.
const detail = await component('pages/word-detail/index.vue')
const detailPage = instance(detail)
detailPage.openInvitation()
assert.equal(navigations.at(-1).url, '/pages/learning-benefits/index?invite=1')
assert.equal(detailPage.refreshAccessOnReturn, true)
for (const path of ['pages/mine/index.vue', 'pages/learning-benefits/index.vue']) {
  assert((await readFile(new URL(path, base), 'utf8')).includes('<invitation-card'))
}
const notice = await readFile(new URL('components/InvitationNotice.vue', base), 'utf8')
assert(notice.includes('重试保存邀请'))
assert(!(await readFile(new URL('common/invitation-api-client.js', base), 'utf8')).includes('HMAC_SECRET'))
reset()
console.log('Miniapp invitation behavior passed: cold/warm entry, capture-registration sequencing, fresh codes, retries, last valid receipt, expiry, account isolation, shared entries, stats and ordinary share.')
