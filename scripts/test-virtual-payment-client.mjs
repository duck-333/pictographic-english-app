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
    async text() {
      if (options.textError) throw options.textError
      return raw
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

assert.deepEqual(await client.notifyProvideGoods({
  wechatOrderId: 'WXORDER1234567890'
}), { accepted: true })
assert.equal(requests[1].url.pathname, '/xpay/notify_provide_goods')
assert.equal(requests[1].url.searchParams.get('access_token'), ACCESS_TOKEN)
assert.equal(requests[1].url.searchParams.has('pay_sig'), false)
assert.equal(requests[1].options.body, JSON.stringify({
  wx_order_id: 'WXORDER1234567890',
  env: 1
}))

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
  { response: response('{"errcode":0}'), code: 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE' },
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

console.log('Virtual payment client tests passed.')
