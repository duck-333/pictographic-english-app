import crypto from 'node:crypto'
import { assertDeliverySchema } from './virtual-payment-delivery-schema.mjs'
import mysql from 'mysql2/promise'

import {
  assertVirtualPaymentState,
  PAYMENT_TRANSITION_SOURCES,
  transitionEntitlementStatus,
  transitionPaymentStatus
} from './virtual-payment-state.mjs'
import { createWechatQueryCanonicalFact } from './virtual-payment-reconciliation.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const ORDERS_TABLE = 'virtual_payment_orders'
const EVENTS_TABLE = 'virtual_payment_events'
const DELIVERY_ATTEMPTS_TABLE = 'virtual_payment_delivery_attempts'
const DELIVERY_QUERIES_TABLE = 'virtual_payment_delivery_queries'
const STORE_ERROR_MARKER = Symbol('virtualPaymentStoreError')
const MAX_SAFE_USER_ID = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_UNSIGNED_INT = 4_294_967_295
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/
const ORDER_NUMBER_PATTERN = /^VP[A-F0-9]{30}$/
const MYSQL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const CLIENT_PLATFORMS = new Set(['android', 'harmony', 'windows'])
const PAYMENT_STATUSES = new Set(['initializing', 'pending', 'confirming', 'paid', 'closed', 'failed'])
const ENTITLEMENT_STATUSES = new Set(['not_ready', 'pending', 'granting', 'granted', 'retryable_failed', 'failed'])
const DELIVERY_STATUSES = new Set(['not_ready', 'pending', 'confirming', 'delivered', 'retryable_failed', 'manual_review'])
const CLIENT_RESULTS = new Set(['success', 'cancelled', 'failed'])
const ALLOWED_WECHAT_QUERY_EVENT_HISTORY = new Map([
  ['wechat_query_status_1_confirming', Object.freeze({ status: 1, meaning: 'order_created', target: 'confirming', paid: false })],
  ['wechat_query_status_2_paid', Object.freeze({ status: 2, meaning: 'paid_pending_delivery', target: 'paid', paid: true })],
  ['wechat_query_status_3_paid', Object.freeze({ status: 3, meaning: 'delivering', target: 'paid', paid: true })],
  ['wechat_query_status_4_paid', Object.freeze({ status: 4, meaning: 'delivered', target: 'paid', paid: true })]
])
const MAX_WECHAT_QUERY_EVENT_HISTORY = ALLOWED_WECHAT_QUERY_EVENT_HISTORY.size
const MAX_PAYMENT_EVENT_HISTORY_SCAN = 64
const EXPECTED_DUPLICATE_CONSTRAINTS = new Set([
  'uk_virtual_payment_orders_order_no',
  'uk_virtual_payment_orders_user_request'
])
const EXPECTED_DUPLICATE_KEYS = new Map(
  [...EXPECTED_DUPLICATE_CONSTRAINTS].flatMap((constraintName) => [
    [constraintName, constraintName],
    [`${ORDERS_TABLE}.${constraintName}`, constraintName],
    [`\`${constraintName}\``, constraintName],
    [`\`${ORDERS_TABLE}\`.\`${constraintName}\``, constraintName]
  ])
)
const MAX_ORDER_NUMBER_ATTEMPTS = 5
const MEMBERSHIP_GRANT_DURATION_SECONDS = 2_592_000
const MEMBERSHIP_SOURCE_TYPE = 'wechat_order'
const DELIVERY_ACTIVE_STATUSES = new Set(['claimed', 'dispatching', 'uncertain', 'confirming'])
const DELIVERY_ATTEMPT_STATUSES = new Set([
  'claimed', 'dispatching', 'explicit_failed', 'uncertain',
  'confirming', 'succeeded', 'manual_review', 'superseded'
])
const DELIVERY_RESULT_KINDS = new Set(['not_started', 'success', 'explicit_failure', 'uncertain'])
const DELIVERY_LEASE_MS = 30_000
const DELIVERY_BACKOFF_MS = 60_000
const DELIVERY_CONFIRM_WINDOW_MS = 15 * 60_000
const DELIVERY_MAX_NOTIFY_ATTEMPTS = 3
const DELIVERY_MAX_CONFIRM_QUERIES = 3
const DELIVERY_ATTEMPT_COLUMNS = `id, operation_id, order_id, user_id, attempt_no, claimed_order_version,
  attempt_status, result_kind, completion_source, claimed_at, finished_at, lease_owner, lease_expires_at, request_started_at,
  response_received_at, next_action_at, query_count, provider_event_id,
  last_error_code, created_at, updated_at`
const DELIVERY_QUERY_COLUMNS = 'id, operation_id, order_id, user_id, attempt_id, query_sequence, claimed_order_version, query_status, claimed_at, lease_expires_at, completed_at, provider_event_id, observation_id, observed_environment, request_env, response_env_type, observed_order_no, observed_provider_order_id, observed_provider_transaction_id, observed_currency, wechat_status, order_type, order_amount_fen, paid_amount_fen, paid_at_seconds, provided_at_seconds, queried_at_seconds, created_at, updated_at'
const CREATE_ORDER_FIELDS = new Set([
  'userId', 'clientRequestId', 'internalSku', 'productId', 'productName', 'quantity',
  'unitPriceFen', 'orderAmountFen', 'currency', 'environment', 'wechatEnv',
  'paymentChannel', 'clientPlatform'
])
const SELECT_COLUMNS = `id, order_no, user_id, client_request_id, internal_sku, product_id,
  product_name, quantity, unit_price_fen, order_amount_fen, paid_amount_fen, currency,
  environment, wechat_env, payment_channel, client_platform, provider_order_id,
  provider_transaction_id, payment_status, entitlement_status, delivery_status,
  client_result, membership_grant_id, entitlement_transaction_id, paid_at,
  entitlement_granted_at, delivered_at, last_queried_at, next_retry_at,
  retry_count, last_error_code, version, created_at, updated_at`

function createStoreError(message, code = 'PAYMENT_SERVICE_UNAVAILABLE', statusCode = 503) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  Object.defineProperty(error, STORE_ERROR_MARKER, { value: true })
  return error
}

function normalizeBigIntId(value, options = {}) {
  const invalid = () => createStoreError(
    options.input ? 'Payment user id is invalid.' : 'Payment order data is invalid.',
    options.input ? 'PAYMENT_REQUEST_INVALID' : 'PAYMENT_ORDER_CONFLICT',
    options.input ? 400 : 409
  )
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw invalid()
    }
    return String(value)
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw invalid()
  }
  const numeric = BigInt(value)
  if (numeric <= 0n || numeric > MAX_SAFE_USER_ID) {
    throw invalid()
  }
  return numeric.toString()
}

function normalizeUserId(value) {
  return normalizeBigIntId(value, { input: true })
}

function normalizeBigIntCounter(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
    }
    return value
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  const numeric = BigInt(value)
  if (numeric > MAX_SAFE_USER_ID) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return Number(numeric)
}

export function normalizeVirtualPaymentClientRequestId(value) {
  if (typeof value !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(value)) {
    throw createStoreError('Payment request is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
  }
  return value
}

function normalizeOrderNo(value) {
  if (typeof value !== 'string' || !ORDER_NUMBER_PATTERN.test(value)) {
    throw createStoreError('Payment order is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return value
}

function normalizeRequiredDate(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
    }
    return value.toISOString()
  }
  if (typeof value !== 'string') {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  const match = MYSQL_DATETIME_PATTERN.exec(value)
  if (!match) throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 10))
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return date.toISOString()
}

function normalizeNullableDate(value) {
  if (value === null) return null
  return normalizeRequiredDate(value)
}

function normalizeNullableId(value) {
  if (value === null) return null
  return normalizeBigIntId(value)
}

function requireString(value, maximumLength = 191) {
  if (typeof value !== 'string' || !value || value.length > maximumLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return value
}

function requireExactString(value, expected) {
  if (typeof value !== 'string' || value !== expected) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return value
}

function requireUnsignedInteger(value, options = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > (options.maximum === undefined ? MAX_UNSIGNED_INT : options.maximum) ||
    (options.expected !== undefined && value !== options.expected)
  ) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return value
}

function normalizeNullableString(value, maximumLength = 191) {
  if (value === null) return null
  return requireString(value, maximumLength)
}

function normalizeNullableEnum(value, allowedValues) {
  if (value === null) return null
  const normalized = requireString(value, 32)
  if (!allowedValues.has(normalized)) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return normalized
}

function normalizeOrderRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  const paymentStatus = requireString(row.payment_status, 32)
  const entitlementStatus = requireString(row.entitlement_status, 32)
  const deliveryStatus = requireString(row.delivery_status, 32)
  if (
    !PAYMENT_STATUSES.has(paymentStatus) ||
    !ENTITLEMENT_STATUSES.has(entitlementStatus) ||
    !DELIVERY_STATUSES.has(deliveryStatus)
  ) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  try {
    assertVirtualPaymentState({ paymentStatus, entitlementStatus, deliveryStatus })
  } catch {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  const clientPlatform = requireString(row.client_platform, 32)
  if (!CLIENT_PLATFORMS.has(clientPlatform)) {
    throw createStoreError('Payment order data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return Object.freeze({
    id: normalizeBigIntId(row.id),
    orderNo: normalizeOrderNo(row.order_no),
    userId: normalizeBigIntId(row.user_id),
    clientRequestId: normalizeVirtualPaymentClientRequestId(row.client_request_id),
    internalSku: requireExactString(row.internal_sku, 'membership_30d'),
    productId: requireString(row.product_id),
    productName: requireExactString(row.product_name, '30天学习会员'),
    quantity: requireUnsignedInteger(row.quantity, { expected: 1 }),
    unitPriceFen: requireUnsignedInteger(row.unit_price_fen, { expected: 3000 }),
    orderAmountFen: requireUnsignedInteger(row.order_amount_fen, { expected: 3000 }),
    paidAmountFen: row.paid_amount_fen === null ? null : requireUnsignedInteger(row.paid_amount_fen),
    currency: requireExactString(row.currency, 'CNY'),
    environment: requireExactString(row.environment, 'sandbox'),
    wechatEnv: requireUnsignedInteger(row.wechat_env, { expected: 1, maximum: 255 }),
    paymentChannel: requireExactString(row.payment_channel, 'wechat_virtual_payment'),
    clientPlatform,
    providerOrderId: normalizeNullableString(row.provider_order_id),
    providerTransactionId: normalizeNullableString(row.provider_transaction_id),
    paymentStatus,
    entitlementStatus,
    deliveryStatus,
    clientResult: normalizeNullableEnum(row.client_result, CLIENT_RESULTS),
    membershipGrantId: normalizeNullableId(row.membership_grant_id),
    entitlementTransactionId: normalizeNullableString(row.entitlement_transaction_id, 64),
    paidAt: normalizeNullableDate(row.paid_at),
    entitlementGrantedAt: normalizeNullableDate(row.entitlement_granted_at),
    deliveredAt: normalizeNullableDate(row.delivered_at),
    lastQueriedAt: normalizeNullableDate(row.last_queried_at),
    nextRetryAt: normalizeNullableDate(row.next_retry_at),
    retryCount: requireUnsignedInteger(row.retry_count),
    lastErrorCode: normalizeNullableString(row.last_error_code, 64),
    version: normalizeBigIntCounter(row.version),
    createdAt: normalizeRequiredDate(row.created_at),
    updatedAt: normalizeRequiredDate(row.updated_at)
  })
}

function getRows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw createStoreError('Payment database response is invalid.')
  }
  return result[0]
}

function normalizeSingleOrder(result) {
  const rows = getRows(result)
  if (rows.length > 1) {
    throw createStoreError('Payment order data is ambiguous.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return rows.length === 1 ? normalizeOrderRow(rows[0]) : null
}

function normalizeDeliveryAttemptRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw createStoreError('Payment delivery attempt data is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
  }
  const status = requireString(row.attempt_status, 32)
  const resultKind = requireString(row.result_kind, 32)
  const operationId = requireString(row.operation_id, 64)
  const leaseOwner = normalizeNullableString(row.lease_owner, 64)
  const lastErrorCode = normalizeNullableString(row.last_error_code, 64)
  if (
    !DELIVERY_ATTEMPT_STATUSES.has(status) || !DELIVERY_RESULT_KINDS.has(resultKind) ||
    !/^[a-f0-9]{64}$/.test(operationId) ||
    (leaseOwner !== null && !/^[a-f0-9]{64}$/.test(leaseOwner)) ||
    (lastErrorCode !== null && !/^[A-Z0-9_]{3,64}$/.test(lastErrorCode))
  ) {
    throw createStoreError('Payment delivery attempt data is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
  }
  return Object.freeze({
    id: normalizeBigIntId(row.id),
    operationId,
    orderId: normalizeBigIntId(row.order_id),
    userId: normalizeBigIntId(row.user_id),
    attemptNo: requireUnsignedInteger(row.attempt_no),
    claimedOrderVersion: normalizeBigIntCounter(row.claimed_order_version),
    status,
    resultKind,
    completionSource: requireString(row.completion_source, 32),
    claimedAt: normalizeRequiredDate(row.claimed_at),
    finishedAt: normalizeNullableDate(row.finished_at),
    leaseOwner,
    leaseExpiresAt: normalizeNullableDate(row.lease_expires_at),
    requestStartedAt: normalizeNullableDate(row.request_started_at),
    responseReceivedAt: normalizeNullableDate(row.response_received_at),
    nextActionAt: normalizeNullableDate(row.next_action_at),
    queryCount: requireUnsignedInteger(row.query_count),
    providerEventId: normalizeNullableId(row.provider_event_id),
    lastErrorCode,
    createdAt: normalizeRequiredDate(row.created_at),
    updatedAt: normalizeRequiredDate(row.updated_at)
  })
}

function normalizeDeliveryQueryRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw createStoreError('Payment delivery query data is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
  }
  const status = requireString(row.query_status, 32)
  const operationId = requireString(row.operation_id, 64)
  const observationId = normalizeNullableString(row.observation_id, 64)
  if (
    !['claimed', 'applied', 'stale', 'failed'].includes(status) ||
    !/^[a-f0-9]{64}$/.test(operationId) ||
    (observationId !== null && !/^[a-f0-9]{64}$/.test(observationId))
  ) {
    throw createStoreError('Payment delivery query data is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
  }
  return Object.freeze({
    id: normalizeBigIntId(row.id),
    operationId,
    orderId: normalizeBigIntId(row.order_id),
    userId: normalizeBigIntId(row.user_id),
    attemptId: normalizeBigIntId(row.attempt_id),
    querySequence: requireUnsignedInteger(row.query_sequence),
    claimedOrderVersion: normalizeBigIntCounter(row.claimed_order_version),
    status,
    claimedAt: normalizeRequiredDate(row.claimed_at),
    leaseExpiresAt: normalizeNullableDate(row.lease_expires_at),
    completedAt: normalizeNullableDate(row.completed_at),
    providerEventId: normalizeNullableId(row.provider_event_id),
    observationId,
    observedEnvironment: normalizeNullableString(row.observed_environment, 32),
    requestEnv: row.request_env === null ? null : requireUnsignedInteger(row.request_env),
    responseEnvType: row.response_env_type === null ? null : requireUnsignedInteger(row.response_env_type),
    observedOrderNo: normalizeNullableString(row.observed_order_no, 64),
    observedProviderOrderId: normalizeNullableString(row.observed_provider_order_id, 191),
    observedProviderTransactionId: normalizeNullableString(row.observed_provider_transaction_id, 191),
    observedCurrency: normalizeNullableString(row.observed_currency, 3),
    wechatStatus: row.wechat_status === null ? null : requireUnsignedInteger(row.wechat_status, { maximum: 10 }),
    orderType: row.order_type === null ? null : requireUnsignedInteger(row.order_type, { maximum: 255 }),
    orderAmountFen: row.order_amount_fen === null ? null : requireUnsignedInteger(row.order_amount_fen),
    paidAmountFen: row.paid_amount_fen === null ? null : requireUnsignedInteger(row.paid_amount_fen),
    paidAtSeconds: row.paid_at_seconds === null ? null : normalizeBigIntCounter(row.paid_at_seconds),
    providedAtSeconds: row.provided_at_seconds === null ? null : normalizeBigIntCounter(row.provided_at_seconds),
    queriedAtSeconds: row.queried_at_seconds === null ? null : normalizeBigIntCounter(row.queried_at_seconds),
    eventKey: row.linked_event_key === undefined || row.linked_event_key === null ? null : requireString(row.linked_event_key, 191),
    eventType: row.linked_event_type === undefined || row.linked_event_type === null ? null : requireString(row.linked_event_type, 64),
    eventOrderId: row.linked_event_order_id === undefined || row.linked_event_order_id === null ? null : normalizeBigIntId(row.linked_event_order_id),
    eventOrderNo: row.linked_event_order_no === undefined || row.linked_event_order_no === null ? null : normalizeOrderNo(row.linked_event_order_no),
    eventProviderOrderId: row.linked_event_provider_order_id === undefined || row.linked_event_provider_order_id === null ? null : requireString(row.linked_event_provider_order_id, 191),
    eventProviderTransactionId: row.linked_event_provider_transaction_id === undefined || row.linked_event_provider_transaction_id === null ? null : requireString(row.linked_event_provider_transaction_id, 191),
    eventPayloadHash: row.linked_event_payload_hash === undefined || row.linked_event_payload_hash === null ? null : row.linked_event_payload_hash,
    eventProcessingStatus: row.linked_event_processing_status === undefined || row.linked_event_processing_status === null ? null : requireString(row.linked_event_processing_status, 32),
    createdAt: normalizeRequiredDate(row.created_at),
    updatedAt: normalizeRequiredDate(row.updated_at)
  })
}

function normalizeDeliveryQueries(result) {
  return getRows(result).map(normalizeDeliveryQueryRow)
}

function normalizeDeliveryAttempts(result) {
  return getRows(result).map(normalizeDeliveryAttemptRow)
}

function deliveryTimestamp(value, field = 'Payment delivery clock') {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw createStoreError(`${field} is invalid.`, 'PAYMENT_SERVICE_UNAVAILABLE', 503)
  }
  return new Date(value.getTime())
}

function deliveryOperationId() {
  return crypto.randomBytes(32).toString('hex')
}

function safeDeliveryErrorCode(value) {
  if (typeof value !== 'string' || !/^[A-Z0-9_]{3,64}$/.test(value)) {
    throw createStoreError('Payment delivery result is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
  }
  return value
}

function normalizeDeliveryQueryFact(value) {
  const keys = [
    'source', 'observationId', 'queryOperationId', 'querySequence', 'claimedOrderVersion',
    'userId', 'environment', 'wechatEnv', 'environmentType', 'currency', 'orderNo',
    'providerOrderId', 'providerTransactionId', 'wechatStatus', 'orderType',
    'orderAmountFen', 'paidAmountFen', 'paidAtSeconds', 'providedAtSeconds',
    'queriedAtSeconds', 'providedAt', 'eventType', 'eventKey', 'payloadHash'
  ]
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)) ||
    value.source !== 'wechat_delivery_query' || !/^[a-f0-9]{64}$/.test(value.observationId || '') ||
    !/^[a-f0-9]{64}$/.test(value.queryOperationId || '') ||
    !Number.isSafeInteger(value.querySequence) || value.querySequence <= 0 ||
    !Number.isSafeInteger(value.claimedOrderVersion) || value.claimedOrderVersion < 0 ||
    typeof value.userId !== 'string' || !/^[1-9][0-9]*$/.test(value.userId) ||
    value.environment !== 'sandbox' || value.wechatEnv !== 1 || value.environmentType !== 2 || value.currency !== 'CNY' ||
    typeof value.orderNo !== 'string' || !ORDER_NUMBER_PATTERN.test(value.orderNo) ||
    typeof value.providerOrderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.providerOrderId) ||
    typeof value.providerTransactionId !== 'string' || value.providerTransactionId.length < 1 ||
    value.providerTransactionId.length > 128 || /[\u0000-\u001f\u007f]/.test(value.providerTransactionId) ||
    !Number.isSafeInteger(value.wechatStatus) || value.wechatStatus < 0 || value.wechatStatus > 10 ||
    value.orderType !== 0 || value.orderAmountFen !== 3000 || value.paidAmountFen !== 3000 ||
    !Number.isSafeInteger(value.paidAtSeconds) || value.paidAtSeconds <= 0 ||
    !Number.isSafeInteger(value.queriedAtSeconds) || value.queriedAtSeconds <= 0 ||
    ![null, 0].includes(value.providedAtSeconds) && (!Number.isSafeInteger(value.providedAtSeconds) || value.providedAtSeconds <= 0) ||
    value.eventType !== `wechat_delivery_query_status_${value.wechatStatus}` ||
    !/^wechat_delivery_query:[a-f0-9]{64}$/.test(value.eventKey || '') ||
    !Buffer.isBuffer(value.payloadHash) || value.payloadHash.length !== 32
  ) {
    throw createStoreError('Payment delivery query fact is invalid.', 'PAYMENT_DELIVERY_QUERY_INVALID', 502)
  }
  if (
    (value.providedAtSeconds === null || value.providedAtSeconds === 0)
      ? value.providedAt !== null
      : !(value.providedAt instanceof Date) || value.providedAt.getTime() !== value.providedAtSeconds * 1000
  ) {
    throw createStoreError('Payment delivery query fact is invalid.', 'PAYMENT_DELIVERY_QUERY_INVALID', 502)
  }
  const raw = JSON.stringify({
    source: value.source,
    observationId: value.observationId,
    queryOperationId: value.queryOperationId,
    querySequence: value.querySequence,
    claimedOrderVersion: value.claimedOrderVersion,
    userId: value.userId,
    environment: value.environment,
    wechatEnv: value.wechatEnv,
    environmentType: value.environmentType,
    currency: value.currency,
    orderNo: value.orderNo,
    providerOrderId: value.providerOrderId,
    providerTransactionId: value.providerTransactionId,
    wechatStatus: value.wechatStatus,
    orderType: value.orderType,
    orderAmountFen: value.orderAmountFen,
    paidAmountFen: value.paidAmountFen,
    paidAtSeconds: value.paidAtSeconds,
    providedAtSeconds: value.providedAtSeconds,
    queriedAtSeconds: value.queriedAtSeconds
  })
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest()
  if (!crypto.timingSafeEqual(hash, value.payloadHash) || value.eventKey !== `wechat_delivery_query:${hash.toString('hex')}`) {
    throw createStoreError('Payment delivery query fact is invalid.', 'PAYMENT_DELIVERY_QUERY_INVALID', 502)
  }
  return Object.freeze({
    ...value,
    payloadHash: Buffer.from(hash),
    providedAt: value.providedAt === null ? null : new Date(value.providedAt.getTime())
  })
}

function assertAffectedRows(result, expected = 1) {
  const affectedRows = result && result[0] && result[0].affectedRows
  if (affectedRows !== expected) {
    throw createStoreError('Payment database update response is invalid.')
  }
}

function normalizeTrustedWechatQueryPaidEvidenceRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw createStoreError('Payment event data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  const eventType = requireString(row.event_type, 64)
  const eventRule = ALLOWED_WECHAT_QUERY_EVENT_HISTORY.get(eventType)
  const eventKey = requireString(row.event_key, 191)
  const orderNo = normalizeOrderNo(row.order_no)
  const providerOrderId = requireString(row.provider_order_id, 128)
  const providerTransactionId = requireProviderTransactionReference(row.provider_transaction_id, {
    nullable: eventRule ? !eventRule.paid : true
  })
  const paidAmountFen = eventRule && eventRule.paid
    ? requireUnsignedInteger(row.paid_amount_fen, { expected: 3000 })
    : null
  const paidAt = eventRule && eventRule.paid ? normalizeRequiredDate(row.paid_at) : null
  const paidAtSeconds = paidAt === null ? null : Date.parse(paidAt) / 1000
  const payloadHash = row.payload_hash
  if (!eventRule && /^wechat_delivery_query_status_(?:[0-9]|10)$/.test(eventType)) {
    const hasDeliveryQueryHistory = row.delivery_query_operation_id !== undefined
    if (!hasDeliveryQueryHistory) {
      if (
        !/^wechat_delivery_query:[a-f0-9]{64}$/.test(eventKey) ||
        normalizeBigIntId(row.order_id) !== normalizeBigIntId(row.linked_order_id) ||
        orderNo !== row.linked_order_no || providerOrderId !== row.linked_provider_order_id ||
        providerTransactionId !== row.linked_provider_transaction_id ||
        row.environment !== 'sandbox' || row.processing_status !== 'processed' || row.last_error_code !== null ||
        !Buffer.isBuffer(payloadHash) || payloadHash.length !== 32 ||
        eventKey !== `wechat_delivery_query:${payloadHash.toString('hex')}`
      ) throw createStoreError('Payment event data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
      return false
    }
    const queryOperationId = requireString(row.delivery_query_operation_id, 64)
    const observationId = requireString(row.delivery_query_observation_id, 64)
    const querySequence = requireUnsignedInteger(row.delivery_query_sequence)
    const claimedOrderVersion = normalizeBigIntCounter(row.delivery_query_order_version)
    const wechatStatus = requireUnsignedInteger(row.delivery_query_wechat_status, { maximum: 10 })
    const providedAtSeconds = row.delivery_query_provided_at_seconds === null
      ? null
      : normalizeBigIntCounter(row.delivery_query_provided_at_seconds)
    const queriedAtSeconds = normalizeBigIntCounter(row.delivery_query_queried_at_seconds)
    const deliveryPaidAtSeconds = normalizeBigIntCounter(row.delivery_query_paid_at_seconds)
    const deliveryRaw = JSON.stringify({
      source: 'wechat_delivery_query', observationId, queryOperationId, querySequence,
      claimedOrderVersion, userId: normalizeBigIntId(row.delivery_query_user_id),
      environment: row.delivery_query_environment, wechatEnv: row.delivery_query_env,
      environmentType: row.delivery_query_env_type, currency: row.delivery_query_currency,
      orderNo: row.delivery_query_order_no, providerOrderId: row.delivery_query_provider_order_id,
      providerTransactionId: row.delivery_query_provider_transaction_id, wechatStatus,
      orderType: requireUnsignedInteger(row.delivery_query_order_type, { expected: 0, maximum: 255 }),
      orderAmountFen: requireUnsignedInteger(row.delivery_query_order_amount_fen, { expected: 3000 }),
      paidAmountFen: requireUnsignedInteger(row.delivery_query_paid_amount_fen, { expected: 3000 }),
      paidAtSeconds: deliveryPaidAtSeconds, providedAtSeconds, queriedAtSeconds
    })
    const rebuiltDeliveryHash = crypto.createHash('sha256').update(deliveryRaw, 'utf8').digest()
    if (
      !/^wechat_delivery_query:[a-f0-9]{64}$/.test(eventKey) ||
      normalizeBigIntId(row.order_id) !== normalizeBigIntId(row.linked_order_id) ||
      orderNo !== row.linked_order_no || providerOrderId !== row.linked_provider_order_id ||
      providerTransactionId !== row.linked_provider_transaction_id ||
      row.environment !== 'sandbox' || row.processing_status !== 'processed' || row.last_error_code !== null ||
      !Buffer.isBuffer(payloadHash) || payloadHash.length !== 32 ||
      !/^[a-f0-9]{64}$/.test(queryOperationId) || !/^[a-f0-9]{64}$/.test(observationId) ||
      normalizeBigIntId(row.delivery_query_user_id) !== normalizeBigIntId(row.linked_user_id) ||
      row.delivery_query_environment !== 'sandbox' || row.delivery_query_env !== 1 ||
      row.delivery_query_env_type !== 2 || row.delivery_query_currency !== 'CNY' ||
      row.delivery_query_order_no !== orderNo || row.delivery_query_provider_order_id !== providerOrderId ||
      row.delivery_query_provider_transaction_id !== providerTransactionId ||
      eventType !== `wechat_delivery_query_status_${wechatStatus}` ||
      deliveryPaidAtSeconds !== Date.parse(normalizeRequiredDate(row.paid_at)) / 1000 ||
      !crypto.timingSafeEqual(payloadHash, rebuiltDeliveryHash) ||
      eventKey !== `wechat_delivery_query:${rebuiltDeliveryHash.toString('hex')}` ||
      requireUnsignedInteger(row.received_count) < 1 || requireUnsignedInteger(row.attempt_count) < 1
    ) {
      throw createStoreError('Payment event data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
    }
    normalizeRequiredDate(row.processed_at)
    return false
  }
  if (
    !eventRule ||
    !/^wechat_query:[a-f0-9]{64}$/.test(eventKey) ||
    normalizeBigIntId(row.order_id) !== normalizeBigIntId(row.linked_order_id) ||
    orderNo !== row.linked_order_no ||
    providerOrderId !== row.linked_provider_order_id ||
    (eventRule && eventRule.paid && providerTransactionId !== row.linked_provider_transaction_id) ||
    row.environment !== 'sandbox' ||
    row.processing_status !== 'processed' ||
    row.last_error_code !== null ||
    (paidAtSeconds !== null && (!Number.isSafeInteger(paidAtSeconds) || paidAtSeconds <= 0)) ||
    !Buffer.isBuffer(payloadHash) ||
    payloadHash.length !== 32 ||
    requireUnsignedInteger(row.received_count) < 1 ||
    requireUnsignedInteger(row.attempt_count) < 1
  ) {
    throw createStoreError('Payment event data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  normalizeRequiredDate(row.processed_at)
  let canonicalFact
  try {
    canonicalFact = createWechatQueryCanonicalFact({
      source: 'wechat_query',
      environment: 'sandbox',
      wechatEnv: requireUnsignedInteger(row.wechat_env, { expected: 1, maximum: 255 }),
      orderNo,
      providerOrderId,
      providerTransactionId,
      wechatStatus: eventRule.status,
      meaning: eventRule.meaning,
      targetPaymentStatus: eventRule.target,
      orderType: 0,
      orderAmountFen: requireUnsignedInteger(row.order_amount_fen, { expected: 3000 }),
      paidAmountFen,
      paidAtSeconds
    })
  } catch {
    throw createStoreError('Payment event data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  if (
    !crypto.timingSafeEqual(payloadHash, canonicalFact.payloadHash) ||
    eventKey !== canonicalFact.eventKey
  ) {
    throw createStoreError('Payment event data is invalid.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
  return eventRule.paid
}

function requireProviderTransactionReference(value, options = {}) {
  if (value === null && options.nullable) return null
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    /^\s+$/u.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
  }
  return value
}

function normalizeTrustedReconciliationContext(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).join(',') !== 'expectedProductId' ||
    typeof value.expectedProductId !== 'string' ||
    value.expectedProductId.length === 0 ||
    value.expectedProductId.length > 191 ||
    /^\s+$/u.test(value.expectedProductId) ||
    /[\u0000-\u001f\u007f]/.test(value.expectedProductId)
  ) {
    throw createStoreError('Payment reconciliation context is invalid.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
  }
  return Object.freeze({ expectedProductId: value.expectedProductId })
}

function normalizeReconciliationFact(value) {
  const expectedFacts = new Map([
    [1, ['order_created', 'confirming']],
    [2, ['paid_pending_delivery', 'paid']],
    [3, ['delivering', 'paid']],
    [4, ['delivered', 'paid']],
    [6, ['closed', 'closed']]
  ])
  const allowedKeys = new Set([
    'source', 'environment', 'wechatEnv', 'orderNo', 'eventKey', 'payloadHash',
    'wechatStatus', 'meaning', 'targetPaymentStatus', 'providerOrderId',
    'providerTransactionId', 'orderType', 'orderAmountFen', 'paidAmountFen',
    'paidAt', 'paidAtSeconds'
  ])
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== allowedKeys.size ||
    [...allowedKeys].some((key) => !Object.hasOwn(value, key)) ||
    value.source !== 'wechat_query' ||
    value.environment !== 'sandbox' ||
    value.wechatEnv !== 1 ||
    typeof value.orderNo !== 'string' ||
    !ORDER_NUMBER_PATTERN.test(value.orderNo) ||
    typeof value.eventKey !== 'string' ||
    !/^wechat_query:[a-f0-9]{64}$/.test(value.eventKey) ||
    !Buffer.isBuffer(value.payloadHash) ||
    value.payloadHash.length !== 32 ||
    typeof value.meaning !== 'string' ||
    !/^[a-z_]{1,64}$/.test(value.meaning) ||
    !Number.isSafeInteger(value.wechatStatus) ||
    typeof value.orderType !== 'number' ||
    !Number.isSafeInteger(value.orderType) ||
    value.orderType !== 0 ||
    value.orderAmountFen !== 3000 ||
    !['confirming', 'paid', 'closed'].includes(value.targetPaymentStatus)
  ) {
    throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
  }
  const expectedFact = expectedFacts.get(value.wechatStatus)
  if (
    !expectedFact ||
    expectedFact[0] !== value.meaning ||
    expectedFact[1] !== value.targetPaymentStatus
  ) {
    throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
  }
  const providerOrderId = requireString(value.providerOrderId, 128)
  const providerTransactionId = requireProviderTransactionReference(value.providerTransactionId, { nullable: true })
  if (!/^[A-Za-z0-9_-]+$/.test(providerOrderId)) {
    throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
  }
  if (value.targetPaymentStatus === 'paid') {
    if (
      value.paidAmountFen !== 3000 ||
      providerTransactionId === null ||
      !(value.paidAt instanceof Date) ||
      !Number.isFinite(value.paidAt.getTime()) ||
      !Number.isSafeInteger(value.paidAtSeconds) ||
      value.paidAtSeconds <= 0 ||
      value.paidAt.getTime() !== value.paidAtSeconds * 1000
    ) {
      throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
    }
  } else if (value.paidAmountFen !== null || value.paidAt !== null || value.paidAtSeconds !== null) {
    throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
  }
  let canonicalFact
  try {
    canonicalFact = createWechatQueryCanonicalFact({
      source: value.source,
      environment: value.environment,
      wechatEnv: value.wechatEnv,
      orderNo: value.orderNo,
      providerOrderId,
      providerTransactionId,
      wechatStatus: value.wechatStatus,
      meaning: value.meaning,
      targetPaymentStatus: value.targetPaymentStatus,
      orderType: value.orderType,
      orderAmountFen: value.orderAmountFen,
      paidAmountFen: value.paidAmountFen,
      paidAtSeconds: value.paidAtSeconds
    })
  } catch {
    throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
  }
  const providedPayloadHash = Buffer.from(value.payloadHash)
  if (
    !crypto.timingSafeEqual(providedPayloadHash, canonicalFact.payloadHash) ||
    value.eventKey !== canonicalFact.eventKey
  ) {
    throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
  }
  return Object.freeze({
    source: 'wechat_query',
    environment: 'sandbox',
    wechatEnv: 1,
    orderNo: value.orderNo,
    eventKey: canonicalFact.eventKey,
    payloadHash: Buffer.from(canonicalFact.payloadHash),
    wechatStatus: value.wechatStatus,
    meaning: value.meaning,
    targetPaymentStatus: value.targetPaymentStatus,
    providerOrderId,
    providerTransactionId,
    orderType: value.orderType,
    orderAmountFen: value.orderAmountFen,
    paidAmountFen: value.paidAmountFen,
    paidAt: value.paidAt === null ? null : new Date(value.paidAt.getTime()),
    paidAtSeconds: value.paidAtSeconds
  })
}

function assertIdempotentOrderMatchesInput(order, input, userId, clientRequestId, productId) {
  if (
    order.userId !== userId ||
    order.clientRequestId !== clientRequestId ||
    order.internalSku !== input.internalSku ||
    order.productId !== productId ||
    order.productName !== input.productName ||
    order.quantity !== input.quantity ||
    order.unitPriceFen !== input.unitPriceFen ||
    order.orderAmountFen !== input.orderAmountFen ||
    order.currency !== input.currency ||
    order.environment !== input.environment ||
    order.wechatEnv !== input.wechatEnv ||
    order.paymentChannel !== input.paymentChannel
  ) {
    throw createStoreError('Payment order conflicts with current configuration.', 'PAYMENT_ORDER_CONFLICT', 409)
  }
}

class ExpectedDuplicateConstraint extends Error {
  constructor(constraintName) {
    super('Expected virtual payment duplicate constraint.')
    this.name = 'ExpectedDuplicateConstraint'
    this.constraintName = constraintName
  }
}

function extractExpectedDuplicateConstraint(error) {
  try {
    if (
      !error ||
      typeof error !== 'object' ||
      error.code !== 'ER_DUP_ENTRY' ||
      error.errno !== 1062 ||
      error.sqlState !== '23000'
    ) {
      return null
    }
    const detail = typeof error.sqlMessage === 'string'
      ? error.sqlMessage
      : typeof error.message === 'string'
        ? error.message
        : ''
    const match = /^Duplicate entry '(?:[^'\r\n]|'')*' for key '([^'\r\n]+)'$/.exec(detail)
    if (!match) return null
    return EXPECTED_DUPLICATE_KEYS.get(match[1]) || null
  } catch {
    return null
  }
}

function getDbConfig(options = {}) {
  const host = String(options.dbHost === undefined ? process.env.DB_HOST || DEFAULT_DB_HOST : options.dbHost).trim()
  const port = Number(options.dbPort === undefined ? process.env.DB_PORT || DEFAULT_DB_PORT : options.dbPort)
  const database = String(options.dbName === undefined ? process.env.DB_NAME || DEFAULT_DB_NAME : options.dbName).trim()
  const user = String(options.dbUser === undefined ? process.env.DB_USER || '' : options.dbUser).trim()
  const password = String(options.dbPassword === undefined ? process.env.DB_PASSWORD || '' : options.dbPassword)
  return { host, port, database, user, password, configured: Boolean(host && port && database && user && password) }
}

export function createVirtualPaymentStore(options = {}) {
  let pool = options.pool || null
  const entitlementStore = options.userEntitlementStore || options.entitlementStore || null
  const orderNoFactory = options.orderNoFactory || (() => `VP${crypto.randomBytes(15).toString('hex').toUpperCase()}`)

  function getPool() {
    if (pool) return pool
    const config = getDbConfig(options)
    if (!config.configured) throw createStoreError('Payment database is unavailable.')
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: Number(options.dbConnectionLimit || process.env.DB_CONNECTION_LIMIT || 5),
      namedPlaceholders: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z'
    })
    return pool
  }

  async function execute(sql, values, options = {}) {
    let connection = null
    let acquiredConnection = false
    let result
    let operationError = null
    let releaseError = null
    try {
      const database = getPool()
      if (typeof database.getConnection === 'function') {
        connection = await database.getConnection()
        acquiredConnection = true
      } else {
        connection = database
      }
      if (!connection || typeof connection.execute !== 'function') {
        throw new Error('Invalid database connection.')
      }
      result = await connection.execute(sql, values)
    } catch (error) {
      operationError = error
    }
    if (acquiredConnection) {
      try {
        if (!connection || typeof connection.release !== 'function') throw new Error('Invalid database release.')
        await connection.release()
      } catch (error) {
        releaseError = error
      }
    }
    if (operationError && releaseError) {
      throw createStoreError('Payment database operation and connection release both failed.')
    }
    if (releaseError) throw createStoreError('Payment database connection release failed.')
    if (operationError) {
      if (options.classifyExpectedDuplicate) {
        const constraintName = extractExpectedDuplicateConstraint(operationError)
        if (constraintName) throw new ExpectedDuplicateConstraint(constraintName)
      }
      throw createStoreError('Payment database operation failed.')
    }
    return result
  }

  async function runTransaction(work, options = {}) {
    let connection = null
    let transactionStarted = false
    let operationError = null
    let rollbackError = null
    let releaseError = null
    let result
    try {
      const database = getPool()
      if (!database || typeof database.getConnection !== 'function') {
        throw new Error('Invalid transactional database pool.')
      }
      connection = await database.getConnection()
      if (
        !connection ||
        typeof connection.execute !== 'function' ||
        typeof connection.beginTransaction !== 'function' ||
        typeof connection.commit !== 'function' ||
        typeof connection.rollback !== 'function'
      ) {
        throw new Error('Invalid transactional database connection.')
      }
      if (options.isolationLevel === 'READ COMMITTED') {
        await connection.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      }
      await connection.beginTransaction()
      transactionStarted = true
      result = await work(connection)
      await connection.commit()
      transactionStarted = false
    } catch (error) {
      operationError = error
      if (transactionStarted && connection) {
        try {
          await connection.rollback()
        } catch (rollbackFailure) {
          rollbackError = rollbackFailure
        }
      }
    } finally {
      if (connection) {
        try {
          if (typeof connection.release !== 'function') throw new Error('Invalid database release.')
          await connection.release()
        } catch (releaseFailure) {
          releaseError = releaseFailure
        }
      }
    }
    if (rollbackError || releaseError) {
      throw createStoreError('Payment database transaction cleanup failed.')
    }
    if (operationError) {
      if (operationError[STORE_ERROR_MARKER] === true) throw operationError
      throw createStoreError('Payment database transaction failed.')
    }
    return result
  }

  async function findByUserAndClientRequestId(userIdValue, clientRequestIdValue) {
    const userId = normalizeUserId(userIdValue)
    const clientRequestId = normalizeVirtualPaymentClientRequestId(clientRequestIdValue)
    const result = await execute(
      `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE} WHERE user_id = ? AND client_request_id = ? LIMIT 2`,
      [userId, clientRequestId]
    )
    return normalizeSingleOrder(result)
  }

  async function findByUserAndOrderNo(userIdValue, orderNoValue) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const result = await execute(
      `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE} WHERE user_id = ? AND order_no = ? LIMIT 2`,
      [userId, orderNo]
    )
    return normalizeSingleOrder(result)
  }

  async function findTrustedWechatQueryPaidEvidenceWithExecutor(executor, userId, orderNo, options = {}) {
    const deliveryQuerySelect = options.includeDeliveryHistory === true
      ? `, o.user_id AS linked_user_id, dq.user_id AS delivery_query_user_id,
              dq.observed_environment AS delivery_query_environment,
              dq.request_env AS delivery_query_env, dq.response_env_type AS delivery_query_env_type,
              dq.observed_currency AS delivery_query_currency, dq.observed_order_no AS delivery_query_order_no,
              dq.observed_provider_order_id AS delivery_query_provider_order_id,
              dq.observed_provider_transaction_id AS delivery_query_provider_transaction_id,
              dq.operation_id AS delivery_query_operation_id,
              dq.observation_id AS delivery_query_observation_id,
              dq.query_sequence AS delivery_query_sequence,
              dq.claimed_order_version AS delivery_query_order_version,
              dq.wechat_status AS delivery_query_wechat_status,
              dq.order_type AS delivery_query_order_type,
              dq.order_amount_fen AS delivery_query_order_amount_fen,
              dq.paid_amount_fen AS delivery_query_paid_amount_fen,
              dq.paid_at_seconds AS delivery_query_paid_at_seconds,
              dq.provided_at_seconds AS delivery_query_provided_at_seconds,
              dq.queried_at_seconds AS delivery_query_queried_at_seconds`
      : ''
    const deliveryQueryJoin = options.includeDeliveryHistory === true
      ? `LEFT JOIN ${DELIVERY_QUERIES_TABLE} dq ON dq.provider_event_id = e.id`
      : ''
    const rows = getRows(await executor(
      `SELECT e.event_key, e.event_type, e.order_id, e.order_no,
              e.provider_order_id, e.provider_transaction_id, e.payload_hash,
              e.processing_status, e.received_count, e.processed_at,
              e.attempt_count, e.last_error_code,
              o.id AS linked_order_id, o.order_no AS linked_order_no,
              o.provider_order_id AS linked_provider_order_id,
              o.provider_transaction_id AS linked_provider_transaction_id,
              o.order_amount_fen, o.paid_amount_fen, o.paid_at,
              o.environment, o.wechat_env${deliveryQuerySelect}
       FROM ${EVENTS_TABLE} e
       INNER JOIN ${ORDERS_TABLE} o
         ON o.id = e.order_id OR o.order_no = e.order_no
       ${deliveryQueryJoin}
       WHERE o.user_id = ? AND o.order_no = ? AND o.payment_status = 'paid'
       LIMIT ${MAX_PAYMENT_EVENT_HISTORY_SCAN + 1}`,
      [userId, orderNo]
    ))
    if (rows.length > MAX_PAYMENT_EVENT_HISTORY_SCAN) {
      throw createStoreError('Payment event data is ambiguous.', 'PAYMENT_ORDER_CONFLICT', 409)
    }
    let hasPaidEvidence = false
    let canonicalHistoryCount = 0
    for (const row of rows) {
      const paidEvidence = normalizeTrustedWechatQueryPaidEvidenceRow(row)
      if (ALLOWED_WECHAT_QUERY_EVENT_HISTORY.has(row.event_type)) canonicalHistoryCount += 1
      if (canonicalHistoryCount > MAX_WECHAT_QUERY_EVENT_HISTORY) {
        throw createStoreError('Payment event data is ambiguous.', 'PAYMENT_ORDER_CONFLICT', 409)
      }
      if (paidEvidence) hasPaidEvidence = true
    }
    return hasPaidEvidence
  }

  async function findTrustedWechatQueryPaidEvidence(userIdValue, orderNoValue) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    return findTrustedWechatQueryPaidEvidenceWithExecutor(execute, userId, orderNo)
  }

  function assertTrustedPaidOrderForEntitlement(order, expectedProductId, userId) {
    if (
      order.userId !== userId || order.paymentStatus !== 'paid' ||
      order.internalSku !== 'membership_30d' || order.productId !== expectedProductId ||
      order.productName !== '30天学习会员' || order.quantity !== 1 ||
      order.unitPriceFen !== 3000 || order.orderAmountFen !== 3000 || order.paidAmountFen !== 3000 ||
      order.currency !== 'CNY' || order.environment !== 'sandbox' || order.wechatEnv !== 1 ||
      order.paymentChannel !== 'wechat_virtual_payment' || !CLIENT_PLATFORMS.has(order.clientPlatform) ||
      order.providerOrderId === null || order.providerTransactionId === null || order.paidAt === null ||
      order.deliveryStatus !== 'not_ready' || order.deliveredAt !== null
    ) {
      throw createStoreError('Paid payment fact is incomplete.', 'PAYMENT_PAID_FACT_INCOMPLETE', 409)
    }
  }

  function membershipGrantKeys(orderNo) {
    return Object.freeze({
      sourceType: MEMBERSHIP_SOURCE_TYPE,
      sourceId: orderNo,
      idempotencyKey: `membership_grant:wechat_order:${orderNo}`
    })
  }

  async function grantTrustedPaidOrderEntitlement(userIdValue, orderNoValue, contextValue = {}) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const expectedProductId = requireString(contextValue.expectedProductId)
    const currentTime = contextValue.now instanceof Date && Number.isFinite(contextValue.now.getTime())
      ? new Date(contextValue.now.getTime())
      : null
    if (
      !currentTime || !entitlementStore ||
      typeof entitlementStore.lockMembershipScheduleInTransaction !== 'function' ||
      typeof entitlementStore.grantMembershipDurationInTransaction !== 'function' ||
      typeof entitlementStore.verifyMembershipGrantInTransaction !== 'function'
    ) {
      throw createStoreError('Payment entitlement service is unavailable.')
    }
    const keys = membershipGrantKeys(orderNo)
    return runTransaction(async (connection) => {
      try {
        await entitlementStore.lockMembershipScheduleInTransaction(connection, userId)
      } catch {
        throw createStoreError('Membership schedule is unavailable.', 'PAYMENT_MEMBERSHIP_SCHEDULE_UNAVAILABLE', 503)
      }
      const lockedOrder = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE}
         WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (!lockedOrder) throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      assertTrustedPaidOrderForEntitlement(lockedOrder, expectedProductId, userId)
      const hasEvidence = await findTrustedWechatQueryPaidEvidenceWithExecutor(
        (sql, values) => connection.execute(sql, values),
        userId,
        orderNo
      )
      if (hasEvidence !== true) {
        throw createStoreError('Paid payment fact is incomplete.', 'PAYMENT_PAID_FACT_INCOMPLETE', 409)
      }

      if (lockedOrder.entitlementStatus === 'granted') {
        if (
          lockedOrder.membershipGrantId === null || lockedOrder.entitlementTransactionId === null ||
          lockedOrder.entitlementGrantedAt === null
        ) {
          throw createStoreError('Payment entitlement data is incomplete.', 'PAYMENT_ENTITLEMENT_INCOMPLETE', 409)
        }
        let membership
        try {
          membership = await entitlementStore.verifyMembershipGrantInTransaction(connection, {
            userId,
            grantId: lockedOrder.membershipGrantId,
            transactionId: lockedOrder.entitlementTransactionId,
            ...keys
          })
        } catch {
          throw createStoreError('Payment entitlement data is incomplete.', 'PAYMENT_ENTITLEMENT_INCOMPLETE', 409)
        }
        return Object.freeze({ order: lockedOrder, membership, idempotent: true })
      }

      if (
        lockedOrder.entitlementStatus !== 'not_ready' || lockedOrder.membershipGrantId !== null ||
        lockedOrder.entitlementTransactionId !== null || lockedOrder.entitlementGrantedAt !== null
      ) {
        throw createStoreError('Payment entitlement cannot be granted.', 'PAYMENT_ENTITLEMENT_NOT_GRANTABLE', 409)
      }
      try {
        transitionEntitlementStatus('not_ready', 'pending', { paymentStatus: 'paid' })
        transitionEntitlementStatus('pending', 'granting', { paymentStatus: 'paid' })
        transitionEntitlementStatus('granting', 'granted', { paymentStatus: 'paid' })
      } catch {
        throw createStoreError('Payment entitlement cannot be granted.', 'PAYMENT_ENTITLEMENT_NOT_GRANTABLE', 409)
      }
      let membership
      try {
        membership = await entitlementStore.grantMembershipDurationInTransaction(connection, {
          userId,
          ...keys,
          operatorType: 'system',
          operatorId: 'virtual-payment-entitlement',
          reason: 'Verified WeChat virtual payment membership grant.',
          now: currentTime
        })
      } catch {
        throw createStoreError('Membership grant failed.', 'PAYMENT_MEMBERSHIP_GRANT_FAILED', 503)
      }
      if (
        !membership || membership.idempotent === true ||
        membership.sourceType !== keys.sourceType || membership.sourceId !== keys.sourceId ||
        !membership.grantId || !membership.transactionId ||
        Date.parse(membership.effectiveEndAt) - Date.parse(membership.effectiveStartAt) !== MEMBERSHIP_GRANT_DURATION_SECONDS * 1000
      ) {
        throw createStoreError('Membership grant result is invalid.', 'PAYMENT_ENTITLEMENT_INCOMPLETE', 409)
      }
      assertAffectedRows(await connection.execute(
        `UPDATE ${ORDERS_TABLE}
         SET entitlement_status = 'granted', membership_grant_id = ?,
             entitlement_transaction_id = ?, entitlement_granted_at = ?, version = version + 1
         WHERE id = ? AND user_id = ? AND order_no = ? AND version = ?
           AND payment_status = 'paid' AND entitlement_status = 'not_ready'
           AND delivery_status = 'not_ready' AND membership_grant_id IS NULL
           AND entitlement_transaction_id IS NULL AND entitlement_granted_at IS NULL`,
        [membership.grantId, membership.transactionId, currentTime, lockedOrder.id, userId, orderNo, lockedOrder.version]
      ))
      const completedOrder = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE}
         WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (
        !completedOrder || completedOrder.entitlementStatus !== 'granted' ||
        completedOrder.membershipGrantId !== String(membership.grantId) ||
        completedOrder.entitlementTransactionId !== membership.transactionId ||
        completedOrder.deliveryStatus !== 'not_ready'
      ) {
        throw createStoreError('Payment entitlement data is incomplete.', 'PAYMENT_ENTITLEMENT_INCOMPLETE', 409)
      }
      return Object.freeze({ order: completedOrder, membership, idempotent: false })
    }, { isolationLevel: 'READ COMMITTED' })
  }

  function assertTrustedGrantedOrderForDelivery(order, expectedProductId, userId) {
    if (
      order.userId !== userId || order.paymentStatus !== 'paid' ||
      order.internalSku !== 'membership_30d' || order.productId !== expectedProductId ||
      order.productName !== '30天学习会员' || order.quantity !== 1 ||
      order.unitPriceFen !== 3000 || order.orderAmountFen !== 3000 || order.paidAmountFen !== 3000 ||
      order.currency !== 'CNY' || order.environment !== 'sandbox' || order.wechatEnv !== 1 ||
      order.paymentChannel !== 'wechat_virtual_payment' || !CLIENT_PLATFORMS.has(order.clientPlatform) ||
      order.providerOrderId === null || order.providerTransactionId === null || order.paidAt === null ||
      order.entitlementStatus !== 'granted' || order.membershipGrantId === null ||
      order.entitlementTransactionId === null || order.entitlementGrantedAt === null ||
      !['not_ready', 'pending', 'confirming', 'delivered', 'retryable_failed', 'manual_review'].includes(order.deliveryStatus) ||
      (order.deliveryStatus === 'delivered') !== (order.deliveredAt !== null)
    ) {
      throw createStoreError('Payment delivery prerequisites are incomplete.', 'PAYMENT_DELIVERY_NOT_READY', 409)
    }
  }

  async function verifyDeliveryPrerequisites(connection, order, expectedProductId, userId) {
    try { await assertDeliverySchema(connection) } catch {
      throw createStoreError('Payment delivery schema mismatch; controlled recovery required.', 'PAYMENT_DELIVERY_SCHEMA_MISMATCH', 503)
    }
    assertTrustedGrantedOrderForDelivery(order, expectedProductId, userId)
    const hasEvidence = await findTrustedWechatQueryPaidEvidenceWithExecutor(
      (sql, values) => connection.execute(sql, values), userId, order.orderNo,
      { includeDeliveryHistory: true }
    )
    if (hasEvidence !== true) {
      throw createStoreError('Paid payment fact is incomplete.', 'PAYMENT_PAID_FACT_INCOMPLETE', 409)
    }
    if (!entitlementStore || typeof entitlementStore.verifyMembershipGrantInTransaction !== 'function') {
      throw createStoreError('Payment entitlement service is unavailable.')
    }
    try {
      await entitlementStore.verifyMembershipGrantInTransaction(connection, {
        userId,
        grantId: order.membershipGrantId,
        transactionId: order.entitlementTransactionId,
        ...membershipGrantKeys(order.orderNo)
      })
    } catch {
      throw createStoreError('Payment entitlement data is incomplete.', 'PAYMENT_ENTITLEMENT_INCOMPLETE', 409)
    }
  }

  function assertDeliveryAttemptHistory(order, userId, attempts, queries) {
    const attemptIds = new Set()
    const operationIds = new Set()
    const leaseOwners = new Set()
    let explicitFailures = 0
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index]
      if (
        attempt.orderId !== order.id || attempt.userId !== userId || attempt.attemptNo !== index + 1 ||
        attemptIds.has(attempt.id) || operationIds.has(attempt.operationId)
      ) {
        throw createStoreError('Payment delivery attempt history is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      attemptIds.add(attempt.id)
      operationIds.add(attempt.operationId)
      if (attempt.leaseOwner !== null) {
        if (leaseOwners.has(attempt.leaseOwner)) {
          throw createStoreError('Payment delivery lease history is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        leaseOwners.add(attempt.leaseOwner)
      }
      const hasLease = attempt.leaseOwner !== null && attempt.leaseExpiresAt !== null
      const noLease = attempt.leaseOwner === null && attempt.leaseExpiresAt === null
      if (
        !['none', 'direct_notify', 'query_confirmation'].includes(attempt.completionSource) ||
        (attempt.status !== 'succeeded' && (attempt.completionSource !== 'none' || attempt.finishedAt !== null)) ||
        (attempt.requestStartedAt !== null && Date.parse(attempt.requestStartedAt) < Date.parse(attempt.claimedAt)) ||
        (attempt.responseReceivedAt !== null && (attempt.requestStartedAt === null ||
          Date.parse(attempt.responseReceivedAt) < Date.parse(attempt.requestStartedAt))) ||
        (attempt.finishedAt !== null && (attempt.requestStartedAt === null ||
          Date.parse(attempt.finishedAt) < Date.parse(attempt.requestStartedAt)))
      ) throw createStoreError('Payment delivery time/source is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      const valid = (
        attempt.status === 'claimed'
          ? attempt.resultKind === 'not_started' && hasLease && attempt.requestStartedAt === null &&
            attempt.responseReceivedAt === null && attempt.providerEventId === null && attempt.lastErrorCode === null
          : attempt.status === 'dispatching'
            ? attempt.resultKind === 'not_started' && hasLease && attempt.requestStartedAt !== null &&
              attempt.responseReceivedAt === null && attempt.providerEventId === null
            : attempt.status === 'explicit_failed'
              ? attempt.resultKind === 'explicit_failure' && noLease && attempt.requestStartedAt !== null &&
                attempt.responseReceivedAt !== null && attempt.providerEventId === null && attempt.lastErrorCode !== null
              : attempt.status === 'confirming' || attempt.status === 'uncertain'
                ? attempt.resultKind === 'uncertain' && noLease && attempt.requestStartedAt !== null &&
                  attempt.lastErrorCode !== null
                : attempt.status === 'succeeded'
                  ? attempt.resultKind === 'success' && noLease && attempt.requestStartedAt !== null &&
                    attempt.finishedAt !== null && attempt.completionSource !== 'none' && attempt.lastErrorCode === null
                  : attempt.status === 'manual_review'
                    ? ['uncertain', 'explicit_failure'].includes(attempt.resultKind) && noLease && attempt.requestStartedAt !== null &&
                      attempt.lastErrorCode !== null
                    : attempt.status === 'superseded' && noLease && attempt.requestStartedAt !== null
      )
      if (!valid) {
        throw createStoreError('Payment delivery attempt state is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      if (attempt.resultKind === 'explicit_failure') explicitFailures += 1
    }
    if (order.retryCount !== explicitFailures) {
      throw createStoreError('Payment delivery retry history is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
    }
    const queryOperations = new Set()
    const querySequences = new Map()
    const appliedByAttempt = new Map()
    const latestProviderByAttempt = new Map()
    for (const query of queries) {
      if (
        query.orderId !== order.id || query.userId !== userId || !attemptIds.has(query.attemptId) ||
        queryOperations.has(query.operationId)
      ) {
        throw createStoreError('Payment delivery query history is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      queryOperations.add(query.operationId)
      const nextSequence = (querySequences.get(query.attemptId) || 0) + 1
      if (query.querySequence !== nextSequence) {
        throw createStoreError('Payment delivery query sequence is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      querySequences.set(query.attemptId, nextSequence)
      const parentAttempt = attempts.find((item) => item.id === query.attemptId)
      if (
        parentAttempt.requestStartedAt === null ||
        Date.parse(query.claimedAt) < Date.parse(parentAttempt.requestStartedAt) ||
        (query.completedAt !== null && Date.parse(query.completedAt) < Date.parse(query.claimedAt))
      ) throw createStoreError('Payment delivery query time is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      if (query.status === 'claimed') {
        if (
          query.completedAt !== null || query.providerEventId !== null || query.observationId !== null ||
          query.claimedOrderVersion !== order.version || query.leaseExpiresAt === null ||
          ['manual_review', 'delivered'].includes(order.deliveryStatus)
        ) {
          throw createStoreError('Payment delivery query claim is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        continue
      }
      if (query.status === 'stale' || query.status === 'failed') {
        if (
          query.completedAt === null || query.leaseExpiresAt !== null ||
          query.providerEventId !== null || query.observationId !== null
        ) {
          throw createStoreError('Payment delivery stale query is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        continue
      }
      if (
        query.status !== 'applied' || query.completedAt === null || query.leaseExpiresAt !== null || query.providerEventId === null ||
        query.observationId === null || query.wechatStatus === null || query.orderType !== 0 ||
        query.observedEnvironment !== 'sandbox' || query.requestEnv !== 1 || query.responseEnvType !== 2 ||
        query.observedCurrency !== 'CNY' || query.observedOrderNo !== order.orderNo ||
        query.observedProviderOrderId !== order.providerOrderId ||
        query.observedProviderTransactionId !== order.providerTransactionId ||
        query.orderAmountFen !== 3000 || query.paidAmountFen !== 3000 ||
        !query.paidAtSeconds || query.paidAtSeconds !== Date.parse(order.paidAt) / 1000 ||
        !query.queriedAtSeconds ||
        query.eventOrderId !== order.id || query.eventOrderNo !== order.orderNo ||
        query.eventProviderOrderId !== order.providerOrderId ||
        query.eventProviderTransactionId !== order.providerTransactionId ||
        query.eventType !== `wechat_delivery_query_status_${query.wechatStatus}` ||
        query.eventProcessingStatus !== 'processed' || !Buffer.isBuffer(query.eventPayloadHash) ||
        query.eventPayloadHash.length !== 32
      ) {
        throw createStoreError('Payment delivery applied query is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      const raw = JSON.stringify({
        source: 'wechat_delivery_query', observationId: query.observationId,
        queryOperationId: query.operationId, querySequence: query.querySequence,
        claimedOrderVersion: query.claimedOrderVersion, userId: query.userId,
        environment: query.observedEnvironment, wechatEnv: query.requestEnv,
        environmentType: query.responseEnvType, currency: query.observedCurrency,
        orderNo: query.observedOrderNo, providerOrderId: query.observedProviderOrderId,
        providerTransactionId: query.observedProviderTransactionId, wechatStatus: query.wechatStatus,
        orderType: query.orderType, orderAmountFen: query.orderAmountFen,
        paidAmountFen: query.paidAmountFen, paidAtSeconds: query.paidAtSeconds,
        providedAtSeconds: query.providedAtSeconds, queriedAtSeconds: query.queriedAtSeconds
      })
      const hash = crypto.createHash('sha256').update(raw, 'utf8').digest()
      if (
        !crypto.timingSafeEqual(hash, query.eventPayloadHash) ||
        query.eventKey !== `wechat_delivery_query:${hash.toString('hex')}`
      ) {
        throw createStoreError('Payment delivery query digest is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      appliedByAttempt.set(query.attemptId, (appliedByAttempt.get(query.attemptId) || 0) + 1)
      latestProviderByAttempt.set(query.attemptId, query.providerEventId)
    }
    for (const attempt of attempts) {
      if (attempt.queryCount !== (appliedByAttempt.get(attempt.id) || 0)) {
        throw createStoreError('Payment delivery query count is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      if (
        attempt.providerEventId !== null &&
        attempt.providerEventId !== latestProviderByAttempt.get(attempt.id)
      ) {
        throw createStoreError('Payment delivery provider event is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      if (attempt.status === 'succeeded') {
        if (attempt.completionSource === 'direct_notify') {
          if (attempt.providerEventId !== null || attempt.responseReceivedAt === null ||
              attempt.finishedAt !== attempt.responseReceivedAt || attempt.queryCount !== 0) {
            throw createStoreError('Payment direct success evidence is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
          }
        } else {
          const successQuery = queries.find((query) => query.providerEventId === attempt.providerEventId && query.attemptId === attempt.id)
          if (!successQuery || successQuery.status !== 'applied' || successQuery.wechatStatus !== 4 ||
              !Number.isSafeInteger(successQuery.providedAtSeconds) || successQuery.providedAtSeconds <= 0 ||
              successQuery.providedAtSeconds * 1000 < Date.parse(attempt.requestStartedAt) ||
              successQuery.providedAtSeconds > successQuery.queriedAtSeconds + 300 ||
              successQuery.queriedAtSeconds * 1000 < Date.parse(successQuery.claimedAt) ||
              successQuery.queriedAtSeconds * 1000 > Date.parse(successQuery.completedAt) ||
              attempt.finishedAt !== successQuery.completedAt) {
            throw createStoreError('Payment query success evidence is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
          }
        }
      }
    }
    const successes = attempts.filter((attempt) => attempt.status === 'succeeded')
    if ((order.deliveryStatus === 'delivered' && successes.length !== 1) ||
        (order.deliveryStatus !== 'delivered' && successes.length !== 0)) {
      throw createStoreError('Payment success history is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
    }
  }

  async function closeActiveDeliveryQueries(connection, orderId, currentTime) {
    const active = getRows(await connection.execute(
      `SELECT id, operation_id FROM ${DELIVERY_QUERIES_TABLE} WHERE order_id = ? AND query_status = 'claimed' FOR UPDATE`, [orderId]
    ))
    for (const query of active) {
      assertAffectedRows(await connection.execute(
        `UPDATE ${DELIVERY_QUERIES_TABLE} SET query_status = 'stale', completed_at = ?, lease_expires_at = NULL
         WHERE id = ? AND operation_id = ? AND query_status = 'claimed'`,
        [currentTime, query.id, query.operation_id]
      ))
    }
  }

  async function listDeliveryAttemptsForUpdate(connection, order, userId) {
    const attempts = normalizeDeliveryAttempts(await connection.execute(
      `SELECT ${DELIVERY_ATTEMPT_COLUMNS} FROM ${DELIVERY_ATTEMPTS_TABLE}
       WHERE order_id = ? ORDER BY attempt_no ASC FOR UPDATE`,
      [order.id]
    ))
    const queries = normalizeDeliveryQueries(await connection.execute(
      `SELECT q.${DELIVERY_QUERY_COLUMNS.split(', ').join(', q.')},
              e.event_key AS linked_event_key, e.event_type AS linked_event_type,
              e.order_id AS linked_event_order_id, e.order_no AS linked_event_order_no,
              e.provider_order_id AS linked_event_provider_order_id,
              e.provider_transaction_id AS linked_event_provider_transaction_id,
              e.payload_hash AS linked_event_payload_hash,
              e.processing_status AS linked_event_processing_status
       FROM ${DELIVERY_QUERIES_TABLE} q
       LEFT JOIN ${EVENTS_TABLE} e ON e.id = q.provider_event_id
       WHERE q.order_id = ? ORDER BY q.attempt_id ASC, q.query_sequence ASC FOR UPDATE`,
      [order.id]
    ))
    assertDeliveryAttemptHistory(order, userId, attempts, queries)
    const active = attempts.filter((attempt) => DELIVERY_ACTIVE_STATUSES.has(attempt.status))
    if (active.length > 1) {
      throw createStoreError('Payment delivery attempts are ambiguous.', 'PAYMENT_DELIVERY_CONFLICT', 409)
    }
    const activeQueries = queries.filter((query) => query.status === 'claimed')
    if (activeQueries.length > 1) {
      throw createStoreError('Payment delivery query claims are ambiguous.', 'PAYMENT_DELIVERY_CONFLICT', 409)
    }
    return {
      attempts, queries, active: active[0] || null,
      activeQuery: activeQueries[0] || null,
      latest: attempts[attempts.length - 1] || null
    }
  }

  async function insertDeliveryAttempt(connection, order, attempts, currentTime) {
    if (attempts.length >= DELIVERY_MAX_NOTIFY_ATTEMPTS) {
      throw createStoreError('Payment delivery retry budget is exhausted.', 'PAYMENT_DELIVERY_MANUAL_REVIEW', 409)
    }
    const operationId = deliveryOperationId()
    const leaseOwner = deliveryOperationId()
    const attemptNo = attempts.length + 1
    const leaseExpiresAt = new Date(currentTime.getTime() + DELIVERY_LEASE_MS)
    assertAffectedRows(await connection.execute(
      `INSERT INTO ${DELIVERY_ATTEMPTS_TABLE} (
         operation_id, order_id, user_id, attempt_no, claimed_order_version, attempt_status, result_kind,
         lease_owner, lease_expires_at, claimed_at
       ) VALUES (?, ?, ?, ?, ?, 'claimed', 'not_started', ?, ?, ?)`,
      [operationId, order.id, order.userId, attemptNo, order.version, leaseOwner, leaseExpiresAt, currentTime]
    ))
    const created = normalizeDeliveryAttempts(await connection.execute(
      `SELECT ${DELIVERY_ATTEMPT_COLUMNS} FROM ${DELIVERY_ATTEMPTS_TABLE}
       WHERE operation_id = ? LIMIT 2 FOR UPDATE`,
      [operationId]
    ))
    if (created.length !== 1) throw createStoreError('Payment delivery attempt was not created.')
    return created[0]
  }

  async function claimDeliveryQuery(connection, order, attemptState, attempt, currentTime) {
    const activeQuery = attemptState.activeQuery
    if (activeQuery && Date.parse(activeQuery.leaseExpiresAt) > currentTime.getTime()) return null
    if (activeQuery) {
      assertAffectedRows(await connection.execute(
        `UPDATE ${DELIVERY_QUERIES_TABLE}
         SET query_status = 'stale', completed_at = ?, lease_expires_at = NULL
         WHERE id = ? AND operation_id = ? AND query_status = 'claimed'`,
        [currentTime, activeQuery.id, activeQuery.operationId]
      ))
    }
    const operationId = deliveryOperationId()
    const previous = attemptState.queries.filter((query) => query.attemptId === attempt.id)
    const querySequence = previous.length + 1
    const leaseExpiresAt = new Date(currentTime.getTime() + DELIVERY_LEASE_MS)
    assertAffectedRows(await connection.execute(
      `INSERT INTO ${DELIVERY_QUERIES_TABLE} (
         operation_id, order_id, user_id, attempt_id, query_sequence,
         claimed_order_version, query_status, claimed_at, lease_expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'claimed', ?, ?)`,
      [operationId, order.id, order.userId, attempt.id, querySequence,
        order.version, currentTime, leaseExpiresAt]
    ))
    return Object.freeze({
      operationId, querySequence, claimedOrderVersion: order.version,
      attemptId: attempt.id, leaseExpiresAt: leaseExpiresAt.toISOString()
    })
  }

  async function claimDeliveryWork(userIdValue, orderNoValue, contextValue = {}) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const expectedProductId = requireString(contextValue.expectedProductId)
    const currentTime = deliveryTimestamp(contextValue.now)
    return runTransaction(async (connection) => {
      const order = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE}
         WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (!order) throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      await verifyDeliveryPrerequisites(connection, order, expectedProductId, userId)
      const attemptState = await listDeliveryAttemptsForUpdate(connection, order, userId)

      if (order.deliveryStatus === 'delivered') {
        if (!attemptState.latest || attemptState.latest.status !== 'succeeded') {
          throw createStoreError('Payment delivery completion is incomplete.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        return Object.freeze({ order, action: 'delivered', attempt: null, idempotent: true })
      }
      if (order.deliveryStatus === 'manual_review') {
        return Object.freeze({ order, action: 'manual_review', attempt: null, idempotent: true })
      }
      if (order.deliveryStatus === 'not_ready') {
        if (attemptState.attempts.length !== 0) {
          throw createStoreError('Payment delivery attempts conflict with order state.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        const attempt = await insertDeliveryAttempt(connection, order, attemptState.attempts, currentTime)
        assertAffectedRows(await connection.execute(
          `UPDATE ${ORDERS_TABLE}
           SET delivery_status = 'pending', next_retry_at = NULL, last_error_code = NULL, version = version + 1
           WHERE id = ? AND user_id = ? AND order_no = ? AND version = ?
             AND payment_status = 'paid' AND entitlement_status = 'granted'
             AND delivery_status = 'not_ready' AND delivered_at IS NULL`,
          [order.id, userId, orderNo, order.version]
        ))
        return Object.freeze({ order: { ...order, deliveryStatus: 'pending' }, action: 'notify', attempt, idempotent: false })
      }

      if (order.deliveryStatus === 'pending') {
        const active = attemptState.active
        if (!active) throw createStoreError('Payment delivery attempt is missing.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        if (active.status === 'claimed' && active.requestStartedAt === null) {
          if (Date.parse(active.leaseExpiresAt) <= currentTime.getTime()) {
            const leaseOwner = deliveryOperationId()
            const leaseExpiresAt = new Date(currentTime.getTime() + DELIVERY_LEASE_MS)
            assertAffectedRows(await connection.execute(
              `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
               SET lease_owner = ?, lease_expires_at = ?
               WHERE id = ? AND operation_id = ? AND attempt_status = 'claimed' AND request_started_at IS NULL`,
              [leaseOwner, leaseExpiresAt, active.id, active.operationId]
            ))
            return Object.freeze({
              order, action: 'notify',
              attempt: Object.freeze({ ...active, leaseOwner, leaseExpiresAt: leaseExpiresAt.toISOString() }),
              idempotent: true
            })
          }
          return Object.freeze({ order, action: 'wait', attempt: null, idempotent: true })
        }
        if (active.status === 'dispatching') {
          if (Date.parse(active.leaseExpiresAt) > currentTime.getTime()) {
            return Object.freeze({ order, action: 'wait', attempt: null, idempotent: true })
          }
          const nextActionAt = new Date(currentTime.getTime() + DELIVERY_BACKOFF_MS)
          assertAffectedRows(await connection.execute(
            `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
             SET attempt_status = 'confirming', result_kind = 'uncertain', next_action_at = ?,
                 lease_owner = NULL, lease_expires_at = NULL,
                 last_error_code = 'DELIVERY_DISPATCH_INTERRUPTED'
             WHERE id = ? AND operation_id = ? AND attempt_status = 'dispatching'`,
            [nextActionAt, active.id, active.operationId]
          ))
          assertAffectedRows(await connection.execute(
            `UPDATE ${ORDERS_TABLE}
             SET delivery_status = 'confirming', next_retry_at = ?,
                 last_error_code = 'DELIVERY_DISPATCH_INTERRUPTED', version = version + 1
             WHERE id = ? AND version = ? AND delivery_status = 'pending'`,
            [nextActionAt, order.id, order.version]
          ))
          return Object.freeze({ order: { ...order, deliveryStatus: 'confirming' }, action: 'wait', attempt: null, idempotent: true })
        }
        throw createStoreError('Payment delivery attempt conflicts with order state.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }

      if (order.deliveryStatus === 'confirming') {
        const active = attemptState.active
        if (!active || !['uncertain', 'confirming'].includes(active.status)) {
          throw createStoreError('Payment delivery confirmation attempt is missing.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        const windowExpired = currentTime.getTime() - Date.parse(active.requestStartedAt || active.createdAt) >= DELIVERY_CONFIRM_WINDOW_MS
        if (active.queryCount >= DELIVERY_MAX_CONFIRM_QUERIES || windowExpired) {
          await closeActiveDeliveryQueries(connection, order.id, currentTime)
          assertAffectedRows(await connection.execute(
            `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
             SET attempt_status = 'manual_review', next_action_at = NULL, last_error_code = 'DELIVERY_CONFIRMATION_EXHAUSTED'
             WHERE id = ? AND operation_id = ? AND attempt_status IN ('uncertain', 'confirming')`,
            [active.id, active.operationId]
          ))
          assertAffectedRows(await connection.execute(
            `UPDATE ${ORDERS_TABLE}
             SET delivery_status = 'manual_review', next_retry_at = NULL,
                 last_error_code = 'DELIVERY_CONFIRMATION_EXHAUSTED', version = version + 1
             WHERE id = ? AND version = ? AND delivery_status = 'confirming'`,
            [order.id, order.version]
          ))
          return Object.freeze({ order: { ...order, deliveryStatus: 'manual_review' }, action: 'manual_review', attempt: null, idempotent: true })
        }
        if (active.nextActionAt && Date.parse(active.nextActionAt) > currentTime.getTime()) {
          return Object.freeze({ order, action: 'wait', attempt: null, idempotent: true })
        }
        const query = await claimDeliveryQuery(connection, order, attemptState, active, currentTime)
        if (!query) return Object.freeze({ order, action: 'wait', attempt: null, idempotent: true })
        return Object.freeze({ order, action: 'query', attempt: active, query, idempotent: true })
      }

      if (order.deliveryStatus === 'retryable_failed') {
        if (attemptState.active || !attemptState.latest || attemptState.latest.status !== 'explicit_failed') {
          throw createStoreError('Payment delivery retry facts are incomplete.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        if (order.retryCount >= DELIVERY_MAX_NOTIFY_ATTEMPTS) {
          await closeActiveDeliveryQueries(connection, order.id, currentTime)
          assertAffectedRows(await connection.execute(
            `UPDATE ${ORDERS_TABLE}
             SET delivery_status = 'manual_review', next_retry_at = NULL,
                 last_error_code = 'DELIVERY_RETRY_EXHAUSTED', version = version + 1
             WHERE id = ? AND version = ? AND delivery_status = 'retryable_failed'`,
            [order.id, order.version]
          ))
          return Object.freeze({ order: { ...order, deliveryStatus: 'manual_review' }, action: 'manual_review', attempt: null, idempotent: true })
        }
        if (order.nextRetryAt && Date.parse(order.nextRetryAt) > currentTime.getTime()) {
          return Object.freeze({ order, action: 'wait', attempt: null, idempotent: true })
        }
        const query = await claimDeliveryQuery(connection, order, attemptState, attemptState.latest, currentTime)
        if (!query) return Object.freeze({ order, action: 'wait', attempt: null, idempotent: true })
        return Object.freeze({ order, action: 'query', attempt: attemptState.latest, query, idempotent: true })
      }
      throw createStoreError('Payment delivery state is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
    }, { isolationLevel: 'READ COMMITTED' })
  }

  async function markDeliveryDispatching(userIdValue, orderNoValue, operationIdValue, contextValue = {}) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const operationId = requireString(operationIdValue, 64)
    const currentTime = deliveryTimestamp(contextValue.now)
    const expectedProductId = requireString(contextValue.expectedProductId)
    return runTransaction(async (connection) => {
      const order = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE} WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (!order) throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      await verifyDeliveryPrerequisites(connection, order, expectedProductId, userId)
      const attemptState = await listDeliveryAttemptsForUpdate(connection, order, userId)
      const attempt = attemptState.attempts.find((item) => item.operationId === operationId)
      if (
        !attempt || attempt !== attemptState.active || attempt.status !== 'claimed' ||
        attempt.requestStartedAt !== null || attempt.attemptNo !== attemptState.attempts.length ||
        attempt.claimedOrderVersion + 1 !== order.version || currentTime.getTime() < Date.parse(attempt.claimedAt) || order.deliveryStatus !== 'pending' ||
        order.paymentStatus !== 'paid' || order.entitlementStatus !== 'granted'
      ) {
        throw createStoreError('Payment delivery attempt cannot be dispatched.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      assertAffectedRows(await connection.execute(
        `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
         SET attempt_status = 'dispatching', request_started_at = ?, lease_expires_at = ?
         WHERE id = ? AND operation_id = ? AND attempt_status = 'claimed' AND request_started_at IS NULL`,
        [currentTime, new Date(currentTime.getTime() + DELIVERY_LEASE_MS), attempt.id, operationId]
      ))
      return Object.freeze({ operationId })
    }, { isolationLevel: 'READ COMMITTED' })
  }

  async function finishDeliveryNotify(userIdValue, orderNoValue, operationIdValue, resultValue = {}) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const operationId = requireString(operationIdValue, 64)
    const currentTime = deliveryTimestamp(resultValue.now)
    const kind = resultValue.kind
    if (!['success', 'uncertain'].includes(kind)) {
      throw createStoreError('Payment delivery result is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
    }
    const errorCode = kind === 'success' ? null : safeDeliveryErrorCode(resultValue.errorCode)
    return runTransaction(async (connection) => {
      const order = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE} WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (!order) throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      const attemptState = await listDeliveryAttemptsForUpdate(connection, order, userId)
      const attempt = attemptState.attempts.find((item) => item.operationId === operationId)
      if (!attempt || attempt !== attemptState.active || attempt.status !== 'dispatching' || order.deliveryStatus !== 'pending') {
        throw createStoreError('Payment delivery result is stale.', 'PAYMENT_DELIVERY_STALE_RESULT', 409)
      }
      if (currentTime.getTime() < Date.parse(attempt.requestStartedAt)) {
        throw createStoreError('Payment delivery result time is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      if (kind === 'success') {
        await closeActiveDeliveryQueries(connection, order.id, currentTime)
        assertAffectedRows(await connection.execute(
          `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
           SET attempt_status = 'succeeded', result_kind = 'success', response_received_at = ?,
               completion_source = 'direct_notify', finished_at = ?,
               lease_owner = NULL, lease_expires_at = NULL, next_action_at = NULL, last_error_code = NULL
           WHERE id = ? AND operation_id = ? AND attempt_status = 'dispatching'`,
          [currentTime, currentTime, attempt.id, operationId]
        ))
        assertAffectedRows(await connection.execute(
          `UPDATE ${ORDERS_TABLE}
           SET delivery_status = 'delivered', delivered_at = ?, next_retry_at = NULL,
               last_error_code = NULL, version = version + 1
           WHERE id = ? AND user_id = ? AND version = ? AND payment_status = 'paid'
             AND entitlement_status = 'granted' AND delivery_status = 'pending' AND delivered_at IS NULL`,
          [currentTime, order.id, userId, order.version]
        ))
        return Object.freeze({ deliveryStatus: 'delivered', idempotent: false })
      }
      const nextActionAt = new Date(currentTime.getTime() + DELIVERY_BACKOFF_MS)
      if (kind === 'explicit_failure') {
        assertAffectedRows(await connection.execute(
          `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
           SET attempt_status = 'explicit_failed', result_kind = 'explicit_failure', response_received_at = ?,
               lease_owner = NULL, lease_expires_at = NULL, next_action_at = ?, last_error_code = ?
           WHERE id = ? AND operation_id = ? AND attempt_status = 'dispatching'`,
          [currentTime, nextActionAt, errorCode, attempt.id, operationId]
        ))
        assertAffectedRows(await connection.execute(
          `UPDATE ${ORDERS_TABLE}
           SET delivery_status = 'retryable_failed', retry_count = retry_count + 1,
               next_retry_at = ?, last_error_code = ?, version = version + 1
           WHERE id = ? AND version = ? AND delivery_status = 'pending'`,
          [nextActionAt, errorCode, order.id, order.version]
        ))
        return Object.freeze({ deliveryStatus: 'retryable_failed', idempotent: false })
      }
      assertAffectedRows(await connection.execute(
        `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
         SET attempt_status = 'confirming', result_kind = 'uncertain', response_received_at = ?,
             lease_owner = NULL, lease_expires_at = NULL, next_action_at = ?, last_error_code = ?
         WHERE id = ? AND operation_id = ? AND attempt_status = 'dispatching'`,
        [currentTime, nextActionAt, errorCode, attempt.id, operationId]
      ))
      assertAffectedRows(await connection.execute(
        `UPDATE ${ORDERS_TABLE}
         SET delivery_status = 'confirming', next_retry_at = ?, last_error_code = ?, version = version + 1
         WHERE id = ? AND version = ? AND delivery_status = 'pending'`,
        [nextActionAt, errorCode, order.id, order.version]
      ))
      return Object.freeze({ deliveryStatus: 'confirming', idempotent: false })
    }, { isolationLevel: 'READ COMMITTED' })
  }

  async function applyDeliveryQueryFact(userIdValue, orderNoValue, factValue, contextValue = {}) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const expectedProductId = requireString(contextValue.expectedProductId)
    const currentTime = deliveryTimestamp(contextValue.now)
    const fact = normalizeDeliveryQueryFact(factValue)
    if (fact.orderNo !== orderNo) throw createStoreError('Payment delivery query fact is invalid.', 'PAYMENT_DELIVERY_QUERY_INVALID', 502)
    return runTransaction(async (connection) => {
      const order = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE} WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (!order) throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      const attemptState = await listDeliveryAttemptsForUpdate(connection, order, userId)
      const query = attemptState.queries.find((item) => item.operationId === fact.queryOperationId)
      if (
        !query || query !== attemptState.activeQuery || query.status !== 'claimed' ||
        query.querySequence !== fact.querySequence ||
        query.claimedOrderVersion !== fact.claimedOrderVersion ||
        query.claimedOrderVersion !== order.version ||
        !['confirming', 'retryable_failed'].includes(order.deliveryStatus)
      ) {
        return Object.freeze({ deliveryStatus: order.deliveryStatus, action: 'stale', attempt: null, idempotent: true })
      }
      await verifyDeliveryPrerequisites(connection, order, expectedProductId, userId)
      const targetAttempt = attemptState.attempts.find((attempt) => attempt.id === query.attemptId)
      if (
        !targetAttempt || !['confirming', 'uncertain', 'explicit_failed'].includes(targetAttempt.status) ||
        fact.userId !== userId || fact.orderNo !== order.orderNo || fact.providerOrderId !== order.providerOrderId ||
        fact.providerTransactionId !== order.providerTransactionId ||
        fact.paidAtSeconds !== Date.parse(order.paidAt) / 1000
      ) {
        throw createStoreError('Payment delivery query conflicts with the order.', 'PAYMENT_DELIVERY_QUERY_INVALID', 502)
      }
      const [eventInsert] = await connection.execute(
        `INSERT INTO ${EVENTS_TABLE} (
           event_key, event_type, order_id, order_no, provider_order_id,
           provider_transaction_id, payload_hash, processing_status,
           received_count, processed_at, attempt_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processed', 1, ?, 1)`,
        [fact.eventKey, fact.eventType, order.id, order.orderNo, fact.providerOrderId,
          fact.providerTransactionId, fact.payloadHash, currentTime]
      )
      if (!eventInsert || !eventInsert.insertId) throw createStoreError('Payment delivery query event was not stored.')
      const providerEventId = String(eventInsert.insertId)
      if (currentTime.getTime() < Date.parse(query.claimedAt) || fact.queriedAtSeconds * 1000 < Date.parse(query.claimedAt) ||
          fact.queriedAtSeconds * 1000 > currentTime.getTime()) {
        throw createStoreError('Payment query observation time is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
      }
      assertAffectedRows(await connection.execute(
        `UPDATE ${DELIVERY_QUERIES_TABLE}
         SET query_status = 'applied', completed_at = ?, lease_expires_at = NULL, provider_event_id = ?,
             observed_environment = ?, request_env = ?, response_env_type = ?, observed_currency = ?,
             observed_order_no = ?, observed_provider_order_id = ?, observed_provider_transaction_id = ?,
             observation_id = ?, wechat_status = ?, order_type = ?, order_amount_fen = ?,
             paid_amount_fen = ?, paid_at_seconds = ?, provided_at_seconds = ?, queried_at_seconds = ?
         WHERE id = ? AND operation_id = ? AND query_sequence = ?
           AND claimed_order_version = ? AND query_status = 'claimed'`,
        [currentTime, providerEventId, fact.environment, fact.wechatEnv, fact.environmentType, fact.currency,
          fact.orderNo, fact.providerOrderId, fact.providerTransactionId,
          fact.observationId, fact.wechatStatus, fact.orderType,
          fact.orderAmountFen, fact.paidAmountFen, fact.paidAtSeconds,
          fact.providedAtSeconds, fact.queriedAtSeconds, query.id,
          query.operationId, query.querySequence, query.claimedOrderVersion]
      ))

      // Close any remaining active operations before any branch advances the order.
      await closeActiveDeliveryQueries(connection, order.id, currentTime)
      if (fact.wechatStatus === 4 && fact.providedAt !== null) {
        if (targetAttempt.resultKind !== 'uncertain' || fact.providedAt.getTime() < Date.parse(targetAttempt.requestStartedAt)) {
          throw createStoreError('Payment query success evidence is invalid.', 'PAYMENT_DELIVERY_CONFLICT', 409)
        }
        assertAffectedRows(await connection.execute(
          `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
           SET attempt_status = 'succeeded', result_kind = 'success', query_count = query_count + 1,
               completion_source = 'query_confirmation', finished_at = ?,
               provider_event_id = ?, lease_owner = NULL, lease_expires_at = NULL,
               next_action_at = NULL, last_error_code = NULL
           WHERE id = ? AND operation_id = ? AND attempt_status IN ('confirming', 'uncertain', 'explicit_failed')`,
          [currentTime, providerEventId, targetAttempt.id, targetAttempt.operationId]
        ))
        assertAffectedRows(await connection.execute(
          `UPDATE ${ORDERS_TABLE}
           SET delivery_status = 'delivered', delivered_at = ?, last_queried_at = ?,
               next_retry_at = NULL, last_error_code = NULL, version = version + 1
           WHERE id = ? AND version = ? AND delivery_status IN ('confirming', 'retryable_failed')
             AND payment_status = 'paid' AND entitlement_status = 'granted' AND delivered_at IS NULL`,
          [fact.providedAt, currentTime, order.id, order.version]
        ))
        return Object.freeze({ deliveryStatus: 'delivered', action: 'delivered', attempt: null, idempotent: false })
      }

      if (fact.wechatStatus === 2 && order.deliveryStatus === 'retryable_failed') {
        assertAffectedRows(await connection.execute(
          `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
           SET attempt_status = 'manual_review', query_count = query_count + 1,
               provider_event_id = ?, lease_owner = NULL, lease_expires_at = NULL,
               next_action_at = NULL, last_error_code = 'DELIVERY_EXPLICIT_ALLOWLIST_EMPTY'
           WHERE id = ? AND operation_id = ? AND attempt_status = 'explicit_failed'`,
          [providerEventId, targetAttempt.id, targetAttempt.operationId]
        ))
        assertAffectedRows(await connection.execute(
          `UPDATE ${ORDERS_TABLE}
           SET delivery_status = 'manual_review', last_queried_at = ?, next_retry_at = NULL,
               last_error_code = 'DELIVERY_EXPLICIT_ALLOWLIST_EMPTY', version = version + 1
           WHERE id = ? AND version = ? AND delivery_status = 'retryable_failed'
             AND payment_status = 'paid' AND entitlement_status = 'granted'`,
          [currentTime, order.id, order.version]
        ))
        return Object.freeze({ deliveryStatus: 'manual_review', action: 'manual_review', attempt: null, idempotent: false })
      }

      if ([2, 3].includes(fact.wechatStatus) && order.deliveryStatus === 'confirming') {
        const nextQueryCount = targetAttempt.queryCount + 1
        const nextActionAt = new Date(currentTime.getTime() + DELIVERY_BACKOFF_MS)
        const manualReview = (
          nextQueryCount >= DELIVERY_MAX_CONFIRM_QUERIES ||
          currentTime.getTime() - Date.parse(targetAttempt.requestStartedAt || targetAttempt.createdAt) >= DELIVERY_CONFIRM_WINDOW_MS
        )
        const nextAttemptStatus = manualReview ? 'manual_review' : 'confirming'
        assertAffectedRows(await connection.execute(
          `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
           SET attempt_status = ?, query_count = query_count + 1, provider_event_id = ?,
               next_action_at = ?, last_error_code = ?
           WHERE id = ? AND operation_id = ? AND attempt_status IN ('confirming', 'uncertain')`,
          [nextAttemptStatus, providerEventId, manualReview ? null : nextActionAt,
            manualReview ? 'DELIVERY_CONFIRMATION_EXHAUSTED' : targetAttempt.lastErrorCode,
            targetAttempt.id, targetAttempt.operationId]
        ))
        assertAffectedRows(await connection.execute(
          `UPDATE ${ORDERS_TABLE}
           SET delivery_status = ?, last_queried_at = ?, next_retry_at = ?,
               last_error_code = ?, version = version + 1
           WHERE id = ? AND version = ? AND delivery_status = 'confirming'`,
          [manualReview ? 'manual_review' : 'confirming', currentTime,
            manualReview ? null : nextActionAt,
            manualReview ? 'DELIVERY_CONFIRMATION_EXHAUSTED' : null, order.id, order.version]
        ))
        return Object.freeze({
          deliveryStatus: manualReview ? 'manual_review' : 'confirming',
          action: manualReview ? 'manual_review' : 'wait', attempt: null, idempotent: false
        })
      }

      if (targetAttempt) {
        assertAffectedRows(await connection.execute(
          `UPDATE ${DELIVERY_ATTEMPTS_TABLE}
           SET attempt_status = 'manual_review', query_count = query_count + 1,
               provider_event_id = ?, lease_owner = NULL, lease_expires_at = NULL, next_action_at = NULL,
               last_error_code = 'DELIVERY_QUERY_REQUIRES_REVIEW'
           WHERE id = ? AND operation_id = ? AND attempt_status IN ('confirming', 'uncertain', 'explicit_failed')`,
          [providerEventId, targetAttempt.id, targetAttempt.operationId]
        ))
      }
      assertAffectedRows(await connection.execute(
        `UPDATE ${ORDERS_TABLE}
         SET delivery_status = 'manual_review', last_queried_at = ?, next_retry_at = NULL,
             last_error_code = 'DELIVERY_QUERY_REQUIRES_REVIEW', version = version + 1
         WHERE id = ? AND version = ? AND delivery_status IN ('confirming', 'retryable_failed')`,
        [currentTime, order.id, order.version]
      ))
      return Object.freeze({ deliveryStatus: 'manual_review', action: 'manual_review', attempt: null, idempotent: false })
    }, { isolationLevel: 'READ COMMITTED' })
  }

  async function createOrder(input) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !CREATE_ORDER_FIELDS.has(key))
    ) {
      throw createStoreError('Payment order input is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
    }
    const userId = normalizeUserId(input.userId)
    const clientRequestId = normalizeVirtualPaymentClientRequestId(input.clientRequestId)
    const productId = requireString(input.productId)
    const clientPlatform = requireString(input.clientPlatform, 32)
    if (
      input.internalSku !== 'membership_30d' ||
      input.productName !== '30天学习会员' ||
      input.quantity !== 1 ||
      input.unitPriceFen !== 3000 ||
      input.orderAmountFen !== 3000 ||
      input.currency !== 'CNY' ||
      input.environment !== 'sandbox' ||
      input.wechatEnv !== 1 ||
      input.paymentChannel !== 'wechat_virtual_payment' ||
      !CLIENT_PLATFORMS.has(clientPlatform)
    ) {
      throw createStoreError('Payment order input is invalid.', 'PAYMENT_REQUEST_INVALID', 400)
    }
    for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      let orderNo
      try {
        orderNo = normalizeOrderNo(orderNoFactory())
      } catch {
        throw createStoreError('Payment order number generation failed.', 'PAYMENT_ORDER_CREATE_FAILED', 503)
      }
      try {
        await execute(
          `INSERT INTO ${ORDERS_TABLE} (
            order_no, user_id, client_request_id, internal_sku, product_id, product_name,
            quantity, unit_price_fen, order_amount_fen, currency, environment, wechat_env,
            payment_channel, client_platform, payment_status, entitlement_status, delivery_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initializing', 'not_ready', 'not_ready')`,
          [
            orderNo,
            userId,
            clientRequestId,
            input.internalSku,
            productId,
            input.productName,
            input.quantity,
            input.unitPriceFen,
            input.orderAmountFen,
            input.currency,
            input.environment,
            input.wechatEnv,
            input.paymentChannel,
            clientPlatform
          ],
          { classifyExpectedDuplicate: true }
        )
        const created = await findByUserAndOrderNo(userId, orderNo)
        if (!created) throw createStoreError('Payment order was not created.', 'PAYMENT_ORDER_CREATE_FAILED')
        return Object.freeze({ order: created, idempotent: false })
      } catch (error) {
        if (
          error instanceof ExpectedDuplicateConstraint &&
          error.constraintName === 'uk_virtual_payment_orders_user_request'
        ) {
          const existing = await findByUserAndClientRequestId(userId, clientRequestId)
          if (!existing) throw createStoreError('Payment order conflict could not be resolved.', 'PAYMENT_ORDER_CONFLICT', 409)
          assertIdempotentOrderMatchesInput(existing, input, userId, clientRequestId, productId)
          return Object.freeze({ order: existing, idempotent: true })
        }
        if (
          error instanceof ExpectedDuplicateConstraint &&
          error.constraintName === 'uk_virtual_payment_orders_order_no'
        ) continue
        throw error
      }
    }
    throw createStoreError('Payment order number generation failed.', 'PAYMENT_ORDER_CREATE_FAILED', 503)
  }

  async function markOrderPending(userIdValue, orderNoValue) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const result = await execute(
      `UPDATE ${ORDERS_TABLE}
       SET payment_status = 'pending', version = version + 1
       WHERE user_id = ? AND order_no = ? AND payment_status = 'initializing'
         AND entitlement_status = 'not_ready' AND delivery_status = 'not_ready'`,
      [userId, orderNo]
    )
    const affectedRows = result && result[0] && result[0].affectedRows
    if (typeof affectedRows !== 'number' || !Number.isSafeInteger(affectedRows) || affectedRows < 0 || affectedRows > 1) {
      throw createStoreError('Payment order update response is invalid.')
    }
    const order = await findByUserAndOrderNo(userId, orderNo)
    if (!order) throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
    if (order.paymentStatus !== 'pending') {
      throw createStoreError('Payment order is not payable.', 'PAYMENT_ORDER_NOT_PAYABLE', 409)
    }
    return order
  }

  async function reconcileVerifiedWechatQuery(userIdValue, orderNoValue, factValue, contextValue) {
    const userId = normalizeUserId(userIdValue)
    const orderNo = normalizeOrderNo(orderNoValue)
    const fact = normalizeReconciliationFact(factValue)
    if (fact.orderNo !== orderNo) {
      throw createStoreError('Payment reconciliation fact is invalid.', 'PAYMENT_QUERY_RESULT_INVALID', 502)
    }
    const context = normalizeTrustedReconciliationContext(contextValue)
    const eventType = `wechat_query_status_${fact.wechatStatus}_${fact.targetPaymentStatus}`
    return runTransaction(async (connection) => {
      const lockedOrder = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE}
         WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (!lockedOrder) {
        throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      }
      if (lockedOrder.productId !== context.expectedProductId) {
        throw createStoreError('Payment order conflicts with current configuration.', 'PAYMENT_ORDER_CONFLICT', 409)
      }
      if (
        lockedOrder.entitlementStatus !== 'not_ready' ||
        lockedOrder.deliveryStatus !== 'not_ready' ||
        lockedOrder.membershipGrantId !== null ||
        lockedOrder.entitlementTransactionId !== null
      ) {
        throw createStoreError('Payment order cannot be reconciled.', 'PAYMENT_ORDER_NOT_RECONCILABLE', 409)
      }
      const currentStatus = lockedOrder.paymentStatus
      const targetStatus = fact.targetPaymentStatus
      const sameTerminalFact = (
        (currentStatus === 'paid' && targetStatus === 'paid') ||
        (currentStatus === 'closed' && targetStatus === 'closed')
      )
      if (!['pending', 'confirming'].includes(currentStatus) && !sameTerminalFact) {
        throw createStoreError('Payment order cannot be reconciled.', 'PAYMENT_ORDER_NOT_RECONCILABLE', 409)
      }
      let transition
      try {
        transition = transitionPaymentStatus(currentStatus, targetStatus, {
          source: PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY
        })
      } catch {
        throw createStoreError('Payment order cannot be reconciled.', 'PAYMENT_ORDER_NOT_RECONCILABLE', 409)
      }
      if (
        (lockedOrder.providerOrderId !== null && lockedOrder.providerOrderId !== fact.providerOrderId) ||
        (lockedOrder.providerTransactionId !== null && lockedOrder.providerTransactionId !== fact.providerTransactionId) ||
        (lockedOrder.paidAmountFen !== null && lockedOrder.paidAmountFen !== fact.paidAmountFen) ||
        (lockedOrder.paidAt !== null && fact.paidAt !== null && lockedOrder.paidAt !== fact.paidAt.toISOString()) ||
        (lockedOrder.paidAt !== null && fact.paidAt === null)
      ) {
        throw createStoreError('Payment reconciliation conflicts with stored facts.', 'PAYMENT_ORDER_CONFLICT', 409)
      }

      const eventRows = getRows(await connection.execute(
        `SELECT id, event_type, order_id, order_no, provider_order_id,
                provider_transaction_id, payload_hash, processing_status, received_count
         FROM ${EVENTS_TABLE} WHERE event_key = ? LIMIT 2 FOR UPDATE`,
        [fact.eventKey]
      ))
      if (eventRows.length > 1) {
        throw createStoreError('Payment event data is ambiguous.', 'PAYMENT_ORDER_CONFLICT', 409)
      }
      const existingEvent = eventRows[0] || null
      let eventDuplicate = false
      if (existingEvent) {
        const payloadHash = existingEvent.payload_hash
        if (
          normalizeBigIntId(existingEvent.order_id) !== lockedOrder.id ||
          existingEvent.event_type !== eventType ||
          existingEvent.order_no !== lockedOrder.orderNo ||
          existingEvent.provider_order_id !== fact.providerOrderId ||
          existingEvent.provider_transaction_id !== fact.providerTransactionId ||
          existingEvent.processing_status !== 'processed' ||
          !Buffer.isBuffer(payloadHash) ||
          payloadHash.length !== 32 ||
          !crypto.timingSafeEqual(payloadHash, fact.payloadHash) ||
          typeof existingEvent.received_count !== 'number' ||
          !Number.isSafeInteger(existingEvent.received_count) ||
          existingEvent.received_count < 1 ||
          existingEvent.received_count >= MAX_UNSIGNED_INT
        ) {
          throw createStoreError('Payment event conflicts with stored facts.', 'PAYMENT_ORDER_CONFLICT', 409)
        }
        assertAffectedRows(await connection.execute(
          `UPDATE ${EVENTS_TABLE}
           SET received_count = received_count + 1
           WHERE id = ? AND event_key = ? AND processing_status = 'processed'`,
          [normalizeBigIntId(existingEvent.id), fact.eventKey]
        ))
        eventDuplicate = true
      } else {
        assertAffectedRows(await connection.execute(
          `INSERT INTO ${EVENTS_TABLE} (
             event_key, event_type, order_id, order_no, provider_order_id,
             provider_transaction_id, payload_hash, processing_status,
             received_count, processed_at, attempt_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processed', 1, UTC_TIMESTAMP(), 1)`,
          [
            fact.eventKey,
            eventType,
            lockedOrder.id,
            lockedOrder.orderNo,
            fact.providerOrderId,
            fact.providerTransactionId,
            fact.payloadHash
          ]
        ))
      }

      const shouldUpdateOrder = !transition.idempotent ||
        lockedOrder.providerOrderId === null ||
        (fact.providerTransactionId !== null && lockedOrder.providerTransactionId === null) ||
        (fact.paidAmountFen !== null && lockedOrder.paidAmountFen === null) ||
        (fact.paidAt !== null && lockedOrder.paidAt === null)
      if (shouldUpdateOrder) {
        assertAffectedRows(await connection.execute(
          `UPDATE ${ORDERS_TABLE}
           SET payment_status = ?,
               provider_order_id = COALESCE(provider_order_id, ?),
               provider_transaction_id = COALESCE(provider_transaction_id, ?),
               paid_amount_fen = COALESCE(paid_amount_fen, ?),
               paid_at = COALESCE(paid_at, ?),
               last_queried_at = UTC_TIMESTAMP(),
               last_error_code = NULL,
               version = version + 1
           WHERE id = ? AND user_id = ? AND order_no = ? AND version = ?
             AND payment_status = ?
             AND entitlement_status = 'not_ready' AND delivery_status = 'not_ready'
             AND membership_grant_id IS NULL AND entitlement_transaction_id IS NULL`,
          [
            targetStatus,
            fact.providerOrderId,
            fact.providerTransactionId,
            fact.paidAmountFen,
            fact.paidAt,
            lockedOrder.id,
            userId,
            orderNo,
            lockedOrder.version,
            currentStatus
          ]
        ))
      }
      const reconciledOrder = normalizeSingleOrder(await connection.execute(
        `SELECT ${SELECT_COLUMNS} FROM ${ORDERS_TABLE}
         WHERE user_id = ? AND order_no = ? LIMIT 2 FOR UPDATE`,
        [userId, orderNo]
      ))
      if (!reconciledOrder) {
        throw createStoreError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      }
      return Object.freeze({
        order: reconciledOrder,
        eventDuplicate,
        stateChanged: shouldUpdateOrder
      })
    })
  }

  return Object.freeze({
    findByUserAndClientRequestId,
    findByUserAndOrderNo,
    findTrustedWechatQueryPaidEvidence,
    createOrder,
    markOrderPending,
    reconcileVerifiedWechatQuery,
    grantTrustedPaidOrderEntitlement,
    claimDeliveryWork,
    markDeliveryDispatching,
    finishDeliveryNotify,
    applyDeliveryQueryFact
  })
}
