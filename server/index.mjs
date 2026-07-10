import http from 'node:http'
import { pathToFileURL } from 'node:url'

import { createAdminSessionToken, createUserSessionToken, requireAdminAuth, verifyAdminCredentials } from './auth.mjs'
import { createIdentityStore } from './identity-store.mjs'
import { createUserStore } from './user-store.mjs'
import { createWechatLoginClient } from './wechat-login.mjs'
import { createWordStore } from './word-store.mjs'

const DEFAULT_PORT = 3001
const DEFAULT_HOST = '0.0.0.0'
const MAX_BODY_BYTES = 1024 * 1024

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8'
  })
  res.end(JSON.stringify(payload))
}

function sendOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  })
  res.end()
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'))
        req.destroy()
        return
      }
      raw += chunk
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error('Request body must be valid JSON.'))
      }
    })
    req.on('error', reject)
  })
}

function extractWordPayload(body) {
  if (body && body.word && typeof body.word === 'object') return body.word
  return body
}

function normalizePathname(pathname) {
  return pathname.replace(/\/+$/, '') || '/'
}

function normalizeRequestId(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w:.-]/g, '')
    .slice(0, 80)
}

const SAFE_PHONE_LOGIN_ERROR_MESSAGES = {
  WECHAT_CODE_REQUIRED: 'Login code is required.',
  WECHAT_PHONE_CODE_REQUIRED: 'Phone code is required.',
  WECHAT_CODE_INVALID: 'Login code is invalid.',
  WECHAT_PHONE_CODE_INVALID: 'Phone code is invalid.',
  WECHAT_CONFIG_MISSING: 'Wechat login is not configured.',
  WECHAT_LOGIN_BLOCKED: 'Wechat login is blocked.',
  WECHAT_RATE_LIMITED: 'Wechat login is rate limited.',
  WECHAT_SYSTEM_BUSY: 'Wechat service is busy.',
  WECHAT_LOGIN_FAILED: 'Wechat login failed.',
  WECHAT_NETWORK_ERROR: 'Wechat service is unavailable.',
  WECHAT_RESPONSE_INVALID: 'Wechat response is invalid.',
  WECHAT_OPENID_MISSING: 'Wechat identity is invalid.',
  WECHAT_OPENID_REQUIRED: 'Wechat identity is invalid.',
  WECHAT_PHONE_NUMBER_FAILED: 'Wechat phone number exchange failed.',
  WECHAT_TIMEOUT: 'Wechat request timed out.',
  PHONE_REQUIRED: 'Phone number is required.',
  PHONE_INVALID: 'Phone number is invalid.',
  PHONE_HASH_SECRET_MISSING: 'Phone login is not configured.',
  USER_DB_CONFIG_MISSING: 'User database is not configured.',
  IDENTITY_CONFLICT: 'Identity binding conflict.',
  INTERNAL_SERVER_ERROR: 'Internal server error.'
}

function sendPhoneLoginError(res, error) {
  const statusCode = Number(error && error.statusCode) || 500
  const code = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'
  sendJson(res, statusCode, {
    ok: false,
    code,
    message: SAFE_PHONE_LOGIN_ERROR_MESSAGES[code] || (
      statusCode >= 500 ? 'Internal server error.' : 'Request failed.'
    )
  })
}

function logPhoneLoginError(error, context = {}) {
  if (!context.requestId) return
  const code = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'
  console.warn(`wechat-phone-login requestId=${context.requestId} failed with ${code}`)
}

function summarizePublishedWords(words) {
  return (Array.isArray(words) ? words : []).map((word) => ({
    id: word.id,
    word: word.word,
    meaning: word.meaning,
    status: word.status
  }))
}

export function createApiHandler(options = {}) {
  const store = options.store || createWordStore()
  const userStore = options.userStore || createUserStore(options)
  const identityStore = options.identityStore || createIdentityStore(options)
  const wechatLoginClient = options.wechatLoginClient || createWechatLoginClient(options)
  const now = options.now || (() => new Date())
  const adminAuthOptions = {
    nodeEnv: options.nodeEnv,
    adminUsername: options.adminUsername,
    adminPassword: options.adminPassword,
    jwtSecret: options.jwtSecret,
    adminSessionTtlMs: options.adminSessionTtlMs,
    now
  }
  const userAuthOptions = {
    jwtSecret: options.jwtSecret,
    userSessionTtlMs: options.userSessionTtlMs,
    now
  }

  return async function handleApiRequest(req, res) {
    if (req.method === 'OPTIONS') {
      sendOptions(res)
      return
    }

    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
    const pathname = normalizePathname(requestUrl.pathname)

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'pictographic-english-api',
          timestamp: now().toISOString(),
          wordCount: await store.getWordCount()
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/homepage/featured-word') {
        const featured = await store.resolveHomepageFeaturedWord({
          date: now()
        })
        sendJson(res, 200, {
          ok: true,
          word: featured.word,
          source: featured.source
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/words') {
        const query = requestUrl.searchParams.get('q') || ''
        const words = await store.listWords({
          query,
          publishedOnly: true,
          limit: 20
        })
        sendJson(res, 200, {
          ok: true,
          count: words.length,
          words
        })
        return
      }

      if (req.method === 'GET' && pathname.startsWith('/api/words/')) {
        const id = decodeURIComponent(pathname.slice('/api/words/'.length))
        const word = await store.findWordById(id, {
          publishedOnly: true
        })
        if (!word) {
          sendJson(res, 404, {
            ok: false,
            message: 'Word not found.'
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          word
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/auth/wechat-login') {
        try {
          const body = await readJsonBody(req)
          const wechatIdentity = await wechatLoginClient.code2Session(body.code)
          const user = await userStore.findOrCreateWechatUser(wechatIdentity)
          const session = createUserSessionToken(user.id, userAuthOptions)

          sendJson(res, 200, {
            ok: true,
            token: session.token,
            tokenType: 'Bearer',
            expiresAt: session.expiresAt,
            user: {
              id: user.id,
              hasWechatBinding: true,
              isNew: Boolean(user.isNew)
            }
          })
        } catch (error) {
          const statusCode = Number(error && error.statusCode) || 500
          sendJson(res, statusCode, {
            ok: false,
            code: error && error.code ? error.code : 'INTERNAL_SERVER_ERROR',
            message: statusCode >= 500
              ? 'Internal server error.'
              : (error && error.message ? error.message : 'Request failed.')
          })
        }
        return
      }

      if (req.method === 'POST' && pathname === '/api/auth/wechat-phone-login') {
        let requestId = ''
        try {
          const body = await readJsonBody(req)
          requestId = normalizeRequestId(body.requestId)
          const wechatIdentity = await wechatLoginClient.code2Session(body.loginCode)
          const phoneIdentity = await wechatLoginClient.phoneCode2Number(body.phoneCode)
          const user = await identityStore.resolveWechatPhoneIdentity({
            openid: wechatIdentity.openid,
            unionid: wechatIdentity.unionid,
            phone: phoneIdentity
          })
          const session = createUserSessionToken(user.id, userAuthOptions)

          sendJson(res, 200, {
            ok: true,
            token: session.token,
            tokenType: 'Bearer',
            expiresAt: session.expiresAt,
            user: {
              id: user.id,
              hasWechatBinding: true,
              hasPhoneBinding: true,
              phoneMasked: user.phoneMasked,
              isNew: Boolean(user.isNew)
            }
          })
        } catch (error) {
          logPhoneLoginError(error, {
            requestId
          })
          sendPhoneLoginError(res, error)
        }
        return
      }

      if (req.method === 'POST' && pathname === '/api/admin/login') {
        const body = await readJsonBody(req)
        const authResult = verifyAdminCredentials(body.username, body.password, adminAuthOptions)
        if (!authResult.ok) {
          sendJson(res, authResult.statusCode, {
            ok: false,
            message: authResult.message
          })
          return
        }

        const session = createAdminSessionToken(authResult.username, adminAuthOptions)
        sendJson(res, 200, {
          ok: true,
          token: session.token,
          tokenType: 'Bearer',
          expiresAt: session.expiresAt
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/admin/homepage-featured') {
        const authResult = requireAdminAuth(req, adminAuthOptions)
        if (!authResult.ok) {
          sendJson(res, authResult.statusCode, {
            ok: false,
            message: 'Unauthorized'
          })
          return
        }

        const featured = await store.resolveHomepageFeaturedWord({
          date: now()
        })
        const publishedWords = await store.listWords({
          publishedOnly: true,
          query: ''
        })
        sendJson(res, 200, {
          ok: true,
          config: featured.config,
          currentWord: featured.word,
          source: featured.source,
          publishedWords: summarizePublishedWords(publishedWords)
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/admin/homepage-featured') {
        const authResult = requireAdminAuth(req, adminAuthOptions)
        if (!authResult.ok) {
          sendJson(res, authResult.statusCode, {
            ok: false,
            message: 'Unauthorized'
          })
          return
        }

        const body = await readJsonBody(req)
        const result = await store.saveHomepageFeaturedConfig(body, {
          updatedBy: 'admin-api'
        })
        if (!result.ok) {
          sendJson(res, 400, {
            ok: false,
            message: 'Homepage featured configuration validation failed.',
            errors: result.errors,
            config: result.config
          })
          return
        }

        const featured = await store.resolveHomepageFeaturedWord({
          date: now()
        })
        sendJson(res, 200, {
          ok: true,
          config: result.config,
          currentWord: featured.word,
          source: featured.source
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/admin/auth/check') {
        const authResult = requireAdminAuth(req, adminAuthOptions)
        if (!authResult.ok) {
          sendJson(res, authResult.statusCode, {
            ok: false,
            message: 'Unauthorized'
          })
          return
        }

        sendJson(res, 200, {
          ok: true
        })
        return
      }

      if (req.method === 'POST' && pathname === '/api/admin/words') {
        const authResult = requireAdminAuth(req, adminAuthOptions)
        if (!authResult.ok) {
          sendJson(res, authResult.statusCode, {
            ok: false,
            message: 'Unauthorized'
          })
          return
        }

        const body = await readJsonBody(req)
        const extracted = extractWordPayload(body)
        const result = await store.saveWord(extracted)
        if (!result.ok) {
          sendJson(res, 400, {
            ok: false,
            message: 'Word validation failed.',
            errors: result.errors,
            word: result.word
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          word: result.word
        })
        return
      }

      sendJson(res, 404, {
        ok: false,
        message: 'API route not found.'
      })
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        message: error && error.message ? error.message : 'Internal server error.'
      })
    }
  }
}

export function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || DEFAULT_PORT)
  const host = options.host || process.env.HOST || DEFAULT_HOST
  const store = options.store || createWordStore()
  const server = http.createServer(createApiHandler({ store }))

  server.listen(port, host, () => {
    console.log(`Pictographic English API running at http://${host}:${port}`)
  })

  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
}
