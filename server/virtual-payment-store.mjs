import crypto from 'node:crypto'
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

  async function findTrustedWechatQueryPaidEvidenceWithExecutor(executor, userId, orderNo) {
    const rows = getRows(await executor(
      `SELECT e.event_key, e.event_type, e.order_id, e.order_no,
              e.provider_order_id, e.provider_transaction_id, e.payload_hash,
              e.processing_status, e.received_count, e.processed_at,
              e.attempt_count, e.last_error_code,
              o.id AS linked_order_id, o.order_no AS linked_order_no,
              o.provider_order_id AS linked_provider_order_id,
              o.provider_transaction_id AS linked_provider_transaction_id,
              o.order_amount_fen, o.paid_amount_fen, o.paid_at,
              o.environment, o.wechat_env
       FROM ${EVENTS_TABLE} e
       INNER JOIN ${ORDERS_TABLE} o
         ON o.id = e.order_id OR o.order_no = e.order_no
       WHERE o.user_id = ? AND o.order_no = ? AND o.payment_status = 'paid'
       LIMIT ${MAX_WECHAT_QUERY_EVENT_HISTORY + 1}`,
      [userId, orderNo]
    ))
    if (rows.length > MAX_WECHAT_QUERY_EVENT_HISTORY) {
      throw createStoreError('Payment event data is ambiguous.', 'PAYMENT_ORDER_CONFLICT', 409)
    }
    let hasPaidEvidence = false
    for (const row of rows) {
      if (normalizeTrustedWechatQueryPaidEvidenceRow(row)) hasPaidEvidence = true
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
    grantTrustedPaidOrderEntitlement
  })
}
