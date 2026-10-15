import assert from 'node:assert/strict'
import { once } from 'node:events'
import { registerHooks } from 'node:module'
import { createLocalContentRateLimiter, getContentClientIp } from '../server/content-rate-limit.mjs'

// No database driver or credentials are needed. Any unexpected DB use fails.
let databaseAttempts = 0
globalThis.productionRateLimitUnexpectedDb = () => { databaseAttempts++; throw new Error('Unexpected database access') }
const driver = 'data:text/javascript,' + encodeURIComponent('export default {createPool(){return globalThis.productionRateLimitUnexpectedDb()},createConnection(){return globalThis.productionRateLimitUnexpectedDb()}}')
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'mysql2' || specifier === 'mysql2/promise'
    ? { url: driver, shortCircuit: true } : next(specifier, context)
} })
const { startServer } = await import('../server/index.mjs')
const { createUserSessionToken } = await import('../server/auth.mjs')
hooks.deregister()

const ip = (remoteAddress, real, forwarded) => getContentClientIp({
  socket: { remoteAddress }, headers: { 'x-real-ip': real, 'x-forwarded-for': forwarded }
})
for (const peer of ['127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
  assert.equal(ip(peer, '198.51.100.1', '203.0.113.9'), '198.51.100.1')
  for (const bad of [undefined, '', 'bad', '198.51.100.1, 198.51.100.2', ['198.51.100.1'], '198.51.100.1:80', 'fe80::1%eth0']) {
    assert.equal(ip(peer, bad, '203.0.113.9'), '127.0.0.1')
  }
}
for (const peer of ['203.0.113.8', '10.0.0.1', '127.0.0.2', '::1']) {
  assert.equal(ip(peer, '198.51.100.1', '198.51.100.2'), peer)
}
for (const peer of [undefined, '', 'invalid', 'fe80::1%eth0']) assert.equal(ip(peer, '198.51.100.1'), 'unknown-peer')
assert.equal(ip('127.0.0.1', '2001:0DB8:0:0:0:0:0:1'), '2001:db8::1')
assert.equal(ip('127.0.0.1', '::ffff:c633:6401'), '198.51.100.1')

// Exercise direct/unknown/invalid keys with changing forged headers.
const keyLimiter = createLocalContentRateLimiter({ now: () => 0, limits: { fullIp: { ratePerMinute: 60, capacity: 1 } } })
for (const peer of ['203.0.113.8', undefined, '127.0.0.1']) {
  const first = peer === '127.0.0.1' ? 'bad' : '198.51.100.10'
  const second = peer === '127.0.0.1' ? 'bad-again' : '198.51.100.11'
  assert.equal(keyLimiter.consume('fullIp', ip(peer, first)).allowed, true)
  assert.equal(keyLimiter.consume('fullIp', ip(peer, second)).allowed, false)
}
// Default policy and recovery assertions are independent of implementation constants.
for (const [group, capacity, recovery] of [['basicIp', 200, 50], ['fullIp', 100, 100], ['account', 10, 2000]]) {
  let tick = 0
  const limiter = createLocalContentRateLimiter({ now: () => tick })
  for (let i = 0; i < capacity; i++) assert.equal(limiter.consume(group, 'a').allowed, true)
  const denied = limiter.consume(group, 'a')
  assert.equal(denied.allowed, false)
  assert.equal(denied.retryAfter, Math.ceil(recovery / 1000))
  assert.equal(limiter.consume(group, 'b').allowed, true)
  assert.equal(createLocalContentRateLimiter({ now: () => 0 }).consume(group, 'a').allowed, true,
    'A new process-local instance does not share exhausted buckets')
  tick += recovery
  assert.equal(limiter.consume(group, 'a').allowed, true)
}
const bounded = createLocalContentRateLimiter({ maxEntries: 1, now: () => 0 })
bounded.consume('fullIp', 'a')
assert.deepEqual(bounded.consume('fullIp', 'b'), { allowed: false, retryAfter: 60 })

const secret = 'isolated-production-rate-limit-secret'
const word = { id: 'word-current', word: 'current', status: 'published', meaning: 'current meaning', explanation: 'full text', parts: [] }
const balances = new Map([['normal', 2], ['zero', 0], ['member', 0]])
const ledger = new Map()
let consumeCalls = 0
const options = {
  host: '127.0.0.1', port: '0', jwtSecret: secret,
  store: {
    async findWordDetailContext(id) { return { word: id === word.id ? word : null, featuredWordId: word.id } },
    async resolveHomepageFeaturedWord() { return { word, source: 'manual' } }
  },
  userStore: { async findUserProfileById(id) { return balances.has(id) ? { id } : null } },
  userEntitlementStore: { async consumeQuota(input) { consumeCalls++; ledger.set(input.idempotencyKey, input); throw new Error('Free word must not consume quota') } }
}
const servers = []
const previousEnv = process.env.NODE_ENV
const originalDateNow = Date.now
const fixedTime = Date.now()
Date.now = () => fixedTime
process.env.NODE_ENV = 'production'
async function open(extra = {}) {
  const server = startServer({ ...options, ...extra })
  servers.push(server)
  await once(server, 'listening')
  return server
}
async function detail(server, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/words/${word.id}`, {
    headers: { 'X-Client-Request-Id': 'production-visit', ...headers }
  })
  const body = await response.json()
  assert.match(response.headers.get('cache-control'), /no-store/)
  return { response, body }
}
try {
  // No nodeEnv option and no injected limiter: actual NODE_ENV=production path.
  const server = await open()
  for (const user of ['', 'normal', 'zero', 'member']) {
    const token = user ? createUserSessionToken(user, { jwtSecret: secret }).token : ''
    const result = await detail(server, { 'X-Real-IP': '198.51.100.1', ...(token ? { Authorization: `Bearer ${token}` } : {}) })
    assert.equal(result.response.status, 200)
    assert.equal(result.body.access.reason, 'FEATURED_WORD_FREE')
    assert.equal(result.body.access.canAccessFull, true)
    assert.equal(result.body.access.charged, false)
    assert.equal(result.body.access.chargeAmount, 0)
  }
  assert.equal(consumeCalls, 0); assert.equal(ledger.size, 0); assert.equal(balances.get('normal'), 2)
  const invalid = await detail(server, { Authorization: 'Bearer invalid' })
  assert.ok([401, 403].includes(invalid.response.status))
  const missing = await detail(server, { 'X-Client-Request-Id': '' })
  assert.equal(missing.response.status, 400)
  // Exhaust the unchanged default anonymous full-IP capacity through real HTTP.
  for (let i = 0; i < 100; i++) assert.equal((await detail(server, { 'X-Real-IP': '198.51.100.2' })).response.status, 200)
  const blocked = await detail(server, { 'X-Real-IP': '::ffff:c633:6402', 'X-Forwarded-For': '198.51.100.99' })
  assert.equal(blocked.response.status, 429)
  assert.ok(Number(blocked.response.headers.get('retry-after')) >= 1)
  assert.equal((await detail(server, { 'X-Real-IP': '198.51.100.3' })).response.status, 200)

  const injectedCalls = []
  const injected = await open({ contentRateLimiter: { consume(group, key) { injectedCalls.push([group, key]); return { allowed: false, retryAfter: 17 } } } })
  const denied = await detail(injected, { 'X-Real-IP': '198.51.100.4' })
  assert.equal(denied.response.status, 429)
  assert.equal(denied.response.headers.get('retry-after'), '17')
  assert.deepEqual(injectedCalls, [['basicIp', '198.51.100.4']])
  for (const headers of [
    { 'X-Real-IP': 'invalid', 'X-Forwarded-For': '198.51.100.90' },
    { 'X-Real-IP': '198.51.100.1, 198.51.100.2' },
    { 'X-Forwarded-For': '198.51.100.91' }
  ]) assert.equal((await detail(injected, headers)).response.status, 429)
  assert.deepEqual(injectedCalls.slice(1), Array(3).fill(['basicIp', '127.0.0.1']))
  assert.equal(consumeCalls, 0); assert.equal(ledger.size, 0)
  assert.equal(databaseAttempts, 0)
  console.log('Production startServer: default limiter, free user matrix/zero ledger, explicit adapter, IP isolation/429, proxy and forged headers passed; no DB access.')
} finally {
  for (const server of servers) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (previousEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousEnv
  Date.now = originalDateNow
  delete globalThis.productionRateLimitUnexpectedDb
}
