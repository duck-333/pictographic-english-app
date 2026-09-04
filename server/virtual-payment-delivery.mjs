import crypto from 'node:crypto'

const ORDER_NUMBER_PATTERN = /^VP[A-F0-9]{30}$/
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const EXPECTED_RESULT_KEYS = [
  'orderId', 'wechatOrderId', 'wechatPaymentOrderId', 'status', 'orderType',
  'orderFeeFen', 'paidFeeFen', 'paidAtSeconds', 'providedAtSeconds',
  'environmentType', 'environment'
]

function deliveryFactError(message = 'Wechat delivery query result is invalid.', code = 'PAYMENT_DELIVERY_QUERY_INVALID', statusCode = 502) {
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

function safePositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function safeNullableTimestamp(value) {
  return value === null || value === 0 || safePositiveInteger(value)
}

export function normalizeVerifiedWechatDeliveryQueryFact(input, order, options = {}) {
  const queryOperationId = options.queryOperationId
  const querySequence = options.querySequence
  const claimedOrderVersion = options.claimedOrderVersion
  if (
    !isPlainObject(input) ||
    Object.keys(input).join(',') !== EXPECTED_RESULT_KEYS.join(',') ||
    !isPlainObject(order) || typeof order.userId !== 'string' || !/^[1-9][0-9]*$/.test(order.userId) ||
    order.environment !== 'sandbox' || order.wechatEnv !== 1 || order.currency !== 'CNY' ||
    typeof order.orderNo !== 'string' || !ORDER_NUMBER_PATTERN.test(order.orderNo) ||
    input.orderId !== order.orderNo ||
    input.environment !== 'sandbox' || input.environmentType !== 2 ||
    input.orderType !== 0 || input.orderFeeFen !== 3000 ||
    typeof input.status !== 'number' || !Number.isSafeInteger(input.status) ||
    input.status < 0 || input.status > 10 ||
    typeof input.wechatOrderId !== 'string' || !SAFE_REFERENCE_PATTERN.test(input.wechatOrderId) ||
    input.wechatOrderId !== order.providerOrderId ||
    !safeNullableTimestamp(input.providedAtSeconds) ||
    typeof queryOperationId !== 'string' || !/^[a-f0-9]{64}$/.test(queryOperationId) ||
    !safePositiveInteger(querySequence) ||
    !Number.isSafeInteger(claimedOrderVersion) || claimedOrderVersion < 0
  ) {
    throw deliveryFactError()
  }
  if (
    (
      typeof input.wechatPaymentOrderId !== 'string' ||
      input.wechatPaymentOrderId.length < 1 || input.wechatPaymentOrderId.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(input.wechatPaymentOrderId) ||
      input.wechatPaymentOrderId !== order.providerTransactionId ||
      input.paidFeeFen !== 3000 ||
      !safePositiveInteger(input.paidAtSeconds)
    )
  ) {
    throw deliveryFactError()
  }
  if (input.status === 4 && !safePositiveInteger(input.providedAtSeconds)) {
    throw deliveryFactError('Wechat delivered status is missing delivery time.')
  }
  if (input.status === 2 && ![null, 0].includes(input.providedAtSeconds)) {
    throw deliveryFactError('Wechat pending-delivery status conflicts with delivery time.')
  }
  const nowValue = options.now === undefined
    ? Date.now()
    : typeof options.now === 'function'
      ? options.now()
      : options.now
  if (typeof nowValue !== 'number' || !Number.isFinite(nowValue)) {
    throw deliveryFactError('Payment delivery clock is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
  }
  const queriedAtSeconds = Math.floor(nowValue / 1000)
  const paidAtMilliseconds = Date.parse(order.paidAt)
  if (
    !Number.isFinite(paidAtMilliseconds) || paidAtMilliseconds % 1000 !== 0 ||
    paidAtMilliseconds / 1000 !== input.paidAtSeconds
  ) {
    throw deliveryFactError('Wechat paid time conflicts with the stored order.')
  }
  for (const seconds of [input.paidAtSeconds, input.providedAtSeconds]) {
    if (safePositiveInteger(seconds) && seconds > Math.floor(nowValue / 1000) + 300) {
      throw deliveryFactError()
    }
  }
  const observationId = typeof options.observationId === 'string' && /^[a-f0-9]{64}$/.test(options.observationId)
    ? options.observationId
    : crypto.randomBytes(32).toString('hex')
  const raw = JSON.stringify({
    source: 'wechat_delivery_query',
    observationId,
    queryOperationId,
    querySequence,
    claimedOrderVersion,
    userId: order.userId,
    environment: input.environment,
    wechatEnv: order.wechatEnv,
    environmentType: input.environmentType,
    currency: order.currency,
    orderNo: order.orderNo,
    providerOrderId: input.wechatOrderId,
    providerTransactionId: input.wechatPaymentOrderId,
    wechatStatus: input.status,
    orderType: input.orderType,
    orderAmountFen: input.orderFeeFen,
    paidAmountFen: input.paidFeeFen,
    paidAtSeconds: input.paidAtSeconds,
    providedAtSeconds: input.providedAtSeconds,
    queriedAtSeconds
  })
  const payloadHash = crypto.createHash('sha256').update(raw, 'utf8').digest()
  return Object.freeze({
    source: 'wechat_delivery_query',
    observationId,
    queryOperationId,
    querySequence,
    claimedOrderVersion,
    userId: order.userId,
    environment: input.environment,
    wechatEnv: order.wechatEnv,
    environmentType: input.environmentType,
    currency: order.currency,
    orderNo: order.orderNo,
    providerOrderId: input.wechatOrderId,
    providerTransactionId: input.wechatPaymentOrderId,
    wechatStatus: input.status,
    orderType: 0,
    orderAmountFen: 3000,
    paidAmountFen: input.paidFeeFen,
    paidAtSeconds: input.paidAtSeconds,
    providedAtSeconds: input.providedAtSeconds,
    queriedAtSeconds,
    providedAt: safePositiveInteger(input.providedAtSeconds)
      ? new Date(input.providedAtSeconds * 1000)
      : null,
    eventType: `wechat_delivery_query_status_${input.status}`,
    eventKey: `wechat_delivery_query:${payloadHash.toString('hex')}`,
    payloadHash
  })
}
