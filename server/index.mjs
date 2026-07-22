import http from 'node:http'
import { pathToFileURL } from 'node:url'

import { assertUserAuthConfig, createUserSessionToken, requireAdminAuth, requireUserAuth } from './auth.mjs'
import { createIdentityStore } from './identity-store.mjs'
import { createUserEntitlementStore } from './user-entitlement-store.mjs'
import { createUserFavoritesStore } from './user-favorites-store.mjs'
import { createUserRecentWordsStore } from './user-recent-words-store.mjs'
import { createUserStore } from './user-store.mjs'
import { createWechatLoginClient } from './wechat-login.mjs'
import { createWordStore } from './word-store.mjs'

const DEFAULT_PORT = 3001
const DEFAULT_HOST = '0.0.0.0'
const MAX_BODY_BYTES = 1024 * 1024
const MAX_FAVORITE_WORD_ID_LENGTH = 191
const MAX_RECENT_WORD_ID_LENGTH = 191

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8'
  })
  res.end(JSON.stringify(payload))
}

function sendOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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

async function ensureRegistrationBonusForUser(user, userEntitlementStore) {
  if (!user || !userEntitlementStore) return null

  const userId = String(user.id || '').trim()
  if (!userId) return null

  return await userEntitlementStore.ensureRegistrationBonus(userId)
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
  USER_DB_ERROR: 'User database is unavailable.',
  IDENTITY_CONFLICT: 'Identity binding conflict.',
  INTERNAL_SERVER_ERROR: 'Internal server error.'
}

const DATABASE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH'
])

function normalizeErrorStatusCode(value, fallback = 500) {
  const statusCode = Number(value)
  return Number.isFinite(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : fallback
}

function isDatabaseErrorCode(code) {
  return /^ER_/.test(code) || /^PROTOCOL_/.test(code) || DATABASE_ERROR_CODES.has(code)
}

function getPublicPhoneLoginError(error) {
  const rawCode = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'

  if (Object.prototype.hasOwnProperty.call(SAFE_PHONE_LOGIN_ERROR_MESSAGES, rawCode)) {
    return {
      statusCode: normalizeErrorStatusCode(error && error.statusCode),
      code: rawCode
    }
  }

  if (isDatabaseErrorCode(rawCode)) {
    return {
      statusCode: 503,
      code: 'USER_DB_ERROR'
    }
  }

  if (/^WECHAT_/.test(rawCode)) {
    return {
      statusCode: normalizeErrorStatusCode(error && error.statusCode, 502),
      code: 'WECHAT_LOGIN_FAILED'
    }
  }

  if (/^IDENTITY_/.test(rawCode)) {
    return {
      statusCode: 409,
      code: 'IDENTITY_CONFLICT'
    }
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR'
  }
}

function sendPhoneLoginError(res, error) {
  const publicError = getPublicPhoneLoginError(error)
  sendJson(res, publicError.statusCode, {
    ok: false,
    code: publicError.code,
    message: SAFE_PHONE_LOGIN_ERROR_MESSAGES[publicError.code]
  })
}

function logPhoneLoginError(error, context = {}) {
  const rawCode = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'
  const publicError = getPublicPhoneLoginError(error)
  const requestPart = context.requestId ? ` requestId=${context.requestId}` : ''
  console.warn(
    `wechat-phone-login${requestPart} failed rawCode=${rawCode} publicCode=${publicError.code} status=${publicError.statusCode}`
  )
}

function getPublicUserStoreError(error) {
  const rawCode = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'
  if (rawCode === 'USER_DB_CONFIG_MISSING' || isDatabaseErrorCode(rawCode)) {
    return {
      statusCode: 503,
      code: 'USER_DB_ERROR',
      message: 'User database is unavailable.'
    }
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error.'
  }
}

function sendUserStoreError(res, error) {
  const publicError = getPublicUserStoreError(error)
  sendJson(res, publicError.statusCode, {
    ok: false,
    code: publicError.code,
    message: publicError.message
  })
}

function createUserEntitlementRequestError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_ENTITLEMENT_REQUEST_ERROR'
  error.statusCode = Number(options.statusCode || 500)
  return error
}

function getPublicUserEntitlementError(error) {
  const rawCode = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'

  if (rawCode === 'USER_ENTITLEMENT_DB_CONFIG_MISSING' || rawCode === 'USER_ENTITLEMENT_DB_ERROR' || isDatabaseErrorCode(rawCode)) {
    return {
      statusCode: 500,
      code: 'USER_ENTITLEMENT_DB_ERROR',
      message: 'User entitlement database is unavailable.'
    }
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error.'
  }
}

function sendUserEntitlementError(res, error) {
  const publicError = getPublicUserEntitlementError(error)
  sendJson(res, publicError.statusCode, {
    ok: false,
    code: publicError.code,
    message: publicError.message
  })
}

function toSafeEntitlementPayload(entitlement) {
  const source = entitlement && typeof entitlement === 'object' ? entitlement : {}
  return {
    quotaBalance: Number(source.quotaBalance || 0),
    quotaTotalGranted: Number(source.quotaTotalGranted || 0),
    quotaTotalConsumed: Number(source.quotaTotalConsumed || 0),
    membershipType: String(source.membershipType || 'none'),
    membershipStatus: String(source.membershipStatus || 'none'),
    membershipExpireAt: source.membershipExpireAt || null
  }
}

async function getOrInitializeUserEntitlement(userId, userEntitlementStore) {
  if (!userEntitlementStore) {
    throw createUserEntitlementRequestError('User entitlement store is not available.', {
      code: 'USER_ENTITLEMENT_STORE_UNAVAILABLE'
    })
  }

  const existingEntitlement = await userEntitlementStore.getUserEntitlement(userId)
  if (existingEntitlement) return existingEntitlement

  const registrationBonusResult = await userEntitlementStore.ensureRegistrationBonus(userId)
  const initializedEntitlement = registrationBonusResult && registrationBonusResult.entitlement
    ? registrationBonusResult.entitlement
    : await userEntitlementStore.getUserEntitlement(userId)

  if (!initializedEntitlement) {
    throw createUserEntitlementRequestError('User entitlement initialization failed.', {
      code: 'USER_ENTITLEMENT_INITIALIZATION_FAILED'
    })
  }

  return initializedEntitlement
}

function createUserFavoritesRequestError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_FAVORITES_REQUEST_ERROR'
  error.statusCode = Number(options.statusCode || 400)
  return error
}

function normalizeFavoriteWordId(value) {
  const wordId = String(value || '').trim()
  if (!wordId) {
    throw createUserFavoritesRequestError('Word id is required.', {
      code: 'WORD_ID_REQUIRED',
      statusCode: 400
    })
  }
  if (wordId.length > MAX_FAVORITE_WORD_ID_LENGTH) {
    throw createUserFavoritesRequestError('Word id is invalid.', {
      code: 'WORD_ID_INVALID',
      statusCode: 400
    })
  }
  return wordId
}

function getPublicUserFavoritesError(error) {
  const rawCode = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'

  if (rawCode === 'WORD_ID_REQUIRED') {
    return {
      statusCode: 400,
      code: 'WORD_ID_REQUIRED',
      message: 'Word id is required.'
    }
  }

  if (rawCode === 'WORD_ID_INVALID') {
    return {
      statusCode: 400,
      code: 'WORD_ID_INVALID',
      message: 'Word id is invalid.'
    }
  }

  if (rawCode === 'USER_FAVORITES_DB_CONFIG_MISSING' || rawCode === 'USER_FAVORITES_DB_ERROR' || isDatabaseErrorCode(rawCode)) {
    return {
      statusCode: 503,
      code: 'USER_FAVORITES_DB_ERROR',
      message: 'User favorites database is unavailable.'
    }
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error.'
  }
}

function sendUserFavoritesError(res, error) {
  const publicError = getPublicUserFavoritesError(error)
  sendJson(res, publicError.statusCode, {
    ok: false,
    code: publicError.code,
    message: publicError.message
  })
}

function createUserRecentWordsRequestError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_RECENT_WORDS_REQUEST_ERROR'
  error.statusCode = Number(options.statusCode || 400)
  return error
}

function normalizeRecentWordId(value) {
  const wordId = String(value || '').trim()
  if (!wordId) {
    throw createUserRecentWordsRequestError('Word id is required.', {
      code: 'WORD_ID_REQUIRED',
      statusCode: 400
    })
  }
  if (wordId.length > MAX_RECENT_WORD_ID_LENGTH) {
    throw createUserRecentWordsRequestError('Word id is invalid.', {
      code: 'WORD_ID_INVALID',
      statusCode: 400
    })
  }
  return wordId
}

function getPublicUserRecentWordsError(error) {
  const rawCode = error && error.code ? String(error.code) : 'INTERNAL_SERVER_ERROR'

  if (rawCode === 'WORD_ID_REQUIRED') {
    return {
      statusCode: 400,
      code: 'WORD_ID_REQUIRED',
      message: 'Word id is required.'
    }
  }

  if (rawCode === 'WORD_ID_INVALID') {
    return {
      statusCode: 400,
      code: 'WORD_ID_INVALID',
      message: 'Word id is invalid.'
    }
  }

  if (rawCode === 'USER_RECENT_WORDS_DB_CONFIG_MISSING' || rawCode === 'USER_RECENT_WORDS_DB_ERROR' || isDatabaseErrorCode(rawCode)) {
    return {
      statusCode: 503,
      code: 'USER_RECENT_WORDS_DB_ERROR',
      message: 'User recent words database is unavailable.'
    }
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error.'
  }
}

function sendUserRecentWordsError(res, error) {
  const publicError = getPublicUserRecentWordsError(error)
  sendJson(res, publicError.statusCode, {
    ok: false,
    code: publicError.code,
    message: publicError.message
  })
}

function sendUserAuthError(res, authResult) {
  sendJson(res, authResult.statusCode, {
    ok: false,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized'
  })
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
  const shouldCreateDefaultUserEntitlementStore = !options.userEntitlementStore && !options.userStore && !options.identityStore
  const userEntitlementStore = options.userEntitlementStore || (
    shouldCreateDefaultUserEntitlementStore ? createUserEntitlementStore(options) : null
  )
  const userFavoritesStore = options.userFavoritesStore || createUserFavoritesStore(options)
  const userRecentWordsStore = options.userRecentWordsStore || createUserRecentWordsStore(options)
  const identityStore = options.identityStore || createIdentityStore(options)
  const wechatLoginClient = options.wechatLoginClient || createWechatLoginClient(options)
  const now = options.now || (() => new Date())
  const adminAuthOptions = {
    nodeEnv: options.nodeEnv,
    adminApiToken: options.adminApiToken
  }
  const userAuthOptions = {
    jwtSecret: options.jwtSecret,
    nodeEnv: options.nodeEnv,
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
          await ensureRegistrationBonusForUser(user, userEntitlementStore)
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
          await ensureRegistrationBonusForUser(user, userEntitlementStore)
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

      if (req.method === 'GET' && pathname === '/api/me') {
        const authResult = requireUserAuth(req, userAuthOptions)
        if (!authResult.ok) {
          sendJson(res, authResult.statusCode, {
            ok: false,
            message: 'Unauthorized'
          })
          return
        }

        try {
          const profile = await userStore.findUserProfileById(authResult.userId)
          if (!profile) {
            sendJson(res, 404, {
              ok: false,
              code: 'USER_NOT_FOUND',
              message: 'User not found.'
            })
            return
          }

          sendJson(res, 200, {
            ok: true,
            user: {
              id: profile.id,
              hasWechatBinding: Boolean(profile.hasWechatBinding),
              hasPhoneBinding: Boolean(profile.hasPhoneBinding),
              phoneMasked: String(profile.phoneMasked || '')
            },
            session: {
              tokenType: 'Bearer',
              expiresAt: authResult.expiresAt
            }
          })
        } catch (error) {
          sendUserStoreError(res, error)
        }
        return
      }

      if (req.method === 'GET' && pathname === '/api/user/entitlements') {
        const authResult = requireUserAuth(req, userAuthOptions)
        if (!authResult.ok) {
          sendJson(res, 401, {
            ok: false,
            code: 'UNAUTHORIZED',
            message: 'Unauthorized'
          })
          return
        }

        try {
          const profile = await userStore.findUserProfileById(authResult.userId)
          if (!profile) {
            sendJson(res, 401, {
              ok: false,
              code: 'UNAUTHORIZED',
              message: 'Unauthorized'
            })
            return
          }

          const entitlement = await getOrInitializeUserEntitlement(authResult.userId, userEntitlementStore)
          const payload = toSafeEntitlementPayload(entitlement)
          sendJson(res, 200, {
            ok: true,
            ...payload
          })
        } catch (error) {
          sendUserEntitlementError(res, error)
        }
        return
      }

      if (req.method === 'GET' && pathname === '/api/user/favorites') {
        const authResult = requireUserAuth(req, userAuthOptions)
        if (!authResult.ok) {
          sendUserAuthError(res, authResult)
          return
        }

        try {
          const favorites = await userFavoritesStore.listFavorites(authResult.userId)
          sendJson(res, 200, {
            ok: true,
            favorites,
            count: favorites.length
          })
        } catch (error) {
          sendUserFavoritesError(res, error)
        }
        return
      }

      if (req.method === 'POST' && pathname === '/api/user/favorites') {
        const authResult = requireUserAuth(req, userAuthOptions)
        if (!authResult.ok) {
          sendUserAuthError(res, authResult)
          return
        }

        try {
          const body = await readJsonBody(req)
          const wordId = normalizeFavoriteWordId(body.wordId)
          const favorite = await userFavoritesStore.addFavorite(authResult.userId, wordId)
          sendJson(res, 200, {
            ok: true,
            favorite
          })
        } catch (error) {
          sendUserFavoritesError(res, error)
        }
        return
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/user/favorites/')) {
        const authResult = requireUserAuth(req, userAuthOptions)
        if (!authResult.ok) {
          sendUserAuthError(res, authResult)
          return
        }

        try {
          const wordId = normalizeFavoriteWordId(decodeURIComponent(pathname.slice('/api/user/favorites/'.length)))
          const result = await userFavoritesStore.removeFavorite(authResult.userId, wordId)
          sendJson(res, 200, {
            ok: true,
            wordId: result.wordId,
            deleted: result.deleted
          })
        } catch (error) {
          sendUserFavoritesError(res, error)
        }
        return
      }

      if (req.method === 'GET' && pathname === '/api/user/recent-words') {
        const authResult = requireUserAuth(req, userAuthOptions)
        if (!authResult.ok) {
          sendUserAuthError(res, authResult)
          return
        }

        try {
          const recentWords = await userRecentWordsStore.listRecentWords(authResult.userId)
          sendJson(res, 200, {
            ok: true,
            recentWords,
            count: recentWords.length
          })
        } catch (error) {
          sendUserRecentWordsError(res, error)
        }
        return
      }

      if (req.method === 'POST' && pathname === '/api/user/recent-words') {
        const authResult = requireUserAuth(req, userAuthOptions)
        if (!authResult.ok) {
          sendUserAuthError(res, authResult)
          return
        }

        try {
          const body = await readJsonBody(req)
          const wordId = normalizeRecentWordId(body.wordId)
          const recentWord = await userRecentWordsStore.recordRecentWord(authResult.userId, wordId)
          sendJson(res, 200, {
            ok: true,
            recentWord
          })
        } catch (error) {
          sendUserRecentWordsError(res, error)
        }
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
  assertUserAuthConfig({
    jwtSecret: options.jwtSecret,
    nodeEnv: options.nodeEnv
  })
  const server = http.createServer(createApiHandler({
    ...options,
    store
  }))

  server.listen(port, host, () => {
    console.log(`Pictographic English API running at http://${host}:${port}`)
  })

  return server
}

startServer()
