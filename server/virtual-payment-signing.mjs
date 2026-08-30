import crypto from 'node:crypto'

import {
  getVirtualPaymentConfig,
  VIRTUAL_PAYMENT_PRODUCT
} from './virtual-payment-config.mjs'
import { createPaymentSessionSignature } from './virtual-payment-session.mjs'

const PAYMENT_REQUEST_URI = 'requestVirtualPayment'
const QUERY_ORDER_URI = '/xpay/query_order'
const ORDER_NUMBER_PATTERN = /^(?!_)[A-Za-z0-9_\-|*@]{8,32}$/
const OPAQUE_ATTACH_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const SAFE_CONFIG_VALUE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_OPENID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/u
const WECHAT_ORDER_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const ASCII_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ALLOWED_PAYMENT_INPUT_FIELDS = new Set(['orderNo', 'attach', 'paymentSession'])

function createSigningError(message, code = 'VIRTUAL_PAYMENT_SIGNING_FAILED', statusCode = 500) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function assertExactInput(input) {
  if (!isPlainObject(input)) {
    throw createSigningError('Virtual payment signing input is invalid.', 'VIRTUAL_PAYMENT_SIGNING_INPUT_INVALID', 400)
  }
  let keys
  try {
    keys = Object.keys(input)
  } catch {
    throw createSigningError('Virtual payment signing input is invalid.', 'VIRTUAL_PAYMENT_SIGNING_INPUT_INVALID', 400)
  }
  for (const key of keys) {
    if (!ALLOWED_PAYMENT_INPUT_FIELDS.has(key)) {
      throw createSigningError('Virtual payment signing input is invalid.', 'VIRTUAL_PAYMENT_SIGNING_INPUT_INVALID', 400)
    }
  }
}

function assertSafeConfigValue(value) {
  return typeof value === 'string' && SAFE_CONFIG_VALUE_PATTERN.test(value)
}

function assertAuthoritativeConfig(config) {
  if (!config || !config.enabled) {
    throw createSigningError('Virtual payment is disabled.', 'VIRTUAL_PAYMENT_DISABLED', 503)
  }
  if (
    config.environment !== 'sandbox' ||
    config.wechatEnv !== 1 ||
    !assertSafeConfigValue(config.offerId) ||
    !assertSafeConfigValue(config.productId) ||
    typeof config.appKey !== 'string' ||
    !config.appKey ||
    config.appKey.length > 512 ||
    ASCII_CONTROL_CHARACTER_PATTERN.test(config.appKey)
  ) {
    throw createSigningError('Virtual payment signing configuration is invalid.', 'VIRTUAL_PAYMENT_SIGNING_CONFIG_INVALID', 503)
  }
  const product = config.product
  if (
    product !== VIRTUAL_PAYMENT_PRODUCT ||
    product.internalSku !== 'membership_30d' ||
    product.mode !== 'short_series_goods' ||
    product.priceFen !== 3000 ||
    product.quantity !== 1 ||
    product.durationSeconds !== 2592000 ||
    product.currency !== 'CNY'
  ) {
    throw createSigningError('Virtual payment product configuration is invalid.', 'VIRTUAL_PAYMENT_PRODUCT_INVALID', 503)
  }
}

function normalizeOrderNumber(value) {
  if (typeof value !== 'string' || !ORDER_NUMBER_PATTERN.test(value)) {
    throw createSigningError('Virtual payment order number is invalid.', 'VIRTUAL_PAYMENT_ORDER_NUMBER_INVALID', 400)
  }
  return value
}

function normalizeAttach(value) {
  if (typeof value !== 'string' || !OPAQUE_ATTACH_PATTERN.test(value)) {
    throw createSigningError('Virtual payment attach value is invalid.', 'VIRTUAL_PAYMENT_ATTACH_INVALID', 400)
  }
  return value
}

function hmacSha256Hex(key, value) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex')
}

function buildSignData(config, orderNo, attach) {
  const signDataObject = Object.freeze({
    offerId: config.offerId,
    buyQuantity: VIRTUAL_PAYMENT_PRODUCT.quantity,
    env: config.wechatEnv,
    currencyType: VIRTUAL_PAYMENT_PRODUCT.currency,
    productId: config.productId,
    goodsPrice: VIRTUAL_PAYMENT_PRODUCT.priceFen,
    outTradeNo: orderNo,
    attach
  })
  return Object.freeze({
    signDataObject,
    signData: JSON.stringify(signDataObject)
  })
}

function assertQueryOrderSignData(signData) {
  if (
    typeof signData !== 'string' ||
    !signData ||
    signData.length > 4096 ||
    ASCII_CONTROL_CHARACTER_PATTERN.test(signData)
  ) {
    throw createSigningError('Virtual payment query payload is invalid.', 'VIRTUAL_PAYMENT_QUERY_PAYLOAD_INVALID', 400)
  }
  let payload
  try {
    payload = JSON.parse(signData)
  } catch {
    throw createSigningError('Virtual payment query payload is invalid.', 'VIRTUAL_PAYMENT_QUERY_PAYLOAD_INVALID', 400)
  }
  if (!isPlainObject(payload) || payload.env !== 1 || !SAFE_OPENID_PATTERN.test(payload.openid || '')) {
    throw createSigningError('Virtual payment query payload is invalid.', 'VIRTUAL_PAYMENT_QUERY_PAYLOAD_INVALID', 400)
  }
  const keys = Object.keys(payload)
  const usesOrderId = keys.length === 3 && keys.join(',') === 'openid,env,order_id'
  const usesWechatOrderId = keys.length === 3 && keys.join(',') === 'openid,env,wx_order_id'
  if (
    (
      usesOrderId &&
      (typeof payload.order_id !== 'string' || !ORDER_NUMBER_PATTERN.test(payload.order_id))
    ) ||
    (
      usesWechatOrderId &&
      (typeof payload.wx_order_id !== 'string' || !WECHAT_ORDER_NUMBER_PATTERN.test(payload.wx_order_id))
    ) ||
    (!usesOrderId && !usesWechatOrderId) ||
    JSON.stringify(payload) !== signData
  ) {
    throw createSigningError('Virtual payment query payload is invalid.', 'VIRTUAL_PAYMENT_QUERY_PAYLOAD_INVALID', 400)
  }
}

export function createVirtualPaymentSigningService(options = {}) {
  const config = getVirtualPaymentConfig({
    env: options.env,
    nodeEnv: options.nodeEnv
  })

  function createPaymentParameters(input = {}) {
    assertExactInput(input)
    assertAuthoritativeConfig(config)
    const orderNo = normalizeOrderNumber(input.orderNo)
    const attach = normalizeAttach(input.attach)
    const { signData } = buildSignData(config, orderNo, attach)
    const paySig = hmacSha256Hex(config.appKey, `${PAYMENT_REQUEST_URI}&${signData}`)

    let signature
    try {
      signature = createPaymentSessionSignature(input.paymentSession, signData)
    } catch {
      throw createSigningError('Virtual payment session signature failed.', 'VIRTUAL_PAYMENT_SESSION_SIGNATURE_FAILED', 503)
    }

    return Object.freeze({
      mode: VIRTUAL_PAYMENT_PRODUCT.mode,
      signData,
      paySig,
      signature
    })
  }

  function signQueryOrderPayload(signData) {
    assertAuthoritativeConfig(config)
    assertQueryOrderSignData(signData)
    return hmacSha256Hex(config.appKey, `${QUERY_ORDER_URI}&${signData}`)
  }

  return Object.freeze({
    createPaymentParameters,
    signQueryOrderPayload
  })
}

export const VIRTUAL_PAYMENT_RESPONSE_CACHE_CONTROL = 'no-store'
