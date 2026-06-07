const DEFAULT_DEVELOPMENT_API_BASE_URL = 'http://127.0.0.1:3001'

function getNodeEnv(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'nodeEnv')) {
    return String(options.nodeEnv || '').toLowerCase()
  }
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return String(process.env.NODE_ENV || '').toLowerCase()
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
  return String(value || '').trim().replace(/\/+$/, '')
}

function parseApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value)
  if (!normalized || typeof URL === 'undefined') return null
  try {
    return new URL(normalized)
  } catch (error) {
    return null
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '')
}

function isLoopbackHostname(hostname) {
  const host = normalizeHostname(hostname)
  if (host === 'localhost' || host === '::1') return true

  const octets = host.split('.')
  if (octets.length !== 4) return false
  if (!octets.every((item) => /^\d{1,3}$/.test(item) && Number(item) >= 0 && Number(item) <= 255)) return false
  return Number(octets[0]) === 127
}

export function isProductionSafeApiBaseUrl(value) {
  const parsed = parseApiBaseUrl(value)
  return Boolean(parsed && parsed.protocol === 'https:' && !isLoopbackHostname(parsed.hostname))
}

export function isDevelopmentApiBaseUrl(value) {
  const parsed = parseApiBaseUrl(value)
  return Boolean(parsed && /^https?:$/i.test(parsed.protocol))
}

export function getWordApiBaseUrl(options = {}) {
  const nodeEnv = getNodeEnv(options)
  const isProduction = nodeEnv === 'production'
  const configured = Object.prototype.hasOwnProperty.call(options, 'apiBaseUrl')
    ? options.apiBaseUrl
    : getEnvApiBaseUrl()
  
  // 非生产环境允许 HBuilderX / 微信开发者工具使用本地 API。
  // 生产环境必须 fail closed；小程序 runtime 不能绕过生产规则。
  const candidate = normalizeApiBaseUrl(configured || (!isProduction ? DEFAULT_DEVELOPMENT_API_BASE_URL : ''))

  if (!candidate) return ''
  
  // 生产环境：严格验证，只允许 HTTPS + 非 localhost
  if (isProduction) {
    return isProductionSafeApiBaseUrl(candidate) ? candidate : ''
  }
  
  // 非生产环境：允许本地开发 API（已通过 normalizeApiBaseUrl 基本处理）
  return candidate
}
