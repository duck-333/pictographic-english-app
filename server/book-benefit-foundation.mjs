import crypto from 'node:crypto'

import { normalizePhone } from './identity-store.mjs'

const HASH_VERSION = 'v1'
const MIN_SECRET_BYTES = 32
const MAX_UNSIGNED_BIGINT = 18446744073709551615n

const CAMPAIGN_SECRET_ENV = 'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET'
const ORDER_SECRET_ENV = 'BOOK_ORDER_CLAIM_HASH_SECRET'
const COMMON_DISALLOWED_SECRET_NAMES = [
  'PHONE_HASH_SECRET',
  'JWT_SECRET',
  'ADMIN_API_TOKEN',
  'REDEMPTION_CODE_HASH_SECRET'
]

function createFoundationError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeRequiredString(value, fieldName, code) {
  const normalized = String(value === undefined || value === null ? '' : value).normalize('NFKC').trim()
  if (!normalized) throw createFoundationError(`${fieldName} is required.`, code)
  return normalized
}

function secretsEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function resolveDedicatedSecret(options, config) {
  const env = options.env || process.env
  const configuredValue = options.secret === undefined ? env[config.envName] : options.secret
  const secret = String(configuredValue === undefined || configuredValue === null ? '' : configuredValue)

  if (!secret.trim()) {
    throw createFoundationError(`${config.envName} is not configured.`, `${config.codePrefix}_MISSING`)
  }
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw createFoundationError(`${config.envName} is too short.`, `${config.codePrefix}_TOO_SHORT`)
  }

  for (const disallowedName of config.disallowedSecretNames) {
    const disallowedValue = String(env[disallowedName] === undefined ? '' : env[disallowedName])
    if (disallowedValue && secretsEqual(secret, disallowedValue)) {
      throw createFoundationError(
        `${config.envName} must not reuse ${disallowedName}.`,
        `${config.codePrefix}_REUSED`
      )
    }
  }

  return secret
}

function hmacSha256Buffer(secret, input) {
  return crypto.createHmac('sha256', secret).update(input, 'utf8').digest()
}

function normalizeUnsignedId(value, fieldName) {
  const normalized = normalizeRequiredString(value, fieldName, 'BOOK_BENEFIT_ID_REQUIRED')
  if (!/^\d+$/.test(normalized)) {
    throw createFoundationError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_ID_INVALID')
  }

  const numericValue = BigInt(normalized)
  if (numericValue <= 0n || numericValue > MAX_UNSIGNED_BIGINT) {
    throw createFoundationError(`${fieldName} is invalid.`, 'BOOK_BENEFIT_ID_INVALID')
  }
  return numericValue.toString()
}

export function createCampaignPhoneIdentity(phone, options = {}) {
  const normalizedPhone = normalizePhone(phone, options)
  const secret = resolveDedicatedSecret(options, {
    envName: CAMPAIGN_SECRET_ENV,
    codePrefix: 'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET',
    disallowedSecretNames: [...COMMON_DISALLOWED_SECRET_NAMES, ORDER_SECRET_ENV, 'WECHAT_MINIAPP_SECRET']
  })
  const hashInput = `campaign-phone-identity:${HASH_VERSION}|${normalizedPhone.e164}`

  return {
    campaignPhoneIdentityHash: hmacSha256Buffer(secret, hashInput),
    hashVersion: HASH_VERSION
  }
}

export function normalizeOrderChannel(value) {
  const normalized = normalizeRequiredString(value, 'Order channel', 'BOOK_ORDER_CHANNEL_REQUIRED').toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw createFoundationError('Order channel is invalid.', 'BOOK_ORDER_CHANNEL_INVALID')
  }
  return normalized
}

export function normalizeOrderNumber(value) {
  const normalized = normalizeRequiredString(value, 'Order number', 'BOOK_ORDER_NUMBER_REQUIRED')
    .replace(/\s+/gu, '')
    .toUpperCase()

  if (!normalized || normalized.length > 191 || /[|\u0000-\u001f\u007f]/u.test(normalized)) {
    throw createFoundationError('Order number is invalid.', 'BOOK_ORDER_NUMBER_INVALID')
  }
  return normalized
}

function resolveOrderClaimSecret(options) {
  return resolveDedicatedSecret(options, {
    envName: ORDER_SECRET_ENV,
    codePrefix: 'BOOK_ORDER_CLAIM_HASH_SECRET',
    disallowedSecretNames: [...COMMON_DISALLOWED_SECRET_NAMES, CAMPAIGN_SECRET_ENV]
  })
}

export function createStandardOrderClaimHash(input = {}, options = {}) {
  const normalizedChannel = normalizeOrderChannel(input.channel)
  const normalizedOrderNumber = normalizeOrderNumber(input.orderNumber)
  const secret = resolveOrderClaimSecret(options)

  return {
    orderClaimHash: hmacSha256Buffer(secret, `${normalizedChannel}|${normalizedOrderNumber}`),
    hashVersion: HASH_VERSION,
    normalizedChannel
  }
}

export function createManualExceptionOrderClaimHash(input = {}, options = {}) {
  const campaignId = normalizeUnsignedId(input.campaignId, 'Campaign id')
  const applicationId = normalizeUnsignedId(input.applicationId, 'Application id')
  const secret = resolveOrderClaimSecret(options)

  return {
    orderClaimHash: hmacSha256Buffer(secret, `manual-exception:${campaignId}:${applicationId}`),
    hashVersion: HASH_VERSION
  }
}
