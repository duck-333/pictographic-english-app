import https from 'node:https'

const WECHAT_ACCESS_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token'
const WECHAT_CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session'
const WECHAT_PHONE_NUMBER_URL = 'https://api.weixin.qq.com/wxa/business/getuserphonenumber'
const DEFAULT_WECHAT_TIMEOUT_MS = 7000
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000

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

    const payload = await requestJson(requestUrl, {
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
    phoneCode2Number
  }
}
