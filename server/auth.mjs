import crypto from 'node:crypto'

export const DEFAULT_DEV_ADMIN_API_TOKEN = ''
const DEFAULT_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const PROCESS_SESSION_SECRET = crypto.randomBytes(32).toString('hex')

export function isProductionNodeEnv(nodeEnv = process.env.NODE_ENV) {
  return String(nodeEnv || '').trim() === 'production'
}

export function getAdminAuthConfig(options = {}) {
  const nodeEnv = options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv
  const production = isProductionNodeEnv(nodeEnv)

  return {
    token: '',
    production,
    source: 'session-login',
    usingDefaultToken: false
  }
}

export function getAdminApiToken(options = {}) {
  return getAdminAuthConfig(options).token
}

export function getAdminCredentials(options = {}) {
  const configuredUsername = options.adminUsername === undefined ? process.env.ADMIN_USERNAME : options.adminUsername
  const configuredPassword = options.adminPassword === undefined ? process.env.ADMIN_PASSWORD : options.adminPassword
  const username = String(configuredUsername || '').trim()
  const password = String(configuredPassword || '')
  return {
    username,
    password,
    configured: !!username && !!password
  }
}

function getBearerToken(req) {
  const header = req && req.headers ? req.headers.authorization : ''
  const match = String(header || '').match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function safeTokenEquals(received, expected) {
  const receivedBuffer = Buffer.from(String(received || ''))
  const expectedBuffer = Buffer.from(String(expected || ''))
  if (!receivedBuffer.length || !expectedBuffer.length || receivedBuffer.length !== expectedBuffer.length) {
    return false
  }
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
}

function getAdminSessionTtlMs(options = {}) {
  const value = Number(options.adminSessionTtlMs || process.env.ADMIN_SESSION_TTL_MS || DEFAULT_ADMIN_SESSION_TTL_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADMIN_SESSION_TTL_MS
}

function getJwtSecret(options = {}) {
  const configuredSecret = options.jwtSecret === undefined ? process.env.JWT_SECRET : options.jwtSecret
  return String(configuredSecret || '').trim() || PROCESS_SESSION_SECRET
}

function getNowMs(options = {}) {
  const value = typeof options.now === 'function' ? options.now() : options.now
  if (value instanceof Date) return value.getTime()
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : Date.now()
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : ''
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')
}

function signTokenBody(body, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

export function verifyAdminCredentials(username, password, options = {}) {
  const credentials = getAdminCredentials(options)
  if (!credentials.configured) {
    return {
      ok: false,
      statusCode: 503,
      message: 'Admin login is not configured.'
    }
  }

  if (!safeTokenEquals(username, credentials.username) || !safeTokenEquals(password, credentials.password)) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Unauthorized'
    }
  }

  return {
    ok: true,
    username: credentials.username
  }
}

export function createAdminSessionToken(username, options = {}) {
  const nowMs = getNowMs(options)
  const expiresAtMs = nowMs + getAdminSessionTtlMs(options)
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }
  const payload = {
    sub: String(username || '').trim(),
    role: 'admin',
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(expiresAtMs / 1000)
  }
  const body = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`
  const token = `${body}.${signTokenBody(body, getJwtSecret(options))}`
  return {
    token,
    expiresAt: new Date(expiresAtMs).toISOString()
  }
}

export function verifyAdminSessionToken(token, options = {}) {
  const credentials = getAdminCredentials(options)
  if (!credentials.configured) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Unauthorized'
    }
  }

  const value = String(token || '').trim()
  const parts = value.split('.')
  if (parts.length !== 3) {
    return {
      ok: false,
      statusCode: 403,
      message: 'Unauthorized'
    }
  }

  const body = `${parts[0]}.${parts[1]}`
  const expectedSignature = signTokenBody(body, getJwtSecret(options))
  if (!safeTokenEquals(parts[2], expectedSignature)) {
    return {
      ok: false,
      statusCode: 403,
      message: 'Unauthorized'
    }
  }

  const payload = parseJson(base64UrlDecode(parts[1]))
  const expiresAtMs = Number(payload && payload.exp) * 1000
  if (!payload || payload.role !== 'admin' || !safeTokenEquals(payload.sub, credentials.username)) {
    return {
      ok: false,
      statusCode: 403,
      message: 'Unauthorized'
    }
  }

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= getNowMs(options)) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Unauthorized'
    }
  }

  return {
    ok: true,
    username: payload.sub
  }
}

export function requireAdminAuth(req, options = {}) {
  const receivedToken = getBearerToken(req)

  if (!receivedToken) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Unauthorized'
    }
  }

  return verifyAdminSessionToken(receivedToken, options)
}
