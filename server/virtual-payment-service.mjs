import { getVirtualPaymentConfig, VIRTUAL_PAYMENT_PRODUCT } from './virtual-payment-config.mjs'
import { normalizeVerifiedWechatDeliveryQueryFact } from './virtual-payment-delivery.mjs'
import { normalizeVerifiedWechatQueryFact } from './virtual-payment-reconciliation.mjs'
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
const ALLOWED_RECONCILE_FIELDS = new Set(['authenticatedUserId', 'orderNo', 'loginCode'])
const ALLOWED_ENTITLEMENT_FIELDS = new Set(['authenticatedUserId', 'orderNo'])
const ALLOWED_DELIVERY_FIELDS = new Set(['authenticatedUserId', 'orderNo'])
const ORDER_NUMBER_PATTERN = /^VP[A-F0-9]{30}$/
const CANONICAL_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

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
    (clientRequestId !== undefined && order.clientRequestId !== clientRequestId) ||
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

function isProviderReference(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !/^\s+$/u.test(value) &&
    !CONTROL_CHARACTER_PATTERN.test(value)
}

function isCanonicalPaidAt(value, nowValue) {
  if (typeof value !== 'string' || !CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) &&
    timestamp > 0 &&
    timestamp <= nowValue + 300_000 &&
    new Date(timestamp).toISOString() === value
}

function assertCompleteLocalPaidOrder(order, config, userId, nowProvider) {
  const rawNowValue = nowProvider === undefined ? Date.now() : nowProvider()
  const nowValue = rawNowValue instanceof Date ? rawNowValue.getTime() : rawNowValue
  if (typeof nowValue !== 'number' || !Number.isFinite(nowValue)) {
    throw createServiceError('Payment service clock is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
  }
  if (
    !isPlainObject(order) ||
    order.userId !== userId ||
    order.paymentStatus !== 'paid' ||
    order.internalSku !== VIRTUAL_PAYMENT_PRODUCT.internalSku ||
    order.productId !== config.productId ||
    order.productName !== VIRTUAL_PAYMENT_PRODUCT.displayName ||
    order.quantity !== VIRTUAL_PAYMENT_PRODUCT.quantity ||
    order.unitPriceFen !== VIRTUAL_PAYMENT_PRODUCT.priceFen ||
    order.orderAmountFen !== VIRTUAL_PAYMENT_PRODUCT.priceFen * VIRTUAL_PAYMENT_PRODUCT.quantity ||
    order.paidAmountFen !== order.orderAmountFen ||
    order.paidAmountFen !== VIRTUAL_PAYMENT_PRODUCT.priceFen ||
    order.currency !== VIRTUAL_PAYMENT_PRODUCT.currency ||
    order.environment !== 'sandbox' ||
    order.wechatEnv !== 1 ||
    order.paymentChannel !== PAYMENT_CHANNEL ||
    !ALLOWED_PLATFORMS.has(order.clientPlatform) ||
    !isCanonicalPaidAt(order.paidAt, nowValue) ||
    !isProviderReference(order.providerOrderId) ||
    !isProviderReference(order.providerTransactionId) ||
    order.entitlementStatus !== 'not_ready' ||
    order.deliveryStatus !== 'not_ready' ||
    order.membershipGrantId !== null ||
    order.entitlementTransactionId !== null ||
    order.entitlementGrantedAt !== null ||
    order.deliveredAt !== null
  ) {
    throw createServiceError('Local paid payment fact is incomplete.', 'PAYMENT_PAID_FACT_INCOMPLETE', 409)
  }
}

function assertPaidOrderForEntitlement(order, config, userId, nowProvider) {
  const entitlementShapeValid = (
    order.entitlementStatus === 'not_ready' &&
    order.membershipGrantId === null &&
    order.entitlementTransactionId === null &&
    order.entitlementGrantedAt === null
  ) || (
    order.entitlementStatus === 'granted' &&
    order.membershipGrantId !== null &&
    order.entitlementTransactionId !== null &&
    order.entitlementGrantedAt !== null
  )
  if (!entitlementShapeValid || order.deliveryStatus !== 'not_ready' || order.deliveredAt !== null) {
    throw createServiceError('Payment entitlement data is incomplete.', 'PAYMENT_ENTITLEMENT_INCOMPLETE', 409)
  }
  assertCompleteLocalPaidOrder({
    ...order,
    entitlementStatus: 'not_ready',
    membershipGrantId: null,
    entitlementTransactionId: null,
    entitlementGrantedAt: null
  }, config, userId, nowProvider)
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
    'PAYMENT_ORDER_CREATE_FAILED',
    'PAYMENT_ORDER_NOT_RECONCILABLE',
    'PAYMENT_QUERY_RESULT_INVALID',
    'PAYMENT_QUERY_STATUS_UNSUPPORTED',
    'PAYMENT_PAID_FACT_INCOMPLETE',
    'PAYMENT_ENTITLEMENT_INCOMPLETE',
    'PAYMENT_ENTITLEMENT_NOT_GRANTABLE',
    'PAYMENT_MEMBERSHIP_SCHEDULE_UNAVAILABLE',
    'PAYMENT_MEMBERSHIP_GRANT_FAILED',
    'PAYMENT_DELIVERY_NOT_READY',
    'PAYMENT_DELIVERY_CONFLICT',
    'PAYMENT_DELIVERY_STALE_RESULT',
    'PAYMENT_DELIVERY_MANUAL_REVIEW',
    'PAYMENT_DELIVERY_QUERY_INVALID',
    'PAYMENT_DELIVERY_QUERY_UNAVAILABLE'
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

  async function listRecoveryOrders(input = {}) {
    assertEnabled(config)
    const userId = normalizeUserId(input.authenticatedUserId)
    assertAllowedUser(config, userId)
    if (!isPlainObject(input) || Object.keys(input).some((key) => !['authenticatedUserId', 'cursor'].includes(key)) ||
        (input.cursor !== undefined && (typeof input.cursor !== 'string' || !ORDER_NUMBER_PATTERN.test(input.cursor)))) throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
    try {
      const result = await store.listRecoveryOrders(userId, input.cursor === undefined ? null : input.cursor)
      return { orders: result.orders.map((row) => ({ orderNo: row.orderNo, clientRequestId: row.clientRequestId,
        paymentStatus: row.paymentStatus, entitlementStatus: row.entitlementStatus, deliveryStatus: row.deliveryStatus,
        createdAt: row.createdAt, updatedAt: row.updatedAt })), nextCursor: result.nextCursor }
    } catch (error) {
      if (error && error.code === 'PAYMENT_REQUEST_INVALID') throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
      throw mapDependencyError(error)
    }
  }

  async function reconcileOwnedOrder(input = {}) {
    assertEnabled(config)
    if (
      !isPlainObject(input) ||
      Object.keys(input).some((key) => !ALLOWED_RECONCILE_FIELDS.has(key)) ||
      typeof input.orderNo !== 'string' ||
      !ORDER_NUMBER_PATTERN.test(input.orderNo) ||
      typeof input.loginCode !== 'string' ||
      !input.loginCode
    ) {
      throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
    }
    const userId = normalizeUserId(input.authenticatedUserId)
    assertAllowedUser(config, userId)
    let order
    try {
      order = await store.findByUserAndOrderNo(userId, input.orderNo)
    } catch {
      throw createServiceError('Payment operation failed.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
    }
    if (!order) {
      throw createServiceError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
    }
    if (order.paymentStatus === 'paid') {
      assertCompleteLocalPaidOrder(order, config, userId, options.now)
      if (typeof store.findTrustedWechatQueryPaidEvidence !== 'function') {
        throw createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
      }
      let hasTrustedEvidence
      try {
        hasTrustedEvidence = await store.findTrustedWechatQueryPaidEvidence(userId, order.orderNo)
      } catch (error) {
        throw mapDependencyError(error)
      }
      if (hasTrustedEvidence !== true) {
        throw createServiceError('Local paid payment fact is incomplete.', 'PAYMENT_PAID_FACT_INCOMPLETE', 409)
      }
      return safeOrderSummary(order)
    }
    assertOrderMatchesConfig(order, config, userId)
    if (
      order.entitlementStatus !== 'not_ready' ||
      order.deliveryStatus !== 'not_ready' ||
      order.membershipGrantId !== null ||
      order.entitlementTransactionId !== null
    ) {
      throw createServiceError('Payment order cannot be reconciled.', 'PAYMENT_ORDER_NOT_RECONCILABLE', 409)
    }
    if (!['pending', 'confirming'].includes(order.paymentStatus)) {
      throw createServiceError('Payment order cannot be reconciled.', 'PAYMENT_ORDER_NOT_RECONCILABLE', 409)
    }
    if (
      !options.virtualPaymentClient ||
      typeof options.virtualPaymentClient.queryOrder !== 'function' ||
      typeof store.reconcileVerifiedWechatQuery !== 'function'
    ) {
      throw createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
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
    let queryResult
    try {
      queryResult = await options.virtualPaymentClient.queryOrder({
        openid: paymentSession.openid,
        orderNo: order.orderNo
      })
    } catch {
      throw createServiceError('Wechat payment query is unavailable.', 'PAYMENT_QUERY_UNAVAILABLE', 503)
    }
    let fact
    try {
      fact = normalizeVerifiedWechatQueryFact(queryResult, order, { now: options.now })
    } catch (error) {
      if (error && [
        'PAYMENT_QUERY_RESULT_INVALID',
        'PAYMENT_QUERY_STATUS_UNSUPPORTED',
        'PAYMENT_ORDER_CONFLICT',
        'PAYMENT_SERVICE_UNAVAILABLE'
      ].includes(error.code)) {
        throw createServiceError(error.message, error.code, Number(error.statusCode || 500))
      }
      throw createServiceError('Wechat payment query result is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
    }
    let reconciled
    try {
      reconciled = await store.reconcileVerifiedWechatQuery(userId, order.orderNo, fact, {
        expectedProductId: config.productId
      })
    } catch (error) {
      throw mapDependencyError(error)
    }
    if (reconciled.order.paymentStatus === 'paid') {
      assertCompleteLocalPaidOrder(reconciled.order, config, userId, options.now)
    }
    return safeOrderSummary(reconciled.order)
  }

  async function grantOwnedOrderEntitlement(input = {}) {
    assertEnabled(config)
    if (
      !isPlainObject(input) ||
      Object.keys(input).length !== ALLOWED_ENTITLEMENT_FIELDS.size ||
      [...ALLOWED_ENTITLEMENT_FIELDS].some((key) => !Object.hasOwn(input, key)) ||
      typeof input.orderNo !== 'string' ||
      !ORDER_NUMBER_PATTERN.test(input.orderNo)
    ) {
      throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
    }
    const userId = normalizeUserId(input.authenticatedUserId)
    assertAllowedUser(config, userId)
    if (typeof store.grantTrustedPaidOrderEntitlement !== 'function') {
      throw createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
    }
    let order
    try {
      order = await store.findByUserAndOrderNo(userId, input.orderNo)
    } catch (error) {
      throw mapDependencyError(error)
    }
    if (!order) throw createServiceError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
    assertPaidOrderForEntitlement(order, config, userId, options.now)
    let hasTrustedEvidence
    try {
      hasTrustedEvidence = await store.findTrustedWechatQueryPaidEvidence(userId, input.orderNo)
    } catch (error) {
      throw mapDependencyError(error)
    }
    if (hasTrustedEvidence !== true) {
      throw createServiceError('Local paid payment fact is incomplete.', 'PAYMENT_PAID_FACT_INCOMPLETE', 409)
    }
    let result
    try {
      const rawNowValue = options.now === undefined ? new Date() : options.now()
      const nowValue = rawNowValue instanceof Date ? new Date(rawNowValue.getTime()) : new Date(rawNowValue)
      if (!Number.isFinite(nowValue.getTime())) {
        throw new Error('Invalid payment clock.')
      }
      result = await store.grantTrustedPaidOrderEntitlement(userId, input.orderNo, {
        expectedProductId: config.productId,
        now: nowValue
      })
    } catch (error) {
      throw mapDependencyError(error, 'PAYMENT_MEMBERSHIP_GRANT_FAILED')
    }
    assertPaidOrderForEntitlement(result.order, config, userId, options.now)
    if (
      !result.membership || result.order.entitlementStatus !== 'granted' ||
      result.order.deliveryStatus !== 'not_ready'
    ) {
      throw createServiceError('Payment entitlement data is incomplete.', 'PAYMENT_ENTITLEMENT_INCOMPLETE', 409)
    }
    return Object.freeze({
      orderNo: result.order.orderNo,
      paymentStatus: result.order.paymentStatus,
      entitlementStatus: result.order.entitlementStatus,
      membershipStartedAt: result.membership.effectiveStartAt,
      membershipExpiresAt: result.membership.effectiveEndAt,
      idempotent: result.idempotent === true
    })
  }

  function deliveryResponse(orderNo, deliveryStatus, options = {}) {
    return Object.freeze({
      orderNo,
      paymentStatus: 'paid',
      entitlementStatus: 'granted',
      deliveryStatus,
      idempotent: options.idempotent === true,
      confirming: deliveryStatus === 'confirming',
      manualReview: deliveryStatus === 'manual_review',
      retryable: deliveryStatus === 'retryable_failed'
    })
  }

  function deliveryNow() {
    const value = options.now === undefined ? new Date() : options.now()
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
    if (!Number.isFinite(date.getTime())) {
      throw createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
    }
    return date
  }

  async function executeDeliveryNotify(userId, orderNo, attempt) {
    const startedAt = deliveryNow()
    try {
      await store.markDeliveryDispatching(userId, orderNo, attempt.operationId, {
        expectedProductId: config.productId,
        now: startedAt
      })
    } catch (error) {
      throw mapDependencyError(error)
    }
    try {
      await options.virtualPaymentClient.notifyProvideGoods({ orderNo })
    } catch (error) {
      // The public WeChat contract does not currently document any error code that
      // proves notify_provide_goods was rejected before acceptance. Therefore every
      // non-success result is uncertain and must be reconciled without resending.
      const errorCode = 'DELIVERY_NOTIFY_UNCERTAIN'
      let result
      try {
        result = await store.finishDeliveryNotify(userId, orderNo, attempt.operationId, {
          kind: 'uncertain',
          errorCode,
          now: deliveryNow()
        })
      } catch (storeError) {
        throw mapDependencyError(storeError)
      }
      return deliveryResponse(orderNo, result.deliveryStatus)
    }
    let result
    try {
      result = await store.finishDeliveryNotify(userId, orderNo, attempt.operationId, {
        kind: 'success',
        now: deliveryNow()
      })
    } catch (error) {
      // The persisted dispatching attempt is intentionally left for query-based recovery.
      throw mapDependencyError(error)
    }
    return deliveryResponse(orderNo, result.deliveryStatus)
  }

  async function deliverOwnedOrder(input = {}) {
    assertEnabled(config)
    if (
      !isPlainObject(input) || Object.keys(input).length !== ALLOWED_DELIVERY_FIELDS.size ||
      [...ALLOWED_DELIVERY_FIELDS].some((key) => !Object.hasOwn(input, key)) ||
      typeof input.orderNo !== 'string' || !ORDER_NUMBER_PATTERN.test(input.orderNo)
    ) {
      throw createServiceError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
    }
    const userId = normalizeUserId(input.authenticatedUserId)
    assertAllowedUser(config, userId)
    if (
      typeof store.claimDeliveryWork !== 'function' ||
      typeof store.markDeliveryDispatching !== 'function' ||
      typeof store.finishDeliveryNotify !== 'function' ||
      typeof store.applyDeliveryQueryFact !== 'function' ||
      !options.virtualPaymentClient ||
      typeof options.virtualPaymentClient.notifyProvideGoods !== 'function' ||
      typeof options.virtualPaymentClient.queryOrder !== 'function'
    ) {
      throw createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
    }
    let work
    try {
      work = await store.claimDeliveryWork(userId, input.orderNo, {
        expectedProductId: config.productId,
        now: deliveryNow()
      })
    } catch (error) {
      throw mapDependencyError(error)
    }
    if (work.action === 'notify') {
      return executeDeliveryNotify(userId, input.orderNo, work.attempt)
    }
    if (work.action === 'delivered') return deliveryResponse(input.orderNo, 'delivered', { idempotent: true })
    if (work.action === 'manual_review') return deliveryResponse(input.orderNo, 'manual_review', { idempotent: true })
    if (work.action === 'wait') return deliveryResponse(input.orderNo, work.order.deliveryStatus, { idempotent: true })
    if (work.action !== 'query') {
      throw createServiceError('Payment operation failed.', 'PAYMENT_DELIVERY_CONFLICT', 409)
    }

    if (!options.identityStore || typeof options.identityStore.findWechatOpenidByUserIdForPayment !== 'function') {
      throw createServiceError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
    }
    let openid
    try {
      openid = await options.identityStore.findWechatOpenidByUserIdForPayment(userId)
    } catch {
      throw createServiceError('Payment delivery query is unavailable.', 'PAYMENT_DELIVERY_QUERY_UNAVAILABLE', 503)
    }
    if (typeof openid !== 'string' || !openid) {
      throw createServiceError('Payment delivery query is unavailable.', 'PAYMENT_DELIVERY_QUERY_UNAVAILABLE', 503)
    }
    let queryResult
    try {
      queryResult = await options.virtualPaymentClient.queryOrder({ openid, orderNo: input.orderNo })
    } catch {
      throw createServiceError('Payment delivery query is unavailable.', 'PAYMENT_DELIVERY_QUERY_UNAVAILABLE', 503)
    }
    let fact
    try {
      fact = normalizeVerifiedWechatDeliveryQueryFact(queryResult, work.order, {
        queryOperationId: work.query.operationId,
        querySequence: work.query.querySequence,
        claimedOrderVersion: work.query.claimedOrderVersion,
        now: deliveryNow().getTime()
      })
    } catch (error) {
      if (error && error.code === 'PAYMENT_QUERY_STATUS_UNSUPPORTED') {
        throw createServiceError('Payment delivery query requires review.', 'PAYMENT_DELIVERY_QUERY_INVALID', 409)
      }
      throw createServiceError('Payment delivery query is invalid.', 'PAYMENT_DELIVERY_QUERY_INVALID', 502)
    }
    let outcome
    try {
      outcome = await store.applyDeliveryQueryFact(userId, input.orderNo, fact, {
        expectedProductId: config.productId,
        now: deliveryNow()
      })
    } catch (error) {
      throw mapDependencyError(error)
    }
    if (outcome.action === 'notify') {
      return executeDeliveryNotify(userId, input.orderNo, outcome.attempt)
    }
    return deliveryResponse(input.orderNo, outcome.deliveryStatus, { idempotent: outcome.idempotent })
  }

  return Object.freeze({
    createOrResumeOrder,
    listRecoveryOrders,
    getOwnedOrder,
    reconcileOwnedOrder,
    grantOwnedOrderEntitlement,
    deliverOwnedOrder
  })
}
