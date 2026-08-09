import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  generateBookBenefitRedemptionCode,
  hashBookBenefitRedemptionCode
} from '../server/book-benefit-code.mjs'
import { createManualExceptionOrderClaimHash } from '../server/book-benefit-foundation.mjs'
import { createBookBenefitStore } from '../server/book-benefit-store.mjs'
import { hashPhone } from '../server/identity-store.mjs'

const NOW = new Date('2026-08-09T03:04:05.000Z')
const PHONE_SECRET = 'fake-book-benefit-phone-secret-for-tests-only'
const ORDER_SECRET = 'fake-book-benefit-order-secret-32-bytes-for-tests-only'
const CODE_SECRET = 'fake-redemption-code-secret-32-bytes-for-tests-only'
const FULL_PHONE = '+86 100 0000 0000'
const ORDER_NUMBER = 'FAKE-ORDER-900001'
const CAMPAIGN_HASH = Buffer.alloc(32, 0x45)
const SECRET_ENV = {
  PHONE_HASH_SECRET: PHONE_SECRET,
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
    phoneBindings: database.phoneBindings.map(cloneRecord),
    applications: database.applications.map(cloneRecord),
    codes: database.codes.map(cloneRecord),
    audits: database.audits.map(cloneRecord),
    nextApplicationId: database.nextApplicationId,
    nextCodeId: database.nextCodeId,
    nextAuditId: database.nextAuditId
  }
}

function createDatabase(overrides = {}) {
  return {
    campaigns: overrides.campaigns || [{
      id: '1',
      status: 'active',
      benefit_days: 30,
      starts_at: new Date('2026-08-01T00:00:00.000Z'),
      ends_at: new Date('2026-09-01T00:00:00.000Z'),
      rules_version: null
    }],
    phoneBindings: overrides.phoneBindings || [{
      id: '11',
      user_id: '10',
      phone_hash: hashPhone(FULL_PHONE, { secret: PHONE_SECRET }).phoneHash,
      phone_masked: '100****0000',
      campaign_phone_identity_hash: Buffer.from(CAMPAIGN_HASH),
      campaign_phone_hash_version: 'v1',
      status: 'active',
      last_verified_at: new Date('2026-08-08T00:00:00.000Z')
    }],
    applications: overrides.applications || [],
    codes: overrides.codes || [],
    audits: overrides.audits || [],
    nextApplicationId: overrides.nextApplicationId || 101,
    nextCodeId: overrides.nextCodeId || 201,
    nextAuditId: overrides.nextAuditId || 301
  }
}

function phoneBindingColumns() {
  return [
    { Field: 'campaign_phone_identity_hash', Type: 'binary(32)', Extra: '' },
    { Field: 'campaign_phone_hash_version', Type: 'varchar(16)', Extra: '' }
  ]
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

function compareLatest(left, right) {
  const timeDifference = new Date(right.last_verified_at).getTime() - new Date(left.last_verified_at).getTime()
  if (timeDifference !== 0) return timeDifference
  return Number(BigInt(right.id) - BigInt(left.id))
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
      assert.match(sql, /SHOW COLUMNS FROM `user_phone_bindings`/)
      return [phoneBindingColumns()]
    },
    async execute(sql, values = []) {
      const savedValues = values.map(cloneValue)
      calls.push({ type: 'execute', sql, values: savedValues })
      const compact = sql.replace(/\s+/g, ' ').trim()
      const database = activeDatabase()

      if (/FROM book_benefit_applications WHERE create_idempotency_key = \?/i.test(compact)) {
        const row = database.applications.find((item) => item.create_idempotency_key === values[0])
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
      if (/FROM `user_phone_bindings`/i.test(compact) && /WHERE phone_hash = \?/i.test(compact)) {
        const row = database.phoneBindings.find(
          (item) => item.status === 'active' && item.phone_hash === values[0]
        )
        return [row ? [{ id: row.id, user_id: row.user_id, phone_hash: row.phone_hash }] : []]
      }
      if (/FROM `user_phone_bindings`/i.test(compact) && /WHERE user_id = \?/i.test(compact)) {
        const row = database.phoneBindings
          .filter((item) => item.status === 'active' && String(item.user_id) === String(values[0]))
          .sort(compareLatest)[0]
        return [row ? [cloneRecord(row)] : []]
      }
      if (/FROM book_benefit_campaigns/i.test(compact)) {
        maybeFail('campaign')
        const row = database.campaigns.find((item) => String(item.id) === String(values[0]))
        return [row ? [cloneRecord(row)] : []]
      }
      if (/INSERT INTO book_benefit_applications/i.test(compact)) {
        maybeFail('application')
        const row = rowFromInsert(sql, values)
        if (database.applications.some((item) =>
          String(item.campaign_id) === String(row.campaign_id) &&
          String(item.applicant_user_id) === String(row.applicant_user_id)
        )) {
          throw duplicateError('uk_book_benefit_applications_campaign_user')
        }
        if (database.applications.some((item) =>
          String(item.campaign_id) === String(row.campaign_id) &&
          Buffer.from(item.applicant_phone_identity_hash).equals(row.applicant_phone_identity_hash)
        )) {
          throw duplicateError('uk_book_benefit_applications_campaign_phone')
        }
        if (row.approved_order_claim_hash && database.applications.some((item) =>
          String(item.campaign_id) === String(row.campaign_id) &&
          item.approved_order_claim_hash &&
          Buffer.from(item.approved_order_claim_hash).equals(row.approved_order_claim_hash)
        )) {
          throw duplicateError('uk_book_benefit_applications_campaign_order')
        }
        if (database.applications.some((item) =>
          item.create_idempotency_key === row.create_idempotency_key
        )) {
          throw duplicateError('uk_book_benefit_applications_idempotency')
        }
        row.id = String(database.nextApplicationId++)
        database.applications.push(row)
        return [{ insertId: row.id, affectedRows: 1 }]
      }
      if (/UPDATE book_benefit_applications/i.test(compact)) {
        maybeFail('application_update')
        const applicationId = String(values[8])
        const row = database.applications.find((item) => String(item.id) === applicationId)
        if (!row || row.status !== values[9]) return [{ affectedRows: 0 }]
        Object.assign(row, {
          order_claim_type: values[0],
          approved_order_claim_hash: cloneValue(values[1]),
          order_claim_hash_version: values[2],
          status: values[3],
          reviewed_by: values[4],
          review_reason_code: values[5],
          reviewed_at: cloneValue(values[6]),
          updated_at: cloneValue(values[7])
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
      phoneHashSecret: PHONE_SECRET,
      orderClaimHashSecret: ORDER_SECRET,
      redemptionCodeHashSecret: CODE_SECRET,
      secretEnv: SECRET_ENV
    })
  }
}

function standardInput(overrides = {}) {
  return {
    campaignId: '1',
    locator: { userId: '10' },
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
    campaignId: '1',
    locator: { userId: '10' },
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
    'applicationId',
    'applicationNo',
    'campaignId',
    'codeExpiresAt',
    'codeId',
    'status',
    'userId'
  ]
  if (includesPlaintext) expectedKeys.push('plaintextCode')
  assert.deepEqual(Object.keys(result).sort(), expectedKeys.sort())
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(FULL_PHONE), false)
  assert.equal(serialized.includes(ORDER_NUMBER), false)
  assert.equal(serialized.includes(CODE_SECRET), false)
  assert.equal(serialized.includes(ORDER_SECRET), false)
  assert.equal(serialized.includes(CAMPAIGN_HASH.toString('hex')), false)
}

function allExecuteCalls(pool) {
  return pool.connections.flatMap((connection) => connection.calls)
    .filter((call) => call.type === 'execute')
}

function assertNoSensitivePersistentValues(pool, plaintextCode) {
  for (const call of allExecuteCalls(pool)) {
    for (const value of call.values) {
      if (typeof value !== 'string') continue
      assert.equal(value.includes(FULL_PHONE), false)
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
  const promise = store.issueApprovedBookBenefitCode(standardInput())
  promise.finally(() => { settled = true })
  const result = await promise
  assert.equal(settled, true)
  assert.equal(result.status, 'issued')
  assert.match(result.plaintextCode, /^BF30-(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-){3}[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  assert.equal(result.codeExpiresAt.getTime() - NOW.getTime(), 30 * 24 * 60 * 60 * 1000)
  assertReturnWhitelist(result, true)

  assert.equal(database.applications.length, 1)
  assert.equal(database.codes.length, 1)
  assert.equal(database.audits.length, 1)
  const application = database.applications[0]
  assert.equal(application.status, 'approved')
  assert.equal(application.order_claim_type, 'standard')
  assert.equal(application.order_channel, 'taobao')
  assert.equal(application.applicant_user_id, '10')
  assert.deepEqual(application.applicant_phone_identity_hash, CAMPAIGN_HASH)
  assert.equal(application.applicant_phone_hash_version, 'v1')
  assert.equal(application.reviewed_by, 'admin-1')
  assert.deepEqual(application.reviewed_at, NOW)
  assert.equal(application.seller_verification_code, 'official_store')
  assert.equal(application.customer_service_channel, 'taobao_cs')
  assert(Buffer.isBuffer(application.approved_order_claim_hash))
  assert.equal(application.approved_order_claim_hash.length, 32)
  assert.equal(application.accepted_rules_version, null)
  assert.equal(application.rules_accepted_at, null)
  assert.equal(application.create_idempotency_key, 'issue-operation-1')
  const code = database.codes[0]
  assert.equal(code.generation_no, 1)
  assert.equal(code.status, 'issued')
  assert(Buffer.isBuffer(code.code_hash))
  assert.equal(code.code_hash.length, 32)
  assert.equal(code.code_hash_version, 'v1')
  assert.equal(code.replacement_code_id, null)
  assert.equal(code.issue_idempotency_key, 'issue-operation-1')
  assert.equal(code.issued_by, 'admin-1')
  assert.equal(database.audits[0].event_type, 'qualification_approved_code_issued')
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
  const result = await store.issueApprovedBookBenefitCode(manualInput())
  const application = database.applications[0]
  assert.equal(application.id, result.applicationId)
  assert.equal(application.status, 'approved')
  assert.equal(application.order_claim_type, 'manual_exception')
  assert.equal(application.order_channel, null)
  assert.equal(application.review_reason_code, 'historical_evidence_unavailable')
  assert.equal(application.reviewed_by, 'admin-1')
  assert.deepEqual(application.reviewed_at, NOW)
  assert.equal(application.seller_verification_code, 'unverified')
  assert.equal(application.customer_service_channel, 'wechat_official_cs')
  assert.equal(application.accepted_rules_version, null)
  assert.equal(application.rules_accepted_at, null)
  const expectedClaim = createManualExceptionOrderClaimHash({
    campaignId: '1',
    applicationId: result.applicationId
  }, {
    secret: ORDER_SECRET,
    env: SECRET_ENV
  })
  assert.deepEqual(application.approved_order_claim_hash, expectedClaim.orderClaimHash)
  assert.equal(database.audits[0].reason_code, 'historical_evidence_unavailable')
  const transactionCallTypes = pool.connections[0].calls.map((call) => call.type)
  assert(transactionCallTypes.indexOf('commit') > transactionCallTypes.findIndex(
    (type, index) => type === 'execute' && index > 0
  ))
  assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 1, rollback: 0, release: 1 })
}

async function testPhoneLocatorUsesTrustedHelper() {
  const database = createDatabase()
  const { store, pool } = createStore(database)
  const result = await store.issueApprovedBookBenefitCode(standardInput({
    locator: { phone: FULL_PHONE },
    operationId: 'phone-locator-operation'
  }))
  assert.equal(result.userId, '10')
  const calls = allExecuteCalls(pool)
  assert(calls.some((call) => /FROM `user_phone_bindings`/.test(call.sql) && /phone_hash/.test(call.sql)))
  assert(calls.some((call) => /ORDER BY last_verified_at DESC, id DESC/.test(call.sql)))
  assert(calls.filter((call) => /FROM `user_phone_bindings`/.test(call.sql)).every(
    (call) => /FOR UPDATE$/.test(call.sql.trim())
  ))
}

async function testCampaignFailures() {
  const cases = [
    [[], 'BOOK_BENEFIT_CAMPAIGN_NOT_FOUND'],
    [[{ ...createDatabase().campaigns[0], status: 'paused' }], 'BOOK_BENEFIT_CAMPAIGN_NOT_ACTIVE'],
    [[{ ...createDatabase().campaigns[0], starts_at: new Date('2026-08-10T00:00:00.000Z') }], 'BOOK_BENEFIT_CAMPAIGN_NOT_STARTED'],
    [[{ ...createDatabase().campaigns[0], ends_at: new Date('2026-08-09T00:00:00.000Z') }], 'BOOK_BENEFIT_CAMPAIGN_ENDED'],
    [[{ ...createDatabase().campaigns[0], benefit_days: 31 }], 'BOOK_BENEFIT_CAMPAIGN_INVALID']
  ]
  for (const [campaigns, code] of cases) {
    const database = createDatabase({ campaigns })
    const { store, pool } = createStore(database)
    await assert.rejects(
      () => store.issueApprovedBookBenefitCode(standardInput()),
      (error) => error.code === code
    )
    assert.equal(database.applications.length, 0)
    assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 0, rollback: 1, release: 1 })
  }
}

async function testAtomicFailures() {
  for (const failStep of ['application', 'application_update', 'code', 'audit']) {
    const database = createDatabase()
    const { store, pool } = createStore(database, { failStep })
    const input = failStep === 'application_update' ? manualInput() : standardInput()
    await assert.rejects(() => store.issueApprovedBookBenefitCode(input))
    assert.equal(database.applications.length, 0)
    assert.equal(database.codes.length, 0)
    assert.equal(database.audits.length, 0)
    assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 0, rollback: 1, release: 1 })
  }
}

async function testIdempotentReplay() {
  const database = createDatabase()
  const { store, pool } = createStore(database)
  const first = await store.issueApprovedBookBenefitCode(standardInput())
  const replay = await store.issueApprovedBookBenefitCode(standardInput())
  assert.equal(replay.status, 'ISSUED_CODE_PLAINTEXT_UNAVAILABLE')
  assert.equal(Object.hasOwn(replay, 'plaintextCode'), false)
  assert.equal(replay.applicationId, first.applicationId)
  assert.equal(replay.codeId, first.codeId)
  assert.equal(database.applications.length, 1)
  assert.equal(database.codes.length, 1)
  assert.equal(database.audits.length, 1)
  assertReturnWhitelist(replay, false)
  assert.equal(allExecuteCalls({ connections: [pool.connections[1]] }).some(
    (call) => /INSERT INTO book_benefit_(applications|codes|audit_events)/i.test(call.sql)
  ), false)
  assertConnectionLifecycle(pool.connections[1], { begin: 1, commit: 1, rollback: 0, release: 1 })
}

async function testDuplicateConflicts() {
  const cases = [
    ['application', 'uk_book_benefit_applications_campaign_user', 'BOOK_BENEFIT_CAMPAIGN_USER_CONFLICT'],
    ['application', 'uk_book_benefit_applications_campaign_phone', 'BOOK_BENEFIT_CAMPAIGN_PHONE_CONFLICT'],
    ['application', 'uk_book_benefit_applications_campaign_order', 'BOOK_BENEFIT_ORDER_CONFLICT'],
    ['code', 'uk_book_benefit_codes_hash', 'BOOK_BENEFIT_CODE_HASH_CONFLICT'],
    ['application', 'unknown_unique_index', 'BOOK_BENEFIT_CONCURRENT_CONFLICT']
  ]
  for (const [duplicateStep, duplicateIndex, expectedCode] of cases) {
    const database = createDatabase()
    const { store, pool } = createStore(database, { duplicateStep, duplicateIndex })
    await assert.rejects(
      () => store.issueApprovedBookBenefitCode(standardInput()),
      (error) => error.code === expectedCode && !error.message.includes(duplicateIndex)
    )
    assert.equal(database.applications.length, 0)
    assert.equal(database.codes.length, 0)
    assert.equal(database.audits.length, 0)
    assert.equal(pool.connections.length, 1)
    assertConnectionLifecycle(pool.connections[0], { begin: 1, commit: 0, rollback: 1, release: 1 })
  }
}

async function testRealUniqueConstraintConflicts() {
  const userConflictDatabase = createDatabase()
  const userConflict = createStore(userConflictDatabase)
  await userConflict.store.issueApprovedBookBenefitCode(standardInput())
  await assert.rejects(
    () => userConflict.store.issueApprovedBookBenefitCode(standardInput({
      operationId: 'second-user-operation',
      orderNumber: 'FAKE-ORDER-900002'
    })),
    (error) => error.code === 'BOOK_BENEFIT_CAMPAIGN_USER_CONFLICT'
  )
  assert.equal(userConflictDatabase.applications.length, 1)

  const secondBinding = {
    id: '12',
    user_id: '20',
    phone_hash: hashPhone('+86 100 0000 0002', { secret: PHONE_SECRET }).phoneHash,
    phone_masked: '100****0002',
    campaign_phone_identity_hash: Buffer.from(CAMPAIGN_HASH),
    campaign_phone_hash_version: 'v1',
    status: 'active',
    last_verified_at: new Date('2026-08-08T00:00:00.000Z')
  }
  const phoneConflictDatabase = createDatabase({
    phoneBindings: [...createDatabase().phoneBindings, secondBinding]
  })
  const phoneConflict = createStore(phoneConflictDatabase)
  await phoneConflict.store.issueApprovedBookBenefitCode(standardInput())
  await assert.rejects(
    () => phoneConflict.store.issueApprovedBookBenefitCode(standardInput({
      locator: { userId: '20' },
      operationId: 'second-phone-operation',
      orderNumber: 'FAKE-ORDER-900003'
    })),
    (error) => error.code === 'BOOK_BENEFIT_CAMPAIGN_PHONE_CONFLICT'
  )
  assert.equal(phoneConflictDatabase.applications.length, 1)

  const distinctBinding = {
    ...secondBinding,
    campaign_phone_identity_hash: Buffer.alloc(32, 0x46)
  }
  const orderConflictDatabase = createDatabase({
    phoneBindings: [...createDatabase().phoneBindings, distinctBinding]
  })
  const orderConflict = createStore(orderConflictDatabase)
  await orderConflict.store.issueApprovedBookBenefitCode(standardInput())
  await assert.rejects(
    () => orderConflict.store.issueApprovedBookBenefitCode(standardInput({
      locator: { userId: '20' },
      operationId: 'second-order-operation'
    })),
    (error) => error.code === 'BOOK_BENEFIT_ORDER_CONFLICT'
  )
  assert.equal(orderConflictDatabase.applications.length, 1)
}

async function testConnectionErrorPriority() {
  const committedDatabase = createDatabase()
  const releaseError = new Error('fake release failure')
  const committed = createStore(committedDatabase, { releaseError })
  await assert.rejects(
    () => committed.store.issueApprovedBookBenefitCode(standardInput()),
    (error) => error === releaseError
  )
  assert.equal(committedDatabase.applications.length, 1)
  assertConnectionLifecycle(committed.pool.connections[0], {
    begin: 1,
    commit: 1,
    rollback: 0,
    release: 1
  })

  const failedDatabase = createDatabase()
  const failed = createStore(failedDatabase, { failStep: 'code', releaseError })
  await assert.rejects(
    () => failed.store.issueApprovedBookBenefitCode(standardInput()),
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
    () => commitFailed.store.issueApprovedBookBenefitCode(standardInput()),
    (error) => error.message === 'fake commit failure'
  )
  assert.equal(commitDatabase.applications.length, 0)
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
    () => rollbackFailed.store.issueApprovedBookBenefitCode(standardInput()),
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
    'applicantPhoneIdentityHash',
    'codeHash',
    'applicationId',
    'codeId',
    'plaintextCode',
    'reviewedAt',
    'auditEventId'
  ]
  for (const field of prohibitedFields) {
    const database = createDatabase()
    const { store, pool } = createStore(database)
    await assert.rejects(() => store.issueApprovedBookBenefitCode(standardInput({ [field]: 'fake-value' })))
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
    await assert.rejects(() => store.issueApprovedBookBenefitCode(invalidInput))
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
    successResult = await createStore(successDatabase).store.issueApprovedBookBenefitCode(standardInput())
    const failureDatabase = createDatabase()
    await assert.rejects(() => createStore(failureDatabase, { failStep: 'audit' })
      .store.issueApprovedBookBenefitCode(standardInput()))
  } finally {
    for (const [name, method] of Object.entries(originalMethods)) console[name] = method
  }
  const output = captured.join('\n')
  for (const sensitiveValue of [
    FULL_PHONE,
    ORDER_NUMBER,
    CODE_SECRET,
    ORDER_SECRET,
    PHONE_SECRET,
    CAMPAIGN_HASH.toString('hex')
  ]) {
    assert.equal(output.includes(sensitiveValue), false)
  }
  assert.equal(output.includes(successResult.plaintextCode), false)
  assert.equal(output.includes(successDatabase.codes[0].code_hash.toString('hex')), false)
  assert.equal(output.includes(successDatabase.applications[0].approved_order_claim_hash.toString('hex')), false)
}

await testCodePrimitive()
await testStandardSuccess()
await testManualSuccess()
await testPhoneLocatorUsesTrustedHelper()
await testCampaignFailures()
await testAtomicFailures()
await testIdempotentReplay()
await testDuplicateConflicts()
await testRealUniqueConstraintConflicts()
await testConnectionErrorPriority()
await testSafeInputAndLogging()

console.log('book-benefit qualification approval and code issue tests passed')
