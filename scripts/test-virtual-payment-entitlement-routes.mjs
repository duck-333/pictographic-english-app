import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createUserSessionToken } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'

const JWT_SECRET = 'entitlement-route-jwt-secret'
const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const calls = []
const result = Object.freeze({
  orderNo: ORDER_NO, paymentStatus: 'paid', entitlementStatus: 'granted',
  membershipStartedAt: '2026-08-31T00:00:00.000Z',
  membershipExpiresAt: '2026-09-30T00:00:00.000Z', idempotent: false
})
const service = {
  async createOrResumeOrder() { throw new Error('not used') },
  async getOwnedOrder() { throw new Error('not used') },
  async reconcileOwnedOrder() { throw new Error('not used') },
  async grantOwnedOrderEntitlement(input) { calls.push(input); return result }
}
const handler = createApiHandler({
  virtualPaymentService: service, jwtSecret: JWT_SECRET,
  store: { async getWordCount() { return 0 } }, userStore: {}, identityStore: {}, wechatLoginClient: {}
})
const server = http.createServer(handler)
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const endpoint = `http://127.0.0.1:${server.address().port}/api/user/virtual-payment/orders/${ORDER_NO}/entitlement`
const auth = `Bearer ${createUserSessionToken('42', { jwtSecret: JWT_SECRET }).token}`
async function request(body, authorization = auth) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body
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

  for (const body of [
    '{"duration":2592000}', '{"membershipGrantId":"1"}', '{"operationId":"x"}',
    '{"startsAt":"2026-01-01"}', '{"endsAt":"2026-02-01"}', '{"userId":"42"}',
    '{"loginCode":"code"}', 'null', '[]', ''
  ]) {
    const before = calls.length
    const rejected = await request(body)
    assert.equal(rejected.response.status, 400)
    assert.equal(calls.length, before)
  }
} finally {
  server.close()
  await once(server, 'close')
}
console.log('virtual payment entitlement route tests passed')
