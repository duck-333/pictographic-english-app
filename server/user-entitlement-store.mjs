import crypto from 'crypto'
import mysql from 'mysql2/promise'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const USER_ENTITLEMENTS_TABLE = 'user_entitlements'
const ENTITLEMENT_TRANSACTIONS_TABLE = 'entitlement_transactions'
const MAX_ID_LENGTH = 191
const MAX_SOURCE_LENGTH = 64
const MAX_TRANSACTION_TYPE_LENGTH = 64
const MAX_OPERATOR_TYPE_LENGTH = 32
const MAX_REASON_LENGTH = 512
const REGISTRATION_BONUS_QUOTA = 30
const REGISTRATION_BONUS_VALID_YEARS = 1
const REGISTRATION_BONUS_SOURCE = 'registration'
const REGISTRATION_BONUS_OPERATOR_ID = 'auth-registration'

export const ENTITLEMENT_TRANSACTION_TYPES = Object.freeze({
  REGISTER_BONUS: 'REGISTER_BONUS',
  CONTENT_ACCESS: 'CONTENT_ACCESS',
  SHARE_REWARD: 'SHARE_REWARD',
  ADMIN_GRANT: 'ADMIN_GRANT',
  ADMIN_DEDUCT: 'ADMIN_DEDUCT',
  TAOBAO_BOOK_MEMBERSHIP_GRANT: 'TAOBAO_BOOK_MEMBERSHIP_GRANT',
  MEMBERSHIP_ACTIVATED: 'MEMBERSHIP_ACTIVATED',
  REFUND_RESTORE: 'REFUND_RESTORE',
  EXPIRE_DEDUCT: 'EXPIRE_DEDUCT'
})

export const ENTITLEMENT_REASONS = Object.freeze({
  MEMBERSHIP_ACTIVE: 'membership_active',
  QUOTA_CONSUMED: 'quota_consumed',
  QUOTA_INSUFFICIENT: 'quota_insufficient'
})

const QUOTA_GRANT_TRANSACTION_TYPE_VALUES = [
  ENTITLEMENT_TRANSACTION_TYPES.REGISTER_BONUS,
  ENTITLEMENT_TRANSACTION_TYPES.SHARE_REWARD,
  ENTITLEMENT_TRANSACTION_TYPES.ADMIN_GRANT
]

const QUOTA_GRANT_TRANSACTION_TYPES = new Set(QUOTA_GRANT_TRANSACTION_TYPE_VALUES)

const MEMBERSHIP_TRANSACTION_TYPES = new Set([
  ENTITLEMENT_TRANSACTION_TYPES.TAOBAO_BOOK_MEMBERSHIP_GRANT,
  ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_ACTIVATED
])

const CONTENT_ACCESS_TRANSACTION_TYPES = new Set([
  ENTITLEMENT_TRANSACTION_TYPES.CONTENT_ACCESS
])

const QUOTA_DEDUCT_TRANSACTION_TYPES = new Set([
  ENTITLEMENT_TRANSACTION_TYPES.ADMIN_DEDUCT
])

const QUOTA_GRANT_SOURCE_TO_TRANSACTION_TYPE = new Map([
  ['registration', ENTITLEMENT_TRANSACTION_TYPES.REGISTER_BONUS],
  ['register', ENTITLEMENT_TRANSACTION_TYPES.REGISTER_BONUS],
  ['share', ENTITLEMENT_TRANSACTION_TYPES.SHARE_REWARD],
  ['admin', ENTITLEMENT_TRANSACTION_TYPES.ADMIN_GRANT]
])

const MEMBERSHIP_SOURCE_TO_TRANSACTION_TYPE = new Map([
  ['taobao_book', ENTITLEMENT_TRANSACTION_TYPES.TAOBAO_BOOK_MEMBERSHIP_GRANT],
  ['admin', ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_ACTIVATED],
  ['order', ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_ACTIVATED],
  ['payment', ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_ACTIVATED]
])

function normalizeString(value) {
  return String(value || '').trim()
}

function createUserEntitlementStoreError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_ENTITLEMENT_STORE_ERROR'
  error.statusCode = Number(options.statusCode || 500)
  return error
}

function isDuplicateEntryError(error) {
  return Boolean(error && error.code === 'ER_DUP_ENTRY')
}

function getRegistrationBonusIdempotencyKey(userId) {
  return `registration_bonus:${userId}`
}

function getRegistrationBonusExpiresAt(currentTime) {
  const expiresAt = new Date(currentTime.getTime())
  expiresAt.setFullYear(expiresAt.getFullYear() + REGISTRATION_BONUS_VALID_YEARS)
  return expiresAt
}

function getDbConfig(options = {}) {
  const host = normalizeString(options.dbHost === undefined ? process.env.DB_HOST : options.dbHost) || DEFAULT_DB_HOST
  const port = Number(options.dbPort === undefined ? process.env.DB_PORT : options.dbPort) || DEFAULT_DB_PORT
  const database = normalizeString(options.dbName === undefined ? process.env.DB_NAME : options.dbName) || DEFAULT_DB_NAME
  const user = normalizeString(options.dbUser === undefined ? process.env.DB_USER : options.dbUser)
  const configuredPassword = options.dbPassword === undefined ? process.env.DB_PASSWORD : options.dbPassword
  const password = String(configuredPassword || '')

  return {
    host,
    port,
    database,
    user,
    password,
    configured: Boolean(database && user && password)
  }
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``
}

function normalizeRequiredString(value, fieldName, code, options = {}) {
  const normalizedValue = normalizeString(value)
  if (!normalizedValue) {
    throw createUserEntitlementStoreError(`${fieldName} is required.`, {
      code,
      statusCode: 400
    })
  }
  const maxLength = Number(options.maxLength || 0)
  if (maxLength > 0 && normalizedValue.length > maxLength) {
    throw createUserEntitlementStoreError(`${fieldName} is invalid.`, {
      code: `${code}_INVALID`,
      statusCode: 400
    })
  }
  return normalizedValue
}

function normalizeOptionalString(value, fieldName, code, options = {}) {
  const normalizedValue = normalizeString(value)
  if (!normalizedValue) return null
  const maxLength = Number(options.maxLength || 0)
  if (maxLength > 0 && normalizedValue.length > maxLength) {
    throw createUserEntitlementStoreError(`${fieldName} is invalid.`, {
      code: `${code}_INVALID`,
      statusCode: 400
    })
  }
  return normalizedValue
}

function normalizeUserId(userId) {
  return normalizeRequiredString(userId, 'User id', 'USER_ID_REQUIRED', {
    maxLength: MAX_ID_LENGTH
  })
}

function normalizeIdempotencyKey(idempotencyKey) {
  return normalizeRequiredString(idempotencyKey, 'Idempotency key', 'IDEMPOTENCY_KEY_REQUIRED', {
    maxLength: MAX_ID_LENGTH
  })
}

function normalizeTransactionId(transactionId) {
  return normalizeOptionalString(transactionId, 'Transaction id', 'TRANSACTION_ID', {
    maxLength: 64
  }) || generateTransactionId()
}

function normalizeSource(source) {
  return normalizeRequiredString(source, 'Source', 'ENTITLEMENT_SOURCE_REQUIRED', {
    maxLength: MAX_SOURCE_LENGTH
  })
}

function normalizeSourceId(sourceId) {
  return normalizeOptionalString(sourceId, 'Source id', 'ENTITLEMENT_SOURCE_ID', {
    maxLength: MAX_ID_LENGTH
  })
}

function normalizeOperatorType(operatorType) {
  const normalizedOperatorType = normalizeString(operatorType) || 'system'
  if (normalizedOperatorType.length > MAX_OPERATOR_TYPE_LENGTH) {
    throw createUserEntitlementStoreError('Operator type is invalid.', {
      code: 'OPERATOR_TYPE_INVALID',
      statusCode: 400
    })
  }
  return normalizedOperatorType
}

function normalizeOperatorId(operatorId) {
  return normalizeOptionalString(operatorId, 'Operator id', 'OPERATOR_ID', {
    maxLength: MAX_ID_LENGTH
  })
}

function normalizeReason(reason) {
  return normalizeOptionalString(reason, 'Reason', 'ENTITLEMENT_REASON', {
    maxLength: MAX_REASON_LENGTH
  })
}

function normalizeLearningObjectId(value, fieldName, code) {
  return normalizeRequiredString(value, fieldName, code, {
    maxLength: MAX_ID_LENGTH
  })
}

function normalizePositiveInteger(value, fieldName, code) {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw createUserEntitlementStoreError(`${fieldName} must be a positive integer.`, {
      code,
      statusCode: 400
    })
  }
  return amount
}

function normalizeNonNegativeInteger(value, fieldName, code, options = {}) {
  const fallback = Number(options.fallback || 0)
  const amount = value === undefined || value === null || value === '' ? fallback : Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw createUserEntitlementStoreError(`${fieldName} must be a non-negative integer.`, {
      code,
      statusCode: 400
    })
  }
  return amount
}

function normalizeTransactionType(value, allowedTypes, source, sourceMap, code) {
  const explicitValue = normalizeString(value).toUpperCase()
  const mappedValue = sourceMap.get(normalizeString(source).toLowerCase()) || ''
  const transactionType = explicitValue || mappedValue
  if (!transactionType || !allowedTypes.has(transactionType)) {
    throw createUserEntitlementStoreError('Entitlement transaction type is invalid.', {
      code,
      statusCode: 400
    })
  }
  if (transactionType.length > MAX_TRANSACTION_TYPE_LENGTH) {
    throw createUserEntitlementStoreError('Entitlement transaction type is invalid.', {
      code,
      statusCode: 400
    })
  }
  return transactionType
}

function normalizeDate(value, fieldName, code, options = {}) {
  if ((value === undefined || value === null || value === '') && options.optional) return null

  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw createUserEntitlementStoreError(`${fieldName} is invalid.`, {
      code,
      statusCode: 400
    })
  }
  return date
}

function formatDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }

  const text = normalizeString(value)
  if (!text) return null

  const parsed = new Date(text)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text
}

function toInteger(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function safeParseJson(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

function normalizeJson(value, fieldName, code) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createUserEntitlementStoreError(`${fieldName} must be an object.`, {
      code,
      statusCode: 400
    })
  }
  return JSON.stringify(value)
}

function normalizeJsonObject(value, fieldName, code) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createUserEntitlementStoreError(`${fieldName} must be an object.`, {
      code,
      statusCode: 400
    })
  }
  return { ...value }
}

function generateTransactionId() {
  return `ent_${Date.now()}_${crypto.randomUUID()}`
}

function getExpireDeductIdempotencyKey(userId, grantTransactionId) {
  const digest = crypto.createHash('sha256').update(`${userId}:${grantTransactionId}`).digest('hex').slice(0, 48)
  return `expire_deduct:${digest}`
}

function mapEntitlementRow(row) {
  if (!row) return null
  return {
    id: row.id === undefined || row.id === null ? null : String(row.id),
    userId: normalizeString(row.user_id),
    quotaBalance: toInteger(row.quota_balance),
    quotaTotalGranted: toInteger(row.quota_total_granted),
    quotaTotalConsumed: toInteger(row.quota_total_consumed),
    quotaTotalExpired: toInteger(row.quota_total_expired),
    membershipType: normalizeString(row.membership_type) || 'none',
    membershipStatus: normalizeString(row.membership_status) || 'none',
    membershipStartedAt: formatDate(row.membership_started_at),
    membershipExpireAt: formatDate(row.membership_expire_at),
    lastTransactionId: row.last_transaction_id === undefined || row.last_transaction_id === null ? null : String(row.last_transaction_id),
    createdAt: formatDate(row.created_at),
    updatedAt: formatDate(row.updated_at)
  }
}

function mapTransactionRow(row) {
  if (!row) return null
  return {
    id: row.id === undefined || row.id === null ? null : String(row.id),
    transactionId: normalizeString(row.transaction_id),
    userId: normalizeString(row.user_id),
    transactionType: normalizeString(row.transaction_type),
    amount: toInteger(row.amount),
    balanceAfter: toInteger(row.balance_after),
    source: normalizeString(row.source),
    sourceId: row.source_id === undefined || row.source_id === null ? null : String(row.source_id),
    expiresAt: formatDate(row.expires_at),
    grantTransactionId: row.grant_transaction_id === undefined || row.grant_transaction_id === null ? null : String(row.grant_transaction_id),
    rootLearningObjectId: row.root_learning_object_id === undefined || row.root_learning_object_id === null ? null : String(row.root_learning_object_id),
    currentLearningObjectId: row.current_learning_object_id === undefined || row.current_learning_object_id === null ? null : String(row.current_learning_object_id),
    accessContext: safeParseJson(row.access_context_json),
    idempotencyKey: normalizeString(row.idempotency_key),
    operatorType: normalizeString(row.operator_type),
    operatorId: row.operator_id === undefined || row.operator_id === null ? null : String(row.operator_id),
    reason: row.reason === undefined || row.reason === null ? null : String(row.reason),
    metadata: safeParseJson(row.metadata_json),
    createdAt: formatDate(row.created_at)
  }
}

function isMembershipActive(entitlement, now) {
  if (!entitlement) return false
  if (entitlement.membershipStatus !== 'active') return false
  const expireAt = entitlement.membershipExpireAt ? new Date(entitlement.membershipExpireAt) : null
  return Boolean(expireAt && Number.isFinite(expireAt.getTime()) && expireAt.getTime() > now.getTime())
}

function getMembershipDurationMilliseconds(startedAt, expireAt) {
  const durationMilliseconds = expireAt.getTime() - startedAt.getTime()
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds <= 0) {
    throw createUserEntitlementStoreError('Membership duration is invalid.', {
      code: 'MEMBERSHIP_DURATION_INVALID',
      statusCode: 400
    })
  }
  return durationMilliseconds
}

function getEffectiveMembershipPeriod(entitlement, currentTime, durationMilliseconds) {
  const currentExpireAt = entitlement && entitlement.membershipExpireAt
    ? new Date(entitlement.membershipExpireAt)
    : null
  const existingMembershipStartedAt = entitlement && entitlement.membershipStartedAt
    ? new Date(entitlement.membershipStartedAt)
    : null
  const hasActiveMembership =
    entitlement &&
    entitlement.membershipStatus === 'active' &&
    currentExpireAt &&
    Number.isFinite(currentExpireAt.getTime()) &&
    currentExpireAt.getTime() > currentTime.getTime()
  const grantBaseAt = hasActiveMembership ? currentExpireAt : currentTime
  const membershipStartedAt =
    hasActiveMembership &&
    existingMembershipStartedAt &&
    Number.isFinite(existingMembershipStartedAt.getTime())
      ? existingMembershipStartedAt
      : currentTime

  return {
    membershipStartedAt,
    membershipExpireAt: new Date(grantBaseAt.getTime() + durationMilliseconds),
    grantBaseAt,
    extendedFromExisting: Boolean(hasActiveMembership)
  }
}

function buildMembershipMetadata(input, startedAt, expireAt, options = {}) {
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? { ...input.metadata }
    : {}
  metadata.membershipType = input.membershipType
  metadata.membershipStartedAt = startedAt.toISOString()
  metadata.membershipExpireAt = expireAt.toISOString()
  if (options.requestedStartedAt) metadata.requestedMembershipStartedAt = options.requestedStartedAt.toISOString()
  if (options.requestedExpireAt) metadata.requestedMembershipExpireAt = options.requestedExpireAt.toISOString()
  if (options.grantBaseAt) metadata.membershipGrantBaseAt = options.grantBaseAt.toISOString()
  if (options.durationMilliseconds) metadata.membershipDurationMilliseconds = options.durationMilliseconds
  metadata.membershipExtendedFromExisting = Boolean(options.extendedFromExisting)
  return metadata
}

export function createUserEntitlementStore(options = {}) {
  let pool = options.pool || null
  const now = options.now || (() => new Date())

  function getPool() {
    if (pool) return pool

    const dbConfig = getDbConfig(options)
    if (!dbConfig.configured) {
      throw createUserEntitlementStoreError('User entitlement database is not configured.', {
        code: 'USER_ENTITLEMENT_DB_CONFIG_MISSING',
        statusCode: 503
      })
    }

    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      waitForConnections: true,
      connectionLimit: Number(options.dbConnectionLimit || process.env.DB_CONNECTION_LIMIT || 5),
      namedPlaceholders: false
    })
    return pool
  }

  async function findUserEntitlement(connection, userId, options = {}) {
    const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
    const [rows] = await connection.execute(
      `SELECT id, user_id, quota_balance, quota_total_granted, quota_total_consumed, quota_total_expired,
              membership_type, membership_status, membership_started_at, membership_expire_at,
              last_transaction_id, created_at, updated_at
         FROM ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
        WHERE user_id = ?
        LIMIT 1${lockClause}`,
      [userId]
    )
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    return mapEntitlementRow(row)
  }

  async function findTransactionByIdempotencyKey(connection, idempotencyKey) {
    const [rows] = await connection.execute(
      `SELECT id, transaction_id, user_id, transaction_type, amount, balance_after, source, source_id,
              expires_at, grant_transaction_id, root_learning_object_id, current_learning_object_id,
              access_context_json, idempotency_key, operator_type, operator_id, reason, metadata_json, created_at
         FROM ${quoteIdentifier(ENTITLEMENT_TRANSACTIONS_TABLE)}
        WHERE idempotency_key = ?
        LIMIT 1`,
      [idempotencyKey]
    )
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    return mapTransactionRow(row)
  }

  async function listUserTransactions(userId, options = {}) {
    const normalizedUserId = normalizeUserId(userId)
    const limit = Math.min(
      normalizeNonNegativeInteger(options.limit, 'Transaction list limit', 'TRANSACTION_LIST_LIMIT_INVALID', {
        fallback: 50
      }) || 50,
      100
    )
    const offset = normalizeNonNegativeInteger(options.offset, 'Transaction list offset', 'TRANSACTION_LIST_OFFSET_INVALID')
    const transactionType = normalizeString(options.transactionType).toUpperCase()
    const params = [normalizedUserId]
    let typeClause = ''
    if (transactionType) {
      typeClause = ' AND transaction_type = ?'
      params.push(transactionType)
    }

    const connection = await getPool().getConnection()
    try {
      const [rows] = await connection.execute(
        `SELECT id, transaction_id, user_id, transaction_type, amount, balance_after, source, source_id,
                expires_at, grant_transaction_id, root_learning_object_id, current_learning_object_id,
                access_context_json, idempotency_key, operator_type, operator_id, reason, metadata_json, created_at
           FROM ${quoteIdentifier(ENTITLEMENT_TRANSACTIONS_TABLE)}
          WHERE user_id = ?${typeClause}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit} OFFSET ${offset}`,
        params
      )
      return (Array.isArray(rows) ? rows : []).map((row) => mapTransactionRow(row)).filter(Boolean)
    } finally {
      connection.release()
    }
  }

  async function listQuotaGrantSources(connection, userId, currentTime, options = {}) {
    const expiryOperator = options.expired ? '<=' : '>'
    const [grantRows] = await connection.execute(
      `SELECT id, transaction_id, transaction_type, amount, expires_at, created_at
         FROM ${quoteIdentifier(ENTITLEMENT_TRANSACTIONS_TABLE)}
        WHERE user_id = ?
          AND transaction_type IN (?, ?, ?)
          AND amount > 0
          AND expires_at ${expiryOperator} ?
        ORDER BY expires_at ASC, id ASC
        FOR UPDATE`,
      [userId, ...QUOTA_GRANT_TRANSACTION_TYPE_VALUES, currentTime]
    )
    const grants = (Array.isArray(grantRows) ? grantRows : []).map((row) => ({
      id: String(row.id),
      transactionId: normalizeString(row.transaction_id),
      transactionType: normalizeString(row.transaction_type),
      amount: toInteger(row.amount),
      expiresAt: formatDate(row.expires_at),
      createdAt: formatDate(row.created_at)
    }))
    if (!grants.length) return []

    const placeholders = grants.map(() => '?').join(', ')
    const [consumedRows] = await connection.execute(
      `SELECT grant_transaction_id, COALESCE(SUM(-amount), 0) AS consumed_amount
         FROM ${quoteIdentifier(ENTITLEMENT_TRANSACTIONS_TABLE)}
        WHERE user_id = ?
          AND grant_transaction_id IN (${placeholders})
          AND amount < 0
        GROUP BY grant_transaction_id`,
      [userId, ...grants.map((grant) => grant.id)]
    )
    const consumedByGrantId = new Map()
    ;(Array.isArray(consumedRows) ? consumedRows : []).forEach((row) => {
      if (row && row.grant_transaction_id !== undefined && row.grant_transaction_id !== null) {
        consumedByGrantId.set(String(row.grant_transaction_id), toInteger(row.consumed_amount))
      }
    })

    return grants
      .map((grant) => {
        const consumedAmount = consumedByGrantId.get(grant.id) || 0
        return {
          ...grant,
          consumedAmount,
          remainingAmount: Math.max(0, grant.amount - consumedAmount)
        }
      })
      .filter((grant) => grant.remainingAmount > 0)
  }

  function allocateQuotaSources(sources, amount) {
    let remainingAmount = amount
    const allocations = []
    for (const source of sources) {
      if (remainingAmount <= 0) break
      const consumedAmount = Math.min(source.remainingAmount, remainingAmount)
      if (consumedAmount <= 0) continue
      allocations.push({
        grantTransactionId: source.id,
        grantBusinessTransactionId: source.transactionId,
        transactionType: source.transactionType,
        amount: consumedAmount,
        expiresAt: source.expiresAt
      })
      remainingAmount -= consumedAmount
    }
    return {
      allocations,
      allocatedAmount: amount - remainingAmount,
      availableAmount: sources.reduce((sum, source) => sum + source.remainingAmount, 0)
    }
  }

  async function expireQuotaGrantSources(connection, userId, entitlement, currentTime) {
    const expiredSources = await listQuotaGrantSources(connection, userId, currentTime, {
      expired: true
    })
    if (!expiredSources.length || entitlement.quotaBalance <= 0) return entitlement

    let balanceAfter = entitlement.quotaBalance
    let totalExpired = 0
    let lastTransactionId = entitlement.lastTransactionId

    for (const source of expiredSources) {
      if (balanceAfter <= 0) break
      const expireAmount = Math.min(source.remainingAmount, balanceAfter)
      if (expireAmount <= 0) continue

      const idempotencyKey = getExpireDeductIdempotencyKey(userId, source.id)
      const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      if (existingTransaction) continue

      balanceAfter -= expireAmount
      totalExpired += expireAmount
      lastTransactionId = await insertTransaction(connection, {
        transactionId: generateTransactionId(),
        userId,
        transactionType: ENTITLEMENT_TRANSACTION_TYPES.EXPIRE_DEDUCT,
        amount: -expireAmount,
        balanceAfter,
        source: 'quota_expiry',
        sourceId: source.transactionId,
        expiresAt: null,
        grantTransactionId: source.id,
        idempotencyKey,
        operatorType: 'system',
        operatorId: null,
        reason: 'Quota grant expired.',
        metadataJson: normalizeJson({
          expiredGrantTransactionId: source.id,
          expiredGrantBusinessTransactionId: source.transactionId,
          expiredGrantTransactionType: source.transactionType,
          expiredAt: currentTime.toISOString(),
          grantExpiresAt: source.expiresAt
        }, 'Metadata', 'METADATA_INVALID')
      })
    }

    if (totalExpired <= 0) return entitlement

    await connection.execute(
      `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
          SET quota_balance = ?,
              quota_total_expired = quota_total_expired + ?,
              last_transaction_id = ?
        WHERE user_id = ?`,
      [balanceAfter, totalExpired, lastTransactionId, userId]
    )

    return await findUserEntitlement(connection, userId, {
      forUpdate: true
    })
  }

  async function ensureUserEntitlementInTransaction(connection, userId) {
    await connection.execute(
      `INSERT INTO ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)} (user_id)
       VALUES (?)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [userId]
    )
    return await findUserEntitlement(connection, userId, {
      forUpdate: true
    })
  }

  async function insertTransaction(connection, transaction) {
    const [result] = await connection.execute(
      `INSERT INTO ${quoteIdentifier(ENTITLEMENT_TRANSACTIONS_TABLE)}
        (transaction_id, user_id, transaction_type, amount, balance_after, source, source_id,
         expires_at, grant_transaction_id, root_learning_object_id, current_learning_object_id,
         access_context_json, idempotency_key, operator_type, operator_id, reason, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transaction.transactionId,
        transaction.userId,
        transaction.transactionType,
        transaction.amount,
        transaction.balanceAfter,
        transaction.source,
        transaction.sourceId,
        transaction.expiresAt,
        transaction.grantTransactionId || null,
        transaction.rootLearningObjectId || null,
        transaction.currentLearningObjectId || null,
        transaction.accessContextJson || null,
        transaction.idempotencyKey,
        transaction.operatorType,
        transaction.operatorId,
        transaction.reason,
        transaction.metadataJson || null
      ]
    )
    return result && result.insertId ? String(result.insertId) : null
  }

  async function getEntitlementAndTransactionAfterDuplicate(connection, idempotencyKey) {
    const transaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
    const entitlement = transaction ? await findUserEntitlement(connection, transaction.userId) : null
    return {
      transaction,
      entitlement
    }
  }

  function assertIdempotentTransaction(transaction, allowedTypes, userId) {
    if (!transaction || !allowedTypes.has(transaction.transactionType)) {
      throw createUserEntitlementStoreError('Idempotency key is already used by another entitlement operation.', {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        statusCode: 409
      })
    }
    if (transaction.userId !== String(userId)) {
      throw createUserEntitlementStoreError('Idempotency key is already used by another user.', {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        statusCode: 409
      })
    }
  }

  async function getUserEntitlement(userId) {
    const normalizedUserId = normalizeUserId(userId)
    const connection = await getPool().getConnection()
    try {
      return await findUserEntitlement(connection, normalizedUserId)
    } finally {
      connection.release()
    }
  }

  async function ensureUserEntitlement(userId) {
    const normalizedUserId = normalizeUserId(userId)
    const connection = await getPool().getConnection()
    try {
      await connection.beginTransaction()
      const entitlement = await ensureUserEntitlementInTransaction(connection, normalizedUserId)
      await connection.commit()
      return entitlement
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async function grantQuota(input = {}) {
    const userId = normalizeUserId(input.userId)
    const amount = normalizePositiveInteger(input.amount, 'Quota grant amount', 'QUOTA_GRANT_AMOUNT_INVALID')
    const source = normalizeSource(input.source)
    const transactionType = normalizeTransactionType(
      input.transactionType,
      QUOTA_GRANT_TRANSACTION_TYPES,
      source,
      QUOTA_GRANT_SOURCE_TO_TRANSACTION_TYPE,
      'QUOTA_GRANT_TRANSACTION_TYPE_INVALID'
    )
    const sourceId = normalizeSourceId(input.sourceId)
    const expiresAt = normalizeDate(input.expiresAt, 'Quota grant expiry time', 'QUOTA_GRANT_EXPIRES_AT_INVALID')
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const operatorType = normalizeOperatorType(input.operatorType)
    const operatorId = normalizeOperatorId(input.operatorId)
    const reason = normalizeReason(input.reason)
    const metadataJson = normalizeJson(input.metadata, 'Metadata', 'METADATA_INVALID')

    const connection = await getPool().getConnection()
    try {
      await connection.beginTransaction()

      const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      if (existingTransaction) {
        assertIdempotentTransaction(existingTransaction, QUOTA_GRANT_TRANSACTION_TYPES, userId)
        await connection.commit()
        return {
          granted: false,
          idempotent: true,
          transaction: existingTransaction,
          entitlement: await findUserEntitlement(connection, userId)
        }
      }

      const entitlement = await ensureUserEntitlementInTransaction(connection, userId)
      const balanceAfter = entitlement.quotaBalance + amount
      const transactionId = normalizeTransactionId(input.transactionId)
      const transactionInsertId = await insertTransaction(connection, {
        transactionId,
        userId,
        transactionType,
        amount,
        balanceAfter,
        source,
        sourceId,
        expiresAt,
        idempotencyKey,
        operatorType,
        operatorId,
        reason,
        metadataJson
      })

      await connection.execute(
        `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
            SET quota_balance = ?,
                quota_total_granted = quota_total_granted + ?,
                last_transaction_id = ?
          WHERE user_id = ?`,
        [balanceAfter, amount, transactionInsertId, userId]
      )

      const updatedEntitlement = await findUserEntitlement(connection, userId)
      const transaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      await connection.commit()
      return {
        granted: true,
        idempotent: false,
        transaction,
        entitlement: updatedEntitlement
      }
    } catch (error) {
      await connection.rollback()
      if (isDuplicateEntryError(error)) {
        const existing = await getEntitlementAndTransactionAfterDuplicate(connection, idempotencyKey)
        assertIdempotentTransaction(existing.transaction, QUOTA_GRANT_TRANSACTION_TYPES, userId)
        return {
          granted: false,
          idempotent: true,
          transaction: existing.transaction,
          entitlement: existing.entitlement
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  async function deductQuota(input = {}) {
    const userId = normalizeUserId(input.userId)
    const amount = normalizePositiveInteger(input.amount, 'Quota deduct amount', 'QUOTA_DEDUCT_AMOUNT_INVALID')
    const source = normalizeSource(input.source)
    const sourceId = normalizeSourceId(input.sourceId)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const operatorType = normalizeOperatorType(input.operatorType)
    const operatorId = normalizeOperatorId(input.operatorId)
    const reason = normalizeReason(input.reason)
    const metadata = normalizeJsonObject(input.metadata, 'Metadata', 'METADATA_INVALID')

    const connection = await getPool().getConnection()
    try {
      await connection.beginTransaction()

      const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      if (existingTransaction) {
        assertIdempotentTransaction(existingTransaction, QUOTA_DEDUCT_TRANSACTION_TYPES, userId)
        await connection.commit()
        return {
          deducted: false,
          idempotent: true,
          transaction: existingTransaction,
          entitlement: await findUserEntitlement(connection, userId)
        }
      }

      let entitlement = await ensureUserEntitlementInTransaction(connection, userId)
      const currentTime = now()
      entitlement = await expireQuotaGrantSources(connection, userId, entitlement, currentTime)
      if (entitlement.quotaBalance < amount) {
        throw createUserEntitlementStoreError('Quota balance is not enough for admin deduction.', {
          code: 'QUOTA_NOT_ENOUGH',
          statusCode: 400
        })
      }

      const quotaSources = await listQuotaGrantSources(connection, userId, currentTime)
      const allocationResult = allocateQuotaSources(quotaSources, amount)
      if (allocationResult.allocatedAmount < amount) {
        throw createUserEntitlementStoreError('Quota grant sources are not enough for admin deduction.', {
          code: 'QUOTA_SOURCE_NOT_ENOUGH',
          statusCode: 409
        })
      }

      const balanceAfter = entitlement.quotaBalance - amount
      const transactionId = normalizeTransactionId(input.transactionId)
      const grantTransactionId = allocationResult.allocations[0].grantTransactionId
      const metadataJson = normalizeJson({
        ...(metadata || {}),
        quotaDeductStrategy: 'FIFO_BY_EXPIRES_AT',
        deductedAllocations: allocationResult.allocations
      }, 'Metadata', 'METADATA_INVALID')
      const transactionInsertId = await insertTransaction(connection, {
        transactionId,
        userId,
        transactionType: ENTITLEMENT_TRANSACTION_TYPES.ADMIN_DEDUCT,
        amount: -amount,
        balanceAfter,
        source,
        sourceId,
        expiresAt: null,
        grantTransactionId,
        idempotencyKey,
        operatorType,
        operatorId,
        reason,
        metadataJson
      })

      await connection.execute(
        `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
            SET quota_balance = ?,
                last_transaction_id = ?
          WHERE user_id = ?`,
        [balanceAfter, transactionInsertId, userId]
      )

      const updatedEntitlement = await findUserEntitlement(connection, userId)
      const transaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      await connection.commit()
      return {
        deducted: true,
        idempotent: false,
        transaction,
        entitlement: updatedEntitlement
      }
    } catch (error) {
      await connection.rollback()
      if (isDuplicateEntryError(error)) {
        const existing = await getEntitlementAndTransactionAfterDuplicate(connection, idempotencyKey)
        assertIdempotentTransaction(existing.transaction, QUOTA_DEDUCT_TRANSACTION_TYPES, userId)
        return {
          deducted: false,
          idempotent: true,
          transaction: existing.transaction,
          entitlement: existing.entitlement
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  async function ensureRegistrationBonus(userId) {
    const normalizedUserId = normalizeUserId(userId)
    return await grantQuota({
      userId: normalizedUserId,
      transactionType: ENTITLEMENT_TRANSACTION_TYPES.REGISTER_BONUS,
      amount: REGISTRATION_BONUS_QUOTA,
      source: REGISTRATION_BONUS_SOURCE,
      sourceId: normalizedUserId,
      expiresAt: getRegistrationBonusExpiresAt(now()),
      idempotencyKey: getRegistrationBonusIdempotencyKey(normalizedUserId),
      operatorType: 'system',
      operatorId: REGISTRATION_BONUS_OPERATOR_ID,
      reason: 'Registration bonus complete-content access quota.'
    })
  }

  async function grantMembership(input = {}) {
    const userId = normalizeUserId(input.userId)
    const membershipType = normalizeRequiredString(input.membershipType, 'Membership type', 'MEMBERSHIP_TYPE_REQUIRED', {
      maxLength: 32
    })
    const requestedExpireAt = normalizeDate(input.expireAt, 'Membership expiry time', 'MEMBERSHIP_EXPIRE_AT_INVALID')
    const requestedStartedAt = normalizeDate(input.startedAt || now(), 'Membership start time', 'MEMBERSHIP_STARTED_AT_INVALID')
    const durationMilliseconds = getMembershipDurationMilliseconds(requestedStartedAt, requestedExpireAt)
    const source = normalizeSource(input.source)
    const transactionType = normalizeTransactionType(
      input.transactionType,
      MEMBERSHIP_TRANSACTION_TYPES,
      source,
      MEMBERSHIP_SOURCE_TO_TRANSACTION_TYPE,
      'MEMBERSHIP_TRANSACTION_TYPE_INVALID'
    )
    const sourceId = normalizeSourceId(input.sourceId)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const operatorType = normalizeOperatorType(input.operatorType)
    const operatorId = normalizeOperatorId(input.operatorId)
    const reason = normalizeReason(input.reason)

    const connection = await getPool().getConnection()
    try {
      await connection.beginTransaction()

      const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      if (existingTransaction) {
        assertIdempotentTransaction(existingTransaction, MEMBERSHIP_TRANSACTION_TYPES, userId)
        await connection.commit()
        return {
          granted: false,
          idempotent: true,
          transaction: existingTransaction,
          entitlement: await findUserEntitlement(connection, userId)
        }
      }

      const entitlement = await ensureUserEntitlementInTransaction(connection, userId)
      const currentTime = now()
      const membershipPeriod = getEffectiveMembershipPeriod(entitlement, currentTime, durationMilliseconds)
      const metadataJson = normalizeJson(buildMembershipMetadata({
        ...input,
        membershipType
      }, membershipPeriod.membershipStartedAt, membershipPeriod.membershipExpireAt, {
        requestedStartedAt,
        requestedExpireAt,
        grantBaseAt: membershipPeriod.grantBaseAt,
        durationMilliseconds,
        extendedFromExisting: membershipPeriod.extendedFromExisting
      }), 'Metadata', 'METADATA_INVALID')
      const transactionId = normalizeTransactionId(input.transactionId)
      const transactionInsertId = await insertTransaction(connection, {
        transactionId,
        userId,
        transactionType,
        amount: 0,
        balanceAfter: entitlement.quotaBalance,
        source,
        sourceId,
        expiresAt: null,
        idempotencyKey,
        operatorType,
        operatorId,
        reason,
        metadataJson
      })

      await connection.execute(
        `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
            SET membership_type = ?,
                membership_status = ?,
                membership_started_at = ?,
                membership_expire_at = ?,
                last_transaction_id = ?
          WHERE user_id = ?`,
        [
          membershipType,
          'active',
          membershipPeriod.membershipStartedAt,
          membershipPeriod.membershipExpireAt,
          transactionInsertId,
          userId
        ]
      )

      const updatedEntitlement = await findUserEntitlement(connection, userId)
      const transaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      await connection.commit()
      return {
        granted: true,
        idempotent: false,
        transaction,
        entitlement: updatedEntitlement
      }
    } catch (error) {
      await connection.rollback()
      if (isDuplicateEntryError(error)) {
        const existing = await getEntitlementAndTransactionAfterDuplicate(connection, idempotencyKey)
        assertIdempotentTransaction(existing.transaction, MEMBERSHIP_TRANSACTION_TYPES, userId)
        return {
          granted: false,
          idempotent: true,
          transaction: existing.transaction,
          entitlement: existing.entitlement
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  async function consumeQuota(input = {}) {
    const userId = normalizeUserId(input.userId)
    const amount = normalizePositiveInteger(input.amount === undefined || input.amount === null ? 1 : input.amount, 'Quota consume amount', 'QUOTA_CONSUME_AMOUNT_INVALID')
    const rootLearningObjectId = normalizeLearningObjectId(input.rootLearningObjectId, 'Root Learning Object id', 'ROOT_LEARNING_OBJECT_ID_REQUIRED')
    const currentLearningObjectId = normalizeLearningObjectId(
      input.currentLearningObjectId || rootLearningObjectId,
      'Current Learning Object id',
      'CURRENT_LEARNING_OBJECT_ID_REQUIRED'
    )
    const accessContextJson = normalizeJson(input.accessContext || {
      relationType: 'self',
      accessReason: 'content_access'
    }, 'Access context', 'ACCESS_CONTEXT_INVALID')
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const source = normalizeString(input.source) || 'full_content_access'
    const normalizedSource = normalizeSource(source)
    const sourceId = normalizeSourceId(input.sourceId)
    const operatorType = normalizeOperatorType(input.operatorType)
    const operatorId = normalizeOperatorId(input.operatorId)
    const reason = normalizeReason(input.reason)
    const metadata = normalizeJsonObject(input.metadata, 'Metadata', 'METADATA_INVALID')

    const connection = await getPool().getConnection()
    try {
      await connection.beginTransaction()

      const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      if (existingTransaction) {
        assertIdempotentTransaction(existingTransaction, CONTENT_ACCESS_TRANSACTION_TYPES, userId)
        await connection.commit()
        return {
          allowed: true,
          reason: ENTITLEMENT_REASONS.QUOTA_CONSUMED,
          remainingQuota: existingTransaction.balanceAfter,
          idempotent: true,
          transaction: existingTransaction,
          entitlement: await findUserEntitlement(connection, userId)
        }
      }

      let entitlement = await ensureUserEntitlementInTransaction(connection, userId)
      const currentTime = now()
      if (isMembershipActive(entitlement, currentTime)) {
        await connection.commit()
        return {
          allowed: true,
          reason: ENTITLEMENT_REASONS.MEMBERSHIP_ACTIVE,
          membershipType: entitlement.membershipType,
          membershipExpireAt: entitlement.membershipExpireAt,
          idempotent: false,
          entitlement
        }
      }

      entitlement = await expireQuotaGrantSources(connection, userId, entitlement, currentTime)
      if (entitlement.quotaBalance < amount) {
        await connection.commit()
        return {
          allowed: false,
          reason: ENTITLEMENT_REASONS.QUOTA_INSUFFICIENT,
          remainingQuota: entitlement.quotaBalance,
          idempotent: false,
          entitlement
        }
      }

      const quotaSources = await listQuotaGrantSources(connection, userId, currentTime)
      const allocationResult = allocateQuotaSources(quotaSources, amount)
      if (allocationResult.allocatedAmount < amount) {
        await connection.commit()
        return {
          allowed: false,
          reason: ENTITLEMENT_REASONS.QUOTA_INSUFFICIENT,
          remainingQuota: Math.min(entitlement.quotaBalance, allocationResult.availableAmount),
          idempotent: false,
          entitlement
        }
      }

      const balanceAfter = entitlement.quotaBalance - amount
      const transactionId = normalizeTransactionId(input.transactionId)
      const grantTransactionId = allocationResult.allocations[0].grantTransactionId
      const metadataJson = normalizeJson({
        ...(metadata || {}),
        quotaConsumeStrategy: 'FIFO_BY_EXPIRES_AT',
        consumedAllocations: allocationResult.allocations
      }, 'Metadata', 'METADATA_INVALID')
      const transactionInsertId = await insertTransaction(connection, {
        transactionId,
        userId,
        transactionType: ENTITLEMENT_TRANSACTION_TYPES.CONTENT_ACCESS,
        amount: -amount,
        balanceAfter,
        source: normalizedSource,
        sourceId,
        expiresAt: null,
        grantTransactionId,
        rootLearningObjectId,
        currentLearningObjectId,
        accessContextJson,
        idempotencyKey,
        operatorType,
        operatorId,
        reason,
        metadataJson
      })

      await connection.execute(
        `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
            SET quota_balance = ?,
                quota_total_consumed = quota_total_consumed + ?,
                last_transaction_id = ?
          WHERE user_id = ?`,
        [balanceAfter, amount, transactionInsertId, userId]
      )

      const updatedEntitlement = await findUserEntitlement(connection, userId)
      const transaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
      await connection.commit()
      return {
        allowed: true,
        reason: ENTITLEMENT_REASONS.QUOTA_CONSUMED,
        remainingQuota: balanceAfter,
        idempotent: false,
        transaction,
        entitlement: updatedEntitlement
      }
    } catch (error) {
      await connection.rollback()
      if (isDuplicateEntryError(error)) {
        const existing = await getEntitlementAndTransactionAfterDuplicate(connection, idempotencyKey)
        assertIdempotentTransaction(existing.transaction, CONTENT_ACCESS_TRANSACTION_TYPES, userId)
        return {
          allowed: true,
          reason: ENTITLEMENT_REASONS.QUOTA_CONSUMED,
          remainingQuota: existing.transaction.balanceAfter,
          idempotent: true,
          transaction: existing.transaction,
          entitlement: existing.entitlement
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  return {
    getUserEntitlement,
    listUserTransactions,
    ensureUserEntitlement,
    ensureRegistrationBonus,
    grantQuota,
    grantMembership,
    deductQuota,
    consumeQuota
  }
}
