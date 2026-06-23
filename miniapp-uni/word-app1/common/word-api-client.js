import { getWordApiBaseUrl } from './api-config.js'

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
  return error
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
        finish(reject, createWordApiError(data.message || `Word API request failed with ${statusCode}`, {
          code: statusCode === 404 ? 'WORD_NOT_FOUND' : 'WORD_API_RESPONSE_ERROR',
          statusCode
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
    return Array.isArray(data.words) ? data.words : []
  })
}

export function fetchServerHomepageFeaturedWord(options = {}) {
  return requestJson('/api/homepage/featured-word', options).then((data) => ({
    word: data.word || null,
    source: String(data.source || 'empty')
  }))
}

export function fetchServerWordById(id, options = {}) {
  const wordId = String(id || '').trim()
  if (!wordId) return Promise.resolve(null)
  return requestJson(`/api/words/${encodeURIComponent(wordId)}`, options)
    .then((data) => data.word || null)
    .catch((error) => {
      if (error && error.code === 'WORD_NOT_FOUND') return null
      throw error
    })
}
