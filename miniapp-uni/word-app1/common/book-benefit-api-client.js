import { getWordApiBaseUrl } from './api-config.js'
import { clearAuthSession, getAuthSession } from './auth-store.js'

export const BOOK_BENEFIT_API_TIMEOUT_MS = 7000

function createBookBenefitApiError(code, statusCode = 0) {
  const error = new Error('Book-benefit request failed.')
  error.code = String(code || 'BOOK_BENEFIT_API_ERROR')
  error.statusCode = Number(statusCode || 0)
  return error
}

function getAuthorization(options = {}) {
  const session = options.session || getAuthSession()
  const token = session && session.token ? String(session.token).trim() : ''
  if (!token) throw createBookBenefitApiError('USER_AUTH_REQUIRED', 401)
  return `Bearer ${token}`
}

function normalizeRedeemInput(input = {}) {
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  const operationId = typeof input.operationId === 'string' ? input.operationId.trim() : ''
  if (!code || code.length > 128) throw createBookBenefitApiError('BOOK_BENEFIT_CODE_INVALID', 400)
  if (!operationId || operationId.length > 191 || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/.test(operationId)) {
    throw createBookBenefitApiError('BOOK_BENEFIT_OPERATION_ID_INVALID', 400)
  }
  return { code, operationId }
}

export function redeemBookBenefitCode(input, options = {}) {
  let authorization = ''
  let payload = null
  try {
    authorization = getAuthorization(options)
    payload = normalizeRedeemInput(input)
  } catch (error) {
    return Promise.reject(error)
  }

  const baseUrl = getWordApiBaseUrl(options)
  if (!baseUrl || typeof uni === 'undefined' || !uni || typeof uni.request !== 'function') {
    return Promise.reject(createBookBenefitApiError('BOOK_BENEFIT_API_UNAVAILABLE'))
  }

  const timeout = Number(options.timeout || BOOK_BENEFIT_API_TIMEOUT_MS)
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
      finish(reject, createBookBenefitApiError('BOOK_BENEFIT_API_TIMEOUT'))
      if (requestTask && typeof requestTask.abort === 'function') requestTask.abort()
    }, timeout)

    requestTask = uni.request({
      url: `${baseUrl}/api/user/book-benefits/redeem`,
      method: 'POST',
      data: payload,
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
        if (statusCode === 401 || statusCode === 403) clearAuthSession()
        finish(reject, createBookBenefitApiError(data.code || 'BOOK_BENEFIT_API_RESPONSE_ERROR', statusCode))
      },
      fail: (requestError) => {
        const code = requestError && /timeout/i.test(String(requestError.errMsg || ''))
          ? 'BOOK_BENEFIT_API_TIMEOUT'
          : 'BOOK_BENEFIT_API_NETWORK_ERROR'
        finish(reject, createBookBenefitApiError(code))
      }
    })
  })
}
