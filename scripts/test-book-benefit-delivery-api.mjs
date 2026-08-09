import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'

import { createUserSessionToken } from '../server/auth.mjs'
import { createBookBenefitStore } from '../server/book-benefit-store.mjs'
import { createApiHandler } from '../server/index.mjs'

const NOW = new Date('2026-08-12T03:00:00.000Z')
const ADMIN_TOKEN = 'fake-admin-token-for-delivery-api-tests'
const JWT_SECRET = 'fake-jwt-secret-for-delivery-api-tests'
const USER_ID = '42'
const CAMPAIGN = {
  campaignId: '7',
  campaignKey: 'book-benefit-30d-v1',
  name: '\u8d2d\u4e66\u7528\u623730\u5929\u4f1a\u5458\u798f\u5229',
  status: 'active',
  benefitDays: 30,
  rulesVersion: 'book-benefit-rules-v1',
  startsAt: new Date('2026-08-01T00:00:00.000Z'),
  endsAt: null,
  createdBy: 'private-actor'
}

function createFakeBookBenefitStore() {
  const calls = []
  const behavior = {}
  return {
    calls,
    behavior,
    async getConfiguredBookBenefitCampaign() {
      calls.push(['campaign'])
      if (behavior.campaignError) throw behavior.campaignError
      return { ...CAMPAIGN }
    },
    async issueApprovedBookBenefitCode(input) {
      calls.push(['issue', input])
      if (behavior.issueError) throw behavior.issueError
      return behavior.issueResult || {
        applicationId: '91', applicationNo: 'BBA-SAFE-001', codeId: '92',
        plaintextCode: 'BOOK-FAKE-ONE-TIME', codeExpiresAt: new Date('2026-09-11T03:00:00.000Z'),
        campaignId: '7', userId: USER_ID, status: 'issued'
      }
    },
    async getBookBenefitIssueOperationStatus(input) {
      calls.push(['status', input])
      if (behavior.statusError) throw behavior.statusError
      return behavior.statusResult || { status: 'not_found' }
    },
    async replaceIssuedBookBenefitCode(input) {
      calls.push(['replace', input])
      if (behavior.replaceError) throw behavior.replaceError
      return behavior.replaceResult || {
        originalCodeId: '92', replacementCodeId: '93', plaintextCode: 'BOOK-FAKE-REPLACEMENT',
        codeExpiresAt: new Date('2026-09-11T03:00:00.000Z'), applicationId: '91', campaignId: '7',
        userId: USER_ID, generationNo: 2, status: 'issued'
      }
    },
    async redeemBookBenefitCode(input) {
      calls.push(['redeem', input])
      if (behavior.redeemError) throw behavior.redeemError
      return behavior.redeemResult || {
        redemptionId: 'private-redemption', codeId: '92', campaignId: '7', applicationId: '91',
        grantId: 'private-grant', transactionId: 'private-transaction', userId: USER_ID,
        membershipType: 'monthly', membershipStatus: 'active',
        membershipStartedAt: new Date('2026-08-12T03:00:00.000Z'),
        membershipExpireAt: new Date('2026-09-11T03:00:00.000Z'), quotaBalance: 7, idempotent: false
      }
    }
  }
}

function createHandler(bookBenefitStore = createFakeBookBenefitStore()) {
  return {
    bookBenefitStore,
    handler: createApiHandler({
      nodeEnv: 'production',
      adminApiToken: ADMIN_TOKEN,
      jwtSecret: JWT_SECRET,
      now: () => new Date(NOW),
      bookBenefitStore,
      store: { async getWordCount() { return 3 } },
      userStore: {},
      userEntitlementStore: {},
      identityStore: {},
      userFavoritesStore: {},
      userRecentWordsStore: {},
      wechatLoginClient: {}
    })
  }
}

async function invoke(handler, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from(raw ? [raw] : [])
  req.method = method
  req.url = url
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  let statusCode = 0
  let responseHeaders = {}
  let responseBody = ''
  const res = {
    writeHead(status, values) {
      statusCode = status
      responseHeaders = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]))
    },
    end(value = '') { responseBody += String(value) }
  }
  await handler(req, res)
  return {
    statusCode,
    headers: responseHeaders,
    body: responseBody ? JSON.parse(responseBody) : null
  }
}

function adminHeaders() {
  return { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }
}

function userHeaders() {
  const session = createUserSessionToken(USER_ID, { jwtSecret: JWT_SECRET, nodeEnv: 'production', now: NOW })
  return { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }
}

function error(code, statusCode, message = 'PRIVATE SQL fake password sentinel') {
  return Object.assign(new Error(message), { code, statusCode, sqlMessage: 'FAKE PRIVATE SQL' })
}

function assertOnlyKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
}

async function testCampaignApi() {
  const { handler, bookBenefitStore } = createHandler()
  const denied = await invoke(handler, { url: '/api/admin/book-benefits/campaign' })
  assert.equal(denied.statusCode, 401)
  assert.equal(denied.headers['cache-control'], 'no-store')
  assert.equal(bookBenefitStore.calls.length, 0)

  const response = await invoke(handler, { url: '/api/admin/book-benefits/campaign', headers: adminHeaders() })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assertOnlyKeys(response.body, ['ok', 'name', 'status', 'benefitDays', 'rulesVersion', 'startsAt', 'endsAt'])
  assert.equal(response.body.campaignId, undefined)
  assert.equal(response.body.createdBy, undefined)

  bookBenefitStore.behavior.campaignError = error('BOOK_BENEFIT_CAMPAIGN_CONFIG_INVALID', 409)
  const failed = await invoke(handler, { url: '/api/admin/book-benefits/campaign', headers: adminHeaders() })
  assert.equal(failed.statusCode, 409)
  assert.equal(failed.body.code, 'BOOK_BENEFIT_CAMPAIGN_CONFIG_INVALID')
  assert.doesNotMatch(JSON.stringify(failed.body), /PRIVATE|password|SQL/i)
}

const STANDARD_ISSUE_BODY = {
  operationId: 'issue-http-001', userId: USER_ID, orderClaimType: 'standard',
  orderChannel: 'taobao', orderNumber: 'FAKE-ORDER-DELIVERY-001',
  sellerVerificationCode: 'official_store', customerServiceChannel: 'taobao_cs'
}

async function testIssueApi() {
  const { handler, bookBenefitStore } = createHandler()
  const denied = await invoke(handler, { method: 'POST', url: '/api/admin/book-benefits/codes/issue', body: STANDARD_ISSUE_BODY })
  assert.equal(denied.statusCode, 401)
  assert.equal(bookBenefitStore.calls.length, 0)

  const response = await invoke(handler, {
    method: 'POST', url: '/api/admin/book-benefits/codes/issue', body: STANDARD_ISSUE_BODY, headers: adminHeaders()
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers.pragma, 'no-cache')
  assert.equal(response.headers.expires, '0')
  assertOnlyKeys(response.body, ['ok', 'applicationNo', 'codeId', 'plaintextCode', 'codeExpiresAt', 'userId', 'status'])
  const issueCall = bookBenefitStore.calls.find(([kind]) => kind === 'issue')[1]
  assert.equal(issueCall.campaignId, CAMPAIGN.campaignId)
  assert.deepEqual(issueCall.locator, { userId: USER_ID })
  assert.equal(issueCall.operatorId, 'legacy-admin')
  assert.equal(issueCall.operationId, STANDARD_ISSUE_BODY.operationId)
  assert.equal(issueCall.orderNumber, STANDARD_ISSUE_BODY.orderNumber)
  assert.equal(issueCall.now.toISOString(), NOW.toISOString())

  const privilegedFields = [
    'campaignId', 'campaignKey', 'benefitDays', 'membershipDays', 'sourceType', 'codeHash',
    'phoneHash', 'campaignPhoneIdentityHash', 'operatorId', 'now', 'metadata', 'screenshot'
  ]
  for (const fieldName of privilegedFields) {
    const before = bookBenefitStore.calls.length
    const rejected = await invoke(handler, {
      method: 'POST', url: '/api/admin/book-benefits/codes/issue',
      body: { ...STANDARD_ISSUE_BODY, [fieldName]: 'FAKE-PRIVILEGED' }, headers: adminHeaders()
    })
    assert.equal(rejected.statusCode, 400, fieldName)
    assert.equal(bookBenefitStore.calls.length, before, fieldName)
  }

  const invalidMatrix = [
    { ...STANDARD_ISSUE_BODY, orderChannel: undefined },
    { ...STANDARD_ISSUE_BODY, orderNumber: '' },
    { ...STANDARD_ISSUE_BODY, sellerVerificationCode: 'unverified' },
    { ...STANDARD_ISSUE_BODY, manualExceptionReasonCode: 'historical_evidence_unavailable' },
    { ...STANDARD_ISSUE_BODY, orderClaimType: 'manual_exception' },
    { ...STANDARD_ISSUE_BODY, orderClaimType: 'manual_exception', orderChannel: undefined, orderNumber: undefined, manualExceptionReasonCode: 'free-text' }
  ]
  for (const body of invalidMatrix) {
    const rejected = await invoke(handler, { method: 'POST', url: '/api/admin/book-benefits/codes/issue', body, headers: adminHeaders() })
    assert.equal(rejected.statusCode, 400)
  }
  const manual = await invoke(handler, {
    method: 'POST', url: '/api/admin/book-benefits/codes/issue', headers: adminHeaders(),
    body: {
      operationId: 'issue-http-manual-001', userId: USER_ID, orderClaimType: 'manual_exception',
      manualExceptionReasonCode: 'customer_service_approved_exception', sellerVerificationCode: 'unverified',
      customerServiceChannel: 'wechat_official_cs'
    }
  })
  assert.equal(manual.statusCode, 200)

  bookBenefitStore.behavior.issueResult = {
    applicationNo: 'BBA-SAFE-001', codeId: '92', codeExpiresAt: NOW, userId: USER_ID,
    plaintextCode: 'MUST-NOT-RETURN', status: 'ISSUED_CODE_PLAINTEXT_UNAVAILABLE'
  }
  const replay = await invoke(handler, {
    method: 'POST', url: '/api/admin/book-benefits/codes/issue', body: STANDARD_ISSUE_BODY, headers: adminHeaders()
  })
  assert.equal(replay.statusCode, 409)
  assert.equal(replay.body.status, 'ISSUED_CODE_PLAINTEXT_UNAVAILABLE')
  assert.equal(replay.body.plaintextCode, undefined)

  bookBenefitStore.behavior.issueError = error('BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  const conflict = await invoke(handler, {
    method: 'POST', url: '/api/admin/book-benefits/codes/issue', body: STANDARD_ISSUE_BODY, headers: adminHeaders()
  })
  assert.equal(conflict.statusCode, 409)
  assert.equal(conflict.body.code, 'BOOK_BENEFIT_OPERATION_CONFLICT')
  assert.doesNotMatch(JSON.stringify(conflict.body), /PRIVATE|password|SQL/i)
}

async function testIssueStatusApi() {
  const { handler, bookBenefitStore } = createHandler()
  const denied = await invoke(handler, {
    method: 'POST', url: '/api/admin/book-benefits/codes/issue-status', body: { operationId: 'issue-http-001' }
  })
  assert.equal(denied.statusCode, 401)
  assert.equal(bookBenefitStore.calls.length, 0)
  for (const result of [
    { status: 'not_found' },
    { status: 'issued_plaintext_unavailable', applicationNo: 'BBA-1', codeId: '2', userId: USER_ID, codeExpiresAt: NOW, plaintextCode: 'NO' },
    { status: 'replaced', applicationNo: 'BBA-1', codeId: '2', replacementCodeId: '3', userId: USER_ID, codeExpiresAt: NOW, plaintextCode: 'NO' },
    { status: 'inconsistent', applicationNo: 'BBA-1', userId: USER_ID, sql: 'NO' }
  ]) {
    bookBenefitStore.behavior.statusResult = result
    const response = await invoke(handler, {
      method: 'POST', url: '/api/admin/book-benefits/codes/issue-status',
      body: { operationId: 'issue-http-001' }, headers: adminHeaders()
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.status, result.status)
    assert.equal(response.body.plaintextCode, undefined)
    assert.equal(response.body.sql, undefined)
    assert.equal(response.headers['cache-control'], 'no-store')
  }
}

async function testReplacementApi() {
  const { handler, bookBenefitStore } = createHandler()
  const body = { codeId: '92', operationId: 'replace-http-001', reasonCode: 'plaintext_unavailable' }
  const denied = await invoke(handler, { method: 'POST', url: '/api/admin/book-benefits/codes/replace', body })
  assert.equal(denied.statusCode, 401)
  assert.equal(bookBenefitStore.calls.length, 0)
  const response = await invoke(handler, {
    method: 'POST', url: '/api/admin/book-benefits/codes/replace', body, headers: adminHeaders()
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers.pragma, 'no-cache')
  assertOnlyKeys(response.body, ['ok', 'originalCodeId', 'replacementCodeId', 'plaintextCode', 'codeExpiresAt', 'applicationId', 'userId', 'generationNo', 'status'])
  const input = bookBenefitStore.calls.find(([kind]) => kind === 'replace')[1]
  assert.equal(input.operatorId, 'legacy-admin')
  assert.equal(input.now.toISOString(), NOW.toISOString())
  for (const invalidBody of [
    { ...body, operatorId: 'attacker' },
    { ...body, now: NOW.toISOString() },
    { ...body, reasonCode: 'free_text' }
  ]) {
    const before = bookBenefitStore.calls.length
    const rejected = await invoke(handler, {
      method: 'POST', url: '/api/admin/book-benefits/codes/replace', body: invalidBody, headers: adminHeaders()
    })
    assert.equal(rejected.statusCode, 400)
    assert.equal(bookBenefitStore.calls.length, before)
  }

  bookBenefitStore.behavior.replaceResult = {
    originalCodeId: '92', replacementCodeId: '93', plaintextCode: 'MUST-NOT-RETURN', codeExpiresAt: NOW,
    applicationId: '91', userId: USER_ID, generationNo: 2, status: 'REPLACEMENT_CODE_PLAINTEXT_UNAVAILABLE'
  }
  const replay = await invoke(handler, {
    method: 'POST', url: '/api/admin/book-benefits/codes/replace', body, headers: adminHeaders()
  })
  assert.equal(replay.statusCode, 409)
  assert.equal(replay.body.plaintextCode, undefined)

  for (const code of ['BOOK_BENEFIT_REPLACEMENT_LIMIT', 'BOOK_BENEFIT_CODE_REDEEMED', 'BOOK_BENEFIT_CAMPAIGN_NOT_ACTIVE']) {
    bookBenefitStore.behavior.replaceError = error(code, 409)
    const failed = await invoke(handler, {
      method: 'POST', url: '/api/admin/book-benefits/codes/replace', body, headers: adminHeaders()
    })
    assert.equal(failed.statusCode, 409)
    assert.equal(failed.body.code, code)
    assert.doesNotMatch(JSON.stringify(failed.body), /PRIVATE|password|SQL/i)
  }
}

async function testRedemptionApi() {
  const { handler, bookBenefitStore } = createHandler()
  const body = { code: 'BOOK-FAKE-ONE-TIME', operationId: 'redeem-http-001' }
  const denied = await invoke(handler, { method: 'POST', url: '/api/user/book-benefits/redeem', body })
  assert.equal(denied.statusCode, 401)
  assert.equal(denied.body.code, 'UNAUTHORIZED')

  const response = await invoke(handler, {
    method: 'POST', url: '/api/user/book-benefits/redeem', body, headers: userHeaders()
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assertOnlyKeys(response.body, ['ok', 'membershipType', 'membershipStatus', 'membershipStartedAt', 'membershipExpireAt', 'quotaBalance', 'idempotent'])
  assert.equal(response.body.quotaBalance, 7)
  const input = bookBenefitStore.calls.find(([kind]) => kind === 'redeem')[1]
  assert.equal(input.userId, USER_ID)
  assert.equal(input.plaintextCode, body.code)
  assert.equal(input.operationId, body.operationId)

  for (const fieldName of ['userId', 'campaignId', 'membershipDays', 'membershipType', 'sourceType', 'sourceId', 'redemptionCodeId', 'transactionId', 'operatorId', 'phoneHash', 'quotaBalance', 'now']) {
    const before = bookBenefitStore.calls.length
    const rejected = await invoke(handler, {
      method: 'POST', url: '/api/user/book-benefits/redeem', body: { ...body, [fieldName]: 'NO' }, headers: userHeaders()
    })
    assert.equal(rejected.statusCode, 400, fieldName)
    assert.equal(bookBenefitStore.calls.length, before, fieldName)
  }

  bookBenefitStore.behavior.redeemResult = {
    membershipType: 'monthly', membershipStatus: 'active',
    membershipStartedAt: new Date('2026-08-12T03:00:00.000Z'),
    membershipExpireAt: new Date('2026-09-11T03:00:00.000Z'), quotaBalance: 7, idempotent: true
  }
  const idempotent = await invoke(handler, {
    method: 'POST', url: '/api/user/book-benefits/redeem', body, headers: userHeaders()
  })
  assert.equal(idempotent.statusCode, 200)
  assert.equal(idempotent.body.idempotent, true)

  const mappings = new Map([
    ['BOOK_BENEFIT_CODE_REDEEMED', 'BOOK_BENEFIT_CODE_REDEEMED'],
    ['BOOK_BENEFIT_CODE_EXPIRED', 'BOOK_BENEFIT_CODE_EXPIRED'],
    ['BOOK_BENEFIT_CODE_VOIDED', 'BOOK_BENEFIT_CODE_VOIDED'],
    ['BOOK_BENEFIT_REDEMPTION_CONFLICT', 'BOOK_BENEFIT_ALREADY_PARTICIPATED'],
    ['BOOK_BENEFIT_PHONE_IDENTITY_REQUIRED', 'PHONE_VERIFICATION_REQUIRED']
  ])
  for (const [internalCode, publicCode] of mappings) {
    bookBenefitStore.behavior.redeemError = error(internalCode, 409)
    const failed = await invoke(handler, {
      method: 'POST', url: '/api/user/book-benefits/redeem', body, headers: userHeaders()
    })
    assert.equal(failed.statusCode, 409)
    assert.equal(failed.body.code, publicCode)
    assert.doesNotMatch(JSON.stringify(failed.body), /PRIVATE|password|SQL/i)
  }
}

async function testStatusStoreIsReadOnly() {
  const statuses = ['not_found', 'issued_plaintext_unavailable', 'replaced', 'inconsistent']
  for (const wanted of statuses) {
    const sql = []
    const connection = {
      async execute(statement) {
        sql.push(statement)
        if (statement.includes('FROM book_benefit_campaigns')) return [[{
          id: '7', campaign_key: 'book-benefit-30d-v1', name: CAMPAIGN.name, status: 'active',
          benefit_days: 30, rules_version: 'book-benefit-rules-v1', starts_at: null, ends_at: null
        }]]
        if (statement.includes('FROM book_benefit_applications')) {
          if (wanted === 'not_found') return [[]]
          return [[{ id: '91', application_no: 'BBA-1', campaign_id: '7', applicant_user_id: USER_ID, status: 'approved' }]]
        }
        if (statement.includes('WHERE issue_idempotency_key')) {
          if (wanted === 'inconsistent') return [[]]
          return [[{
            id: '92', application_id: '91', status: wanted === 'replaced' ? 'voided' : 'issued',
            replacement_code_id: wanted === 'replaced' ? '93' : null, expires_at: NOW
          }]]
        }
        if (statement.includes('FROM book_benefit_audit_events')) {
          return [[{ application_id: '91', code_id: '92', event_type: 'qualification_approved_code_issued', result: 'succeeded' }]]
        }
        if (statement.includes('WHERE id = ?')) return [[{ id: '93', application_id: '91', expires_at: NOW }]]
        throw new Error('Unexpected fake query')
      },
      release() {}
    }
    const store = createBookBenefitStore({
      pool: { async getConnection() { return connection } },
      entitlementStore: {},
      campaignKey: 'book-benefit-30d-v1'
    })
    const result = await store.getBookBenefitIssueOperationStatus({ operationId: 'issue-http-001' })
    assert.equal(result.status, wanted)
    assert.equal(sql.some((statement) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(statement)), false)
    assert.equal(Object.hasOwn(result, 'plaintextCode'), false)
  }
}

async function testCompatibilityAndPrivacy() {
  const { handler } = createHandler()
  const health = await invoke(handler, { url: '/api/health' })
  assert.equal(health.statusCode, 200)
  assert.equal(health.body.wordCount, 3)
  const handlerWithoutConfiguredBookBenefitSecrets = createApiHandler({
    nodeEnv: 'production', adminApiToken: ADMIN_TOKEN, jwtSecret: JWT_SECRET, now: () => new Date(NOW),
    store: { async getWordCount() { return 4 } }, userStore: {}, userEntitlementStore: {}, identityStore: {},
    userFavoritesStore: {}, userRecentWordsStore: {}, wechatLoginClient: {}, env: {}
  })
  const secretIndependentHealth = await invoke(handlerWithoutConfiguredBookBenefitSecrets, { url: '/api/health' })
  assert.equal(secretIndependentHealth.statusCode, 200)
  assert.equal(secretIndependentHealth.body.wordCount, 4)
  const existingAdminAuth = await invoke(handlerWithoutConfiguredBookBenefitSecrets, {
    url: '/api/admin/auth/check', headers: adminHeaders()
  })
  assert.equal(existingAdminAuth.statusCode, 200)

  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./server/index.mjs')"], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DB_|BOOK_|REDEMPTION_|PHONE_|ADMIN_API_TOKEN|JWT_SECRET)/.test(key)))
  })
  assert.equal(imported.status, 0, imported.stderr)
  assert.equal(imported.stdout, '')
  assert.equal(imported.stderr, '')

  const sentinels = ['FAKE-ORDER-PRIVATE-SENTINEL', 'FAKE-CODE-PRIVATE-SENTINEL', 'FAKE-TOKEN-PRIVATE-SENTINEL']
  const captured = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...values) => captured.push(values.join(' '))
  console.error = (...values) => captured.push(values.join(' '))
  try {
    const privateHandler = createHandler().handler
    await invoke(privateHandler, {
      method: 'POST', url: '/api/admin/book-benefits/codes/issue', headers: adminHeaders(),
      body: { ...STANDARD_ISSUE_BODY, orderNumber: sentinels[0] }
    })
    await invoke(privateHandler, {
      method: 'POST', url: '/api/admin/book-benefits/codes/issue', headers: { authorization: `Bearer ${sentinels[2]}` },
      body: STANDARD_ISSUE_BODY
    })
    await invoke(privateHandler, {
      method: 'POST', url: '/api/user/book-benefits/redeem', headers: userHeaders(),
      body: { code: sentinels[1], operationId: 'privacy-http-001' }
    })
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  for (const sentinel of sentinels) assert.equal(captured.join('\n').includes(sentinel), false)
}

async function testBookBenefitNamespaceNotFoundResponses() {
  const { handler, bookBenefitStore } = createHandler()
  const namespaceCases = [
    { method: 'GET', url: '/api/admin/book-benefits/codes/issue' },
    { method: 'GET', url: '/api/user/book-benefits/redeem' },
    { method: 'GET', url: '/api/admin/book-benefits/unknown' },
    { method: 'POST', url: '/api/user/book-benefits/unknown' },
    { method: 'GET', url: '/api/admin/book-benefits' },
    { method: 'GET', url: '/api/user/book-benefits' }
  ]
  for (const testCase of namespaceCases) {
    const response = await invoke(handler, testCase)
    assert.equal(response.statusCode, 404, `${testCase.method} ${testCase.url}`)
    assert.equal(response.headers['cache-control'], 'no-store', `${testCase.method} ${testCase.url}`)
    assert.deepEqual(response.body, { ok: false, message: 'API route not found.' })
    assert.equal(bookBenefitStore.calls.length, 0, `${testCase.method} ${testCase.url}`)
  }

  for (const url of ['/api/admin/book-benefits-extra', '/api/user/book-benefit', '/api/admin/book']) {
    const response = await invoke(handler, { method: 'GET', url })
    assert.equal(response.statusCode, 404, url)
    assert.equal(response.headers['cache-control'], undefined, url)
    assert.deepEqual(response.body, { ok: false, message: 'API route not found.' })
    assert.equal(bookBenefitStore.calls.length, 0, url)
  }
}

await testCampaignApi()
await testIssueApi()
await testIssueStatusApi()
await testReplacementApi()
await testRedemptionApi()
await testStatusStoreIsReadOnly()
await testCompatibilityAndPrivacy()
await testBookBenefitNamespaceNotFoundResponses()

console.log('Book-benefit delivery API tests passed.')
