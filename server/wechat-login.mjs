import https from 'node:https'

const WECHAT_CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session'
const DEFAULT_WECHAT_TIMEOUT_MS = 7000

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

function mapWechatError(payload) {
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

function requestJson(url, options = {}) {
  const timeout = Number(options.timeout || DEFAULT_WECHAT_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', timeout }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        raw += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw || '{}'))
        } catch (error) {
          reject(createWechatLoginError('Wechat login response is invalid.', {
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
    req.end()
  })
}

export function createWechatLoginClient(options = {}) {
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
    const wechatError = mapWechatError(payload)
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

  return {
    code2Session
  }
}
