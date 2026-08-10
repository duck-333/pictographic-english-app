import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  generateBookBenefitRedemptionCode,
  hashBookBenefitRedemptionCode
} from '../server/book-benefit-code.mjs'
import { createManualExceptionIssuanceClaimHash } from '../server/book-benefit-foundation.mjs'
import { createBookBenefitStore } from '../server/book-benefit-store.mjs'

const NOW = new Date('2026-08-09T03:04:05.000Z')
const ORDER_SECRET = 'fake-book-benefit-order-secret-32-bytes-for-tests-only'
const CODE_SECRET = 'fake-redemption-code-secret-32-bytes-for-tests-only'
const ORDER_NUMBER = 'FAKE-ORDER-900001'
const SECRET_ENV = {
  BOOK_ORDER_CLAIM_HASH_SECRET: ORDER_SECRET,
  CAMPAIGN_PHONE_IDENTITY_HASH_SECRET: 'different-fake-campaign-secret-32-bytes',
  JWT_SECRET: 'different-fake-jwt-secret-32-bytes',
  ADMIN_API_TOKEN: 'different-fake-admin-token-32-bytes',
  WECHAT_MINIAPP_SECRET: 'different-fake-wechat-secret-32-bytes'
}

function cloneValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object') return cloneRecord(value)
  return value
}

function cloneRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, cloneValue(value)]))
}

function cloneDatabase(database) {
  return {
    campaigns: database.campaigns.map(cloneRecord),
    issuances: database.issuances.map(cloneRecord),
    codes: database.codes.map(cloneRecord),
    audits: database.audits.map(cloneRecord),
    nextIssuanceId: database.nextIssuanceId,
    nextCodeId: database.nextCodeId,
    nextAuditId: database.nextAuditId
  }
}

function createDatabase(overrides = {}) {
  return {
    campaigns: overrides.campaigns || [{
      id: '1',
      campaign_key: 'book-benefit-30d-v1',
      name: '购书用户30天会员福利',
      status: 'active',
      benefit_days: 30,
      starts_at: new Date('2026-08-01T00:00:00.000Z'),
      ends_at: new Date('2026-09-01T00:00:00.000Z'),
      rules_version: 'book-benefit-rules-v1'
    }],
    issuances: overrides.issuances || [],
    codes: overrides.codes || [],
    audits: overrides.audits || [],
    nextIssuanceId: overrides.nextIssuanceId || 101,
    nextCodeId: overrides.nextCodeId || 201,
    nextAuditId: overrides.nextAuditId || 301
  }
}

function parseInsertColumns(sql) {
  const match = sql.match(/\(([^)]+)\)\s+VALUES/i)
  assert(match)
  return match[1].split(',').map((value) => value.replace(/[`\s]/g, ''))
}

function rowFromInsert(sql, values) {
  const columns = parseInsertColumns(sql)
  assert.equal(columns.length, values.length)
  return Object.fromEntries(columns.map((column, index) => [column, cloneValue(values[index])]))
}

function duplicateError(indexName) {
  const error = new Error('fake duplicate entry')
  error.code = 'ER_DUP_ENTRY'
  error.constraint = indexName
  return error
}

function createFakeConnection(sharedDatabase, scenario = {}) {
  let transactionDatabase = null
  const calls = []
  const counters = { begin: 0, commit: 0, rollback: 0, release: 0 }
  const activeDatabase = () => transactionDatabase || sharedDatabase

  function maybeFail(step) {
    if (scenario.failStep === step) throw new Error(`fake ${step} failure`)
    if (scenario.duplicateStep === step) throw duplicateError(scenario.duplicateIndex)
  }

  return {
    calls,
    counters,
    async beginTransaction() {
      counters.begin += 1
      transactionDatabase = cloneDatabase(sharedDatabase)
      calls.push({ type: 'begin' })
      maybeFail('begin')
    },
    async commit() {
      counters.commit += 1
      calls.push({ type: 'commit' })
      if (scenario.beforeCommit) scenario.beforeCommit()
      maybeFail('commit')
      Object.assign(sharedDatabase, cloneDatabase(transactionDatabase))
      transactionDatabase = null
    },
    async rollback() {
      counters.rollback += 1
      calls.push({ type: 'rollback' })
      transactionDatabase = null
      if (scenario.rollbackError) throw scenario.rollbackError
      maybeFail('rollback')
    },
    release() {
      counters.release += 1
      calls.push({ type: 'release' })
      if (scenario.releaseError) throw scenario.releaseError
    },
    async query(sql) {
      calls.push({ type: 'query', sql, values: [] })
      throw new Error('Issuance must not query identity schema')
    },
    async execute(sql, values = []) {
      const savedValues = values.map(cloneValue)
      calls.push({ type: 'execute', sql, values: savedValues })
      const compact = sql.replace(/\s+/g, ' ').trim()
      const database = activeDatabase()

      if (/FROM book_benefit_issuances WHERE create_idempotency_key = \?/i.test(compact)) {
        const row = database.issuances.find((item) => item.create_idempotency_key === values[0])
        return [row ? [cloneRecord(row)] : []]
      }
      if (/FROM book_benefit_codes WHERE issue_idempotency_key = \?/i.test(compact)) {
        const row = database.codes.find((item) => item.issue_idempotency_key === values[0])
        return [row ? [cloneRecord(row)] : []]
      }
      if (/FROM book_benefit_audit_events WHERE event_id = \?/i.test(compact)) {
        const row = database.audits.find((item) => item.event_id === values[0])
        return [row ? [cloneRecord(row)] : []]
      }
      if (/FROM book_benefit_campaigns/i.test(compact)) {
        maybeFail('campaign')
        const row = database.campaigns.find((item) =>
          /campaign_key = \?/i.test(compact)
            ? item.campaign_key === values[0]
            : String(item.id) === String(values[0])
        )
        return [row ? [cloneRecord(row)] : []]
      }
      if (/INSERT INTO book_benefit_issuances/i.test(compact)) {
        maybeFail('issuance')
        const row = rowFromInsert(sql, values)
        if (row.approved_order_claim_hash && database.issuances.some((item) =>
          String(item.campaign_id) === String(row.campaign_id) &&
          item.approved_order_claim_hash &&
          Buffer.from(item.approved_order_claim_hash).equals(row.approved_order_claim_hash)
        )) {
          throw duplicateError('uk_book_benefit_issuances_campaign_order')
        }
        if (database.issuances.some((item) =>
          item.create_idempotency_key === row.create_idempotency_key
        )) {
          throw duplicateError('uk_book_benefit_issuances_idempotency')
        }
        row.id = String(database.nextIssuanceId++)
        database.issuances.push(row)
        return [{ insertId: row.id, affectedRows: 1 }]
      }
      if (/UPDATE book_benefit_issuances/i.test(compact)) {
        maybeFail('issuance_update')
        const issuanceId = String(values[3])
        const row = database.issuances.find((item) => String(item.id) === issuanceId)
        if (!row || row.status !== 'approved' || row.approved_order_claim_hash !== null) return [{ affectedRows: 0 }]
        Object.assign(row, {
          approved_order_claim_hash: cloneValue(values[0]),
          order_claim_hash_version: values[1],
          updated_at: cloneValue(values[2])
        })
        return [{ affectedRows: 1 }]
      }
      if (/INSERT INTO book_benefit_codes/i.test(compact)) {
        maybeFail('code')
        const row = rowFromInsert(sql, values)
        row.id = String(database.nextCodeId++)
        database.codes.push(row)
        return [{ insertId: row.id, affectedRows: 1 }]
      }
      if (/INSERT INTO book_benefit_audit_events/i.test(compact)) {
        maybeFail('audit')
        const row = rowFromInsert(sql, values)
        row.id = String(database.nextAuditId++)
        database.audits.push(row)
        return [{ insertId: row.id, affectedRows: 1 }]
      }

      throw new Error(`Unexpected fake SQL: ${compact.slice(0, 100)}`)
    }
  }
}

function createFakePool(database, scenario = {}) {
  const connections = []
  return {
    connections,
    async getConnection() {
      const connection = createFakeConnection(database, scenario)
      connections.push(connection)
      return connection
    }
  }
}

function createStore(database, scenario = {}) {
  const pool = createFakePool(database, scenario)
  return {
    pool,
    store: createBookBenefitStore({
      pool,
      orderClaimHashSecret: ORDER_SECRET,
      redemptionCodeHashSecret: CODE_SECRET,
      secretEnv: SECRET_ENV
    })
  }
}

function standardInput(overrides = {}) {
  return {
    orderClaimType: 'standard',
    orderChannel: 'taobao',
    orderNumber: ORDER_NUMBER,
    sellerVerificationCode: 'official_store',
    customerServiceChannel: 'taobao_cs',
    operatorId: 'admin-1',
    operationId: 'issue-operation-1',
    now: NOW,
    ...overrides
  }
}

function manualInput(overrides = {}) {
  return {
    orderClaimType: 'manual_exception',
    manualExceptionReasonCode: 'historical_evidence_unavailable',
    sellerVerificationCode: 'unverified',
    customerServiceChannel: 'wechat_official_cs',
    operatorId: 'admin-1',
    operationId: 'manual-operation-1',
    now: NOW,
    ...overrides
  }
}

function assertConnectionLifecycle(connection, expected) {
  assert.deepEqual(connection.counters, expected)
  assert(connection.counters.release <= 1)
}

function assertReturnWhitelist(result, includesPlaintext) {
  const expectedKeys = [
    'campaignId',
    'codeExpiresAt',
    'codeId',
    'issuanceId',
    'issuanceNo',
    'status'
  ]
  if (includesPlaintext) expectedKeys.push('plaintextCode')
  assert.deepEqual(Object.keys(result).sort(), expectedKeys.sort())
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(ORDER_NUMBER), false)
  assert.equal(serialized.includes(CODE_SECRET), false)
  assert.equal(serialized.includes(ORDER_SECRET), false)
}

function allExecuteCalls(pool) {
  return pool.connections.flatMap((connection) => connection.calls)
    .filter((call) => call.type === 'execute')
}

function assertNoSensitivePersistentValues(pool, plaintextCode) {
  for (const call of allExecuteCalls(pool)) {
    for (const value of call.values) {
      if (typeof value !== 'string') continue
      assert.equal(value.includes(ORDER_NUMBER), false)
      assert.equal(value.includes(plaintextCode), false)
      assert.equal(value.includes(CODE_SECRET), false)
      assert.equal(value.includes(ORDER_SECRET), false)
    }
  }
}

async function testCodePrimitive() {
  const generatedCodes = new Set(Array.from({ length: 64 }, () => generateBookBenefitRedemptionCode()))
  assert.equal(generatedCodes.size, 64)
  for (const generatedCode of generatedCodes) {
    assert.match(generatedCode, /^BF30-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-){3}[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  }
  const [code] = generatedCodes
  const identity = hashBookBenefitRedemptionCode(code.toLowerCase().replaceAll('-', ''), {
    secret: CODE_SECRET,
    env: SECRET_ENV
  })
  assert(Buffer.isBuffer(identity.codeHash))
  assert.equal(identity.codeHash.length, 32)
  assert.equal(identity.hashVersion, 'v1')
  const expected = crypto
    .createHmac('sha256', CODE_SECRET)
    .update(`book-benefit-redemption-code:v1|${code}`)
    .digest()
  assert.deepEqual(identity.codeHash, expected)

  assert.throws(
    () => hashBookBenefitRedemptionCode(code, { env: {} }),
    (error) => error.code === 'REDEMPTION_CODE_HASH_SECRET_MISSING'
  )
  assert.throws(
    () => hashBookBenefitRedemptionCode(code, { secret: 'short', env: {} }),
    (error) => error.code === 'REDEMPTION_CODE_HASH_SECRET_TOO_SHORT'
  )
  for (const secretName of Object.keys(SECRET_ENV)) {
    assert.throws(
      () => hashBookBenefitRedemptionCode(code, {
        secret: CODE_SECRET,
        env: { [secretName]: CODE_SECRET }
      }),
      (error) => error.code === 'REDEMPTION_CODE_HASH_SECRET_REUSED'
    )
  }
}

async function testStandardSuccess() {
  const database = createDatabase()
  let settled = false
  const { store, pool } = createStore(database, {
    beforeCommit() {
      assert.equal(settled, false)
    }
  })
  const promise = store.issueUnassignedBookBenefitCode(standardInput())
  promise.finally(() => { settled = true })
  const result = await promise
  assert.equal(settled, true)
  assert.equal(result.status, 'issued')
  assert.match(result.plaintextCode, /^BF30-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-){3}[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  assert.equal(result.codeExpiresAt.getTime() - NOW.getTime(), 30 * 24 * 60 * 60 * 1000)
  assertReturnWhitelist(result, true)

  assert.equal(database.issuances.length, 1)
  assert.equal(database.codes.length, 1)
  assert.equal(database.audits.length, 1)
  const issuance = database.issuances[0]
  assert.equal(issuance.status, 'approved')
  assert.equal(issuance.order_claim_type, 'standard')
  assert.equal(issuance.order_channel, 'taobao')
  assert.equal(issuance.qualification_rules_version, 'book-benefit-rules-v1')
  assert.equal(issuance.reviewed_by, 'admin-1')
  assert.deepEqual(issuance.reviewed_at, NOW)
  assert.equal(issuance.seller_verification_code, 'official_store')
  assert.equal(issuance.customer_service_channel, 'taobao_cs')
  assert(Buffer.isBuffer(issuance.approved_order_claim_hash))
  assert.equal(issuance.approved_order_claim_hash.length, 32)
  assert.equal(issuance.create_idempotency_key, 'issue-operation-1')
  const code = database.codes[0]
  assert.equal(code.generation_no, 1)
  assert.equal(code.status, 'issued')
  assert(Buffer.isBuffer(code.code_hash))
  assert.equal(code.code_hash.length, 32)
  assert.equal(code.code_hash_version, 'v1')
  assert.equal(code.replacement_code_id, null)
  assert.equal(code.issue_idempotency_key, 'issue-operation-1')
  assert.equal(code.issued_by, 'admin-1')
  assert.equal(database.audits[0].event_type, 'unassigned_code_issued')
  assert.match(database.audits[0].event_id, /^bbev_[a-f0-9]{59}$/)
  assert.equal(database.audits[0].actor_type, 'admin')
  assert.equal(database.audits[0].actor_id, 'admin-1')
  assert.equal(database.audits[0].result, 'succeeded')
  assert.equal(database.audits[0].reason_code, null)
  assert.equal(Object.values(database.audits[0]).some(Buffer.isBuffer), false)
  assertNoSensitivePersistentValues(pool, result.plaintextCode)
  const sqlText = allExecuteCalls(pool).map((call) => call.sql).join('\n')
  assert.doesNotMatch(sqlText, /membership_grants|entitlement_transactions|user_entitlements|quota/i)
  assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 1, rollback: 0, release: 1 })
}

async function testManualSuccess() {
  const database = createDatabase()
  const { store, pool } = createStore(database)
  const result = await store.issueUnassignedBookBenefitCode(manualInput())
  const issuance = database.issuances[0]
  assert.equal(issuance.id, result.issuanceId)
  assert.equal(issuance.status, 'approved')
  assert.equal(issuance.order_claim_type, 'manual_exception')
  assert.equal(issuance.order_channel, null)
  assert.equal(issuance.review_reason_code, 'historical_evidence_unavailable')
  assert.equal(issuance.reviewed_by, 'admin-1')
  assert.deepEqual(issuance.reviewed_at, NOW)
  assert.equal(issuance.seller_verification_code, 'unverified')
  assert.equal(issuance.customer_service_channel, 'wechat_official_cs')
  const expectedClaim = createManualExceptionIssuanceClaimHash({
    campaignId: '1',
    issuanceId: result.issuanceId
  }, {
    secret: ORDER_SECRET,
    env: SECRET_ENV
  })
  assert.deepEqual(issuance.approved_order_claim_hash, expectedClaim.orderClaimHash)
  assert.equal(database.audits[0].reason_code, 'historical_evidence_unavailable')
  const transactionCallTypes = pool.connections[0].calls.map((call) => call.type)
  assert(transactionCallTypes.indexOf('commit') > transactionCallTypes.findIndex(
    (type, index) => type === 'execute' && index > 0
  ))
  assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 1, rollback: 0, release: 1 })
}

async function testIssuanceDoesNotUseIdentityLookup() {
  const database = createDatabase()
  const { store, pool } = createStore(database)
  await store.issueUnassignedBookBenefitCode(standardInput())
  const calls = pool.connections[0].calls
  assert.equal(calls.some((call) => call.type === 'query'), false)
  assert.equal(calls.some((call) => /user_phone_bindings|phone_hash|applicant/i.test(call.sql || '')), false)
}

async function testCampaignFailures() {
  const cases = [
    [[], 'BOOK_BENEFIT_CAMPAIGN_NOT_FOUND'],
    [[{ ...createDatabase().campaigns[0], status: 'paused' }], 'BOOK_BENEFIT_CAMPAIGN_NOT_ACTIVE'],
    [[{ ...createDatabase().campaigns[0], starts_at: new Date('2026-08-10T00:00:00.000Z') }], 'BOOK_BENEFIT_CAMPAIGN_NOT_STARTED'],
    [[{ ...createDatabase().campaigns[0], ends_at: new Date('2026-08-09T00:00:00.000Z') }], 'BOOK_BENEFIT_CAMPAIGN_ENDED'],
    [[{ ...createDatabase().campaigns[0], benefit_days: 31 }], 'BOOK_BENEFIT_CAMPAIGN_CONFIG_INVALID']
  ]
  for (const [campaigns, code] of cases) {
    const database = createDatabase({ campaigns })
    const { store, pool } = createStore(database)
    await assert.rejects(
      () => store.issueUnassignedBookBenefitCode(standardInput()),
      (error) => error.code === code
    )
    assert.equal(database.issuances.length, 0)
    assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 0, rollback: 1, release: 1 })
  }
}

async function testAtomicFailures() {
  for (const failStep of ['issuance', 'issuance_update', 'code', 'audit']) {
    const database = createDatabase()
    const { store, pool } = createStore(database, { failStep })
    const input = failStep === 'issuance_update' ? manualInput() : standardInput()
    await assert.rejects(() => store.issueUnassignedBookBenefitCode(input))
    assert.equal(database.issuances.length, 0)
    assert.equal(database.codes.length, 0)
    assert.equal(database.audits.length, 0)
    assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 0, rollback: 1, release: 1 })
  }
}

async function testIdempotentReplay() {
  const database = createDatabase()
  const { store, pool } = createStore(database)
  const first = await store.issueUnassignedBookBenefitCode(standardInput())
  const replay = await store.issueUnassignedBookBenefitCode(standardInput())
  assert.equal(replay.status, 'ISSUED_CODE_PLAINTEXT_UNAVAILABLE')
  assert.equal(Object.hasOwn(replay, 'plaintextCode'), false)
  assert.equal(replay.issuanceId, first.issuanceId)
  assert.equal(replay.codeId, first.codeId)
  assert.equal(database.issuances.length, 1)
  assert.equal(database.codes.length, 1)
  assert.equal(database.audits.length, 1)
  assertReturnWhitelist(replay, false)
  assert.equal(allExecuteCalls({ connections: [pool.connections[1]] }).some(
    (call) => /INSERT INTO book_benefit_(issuances|codes|audit_events)/i.test(call.sql)
  ), false)
  assertConnectionLifecycle(pool.connections[1], { begin: 1, commit: 1, rollback: 0, release: 1 })
}

async function testDuplicateConflicts() {
  const cases = [
    ['issuance', 'uk_book_benefit_issuances_campaign_order', 'BOOK_BENEFIT_ORDER_CONFLICT'],
    ['code', 'uk_book_benefit_codes_hash', 'BOOK_BENEFIT_CODE_HASH_CONFLICT'],
    ['issuance', 'unknown_unique_index', 'BOOK_BENEFIT_CONCURRENT_CONFLICT']
  ]
  for (const [duplicateStep, duplicateIndex, expectedCode] of cases) {
    const database = createDatabase()
    const { store, pool } = createStore(database, { duplicateStep, duplicateIndex })
    await assert.rejects(
      () => store.issueUnassignedBookBenefitCode(standardInput()),
      (error) => error.code === expectedCode && !error.message.includes(duplicateIndex)
    )
    assert.equal(database.issuances.length, 0)
    assert.equal(database.codes.length, 0)
    assert.equal(database.audits.length, 0)
    assert.equal(pool.connections.length, 1)
    assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 0, rollback: 1, release: 1 })
  }
}

async function testRealUniqueConstraintConflicts() {
  const orderConflictDatabase = createDatabase()
  const orderConflict = createStore(orderConflictDatabase)
  await orderConflict.store.issueUnassignedBookBenefitCode(standardInput())
  await assert.rejects(
    () => orderConflict.store.issueUnassignedBookBenefitCode(standardInput({
      operationId: 'second-order-operation'
    })),
    (error) => error.code === 'BOOK_BENEFIT_ORDER_CONFLICT'
  )
  assert.equal(orderConflictDatabase.issuances.length, 1)

  const differentOrder = await orderConflict.store.issueUnassignedBookBenefitCode(standardInput({
    operationId: 'different-order-operation',
    orderNumber: 'FAKE-ORDER-900002'
  }))
  assert.equal(differentOrder.status, 'issued')
  assert.equal(orderConflictDatabase.issuances.length, 2)
}

async function testConnectionErrorPriority() {
  const committedDatabase = createDatabase()
  const releaseError = new Error('fake release failure')
  const committed = createStore(committedDatabase, { releaseError })
  await assert.rejects(
    () => committed.store.issueUnassignedBookBenefitCode(standardInput()),
    (error) => error === releaseError
  )
  assert.equal(committedDatabase.issuances.length, 1)
  assertConnectionLifecycle(committed.pool.connections[0], {
    begin: 1,
    commit: 1,
    rollback: 0,
    release: 1
  })

  const failedDatabase = createDatabase()
  const failed = createStore(failedDatabase, { failStep: 'code', releaseError })
  await assert.rejects(
    () => failed.store.issueUnassignedBookBenefitCode(standardInput()),
    (error) => error.message === 'fake code failure'
  )
  assertConnectionLifecycle(failed.pool.connections[0], {
    begin: 1,
    commit: 0,
    rollback: 1,
    release: 1
  })

  const commitDatabase = createDatabase()
  const commitFailed = createStore(commitDatabase, { failStep: 'commit' })
  await assert.rejects(
    () => commitFailed.store.issueUnassignedBookBenefitCode(standardInput()),
    (error) => error.message === 'fake commit failure'
  )
  assert.equal(commitDatabase.issuances.length, 0)
  assertConnectionLifecycle(commitFailed.pool.connections[0], {
    begin: 1,
    commit: 1,
    rollback: 1,
    release: 1
  })

  const rollbackDatabase = createDatabase()
  const rollbackError = new Error('fake rollback failure')
  const rollbackFailed = createStore(rollbackDatabase, {
    failStep: 'code',
    rollbackError,
    releaseError
  })
  await assert.rejects(
    () => rollbackFailed.store.issueUnassignedBookBenefitCode(standardInput()),
    (error) => error.message === 'fake code failure'
  )
  assertConnectionLifecycle(rollbackFailed.pool.connections[0], {
    begin: 1,
    commit: 0,
    rollback: 1,
    release: 1
  })
}

async function testSafeInputAndLogging() {
  const prohibitedFields = [
    'userId',
    'locator',
    'phone',
    'phoneHash',
    'campaignPhoneIdentityHash',
    'applicantPhoneIdentityHash',
    'codeHash',
    'issuanceId',
    'codeId',
    'plaintextCode',
    'reviewedAt',
    'auditEventId'
  ]
  for (const field of prohibitedFields) {
    const database = createDatabase()
    const { store, pool } = createStore(database)
    await assert.rejects(() => store.issueUnassignedBookBenefitCode(standardInput({ [field]: 'fake-value' })))
    assert.equal(pool.connections.length, 0)
  }
  for (const invalidInput of [
    standardInput({ orderChannel: ['taobao'] }),
    standardInput({ sellerVerificationCode: ['official_store'] }),
    standardInput({ customerServiceChannel: ['taobao_cs'] }),
    standardInput({ operatorId: ['admin-1'] }),
    standardInput({ operationId: ['issue-operation-1'] }),
    standardInput({ orderNumber: ['FAKE-ORDER-900001'] })
  ]) {
    const database = createDatabase()
    const { store, pool } = createStore(database)
    await assert.rejects(() => store.issueUnassignedBookBenefitCode(invalidInput))
    assert.equal(pool.connections.length, 0)
  }

  const captured = []
  const originalMethods = Object.fromEntries(
    ['log', 'info', 'warn', 'error'].map((name) => [name, console[name]])
  )
  for (const name of Object.keys(originalMethods)) {
    console[name] = (...values) => captured.push(values.join(' '))
  }
  let successResult = null
  let successDatabase = null
  try {
    successDatabase = createDatabase()
    successResult = await createStore(successDatabase).store.issueUnassignedBookBenefitCode(standardInput())
    const failureDatabase = createDatabase()
    await assert.rejects(() => createStore(failureDatabase, { failStep: 'audit' })
      .store.issueUnassignedBookBenefitCode(standardInput()))
  } finally {
    for (const [name, method] of Object.entries(originalMethods)) console[name] = method
  }
  const output = captured.join('\n')
  for (const sensitiveValue of [
    ORDER_NUMBER,
    CODE_SECRET,
    ORDER_SECRET
  ]) {
    assert.equal(output.includes(sensitiveValue), false)
  }
  assert.equal(output.includes(successResult.plaintextCode), false)
  assert.equal(output.includes(successDatabase.codes[0].code_hash.toString('hex')), false)
  assert.equal(output.includes(successDatabase.issuances[0].approved_order_claim_hash.toString('hex')), false)
}

await testCodePrimitive()
await testStandardSuccess()
await testManualSuccess()
await testIssuanceDoesNotUseIdentityLookup()
await testCampaignFailures()
await testAtomicFailures()
await testIdempotentReplay()
await testDuplicateConflicts()
await testRealUniqueConstraintConflicts()
await testConnectionErrorPriority()
await testSafeInputAndLogging()

console.log('book-benefit unassigned code issuance tests passed')
