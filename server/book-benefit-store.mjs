import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

import {
  createManualExceptionIssuanceClaimHash,
  createStandardOrderClaimHash
} from './book-benefit-foundation.mjs'
import {
  generateBookBenefitRedemptionCode,
  hashBookBenefitRedemptionCode,
  normalizeBookBenefitRedemptionCode
} from './book-benefit-code.mjs'
import {
  findCurrentCampaignPhoneIdentityInTransaction
} from './identity-store.mjs'
import { createUserEntitlementStore } from './user-entitlement-store.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const CODE_VALIDITY_MILLISECONDS = 30 * 24 * 60 * 60 * 1000
const REDEMPTION_OPERATOR_ID = 'book-benefit-redemption'
const DEFAULT_BOOK_BENEFIT_CAMPAIGN_KEY = 'book-benefit-30d-v1'
const BOOK_BENEFIT_CAMPAIGN_NAME = '购书用户30天会员福利'
const BOOK_BENEFIT_RULES_VERSION = 'book-benefit-rules-v1'
const MAX_CODE_GENERATION = 3
const MAX_SAFE_ID = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_SAFE_ID_DIGITS = String(Number.MAX_SAFE_INTEGER).length
const ORDER_CLAIM_TYPES = new Set(['standard', 'manual_exception'])
const ORDER_CHANNELS = new Set(['taobao', 'wechat', 'xianyu', 'legacy_offline'])
const SELLER_VERIFICATION_CODES = new Set(['official_store', 'authorized_seller', 'unverified'])
const CUSTOMER_SERVICE_CHANNELS = new Set([
  'miniapp_cs',
  'taobao_cs',
  'xianyu_cs',
  'wechat_official_cs'
])
const MANUAL_EXCEPTION_REASONS = new Set([
  'historical_evidence_unavailable',
  'customer_service_approved_exception'
])
const ALLOWED_ISSUE_INPUT_FIELDS = new Set([
  'orderClaimType',
  'orderChannel',
  'orderNumber',
  'manualExceptionReasonCode',
  'sellerVerificationCode',
  'customerServiceChannel',
  'operatorId',
  'operationId',
  'now'
])
const ALLOWED_REDEMPTION_INPUT_FIELDS = new Set(['userId', 'plaintextCode', 'operationId', 'now'])
const ALLOWED_REPLACEMENT_INPUT_FIELDS = new Set(['codeId', 'operationId', 'reasonCode', 'operatorId', 'now'])
const ALLOWED_ISSUE_STATUS_INPUT_FIELDS = new Set(['operationId'])
const REPLACEMENT_REASON_CODES = new Set(['plaintext_unavailable', 'delivery_failed'])

function createStoreError(message, code = 'BOOK_BENEFIT_STORE_ERROR', statusCode = 500) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function normalizeString(value) {
  return String(value === undefined || value === null ? '' : value).normalize('NFKC').trim()
}

function normalizePositiveId(value, fieldName) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
    }
    return String(value)
  }
  if (typeof value !== 'string') {
    throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized) || normalized.length > MAX_SAFE_ID_DIGITS) {
    throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  const numericValue = BigInt(normalized)
  if (numericValue <= 0n || numericValue > MAX_SAFE_ID) {
    throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  return numericValue.toString()
}

function normalizeWhitelistedValue(value, fieldName, allowedValues) {
  if (typeof value !== 'string') {
    throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  const normalized = normalizeString(value).toLowerCase()
  if (!allowedValues.has(normalized)) {
    throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  return normalized
}

function normalizeIdentifier(value, fieldName, maximumLength) {
  if (typeof value !== 'string') {
    throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  const normalized = normalizeString(value)
  if (!normalized || normalized.length > maximumLength || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/.test(normalized)) {
    throw createStoreError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  return normalized
}

function normalizeOperationId(value) {
  return normalizeIdentifier(value, 'Operation id', 191).toLowerCase()
}

function normalizeNow(value) {
  const date = value === undefined ? new Date() : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw createStoreError('Current time is invalid.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  return date
}

function normalizeIssueInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('Book-benefit issue input is invalid.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  for (const fieldName of Object.keys(input)) {
    if (!ALLOWED_ISSUE_INPUT_FIELDS.has(fieldName)) {
      throw createStoreError('Book-benefit issue input contains an unsupported field.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
    }
  }

  const orderClaimType = normalizeWhitelistedValue(
    input.orderClaimType,
    'Order claim type',
    ORDER_CLAIM_TYPES
  )
  const orderChannel = orderClaimType === 'standard'
    ? normalizeWhitelistedValue(input.orderChannel, 'Order channel', ORDER_CHANNELS)
    : null
  if (orderClaimType === 'standard' && typeof input.orderNumber !== 'string') {
    throw createStoreError('Order number is invalid.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  const orderNumber = orderClaimType === 'standard' ? normalizeString(input.orderNumber) : null
  if (orderClaimType === 'standard' && !orderNumber) {
    throw createStoreError('Order number is required.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  if (orderClaimType === 'manual_exception' && (
    input.orderChannel !== undefined || input.orderNumber !== undefined
  )) {
    throw createStoreError('Manual exception must not include order details.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  if (orderClaimType === 'standard' && input.manualExceptionReasonCode !== undefined) {
    throw createStoreError('Standard order claim must not include a manual reason.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  const sellerVerificationCode = normalizeWhitelistedValue(
    input.sellerVerificationCode,
    'Seller verification code',
    SELLER_VERIFICATION_CODES
  )
  if (orderClaimType === 'standard' && sellerVerificationCode === 'unverified') {
    throw createStoreError('Standard order seller must be verified.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }

  return {
    orderClaimType,
    orderChannel,
    orderNumber,
    manualExceptionReasonCode: orderClaimType === 'manual_exception'
      ? normalizeWhitelistedValue(
        input.manualExceptionReasonCode,
        'Manual exception reason',
        MANUAL_EXCEPTION_REASONS
      )
      : null,
    sellerVerificationCode,
    customerServiceChannel: normalizeWhitelistedValue(
      input.customerServiceChannel,
      'Customer service channel',
      CUSTOMER_SERVICE_CHANNELS
    ),
    operatorId: normalizeIdentifier(input.operatorId, 'Operator id', 191),
    operationId: normalizeOperationId(input.operationId),
    now: normalizeNow(input.now)
  }
}

function normalizeReplacementInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('Book-benefit replacement input is invalid.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  for (const fieldName of Object.keys(input)) {
    if (!ALLOWED_REPLACEMENT_INPUT_FIELDS.has(fieldName)) {
      throw createStoreError('Book-benefit replacement input contains an unsupported field.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
    }
  }
  return {
    codeId: normalizePositiveId(input.codeId, 'Code id'),
    operationId: normalizeOperationId(input.operationId),
    reasonCode: normalizeWhitelistedValue(input.reasonCode, 'Replacement reason', REPLACEMENT_REASON_CODES),
    operatorId: normalizeIdentifier(input.operatorId, 'Operator id', 191),
    now: normalizeNow(input.now)
  }
}

function normalizeIssueStatusInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('Book-benefit issue status input is invalid.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  for (const fieldName of Object.keys(input)) {
    if (!ALLOWED_ISSUE_STATUS_INPUT_FIELDS.has(fieldName)) {
      throw createStoreError('Book-benefit issue status input contains an unsupported field.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
    }
  }
  return { operationId: normalizeOperationId(input.operationId) }
}

function normalizeReplacementGeneration(value) {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value
  } else if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    const parsed = BigInt(value)
    if (parsed <= MAX_SAFE_ID) return Number(parsed)
  }
  throw createStoreError('Book-benefit code generation is invalid.', 'BOOK_BENEFIT_RELATION_INVALID', 409)
}

function normalizeRedemptionInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('Book-benefit redemption input is invalid.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  for (const fieldName of Object.keys(input)) {
    if (!ALLOWED_REDEMPTION_INPUT_FIELDS.has(fieldName)) {
      throw createStoreError('Book-benefit redemption input contains an unsupported field.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
    }
  }
  return {
    userId: normalizePositiveId(input.userId, 'User id'),
    canonicalCode: normalizeBookBenefitRedemptionCode(input.plaintextCode),
    operationId: normalizeOperationId(input.operationId),
    now: normalizeNow(input.now)
  }
}

function getDbConfig(options = {}) {
  const host = normalizeString(options.dbHost === undefined ? process.env.DB_HOST : options.dbHost) || DEFAULT_DB_HOST
  const port = Number(options.dbPort === undefined ? process.env.DB_PORT : options.dbPort) || DEFAULT_DB_PORT
  const database = normalizeString(options.dbName === undefined ? process.env.DB_NAME : options.dbName) || DEFAULT_DB_NAME
  const user = normalizeString(options.dbUser === undefined ? process.env.DB_USER : options.dbUser)
  const configuredPassword = options.dbPassword === undefined ? process.env.DB_PASSWORD : options.dbPassword
  const password = String(configuredPassword || '')
  return { host, port, database, user, password, configured: Boolean(database && user && password) }
}

function stableIdentifier(prefix, domain, operationId, hexLength) {
  const digest = crypto.createHash('sha256').update(`${domain}|${operationId}`, 'utf8').digest('hex')
  return `${prefix}${digest.slice(0, hexLength)}`
}

function issuanceNumber(operationId) {
  return stableIdentifier('BBI-', 'book-benefit-issuance:v1', operationId, 32).toUpperCase()
}

function auditEventId(operationId) {
  return stableIdentifier('bbev_', 'book-benefit-audit:v1', operationId, 59)
}

function redemptionId(operationId) {
  return stableIdentifier('bbr_', 'book-benefit-redemption:v1', operationId, 60)
}

function redemptionAuditEventId(operationId) {
  return stableIdentifier('bbre_', 'book-benefit-redemption-audit:v1', operationId, 59)
}

function membershipTransactionId(operationId) {
  return stableIdentifier('bbrtx_', 'book-benefit-membership-transaction:v1', operationId, 58)
}

function membershipIdempotencyKey(operationId) {
  return stableIdentifier('bbrm_', 'book-benefit-membership-idempotency:v1', operationId, 59)
}

function replacementIssueIdempotencyKey(operationId) {
  return stableIdentifier('bbrp_', 'book-benefit-code-replacement:v1', operationId, 59)
}

function replacementAuditEventId(operationId) {
  return stableIdentifier('bbrpa_', 'book-benefit-code-replacement-audit:v1', operationId, 58)
}

function asDate(value, fieldName) {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw createStoreError(`${fieldName} is invalid.`)
  }
  return date
}

function assertCampaignAvailable(row, campaignId, now) {
  if (!row) {
    throw createStoreError('Book-benefit campaign was not found.', 'BOOK_BENEFIT_CAMPAIGN_NOT_FOUND', 404)
  }
  if (String(row.id) !== campaignId) {
    throw createStoreError('Book-benefit campaign is invalid.')
  }
  if (row.status !== 'active') {
    throw createStoreError('Book-benefit campaign is not active.', 'BOOK_BENEFIT_CAMPAIGN_NOT_ACTIVE', 409)
  }
  if (Number(row.benefit_days) !== 30) {
    throw createStoreError('Book-benefit campaign duration is invalid.', 'BOOK_BENEFIT_CAMPAIGN_INVALID', 409)
  }
  const startsAt = asDate(row.starts_at, 'Campaign start time')
  const endsAt = asDate(row.ends_at, 'Campaign end time')
  if (startsAt && now.getTime() < startsAt.getTime()) {
    throw createStoreError('Book-benefit campaign has not started.', 'BOOK_BENEFIT_CAMPAIGN_NOT_STARTED', 409)
  }
  if (endsAt && now.getTime() >= endsAt.getTime()) {
    throw createStoreError('Book-benefit campaign has ended.', 'BOOK_BENEFIT_CAMPAIGN_ENDED', 409)
  }
}

function assertInsertId(result, entityName) {
  const value = result && result.insertId
  if (value === undefined || value === null || String(value) === '0') {
    throw createStoreError(`${entityName} was not created.`)
  }
  return String(value)
}

function assertSingleRow(result, entityName) {
  if (!result || Number(result.affectedRows) !== 1) {
    throw createStoreError(`${entityName} was not updated.`)
  }
}

function assertBufferIdentity(left, right) {
  return Buffer.isBuffer(left) && left.length === 32 && Buffer.isBuffer(right) &&
    right.length === 32 && left.equals(right)
}

async function findIdempotentIssue(connection, input, options) {
  const [issuanceRows] = await connection.execute(
    `SELECT id, issuance_no, campaign_id, qualification_rules_version,
            order_claim_type, approved_order_claim_hash, order_claim_hash_version,
            order_channel, status, reviewed_by, review_reason_code,
            seller_verification_code, customer_service_channel
       FROM book_benefit_issuances
      WHERE create_idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [input.operationId]
  )
  const issuance = Array.isArray(issuanceRows) && issuanceRows.length ? issuanceRows[0] : null
  if (!issuance) return null
  const campaign = await findConfiguredCampaignForUpdate(connection, options)
  if (
    issuance.status !== 'approved' ||
    String(issuance.campaign_id) !== campaign.campaignId ||
    issuance.qualification_rules_version !== campaign.rulesVersion ||
    issuance.reviewed_by !== input.operatorId ||
    issuance.order_claim_type !== input.orderClaimType ||
    issuance.seller_verification_code !== input.sellerVerificationCode ||
    issuance.customer_service_channel !== input.customerServiceChannel
  ) {
    throw createStoreError('Operation id conflicts with an existing issuance.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }
  let expectedClaim = null
  if (input.orderClaimType === 'standard') {
    expectedClaim = createStandardOrderClaimHash({
      channel: input.orderChannel,
      orderNumber: input.orderNumber
    }, {
      secret: options.orderClaimHashSecret === undefined
        ? process.env.BOOK_ORDER_CLAIM_HASH_SECRET
        : options.orderClaimHashSecret,
      env: options.secretEnv || process.env
    })
    if (
      issuance.order_channel !== expectedClaim.normalizedChannel ||
      issuance.order_claim_hash_version !== expectedClaim.hashVersion ||
      !assertBufferIdentity(issuance.approved_order_claim_hash, expectedClaim.orderClaimHash)
    ) {
      throw createStoreError('Operation id conflicts with an existing issuance.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
  } else {
    expectedClaim = createManualExceptionIssuanceClaimHash({
      campaignId: campaign.campaignId,
      issuanceId: issuance.id
    }, {
      secret: options.orderClaimHashSecret === undefined
        ? process.env.BOOK_ORDER_CLAIM_HASH_SECRET
        : options.orderClaimHashSecret,
      env: options.secretEnv || process.env
    })
    if (
      issuance.review_reason_code !== input.manualExceptionReasonCode ||
      issuance.order_channel !== null ||
      issuance.order_claim_hash_version !== expectedClaim.hashVersion ||
      !assertBufferIdentity(issuance.approved_order_claim_hash, expectedClaim.orderClaimHash)
    ) {
      throw createStoreError('Operation id conflicts with an existing issuance.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
  }

  const [codeRows] = await connection.execute(
    `SELECT id, issuance_id, status, expires_at
       FROM book_benefit_codes
      WHERE issue_idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [input.operationId]
  )
  const code = Array.isArray(codeRows) && codeRows.length ? codeRows[0] : null
  if (!code || String(code.issuance_id) !== String(issuance.id) || code.status !== 'issued') {
    throw createStoreError('Existing code issuance is incomplete.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }
  const [auditRows] = await connection.execute(
    `SELECT id, issuance_id, code_id, event_type, result
       FROM book_benefit_audit_events
      WHERE event_id = ?
      LIMIT 1
      FOR UPDATE`,
    [auditEventId(input.operationId)]
  )
  const audit = Array.isArray(auditRows) && auditRows.length ? auditRows[0] : null
  if (
    !audit ||
    String(audit.issuance_id) !== String(issuance.id) ||
    String(audit.code_id) !== String(code.id) ||
    audit.event_type !== 'unassigned_code_issued' ||
    audit.result !== 'succeeded'
  ) {
    throw createStoreError('Existing code issuance is incomplete.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }
  const codeExpiresAt = asDate(code.expires_at, 'Code expiration time')
  if (!codeExpiresAt) {
    throw createStoreError('Existing code issuance is incomplete.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }
  return {
    issuanceId: String(issuance.id),
    issuanceNo: issuance.issuance_no,
    codeId: String(code.id),
    codeExpiresAt,
    campaignId: campaign.campaignId,
    status: 'ISSUED_CODE_PLAINTEXT_UNAVAILABLE'
  }
}

async function findCampaignForUpdate(connection, campaignId) {
  const [rows] = await connection.execute(
    `SELECT id, status, benefit_days, starts_at, ends_at, rules_version
       FROM book_benefit_campaigns
      WHERE id = ?
      LIMIT 1
      FOR UPDATE`,
    [campaignId]
  )
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

function configuredCampaignKey(options = {}) {
  const value = options.campaignKey === undefined
    ? (options.env || process.env).BOOK_BENEFIT_CAMPAIGN_KEY
    : options.campaignKey
  const key = normalizeString(value) || DEFAULT_BOOK_BENEFIT_CAMPAIGN_KEY
  if (key !== DEFAULT_BOOK_BENEFIT_CAMPAIGN_KEY) {
    throw createStoreError('Configured book-benefit campaign key is invalid.', 'BOOK_BENEFIT_CAMPAIGN_CONFIG_INVALID', 500)
  }
  return key
}

async function findConfiguredCampaignForUpdate(connection, options = {}) {
  const key = configuredCampaignKey(options)
  const [rows] = await connection.execute(
    `SELECT id, campaign_key, name, status, benefit_days, rules_version, starts_at, ends_at
       FROM book_benefit_campaigns
      WHERE campaign_key = ?
      LIMIT 1
      FOR UPDATE`,
    [key]
  )
  return mapConfiguredCampaign(Array.isArray(rows) && rows.length ? rows[0] : null, key)
}

function mapConfiguredCampaign(row, expectedKey) {
  if (!row) {
    throw createStoreError('Configured book-benefit campaign was not found.', 'BOOK_BENEFIT_CAMPAIGN_NOT_FOUND', 404)
  }
  const startsAt = asDate(row.starts_at, 'Campaign start time')
  const endsAt = asDate(row.ends_at, 'Campaign end time')
  if (
    row.campaign_key !== expectedKey ||
    row.name !== BOOK_BENEFIT_CAMPAIGN_NAME ||
    Number(row.benefit_days) !== 30 ||
    row.rules_version !== BOOK_BENEFIT_RULES_VERSION
  ) {
    throw createStoreError('Configured book-benefit campaign is invalid.', 'BOOK_BENEFIT_CAMPAIGN_CONFIG_INVALID', 409)
  }
  return {
    campaignId: String(row.id),
    campaignKey: row.campaign_key,
    name: row.name,
    status: row.status,
    benefitDays: Number(row.benefit_days),
    rulesVersion: row.rules_version,
    startsAt,
    endsAt
  }
}

async function findConfiguredCampaign(connection, options = {}) {
  const key = configuredCampaignKey(options)
  const [rows] = await connection.execute(
    `SELECT id, campaign_key, name, status, benefit_days, rules_version, starts_at, ends_at
       FROM book_benefit_campaigns
      WHERE campaign_key = ?
      LIMIT 1`,
    [key]
  )
  return mapConfiguredCampaign(Array.isArray(rows) && rows.length ? rows[0] : null, key)
}

async function getIssueOperationStatus(connection, input, options) {
  const campaign = await findConfiguredCampaign(connection, options)
  const [issuanceRows] = await connection.execute(
    `SELECT id, issuance_no, campaign_id, status
       FROM book_benefit_issuances
      WHERE create_idempotency_key = ?
      LIMIT 1`,
    [input.operationId]
  )
  const issuance = Array.isArray(issuanceRows) && issuanceRows.length ? issuanceRows[0] : null
  if (!issuance) return { status: 'not_found' }
  const base = {
    issuanceId: String(issuance.id),
    issuanceNo: issuance.issuance_no
  }
  if (String(issuance.campaign_id) !== campaign.campaignId || issuance.status !== 'approved') {
    return { ...base, status: 'inconsistent' }
  }
  const [codeRows] = await connection.execute(
    `SELECT id, issuance_id, status, replacement_code_id, expires_at
       FROM book_benefit_codes
      WHERE issue_idempotency_key = ?
      LIMIT 1`,
    [input.operationId]
  )
  const code = Array.isArray(codeRows) && codeRows.length ? codeRows[0] : null
  const [auditRows] = await connection.execute(
    `SELECT issuance_id, code_id, event_type, result
       FROM book_benefit_audit_events
      WHERE event_id = ?
      LIMIT 1`,
    [auditEventId(input.operationId)]
  )
  const audit = Array.isArray(auditRows) && auditRows.length ? auditRows[0] : null
  if (
    !code || !audit ||
    String(code.issuance_id) !== String(issuance.id) ||
    String(audit.issuance_id) !== String(issuance.id) ||
    String(audit.code_id) !== String(code.id) ||
    audit.event_type !== 'unassigned_code_issued' ||
    audit.result !== 'succeeded'
  ) {
    return { ...base, status: 'inconsistent' }
  }
  let codeExpiresAt = null
  try { codeExpiresAt = asDate(code.expires_at, 'Code expiration time') } catch { /* Inconsistent below. */ }
  const codeBase = { ...base, codeId: String(code.id), codeExpiresAt }
  if (!codeExpiresAt) return { ...codeBase, status: 'inconsistent' }
  if (code.status === 'issued' && code.replacement_code_id === null) {
    return { ...codeBase, status: 'issued_plaintext_unavailable' }
  }
  if (code.status === 'voided' && code.replacement_code_id !== null) {
    const [replacementRows] = await connection.execute(
      `SELECT id, issuance_id, expires_at
         FROM book_benefit_codes
        WHERE id = ?
        LIMIT 1`,
      [code.replacement_code_id]
    )
    const replacement = Array.isArray(replacementRows) && replacementRows.length ? replacementRows[0] : null
    if (!replacement || String(replacement.issuance_id) !== String(issuance.id)) {
      return { ...codeBase, status: 'inconsistent' }
    }
    let replacementExpiresAt = null
    try { replacementExpiresAt = asDate(replacement.expires_at, 'Replacement code expiration time') } catch { /* Inconsistent below. */ }
    if (!replacementExpiresAt) return { ...codeBase, status: 'inconsistent' }
    return {
      ...codeBase,
      codeExpiresAt: replacementExpiresAt,
      replacementCodeId: String(replacement.id),
      status: 'replaced'
    }
  }
  return { ...codeBase, status: 'inconsistent' }
}

async function findReplacementByOperationForUpdate(connection, operationId) {
  const issueKey = replacementIssueIdempotencyKey(operationId)
  const [replacementRows] = await connection.execute(
    `SELECT id, issuance_id, generation_no, status, expires_at, issue_idempotency_key
       FROM book_benefit_codes
      WHERE issue_idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [issueKey]
  )
  const replacement = Array.isArray(replacementRows) && replacementRows.length ? replacementRows[0] : null
  if (!replacement) return null
  const [originalRows] = await connection.execute(
    `SELECT c.id, c.issuance_id, c.generation_no, c.status, c.replacement_code_id,
            c.void_reason_code, i.campaign_id, i.status AS issuance_status,
            p.id AS campaign_record_id, p.status AS campaign_status, p.benefit_days,
            p.starts_at, p.ends_at,
            r.id AS redemption_record_id
       FROM book_benefit_codes c
       JOIN book_benefit_issuances i ON i.id = c.issuance_id
       JOIN book_benefit_campaigns p ON p.id = i.campaign_id
       LEFT JOIN book_benefit_redemptions r ON r.code_id = c.id
      WHERE c.replacement_code_id = ?
      LIMIT 1
      FOR UPDATE`,
    [replacement.id]
  )
  const original = Array.isArray(originalRows) && originalRows.length ? originalRows[0] : null
  return { issueKey, replacement, original }
}

function replacementResult(original, replacement, plaintextCode, status) {
  const result = {
    originalCodeId: String(original.id),
    replacementCodeId: String(replacement.id),
    codeExpiresAt: asDate(replacement.expires_at, 'Replacement code expiration time'),
    issuanceId: String(original.issuance_id),
    campaignId: String(original.campaign_id),
    generationNo: Number(replacement.generation_no),
    status
  }
  if (plaintextCode) result.plaintextCode = plaintextCode
  return result
}

async function replaceIssuedBookBenefitCodeInTransaction(connection, input, options) {
  const replay = await findReplacementByOperationForUpdate(connection, input.operationId)
  if (replay) {
    const { replacement, original } = replay
    const originalGeneration = original
      ? normalizeReplacementGeneration(original.generation_no)
      : null
    const replacementGeneration = normalizeReplacementGeneration(replacement.generation_no)
    if (
      !original ||
      String(original.id) !== input.codeId ||
      original.status !== 'voided' ||
      String(original.replacement_code_id) !== String(replacement.id) ||
      original.void_reason_code !== input.reasonCode ||
      original.redemption_record_id !== null ||
      original.issuance_status !== 'approved' ||
      String(original.campaign_id) !== String(original.campaign_record_id) ||
      Number(original.benefit_days) !== 30 ||
      replacement.status !== 'issued' ||
      String(replacement.issuance_id) !== String(original.issuance_id) ||
      replacementGeneration !== originalGeneration + 1
    ) {
      throw createStoreError('Replacement operation conflicts with an existing record.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
    const [auditRows] = await connection.execute(
      `SELECT issuance_id, code_id, event_type, actor_type, actor_id, result, reason_code
         FROM book_benefit_audit_events
        WHERE event_id = ?
        LIMIT 1
        FOR UPDATE`,
      [replacementAuditEventId(input.operationId)]
    )
    const audit = Array.isArray(auditRows) && auditRows.length ? auditRows[0] : null
    if (
      !audit ||
      String(audit.issuance_id) !== String(original.issuance_id) ||
      String(audit.code_id) !== String(replacement.id) ||
      audit.event_type !== 'issued_code_replaced' ||
      audit.actor_type !== 'admin' ||
      audit.actor_id !== input.operatorId ||
      audit.result !== 'succeeded' ||
      audit.reason_code !== input.reasonCode
    ) {
      throw createStoreError('Replacement operation conflicts with an existing record.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
    return replacementResult(
      original,
      { ...replacement, generation_no: replacementGeneration },
      null,
      'REPLACEMENT_CODE_PLAINTEXT_UNAVAILABLE'
    )
  }

  const [rows] = await connection.execute(
    `SELECT c.id, c.issuance_id, c.generation_no, c.status, c.replacement_code_id,
            i.id AS issuance_record_id, i.campaign_id,
            i.status AS issuance_status, p.id AS campaign_record_id,
            p.status AS campaign_status, p.benefit_days, p.starts_at, p.ends_at,
            c.expires_at, r.id AS redemption_record_id
       FROM book_benefit_codes c
       JOIN book_benefit_issuances i ON i.id = c.issuance_id
       JOIN book_benefit_campaigns p ON p.id = i.campaign_id
       LEFT JOIN book_benefit_redemptions r ON r.code_id = c.id
      WHERE c.id = ?
      LIMIT 1
      FOR UPDATE`,
    [input.codeId]
  )
  const original = Array.isArray(rows) && rows.length ? rows[0] : null
  if (!original) {
    throw createStoreError('Book-benefit code was not found.', 'BOOK_BENEFIT_CODE_NOT_FOUND', 404)
  }
  if (original.status !== 'issued' || original.replacement_code_id !== null || original.redemption_record_id !== null) {
    throw createStoreError('Book-benefit code cannot be replaced.', 'BOOK_BENEFIT_CODE_UNAVAILABLE', 409)
  }
  if (
    String(original.issuance_id) !== String(original.issuance_record_id) ||
    String(original.campaign_id) !== String(original.campaign_record_id) ||
    original.issuance_status !== 'approved' ||
    Number(original.benefit_days) !== 30
  ) {
    throw createStoreError('Book-benefit code relationship is invalid.', 'BOOK_BENEFIT_RELATION_INVALID', 409)
  }
  let originalExpiresAt = null
  try {
    originalExpiresAt = asDate(original.expires_at, 'Code expiration time')
  } catch {
    throw createStoreError('Book-benefit code cannot be replaced.', 'BOOK_BENEFIT_CODE_UNAVAILABLE', 409)
  }
  if (!originalExpiresAt) {
    throw createStoreError('Book-benefit code cannot be replaced.', 'BOOK_BENEFIT_CODE_UNAVAILABLE', 409)
  }
  if (input.now.getTime() >= originalExpiresAt.getTime()) {
    throw createStoreError('Book-benefit code has expired.', 'BOOK_BENEFIT_CODE_EXPIRED', 409)
  }
  assertCampaignAvailable({
    id: original.campaign_record_id,
    status: original.campaign_status,
    benefit_days: original.benefit_days,
    starts_at: original.starts_at,
    ends_at: original.ends_at
  }, String(original.campaign_id), input.now)

  const originalGeneration = normalizeReplacementGeneration(original.generation_no)
  if (originalGeneration === MAX_CODE_GENERATION) {
    throw createStoreError('Book-benefit replacement generation limit was reached.', 'BOOK_BENEFIT_REPLACEMENT_LIMIT', 409)
  }
  if (originalGeneration > MAX_CODE_GENERATION) {
    throw createStoreError('Book-benefit code generation is invalid.', 'BOOK_BENEFIT_RELATION_INVALID', 409)
  }

  const plaintextCode = generateBookBenefitRedemptionCode()
  const codeIdentity = hashBookBenefitRedemptionCode(plaintextCode, {
    secret: options.redemptionCodeHashSecret === undefined
      ? process.env.REDEMPTION_CODE_HASH_SECRET
      : options.redemptionCodeHashSecret,
    env: options.secretEnv || process.env
  })
  const codeExpiresAt = new Date(input.now.getTime() + CODE_VALIDITY_MILLISECONDS)
  const [voidResult] = await connection.execute(
    `UPDATE book_benefit_codes
        SET status = 'voided', voided_at = ?, voided_by = ?, void_reason_code = ?, updated_at = ?
      WHERE id = ? AND status = 'issued' AND replacement_code_id IS NULL`,
    [input.now, input.operatorId, input.reasonCode, input.now, input.codeId]
  )
  assertSingleRow(voidResult, 'Original book-benefit code')
  const [insertResult] = await connection.execute(
    `INSERT INTO book_benefit_codes (
       issuance_id, generation_no, code_hash, code_hash_version, status,
       issue_idempotency_key, replacement_code_id, issued_by, issued_at, expires_at,
       redeemed_at, voided_at, voided_by, void_reason_code, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      original.issuance_id,
      originalGeneration + 1,
      codeIdentity.codeHash,
      codeIdentity.hashVersion,
      'issued',
      replacementIssueIdempotencyKey(input.operationId),
      null,
      input.operatorId,
      input.now,
      codeExpiresAt,
      null,
      null,
      null,
      null,
      input.now,
      input.now
    ]
  )
  const replacementCodeId = assertInsertId(insertResult, 'Replacement book-benefit code')
  const [linkResult] = await connection.execute(
    `UPDATE book_benefit_codes
        SET replacement_code_id = ?, updated_at = ?
      WHERE id = ? AND status = 'voided' AND replacement_code_id IS NULL`,
    [replacementCodeId, input.now, input.codeId]
  )
  assertSingleRow(linkResult, 'Original book-benefit code replacement link')
  const [auditResult] = await connection.execute(
    `INSERT INTO book_benefit_audit_events (
       event_id, campaign_id, issuance_id, code_id, redemption_record_id,
       event_type, actor_type, actor_id, result, reason_code, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      replacementAuditEventId(input.operationId),
      original.campaign_id,
      original.issuance_id,
      replacementCodeId,
      null,
      'issued_code_replaced',
      'admin',
      input.operatorId,
      'succeeded',
      input.reasonCode,
      input.now
    ]
  )
  assertSingleRow(auditResult, 'Book-benefit replacement audit event')

  return replacementResult(original, {
    id: replacementCodeId,
    generation_no: originalGeneration + 1,
    expires_at: codeExpiresAt
  }, plaintextCode, 'issued')
}

async function findRedemptionByIdempotencyKey(connection, idempotencyKey) {
  const [rows] = await connection.execute(
    `SELECT id, redemption_id, code_id, campaign_id, issuance_id, redeemer_user_id,
            redeemer_phone_identity_hash, redeemer_phone_hash_version,
            membership_grant_id, entitlement_transaction_id
       FROM book_benefit_redemptions
      WHERE idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [idempotencyKey]
  )
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

async function findRedeemableCodeForUpdate(connection, codeHash) {
  const [rows] = await connection.execute(
    `SELECT c.id AS code_id, c.issuance_id AS code_issuance_id, c.status AS code_status,
            c.expires_at, i.id AS issuance_id, i.campaign_id, i.status AS issuance_status,
            p.id AS campaign_record_id, p.benefit_days
       FROM book_benefit_codes c
       LEFT JOIN book_benefit_issuances i ON i.id = c.issuance_id
       LEFT JOIN book_benefit_campaigns p ON p.id = i.campaign_id
      WHERE c.code_hash = ? AND c.code_hash_version = 'v1'
      LIMIT 1
      FOR UPDATE`,
    [codeHash]
  )
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

function assertRedeemableCode(row, now) {
  if (!row) {
    throw createStoreError('Book-benefit code was not found.', 'BOOK_BENEFIT_CODE_NOT_FOUND', 404)
  }
  if (row.code_status !== 'issued') {
    const code = row.code_status === 'redeemed'
      ? 'BOOK_BENEFIT_CODE_REDEEMED'
      : row.code_status === 'voided'
        ? 'BOOK_BENEFIT_CODE_VOIDED'
        : row.code_status === 'expired'
          ? 'BOOK_BENEFIT_CODE_EXPIRED'
          : 'BOOK_BENEFIT_CODE_UNAVAILABLE'
    throw createStoreError('Book-benefit code is not available.', code, 409)
  }
  const expiresAt = asDate(row.expires_at, 'Code expiration time')
  if (!expiresAt || now.getTime() >= expiresAt.getTime()) {
    throw createStoreError('Book-benefit code has expired.', 'BOOK_BENEFIT_CODE_EXPIRED', 409)
  }
  if (
    row.issuance_id === null || row.issuance_id === undefined ||
    row.campaign_id === null || row.campaign_id === undefined ||
    row.campaign_record_id === null || row.campaign_record_id === undefined ||
    String(row.code_issuance_id) !== String(row.issuance_id) ||
    String(row.campaign_id) !== String(row.campaign_record_id)
  ) {
    throw createStoreError('Book-benefit code relationship is invalid.', 'BOOK_BENEFIT_RELATION_INVALID', 409)
  }
  if (row.issuance_status !== 'approved') {
    throw createStoreError('Book-benefit issuance is not approved.', 'BOOK_BENEFIT_ISSUANCE_INVALID', 409)
  }
  if (Number(row.benefit_days) !== 30) {
    throw createStoreError('Book-benefit campaign duration is invalid.', 'BOOK_BENEFIT_CAMPAIGN_INVALID', 409)
  }
}

async function assertRedemptionAvailable(connection, code, identity) {
  const [rows] = await connection.execute(
    `SELECT id, code_id, redeemer_user_id
       FROM book_benefit_redemptions
      WHERE code_id = ?
         OR (campaign_id = ? AND redeemer_user_id = ?)
         OR (campaign_id = ? AND redeemer_phone_identity_hash = ?)
      LIMIT 1
      FOR UPDATE`,
    [code.code_id, code.campaign_id, identity.userId, code.campaign_id, identity.campaignPhoneIdentityHash]
  )
  const row = Array.isArray(rows) && rows.length ? rows[0] : null
  if (!row) return
  if (String(row.code_id) === String(code.code_id)) {
    throw createStoreError('Book-benefit code was already redeemed.', 'BOOK_BENEFIT_CODE_REDEEMED', 409)
  }
  throw createStoreError('Book benefit was already redeemed for this campaign.', 'BOOK_BENEFIT_REDEMPTION_CONFLICT', 409)
}

function createRedemptionResult(redemption, membership, idempotent) {
  return {
    redemptionId: redemption.redemption_id,
    codeId: String(redemption.code_id),
    campaignId: String(redemption.campaign_id),
    issuanceId: String(redemption.issuance_id),
    userId: String(redemption.redeemer_user_id),
    grantId: String(membership.grantId),
    transactionId: membership.transactionId,
    transactionInsertId: String(membership.transactionInsertId),
    membershipType: membership.membershipType,
    membershipStatus: membership.membershipStatus,
    membershipStartedAt: membership.membershipStartedAt,
    membershipExpireAt: membership.membershipExpireAt,
    quotaBalance: membership.quotaBalance,
    idempotent
  }
}

async function redeemBookBenefitCodeInTransaction(connection, input, options, entitlementStore) {
  const codeIdentity = hashBookBenefitRedemptionCode(input.canonicalCode, {
    secret: options.redemptionCodeHashSecret === undefined
      ? process.env.REDEMPTION_CODE_HASH_SECRET
      : options.redemptionCodeHashSecret,
    env: options.secretEnv || process.env
  })
  const grantIdempotencyKey = membershipIdempotencyKey(input.operationId)
  const existing = await findRedemptionByIdempotencyKey(connection, input.operationId)
  const code = await findRedeemableCodeForUpdate(connection, codeIdentity.codeHash)

  if (existing) {
    if (
      !code ||
      existing.redemption_id !== redemptionId(input.operationId) ||
      String(existing.code_id) !== String(code.code_id) ||
      String(existing.issuance_id) !== String(code.issuance_id) ||
      String(existing.campaign_id) !== String(code.campaign_id) ||
      String(existing.redeemer_user_id) !== input.userId
    ) {
      throw createStoreError('Redemption operation conflicts with an existing record.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
    let currentIdentity = null
    try {
      currentIdentity = await findCurrentCampaignPhoneIdentityInTransaction(
        connection,
        input.userId,
        { forUpdate: true }
      )
    } catch (error) {
      if (!error || error.code !== 'IDENTITY_STORE_ERROR') throw error
      throw createStoreError('Redemption operation conflicts with an existing record.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
    if (
      !Buffer.isBuffer(existing.redeemer_phone_identity_hash) ||
      existing.redeemer_phone_identity_hash.length !== 32 ||
      existing.redeemer_phone_hash_version !== 'v1' ||
      !currentIdentity ||
      !Buffer.isBuffer(currentIdentity.campaignPhoneIdentityHash) ||
      currentIdentity.campaignPhoneIdentityHash.length !== 32 ||
      currentIdentity.campaignPhoneHashVersion !== 'v1' ||
      !existing.redeemer_phone_identity_hash.equals(currentIdentity.campaignPhoneIdentityHash)
    ) {
      throw createStoreError('Redemption operation conflicts with an existing record.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
    const membership = await entitlementStore.grantMembershipDurationInTransaction(connection, {
      userId: input.userId,
      sourceType: 'redemption_code',
      sourceId: String(existing.code_id),
      redemptionCodeId: existing.code_id,
      idempotencyKey: grantIdempotencyKey,
      transactionId: membershipTransactionId(input.operationId),
      operatorType: 'system',
      operatorId: REDEMPTION_OPERATOR_ID,
      reason: 'Book-benefit redemption code redeemed.',
      now: input.now
    })
    if (
      membership.idempotent !== true ||
      String(existing.membership_grant_id) !== String(membership.grantId) ||
      String(existing.entitlement_transaction_id) !== String(membership.transactionId)
    ) {
      throw createStoreError('Existing redemption is incomplete.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
    }
    return createRedemptionResult(existing, membership, true)
  }

  assertRedeemableCode(code, input.now)
  const identity = await findCurrentCampaignPhoneIdentityInTransaction(connection, input.userId, { forUpdate: true })
  if (!identity) {
    throw createStoreError('Verified campaign phone identity is required.', 'BOOK_BENEFIT_PHONE_IDENTITY_REQUIRED', 409)
  }
  await assertRedemptionAvailable(connection, code, { ...identity, userId: input.userId })

  const membership = await entitlementStore.grantMembershipDurationInTransaction(connection, {
    userId: input.userId,
    sourceType: 'redemption_code',
    sourceId: String(code.code_id),
    redemptionCodeId: code.code_id,
    idempotencyKey: grantIdempotencyKey,
    transactionId: membershipTransactionId(input.operationId),
    operatorType: 'system',
    operatorId: REDEMPTION_OPERATOR_ID,
    reason: 'Book-benefit redemption code redeemed.',
    now: input.now
  })
  if (membership.idempotent) {
    throw createStoreError('Existing membership grant has no matching redemption.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }

  const businessRedemptionId = redemptionId(input.operationId)
  const [redemptionInsert] = await connection.execute(
    `INSERT INTO book_benefit_redemptions (
       redemption_id, code_id, campaign_id, issuance_id, redeemer_user_id,
       redeemer_phone_identity_hash, redeemer_phone_hash_version, idempotency_key,
       membership_grant_id, entitlement_transaction_id, redeemed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      businessRedemptionId,
      code.code_id,
      code.campaign_id,
      code.issuance_id,
      input.userId,
      identity.campaignPhoneIdentityHash,
      identity.campaignPhoneHashVersion,
      input.operationId,
      membership.grantId,
      membership.transactionId,
      input.now,
      input.now
    ]
  )
  const redemptionRecordId = assertInsertId(redemptionInsert, 'Book-benefit redemption')
  const [codeUpdate] = await connection.execute(
    `UPDATE book_benefit_codes
        SET status = 'redeemed', redeemed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'issued'`,
    [input.now, input.now, code.code_id]
  )
  assertSingleRow(codeUpdate, 'Book-benefit code')
  const [auditInsert] = await connection.execute(
    `INSERT INTO book_benefit_audit_events (
       event_id, campaign_id, issuance_id, code_id, redemption_record_id,
       event_type, actor_type, actor_id, result, reason_code, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      redemptionAuditEventId(input.operationId),
      code.campaign_id,
      code.issuance_id,
      code.code_id,
      redemptionRecordId,
      'code_redeemed_membership_granted',
      'user',
      input.userId,
      'succeeded',
      null,
      input.now
    ]
  )
  assertSingleRow(auditInsert, 'Book-benefit audit event')

  return createRedemptionResult({
    redemption_id: businessRedemptionId,
    code_id: code.code_id,
    campaign_id: code.campaign_id,
    issuance_id: code.issuance_id,
    redeemer_user_id: input.userId
  }, membership, false)
}

async function insertIssuance(connection, values) {
  const [result] = await connection.execute(
    `INSERT INTO book_benefit_issuances (
       issuance_no, campaign_id, qualification_rules_version, order_claim_type,
       approved_order_claim_hash, order_claim_hash_version, order_channel, status,
       reviewed_by, review_reason_code, reviewed_at, seller_verification_code,
       customer_service_channel, create_idempotency_key, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values
  )
  return assertInsertId(result, 'Book-benefit issuance')
}

async function issueUnassignedBookBenefitCodeInTransaction(connection, input, options) {
  const existing = await findIdempotentIssue(connection, input, options)
  if (existing) return existing

  const campaign = await findConfiguredCampaignForUpdate(connection, options)
  assertCampaignAvailable({
    id: campaign.campaignId,
    status: campaign.status,
    benefit_days: campaign.benefitDays,
    starts_at: campaign.startsAt,
    ends_at: campaign.endsAt
  }, campaign.campaignId, input.now)

  const issuanceNo = issuanceNumber(input.operationId)
  let issuanceId = ''

  if (input.orderClaimType === 'standard') {
    const orderClaim = createStandardOrderClaimHash({
      channel: input.orderChannel,
      orderNumber: input.orderNumber
    }, {
      secret: options.orderClaimHashSecret === undefined
        ? process.env.BOOK_ORDER_CLAIM_HASH_SECRET
        : options.orderClaimHashSecret,
      env: options.secretEnv || process.env
    })
    issuanceId = await insertIssuance(connection, [
      issuanceNo,
      campaign.campaignId,
      campaign.rulesVersion,
      'standard',
      orderClaim.orderClaimHash,
      orderClaim.hashVersion,
      orderClaim.normalizedChannel,
      'approved',
      input.operatorId,
      null,
      input.now,
      input.sellerVerificationCode,
      input.customerServiceChannel,
      input.operationId,
      input.now,
      input.now
    ])
  } else {
    issuanceId = await insertIssuance(connection, [
      issuanceNo,
      campaign.campaignId,
      campaign.rulesVersion,
      'manual_exception',
      null,
      null,
      null,
      'approved',
      input.operatorId,
      input.manualExceptionReasonCode,
      input.now,
      input.sellerVerificationCode,
      input.customerServiceChannel,
      input.operationId,
      input.now,
      input.now
    ])
    const orderClaim = createManualExceptionIssuanceClaimHash({
      campaignId: campaign.campaignId,
      issuanceId
    }, {
      secret: options.orderClaimHashSecret === undefined
        ? process.env.BOOK_ORDER_CLAIM_HASH_SECRET
        : options.orderClaimHashSecret,
      env: options.secretEnv || process.env
    })
    const [updateResult] = await connection.execute(
      `UPDATE book_benefit_issuances
          SET approved_order_claim_hash = ?, order_claim_hash_version = ?, updated_at = ?
        WHERE id = ? AND status = 'approved' AND approved_order_claim_hash IS NULL`,
      [
        orderClaim.orderClaimHash,
        orderClaim.hashVersion,
        input.now,
        issuanceId
      ]
    )
    assertSingleRow(updateResult, 'Book-benefit issuance')
  }

  const plaintextCode = generateBookBenefitRedemptionCode()
  const codeIdentity = hashBookBenefitRedemptionCode(plaintextCode, {
    secret: options.redemptionCodeHashSecret === undefined
      ? process.env.REDEMPTION_CODE_HASH_SECRET
      : options.redemptionCodeHashSecret,
    env: options.secretEnv || process.env
  })
  const codeExpiresAt = new Date(input.now.getTime() + CODE_VALIDITY_MILLISECONDS)
  const [codeInsertResult] = await connection.execute(
    `INSERT INTO book_benefit_codes (
       issuance_id, generation_no, code_hash, code_hash_version, status,
       issue_idempotency_key, replacement_code_id, issued_by, issued_at, expires_at,
       redeemed_at, voided_at, voided_by, void_reason_code, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      issuanceId,
      1,
      codeIdentity.codeHash,
      codeIdentity.hashVersion,
      'issued',
      input.operationId,
      null,
      input.operatorId,
      input.now,
      codeExpiresAt,
      null,
      null,
      null,
      null,
      input.now,
      input.now
    ]
  )
  const codeId = assertInsertId(codeInsertResult, 'Book-benefit code')

  const [auditInsertResult] = await connection.execute(
    `INSERT INTO book_benefit_audit_events (
       event_id, campaign_id, issuance_id, code_id, redemption_record_id,
       event_type, actor_type, actor_id, result, reason_code, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditEventId(input.operationId),
      campaign.campaignId,
      issuanceId,
      codeId,
      null,
      'unassigned_code_issued',
      'admin',
      input.operatorId,
      'succeeded',
      input.orderClaimType === 'manual_exception' ? input.manualExceptionReasonCode : null,
      input.now
    ]
  )
  assertSingleRow(auditInsertResult, 'Book-benefit audit event')

  return {
    issuanceId,
    issuanceNo,
    codeId,
    plaintextCode,
    codeExpiresAt,
    campaignId: campaign.campaignId,
    status: 'issued'
  }
}

function mapDuplicateError(error) {
  if (!error || error.code !== 'ER_DUP_ENTRY') return error
  const detail = String(error.constraint || error.sqlMessage || error.message || '')
  const mappings = [
    ['uk_book_benefit_issuances_campaign_order', 'BOOK_BENEFIT_ORDER_CONFLICT'],
    ['uk_book_benefit_codes_hash', 'BOOK_BENEFIT_CODE_HASH_CONFLICT'],
    ['uk_book_benefit_issuances_idempotency', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_book_benefit_codes_issue_idempotency', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_book_benefit_audit_events_event_id', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_membership_grants_idempotency', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_entitlement_transactions_idempotency_key', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_entitlement_transactions_transaction_id', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_membership_grants_source', 'BOOK_BENEFIT_CODE_REDEEMED'],
    ['uk_membership_grants_redemption_code', 'BOOK_BENEFIT_CODE_REDEEMED'],
    ['uk_book_benefit_redemptions_redemption_id', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_book_benefit_redemptions_idempotency', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_book_benefit_redemptions_code', 'BOOK_BENEFIT_CODE_REDEEMED'],
    ['uk_book_benefit_redemptions_campaign_user', 'BOOK_BENEFIT_REDEMPTION_CONFLICT'],
    ['uk_book_benefit_redemptions_campaign_phone', 'BOOK_BENEFIT_REDEMPTION_CONFLICT'],
    ['uk_book_benefit_redemptions_membership_grant', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_book_benefit_redemptions_entitlement_transaction', 'BOOK_BENEFIT_OPERATION_CONFLICT']
  ]
  const match = mappings.find(([indexName]) => detail.includes(indexName))
  return createStoreError(
    'Book-benefit operation conflicts with an existing record.',
    match ? match[1] : 'BOOK_BENEFIT_CONCURRENT_CONFLICT',
    409
  )
}

export function createBookBenefitStore(options = {}) {
  let pool = options.pool || null
  const entitlementStore = options.entitlementStore || createUserEntitlementStore({ pool: options.pool })

  function getPool() {
    if (pool) return pool
    const config = getDbConfig(options)
    if (!config.configured) {
      throw createStoreError('Book-benefit database is not configured.', 'BOOK_BENEFIT_DB_CONFIG_MISSING', 503)
    }
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      waitForConnections: true,
      connectionLimit: Number(options.dbConnectionLimit || process.env.DB_CONNECTION_LIMIT || 5),
      namedPlaceholders: false
    })
    return pool
  }

  async function issueUnassignedBookBenefitCode(rawInput = {}) {
    const input = normalizeIssueInput(rawInput)
    const connection = await getPool().getConnection()
    let transactionStarted = false
    let transactionCommitted = false
    let primaryError = null
    let result = null

    try {
      await connection.beginTransaction()
      transactionStarted = true
      result = await issueUnassignedBookBenefitCodeInTransaction(connection, input, options)
      await connection.commit()
      transactionStarted = false
      transactionCommitted = true
    } catch (error) {
      primaryError = error
      if (transactionStarted && !transactionCommitted) {
        try {
          await connection.rollback()
          transactionStarted = false
        } catch {
          // Preserve the original database or business error.
        }
      }
    }

    let releaseError = null
    try {
      connection.release()
    } catch (error) {
      releaseError = error
    }

    if (primaryError) throw mapDuplicateError(primaryError)
    if (releaseError) throw releaseError
    return result
  }

  async function getConfiguredBookBenefitCampaign() {
    const connection = await getPool().getConnection()
    let primaryError = null
    let result = null
    try {
      result = await findConfiguredCampaign(connection, options)
    } catch (error) {
      primaryError = error
    }
    let releaseError = null
    try {
      connection.release()
    } catch (error) {
      releaseError = error
    }
    if (primaryError) throw primaryError
    if (releaseError) throw releaseError
    return result
  }

  async function getBookBenefitIssueOperationStatus(rawInput = {}) {
    const input = normalizeIssueStatusInput(rawInput)
    const connection = await getPool().getConnection()
    let primaryError = null
    let result = null
    try {
      result = await getIssueOperationStatus(connection, input, options)
    } catch (error) {
      primaryError = error
    }
    let releaseError = null
    try { connection.release() } catch (error) { releaseError = error }
    if (primaryError) throw primaryError
    if (releaseError) throw releaseError
    return result
  }

  async function replaceIssuedBookBenefitCode(rawInput = {}) {
    const input = normalizeReplacementInput(rawInput)
    const connection = await getPool().getConnection()
    let transactionStarted = false
    let transactionCommitted = false
    let primaryError = null
    let result = null

    try {
      await connection.beginTransaction()
      transactionStarted = true
      result = await replaceIssuedBookBenefitCodeInTransaction(connection, input, options)
      await connection.commit()
      transactionStarted = false
      transactionCommitted = true
    } catch (error) {
      primaryError = error
      if (transactionStarted && !transactionCommitted) {
        try {
          await connection.rollback()
          transactionStarted = false
        } catch {
          // Preserve the original database or business error.
        }
      }
    }

    let releaseError = null
    try {
      connection.release()
    } catch (error) {
      releaseError = error
    }

    if (primaryError) throw mapDuplicateError(primaryError)
    if (releaseError) throw releaseError
    return result
  }

  async function redeemBookBenefitCode(rawInput = {}) {
    const input = normalizeRedemptionInput(rawInput)
    const connection = await getPool().getConnection()
    let transactionStarted = false
    let transactionCommitted = false
    let primaryError = null
    let result = null

    try {
      await connection.beginTransaction()
      transactionStarted = true
      result = await redeemBookBenefitCodeInTransaction(connection, input, options, entitlementStore)
      await connection.commit()
      transactionStarted = false
      transactionCommitted = true
    } catch (error) {
      primaryError = error
      if (transactionStarted && !transactionCommitted) {
        try {
          await connection.rollback()
          transactionStarted = false
        } catch {
          // Preserve the original database or business error.
        }
      }
    }

    let releaseError = null
    try {
      connection.release()
    } catch (error) {
      releaseError = error
    }

    if (primaryError) throw mapDuplicateError(primaryError)
    if (releaseError) throw releaseError
    return result
  }

  return {
    issueUnassignedBookBenefitCode,
    redeemBookBenefitCode,
    getConfiguredBookBenefitCampaign,
    getBookBenefitIssueOperationStatus,
    replaceIssuedBookBenefitCode
  }
}
