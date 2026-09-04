import assert from 'node:assert/strict'

import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-09-02T00:00:00.000Z')
const env = {
  VIRTUAL_PAYMENT_ENABLED: 'true',
  VIRTUAL_PAYMENT_ENV: 'sandbox',
  VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox.offer-001',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'sandbox-product',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'sandbox-key'
}
const order = Object.freeze({
  id: '7', orderNo: ORDER_NO, userId: '42', providerOrderId: 'WXORDER1',
  providerTransactionId: 'WXPAY1', paymentStatus: 'paid', entitlementStatus: 'granted',
  deliveryStatus: 'confirming', internalSku: 'membership_30d', productName: '30天学习会员',
  quantity: 1, unitPriceFen: 3000, orderAmountFen: 3000, currency: 'CNY',
  environment: 'sandbox', wechatEnv: 1, paymentChannel: 'wechat_virtual_payment',
  paidAt: new Date(NOW.getTime() - 3600_000).toISOString(), version: 9
})
const query4 = Object.freeze({
  orderId: ORDER_NO, wechatOrderId: 'WXORDER1', wechatPaymentOrderId: 'WXPAY1',
  status: 4, orderType: 0, orderFeeFen: 3000, paidFeeFen: 3000,
  paidAtSeconds: Math.floor(NOW.getTime() / 1000) - 3600,
  providedAtSeconds: Math.floor(NOW.getTime() / 1000) - 600,
  environmentType: 2, environment: 'sandbox'
})

function baseStore(overrides = {}) {
  return {
    async findByUserAndClientRequestId() { return null },
    async findByUserAndOrderNo() { return order },
    async createOrder() { throw new Error('not used') },
    async markOrderPending() { throw new Error('not used') },
    ...overrides
  }
}

function serviceWith({ store, client, identityStore } = {}) {
  return createVirtualPaymentService({
    env,
    now: () => new Date(NOW),
    store,
    virtualPaymentClient: client,
    identityStore: identityStore || { async findWechatOpenidByUserIdForPayment() { return 'openid-42' } },
    paymentSessionService: { async exchangeAndVerifyPaymentSession() { throw new Error('not used') } },
    signingService: { createPaymentParameters() { throw new Error('not used') } }
  })
}

function queryWork(operationId) {
  return {
    action: 'query', order, attempt: { operationId },
    query: { operationId, querySequence: 1, claimedOrderVersion: order.version }
  }
}

{
  const calls = []
  const store = baseStore({
    async claimDeliveryWork() { calls.push('claim'); return { action: 'notify', attempt: { operationId: 'a'.repeat(64) } } },
    async markDeliveryDispatching() { calls.push('dispatch') },
    async finishDeliveryNotify(userId, orderNo, operationId, result) {
      calls.push(`finish:${result.kind}`); return { deliveryStatus: 'delivered' }
    },
    async applyDeliveryQueryFact() { throw new Error('not used') }
  })
  const service = serviceWith({
    store,
    client: {
      async notifyProvideGoods(input) { calls.push(`http:${input.orderNo}`); return { accepted: true } },
      async queryOrder() { throw new Error('not used') }
    }
  })
  const result = await service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.deepEqual(calls, ['claim', 'dispatch', `http:${ORDER_NO}`, 'finish:success'])
  assert.equal(result.deliveryStatus, 'delivered')
}

{
  let notifyCalls = 0
  const store = baseStore({
    async claimDeliveryWork() { return { action: 'delivered', order: { ...order, deliveryStatus: 'delivered' } } },
    async markDeliveryDispatching() { throw new Error('must not run') },
    async finishDeliveryNotify() { throw new Error('must not run') },
    async applyDeliveryQueryFact() { throw new Error('must not run') }
  })
  const service = serviceWith({ store, client: {
    async notifyProvideGoods() { notifyCalls += 1 }, async queryOrder() { throw new Error('must not run') }
  } })
  const result = await service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.equal(result.idempotent, true)
  assert.equal(notifyCalls, 0)
}

{
  const store = baseStore({
    async claimDeliveryWork() { return queryWork('9'.repeat(64)) },
    async markDeliveryDispatching() { throw new Error('must not run') },
    async finishDeliveryNotify() { throw new Error('must not run') },
    async applyDeliveryQueryFact() { throw new Error('must not apply mismatched paid time') }
  })
  const service = serviceWith({ store, client: {
    async notifyProvideGoods() { throw new Error('must not notify') },
    async queryOrder() { return { ...query4, paidAtSeconds: query4.paidAtSeconds + 1 } }
  } })
  await assert.rejects(
    service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO }),
    (error) => error.code === 'PAYMENT_DELIVERY_QUERY_INVALID'
  )
}

for (const [status, expectedDeliveryStatus] of [[3, 'confirming'], [6, 'manual_review']]) {
  let notifyCalls = 0
  let observedStatus = null
  const store = baseStore({
    async claimDeliveryWork() { return queryWork('e'.repeat(64)) },
    async markDeliveryDispatching() { throw new Error('must not run') },
    async finishDeliveryNotify() { throw new Error('must not run') },
    async applyDeliveryQueryFact(userId, orderNo, fact) {
      observedStatus = fact.wechatStatus
      return {
        action: expectedDeliveryStatus === 'manual_review' ? 'manual_review' : 'wait',
        deliveryStatus: expectedDeliveryStatus,
        idempotent: false
      }
    }
  })
  const service = serviceWith({ store, client: {
    async notifyProvideGoods() { notifyCalls += 1 },
    async queryOrder() {
      return { ...query4, status, providedAtSeconds: 0 }
    }
  } })
  const result = await service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.equal(observedStatus, status)
  assert.equal(result.deliveryStatus, expectedDeliveryStatus)
  assert.equal(notifyCalls, 0)
}

for (const [clientCode, expectedStatus] of [
  ['VIRTUAL_PAYMENT_CLIENT_TIMEOUT', 'confirming'],
  ['VIRTUAL_PAYMENT_CLIENT_UNAVAILABLE', 'confirming'],
  ['VIRTUAL_PAYMENT_HTTP_ERROR', 'confirming'],
  ['VIRTUAL_PAYMENT_WECHAT_ERROR', 'confirming'],
  ['VIRTUAL_PAYMENT_RESPONSE_INVALID', 'confirming'],
  ['VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE', 'confirming'],
  ['VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE', 'confirming']
]) {
  const results = []
  let claimCalls = 0
  let notifyCalls = 0
  const store = baseStore({
    async claimDeliveryWork() {
      claimCalls += 1
      return claimCalls === 1
        ? { action: 'notify', attempt: { operationId: 'b'.repeat(64) } }
        : queryWork('f'.repeat(64))
    },
    async markDeliveryDispatching() {},
    async finishDeliveryNotify(userId, orderNo, operationId, result) {
      results.push(result.kind)
      return { deliveryStatus: result.kind === 'uncertain' ? 'confirming' : 'retryable_failed' }
    },
    async applyDeliveryQueryFact(userId, orderNo, fact) {
      assert.equal(fact.wechatStatus, 2)
      return { action: 'wait', deliveryStatus: 'confirming', idempotent: false }
    }
  })
  const service = serviceWith({ store, client: {
    async notifyProvideGoods() {
      notifyCalls += 1
      const error = new Error('sensitive'); error.code = clientCode; throw error
    },
    async queryOrder() { return { ...query4, status: 2, providedAtSeconds: 0 } }
  } })
  const result = await service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.equal(result.deliveryStatus, expectedStatus)
  assert.deepEqual(results, ['uncertain'])
  const afterQuery = await service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.equal(afterQuery.deliveryStatus, 'confirming')
  assert.equal(notifyCalls, 1)
}

{
  let notifyCalls = 0
  let queryCalls = 0
  const store = baseStore({
    async claimDeliveryWork() { return queryWork('c'.repeat(64)) },
    async markDeliveryDispatching() { throw new Error('must not run') },
    async finishDeliveryNotify() { throw new Error('must not run') },
    async applyDeliveryQueryFact(userId, orderNo, fact) {
      assert.equal(fact.wechatStatus, 4)
      assert.equal(fact.providedAt.toISOString(), new Date(query4.providedAtSeconds * 1000).toISOString())
      return { action: 'delivered', deliveryStatus: 'delivered', idempotent: false }
    }
  })
  const service = serviceWith({ store, client: {
    async notifyProvideGoods() { notifyCalls += 1 },
    async queryOrder(input) { queryCalls += 1; assert.deepEqual(input, { openid: 'openid-42', orderNo: ORDER_NO }); return query4 }
  } })
  const result = await service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.equal(result.deliveryStatus, 'delivered')
  assert.equal(queryCalls, 1)
  assert.equal(notifyCalls, 0)
}

{
  let notifyCalls = 0
  const store = baseStore({
    async claimDeliveryWork() { return { action: 'notify', attempt: { operationId: 'd'.repeat(64) } } },
    async markDeliveryDispatching() {},
    async finishDeliveryNotify() { throw new Error('database update failed') },
    async applyDeliveryQueryFact() { throw new Error('not used') }
  })
  const service = serviceWith({ store, client: {
    async notifyProvideGoods() { notifyCalls += 1; return { accepted: true } },
    async queryOrder() { throw new Error('not used') }
  } })
  await assert.rejects(service.deliverOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO }))
  assert.equal(notifyCalls, 1)
}

for (const invalid of [
  {}, { authenticatedUserId: '42' }, { authenticatedUserId: '42', orderNo: ORDER_NO, operationId: 'x' },
  { authenticatedUserId: '42', orderNo: 'bad' }
]) {
  const service = serviceWith({ store: baseStore(), client: { notifyProvideGoods() {}, queryOrder() {} } })
  await assert.rejects(service.deliverOwnedOrder(invalid), (error) => error.code === 'PAYMENT_REQUEST_INVALID')
}

console.log('virtual payment delivery service tests passed')
