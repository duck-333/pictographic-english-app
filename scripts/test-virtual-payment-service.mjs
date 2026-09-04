import assert from 'node:assert/strict'

import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function enabledEnv(overrides = {}) {
  return {
    NODE_ENV: 'development',
    VIRTUAL_PAYMENT_ENABLED: 'true',
    VIRTUAL_PAYMENT_ENV: 'sandbox',
    VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox-offer',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'sandbox-product',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'fake-app-key',
    ...overrides
  }
}

function order(overrides = {}) {
  return {
    id: '1',
    orderNo: ORDER_NO,
    userId: '42',
    clientRequestId: 'request-12345678',
    internalSku: 'membership_30d',
    productId: 'sandbox-product',
    productName: '30天学习会员',
    quantity: 1,
    unitPriceFen: 3000,
    orderAmountFen: 3000,
    paidAmountFen: null,
    currency: 'CNY',
    environment: 'sandbox',
    wechatEnv: 1,
    paymentChannel: 'wechat_virtual_payment',
    clientPlatform: 'android',
    providerOrderId: null,
    providerTransactionId: null,
    paymentStatus: 'initializing',
    entitlementStatus: 'not_ready',
    deliveryStatus: 'not_ready',
    membershipGrantId: null,
    entitlementTransactionId: null,
    paidAt: null,
    entitlementGrantedAt: null,
    deliveredAt: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides
  }
}

function request(overrides = {}) {
  return {
    authenticatedUserId: '42',
    clientRequestId: 'request-12345678',
    loginCode: 'fresh-login-code',
    sku: 'membership_30d',
    platform: 'android',
    ...overrides
  }
}

function createHarness(overrides = {}) {
  let currentOrder = overrides.currentOrder === undefined ? null : overrides.currentOrder
  const calls = []
  const store = overrides.store || {
    async findByUserAndClientRequestId(userId, clientRequestId) {
      calls.push(['findRequest', userId, clientRequestId])
      return currentOrder
    },
    async findByUserAndOrderNo(userId, orderNo) {
      calls.push(['findOrder', userId, orderNo])
      return currentOrder && currentOrder.userId === userId && currentOrder.orderNo === orderNo
        ? currentOrder
        : null
    },
    async createOrder(input) {
      calls.push(['create', input])
      currentOrder = order({ clientPlatform: input.clientPlatform })
      return { order: currentOrder, idempotent: false }
    },
    async markOrderPending(userId, orderNo) {
      calls.push(['pending', userId, orderNo])
      currentOrder = order({
        ...(currentOrder || {}),
        paymentStatus: 'pending',
        updatedAt: '2026-08-30T00:00:01.000Z'
      })
      return currentOrder
    }
  }
  const paymentSessionService = overrides.paymentSessionService || {
    async exchangeAndVerifyPaymentSession(input) {
      calls.push(['exchange', input])
      return Object.freeze({ userId: input.authenticatedUserId })
    }
  }
  const signingService = overrides.signingService || {
    createPaymentParameters(input) {
      calls.push(['sign', input.orderNo, input.attach])
      return Object.freeze({
        mode: 'short_series_goods',
        signData: '{"safe":"signed"}',
        paySig: 'fake-pay-signature',
        signature: 'fake-user-signature'
      })
    }
  }
  return {
    calls,
    getCurrentOrder: () => currentOrder,
    service: createVirtualPaymentService({
      env: overrides.env || enabledEnv(),
      store,
      paymentSessionService,
      signingService
    })
  }
}

const harness = createHarness()
const result = await harness.service.createOrResumeOrder(request())
assert.equal(result.orderNo, ORDER_NO)
assert.equal(result.paymentStatus, 'pending')
assert.equal(result.entitlementStatus, 'not_ready')
assert.equal(result.deliveryStatus, 'not_ready')
assert.equal(result.paymentParams.mode, 'short_series_goods')
assert.deepEqual(harness.calls.map((call) => call[0]), ['findRequest', 'exchange', 'create', 'sign', 'pending'])
const createCall = harness.calls.find((call) => call[0] === 'create')[1]
assert.deepEqual(createCall, {
  userId: '42',
  clientRequestId: 'request-12345678',
  internalSku: 'membership_30d',
  productId: 'sandbox-product',
  productName: '30天学习会员',
  quantity: 1,
  unitPriceFen: 3000,
  orderAmountFen: 3000,
  currency: 'CNY',
  environment: 'sandbox',
  wechatEnv: 1,
  paymentChannel: 'wechat_virtual_payment',
  clientPlatform: 'android'
})
assert.equal(JSON.stringify(createCall).includes('loginCode'), false)

for (const allowedPlatform of ['harmony', 'windows']) {
  const platformHarness = createHarness()
  await platformHarness.service.createOrResumeOrder(request({ platform: allowedPlatform }))
  assert.equal(
    platformHarness.calls.find((call) => call[0] === 'create')[1].clientPlatform,
    allowedPlatform
  )
}

await harness.service.createOrResumeOrder(request({ loginCode: 'second-fresh-code' }))
assert.equal(harness.calls.filter((call) => call[0] === 'create').length, 1)
assert.equal(harness.calls.filter((call) => call[0] === 'exchange').length, 2)

const owned = await harness.service.getOwnedOrder({ authenticatedUserId: '42', orderNo: ORDER_NO })
assert.equal(owned.orderNo, ORDER_NO)
assert.equal(Object.hasOwn(owned, 'userId'), false)
assert.equal(Object.hasOwn(owned, 'productId'), false)

let disabledCalls = 0
const disabledHarness = createHarness({
  env: {},
  store: {
    async findByUserAndClientRequestId() { disabledCalls += 1 },
    async findByUserAndOrderNo() { disabledCalls += 1 },
    async createOrder() { disabledCalls += 1 },
    async markOrderPending() { disabledCalls += 1 }
  }
})
await assert.rejects(
  () => disabledHarness.service.createOrResumeOrder(request()),
  (error) => error.code === 'PAYMENT_DISABLED'
)
assert.equal(disabledCalls, 0)

const deniedHarness = createHarness({ env: enabledEnv({ VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '43' }) })
await assert.rejects(
  () => deniedHarness.service.createOrResumeOrder(request()),
  (error) => error.code === 'PAYMENT_TEST_USER_NOT_ALLOWED'
)
assert.equal(deniedHarness.calls.length, 0)

assert.throws(
  () => createHarness({ env: enabledEnv({ NODE_ENV: 'production' }) }),
  (error) => error.code === 'PAYMENT_SANDBOX_FORBIDDEN_IN_PRODUCTION'
)

for (const override of [
  { sku: 'other' },
  { price: 1 },
  { env: 0 },
  { userId: '43' },
  { clientRequestId: 'bad' }
]) {
  const invalidHarness = createHarness()
  await assert.rejects(
    () => invalidHarness.service.createOrResumeOrder(request(override)),
    (error) => error.code === 'PAYMENT_REQUEST_INVALID'
  )
  assert.equal(invalidHarness.calls.length, 0)
}

const unsupportedPlatformRequests = [
  (() => { const value = request(); delete value.platform; return value })(),
  request({ platform: undefined }),
  request({ platform: 'unknown' }),
  request({ platform: 'ios' }),
  request({ platform: '' }),
  request({ platform: ' android' }),
  request({ platform: 'android ' }),
  request({ platform: 'ANDROID' }),
  request({ platform: 'linux' }),
  request({ platform: 1 }),
  request({ platform: true }),
  request({ platform: null }),
  request({ platform: [] }),
  request({ platform: {} })
]
for (const unsupportedRequest of unsupportedPlatformRequests) {
  const platformHarness = createHarness()
  await assert.rejects(
    () => platformHarness.service.createOrResumeOrder(unsupportedRequest),
    (error) => (
      error.code === 'PAYMENT_PLATFORM_UNSUPPORTED' &&
      error.message === 'Payment platform is unsupported.' &&
      Object.hasOwn(error, 'cause') === false &&
      Object.hasOwn(error, 'details') === false
    )
  )
  assert.deepEqual(platformHarness.calls, [], 'unsupported platform must not call Store, session, or signing')
}

let mismatchCreates = 0
const mismatchHarness = createHarness({
  paymentSessionService: {
    async exchangeAndVerifyPaymentSession() {
      const error = new Error('raw openid must not escape')
      error.code = 'WECHAT_IDENTITY_MISMATCH'
      error.statusCode = 403
      throw error
    }
  },
  store: {
    async findByUserAndClientRequestId() { return null },
    async findByUserAndOrderNo() { return null },
    async createOrder() { mismatchCreates += 1 },
    async markOrderPending() { throw new Error('must not run') }
  }
})
await assert.rejects(
  () => mismatchHarness.service.createOrResumeOrder(request()),
  (error) => error.code === 'WECHAT_IDENTITY_MISMATCH' && !error.message.includes('openid')
)
assert.equal(mismatchCreates, 0)

for (const paymentStatus of ['confirming', 'paid', 'closed', 'failed']) {
  const stateHarness = createHarness({ currentOrder: order({ paymentStatus }) })
  await assert.rejects(
    () => stateHarness.service.createOrResumeOrder(request()),
    (error) => error.code === 'PAYMENT_ORDER_NOT_PAYABLE'
  )
  assert.deepEqual(stateHarness.calls.map((call) => call[0]), ['findRequest'])
}

const signatureHarness = createHarness({
  signingService: { createPaymentParameters() { throw new Error('secret signing failure') } }
})
await assert.rejects(
  () => signatureHarness.service.createOrResumeOrder(request()),
  (error) => error.code === 'PAYMENT_SIGNATURE_FAILED' && !error.message.includes('secret')
)
assert.equal(signatureHarness.getCurrentOrder().paymentStatus, 'initializing')
assert.equal(signatureHarness.calls.some((call) => call[0] === 'pending'), false)

const updateHarness = createHarness({
  store: {
    async findByUserAndClientRequestId() { return order() },
    async findByUserAndOrderNo() { return order() },
    async createOrder() { throw new Error('must not create') },
    async markOrderPending() {
      const error = new Error('database details')
      error.code = 'PAYMENT_SERVICE_UNAVAILABLE'
      throw error
    }
  }
})
await assert.rejects(
  () => updateHarness.service.createOrResumeOrder(request()),
  (error) => error.code === 'PAYMENT_SERVICE_UNAVAILABLE' && !error.message.includes('database')
)

console.log('Virtual payment service tests passed.')

{
  let reads = 0
  const forbidden = () => { throw new Error('unexpected mutation or WeChat call') }
  const recoveryStore = { findByUserAndClientRequestId: forbidden, findByUserAndOrderNo: forbidden, createOrder: forbidden, markOrderPending: forbidden,
    async listRecoveryOrders(userId, cursor) { reads++; assert.equal(userId, '42'); assert.equal(cursor, null); return { orders: [order({ secret: 'not-returned' })], nextCursor: null } } }
  const recovery = createHarness({ store: recoveryStore, paymentSessionService: { exchangeAndVerifyPaymentSession: forbidden }, signingService: { createPaymentParameters: forbidden } }).service
  const page = await recovery.listRecoveryOrders({ authenticatedUserId: '42' })
  assert.deepEqual(Object.keys(page.orders[0]), ['orderNo', 'clientRequestId', 'paymentStatus', 'entitlementStatus', 'deliveryStatus', 'createdAt', 'updatedAt'])
  for (const input of [{ authenticatedUserId: '43' }, { authenticatedUserId: '42', userId: '43' }, { authenticatedUserId: '42', cursor: '' }]) await assert.rejects(recovery.listRecoveryOrders(input))
  assert.equal(reads, 1)
  recoveryStore.listRecoveryOrders = () => { throw new Error('SQL password token') }
  await assert.rejects(recovery.listRecoveryOrders({ authenticatedUserId: '42' }), (error) => error.code === 'PAYMENT_SERVICE_UNAVAILABLE' && !/SQL|password|token/.test(error.message))
  console.log('Recovery Service: authenticated ownership, no mutation/WeChat, whitelist and safe errors passed.')
}
