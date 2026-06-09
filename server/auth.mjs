import crypto from 'node:crypto'

export const DEFAULT_DEV_ADMIN_API_TOKEN = 'dev-admin-token'

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
