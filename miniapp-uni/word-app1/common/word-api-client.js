import { getWordApiBaseUrl } from './api-config.js'

function hasUniRequest() {
  return typeof uni !== 'undefined' && uni && typeof uni.request === 'function'
}

function buildUrl(path, options = {}) {
  const baseUrl = getWordApiBaseUrl(options)
  if (!baseUrl) return ''
  return `${baseUrl}${path}`
}

function requestJson(path, options = {}) {
  const url = buildUrl(path, options)
  if (!url || !hasUniRequest()) {
    return Promise.reject(new Error('Word API is not available in this runtime.'))
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json'
      },
      success: (response) => {
        const statusCode = Number(response.statusCode || 0)
        const data = response.data || {}
        if (statusCode >= 200 && statusCode < 300 && data.ok !== false) {
          resolve(data)
          return
        }
        reject(new Error(data.message || `Word API request failed with ${statusCode}`))
      },
      fail: (error) => {
        reject(new Error(error && error.errMsg ? error.errMsg : 'Word API request failed.'))
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

export function fetchServerWordById(id, options = {}) {
  const wordId = String(id || '').trim()
  if (!wordId) return Promise.resolve(null)
  return requestJson(`/api/words/${encodeURIComponent(wordId)}`, options).then((data) => data.word || null)
}
