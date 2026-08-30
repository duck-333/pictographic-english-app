import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'

const JWT_SECRET = 'route-test-jwt-secret'
const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function paymentResult() {
  return {
    orderNo: ORDER_NO,
    paymentStatus: 'pending',
    entitlementStatus: 'not_ready',
    deliveryStatus: 'not_ready',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:01.000Z',
    paidAt: null,
    entitlementGrantedAt: null,
    deliveredAt: null,
    hasMembershipGrant: false,
    hasEntitlementTransaction: false,
    paymentParams: {
      mode: 'short_series_goods',
      signData: '{"offerId":"safe"}',
      paySig: 'short-lived-pay-signature',
      signature: 'short-lived-user-signature'
    }
  }
}

async function startServer(service, overrides = {}) {
  const handler = createApiHandler({
    ...(service ? { virtualPaymentService: service } : {}),
    jwtSecret: JWT_SECRET,
    store: { async getWordCount() { return 0 } },
    userStore: {},
    identityStore: {},
    wechatLoginClient: {},
    ...overrides
  })
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  }
}

function authHeader(userId = '42') {
  return `Bearer ${createUserSessionToken(userId, { jwtSecret: JWT_SECRET }).token}`
}

async function read(response) {
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json()
  }
}

const calls = []
const service = {
  async createOrResumeOrder(input) {
    if (input.clientRequestId === 'request-db-failure') {
      const error = new Error('SQL_SENTINEL PASSWORD_SENTINEL HOST_SENTINEL')
      error.code = 'PAYMENT_SERVICE_UNAVAILABLE'
      error.statusCode = 503
      error.cause = new Error('OPENID_SENTINEL DATABASE_SENTINEL')
      error.details = { orderNo: ORDER_NO }
      throw error
    }
    if (!['android', 'harmony', 'windows'].includes(input.platform)) {
      const error = new Error('unsupported')
      error.code = 'PAYMENT_PLATFORM_UNSUPPORTED'
      error.statusCode = 400
      throw error
    }
    calls.push(['create', input])
    return paymentResult()
  },
  async getOwnedOrder(input) {
    calls.push(['get', input])
    if (input.authenticatedUserId !== '42' || input.orderNo !== ORDER_NO) {
      const error = new Error('hidden')
      error.code = 'PAYMENT_ORDER_NOT_FOUND'
      error.statusCode = 404
      throw error
    }
    const { paymentParams, ...summary } = paymentResult()
    return summary
  }
}

const { server, baseUrl } = await startServer(service)
try {
  const unauthenticated = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'fresh-code' })
  }))
  assert.equal(unauthenticated.status, 401)

  const invalidToken = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid' },
    body: JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'fresh-code' })
  }))
  assert.equal(invalidToken.status, 401)

  const created = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({
      clientRequestId: 'request-12345678',
      loginCode: 'fresh-code',
      sku: 'membership_30d',
      platform: 'android'
    })
  }))
  assert.equal(created.status, 200)
  assert.equal(created.headers.get('cache-control'), 'no-store')
  assert.equal(created.headers.get('pragma'), 'no-cache')
  assert.equal(created.body.ok, true)
  assert.equal(typeof created.body.paymentParams.signData, 'string')
  const serialized = JSON.stringify(created.body)
  for (const forbidden of ['sessionKey', 'session_key', 'AppKey', 'AppSecret', 'access_token', 'openid', 'JWT']) {
    assert(!serialized.includes(forbidden))
  }
  assert.deepEqual(calls[0], ['create', {
    authenticatedUserId: '42',
    clientRequestId: 'request-12345678',
    loginCode: 'fresh-code',
    sku: 'membership_30d',
    platform: 'android'
  }])

  const databaseFailure = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({
      clientRequestId: 'request-db-failure',
      loginCode: 'fresh-code',
      platform: 'android'
    })
  }))
  assert.equal(databaseFailure.status, 503)
  assert.deepEqual(databaseFailure.body, {
    ok: false,
    code: 'PAYMENT_SERVICE_UNAVAILABLE',
    message: 'Payment operation failed.'
  })
  const safeDatabaseFailure = JSON.stringify(databaseFailure.body)
  for (const sentinel of ['SQL_SENTINEL', 'PASSWORD_SENTINEL', 'HOST_SENTINEL', 'OPENID_SENTINEL', 'DATABASE_SENTINEL', ORDER_NO]) {
    assert(!safeDatabaseFailure.includes(sentinel))
  }

  for (const allowedPlatform of ['harmony', 'windows']) {
    const allowed = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({
        clientRequestId: `request-${allowedPlatform}`,
        loginCode: 'fresh-code',
        platform: allowedPlatform
      })
    }))
    assert.equal(allowed.status, 200)
  }

  const queried = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders/${ORDER_NO}`, {
    headers: { Authorization: authHeader() }
  }))
  assert.equal(queried.status, 200)
  assert.equal(queried.headers.get('cache-control'), 'no-store')
  assert.equal(queried.body.orderNo, ORDER_NO)
  assert.equal(Object.hasOwn(queried.body, 'paymentParams'), false)

  const hidden = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders/${ORDER_NO}`, {
    headers: { Authorization: authHeader('43') }
  }))
  assert.equal(hidden.status, 404)
  assert.deepEqual(hidden.body, {
    ok: false,
    code: 'PAYMENT_ORDER_NOT_FOUND',
    message: 'Payment order was not found.'
  })

  const malformedOrder = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders/not-an-order`, {
    headers: { Authorization: authHeader() }
  }))
  assert.equal(malformedOrder.status, 404)

  for (const body of [
    'null',
    '[]',
    '{bad-json',
    '{"clientRequestId":"request-12345678","clientRequestId":"request-duplicate","loginCode":"fresh-code"}',
    '{"clientRequestI\\u0064":"request-12345678","clientRequestId":"request-duplicate","loginCode":"fresh-code"}',
    JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'fresh-code', price: 1 }),
    JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'fresh-code', userId: '42' }),
    JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'fresh-code', env: 1 })
  ]) {
    const invalid = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body
    }))
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'PAYMENT_REQUEST_INVALID')
  }

  const wrongContentType = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Authorization: authHeader() },
    body: '{}'
  }))
  assert.equal(wrongContentType.status, 400)

  const tooLarge = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'x'.repeat(17 * 1024) })
  }))
  assert.equal(tooLarge.status, 400)

  const successfulCreateCalls = calls.filter((call) => call[0] === 'create').length
  for (const platformBody of [
    {},
    { platform: 'unknown' },
    { platform: 'ios' },
    { platform: '' },
    { platform: ' android' },
    { platform: 'ANDROID' },
    { platform: 'linux' },
    { platform: 1 },
    { platform: true },
    { platform: null },
    { platform: [] },
    { platform: {} }
  ]) {
    const rejected = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({
        clientRequestId: 'request-platform-reject',
        loginCode: 'fresh-code',
        ...platformBody
      })
    }))
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.code, 'PAYMENT_PLATFORM_UNSUPPORTED')
  }
  assert.equal(calls.filter((call) => call[0] === 'create').length, successfulCreateCalls)

  const methodNotAllowed = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders`, {
    headers: { Authorization: authHeader() }
  }))
  assert.equal(methodNotAllowed.status, 405)

  const health = await read(await fetch(`${baseUrl}/api/health`))
  assert.equal(health.status, 200)
  assert.equal(health.body.wordCount, 0)
} finally {
  await new Promise((resolve) => server.close(resolve))
}

let disabledCalls = 0
const disabledServer = await startServer({
  async createOrResumeOrder() {
    disabledCalls += 1
    const error = new Error('disabled')
    error.code = 'PAYMENT_DISABLED'
    error.statusCode = 503
    throw error
  },
  async getOwnedOrder() { throw new Error('must not run') }
})
try {
  const disabled = await read(await fetch(`${disabledServer.baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'fresh-code' })
  }))
  assert.equal(disabled.status, 503)
  assert.equal(disabled.body.code, 'PAYMENT_DISABLED')
  assert.equal(disabledCalls, 1)
} finally {
  await new Promise((resolve) => disabledServer.server.close(resolve))
}

let disabledDependencyCalls = 0
const defaultDisabledServer = await startServer(null, {
  env: {},
  virtualPaymentStore: {
    async findByUserAndClientRequestId() { disabledDependencyCalls += 1 },
    async findByUserAndOrderNo() { disabledDependencyCalls += 1 },
    async createOrder() { disabledDependencyCalls += 1 },
    async markOrderPending() { disabledDependencyCalls += 1 }
  },
  virtualPaymentSessionService: {
    async exchangeAndVerifyPaymentSession() { disabledDependencyCalls += 1 }
  },
  virtualPaymentSigningService: {
    createPaymentParameters() { disabledDependencyCalls += 1 }
  }
})
try {
  const disabled = await read(await fetch(`${defaultDisabledServer.baseUrl}/api/user/virtual-payment/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ clientRequestId: 'request-12345678', loginCode: 'fresh-code' })
  }))
  assert.equal(disabled.status, 503)
  assert.equal(disabled.body.code, 'PAYMENT_DISABLED')
  assert.equal(disabledDependencyCalls, 0)
} finally {
  await new Promise((resolve) => defaultDisabledServer.server.close(resolve))
}

console.log('Virtual payment route tests passed.')
