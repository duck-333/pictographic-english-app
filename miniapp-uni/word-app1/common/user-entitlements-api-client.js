import { getWordApiBaseUrl } from './api-config.js'
import { getAuthSession } from './auth-store.js'

export const USER_ENTITLEMENTS_API_TIMEOUT_MS = 7000

function hasUniRequest() {
  return typeof uni !== 'undefined' && uni && typeof uni.request === 'function'
}

function createUserEntitlementsApiError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_ENTITLEMENTS_API_ERROR'
  error.statusCode = Number(options.statusCode || 0)
  return error
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function buildUrl(path, options = {}) {
  const baseUrl = getWordApiBaseUrl(options)
  if (!baseUrl) return ''
  return `${baseUrl}${path}`
}

function getAuthorization(options = {}) {
  const session = options.session || getAuthSession()
  const token = session && session.token ? String(session.token).trim() : ''
  if (!token) {
    throw createUserEntitlementsApiError('User session is required.', {
      code: 'USER_AUTH_REQUIRED',
      statusCode: 401
    })
  }
  return `Bearer ${token}`
}

function normalizeEntitlement(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    quotaBalance: toNumber(source.quotaBalance),
    quotaTotalGranted: toNumber(source.quotaTotalGranted),
    quotaTotalConsumed: toNumber(source.quotaTotalConsumed),
    membershipType: String(source.membershipType || 'none').trim() || 'none',
    membershipStatus: String(source.membershipStatus || 'none').trim() || 'none',
    membershipExpireAt: source.membershipExpireAt ? String(source.membershipExpireAt).trim() : ''
  }
}

function requestJson(path, options = {}) {
  const url = buildUrl(path, options)
  if (!url || !hasUniRequest()) {
    return Promise.reject(createUserEntitlementsApiError('User entitlements API is not available in this runtime.', {
      code: 'USER_ENTITLEMENTS_API_UNAVAILABLE'
    }))
  }

  let authorization = ''
  try {
    authorization = getAuthorization(options)
  } catch (error) {
    return Promise.reject(error)
  }

  const timeout = Number(options.timeout || USER_ENTITLEMENTS_API_TIMEOUT_MS)
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
      finish(reject, createUserEntitlementsApiError('User entitlements API request timed out.', {
        code: 'USER_ENTITLEMENTS_API_TIMEOUT'
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
        'Content-Type': 'application/json',
        Authorization: authorization
      },
      success: (response) => {
        const statusCode = Number(response.statusCode || 0)
        const data = response.data && typeof response.data === 'object' ? response.data : {}
        if (statusCode >= 200 && statusCode < 300 && data.ok !== false) {
          finish(resolve, data)
          return
        }
        finish(reject, createUserEntitlementsApiError(data.message || `User entitlements API request failed with ${statusCode}`, {
          code: data.code || 'USER_ENTITLEMENTS_API_RESPONSE_ERROR',
          statusCode
        }))
      },
      fail: (requestError) => {
        const message = requestError && requestError.errMsg
          ? requestError.errMsg
          : 'User entitlements API request failed.'
        finish(reject, createUserEntitlementsApiError(message, {
          code: /timeout/i.test(message) ? 'USER_ENTITLEMENTS_API_TIMEOUT' : 'USER_ENTITLEMENTS_API_NETWORK_ERROR'
        }))
      }
    })
  })
}

export async function getUserEntitlements(options = {}) {
  const data = await requestJson('/api/user/entitlements', options)
  return normalizeEntitlement(data)
}
