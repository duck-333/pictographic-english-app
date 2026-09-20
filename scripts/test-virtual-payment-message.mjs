import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  createWechatGoodsDeliveryCanonicalFact,
  getVirtualPaymentMessageConfig,
  normalizeWechatGoodsDeliveryMessage,
  parseWechatMessageQuery,
  verifyWechatMessageSignature
} from '../server/virtual-payment-message.mjs'

const TOKEN = 'MessageToken123'
const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-09-14T08:00:00.000Z')
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000))
const NONCE = 'nonce-1'
const ORIGINAL_ID = 'gh_original_safe'
const OPENID = 'openid-safe-42'
const APP_ID = 'wx1234567890abcdef'
const ENCODING_AES_KEY = Buffer.alloc(32, 7).toString('base64').slice(0, -1)
const NON_CANONICAL_ENCODING_AES_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyB'

function signature(timestamp = TIMESTAMP, nonce = NONCE) {
  return crypto.createHash('sha1').update([TOKEN, timestamp, nonce].sort().join('')).digest('hex')
}

function env(overrides = {}) {
  return {
    NODE_ENV: 'development', VIRTUAL_PAYMENT_ENABLED: 'true', VIRTUAL_PAYMENT_ENV: 'sandbox',
    VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox-offer-safe',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'sandbox-product',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'sandbox-app-key-safe',
    VIRTUAL_PAYMENT_WECHAT_MESSAGE_ENABLED: 'true',
    WECHAT_VIRTUAL_PAYMENT_MESSAGE_TOKEN: TOKEN,
    WECHAT_VIRTUAL_PAYMENT_MESSAGE_ORIGINAL_ID: ORIGINAL_ID,
    WECHAT_VIRTUAL_PAYMENT_MESSAGE_FORMAT: 'json',
    WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'plaintext',
    ...overrides
  }
}

const config = getVirtualPaymentMessageConfig({ env: env() })
assert.equal(config.token, TOKEN)
assert.equal(config.mode, 'plaintext')
assert.equal(config.aesKey, null)
assert.equal(config.appId, null)
const aesConfig = getVirtualPaymentMessageConfig({ env: env({
  WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'aes',
  WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY: ENCODING_AES_KEY,
  WECHAT_MINIAPP_APPID: APP_ID
}) })
assert.equal(aesConfig.mode, 'aes')
assert.equal(aesConfig.aesKey.length, 32)
assert.equal(aesConfig.appId, APP_ID)
const productionMessageConfig = getVirtualPaymentMessageConfig({ env: env({
  NODE_ENV: 'production', VIRTUAL_PAYMENT_ENV: 'production',
  VIRTUAL_PAYMENT_SANDBOX_USER_IDS: undefined,
  WECHAT_VIRTUAL_PAYMENT_PRODUCTION_OFFER_ID: 'production-offer-safe',
  WECHAT_VIRTUAL_PAYMENT_PRODUCTION_PRODUCT_ID: 'production-product',
  WECHAT_VIRTUAL_PAYMENT_PRODUCTION_APP_KEY: 'production-app-key-safe',
  WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'aes',
  WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY: ENCODING_AES_KEY,
  WECHAT_MINIAPP_APPID: APP_ID
}) })
assert.equal(productionMessageConfig.environment, 'production')
assert.equal(productionMessageConfig.wechatEnv, 0)
assert.equal(productionMessageConfig.mode, 'aes')
const independentlyDecodedNonCanonicalKey = Buffer.from(`${NON_CANONICAL_ENCODING_AES_KEY}=`, 'base64')
const nonCanonicalAesConfig = getVirtualPaymentMessageConfig({ env: env({
  WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'aes',
  WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY: NON_CANONICAL_ENCODING_AES_KEY,
  WECHAT_MINIAPP_APPID: APP_ID
}) })
assert.deepEqual(nonCanonicalAesConfig.aesKey, independentlyDecodedNonCanonicalKey)
assert.notEqual(
  nonCanonicalAesConfig.aesKey.toString('base64').slice(0, -1),
  NON_CANONICAL_ENCODING_AES_KEY
)
for (const changed of [
  { VIRTUAL_PAYMENT_WECHAT_MESSAGE_ENABLED: undefined },
  { NODE_ENV: 'production' }, { NODE_ENV: 'Development' },
  { VIRTUAL_PAYMENT_ENABLED: 'false' }, { VIRTUAL_PAYMENT_ENV: 'production' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_TOKEN: '' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_TOKEN: 'bad token' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_ORIGINAL_ID: '' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_FORMAT: 'xml' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: undefined },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'auto' },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'aes', WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY: undefined, WECHAT_MINIAPP_APPID: APP_ID },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'aes', WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY: '*'.repeat(43), WECHAT_MINIAPP_APPID: APP_ID },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'aes', WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY: ENCODING_AES_KEY, WECHAT_MINIAPP_APPID: undefined },
  { WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE: 'aes', WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY: ENCODING_AES_KEY, WECHAT_MINIAPP_APPID: 'invalid' }
]) assert.throws(() => getVirtualPaymentMessageConfig({ env: env(changed) }))

const getUrl = new URL(`http://local.invalid/path?signature=${signature()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&echostr=echo-safe`)
const getQuery = parseWechatMessageQuery(getUrl, { method: 'GET' })
assert.equal(verifyWechatMessageSignature(getQuery, TOKEN), true)
assert.equal(getQuery.echostr, 'echo-safe')
for (const query of [
  '', `signature=${signature()}&timestamp=${TIMESTAMP}&nonce=${NONCE}`,
  `signature=${signature()}&signature=${signature()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&echostr=x`,
  `signature=${'A'.repeat(40)}&timestamp=${TIMESTAMP}&nonce=${NONCE}&echostr=x`,
  `signature=${signature()}&timestamp=x&nonce=${NONCE}&echostr=x`,
  `signature=${signature()}&timestamp=${TIMESTAMP}&nonce=${NONCE}&echostr=x&extra=1`
]) assert.throws(() => parseWechatMessageQuery(new URL(`http://local.invalid/path?${query}`), { method: 'GET' }))
assert.throws(() => verifyWechatMessageSignature({ ...getQuery, signature: '0'.repeat(40) }, TOKEN))

const order = Object.freeze({
  userId: '42', orderNo: ORDER_NO, internalSku: 'membership_30d', productId: 'sandbox-product',
  productName: '30天学习会员', quantity: 1, unitPriceFen: 3000, orderAmountFen: 3000,
  currency: 'CNY', environment: 'sandbox', wechatEnv: 1,
  paymentChannel: 'wechat_virtual_payment', clientPlatform: 'android',
  providerTransactionId: null, paidAt: null
})
function body(overrides = {}) {
  return {
    ToUserName: ORIGINAL_ID, FromUserName: 'wechat-official-openid', CreateTime: Number(TIMESTAMP),
    MsgType: 'event', Event: 'xpay_goods_deliver_notify', OpenId: OPENID,
    OutTradeNo: ORDER_NO, Env: 1,
    GoodsInfo: { ProductId: order.productId, Quantity: 1, Attach: ORDER_NO },
    WeChatPayInfo: { MchOrderNo: 'merchant-order-safe', TransactionId: 'transaction-safe', PaidTime: Number(TIMESTAMP) - 10 },
    ...overrides
  }
}
const fact = normalizeWechatGoodsDeliveryMessage(body(), order, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
})
assert.equal(fact.eventType, 'xpay_goods_deliver_notify')
assert.match(fact.eventKey, /^wechat_goods_delivery:[a-f0-9]{64}$/)
assert.equal(fact.payloadHash.length, 32)
const rebuilt = createWechatGoodsDeliveryCanonicalFact({
  source: fact.source, environment: 'sandbox', wechatEnv: 1, userId: fact.userId,
  orderNo: fact.orderNo, productId: fact.productId, internalSku: fact.internalSku,
  quantity: fact.quantity, attach: fact.attach,
  unitPriceFen: fact.unitPriceFen, orderAmountFen: fact.orderAmountFen,
  providerMerchantOrderNo: fact.providerMerchantOrderNo,
  providerTransactionId: fact.providerTransactionId, paidAtSeconds: fact.paidAtSeconds
})
assert.deepEqual(rebuilt.payloadHash, fact.payloadHash)
assert.equal(fact.providerMerchantOrderNo, 'merchant-order-safe')
const productionOrder = Object.freeze({ ...order, environment: 'production', wechatEnv: 0, productId: 'production-product' })
const productionBody = body({
  Env: 0,
  GoodsInfo: { ProductId: 'production-product', Quantity: 1, Attach: ORDER_NO }
})
const productionFact = normalizeWechatGoodsDeliveryMessage(productionBody, productionOrder, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
})
assert.equal(productionFact.environment, 'production')
assert.equal(productionFact.wechatEnv, 0)
assert.throws(() => normalizeWechatGoodsDeliveryMessage(body(), productionOrder, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
}))
assert.throws(() => normalizeWechatGoodsDeliveryMessage({
  ...productionBody,
  GoodsInfo: { ProductId: 'production-test-product', Quantity: 1, Attach: ORDER_NO }
}, { ...productionOrder, productId: 'production-test-product', unitPriceFen: 100, orderAmountFen: 100 }, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
}))
const extensionFact = normalizeWechatGoodsDeliveryMessage(body({
  FutureRootField: { ignored: true },
  GoodsInfo: { ...body().GoodsInfo, TeamInfo: {
    ActivityId: 'activity-safe', TeamId: 'team-safe', TeamType: 1, TeamAction: 2, FutureTeamField: true
  }, FutureGoodsField: 'ignored' },
  WeChatPayInfo: { ...body().WeChatPayInfo, FuturePayField: 'ignored' }
}), order, { originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW })
assert.deepEqual(extensionFact.payloadHash, fact.payloadHash)
for (const invalid of [
  { MsgType: 'text' }, { Event: 'other' }, { Env: 0 }, { ToUserName: 'wrong' },
  { OpenId: 'wrong' }, { OutTradeNo: 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' },
  { GoodsInfo: { ...body().GoodsInfo, ProductId: 'other' } },
  { GoodsInfo: { ...body().GoodsInfo, Quantity: 2 } },
  { GoodsInfo: { ...body().GoodsInfo, Attach: '' } },
  { GoodsInfo: { ...body().GoodsInfo, Attach: 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' } },
  { GoodsInfo: { ...body().GoodsInfo, Attach: `${ORDER_NO}\u0000` } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: 'invalid' } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { ActivityId: 1 } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { TeamId: 1 } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { ActivityId: '' } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { ActivityId: 'bad\nvalue' } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { TeamId: 'x'.repeat(129) } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { TeamType: '1' } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { TeamType: 1.5 } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { TeamAction: '2' } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { TeamAction: Number.NaN } } },
  { GoodsInfo: { ...body().GoodsInfo, TeamInfo: { TeamAction: Number.POSITIVE_INFINITY } } },
  { GoodsInfo: { ProductId: order.productId, Quantity: 1 } },
  { WeChatPayInfo: { ...body().WeChatPayInfo, PaidTime: 0 } },
  { WeChatPayInfo: { MchOrderNo: 'merchant-order-safe', TransactionId: 'transaction-safe' } }
]) assert.throws(() => normalizeWechatGoodsDeliveryMessage(body(invalid), order, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
}))

const alreadyPaid = { ...order, providerTransactionId: 'transaction-safe', paidAt: new Date((Number(TIMESTAMP) - 10) * 1000).toISOString() }
const withoutOptionalPay = body()
delete withoutOptionalPay.WeChatPayInfo
assert.equal(normalizeWechatGoodsDeliveryMessage(withoutOptionalPay, alreadyPaid, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
}).providerTransactionId, 'transaction-safe')
assert.throws(() => normalizeWechatGoodsDeliveryMessage(withoutOptionalPay, order, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
}))

const testProductOrder = {
  ...order, productId: 'sandbox-test-product', unitPriceFen: 100, orderAmountFen: 100
}
const testProductBody = body({
  GoodsInfo: { ProductId: 'sandbox-test-product', Quantity: 1, Attach: ORDER_NO }
})
const testProductFact = normalizeWechatGoodsDeliveryMessage(testProductBody, testProductOrder, {
  originalId: ORIGINAL_ID, openid: OPENID, userId: '42', now: NOW
})
assert.equal(testProductFact.unitPriceFen, 100)
assert.equal(testProductFact.orderAmountFen, 100)

console.log('virtual payment message validation tests passed')
