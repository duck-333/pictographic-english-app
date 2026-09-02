import crypto from 'crypto'
import mysql from 'mysql2/promise'

import {
  MEMBERSHIP_GRANT_DAYS,
  MEMBERSHIP_GRANT_DURATION_SECONDS,
  revokeMembershipGrantSchedule,
  scheduleMembershipGrant
} from './membership-grant-schedule.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const USER_ENTITLEMENTS_TABLE = 'user_entitlements'
const ENTITLEMENT_TRANSACTIONS_TABLE = 'entitlement_transactions'
const MEMBERSHIP_GRANTS_TABLE = 'membership_grants'
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
  MEMBERSHIP_GRANT: 'MEMBERSHIP_GRANT',
  MEMBERSHIP_REVOKE: 'MEMBERSHIP_REVOKE',
  LEGACY_MEMBERSHIP_BASELINE: 'LEGACY_MEMBERSHIP_BASELINE',
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

const MEMBERSHIP_SOURCE_TYPES = new Set([
  'redemption_code',
  'admin_gift',
  'book_order',
  'wechat_order',
  'legacy_membership'
])

const CONTENT_ACCESS_TRANSACTION_TYPES = new Set([
  ENTITLEMENT_TRANSACTION_TYPES.CONTENT_ACCESS
])

const QUOTA_DEDUCT_TRANSACTION_TYPES = new Set([
  ENTITLEMENT_TRANSACTION_TYPES.ADMIN_DEDUCT
])

const ENTITLEMENT_TRANSACTION_TYPE_VALUES = new Set(Object.values(ENTITLEMENT_TRANSACTION_TYPES))

const ENTITLEMENT_LEDGER_EFFECTS = new Map([
  [ENTITLEMENT_TRANSACTION_TYPES.REGISTER_BONUS, Object.freeze({ sign: 'positive', granted: true })],
  [ENTITLEMENT_TRANSACTION_TYPES.SHARE_REWARD, Object.freeze({ sign: 'positive', granted: true })],
  [ENTITLEMENT_TRANSACTION_TYPES.ADMIN_GRANT, Object.freeze({ sign: 'positive', granted: true })],
  [ENTITLEMENT_TRANSACTION_TYPES.CONTENT_ACCESS, Object.freeze({ sign: 'negative', consumed: true })],
  [ENTITLEMENT_TRANSACTION_TYPES.EXPIRE_DEDUCT, Object.freeze({ sign: 'negative', expired: true })],
  [ENTITLEMENT_TRANSACTION_TYPES.ADMIN_DEDUCT, Object.freeze({ sign: 'negative' })],
  [ENTITLEMENT_TRANSACTION_TYPES.TAOBAO_BOOK_MEMBERSHIP_GRANT, Object.freeze({ sign: 'zero' })],
  [ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_ACTIVATED, Object.freeze({ sign: 'zero' })],
  [ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_GRANT, Object.freeze({ sign: 'zero' })],
  [ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_REVOKE, Object.freeze({ sign: 'zero' })],
  [ENTITLEMENT_TRANSACTION_TYPES.LEGACY_MEMBERSHIP_BASELINE, Object.freeze({ sign: 'zero' })]
])

const QUOTA_GRANT_SOURCE_TO_TRANSACTION_TYPE = new Map([
  ['registration', ENTITLEMENT_TRANSACTION_TYPES.REGISTER_BONUS],
  ['register', ENTITLEMENT_TRANSACTION_TYPES.REGISTER_BONUS],
  ['share', ENTITLEMENT_TRANSACTION_TYPES.SHARE_REWARD],
  ['admin', ENTITLEMENT_TRANSACTION_TYPES.ADMIN_GRANT]
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

// Stage 1 intentionally does not catch ER_LOCK_DEADLOCK or ER_LOCK_WAIT_TIMEOUT.
// A later database-hardening stage should add bounded retries around the whole transaction.

function assertSingleRowUpdate(result, operation) {
  if (!result || Number(result.affectedRows) !== 1) {
    throw createUserEntitlementStoreError(`Membership entitlement consistency check failed during ${operation}.`, {
      code: 'MEMBERSHIP_UPDATE_INCONSISTENT',
      statusCode: 500
    })
  }
}

function createIdempotencyConflictError() {
  return createUserEntitlementStoreError('Idempotency key is already used by another entitlement operation.', {
    code: 'IDEMPOTENCY_KEY_CONFLICT',
    statusCode: 409
  })
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

function normalizeOptionalSafePositiveIntegerId(value, fieldName, code) {
  if (value === undefined || value === null) return null

  const normalizedValue = typeof value === 'bigint'
    ? value.toString()
    : typeof value === 'number'
      ? (Number.isSafeInteger(value) ? String(value) : '')
      : normalizeString(value)
  if (!/^\d+$/.test(normalizedValue)) {
    throw createUserEntitlementStoreError(`${fieldName} must be a safe positive integer.`, {
      code,
      statusCode: 400
    })
  }

  const numericValue = BigInt(normalizedValue)
  if (numericValue <= 0n || numericValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw createUserEntitlementStoreError(`${fieldName} must be a safe positive integer.`, {
      code,
      statusCode: 400
    })
  }
  return numericValue.toString()
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

function createMembershipGrantIntegrityError() {
  return createUserEntitlementStoreError('Membership grant integrity check failed.', {
    code: 'MEMBERSHIP_GRANT_INTEGRITY_INVALID',
    statusCode: 409
  })
}

function strictSafePositiveId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw createMembershipGrantIntegrityError()
    return String(value)
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw createMembershipGrantIntegrityError()
  const numericValue = BigInt(value)
  if (numericValue > BigInt(Number.MAX_SAFE_INTEGER)) throw createMembershipGrantIntegrityError()
  return value
}

function strictUnsignedInteger(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw createMembershipGrantIntegrityError()
  }
  return value
}

function strictSignedInteger(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw createMembershipGrantIntegrityError()
  return value
}

function strictUnsignedBigInteger(value) {
  if (typeof value === 'number') return strictUnsignedInteger(value)
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw createMembershipGrantIntegrityError()
  const numericValue = BigInt(value)
  if (numericValue > BigInt(Number.MAX_SAFE_INTEGER)) throw createMembershipGrantIntegrityError()
  return Number(numericValue)
}

function strictRequiredText(value, maxLength) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw createMembershipGrantIntegrityError()
  }
  return value
}

function strictNullableText(value, maxLength) {
  if (value === null) return null
  return strictRequiredText(value, maxLength)
}

function strictDatabaseDate(value, nullable = false) {
  if (value === null && nullable) return null
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw createMembershipGrantIntegrityError()
    return value.toISOString()
  }
  if (typeof value !== 'string') throw createMembershipGrantIntegrityError()
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw createMembershipGrantIntegrityError()
  const parts = match.slice(1).map(Number)
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]))
  if (
    date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2] || date.getUTCHours() !== parts[3] ||
    date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]
  ) {
    throw createMembershipGrantIntegrityError()
  }
  return date.toISOString()
}

function strictJsonObject(value) {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw createMembershipGrantIntegrityError()
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) {
    throw createMembershipGrantIntegrityError()
  }
  return parsed
}

function strictNullableJsonObject(value) {
  if (value === null) return null
  return strictJsonObject(value)
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

function normalizeMembershipSourceType(value) {
  const sourceType = normalizeRequiredString(value, 'Membership source type', 'MEMBERSHIP_SOURCE_TYPE_REQUIRED', {
    maxLength: MAX_SOURCE_LENGTH
  }).toLowerCase()
  if (!MEMBERSHIP_SOURCE_TYPES.has(sourceType)) {
    throw createUserEntitlementStoreError('Membership source type is invalid.', {
      code: 'MEMBERSHIP_SOURCE_TYPE_INVALID',
      statusCode: 400
    })
  }
  return sourceType
}

function normalizeRequiredSourceId(value) {
  return normalizeRequiredString(value, 'Membership source id', 'MEMBERSHIP_SOURCE_ID_REQUIRED', {
    maxLength: MAX_ID_LENGTH
  })
}

function normalizeRequiredReason(value) {
  return normalizeRequiredString(value, 'Reason', 'MEMBERSHIP_REASON_REQUIRED', {
    maxLength: MAX_REASON_LENGTH
  })
}

function normalizeMembershipOperatorType(value) {
  return normalizeRequiredString(value, 'Operator type', 'MEMBERSHIP_OPERATOR_TYPE_REQUIRED', {
    maxLength: MAX_OPERATOR_TYPE_LENGTH
  })
}

function normalizeMembershipOperatorId(value) {
  return normalizeRequiredString(value, 'Operator id', 'MEMBERSHIP_OPERATOR_ID_REQUIRED', {
    maxLength: MAX_ID_LENGTH
  })
}

function rejectUnsupportedLegacyMembershipParameters(input = {}) {
  const hasCustomInterval = [
    'startedAt',
    'expireAt',
    'duration',
    'durationSeconds',
    'days',
    'daysGranted'
  ].some((key) => input[key] !== undefined && input[key] !== null && input[key] !== '')
  const membershipType = normalizeString(input.membershipType).toLowerCase()
  if (hasCustomInterval || (membershipType && membershipType !== 'monthly')) {
    throw createUserEntitlementStoreError(
      'Custom membership intervals are no longer supported. Use the fixed 30-day membership grant source method.',
      {
        code: 'CUSTOM_MEMBERSHIP_INTERVAL_UNSUPPORTED',
        statusCode: 400
      }
    )
  }
}

function getLegacyMembershipSourceId(userId, expireAt) {
  const normalizedExpireAt = expireAt.toISOString()
  const rawValue = `legacy_membership:${userId}:${normalizedExpireAt}`
  if (rawValue.length <= MAX_ID_LENGTH) return rawValue
  const digest = crypto.createHash('sha256').update(rawValue).digest('hex')
  return `legacy_membership:${digest}`
}

function getLegacyMembershipIdempotencyKey(sourceId) {
  return `membership_grant:${sourceId}`
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

function restoreMembershipRevokeReplay(transaction, targetGrant) {
  const metadata = transaction && transaction.metadata && typeof transaction.metadata === 'object'
    ? transaction.metadata
    : null
  const matchesOperation = Boolean(
    transaction &&
    targetGrant &&
    transaction.transactionType === ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_REVOKE &&
    transaction.userId === targetGrant.userId &&
    transaction.source === 'membership_grant_revoke' &&
    String(transaction.sourceId || '') === targetGrant.id &&
    metadata &&
    typeof metadata.membershipGrantId === 'string' &&
    metadata.membershipGrantId === targetGrant.id &&
    targetGrant.status === 'revoked' &&
    targetGrant.revokeTransactionId === transaction.transactionId
  )
  if (!matchesOperation) throw createIdempotencyConflictError()

  const usedSeconds = metadata.usedSeconds
  const revokedSeconds = metadata.revokedSeconds
  const membershipExpireAtBefore = formatDate(metadata.membershipExpireAtBefore)
  const membershipExpireAt = formatDate(metadata.membershipExpireAtAfter)
  const membershipStatus = normalizeString(metadata.membershipStatus)
  if (
    typeof usedSeconds !== 'number' ||
    !Number.isSafeInteger(usedSeconds) || usedSeconds < 0 ||
    typeof revokedSeconds !== 'number' ||
    !Number.isSafeInteger(revokedSeconds) || revokedSeconds < 0 ||
    typeof metadata.membershipExpireAtBefore !== 'string' ||
    !membershipExpireAtBefore || !Number.isFinite(new Date(membershipExpireAtBefore).getTime()) ||
    typeof metadata.membershipExpireAtAfter !== 'string' ||
    !membershipExpireAt || !Number.isFinite(new Date(membershipExpireAt).getTime()) ||
    typeof metadata.membershipStatus !== 'string' ||
    !['active', 'expired'].includes(membershipStatus) ||
    typeof metadata.shortened !== 'boolean' ||
    metadata.alreadyRevoked !== false
  ) {
    throw createIdempotencyConflictError()
  }

  return {
    grantId: targetGrant.id,
    idempotent: true,
    alreadyRevoked: metadata.alreadyRevoked,
    usedSeconds,
    revokedSeconds,
    membershipExpireAtBefore,
    membershipExpireAt,
    membershipStatus,
    shortened: metadata.shortened
  }
}

function mapMembershipGrantRow(row) {
  if (!row) return null
  return {
    id: row.id === undefined || row.id === null ? null : String(row.id),
    userId: normalizeString(row.user_id),
    sourceType: normalizeString(row.source_type),
    sourceId: normalizeString(row.source_id),
    redemptionCodeId: row.redemption_code_id === undefined || row.redemption_code_id === null
      ? null
      : String(row.redemption_code_id),
    daysGranted: toInteger(row.days_granted),
    durationSeconds: toInteger(row.duration_seconds),
    status: normalizeString(row.status) || 'granted',
    grantedAt: formatDate(row.granted_at),
    effectiveStartAt: formatDate(row.effective_start_at),
    effectiveEndAt: formatDate(row.effective_end_at),
    consumedSecondsAtRevoke: toInteger(row.consumed_seconds_at_revoke),
    revokedSeconds: toInteger(row.revoked_seconds),
    revokedAt: formatDate(row.revoked_at),
    revokedBy: row.revoked_by === undefined || row.revoked_by === null ? null : String(row.revoked_by),
    revokeReason: row.revoke_reason === undefined || row.revoke_reason === null ? null : String(row.revoke_reason),
    idempotencyKey: normalizeString(row.idempotency_key),
    grantTransactionId: row.grant_transaction_id === undefined || row.grant_transaction_id === null
      ? null
      : String(row.grant_transaction_id),
    revokeTransactionId: row.revoke_transaction_id === undefined || row.revoke_transaction_id === null
      ? null
      : String(row.revoke_transaction_id),
    createdAt: formatDate(row.created_at),
    updatedAt: formatDate(row.updated_at)
  }
}

function getContinuousMembershipWindow(grants, targetGrantId) {
  const activeGrants = grants
    .filter((grant) => grant && grant.status === 'granted')
    .slice()
    .sort((left, right) => Date.parse(left.effectiveStartAt) - Date.parse(right.effectiveStartAt) || Number(left.id) - Number(right.id))
  const targetIndex = activeGrants.findIndex((grant) => grant.id === String(targetGrantId))
  if (targetIndex < 0) throw createMembershipGrantIntegrityError()
  let startIndex = targetIndex
  let endIndex = targetIndex
  while (
    startIndex > 0 &&
    Date.parse(activeGrants[startIndex - 1].effectiveEndAt) === Date.parse(activeGrants[startIndex].effectiveStartAt)
  ) {
    startIndex -= 1
  }
  while (
    endIndex + 1 < activeGrants.length &&
    Date.parse(activeGrants[endIndex].effectiveEndAt) === Date.parse(activeGrants[endIndex + 1].effectiveStartAt)
  ) {
    endIndex += 1
  }
  return Object.freeze({
    grants: Object.freeze(activeGrants.slice(startIndex, endIndex + 1)),
    startedAt: activeGrants[startIndex].effectiveStartAt,
    expireAt: activeGrants[endIndex].effectiveEndAt
  })
}

function getCurrentMembershipWindow(grants) {
  const activeGrants = grants
    .filter((grant) => grant && grant.status === 'granted')
    .slice()
    .sort((left, right) => Date.parse(left.effectiveStartAt) - Date.parse(right.effectiveStartAt) || Number(left.id) - Number(right.id))
  if (!activeGrants.length) throw createMembershipGrantIntegrityError()
  return getContinuousMembershipWindow(activeGrants, activeGrants[activeGrants.length - 1].id)
}

function isMembershipActive(entitlement, now) {
  if (!entitlement) return false
  if (entitlement.membershipStatus !== 'active') return false
  const expireAt = entitlement.membershipExpireAt ? new Date(entitlement.membershipExpireAt) : null
  return Boolean(expireAt && Number.isFinite(expireAt.getTime()) && expireAt.getTime() > now.getTime())
}

export function createUserEntitlementStore(options = {}) {
  let pool = options.pool || null
  const now = options.now || (() => new Date())
  const currentMembershipReadUsersByConnection = new WeakMap()

  function requireCurrentMembershipRead(connection, userId) {
    const users = currentMembershipReadUsersByConnection.get(connection)
    return Boolean(users && users.has(String(userId)))
  }

  function markCurrentMembershipRead(connection, userId) {
    let users = currentMembershipReadUsersByConnection.get(connection)
    if (!users) {
      users = new Set()
      currentMembershipReadUsersByConnection.set(connection, users)
    }
    users.add(String(userId))
  }

  function entitlementChangedWhileWaiting(before, after) {
    if (!before || !after) return before !== after
    return (
      before.id !== after.id || before.userId !== after.userId ||
      before.quotaBalance !== after.quotaBalance || before.quotaTotalGranted !== after.quotaTotalGranted ||
      before.quotaTotalConsumed !== after.quotaTotalConsumed || before.quotaTotalExpired !== after.quotaTotalExpired ||
      before.membershipType !== after.membershipType || before.membershipStatus !== after.membershipStatus ||
      before.membershipStartedAt !== after.membershipStartedAt || before.membershipExpireAt !== after.membershipExpireAt ||
      before.lastTransactionId !== after.lastTransactionId || before.updatedAt !== after.updatedAt
    )
  }

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

  async function findTransactionByIdempotencyKey(connection, idempotencyKey, options = {}) {
    const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
    const [rows] = await connection.execute(
      `SELECT id, transaction_id, user_id, transaction_type, amount, balance_after, source, source_id,
              expires_at, grant_transaction_id, root_learning_object_id, current_learning_object_id,
              access_context_json, idempotency_key, operator_type, operator_id, reason, metadata_json, created_at
         FROM ${quoteIdentifier(ENTITLEMENT_TRANSACTIONS_TABLE)}
        WHERE idempotency_key = ?
        LIMIT 1${lockClause}`,
      [idempotencyKey]
    )
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    return mapTransactionRow(row)
  }

  const membershipGrantSelectColumns = `id, user_id, source_type, source_id, redemption_code_id,
          days_granted, duration_seconds, status, granted_at, effective_start_at, effective_end_at,
          consumed_seconds_at_revoke, revoked_seconds, revoked_at, revoked_by, revoke_reason,
          idempotency_key, grant_transaction_id, revoke_transaction_id, created_at, updated_at`

  async function findMembershipGrantHint(connection, grantId) {
    const [rows] = await connection.execute(
      `SELECT id, user_id
         FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
        WHERE id = ?
        LIMIT 1`,
      [grantId]
    )
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    if (!row) return null
    return {
      id: String(row.id),
      userId: normalizeString(row.user_id)
    }
  }

  async function findMembershipGrantById(connection, grantId, options = {}) {
    const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
    const [rows] = await connection.execute(
      `SELECT ${membershipGrantSelectColumns}
         FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
        WHERE id = ?
        LIMIT 1${lockClause}`,
      [grantId]
    )
    return mapMembershipGrantRow(Array.isArray(rows) && rows.length ? rows[0] : null)
  }

  async function findMembershipGrantByIdempotencyKey(connection, idempotencyKey, options = {}) {
    const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
    const [rows] = await connection.execute(
      `SELECT ${membershipGrantSelectColumns}
         FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
        WHERE idempotency_key = ?
        LIMIT 1${lockClause}`,
      [idempotencyKey]
    )
    return mapMembershipGrantRow(Array.isArray(rows) && rows.length ? rows[0] : null)
  }

  async function findMembershipGrantBySource(connection, sourceType, sourceId) {
    const [rows] = await connection.execute(
      `SELECT ${membershipGrantSelectColumns}
         FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
        WHERE source_type = ? AND source_id = ?
        LIMIT 1`,
      [sourceType, sourceId]
    )
    return mapMembershipGrantRow(Array.isArray(rows) && rows.length ? rows[0] : null)
  }

  async function listUserMembershipGrants(connection, userId, options = {}) {
    if (options.currentRead) {
      const [currentRows] = await connection.execute(
        `SELECT ${membershipGrantSelectColumns}
           FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
          WHERE user_id = ?
          ORDER BY granted_at ASC, id ASC
          FOR UPDATE`,
        [userId]
      )
      return (Array.isArray(currentRows) ? currentRows : []).map(mapMembershipGrantRow).filter(Boolean)
    }
    const [candidateRows] = await connection.execute(
      `SELECT ${membershipGrantSelectColumns}
         FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
        WHERE user_id = ?
        ORDER BY granted_at ASC, id ASC`,
      [userId]
    )
    let rows = Array.isArray(candidateRows) ? candidateRows : []
    if (options.forUpdate && rows.length) {
      const ids = rows.map((row) => strictSafePositiveId(row && row.id))
      const placeholders = ids.map(() => '?').join(', ')
      const [lockedRows] = await connection.execute(
        `SELECT ${membershipGrantSelectColumns}
           FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
          WHERE user_id = ? AND id IN (${placeholders})
          ORDER BY granted_at ASC, id ASC
          FOR UPDATE`,
        [userId, ...ids]
      )
      rows = Array.isArray(lockedRows) ? lockedRows : []
      if (rows.length !== ids.length) throw createMembershipGrantIntegrityError()
    }
    return (Array.isArray(rows) ? rows : []).map(mapMembershipGrantRow).filter(Boolean)
  }

  async function insertMembershipGrant(connection, grant) {
    const [result] = await connection.execute(
      `INSERT INTO ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
        (user_id, source_type, source_id, redemption_code_id, days_granted, duration_seconds,
         status, granted_at, effective_start_at, effective_end_at, idempotency_key,
         grant_transaction_id, revoke_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grant.userId,
        grant.sourceType,
        grant.sourceId,
        grant.redemptionCodeId || null,
        grant.daysGranted,
        grant.durationSeconds,
        grant.status || 'granted',
        grant.grantedAt,
        grant.effectiveStartAt,
        grant.effectiveEndAt,
        grant.idempotencyKey,
        grant.grantTransactionId || null,
        grant.revokeTransactionId || null
      ]
    )
    return result && result.insertId ? String(result.insertId) : null
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
    const existingEntitlement = await findUserEntitlement(connection, userId)
    let insertResult = null
    if (!existingEntitlement) {
      const insertResponse = await connection.execute(
        `INSERT IGNORE INTO ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)} (user_id)
         VALUES (?)`,
        [userId]
      )
      insertResult = insertResponse[0]
    }
    const lockedEntitlement = await findUserEntitlement(connection, userId, {
      forUpdate: true
    })
    if (
      (!existingEntitlement && (!insertResult || Number(insertResult.affectedRows) !== 1)) ||
      entitlementChangedWhileWaiting(existingEntitlement, lockedEntitlement)
    ) {
      markCurrentMembershipRead(connection, userId)
    }
    return lockedEntitlement
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

  async function ensureLegacyMembershipGrant(connection, userId, entitlement, currentTime, existingGrants) {
    if (existingGrants.length) return null

    const expireAt = entitlement && entitlement.membershipExpireAt
      ? new Date(entitlement.membershipExpireAt)
      : null
    if (!expireAt || !Number.isFinite(expireAt.getTime()) || expireAt.getTime() <= currentTime.getTime()) {
      return null
    }

    const storedStartedAt = entitlement.membershipStartedAt
      ? new Date(entitlement.membershipStartedAt)
      : null
    const hasReliableStartedAt = Boolean(
      storedStartedAt &&
      Number.isFinite(storedStartedAt.getTime()) &&
      storedStartedAt.getTime() < expireAt.getTime()
    )
    // If the old snapshot has no trustworthy start, preserve only the known remaining interval.
    // This does not invent a historical 30-day grant and never shortens membership_expire_at.
    const effectiveStartAt = hasReliableStartedAt ? storedStartedAt : currentTime
    const durationSeconds = Math.max(0, Math.floor((expireAt.getTime() - effectiveStartAt.getTime()) / 1000))
    const daysGranted = Math.max(1, Math.ceil(durationSeconds / (24 * 60 * 60)))
    const sourceId = getLegacyMembershipSourceId(userId, expireAt)
    const idempotencyKey = getLegacyMembershipIdempotencyKey(sourceId)

    const existingByIdempotency = await findMembershipGrantByIdempotencyKey(connection, idempotencyKey)
    if (existingByIdempotency) return existingByIdempotency
    const existingBySource = await findMembershipGrantBySource(connection, 'legacy_membership', sourceId)
    if (existingBySource) return existingBySource

    const grantId = await insertMembershipGrant(connection, {
      userId,
      sourceType: 'legacy_membership',
      sourceId,
      redemptionCodeId: null,
      daysGranted,
      durationSeconds,
      status: 'granted',
      grantedAt: effectiveStartAt,
      effectiveStartAt,
      effectiveEndAt: expireAt,
      idempotencyKey
    })
    const transactionId = generateTransactionId()
    const transactionInsertId = await insertTransaction(connection, {
      transactionId,
      userId,
      transactionType: ENTITLEMENT_TRANSACTION_TYPES.LEGACY_MEMBERSHIP_BASELINE,
      amount: 0,
      balanceAfter: entitlement.quotaBalance,
      source: 'legacy_membership',
      sourceId,
      expiresAt: null,
      idempotencyKey,
      operatorType: 'system',
      operatorId: 'membership-grant-migration',
      reason: 'Preserve pre-existing membership snapshot before first membership grant.',
      metadataJson: normalizeJson({
        membershipGrantId: grantId,
        effectiveStartAt: effectiveStartAt.toISOString(),
        effectiveEndAt: expireAt.toISOString(),
        durationSeconds,
        startedAtSource: hasReliableStartedAt ? 'membership_started_at' : 'conservative_remaining_baseline'
      }, 'Metadata', 'METADATA_INVALID')
    })

    const [grantLinkUpdate] = await connection.execute(
      `UPDATE ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
          SET grant_transaction_id = ?
        WHERE id = ? AND user_id = ? AND status = 'granted'`,
      [transactionId, grantId, userId]
    )
    assertSingleRowUpdate(grantLinkUpdate, 'legacy grant transaction link')
    const [snapshotLinkUpdate] = await connection.execute(
      `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
          SET last_transaction_id = ?
        WHERE user_id = ?`,
      [transactionInsertId, userId]
    )
    assertSingleRowUpdate(snapshotLinkUpdate, 'legacy entitlement snapshot link')

    return await findMembershipGrantById(connection, grantId)
  }

  async function getEntitlementAndTransactionAfterDuplicate(connection, idempotencyKey) {
    const transaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
    const entitlement = transaction ? await findUserEntitlement(connection, transaction.userId) : null
    return {
      transaction,
      entitlement
    }
  }

  function assertMembershipGrantReplay(existingGrant, existingTransaction, expected) {
    const hasMetadataGrantId = Boolean(
      existingTransaction &&
      existingTransaction.metadata &&
      Object.prototype.hasOwnProperty.call(existingTransaction.metadata, 'membershipGrantId')
    )
    const metadataGrantId = hasMetadataGrantId
      ? existingTransaction.metadata.membershipGrantId
      : null
    const matches = Boolean(
      existingGrant &&
      existingTransaction &&
      existingGrant.userId === expected.userId &&
      existingGrant.sourceType === expected.sourceType &&
      existingGrant.sourceId === expected.sourceId &&
      existingGrant.idempotencyKey === expected.idempotencyKey &&
      existingGrant.redemptionCodeId === expected.redemptionCodeId &&
      existingTransaction.idempotencyKey === expected.idempotencyKey &&
      existingTransaction.transactionType === ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_GRANT &&
      existingTransaction.userId === existingGrant.userId &&
      existingTransaction.source === existingGrant.sourceType &&
      String(existingTransaction.sourceId || '') === existingGrant.sourceId &&
      existingTransaction.transactionId === existingGrant.grantTransactionId &&
      (!hasMetadataGrantId || String(metadataGrantId) === existingGrant.id)
    )
    if (!matches) throw createIdempotencyConflictError()
  }

  function createMembershipGrantResult(existingGrant, existingTransaction, entitlement, idempotent) {
    if (!existingGrant || !existingTransaction || !entitlement) {
      throw createIdempotencyConflictError()
    }
    return {
      grantId: existingGrant.id,
      transactionId: existingTransaction.transactionId,
      transactionInsertId: existingTransaction.id,
      userId: existingGrant.userId,
      sourceType: existingGrant.sourceType,
      sourceId: existingGrant.sourceId,
      redemptionCodeId: existingGrant.redemptionCodeId,
      idempotent,
      effectiveStartAt: existingGrant.effectiveStartAt,
      effectiveEndAt: existingGrant.effectiveEndAt,
      membershipStartedAt: entitlement.membershipStartedAt,
      membershipExpireAt: entitlement.membershipExpireAt,
      membershipType: entitlement.membershipType,
      membershipStatus: entitlement.membershipStatus,
      quotaBalance: entitlement.quotaBalance
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

  async function grantMembershipDurationInTransaction(connection, input = {}) {
    if (!connection || typeof connection.execute !== 'function') {
      throw createUserEntitlementStoreError('A usable membership transaction connection is required.', {
        code: 'MEMBERSHIP_TRANSACTION_CONNECTION_INVALID',
        statusCode: 500
      })
    }

    const userId = normalizeUserId(input.userId)
    const sourceType = normalizeMembershipSourceType(input.sourceType)
    if (sourceType === 'legacy_membership') {
      throw createUserEntitlementStoreError('Legacy membership grants are created only by snapshot preservation.', {
        code: 'LEGACY_MEMBERSHIP_SOURCE_RESERVED',
        statusCode: 400
      })
    }
    const sourceId = normalizeRequiredSourceId(input.sourceId)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const operatorType = normalizeMembershipOperatorType(input.operatorType)
    const operatorId = normalizeMembershipOperatorId(input.operatorId)
    const reason = normalizeRequiredReason(input.reason)
    const redemptionCodeId = normalizeOptionalSafePositiveIntegerId(
      input.redemptionCodeId,
      'Redemption code id',
      'REDEMPTION_CODE_ID_INVALID'
    )
    const currentTime = normalizeDate(input.now === undefined ? now() : input.now, 'Membership grant time', 'MEMBERSHIP_GRANT_TIME_INVALID')

    let entitlement = await ensureUserEntitlementInTransaction(connection, userId)
    let grants = await listUserMembershipGrants(connection, userId, {
      forUpdate: true,
      currentRead: requireCurrentMembershipRead(connection, userId)
    })

    const existingByIdempotency = await findMembershipGrantByIdempotencyKey(connection, idempotencyKey, { forUpdate: true })
    const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey, { forUpdate: true })
    if (existingByIdempotency || existingTransaction) {
      assertMembershipGrantReplay(existingByIdempotency, existingTransaction, {
        userId,
        sourceType,
        sourceId,
        idempotencyKey,
        redemptionCodeId
      })
      return createMembershipGrantResult(existingByIdempotency, existingTransaction, entitlement, true)
    }

    const existingBySource = await findMembershipGrantBySource(connection, sourceType, sourceId)
    if (existingBySource) {
      throw createUserEntitlementStoreError('Membership source is already used by another grant request.', {
        code: 'MEMBERSHIP_SOURCE_CONFLICT',
        statusCode: 409
      })
    }

    await ensureLegacyMembershipGrant(connection, userId, entitlement, currentTime, grants)
    grants = await listUserMembershipGrants(connection, userId, {
      forUpdate: true,
      currentRead: requireCurrentMembershipRead(connection, userId)
    })
    entitlement = await findUserEntitlement(connection, userId, { forUpdate: true })

    const schedule = scheduleMembershipGrant({
      now: currentTime,
      membershipExpireAt: entitlement.membershipExpireAt,
      grants,
      durationSeconds: MEMBERSHIP_GRANT_DURATION_SECONDS
    })
    const grantId = await insertMembershipGrant(connection, {
      userId,
      sourceType,
      sourceId,
      redemptionCodeId,
      daysGranted: MEMBERSHIP_GRANT_DAYS,
      durationSeconds: MEMBERSHIP_GRANT_DURATION_SECONDS,
      status: 'granted',
      grantedAt: currentTime,
      effectiveStartAt: new Date(schedule.effectiveStartAt),
      effectiveEndAt: new Date(schedule.effectiveEndAt),
      idempotencyKey
    })
    const transactionId = normalizeTransactionId(input.transactionId)
    const transactionInsertId = await insertTransaction(connection, {
      transactionId,
      userId,
      transactionType: ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_GRANT,
      amount: 0,
      balanceAfter: entitlement.quotaBalance,
      source: sourceType,
      sourceId,
      expiresAt: null,
      idempotencyKey,
      operatorType,
      operatorId,
      reason,
      metadataJson: normalizeJson({
        membershipGrantId: grantId,
        membershipType: 'monthly',
        daysGranted: MEMBERSHIP_GRANT_DAYS,
        durationSeconds: MEMBERSHIP_GRANT_DURATION_SECONDS,
        effectiveStartAt: schedule.effectiveStartAt,
        effectiveEndAt: schedule.effectiveEndAt,
        durationRule: '30x24_hours_not_calendar_month'
      }, 'Metadata', 'METADATA_INVALID')
    })
    const [grantLinkUpdate] = await connection.execute(
      `UPDATE ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
          SET grant_transaction_id = ?
        WHERE id = ? AND user_id = ? AND status = 'granted'`,
      [transactionId, grantId, userId]
    )
    assertSingleRowUpdate(grantLinkUpdate, 'membership grant transaction link')

    const allGrants = await listUserMembershipGrants(connection, userId, {
      forUpdate: true,
      currentRead: requireCurrentMembershipRead(connection, userId)
    })
    const membershipWindow = getCurrentMembershipWindow(allGrants)
    const membershipStartedAtDate = normalizeDate(
      membershipWindow.startedAt,
      'Membership start time',
      'MEMBERSHIP_STARTED_AT_INVALID'
    )
    const membershipExpireAtDate = normalizeDate(
      membershipWindow.expireAt,
      'Membership expiry time',
      'MEMBERSHIP_EXPIRE_AT_INVALID'
    )
    // Compatibility value: "monthly" means exactly 30x24 hours in stage 1, never a calendar month.
    const [snapshotUpdate] = await connection.execute(
      `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
          SET membership_type = ?,
              membership_status = ?,
              membership_started_at = ?,
              membership_expire_at = ?,
              last_transaction_id = ?
        WHERE user_id = ?`,
      ['monthly', 'active', membershipStartedAtDate, membershipExpireAtDate, transactionInsertId, userId]
    )
    assertSingleRowUpdate(snapshotUpdate, 'membership grant entitlement snapshot')

    return {
      grantId,
      transactionId,
      transactionInsertId,
      userId,
      sourceType,
      sourceId,
      redemptionCodeId,
      idempotent: false,
      effectiveStartAt: schedule.effectiveStartAt,
      effectiveEndAt: schedule.effectiveEndAt,
      membershipStartedAt: membershipStartedAtDate.toISOString(),
      membershipExpireAt: membershipExpireAtDate.toISOString(),
      membershipType: 'monthly',
      membershipStatus: 'active',
      quotaBalance: entitlement.quotaBalance
    }
  }

  async function lockMembershipScheduleInTransaction(connection, userIdValue) {
    if (!connection || typeof connection.execute !== 'function') {
      throw createUserEntitlementStoreError('A usable membership transaction connection is required.', {
        code: 'MEMBERSHIP_TRANSACTION_CONNECTION_INVALID',
        statusCode: 500
      })
    }
    const userId = normalizeUserId(userIdValue)
    const entitlement = await ensureUserEntitlementInTransaction(connection, userId)
    if (!entitlement) throw createMembershipGrantIntegrityError()
    const grants = await listUserMembershipGrants(connection, userId, {
      forUpdate: true,
      currentRead: requireCurrentMembershipRead(connection, userId)
    })
    return Object.freeze({ entitlement, grants: Object.freeze(grants) })
  }

  async function verifyMembershipGrantInTransaction(connection, input = {}) {
    if (!connection || typeof connection.execute !== 'function') {
      throw createUserEntitlementStoreError('A usable membership transaction connection is required.', {
        code: 'MEMBERSHIP_TRANSACTION_CONNECTION_INVALID',
        statusCode: 500
      })
    }
    const userId = normalizeUserId(input.userId)
    const grantId = normalizeRequiredString(input.grantId, 'Membership grant id', 'MEMBERSHIP_GRANT_ID_REQUIRED', {
      maxLength: MAX_ID_LENGTH
    })
    const sourceType = normalizeMembershipSourceType(input.sourceType)
    const sourceId = normalizeRequiredSourceId(input.sourceId)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const expectedTransactionId = normalizeRequiredString(
      input.transactionId,
      'Transaction id',
      'TRANSACTION_ID_REQUIRED',
      { maxLength: 64 }
    )
    const [entitlementRows] = await connection.execute(
      `SELECT id, user_id, quota_balance, quota_total_granted, quota_total_consumed, quota_total_expired,
              membership_type, membership_status, membership_started_at, membership_expire_at,
              last_transaction_id, created_at, updated_at
         FROM ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
        WHERE user_id = ?
        LIMIT 2 FOR UPDATE`,
      [userId]
    )
    const [grantRows] = await connection.execute(
      `SELECT ${membershipGrantSelectColumns}
         FROM ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
        WHERE user_id = ?
        ORDER BY granted_at ASC, id ASC
        FOR UPDATE`,
      [userId]
    )
    const [transactionRows] = await connection.execute(
      `SELECT id, transaction_id, user_id, transaction_type, amount, balance_after, source, source_id,
              expires_at, grant_transaction_id, root_learning_object_id, current_learning_object_id,
              access_context_json, idempotency_key, operator_type, operator_id, reason, metadata_json, created_at
         FROM ${quoteIdentifier(ENTITLEMENT_TRANSACTIONS_TABLE)}
        WHERE user_id = ?
        ORDER BY created_at ASC, id ASC
        FOR UPDATE`,
      [userId]
    )
    if (!Array.isArray(entitlementRows) || entitlementRows.length !== 1 ||
        !Array.isArray(grantRows) || grantRows.length === 0 ||
        !Array.isArray(transactionRows) || transactionRows.length === 0) {
      throw createMembershipGrantIntegrityError()
    }

    const normalizedGrants = grantRows.map((row) => {
      if (!row || typeof row !== 'object') throw createMembershipGrantIntegrityError()
      const normalized = {
        id: strictSafePositiveId(row.id),
        userId: strictSafePositiveId(row.user_id),
        sourceType: strictRequiredText(row.source_type, MAX_SOURCE_LENGTH),
        sourceId: strictRequiredText(row.source_id, MAX_ID_LENGTH),
        redemptionCodeId: row.redemption_code_id === null ? null : strictSafePositiveId(row.redemption_code_id),
        daysGranted: strictUnsignedInteger(row.days_granted),
        durationSeconds: strictUnsignedBigInteger(row.duration_seconds),
        status: strictRequiredText(row.status, 16),
        grantedAt: strictDatabaseDate(row.granted_at),
        effectiveStartAt: strictDatabaseDate(row.effective_start_at),
        effectiveEndAt: strictDatabaseDate(row.effective_end_at),
        consumedSecondsAtRevoke: strictUnsignedBigInteger(row.consumed_seconds_at_revoke),
        revokedSeconds: strictUnsignedBigInteger(row.revoked_seconds),
        revokedAt: strictDatabaseDate(row.revoked_at, true),
        revokedBy: strictNullableText(row.revoked_by, MAX_ID_LENGTH),
        revokeReason: strictNullableText(row.revoke_reason, MAX_REASON_LENGTH),
        idempotencyKey: strictRequiredText(row.idempotency_key, MAX_ID_LENGTH),
        grantTransactionId: strictNullableText(row.grant_transaction_id, 64),
        revokeTransactionId: strictNullableText(row.revoke_transaction_id, 64),
        createdAt: strictDatabaseDate(row.created_at),
        updatedAt: strictDatabaseDate(row.updated_at)
      }
      if (!MEMBERSHIP_SOURCE_TYPES.has(normalized.sourceType) || normalized.userId !== userId ||
          !['granted', 'revoked'].includes(normalized.status) || !normalized.grantTransactionId) {
        throw createMembershipGrantIntegrityError()
      }
      const start = Date.parse(normalized.effectiveStartAt)
      const end = Date.parse(normalized.effectiveEndAt)
      if (normalized.sourceType === 'legacy_membership') {
        if (normalized.durationSeconds <= 0 || normalized.daysGranted <= 0) throw createMembershipGrantIntegrityError()
      } else if (normalized.durationSeconds !== MEMBERSHIP_GRANT_DURATION_SECONDS || normalized.daysGranted !== MEMBERSHIP_GRANT_DAYS) {
        throw createMembershipGrantIntegrityError()
      }
      if (normalized.status === 'granted') {
        if (end - start !== normalized.durationSeconds * 1000 || normalized.consumedSecondsAtRevoke !== 0 ||
            normalized.revokedSeconds !== 0 || normalized.revokedAt !== null || normalized.revokedBy !== null ||
            normalized.revokeReason !== null || normalized.revokeTransactionId !== null) {
          throw createMembershipGrantIntegrityError()
        }
      } else if (
        end - start !== normalized.consumedSecondsAtRevoke * 1000 ||
        normalized.consumedSecondsAtRevoke + normalized.revokedSeconds !== normalized.durationSeconds ||
        normalized.revokedAt === null || !normalized.revokedBy || !normalized.revokeReason || !normalized.revokeTransactionId
      ) {
        throw createMembershipGrantIntegrityError()
      }
      return normalized
    })

    const activeGrants = normalizedGrants
      .filter((candidate) => candidate.status === 'granted')
      .sort((left, right) => Date.parse(left.effectiveStartAt) - Date.parse(right.effectiveStartAt) || Number(left.id) - Number(right.id))
    if (!activeGrants.length) throw createMembershipGrantIntegrityError()
    const grantIds = new Set()
    const idempotencyKeys = new Set()
    const sourceKeys = new Set()
    const grantTransactionIds = new Set()
    for (const candidate of normalizedGrants) {
      const sourceKey = `${candidate.sourceType}\u0000${candidate.sourceId}`
      if (grantIds.has(candidate.id) || idempotencyKeys.has(candidate.idempotencyKey) || sourceKeys.has(sourceKey) ||
          (candidate.grantTransactionId && grantTransactionIds.has(candidate.grantTransactionId))) {
        throw createMembershipGrantIntegrityError()
      }
      grantIds.add(candidate.id)
      idempotencyKeys.add(candidate.idempotencyKey)
      sourceKeys.add(sourceKey)
      if (candidate.grantTransactionId) grantTransactionIds.add(candidate.grantTransactionId)
    }
    for (let index = 0; index < activeGrants.length; index += 1) {
      const candidate = activeGrants[index]
      const previousEnd = index === 0 ? 0 : Date.parse(activeGrants[index - 1].effectiveEndAt)
      const candidateStart = Date.parse(candidate.effectiveStartAt)
      if (candidateStart < previousEnd) throw createMembershipGrantIntegrityError()
      if (candidate.sourceType !== 'legacy_membership' && candidateStart !== Math.max(Date.parse(candidate.grantedAt), previousEnd)) {
        throw createMembershipGrantIntegrityError()
      }
    }
    const grant = activeGrants.find((candidate) => candidate.id === grantId)
    if (!grant || grant.sourceType !== sourceType || grant.sourceId !== sourceId ||
        grant.idempotencyKey !== idempotencyKey || grant.redemptionCodeId !== null ||
        grant.grantTransactionId !== expectedTransactionId || grant.daysGranted !== MEMBERSHIP_GRANT_DAYS ||
        grant.durationSeconds !== MEMBERSHIP_GRANT_DURATION_SECONDS) {
      throw createMembershipGrantIntegrityError()
    }
    const entitlementRow = entitlementRows[0]
    const entitlement = {
      id: strictSafePositiveId(entitlementRow.id),
      userId: strictSafePositiveId(entitlementRow.user_id),
      quotaBalance: strictUnsignedInteger(entitlementRow.quota_balance),
      quotaTotalGranted: strictUnsignedInteger(entitlementRow.quota_total_granted),
      quotaTotalConsumed: strictUnsignedInteger(entitlementRow.quota_total_consumed),
      quotaTotalExpired: strictUnsignedInteger(entitlementRow.quota_total_expired),
      membershipType: strictRequiredText(entitlementRow.membership_type, 32),
      membershipStatus: strictRequiredText(entitlementRow.membership_status, 32),
      membershipStartedAt: strictDatabaseDate(entitlementRow.membership_started_at),
      membershipExpireAt: strictDatabaseDate(entitlementRow.membership_expire_at),
      lastTransactionId: entitlementRow.last_transaction_id === null ? null : strictSafePositiveId(entitlementRow.last_transaction_id),
      createdAt: strictDatabaseDate(entitlementRow.created_at),
      updatedAt: strictDatabaseDate(entitlementRow.updated_at)
    }
    const targetHistoricalWindow = getContinuousMembershipWindow(activeGrants, grant.id)
    if (!targetHistoricalWindow.grants.some((candidate) => candidate.id === grant.id)) {
      throw createMembershipGrantIntegrityError()
    }
    const currentMembershipWindow = getCurrentMembershipWindow(activeGrants)
    const rebuiltStartAt = currentMembershipWindow.startedAt
    const rebuiltExpireAt = currentMembershipWindow.expireAt
    if (entitlement.userId !== userId || entitlement.membershipType !== 'monthly' ||
        entitlement.membershipStatus !== 'active' || entitlement.membershipStartedAt !== rebuiltStartAt ||
        entitlement.membershipExpireAt !== rebuiltExpireAt) {
      throw createMembershipGrantIntegrityError()
    }

    const ledgerTransactionIds = new Set()
    const ledgerIdempotencyKeys = new Set()
    const normalizedTransactions = transactionRows.map((transactionRow) => {
      if (!transactionRow || typeof transactionRow !== 'object') throw createMembershipGrantIntegrityError()
      const transactionType = strictRequiredText(transactionRow.transaction_type, MAX_TRANSACTION_TYPE_LENGTH)
      if (!ENTITLEMENT_TRANSACTION_TYPE_VALUES.has(transactionType) || !ENTITLEMENT_LEDGER_EFFECTS.has(transactionType)) {
        throw createMembershipGrantIntegrityError()
      }
      const transaction = {
        id: strictSafePositiveId(transactionRow.id),
        transactionId: strictRequiredText(transactionRow.transaction_id, 64),
        userId: strictSafePositiveId(transactionRow.user_id),
        transactionType,
        amount: strictSignedInteger(transactionRow.amount),
        balanceAfter: strictUnsignedInteger(transactionRow.balance_after),
        source: strictRequiredText(transactionRow.source, MAX_SOURCE_LENGTH),
        sourceId: strictNullableText(transactionRow.source_id, MAX_ID_LENGTH),
        expiresAt: strictDatabaseDate(transactionRow.expires_at, true),
        grantTransactionId: transactionRow.grant_transaction_id === null ? null : strictSafePositiveId(transactionRow.grant_transaction_id),
        rootLearningObjectId: strictNullableText(transactionRow.root_learning_object_id, MAX_ID_LENGTH),
        currentLearningObjectId: strictNullableText(transactionRow.current_learning_object_id, MAX_ID_LENGTH),
        accessContext: strictNullableJsonObject(transactionRow.access_context_json),
        idempotencyKey: strictRequiredText(transactionRow.idempotency_key, MAX_ID_LENGTH),
        operatorType: strictRequiredText(transactionRow.operator_type, MAX_OPERATOR_TYPE_LENGTH),
        operatorId: strictNullableText(transactionRow.operator_id, MAX_ID_LENGTH),
        reason: strictNullableText(transactionRow.reason, MAX_REASON_LENGTH),
        metadata: strictNullableJsonObject(transactionRow.metadata_json),
        createdAt: strictDatabaseDate(transactionRow.created_at)
      }
      if (transaction.userId !== userId || ledgerTransactionIds.has(transaction.transactionId) ||
          ledgerIdempotencyKeys.has(transaction.idempotencyKey)) {
        throw createMembershipGrantIntegrityError()
      }
      ledgerTransactionIds.add(transaction.transactionId)
      ledgerIdempotencyKeys.add(transaction.idempotencyKey)
      return transaction
    })
    let ledgerBalance = 0
    let ledgerTotalGranted = 0
    let ledgerTotalConsumed = 0
    let ledgerTotalExpired = 0
    let previousCreatedAt = null
    let previousTransactionId = null
    for (const transaction of normalizedTransactions) {
      const createdAt = Date.parse(transaction.createdAt)
      if (previousCreatedAt !== null && (
        createdAt < previousCreatedAt ||
        (createdAt === previousCreatedAt && BigInt(transaction.id) <= BigInt(previousTransactionId))
      )) {
        throw createMembershipGrantIntegrityError()
      }
      const expectedBalance = ledgerBalance + transaction.amount
      if (!Number.isSafeInteger(expectedBalance) || expectedBalance < 0 || transaction.balanceAfter !== expectedBalance) {
        throw createMembershipGrantIntegrityError()
      }
      const effect = ENTITLEMENT_LEDGER_EFFECTS.get(transaction.transactionType)
      if (
        (effect.sign === 'positive' && transaction.amount <= 0) ||
        (effect.sign === 'negative' && transaction.amount >= 0) ||
        (effect.sign === 'zero' && transaction.amount !== 0)
      ) {
        throw createMembershipGrantIntegrityError()
      }
      if (effect.granted) ledgerTotalGranted += transaction.amount
      if (effect.consumed) ledgerTotalConsumed += -transaction.amount
      if (effect.expired) ledgerTotalExpired += -transaction.amount
      if (
        !Number.isSafeInteger(ledgerTotalGranted) || !Number.isSafeInteger(ledgerTotalConsumed) ||
        !Number.isSafeInteger(ledgerTotalExpired)
      ) {
        throw createMembershipGrantIntegrityError()
      }
      ledgerBalance = transaction.balanceAfter
      previousCreatedAt = createdAt
      previousTransactionId = transaction.id
    }
    if (ledgerBalance !== entitlement.quotaBalance || ledgerTotalGranted !== entitlement.quotaTotalGranted ||
        ledgerTotalConsumed !== entitlement.quotaTotalConsumed || ledgerTotalExpired !== entitlement.quotaTotalExpired ||
        entitlement.lastTransactionId !== normalizedTransactions[normalizedTransactions.length - 1].id) {
      throw createMembershipGrantIntegrityError()
    }

    const matchingTransactions = normalizedTransactions.filter((candidate) => candidate.idempotencyKey === idempotencyKey)
    if (matchingTransactions.length !== 1) throw createMembershipGrantIntegrityError()
    const transaction = matchingTransactions[0]
    const transactionRow = transactionRows.find((candidate) => String(candidate.id) === transaction.id)
    if (!transactionRow) throw createMembershipGrantIntegrityError()
    const metadata = strictJsonObject(transactionRow.metadata_json)
    const metadataKeys = Object.keys(metadata).sort()
    const expectedMetadataKeys = [
      'daysGranted', 'durationRule', 'durationSeconds', 'effectiveEndAt',
      'effectiveStartAt', 'membershipGrantId', 'membershipType'
    ].sort()
    transaction.metadata = metadata
    if (transaction.transactionId !== expectedTransactionId || transaction.userId !== userId ||
        transaction.transactionType !== ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_GRANT || transaction.amount !== 0 ||
        transaction.source !== sourceType ||
        transaction.sourceId !== sourceId || transaction.expiresAt !== null || transaction.grantTransactionId !== null ||
        transaction.rootLearningObjectId !== null || transaction.currentLearningObjectId !== null ||
        transaction.accessContext !== null || transaction.idempotencyKey !== idempotencyKey ||
        transaction.operatorType !== 'system' || transaction.operatorId !== 'virtual-payment-entitlement' ||
        transaction.reason !== 'Verified WeChat virtual payment membership grant.' ||
        metadataKeys.length !== expectedMetadataKeys.length || metadataKeys.some((key, index) => key !== expectedMetadataKeys[index]) ||
        metadata.membershipGrantId !== grantId || metadata.membershipType !== 'monthly' ||
        metadata.daysGranted !== MEMBERSHIP_GRANT_DAYS || metadata.durationSeconds !== MEMBERSHIP_GRANT_DURATION_SECONDS ||
        metadata.effectiveStartAt !== grant.effectiveStartAt || metadata.effectiveEndAt !== grant.effectiveEndAt ||
        metadata.durationRule !== '30x24_hours_not_calendar_month') {
      throw createMembershipGrantIntegrityError()
    }
    return createMembershipGrantResult(grant, transaction, entitlement, true)
  }

  async function recoverMembershipGrantAfterDuplicate(input = {}) {
    const userId = normalizeUserId(input.userId)
    const sourceType = normalizeMembershipSourceType(input.sourceType)
    const sourceId = normalizeRequiredSourceId(input.sourceId)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const redemptionCodeId = normalizeOptionalSafePositiveIntegerId(
      input.redemptionCodeId,
      'Redemption code id',
      'REDEMPTION_CODE_ID_INVALID'
    )
    const recoveryConnection = await getPool().getConnection()
    let result = null
    let recoveryError = null
    try {
      let existingGrant = await findMembershipGrantByIdempotencyKey(recoveryConnection, idempotencyKey)
      if (!existingGrant) {
        const existingBySource = await findMembershipGrantBySource(recoveryConnection, sourceType, sourceId)
        if (existingBySource && existingBySource.idempotencyKey !== idempotencyKey) {
          throw createUserEntitlementStoreError('Membership source is already used by another grant request.', {
            code: 'MEMBERSHIP_SOURCE_CONFLICT',
            statusCode: 409
          })
        }
        existingGrant = existingBySource
      }
      const existingTransaction = await findTransactionByIdempotencyKey(recoveryConnection, idempotencyKey)
      if (!existingGrant && !existingTransaction) {
        throw createUserEntitlementStoreError('Concurrent membership grant could not be reconciled.', {
          code: 'MEMBERSHIP_GRANT_CONFLICT',
          statusCode: 409
        })
      }
      assertMembershipGrantReplay(existingGrant, existingTransaction, {
        userId,
        sourceType,
        sourceId,
        idempotencyKey,
        redemptionCodeId
      })
      const entitlement = await findUserEntitlement(recoveryConnection, userId)
      result = createMembershipGrantResult(existingGrant, existingTransaction, entitlement, true)
    } catch (error) {
      recoveryError = error
    }

    let releaseError = null
    try {
      recoveryConnection.release()
    } catch (error) {
      releaseError = error
    }
    if (recoveryError) throw recoveryError
    if (releaseError) throw releaseError
    return result
  }

  async function grantMembershipDuration(input = {}) {
    const connection = await getPool().getConnection()
    let transactionStarted = false
    let transactionCommitted = false
    try {
      await connection.beginTransaction()
      transactionStarted = true
      const result = await grantMembershipDurationInTransaction(connection, input)
      await connection.commit()
      transactionStarted = false
      transactionCommitted = true
      connection.release()
      return result
    } catch (primaryError) {
      if (transactionCommitted) throw primaryError

      let rollbackCompleted = false
      let errorToThrow = primaryError
      if (transactionStarted) {
        try {
          await connection.rollback()
          transactionStarted = false
          rollbackCompleted = true
        } catch (rollbackError) {
          errorToThrow = rollbackError
        }
      }

      let releaseCompleted = false
      try {
        connection.release()
        releaseCompleted = true
      } catch {
        // A release failure is secondary to the existing database or rollback error.
      }
      if (!isDuplicateEntryError(primaryError) || !rollbackCompleted || !releaseCompleted) {
        throw errorToThrow
      }
      return await recoverMembershipGrantAfterDuplicate(input)
    }
  }

  async function grantMembership(input = {}) {
    rejectUnsupportedLegacyMembershipParameters(input)
    normalizeMembershipSourceType(input.sourceType)
    normalizeRequiredSourceId(input.sourceId)
    normalizeIdempotencyKey(input.idempotencyKey)
    normalizeMembershipOperatorType(input.operatorType)
    normalizeMembershipOperatorId(input.operatorId)
    normalizeRequiredReason(input.reason)
    return await grantMembershipDuration({
      ...input,
      membershipType: 'monthly'
    })
  }

  async function revokeMembershipGrant(input = {}) {
    const grantId = normalizeRequiredString(input.grantId, 'Membership grant id', 'MEMBERSHIP_GRANT_ID_REQUIRED', {
      maxLength: MAX_ID_LENGTH
    })
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    const operatorType = normalizeMembershipOperatorType(input.operatorType)
    const operatorId = normalizeMembershipOperatorId(input.operatorId)
    const reason = normalizeRequiredReason(input.reason)
    const currentTime = normalizeDate(input.now === undefined ? now() : input.now, 'Membership revoke time', 'MEMBERSHIP_REVOKE_TIME_INVALID')

    const connection = await getPool().getConnection()
    let targetHint = null
    let transactionStarted = false
    try {
      // This minimal hint read is deliberately outside the transaction. It only selects the
      // user whose entitlement and FIFO grant set must be locked; it is never a final state read.
      targetHint = await findMembershipGrantHint(connection, grantId)
      if (!targetHint) {
        throw createUserEntitlementStoreError('Membership grant was not found.', {
          code: 'MEMBERSHIP_GRANT_NOT_FOUND',
          statusCode: 404
        })
      }

      await connection.beginTransaction()
      transactionStarted = true
      const entitlement = await ensureUserEntitlementInTransaction(connection, targetHint.userId)
      const grants = await listUserMembershipGrants(connection, targetHint.userId, { forUpdate: true })
      const targetGrant = grants.find((grant) => grant.id === grantId)
      if (!targetGrant || targetGrant.userId !== targetHint.userId) {
        throw createUserEntitlementStoreError('Membership grant changed during lock acquisition.', {
          code: 'MEMBERSHIP_GRANT_LOCK_INCONSISTENT',
          statusCode: 409
        })
      }

      const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey, { forUpdate: true })
      if (existingTransaction) {
        const replay = restoreMembershipRevokeReplay(existingTransaction, targetGrant)
        await connection.commit()
        return replay
      }

      if (targetGrant.status === 'revoked') {
        await connection.commit()
        return {
          grantId: targetGrant.id,
          idempotent: false,
          alreadyRevoked: true,
          usedSeconds: targetGrant.consumedSecondsAtRevoke,
          revokedSeconds: targetGrant.revokedSeconds,
          membershipExpireAt: entitlement.membershipExpireAt,
          membershipStatus: entitlement.membershipStatus
        }
      }

      const schedule = revokeMembershipGrantSchedule({
        now: currentTime,
        grants,
        targetGrantId: targetGrant.id
      })
      const transactionId = normalizeTransactionId(input.transactionId)
      const transactionInsertId = await insertTransaction(connection, {
        transactionId,
        userId: targetGrant.userId,
        transactionType: ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_REVOKE,
        amount: 0,
        balanceAfter: entitlement.quotaBalance,
        source: 'membership_grant_revoke',
        sourceId: targetGrant.id,
        expiresAt: null,
        idempotencyKey,
        operatorType,
        operatorId,
        reason,
        metadataJson: normalizeJson({
          membershipGrantId: targetGrant.id,
          sourceType: targetGrant.sourceType,
          sourceId: targetGrant.sourceId,
          usedSeconds: schedule.usedSeconds,
          revokedSeconds: schedule.revokedSeconds,
          membershipExpireAtBefore: schedule.membershipExpireAtBefore,
          membershipExpireAtAfter: schedule.membershipExpireAt,
          membershipStatus: schedule.membershipStatus,
          shortened: Boolean(schedule.shortened),
          alreadyRevoked: false,
          reason,
          operatorType,
          operatorId
        }, 'Metadata', 'METADATA_INVALID')
      })

      const [targetUpdateResult] = await connection.execute(
        `UPDATE ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
            SET status = 'revoked',
                effective_start_at = ?,
                effective_end_at = ?,
                consumed_seconds_at_revoke = ?,
                revoked_seconds = ?,
                revoked_at = ?,
                revoked_by = ?,
                revoke_reason = ?,
                revoke_transaction_id = ?
          WHERE id = ? AND user_id = ? AND status = 'granted'`,
        [
          new Date(schedule.targetUpdate.effectiveStartAt),
          new Date(schedule.targetUpdate.effectiveEndAt),
          schedule.usedSeconds,
          schedule.revokedSeconds,
          currentTime,
          operatorId,
          reason,
          transactionId,
          targetGrant.id,
          targetGrant.userId
        ]
      )
      assertSingleRowUpdate(targetUpdateResult, 'membership grant revoke target')

      for (const rescheduledGrant of schedule.rescheduleUpdates) {
        const [rescheduleUpdateResult] = await connection.execute(
          `UPDATE ${quoteIdentifier(MEMBERSHIP_GRANTS_TABLE)}
              SET effective_start_at = ?, effective_end_at = ?
            WHERE id = ? AND user_id = ? AND status = 'granted'`,
          [
            new Date(rescheduledGrant.effectiveStartAt),
            new Date(rescheduledGrant.effectiveEndAt),
            rescheduledGrant.id,
            targetGrant.userId
          ]
        )
        assertSingleRowUpdate(rescheduleUpdateResult, 'membership grant FIFO reschedule')
      }

      const membershipStartedAt = schedule.grants.length ? schedule.grants[0].effectiveStartAt : null
      const membershipType = entitlement.membershipType && entitlement.membershipType !== 'none'
        ? entitlement.membershipType
        : 'monthly'
      const [snapshotUpdateResult] = await connection.execute(
        `UPDATE ${quoteIdentifier(USER_ENTITLEMENTS_TABLE)}
            SET membership_type = ?,
                membership_status = ?,
                membership_started_at = ?,
                membership_expire_at = ?,
                last_transaction_id = ?
          WHERE user_id = ?`,
        [
          membershipType,
          schedule.membershipStatus,
          membershipStartedAt ? new Date(membershipStartedAt) : null,
          schedule.membershipExpireAt ? new Date(schedule.membershipExpireAt) : null,
          transactionInsertId,
          targetGrant.userId
        ]
      )
      assertSingleRowUpdate(snapshotUpdateResult, 'membership revoke entitlement snapshot')

      await connection.commit()
      return {
        grantId: targetGrant.id,
        idempotent: false,
        alreadyRevoked: false,
        usedSeconds: schedule.usedSeconds,
        revokedSeconds: schedule.revokedSeconds,
        membershipExpireAtBefore: schedule.membershipExpireAtBefore,
        membershipExpireAt: schedule.membershipExpireAt,
        membershipStatus: schedule.membershipStatus,
        shortened: schedule.shortened
      }
    } catch (error) {
      if (transactionStarted) await connection.rollback()
      if (isDuplicateEntryError(error)) {
        const existingGrant = await findMembershipGrantById(connection, grantId)
        const existingTransaction = await findTransactionByIdempotencyKey(connection, idempotencyKey)
        if (existingTransaction) return restoreMembershipRevokeReplay(existingTransaction, existingGrant)
        throw createUserEntitlementStoreError('Concurrent membership revoke could not be reconciled.', {
          code: 'MEMBERSHIP_REVOKE_CONCURRENT_CONFLICT',
          statusCode: 409
        })
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
    lockMembershipScheduleInTransaction,
    verifyMembershipGrantInTransaction,
    grantMembershipDurationInTransaction,
    grantMembershipDuration,
    grantMembership,
    revokeMembershipGrant,
    deductQuota,
    consumeQuota
  }
}
