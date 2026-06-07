const DEFAULT_ADMIN_API_BASE_URL = 'http://127.0.0.1:3001'
const ADMIN_API_BASE_STORAGE_KEY = 'pictographic:adminApiBaseUrl'

function normalizeApiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function getEnvApiBaseUrl() {
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return process.env.VUE_APP_ADMIN_API_BASE_URL || process.env.ADMIN_API_BASE_URL || ''
}

function getStoredApiBaseUrl() {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(ADMIN_API_BASE_STORAGE_KEY) || ''
  } catch (error) {
    return ''
  }
}

export function getAdminApiBaseUrl(options = {}) {
  return normalizeApiBaseUrl(options.apiBaseUrl || getEnvApiBaseUrl() || getStoredApiBaseUrl() || DEFAULT_ADMIN_API_BASE_URL)
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then((response) => response.json().then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (!response.ok || data.ok === false) {
        const detail = Array.isArray(data.errors) && data.errors.length ? `: ${data.errors.join('; ')}` : ''
        const errorMsg = (data.message || 'Admin API save failed') + detail
        throw new Error(errorMsg)
      }
      return data
    })
}
