import assert from 'node:assert/strict'

import {
  hashBookBenefitRedemptionCode,
  normalizeBookBenefitRedemptionCode
} from '../server/book-benefit-code.mjs'
import { createBookBenefitStore } from '../server/book-benefit-store.mjs'

const NOW = new Date('2026-08-09T04:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const CODE = 'BF30-2345-6789-ABCD-EFGH'
const CODE_SECRET = 'fake-redemption-code-secret-for-stage-2b3c-tests'
const SECRET_ENV = {
  PHONE_HASH_SECRET: 'different-fake-phone-secret-32-bytes',
  JWT_SECRET: 'different-fake-jwt-secret-32-bytes',
  ADMIN_API_TOKEN: 'different-fake-admin-token-32-bytes',
  CAMPAIGN_PHONE_IDENTITY_HASH_SECRET: 'different-fake-campaign-secret-32-bytes',
  BOOK_ORDER_CLAIM_HASH_SECRET: 'different-fake-order-secret-32-bytes',
  WECHAT_MINIAPP_SECRET: 'different-fake-wechat-secret-32-bytes'
}
const CODE_HASH = hashBookBenefitRedemptionCode(CODE, {
  secret: CODE_SECRET,
  env: SECRET_ENV
}).codeHash

function clone(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Date) return new Date(value)
  if (value instanceof Map) return new Map(Array.from(value, ([key, item]) => [key, clone(item)]))
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
  }
  return value
}

function initialState(overrides = {}) {
  const state = {
    campaigns: [{ id: '11', status: 'ended', benefit_days: 30 }],
    issuances: [{ id: '21', campaign_id: '11', status: 'approved' }],
    codes: [{
      id: '31',
      issuance_id: '21',
      code_hash: Buffer.from(CODE_HASH),
      code_hash_version: 'v1',
      status: 'issued',
      expires_at: new Date(NOW.getTime() + DAY_MS),
      redeemed_at: null
    }],
    phoneBindings: [
      { user_id: '42', hash: Buffer.alloc(32, 42), version: 'v1' },
      { user_id: '43', hash: Buffer.alloc(32, 43), version: 'v1' }
    ],
    entitlement: new Map([
      ['42', {
        id: 1, user_id: '42', quota_balance: 9, quota_total_granted: 20,
        quota_total_consumed: 11, quota_total_expired: 0, membership_type: 'none',
        membership_status: 'none', membership_started_at: null, membership_expire_at: null,
        last_transaction_id: null, created_at: NOW, updated_at: NOW
      }],
      ['43', {
        id: 2, user_id: '43', quota_balance: 7, quota_total_granted: 10,
        quota_total_consumed: 3, quota_total_expired: 0, membership_type: 'none',
        membership_status: 'none', membership_started_at: null, membership_expire_at: null,
        last_transaction_id: null, created_at: NOW, updated_at: NOW
      }]
    ]),
    grants: [],
    transactions: [],
    redemptions: [],
    audits: []
  }
  Object.assign(state, overrides)
  return state
}

function createDatabase(options = {}) {
  let committed = clone(options.state || initialState())
  let nextConnectionId = 0
  let connectionCount = 0
  let locked = false
  const lockWaiters = []
  const events = []
  const sqlEvents = []

  async function acquireLock() {
    if (!locked) {
      locked = true
      return
    }
    await new Promise((resolve) => lockWaiters.push(resolve))
    locked = true
  }

  function releaseLock() {
    locked = false
    const waiter = lockWaiters.shift()
    if (waiter) waiter()
  }

  function operationFor(sql) {
    if (sql.includes('FROM book_benefit_redemptions') && sql.includes('WHERE idempotency_key = ?')) return 'findRedemptionByIdempotency'
    if (sql.includes('FROM book_benefit_codes c') && sql.includes('JOIN book_benefit_issuances')) return 'findCode'
    if (sql.includes('FROM `user_phone_bindings`') && sql.includes('campaign_phone_identity_hash')) return 'findIdentity'
    if (sql.includes('FROM book_benefit_redemptions') && sql.includes('WHERE code_id = ?')) return 'findRedemptionConflict'
    if (sql.startsWith('INSERT INTO book_benefit_redemptions')) return 'insertRedemption'
    if (sql.startsWith('UPDATE book_benefit_codes')) return 'updateCode'
    if (sql.startsWith('INSERT INTO book_benefit_audit_events')) return 'insertAudit'
    if (sql.startsWith('INSERT INTO `user_entitlements`')) return 'ensureEntitlement'
    if (sql.startsWith('SELECT id, user_id, quota_balance')) return 'selectEntitlement'
    if (sql.includes('FROM `membership_grants`') && sql.includes('WHERE idempotency_key = ?')) return 'selectGrantByIdempotency'
    if (sql.includes('FROM `membership_grants`') && sql.includes('WHERE source_type = ? AND source_id = ?')) return 'selectGrantBySource'
    if (sql.includes('FROM `membership_grants`') && sql.includes('WHERE user_id = ?')) return 'listGrants'
    if (sql.includes('FROM `entitlement_transactions`') && sql.includes('WHERE idempotency_key = ?')) return 'selectTransactionByIdempotency'
    if (sql.startsWith('INSERT INTO `membership_grants`')) return 'insertMembershipGrant'
    if (sql.startsWith('INSERT INTO `entitlement_transactions`')) return 'insertEntitlementTransaction'
    if (sql.startsWith('UPDATE `membership_grants` SET grant_transaction_id = ?')) return 'linkGrantTransaction'
    if (sql.startsWith('UPDATE `user_entitlements` SET membership_type = ?')) return 'updateEntitlementSnapshot'
    return 'unexpected'
  }

  function maybeFail(operation) {
    if (options.failure === operation) throw new Error(`injected ${operation} failure`)
  }

  function createConnection() {
    const label = `connection-${++nextConnectionId}`
    let working = null
    let released = false
    return {
      label,
      _state() {
        assert(working, 'transaction state is required')
        return working
      },
      async beginTransaction() {
        await acquireLock()
        working = clone(committed)
        events.push(`${label}:begin`)
      },
      async commit() {
        maybeFail('commit')
        committed = working
        working = null
        events.push(`${label}:commit`)
        releaseLock()
      },
      async rollback() {
        events.push(`${label}:rollback`)
        working = null
        releaseLock()
        if (options.failure === 'rollback') throw new Error('injected rollback failure')
      },
      release() {
        assert.equal(released, false, 'connection released more than once')
        released = true
        events.push(`${label}:release`)
        if (options.failure === 'release') throw new Error('injected release failure')
      },
      async execute(sql, params = []) {
        const compactSql = String(sql).replace(/\s+/g, ' ').trim()
        const operation = operationFor(compactSql)
        sqlEvents.push({ label, operation, sql: compactSql, params })
        maybeFail(operation)
        const state = working
        assert(state, 'all SQL must run inside a transaction')

        if (operation === 'findRedemptionByIdempotency') {
          const row = state.redemptions.find((item) => item.idempotency_key === params[0])
          return [row ? [{ ...row }] : []]
        }
        if (operation === 'findCode') {
          const code = state.codes.find((item) => Buffer.from(item.code_hash).equals(params[0]))
          if (!code) return [[]]
          const issuance = state.issuances.find((item) => item.id === code.issuance_id)
          const campaign = issuance && state.campaigns.find((item) => item.id === issuance.campaign_id)
          return [[{
            code_id: code.id,
            code_issuance_id: code.issuance_id,
            code_status: code.status,
            expires_at: code.expires_at,
            issuance_id: issuance ? issuance.id : null,
            campaign_id: issuance ? issuance.campaign_id : null,
            issuance_status: issuance ? issuance.status : null,
            campaign_record_id: campaign ? campaign.id : null,
            benefit_days: campaign ? campaign.benefit_days : null
          }]]
        }
        if (operation === 'findIdentity') {
          const binding = state.phoneBindings.find((item) => item.user_id === String(params[0]))
          return [binding ? [{
            campaign_phone_identity_hash: binding.hash,
            campaign_phone_hash_version: binding.version
          }] : []]
        }
        if (operation === 'findRedemptionConflict') {
          const [codeId, campaignForUser, userId, campaignForPhone, phoneHash] = params
          const row = state.redemptions.find((item) =>
            item.code_id === String(codeId) ||
            (item.campaign_id === String(campaignForUser) && item.redeemer_user_id === String(userId)) ||
            (item.campaign_id === String(campaignForPhone) && Buffer.from(item.redeemer_phone_identity_hash).equals(phoneHash))
          )
          return [row ? [{ id: row.id, code_id: row.code_id, redeemer_user_id: row.redeemer_user_id }] : []]
        }
        if (operation === 'insertRedemption') {
          const [redemptionId, codeId, campaignId, issuanceId, userId, phoneHash, version,
            idempotencyKey, grantId, transactionId, redeemedAt, createdAt] = params
          const duplicate = state.redemptions.some((item) =>
            item.redemption_id === redemptionId || item.code_id === String(codeId) ||
            item.idempotency_key === idempotencyKey ||
            (item.campaign_id === String(campaignId) && item.redeemer_user_id === String(userId)) ||
            (item.campaign_id === String(campaignId) && Buffer.from(item.redeemer_phone_identity_hash).equals(phoneHash))
          )
          if (duplicate) {
            const error = new Error('duplicate redemption')
            error.code = 'ER_DUP_ENTRY'
            error.constraint = 'uk_book_benefit_redemptions_code'
            throw error
          }
          const id = String(state.redemptions.length + 1)
          state.redemptions.push({
            id,
            redemption_id: redemptionId,
            code_id: String(codeId),
            campaign_id: String(campaignId),
            issuance_id: String(issuanceId),
            redeemer_user_id: String(userId),
            redeemer_phone_identity_hash: Buffer.from(phoneHash),
            redeemer_phone_hash_version: version,
            idempotency_key: idempotencyKey,
            membership_grant_id: String(grantId),
            entitlement_transaction_id: transactionId,
            redeemed_at: redeemedAt,
            created_at: createdAt
          })
          return [{ insertId: Number(id), affectedRows: 1 }]
        }
        if (operation === 'updateCode') {
          const code = state.codes.find((item) => item.id === String(params[2]) && item.status === 'issued')
          if (code) {
            code.status = 'redeemed'
            code.redeemed_at = params[0]
          }
          return [{ affectedRows: code ? 1 : 0 }]
        }
        if (operation === 'insertAudit') {
          const id = String(state.audits.length + 1)
          state.audits.push({ id, params: clone(params) })
          return [{ insertId: Number(id), affectedRows: 1 }]
        }
        if (operation === 'ensureEntitlement') return [{ affectedRows: 1 }]
        if (operation === 'selectEntitlement') {
          const entitlement = state.entitlement.get(String(params[0]))
          return [entitlement ? [{ ...entitlement }] : []]
        }
        if (operation === 'selectGrantByIdempotency') {
          const grant = state.grants.find((item) => item.idempotency_key === params[0])
          return [grant ? [{ ...grant }] : []]
        }
        if (operation === 'selectGrantBySource') {
          const grant = state.grants.find((item) => item.source_type === params[0] && item.source_id === params[1])
          return [grant ? [{ ...grant }] : []]
        }
        if (operation === 'listGrants') {
          return [state.grants.filter((item) => item.user_id === String(params[0])).map((item) => ({ ...item }))]
        }
        if (operation === 'selectTransactionByIdempotency') {
          const transaction = state.transactions.find((item) => item.idempotency_key === params[0])
          return [transaction ? [{ ...transaction }] : []]
        }
        if (operation === 'insertMembershipGrant') {
          const id = String(state.grants.length + 101)
          state.grants.push({
            id, user_id: String(params[0]), source_type: params[1], source_id: params[2],
            redemption_code_id: String(params[3]), days_granted: params[4], duration_seconds: params[5],
            status: params[6], granted_at: params[7], effective_start_at: params[8], effective_end_at: params[9],
            consumed_seconds_at_revoke: 0, revoked_seconds: 0, revoked_at: null, revoked_by: null,
            revoke_reason: null, idempotency_key: params[10], grant_transaction_id: params[11],
            revoke_transaction_id: params[12], created_at: NOW, updated_at: NOW
          })
          return [{ insertId: Number(id), affectedRows: 1 }]
        }
        if (operation === 'insertEntitlementTransaction') {
          const id = String(state.transactions.length + 201)
          state.transactions.push({
            id, transaction_id: params[0], user_id: String(params[1]), transaction_type: params[2],
            amount: params[3], balance_after: params[4], source: params[5], source_id: params[6],
            expires_at: params[7], grant_transaction_id: params[8], root_learning_object_id: params[9],
            current_learning_object_id: params[10], access_context_json: params[11], idempotency_key: params[12],
            operator_type: params[13], operator_id: params[14], reason: params[15], metadata_json: params[16],
            created_at: NOW
          })
          return [{ insertId: Number(id), affectedRows: 1 }]
        }
        if (operation === 'linkGrantTransaction') {
          const grant = state.grants.find((item) => item.id === String(params[1]) && item.user_id === String(params[2]))
          if (grant) grant.grant_transaction_id = params[0]
          return [{ affectedRows: grant ? 1 : 0 }]
        }
        if (operation === 'updateEntitlementSnapshot') {
          const entitlement = state.entitlement.get(String(params[5]))
          if (entitlement) {
            entitlement.membership_type = params[0]
            entitlement.membership_status = params[1]
            entitlement.membership_started_at = params[2]
            entitlement.membership_expire_at = params[3]
            entitlement.last_transaction_id = params[4]
          }
          return [{ affectedRows: entitlement ? 1 : 0 }]
        }
        throw new Error(`Unexpected SQL: ${compactSql}`)
      }
    }
  }

  return {
    pool: {
      async getConnection() {
        connectionCount += 1
        return createConnection()
      }
    },
    events,
    sqlEvents,
    snapshot: () => clone(committed),
    connectionCount: () => connectionCount
  }
}

function createEntitlementStore(options = {}) {
  return {
    async grantMembershipDurationInTransaction(connection, input) {
      assert.equal(typeof connection._state, 'function', 'must use caller connection')
      if (options.failure === 'membership') throw new Error('injected membership failure')
      const state = connection._state()
      const existingGrant = state.grants.find((item) => item.idempotencyKey === input.idempotencyKey)
      const existingTransaction = state.transactions.find((item) => item.idempotencyKey === input.idempotencyKey)
      const entitlement = state.entitlement.get(String(input.userId))
      if (existingGrant || existingTransaction) {
        assert(existingGrant && existingTransaction, 'idempotent membership state must be complete')
        return {
          ...existingGrant.result,
          transactionId: existingTransaction.transactionId,
          transactionInsertId: existingTransaction.id,
          quotaBalance: entitlement.quota_balance,
          idempotent: true
        }
      }
      assert.equal(input.sourceType, 'redemption_code')
      assert.equal(String(input.sourceId), String(input.redemptionCodeId))
      assert.equal(input.operatorType, 'system')
      const grantId = String(state.grants.length + 101)
      const transactionInsertId = String(state.transactions.length + 201)
      const membershipStartedAt = entitlement.membership_expire_at && entitlement.membership_expire_at > input.now
        ? entitlement.membership_started_at
        : input.now
      const effectiveStartAt = entitlement.membership_expire_at && entitlement.membership_expire_at > input.now
        ? entitlement.membership_expire_at
        : input.now
      const membershipExpireAt = new Date(effectiveStartAt.getTime() + 30 * DAY_MS)
      entitlement.membership_started_at = membershipStartedAt
      entitlement.membership_expire_at = membershipExpireAt
      const result = {
        grantId,
        transactionId: input.transactionId,
        transactionInsertId,
        membershipType: 'monthly',
        membershipStatus: 'active',
        membershipStartedAt: membershipStartedAt.toISOString(),
        membershipExpireAt: membershipExpireAt.toISOString(),
        quotaBalance: entitlement.quota_balance,
        idempotent: false
      }
      state.grants.push({
        id: grantId,
        userId: String(input.userId),
        sourceType: input.sourceType,
        sourceId: String(input.sourceId),
        redemptionCodeId: String(input.redemptionCodeId),
        idempotencyKey: input.idempotencyKey,
        daysGranted: 30,
        durationSeconds: 2592000,
        result
      })
      state.transactions.push({
        id: transactionInsertId,
        transactionId: input.transactionId,
        userId: String(input.userId),
        amount: 0,
        balanceAfter: entitlement.quota_balance,
        source: input.sourceType,
        sourceId: String(input.sourceId),
        idempotencyKey: input.idempotencyKey
      })
      return result
    }
  }
}

function createTestStore(database, options = {}) {
  return createBookBenefitStore({
    pool: database.pool,
    entitlementStore: createEntitlementStore(options),
    redemptionCodeHashSecret: CODE_SECRET,
    secretEnv: SECRET_ENV
  })
}

function redemptionInput(overrides = {}) {
  return {
    userId: '42',
    plaintextCode: CODE,
    operationId: 'redeem-operation-1',
    now: NOW,
    ...overrides
  }
}

function assertAtomicSuccess(state, expectedUser = '42') {
  assert.equal(state.grants.length, 1)
  assert.equal(state.grants[0].daysGranted ?? state.grants[0].days_granted, 30)
  assert.equal(state.grants[0].durationSeconds ?? state.grants[0].duration_seconds, 2592000)
  assert.equal(state.transactions.length, 1)
  assert.equal(state.transactions[0].amount, 0)
  assert.equal(state.redemptions.length, 1)
  assert.equal(state.redemptions[0].redeemer_user_id, expectedUser)
  assert.equal(state.codes[0].status, 'redeemed')
  assert.equal(state.audits.length, 1)
}

{
  const database = createDatabase()
  const store = createBookBenefitStore({
    pool: database.pool,
    redemptionCodeHashSecret: CODE_SECRET,
    secretEnv: SECRET_ENV
  })
  const result = await store.redeemBookBenefitCode(redemptionInput({ operationId: 'real-membership-core' }))
  assert.equal(result.membershipType, 'monthly')
  assert.equal(result.membershipStatus, 'active')
  assert.equal(result.quotaBalance, 9)
  assert.equal(new Date(result.membershipExpireAt).getTime() - NOW.getTime(), 30 * DAY_MS)
  const state = database.snapshot()
  assertAtomicSuccess(state)
  assert.equal(state.grants[0].source_type, 'redemption_code')
  assert.equal(state.grants[0].redemption_code_id, '31')
  assert.equal(state.transactions[0].amount, 0)
  assert.equal(state.entitlement.get('42').quota_balance, 9)
  assert(database.sqlEvents.every((event) => event.label === 'connection-1'))
  const replay = await store.redeemBookBenefitCode(redemptionInput({ operationId: 'real-membership-core' }))
  assert.equal(replay.idempotent, true)
  assert.equal(replay.redemptionId, result.redemptionId)
  assert.equal(replay.grantId, result.grantId)
  assert.equal(replay.transactionId, result.transactionId)
  const replayedState = database.snapshot()
  assertAtomicSuccess(replayedState)
  assert.equal(replayedState.entitlement.get('42').membership_expire_at.toISOString(), result.membershipExpireAt)
}

assert.equal(normalizeBookBenefitRedemptionCode(' bf30 2345-6789 abcd efgh '), CODE)
for (const invalid of ['', 'BF31-2345-6789-ABCD-EFGH', 'BF30-2345-6789-ABCD-EFG',
  'BF30-2345-6789-ABCD-EFGI', `${CODE}X`, 'X'.repeat(65), null, {}]) {
  const database = createDatabase()
  const store = createTestStore(database)
  await assert.rejects(
    store.redeemBookBenefitCode(redemptionInput({ plaintextCode: invalid })),
    (error) => error && error.code === 'REDEMPTION_CODE_INVALID'
  )
  assert.equal(database.connectionCount(), 0, 'invalid codes must fail before database access')
}

{
  const database = createDatabase()
  const result = await createTestStore(database).redeemBookBenefitCode(redemptionInput())
  assert.deepEqual(Object.keys(result).sort(), [
    'campaignId', 'codeId', 'grantId', 'idempotent', 'issuanceId', 'membershipExpireAt',
    'membershipStartedAt', 'membershipStatus', 'membershipType', 'quotaBalance', 'redemptionId',
    'transactionId', 'transactionInsertId', 'userId'
  ].sort())
  assert.equal(result.idempotent, false)
  assert.equal(result.membershipType, 'monthly')
  assert.equal(result.quotaBalance, 9)
  assert.equal(new Date(result.membershipExpireAt).getTime() - new Date(result.membershipStartedAt).getTime(), 30 * DAY_MS)
  const state = database.snapshot()
  assertAtomicSuccess(state)
  assert.equal(state.entitlement.get('42').quota_balance, 9)
  assert.deepEqual(database.events, ['connection-1:begin', 'connection-1:commit', 'connection-1:release'])
  assert(database.sqlEvents.every((event) => !event.params.includes(CODE)))
  assert(database.sqlEvents.every((event) => !event.sql.includes('payment')))
}

{
  const database = createDatabase()
  const result = await createTestStore(database).redeemBookBenefitCode(redemptionInput({
    plaintextCode: ' bf30 2345 6789 abcd efgh '
  }))
  assert.equal(result.codeId, '31')
  assertAtomicSuccess(database.snapshot())
}

{
  const sourceDatabase = createDatabase()
  const sourceStore = createTestStore(sourceDatabase)
  await sourceStore.redeemBookBenefitCode(redemptionInput())
  const successfulState = sourceDatabase.snapshot()
  const corruptions = [
    {
      name: 'redemption phone hash changed',
      mutate(state) { state.redemptions[0].redeemer_phone_identity_hash = Buffer.alloc(32, 99) }
    },
    {
      name: 'redemption phone version changed',
      mutate(state) { state.redemptions[0].redeemer_phone_hash_version = 'v2' }
    },
    {
      name: 'redemption phone version null',
      mutate(state) { state.redemptions[0].redeemer_phone_hash_version = null }
    },
    {
      name: 'redemption phone hash null',
      mutate(state) { state.redemptions[0].redeemer_phone_identity_hash = null }
    },
    {
      name: 'redemption phone hash non-buffer',
      mutate(state) { state.redemptions[0].redeemer_phone_identity_hash = 'not-a-buffer' }
    },
    {
      name: 'redemption phone hash wrong length',
      mutate(state) { state.redemptions[0].redeemer_phone_identity_hash = Buffer.alloc(31, 42) }
    },
    {
      name: 'current phone identity changed',
      mutate(state) { state.phoneBindings[0].hash = Buffer.alloc(32, 77) }
    },
    {
      name: 'current phone identity version changed',
      mutate(state) { state.phoneBindings[0].version = 'v2' }
    },
    {
      name: 'current phone identity wrong length',
      mutate(state) { state.phoneBindings[0].hash = Buffer.alloc(31, 42) }
    }
  ]

  for (const corruption of corruptions) {
    const state = clone(successfulState)
    corruption.mutate(state)
    const before = clone(state)
    const database = createDatabase({ state })
    await assert.rejects(
      createTestStore(database).redeemBookBenefitCode(redemptionInput()),
      (error) => error && error.code === 'BOOK_BENEFIT_OPERATION_CONFLICT',
      corruption.name
    )
    assert.deepEqual(database.snapshot(), before, `${corruption.name} must not write or repair data`)
  }
}

for (const [status, errorCode] of [
  ['voided', 'BOOK_BENEFIT_CODE_VOIDED'],
  ['redeemed', 'BOOK_BENEFIT_CODE_REDEEMED'],
  ['expired', 'BOOK_BENEFIT_CODE_EXPIRED']
]) {
  const state = initialState()
  state.codes[0].status = status
  const database = createDatabase({ state })
  await assert.rejects(
    createTestStore(database).redeemBookBenefitCode(redemptionInput()),
    (error) => error && error.code === errorCode
  )
  assert.equal(database.snapshot().grants.length, 0)
}

{
  const state = initialState()
  state.codes[0].expires_at = NOW
  const database = createDatabase({ state })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()),
    (error) => error && error.code === 'BOOK_BENEFIT_CODE_EXPIRED')
}

{
  const state = initialState()
  state.issuances[0].status = 'cancelled'
  const database = createDatabase({ state })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()),
    (error) => error && error.code === 'BOOK_BENEFIT_ISSUANCE_INVALID')
}

{
  const state = initialState()
  state.campaigns[0].id = '99'
  const database = createDatabase({ state })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()),
    (error) => error && error.code === 'BOOK_BENEFIT_RELATION_INVALID')
}

{
  const state = initialState()
  state.campaigns[0].benefit_days = 29
  const database = createDatabase({ state })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()),
    (error) => error && error.code === 'BOOK_BENEFIT_CAMPAIGN_INVALID')
}

for (const binding of [
  { user_id: '42', hash: null, version: null },
  { user_id: '42', hash: Buffer.alloc(31), version: 'v1' },
  { user_id: '42', hash: Buffer.alloc(32), version: 'v2' }
]) {
  const state = initialState()
  state.phoneBindings[0] = binding
  const database = createDatabase({ state })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()))
  assert.equal(database.snapshot().grants.length, 0)
}

{
  const database = createDatabase()
  const store = createTestStore(database)
  const first = await store.redeemBookBenefitCode(redemptionInput())
  const replay = await store.redeemBookBenefitCode(redemptionInput())
  assert.equal(replay.idempotent, true)
  assert.equal(replay.redemptionId, first.redemptionId)
  assert.equal(replay.grantId, first.grantId)
  assert.equal(replay.transactionId, first.transactionId)
  assertAtomicSuccess(database.snapshot())
}

for (const conflictKind of ['user', 'phone']) {
  const state = initialState()
  state.redemptions.push({
    id: '88', redemption_id: 'existing', code_id: '99', campaign_id: '11', issuance_id: '29',
    redeemer_user_id: conflictKind === 'user' ? '42' : '99',
    redeemer_phone_identity_hash: conflictKind === 'phone' ? Buffer.alloc(32, 42) : Buffer.alloc(32, 99),
    idempotency_key: 'existing-operation', membership_grant_id: '77', entitlement_transaction_id: 'existing-tx'
  })
  const database = createDatabase({ state })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()),
    (error) => error && error.code === 'BOOK_BENEFIT_REDEMPTION_CONFLICT')
  assert.equal(database.snapshot().grants.length, 0)
}

{
  const database = createDatabase()
  const store = createTestStore(database)
  const settled = await Promise.allSettled([
    store.redeemBookBenefitCode(redemptionInput({ operationId: 'concurrent-user-42' })),
    store.redeemBookBenefitCode(redemptionInput({ userId: '43', operationId: 'concurrent-user-43' }))
  ])
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1)
  assertAtomicSuccess(database.snapshot(), settled[0].status === 'fulfilled' ? '42' : '43')
}

for (const failure of ['membership', 'insertRedemption', 'updateCode', 'insertAudit']) {
  const database = createDatabase({ failure: failure === 'membership' ? null : failure })
  const store = createTestStore(database, { failure })
  await assert.rejects(store.redeemBookBenefitCode(redemptionInput()))
  const state = database.snapshot()
  assert.equal(state.grants.length, 0)
  assert.equal(state.transactions.length, 0)
  assert.equal(state.redemptions.length, 0)
  assert.equal(state.audits.length, 0)
  assert.equal(state.codes[0].status, 'issued')
  assert.deepEqual(database.events.slice(-2), ['connection-1:rollback', 'connection-1:release'])
}

{
  const database = createDatabase({ failure: 'commit' })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()))
  assert.equal(database.snapshot().redemptions.length, 0)
  assert(database.events.includes('connection-1:rollback'))
}

{
  const database = createDatabase({ failure: 'release' })
  await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()), /release/)
  assertAtomicSuccess(database.snapshot())
  assert(!database.events.includes('connection-1:rollback'))
  assert.equal(database.events.filter((event) => event === 'connection-1:release').length, 1)
}

{
  const sensitiveValues = [CODE, CODE_SECRET, 'fake-full-phone-10000000000', CODE_HASH.toString('hex')]
  const captured = []
  const originalError = console.error
  console.error = (...args) => captured.push(args.join(' '))
  try {
    const database = createDatabase({ failure: 'insertAudit' })
    await assert.rejects(createTestStore(database).redeemBookBenefitCode(redemptionInput()))
  } finally {
    console.error = originalError
  }
  const output = captured.join('\n')
  for (const sensitive of sensitiveValues) assert(!output.includes(sensitive))
}

console.log('book-benefit code redemption tests passed')
