import crypto from 'node:crypto'

import { isVirtualPaymentProductId, virtualPaymentProductForPrice } from './virtual-payment-config.mjs'
import {
  decodeWechatMessageEncodingAesKey,
  normalizeWechatMessageAppId
} from './virtual-payment-message-crypto.mjs'

const MESSAGE_EVENT = 'xpay_goods_deliver_notify'
const ORDER_NUMBER_PATTERN = /^VP[A-F0-9]{30}$/
const SAFE_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/u
const SAFE_PROVIDER_REFERENCE_PATTERN = /^[^\u0000-\u001f\u007f]{1,128}$/u
const ROOT_REQUIRED_FIELDS = Object.freeze([
  'ToUserName', 'FromUserName', 'CreateTime', 'MsgType', 'Event',
  'OpenId', 'OutTradeNo', 'Env', 'GoodsInfo'
])
const GOODS_REQUIRED_FIELDS = Object.freeze(['ProductId', 'Quantity', 'Attach'])
const WECHAT_PAY_FIELDS = Object.freeze(['MchOrderNo', 'TransactionId', 'PaidTime'])
const CANONICAL_FIELDS = Object.freeze([
  'source', 'environment', 'wechatEnv', 'userId', 'orderNo', 'productId',
  'internalSku', 'quantity', 'attach', 'unitPriceFen', 'orderAmountFen',
  'providerMerchantOrderNo', 'providerTransactionId', 'paidAtSeconds'
])

function messageError(message = 'Wechat virtual payment message is invalid.', code = 'PAYMENT_MESSAGE_INVALID', statusCode = 400) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactFields(value, required, optional = []) {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
}

function hasRequiredFields(value, required) {
  return isPlainObject(value) && required.every((key) => Object.hasOwn(value, key))
}

function requireSafeString(value, maximumLength = 128, allowEmpty = false) {
  if (
    typeof value !== 'string' || value.length > maximumLength ||
    (!allowEmpty && value.length === 0) || /[\u0000-\u001f\u007f]/.test(value)
  ) throw messageError()
  return value
}

function requirePositiveInteger(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw messageError()
  return value
}

export function getVirtualPaymentMessageConfig(options = {}) {
  const env = options.env || process.env
  const nodeEnv = options.nodeEnv === undefined ? env && env.NODE_ENV : options.nodeEnv
  const enabled = env && env.VIRTUAL_PAYMENT_WECHAT_MESSAGE_ENABLED
  if (enabled !== 'true') {
    throw messageError('Wechat virtual payment message endpoint is unavailable.', 'PAYMENT_MESSAGE_DISABLED', 503)
  }
  if (
    nodeEnv !== 'development' || env.VIRTUAL_PAYMENT_ENABLED !== 'true' ||
    env.VIRTUAL_PAYMENT_ENV !== 'sandbox'
  ) {
    throw messageError('Wechat virtual payment message endpoint is unavailable.', 'PAYMENT_MESSAGE_CONFIG_INVALID', 503)
  }
  const token = env.WECHAT_VIRTUAL_PAYMENT_MESSAGE_TOKEN
  const originalId = env.WECHAT_VIRTUAL_PAYMENT_MESSAGE_ORIGINAL_ID
  const format = env.WECHAT_VIRTUAL_PAYMENT_MESSAGE_FORMAT
  const mode = env.WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE
  if (
    typeof token !== 'string' || !/^[A-Za-z0-9]{3,32}$/.test(token) ||
    typeof originalId !== 'string' || !SAFE_ID_PATTERN.test(originalId) ||
    format !== 'json' || !['plaintext', 'aes'].includes(mode)
  ) {
    throw messageError('Wechat virtual payment message endpoint is unavailable.', 'PAYMENT_MESSAGE_CONFIG_INVALID', 503)
  }
  let aesKey = null
  let appId = null
  if (mode === 'aes') {
    try {
      aesKey = decodeWechatMessageEncodingAesKey(env.WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY)
      appId = normalizeWechatMessageAppId(env.WECHAT_MINIAPP_APPID)
    } catch {
      throw messageError('Wechat virtual payment message endpoint is unavailable.', 'PAYMENT_MESSAGE_CONFIG_INVALID', 503)
    }
  }
  return Object.freeze({
    enabled: true, environment: 'sandbox', wechatEnv: 1,
    token, originalId, format: 'json', mode, aesKey, appId
  })
}

export function parseWechatMessageQuery(requestUrl, options = {}) {
  const method = options.method === 'POST' ? 'POST' : 'GET'
  const required = method === 'GET'
    ? ['signature', 'timestamp', 'nonce', 'echostr']
    : ['signature', 'timestamp', 'nonce']
  const params = requestUrl.searchParams
  const keys = [...params.keys()]
  if (keys.some((key) => !required.includes(key)) || required.some((key) => params.getAll(key).length !== 1)) {
    throw messageError()
  }
  const signature = params.get('signature')
  const timestamp = params.get('timestamp')
  const nonce = params.get('nonce')
  const echostr = method === 'GET' ? params.get('echostr') : null
  if (
    typeof signature !== 'string' || !/^[a-f0-9]{40}$/.test(signature) ||
    typeof timestamp !== 'string' || !/^[0-9]{1,10}$/.test(timestamp) ||
    typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 128 || /[\u0000-\u001f\u007f]/.test(nonce) ||
    (method === 'GET' && (typeof echostr !== 'string' || echostr.length < 1 || echostr.length > 512 || /[\u0000-\u001f\u007f]/.test(echostr)))
  ) throw messageError()
  return Object.freeze({ signature, timestamp, nonce, echostr })
}

export function verifyWechatMessageSignature(query, token) {
  if (!query || typeof token !== 'string') throw messageError()
  const expected = crypto.createHash('sha1')
    .update([token, query.timestamp, query.nonce].sort().join(''), 'utf8')
    .digest()
  let provided
  try { provided = Buffer.from(query.signature, 'hex') } catch { throw messageError() }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw messageError('Wechat virtual payment message signature is invalid.', 'PAYMENT_MESSAGE_SIGNATURE_INVALID', 401)
  }
  return true
}

export function createWechatGoodsDeliveryCanonicalFact(input) {
  if (
    !hasExactFields(input, CANONICAL_FIELDS) || input.source !== 'wechat_goods_delivery_message' ||
    input.environment !== 'sandbox' || input.wechatEnv !== 1 ||
    typeof input.userId !== 'string' || !/^[1-9][0-9]*$/.test(input.userId) ||
    typeof input.orderNo !== 'string' || !ORDER_NUMBER_PATTERN.test(input.orderNo) ||
    !isVirtualPaymentProductId(input.productId) || input.internalSku !== 'membership_30d' ||
    input.quantity !== 1 || typeof input.attach !== 'string' ||
    input.attach.length === 0 || input.attach.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(input.attach) ||
    !virtualPaymentProductForPrice(input.unitPriceFen) ||
    input.orderAmountFen !== input.unitPriceFen ||
    (input.providerMerchantOrderNo !== null && (
      typeof input.providerMerchantOrderNo !== 'string' ||
      !SAFE_PROVIDER_REFERENCE_PATTERN.test(input.providerMerchantOrderNo)
    )) ||
    typeof input.providerTransactionId !== 'string' || !SAFE_PROVIDER_REFERENCE_PATTERN.test(input.providerTransactionId) ||
    !Number.isSafeInteger(input.paidAtSeconds) || input.paidAtSeconds <= 0
  ) throw messageError()
  const raw = JSON.stringify(input)
  const payloadHash = crypto.createHash('sha256').update(raw, 'utf8').digest()
  const identityHash = crypto.createHash('sha256')
    .update(JSON.stringify({ source: input.source, orderNo: input.orderNo }), 'utf8')
    .digest('hex')
  return Object.freeze({ raw, payloadHash, eventKey: `wechat_goods_delivery:${identityHash}` })
}

export function normalizeWechatGoodsDeliveryMessage(body, order, context = {}) {
  if (!hasRequiredFields(body, ROOT_REQUIRED_FIELDS)) throw messageError()
  if (
    body.ToUserName !== context.originalId ||
    !SAFE_ID_PATTERN.test(body.FromUserName || '') ||
    !Number.isSafeInteger(body.CreateTime) || body.CreateTime <= 0 ||
    body.MsgType !== 'event' || body.Event !== MESSAGE_EVENT || body.Env !== 1 ||
    !SAFE_ID_PATTERN.test(body.OpenId || '') ||
    typeof body.OutTradeNo !== 'string' || !ORDER_NUMBER_PATTERN.test(body.OutTradeNo) ||
    !order || typeof order !== 'object' || body.OutTradeNo !== order.orderNo ||
    body.OpenId !== context.openid || order.userId !== context.userId ||
    order.environment !== 'sandbox' || order.wechatEnv !== 1
  ) throw messageError()
  if (!hasRequiredFields(body.GoodsInfo, GOODS_REQUIRED_FIELDS)) throw messageError()
  const goods = body.GoodsInfo
  const attach = requireSafeString(goods.Attach, 128)
  if (
    !isVirtualPaymentProductId(goods.ProductId) || goods.ProductId !== order.productId ||
    goods.Quantity !== order.quantity || attach !== order.orderNo
  ) throw messageError()
  if (Object.hasOwn(goods, 'TeamInfo')) {
    if (!isPlainObject(goods.TeamInfo)) throw messageError()
    for (const field of ['ActivityId', 'TeamId']) {
      if (Object.hasOwn(goods.TeamInfo, field)) requireSafeString(goods.TeamInfo[field], 128)
    }
    for (const field of ['TeamType', 'TeamAction']) {
      if (Object.hasOwn(goods.TeamInfo, field) && !Number.isSafeInteger(goods.TeamInfo[field])) throw messageError()
    }
  }
  let providerMerchantOrderNo = null
  let providerTransactionId = order.providerTransactionId
  let paidAtSeconds = order.paidAt === null ? null : Date.parse(order.paidAt) / 1000
  if (Object.hasOwn(body, 'WeChatPayInfo')) {
    if (!hasRequiredFields(body.WeChatPayInfo, WECHAT_PAY_FIELDS)) throw messageError()
    providerMerchantOrderNo = requireSafeString(body.WeChatPayInfo.MchOrderNo)
    providerTransactionId = requireSafeString(body.WeChatPayInfo.TransactionId)
    paidAtSeconds = requirePositiveInteger(body.WeChatPayInfo.PaidTime)
  }
  if (
    typeof providerTransactionId !== 'string' || !SAFE_PROVIDER_REFERENCE_PATTERN.test(providerTransactionId) ||
    !Number.isSafeInteger(paidAtSeconds) || paidAtSeconds <= 0 ||
    (order.providerTransactionId !== null && order.providerTransactionId !== providerTransactionId) ||
    (order.paidAt !== null && Date.parse(order.paidAt) / 1000 !== paidAtSeconds)
  ) throw messageError()
  const nowValue = context.now instanceof Date ? context.now.getTime() : NaN
  if (!Number.isFinite(nowValue)) throw messageError('Wechat virtual payment message service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
  if (body.CreateTime > Math.floor(nowValue / 1000) + 300 || paidAtSeconds > Math.floor(nowValue / 1000) + 300) throw messageError()
  const canonical = createWechatGoodsDeliveryCanonicalFact({
    source: 'wechat_goods_delivery_message', environment: 'sandbox', wechatEnv: 1,
    userId: context.userId, orderNo: order.orderNo, productId: order.productId,
    internalSku: order.internalSku, quantity: order.quantity, attach,
    unitPriceFen: order.unitPriceFen, orderAmountFen: order.orderAmountFen,
    providerMerchantOrderNo, providerTransactionId, paidAtSeconds
  })
  return Object.freeze({
    source: 'wechat_goods_delivery_message', eventType: MESSAGE_EVENT,
    eventKey: canonical.eventKey, payloadHash: canonical.payloadHash,
    userId: context.userId, orderNo: order.orderNo, productId: order.productId,
    internalSku: order.internalSku, quantity: order.quantity, attach,
    unitPriceFen: order.unitPriceFen, orderAmountFen: order.orderAmountFen,
    providerMerchantOrderNo, providerTransactionId, paidAtSeconds,
    paidAt: new Date(paidAtSeconds * 1000)
  })
}

export const VIRTUAL_PAYMENT_MESSAGE_CONFIG_VARIABLES = Object.freeze({
  enabled: 'VIRTUAL_PAYMENT_WECHAT_MESSAGE_ENABLED',
  token: 'WECHAT_VIRTUAL_PAYMENT_MESSAGE_TOKEN',
  originalId: 'WECHAT_VIRTUAL_PAYMENT_MESSAGE_ORIGINAL_ID',
  format: 'WECHAT_VIRTUAL_PAYMENT_MESSAGE_FORMAT',
  mode: 'WECHAT_VIRTUAL_PAYMENT_MESSAGE_MODE',
  encodingAesKey: 'WECHAT_VIRTUAL_PAYMENT_MESSAGE_ENCODING_AES_KEY',
  appId: 'WECHAT_MINIAPP_APPID'
})
