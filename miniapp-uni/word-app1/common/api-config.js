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

export function isDevelopmentApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value)
  return /^https?:\/\/\S+$/i.test(normalized)
}

export function getWordApiBaseUrl(options = {}) {
  const nodeEnv = getNodeEnv(options)
  const isDevelopment = nodeEnv === 'development'
  const configured = Object.prototype.hasOwnProperty.call(options, 'apiBaseUrl')
    ? options.apiBaseUrl
    : getEnvApiBaseUrl()

  // 第一版生产包固定使用本地已发布词库，不发起远程词条请求。
  if (!isDevelopment) {
    return ''
  }

  // 开发环境仅在显式配置地址时启用 API，未配置时同样使用本地词库。
  const candidate = normalizeApiBaseUrl(configured)
  return isDevelopmentApiBaseUrl(candidate) ? candidate : ''
}
