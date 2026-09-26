import crypto from 'node:crypto'

const HASH_VERSION = 'v1'
const TOKEN_PREFIX = 'ivt1'
const CANDIDATE_PREFIX = 'icr1'
const RANDOM_BYTES = 32
const MIN_SECRET_BYTES = 32
const TOKEN_SECRET_ENV = 'INVITATION_TOKEN_HMAC_SECRET'
const CANDIDATE_SECRET_ENV = 'INVITATION_CANDIDATE_HMAC_SECRET'
const DISALLOWED_SECRET_NAMES = Object.freeze([
  'JWT_SECRET',
  'PHONE_HASH_SECRET',
  'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET',
  'ADMIN_API_TOKEN',
  'REDEMPTION_CODE_HASH_SECRET',
  'BOOK_ORDER_CLAIM_HASH_SECRET',
  'WECHAT_SECRET',
  'WECHAT_MINIAPP_SECRET',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY',
  'WECHAT_VIRTUAL_PAYMENT_PRODUCTION_APP_KEY'
])
const OBVIOUS_PLACEHOLDER = /(?:change[-_ ]?me|replace[-_ ]?with|replace[-_ ]?me|placeholder|example|your[-_ ]?secret|set[-_ ]?me|todo)/iu

function hasObviousRepeatedPattern(value) {
  for (let width = 1; width <= Math.floor(value.length / 2); width += 1) {
    if (value.length % width !== 0) continue
    const pattern = value.slice(0, width)
    if (pattern.repeat(value.length / width) === value) return true
  }
  return false
}

function securityError(message, code) {
  const error = new Error(message)
  error.code = code
  error.statusCode = 503
  return error
}

function equalSecret(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function resolveSecret(env, name, otherName) {
  const value = String(env[name] === undefined || env[name] === null ? '' : env[name])
  if (!value.trim()) throw securityError(`${name} is not configured.`, `${name}_MISSING`)
  if (Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
    throw securityError(`${name} is too short.`, `${name}_TOO_SHORT`)
  }
  if (OBVIOUS_PLACEHOLDER.test(value)) {
    throw securityError(`${name} is an unsafe placeholder.`, `${name}_PLACEHOLDER`)
  }
  if (new Set([...value]).size < 8 || hasObviousRepeatedPattern(value)) {
    throw securityError(`${name} is an unsafe placeholder.`, `${name}_PLACEHOLDER`)
  }
  for (const disallowedName of [...DISALLOWED_SECRET_NAMES, otherName]) {
    const otherValue = String(env[disallowedName] === undefined ? '' : env[disallowedName])
    if (otherValue && equalSecret(value, otherValue)) {
      throw securityError(`${name} must not reuse ${disallowedName}.`, `${name}_REUSED`)
    }
  }
  return value
}

function encodeCredential(prefix, randomBytes) {
  return `${prefix}.${randomBytes(RANDOM_BYTES).toString('base64url')}`
}

function normalizeCredential(value, prefix, code) {
  const invalid = () => {
    const error = new Error('Invitation credential is invalid.')
    error.code = code
    error.statusCode = 400
    throw error
  }
  if (typeof value !== 'string' || !new RegExp(`^${prefix}\\.[A-Za-z0-9_-]{43}$`, 'u').test(value)) invalid()
  const encoded = value.slice(prefix.length + 1)
  const decoded = Buffer.from(encoded, 'base64url')
  if (decoded.length !== RANDOM_BYTES || decoded.toString('base64url') !== encoded) invalid()
  return value
}

function digest(secret, namespace, credential) {
  return crypto.createHmac('sha256', secret)
    .update(`${namespace}:${HASH_VERSION}|${credential}`, 'utf8')
    .digest()
}

export function createInvitationCredentialSecurity(options = {}) {
  const env = options.env || process.env
  const tokenEnv = {
    ...env,
    [TOKEN_SECRET_ENV]: options.tokenSecret === undefined ? env[TOKEN_SECRET_ENV] : options.tokenSecret,
    [CANDIDATE_SECRET_ENV]: options.candidateSecret === undefined ? env[CANDIDATE_SECRET_ENV] : options.candidateSecret
  }
  const tokenSecret = resolveSecret(tokenEnv, TOKEN_SECRET_ENV, CANDIDATE_SECRET_ENV)
  const candidateSecret = resolveSecret(tokenEnv, CANDIDATE_SECRET_ENV, TOKEN_SECRET_ENV)
  const randomBytes = options.randomBytes || crypto.randomBytes

  return Object.freeze({
    hashVersion: HASH_VERSION,
    generateInvitationToken() {
      return encodeCredential(TOKEN_PREFIX, randomBytes)
    },
    generateCandidateReceipt() {
      return encodeCredential(CANDIDATE_PREFIX, randomBytes)
    },
    digestInvitationToken(value) {
      return digest(tokenSecret, 'invitation-token', normalizeCredential(value, TOKEN_PREFIX, 'INVITATION_TOKEN_INVALID'))
    },
    digestCandidateReceipt(value) {
      return digest(candidateSecret, 'invitation-candidate', normalizeCredential(value, CANDIDATE_PREFIX, 'INVITATION_CANDIDATE_RECEIPT_INVALID'))
    },
    digestTrustedCandidateSubject(value) {
      if (typeof value !== 'string' || !value.trim() || value.length > 512) {
        const error = new Error('Trusted candidate subject is invalid.')
        error.code = 'INVITATION_CANDIDATE_SUBJECT_INVALID'
        error.statusCode = 400
        throw error
      }
      return digest(candidateSecret, 'invitation-subject', value)
    }
  })
}

export const INVITATION_CREDENTIAL_CONFIG = Object.freeze({
  tokenSecretEnv: TOKEN_SECRET_ENV,
  candidateSecretEnv: CANDIDATE_SECRET_ENV,
  hashVersion: HASH_VERSION,
  randomBytes: RANDOM_BYTES
})
