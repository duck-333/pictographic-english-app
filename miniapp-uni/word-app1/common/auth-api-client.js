import { getWordApiBaseUrl } from './api-config.js'
import { saveAuthSession } from './auth-store.js'

export const AUTH_API_TIMEOUT_MS = 7000

function hasUniApi(name) {
  return typeof uni !== 'undefined' && uni && typeof uni[name] === 'function'
}

function createAuthError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'AUTH_ERROR'
  error.statusCode = Number(options.statusCode || 0)
  return error
}

function buildUrl(path, options = {}) {
  const baseUrl = getWordApiBaseUrl(options)
  if (!baseUrl) return ''
  return `${baseUrl}${path}`
}

function requestJson(path, options = {}) {
  const url = buildUrl(path, options)
  if (!url || !hasUniApi('request')) {
    return Promise.reject(createAuthError('Auth API is not available in this runtime.', {
      code: 'AUTH_API_UNAVAILABLE'
    }))
  }

  const timeout = Number(options.timeout || AUTH_API_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    let settled = false
    let requestTask = null
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      callback(value)
    }
    const timeoutTimer = setTimeout(() => {
      finish(reject, createAuthError('Auth API request timed out.', {
        code: 'AUTH_API_TIMEOUT'
      }))
      if (requestTask && typeof requestTask.abort === 'function') {
        requestTask.abort()
      }
    }, timeout)

    requestTask = uni.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      timeout,
      header: {
        'Content-Type': 'application/json'
      },
      success: (response) => {
        const statusCode = Number(response.statusCode || 0)
        const data = response.data && typeof response.data === 'object' ? response.data : {}
        if (statusCode >= 200 && statusCode < 300 && data.ok !== false) {
          finish(resolve, data)
          return
        }
        finish(reject, createAuthError(data.message || `Auth API request failed with ${statusCode}`, {
          code: data.code || 'AUTH_API_RESPONSE_ERROR',
          statusCode
        }))
      },
      fail: (requestError) => {
        const message = requestError && requestError.errMsg
          ? requestError.errMsg
          : 'Auth API request failed.'
        finish(reject, createAuthError(message, {
          code: /timeout/i.test(message) ? 'AUTH_API_TIMEOUT' : 'AUTH_API_NETWORK_ERROR'
        }))
      }
    })
  })
}

function requestWechatLoginCode(options = {}) {
  if (!hasUniApi('login')) {
    return Promise.reject(createAuthError('Wechat login is not available in this runtime.', {
      code: 'WECHAT_LOGIN_UNAVAILABLE'
    }))
  }

  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      timeout: Number(options.timeout || AUTH_API_TIMEOUT_MS),
      success: (response) => {
        const code = response && response.code ? String(response.code).trim() : ''
        if (!code) {
          reject(createAuthError('Wechat login did not return code.', {
            code: 'WECHAT_CODE_MISSING'
          }))
          return
        }
        resolve(code)
      },
      fail: (error) => {
        reject(createAuthError(error && error.errMsg ? error.errMsg : 'Wechat login failed.', {
          code: 'WECHAT_LOGIN_FAILED'
        }))
      }
    })
  })
}

export async function loginWithWechat(options = {}) {
  const code = await requestWechatLoginCode(options)
  const session = await requestJson('/api/auth/wechat-login', {
    ...options,
    method: 'POST',
    data: {
      code
    }
  })
  const savedSession = saveAuthSession(session)
  if (!savedSession) {
    throw createAuthError('Auth API response is invalid.', {
      code: 'AUTH_SESSION_INVALID'
    })
  }
  return savedSession
}
