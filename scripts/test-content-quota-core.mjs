import assert from 'node:assert/strict'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'

// Runs the unchanged consumeQuota implementation against a strict in-memory SQL
// adapter. No driver connection or production environment configuration is used.
const entitlement = {
  id: 1, user_id: '42', quota_balance: 1, quota_total_granted: 1,
  quota_total_consumed: 0, quota_total_expired: 0,
  membership_type: 'none', membership_status: 'none'
}
const transactions = new Map()
let inserts = 0
const connection = {
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  async execute(raw, params) {
    const sql = raw.replace(/\s+/g, ' ').trim()
    if (sql.startsWith('SELECT') && sql.includes('WHERE idempotency_key = ?')) {
      return [[transactions.get(params[0])].filter(Boolean), []]
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM `user_entitlements`')) return [[{ ...entitlement }], []]
    if (sql.startsWith('SELECT id, transaction_id, transaction_type, amount, expires_at')) {
      if (sql.includes('expires_at <= ?')) return [[], []]
      return [[{ id: 1, transaction_id: 'grant-1', transaction_type: 'REGISTER_BONUS', amount: 1, expires_at: '2099-01-01T00:00:00Z' }], []]
    }
    if (sql.startsWith('SELECT grant_transaction_id')) return [[], []]
    if (sql.startsWith('INSERT INTO `entitlement_transactions`')) {
      const fields = ['transaction_id', 'user_id', 'transaction_type', 'amount', 'balance_after', 'source', 'source_id',
        'expires_at', 'grant_transaction_id', 'root_learning_object_id', 'current_learning_object_id',
        'access_context_json', 'idempotency_key', 'operator_type', 'operator_id', 'reason', 'metadata_json']
      const row = { id: ++inserts }
      fields.forEach((field, index) => { row[field] = params[index] })
      assert.equal(transactions.has(row.idempotency_key), false)
      transactions.set(row.idempotency_key, row)
      return [{ insertId: row.id, affectedRows: 1 }, []]
    }
    if (sql.startsWith('UPDATE `user_entitlements`')) {
      entitlement.quota_balance = params[0]
      entitlement.quota_total_consumed += params[1]
      entitlement.last_transaction_id = params[2]
      return [{ affectedRows: 1 }, []]
    }
    throw new Error(`Unexpected SQL in local quota adapter: ${sql}`)
  }
}
const store = createUserEntitlementStore({ pool: { async getConnection() { return connection } } })
const input = { userId: '42', amount: 1, rootLearningObjectId: 'word-test', currentLearningObjectId: 'word-test', idempotencyKey: 'access-1' }
const first = await store.consumeQuota(input)
assert.equal(first.allowed, true)
assert.equal(first.remainingQuota, 0)
assert.equal(first.idempotent, false)
assert.equal(entitlement.quota_balance, 0)
assert.equal(inserts, 1)
const replay = await store.consumeQuota(input)
assert.equal(replay.allowed, true)
assert.equal(replay.idempotent, true)
assert.equal(inserts, 1)
const next = await store.consumeQuota({ ...input, idempotencyKey: 'access-2' })
assert.equal(next.allowed, false)
assert.equal(inserts, 1)
entitlement.membership_type = 'monthly'
entitlement.membership_status = 'active'
entitlement.membership_expire_at = '2099-01-01T00:00:00Z'
const member = await store.consumeQuota({ ...input, idempotencyKey: 'member-access' })
assert.equal(member.allowed, true)
assert.equal(member.reason, 'membership_active')
assert.equal(inserts, 1)
console.log('Unchanged consumeQuota: last unit 1->0, same-ID replay, new-ID denial, membership no debit passed (strict fake SQL; no real MySQL).')
