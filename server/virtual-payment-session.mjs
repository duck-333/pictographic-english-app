import crypto from 'node:crypto'

const MAX_SAFE_USER_ID = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_SAFE_USER_ID_DIGITS = String(Number.MAX_SAFE_INTEGER).length
const paymentSessionKeys = new WeakMap()
const MAX_SIGN_DATA_LENGTH = 4096
const ASCII_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ORDER_NUMBER_PATTERN = /^(?!_)[A-Za-z0-9_\-|*@]{8,32}$/
const OPAQUE_ATTACH_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const SAFE_CONFIG_VALUE_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const PAYMENT_SIGN_DATA_KEYS = [
  'offerId',
  'buyQuantity',
  'env',
  'currencyType',
  'productId',
  'goodsPrice',
  'outTradeNo',
  'attach'
]

function createPaymentSessionError(message, code, statusCode) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

export function createSensitivePaymentSession(input = {}, sessionKey) {
  if (typeof sessionKey !== 'string') {
    throw createPaymentSessionError(
      'Wechat payment session service is unavailable.',
      'WECHAT_SERVICE_UNAVAILABLE',
      503
    )
  }

  const result = {}
  for (const field of ['userId', 'openid', 'unionid']) {
    if (Object.hasOwn(input, field)) result[field] = input[field]
  }
  Object.defineProperty(result, 'toJSON', {
    value() {
      throw createPaymentSessionError(
        'Sensitive payment session serialization is forbidden.',
        'PAYMENT_SESSION_SERIALIZATION_FORBIDDEN',
        500
      )
    },
    enumerable: false,
    writable: false,
    configurable: false
  })
  paymentSessionKeys.set(result, sessionKey)
  return Object.freeze(result)
}

function isValidatedPaymentSignData(signData) {
  if (
    typeof signData !== 'string' ||
    !signData ||
    signData.length > MAX_SIGN_DATA_LENGTH ||
    ASCII_CONTROL_CHARACTER_PATTERN.test(signData)
  ) return false
  let payload
  try {
    payload = JSON.parse(signData)
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.getPrototypeOf(payload) !== Object.prototype ||
      Object.keys(payload).join(',') !== PAYMENT_SIGN_DATA_KEYS.join(',') ||
      JSON.stringify(payload) !== signData
    ) return false
  } catch {
    return false
  }
  return (
    typeof payload.offerId === 'string' &&
    SAFE_CONFIG_VALUE_PATTERN.test(payload.offerId) &&
    payload.buyQuantity === 1 &&
    payload.env === 1 &&
    payload.currencyType === 'CNY' &&
    typeof payload.productId === 'string' &&
    SAFE_CONFIG_VALUE_PATTERN.test(payload.productId) &&
    payload.goodsPrice === 3000 &&
    typeof payload.outTradeNo === 'string' &&
    ORDER_NUMBER_PATTERN.test(payload.outTradeNo) &&
    typeof payload.attach === 'string' &&
    OPAQUE_ATTACH_PATTERN.test(payload.attach)
  )
}

export function createPaymentSessionSignature(paymentSession, signData) {
  if (
    !paymentSessionKeys.has(paymentSession) ||
    !isValidatedPaymentSignData(signData)
  ) {
    throw createPaymentSessionError(
      'Wechat payment session service is unavailable.',
      'WECHAT_SERVICE_UNAVAILABLE',
      503
    )
  }
  const sessionKey = paymentSessionKeys.get(paymentSession)
  let signature
  try {
    signature = crypto.createHmac('sha256', sessionKey).update(signData, 'utf8').digest('hex')
  } catch {
    throw createPaymentSessionError(
      'Wechat payment session service is unavailable.',
      'WECHAT_SERVICE_UNAVAILABLE',
      503
    )
  }
  paymentSessionKeys.delete(paymentSession)
  return signature
}

function rebindSensitivePaymentSession(paymentSession, input) {
  if (!paymentSessionKeys.has(paymentSession)) {
    throw createPaymentSessionError(
      'Wechat payment session service is unavailable.',
      'WECHAT_SERVICE_UNAVAILABLE',
      503
    )
  }
  const sessionKey = paymentSessionKeys.get(paymentSession)
  const reboundSession = createSensitivePaymentSession(input, sessionKey)
  paymentSessionKeys.delete(paymentSession)
  return reboundSession
}

function normalizeAuthenticatedUserId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw createPaymentSessionError(
        'Authenticated user id is invalid.',
        'PAYMENT_AUTHENTICATED_USER_INVALID',
        400
      )
    }
    return String(value)
  }

  if (typeof value !== 'string') {
    throw createPaymentSessionError(
      'Authenticated user id is invalid.',
      'PAYMENT_AUTHENTICATED_USER_INVALID',
      400
    )
  }

  const normalized = value.trim()
  if (!/^\d+$/.test(normalized) || normalized.length > MAX_SAFE_USER_ID_DIGITS) {
    throw createPaymentSessionError(
      'Authenticated user id is invalid.',
      'PAYMENT_AUTHENTICATED_USER_INVALID',
      400
    )
  }

  const numericValue = BigInt(normalized)
  if (numericValue <= 0n || numericValue > MAX_SAFE_USER_ID) {
    throw createPaymentSessionError(
      'Authenticated user id is invalid.',
      'PAYMENT_AUTHENTICATED_USER_INVALID',
      400
    )
  }
  return numericValue.toString()
}

function normalizeBoundUserId(value) {
  try {
    return normalizeAuthenticatedUserId(value)
  } catch {
    throw createPaymentSessionError(
      'Wechat identity is ambiguous.',
      'WECHAT_IDENTITY_AMBIGUOUS',
      409
    )
  }
}

export function createVirtualPaymentSessionService(options = {}) {
  const wechatLoginClient = options.wechatLoginClient
  const identityStore = options.identityStore

  async function exchangeAndVerifyPaymentSession(input = {}) {
    const authenticatedUserId = normalizeAuthenticatedUserId(input.authenticatedUserId)
    if (!wechatLoginClient || typeof wechatLoginClient.exchangePaymentSession !== 'function') {
      throw createPaymentSessionError(
        'Wechat payment session service is unavailable.',
        'WECHAT_SERVICE_UNAVAILABLE',
        503
      )
    }
    if (!identityStore || typeof identityStore.findWechatBindingForPayment !== 'function') {
      throw createPaymentSessionError(
        'Wechat payment session service is unavailable.',
        'WECHAT_SERVICE_UNAVAILABLE',
        503
      )
    }

    const paymentSession = await wechatLoginClient.exchangePaymentSession(input.loginCode)
    let binding
    try {
      binding = await identityStore.findWechatBindingForPayment(paymentSession.openid)
    } catch (error) {
      if (error && error.code === 'WECHAT_IDENTITY_AMBIGUOUS') {
        throw createPaymentSessionError(
          'Wechat identity is ambiguous.',
          'WECHAT_IDENTITY_AMBIGUOUS',
          409
        )
      }
      throw createPaymentSessionError(
        'Wechat identity service is unavailable.',
        'WECHAT_SERVICE_UNAVAILABLE',
        503
      )
    }

    if (!binding) {
      throw createPaymentSessionError(
        'Wechat identity is not bound.',
        'WECHAT_IDENTITY_NOT_BOUND',
        403
      )
    }

    const boundUserId = normalizeBoundUserId(binding.userId)
    if (boundUserId !== authenticatedUserId) {
      throw createPaymentSessionError(
        'Wechat identity does not belong to the authenticated user.',
        'WECHAT_IDENTITY_MISMATCH',
        403
      )
    }

    return rebindSensitivePaymentSession(paymentSession, {
      userId: authenticatedUserId,
      openid: paymentSession.openid,
      unionid: paymentSession.unionid
    })
  }

  return {
    exchangeAndVerifyPaymentSession
  }
}
