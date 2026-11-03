import { MONTHLY_MEMBERSHIP_PRODUCT, YEARLY_MEMBERSHIP_PRODUCT, LEGACY_MEMBERSHIP_PRODUCT, SANDBOX_MEMBERSHIP_PRODUCT } from '../miniapp-uni/word-app1/common/membership-products.js'
import assert from 'node:assert/strict'
import { createVirtualPaymentApi, getVirtualPaymentClientProduct, paymentMessage, validatePaymentParams } from '../miniapp-uni/word-app1/common/virtual-payment-api-client.js'

const env = { NODE_ENV: 'development', VUE_APP_WORD_API_BASE_URL: 'https://sandbox.example.test' }
const session = { token: 'jwt-fixture', expiresAt: '2099-01-01', user: { id: '42', hasWechatBinding: true } }
const orderNo = 'VP' + 'A'.repeat(30)
let code = 0, nativeCalls = [], requests = [], activeSession = session
const native = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }), getDeviceInfo: () => ({ platform: 'android' }),
  requestVirtualPayment(args) { nativeCalls.push(args); args.success({ sensitive: 'never-log' }) } }
const options = { env, wx: native, getSession: () => activeSession, loginCode: async () => `fresh-${++code}`,
  request(args) { requests.push(args); args.success({ statusCode: 200, data: { ok: true, orderNo } }); return { abort() {} } },
  entitlements: async (args) => { assert.equal(args.apiBaseUrl, env.VUE_APP_WORD_API_BASE_URL); assert.equal(args.session.token, session.token); return { membershipActive: true } } }
const api = createVirtualPaymentApi(options)
const owner = api.context(true)
await api.create(owner, 'purchase-fixture-1')
await api.get(owner, orderNo)
await api.reconcile(owner, orderNo)
await api.entitlement(owner, orderNo)
await api.delivery(owner, orderNo)
assert.deepEqual(requests.map((r) => [r.method, r.url.replace(env.VUE_APP_WORD_API_BASE_URL, ''), r.data]), [
  ['POST', '/api/user/virtual-payment/orders', { clientRequestId: 'purchase-fixture-1', loginCode: 'fresh-1', sku: 'membership_30d_v2', platform: 'android' }],
  ['GET', `/api/user/virtual-payment/orders/${orderNo}`, undefined],
  ['POST', `/api/user/virtual-payment/orders/${orderNo}/reconcile`, { loginCode: 'fresh-2' }],
  ['POST', `/api/user/virtual-payment/orders/${orderNo}/entitlement`, {}],
  ['POST', `/api/user/virtual-payment/orders/${orderNo}/delivery`, {}]
])
assert(requests.every((r) => r.header.Authorization === 'Bearer jwt-fixture' && r.header['Content-Type'] === 'application/json'))
await api.refresh(owner)
const params = { mode: 'short_series_goods', signData: JSON.stringify({ env: 1, buyQuantity: 1, currencyType: 'CNY', goodsPrice: 1200, outTradeNo: orderNo }, null, 2), paySig: 'a'.repeat(64), signature: 'b'.repeat(64) }
assert.equal(validatePaymentParams(params, orderNo), params, 'validation preserves the original parameter object and strings')
const sandboxTestEnv = { ...env, VUE_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com', VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'true' }
assert.deepEqual(getVirtualPaymentClientProduct({ env: sandboxTestEnv }), { ...SANDBOX_MEMBERSHIP_PRODUCT, priceText: '¥1.00', sandboxTest: true })
assert.deepEqual(getVirtualPaymentClientProduct({
  env: { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: 'https://baxiaota.com' },
  apiBaseUrl: 'https://sandbox-api.baxiaota.com'
}), { ...MONTHLY_MEMBERSHIP_PRODUCT, priceText: '¥12.00', sandboxTest: false })
assert.deepEqual(getVirtualPaymentClientProduct({ env: {
  ...sandboxTestEnv,
  VUE_APP_WORD_API_BASE_URL: 'https://sandbox.example.test',
  UNI_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com'
} }), { ...MONTHLY_MEMBERSHIP_PRODUCT, priceText: '¥12.00', sandboxTest: false })
for (const fallbackEnv of [
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: '', UNI_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com' },
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: '', UNI_APP_WORD_API_BASE_URL: '', WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com' }
]) assert.deepEqual(getVirtualPaymentClientProduct({ env: fallbackEnv }), { ...SANDBOX_MEMBERSHIP_PRODUCT, priceText: '¥1.00', sandboxTest: true })
for (const disabledEnv of [
  { ...sandboxTestEnv, NODE_ENV: 'production' },
  { ...sandboxTestEnv, NODE_ENV: ' development' },
  { ...sandboxTestEnv, NODE_ENV: 'Development' },
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: 'https://sandbox.example.test' },
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: ' https://sandbox-api.baxiaota.com' },
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com ' },
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com/' },
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com///' },
  { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: ['https://sandbox-api.baxiaota.com'] },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: true },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'TRUE' },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'True' },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: '1' },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: ' true ' },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 1 },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: {} },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: '' },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'false' },
  { ...sandboxTestEnv, VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: undefined }
]) assert.deepEqual(getVirtualPaymentClientProduct({ env: disabledEnv }), { ...MONTHLY_MEMBERSHIP_PRODUCT, priceText: '¥12.00', sandboxTest: false })
for (const rawBaseUrl of [
  ' https://sandbox-api.baxiaota.com',
  'https://sandbox-api.baxiaota.com ',
  'https://sandbox-api.baxiaota.com/',
  'https://sandbox-api.baxiaota.com///'
]) {
  const normalizedApi = createVirtualPaymentApi({
    ...options,
    env: { ...sandboxTestEnv, VUE_APP_WORD_API_BASE_URL: rawBaseUrl }
  })
  assert.deepEqual(normalizedApi.product(), { ...MONTHLY_MEMBERSHIP_PRODUCT, priceText: '¥12.00', sandboxTest: false })
  assert.equal(normalizedApi.environment().baseUrl, 'https://sandbox-api.baxiaota.com')
}
const testParams = { ...params, signData: JSON.stringify({ env: 1, buyQuantity: 1, currencyType: 'CNY', goodsPrice: 100, outTradeNo: orderNo }) }
assert.equal(validatePaymentParams(testParams, orderNo, 100), testParams)
assert.throws(() => validatePaymentParams(testParams, orderNo), { code: 'PAYMENT_RESPONSE_INVALID' })
assert.throws(() => validatePaymentParams(params, orderNo, 100), { code: 'PAYMENT_RESPONSE_INVALID' })
const productionParams = { ...params, signData: JSON.stringify({
  env: 0, buyQuantity: 1, currencyType: 'CNY', goodsPrice: 1200, outTradeNo: orderNo
}) }
assert.equal(validatePaymentParams(productionParams, orderNo, 1200, 0), productionParams)
assert.throws(() => validatePaymentParams(params, orderNo, 1200, 0), { code: 'PAYMENT_RESPONSE_INVALID' })
assert.throws(() => validatePaymentParams({
  ...productionParams,
  signData: JSON.stringify({ env: 0, buyQuantity: 1, currencyType: 'CNY', goodsPrice: 100, outTradeNo: orderNo })
}, orderNo, 100, 0), { code: 'PAYMENT_RESPONSE_INVALID' })
{
  let invoked
  const productionApi = createVirtualPaymentApi({
    ...options,
    env: {
      NODE_ENV: 'production',
      VUE_APP_WORD_API_BASE_URL: 'https://baxiaota.com',
      VUE_APP_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'true'
    },
    wx: {
      ...native,
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
      requestVirtualPayment(args) { invoked = args; args.success({}) }
    }
  })
  assert.deepEqual(productionApi.product(), { ...MONTHLY_MEMBERSHIP_PRODUCT, priceText: '¥12.00', sandboxTest: false })
  const productionOwner = productionApi.context(true)
  assert.equal(productionOwner.environment, 'production')
  assert.equal(productionOwner.wechatEnv, 0)
  assert.equal(productionOwner.baseUrl, 'https://baxiaota.com')
  assert.equal(await productionApi.invoke(productionOwner, productionParams, orderNo), 'unknown')
  assert.equal(JSON.parse(invoked.signData).env, 0)
  assert.throws(() => productionApi.invoke(productionOwner, params, orderNo), { code: 'PAYMENT_RESPONSE_INVALID' })
  assert.throws(() => createVirtualPaymentApi({
    ...options,
    env: { NODE_ENV: 'production', VUE_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com' },
    wx: { ...native, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }) }
  }).context(true))
  assert.throws(() => createVirtualPaymentApi({
    ...options,
    env: { NODE_ENV: 'production', VUE_APP_WORD_API_BASE_URL: 'https://baxiaota.com' },
    wx: { ...native, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) }
  }).context(true))
}
{
  let invoked
  const sandboxTestApi = createVirtualPaymentApi({ ...options, env: sandboxTestEnv, wx: {
    ...native,
    requestVirtualPayment(args) { invoked = args; args.success({}) }
  } })
  const sandboxTestOwner = sandboxTestApi.context(true)
  assert.equal((await sandboxTestApi.invoke(sandboxTestOwner, testParams, orderNo)), 'unknown')
  assert.equal(invoked.signData, testParams.signData)
  assert.equal(JSON.parse(invoked.signData).goodsPrice, 100)
  assert.throws(() => sandboxTestApi.invoke(sandboxTestOwner, params, orderNo), { code: 'PAYMENT_RESPONSE_INVALID' })
}
for (const field of ['mode', 'signData', 'paySig', 'signature']) {
  for (const invalid of [undefined, null, 1, {}, [], '']) {
    const bad = { ...params, [field]: invalid }, count = nativeCalls.length
    assert.throws(() => validatePaymentParams(bad, orderNo), { code: 'PAYMENT_RESPONSE_INVALID' })
    assert.throws(() => api.invoke(owner, bad, orderNo), { code: 'PAYMENT_RESPONSE_INVALID' })
    assert.equal(nativeCalls.length, count)
  }
}
function lifecycle() {
  let cancelled = false
  const listeners = new Set()
  return { listeners, check() { if (cancelled) throw new Error('stale') },
    onCancel(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    cancel() { cancelled = true; for (const fn of listeners) fn() } }
}
{
  const run = lifecycle()
  let callbacks, aborts = 0
  const cancellable = createVirtualPaymentApi({ ...options, request(args) { callbacks = args; return { abort() { aborts++ } } } })
  const pending = cancellable.get(owner, orderNo, run)
  run.cancel()
  await assert.rejects(pending)
  assert.equal(aborts, 1)
  assert.equal(run.listeners.size, 0)
  callbacks.success({ statusCode: 200, data: { ok: true } })
  callbacks.fail({ raw: 'private' })
  if (callbacks.complete) callbacks.complete({})
  assert.equal(aborts, 1)
}
{
  const run = lifecycle()
  let callbacks
  const cancellable = createVirtualPaymentApi({ ...options, wx: { ...native, requestVirtualPayment(args) { callbacks = args } } })
  const pending = cancellable.invoke(owner, params, orderNo, run)
  run.cancel()
  assert.equal(await pending, 'unknown')
  assert.equal(run.listeners.size, 0)
  callbacks.success({})
  callbacks.fail({ errCode: -2 })
  if (callbacks.complete) callbacks.complete({})
  assert.equal(await pending, 'unknown')
}
{
  const run = lifecycle()
  let finish, calls = 0
  const cancellable = createVirtualPaymentApi({ ...options,
    loginCode: () => new Promise((resolve) => { finish = resolve }), request() { calls++ } })
  const pending = cancellable.reconcile(owner, orderNo, run)
  run.cancel(); finish('late-code')
  await assert.rejects(pending)
  assert.equal(calls, 0)
}
assert.equal(paymentMessage({ code: 'PAYMENT_RECORDS_INVALID' }), '本地购买记录异常，请查询订单或联系客服')
assert.equal(await api.invoke(owner, params, orderNo), 'unknown')
assert.equal(nativeCalls[0].signData, params.signData)
for (const platform of ['ios', 'mac', 'macos', 'devtools', 'unknown', 'linux', 'Android']) {
  const unsupported = createVirtualPaymentApi({ ...options, wx: { ...native, getDeviceInfo: () => ({ platform }) } })
  const before = requests.length
  await assert.rejects(unsupported.create(owner, 'purchase-unsupported'), /购买操作/)
  assert.equal(requests.length, before)
}
for (const platform of ['android', 'harmony', 'windows']) assert.equal(createVirtualPaymentApi({ ...options, wx: { ...native, getDeviceInfo: () => ({ platform }) } }).context(true).platform, platform)
assert.doesNotThrow(() => createVirtualPaymentApi({ ...options, env: { ...env, VUE_APP_WORD_API_BASE_URL: 'https://sandbox-api.baxiaota.com' } }).context(true))
assert.throws(() => createVirtualPaymentApi({ ...options, env: { ...env, VUE_APP_WORD_API_BASE_URL: 'https://other.baxiaota.com' } }).context(true))
for (const override of [
  { wx: {} }, { wx: { ...native, requestVirtualPayment: undefined } },
  { wx: { ...native, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }) } },
  { env: { NODE_ENV: 'production', VUE_APP_WORD_API_BASE_URL: env.VUE_APP_WORD_API_BASE_URL } },
  { env: { NODE_ENV: 'development' } },
  { env: { NODE_ENV: 'development', VUE_APP_WORD_API_BASE_URL: 'https://baxiaota.com' } },
  { env: { NODE_ENV: 'development', VUE_APP_WORD_API_BASE_URL: 'https://baxiaota.com:443' } }
]) assert.throws(() => createVirtualPaymentApi({ ...options, ...override }).context(true))
activeSession = { ...session, user: { ...session.user, id: '43' } }
await assert.rejects(api.get(owner, orderNo), (e) => e.code === 'PAYMENT_CONTEXT_CHANGED')
activeSession = session
let cancelled = 0
const timeoutApi = createVirtualPaymentApi({ ...options, timeout: 5, request() { return { abort() { cancelled++ } } } })
await assert.rejects(timeoutApi.get(owner, orderNo), (e) => e.code === 'PAYMENT_NETWORK_UNKNOWN')
assert.equal(cancelled, 1)
const errorApi = createVirtualPaymentApi({ ...options, request(args) { args.success({ statusCode: 503, data: { ok: false, code: 'SQL raw-secret', message: 'provider-private' } }) } })
await assert.rejects(errorApi.get(owner, orderNo), (e) => !e.message.includes('private') && !paymentMessage(e).includes('SQL'))
for (const value of [2, 3]) {
  const invalid = createVirtualPaymentApi({ ...options, request(args) { args.success({ statusCode: 200, data: { status: value } }) } })
  await assert.rejects(invalid.get(owner, orderNo))
}
console.log('Batch8 API contracts, fresh codes, isolation, native parameters and safe errors passed.')

{
  const row = { orderNo, clientRequestId: 'recovery-client-1', paymentStatus: 'pending', entitlementStatus: 'not_ready', deliveryStatus: 'not_ready', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z' }
  const valid = { ok: true, orders: [row], nextCursor: null }
  let response = valid, sent
  const recovery = createVirtualPaymentApi({ ...options, request(args) { sent = args; args.success({ statusCode: 200, data: response }) } })
  assert.deepEqual(await recovery.discover(owner), valid)
  assert.equal(sent.method, 'GET'); assert.equal(sent.data, undefined)
  assert.equal(sent.url, env.VUE_APP_WORD_API_BASE_URL + '/api/user/virtual-payment/orders/recovery')
  assert.equal(sent.header.Authorization, 'Bearer jwt-fixture')
  response = { ok: true, orders: [], nextCursor: null }
  await recovery.discover(owner, orderNo)
  assert(sent.url.endsWith(`?cursor=${orderNo}`))
  const bad = [null, [], { ...valid, orders: null }, { ...valid, orders: Array(21).fill(row) }, { ...valid, orders: [row, row] }, { ...valid, token: 'secret' }, { ...valid, nextCursor: '' }, { ...valid, nextCursor: orderNo }]
  for (const field of Object.keys(row)) bad.push({ ...valid, orders: [{ ...row, [field]: null }] })
  for (const mutation of [{ signData: 'secret' }, { paymentStatus: 'unknown' }, { entitlementStatus: 'granted' }, { deliveryStatus: 'delivered' }, { createdAt: '2026-09-05T00:00:00.000Z' }, { createdAt: '2026-09-04' }]) bad.push({ ...valid, orders: [{ ...row, ...mutation }] })
  for (const value of bad) { response = value; await assert.rejects(recovery.discover(owner), { code: 'PAYMENT_RESPONSE_INVALID' }) }
  console.log('Recovery Client: GET/JWT, bounded exact schema, duplicates, states, ISO times and cursor passed.')
}

await api.create(owner, 'purchase-yearly-fixture', undefined, undefined, YEARLY_MEMBERSHIP_PRODUCT.internalSku)
assert.equal(requests.at(-1).data.sku, YEARLY_MEMBERSHIP_PRODUCT.internalSku)
for (const product of [MONTHLY_MEMBERSHIP_PRODUCT, YEARLY_MEMBERSHIP_PRODUCT, LEGACY_MEMBERSHIP_PRODUCT]) {
  const signed = { ...params, signData: JSON.stringify({ env: 1, buyQuantity: 1, currencyType: 'CNY', goodsPrice: product.priceFen, outTradeNo: orderNo }) }
  assert.equal(validatePaymentParams(signed, orderNo, product.priceFen, 1), signed)
  assert.equal(await api.invoke(owner, signed, orderNo, undefined, product), 'unknown')
  assert.throws(() => validatePaymentParams(signed, orderNo, product.priceFen + 1, 1), { code: 'PAYMENT_RESPONSE_INVALID' })
}
assert.deepEqual(api.products().map(p => [p.internalSku, p.priceFen, p.durationSeconds]), [
  ['membership_30d_v2', 1200, 30 * 86400], ['membership_365d', 9800, 365 * 86400]
])
assert(paymentMessage({ code: 'PAYMENT_PRODUCT_NOT_CONFIGURED' }).includes('尚未配置'))
console.log('Monthly/yearly client selection and legacy price validation passed.')

assert.equal(getVirtualPaymentClientProduct({ env: sandboxTestEnv, sku: SANDBOX_MEMBERSHIP_PRODUCT.internalSku }).priceFen, 100)
assert.equal(getVirtualPaymentClientProduct({ env: sandboxTestEnv, sku: YEARLY_MEMBERSHIP_PRODUCT.internalSku }).priceFen, 9800)
