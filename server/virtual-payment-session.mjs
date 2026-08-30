const MAX_SAFE_USER_ID = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_SAFE_USER_ID_DIGITS = String(Number.MAX_SAFE_INTEGER).length
const paymentSessionKeys = new WeakMap()

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

export function consumePaymentSessionKey(paymentSession, consumer) {
  if (!paymentSessionKeys.has(paymentSession) || typeof consumer !== 'function') {
    throw createPaymentSessionError(
      'Wechat payment session service is unavailable.',
      'WECHAT_SERVICE_UNAVAILABLE',
      503
    )
  }
  return consumer(paymentSessionKeys.get(paymentSession))
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

    return consumePaymentSessionKey(paymentSession, (sessionKey) => (
      createSensitivePaymentSession({
        userId: authenticatedUserId,
        openid: paymentSession.openid,
        unionid: paymentSession.unionid
      }, sessionKey)
    ))
  }

  return {
    exchangeAndVerifyPaymentSession
  }
}
