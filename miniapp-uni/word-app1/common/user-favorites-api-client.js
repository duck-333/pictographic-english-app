import { getWordApiBaseUrl } from './api-config.js'
import { getAuthSession } from './auth-store.js'

export const USER_FAVORITES_API_TIMEOUT_MS = 7000

function hasUniRequest() {
  return typeof uni !== 'undefined' && uni && typeof uni.request === 'function'
}

function createUserFavoritesApiError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_FAVORITES_API_ERROR'
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
    throw createUserFavoritesApiError('User session is required.', {
      code: 'USER_AUTH_REQUIRED',
      statusCode: 401
    })
  }
  return `Bearer ${token}`
}

function normalizeFavorite(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    wordId: normalizeWordId(source.wordId),
    createdAt: String(source.createdAt || '').trim()
  }
}

function requestJson(path, options = {}) {
  const url = buildUrl(path, options)
  if (!url || !hasUniRequest()) {
    return Promise.reject(createUserFavoritesApiError('User favorites API is not available in this runtime.', {
      code: 'USER_FAVORITES_API_UNAVAILABLE'
    }))
  }

  let authorization = ''
  try {
    authorization = getAuthorization(options)
  } catch (error) {
    return Promise.reject(error)
  }

  const timeout = Number(options.timeout || USER_FAVORITES_API_TIMEOUT_MS)
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
      finish(reject, createUserFavoritesApiError('User favorites API request timed out.', {
        code: 'USER_FAVORITES_API_TIMEOUT'
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
        finish(reject, createUserFavoritesApiError(data.message || `User favorites API request failed with ${statusCode}`, {
          code: data.code || 'USER_FAVORITES_API_RESPONSE_ERROR',
          statusCode
        }))
      },
      fail: (requestError) => {
        const message = requestError && requestError.errMsg
          ? requestError.errMsg
          : 'User favorites API request failed.'
        finish(reject, createUserFavoritesApiError(message, {
          code: /timeout/i.test(message) ? 'USER_FAVORITES_API_TIMEOUT' : 'USER_FAVORITES_API_NETWORK_ERROR'
        }))
      }
    })
  })
}

export async function listUserFavorites(options = {}) {
  const data = await requestJson('/api/user/favorites', options)
  return (Array.isArray(data.favorites) ? data.favorites : [])
    .map(normalizeFavorite)
    .filter((favorite) => favorite.wordId)
}

export async function addUserFavorite(wordId, options = {}) {
  const normalizedWordId = normalizeWordId(wordId)
  if (!normalizedWordId) {
    throw createUserFavoritesApiError('Word id is required.', {
      code: 'WORD_ID_REQUIRED',
      statusCode: 400
    })
  }

  const data = await requestJson('/api/user/favorites', {
    ...options,
    method: 'POST',
    data: {
      wordId: normalizedWordId
    }
  })
  return normalizeFavorite(data.favorite || { wordId: normalizedWordId })
}

export async function removeUserFavorite(wordId, options = {}) {
  const normalizedWordId = normalizeWordId(wordId)
  if (!normalizedWordId) {
    throw createUserFavoritesApiError('Word id is required.', {
      code: 'WORD_ID_REQUIRED',
      statusCode: 400
    })
  }

  const data = await requestJson(`/api/user/favorites/${encodeURIComponent(normalizedWordId)}`, {
    ...options,
    method: 'DELETE'
  })
  return {
    wordId: normalizeWordId(data.wordId || normalizedWordId),
    deleted: Boolean(data.deleted)
  }
}
