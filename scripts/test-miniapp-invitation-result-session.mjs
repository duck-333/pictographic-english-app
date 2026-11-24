import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const base = new URL('../miniapp-uni/word-app1/', import.meta.url)
const storage = new Map(), timers = new Map(), toasts = []
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout
globalThis.setTimeout = (callback, ms, ...args) => {
  if (ms !== 8000) return realSetTimeout(callback, ms, ...args)
  const timer = { callback }; timers.set(timer, callback); return timer
}
globalThis.clearTimeout = timer => { if (!timers.delete(timer)) realClearTimeout(timer) }
const session = (id = 'same-user') => ({ token: 'fixture-' + id, expiresAt: '2099-01-01T00:00:00Z', user: { id, hasWechatBinding: true, hasPhoneBinding: true } })
let holdPath = '', held = null, code = 0, summaries = 0
function respond(request) {
  let data = { ok: true }
  if (request.url.endsWith('/wechat-phone-login')) data = { ...session(), invitation: { status: 'REWARD_GRANTED' } }
  else if (request.url.endsWith('/summary')) { summaries++; Object.assign(data, { successfulInvitations: 0, totalRewardQuota: 0, pendingRewards: 0, remainingRewardSlots: 5, limitReached: false }) }
  else if (request.url.endsWith('/favorites')) data.favorites = []
  else if (request.url.endsWith('/recent-words')) data.recentWords = []
  else if (request.url.endsWith('/entitlements')) data.quotaBalance = 30
  else throw Error('Unexpected request ' + request.url)
  request.success({ statusCode: 200, data })
}
globalThis.uni = {
  getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
  login(options) { options.success({ code: 'fresh-fixture-' + (++code) }) },
  request(options) { if (holdPath && options.url.endsWith(holdPath)) held = options; else respond(options); return { abort() {} } },
  showToast(value) { toasts.push(value) }, pageScrollTo() {}
}
const auth = await import(new URL('common/auth-store.js', base))
async function component(path) {
  const source = await readFile(new URL(path, base), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import (\w+) from '[^']+\.vue'/g, 'const $1 = {}')
    .replace(/from '([^']+)'/g, (_, relative) => `from '${new URL(relative, new URL(path, base)).href}'`)
  return (await import('data:text/javascript,' + encodeURIComponent(script))).default
}
const mineDef = await component('pages/mine/index.vue'), cardDef = await component('components/InvitationCard.vue')
function instance(definition) {
  const page = { ...definition.data(), $refs: {}, $emit() {}, $nextTick: async () => {} }
  for (const [key, method] of Object.entries(definition.methods || {})) page[key] = method.bind(page)
  for (const [key, getter] of Object.entries(definition.computed || {})) Object.defineProperty(page, key, { get: () => getter.call(page) })
  return page
}
function setup() {
  auth.clearAuthSession(); storage.clear(); holdPath = ''; held = null; summaries = 0; toasts.length = 0; timers.clear()
  // Same-account phone binding change exercises the existing P2 refresh path.
  auth.saveAuthSession({ ...session(), user: { ...session().user, hasPhoneBinding: false } })
  const mine = instance(mineDef), card = instance(cardDef)
  mine.invitationNoticeActive = true; mine.$refs.invitationCard = card
  mineDef.onLoad?.call(mine)
  return { mine, card }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
async function waitHeld() { for (let i = 0; i < 20 && !held; i++) await flush(); assert(held, 'actual refresh request must be delayed') }
function dispose(mine) { mineDef.onUnload.call(mine); mineDef.beforeDestroy?.call(mine); auth.clearAuthSession(); for (const timer of timers.keys()) clearTimeout(timer) }

for (const path of ['/favorites', '/summary']) {
  for (const change of ['logout', 'switch', 'same-user-relogin']) {
    test(`actual phone login with delayed ${path}: ${change} invalidates old feedback and timer`, async () => {
      const { mine } = setup(); holdPath = path
      const operation = mine.handlePhoneLogin({ detail: { code: 'phone-fixture' } })
      try {
        await waitHeld()
        if (change === 'logout') mine.handleLogout()
        else {
          if (change === 'same-user-relogin') auth.clearAuthSession()
          auth.saveAuthSession(session(change === 'switch' ? 'new-user' : 'same-user'))
          // A newer session's visible result/timer must not be touched by the old task.
          mine.invitationResult = { title: 'new-session-only', description: 'new-result' }
          mine.invitationResultTimer = setTimeout(() => {}, 8000)
        }
        const expected = mine.invitationResult, expectedTimer = mine.invitationResultTimer
        const requestsBefore = summaries
        holdPath = ''; respond(held); await operation
        assert.equal(mine.invitationResult, expected, 'stale success must not overwrite or clear current feedback')
        assert.equal(mine.invitationResultTimer, expectedTimer, 'stale success must not replace or clear current timer')
        assert.equal(timers.size, change === 'logout' ? 0 : 1)
        assert(!toasts.some(t => t.title === '登录成功'), 'stale success must not show login toast either')
        if (path === '/summary') assert.equal(summaries, requestsBefore + 1)
      } finally { dispose(mine) }
    })
  }
}
test('normal result and card refresh work; external logout/switch immediately clears visible result and timer', async () => {
  for (const change of ['logout', 'switch']) {
    const { mine, card } = setup()
    try {
      await mine.handlePhoneLogin({ detail: { code: 'phone-fixture' } })
      assert.match(mine.invitationResult.title, /30次.*已到账/)
      assert.equal(card.registered, true); assert.equal(summaries, 1); assert.equal(timers.size, 1)
      if (change === 'logout') auth.clearAuthSession(); else auth.saveAuthSession(session('new-user'))
      assert.equal(mine.invitationResult, null); assert.equal(timers.size, 0)
    } finally { dispose(mine) }
  }
})
test('unload/destroy unsubscribe idempotently; hidden/unloaded page never resurrects delayed result', async () => {
  for (const hide of ['onHide', 'onUnload']) {
    const { mine } = setup(); holdPath = '/favorites'
    const operation = mine.handlePhoneLogin({ detail: { code: 'phone-fixture' } })
    try {
      await waitHeld(); mineDef[hide].call(mine); holdPath = ''; respond(held); await operation
      assert.equal(mine.invitationResult, null); assert.equal(timers.size, 0)
      mineDef.onUnload.call(mine); mineDef.beforeDestroy?.call(mine)
      let callbacks = 0; mine.dismissInvitationResult = () => { callbacks++ }
      auth.clearAuthSession(); assert.equal(callbacks, 0, 'destroyed page must receive no auth callback')
    } finally { dispose(mine) }
  }
})
