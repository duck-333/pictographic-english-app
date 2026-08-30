import crypto from 'node:crypto'
import https from 'node:https'

import { createSensitivePaymentSession } from './virtual-payment-session.mjs'

const WECHAT_ACCESS_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const WECHAT_CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session'
const WECHAT_PHONE_NUMBER_URL = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber'
const DEFAULT_WECHAT_TIMEOUT_MS = 7000
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000
const ACCESS_TOKEN_MAX_RESPONSE_BYTES = 64 * 1024
const MAX_ACCESS_TOKEN_LENGTH = 2048
const MAX_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 7200
// Bounds untrusted input without assuming an undocumented Wechat code alphabet.
const MAX_PAYMENT_LOGIN_CODE_LENGTH = 256
// Opaque identity values remain unmodified; these caps only reject malformed oversized responses.
const MAX_PAYMENT_IDENTITY_LENGTH = 128
// Keep the key opaque while rejecting unusably short or unbounded response values.
const MIN_PAYMENT_SESSION_KEY_LENGTH = 16
const MAX_PAYMENT_SESSION_KEY_LENGTH = 256
const ASCII_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

function normalizeString(value) {
  return String(value || '').trim()
}

function createWechatLoginError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'WECHAT_LOGIN_ERROR'
  error.statusCode = Number(options.statusCode || 502)
  error.wechatErrcode = options.wechatErrcode
  return error
}

function createPaymentSessionError(message, code, statusCode) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function normalizePaymentLoginCode(value) {
  if (typeof value !== 'string') {
    throw createPaymentSessionError(
      'Payment login code is invalid.',
      'PAYMENT_LOGIN_CODE_INVALID',
      400
    )
  }
  const code = value
  if (
    !code.trim() ||
    code.length > MAX_PAYMENT_LOGIN_CODE_LENGTH ||
    ASCII_CONTROL_CHARACTER_PATTERN.test(code)
  ) {
    throw createPaymentSessionError(
      'Payment login code is invalid.',
      'PAYMENT_LOGIN_CODE_INVALID',
      400
    )
  }
  return code
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function isSafeWechatString(value, options = {}) {
  if (typeof value !== 'string') return false
  if (!value || !value.trim() || value.trim() !== value) return false
  if (ASCII_CONTROL_CHARACTER_PATTERN.test(value)) return false
  const minimumLength = Number(options.minimumLength || 1)
  const maximumLength = Number(options.maximumLength || 0)
  if (value.length < minimumLength) return false
  return maximumLength <= 0 || value.length <= maximumLength
}

function getWechatConfig(options = {}) {
  const appid = normalizeString(
    options.appid === undefined
      ? process.env.WECHAT_MINIAPP_APPID || process.env.WECHAT_APPID
      : options.appid
  )
  const secret = normalizeString(
    options.secret === undefined
      ? process.env.WECHAT_MINIAPP_SECRET || process.env.WECHAT_SECRET
      : options.secret
  )
  return {
    appid,
    secret,
    configured: Boolean(appid && secret)
  }
}

function getNowMs(now) {
  const value = typeof now === 'function' ? now() : now
  if (value instanceof Date) return value.getTime()
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : Date.now()
}

function createWechatAccessTokenError(message, code = 'WECHAT_ACCESS_TOKEN_UNAVAILABLE', statusCode = 502) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function createAccessTokenConfigFingerprint(config) {
  return crypto
    .createHash('sha256')
    .update(config.appid, 'utf8')
    .update('\u0000', 'utf8')
    .update(config.secret, 'utf8')
    .digest('hex')
}

function requestWechatAccessTokenResponse(url, options = {}) {
  const requestImpl = options.request || https.request
  const timeout = Number(options.timeout || DEFAULT_WECHAT_TIMEOUT_MS)

  return new Promise((resolve, reject) => {
    let settled = false
    let req
    const rejectSafely = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const resolveSafely = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    try {
      req = requestImpl(url, {
        method: 'GET',
        timeout
      }, (res) => {
        const statusCode = Number(res.statusCode)
        const contentLength = Number(res.headers && res.headers['content-length'])
        if (
          !Number.isInteger(statusCode) ||
          statusCode < 200 ||
          statusCode >= 300 ||
          (Number.isFinite(contentLength) && contentLength > ACCESS_TOKEN_MAX_RESPONSE_BYTES)
        ) {
          try {
            res.destroy()
          } catch {
            // The controlled response error remains authoritative.
          }
          try {
            req.destroy()
          } catch {
            // The controlled response error remains authoritative.
          }
          rejectSafely(createWechatAccessTokenError('Wechat access token response is invalid.'))
          return
        }
        let raw = ''
        let responseBytes = 0
        if (typeof res.setEncoding === 'function') res.setEncoding('utf8')
        res.on('data', (chunk) => {
          if (settled) return
          responseBytes += Buffer.byteLength(chunk, 'utf8')
          if (responseBytes > ACCESS_TOKEN_MAX_RESPONSE_BYTES) {
            try {
              res.destroy()
            } catch {
              // Continue to destroy the request and return a controlled error.
            }
            try {
              req.destroy()
            } catch {
              // The controlled size error remains authoritative.
            }
            rejectSafely(createWechatAccessTokenError('Wechat access token response is too large.'))
            return
          }
          raw += chunk
        })
        res.on('end', () => {
          resolveSafely({
            statusCode: Number(res.statusCode),
            body: raw
          })
        })
        res.on('error', () => {
          rejectSafely(createWechatAccessTokenError('Wechat access token response failed.'))
        })
        res.on('aborted', () => {
          rejectSafely(createWechatAccessTokenError('Wechat access token response failed.'))
        })
        res.on('close', () => {
          if (!settled) {
            rejectSafely(createWechatAccessTokenError('Wechat access token response failed.'))
          }
        })
      })
    } catch {
      rejectSafely(createWechatAccessTokenError('Wechat access token service is unavailable.'))
      return
    }

    req.on('timeout', () => {
      try {
        req.destroy()
      } catch {
        // The controlled timeout error remains authoritative.
      }
      rejectSafely(createWechatAccessTokenError(
        'Wechat access token request timed out.',
        'WECHAT_ACCESS_TOKEN_TIMEOUT',
        504
      ))
    })
    req.on('error', () => {
      rejectSafely(createWechatAccessTokenError('Wechat access token service is unavailable.'))
    })
    req.end()
  })
}

export function createWechatAccessTokenProvider(options = {}) {
  const now = options.now || (() => new Date())
  let cache = {
    configFingerprint: '',
    token: '',
    refreshAtMs: 0
  }
  const refreshPromises = new Map()
  let activeConfigFingerprint = ''

  async function refreshAccessToken(config, configFingerprint) {
    const requestUrl = new URL(WECHAT_ACCESS_TOKEN_URL)
    requestUrl.searchParams.set('grant_type', 'client_credential')
    requestUrl.searchParams.set('appid', config.appid)
    requestUrl.searchParams.set('secret', config.secret)

    let response
    try {
      response = await requestWechatAccessTokenResponse(requestUrl, {
        timeout: options.timeout,
        request: options.request
      })
    } catch {
      throw createWechatAccessTokenError('Wechat access token service is unavailable.')
    }

    if (
      !response ||
      !Number.isInteger(response.statusCode) ||
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      typeof response.body !== 'string' ||
      !response.body ||
      Buffer.byteLength(response.body, 'utf8') > ACCESS_TOKEN_MAX_RESPONSE_BYTES
    ) {
      throw createWechatAccessTokenError('Wechat access token response is invalid.')
    }

    let payload
    try {
      payload = JSON.parse(response.body)
    } catch {
      throw createWechatAccessTokenError('Wechat access token response is invalid.')
    }

    if (!isPlainObject(payload)) {
      throw createWechatAccessTokenError('Wechat access token response is invalid.')
    }
    if (Object.hasOwn(payload, 'errcode')) {
      if (
        typeof payload.errcode !== 'number' ||
        !Number.isFinite(payload.errcode) ||
        !Number.isInteger(payload.errcode) ||
        payload.errcode !== 0
      ) {
        throw createWechatAccessTokenError('Wechat access token request failed.')
      }
    }

    if (!isSafeWechatString(payload.access_token, { maximumLength: MAX_ACCESS_TOKEN_LENGTH })) {
      throw createWechatAccessTokenError('Wechat access token response is invalid.')
    }
    if (
      typeof payload.expires_in !== 'number' ||
      !Number.isFinite(payload.expires_in) ||
      !Number.isInteger(payload.expires_in) ||
      payload.expires_in <= 0 ||
      payload.expires_in > MAX_ACCESS_TOKEN_EXPIRES_IN_SECONDS
    ) {
      throw createWechatAccessTokenError('Wechat access token response is invalid.')
    }

    const nowMs = getNowMs(now)
    const expiresInMs = payload.expires_in * 1000
    const refreshBufferMs = Math.min(
      ACCESS_TOKEN_REFRESH_BUFFER_MS,
      Math.max(100, Math.floor(expiresInMs * 0.1)),
      Math.max(1, Math.floor(expiresInMs / 2))
    )
    if (activeConfigFingerprint === configFingerprint) {
      cache = {
        configFingerprint,
        token: payload.access_token,
        refreshAtMs: nowMs + expiresInMs - refreshBufferMs
      }
    }
    return payload.access_token
  }

  async function getAccessToken() {
    const config = getWechatConfig(options)
    if (!config.configured) {
      throw createWechatAccessTokenError(
        'Wechat access token service is unavailable.',
        'WECHAT_ACCESS_TOKEN_CONFIG_MISSING',
        503
      )
    }

    const nowMs = getNowMs(now)
    const configFingerprint = createAccessTokenConfigFingerprint(config)
    activeConfigFingerprint = configFingerprint
    if (
      cache.configFingerprint === configFingerprint &&
      cache.token &&
      cache.refreshAtMs > nowMs
    ) {
      return cache.token
    }
    if (refreshPromises.has(configFingerprint)) {
      return refreshPromises.get(configFingerprint)
    }
    const refreshPromise = refreshAccessToken(config, configFingerprint).finally(() => {
      if (refreshPromises.get(configFingerprint) === refreshPromise) {
        refreshPromises.delete(configFingerprint)
      }
    })
    refreshPromises.set(configFingerprint, refreshPromise)
    return refreshPromise
  }

  function invalidate() {
    cache = {
      configFingerprint: '',
      token: '',
      refreshAtMs: 0
    }
    activeConfigFingerprint = ''
  }

  return Object.freeze({
    getAccessToken,
    invalidate
  })
}

function mapWechatLoginError(payload) {
  const errcode = Number(payload && payload.errcode)
  if (!Number.isFinite(errcode) || errcode === 0) return null

  if (errcode === 40029) {
    return createWechatLoginError('Login code is invalid.', {
      code: 'WECHAT_CODE_INVALID',
      statusCode: 400,
      wechatErrcode: errcode
    })
  }

  if (errcode === 40226) {
    return createWechatLoginError('Wechat login is blocked for this account.', {
      code: 'WECHAT_LOGIN_BLOCKED',
      statusCode: 403,
      wechatErrcode: errcode
    })
  }

  if (errcode === 45011) {
    return createWechatLoginError('Wechat login is rate limited.', {
      code: 'WECHAT_RATE_LIMITED',
      statusCode: 429,
      wechatErrcode: errcode
    })
  }

  if (errcode === -1) {
    return createWechatLoginError('Wechat login service is busy.', {
      code: 'WECHAT_SYSTEM_BUSY',
      statusCode: 503,
      wechatErrcode: errcode
    })
  }

  return createWechatLoginError('Wechat login failed.', {
    code: 'WECHAT_LOGIN_FAILED',
    statusCode: 502,
    wechatErrcode: errcode
  })
}

function mapWechatAccessTokenError(payload) {
  const errcode = Number(payload && payload.errcode)
  if (!Number.isFinite(errcode) || errcode === 0) return null

  if (errcode === 40013 || errcode === 40125) {
    return createWechatLoginError('Wechat mini program login is not configured.', {
      code: 'WECHAT_CONFIG_MISSING',
      statusCode: 503,
      wechatErrcode: errcode
    })
  }

  if (errcode === 45011) {
    return createWechatLoginError('Wechat login is rate limited.', {
      code: 'WECHAT_RATE_LIMITED',
      statusCode: 429,
      wechatErrcode: errcode
    })
  }

  if (errcode === -1) {
    return createWechatLoginError('Wechat login service is busy.', {
      code: 'WECHAT_SYSTEM_BUSY',
      statusCode: 503,
      wechatErrcode: errcode
    })
  }

  return createWechatLoginError('Wechat phone number exchange failed.', {
    code: 'WECHAT_PHONE_NUMBER_FAILED',
    statusCode: 502,
    wechatErrcode: errcode
  })
}

function mapWechatPhoneNumberError(payload) {
  const errcode = Number(payload && payload.errcode)
  if (!Number.isFinite(errcode) || errcode === 0) return null

  if (errcode === 40029) {
    return createWechatLoginError('Phone code is invalid.', {
      code: 'WECHAT_PHONE_CODE_INVALID',
      statusCode: 400,
      wechatErrcode: errcode
    })
  }

  if (errcode === 45011) {
    return createWechatLoginError('Wechat login is rate limited.', {
      code: 'WECHAT_RATE_LIMITED',
      statusCode: 429,
      wechatErrcode: errcode
    })
  }

  if (errcode === -1) {
    return createWechatLoginError('Wechat login service is busy.', {
      code: 'WECHAT_SYSTEM_BUSY',
      statusCode: 503,
      wechatErrcode: errcode
    })
  }

  return createWechatLoginError('Wechat phone number exchange failed.', {
    code: 'WECHAT_PHONE_NUMBER_FAILED',
    statusCode: 502,
    wechatErrcode: errcode
  })
}

function isAccessTokenInvalidPayload(payload) {
  const errcode = Number(payload && payload.errcode)
  return errcode === 40001 || errcode === 40014 || errcode === 42001
}

function requestJson(url, options = {}) {
  const timeout = Number(options.timeout || DEFAULT_WECHAT_TIMEOUT_MS)
  const method = normalizeString(options.method || 'GET').toUpperCase()
  const headers = {
    ...(options.headers || {})
  }
  let requestBody = null
  if (options.body !== undefined) {
    requestBody = typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body)
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json; charset=utf-8'
    }
    headers['Content-Length'] = Buffer.byteLength(requestBody)
  }

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      timeout,
      headers
    }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        raw += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw || '{}'))
        } catch (error) {
          reject(createWechatLoginError('Wechat API response is invalid.', {
            code: 'WECHAT_RESPONSE_INVALID'
          }))
        }
      })
    })

    req.on('timeout', () => {
      req.destroy(createWechatLoginError('Wechat login request timed out.', {
        code: 'WECHAT_TIMEOUT',
        statusCode: 504
      }))
    })
    req.on('error', (error) => {
      if (error && error.code && String(error.code).startsWith('WECHAT_')) {
        reject(error)
        return
      }
      reject(createWechatLoginError('Wechat login service is unavailable.', {
        code: 'WECHAT_NETWORK_ERROR'
      }))
    })
    if (requestBody !== null) {
      req.write(requestBody)
    }
    req.end()
  })
}

export function createWechatLoginClient(options = {}) {
  let accessTokenCache = {
    token: '',
    expiresAtMs: 0
  }
  const now = options.now || (() => new Date())
  const codeSessionRequest = options.requestJson || requestJson

  async function code2Session(jsCode) {
    const code = normalizeString(jsCode)
    if (!code) {
      throw createWechatLoginError('Login code is required.', {
        code: 'WECHAT_CODE_REQUIRED',
        statusCode: 400
      })
    }

    const config = getWechatConfig(options)
    if (!config.configured) {
      throw createWechatLoginError('Wechat mini program login is not configured.', {
        code: 'WECHAT_CONFIG_MISSING',
        statusCode: 503
      })
    }

    const requestUrl = new URL(WECHAT_CODE2SESSION_URL)
    requestUrl.searchParams.set('appid', config.appid)
    requestUrl.searchParams.set('secret', config.secret)
    requestUrl.searchParams.set('js_code', code)
    requestUrl.searchParams.set('grant_type', 'authorization_code')

    const payload = await codeSessionRequest(requestUrl, {
      timeout: options.timeout
    })
    const wechatError = mapWechatLoginError(payload)
    if (wechatError) throw wechatError

    const openid = normalizeString(payload.openid)
    if (!openid) {
      throw createWechatLoginError('Wechat login did not return openid.', {
        code: 'WECHAT_OPENID_MISSING'
      })
    }

    return {
      openid,
      unionid: normalizeString(payload.unionid)
    }
  }

  async function exchangePaymentSession(loginCode) {
    const code = normalizePaymentLoginCode(loginCode)
    const config = getWechatConfig(options)
    if (!config.configured) {
      throw createPaymentSessionError(
        'Wechat payment session service is unavailable.',
        'WECHAT_SERVICE_UNAVAILABLE',
        503
      )
    }

    const requestUrl = new URL(WECHAT_CODE2SESSION_URL)
    requestUrl.searchParams.set('appid', config.appid)
    requestUrl.searchParams.set('secret', config.secret)
    requestUrl.searchParams.set('js_code', code)
    requestUrl.searchParams.set('grant_type', 'authorization_code')

    let payload
    try {
      payload = await codeSessionRequest(requestUrl, {
        timeout: options.timeout
      })
    } catch {
      throw createPaymentSessionError(
        'Wechat payment session service is unavailable.',
        'WECHAT_SERVICE_UNAVAILABLE',
        503
      )
    }

    if (!isPlainObject(payload)) {
      throw createPaymentSessionError(
        'Wechat payment session is incomplete.',
        'WECHAT_PAYMENT_SESSION_INCOMPLETE',
        502
      )
    }

    if (
      Object.hasOwn(payload, 'errcode') &&
      (
        typeof payload.errcode !== 'number' ||
        !Number.isFinite(payload.errcode) ||
        !Number.isInteger(payload.errcode) ||
        payload.errcode !== 0
      )
    ) {
      throw createPaymentSessionError(
        'Wechat payment login code exchange failed.',
        'WECHAT_CODE_EXCHANGE_FAILED',
        400
      )
    }

    if (
      !isSafeWechatString(payload.openid, { maximumLength: MAX_PAYMENT_IDENTITY_LENGTH }) ||
      !isSafeWechatString(payload.session_key, {
        minimumLength: MIN_PAYMENT_SESSION_KEY_LENGTH,
        maximumLength: MAX_PAYMENT_SESSION_KEY_LENGTH
      })
    ) {
      throw createPaymentSessionError(
        'Wechat payment session is incomplete.',
        'WECHAT_PAYMENT_SESSION_INCOMPLETE',
        502
      )
    }

    let unionid = null
    if (Object.hasOwn(payload, 'unionid') && payload.unionid !== null) {
      if (!isSafeWechatString(payload.unionid, { maximumLength: MAX_PAYMENT_IDENTITY_LENGTH })) {
        throw createPaymentSessionError(
          'Wechat payment session is incomplete.',
          'WECHAT_PAYMENT_SESSION_INCOMPLETE',
          502
        )
      }
      unionid = payload.unionid
    }

    return createSensitivePaymentSession({
      openid: payload.openid,
      unionid
    }, payload.session_key)
  }

  async function getAccessToken() {
    const nowMs = getNowMs(now)
    if (accessTokenCache.token && accessTokenCache.expiresAtMs > nowMs + ACCESS_TOKEN_REFRESH_BUFFER_MS) {
      return accessTokenCache.token
    }

    const config = getWechatConfig(options)
    if (!config.configured) {
      throw createWechatLoginError('Wechat mini program login is not configured.', {
        code: 'WECHAT_CONFIG_MISSING',
        statusCode: 503
      })
    }

    const requestUrl = new URL(WECHAT_ACCESS_TOKEN_URL)
    requestUrl.searchParams.set('grant_type', 'client_credential')
    requestUrl.searchParams.set('appid', config.appid)
    requestUrl.searchParams.set('secret', config.secret)

    const payload = await requestJson(requestUrl, {
      timeout: options.timeout
    })
    const wechatError = mapWechatAccessTokenError(payload)
    if (wechatError) throw wechatError

    const token = normalizeString(payload.access_token)
    if (!token) {
      throw createWechatLoginError('Wechat phone number exchange failed.', {
        code: 'WECHAT_PHONE_NUMBER_FAILED',
        statusCode: 502
      })
    }

    const expiresInMs = Math.max(0, Number(payload.expires_in || 0) * 1000)
    accessTokenCache = {
      token,
      expiresAtMs: nowMs + expiresInMs
    }
    return token
  }

  async function requestPhoneNumberPayload(phoneCode, accessToken) {
    const requestUrl = new URL(WECHAT_PHONE_NUMBER_URL)
    requestUrl.searchParams.set('access_token', accessToken)
    return requestJson(requestUrl, {
      method: 'POST',
      timeout: options.timeout,
      body: {
        code: phoneCode
      }
    })
  }

  async function phoneCode2Number(phoneCode) {
    const code = normalizeString(phoneCode)
    if (!code) {
      throw createWechatLoginError('Phone code is required.', {
        code: 'WECHAT_PHONE_CODE_REQUIRED',
        statusCode: 400
      })
    }

    let payload = await requestPhoneNumberPayload(code, await getAccessToken())
    if (isAccessTokenInvalidPayload(payload)) {
      accessTokenCache = {
        token: '',
        expiresAtMs: 0
      }
      payload = await requestPhoneNumberPayload(code, await getAccessToken())
    }

    const wechatError = mapWechatPhoneNumberError(payload)
    if (wechatError) throw wechatError

    const phoneInfo = payload && (payload.phone_info || payload.phoneInfo)
    const purePhoneNumber = normalizeString(phoneInfo && phoneInfo.purePhoneNumber)
    const phoneNumber = normalizeString(phoneInfo && (phoneInfo.phoneNumber || purePhoneNumber))
    const countryCode = normalizeString(phoneInfo && phoneInfo.countryCode)
    if (!purePhoneNumber && !phoneNumber) {
      throw createWechatLoginError('Wechat phone number exchange failed.', {
        code: 'WECHAT_PHONE_NUMBER_FAILED',
        statusCode: 502
      })
    }

    return {
      phoneNumber,
      purePhoneNumber: purePhoneNumber || phoneNumber,
      countryCode
    }
  }

  return {
    code2Session,
    exchangePaymentSession,
    phoneCode2Number
  }
}
