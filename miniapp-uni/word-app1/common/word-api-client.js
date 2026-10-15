import { getWordApiBaseUrl } from './api-config.js'
import { getAuthSession, invalidateAuthSession, captureAuthSession, isAuthSessionCurrent } from './auth-store.js'
import { toPublicWord } from './public-word.js'
import { toHomepageFeaturedWord } from './homepage-featured-word.js'

export const WORD_API_TIMEOUT_MS = 7000

function hasUniRequest() {
  return typeof uni !== 'undefined' && uni && typeof uni.request === 'function'
}

function buildUrl(path, options = {}) {
  const baseUrl = getWordApiBaseUrl(options)
  if (!baseUrl) return ''
  return `${baseUrl}${path}`
}

function createWordApiError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'WORD_API_ERROR'
  error.statusCode = Number(options.statusCode || 0)
  error.retryAfter = Number(options.retryAfter || 0)
  return error
}

function normalizeClientRequestId(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w:.-]/g, '')
    .slice(0, 80)
}

function getOptionalAuthorization(options = {}) {
  const session = Object.prototype.hasOwnProperty.call(options, 'session')
    ? options.session
    : getAuthSession()
  const token = session && session.token ? String(session.token).trim() : ''
  return token ? `Bearer ${token}` : ''
}

function buildRequestHeaders(options = {}) {
  const headers = {
    'Content-Type': 'application/json'
  }
  const extraHeaders = options.header && typeof options.header === 'object' && !Array.isArray(options.header)
    ? options.header
    : {}
  Object.keys(extraHeaders).forEach((key) => {
    headers[key] = extraHeaders[key]
  })

  if (options.authorization) {
    headers.Authorization = options.authorization
  }

  const clientRequestId = normalizeClientRequestId(options.clientRequestId)
  if (clientRequestId) {
    headers['X-Client-Request-Id'] = clientRequestId
  }

  return headers
}

function requestJson(path, options = {}) {
  const url = buildUrl(path, options)
  if (!url || !hasUniRequest()) {
    return Promise.reject(createWordApiError('Word API is not available in this runtime.', {
      code: 'WORD_API_UNAVAILABLE'
    }))
  }

  const timeout = Number(options.timeout || WORD_API_TIMEOUT_MS)
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
      finish(reject, createWordApiError('Word API request timed out.', {
        code: 'WORD_API_TIMEOUT'
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
      header: buildRequestHeaders(options),
      success: (response) => {
        if (settled) return
        const statusCode = Number(response.statusCode || 0)
        const data = response.data && typeof response.data === 'object' ? response.data : {}
        if (statusCode >= 200 && statusCode < 300 && data.ok !== false) {
          finish(resolve, data)
          return
        }
        finish(reject, createWordApiError(data.message || `Word API request failed with ${statusCode}`, {
          code: data.code || (statusCode === 404 ? 'WORD_NOT_FOUND' : 'WORD_API_RESPONSE_ERROR'),
          statusCode,
          retryAfter: response.header && (response.header['Retry-After'] || response.header['retry-after'])
        }))
      },
      fail: (requestError) => {
        const message = requestError && requestError.errMsg
          ? requestError.errMsg
          : 'Word API request failed.'
        finish(reject, createWordApiError(message, {
          code: /timeout/i.test(message) ? 'WORD_API_TIMEOUT' : 'WORD_API_NETWORK_ERROR'
        }))
      }
    })
  })
}

export function fetchServerWords(query, options = {}) {
  const keyword = String(query || '').trim()
  const suffix = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
  return requestJson(`/api/words${suffix}`, options).then((data) => {
    return Array.isArray(data.words) ? data.words.map(toPublicWord) : []
  })
}

export function fetchServerHomepageFeaturedWord(options = {}) {
  const snapshot = captureAuthSession()
  return requestJson('/api/homepage/featured-word', options).then((data) => {
    if (!isAuthSessionCurrent(snapshot)) {
      throw createWordApiError('Login session changed.', { code: 'AUTH_SESSION_CHANGED' })
    }
    return {
      word: data.word ? toHomepageFeaturedWord(data.word) : null,
      source: String(data.source || 'empty')
    }
  })
}

export function fetchServerWordById(id, options = {}) {
  const wordId = String(id || '').trim()
  if (!wordId) return Promise.resolve(null)
  const snapshot = captureAuthSession()
  const authorization = options.accessContent ? getOptionalAuthorization(options) : ''
  return requestJson(`/api/words/${encodeURIComponent(wordId)}`, {
    ...options,
    authorization
  })
    .then((data) => {
      if (options.accessContent && !isAuthSessionCurrent(snapshot)) {
        throw createWordApiError('Login session changed.', { code: 'AUTH_SESSION_CHANGED' })
      }
      const word = data.word || null
      if (word && !options.accessContent) return toPublicWord(word)
      if (word && data.access) {
        return {
          ...word,
          access: data.access
        }
      }
      return word
    })
    .catch((error) => {
      if (options.accessContent && !isAuthSessionCurrent(snapshot)) {
        throw createWordApiError('Login session changed.', { code: 'AUTH_SESSION_CHANGED' })
      }
      if (options.accessContent && authorization && (error.statusCode === 401 || error.statusCode === 403)) {
        invalidateAuthSession(snapshot, authorization.slice(7))
      }
      if (error && error.code === 'WORD_NOT_FOUND') return null
      throw error
    })
}
