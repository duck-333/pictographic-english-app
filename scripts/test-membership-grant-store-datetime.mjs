import assert from 'node:assert/strict'

import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'

const USER_ID = '42'
const NOW = new Date('2026-08-05T02:27:58.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function cloneState(value) {
  return structuredClone(value)
}

function createFakeMembershipDatabase() {
  let committed = {
    entitlement: {
      id: 1,
      user_id: USER_ID,
      quota_balance: 9,
      quota_total_granted: 30,
      quota_total_consumed: 21,
      quota_total_expired: 0,
      membership_type: 'none',
      membership_status: 'none',
      membership_started_at: null,
      membership_expire_at: null,
      last_transaction_id: null,
      created_at: NOW,
      updated_at: NOW
    },
    grants: [],
    transactions: []
  }
  let working = null
  let corruptGrantListAtCount = null
  const membershipStartedAtSqlValues = []

  function activeState() {
    return working || committed
  }

  function membershipGrantRow(grant) {
    return {
      ...grant,
      granted_at: new Date(grant.granted_at).toISOString(),
      effective_start_at: new Date(grant.effective_start_at).toISOString(),
      effective_end_at: new Date(grant.effective_end_at).toISOString()
    }
  }

  const connection = {
    async beginTransaction() {
      working = cloneState(committed)
    },
    async commit() {
      committed = working
      working = null
    },
    async rollback() {
      working = null
    },
    release() {},
    async execute(sql, params = []) {
      const compactSql = String(sql).replace(/\s+/g, ' ').trim()
      const state = activeState()

      if (compactSql.startsWith('INSERT INTO `user_entitlements`')) {
        return [{ affectedRows: 1 }]
      }
      if (compactSql.startsWith('SELECT id, user_id, quota_balance')) {
        return [[{ ...state.entitlement }]]
      }
      if (compactSql.includes('FROM `membership_grants`') && compactSql.includes('WHERE idempotency_key = ?')) {
        const match = state.grants.find((grant) => grant.idempotency_key === params[0])
        return [match ? [membershipGrantRow(match)] : []]
      }
      if (compactSql.includes('FROM `membership_grants`') && compactSql.includes('WHERE source_type = ? AND source_id = ?')) {
        const match = state.grants.find((grant) => grant.source_type === params[0] && grant.source_id === params[1])
        return [match ? [membershipGrantRow(match)] : []]
      }
      if (compactSql.includes('FROM `membership_grants`') && compactSql.includes('WHERE user_id = ?')) {
        const rows = state.grants
          .filter((grant) => grant.user_id === String(params[0]))
          .sort((left, right) => new Date(left.granted_at) - new Date(right.granted_at) || Number(left.id) - Number(right.id))
          .map(membershipGrantRow)
        if (corruptGrantListAtCount !== null && state.grants.length >= corruptGrantListAtCount && rows.length) {
          rows[0].effective_start_at = 'not-a-valid-membership-start'
        }
        return [rows]
      }
      if (compactSql.includes('FROM `entitlement_transactions`') && compactSql.includes('WHERE idempotency_key = ?')) {
        const match = state.transactions.find((transaction) => transaction.idempotency_key === params[0])
        return [match ? [{ ...match }] : []]
      }
      if (compactSql.startsWith('INSERT INTO `membership_grants`')) {
        const id = state.grants.length + 1
        state.grants.push({
          id,
          user_id: String(params[0]),
          source_type: params[1],
          source_id: params[2],
          redemption_code_id: params[3],
          days_granted: params[4],
          duration_seconds: params[5],
          status: params[6],
          granted_at: params[7],
          effective_start_at: params[8],
          effective_end_at: params[9],
          consumed_seconds_at_revoke: 0,
          revoked_seconds: 0,
          revoked_at: null,
          revoked_by: null,
          revoke_reason: null,
          idempotency_key: params[10],
          grant_transaction_id: params[11],
          revoke_transaction_id: params[12],
          created_at: NOW,
          updated_at: NOW
        })
        return [{ insertId: id, affectedRows: 1 }]
      }
      if (compactSql.startsWith('INSERT INTO `entitlement_transactions`')) {
        const id = state.transactions.length + 1
        state.transactions.push({
          id,
          transaction_id: params[0],
          user_id: String(params[1]),
          transaction_type: params[2],
          amount: params[3],
          balance_after: params[4],
          source: params[5],
          source_id: params[6],
          expires_at: params[7],
          grant_transaction_id: params[8],
          root_learning_object_id: params[9],
          current_learning_object_id: params[10],
          access_context_json: params[11],
          idempotency_key: params[12],
          operator_type: params[13],
          operator_id: params[14],
          reason: params[15],
          metadata_json: params[16],
          created_at: NOW
        })
        return [{ insertId: id, affectedRows: 1 }]
      }
      if (compactSql.startsWith('UPDATE `membership_grants` SET grant_transaction_id = ?')) {
        const grant = state.grants.find((item) => String(item.id) === String(params[1]))
        if (grant) grant.grant_transaction_id = params[0]
        return [{ affectedRows: grant ? 1 : 0 }]
      }
      if (compactSql.startsWith('UPDATE `user_entitlements` SET membership_type = ?')) {
        membershipStartedAtSqlValues.push(params[2])
        assert(params[2] instanceof Date, 'membership_started_at must be sent to mysql2 as Date')
        assert(Number.isFinite(params[2].getTime()), 'membership_started_at Date must be valid')
        assert(params[3] instanceof Date, 'membership_expire_at must be sent to mysql2 as Date')
        state.entitlement = {
          ...state.entitlement,
          membership_type: params[0],
          membership_status: params[1],
          membership_started_at: params[2],
          membership_expire_at: params[3],
          last_transaction_id: params[4]
        }
        return [{ affectedRows: 1 }]
      }

      throw new Error(`Unexpected SQL in membership datetime test: ${compactSql}`)
    }
  }

  return {
    pool: {
      async getConnection() {
        return connection
      }
    },
    snapshot() {
      return cloneState(committed)
    },
    membershipStartedAtSqlValues,
    corruptGrantStartWhenGrantCountReaches(count) {
      corruptGrantListAtCount = count
    }
  }
}

function grantInput(operationId) {
  return {
    userId: USER_ID,
    sourceType: 'admin_gift',
    sourceId: `admin_membership_gift:${operationId}`,
    idempotencyKey: `admin_membership_grant:${operationId}`,
    transactionId: `membership-transaction-${operationId}`,
    operatorType: 'admin',
    operatorId: 'datetime-regression-test',
    reason: 'Membership DATETIME regression test.',
    now: NOW
  }
}

const fakeDatabase = createFakeMembershipDatabase()
const store = createUserEntitlementStore({ pool: fakeDatabase.pool, now: () => new Date(NOW) })

const first = await store.grantMembershipDuration(grantInput('operation-1'))
let snapshot = fakeDatabase.snapshot()
assert.equal(first.idempotent, false)
assert.equal(new Date(first.membershipExpireAt).getTime(), NOW.getTime() + 30 * DAY_MS)
assert.equal(snapshot.grants.length, 1)
assert.equal(snapshot.transactions.length, 1)
assert.equal(snapshot.entitlement.quota_balance, 9)
assert.equal(fakeDatabase.membershipStartedAtSqlValues[0].toISOString(), NOW.toISOString())

const second = await store.grantMembershipDuration(grantInput('operation-2'))
snapshot = fakeDatabase.snapshot()
assert.equal(second.idempotent, false)
assert.equal(new Date(second.effectiveStartAt).getTime(), NOW.getTime() + 30 * DAY_MS)
assert.equal(new Date(second.membershipExpireAt).getTime(), NOW.getTime() + 60 * DAY_MS)
assert.equal(snapshot.grants.length, 2)
assert.equal(snapshot.transactions.length, 2)
assert.equal(snapshot.entitlement.quota_balance, 9)
assert.equal(fakeDatabase.membershipStartedAtSqlValues[1].toISOString(), NOW.toISOString())

const retry = await store.grantMembershipDuration(grantInput('operation-1'))
snapshot = fakeDatabase.snapshot()
assert.equal(retry.idempotent, true)
assert.equal(retry.grantId, first.grantId)
assert.equal(snapshot.grants.length, 2)
assert.equal(snapshot.transactions.length, 2)
assert.equal(snapshot.entitlement.quota_balance, 9)

fakeDatabase.corruptGrantStartWhenGrantCountReaches(3)
await assert.rejects(
  store.grantMembershipDuration(grantInput('operation-invalid-start')),
  (error) => error && error.code === 'MEMBERSHIP_STARTED_AT_INVALID'
)
snapshot = fakeDatabase.snapshot()
assert.equal(snapshot.grants.length, 2)
assert.equal(snapshot.transactions.length, 2)
assert.equal(snapshot.entitlement.quota_balance, 9)
assert.equal(new Date(snapshot.entitlement.membership_expire_at).getTime(), NOW.getTime() + 60 * DAY_MS)

console.log('membership grant mysql DATETIME regression tests passed')
