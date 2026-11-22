import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
const base = new URL('../miniapp-uni/word-app1/', import.meta.url)
const storage = new Map(), calls = []
const future = '2099-01-01T00:00:00Z'
const summary = { ok: true, successfulInvitations: 0, totalRewardQuota: 0, pendingRewards: 0, remainingRewardSlots: 5, limitReached: false }
const session = phone => ({ ok: true, token: 'p2-test-token', expiresAt: future, user: { id: 'p2-same-user', hasWechatBinding: true, hasPhoneBinding: phone } })
const response = (request, data) => request.success({ statusCode: 200, data })
let handleRequest, handleLogin
let code = 0
const loginNow = options => options.success({ code: `p2-fresh-${++code}` })
globalThis.uni = {
  getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
  login(options) { handleLogin(options) },
  request(options) { calls.push(options); handleRequest(options); return { abort() {} } },
  showToast() {}, pageScrollTo() {}, navigateTo() {}
}
const auth = await import(new URL('common/auth-store.js', base))
const invite = await import(new URL('common/invitation-state.js', base))
const options = { nodeEnv: 'development', apiBaseUrl: 'http://127.0.0.1:9999' }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const reset = () => { auth.clearAuthSession(); invite.clearPendingInvitation(); storage.clear(); calls.length = 0; handleLogin = loginNow }
async function component(path) {
  const source = await readFile(new URL(path, base), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import (\w+) from '[^']+\.vue'/g, 'const $1 = {}')
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, new URL(path, base)).href}'`)
  return (await import('data:text/javascript,' + encodeURIComponent(script))).default
}
function instance(definition) {
  const value = definition.data ? definition.data() : {}
  value.$refs = {}; value.$emit = () => {}
  for (const [name, fn] of Object.entries(definition.methods || {})) value[name] = fn.bind(value)
  for (const [name, fn] of Object.entries(definition.computed || {})) Object.defineProperty(value, name, { get: () => fn.call(value) })
  return value
}

test('P2-1: invalidated A login callback cannot send a candidate HTTP request or alter B', async () => {
  for (const bStatus of ['saved', 'saving', 'failed']) {
    reset()
    let delayedA, requestB
    handleLogin = options => { if (!delayedA) delayedA = options; else loginNow(options) }
    handleRequest = request => {
      assert(request.url.endsWith('/invitations/candidates'))
      if (request.data.token === 'B') {
        requestB = request
        if (bStatus === 'saved') response(request, { ok: true, candidateReceipt: 'receipt-B', expiresAt: future })
        if (bStatus === 'failed') request.fail({ errMsg: 'B network failure' })
      } else response(request, { ok: true, candidateReceipt: 'receipt-A', expiresAt: future })
    }
    const operationA = invite.receiveInvitation({ invitationToken: 'A' }, options)
    await flush()
    assert(delayedA)
    assert.equal(calls.length, 0, 'A still awaits wx.login')
    auth.clearAuthSession() // invalidates the existing operation epoch, including anonymous logout
    const operationB = invite.receiveInvitation({ invitationToken: 'B' }, options)
    if (bStatus === 'failed') await assert.rejects(operationB)
    else if (bStatus === 'saved') await operationB
    else await flush()
    const stateB = invite.invitationState()
    const storedB = structuredClone(storage.get('pictographic:pendingInvitation'))
    if (bStatus === 'saved') assert.equal(storedB.candidate.candidateReceipt, 'receipt-B')
    if (bStatus === 'saving') assert.equal(stateB.saving, true)
    if (bStatus === 'failed') assert(stateB.message)
    delayedA.success({ code: 'late-code-A' })
    await operationA
    assert.deepEqual(calls.map(request => request.data.token), ['B'], 'server must see B only, never stale A')
    assert.deepEqual(invite.invitationState(), stateB, 'old finally must preserve B saving/error/result state')
    assert.deepEqual(storage.get('pictographic:pendingInvitation'), storedB)
    if (bStatus === 'saving') {
      response(requestB, { ok: true, candidateReceipt: 'receipt-B', expiresAt: future })
      await operationB
      assert.equal(storage.get('pictographic:pendingInvitation').candidate.candidateReceipt, 'receipt-B')
    }
  }
  reset()
})

test('P2-2: actual mine phone-login success refreshes the card for the same user without leaving', async () => {
  reset()
  auth.saveAuthSession(session(false))
  handleRequest = request => {
    if (request.url.endsWith('/wechat-phone-login')) response(request, { ...session(true), invitation: { status: 'NO_REWARD', reason: 'CANDIDATE_MISSING' } })
    else if (request.url.endsWith('/invitations/summary')) response(request, summary)
    else if (request.url.endsWith('/entitlements')) response(request, { ok: true, quotaBalance: 30 })
    else if (request.url.endsWith('/favorites')) response(request, { ok: true, favorites: [] })
    else if (request.url.endsWith('/recent-words')) response(request, { ok: true, recentWords: [] })
    else if (request.url.endsWith('/share-credentials')) response(request, { ok: true, token: 'ivt1.p2-only', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 604800000).toISOString() })
    else throw new Error('Unexpected request: ' + request.url)
  }
  const cardDefinition = await component('components/InvitationCard.vue')
  const card = instance(cardDefinition)
  const mineDefinition = await component('pages/mine/index.vue')
  const mine = instance(mineDefinition)
  cardDefinition.mounted.call(card)
  await flush()
  assert.equal(card.registered, false)
  assert.equal(calls.filter(request => request.url.endsWith('/summary')).length, 0)
  let sessionNotifications = 0, nextTicks = 0
  const unsubscribe = auth.subscribeAuthSession(() => sessionNotifications++)
  // Model Vue mounting the ref at nextTick. The test never directly refreshes after registration.
  mine.$nextTick = async () => { nextTicks++; mine.$refs.invitationCard = card }
  try {
    await mine.handlePhoneLogin({ detail: { code: 'phone-authorization-code' } })
    assert.equal(auth.getAuthSession().user.id, 'p2-same-user')
    assert.equal(auth.getAuthSession().user.hasPhoneBinding, true)
    assert.equal(sessionNotifications, 0, 'same-user renewal notification policy stays unchanged')
    assert.equal(card.registered, true, 'parent success path must refresh the existing card immediately')
    assert(nextTicks > 0, 'parent waits for component availability')
    assert.deepEqual(card.summary, summary)
    assert.equal(calls.filter(request => request.url.endsWith('/summary')).length, 1)
    assert.equal(mine.authLoading, false)
    await card.prepare()
    assert.equal(card.shareReady, true, 'registered account can now prepare an invitation')
  } finally {
    unsubscribe(); cardDefinition.beforeDestroy.call(card); reset()
  }
})
