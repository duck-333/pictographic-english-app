import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createApiHandler } from '../server/index.mjs'
import { createUserSessionToken } from '../server/auth.mjs'
import { toBasicWord } from '../server/word-access-policy.mjs'
import { createLocalContentRateLimiter, getDirectPeerIp } from '../server/content-rate-limit.mjs'

const fixture = {
  id: 'word-audit', word: 'audit', status: 'published', basicMeaning: '核查', meaning: 'private long meaning',
  image: 'https://example.org/public-cover.png', intro: 'private intro',
  parts: [{ text: 'private part' }], pictograph: 'private imagery',
  illustrationImage: { url: 'https://example.org/private-image.png', alt: 'private caption' }
}
const basic = toBasicWord(fixture, { canAccessFull: true, charged: true })
assert.equal(basic.meaning, '核查')
assert.equal(basic.image, fixture.image)
assert.equal(basic.access.canAccessFull, false)
assert.equal(basic.access.charged, false)
for (const key of ['parts', 'pictograph', 'intro', 'illustrationImage']) assert.equal(Object.hasOwn(basic, key), false)
assert.equal(getDirectPeerIp({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4' } }), '127.0.0.1')

let milliseconds = 0
const limiter = createLocalContentRateLimiter({ now: () => milliseconds, limits: {
  account: { ratePerMinute: 60, capacity: 1 }
} })
let balance = 1
let calls = 0
let member = false
let failLookup = false
let saveMode = 'success'
const ledger = new Map()
// In-memory HTTP adapter verifies admission order and client request binding.
// This deliberately does not claim to validate real MySQL locking.
const entitlementStore = {
  async consumeQuota(input) {
    calls += 1
    if (ledger.has(input.idempotencyKey)) return { allowed: true, reason: 'quota_consumed', remainingQuota: 0, idempotent: true }
    if (member) return { allowed: true, reason: 'membership_active', remainingQuota: balance }
    if (!balance) return { allowed: false, remainingQuota: 0 }
    balance -= 1
    ledger.set(input.idempotencyKey, input)
    return { allowed: true, reason: 'quota_consumed', remainingQuota: balance }
  }
}
const secret = 'local-content-security-fixture-secret'
const token = createUserSessionToken('42', { jwtSecret: secret }).token
const server = http.createServer(createApiHandler({
  store: {
    async findWordById(id) { if (failLookup) throw new Error('fixture failure'); return id === fixture.id ? fixture : null },
    async findWordDetailContext(id) { return { word: await this.findWordById(id), featuredWordId: null } },
    async listWords() { return [fixture] },
    async saveWord() {
      if (saveMode === 'throw') throw new Error('save fixture failure')
      return { ok: saveMode === 'success', word: fixture, errors: [] }
    },
    async resolveHomepageFeaturedWord() { return { word: fixture, config: {}, source: 'fixture' } },
    async saveHomepageFeaturedConfig() { return { ok: saveMode === 'success', config: {}, errors: [] } }
  },
  userStore: { async findUserProfileById() { return { id: '42' } } },
  userEntitlementStore: entitlementStore,
  jwtSecret: secret, adminApiToken: 'local-admin-fixture', contentRateLimiter: limiter
}))
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
async function detail({ requestId = 'access-1', auth = token, id = fixture.id } = {}) {
  const response = await fetch(`${base}/api/words/${id}`, { headers: {
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'X-Client-Request-Id': requestId
  } })
  assert.match(response.headers.get('cache-control'), /no-store/)
  return { response, body: await response.json() }
}
try {
  const anonymous = await detail({ auth: '' })
  assert.equal(anonymous.body.word.access.canAccessFull, false)
  assert.equal(calls, 0)
  assert.ok([401, 403].includes((await detail({ auth: 'invalid' })).response.status))
  assert.equal(calls, 0)
  assert.equal((await detail({ id: 'missing' })).response.status, 404)
  const first = await detail()
  assert.equal(first.body.word.access.canAccessFull, true)
  assert.equal(first.body.remainingQuota, 0)
  assert.equal(balance, 0)
  assert.equal(ledger.size, 1)
  const blocked = await detail()
  assert.equal(blocked.response.status, 429)
  assert.equal(blocked.response.headers.get('retry-after'), '1')
  assert.equal(calls, 1)
  // Treat the first response as lost; retry the same access after rate recovery.
  milliseconds += 1000
  const replay = await detail()
  assert.equal(replay.body.word.access.canAccessFull, true)
  assert.equal(ledger.size, 1)
  milliseconds += 1000
  const exhausted = await detail({ requestId: 'access-2' })
  assert.equal(exhausted.body.word.access.canAccessFull, false)
  assert.equal(exhausted.body.code, 'QUOTA_INSUFFICIENT')
  assert.equal(ledger.size, 1)
  milliseconds += 1000
  member = true
  assert.equal((await detail({ requestId: 'member-1' })).body.word.access.canAccessFull, true)
  assert.equal(balance, 0)
  assert.equal(ledger.size, 1)
  failLookup = true
  assert.equal((await detail()).response.status, 500)
  const adminDenied = await fetch(`${base}/api/admin/words`)
  assert.match(adminDenied.headers.get('cache-control'), /no-store/)
  assert.equal(adminDenied.status, 401)
  const admin = await fetch(`${base}/api/admin/words`, { headers: { Authorization: 'Bearer local-admin-fixture' } })
  assert.match(admin.headers.get('cache-control'), /no-store/)
  assert.equal((await admin.json()).words[0].pictograph, fixture.pictograph)
  for (const mode of ['success', 'invalid', 'throw']) {
    saveMode = mode
    const saved = await fetch(`${base}/api/admin/words`, {
      method: 'POST', headers: { Authorization: 'Bearer local-admin-fixture', 'Content-Type': 'application/json' }, body: '{}'
    })
    assert.equal(saved.status, mode === 'success' ? 200 : mode === 'invalid' ? 400 : 500)
    assert.match(saved.headers.get('cache-control'), /no-store/)
    await saved.json()
  }
  for (const method of ['GET', 'POST']) {
    for (const authorized of [false, true]) {
      saveMode = 'success'
      const featured = await fetch(`${base}/api/admin/homepage-featured`, {
        method, headers: { ...(authorized ? { Authorization: 'Bearer local-admin-fixture' } : {}), 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {})
      })
      assert.equal(featured.status, authorized ? 200 : 401)
      assert.match(featured.headers.get('cache-control'), /no-store/)
      await featured.json()
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve))
}

const ipLimiter = createLocalContentRateLimiter({ limits: { fullIp: { ratePerMinute: 60, capacity: 1 } } })
assert.equal(ipLimiter.consume('fullIp', 'same-nat').allowed, true)
assert.equal(ipLimiter.consume('fullIp', 'same-nat').allowed, false)
assert.equal(ipLimiter.consume('fullIp', 'other-ip').allowed, true)
console.log('Content API security: field projection, no-store, authorization, last quota, replay, 429-before-consume, membership, peer IP passed (local fakes; no DB).')
