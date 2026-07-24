const ADMIN_API_BASE_STORAGE_KEY = 'pictographic:adminApiBaseUrl'
export const ADMIN_API_TOKEN_STORAGE_KEY = 'pictographic:adminApiToken'

function getDefaultDevelopmentAdminApiBaseUrl() {
  const schemeSeparator = String.fromCharCode(58, 47, 47)
  const hostSeparator = String.fromCharCode(46)
  const portSeparator = String.fromCharCode(58)
  const host = [127, 0, 0, 1].join(hostSeparator)
  const port = String.fromCharCode(51, 48, 48, 49)
  return ['http', schemeSeparator, host, portSeparator, port].join('')
}

function normalizeApiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function normalizeAdminApiToken(value) {
  return String(value || '').trim()
}

function getNodeEnv() {
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return String(process.env.NODE_ENV || '').trim().toLowerCase()
}

function isProductionRuntime() {
  return getNodeEnv() === 'production'
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
  if (isProductionRuntime()) return ''

  return normalizeApiBaseUrl(
    options.apiBaseUrl ||
    getEnvApiBaseUrl() ||
    getStoredApiBaseUrl() ||
    getDefaultDevelopmentAdminApiBaseUrl()
  )
}

function buildAdminApiUrl(path, options = {}) {
  const baseUrl = getAdminApiBaseUrl(options)
  const normalizedPath = `/${String(path || '').trim().replace(/^\/+/, '')}`
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath
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

function createPublicApiError(response, data) {
  const message = data.message || `Public API request failed (${response.status})`
  const error = new Error(message)
  error.statusCode = response.status
  return error
}

function normalizePayloadText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeIllustrationImagePayload(image) {
  const source = image && typeof image === 'object' && !Array.isArray(image) ? image : {}
  const normalized = {
    url: normalizePayloadText(source.url),
    title: normalizePayloadText(source.title),
    alt: normalizePayloadText(source.alt),
    provider: normalizePayloadText(source.provider),
    assetId: normalizePayloadText(source.assetId || source.asset_id),
    uploadStatus: normalizePayloadText(source.uploadStatus || source.upload_status),
    uploadedAt: normalizePayloadText(source.uploadedAt || source.uploaded_at)
  }
  return Object.values(normalized).some((value) => value) ? normalized : {}
}

function buildAdminWordPayload(word) {
  const source = word && typeof word === 'object' && !Array.isArray(word) ? word : {}
  const payload = {
    ...source,
    illustrationImage: normalizeIllustrationImagePayload(
      source.illustrationImage ||
        source.illustration_image ||
        {}
    )
  }
  delete payload.illustration_image
  return payload
}

export function checkAdminAuth(token, options = {}) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Admin API is not available in this runtime.'))
  }

  return fetch(buildAdminApiUrl('/api/admin/auth/check', options), {
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
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Admin API is not available in this runtime.'))
  }

  const payload = { word: buildAdminWordPayload(word) }
  const url = buildAdminApiUrl('/api/admin/words', options)

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

export function getPublicWordFromServer(idOrWord, options = {}) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Public API is not available in this runtime.'))
  }

  const value = String(idOrWord || '').trim()
  if (!value) return Promise.resolve(null)

  return fetch(buildAdminApiUrl(`/api/words/${encodeURIComponent(value)}`, options), {
    method: 'GET'
  })
    .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (response.status === 404) return null
      if (!response.ok || data.ok === false) {
        throw createPublicApiError(response, data)
      }
      return data.word || null
    })
}

export function searchPublicWordsFromServer(query, options = {}) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Public API is not available in this runtime.'))
  }

  const value = String(query || '').trim()
  if (!value) return Promise.resolve([])

  return fetch(buildAdminApiUrl(`/api/words?q=${encodeURIComponent(value)}`, options), {
    method: 'GET'
  })
    .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (response.status === 404) return []
      if (!response.ok || data.ok === false) {
        throw createPublicApiError(response, data)
      }
      return Array.isArray(data.words) ? data.words : []
    })
}

export function getAdminHomepageFeatured(options = {}) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Admin API is not available in this runtime.'))
  }

  return fetch(buildAdminApiUrl('/api/admin/homepage-featured', options), {
    method: 'GET',
    headers: buildAdminHeaders(options)
  })
    .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok || data.ok === false) {
        throw createAdminApiError(response, data)
      }
      return data
    })
}

export function saveAdminHomepageFeatured(config, options = {}) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Admin API is not available in this runtime.'))
  }

  return fetch(buildAdminApiUrl('/api/admin/homepage-featured', options), {
    method: 'POST',
    headers: buildAdminHeaders(options),
    body: JSON.stringify(config || {})
  })
    .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok || data.ok === false) {
        throw createAdminApiError(response, data)
      }
      return data
    })
}

function requestAdminJson(path, options = {}) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('Admin API is not available in this runtime.'))
  }

  const requestOptions = {
    method: options.method || 'GET',
    headers: buildAdminHeaders(options)
  }
  if (Object.prototype.hasOwnProperty.call(options, 'data')) {
    requestOptions.body = JSON.stringify(options.data || {})
  }

  return fetch(buildAdminApiUrl(path, options), requestOptions)
    .then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok || data.ok === false) {
        throw createAdminApiError(response, data)
      }
      return data
    })
}

function buildQueryString(params = {}) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value).trim())}`)
  return pairs.length ? `?${pairs.join('&')}` : ''
}

export function searchAdminEntitlementUsers(query, options = {}) {
  const keyword = String(query || '').trim()
  const suffix = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
  return requestAdminJson(`/api/admin/entitlements/users${suffix}`, options)
    .then((data) => ({
      users: Array.isArray(data.users) ? data.users : [],
      count: Number(data.count || 0)
    }))
}

export function getAdminUserEntitlement(userId, options = {}) {
  const id = String(userId || '').trim()
  if (!id) return Promise.reject(new Error('User id is required.'))
  return requestAdminJson(`/api/admin/entitlements/users/${encodeURIComponent(id)}`, options)
}

export function grantAdminUserQuota(userId, payload = {}, options = {}) {
  const id = String(userId || '').trim()
  if (!id) return Promise.reject(new Error('User id is required.'))
  return requestAdminJson(`/api/admin/entitlements/users/${encodeURIComponent(id)}/grant`, {
    ...options,
    method: 'POST',
    data: payload
  })
}

export function deductAdminUserQuota(userId, payload = {}, options = {}) {
  const id = String(userId || '').trim()
  if (!id) return Promise.reject(new Error('User id is required.'))
  return requestAdminJson(`/api/admin/entitlements/users/${encodeURIComponent(id)}/deduct`, {
    ...options,
    method: 'POST',
    data: payload
  })
}

export function listAdminUserEntitlementTransactions(userId, options = {}) {
  const id = String(userId || '').trim()
  if (!id) return Promise.reject(new Error('User id is required.'))
  const suffix = buildQueryString({
    limit: options.limit,
    offset: options.offset,
    type: options.transactionType || options.type
  })
  return requestAdminJson(`/api/admin/entitlements/users/${encodeURIComponent(id)}/transactions${suffix}`, options)
    .then((data) => ({
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      count: Number(data.count || 0)
    }))
}
