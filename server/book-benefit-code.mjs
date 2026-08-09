import crypto from 'node:crypto'

const CODE_VERSION = 'v1'
const CODE_PREFIX = 'BF30'
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const RANDOM_CHARACTER_COUNT = 16
const MIN_SECRET_BYTES = 32
const SECRET_ENV_NAME = 'REDEMPTION_CODE_HASH_SECRET'
const DISALLOWED_SECRET_NAMES = [
  'PHONE_HASH_SECRET',
  'JWT_SECRET',
  'ADMIN_API_TOKEN',
  'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET',
  'BOOK_ORDER_CLAIM_HASH_SECRET',
  'WECHAT_MINIAPP_SECRET'
]

function createCodeError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function secretsEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function resolveRedemptionCodeSecret(options = {}) {
  const env = options.env || process.env
  const configured = options.secret === undefined ? env[SECRET_ENV_NAME] : options.secret
  const secret = String(configured === undefined || configured === null ? '' : configured)
  if (!secret.trim()) {
    throw createCodeError('Redemption code hash secret is not configured.', 'REDEMPTION_CODE_HASH_SECRET_MISSING')
  }
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw createCodeError('Redemption code hash secret is too short.', 'REDEMPTION_CODE_HASH_SECRET_TOO_SHORT')
  }
  for (const name of DISALLOWED_SECRET_NAMES) {
    const otherSecret = String(env[name] === undefined || env[name] === null ? '' : env[name])
    if (otherSecret && secretsEqual(secret, otherSecret)) {
      throw createCodeError(
        `Redemption code hash secret must not reuse ${name}.`,
        'REDEMPTION_CODE_HASH_SECRET_REUSED'
      )
    }
  }
  return secret
}

export function normalizeBookBenefitRedemptionCode(value) {
  if (typeof value !== 'string' || value.length > 64) {
    throw createCodeError('Redemption code is invalid.', 'REDEMPTION_CODE_INVALID')
  }
  const compact = value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
  if (!new RegExp(`^${CODE_PREFIX}[${CODE_ALPHABET}]{${RANDOM_CHARACTER_COUNT}}$`).test(compact)) {
    throw createCodeError('Redemption code is invalid.', 'REDEMPTION_CODE_INVALID')
  }
  const body = compact.slice(CODE_PREFIX.length)
  return `${CODE_PREFIX}-${body.match(/.{4}/g).join('-')}`
}

export function generateBookBenefitRedemptionCode() {
  let body = ''
  const unbiasedLimit = 256 - (256 % CODE_ALPHABET.length)
  while (body.length < RANDOM_CHARACTER_COUNT) {
    const bytes = crypto.randomBytes((RANDOM_CHARACTER_COUNT - body.length) * 2)
    for (const byte of bytes) {
      if (byte >= unbiasedLimit) continue
      body += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (body.length === RANDOM_CHARACTER_COUNT) break
    }
  }
  return normalizeBookBenefitRedemptionCode(`${CODE_PREFIX}${body}`)
}

export function hashBookBenefitRedemptionCode(code, options = {}) {
  const canonicalCode = normalizeBookBenefitRedemptionCode(code)
  const secret = resolveRedemptionCodeSecret(options)
  return {
    codeHash: crypto
      .createHmac('sha256', secret)
      .update(`book-benefit-redemption-code:${CODE_VERSION}|${canonicalCode}`, 'utf8')
      .digest(),
    hashVersion: CODE_VERSION
  }
}
