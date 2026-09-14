import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { once } from 'node:events'
import { EventEmitter } from 'node:events'

import { createApiHandler } from '../server/index.mjs'
import { createVirtualPaymentMessageRoutes, readRawJsonBody } from '../server/virtual-payment-message-routes.mjs'

const TOKEN = 'RouteMessageToken1'
const ORIGINAL_ID = 'gh_route_original'
const OPENID = 'openid-route-safe'
const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-09-14T08:00:00.000Z')
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000))
const NONCE = 'route-nonce'
const PRODUCT_ID = 'sandbox-product'

function sign(timestamp = TIMESTAMP, nonce = NONCE) {
  return crypto.createHash('sha1').update([TOKEN, timestamp, nonce].sort().join('')).digest('hex')
}

function config(overrides = {}) {
  return {
    NODE_ENV: 'development', VIRTUAL_PAYMENT_ENABLED: 'true', VIRTUAL_PAYMENT_ENV: 'sandbox',
    VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'offer-safe',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: PRODUCT_ID,
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'app-key-safe',
    VIRTUAL_PAYMENT_WECHAT_MESSAGE_ENABLED: 'true',
    WECHAT_VIRTUAL_PAYMENT_MESSAGE_TOKEN: TOKEN,
    WECHAT_VIRTUAL_PAYMENT_MESSAGE_ORIGINAL_ID: ORIGINAL_ID,
    WECHAT_VIRTUAL_PAYMENT_MESSAGE_FORMAT: 'json',
    ...overrides
  }
}

const order = Object.freeze({
  id: '7', userId: '42', orderNo: ORDER_NO, internalSku: 'membership_30d', productId: PRODUCT_ID,
  productName: '30天学习会员', quantity: 1, unitPriceFen: 3000, orderAmountFen: 3000,
  currency: 'CNY', environment: 'sandbox', wechatEnv: 1,
  paymentChannel: 'wechat_virtual_payment', clientPlatform: 'android',
  providerTransactionId: null, paidAt: null
})

function validBody(overrides = {}) {
  return {
    ToUserName: ORIGINAL_ID, FromUserName: 'wechat-official-openid', CreateTime: Number(TIMESTAMP),
    MsgType: 'event', Event: 'xpay_goods_deliver_notify', OpenId: OPENID,
    OutTradeNo: ORDER_NO, Env: 1,
    GoodsInfo: { ProductId: PRODUCT_ID, Quantity: 1, Attach: ORDER_NO },
    WeChatPayInfo: { MchOrderNo: 'merchant-route-safe', TransactionId: 'transaction-route-safe', PaidTime: Number(TIMESTAMP) - 10 },
    ...overrides
  }
}

async function start(overrides = {}) {
  const state = { receivedCount: 0, grants: 0, notifyCalls: 0, applyCalls: 0 }
  let serialized = Promise.resolve()
  const virtualPaymentStore = overrides.virtualPaymentStore || {
    async findByUserAndOrderNo(userId, orderNo) {
      return userId === '42' && orderNo === ORDER_NO ? order : null
    },
    async applyGoodsDeliveryNotification(userId, orderNo, fact) {
      const run = serialized.then(async () => {
        state.applyCalls += 1
        if (fact.providerTransactionId === 'conflicting-transaction') throw new Error('SENSITIVE_TRANSACTION_SENTINEL')
        state.receivedCount += 1
        if (state.grants === 0) state.grants = 1
        return { order: { ...order, paymentStatus: 'paid', entitlementStatus: 'granted', deliveryStatus: 'delivered' } }
      })
      serialized = run.catch(() => {})
      return run
    }
  }
  const identityStore = overrides.identityStore || {
    async findWechatBindingForPayment(openid) { return openid === OPENID ? { userId: '42' } : null }
  }
  const handler = createApiHandler({
    env: overrides.env || config(), nodeEnv: overrides.nodeEnv,
    now: () => new Date(NOW), virtualPaymentStore, identityStore,
    virtualPaymentClient: { async notifyProvideGoods() { state.notifyCalls += 1 } },
    store: { async getWordCount() { return 0 } }, userStore: {}, wechatLoginClient: {}
  })
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, state, baseUrl: `http://127.0.0.1:${server.address().port}` }
}

async function close(fixture) {
  fixture.server.close()
  await once(fixture.server, 'close')
}

async function get(fixture, query) {
  const response = await fetch(`${fixture.baseUrl}/api/wechat/virtual-payment/message?${query}`)
  return { response, text: await response.text() }
}

async function post(fixture, body, options = {}) {
  const query = options.query || `signature=${sign()}&timestamp=${TIMESTAMP}&nonce=${NONCE}`
  const response = await fetch(`${fixture.baseUrl}/api/wechat/virtual-payment/message?${query}`, {
    method: 'POST', headers: { 'Content-Type': options.contentType || 'application/json' }, body
  })
  return { response, text: await response.text() }
}

const fixture = await start()
try {
  const verified = await get(fixture, `signature=${sign()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&echostr=echo-raw`)
  assert.equal(verified.response.status, 200)
  assert.equal(verified.text, 'echo-raw')
  assert.equal(verified.response.headers.get('cache-control'), 'no-store')
  const optionsResponse = await fetch(`${fixture.baseUrl}/api/wechat/virtual-payment/message`, { method: 'OPTIONS' })
  assert.equal(optionsResponse.status, 405)
  for (const query of [
    `signature=${'0'.repeat(40)}&timestamp=${TIMESTAMP}&nonce=${NONCE}&echostr=x`,
    `signature=${sign()}&timestamp=${TIMESTAMP}&nonce=${NONCE}`,
    `signature=${sign()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&nonce=again&echostr=x`,
    `signature=${sign()}&timestamp=bad&nonce=${NONCE}&echostr=x`
  ]) {
    const rejected = await get(fixture, query)
    assert.notEqual(rejected.response.status, 200)
    assert.equal(rejected.response.headers.get('cache-control'), 'no-store')
  }

  const badSignature = await post(fixture, JSON.stringify(validBody()), {
    query: `signature=${'0'.repeat(40)}&timestamp=${TIMESTAMP}&nonce=${NONCE}`
  })
  assert.equal(badSignature.response.status, 401)
  assert.equal(fixture.state.applyCalls, 0)
  const duplicateQuery = await post(fixture, JSON.stringify(validBody()), {
    query: `signature=${sign()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&nonce=again`
  })
  assert.notEqual(duplicateQuery.response.status, 200)
  assert.equal(fixture.state.applyCalls, 0)
  const aes = await post(fixture, JSON.stringify(validBody()), {
    query: `signature=${sign()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&encrypt_type=aes`
  })
  assert.equal(aes.response.status, 400)
  for (const [body, contentType] of [
    ['', 'application/json'], ['{bad', 'application/json'], ['{}', 'text/plain'],
    [JSON.stringify(validBody({ MsgType: 'text' })), 'application/json'],
    [JSON.stringify(validBody({ Event: 'other' })), 'application/json'],
    [JSON.stringify(validBody({ Env: 0 })), 'application/json'],
    [JSON.stringify(validBody({ ToUserName: 'wrong' })), 'application/json'],
    [JSON.stringify(validBody({ OpenId: 'unknown-openid' })), 'application/json'],
    [JSON.stringify(validBody({ OutTradeNo: 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' })), 'application/json'],
    [JSON.stringify(validBody({ GoodsInfo: { ...validBody().GoodsInfo, ProductId: 'other' } })), 'application/json'],
    [JSON.stringify(validBody({ GoodsInfo: { ...validBody().GoodsInfo, Quantity: 2 } })), 'application/json'],
    [JSON.stringify(validBody({ GoodsInfo: { ...validBody().GoodsInfo, Attach: 'x'.repeat(17 * 1024) } })), 'application/json']
  ]) {
    const before = fixture.state.applyCalls
    const rejected = await post(fixture, body, { contentType })
    assert.notEqual(rejected.response.status, 200)
    assert.equal(rejected.response.headers.get('cache-control'), 'no-store')
    assert.equal(fixture.state.applyCalls, before)
    for (const secret of [TOKEN, OPENID, ORDER_NO, 'transaction-route-safe']) assert(!rejected.text.includes(secret))
  }

  const first = await post(fixture, JSON.stringify(validBody({
    FutureRootField: 'ignored',
    GoodsInfo: { ...validBody().GoodsInfo, TeamInfo: {
      ActivityId: 'activity-safe', TeamId: 'team-safe', TeamType: 1, TeamAction: 2, FutureTeamField: true
    }, FutureGoodsField: true },
    WeChatPayInfo: { ...validBody().WeChatPayInfo, FuturePayField: true }
  })))
  assert.equal(first.response.status, 200)
  assert.deepEqual(JSON.parse(first.text), { ErrCode: 0, ErrMsg: 'success' })
  const repeated = await post(fixture, JSON.stringify(validBody()))
  assert.equal(repeated.response.status, 200)
  assert.equal(fixture.state.receivedCount, 2)
  assert.equal(fixture.state.grants, 1)

  const beforeConcurrent = fixture.state.receivedCount
  const concurrent = await Promise.all([
    post(fixture, JSON.stringify(validBody())), post(fixture, JSON.stringify(validBody()))
  ])
  assert(concurrent.every((item) => item.response.status === 200))
  assert.equal(fixture.state.receivedCount, beforeConcurrent + 2)
  assert.equal(fixture.state.grants, 1)

  const sensitiveLogs = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...values) => sensitiveLogs.push(values.join(' '))
  console.warn = (...values) => sensitiveLogs.push(values.join(' '))
  let conflict
  try {
    conflict = await post(fixture, JSON.stringify(validBody({
      WeChatPayInfo: { ...validBody().WeChatPayInfo, TransactionId: 'conflicting-transaction' }
    })))
  } finally {
    console.error = originalError
    console.warn = originalWarn
  }
  assert.notEqual(conflict.response.status, 200)
  assert.equal(fixture.state.grants, 1)
  assert.equal(fixture.state.notifyCalls, 0)
  for (const secret of [TOKEN, OPENID, ORDER_NO, 'conflicting-transaction', 'SENSITIVE_TRANSACTION_SENTINEL']) {
    assert(!conflict.text.includes(secret))
    assert(!sensitiveLogs.join('\n').includes(secret))
  }
  assert.equal(sensitiveLogs.length, 0)
} finally { await close(fixture) }

{
  let bodyListenerAdded = false
  const routes = createVirtualPaymentMessageRoutes({
    env: config(), identityStore: { async findWechatBindingForPayment() { throw new Error('not reached') } },
    virtualPaymentStore: {}
  })
  const req = {
    method: 'POST', headers: { 'content-type': 'application/json' },
    url: `/api/wechat/virtual-payment/message?signature=${'0'.repeat(40)}&timestamp=${TIMESTAMP}&nonce=${NONCE}`,
    on(event) { if (event === 'data') bodyListenerAdded = true; return this }
  }
  const res = { writeHead() {}, end() {} }
  assert.equal(await routes.handle(req, res, '/api/wechat/virtual-payment/message'), true)
  assert.equal(bodyListenerAdded, false)
}

for (const eventName of ['aborted', 'close']) {
  const request = new EventEmitter()
  request.headers = { 'content-type': 'application/json' }
  request.resume = () => {}
  const reading = readRawJsonBody(request)
  request.emit(eventName)
  await assert.rejects(reading)
  for (const listener of ['data', 'end', 'error', 'aborted', 'close']) assert.equal(request.listenerCount(listener), 0)
}

for (const changed of [
  { VIRTUAL_PAYMENT_WECHAT_MESSAGE_ENABLED: undefined }, { NODE_ENV: 'production' },
  { VIRTUAL_PAYMENT_ENABLED: 'false' }, { VIRTUAL_PAYMENT_ENV: 'production' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_TOKEN: '' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_ORIGINAL_ID: '' }
]) {
  const disabled = await start({ env: config(changed) })
  try {
    const response = await get(disabled, `signature=${sign()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&echostr=x`)
    assert.equal(response.response.status, 503)
    assert.equal(response.response.headers.get('cache-control'), 'no-store')
  } finally { await close(disabled) }
}

console.log('virtual payment message route tests passed')
