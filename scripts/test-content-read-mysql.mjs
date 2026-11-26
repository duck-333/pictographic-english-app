import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'
import { startServer } from '../server/index.mjs'
import { createUserSessionToken } from '../server/auth.mjs'
import { createLocalContentRateLimiter } from '../server/content-rate-limit.mjs'
import { cleanupContentReads, CONTENT_READ_POLICY } from '../server/content-read-guard.mjs'

// Only the dedicated disposable local container; no env/production fallback.
const config = { host: '127.0.0.1', port: 3312, user: 'root', password: 'local-content-only', database: 'content_read_local_' + randomBytes(6).toString('hex') }
let pool = mysql.createPool({ ...config, connectionLimit: 12, multipleStatements: true })
let clock = Date.parse('2026-11-26T00:00:00Z')
let store = createUserEntitlementStore({ pool, now: () => new Date(clock) })
let server
const count = async (user) => Number((await pool.execute('SELECT COUNT(*) AS n FROM content_read_words WHERE user_id = ?', [user]))[0][0].n)
const consume = (userId, word, key = word) => store.consumeQuota({ userId: String(userId), rootLearningObjectId: word,
  idempotencyKey: `read:${userId}:${key}`, protectContentRead: true })
try {
  const setup = await mysql.createConnection({ ...config, database: undefined })
  await setup.query(`CREATE DATABASE \`${config.database}\``)
  await setup.end()
  for (const name of ['004_create_user_entitlements.sql', '005_create_entitlement_transactions.sql', '006_create_membership_grants.sql', '012_create_content_read_guard.sql']) {
    await pool.query(await readFile(new URL('../database/migrations/' + name, import.meta.url), 'utf8'))
  }
  // Run twice: DDL is repeatable, using real MySQL, not a substitute store.
  await pool.query(await readFile(new URL('../server/migrations/012_create_content_read_guard.sql', import.meta.url), 'utf8'))
  for (const user of [1, 2, 3, 4, 5, 6, 7, 8]) await store.ensureUserEntitlement(String(user))
  await pool.execute("UPDATE user_entitlements SET membership_type='monthly', membership_status='active', membership_expire_at='2027-12-01' WHERE user_id IN (1,2,3,4,6,7,8)")
  const short = createLocalContentRateLimiter({ now: () => clock })
  for (let i = 0; i < 360; i++) {
    assert.equal(short.consume('account', '1').allowed, true)
    assert.equal((await consume(1, `word-${i}`)).allowed, true)
    clock += 3000 // 20/min, below original 30/min.
  }
  assert.equal(await count(1), 360)
  console.log('PASS: default 360-word window at 20 requests/minute')
  assert.equal((await consume(1, 'word-0', 'review')).allowed, true)
  assert.equal(await count(1), 360)
  const denied = await consume(1, 'word-360')
  assert.equal(denied.reason, 'CONTENT_READ_COOLDOWN')
  assert.equal(denied.retryAfter, 21600)
  assert.equal((await consume(1, 'word-360')).allowed, false)
  assert.equal((await consume(2, 'word-360')).allowed, true)
  assert.equal((await consume(1, 'word-0', 'review2')).allowed, true)

  // Fresh pool/store simulates application restart; database records survive.
  await pool.end()
  pool = mysql.createPool({ ...config, connectionLimit: 12 })
  store = createUserEntitlementStore({ pool, now: () => new Date(clock) })
  assert.equal((await consume(1, 'word-361')).allowed, false)
  clock += CONTENT_READ_POLICY.cooldownMs - 1
  assert.equal((await consume(1, 'word-361')).allowed, false)
  clock++
  assert.equal((await consume(1, 'word-361')).allowed, true)
  assert.equal(await count(1), 1)

  // Accelerated thresholds for boundary/concurrency; production defaults above.
  const tiny = { windowMs: 60000, maxDistinct: 3, cooldownMs: 60000 }
  store = createUserEntitlementStore({ pool, now: () => new Date(clock), contentReadPolicy: tiny })
  const same = await Promise.all(Array.from({ length: 8 }, () => consume(3, 'same')))
  assert(same.every(x => x.allowed)); assert.equal(await count(3), 1)
  const race = await Promise.all(Array.from({ length: 8 }, (_, i) => consume(3, `race-${i}`)))
  assert.equal(race.filter(x => x.allowed).length, 2)
  assert.equal(await count(3), 3)
  assert.equal((await consume(5, 'no-quota')).allowed, false)
  assert.equal(await count(5), 0)
  await store.ensureRegistrationBonus('5')
  assert.equal((await store.getUserEntitlement('5')).quotaBalance, 30)
  const paidRace = await Promise.all(Array.from({ length: 8 }, () => consume(5, 'paid', 'same-retry')))
  assert(paidRace.every(x => x.allowed)); assert.equal(await count(5), 1)
  assert.equal((await store.getUserEntitlement('5')).quotaBalance, 29)
  await consume(5, 'paid2'); await consume(5, 'paid3')
  assert.equal((await consume(5, 'paid4')).reason, 'CONTENT_READ_COOLDOWN')
  assert.equal((await store.getUserEntitlement('5')).quotaBalance, 27)

  for (const user of ['9', '10']) await store.ensureRegistrationBonus(user)
  const separateAccounts = await Promise.all([consume(9, 'parallel-paid'), consume(10, 'parallel-paid')])
  assert(separateAccounts.every(result => result.allowed))
  assert.equal(await count(9), 1); assert.equal(await count(10), 1)
  // Actual database error after recording must roll back both record and debit.
  await pool.query(`CREATE TRIGGER content_read_test_failure BEFORE INSERT ON entitlement_transactions
    FOR EACH ROW BEGIN IF NEW.user_id = 9 AND NEW.transaction_type = 'CONTENT_ACCESS' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated injected write failure'; END IF; END`)
  await assert.rejects(() => consume(9, 'rollback-word'), /isolated injected write failure/)
  assert.equal(await count(9), 1)
  assert.equal((await store.getUserEntitlement('9')).quotaBalance, 29)
  await pool.query('DROP TRIGGER content_read_test_failure')
  assert.equal((await consume(5, 'paid', 'same-retry')).idempotent, true)
  assert.equal((await store.getUserEntitlement('5')).quotaBalance, 27)

  // HTTP uses real entitlement store/DB, synthetic published vocabulary/profile only.
  const secret = 'local-content-read-test'
  const words = new Map(Array.from({ length: 8 }, (_, i) => [`w${i}`, { id: `w${i}`, word: `w${i}`, status: 'published', explanation: 'PROTECTED_BODY', parts: [] }]))
  server = startServer({ host: '127.0.0.1', port: '0', jwtSecret: secret,
    store: { async findWordDetailContext(id) { return { word: words.get(id.toLowerCase()), featuredWordId: 'w0' } } },
    userStore: { async findUserProfileById(id) { return { id } } }, userEntitlementStore: store,
    contentRateLimiter: createLocalContentRateLimiter({ now: () => clock }), now: () => new Date(clock) })
  await once(server, 'listening')
  const request = async (id, user, visit = id, sessionSalt = 0) => {
    const token = user ? createUserSessionToken(String(user), { jwtSecret: secret, now: () => new Date(clock + sessionSalt * 1000) }).token : ''
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/words/${id}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Client-Request-Id': visit, 'X-Real-IP': `198.51.100.${sessionSalt + 1}` }
    })
    return { status: response.status, headers: response.headers, body: await response.json() }
  }
  for (const id of ['w1', 'W1', 'w2', 'w3']) { clock += 3000; assert.equal((await request(id, 6)).status, 200) }
  assert.equal(await count(6), 3)
  const blocked = await request('w4', 6, 'new-session', 1)
  assert.equal(blocked.status, 429); assert.equal(blocked.body.code, 'CONTENT_READ_COOLDOWN')
  assert.equal(JSON.stringify(blocked.body).includes('PROTECTED_BODY'), false)
  assert.equal(blocked.headers.get('retry-after'), '60')
  assert.match(blocked.headers.get('cache-control'), /no-store/)
  assert.equal((await request('w1', 6, 'review', 2)).status, 200)
  assert.equal((await request('missing', 6)).status, 404); assert.equal(await count(6), 3)
  assert.equal((await request('w1')).body.access.reason, 'LOGIN_REQUIRED')
  for (const user of [undefined, 5, 6]) {
    const free = await request('w0', user)
    assert.equal(free.body.access.reason, 'FEATURED_WORD_FREE'); assert.equal(free.body.access.charged, false)
  }
  assert.equal((await request('w5', 7)).status, 200)
  // Persist a known cooldown for a follow-up real container restart probe.
  for (const id of ['a','b','c']) await consume(8, id)
  assert.equal((await consume(8, 'd')).allowed, false)
  clock += 60000
  const cleaned = await cleanupContentReads(pool, { nowMs: clock, policy: tiny })
  assert(cleaned.words > 0); assert(cleaned.cooldowns > 0)
  assert.equal(await count(3), 0)
  assert.equal((await consume(3, 'recovered')).allowed, true)
  for (const id of ['restart-a','restart-b','restart-c']) await consume(8, id)
  assert.equal((await consume(8, 'restart-d')).allowed, false)
  console.log('Restart probe database:', config.database, 'clock:', clock)
  console.log('PASS: real MySQL migrations, default 360/6h below short rate, review dedup, account isolation, pool restart, expiry boundary, concurrent new words/retries, registration 30/quota idempotency/no-charge denial, HTTP sessions/aliases/no-body/featured/anonymous/short limit compatibility, cleanup.')
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  await pool.end()
}
