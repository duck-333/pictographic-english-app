import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'

const JWT_SECRET = 'delivery-route-jwt-secret'
const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const calls = []
const result = Object.freeze({
  orderNo: ORDER_NO,
  paymentStatus: 'paid',
  entitlementStatus: 'granted',
  deliveryStatus: 'confirming',
  idempotent: false,
  confirming: true,
  manualReview: false,
  retryable: false
})
const service = {
  async createOrResumeOrder() { throw new Error('not used') },
  async getOwnedOrder() { throw new Error('not used') },
  async reconcileOwnedOrder() { throw new Error('not used') },
  async grantOwnedOrderEntitlement() { throw new Error('not used') },
  async deliverOwnedOrder(input) { calls.push(input); return result }
}
const handler = createApiHandler({
  virtualPaymentService: service,
  jwtSecret: JWT_SECRET,
  store: { async getWordCount() { return 0 } },
  userStore: {}, identityStore: {}, wechatLoginClient: {}
})
const server = http.createServer(handler)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const endpoint = `http://127.0.0.1:${server.address().port}/api/user/virtual-payment/orders/${ORDER_NO}/delivery`
const auth = `Bearer ${createUserSessionToken('42', { jwtSecret: JWT_SECRET }).token}`

async function request(body, authorization = auth) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body
  })
  return { response, payload: await response.json() }
}

try {
  const unauthorized = await request('{}', '')
  assert.equal(unauthorized.response.status, 401)
  assert.equal(calls.length, 0)

  const success = await request('{}')
  assert.equal(success.response.status, 200)
  assert.equal(success.response.headers.get('cache-control'), 'no-store')
  assert.equal(success.response.headers.get('pragma'), 'no-cache')
  assert.deepEqual(success.payload, { ok: true, ...result })
  assert.deepEqual(calls[0], { authenticatedUserId: '42', orderNo: ORDER_NO })
  const serialized = JSON.stringify(success.payload)
  for (const forbidden of [
    'openid', 'provider', 'operationId', 'attemptId', 'access_token',
    'payloadHash', 'eventKey', 'wx_order_id', 'WXPAY'
  ]) assert(!serialized.includes(forbidden))

  for (const body of [
    '', 'null', '[]', '"text"', '{bad',
    '{"operationId":"x"}', '{"openid":"x"}', '{"userId":"42"}',
    '{"env":1}', '{"amount":3000}', '{"orderNo":"x"}',
    '{"providerOrderId":"x"}', '{"attemptId":"x"}'
  ]) {
    const before = calls.length
    const rejected = await request(body)
    assert.equal(rejected.response.status, 400)
    assert.equal(rejected.response.headers.get('cache-control'), 'no-store')
    assert.equal(rejected.response.headers.get('pragma'), 'no-cache')
    assert.equal(calls.length, before)
  }

  const method = await fetch(endpoint, { headers: { Authorization: auth } })
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('cache-control'), 'no-store')
  assert.equal(method.headers.get('pragma'), 'no-cache')
} finally {
  server.close()
  await once(server, 'close')
}

console.log('virtual payment delivery route tests passed')
