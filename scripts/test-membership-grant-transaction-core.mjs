import assert from 'node:assert/strict'

import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'

const USER_ID = '42'
const NOW = new Date('2026-08-07T03:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function clone(value) {
  return structuredClone(value)
}

function duplicateError(message = 'duplicate membership grant') {
  const error = new Error(message)
  error.code = 'ER_DUP_ENTRY'
  return error
}

function createDatabase(options = {}) {
  let committed = options.state ? clone(options.state) : {
    entitlement: {
      id: 1,
      user_id: USER_ID,
      quota_balance: 11,
      quota_total_granted: 30,
      quota_total_consumed: 19,
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
  const events = []
  const sqlEvents = []
  let connectionNumber = 0
  let poolGetCount = 0
  let failure = options.failure || null

  function operationFor(sql) {
    if (sql.startsWith('INSERT INTO `user_entitlements`')) return 'ensureEntitlement'
    if (sql.startsWith('SELECT id, user_id, quota_balance')) return 'selectEntitlement'
    if (sql.includes('FROM `membership_grants`') && sql.includes('WHERE idempotency_key = ?')) return 'selectGrantByIdempotency'
    if (sql.includes('FROM `membership_grants`') && sql.includes('WHERE source_type = ? AND source_id = ?')) return 'selectGrantBySource'
    if (sql.includes('FROM `membership_grants`') && sql.includes('WHERE user_id = ?')) return 'listGrants'
    if (sql.includes('FROM `entitlement_transactions`') && sql.includes('WHERE idempotency_key = ?')) return 'selectTransactionByIdempotency'
    if (sql.startsWith('INSERT INTO `membership_grants`')) return 'insertGrant'
    if (sql.startsWith('INSERT INTO `entitlement_transactions`')) return 'insertTransaction'
    if (sql.startsWith('UPDATE `membership_grants` SET grant_transaction_id = ?')) return 'linkGrantTransaction'
    if (sql.startsWith('UPDATE `user_entitlements` SET membership_type = ?')) return 'updateSnapshot'
    return 'unexpected'
  }

  function rowForGrant(grant) {
    return {
      ...grant,
      granted_at: new Date(grant.granted_at).toISOString(),
      effective_start_at: new Date(grant.effective_start_at).toISOString(),
      effective_end_at: new Date(grant.effective_end_at).toISOString()
    }
  }

  function runFailure(operation, timing, state) {
    if (!failure || failure.operation !== operation || (failure.timing || 'before') !== timing) return
    if (typeof failure.prepare === 'function') failure.prepare(committed, state)
    const error = failure.error || new Error(`injected ${operation} failure`)
    if (failure.once !== false) failure = null
    throw error
  }

  function createConnection(label = `connection-${++connectionNumber}`) {
    let working = null
    let released = false
    const connection = {
      label,
      async beginTransaction() {
        events.push(`${label}:begin`)
        working = clone(committed)
      },
      async commit() {
        events.push(`${label}:commit`)
        committed = working
        working = null
      },
      async rollback() {
        events.push(`${label}:rollback`)
        if (options.rollbackError) throw options.rollbackError
        working = null
      },
      release() {
        assert.equal(released, false, `${label} released more than once`)
        released = true
        events.push(`${label}:release`)
        const releaseError = options.releaseErrors && options.releaseErrors[label]
        if (releaseError) throw releaseError
      },
      async execute(sql, params = []) {
        const compactSql = String(sql).replace(/\s+/g, ' ').trim()
        const operation = operationFor(compactSql)
        const state = working || committed
        sqlEvents.push({ connection: label, operation, sql: compactSql, params })
        runFailure(operation, 'before', state)

        let result
        if (operation === 'ensureEntitlement') {
          result = [{ affectedRows: 1 }]
        } else if (operation === 'selectEntitlement') {
          result = [[state.entitlement ? { ...state.entitlement } : null].filter(Boolean)]
        } else if (operation === 'selectGrantByIdempotency') {
          const grant = state.grants.find((item) => item.idempotency_key === params[0])
          result = [grant ? [rowForGrant(grant)] : []]
        } else if (operation === 'selectGrantBySource') {
          const grant = state.grants.find((item) => item.source_type === params[0] && item.source_id === params[1])
          result = [grant ? [rowForGrant(grant)] : []]
        } else if (operation === 'listGrants') {
          result = [state.grants
            .filter((item) => item.user_id === String(params[0]))
            .sort((left, right) => new Date(left.granted_at) - new Date(right.granted_at) || Number(left.id) - Number(right.id))
            .map(rowForGrant)]
        } else if (operation === 'selectTransactionByIdempotency') {
          const transaction = state.transactions.find((item) => item.idempotency_key === params[0])
          result = [transaction ? [{ ...transaction }] : []]
        } else if (operation === 'insertGrant') {
          const id = String(state.grants.length + 1)
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
          result = [{ insertId: Number(id), affectedRows: 1 }]
        } else if (operation === 'insertTransaction') {
          const id = String(state.transactions.length + 1)
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
          result = [{ insertId: Number(id), affectedRows: 1 }]
        } else if (operation === 'linkGrantTransaction') {
          const grant = state.grants.find((item) => String(item.id) === String(params[1]))
          if (grant) grant.grant_transaction_id = params[0]
          result = [{ affectedRows: grant ? 1 : 0 }]
        } else if (operation === 'updateSnapshot') {
          assert(params[2] instanceof Date && Number.isFinite(params[2].getTime()))
          assert(params[3] instanceof Date && Number.isFinite(params[3].getTime()))
          state.entitlement = {
            ...state.entitlement,
            membership_type: params[0],
            membership_status: params[1],
            membership_started_at: params[2],
            membership_expire_at: params[3],
            last_transaction_id: params[4]
          }
          result = [{ affectedRows: failure && failure.operation === operation && failure.resultAfter ? 0 : 1 }]
        } else {
          throw new Error(`Unexpected SQL: ${compactSql}`)
        }

        runFailure(operation, 'after', state)
        return result
      }
    }
    return connection
  }

  const pool = {
    async getConnection() {
      poolGetCount += 1
      if (options.getConnectionErrorAt === poolGetCount) {
        events.push(`pool-${poolGetCount}:acquire-error`)
        throw options.getConnectionError || new Error(`pool-${poolGetCount} acquisition failed`)
      }
      const connection = createConnection(`pool-${poolGetCount}`)
      events.push(`${connection.label}:acquire`)
      return connection
    }
  }

  return {
    pool,
    events,
    sqlEvents,
    createConnection,
    snapshot: () => clone(committed),
    poolGetCount: () => poolGetCount
  }
}

function grantInput(operation, overrides = {}) {
  return {
    userId: USER_ID,
    sourceType: 'admin_gift',
    sourceId: `membership-source:${operation}`,
    idempotencyKey: `membership-idempotency:${operation}`,
    transactionId: `membership-transaction-${operation}`,
    operatorType: 'admin',
    operatorId: 'transaction-core-test',
    reason: 'Membership transaction core test.',
    now: NOW,
    ...overrides
  }
}

function seedSuccessfulGrant(state, input, overrides = {}) {
  const effectiveStartAt = overrides.effectiveStartAt || NOW
  const effectiveEndAt = overrides.effectiveEndAt || new Date(NOW.getTime() + 30 * DAY_MS)
  const transactionId = overrides.transactionId || input.transactionId
  const grantId = overrides.grantId || '71'
  const transactionInsertId = overrides.transactionInsertId || '81'
  const redemptionCodeId = overrides.redemptionCodeId ?? null
  state.grants.push({
    id: grantId,
    user_id: String(input.userId),
    source_type: input.sourceType,
    source_id: input.sourceId,
    redemption_code_id: redemptionCodeId,
    days_granted: 30,
    duration_seconds: 2592000,
    status: 'granted',
    granted_at: effectiveStartAt,
    effective_start_at: effectiveStartAt,
    effective_end_at: effectiveEndAt,
    consumed_seconds_at_revoke: 0,
    revoked_seconds: 0,
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
    idempotency_key: input.idempotencyKey,
    grant_transaction_id: overrides.grantTransactionId || transactionId,
    revoke_transaction_id: null,
    created_at: NOW,
    updated_at: NOW
  })
  if (!overrides.omitTransaction) {
    state.transactions.push({
      id: transactionInsertId,
      transaction_id: transactionId,
      user_id: String(overrides.transactionUserId || input.userId),
      transaction_type: overrides.transactionType || 'MEMBERSHIP_GRANT',
      amount: 0,
      balance_after: state.entitlement.quota_balance,
      source: overrides.transactionSource || input.sourceType,
      source_id: overrides.transactionSourceId || input.sourceId,
      expires_at: null,
      grant_transaction_id: null,
      root_learning_object_id: null,
      current_learning_object_id: null,
      access_context_json: null,
      idempotency_key: input.idempotencyKey,
      operator_type: input.operatorType,
      operator_id: input.operatorId,
      reason: input.reason,
      metadata_json: JSON.stringify({ membershipGrantId: overrides.metadataGrantId || grantId }),
      created_at: NOW
    })
  }
  state.entitlement.membership_type = 'monthly'
  state.entitlement.membership_status = 'active'
  state.entitlement.membership_started_at = effectiveStartAt
  state.entitlement.membership_expire_at = effectiveEndAt
  state.entitlement.last_transaction_id = transactionInsertId
}

{
  const database = createDatabase()
  const store = createUserEntitlementStore({ pool: database.pool, now: () => new Date(NOW) })
  const callerConnection = database.createConnection('caller-transaction')
  const lifecycleBefore = database.events.length
  const result = await store.grantMembershipDurationInTransaction(
    callerConnection,
    grantInput('core-first', { sourceType: 'redemption_code', redemptionCodeId: 123 })
  )

  assert.equal(database.poolGetCount(), 0)
  assert.equal(database.events.length, lifecycleBefore, 'transaction core must not manage connection lifecycle')
  assert(database.sqlEvents.every((event) => event.connection === 'caller-transaction'))
  assert.equal(result.redemptionCodeId, '123')
  assert.equal(result.transactionId, 'membership-transaction-core-first')
  assert.equal(result.transactionInsertId, '1')
  assert.equal(result.quotaBalance, 11)
  const snapshot = database.snapshot()
  assert.equal(snapshot.grants[0].redemption_code_id, '123')
  assert.equal(snapshot.grants[0].days_granted, 30)
  assert.equal(snapshot.grants[0].duration_seconds, 2592000)
  assert.equal(snapshot.transactions[0].amount, 0)
  assert.equal(snapshot.entitlement.quota_balance, 11)
  assert(snapshot.entitlement.membership_started_at instanceof Date)
  assert(snapshot.entitlement.membership_expire_at instanceof Date)
}

{
  const database = createDatabase()
  const store = createUserEntitlementStore({ pool: database.pool, now: () => new Date(NOW) })
  const first = await store.grantMembershipDuration(grantInput('wrapper-first'))
  const second = await store.grantMembershipDuration(grantInput('wrapper-second'))
  assert.equal(first.membershipStartedAt, NOW.toISOString())
  assert.equal(first.redemptionCodeId, null)
  assert.equal(new Date(first.membershipExpireAt).getTime(), NOW.getTime() + 30 * DAY_MS)
  assert.equal(second.effectiveStartAt, first.effectiveEndAt)
  assert.equal(new Date(second.membershipExpireAt).getTime(), NOW.getTime() + 60 * DAY_MS)
  assert.equal(database.snapshot().entitlement.quota_balance, 11)
  assert.deepEqual(database.events, [
    'pool-1:acquire', 'pool-1:begin', 'pool-1:commit', 'pool-1:release',
    'pool-2:acquire', 'pool-2:begin', 'pool-2:commit', 'pool-2:release'
  ])

  const beforeReplay = clone(database.snapshot())
  const replayConnection = database.createConnection('caller-replay')
  const replay = await store.grantMembershipDurationInTransaction(
    replayConnection,
    grantInput('wrapper-first', { transactionId: 'ignored-on-replay' })
  )
  assert.equal(replay.idempotent, true)
  assert.equal(replay.grantId, first.grantId)
  assert.equal(replay.transactionId, first.transactionId)
  assert.equal(replay.transactionInsertId, first.transactionInsertId)
  assert.deepEqual(database.snapshot(), beforeReplay)
  assert(!database.events.some((event) => event.startsWith('caller-replay:')))
}

{
  const invalidValues = ['', '   ', 0, -1, 1.5, 'not-an-id', '9007199254740992', Number.MAX_SAFE_INTEGER + 1]
  for (const value of invalidValues) {
    const database = createDatabase()
    const store = createUserEntitlementStore({ pool: database.pool })
    await assert.rejects(
      store.grantMembershipDurationInTransaction(database.createConnection('invalid-id'), grantInput('invalid-id', {
        redemptionCodeId: value
      })),
      (error) => error && error.code === 'REDEMPTION_CODE_ID_INVALID'
    )
    assert.equal(database.sqlEvents.length, 0)
  }

  for (const value of [undefined, null]) {
    const database = createDatabase()
    const store = createUserEntitlementStore({ pool: database.pool })
    const result = await store.grantMembershipDurationInTransaction(
      database.createConnection('nullable-id'),
      grantInput(`nullable-${String(value)}`, { sourceType: 'redemption_code', redemptionCodeId: value })
    )
    assert.equal(result.redemptionCodeId, null)
    assert.equal(database.snapshot().grants[0].redemption_code_id, null)
  }

  const database = createDatabase({ failure: { operation: 'insertGrant', error: duplicateError('redemption id unique') } })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDurationInTransaction(
      database.createConnection('redemption-unique'),
      grantInput('redemption-unique', { sourceType: 'admin_gift', redemptionCodeId: 8 })
    ),
    (error) => error && error.code === 'ER_DUP_ENTRY' && error.message === 'redemption id unique'
  )
}

{
  const conflictCases = [
    { name: 'different-user', input: { userId: '99' } },
    { name: 'different-source-type', input: { sourceType: 'book_order' } },
    { name: 'different-source-id', input: { sourceId: 'different-source' } },
    { name: 'different-redemption-id', input: { redemptionCodeId: 6 } }
  ]
  for (const conflictCase of conflictCases) {
    const input = grantInput(`conflict-${conflictCase.name}`, { redemptionCodeId: 5 })
    const stateDatabase = createDatabase()
    seedSuccessfulGrant(stateDatabase.snapshot(), input)
    const seededState = stateDatabase.snapshot()
    seedSuccessfulGrant(seededState, input, { redemptionCodeId: '5' })
    const database = createDatabase({ state: seededState })
    const store = createUserEntitlementStore({ pool: database.pool })
    await assert.rejects(
      store.grantMembershipDurationInTransaction(
        database.createConnection('conflict'),
        { ...input, ...conflictCase.input }
      ),
      (error) => error && error.code === 'IDEMPOTENCY_KEY_CONFLICT'
    )
  }
}

{
  const sourceInput = grantInput('source-conflict')
  const databaseForState = createDatabase()
  const state = databaseForState.snapshot()
  seedSuccessfulGrant(state, sourceInput)
  const database = createDatabase({ state })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDurationInTransaction(
      database.createConnection('source-conflict'),
      grantInput('different-operation', { sourceId: sourceInput.sourceId })
    ),
    (error) => error && error.code === 'MEMBERSHIP_SOURCE_CONFLICT'
  )
}

for (const incompleteState of ['grant-only', 'transaction-only']) {
  const input = grantInput(`incomplete-${incompleteState}`)
  const state = createDatabase().snapshot()
  seedSuccessfulGrant(state, input)
  if (incompleteState === 'grant-only') state.transactions = []
  if (incompleteState === 'transaction-only') state.grants = []
  const database = createDatabase({ state })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDurationInTransaction(database.createConnection('incomplete-replay'), input),
    (error) => error && error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  )
}

{
  const database = createDatabase()
  const store = createUserEntitlementStore({ pool: database.pool, now: () => new Date(NOW) })
  const input = grantInput('generated-transaction-id')
  delete input.transactionId
  const result = await store.grantMembershipDuration(input)
  assert.match(result.transactionId, /^ent_\d+_[0-9a-f-]{36}$/)
}

for (const failure of [
  { operation: 'insertTransaction', timing: 'before' },
  { operation: 'linkGrantTransaction', timing: 'before' },
  { operation: 'updateSnapshot', timing: 'before' },
  { operation: 'updateSnapshot', timing: 'after' }
]) {
  const database = createDatabase({ failure })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(store.grantMembershipDuration(grantInput(`failure-${failure.operation}-${failure.timing}`)))
  const snapshot = database.snapshot()
  assert.equal(snapshot.grants.length, 0)
  assert.equal(snapshot.transactions.length, 0)
  assert.equal(snapshot.entitlement.membership_status, 'none')
  assert.deepEqual(database.events.slice(-2), ['pool-1:rollback', 'pool-1:release'])
  assert(!database.events.includes('pool-1:commit'))
}

{
  const input = grantInput('duplicate-recovery', { sourceType: 'redemption_code', redemptionCodeId: 55 })
  const database = createDatabase({
    failure: {
      operation: 'insertGrant',
      error: duplicateError(),
      prepare(committed) {
        seedSuccessfulGrant(committed, input, { redemptionCodeId: '55' })
      }
    }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  const recovered = await store.grantMembershipDuration(input)
  assert.equal(recovered.idempotent, true)
  assert.equal(recovered.grantId, '71')
  assert.equal(recovered.transactionId, input.transactionId)
  assert.equal(recovered.transactionInsertId, '81')
  assert.equal(recovered.redemptionCodeId, '55')
  assert.deepEqual(database.events, [
    'pool-1:acquire', 'pool-1:begin', 'pool-1:rollback', 'pool-1:release',
    'pool-2:acquire', 'pool-2:release'
  ])
  assert(database.sqlEvents.filter((event) => event.connection === 'pool-2').every((event) => event.operation.startsWith('select')))
}

for (const recoveryMutation of [
  { name: 'missing-transaction', mutate: (state) => { state.transactions = [] } },
  { name: 'cross-linked-transaction', mutate: (state) => { state.grants[0].grant_transaction_id = 'wrong-transaction' } },
  { name: 'wrong-metadata', mutate: (state) => { state.transactions[0].metadata_json = JSON.stringify({ membershipGrantId: 'wrong-grant' }) } }
]) {
  const input = grantInput(`recovery-${recoveryMutation.name}`)
  const database = createDatabase({
    failure: {
      operation: 'insertGrant',
      error: duplicateError(),
      prepare(committed) {
        seedSuccessfulGrant(committed, input)
        recoveryMutation.mutate(committed)
      }
    }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDuration(input),
    (error) => error && error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  )
  assert.equal(database.events.at(-1), 'pool-2:release')
}

{
  const database = createDatabase({
    rollbackError: new Error('rollback failed'),
    failure: { operation: 'insertGrant', error: duplicateError() }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(store.grantMembershipDuration(grantInput('rollback-failure')), /rollback failed/)
  assert.equal(database.poolGetCount(), 1)
  assert.equal(database.events.at(-1), 'pool-1:release')
}

{
  const primaryError = new Error('primary database failure')
  const releaseError = new Error('main release failure')
  const database = createDatabase({
    failure: { operation: 'insertTransaction', error: primaryError },
    releaseErrors: { 'pool-1': releaseError }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDuration(grantInput('primary-and-main-release-failure')),
    (error) => error === primaryError
  )
  assert.equal(database.poolGetCount(), 1)
  assert.equal(database.events.filter((event) => event === 'pool-1:release').length, 1)
  assert(!database.events.some((event) => event.startsWith('pool-2:')))
}

{
  const primaryError = duplicateError('duplicate before main release failure')
  const database = createDatabase({
    failure: { operation: 'insertGrant', error: primaryError },
    releaseErrors: { 'pool-1': new Error('main release failure') }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDuration(grantInput('duplicate-and-main-release-failure')),
    (error) => error === primaryError
  )
  assert.equal(database.poolGetCount(), 1)
  assert.equal(database.events.filter((event) => event === 'pool-1:release').length, 1)
  assert(!database.sqlEvents.some((event) => event.connection === 'pool-2'))
}

{
  const rollbackError = new Error('rollback failure takes priority')
  const database = createDatabase({
    rollbackError,
    failure: { operation: 'insertGrant', error: duplicateError() },
    releaseErrors: { 'pool-1': new Error('main release failure') }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDuration(grantInput('rollback-and-release-failure')),
    (error) => error === rollbackError
  )
  assert.equal(database.poolGetCount(), 1)
  assert.equal(database.events.filter((event) => event === 'pool-1:release').length, 1)
}

{
  const input = grantInput('recovery-acquisition-failure')
  const acquisitionError = new Error('recovery connection acquisition failed')
  const database = createDatabase({
    getConnectionErrorAt: 2,
    getConnectionError: acquisitionError,
    failure: {
      operation: 'insertGrant',
      error: duplicateError(),
      prepare(committed) {
        seedSuccessfulGrant(committed, input)
      }
    }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(store.grantMembershipDuration(input), (error) => error === acquisitionError)
  assert.deepEqual(database.events.slice(-2), ['pool-1:release', 'pool-2:acquire-error'])
  assert(!database.sqlEvents.some((event) => event.connection === 'pool-2'))
}

{
  const database = createDatabase({ failure: { operation: 'insertGrant', error: duplicateError() } })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDuration(grantInput('unreconciled-duplicate')),
    (error) => error && error.code === 'MEMBERSHIP_GRANT_CONFLICT'
  )
  assert.equal(database.events.at(-1), 'pool-2:release')
}

{
  const input = grantInput('recovery-query-failure')
  const recoveryError = new Error('recovery query failed')
  let prepared = false
  const database = createDatabase({
    releaseErrors: { 'pool-2': new Error('recovery release failed') },
    failure: {
      operation: 'insertGrant',
      error: duplicateError(),
      prepare(committed) {
        seedSuccessfulGrant(committed, input)
        prepared = true
      }
    }
  })
  const originalPool = database.pool
  const pool = {
    async getConnection() {
      const connection = await originalPool.getConnection()
      if (prepared) {
        const execute = connection.execute.bind(connection)
        connection.execute = async (sql, params) => {
          if (String(sql).includes('WHERE idempotency_key = ?')) throw recoveryError
          return await execute(sql, params)
        }
      }
      return connection
    }
  }
  const store = createUserEntitlementStore({ pool })
  await assert.rejects(store.grantMembershipDuration(input), (error) => error === recoveryError)
  assert.equal(database.events.at(-1), 'pool-2:release')
  assert.equal(database.events.filter((event) => event === 'pool-2:release').length, 1)
}

{
  const input = grantInput('successful-recovery-release-failure')
  const releaseError = new Error('recovery release failed after successful query')
  const database = createDatabase({
    releaseErrors: { 'pool-2': releaseError },
    failure: {
      operation: 'insertGrant',
      error: duplicateError(),
      prepare(committed) {
        seedSuccessfulGrant(committed, input)
      }
    }
  })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(store.grantMembershipDuration(input), (error) => error === releaseError)
  assert.equal(database.events.filter((event) => event === 'pool-2:release').length, 1)
  assert.equal(database.snapshot().grants.length, 1)
  assert.equal(database.snapshot().transactions.length, 1)
}

{
  const releaseError = new Error('release failed after commit')
  const database = createDatabase({ releaseErrors: { 'pool-1': releaseError } })
  const store = createUserEntitlementStore({ pool: database.pool })
  await assert.rejects(
    store.grantMembershipDuration(grantInput('successful-commit-release-failure')),
    (error) => error === releaseError
  )
  assert.equal(database.events.filter((event) => event === 'pool-1:release').length, 1)
  assert(!database.events.includes('pool-1:rollback'))
  assert.equal(database.poolGetCount(), 1)
  assert.equal(database.snapshot().grants.length, 1)
  assert.equal(database.snapshot().transactions.length, 1)
}

await assert.rejects(
  createUserEntitlementStore({ pool: { getConnection: async () => null } })
    .grantMembershipDurationInTransaction(null, grantInput('invalid-connection')),
  (error) => error && error.code === 'MEMBERSHIP_TRANSACTION_CONNECTION_INVALID'
)

console.log('membership grant transaction core tests passed')
