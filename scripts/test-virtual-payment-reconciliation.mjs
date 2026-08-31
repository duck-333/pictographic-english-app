import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  createWechatQueryCanonicalFact,
  normalizeVerifiedWechatQueryFact,
  WECHAT_QUERY_STATUS_RULES
} from '../server/virtual-payment-reconciliation.mjs'
import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = Date.parse('2026-08-31T00:00:00.000Z')

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
    paymentStatus: 'pending',
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

function queryResult(status, overrides = {}) {
  const paid = [2, 3, 4].includes(status)
  return {
    orderId: ORDER_NO,
    wechatOrderId: 'WXORDER123456789',
    wechatPaymentOrderId: paid ? 'WXPAY123456789' : null,
    status,
    orderType: 0,
    orderFeeFen: 3000,
    paidFeeFen: paid ? 3000 : null,
    paidAtSeconds: paid ? Math.floor(NOW / 1000) - 60 : null,
    providedAtSeconds: null,
    environmentType: 2,
    environment: 'sandbox',
    ...overrides
  }
}

assert.deepEqual(WECHAT_QUERY_STATUS_RULES.map((entry) => [entry.status, entry.localStatus]), [
  [0, null],
  [1, 'confirming'],
  [2, 'paid'],
  [3, 'paid'],
  [4, 'paid'],
  [5, null],
  [6, 'closed'],
  [7, null],
  [8, null],
  [9, null],
  [10, null]
])

  for (const [status, target] of [[1, 'confirming'], [2, 'paid'], [3, 'paid'], [4, 'paid'], [6, 'closed']]) {
  const fact = normalizeVerifiedWechatQueryFact(queryResult(status), order(), { now: () => NOW })
  assert.equal(fact.targetPaymentStatus, target)
  assert.equal(fact.source, 'wechat_query')
  assert.match(fact.eventKey, /^wechat_query:[a-f0-9]{64}$/)
  assert.equal(fact.payloadHash.length, 32)
  assert.equal(fact.orderType, 0)
  assert.equal(fact.paidAmountFen, target === 'paid' ? 3000 : null)
}

for (const status of [2, 3, 4]) {
  const missing = queryResult(status)
  delete missing.wechatPaymentOrderId
  for (const invalidTransactionId of [
    undefined,
    null,
    '',
    '   ',
    123,
    true,
    {},
    [],
    'bad\u0000transaction',
    'x'.repeat(129)
  ]) {
    const candidate = invalidTransactionId === undefined
      ? missing
      : queryResult(status, { wechatPaymentOrderId: invalidTransactionId })
    assert.throws(
      () => normalizeVerifiedWechatQueryFact(candidate, order(), { now: () => NOW }),
      (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
    )
  }
  const boundaryValue = '交'.repeat(128)
  assert.equal(
    normalizeVerifiedWechatQueryFact(
      queryResult(status, { wechatPaymentOrderId: boundaryValue }),
      order(),
      { now: () => NOW }
    ).providerTransactionId,
    boundaryValue
  )
}

for (const status of [1, 6]) {
  assert.equal(
    normalizeVerifiedWechatQueryFact(queryResult(status, { wechatPaymentOrderId: null }), order(), {
      now: () => NOW
    }).providerTransactionId,
    null
  )
}

for (const unsupportedStatus of [0, 5, 7, 8, 9, 10]) {
  assert.throws(
    () => normalizeVerifiedWechatQueryFact(queryResult(unsupportedStatus), order(), { now: () => NOW }),
    (error) => error.code === 'PAYMENT_QUERY_STATUS_UNSUPPORTED'
  )
}

for (const invalid of [
  queryResult('2'),
  queryResult(2, { status: undefined }),
  (() => { const value = queryResult(2); delete value.orderType; return value })(),
  queryResult(2, { orderType: '0' }),
  queryResult(2, { orderType: null }),
  queryResult(2, { orderType: 1 }),
  queryResult(2, { orderType: 2 }),
  queryResult(1, { wechatPaymentOrderId: 'unexpected-transaction' }),
  queryResult(99),
  queryResult(2, { environmentType: 1 }),
  queryResult(2, { environmentType: '2' }),
  queryResult(2, { orderId: 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }),
  queryResult(2, { wechatOrderId: 'bad provider id' }),
  queryResult(2, { orderFeeFen: 2999 }),
  queryResult(2, { paidFeeFen: 2999 }),
  queryResult(2, { paidAtSeconds: '123' }),
  queryResult(2, { paidAtSeconds: Math.floor(NOW / 1000) + 301 }),
  { ...queryResult(2), extra: true }
]) {
  assert.throws(
    () => normalizeVerifiedWechatQueryFact(invalid, order(), { now: () => NOW }),
    (error) => [
      'PAYMENT_QUERY_RESULT_INVALID',
      'PAYMENT_QUERY_STATUS_UNSUPPORTED',
      'PAYMENT_ORDER_CONFLICT'
    ].includes(error.code)
  )
}

const sameFactA = normalizeVerifiedWechatQueryFact(queryResult(2), order(), { now: () => NOW })
const sameFactB = normalizeVerifiedWechatQueryFact(queryResult(2), order(), { now: () => NOW })
assert.equal(sameFactA.eventKey, sameFactB.eventKey)
assert.deepEqual(sameFactA.payloadHash, sameFactB.payloadHash)
assert.notEqual(
  sameFactA.eventKey,
  normalizeVerifiedWechatQueryFact(queryResult(3), order(), { now: () => NOW }).eventKey
)
assert.equal(sameFactA.orderType, 0)
const canonicalInput = {
  source: 'wechat_query',
  environment: 'sandbox',
  wechatEnv: 1,
  orderNo: ORDER_NO,
  providerOrderId: 'WXORDER123456789',
  providerTransactionId: 'WXPAY123456789',
  wechatStatus: 2,
  meaning: 'paid_pending_delivery',
  targetPaymentStatus: 'paid',
  orderType: 0,
  orderAmountFen: 3000,
  paidAmountFen: 3000,
  paidAtSeconds: Math.floor(NOW / 1000) - 60
}
const canonicalWithOrderType = createWechatQueryCanonicalFact(canonicalInput)
const mutatedRaw = canonicalWithOrderType.raw.replace('"orderType":0', '"orderType":1')
assert.notEqual(
  crypto.createHash('sha256').update(mutatedRaw, 'utf8').digest('hex'),
  canonicalWithOrderType.payloadHash.toString('hex')
)
assert.notEqual(
  `wechat_query:${crypto.createHash('sha256').update(mutatedRaw, 'utf8').digest('hex')}`,
  canonicalWithOrderType.eventKey
)
for (const invalidOrderType of [undefined, null, '0', false, 0.5, 1, {}, []]) {
  const candidate = { ...canonicalInput, orderType: invalidOrderType }
  if (invalidOrderType === undefined) delete candidate.orderType
  assert.throws(
    () => createWechatQueryCanonicalFact(candidate),
    (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
  )
}

function createServiceHarness(overrides = {}) {
  let currentOrder = overrides.currentOrder || order()
  const calls = []
  const store = {
    async findByUserAndClientRequestId() { return null },
    async findByUserAndOrderNo(userId, orderNo) {
      calls.push(['find', userId, orderNo])
      return currentOrder && currentOrder.userId === userId && currentOrder.orderNo === orderNo
        ? currentOrder
        : null
    },
    async findTrustedWechatQueryPaidEvidence(userId, orderNo) {
      calls.push(['evidence', userId, orderNo])
      return overrides.hasTrustedPaidEvidence !== false
    },
    async createOrder() { throw new Error('not used') },
    async markOrderPending() { throw new Error('not used') },
    async reconcileVerifiedWechatQuery(userId, orderNo, fact, context) {
      calls.push(['reconcile', userId, orderNo, fact.targetPaymentStatus, context.expectedProductId])
      currentOrder = order({
        ...currentOrder,
        paymentStatus: fact.targetPaymentStatus,
        paidAmountFen: fact.paidAmountFen,
        paidAt: fact.paidAt && fact.paidAt.toISOString(),
        providerOrderId: fact.providerOrderId,
        providerTransactionId: fact.providerTransactionId
      })
      return { order: currentOrder, eventDuplicate: false, stateChanged: true }
    },
    ...overrides.store
  }
  const paymentSessionService = overrides.paymentSessionService || {
    async exchangeAndVerifyPaymentSession(input) {
      calls.push(['exchange', input])
      return Object.freeze({ openid: 'fake-openid', userId: input.authenticatedUserId })
    }
  }
  const virtualPaymentClient = overrides.virtualPaymentClient || {
    async queryOrder(input) {
      calls.push(['query', input])
      return overrides.queryResultOverride ||
        queryResult(overrides.wechatStatus === undefined ? 2 : overrides.wechatStatus)
    }
  }
  return {
    calls,
    service: createVirtualPaymentService({
      env: overrides.env || enabledEnv(),
      now: () => NOW,
      store,
      paymentSessionService,
      signingService: { createPaymentParameters() { throw new Error('not used') } },
      virtualPaymentClient
    })
  }
}

const confirmingHarness = createServiceHarness({
  currentOrder: order({ paymentStatus: 'confirming' }),
  wechatStatus: 2
})
assert.equal((await confirmingHarness.service.reconcileOwnedOrder({
  authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
})).paymentStatus, 'paid')

const nonWhitelistedHarness = createServiceHarness({
  env: enabledEnv({ VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '99' })
})
await assert.rejects(
  () => nonWhitelistedHarness.service.reconcileOwnedOrder({
    authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
  }),
  (error) => error.code === 'PAYMENT_TEST_USER_NOT_ALLOWED'
)
assert.equal(nonWhitelistedHarness.calls.length, 0)

for (const identityCode of [
  'WECHAT_IDENTITY_NOT_BOUND',
  'WECHAT_IDENTITY_MISMATCH',
  'WECHAT_IDENTITY_AMBIGUOUS'
]) {
  const identityHarness = createServiceHarness({
    paymentSessionService: {
      async exchangeAndVerifyPaymentSession() {
        const error = new Error('identity rejected')
        error.code = identityCode
        error.statusCode = identityCode === 'WECHAT_IDENTITY_NOT_BOUND' ? 403 : 409
        throw error
      }
    }
  })
  await assert.rejects(
    () => identityHarness.service.reconcileOwnedOrder({
      authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
    }),
    (error) => error.code === identityCode
  )
  assert.deepEqual(identityHarness.calls.map((call) => call[0]), ['find'])
}

for (const [wechatStatus, localStatus] of [[1, 'confirming'], [2, 'paid'], [6, 'closed']]) {
  const harness = createServiceHarness({ wechatStatus })
  const result = await harness.service.reconcileOwnedOrder({
    authenticatedUserId: '42',
    orderNo: ORDER_NO,
    loginCode: 'fresh-code'
  })
  assert.equal(result.paymentStatus, localStatus)
  assert.deepEqual(harness.calls.map((call) => call[0]), ['find', 'exchange', 'query', 'reconcile'])
  assert.deepEqual(harness.calls.find((call) => call[0] === 'query')[1], {
    openid: 'fake-openid',
    orderNo: ORDER_NO
  })
  assert.equal(harness.calls.find((call) => call[0] === 'reconcile')[4], 'sandbox-product')
}

const completePaidOrder = order({
  paymentStatus: 'paid',
  paidAmountFen: 3000,
  paidAt: new Date(NOW - 60_000).toISOString(),
  providerOrderId: 'WXORDERPAID123',
  providerTransactionId: 'WXPAYPAID123'
})
const paidHarness = createServiceHarness({ currentOrder: completePaidOrder })
const paidResult = await paidHarness.service.reconcileOwnedOrder({
  authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
})
assert.equal(paidResult.paymentStatus, 'paid')
assert.deepEqual(paidHarness.calls.map((call) => call[0]), ['find', 'evidence'])

const formalPaidAt = new Date(NOW - 60_000)
const formalPaidRow = {
  id: 1,
  order_no: ORDER_NO,
  user_id: 42,
  client_request_id: 'request-12345678',
  internal_sku: 'membership_30d',
  product_id: 'sandbox-product',
  product_name: '30天学习会员',
  quantity: 1,
  unit_price_fen: 3000,
  order_amount_fen: 3000,
  paid_amount_fen: 3000,
  currency: 'CNY',
  environment: 'sandbox',
  wechat_env: 1,
  payment_channel: 'wechat_virtual_payment',
  client_platform: 'android',
  provider_order_id: 'WXORDERPAID123',
  provider_transaction_id: 'WXPAYPAID123',
  payment_status: 'paid',
  entitlement_status: 'not_ready',
  delivery_status: 'not_ready',
  client_result: null,
  membership_grant_id: null,
  entitlement_transaction_id: null,
  paid_at: formalPaidAt,
  entitlement_granted_at: null,
  delivered_at: null,
  last_queried_at: formalPaidAt,
  next_retry_at: null,
  retry_count: 0,
  last_error_code: null,
  version: 1,
  created_at: new Date(NOW - 120_000),
  updated_at: formalPaidAt
}
function createFormalEvidenceRow(status) {
  const meanings = new Map([[2, 'paid_pending_delivery'], [3, 'delivering'], [4, 'delivered']])
  const canonicalFact = createWechatQueryCanonicalFact({
    source: 'wechat_query',
    environment: 'sandbox',
    wechatEnv: 1,
    orderNo: ORDER_NO,
    providerOrderId: 'WXORDERPAID123',
    providerTransactionId: 'WXPAYPAID123',
    wechatStatus: status,
    meaning: meanings.get(status),
    targetPaymentStatus: 'paid',
    orderType: 0,
    orderAmountFen: 3000,
    paidAmountFen: 3000,
    paidAtSeconds: Math.floor(formalPaidAt.getTime() / 1000)
  })
  return {
    event_key: canonicalFact.eventKey,
    event_type: `wechat_query_status_${status}_paid`,
    order_id: 1,
    order_no: ORDER_NO,
    provider_order_id: 'WXORDERPAID123',
    provider_transaction_id: 'WXPAYPAID123',
    payload_hash: canonicalFact.payloadHash,
    processing_status: 'processed',
    received_count: 1,
    processed_at: formalPaidAt,
    attempt_count: 1,
    last_error_code: null,
    linked_order_id: 1,
    linked_order_no: ORDER_NO,
    linked_provider_order_id: 'WXORDERPAID123',
    linked_provider_transaction_id: 'WXPAYPAID123',
    order_amount_fen: 3000,
    paid_amount_fen: 3000,
    paid_at: formalPaidAt,
    environment: 'sandbox',
    wechat_env: 1
  }
}
let formalEvidenceRow = createFormalEvidenceRow(2)
let formalStoreWrites = 0
const formalStore = createVirtualPaymentStore({
  pool: {
    async getConnection() {
      return {
        async execute(sql, params) {
          if (/^\s*SELECT e\.event_key/.test(sql)) {
            assert.deepEqual(params.slice(0, 2), ['42', ORDER_NO])
            return [[formalEvidenceRow]]
          }
          if (/^\s*SELECT id, order_no/.test(sql)) return [[formalPaidRow]]
          formalStoreWrites += 1
          throw new Error('unexpected database write')
        },
        async release() {}
      }
    }
  }
})
const formalService = createVirtualPaymentService({
  env: enabledEnv(),
  now: () => NOW,
  store: formalStore,
  paymentSessionService: { async exchangeAndVerifyPaymentSession() { throw new Error('must not call WeChat') } },
  signingService: { createPaymentParameters() { throw new Error('must not sign') } },
  virtualPaymentClient: { async queryOrder() { throw new Error('must not query WeChat') } }
})
for (const status of [2, 3, 4]) {
  formalEvidenceRow = createFormalEvidenceRow(status)
  const formalPaidResult = await formalService.reconcileOwnedOrder({
    authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
  })
  assert.equal(formalPaidResult.paymentStatus, 'paid')
}
assert.equal(Object.hasOwn(await formalStore.findByUserAndOrderNo('42', ORDER_NO), 'orderType'), false)
assert.equal(formalStoreWrites, 0)

const missingPaidEvidenceHarness = createServiceHarness({
  currentOrder: completePaidOrder,
  hasTrustedPaidEvidence: false
})
await assert.rejects(
  () => missingPaidEvidenceHarness.service.reconcileOwnedOrder({
    authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
  }),
  (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
)
assert.deepEqual(missingPaidEvidenceHarness.calls.map((call) => call[0]), ['find', 'evidence'])

const evidenceFailureHarness = createServiceHarness({
  currentOrder: completePaidOrder,
  store: {
    async findTrustedWechatQueryPaidEvidence() {
      throw new Error('EVENT_KEY SQL PRODUCT PROVIDER SENTINEL')
    }
  }
})
await assert.rejects(
  () => evidenceFailureHarness.service.reconcileOwnedOrder({
    authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
  }),
  (error) => {
    const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}\n${String(error.cause)}\n${String(error.details)}`
    return error.code === 'PAYMENT_SERVICE_UNAVAILABLE' &&
      !/EVENT_KEY|SQL|PRODUCT|PROVIDER|SENTINEL/.test(exposed)
  }
)
assert.deepEqual(evidenceFailureHarness.calls.map((call) => call[0]), ['find'])

for (const damagedPaidFields of [
  { paidAmountFen: null },
  { paidAmountFen: 0 },
  { paidAmountFen: '3000' },
  { orderAmountFen: 2999 },
  { paidAt: null },
  { paidAt: new Date('invalid') },
  { paidAt: '2026-08-31 00:00:00' },
  { paidAt: 1_788_134_400_000 },
  { paidAt: new Date(NOW + 301_000).toISOString() },
  { providerOrderId: null },
  { providerOrderId: '   ' },
  { providerOrderId: 'ORDER\u0000SENTINEL' },
  { providerTransactionId: null },
  { providerTransactionId: '   ' },
  { providerTransactionId: 'TRANSACTION\u0000SENTINEL' },
  { productId: 'DAMAGED_PRODUCT_SENTINEL' },
  { internalSku: 'damaged_sku' },
  { productName: 'damaged product' },
  { quantity: 2 },
  { unitPriceFen: 2999 },
  { currency: 'USD' },
  { environment: 'production' },
  { wechatEnv: 0 },
  { paymentChannel: 'damaged_channel' },
  { clientPlatform: 'ios' },
  { entitlementStatus: 'pending' },
  { membershipGrantId: '9' }
]) {
  const damagedHarness = createServiceHarness({
    currentOrder: order({ ...completePaidOrder, ...damagedPaidFields })
  })
  await assert.rejects(
    () => damagedHarness.service.reconcileOwnedOrder({
      authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
    }),
    (error) => {
      const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}\n${String(error.cause)}\n${String(error.details)}`
      return error.code === 'PAYMENT_PAID_FACT_INCOMPLETE' &&
        !/DAMAGED_PRODUCT_SENTINEL|ORDER_SENTINEL|TRANSACTION_SENTINEL/.test(exposed)
    }
  )
  assert.deepEqual(damagedHarness.calls.map((call) => call[0]), ['find'])
}

for (const blockedOrder of [
  order({ paymentStatus: 'initializing' }),
  order({ paymentStatus: 'closed' }),
  order({ paymentStatus: 'failed' }),
  order({ paymentStatus: 'paid', entitlementStatus: 'pending' }),
  order({ paymentStatus: 'paid', membershipGrantId: '9' })
]) {
  const harness = createServiceHarness({ currentOrder: blockedOrder })
  await assert.rejects(
    () => harness.service.reconcileOwnedOrder({
      authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
    }),
    (error) => ['PAYMENT_ORDER_NOT_RECONCILABLE', 'PAYMENT_PAID_FACT_INCOMPLETE'].includes(error.code)
  )
  assert.deepEqual(harness.calls.map((call) => call[0]), ['find'])
}

const missingHarness = createServiceHarness({
  currentOrder: order(),
  store: { async findByUserAndOrderNo() { return null } }
})
await assert.rejects(
  () => missingHarness.service.reconcileOwnedOrder({
    authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
  }),
  (error) => error.code === 'PAYMENT_ORDER_NOT_FOUND'
)

const queryFailureHarness = createServiceHarness({
  virtualPaymentClient: { async queryOrder() { throw new Error('NETWORK URL TOKEN SECRET') } }
})
await assert.rejects(
  () => queryFailureHarness.service.reconcileOwnedOrder({
    authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
  }),
  (error) => error.code === 'PAYMENT_QUERY_UNAVAILABLE' && !/NETWORK|TOKEN|SECRET/.test(error.message + error.stack)
)
assert.equal(queryFailureHarness.calls.filter((call) => call[0] === 'reconcile').length, 0)

for (const status of [2, 3, 4]) {
  const incompleteWechatFactHarness = createServiceHarness({
    queryResultOverride: queryResult(status, { wechatPaymentOrderId: null })
  })
  await assert.rejects(
    () => incompleteWechatFactHarness.service.reconcileOwnedOrder({
      authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code'
    }),
    (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
  )
  assert.deepEqual(
    incompleteWechatFactHarness.calls.map((call) => call[0]),
    ['find', 'exchange', 'query']
  )
}

for (const invalidInput of [
  { authenticatedUserId: '42', orderNo: 'bad', loginCode: 'fresh-code' },
  { authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: '' },
  { authenticatedUserId: '42', orderNo: ORDER_NO, loginCode: 'fresh-code', paid: true }
]) {
  const harness = createServiceHarness()
  await assert.rejects(
    () => harness.service.reconcileOwnedOrder(invalidInput),
    (error) => error.code === 'PAYMENT_REQUEST_INVALID'
  )
  assert.equal(harness.calls.length, 0)
}

console.log('virtual payment reconciliation tests passed')
