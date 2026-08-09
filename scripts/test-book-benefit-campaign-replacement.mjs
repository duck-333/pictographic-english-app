import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { createStandardOrderClaimHash } from '../server/book-benefit-foundation.mjs'
import { createBookBenefitStore } from '../server/book-benefit-store.mjs'
import { runBookBenefitCampaignAction } from './init-book-benefit-campaign.mjs'

const NOW = new Date('2026-08-10T02:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const CAMPAIGN_KEY = 'book-benefit-30d-v1'
const CAMPAIGN_NAME = '购书用户30天会员福利'
const RULES_VERSION = 'book-benefit-rules-v1'
const ORDER_SECRET = 'fake-order-claim-secret-for-replacement-tests'
const CODE_SECRET = 'fake-redemption-secret-for-replacement-tests'
const PHONE_SECRET = 'fake-phone-secret-for-replacement-tests-only'
const ORDER_NUMBER = 'FAKE-ORDER-2C1A-001'
const SECRET_ENV = {
  BOOK_ORDER_CLAIM_HASH_SECRET: ORDER_SECRET,
  PHONE_HASH_SECRET: PHONE_SECRET,
  CAMPAIGN_PHONE_IDENTITY_HASH_SECRET: 'different-fake-campaign-secret-32-bytes',
  JWT_SECRET: 'different-fake-jwt-secret-32-bytes',
  ADMIN_API_TOKEN: 'different-fake-admin-token-32-bytes',
  WECHAT_MINIAPP_SECRET: 'different-fake-wechat-secret-32-bytes'
}

function clone(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(clone)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
  return value
}

function stable(prefix, domain, operationId, length) {
  return `${prefix}${crypto.createHash('sha256').update(`${domain}|${operationId}`).digest('hex').slice(0, length)}`
}

function exactCampaign(status = 'active') {
  return {
    id: '1', campaign_key: CAMPAIGN_KEY, name: CAMPAIGN_NAME, status,
    benefit_days: 30, rules_version: RULES_VERSION,
    starts_at: status === 'draft' ? null : new Date('2026-08-01T00:00:00.000Z'),
    ends_at: status === 'ended' ? new Date('2026-08-09T00:00:00.000Z') : null,
    created_by: 'admin-1', created_at: NOW, updated_at: NOW
  }
}

function issueSeed() {
  const operationId = 'issue-target-operation'
  const orderClaim = createStandardOrderClaimHash({ channel: 'taobao', orderNumber: ORDER_NUMBER }, {
    secret: ORDER_SECRET, env: SECRET_ENV
  })
  return {
    application: {
      id: '21', application_no: 'BBA-TARGET', campaign_id: '1', applicant_user_id: '10',
      applicant_phone_identity_hash: Buffer.alloc(32, 10), applicant_phone_hash_version: 'v1',
      order_claim_type: 'standard', approved_order_claim_hash: orderClaim.orderClaimHash,
      order_claim_hash_version: 'v1', order_channel: 'taobao', status: 'approved',
      review_reason_code: null, seller_verification_code: 'official_store',
      customer_service_channel: 'taobao_cs', create_idempotency_key: operationId
    },
    code: {
      id: '31', application_id: '21', generation_no: 1, code_hash: Buffer.alloc(32, 31),
      code_hash_version: 'v1', status: 'issued', issue_idempotency_key: operationId,
      replacement_code_id: null, issued_by: 'admin-1', issued_at: NOW,
      expires_at: new Date(NOW.getTime() + 30 * DAY_MS), redeemed_at: null,
      voided_at: null, voided_by: null, void_reason_code: null, created_at: NOW, updated_at: NOW
    },
    audit: {
      id: '41', event_id: stable('bbev_', 'book-benefit-audit:v1', operationId, 59),
      campaign_id: '1', application_id: '21', code_id: '31', redemption_record_id: null,
      event_type: 'qualification_approved_code_issued', actor_type: 'admin', actor_id: 'admin-1',
      result: 'succeeded', reason_code: null, created_at: NOW
    }
  }
}

function initialState(overrides = {}) {
  const seed = issueSeed()
  return {
    campaigns: overrides.campaigns ?? [exactCampaign()],
    applications: overrides.applications ?? [seed.application],
    codes: overrides.codes ?? [seed.code],
    audits: overrides.audits ?? [seed.audit],
    redemptions: overrides.redemptions ?? [],
    phoneBindings: overrides.phoneBindings ?? [{
      id: '11', user_id: '10', phone_masked: '100****0000', phone_hash: 'fake-phone-hash',
      campaign_phone_identity_hash: Buffer.alloc(32, 10), campaign_phone_hash_version: 'v1',
      status: 'active', last_verified_at: NOW
    }],
    nextCampaignId: overrides.nextCampaignId ?? 1,
    nextCodeId: overrides.nextCodeId ?? 100,
    nextAuditId: overrides.nextAuditId ?? 100
  }
}

function parseColumns(sql) {
  const match = sql.match(/\(([^)]+)\)\s+VALUES/i)
  assert(match)
  return match[1].split(',').map((item) => item.replace(/[\s`]/g, ''))
}

function insertRow(sql, values) {
  const columns = parseColumns(sql)
  return Object.fromEntries(columns.map((column, index) => [column, clone(values[index])]))
}

function createDatabase(options = {}) {
  let committed = clone(options.state || initialState())
  const connections = []
  const sqlEvents = []

  function fail(step) {
    if (options.failure === step) throw new Error(`fake ${step} failure`)
  }

  function createConnection() {
    let working = null
    let released = false
    const lifecycle = { begin: 0, commit: 0, rollback: 0, release: 0 }
    const state = () => working || committed
    const connection = {
      lifecycle,
      async beginTransaction() { lifecycle.begin += 1; working = clone(committed) },
      async commit() { lifecycle.commit += 1; fail('commit'); committed = working; working = null },
      async rollback() { lifecycle.rollback += 1; working = null; fail('rollback') },
      release() { assert.equal(released, false); released = true; lifecycle.release += 1; fail('release') },
      async query(sql) {
        assert.match(sql, /SHOW COLUMNS FROM `user_phone_bindings`/)
        return [[
          { Field: 'campaign_phone_identity_hash', Type: 'binary(32)', Extra: '' },
          { Field: 'campaign_phone_hash_version', Type: 'varchar(16)', Extra: '' }
        ]]
      },
      async execute(sql, values = []) {
        const compact = String(sql).replace(/\s+/g, ' ').trim()
        sqlEvents.push({ sql: compact, values: clone(values) })
        const db = state()
        if (/FROM book_benefit_campaigns WHERE campaign_key = \?/i.test(compact)) {
          const row = db.campaigns.find((item) => item.campaign_key === values[0])
          return [row ? [clone(row)] : []]
        }
        if (/INSERT INTO book_benefit_campaigns/i.test(compact)) {
          fail('campaignInsert')
          const row = insertRow(compact, values)
          row.id = String(db.nextCampaignId++)
          db.campaigns.push(row)
          return [{ insertId: Number(row.id), affectedRows: 1 }]
        }
        if (/UPDATE book_benefit_campaigns/i.test(compact)) {
          fail('campaignUpdate')
          const row = db.campaigns.find((item) => item.campaign_key === CAMPAIGN_KEY)
          let allowed = false
          if (/SET status = 'active'/.test(compact)) allowed = row && ['draft', 'paused'].includes(row.status)
          if (/SET status = 'paused'/.test(compact)) allowed = row && row.status === 'active'
          if (/SET status = 'ended'/.test(compact)) allowed = row && ['active', 'paused'].includes(row.status)
          if (!allowed) return [{ affectedRows: 0 }]
          if (/SET status = 'active'/.test(compact)) {
            row.status = 'active'; row.starts_at ||= values[0]; row.updated_at = values[1]
          } else if (/SET status = 'paused'/.test(compact)) {
            row.status = 'paused'; row.updated_at = values[0]
          } else {
            row.status = 'ended'; row.ends_at = values[0]; row.updated_at = values[1]
          }
          return [{ affectedRows: 1 }]
        }
        if (/FROM book_benefit_applications WHERE create_idempotency_key = \?/i.test(compact)) {
          const row = db.applications.find((item) => item.create_idempotency_key === values[0])
          return [row ? [clone(row)] : []]
        }
        if (/FROM `user_phone_bindings`/i.test(compact) && /WHERE user_id = \?/i.test(compact)) {
          const row = db.phoneBindings.find((item) => item.status === 'active' && String(item.user_id) === String(values[0]))
          return [row ? [clone(row)] : []]
        }
        if (/FROM book_benefit_campaigns/i.test(compact) && /WHERE id = \?/i.test(compact)) {
          const row = db.campaigns.find((item) => String(item.id) === String(values[0]))
          return [row ? [clone(row)] : []]
        }
        if (/FROM book_benefit_codes WHERE issue_idempotency_key = \?/i.test(compact)) {
          const row = db.codes.find((item) => item.issue_idempotency_key === values[0])
          return [row ? [clone(row)] : []]
        }
        if (/FROM book_benefit_audit_events WHERE event_id = \?/i.test(compact)) {
          const row = db.audits.find((item) => item.event_id === values[0])
          return [row ? [clone(row)] : []]
        }
        if (/WHERE c.replacement_code_id = \?/i.test(compact)) {
          const code = db.codes.find((item) => String(item.replacement_code_id) === String(values[0]))
          if (!code) return [[]]
          const app = db.applications.find((item) => item.id === code.application_id)
          const campaign = db.campaigns.find((item) => item.id === app.campaign_id)
          return [[{
            ...clone(code), campaign_id: app.campaign_id, applicant_user_id: app.applicant_user_id,
            application_status: app.status, campaign_record_id: campaign.id,
            campaign_status: campaign.status, benefit_days: campaign.benefit_days,
            starts_at: campaign.starts_at, ends_at: campaign.ends_at,
            redemption_record_id: db.redemptions.find((item) => item.code_id === code.id)?.id ?? null
          }]]
        }
        if (/FROM book_benefit_codes c/i.test(compact) && /WHERE c.id = \?/i.test(compact)) {
          const code = db.codes.find((item) => String(item.id) === String(values[0]))
          if (!code) return [[]]
          const app = db.applications.find((item) => item.id === code.application_id)
          const campaign = app && db.campaigns.find((item) => item.id === app.campaign_id)
          if (!app || !campaign) return [[]]
          return [[{
            ...clone(code), application_record_id: app.id, campaign_id: app.campaign_id,
            applicant_user_id: app.applicant_user_id, application_status: app.status,
            campaign_record_id: campaign.id, campaign_status: campaign.status,
            benefit_days: campaign.benefit_days,
            starts_at: campaign.starts_at, ends_at: campaign.ends_at,
            redemption_record_id: db.redemptions.find((item) => item.code_id === code.id)?.id ?? null
          }]]
        }
        if (/UPDATE book_benefit_codes SET status = 'voided'/i.test(compact)) {
          fail('void')
          const code = db.codes.find((item) => String(item.id) === String(values[4]) && item.status === 'issued' && item.replacement_code_id === null)
          if (code) {
            code.status = 'voided'; code.voided_at = values[0]; code.voided_by = values[1]
            code.void_reason_code = values[2]; code.updated_at = values[3]
          }
          return [{ affectedRows: code ? 1 : 0 }]
        }
        if (/INSERT INTO book_benefit_codes/i.test(compact)) {
          fail('replacementInsert')
          const row = insertRow(compact, values)
          row.id = String(db.nextCodeId++)
          db.codes.push(row)
          return [{ insertId: Number(row.id), affectedRows: 1 }]
        }
        if (/UPDATE book_benefit_codes SET replacement_code_id = \?/i.test(compact)) {
          fail('link')
          const code = db.codes.find((item) => String(item.id) === String(values[2]) && item.status === 'voided' && item.replacement_code_id === null)
          if (code) { code.replacement_code_id = String(values[0]); code.updated_at = values[1] }
          return [{ affectedRows: code ? 1 : 0 }]
        }
        if (/INSERT INTO book_benefit_audit_events/i.test(compact)) {
          fail('audit')
          const row = insertRow(compact, values)
          row.id = String(db.nextAuditId++)
          db.audits.push(row)
          return [{ insertId: Number(row.id), affectedRows: 1 }]
        }
        throw new Error(`Unexpected SQL: ${compact}`)
      }
    }
    connections.push(connection)
    return connection
  }

  return {
    pool: { async getConnection() { return createConnection() } },
    connections,
    sqlEvents,
    snapshot: () => clone(committed)
  }
}

function storeFor(database) {
  return createBookBenefitStore({
    pool: database.pool, campaignKey: CAMPAIGN_KEY,
    phoneHashSecret: PHONE_SECRET, orderClaimHashSecret: ORDER_SECRET,
    redemptionCodeHashSecret: CODE_SECRET, secretEnv: SECRET_ENV
  })
}

function replacementInput(overrides = {}) {
  return { codeId: '31', operationId: 'replace-operation-1', reasonCode: 'delivery_failed', operatorId: 'admin-1', now: NOW, ...overrides }
}

function issueInput(overrides = {}) {
  return {
    campaignId: '1', locator: { userId: '10' }, orderClaimType: 'standard',
    orderChannel: 'taobao', orderNumber: ORDER_NUMBER, sellerVerificationCode: 'official_store',
    customerServiceChannel: 'taobao_cs', operatorId: 'admin-1',
    operationId: 'issue-target-operation', now: NOW, ...overrides
  }
}

async function testCampaignLifecycle() {
  const database = createDatabase({ state: initialState({ campaigns: [], applications: [], codes: [], audits: [] }) })
  const created = await runBookBenefitCampaignAction('create-draft', { pool: database.pool, operatorId: 'admin-1', now: NOW })
  assert.equal(created.created, true)
  const repeated = await runBookBenefitCampaignAction('create-draft', { pool: database.pool, operatorId: 'admin-1', now: NOW })
  assert.equal(repeated.created, false)
  assert.equal((await runBookBenefitCampaignAction('activate', { pool: database.pool, now: NOW })).status, 'active')
  assert.equal((await runBookBenefitCampaignAction('pause', { pool: database.pool, now: NOW })).status, 'paused')
  assert.equal((await runBookBenefitCampaignAction('activate', { pool: database.pool, now: NOW })).status, 'active')
  assert.equal((await runBookBenefitCampaignAction('end', { pool: database.pool, now: NOW })).status, 'ended')
  await assert.rejects(runBookBenefitCampaignAction('activate', { pool: database.pool, now: NOW }),
    (error) => error.code === 'BOOK_BENEFIT_CAMPAIGN_STATE_CONFLICT')
  const status = await runBookBenefitCampaignAction('status', { pool: database.pool })
  assert.equal(status.campaignKey, CAMPAIGN_KEY)
  assert.equal(status.endsAt.toISOString(), NOW.toISOString())
  assert(database.connections.every((connection) => connection.lifecycle.release === 1))

  for (const field of ['name', 'benefit_days', 'rules_version']) {
    const campaign = exactCampaign('draft')
    campaign[field] = field === 'benefit_days' ? 31 : 'wrong'
    const mismatch = createDatabase({ state: initialState({ campaigns: [campaign], applications: [], codes: [], audits: [] }) })
    await assert.rejects(runBookBenefitCampaignAction('create-draft', { pool: mismatch.pool, operatorId: 'admin-1', now: NOW }),
      (error) => error.code === 'BOOK_BENEFIT_CAMPAIGN_CONFIG_CONFLICT')
  }
}

async function testConfiguredCampaignRead() {
  for (const status of ['draft', 'active', 'paused', 'ended']) {
    const database = createDatabase({ state: initialState({ campaigns: [exactCampaign(status)] }) })
    const result = await storeFor(database).getConfiguredBookBenefitCampaign()
    assert.deepEqual(Object.keys(result).sort(), ['benefitDays', 'campaignId', 'campaignKey', 'endsAt', 'name', 'rulesVersion', 'startsAt', 'status'].sort())
    assert.equal(result.status, status)
  }
  for (const mutate of [
    (row) => { row.campaign_key = 'wrong' },
    (row) => { row.name = '错误活动名称' },
    (row) => { row.benefit_days = 31 },
    (row) => { row.rules_version = 'wrong' }
  ]) {
    const row = exactCampaign(); mutate(row)
    const database = createDatabase({ state: initialState({ campaigns: [row] }) })
    await assert.rejects(storeFor(database).getConfiguredBookBenefitCampaign())
  }
}

async function testIssueTargetReplay() {
  const exactDatabase = createDatabase()
  const exactResult = await storeFor(exactDatabase).issueApprovedBookBenefitCode(issueInput())
  assert.equal(exactResult.status, 'ISSUED_CODE_PLAINTEXT_UNAVAILABLE')
  const cases = [
    issueInput({ locator: { userId: '20' } }),
    issueInput({ orderNumber: 'DIFFERENT-FAKE-ORDER' }),
    issueInput({ sellerVerificationCode: 'authorized_seller' }),
    issueInput({ customerServiceChannel: 'wechat_official_cs' })
  ]
  for (const input of cases) {
    const state = initialState()
    if (input.locator.userId === '20') state.phoneBindings.push({ ...clone(state.phoneBindings[0]), id: '12', user_id: '20', campaign_phone_identity_hash: Buffer.alloc(32, 20) })
    const before = clone(state)
    const database = createDatabase({ state })
    await assert.rejects(storeFor(database).issueApprovedBookBenefitCode(input),
      (error) => error.code === 'BOOK_BENEFIT_OPERATION_CONFLICT')
    assert.deepEqual(database.snapshot(), before)
  }
  const changedPhone = initialState()
  changedPhone.phoneBindings[0].campaign_phone_identity_hash = Buffer.alloc(32, 99)
  const phoneDatabase = createDatabase({ state: changedPhone })
  await assert.rejects(storeFor(phoneDatabase).issueApprovedBookBenefitCode(issueInput()),
    (error) => error.code === 'BOOK_BENEFIT_OPERATION_CONFLICT')

  const invalidSeller = createDatabase({ state: initialState({ applications: [], codes: [], audits: [] }) })
  await assert.rejects(storeFor(invalidSeller).issueApprovedBookBenefitCode(issueInput({ sellerVerificationCode: 'unverified', operationId: 'new-op' })),
    (error) => error.code === 'BOOK_BENEFIT_INPUT_INVALID')
  assert.equal(invalidSeller.connections.length, 0)
}

async function testReplacement() {
  const database = createDatabase()
  const store = storeFor(database)
  const result = await store.replaceIssuedBookBenefitCode(replacementInput())
  assert.deepEqual(Object.keys(result).sort(), [
    'applicationId', 'campaignId', 'codeExpiresAt', 'generationNo', 'originalCodeId',
    'plaintextCode', 'replacementCodeId', 'status', 'userId'
  ].sort())
  assert.equal(result.generationNo, 2)
  assert.equal(result.codeExpiresAt.getTime() - NOW.getTime(), 30 * DAY_MS)
  let state = database.snapshot()
  assert.equal(state.codes.length, 2)
  assert.equal(state.codes[0].status, 'voided')
  assert.equal(state.codes[0].replacement_code_id, result.replacementCodeId)
  assert.equal(state.codes[1].status, 'issued')
  assert.equal(state.audits.at(-1).event_type, 'issued_code_replaced')
  assert.equal(state.audits.at(-1).reason_code, 'delivery_failed')
  assert.deepEqual(database.connections[0].lifecycle, { begin: 1, commit: 1, rollback: 0, release: 1 })

  const replay = await store.replaceIssuedBookBenefitCode(replacementInput())
  assert.equal(replay.status, 'REPLACEMENT_CODE_PLAINTEXT_UNAVAILABLE')
  assert.equal(Object.hasOwn(replay, 'plaintextCode'), false)
  assert.equal(database.snapshot().codes.length, 2)
  assert.equal(database.snapshot().audits.length, 2)
  assert.deepEqual(database.connections[1].lifecycle, { begin: 1, commit: 1, rollback: 0, release: 1 })
  await assert.rejects(store.replaceIssuedBookBenefitCode(replacementInput({ reasonCode: 'plaintext_unavailable' })),
    (error) => error.code === 'BOOK_BENEFIT_OPERATION_CONFLICT')
  await assert.rejects(store.replaceIssuedBookBenefitCode(replacementInput({ codeId: '99' })),
    (error) => error.code === 'BOOK_BENEFIT_OPERATION_CONFLICT')
  state = database.snapshot()
  assert.equal(state.codes.length, 2)
}

async function testReplacementFailures() {
  for (const status of ['paused', 'ended']) {
    const database = createDatabase({ state: initialState({ campaigns: [exactCampaign(status)] }) })
    await assert.rejects(storeFor(database).replaceIssuedBookBenefitCode(replacementInput()),
      (error) => error.code === 'BOOK_BENEFIT_CAMPAIGN_NOT_ACTIVE')
  }
  for (const status of ['redeemed', 'voided', 'expired']) {
    const state = initialState(); state.codes[0].status = status
    const database = createDatabase({ state })
    await assert.rejects(storeFor(database).replaceIssuedBookBenefitCode(replacementInput()),
      (error) => error.code === 'BOOK_BENEFIT_CODE_UNAVAILABLE')
  }

  for (const expiresAt of [
    new Date(NOW.getTime() - 1),
    new Date(NOW),
    null,
    new Date('invalid')
  ]) {
    const state = initialState(); state.codes[0].expires_at = expiresAt
    const before = clone(state)
    const database = createDatabase({ state })
    await assert.rejects(storeFor(database).replaceIssuedBookBenefitCode(replacementInput()))
    assert.deepEqual(database.snapshot(), before)
  }

  const campaignTimeCases = [
    {
      name: 'not started',
      startsAt: new Date(NOW.getTime() + 1),
      endsAt: null,
      code: 'BOOK_BENEFIT_CAMPAIGN_NOT_STARTED'
    },
    {
      name: 'already ended',
      startsAt: new Date(NOW.getTime() - DAY_MS),
      endsAt: new Date(NOW.getTime() - 1),
      code: 'BOOK_BENEFIT_CAMPAIGN_ENDED'
    },
    {
      name: 'ends exactly now',
      startsAt: new Date(NOW.getTime() - DAY_MS),
      endsAt: new Date(NOW),
      code: 'BOOK_BENEFIT_CAMPAIGN_ENDED'
    },
    {
      name: 'invalid start',
      startsAt: new Date('invalid'),
      endsAt: null,
      code: 'BOOK_BENEFIT_STORE_ERROR'
    },
    {
      name: 'invalid end',
      startsAt: null,
      endsAt: new Date('invalid'),
      code: 'BOOK_BENEFIT_STORE_ERROR'
    }
  ]
  for (const item of campaignTimeCases) {
    const state = initialState()
    state.campaigns[0].starts_at = item.startsAt
    state.campaigns[0].ends_at = item.endsAt
    const before = clone(state)
    const database = createDatabase({ state })
    await assert.rejects(
      storeFor(database).replaceIssuedBookBenefitCode(replacementInput()),
      (error) => error.code === item.code,
      item.name
    )
    assert.deepEqual(database.snapshot(), before)
  }

  for (const [name, startsAt, endsAt] of [
    ['starts exactly now', new Date(NOW), null],
    ['long running null window', null, null]
  ]) {
    const state = initialState()
    state.campaigns[0].starts_at = startsAt
    state.campaigns[0].ends_at = endsAt
    const database = createDatabase({ state })
    const result = await storeFor(database).replaceIssuedBookBenefitCode(
      replacementInput({ operationId: `valid-window-${name.replaceAll(' ', '-')}` })
    )
    assert.equal(result.generationNo, 2)
    assert.equal(database.snapshot().codes.length, 2)
  }

  for (const [generation, expectedGeneration] of [[1, 2], [2, 3], ['1', 2], ['2', 3]]) {
    const state = initialState(); state.codes[0].generation_no = generation
    const database = createDatabase({ state })
    const result = await storeFor(database).replaceIssuedBookBenefitCode(
      replacementInput({ operationId: `generation-success-${String(generation)}-${typeof generation}` })
    )
    assert.equal(result.generationNo, expectedGeneration)
    assert.equal(database.snapshot().codes[1].generation_no, expectedGeneration)
  }

  for (const generation of [3, '3']) {
    const state = initialState(); state.codes[0].generation_no = generation
    const before = clone(state)
    const database = createDatabase({ state })
    await assert.rejects(storeFor(database).replaceIssuedBookBenefitCode(replacementInput()),
      (error) => error.code === 'BOOK_BENEFIT_REPLACEMENT_LIMIT')
    assert.deepEqual(database.snapshot(), before)
  }

  for (const generation of [null, undefined, 0, -1, 1.5, NaN, Infinity, 'abc', '2x', 4, '4', '9007199254740992']) {
    const state = initialState(); state.codes[0].generation_no = generation
    const before = clone(state)
    const database = createDatabase({ state })
    await assert.rejects(storeFor(database).replaceIssuedBookBenefitCode(replacementInput()),
      (error) => error.code === 'BOOK_BENEFIT_RELATION_INVALID')
    assert.deepEqual(database.snapshot(), before)
  }
  {
    const state = initialState()
    state.redemptions.push({ id: '71', code_id: '31' })
    const before = clone(state)
    const database = createDatabase({ state })
    await assert.rejects(storeFor(database).replaceIssuedBookBenefitCode(replacementInput()),
      (error) => error.code === 'BOOK_BENEFIT_CODE_UNAVAILABLE')
    assert.deepEqual(database.snapshot(), before)
  }
  for (const failure of ['void', 'replacementInsert', 'link', 'audit']) {
    const state = initialState(); const before = clone(state)
    const database = createDatabase({ state, failure })
    await assert.rejects(storeFor(database).replaceIssuedBookBenefitCode(replacementInput()))
    assert.deepEqual(database.snapshot(), before)
    assert.deepEqual(database.connections[0].lifecycle, { begin: 1, commit: 0, rollback: 1, release: 1 })
  }
  const releaseDatabase = createDatabase({ failure: 'release' })
  await assert.rejects(storeFor(releaseDatabase).replaceIssuedBookBenefitCode(replacementInput()), /release/)
  assert.equal(releaseDatabase.snapshot().codes.length, 2)
  assert.equal(releaseDatabase.connections[0].lifecycle.rollback, 0)
}

async function testPrivacy() {
  const captured = []
  const original = console.error
  console.error = (...args) => captured.push(args.join(' '))
  let result
  try {
    const database = createDatabase()
    result = await storeFor(database).replaceIssuedBookBenefitCode(replacementInput())
  } finally {
    console.error = original
  }
  const output = captured.join('\n')
  for (const value of [result.plaintextCode, CODE_SECRET, ORDER_NUMBER, ORDER_SECRET, Buffer.alloc(32, 10).toString('hex')]) {
    assert.equal(output.includes(value), false)
  }
}

await testCampaignLifecycle()
await testConfiguredCampaignRead()
await testIssueTargetReplay()
await testReplacement()
await testReplacementFailures()
await testPrivacy()

console.log('book-benefit campaign and replacement tests passed')
