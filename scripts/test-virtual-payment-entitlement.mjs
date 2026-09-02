import assert from 'node:assert/strict'
import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-08-31T00:00:00.000Z')
const END = new Date(NOW.getTime() + 2_592_000_000).toISOString()

function env(overrides = {}) {
  return {
    NODE_ENV: 'development',
    VIRTUAL_PAYMENT_ENABLED: 'true',
    VIRTUAL_PAYMENT_ENV: 'sandbox',
    VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox-offer',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'sandbox-product',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'sandbox-key',
    ...overrides
  }
}

function paidOrder(overrides = {}) {
  return {
    id: '1', orderNo: ORDER_NO, userId: '42', clientRequestId: 'request-12345678',
    internalSku: 'membership_30d', productId: 'sandbox-product', productName: '30天学习会员',
    quantity: 1, unitPriceFen: 3000, orderAmountFen: 3000, paidAmountFen: 3000,
    currency: 'CNY', environment: 'sandbox', wechatEnv: 1,
    paymentChannel: 'wechat_virtual_payment', clientPlatform: 'android',
    providerOrderId: 'WXORDER123', providerTransactionId: 'WXTX123', paymentStatus: 'paid',
    entitlementStatus: 'not_ready', deliveryStatus: 'not_ready', membershipGrantId: null,
    entitlementTransactionId: null, paidAt: NOW.toISOString(), entitlementGrantedAt: null,
    deliveredAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...overrides
  }
}

function harness(overrides = {}) {
  let current = overrides.order || paidOrder()
  const calls = []
  const store = {
    async findByUserAndClientRequestId() { return null },
    async createOrder() { throw new Error('not used') },
    async markOrderPending() { throw new Error('not used') },
    async findByUserAndOrderNo(userId, orderNo) {
      calls.push(['find', userId, orderNo])
      return current && current.userId === userId && current.orderNo === orderNo ? current : null
    },
    async findTrustedWechatQueryPaidEvidence(userId, orderNo) {
      calls.push(['evidence', userId, orderNo])
      if (overrides.evidenceError) throw overrides.evidenceError
      return overrides.evidence === undefined ? true : overrides.evidence
    },
    async grantTrustedPaidOrderEntitlement(userId, orderNo, context) {
      calls.push(['grant', userId, orderNo, context])
      if (overrides.grantError) throw overrides.grantError
      current = paidOrder({
        entitlementStatus: 'granted', membershipGrantId: '9',
        entitlementTransactionId: 'ent-payment', entitlementGrantedAt: NOW.toISOString()
      })
      return {
        order: current,
        membership: { effectiveStartAt: NOW.toISOString(), effectiveEndAt: END },
        idempotent: overrides.idempotent === true
      }
    }
  }
  const service = createVirtualPaymentService({
    env: overrides.env || env(), now: () => new Date(NOW), store,
    paymentSessionService: { async exchangeAndVerifyPaymentSession() { throw new Error('must not call WeChat') } },
    signingService: { createPaymentParameters() { throw new Error('must not sign') } }
  })
  return { service, calls }
}

{
  const { service, calls } = harness()
  const result = await service.grantOwnedOrderEntitlement({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.deepEqual(result, {
    orderNo: ORDER_NO, paymentStatus: 'paid', entitlementStatus: 'granted',
    membershipStartedAt: NOW.toISOString(), membershipExpiresAt: END, idempotent: false
  })
  assert.equal(calls.filter(([name]) => name === 'grant').length, 1)
  assert.deepEqual(Object.keys(calls.find(([name]) => name === 'grant')[3]).sort(), ['expectedProductId', 'now'])
}

for (const mutation of [
  { paymentStatus: 'pending' }, { paymentStatus: 'confirming' }, { paymentStatus: 'closed' },
  { paidAmountFen: null }, { paidAmountFen: 2999 }, { paidAt: null },
  { providerOrderId: null }, { providerTransactionId: null }, { productId: 'wrong-product' },
  { deliveryStatus: 'delivered', deliveredAt: NOW.toISOString() }
]) {
  const { service, calls } = harness({ order: paidOrder(mutation) })
  await assert.rejects(
    service.grantOwnedOrderEntitlement({ authenticatedUserId: '42', orderNo: ORDER_NO })
  )
  assert.equal(calls.some(([name]) => name === 'grant'), false)
}

{
  const { service, calls } = harness({ evidence: false })
  await assert.rejects(
    service.grantOwnedOrderEntitlement({ authenticatedUserId: '42', orderNo: ORDER_NO }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )
  assert.equal(calls.some(([name]) => name === 'grant'), false)
}

{
  const completed = paidOrder({
    entitlementStatus: 'granted', membershipGrantId: '9', entitlementTransactionId: 'ent-payment',
    entitlementGrantedAt: NOW.toISOString()
  })
  const { service } = harness({ order: completed, idempotent: true })
  const result = await service.grantOwnedOrderEntitlement({ authenticatedUserId: '42', orderNo: ORDER_NO })
  assert.equal(result.idempotent, true)
}

for (const invalid of [
  {}, { authenticatedUserId: '42' }, { authenticatedUserId: '42', orderNo: 'bad' },
  { authenticatedUserId: '42', orderNo: ORDER_NO, duration: 2_592_000 }
]) {
  const { service, calls } = harness()
  await assert.rejects(service.grantOwnedOrderEntitlement(invalid))
  assert.equal(calls.length, 0)
}

{
  const { service, calls } = harness({ env: env({ VIRTUAL_PAYMENT_ENABLED: 'false' }) })
  await assert.rejects(service.grantOwnedOrderEntitlement({ authenticatedUserId: '42', orderNo: ORDER_NO }))
  assert.equal(calls.length, 0)
}

console.log('virtual payment entitlement service tests passed')
