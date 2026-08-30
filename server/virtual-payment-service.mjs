import { getVirtualPaymentConfig, VIRTUAL_PAYMENT_PRODUCT } from './virtual-payment-config.mjs'
import { normalizeVirtualPaymentClientRequestId } from './virtual-payment-store.mjs'

const PAYMENT_CHANNEL = 'wechat_virtual_payment'
const ALLOWED_CREATE_FIELDS = new Set([
  'authenticatedUserId',
  'clientRequestId',
  'loginCode',
  'sku',
  'platform'
])
const ALLOWED_PLATFORMS = new Set(['android', 'harmony', 'windows'])

function createServiceError(message, code, statusCode) {
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

function normalizeUserId(value) {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
  }
  const numeric = BigInt(raw)
  if (numeric <= 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
  }
  return numeric.toString()
}

function normalizePlatform(value) {
  if (typeof value !== 'string' || !ALLOWED_PLATFORMS.has(value)) {
    throw createServiceError('Payment platform is unsupported.', 'PAYMENT_PLATFORM_UNSUPPORTED', 400)
  }
  return value
}

function mapConfigError(error) {
  if (error && error.code === 'VIRTUAL_PAYMENT_SANDBOX_PRODUCTION_FORBIDDEN') {
    return createServiceError(
      'Sandbox virtual payment is forbidden in production.',
      'PAYMENT_SANDBOX_FORBIDDEN_IN_PRODUCTION',
      503
    )
  }
  return createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
}

function resolveConfig(options) {
  try {
    return getVirtualPaymentConfig({ env: options.env, nodeEnv: options.nodeEnv })
  } catch (error) {
    throw mapConfigError(error)
  }
}

function assertEnabled(config) {
  if (!config.enabled) {
    throw createServiceError('Payment is disabled.', 'PAYMENT_DISABLED', 503)
  }
}

function assertAllowedUser(config, userId) {
  if (!Array.isArray(config.sandboxUserIds) || !config.sandboxUserIds.includes(userId)) {
    throw createServiceError('User is not allowed to use sandbox payment.', 'PAYMENT_TEST_USER_NOT_ALLOWED', 403)
  }
}

function assertCreateInput(input) {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !ALLOWED_CREATE_FIELDS.has(key))) {
    throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
  }
  if (input.sku !== undefined && input.sku !== VIRTUAL_PAYMENT_PRODUCT.internalSku) {
    throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
  }
  if (typeof input.loginCode !== 'string' || !input.loginCode) {
    throw createServiceError('Payment login code is invalid.', 'PAYMENT_LOGIN_CODE_INVALID', 400)
  }
}

function assertOrderMatchesConfig(order, config, userId, clientRequestId) {
  if (
    order.userId !== userId ||
    order.clientRequestId !== clientRequestId ||
    order.internalSku !== VIRTUAL_PAYMENT_PRODUCT.internalSku ||
    order.productId !== config.productId ||
    order.productName !== VIRTUAL_PAYMENT_PRODUCT.displayName ||
    order.quantity !== VIRTUAL_PAYMENT_PRODUCT.quantity ||
    order.unitPriceFen !== VIRTUAL_PAYMENT_PRODUCT.priceFen ||
    order.orderAmountFen !== VIRTUAL_PAYMENT_PRODUCT.priceFen * VIRTUAL_PAYMENT_PRODUCT.quantity ||
    order.currency !== VIRTUAL_PAYMENT_PRODUCT.currency ||
    order.environment !== 'sandbox' ||
    order.wechatEnv !== 1 ||
    order.paymentChannel !== PAYMENT_CHANNEL
  ) {
    throw createServiceError('Payment order conflicts with current configuration.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
}

function assertPayable(order) {
  if (
    !['initializing', 'pending'].includes(order.paymentStatus) ||
    order.entitlementStatus !== 'not_ready' ||
    order.deliveryStatus !== 'not_ready' ||
    order.membershipGrantId !== null ||
    order.entitlementTransactionId !== null
  ) {
    throw createServiceError('Payment order is not payable.', 'PAYMENT_ORDER_NOT_PAYABLE', 409)
  }
}

function safeOrderSummary(order) {
  return Object.freeze({
    orderNo: order.orderNo,
    paymentStatus: order.paymentStatus,
    entitlementStatus: order.entitlementStatus,
    deliveryStatus: order.deliveryStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    entitlementGrantedAt: order.entitlementGrantedAt,
    deliveredAt: order.deliveredAt,
    hasMembershipGrant: order.membershipGrantId !== null,
    hasEntitlementTransaction: order.entitlementTransactionId !== null
  })
}

function mapDependencyError(error, fallbackCode = 'PAYMENT_SERVICE_UNAVAILABLE') {
  const allowedCodes = new Set([
    'PAYMENT_LOGIN_CODE_INVALID',
    'WECHAT_CODE_EXCHANGE_FAILED',
    'WECHAT_IDENTITY_NOT_BOUND',
    'WECHAT_IDENTITY_MISMATCH',
    'WECHAT_IDENTITY_AMBIGUOUS',
    'PAYMENT_ORDER_CONFLICT',
    'PAYMENT_ORDER_NOT_PAYABLE',
    'PAYMENT_ORDER_NOT_FOUND',
    'PAYMENT_ORDER_CREATE_FAILED'
  ])
  if (error && allowedCodes.has(error.code)) {
    return createServiceError(
      error.code === 'PAYMENT_ORDER_NOT_FOUND' ? 'Payment order was not found.' : 'Payment operation failed.',
      error.code,
      Number(error.statusCode || 500)
    )
  }
  return createServiceError('Payment service is unavailable.', fallbackCode, 503)
}

export function createVirtualPaymentService(options = {}) {
  const config = resolveConfig(options)
  const store = options.store
  const paymentSessionService = options.paymentSessionService
  const signingService = options.signingService
  if (
    !store ||
    typeof store.findByUserAndClientRequestId !== 'function' ||
    typeof store.findByUserAndOrderNo !== 'function' ||
    typeof store.createOrder !== 'function' ||
    typeof store.markOrderPending !== 'function' ||
    !paymentSessionService ||
    typeof paymentSessionService.exchangeAndVerifyPaymentSession !== 'function' ||
    !signingService ||
    typeof signingService.createPaymentParameters !== 'function'
  ) {
    throw createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
  }

  async function createOrResumeOrder(input = {}) {
    assertEnabled(config)
    assertCreateInput(input)
    const userId = normalizeUserId(input.authenticatedUserId)
    const clientRequestId = normalizeVirtualPaymentClientRequestId(input.clientRequestId)
    assertAllowedUser(config, userId)
    const platform = normalizePlatform(input.platform)

    let order
    try {
      order = await store.findByUserAndClientRequestId(userId, clientRequestId)
    } catch (error) {
      throw mapDependencyError(error)
    }
    if (order) {
      assertOrderMatchesConfig(order, config, userId, clientRequestId)
      assertPayable(order)
    }

    let paymentSession
    try {
      paymentSession = await paymentSessionService.exchangeAndVerifyPaymentSession({
        loginCode: input.loginCode,
        authenticatedUserId: userId
      })
    } catch (error) {
      throw mapDependencyError(error)
    }

    if (!order) {
      try {
        const creation = await store.createOrder({
          userId,
          clientRequestId,
          internalSku: VIRTUAL_PAYMENT_PRODUCT.internalSku,
          productId: config.productId,
          productName: VIRTUAL_PAYMENT_PRODUCT.displayName,
          quantity: VIRTUAL_PAYMENT_PRODUCT.quantity,
          unitPriceFen: VIRTUAL_PAYMENT_PRODUCT.priceFen,
          orderAmountFen: VIRTUAL_PAYMENT_PRODUCT.priceFen * VIRTUAL_PAYMENT_PRODUCT.quantity,
          currency: VIRTUAL_PAYMENT_PRODUCT.currency,
          environment: 'sandbox',
          wechatEnv: 1,
          paymentChannel: PAYMENT_CHANNEL,
          clientPlatform: platform
        })
        order = creation.order
      } catch (error) {
        throw mapDependencyError(error, 'PAYMENT_ORDER_CREATE_FAILED')
      }
      assertOrderMatchesConfig(order, config, userId, clientRequestId)
      assertPayable(order)
    }

    let paymentParams
    try {
      paymentParams = signingService.createPaymentParameters({
        orderNo: order.orderNo,
        attach: order.orderNo,
        paymentSession
      })
    } catch {
      throw createServiceError('Payment signature generation failed.', 'PAYMENT_SIGNATURE_FAILED', 503)
    }

    let pendingOrder
    try {
      pendingOrder = await store.markOrderPending(userId, order.orderNo)
    } catch (error) {
      throw mapDependencyError(error)
    }
    assertOrderMatchesConfig(pendingOrder, config, userId, clientRequestId)
    assertPayable(pendingOrder)

    return Object.freeze({
      ...safeOrderSummary(pendingOrder),
      paymentParams
    })
  }

  async function getOwnedOrder(input = {}) {
    assertEnabled(config)
    const userId = normalizeUserId(input.authenticatedUserId)
    assertAllowedUser(config, userId)
    let order
    try {
      order = await store.findByUserAndOrderNo(userId, input.orderNo)
    } catch (error) {
      if (error && error.code === 'PAYMENT_ORDER_CONFLICT') throw mapDependencyError(error)
      throw mapDependencyError(error)
    }
    if (!order) throw createServiceError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
    return safeOrderSummary(order)
  }

  return Object.freeze({
    createOrResumeOrder,
    getOwnedOrder
  })
}
