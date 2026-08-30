import assert from 'node:assert/strict'
import { inspect } from 'node:util'

import { createIdentityStore } from '../server/identity-store.mjs'
import * as paymentSessionModule from '../server/virtual-payment-session.mjs'
import {
  createPaymentSessionSignature,
  createSensitivePaymentSession,
  createVirtualPaymentSessionService
} from '../server/virtual-payment-session.mjs'
import { createWechatLoginClient } from '../server/wechat-login.mjs'

const APP_ID = 'fake-app-id'
const APP_SECRET = 'fake-app-secret-sensitive'
const LOGIN_CODE = 'fresh-login-code-sensitive'
const OPENID = 'fake-openid-sensitive'
const UNIONID = 'fake-unionid-sensitive'
const SESSION_KEY = 'fake-session-key-sensitive'
const USER_ID = '42'
const DB_HOST = 'fake-db-host-sensitive'
const DB_PASSWORD = 'fake-db-password-sensitive'
const SIGN_DATA = '{"offerId":"sandbox.offer-001","buyQuantity":1,"env":1,"currencyType":"CNY","productId":"membership.product-30d","goodsPrice":3000,"outTradeNo":"VP20260830ABC123","attach":"opaque_ref_1234567890"}'
const EXPECTED_SIGNATURE = '41933e9eacbeee03ef147736896a76f916cca9c2d545218cf42bb85907a68c82'
const SENSITIVE_VALUES = [
  APP_SECRET,
  LOGIN_CODE,
  OPENID,
  UNIONID,
  SESSION_KEY,
  DB_HOST,
  DB_PASSWORD
]

function assertSafeError(error, expectedCode) {
  assert.equal(error && error.code, expectedCode)
  assert.equal(Object.hasOwn(error, 'cause'), false)
  assert.equal(Object.hasOwn(error, 'details'), false)
  const serialized = [
    error && error.message,
    error && error.stack,
    JSON.stringify(error),
    JSON.stringify(error && error.cause),
    JSON.stringify(error && error.details)
  ].join('\n')
  SENSITIVE_VALUES.forEach((value) => {
    assert(!serialized.includes(value), `error must not expose ${value}`)
  })
  assert(!serialized.includes('errmsg'))
  assert(!serialized.includes('SELECT '))
  assert(!serialized.includes('https://'))
}

async function expectSerializationForbidden(value) {
  return await expectError(
    () => JSON.stringify(value),
    'PAYMENT_SESSION_SERIALIZATION_FORBIDDEN'
  )
}

function assertSensitiveSessionShape(result, expectedKeys) {
  assert.deepEqual(Object.keys(result).sort(), [...expectedKeys].sort())
  assert.equal(Object.hasOwn(result, 'sessionKey'), false)
  assert.equal(result.sessionKey, undefined)
  assert.equal(Object.hasOwn({ ...result }, 'sessionKey'), false)
  assert(!inspect(result).includes(SESSION_KEY))
  assert(Object.isFrozen(result))
}

async function expectError(run, expectedCode) {
  let thrown = null
  try {
    await run()
  } catch (error) {
    thrown = error
  }
  assert(thrown, `expected ${expectedCode}`)
  assertSafeError(thrown, expectedCode)
  return thrown
}

function createWechatClient(requestJson) {
  return createWechatLoginClient({
    appid: APP_ID,
    secret: APP_SECRET,
    requestJson
  })
}

async function testOrdinaryCode2SessionFiltersSensitiveFields() {
  const client = createWechatClient(async () => ({
    openid: OPENID,
    unionid: UNIONID,
    session_key: SESSION_KEY
  }))
  const result = await client.code2Session(LOGIN_CODE)
  assert.deepEqual(result, {
    openid: OPENID,
    unionid: UNIONID
  })
  assert.equal(Object.hasOwn(result, 'session_key'), false)
  assert.equal(Object.hasOwn(result, 'sessionKey'), false)
}

async function testPaymentExchangeReturnsInternalSessionOnce() {
  let requestCount = 0
  const client = createWechatClient(async (url, options) => {
    requestCount += 1
    assert.equal(url.origin, 'https://api.weixin.qq.com')
    assert.equal(url.pathname, '/sns/jscode2session')
    assert.equal(url.searchParams.get('appid'), APP_ID)
    assert.equal(url.searchParams.get('secret'), APP_SECRET)
    assert.equal(url.searchParams.get('js_code'), LOGIN_CODE)
    assert.equal(options.timeout, undefined)
    return {
      openid: OPENID,
      unionid: UNIONID,
      session_key: SESSION_KEY
    }
  })

  const result = await client.exchangePaymentSession(LOGIN_CODE)
  assert.equal(requestCount, 1)
  assertSensitiveSessionShape(result, ['openid', 'unionid'])
  assert.equal(result.openid, OPENID)
  assert.equal(result.unionid, UNIONID)
  await expectSerializationForbidden(result)
  assert.equal(createPaymentSessionSignature(result, SIGN_DATA), EXPECTED_SIGNATURE)
  await expectError(
    () => createPaymentSessionSignature(result, SIGN_DATA),
    'WECHAT_SERVICE_UNAVAILABLE'
  )
}

async function testPaymentExchangeFailuresAreControlledAndNotRetried() {
  let invalidRequestCount = 0
  const invalidClient = createWechatClient(async () => {
    invalidRequestCount += 1
    return {}
  })
  for (const invalidCode of [
    '',
    '   ',
    'line\nfeed',
    'carriage\rreturn',
    `null\u0000byte`,
    `delete\u007fcharacter`,
    'x'.repeat(257),
    123,
    {},
    [],
    true,
    null,
    undefined
  ]) {
    await expectError(
      () => invalidClient.exchangePaymentSession(invalidCode),
      'PAYMENT_LOGIN_CODE_INVALID'
    )
  }
  assert.equal(invalidRequestCount, 0)

  const encodedCode = 'code+with=/?:.% and spaces'
  let receivedCode = ''
  const encodedClient = createWechatClient(async (url) => {
    receivedCode = url.searchParams.get('js_code')
    return {
      errcode: 0,
      openid: OPENID,
      unionid: UNIONID,
      session_key: SESSION_KEY
    }
  })
  const encodedResult = await encodedClient.exchangePaymentSession(encodedCode)
  assert.equal(receivedCode, encodedCode)
  assert.equal(encodedResult.openid, OPENID)

  let incompleteRequestCount = 0
  const missingOpenidClient = createWechatClient(async () => {
    incompleteRequestCount += 1
    return { session_key: SESSION_KEY }
  })
  await expectError(
    () => missingOpenidClient.exchangePaymentSession(LOGIN_CODE),
    'WECHAT_PAYMENT_SESSION_INCOMPLETE'
  )

  const missingSessionClient = createWechatClient(async () => {
    incompleteRequestCount += 1
    return { openid: OPENID }
  })
  await expectError(
    () => missingSessionClient.exchangePaymentSession(LOGIN_CODE),
    'WECHAT_PAYMENT_SESSION_INCOMPLETE'
  )
  assert.equal(incompleteRequestCount, 2)

  let expiredRequestCount = 0
  const expiredClient = createWechatClient(async () => {
    expiredRequestCount += 1
    return {
      errcode: 40029,
      errmsg: `raw-${LOGIN_CODE}-${APP_SECRET}-${SESSION_KEY}-${OPENID}`
    }
  })
  await expectError(
    () => expiredClient.exchangePaymentSession(LOGIN_CODE),
    'WECHAT_CODE_EXCHANGE_FAILED'
  )
  assert.equal(expiredRequestCount, 1, 'an invalid Wechat code must not be retried')

  let networkRequestCount = 0
  const unavailableClient = createWechatClient(async () => {
    networkRequestCount += 1
    throw new Error(`network ${LOGIN_CODE} ${APP_SECRET} ${SESSION_KEY} ${OPENID} https://secret`)
  })
  await expectError(
    () => unavailableClient.exchangePaymentSession(LOGIN_CODE),
    'WECHAT_SERVICE_UNAVAILABLE'
  )
  assert.equal(networkRequestCount, 1, 'an uncertain exchange must not be retried')

  const unconfiguredClient = createWechatLoginClient({ appid: '', secret: '' })
  await expectError(
    () => unconfiguredClient.exchangePaymentSession(LOGIN_CODE),
    'WECHAT_SERVICE_UNAVAILABLE'
  )
}

async function testPaymentExchangeStrictResponseValidation() {
  const incompletePayloads = [
    null,
    [],
    'not-an-object',
    { openid: {}, session_key: SESSION_KEY },
    { openid: [], session_key: SESSION_KEY },
    { openid: 123, session_key: SESSION_KEY },
    { openid: true, session_key: SESSION_KEY },
    { openid: '   ', session_key: SESSION_KEY },
    { openid: `bad\u0000${OPENID}`, session_key: SESSION_KEY },
    { openid: 'x'.repeat(129), session_key: SESSION_KEY },
    { openid: ` ${OPENID}`, session_key: SESSION_KEY },
    { openid: OPENID, session_key: {} },
    { openid: OPENID, session_key: [] },
    { openid: OPENID, session_key: 123 },
    { openid: OPENID, session_key: true },
    { openid: OPENID, session_key: 'too-short' },
    { openid: OPENID, session_key: ' '.repeat(16) },
    { openid: OPENID, session_key: `bad\n${SESSION_KEY}` },
    { openid: OPENID, session_key: 'x'.repeat(10000) },
    { openid: OPENID, sessionKey: SESSION_KEY },
    { openid: OPENID, session_key: SESSION_KEY, unionid: {} },
    { openid: OPENID, session_key: SESSION_KEY, unionid: [] },
    { openid: OPENID, session_key: SESSION_KEY, unionid: 123 },
    { openid: OPENID, session_key: SESSION_KEY, unionid: true },
    { openid: OPENID, session_key: SESSION_KEY, unionid: '   ' }
  ]
  for (const payload of incompletePayloads) {
    const client = createWechatClient(async () => payload)
    await expectError(
      () => client.exchangePaymentSession(LOGIN_CODE),
      'WECHAT_PAYMENT_SESSION_INCOMPLETE'
    )
  }

  for (const errcode of ['malformed', '0', 0.5, 40029, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
    const client = createWechatClient(async () => ({
      errcode,
      errmsg: `raw ${SESSION_KEY} ${OPENID}`,
      openid: OPENID,
      session_key: SESSION_KEY
    }))
    await expectError(
      () => client.exchangePaymentSession(LOGIN_CODE),
      'WECHAT_CODE_EXCHANGE_FAILED'
    )
  }

  const validClient = createWechatClient(async () => ({
    errcode: 0,
    openid: OPENID,
    session_key: SESSION_KEY
  }))
  const validResult = await validClient.exchangePaymentSession(LOGIN_CODE)
  assert.equal(validResult.openid, OPENID)
  assert.equal(validResult.unionid, null)
  assert.equal(createPaymentSessionSignature(validResult, SIGN_DATA), EXPECTED_SIGNATURE)

  const nullUnionidClient = createWechatClient(async () => ({
    openid: OPENID,
    unionid: null,
    session_key: SESSION_KEY
  }))
  assert.equal((await nullUnionidClient.exchangePaymentSession(LOGIN_CODE)).unionid, null)
}

function createSessionService(identityStore, overrides = {}) {
  return createVirtualPaymentSessionService({
    wechatLoginClient: overrides.wechatLoginClient || {
      async exchangePaymentSession(code) {
        assert.equal(code, LOGIN_CODE)
        return createSensitivePaymentSession({
          openid: OPENID,
          unionid: UNIONID
        }, SESSION_KEY)
      }
    },
    identityStore
  })
}

async function testIdentityOwnershipCoordinator() {
  let lookupOpenid = ''
  const matchingService = createSessionService({
    async findWechatBindingForPayment(openid) {
      lookupOpenid = openid
      return { userId: USER_ID }
    }
  })
  const result = await matchingService.exchangeAndVerifyPaymentSession({
    loginCode: LOGIN_CODE,
    authenticatedUserId: USER_ID
  })
  assert.equal(lookupOpenid, OPENID)
  assert.equal(result.userId, USER_ID)
  assert.equal(result.openid, OPENID)
  assert.equal(result.unionid, UNIONID)
  assertSensitiveSessionShape(result, ['openid', 'unionid', 'userId'])
  await expectSerializationForbidden(result)
  assert.equal(createPaymentSessionSignature(result, SIGN_DATA), EXPECTED_SIGNATURE)
  await expectError(
    () => createPaymentSessionSignature(result, SIGN_DATA),
    'WECHAT_SERVICE_UNAVAILABLE'
  )

  const notBoundService = createSessionService({
    async findWechatBindingForPayment() {
      return null
    }
  })
  await expectError(
    () => notBoundService.exchangeAndVerifyPaymentSession({
      loginCode: LOGIN_CODE,
      authenticatedUserId: USER_ID
    }),
    'WECHAT_IDENTITY_NOT_BOUND'
  )

  const mismatchService = createSessionService({
    async findWechatBindingForPayment() {
      return { userId: '43' }
    }
  })
  await expectError(
    () => mismatchService.exchangeAndVerifyPaymentSession({
      loginCode: LOGIN_CODE,
      authenticatedUserId: USER_ID
    }),
    'WECHAT_IDENTITY_MISMATCH'
  )

  const ambiguousService = createSessionService({
    async findWechatBindingForPayment() {
      const error = new Error(`ambiguous ${OPENID}`)
      error.code = 'WECHAT_IDENTITY_AMBIGUOUS'
      throw error
    }
  })
  await expectError(
    () => ambiguousService.exchangeAndVerifyPaymentSession({
      loginCode: LOGIN_CODE,
      authenticatedUserId: USER_ID
    }),
    'WECHAT_IDENTITY_AMBIGUOUS'
  )

  const invalidBindingService = createSessionService({
    async findWechatBindingForPayment() {
      return { userId: 'not-a-user-id' }
    }
  })
  await expectError(
    () => invalidBindingService.exchangeAndVerifyPaymentSession({
      loginCode: LOGIN_CODE,
      authenticatedUserId: USER_ID
    }),
    'WECHAT_IDENTITY_AMBIGUOUS'
  )

  const databaseFailureService = createSessionService({
    async findWechatBindingForPayment() {
      throw new Error(`SELECT failed for ${OPENID}`)
    }
  })
  await expectError(
    () => databaseFailureService.exchangeAndVerifyPaymentSession({
      loginCode: LOGIN_CODE,
      authenticatedUserId: USER_ID
    }),
    'WECHAT_SERVICE_UNAVAILABLE'
  )

  for (const invalidUserId of ['', '0', '-1', '1.5', 'abc', Number.MAX_SAFE_INTEGER + 1]) {
    let exchangeCalled = false
    const service = createSessionService({
      async findWechatBindingForPayment() {
        throw new Error('identity lookup must not run')
      }
    }, {
      wechatLoginClient: {
        async exchangePaymentSession() {
          exchangeCalled = true
          throw new Error('exchange must not run')
        }
      }
    })
    await expectError(
      () => service.exchangeAndVerifyPaymentSession({
        loginCode: LOGIN_CODE,
        authenticatedUserId: invalidUserId
      }),
      'PAYMENT_AUTHENTICATED_USER_INVALID'
    )
    assert.equal(exchangeCalled, false)
  }
}

async function testIdentityStoreUsesReadOnlyUniqueLookup() {
  async function runLookup(options = {}) {
    const executedStatements = []
    let releaseCount = 0
    const connection = {
      async execute(sql, params) {
        executedStatements.push({ sql, params })
        if (options.executeError) throw options.executeError
        return options.executionResult === undefined
          ? [options.rows === undefined ? [{ user_id: USER_ID }] : options.rows]
          : options.executionResult
      },
      async release() {
        releaseCount += 1
        if (options.releaseError) throw options.releaseError
      }
    }
    const store = createIdentityStore({
      pool: {
        async getConnection() {
          if (options.connectionError) throw options.connectionError
          return connection
        }
      }
    })
    let result
    let error
    try {
      result = await store.findWechatBindingForPayment(OPENID)
    } catch (caughtError) {
      error = caughtError
    }
    executedStatements.forEach(({ sql, params }) => {
      assert.match(sql, /^SELECT user_id FROM `wechat_user_bindings` WHERE openid = \? LIMIT 2$/)
      assert.deepEqual(params, [OPENID])
      assert(!/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))
    })
    assert.equal(typeof connection.beginTransaction, 'undefined')
    assert.equal(typeof connection.commit, 'undefined')
    assert.equal(typeof connection.rollback, 'undefined')
    return { result, error, executedStatements, releaseCount }
  }

  const validCases = [
    { value: 42, expected: '42' },
    { value: '42', expected: '42' },
    { value: '00042', expected: '42' },
    { value: `${'0'.repeat(40)}42`, expected: '42' },
    { value: Number.MAX_SAFE_INTEGER, expected: String(Number.MAX_SAFE_INTEGER) },
    { value: String(Number.MAX_SAFE_INTEGER), expected: String(Number.MAX_SAFE_INTEGER) }
  ]
  for (const testCase of validCases) {
    const outcome = await runLookup({ rows: [{ user_id: testCase.value }] })
    assert.equal(outcome.error, undefined)
    assert.deepEqual(outcome.result, { userId: testCase.expected })
    assert.equal(outcome.releaseCount, 1)
  }

  const invalidValues = [
    null,
    undefined,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
    '-1',
    '+1',
    '1.5',
    '1e3',
    'not-a-user-id',
    '9007199254740992',
    {},
    []
  ]
  for (const value of invalidValues) {
    const outcome = await runLookup({ rows: [{ user_id: value }] })
    assertSafeError(outcome.error, 'WECHAT_IDENTITY_AMBIGUOUS')
    assert.equal(outcome.releaseCount, 1)
  }

  for (const rows of [
    [{ user_id: USER_ID }, { user_id: USER_ID }],
    [{ user_id: USER_ID }, { user_id: '43' }]
  ]) {
    const outcome = await runLookup({ rows })
    assertSafeError(outcome.error, 'WECHAT_IDENTITY_AMBIGUOUS')
  }

  const missing = await runLookup({ rows: [] })
  assert.equal(missing.result, null)
  assert.equal(missing.error, undefined)

  const malformed = await runLookup({ executionResult: { rows: [] } })
  assertSafeError(malformed.error, 'WECHAT_IDENTITY_AMBIGUOUS')

  const rawDatabaseError = new Error(
    `SELECT secret FROM bindings host=${DB_HOST} password=${DB_PASSWORD} openid=${OPENID}`
  )
  for (const testCase of [
    { options: { connectionError: rawDatabaseError }, expectedReleaseCount: 0 },
    { options: { executeError: rawDatabaseError }, expectedReleaseCount: 1 },
    { options: { releaseError: rawDatabaseError }, expectedReleaseCount: 1 },
    {
      options: { executeError: rawDatabaseError, releaseError: rawDatabaseError },
      expectedReleaseCount: 1
    }
  ]) {
    const outcome = await runLookup(testCase.options)
    assertSafeError(outcome.error, 'WECHAT_IDENTITY_QUERY_FAILED')
    assert.equal(outcome.releaseCount, testCase.expectedReleaseCount)
  }
}

async function testNoSensitiveLogging() {
  const captured = []
  const originalMethods = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  }
  Object.keys(originalMethods).forEach((method) => {
    console[method] = (...args) => captured.push(args)
  })
  try {
    const client = createWechatClient(async () => ({
      errcode: 40029,
      errmsg: `${OPENID} ${SESSION_KEY} ${APP_SECRET} ${LOGIN_CODE}`
    }))
    await expectError(
      () => client.exchangePaymentSession(LOGIN_CODE),
      'WECHAT_CODE_EXCHANGE_FAILED'
    )
    const successfulClient = createWechatClient(async () => ({
      openid: OPENID,
      unionid: UNIONID,
      session_key: SESSION_KEY
    }))
    console.info(await successfulClient.exchangePaymentSession(LOGIN_CODE))
  } finally {
    Object.assign(console, originalMethods)
  }
  assert.equal(captured.length, 1)
  const loggerInspection = captured.flatMap((args) => args.map((value) => inspect(value))).join('\n')
  assert(!loggerInspection.includes(SESSION_KEY))
  assert(!loggerInspection.includes('sessionKey'))
}

await testOrdinaryCode2SessionFiltersSensitiveFields()
await testPaymentExchangeReturnsInternalSessionOnce()
await testPaymentExchangeFailuresAreControlledAndNotRetried()
await testPaymentExchangeStrictResponseValidation()
await testIdentityOwnershipCoordinator()
await testIdentityStoreUsesReadOnlyUniqueLookup()
await testNoSensitiveLogging()

assert.equal(Object.hasOwn(paymentSessionModule, 'consumePaymentSessionKey'), false)
await expectError(
  () => createPaymentSessionSignature({}, SIGN_DATA),
  'WECHAT_SERVICE_UNAVAILABLE'
)
const invalidSignDataSession = createSensitivePaymentSession({ openid: OPENID }, SESSION_KEY)
await expectError(
  () => createPaymentSessionSignature(invalidSignDataSession, '{"env":1}'),
  'WECHAT_SERVICE_UNAVAILABLE'
)
assert.equal(
  createPaymentSessionSignature(invalidSignDataSession, SIGN_DATA),
  EXPECTED_SIGNATURE,
  'invalid signData must not consume the private session'
)

console.log('Virtual payment session tests passed.')
