import assert from 'node:assert/strict'

import { createSensitivePaymentSession } from '../server/virtual-payment-session.mjs'
import {
  createVirtualPaymentSigningService,
  VIRTUAL_PAYMENT_RESPONSE_CACHE_CONTROL
} from '../server/virtual-payment-signing.mjs'

const APP_KEY = 'sandbox-app-key-fixed-vector'
const SESSION_KEY = 'session-key-fixed-vector-1234'
const ORDER_NO = 'VP20260830ABC123'
const ATTACH = 'opaque_ref_1234567890'
const EXPECTED_SIGN_DATA = '{"offerId":"sandbox.offer-001","buyQuantity":1,"env":1,"currencyType":"CNY","productId":"membership.product-30d","goodsPrice":3000,"outTradeNo":"VP20260830ABC123","attach":"opaque_ref_1234567890"}'
const EXPECTED_PAY_SIG = '55ff12feda16d6de30d9d253213dd4ce703cb65ad30a19b1436314867c999e94'
const EXPECTED_SIGNATURE = 'c7fe48631e2609d0a71b3868e19993f45a786bc369dec48f8a4de56dfe4866b4'
const EXPECTED_QUERY_PAY_SIG = 'f8679f651d5c6d656d3fb9796af90ba39ceee6e571635091a60d90f7bb424187'

function enabledEnv(overrides = {}) {
  return {
    VIRTUAL_PAYMENT_ENABLED: 'true',
    VIRTUAL_PAYMENT_ENV: 'sandbox',
    VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox.offer-001',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'membership.product-30d',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: APP_KEY,
    ...overrides
  }
}

function createSession() {
  return createSensitivePaymentSession({
    userId: '42',
    openid: 'openid-private-value'
  }, SESSION_KEY)
}

function expectCode(run, code) {
  assert.throws(run, (error) => {
    assert.equal(error.code, code)
    const serialized = JSON.stringify({ message: error.message, code: error.code })
    assert(!serialized.includes(APP_KEY))
    assert(!serialized.includes(SESSION_KEY))
    assert(!serialized.includes('openid-private-value'))
    return true
  })
}

const service = createVirtualPaymentSigningService({ env: enabledEnv() })
const result = service.createPaymentParameters({
  orderNo: ORDER_NO,
  attach: ATTACH,
  paymentSession: createSession()
})

assert.equal(VIRTUAL_PAYMENT_RESPONSE_CACHE_CONTROL, 'no-store')
assert(Object.isFrozen(result))
assert.equal(result.mode, 'short_series_goods')
assert.equal(typeof result.signData, 'string')
assert.equal(result.signData, EXPECTED_SIGN_DATA)
assert.equal(result.paySig, EXPECTED_PAY_SIG)
assert.equal(result.signature, EXPECTED_SIGNATURE)
assert.deepEqual(Object.keys(JSON.parse(result.signData)), [
  'offerId',
  'buyQuantity',
  'env',
  'currencyType',
  'productId',
  'goodsPrice',
  'outTradeNo',
  'attach'
])
assert.deepEqual(JSON.parse(result.signData), {
  offerId: 'sandbox.offer-001',
  buyQuantity: 1,
  env: 1,
  currencyType: 'CNY',
  productId: 'membership.product-30d',
  goodsPrice: 3000,
  outTradeNo: ORDER_NO,
  attach: ATTACH
})
assert(!JSON.stringify(result).includes(APP_KEY))
assert(!JSON.stringify(result).includes(SESSION_KEY))
assert(!result.signData.includes('openid-private-value'))

const repeated = service.createPaymentParameters({
  orderNo: ORDER_NO,
  attach: ATTACH,
  paymentSession: createSession()
})
assert.deepEqual(repeated, result)

const mutableInput = {
  orderNo: ORDER_NO,
  attach: ATTACH,
  paymentSession: createSession()
}
const immutableOutput = service.createPaymentParameters(mutableInput)
mutableInput.orderNo = 'VP20260830CHANGED'
mutableInput.attach = 'opaque_ref_9999999999'
assert.equal(immutableOutput.signData, EXPECTED_SIGN_DATA)
assert.equal(immutableOutput.paySig, EXPECTED_PAY_SIG)

const changedOrder = service.createPaymentParameters({
  orderNo: 'VP20260830ABC124',
  attach: ATTACH,
  paymentSession: createSession()
})
assert.notEqual(changedOrder.paySig, result.paySig)
assert.notEqual(changedOrder.signature, result.signature)

for (const input of [
  null,
  [],
  { orderNo: ORDER_NO, attach: ATTACH, paymentSession: createSession(), priceFen: 1 },
  { orderNo: '_BADORDER', attach: ATTACH, paymentSession: createSession() },
  { orderNo: 'short', attach: ATTACH, paymentSession: createSession() },
  { orderNo: `${ORDER_NO}\n`, attach: ATTACH, paymentSession: createSession() },
  { orderNo: ORDER_NO, attach: 'person@example.com', paymentSession: createSession() },
  { orderNo: ORDER_NO, attach: `${ATTACH}\n`, paymentSession: createSession() },
  { orderNo: ORDER_NO, attach: ATTACH, paymentSession: {} }
]) {
  assert.throws(() => service.createPaymentParameters(input))
}

const disabledService = createVirtualPaymentSigningService({ env: {} })
expectCode(() => disabledService.createPaymentParameters({
  orderNo: ORDER_NO,
  attach: ATTACH,
  paymentSession: createSession()
}), 'VIRTUAL_PAYMENT_DISABLED')

assert.throws(() => createVirtualPaymentSigningService({
  env: enabledEnv({ NODE_ENV: 'production' })
}), (error) => error.code === 'VIRTUAL_PAYMENT_SANDBOX_PRODUCTION_FORBIDDEN')

assert.equal(Object.hasOwn(result, 'appKey'), false)
assert.equal(Object.hasOwn(result, 'sessionKey'), false)
assert.equal(Object.hasOwn(result, 'accessToken'), false)

const querySignData = '{"openid":"openid-fixed-vector","env":1,"order_id":"VP20260830ABC123"}'
assert.equal(service.signQueryOrderPayload(querySignData), EXPECTED_QUERY_PAY_SIG)
for (const invalidQuerySignData of [
  '{}',
  '{"openid":"openid-fixed-vector","env":0,"order_id":"VP20260830ABC123"}',
  '{"openid":"openid-fixed-vector","env":1,"order_id":"VP20260830ABC123","price":1}',
  '{"env":1,"openid":"openid-fixed-vector","order_id":"VP20260830ABC123"}',
  '{"openid":"openid-fixed-vector","env":1,"order_id":"VP20260830ABC123" }'
]) {
  expectCode(() => service.signQueryOrderPayload(invalidQuerySignData), 'VIRTUAL_PAYMENT_QUERY_PAYLOAD_INVALID')
}

console.log('Virtual payment signing tests passed.')
