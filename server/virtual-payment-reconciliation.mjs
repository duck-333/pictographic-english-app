import crypto from 'node:crypto'

const ORDER_NUMBER_PATTERN = /^VP[A-F0-9]{30}$/
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_PROVIDER_TRANSACTION_ID_LENGTH = 128
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const EXPECTED_RESULT_KEYS = [
  'orderId',
  'wechatOrderId',
  'wechatPaymentOrderId',
  'status',
  'orderType',
  'orderFeeFen',
  'paidFeeFen',
  'paidAtSeconds',
  'providedAtSeconds',
  'environmentType',
  'environment'
]

export const WECHAT_QUERY_STATUS_RULES = Object.freeze([
  Object.freeze({ status: 0, meaning: 'order_initializing', localStatus: null }),
  Object.freeze({ status: 1, meaning: 'order_created', localStatus: 'confirming' }),
  Object.freeze({ status: 2, meaning: 'paid_pending_delivery', localStatus: 'paid' }),
  Object.freeze({ status: 3, meaning: 'delivering', localStatus: 'paid' }),
  Object.freeze({ status: 4, meaning: 'delivered', localStatus: 'paid' }),
  Object.freeze({ status: 5, meaning: 'refunded', localStatus: null }),
  Object.freeze({ status: 6, meaning: 'closed', localStatus: 'closed' }),
  Object.freeze({ status: 7, meaning: 'refund_failed', localStatus: null }),
  Object.freeze({ status: 8, meaning: 'user_refund_completed', localStatus: null }),
  Object.freeze({ status: 9, meaning: 'advertising_funds_recovered', localStatus: null }),
  Object.freeze({ status: 10, meaning: 'profit_share_returned', localStatus: null })
])

const STATUS_RULES = new Map(WECHAT_QUERY_STATUS_RULES.map((rule) => [rule.status, rule]))
const CANONICAL_FACT_KEYS = Object.freeze([
  'source',
  'environment',
  'wechatEnv',
  'orderNo',
  'providerOrderId',
  'providerTransactionId',
  'wechatStatus',
  'meaning',
  'targetPaymentStatus',
  'orderType',
  'orderAmountFen',
  'paidAmountFen',
  'paidAtSeconds'
])

function reconciliationError(message, code = 'PAYMENT_QUERY_RESULT_INVALID', statusCode = 502) {
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

function requireProviderId(value, options = {}) {
  if (value === null && options.nullable) return null
  if (typeof value !== 'string' || !PROVIDER_ID_PATTERN.test(value)) {
    throw reconciliationError('Wechat payment query result is invalid.')
  }
  return value
}

function requireProviderTransactionId(value, options = {}) {
  if (value === null && options.required !== true) return null
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_TRANSACTION_ID_LENGTH ||
    /^\s+$/u.test(value) ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw reconciliationError('Wechat payment query result is invalid.')
  }
  return value
}

function requireInteger(value, options = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (options.minimum === undefined ? 0 : options.minimum) ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    throw reconciliationError('Wechat payment query result is invalid.')
  }
  return value
}

function requireNullableInteger(value) {
  if (value === null) return null
  return requireInteger(value)
}

export function createWechatQueryCanonicalFact(input) {
  if (
    !isPlainObject(input) ||
    Object.keys(input).length !== CANONICAL_FACT_KEYS.length ||
    CANONICAL_FACT_KEYS.some((key) => !Object.hasOwn(input, key)) ||
    input.source !== 'wechat_query' ||
    input.environment !== 'sandbox' ||
    input.wechatEnv !== 1 ||
    typeof input.orderNo !== 'string' ||
    !ORDER_NUMBER_PATTERN.test(input.orderNo) ||
    typeof input.orderType !== 'number' ||
    !Number.isSafeInteger(input.orderType) ||
    input.orderType !== 0 ||
    input.orderAmountFen !== 3000
  ) {
    throw reconciliationError('Wechat payment query fact is invalid.')
  }
  const rule = STATUS_RULES.get(input.wechatStatus)
  if (
    !rule ||
    rule.localStatus === null ||
    input.meaning !== rule.meaning ||
    input.targetPaymentStatus !== rule.localStatus
  ) {
    throw reconciliationError('Wechat payment query fact is invalid.')
  }
  const providerOrderId = requireProviderId(input.providerOrderId)
  const providerTransactionId = requireProviderTransactionId(input.providerTransactionId, {
    required: rule.localStatus === 'paid'
  })
  let paidAmountFen = null
  let paidAtSeconds = null
  if (rule.localStatus === 'paid') {
    if (input.paidAmountFen !== 3000) {
      throw reconciliationError('Wechat payment query fact is invalid.')
    }
    paidAtSeconds = requireInteger(input.paidAtSeconds, { minimum: 1 })
    paidAmountFen = 3000
  } else if (
    providerTransactionId !== null ||
    input.paidAmountFen !== null ||
    input.paidAtSeconds !== null
  ) {
    throw reconciliationError('Wechat payment query fact is invalid.')
  }
  const raw = JSON.stringify({
    source: 'wechat_query',
    environment: 'sandbox',
    wechatEnv: 1,
    orderNo: input.orderNo,
    providerOrderId,
    providerTransactionId,
    wechatStatus: rule.status,
    meaning: rule.meaning,
    targetPaymentStatus: rule.localStatus,
    orderType: input.orderType,
    orderAmountFen: 3000,
    paidAmountFen,
    paidAtSeconds
  })
  const payloadHash = crypto.createHash('sha256').update(raw, 'utf8').digest()
  return Object.freeze({
    raw,
    payloadHash,
    eventKey: `wechat_query:${payloadHash.toString('hex')}`
  })
}

function assertOrderSnapshot(order) {
  if (
    !isPlainObject(order) ||
    typeof order.orderNo !== 'string' ||
    !ORDER_NUMBER_PATTERN.test(order.orderNo) ||
    order.internalSku !== 'membership_30d' ||
    order.productName !== '30天学习会员' ||
    order.quantity !== 1 ||
    order.unitPriceFen !== 3000 ||
    order.orderAmountFen !== 3000 ||
    order.currency !== 'CNY' ||
    order.environment !== 'sandbox' ||
    order.wechatEnv !== 1 ||
    order.paymentChannel !== 'wechat_virtual_payment'
  ) {
    throw reconciliationError('Payment order conflicts with current configuration.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
}

function normalizePaidTime(seconds, nowSeconds) {
  const value = requireInteger(seconds, { minimum: 1 })
  if (value > nowSeconds + 300) {
    throw reconciliationError('Wechat payment query result is invalid.')
  }
  const date = new Date(value * 1000)
  if (!Number.isFinite(date.getTime())) {
    throw reconciliationError('Wechat payment query result is invalid.')
  }
  return date
}

export function normalizeVerifiedWechatQueryFact(input, order, options = {}) {
  assertOrderSnapshot(order)
  if (!isPlainObject(input) || Object.keys(input).join(',') !== EXPECTED_RESULT_KEYS.join(',')) {
    throw reconciliationError('Wechat payment query result is invalid.')
  }
  if (input.environmentType !== 2 || input.environment !== 'sandbox') {
    throw reconciliationError('Wechat payment query result is invalid.')
  }
  if (input.orderId !== order.orderNo) {
    throw reconciliationError('Wechat payment query result does not match the order.')
  }
  const providerOrderId = requireProviderId(input.wechatOrderId)
  if (input.orderType !== 0 || input.orderFeeFen !== 3000) {
    throw reconciliationError('Wechat payment query result does not match the order.')
  }
  requireNullableInteger(input.providedAtSeconds)
  const rule = STATUS_RULES.get(input.status)
  if (!rule || rule.localStatus === null) {
    throw reconciliationError('Wechat payment query status is unsupported.', 'PAYMENT_QUERY_STATUS_UNSUPPORTED', 409)
  }
  const providerTransactionId = requireProviderTransactionId(input.wechatPaymentOrderId, {
    required: rule.localStatus === 'paid'
  })

  let paidAmountFen = null
  let paidAt = null
  let paidAtSeconds = null
  if (rule.localStatus === 'paid') {
    if (input.paidFeeFen !== 3000) {
      throw reconciliationError('Wechat payment query result does not match the order.')
    }
    const nowValue = options.now === undefined ? Date.now() : options.now()
    if (typeof nowValue !== 'number' || !Number.isFinite(nowValue)) {
      throw reconciliationError('Payment query clock is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
    }
    paidAtSeconds = requireInteger(input.paidAtSeconds, { minimum: 1 })
    paidAt = normalizePaidTime(paidAtSeconds, Math.floor(nowValue / 1000))
    paidAmountFen = 3000
  } else if (
    ![null, 0].includes(input.paidFeeFen) ||
    ![null, 0].includes(input.paidAtSeconds)
  ) {
    throw reconciliationError('Wechat payment query result does not match the order.')
  }

  const canonicalFact = createWechatQueryCanonicalFact({
    source: 'wechat_query',
    environment: 'sandbox',
    wechatEnv: 1,
    orderNo: order.orderNo,
    providerOrderId,
    providerTransactionId,
    wechatStatus: rule.status,
    meaning: rule.meaning,
    targetPaymentStatus: rule.localStatus,
    orderType: input.orderType,
    orderAmountFen: 3000,
    paidAmountFen,
    paidAtSeconds
  })
  return Object.freeze({
    source: 'wechat_query',
    environment: 'sandbox',
    wechatEnv: 1,
    orderNo: order.orderNo,
    eventKey: canonicalFact.eventKey,
    payloadHash: canonicalFact.payloadHash,
    wechatStatus: rule.status,
    meaning: rule.meaning,
    targetPaymentStatus: rule.localStatus,
    orderType: input.orderType,
    orderAmountFen: 3000,
    providerOrderId,
    providerTransactionId,
    paidAmountFen,
    paidAt,
    paidAtSeconds
  })
}
