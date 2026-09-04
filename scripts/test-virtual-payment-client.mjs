import assert from 'node:assert/strict'
import { inspect } from 'node:util'

import { createVirtualPaymentClient } from '../server/virtual-payment-client.mjs'

const APP_KEY = 'sandbox-app-key-fixed-vector'
const ACCESS_TOKEN = 'access-token-client-sensitive'
const OPENID = 'openid-client-sensitive'
const ORDER_NO = 'VP20260830ABC123'
const EXPECTED_QUERY_PAY_SIG = '77161caefac33fa8dfe06ae0e88cb45d0e199b648b9675e9efcfb735a8880110'

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

function response(body, options = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const encoded = new TextEncoder().encode(raw)
  const chunks = options.chunks || [encoded]
  let index = 0
  return {
    status: options.status === undefined ? 200 : options.status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-length' && options.contentLength !== undefined) {
          return String(options.contentLength)
        }
        return null
      }
    },
    body: {
      getReader() {
        return {
          async read() {
            if (options.textError || options.readError) throw options.textError || options.readError
            if (index >= chunks.length) return { done: true, value: undefined }
            const value = chunks[index]
            index += 1
            if (options.onRead) options.onRead(index, value.byteLength)
            return { done: false, value }
          },
          async cancel() { if (options.onCancel) options.onCancel() },
          releaseLock() { if (options.onRelease) options.onRelease() }
        }
      },
      async cancel() { if (options.onCancel) options.onCancel() }
    }
  }
}

function tokenProvider(overrides = {}) {
  return {
    async getAccessToken() {
      if (overrides.error) throw overrides.error
      return overrides.token === undefined ? ACCESS_TOKEN : overrides.token
    }
  }
}

function assertSafeError(error, expectedCode) {
  assert.equal(error.code, expectedCode)
  const value = inspect(error)
  for (const secret of [APP_KEY, ACCESS_TOKEN, OPENID, ORDER_NO, 'app-secret-client-sensitive']) {
    assert(!value.includes(secret))
  }
  assert(!value.includes('api.weixin.qq.com'))
  return true
}

async function expectCode(run, expectedCode) {
  await assert.rejects(run, (error) => assertSafeError(error, expectedCode))
}

const requests = []
const client = createVirtualPaymentClient({
  env: enabledEnv(),
  accessTokenProvider: tokenProvider(),
  async fetch(url, options) {
    requests.push({ url, options })
    if (url.pathname === '/xpay/query_order') {
      return response({
        errcode: 0,
        errmsg: 'ok',
        order: {
          order_id: ORDER_NO,
          wx_order_id: 'WXORDER1234567890',
          wxpay_order_id: 'WXPAY1234567890',
          status: 2,
          order_type: 0,
          order_fee: 3000,
          paid_fee: 3000,
          paid_time: 1788048000,
          provide_time: 0,
          env_type: 2,
          token: 'must-not-propagate',
          biz_meta: 'must-not-propagate'
        }
      })
    }
    return response('')
  }
})

const queryResult = await client.queryOrder({ openid: OPENID, orderNo: ORDER_NO })
assert(Object.isFrozen(queryResult))
assert.deepEqual(queryResult, {
  orderId: ORDER_NO,
  wechatOrderId: 'WXORDER1234567890',
  wechatPaymentOrderId: 'WXPAY1234567890',
  status: 2,
  orderType: 0,
  orderFeeFen: 3000,
  paidFeeFen: 3000,
  paidAtSeconds: 1788048000,
  providedAtSeconds: 0,
  environmentType: 2,
  environment: 'sandbox'
})
assert(!JSON.stringify(queryResult).includes('must-not-propagate'))
assert.equal(requests[0].url.origin, 'https://api.weixin.qq.com')
assert.equal(requests[0].url.pathname, '/xpay/query_order')
assert.equal(requests[0].url.searchParams.get('access_token'), ACCESS_TOKEN)
assert.equal(requests[0].url.searchParams.get('pay_sig'), EXPECTED_QUERY_PAY_SIG)
assert.equal(requests[0].options.method, 'POST')
assert.equal(requests[0].options.body, JSON.stringify({
  openid: OPENID,
  env: 1,
  order_id: ORDER_NO
}))

async function queryWithRawTransactionId(value, includeField = true) {
  const order = {
    order_id: ORDER_NO,
    wx_order_id: 'WXORDER1234567890',
    status: 2,
    order_type: 0,
    order_fee: 3000,
    paid_fee: 3000,
    paid_time: 1788048000,
    env_type: 2
  }
  if (includeField) order.wxpay_order_id = value
  const rawClient = createVirtualPaymentClient({
    env: enabledEnv(),
    accessTokenProvider: tokenProvider(),
    async fetch() { return response({ errcode: 0, order }) }
  })
  return rawClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO })
}

for (const [value, includeField] of [[undefined, false], [null, true], ['', true]]) {
  assert.equal((await queryWithRawTransactionId(value, includeField)).wechatPaymentOrderId, null)
}
assert.equal((await queryWithRawTransactionId('   ')).wechatPaymentOrderId, '   ')
for (const invalidTransactionId of [123, true, {}, [], 'bad\u0000transaction', 'x'.repeat(129)]) {
  await expectCode(
    () => queryWithRawTransactionId(invalidTransactionId),
    'VIRTUAL_PAYMENT_RESPONSE_INVALID'
  )
}

assert.deepEqual(await client.notifyProvideGoods({ orderNo: ORDER_NO }), { accepted: true })
assert.equal(requests[1].url.pathname, '/xpay/notify_provide_goods')
assert.equal(requests[1].url.searchParams.get('access_token'), ACCESS_TOKEN)
assert.equal(requests[1].url.searchParams.get('order_id'), ORDER_NO)
assert.equal(requests[1].url.searchParams.get('env'), '1')
assert.equal(requests[1].url.searchParams.has('pay_sig'), false)
assert.equal(requests[1].url.searchParams.has('wx_order_id'), false)
assert.equal(Object.hasOwn(requests[1].options, 'body'), false)
assert.equal(requests[1].options.redirect, 'error')

for (const invalidEnvironment of [1, '2', null, 3, Number.NaN, {}]) {
  const environmentClient = createVirtualPaymentClient({
    env: enabledEnv(),
    accessTokenProvider: tokenProvider(),
    async fetch() {
      return response({
        errcode: 0,
        order: {
          order_id: ORDER_NO,
          status: 2,
          env_type: invalidEnvironment
        }
      })
    }
  })
  await expectCode(
    () => environmentClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO }),
    'VIRTUAL_PAYMENT_RESPONSE_INVALID'
  )
}
const missingEnvironmentClient = createVirtualPaymentClient({
  env: enabledEnv(),
  accessTokenProvider: tokenProvider(),
  async fetch() {
    return response({ errcode: 0, order: { order_id: ORDER_NO, status: 2 } })
  }
})
await expectCode(
  () => missingEnvironmentClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO }),
  'VIRTUAL_PAYMENT_RESPONSE_INVALID'
)

for (const testCase of [
  { response: response('', { status: 204 }), succeeds: true },
  { response: response(''), succeeds: true },
  { response: response(' \r\n\t'), succeeds: true },
  { response: response('{"errcode":40001,"errmsg":"invalid"}'), code: 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE' },
  { response: response('{"errcode":0}'), code: 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE' },
  { response: response('<html>proxy</html>'), code: 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE' },
  { response: response('{"unknown":true}'), code: 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE' },
  { response: response('{"errcode":'), code: 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE' },
  { response: response('<html>bad gateway</html>', { status: 502 }), code: 'VIRTUAL_PAYMENT_HTTP_ERROR' },
  { response: response('', { status: 429 }), code: 'VIRTUAL_PAYMENT_HTTP_ERROR' },
  { response: response('', { status: 500 }), code: 'VIRTUAL_PAYMENT_HTTP_ERROR' },
  { response: response('x', { contentLength: 65537 }), code: 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE' },
  { response: response('x'.repeat(65537)), code: 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE' }
]) {
  let callCount = 0
  const notifyClient = createVirtualPaymentClient({
    env: enabledEnv(),
    accessTokenProvider: tokenProvider(),
    async fetch() {
      callCount += 1
      return testCase.response
    }
  })
  if (testCase.succeeds) {
    assert.deepEqual(await notifyClient.notifyProvideGoods({ orderNo: ORDER_NO }), { accepted: true })
  } else {
    await expectCode(() => notifyClient.notifyProvideGoods({ orderNo: ORDER_NO }), testCase.code)
  }
  assert.equal(callCount, 1)
}

for (const invalidNotifyInput of [
  {}, { wechatOrderId: 'WXORDER1234567890' }, { orderNo: ORDER_NO, env: 1 },
  { orderNo: ORDER_NO, openid: OPENID }, { orderNo: '_BADORDER' }, null, []
]) {
  await expectCode(
    () => client.notifyProvideGoods(invalidNotifyInput),
    'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID'
  )
}

for (const testCase of [
  { input: {}, code: 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID' },
  { input: { openid: OPENID }, code: 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID' },
  {
    input: { openid: OPENID, orderNo: ORDER_NO, wechatOrderId: 'WXORDER1234567890' },
    code: 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID'
  },
  { input: { openid: `${OPENID}\n`, orderNo: ORDER_NO }, code: 'VIRTUAL_PAYMENT_IDENTITY_INVALID' },
  { input: { openid: OPENID, orderNo: '_BADORDER' }, code: 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID' },
  { input: { openid: OPENID, orderNo: ORDER_NO, env: 0 }, code: 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID' }
]) {
  await expectCode(() => client.queryOrder(testCase.input), testCase.code)
}

const responseCases = [
  { response: response('not-json'), code: 'VIRTUAL_PAYMENT_RESPONSE_INVALID' },
  { response: response(''), code: 'VIRTUAL_PAYMENT_RESPONSE_INVALID' },
  { response: response({ errcode: 0 }, { status: 500 }), code: 'VIRTUAL_PAYMENT_HTTP_ERROR' },
  { response: response({ errcode: 40001, errmsg: `${ACCESS_TOKEN} ${OPENID}` }), code: 'VIRTUAL_PAYMENT_WECHAT_ERROR' },
  { response: response({ errmsg: 'ok', order: {} }), code: 'VIRTUAL_PAYMENT_RESPONSE_INVALID' },
  { response: response({ errcode: '0', order: {} }), code: 'VIRTUAL_PAYMENT_RESPONSE_INVALID' },
  { response: response({ errcode: 0, order: { order_id: ORDER_NO, status: 99, env_type: 2 } }), code: 'VIRTUAL_PAYMENT_QUERY_STATUS_UNKNOWN' },
  { response: response({ errcode: 0, order: { status: 2, env_type: 2 } }), code: 'VIRTUAL_PAYMENT_RESPONSE_INVALID' },
  { response: response('x', { contentLength: 65537 }), code: 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE' },
  { response: response('x'.repeat(65537)), code: 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE' }
]
for (const testCase of responseCases) {
  let callCount = 0
  const failingClient = createVirtualPaymentClient({
    env: enabledEnv(),
    accessTokenProvider: tokenProvider(),
    async fetch() {
      callCount += 1
      return testCase.response
    }
  })
  await expectCode(() => failingClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO }), testCase.code)
  assert.equal(callCount, 1, 'client must not retry automatically')
}

const accessFailureClient = createVirtualPaymentClient({
  env: enabledEnv(),
  accessTokenProvider: tokenProvider({
    error: new Error(`raw ${ACCESS_TOKEN} ${APP_KEY} app-secret-client-sensitive`)
  }),
  async fetch() {
    throw new Error('fetch must not run')
  }
})
await expectCode(
  () => accessFailureClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO }),
  'WECHAT_ACCESS_TOKEN_UNAVAILABLE'
)

let abortObserved = false
const timeoutClient = createVirtualPaymentClient({
  env: enabledEnv(),
  accessTokenProvider: tokenProvider(),
  timeoutMs: 10,
  fetch(url, options) {
    return new Promise(() => {
      options.signal.addEventListener('abort', () => {
        abortObserved = true
      })
    })
  }
})
await expectCode(
  () => timeoutClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO }),
  'VIRTUAL_PAYMENT_CLIENT_TIMEOUT'
)
assert.equal(abortObserved, true)
abortObserved = false
await expectCode(
  () => timeoutClient.notifyProvideGoods({ orderNo: ORDER_NO }),
  'VIRTUAL_PAYMENT_CLIENT_TIMEOUT'
)
assert.equal(abortObserved, true)

const notifyNetworkClient = createVirtualPaymentClient({
  env: enabledEnv(),
  accessTokenProvider: tokenProvider(),
  async fetch() {
    throw new Error(`${ACCESS_TOKEN} ${ORDER_NO}`)
  }
})
await expectCode(
  () => notifyNetworkClient.notifyProvideGoods({ orderNo: ORDER_NO }),
  'VIRTUAL_PAYMENT_CLIENT_UNAVAILABLE'
)

let oversizedReads = 0
let oversizedCancelled = false
const oversizedChunk = new Uint8Array(32 * 1024)
const boundedNotifyClient = createVirtualPaymentClient({
  env: enabledEnv(), accessTokenProvider: tokenProvider(),
  async fetch() {
    return response('', {
      chunks: [oversizedChunk, oversizedChunk, new Uint8Array([1]), oversizedChunk],
      onRead() { oversizedReads += 1 },
      onCancel() { oversizedCancelled = true }
    })
  }
})
await expectCode(
  () => boundedNotifyClient.notifyProvideGoods({ orderNo: ORDER_NO }),
  'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE'
)
assert.equal(oversizedReads, 3, 'bounded reader must stop before consuming the remaining response')
assert.equal(oversizedCancelled, true)

const utf8Payload = JSON.stringify({
  errcode: 0, errmsg: '跨块字符',
  order: {
    order_id: ORDER_NO, wx_order_id: 'WXORDER1234567890', wxpay_order_id: 'WXPAY1234567890',
    status: 2, order_type: 0, order_fee: 3000, paid_fee: 3000,
    paid_time: 1788048000, provide_time: 0, env_type: 2
  }
})
const utf8Bytes = new TextEncoder().encode(utf8Payload)
const splitAt = utf8Bytes.findIndex((value) => value >= 0xE0) + 1
const utf8Client = createVirtualPaymentClient({
  env: enabledEnv(), accessTokenProvider: tokenProvider(),
  async fetch() {
    return response('', { chunks: [utf8Bytes.slice(0, splitAt), utf8Bytes.slice(splitAt)] })
  }
})
assert.equal((await utf8Client.queryOrder({ openid: OPENID, orderNo: ORDER_NO })).status, 2)

for (const fixture of [
  response('', { readError: new Error(`${ACCESS_TOKEN} body-secret`) }),
  response('', { chunks: [new Uint8Array([0xE4])] })
]) {
  const fixtureClient = createVirtualPaymentClient({
    env: enabledEnv(), accessTokenProvider: tokenProvider(), async fetch() { return fixture }
  })
  await expectCode(
    () => fixtureClient.notifyProvideGoods({ orderNo: ORDER_NO }),
    'VIRTUAL_PAYMENT_RESPONSE_INVALID'
  )
}

let disabledCalls = 0
const disabledClient = createVirtualPaymentClient({
  env: {},
  accessTokenProvider: tokenProvider(),
  async fetch() {
    disabledCalls += 1
    return response({ errcode: 0 })
  }
})
await expectCode(
  () => disabledClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO }),
  'VIRTUAL_PAYMENT_DISABLED'
)
assert.equal(disabledCalls, 0)

assert.throws(() => createVirtualPaymentClient({
  env: enabledEnv({ NODE_ENV: 'production' }),
  accessTokenProvider: tokenProvider(),
  fetch: async () => response({ errcode: 0 })
}), (error) => error.code === 'VIRTUAL_PAYMENT_SANDBOX_PRODUCTION_FORBIDDEN')

const captured = []
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error
}
for (const method of Object.keys(originalConsole)) console[method] = (...args) => captured.push(args)
try {
  const silentClient = createVirtualPaymentClient({
    env: enabledEnv(),
    accessTokenProvider: tokenProvider(),
    async fetch() {
      throw new Error(`${APP_KEY} ${ACCESS_TOKEN} ${OPENID} ${ORDER_NO}`)
    }
  })
  await expectCode(
    () => silentClient.queryOrder({ openid: OPENID, orderNo: ORDER_NO }),
    'VIRTUAL_PAYMENT_CLIENT_UNAVAILABLE'
  )
} finally {
  Object.assign(console, originalConsole)
}
assert.equal(captured.length, 0)

for (const nativeResponse of [new Response(null, { status: 204 }), new Response(null, { status: 200 }), new Response(' \r\n\t', { status: 200 })]) {
  const nativeClient = createVirtualPaymentClient({ env: enabledEnv(), accessTokenProvider: tokenProvider(), async fetch() { return nativeResponse } })
  await nativeClient.notifyProvideGoods({ orderNo: ORDER_NO })
}
for (const fixture of [
  { contentLength: 'invalid', code: 'VIRTUAL_PAYMENT_RESPONSE_INVALID', reads: 0, releases: 0 },
  { contentLength: 65537, code: 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE', reads: 0, releases: 0 },
  { status: 500, code: 'VIRTUAL_PAYMENT_HTTP_ERROR', reads: 0, releases: 0 },
  { chunks: [new Uint8Array(65537), new Uint8Array(1)], code: 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE', reads: 1, releases: 1 },
  { readError: new Error(ACCESS_TOKEN), code: 'VIRTUAL_PAYMENT_RESPONSE_INVALID', reads: 0, releases: 1 }
]) {
  for (const cancelFails of [false, true]) {
    let reads = 0, cancels = 0, releases = 0
    const cleanupClient = createVirtualPaymentClient({
      env: enabledEnv(), accessTokenProvider: tokenProvider(),
      async fetch() { return response('', { ...fixture, onRead() { reads++ }, onRelease() { releases++ }, onCancel() { cancels++; if (cancelFails) throw new Error(ACCESS_TOKEN) } }) }
    })
    await expectCode(() => cleanupClient.notifyProvideGoods({ orderNo: ORDER_NO }), fixture.code)
    assert.deepEqual({ reads, cancels, releases }, { reads: fixture.reads, cancels: 1, releases: fixture.releases })
  }
}
let timedReadCancel = 0, timedReadRelease = 0
let invalidUtf8Release = 0, invalidUtf8Cancel = 0
const invalidUtf8Client = createVirtualPaymentClient({ env: enabledEnv(), accessTokenProvider: tokenProvider(),
  async fetch() { return response('', { chunks: [new Uint8Array([0xff])], onRelease() { invalidUtf8Release++ }, onCancel() { invalidUtf8Cancel++ } }) } })
await expectCode(() => invalidUtf8Client.notifyProvideGoods({ orderNo: ORDER_NO }), 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
assert.equal(invalidUtf8Release, 1)
assert.equal(invalidUtf8Cancel, 0, 'fully consumed body has no remaining resource to cancel')
const stalledStream = new ReadableStream({ cancel() { timedReadCancel++ } })
const originalReader = stalledStream.getReader.bind(stalledStream)
stalledStream.getReader = () => {
  const reader = originalReader()
  const release = reader.releaseLock.bind(reader)
  reader.releaseLock = () => { timedReadRelease++; release() }
  return reader
}
const stalledClient = createVirtualPaymentClient({ env: enabledEnv(), accessTokenProvider: tokenProvider(), timeoutMs: 10,
  async fetch() { return { status: 200, body: stalledStream } } })
await expectCode(() => stalledClient.notifyProvideGoods({ orderNo: ORDER_NO }), 'VIRTUAL_PAYMENT_CLIENT_TIMEOUT')
await new Promise((resolve) => setImmediate(resolve))
assert.equal(timedReadCancel, 1)
assert.equal(timedReadRelease, 1)
assert.equal(stalledStream.locked, false)
console.log('Virtual payment client tests passed, including native 204 and exact cleanup counts.')
