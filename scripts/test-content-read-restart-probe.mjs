import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'

const [database, time] = process.argv.slice(2)
assert.match(database || '', /^content_read_local_[a-f0-9]{12}$/)
assert(Number.isSafeInteger(Number(time)))
const pool = mysql.createPool({ host: '127.0.0.1', port: 3312, user: 'root', password: 'local-content-only', database })
try {
  const store = createUserEntitlementStore({ pool, now: () => new Date(Number(time)),
    contentReadPolicy: { windowMs: 60000, cooldownMs: 60000, maxDistinct: 3 } })
  const input = { userId: '8', rootLearningObjectId: 'restart-new', idempotencyKey: 'restart-new', protectContentRead: true }
  assert.equal((await store.consumeQuota(input)).reason, 'CONTENT_READ_COOLDOWN')
  assert.equal((await store.consumeQuota({ ...input, rootLearningObjectId: 'restart-a' })).allowed, true)
  console.log('PASS: real MySQL container restart retained cooldown and read-word records')
} finally { await pool.end() }
