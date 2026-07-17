import crypto from 'node:crypto'

export const DEFAULT_DEV_ADMIN_API_TOKEN = 'dev-admin-token'
const DEFAULT_USER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PROCESS_SESSION_SECRET = crypto.randomBytes(32).toString('hex')

export function isProductionNodeEnv(nodeEnv = process.env.NODE_ENV) {
  return String(nodeEnv || '').trim() === 'production'
}

export function getAdminAuthConfig(options = {}) {
  const nodeEnv = options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv
  const configuredToken = options.adminApiToken === undefined ? process.env.ADMIN_API_TOKEN : options.adminApiToken
  const token = String(configuredToken || '').trim()
  const production = isProductionNodeEnv(nodeEnv)

  if (production) {
    if (!token || token === DEFAULT_DEV_ADMIN_API_TOKEN) {
      return {
        token: '',
        production,
        source: 'missing-production-token',
        usingDefaultToken: false
      }
    }

    return {
      token,
      production,
      source: 'env',
      usingDefaultToken: false
    }
  }

  if (token) {
    return {
      token,
      production,
      source: 'env',
      usingDefaultToken: false
    }
  }

  return {
    token: DEFAULT_DEV_ADMIN_API_TOKEN,
    production,
    source: 'development-default',
    usingDefaultToken: true
  }
}

export function getAdminApiToken(options = {}) {
  return getAdminAuthConfig(options).token
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

function getUserSessionTtlMs(options = {}) {
  const value = Number(options.userSessionTtlMs || process.env.USER_SESSION_TTL_MS || DEFAULT_USER_SESSION_TTL_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_USER_SESSION_TTL_MS
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

export function createUserSessionToken(userId, options = {}) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) {
    throw new Error('User id is required.')
  }

  const nowMs = getNowMs(options)
  const expiresAtMs = nowMs + getUserSessionTtlMs(options)
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }
  const payload = {
    sub: normalizedUserId,
    role: 'user',
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

export function verifyUserSessionToken(token, options = {}) {
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
  const userId = String(payload && payload.sub || '').trim()
  const expiresAtMs = Number(payload && payload.exp) * 1000
  if (!payload || payload.role !== 'user' || !userId) {
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
    userId,
    expiresAt: new Date(expiresAtMs).toISOString()
  }
}

export function requireAdminAuth(req, options = {}) {
  const expectedToken = getAdminApiToken(options)
  const receivedToken = getBearerToken(req)

  if (!expectedToken || !receivedToken) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Unauthorized'
    }
  }

  if (!safeTokenEquals(receivedToken, expectedToken)) {
    return {
      ok: false,
      statusCode: 403,
      message: 'Unauthorized'
    }
  }

  return {
    ok: true
  }
}

export function requireUserAuth(req, options = {}) {
  const receivedToken = getBearerToken(req)

  if (!receivedToken) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Unauthorized'
    }
  }

  return verifyUserSessionToken(receivedToken, options)
}
