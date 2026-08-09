import crypto from 'node:crypto'
import mysql from 'mysql2/promise'

import {
  createManualExceptionOrderClaimHash,
  createStandardOrderClaimHash
} from './book-benefit-foundation.mjs'
import {
  generateBookBenefitRedemptionCode,
  hashBookBenefitRedemptionCode
} from './book-benefit-code.mjs'
import { findBookBenefitAdminIdentityInTransaction } from './identity-store.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const CODE_VALIDITY_MILLISECONDS = 30 * 24 * 60 * 60 * 1000
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
const ALLOWED_INPUT_FIELDS = new Set([
  'campaignId',
  'locator',
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

function normalizeInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createStoreError('Book-benefit issue input is invalid.', 'BOOK_BENEFIT_INPUT_INVALID', 400)
  }
  for (const fieldName of Object.keys(input)) {
    if (!ALLOWED_INPUT_FIELDS.has(fieldName)) {
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

  return {
    campaignId: normalizePositiveId(input.campaignId, 'Campaign id'),
    locator: input.locator,
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
    sellerVerificationCode: normalizeWhitelistedValue(
      input.sellerVerificationCode,
      'Seller verification code',
      SELLER_VERIFICATION_CODES
    ),
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

function applicationNumber(operationId) {
  return stableIdentifier('BBA-', 'book-benefit-application:v1', operationId, 32).toUpperCase()
}

function auditEventId(operationId) {
  return stableIdentifier('bbev_', 'book-benefit-audit:v1', operationId, 59)
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

async function findIdempotentIssue(connection, operationId, campaignId) {
  const [applicationRows] = await connection.execute(
    `SELECT id, application_no, campaign_id, applicant_user_id, status
       FROM book_benefit_applications
      WHERE create_idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [operationId]
  )
  const application = Array.isArray(applicationRows) && applicationRows.length ? applicationRows[0] : null
  if (!application) return null
  if (String(application.campaign_id) !== campaignId || application.status !== 'approved') {
    throw createStoreError('Operation id conflicts with an existing application.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }

  const [codeRows] = await connection.execute(
    `SELECT id, application_id, status, expires_at
       FROM book_benefit_codes
      WHERE issue_idempotency_key = ?
      LIMIT 1
      FOR UPDATE`,
    [operationId]
  )
  const code = Array.isArray(codeRows) && codeRows.length ? codeRows[0] : null
  if (!code || String(code.application_id) !== String(application.id) || code.status !== 'issued') {
    throw createStoreError('Existing code issuance is incomplete.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }
  const [auditRows] = await connection.execute(
    `SELECT id, application_id, code_id, event_type, result
       FROM book_benefit_audit_events
      WHERE event_id = ?
      LIMIT 1
      FOR UPDATE`,
    [auditEventId(operationId)]
  )
  const audit = Array.isArray(auditRows) && auditRows.length ? auditRows[0] : null
  if (
    !audit ||
    String(audit.application_id) !== String(application.id) ||
    String(audit.code_id) !== String(code.id) ||
    audit.event_type !== 'qualification_approved_code_issued' ||
    audit.result !== 'succeeded'
  ) {
    throw createStoreError('Existing code issuance is incomplete.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }
  const codeExpiresAt = asDate(code.expires_at, 'Code expiration time')
  if (!codeExpiresAt) {
    throw createStoreError('Existing code issuance is incomplete.', 'BOOK_BENEFIT_OPERATION_CONFLICT', 409)
  }
  return {
    applicationId: String(application.id),
    applicationNo: application.application_no,
    codeId: String(code.id),
    codeExpiresAt,
    campaignId,
    userId: String(application.applicant_user_id),
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

async function insertApplication(connection, values) {
  const [result] = await connection.execute(
    `INSERT INTO book_benefit_applications (
       application_no, campaign_id, applicant_user_id,
       applicant_phone_identity_hash, applicant_phone_hash_version,
       order_claim_type, approved_order_claim_hash, order_claim_hash_version,
       order_channel, status, reviewed_by, review_reason_code, reviewed_at,
       create_idempotency_key, accepted_rules_version, rules_accepted_at,
       seller_verification_code, customer_service_channel, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values
  )
  return assertInsertId(result, 'Book-benefit application')
}

async function issueApprovedBookBenefitCodeInTransaction(connection, input, options) {
  const existing = await findIdempotentIssue(connection, input.operationId, input.campaignId)
  if (existing) return existing

  const identity = await findBookBenefitAdminIdentityInTransaction(
    connection,
    input.locator,
    {
      forUpdate: true,
      phoneHashSecret: options.phoneHashSecret === undefined
        ? process.env.PHONE_HASH_SECRET
        : options.phoneHashSecret
    }
  )
  const campaign = await findCampaignForUpdate(connection, input.campaignId)
  assertCampaignAvailable(campaign, input.campaignId, input.now)

  const appNo = applicationNumber(input.operationId)
  const commonApplicationValues = [
    appNo,
    input.campaignId,
    identity.userId,
    identity.campaignPhoneIdentityHash,
    identity.campaignPhoneHashVersion
  ]
  let applicationId = ''

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
    applicationId = await insertApplication(connection, [
      ...commonApplicationValues,
      'standard',
      orderClaim.orderClaimHash,
      orderClaim.hashVersion,
      orderClaim.normalizedChannel,
      'approved',
      input.operatorId,
      null,
      input.now,
      input.operationId,
      null,
      null,
      input.sellerVerificationCode,
      input.customerServiceChannel,
      input.now,
      input.now
    ])
  } else {
    applicationId = await insertApplication(connection, [
      ...commonApplicationValues,
      'unreviewed',
      null,
      null,
      null,
      'pending',
      null,
      null,
      null,
      input.operationId,
      null,
      null,
      input.sellerVerificationCode,
      input.customerServiceChannel,
      input.now,
      input.now
    ])
    const orderClaim = createManualExceptionOrderClaimHash({
      campaignId: input.campaignId,
      applicationId
    }, {
      secret: options.orderClaimHashSecret === undefined
        ? process.env.BOOK_ORDER_CLAIM_HASH_SECRET
        : options.orderClaimHashSecret,
      env: options.secretEnv || process.env
    })
    const [updateResult] = await connection.execute(
      `UPDATE book_benefit_applications
          SET order_claim_type = ?, approved_order_claim_hash = ?, order_claim_hash_version = ?,
              status = ?, reviewed_by = ?, review_reason_code = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
      [
        'manual_exception',
        orderClaim.orderClaimHash,
        orderClaim.hashVersion,
        'approved',
        input.operatorId,
        input.manualExceptionReasonCode,
        input.now,
        input.now,
        applicationId,
        'pending'
      ]
    )
    assertSingleRow(updateResult, 'Book-benefit application')
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
       application_id, generation_no, code_hash, code_hash_version, status,
       issue_idempotency_key, replacement_code_id, issued_by, issued_at, expires_at,
       redeemed_at, voided_at, voided_by, void_reason_code, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      applicationId,
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
       event_id, campaign_id, application_id, code_id, redemption_record_id,
       event_type, actor_type, actor_id, result, reason_code, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditEventId(input.operationId),
      input.campaignId,
      applicationId,
      codeId,
      null,
      'qualification_approved_code_issued',
      'admin',
      input.operatorId,
      'succeeded',
      input.orderClaimType === 'manual_exception' ? input.manualExceptionReasonCode : null,
      input.now
    ]
  )
  assertSingleRow(auditInsertResult, 'Book-benefit audit event')

  return {
    applicationId,
    applicationNo: appNo,
    codeId,
    plaintextCode,
    codeExpiresAt,
    campaignId: input.campaignId,
    userId: identity.userId,
    status: 'issued'
  }
}

function mapDuplicateError(error) {
  if (!error || error.code !== 'ER_DUP_ENTRY') return error
  const detail = String(error.constraint || error.sqlMessage || error.message || '')
  const mappings = [
    ['uk_book_benefit_applications_campaign_user', 'BOOK_BENEFIT_CAMPAIGN_USER_CONFLICT'],
    ['uk_book_benefit_applications_campaign_phone', 'BOOK_BENEFIT_CAMPAIGN_PHONE_CONFLICT'],
    ['uk_book_benefit_applications_campaign_order', 'BOOK_BENEFIT_ORDER_CONFLICT'],
    ['uk_book_benefit_codes_hash', 'BOOK_BENEFIT_CODE_HASH_CONFLICT'],
    ['uk_book_benefit_applications_idempotency', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_book_benefit_codes_issue_idempotency', 'BOOK_BENEFIT_OPERATION_CONFLICT'],
    ['uk_book_benefit_audit_events_event_id', 'BOOK_BENEFIT_OPERATION_CONFLICT']
  ]
  const match = mappings.find(([indexName]) => detail.includes(indexName))
  return createStoreError(
    'Book-benefit issuance conflicts with an existing record.',
    match ? match[1] : 'BOOK_BENEFIT_CONCURRENT_CONFLICT',
    409
  )
}

export function createBookBenefitStore(options = {}) {
  let pool = options.pool || null

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

  async function issueApprovedBookBenefitCode(rawInput = {}) {
    const input = normalizeInput(rawInput)
    const connection = await getPool().getConnection()
    let transactionStarted = false
    let transactionCommitted = false
    let primaryError = null
    let result = null

    try {
      await connection.beginTransaction()
      transactionStarted = true
      result = await issueApprovedBookBenefitCodeInTransaction(connection, input, options)
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
    issueApprovedBookBenefitCode
  }
}
