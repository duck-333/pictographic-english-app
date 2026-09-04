export const PRODUCTION_WORD_API_BASE_URL = 'https://baxiaota.com'

function getNodeEnv(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'nodeEnv')) {
    return String(options.nodeEnv || '').trim().toLowerCase()
  }
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return String(process.env.NODE_ENV || '').trim().toLowerCase()
}

function getEnvApiBaseUrl() {
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return (
    process.env.VUE_APP_WORD_API_BASE_URL ||
    process.env.UNI_APP_WORD_API_BASE_URL ||
    process.env.WORD_API_BASE_URL ||
    ''
  )
}

function normalizeApiBaseUrl(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\/+$/, '')
}

export function isDevelopmentApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value)
  return /^https?:\/\/[^\s]+$/i.test(normalized)
}

export function getWordApiBaseUrl(options = {}) {
  const nodeEnv = getNodeEnv(options)
  if (nodeEnv !== 'development') {
    return PRODUCTION_WORD_API_BASE_URL
  }

  const configured = Object.prototype.hasOwnProperty.call(options, 'apiBaseUrl')
    ? options.apiBaseUrl
    : getEnvApiBaseUrl()
  const candidate = normalizeApiBaseUrl(configured)
  // An unconfigured development preview must never fall back to production.
  return isDevelopmentApiBaseUrl(candidate) ? candidate : 'https://sandbox.invalid'
}
