import crypto from 'crypto'
import { lstat } from 'node:fs/promises'

const ENABLED_VALUE = 'true'
const FILE_SWITCH_PATH = '/home/ubuntu/.identity-conflict-diagnostic-enabled'
const MEMBERSHIP_TRANSACTION_TYPES = [
  'TAOBAO_BOOK_MEMBERSHIP_GRANT',
  'MEMBERSHIP_ACTIVATED',
  'MEMBERSHIP_GRANT',
  'MEMBERSHIP_REVOKE',
  'LEGACY_MEMBERSHIP_BASELINE'
]
const EXACT_REGISTRATION_ENTITLEMENT_SQL = `(
  quota_balance <=> 30
  AND quota_total_granted <=> 30
  AND quota_total_consumed <=> 0
  AND quota_total_expired <=> 0
  AND BINARY membership_type <=> BINARY 'none'
  AND BINARY membership_status <=> BINARY 'none'
  AND membership_started_at IS NULL
  AND membership_expire_at IS NULL
  AND last_transaction_id IS NOT NULL
)`
const EXACT_REGISTRATION_TRANSACTION_SQL = `(
  BINARY transaction_type <=> BINARY 'REGISTER_BONUS'
  AND amount <=> 30
  AND balance_after <=> 30
  AND BINARY source <=> BINARY 'registration'
  AND BINARY source_id <=> BINARY ?
  AND expires_at IS NOT NULL
  AND grant_transaction_id IS NULL
  AND root_learning_object_id IS NULL
  AND current_learning_object_id IS NULL
  AND access_context_json IS NULL
  AND BINARY idempotency_key <=> BINARY CONCAT('registration_bonus:', ?)
  AND BINARY operator_type <=> BINARY 'system'
  AND BINARY operator_id <=> BINARY 'auth-registration'
  AND BINARY reason <=> BINARY 'Registration bonus complete-content access quota.'
  AND metadata_json IS NULL
)`

function normalizeString(value) {
  return String(value || '').trim()
}

function toCount(value) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid diagnostic count.')
  }
  return count
}

function toBoolean(value) {
  return value ? 'True' : 'False'
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function isIdentityConflictDiagnosticSwitchFileEnabled(options = {}) {
  const lstatFile = options.lstat || lstat
  try {
    const stats = await lstatFile(FILE_SWITCH_PATH)
    return Boolean(
      stats &&
      typeof stats.isSymbolicLink === 'function' &&
      !stats.isSymbolicLink() &&
      typeof stats.isFile === 'function' &&
      stats.isFile() &&
      stats.size === 0
    )
  } catch {
    return false
  }
}

async function executeSelect(connection, sql, values) {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('Diagnostic query must be SELECT.')
  }
  const [rows] = await connection.execute(sql, values)
  return Array.isArray(rows) ? rows : []
}

async function collectBindingCounts(connection, aUserId, bUserId) {
  const rows = await executeSelect(
    connection,
    `SELECT
       (SELECT COUNT(*) FROM wechat_user_bindings WHERE user_id = ?) AS a_wechat_binding_count,
       (SELECT COUNT(*) FROM wechat_user_bindings WHERE user_id = ?) AS b_wechat_binding_count,
       (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id = ? AND status = 'active') AS a_active_phone_binding_count,
       (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id = ? AND status = 'active') AS b_active_phone_binding_count`,
    [aUserId, bUserId, aUserId, bUserId]
  )
  const row = rows[0] || {}
  return {
    aWechatBindingCount: toCount(row.a_wechat_binding_count),
    bWechatBindingCount: toCount(row.b_wechat_binding_count),
    aActivePhoneBindingCount: toCount(row.a_active_phone_binding_count),
    bActivePhoneBindingCount: toCount(row.b_active_phone_binding_count)
  }
}

async function collectBUnionids(connection, bUserId) {
  const rows = await executeSelect(
    connection,
    `SELECT unionid
       FROM wechat_user_bindings
      WHERE user_id = ?`,
    [bUserId]
  )
  return [...new Set(rows.map((row) => normalizeString(row && row.unionid)).filter(Boolean))]
}

async function collectBusinessSummary(connection, userId) {
  const rows = await executeSelect(
    connection,
    `SELECT
       (SELECT COUNT(*)
          FROM user_entitlements
         WHERE user_id = ?) AS entitlement_row_count,
       (SELECT COUNT(*)
          FROM user_entitlements
         WHERE user_id = ?
           AND ${EXACT_REGISTRATION_ENTITLEMENT_SQL}) AS exact_registration_entitlement_count,
       (SELECT COUNT(*)
          FROM user_entitlements
         WHERE user_id = ?
           AND NOT ${EXACT_REGISTRATION_ENTITLEMENT_SQL}) AS real_entitlement_snapshot_count,
       (SELECT COUNT(*)
          FROM user_entitlements
         WHERE user_id = ?
           AND (NOT (BINARY membership_type <=> BINARY 'none')
             OR NOT (BINARY membership_status <=> BINARY 'none')
             OR membership_started_at IS NOT NULL
             OR membership_expire_at IS NOT NULL)) AS entitlement_membership_count,
       (SELECT COUNT(*)
          FROM entitlement_transactions
         WHERE user_id = ?) AS entitlement_transaction_count,
       (SELECT COUNT(*)
          FROM entitlement_transactions
         WHERE user_id = ?
           AND ${EXACT_REGISTRATION_TRANSACTION_SQL}) AS registration_transaction_count,
       (SELECT COUNT(*)
          FROM entitlement_transactions
         WHERE user_id = ?
           AND NOT ${EXACT_REGISTRATION_TRANSACTION_SQL}) AS real_entitlement_transaction_count,
       (SELECT COUNT(*)
          FROM entitlement_transactions
         WHERE user_id = ?
           AND transaction_type IN (?, ?, ?, ?, ?)) AS membership_transaction_count,
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = ?) AS membership_grant_count,
       (SELECT COUNT(*) FROM user_favorites WHERE user_id = ?) AS favorite_count,
       (SELECT COUNT(*) FROM user_recent_words WHERE user_id = ?) AS recent_word_count,
       (SELECT COUNT(*) FROM book_benefit_redemptions WHERE redeemer_user_id = ?) AS book_redemption_count`,
    [
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      ...MEMBERSHIP_TRANSACTION_TYPES,
      userId,
      userId,
      userId,
      userId
    ]
  )
  const row = rows[0] || {}
  const entitlementRowCount = toCount(row.entitlement_row_count)
  const exactRegistrationEntitlementCount = toCount(row.exact_registration_entitlement_count)
  const realEntitlementSnapshotCount = toCount(row.real_entitlement_snapshot_count)
  const entitlementMembershipCount = toCount(row.entitlement_membership_count)
  const entitlementTransactionCount = toCount(row.entitlement_transaction_count)
  const registrationTransactionCount = toCount(row.registration_transaction_count)
  const realEntitlementTransactionCount = toCount(row.real_entitlement_transaction_count)
  const membershipTransactionCount = toCount(row.membership_transaction_count)
  const membershipGrantCount = toCount(row.membership_grant_count)
  const favoriteCount = toCount(row.favorite_count)
  const recentWordCount = toCount(row.recent_word_count)
  const bookRedemptionCount = toCount(row.book_redemption_count)
  const hasMembership =
    entitlementMembershipCount > 0 ||
    membershipTransactionCount > 0 ||
    membershipGrantCount > 0
  const hasRealEntitlementActivity =
    realEntitlementSnapshotCount > 0 ||
    realEntitlementTransactionCount > 0 ||
    membershipGrantCount > 0
  const registrationInitializationOnly =
    entitlementRowCount === 1 &&
    exactRegistrationEntitlementCount === 1 &&
    entitlementTransactionCount === 1 &&
    registrationTransactionCount === 1 &&
    membershipGrantCount === 0 &&
    favoriteCount === 0 &&
    recentWordCount === 0 &&
    bookRedemptionCount === 0

  return {
    registrationInitializationOnly,
    hasRealEntitlementActivity,
    hasMembership,
    favoriteCount,
    recentWordCount,
    bookRedemptionCount
  }
}

function compareUnionids(aUnionid, bUnionids) {
  if (!aUnionid || bUnionids.length !== 1) return 'Unknown'
  return aUnionid === bUnionids[0] ? 'True' : 'False'
}

function formatDiagnosticLine(marker, bindingCounts, unionids, aBusiness, bBusiness) {
  if (!isUuid(marker)) throw new Error('Invalid diagnostic marker.')
  const fields = [
    ['OPERATION_MARKER', marker],
    ['CONFLICT_CONFIRMED', 'True'],
    ['A_EQUALS_B', 'False'],
    ['A_WECHAT_BINDING_COUNT', bindingCounts.aWechatBindingCount],
    ['B_WECHAT_BINDING_COUNT', bindingCounts.bWechatBindingCount],
    ['A_ACTIVE_PHONE_BINDING_COUNT', bindingCounts.aActivePhoneBindingCount],
    ['B_ACTIVE_PHONE_BINDING_COUNT', bindingCounts.bActivePhoneBindingCount],
    ['A_UNIONID_PRESENT', toBoolean(Boolean(unionids.aUnionid))],
    ['B_UNIONID_PRESENT', toBoolean(unionids.bUnionids.length > 0)],
    ['UNIONID_EQUAL', compareUnionids(unionids.aUnionid, unionids.bUnionids)],
    ['A_REGISTRATION_INITIALIZATION_ONLY', toBoolean(aBusiness.registrationInitializationOnly)],
    ['B_REGISTRATION_INITIALIZATION_ONLY', toBoolean(bBusiness.registrationInitializationOnly)],
    ['A_HAS_REAL_ENTITLEMENT_ACTIVITY', toBoolean(aBusiness.hasRealEntitlementActivity)],
    ['B_HAS_REAL_ENTITLEMENT_ACTIVITY', toBoolean(bBusiness.hasRealEntitlementActivity)],
    ['A_HAS_MEMBERSHIP', toBoolean(aBusiness.hasMembership)],
    ['B_HAS_MEMBERSHIP', toBoolean(bBusiness.hasMembership)],
    ['A_FAVORITE_COUNT', aBusiness.favoriteCount],
    ['B_FAVORITE_COUNT', bBusiness.favoriteCount],
    ['A_RECENT_WORD_COUNT', aBusiness.recentWordCount],
    ['B_RECENT_WORD_COUNT', bBusiness.recentWordCount],
    ['A_BOOK_REDEMPTION_COUNT', aBusiness.bookRedemptionCount],
    ['B_BOOK_REDEMPTION_COUNT', bBusiness.bookRedemptionCount]
  ]
  return `IDENTITY_CONFLICT_DIAGNOSTIC ${fields.map(([key, value]) => `${key}=${value}`).join(' ')}`
}

export function createIdentityConflictDiagnostic(options = {}) {
  const env = options.env || process.env
  const fileSwitchChecker = options.fileSwitchChecker || isIdentityConflictDiagnosticSwitchFileEnabled
  const logger = options.logger || console.warn
  const randomUUID = options.randomUUID || (() => crypto.randomUUID())
  let claimed = false

  async function collect(connection, input = {}) {
    if (claimed) return null
    const aUserId = normalizeString(input.aUserId)
    const bUserId = normalizeString(input.bUserId)
    if (!aUserId || !bUserId || aUserId === bUserId) return null
    const envEnabled = env.IDENTITY_CONFLICT_DIAGNOSTIC_ENABLED === ENABLED_VALUE
    if (!envEnabled) {
      let fileEnabled = false
      try {
        fileEnabled = await fileSwitchChecker() === true
      } catch {
        fileEnabled = false
      }
      if (!fileEnabled || claimed) return null
    }
    if (claimed) return null
    claimed = true

    try {
      const marker = randomUUID()
      const aUnionid = normalizeString(input.requestUnionid || input.aStoredUnionid)
      const bindingCounts = await collectBindingCounts(connection, aUserId, bUserId)
      const bUnionids = await collectBUnionids(connection, bUserId)
      const aBusiness = await collectBusinessSummary(connection, aUserId)
      const bBusiness = await collectBusinessSummary(connection, bUserId)
      return {
        marker,
        line: formatDiagnosticLine(
          marker,
          bindingCounts,
          { aUnionid, bUnionids },
          aBusiness,
          bBusiness
        )
      }
    } catch {
      return null
    }
  }

  async function emit(diagnostic) {
    if (!diagnostic || !isUuid(diagnostic.marker) || typeof diagnostic.line !== 'string') return null
    const expectedPrefix = `IDENTITY_CONFLICT_DIAGNOSTIC OPERATION_MARKER=${diagnostic.marker} `
    if (!diagnostic.line.startsWith(expectedPrefix)) return null
    try {
      await logger(diagnostic.line)
      return diagnostic.marker
    } catch {
      // Diagnostic logging must never change the existing conflict response.
      return null
    }
  }

  return {
    collect,
    emit
  }
}
