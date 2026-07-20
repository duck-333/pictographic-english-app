import { getWordApiBaseUrl } from './api-config.js'
import { getAuthSession } from './auth-store.js'

export const USER_RECENT_WORDS_API_TIMEOUT_MS = 7000

function hasUniRequest() {
  return typeof uni !== 'undefined' && uni && typeof uni.request === 'function'
}

function createUserRecentWordsApiError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_RECENT_WORDS_API_ERROR'
  error.statusCode = Number(options.statusCode || 0)
  return error
}

function normalizeWordId(value) {
  return String(value || '').trim()
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
    throw createUserRecentWordsApiError('User session is required.', {
      code: 'USER_AUTH_REQUIRED',
      statusCode: 401
    })
  }
  return `Bearer ${token}`
}

function normalizeRecentWord(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    wordId: normalizeWordId(source.wordId),
    viewedAt: String(source.viewedAt || '').trim()
  }
}

function requestJson(path, options = {}) {
  const url = buildUrl(path, options)
  if (!url || !hasUniRequest()) {
    return Promise.reject(createUserRecentWordsApiError('User recent words API is not available in this runtime.', {
      code: 'USER_RECENT_WORDS_API_UNAVAILABLE'
    }))
  }

  let authorization = ''
  try {
    authorization = getAuthorization(options)
  } catch (error) {
    return Promise.reject(error)
  }

  const timeout = Number(options.timeout || USER_RECENT_WORDS_API_TIMEOUT_MS)
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
      finish(reject, createUserRecentWordsApiError('User recent words API request timed out.', {
        code: 'USER_RECENT_WORDS_API_TIMEOUT'
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
        finish(reject, createUserRecentWordsApiError(data.message || `User recent words API request failed with ${statusCode}`, {
          code: data.code || 'USER_RECENT_WORDS_API_RESPONSE_ERROR',
          statusCode
        }))
      },
      fail: (requestError) => {
        const message = requestError && requestError.errMsg
          ? requestError.errMsg
          : 'User recent words API request failed.'
        finish(reject, createUserRecentWordsApiError(message, {
          code: /timeout/i.test(message) ? 'USER_RECENT_WORDS_API_TIMEOUT' : 'USER_RECENT_WORDS_API_NETWORK_ERROR'
        }))
      }
    })
  })
}

export async function listUserRecentWords(options = {}) {
  const data = await requestJson('/api/user/recent-words', options)
  return (Array.isArray(data.recentWords) ? data.recentWords : [])
    .map(normalizeRecentWord)
    .filter((recentWord) => recentWord.wordId)
}

export async function recordUserRecentWord(wordId, options = {}) {
  const normalizedWordId = normalizeWordId(wordId)
  if (!normalizedWordId) {
    throw createUserRecentWordsApiError('Word id is required.', {
      code: 'WORD_ID_REQUIRED',
      statusCode: 400
    })
  }

  const data = await requestJson('/api/user/recent-words', {
    ...options,
    method: 'POST',
    data: {
      wordId: normalizedWordId
    }
  })
  return normalizeRecentWord(data.recentWord || { wordId: normalizedWordId })
}
