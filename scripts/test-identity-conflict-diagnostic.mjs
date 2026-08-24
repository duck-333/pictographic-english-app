import assert from 'node:assert/strict'

import { createIdentityConflictDiagnostic } from '../server/identity-conflict-diagnostic.mjs'
import { createIdentityStore, resolveIdentityConflict } from '../server/identity-store.mjs'

const MARKER = '123e4567-e89b-42d3-a456-426614174000'
const A_ID = 'user-a-private-sentinel'
const B_ID = 'user-b-private-sentinel'
const A_UNIONID = 'union-a-private-sentinel'
const B_UNIONID = 'union-b-private-sentinel'
const OPENID_REQUEST = 'openid-request-private-sentinel'
const OPENID_DATABASE = 'openid-database-private-sentinel'
const PHONE_NUMBER = '10000000000'
const PHONE_MASKED = '100****0000-private-sentinel'
const PHONE_HASH = 'phone-hash-private-sentinel'
const IDENTITY_HASH = 'identity-hash-private-sentinel'
const TOKEN = 'jwt-token-private-sentinel'
const CODE = 'wechat-code-private-sentinel'
const SESSION_KEY = 'session-key-private-sentinel'
const SQL_TEXT = 'SELECT-private-sql-sentinel'
const ROLLBACK_MESSAGE = 'rollback-error-private-sentinel'
const ROLLBACK_STACK = 'rollback-stack-private-sentinel'
const LOGGER_MESSAGE = 'logger-error-private-sentinel'
const LOGGER_STACK = 'logger-stack-private-sentinel'
const FORBIDDEN_SENTINELS = [
  A_ID,
  B_ID,
  OPENID_REQUEST,
  OPENID_DATABASE,
  A_UNIONID,
  B_UNIONID,
  PHONE_NUMBER,
  PHONE_MASKED,
  PHONE_HASH,
  IDENTITY_HASH,
  TOKEN,
  CODE,
  SESSION_KEY,
  SQL_TEXT,
  ROLLBACK_MESSAGE,
  ROLLBACK_STACK,
  LOGGER_MESSAGE,
  LOGGER_STACK
]

function createBusinessRow(overrides = {}) {
  return {
    entitlement_row_count: 1,
    exact_registration_entitlement_count: 1,
    real_entitlement_snapshot_count: 0,
    entitlement_membership_count: 0,
    entitlement_transaction_count: 1,
    registration_transaction_count: 1,
    real_entitlement_transaction_count: 0,
    membership_transaction_count: 0,
    membership_grant_count: 0,
    favorite_count: 0,
    recent_word_count: 0,
    book_redemption_count: 0,
    ...overrides
  }
}

function createExactRegistrationTransaction(userId) {
  return {
    transaction_type: 'REGISTER_BONUS',
    amount: 30,
    balance_after: 30,
    source: 'registration',
    source_id: userId,
    expires_at: new Date('2027-01-01T00:00:00.000Z'),
    grant_transaction_id: null,
    root_learning_object_id: null,
    current_learning_object_id: null,
    access_context_json: null,
    idempotency_key: `registration_bonus:${userId}`,
    operator_type: 'system',
    operator_id: 'auth-registration',
    reason: 'Registration bonus complete-content access quota.',
    metadata_json: null
  }
}

function isExactRegistrationTransaction(transaction, userId) {
  return Boolean(
    transaction &&
    transaction.transaction_type === 'REGISTER_BONUS' &&
    transaction.amount === 30 &&
    transaction.balance_after === 30 &&
    transaction.source === 'registration' &&
    transaction.source_id === userId &&
    transaction.expires_at !== null &&
    transaction.expires_at !== undefined &&
    transaction.grant_transaction_id === null &&
    transaction.root_learning_object_id === null &&
    transaction.current_learning_object_id === null &&
    transaction.access_context_json === null &&
    transaction.idempotency_key === `registration_bonus:${userId}` &&
    transaction.operator_type === 'system' &&
    transaction.operator_id === 'auth-registration' &&
    transaction.reason === 'Registration bonus complete-content access quota.' &&
    transaction.metadata_json === null
  )
}

function createBusinessRowFromTransaction(transaction, userId = A_ID, overrides = {}) {
  const exact = isExactRegistrationTransaction(transaction, userId)
  return createBusinessRow({
    entitlement_transaction_count: 1,
    registration_transaction_count: exact ? 1 : 0,
    real_entitlement_transaction_count: exact ? 0 : 1,
    ...overrides
  })
}

function createDiagnosticConnection(options = {}) {
  const calls = []
  let businessCallCount = 0
  const connection = {
    calls,
    async execute(sql, values) {
      calls.push({ sql, values })
      assert.match(sql, /^\s*SELECT\b/i)
      assert.equal((sql.match(/\?/g) || []).length, values.length)
      if (options.failSelect) throw new Error('private database failure sentinel')
      if (sql.includes('a_wechat_binding_count')) {
        return [[{
          a_wechat_binding_count: 1,
          b_wechat_binding_count: 2,
          a_active_phone_binding_count: 1,
          b_active_phone_binding_count: 1,
          ...(options.bindingCounts || {})
        }]]
      }
      if (sql.includes('SELECT unionid')) {
        return [(options.bUnionids || []).map((unionid) => ({ unionid }))]
      }
      if (sql.includes('entitlement_row_count')) {
        assert.match(sql, /<=>/)
        assert.match(sql, /BINARY transaction_type <=> BINARY 'REGISTER_BONUS'/)
        assert.match(sql, /BINARY source <=> BINARY 'registration'/)
        assert.match(sql, /AND NOT \(\s*BINARY transaction_type <=>/)
        const rows = options.businessRows || [createBusinessRow(), createBusinessRow()]
        const row = rows[businessCallCount]
        businessCallCount += 1
        return [[row]]
      }
      throw new Error('Unexpected SELECT in diagnostic test.')
    }
  }
  return connection
}

function createDiagnostic(options = {}) {
  return createIdentityConflictDiagnostic({
    env: options.env || { IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED: 'true' },
    logger: options.logger || (() => {}),
    randomUUID: options.randomUUID || (() => MARKER)
  })
}

async function collectLine(options = {}) {
  const connection = createDiagnosticConnection(options)
  const diagnostic = createDiagnostic(options)
  const result = await diagnostic.collect(connection, {
    aUserId: A_ID,
    bUserId: B_ID,
    requestUnionid: options.aUnionid,
    aStoredUnionid: options.aStoredUnionid
  })
  return {
    connection,
    diagnostic,
    result,
    line: result ? result.line : null
  }
}

async function testStrictDefaultOff() {
  for (const env of [{}, { IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED: 'false' }, { IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED: 'TRUE' }, { IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED: '1' }]) {
    let markerCalls = 0
    let logCalls = 0
    const connection = createDiagnosticConnection()
    const diagnostic = createDiagnostic({
      env,
      logger: () => { logCalls += 1 },
      randomUUID: () => {
        markerCalls += 1
        return MARKER
      }
    })
    const result = await diagnostic.collect(connection, { aUserId: A_ID, bUserId: B_ID })
    await diagnostic.emit(result)
    assert.equal(result, null)
    assert.equal(connection.calls.length, 0)
    assert.equal(markerCalls, 0)
    assert.equal(logCalls, 0)
  }
}

async function testSameIdentityDoesNothing() {
  let markerCalls = 0
  const connection = createDiagnosticConnection()
  const diagnostic = createDiagnostic({
    randomUUID: () => {
      markerCalls += 1
      return MARKER
    }
  })
  const resolution = resolveIdentityConflict({
    wechatBinding: { userId: A_ID },
    phoneBinding: { userId: A_ID }
  })
  assert.equal(resolution.conflict, false)
  assert.equal(await diagnostic.collect(connection, { aUserId: A_ID, bUserId: A_ID }), null)
  assert.equal(connection.calls.length, 0)
  assert.equal(markerCalls, 0)
}

async function testFixedLineAndBusinessClassification() {
  const bBusiness = createBusinessRow({
    exact_registration_entitlement_count: 0,
    real_entitlement_snapshot_count: 1,
    entitlement_membership_count: 1,
    entitlement_transaction_count: 2,
    real_entitlement_transaction_count: 1,
    membership_transaction_count: 1,
    membership_grant_count: 1,
    favorite_count: 3,
    recent_word_count: 4,
    book_redemption_count: 1
  })
  const { connection, result, line } = await collectLine({
    aUnionid: A_UNIONID,
    bUnionids: [A_UNIONID],
    businessRows: [createBusinessRow(), bBusiness]
  })
  assert.equal(connection.calls.length, 4)
  assert.equal(result.marker, MARKER)
  assert(connection.calls.every((call) => /^\s*SELECT\b/i.test(call.sql)))
  assert.equal(
    line,
    `IDENTITY_CONFLICT_DIAGNOSTIC OPERATION_MARKER=${MARKER} CONFLICT_CONFIRMED=True A_EQUALS_B=False A_WECHAT_BINDING_COUNT=1 B_WECHAT_BINDING_COUNT=2 A_ACTIVE_PHONE_BINDING_COUNT=1 B_ACTIVE_PHONE_BINDING_COUNT=1 A_UNIONID_PRESENT=True B_UNIONID_PRESENT=True UNIONID_EQUAL=True A_REGISTRATION_INITIALIZATION_ONLY=True B_REGISTRATION_INITIALIZATION_ONLY=False A_HAS_REAL_ENTITLEMENT_ACTIVITY=False B_HAS_REAL_ENTITLEMENT_ACTIVITY=True A_HAS_MEMBERSHIP=False B_HAS_MEMBERSHIP=True A_FAVORITE_COUNT=0 B_FAVORITE_COUNT=3 A_RECENT_WORD_COUNT=0 B_RECENT_WORD_COUNT=4 A_BOOK_REDEMPTION_COUNT=0 B_BOOK_REDEMPTION_COUNT=1`
  )
  for (const sentinel of FORBIDDEN_SENTINELS) {
    assert.equal(line.includes(sentinel), false)
  }
}

async function testNullSafeEntitlementClassification() {
  const anomalies = [
    ['transaction_type null', { transaction_type: null }],
    ['source null', { source: null }],
    ['amount null', { amount: null }],
    ['operator_type null', { operator_type: null }],
    ['operator_id null', { operator_id: null }],
    ['idempotency_key null', { idempotency_key: null }],
    ['idempotency_key empty', { idempotency_key: '' }],
    ['transaction_type case', { transaction_type: 'register_bonus' }],
    ['source case', { source: 'Registration' }],
    ['operator case', { operator_type: 'System' }],
    ['transaction_type whitespace', { transaction_type: ' REGISTER_BONUS' }],
    ['source whitespace', { source: 'registration ' }],
    ['operator whitespace', { operator_id: ' auth-registration' }]
  ]

  const exactTransaction = createExactRegistrationTransaction(A_ID)
  const exact = await collectLine({
    businessRows: [createBusinessRowFromTransaction(exactTransaction), createBusinessRow()]
  })
  assert.match(exact.line, /A_REGISTRATION_INITIALIZATION_ONLY=True/)
  assert.match(exact.line, /A_HAS_REAL_ENTITLEMENT_ACTIVITY=False/)

  for (const [name, mutation] of anomalies) {
    const transaction = { ...createExactRegistrationTransaction(A_ID), ...mutation }
    const result = await collectLine({
      businessRows: [createBusinessRowFromTransaction(transaction), createBusinessRow()]
    })
    assert.match(result.line, /A_REGISTRATION_INITIALIZATION_ONLY=False/, name)
    assert.match(result.line, /A_HAS_REAL_ENTITLEMENT_ACTIVITY=True/, name)
  }

  const abnormalSnapshot = await collectLine({
    businessRows: [
      createBusinessRow({
        exact_registration_entitlement_count: 0,
        real_entitlement_snapshot_count: 1
      }),
      createBusinessRow()
    ]
  })
  assert.match(abnormalSnapshot.line, /A_REGISTRATION_INITIALIZATION_ONLY=False/)
  assert.match(abnormalSnapshot.line, /A_HAS_REAL_ENTITLEMENT_ACTIVITY=True/)
}

async function testUnionidOutcomes() {
  const same = await collectLine({ aUnionid: A_UNIONID, bUnionids: [A_UNIONID] })
  assert.match(same.line, /UNIONID_EQUAL=True/)

  const different = await collectLine({ aUnionid: A_UNIONID, bUnionids: [B_UNIONID] })
  assert.match(different.line, /UNIONID_EQUAL=False/)

  const missing = await collectLine({ aUnionid: '', aStoredUnionid: '', bUnionids: [B_UNIONID] })
  assert.match(missing.line, /A_UNIONID_PRESENT=False B_UNIONID_PRESENT=True UNIONID_EQUAL=Unknown/)

  const noBUnionid = await collectLine({ aUnionid: A_UNIONID, bUnionids: [] })
  assert.match(noBUnionid.line, /B_UNIONID_PRESENT=False UNIONID_EQUAL=Unknown/)
}

async function testSingleUseAndConcurrency() {
  const sequentialConnection = createDiagnosticConnection()
  const sequential = createDiagnostic()
  const first = await sequential.collect(sequentialConnection, {
    aUserId: A_ID,
    bUserId: B_ID,
    requestUnionid: A_UNIONID
  })
  const second = await sequential.collect(sequentialConnection, {
    aUserId: A_ID,
    bUserId: B_ID,
    requestUnionid: A_UNIONID
  })
  assert(first)
  assert.equal(second, null)
  assert.equal(sequentialConnection.calls.length, 4)

  const concurrentConnection = createDiagnosticConnection()
  const concurrent = createDiagnostic()
  const lines = await Promise.all([
    concurrent.collect(concurrentConnection, { aUserId: A_ID, bUserId: B_ID }),
    concurrent.collect(concurrentConnection, { aUserId: A_ID, bUserId: B_ID })
  ])
  assert.equal(lines.filter(Boolean).length, 1)
  assert.equal(concurrentConnection.calls.length, 4)
}

async function testSelectAndLoggerFailuresAreContained() {
  let logCalls = 0
  const failed = await collectLine({
    failSelect: true,
    logger: () => { logCalls += 1 }
  })
  assert.equal(failed.line, null)
  await failed.diagnostic.emit(failed.result)
  assert.equal(logCalls, 0)

  const successful = await collectLine({ aUnionid: A_UNIONID, bUnionids: [A_UNIONID] })
  const loggerFailure = createDiagnostic({
    logger: async () => {
      throw new Error('private logger failure sentinel')
    }
  })
  await assert.doesNotReject(() => loggerFailure.emit(successful.result))
}

function createIdentityConnection(options = {}) {
  const events = []
  const diagnostic = createDiagnosticConnection(options)
  return {
    events,
    diagnosticCalls: diagnostic.calls,
    async beginTransaction() {
      events.push('begin')
    },
    async execute(sql, values) {
      events.push(sql.includes('a_wechat_binding_count') || sql.includes('entitlement_row_count') || sql.includes('SELECT unionid') ? 'diagnostic-select' : 'identity-select')
      if (sql.includes('WHERE openid = ?')) {
        return [[{
          user_id: A_ID,
          openid: OPENID_DATABASE,
          unionid: A_UNIONID,
          sql_private_value: SQL_TEXT
        }]]
      }
      if (sql.includes('WHERE phone_hash = ?')) {
        return [[{
          user_id: B_ID,
          phone_hash: PHONE_HASH,
          phone_masked: PHONE_MASKED,
          campaign_phone_identity_hash: IDENTITY_HASH,
          hash_version: 'v1',
          country_code: '86',
          status: 'active',
          verified_at: null
        }]]
      }
      return diagnostic.execute(sql, values)
    },
    async commit() {
      events.push('commit')
    },
    async rollback() {
      events.push('rollback')
      if (options.rollbackReject) {
        const error = new Error(ROLLBACK_MESSAGE)
        error.stack = ROLLBACK_STACK
        throw error
      }
    },
    destroy() {
      events.push('destroy')
    },
    release() {
      events.push('release')
    }
  }
}

function createConflictStore(connection, options = {}) {
  return createIdentityStore({
    pool: { getConnection: async () => connection },
    phoneHashSecret: 'phone-secret-private-sentinel',
    campaignPhoneIdentityFactory: async () => ({
      campaignPhoneIdentityHash: Buffer.alloc(32, 0x2a),
      hashVersion: 'v1'
    }),
    identityConflictDiagnosticEnv: options.env || { IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED: 'true' },
    identityConflictDiagnosticLogger: options.logger,
    identityConflictDiagnosticRandomUUID: () => MARKER
  })
}

async function resolveConflict(store) {
  let rejectedError = null
  try {
    await store.resolveWechatPhoneIdentity({
      openid: OPENID_REQUEST,
      unionid: A_UNIONID,
      phone: { purePhoneNumber: PHONE_NUMBER, countryCode: '86' },
      token: TOKEN,
      code: CODE,
      session_key: SESSION_KEY
    })
  } catch (error) {
    rejectedError = error
  }
  assert(rejectedError)
  assert.equal(rejectedError.code, 'IDENTITY_CONFLICT')
  assert.equal(rejectedError.statusCode, 409)
  return rejectedError
}

function createDuplicateTriggerConnection() {
  const events = []
  return {
    events,
    async beginTransaction() {
      events.push('begin')
    },
    async query(sql) {
      if (sql.includes('SHOW COLUMNS FROM `user_phone_bindings`')) {
        return [[
          { Field: 'campaign_phone_identity_hash', Type: 'binary(32)', Extra: '' },
          { Field: 'campaign_phone_hash_version', Type: 'varchar(16)', Extra: '' }
        ]]
      }
      return [[]]
    },
    async execute(sql) {
      if (sql.includes('WHERE openid = ?')) {
        return [[{ user_id: A_ID, openid: OPENID_DATABASE, unionid: A_UNIONID }]]
      }
      if (sql.includes('WHERE phone_hash = ?')) return [[]]
      if (sql.startsWith('INSERT INTO `user_phone_bindings`')) {
        const error = new Error('duplicate-private-sentinel')
        error.code = 'ER_DUP_ENTRY'
        throw error
      }
      throw new Error('Unexpected duplicate trigger operation.')
    },
    async commit() {
      events.push('commit')
    },
    async rollback() {
      events.push('rollback')
    },
    release() {
      events.push('release')
    }
  }
}

async function testIdentityStoreIntegration() {
  const logs = []
  const connection = createIdentityConnection({
    bUnionids: [A_UNIONID],
    businessRows: [createBusinessRow(), createBusinessRow()]
  })
  const error = await resolveConflict(createConflictStore(connection, {
    logger: (line) => {
      connection.events.push('log')
      logs.push(line)
    }
  }))
  assert.equal(logs.length, 1)
  assert.equal(error.diagnosticMarker, MARKER)
  assert.match(logs[0], new RegExp(`OPERATION_MARKER=${error.diagnosticMarker}`))
  assert.equal(connection.diagnosticCalls.length, 4)
  assert.deepEqual(connection.events.slice(-3), ['rollback', 'log', 'release'])

  const disabledLogs = []
  const disabledConnection = createIdentityConnection()
  const disabledError = await resolveConflict(createConflictStore(disabledConnection, {
    env: {},
    logger: (line) => disabledLogs.push(line)
  }))
  assert.equal(disabledConnection.diagnosticCalls.length, 0)
  assert.equal(disabledLogs.length, 0)
  assert.equal(Object.prototype.hasOwnProperty.call(disabledError, 'diagnosticMarker'), false)
  assert.deepEqual(disabledConnection.events.slice(-2), ['rollback', 'release'])

  const failedConnection = createIdentityConnection({ failSelect: true })
  const failedError = await resolveConflict(createConflictStore(failedConnection, {
    logger: () => assert.fail('failed diagnostic must not log')
  }))
  assert.equal(Object.prototype.hasOwnProperty.call(failedError, 'diagnosticMarker'), false)
  assert.deepEqual(failedConnection.events.slice(-2), ['rollback', 'release'])

  const loggerFailureConnection = createIdentityConnection()
  const loggerFailureError = await resolveConflict(createConflictStore(loggerFailureConnection, {
    logger: async () => {
      throw new Error('private logger failure sentinel')
    }
  }))
  assert.equal(Object.prototype.hasOwnProperty.call(loggerFailureError, 'diagnosticMarker'), false)
  assert.deepEqual(loggerFailureConnection.events.slice(-2), ['rollback', 'release'])
}

async function testSubsequentConflictDoesNotReceiveMarker() {
  const logs = []
  const connection = createIdentityConnection({
    bUnionids: [A_UNIONID],
    businessRows: [createBusinessRow(), createBusinessRow()]
  })
  const store = createConflictStore(connection, {
    logger: (line) => logs.push(line)
  })
  const firstError = await resolveConflict(store)
  const secondError = await resolveConflict(store)
  assert.equal(firstError.diagnosticMarker, MARKER)
  assert.equal(Object.prototype.hasOwnProperty.call(secondError, 'diagnosticMarker'), false)
  assert.equal(logs.length, 1)
  assert.match(logs[0], new RegExp(`OPERATION_MARKER=${firstError.diagnosticMarker}`))
}

async function testConcurrentConflictsHaveAtMostOneMatchingMarker() {
  const connections = [
    createIdentityConnection({
      bUnionids: [A_UNIONID],
      businessRows: [createBusinessRow(), createBusinessRow()]
    }),
    createIdentityConnection({
      bUnionids: [A_UNIONID],
      businessRows: [createBusinessRow(), createBusinessRow()]
    })
  ]
  const logs = []
  const store = createIdentityStore({
    pool: { getConnection: async () => connections.shift() },
    phoneHashSecret: 'phone-secret-private-sentinel',
    campaignPhoneIdentityFactory: async () => ({
      campaignPhoneIdentityHash: Buffer.alloc(32, 0x2a),
      hashVersion: 'v1'
    }),
    identityConflictDiagnosticEnv: { IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED: 'true' },
    identityConflictDiagnosticLogger: (line) => logs.push(line),
    identityConflictDiagnosticRandomUUID: () => MARKER
  })
  const errors = await Promise.all([resolveConflict(store), resolveConflict(store)])
  const markedErrors = errors.filter((error) => Object.prototype.hasOwnProperty.call(error, 'diagnosticMarker'))
  assert.equal(markedErrors.length, 1)
  assert.equal(logs.length, 1)
  assert.match(logs[0], new RegExp(`OPERATION_MARKER=${markedErrors[0].diagnosticMarker}`))
}

async function testRollbackRejectPreservesConflictAndDisposesConnection() {
  const logs = []
  const connection = createIdentityConnection({
    rollbackReject: true,
    bUnionids: [A_UNIONID],
    businessRows: [createBusinessRow(), createBusinessRow()]
  })
  const error = await resolveConflict(createConflictStore(connection, {
    logger: (line) => logs.push(line)
  }))
  assert.equal(error.code, 'IDENTITY_CONFLICT')
  assert.equal(error.statusCode, 409)
  assert.equal(error.diagnosticMarker, MARKER)
  assert.equal(logs.length, 1)
  assert.deepEqual(connection.events.slice(-2), ['rollback', 'destroy'])
  assert(connection.events.includes('destroy'))
  assert.equal(connection.events.includes('release'), false)
  for (const sentinel of FORBIDDEN_SENTINELS) {
    assert.equal(logs.join('\n').includes(sentinel), false)
  }
}

async function testRetryRollbackRejectPreservesConflictAndDisposesConnection() {
  const firstConnection = createDuplicateTriggerConnection()
  const retryConnection = createIdentityConnection({
    rollbackReject: true,
    bUnionids: [A_UNIONID],
    businessRows: [createBusinessRow(), createBusinessRow()]
  })
  const connections = [firstConnection, retryConnection]
  const logs = []
  const store = createIdentityStore({
    pool: { getConnection: async () => connections.shift() },
    phoneHashSecret: 'phone-secret-private-sentinel',
    campaignPhoneIdentityFactory: async () => ({
      campaignPhoneIdentityHash: Buffer.alloc(32, 0x2a),
      hashVersion: 'v1'
    }),
    identityConflictDiagnosticEnv: { IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED: 'true' },
    identityConflictDiagnosticLogger: (line) => logs.push(line),
    identityConflictDiagnosticRandomUUID: () => MARKER
  })
  const error = await resolveConflict(store)
  assert.equal(error.code, 'IDENTITY_CONFLICT')
  assert.equal(error.diagnosticMarker, MARKER)
  assert.deepEqual(firstConnection.events.slice(-2), ['rollback', 'release'])
  assert(retryConnection.events.includes('destroy'))
  assert.equal(retryConnection.events.includes('release'), false)
  assert.equal(logs.length, 1)
  for (const sentinel of FORBIDDEN_SENTINELS) {
    assert.equal(logs.join('\n').includes(sentinel), false)
  }
}

async function testLoggerErrorPrivacy() {
  const connection = createIdentityConnection({
    bUnionids: [A_UNIONID],
    businessRows: [createBusinessRow(), createBusinessRow()]
  })
  const logs = []
  const error = await resolveConflict(createConflictStore(connection, {
    logger: async (line) => {
      logs.push(line)
      const error = new Error(LOGGER_MESSAGE)
      error.stack = LOGGER_STACK
      throw error
    }
  }))
  assert.equal(logs.length, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(error, 'diagnosticMarker'), false)
  for (const sentinel of FORBIDDEN_SENTINELS) {
    assert.equal(logs.join('\n').includes(sentinel), false)
  }
}

await testStrictDefaultOff()
await testSameIdentityDoesNothing()
await testFixedLineAndBusinessClassification()
await testNullSafeEntitlementClassification()
await testUnionidOutcomes()
await testSingleUseAndConcurrency()
await testSelectAndLoggerFailuresAreContained()
await testIdentityStoreIntegration()
await testSubsequentConflictDoesNotReceiveMarker()
await testConcurrentConflictsHaveAtMostOneMatchingMarker()
await testRollbackRejectPreservesConflictAndDisposesConnection()
await testRetryRollbackRejectPreservesConflictAndDisposesConnection()
await testLoggerErrorPrivacy()

console.log('identity conflict diagnostic tests passed')
