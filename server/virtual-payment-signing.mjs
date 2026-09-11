import crypto from 'node:crypto'

import {
  getVirtualPaymentConfig,
  isVirtualPaymentProductId,
  VIRTUAL_PAYMENT_PRODUCT,
  virtualPaymentProductForPrice
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
const PAYMENT_PRODUCT_CONTEXT_FIELDS = Object.freeze([
  'productId', 'internalSku', 'mode', 'displayName', 'priceFen', 'quantity',
  'durationSeconds', 'currency', 'membershipSourceType'
])
const ALLOWED_PAYMENT_INPUT_FIELDS = new Set(['orderNo', 'attach', 'paymentSession', 'productContext'])

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
    !isVirtualPaymentProductId(config.productId) ||
    typeof config.appKey !== 'string' ||
    !config.appKey ||
    config.appKey.length > 512 ||
    ASCII_CONTROL_CHARACTER_PATTERN.test(config.appKey)
  ) {
    throw createSigningError('Virtual payment signing configuration is invalid.', 'VIRTUAL_PAYMENT_SIGNING_CONFIG_INVALID', 503)
  }
  const product = config.product
  if (
    virtualPaymentProductForPrice(product && product.priceFen) !== product ||
    product.internalSku !== 'membership_30d' ||
    product.mode !== 'short_series_goods' ||
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

function normalizeProductContext(value, config) {
  if (value === undefined) {
    return Object.freeze({ productId: config.productId, product: config.product })
  }
  if (!isPlainObject(value)) {
    throw createSigningError('Virtual payment product context is invalid.', 'VIRTUAL_PAYMENT_PRODUCT_INVALID', 503)
  }
  const keys = Object.keys(value)
  const product = virtualPaymentProductForPrice(value.priceFen)
  const usesStandardProduct = product === VIRTUAL_PAYMENT_PRODUCT
  if (
    keys.length !== PAYMENT_PRODUCT_CONTEXT_FIELDS.length ||
    PAYMENT_PRODUCT_CONTEXT_FIELDS.some((field) => !Object.hasOwn(value, field)) ||
    !product ||
    !isVirtualPaymentProductId(value.productId) ||
    (usesStandardProduct && value.productId !== config.standardProductId) ||
    (!usesStandardProduct && value.productId === config.standardProductId) ||
    value.internalSku !== product.internalSku ||
    value.mode !== product.mode ||
    value.displayName !== product.displayName ||
    value.quantity !== product.quantity ||
    value.durationSeconds !== product.durationSeconds ||
    value.currency !== product.currency ||
    value.membershipSourceType !== product.membershipSourceType
  ) {
    throw createSigningError('Virtual payment product context is invalid.', 'VIRTUAL_PAYMENT_PRODUCT_INVALID', 503)
  }
  return Object.freeze({ productId: value.productId, product })
}

function buildSignData(config, productContext, orderNo, attach) {
  const product = productContext.product
  const signDataObject = Object.freeze({
    offerId: config.offerId,
    buyQuantity: product.quantity,
    env: config.wechatEnv,
    currencyType: product.currency,
    productId: productContext.productId,
    goodsPrice: product.priceFen,
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
    const productContext = normalizeProductContext(input.productContext, config)
    const { signData } = buildSignData(config, productContext, orderNo, attach)
    const paySig = hmacSha256Hex(config.appKey, `${PAYMENT_REQUEST_URI}&${signData}`)

    let signature
    try {
      signature = createPaymentSessionSignature(input.paymentSession, signData, productContext.product.priceFen)
    } catch {
      throw createSigningError('Virtual payment session signature failed.', 'VIRTUAL_PAYMENT_SESSION_SIGNATURE_FAILED', 503)
    }

    return Object.freeze({
      mode: productContext.product.mode,
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
