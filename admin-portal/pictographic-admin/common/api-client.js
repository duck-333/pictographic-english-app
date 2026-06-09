const DEFAULT_ADMIN_API_BASE_URL = 'http://127.0.0.1:3001'
const ADMIN_API_BASE_STORAGE_KEY = 'pictographic:adminApiBaseUrl'
export const ADMIN_API_TOKEN_STORAGE_KEY = 'pictographic:adminApiToken'

function normalizeApiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function normalizeAdminApiToken(value) {
  return String(value || '').trim()
}

function getEnvApiBaseUrl() {
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return process.env.VUE_APP_ADMIN_API_BASE_URL || process.env.ADMIN_API_BASE_URL || ''
}

function getEnvAdminApiToken() {
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return process.env.VUE_APP_ADMIN_API_TOKEN || process.env.ADMIN_API_TOKEN || ''
}

function getStoredApiBaseUrl() {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(ADMIN_API_BASE_STORAGE_KEY) || ''
  } catch (error) {
    return ''
  }
}

function getStoredAdminApiToken() {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(ADMIN_API_TOKEN_STORAGE_KEY) || ''
  } catch (error) {
    return ''
  }
}

export function getAdminApiBaseUrl(options = {}) {
  return normalizeApiBaseUrl(options.apiBaseUrl || getEnvApiBaseUrl() || getStoredApiBaseUrl() || DEFAULT_ADMIN_API_BASE_URL)
}

export function getAdminApiToken(options = {}) {
  return normalizeAdminApiToken(options.adminApiToken || getEnvAdminApiToken() || getStoredAdminApiToken())
}

export function saveAdminApiToken(token) {
  const normalized = normalizeAdminApiToken(token)
  if (typeof localStorage === 'undefined') return normalized

  try {
    if (normalized) {
      localStorage.setItem(ADMIN_API_TOKEN_STORAGE_KEY, normalized)
    } else {
      localStorage.removeItem(ADMIN_API_TOKEN_STORAGE_KEY)
    }
  } catch (error) {
    // Storage can fail in locked-down preview runtimes. Keep the token in memory only.
  }

  return normalized
}

function buildAdminHeaders(options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getAdminApiToken(options)
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function createAdminApiError(response, data) {
  const isAuthError = response.status === 401 || response.status === 403
  const detail = Array.isArray(data.errors) && data.errors.length ? `: ${data.errors.join('; ')}` : ''
  const message = isAuthError
    ? '管理员鉴权失败，请检查 Admin API Token'
    : (data.message || 'Admin API save failed') + detail
  const error = new Error(message)
  error.statusCode = response.status
  error.isAuthError = isAuthError
  if (isAuthError) {
    error.code = 'UNAUTHORIZED'
  }
  return error
}

export function checkAdminAuth(token, options = {}) {
  const baseUrl = getAdminApiBaseUrl(options)
  if (!baseUrl || typeof fetch !== 'function') {
    return Promise.reject(new Error('Admin API is not available in this runtime.'))
  }

  return fetch(`${baseUrl}/api/admin/auth/check`, {
    method: 'GET',
    headers: buildAdminHeaders({
      ...options,
      adminApiToken: token
    })
  })
    .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok || data.ok === false) {
        throw createAdminApiError(response, data)
      }
      return data
    })
}

export function saveAdminWordToServer(word, options = {}) {
  const baseUrl = getAdminApiBaseUrl(options)
  if (!baseUrl || typeof fetch !== 'function') {
    return Promise.reject(new Error('Admin API is not available in this runtime.'))
  }

  const payload = { word }
  const url = `${baseUrl}/api/admin/words`

  return fetch(url, {
    method: 'POST',
    headers: buildAdminHeaders(options),
    body: JSON.stringify(payload)
  })
    .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok || data.ok === false) {
        throw createAdminApiError(response, data)
      }
      return data
    })
}
