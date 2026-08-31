import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'

const JWT_SECRET = 'reconciliation-route-jwt-secret'
const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function authHeader(userId = '42') {
  return `Bearer ${createUserSessionToken(userId, { jwtSecret: JWT_SECRET }).token}`
}

function summary(paymentStatus = 'paid') {
  return {
    orderNo: ORDER_NO,
    paymentStatus,
    entitlementStatus: 'not_ready',
    deliveryStatus: 'not_ready',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    paidAt: paymentStatus === 'paid' ? '2026-08-31T00:00:00.000Z' : null,
    entitlementGrantedAt: null,
    deliveredAt: null,
    hasMembershipGrant: false,
    hasEntitlementTransaction: false
  }
}

async function startServer(service) {
  const handler = createApiHandler({
    virtualPaymentService: service,
    jwtSecret: JWT_SECRET,
    store: { async getWordCount() { return 0 } },
    userStore: {},
    identityStore: {},
    wechatLoginClient: {}
  })
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` }
}

async function read(response) {
  return { status: response.status, headers: response.headers, body: await response.json() }
}

const calls = []
const service = {
  async createOrResumeOrder() { throw new Error('not used') },
  async getOwnedOrder() { throw new Error('not used') },
  async reconcileOwnedOrder(input) {
    if (typeof input.loginCode !== 'string' || !input.loginCode) {
      const error = new Error('invalid')
      error.code = 'PAYMENT_REQUEST_INVALID'
      error.statusCode = 400
      throw error
    }
    calls.push(input)
    if (input.authenticatedUserId !== '42' || input.orderNo !== ORDER_NO) {
      const error = new Error('hidden order details')
      error.code = 'PAYMENT_ORDER_NOT_FOUND'
      error.statusCode = 404
      throw error
    }
    if (input.loginCode === 'unsafe-error') {
      const error = new Error('ACCESS_TOKEN APP_SECRET OPENID SQL FULL_URL RESPONSE_BODY')
      error.code = 'PAYMENT_QUERY_UNAVAILABLE'
      error.statusCode = 503
      error.cause = new Error('SESSION_KEY PROVIDER_ORDER')
      error.details = { loginCode: input.loginCode }
      throw error
    }
    if (input.loginCode === 'damaged-paid') {
      const error = new Error('DAMAGED_PRODUCT_SENTINEL PROVIDER_SENTINEL')
      error.code = 'PAYMENT_PAID_FACT_INCOMPLETE'
      error.statusCode = 409
      throw error
    }
    return summary()
  }
}

const { server, baseUrl } = await startServer(service)
try {
  const endpoint = `${baseUrl}/api/user/virtual-payment/orders/${ORDER_NO}/reconcile`
  const unauthenticated = await read(await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginCode: 'fresh-code' })
  }))
  assert.equal(unauthenticated.status, 401)
  assert.equal(calls.length, 0)

  const reconciled = await read(await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ loginCode: 'fresh-code' })
  }))
  assert.equal(reconciled.status, 200)
  assert.equal(reconciled.headers.get('cache-control'), 'no-store')
  assert.equal(reconciled.headers.get('pragma'), 'no-cache')
  assert.deepEqual(reconciled.body, { ok: true, ...summary() })
  assert.deepEqual(calls[0], {
    authenticatedUserId: '42',
    orderNo: ORDER_NO,
    loginCode: 'fresh-code'
  })

  for (const forbiddenBody of [
    {},
    { loginCode: 'fresh-code', userId: '42' },
    { loginCode: 'fresh-code', openid: 'client-openid' },
    { loginCode: 'fresh-code', env: 1 },
    { loginCode: 'fresh-code', paid: true },
    { loginCode: 'fresh-code', paymentStatus: 'paid' },
    { loginCode: 'fresh-code', paidAmount: 3000 },
    { loginCode: 'fresh-code', providerOrderId: 'provider' },
    { loginCode: 'fresh-code', productId: 'client-product' },
    { loginCode: 'fresh-code', orderType: 0 },
    { loginCode: 'fresh-code', event_type: 'wechat_query_status_2_paid' },
    { loginCode: 'fresh-code', event_key: 'wechat_query:client-controlled' },
    { loginCode: 'fresh-code', paySig: 'forbidden' },
    { loginCode: 'fresh-code', signature: 'forbidden' },
    { loginCode: 'fresh-code', access_token: 'forbidden' }
  ]) {
    const rejected = await read(await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify(forbiddenBody)
    }))
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.code, 'PAYMENT_REQUEST_INVALID')
  }
  assert.equal(calls.length, 1)

  const duplicateField = await read(await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: '{"loginCode":"one","loginCode":"two"}'
  }))
  assert.equal(duplicateField.status, 400)
  assert.equal(calls.length, 1)

  const malformed = await read(await fetch(`${baseUrl}/api/user/virtual-payment/orders/not-an-order/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ loginCode: 'fresh-code' })
  }))
  assert.equal(malformed.status, 404)
  assert.equal(malformed.body.code, 'PAYMENT_ORDER_NOT_FOUND')
  assert.equal(calls.length, 1)

  const hidden = await read(await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader('43') },
    body: JSON.stringify({ loginCode: 'fresh-code' })
  }))
  assert.equal(hidden.status, 404)
  assert.deepEqual(hidden.body, {
    ok: false,
    code: 'PAYMENT_ORDER_NOT_FOUND',
    message: 'Payment order was not found.'
  })

  const unsafe = await read(await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ loginCode: 'unsafe-error' })
  }))
  assert.equal(unsafe.status, 503)
  assert.deepEqual(unsafe.body, {
    ok: false,
    code: 'PAYMENT_QUERY_UNAVAILABLE',
    message: 'Payment operation failed.'
  })
  const serialized = JSON.stringify(unsafe.body)
  for (const sentinel of [
    'ACCESS_TOKEN', 'APP_SECRET', 'OPENID', 'SQL', 'FULL_URL', 'RESPONSE_BODY',
    'SESSION_KEY', 'PROVIDER_ORDER', 'unsafe-error'
  ]) assert.equal(serialized.includes(sentinel), false)

  const damagedPaid = await read(await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ loginCode: 'damaged-paid' })
  }))
  assert.equal(damagedPaid.status, 409)
  assert.equal(damagedPaid.body.code, 'PAYMENT_PAID_FACT_INCOMPLETE')
  assert.equal(/DAMAGED_PRODUCT_SENTINEL|PROVIDER_SENTINEL/.test(JSON.stringify(damagedPaid.body)), false)

  const wrongMethod = await read(await fetch(endpoint, {
    headers: { Authorization: authHeader() }
  }))
  assert.equal(wrongMethod.status, 405)
} finally {
  await new Promise((resolve) => server.close(resolve))
}

console.log('virtual payment reconciliation route tests passed')
