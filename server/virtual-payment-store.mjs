import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

import { assertVirtualPaymentState } from './virtual-payment-state.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const ORDERS_TABLE = 'virtual_payment_orders'
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

  return Object.freeze({
    findByUserAndClientRequestId,
    findByUserAndOrderNo,
    createOrder,
    markOrderPending
  })
}
