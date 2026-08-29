const ENABLED_VARIABLE = 'VIRTUAL_PAYMENT_ENABLED'
const ENVIRONMENT_VARIABLE = 'VIRTUAL_PAYMENT_ENV'
const SANDBOX_OFFER_ID_VARIABLE = 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID'
const SANDBOX_PRODUCT_ID_VARIABLE = 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID'
const SANDBOX_APP_KEY_VARIABLE = 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY'

export const VIRTUAL_PAYMENT_PRODUCT = Object.freeze({
  internalSku: 'membership_30d',
  mode: 'short_series_goods',
  displayName: '30天学习会员',
  priceFen: 3000,
  quantity: 1,
  durationSeconds: 2592000,
  currency: 'CNY',
  membershipSourceType: 'wechat_order'
})

function configError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'VIRTUAL_PAYMENT_CONFIG_INVALID'
  if (options.variableName) error.variableName = options.variableName
  return error
}

function normalizeString(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

export function parseVirtualPaymentEnabled(value) {
  if (value === undefined || value === null || value === false) return false
  if (value === true) return true

  const normalized = normalizeString(value).toLowerCase()
  if (!normalized || normalized === 'false' || normalized === '0') return false
  if (normalized === 'true' || normalized === '1') return true

  throw configError(`${ENABLED_VARIABLE} must be true or false.`, {
    variableName: ENABLED_VARIABLE
  })
}

function requireVariable(env, variableName) {
  const value = normalizeString(env && env[variableName])
  if (!value) {
    throw configError(`${variableName} is required when virtual payment is enabled.`, {
      code: 'VIRTUAL_PAYMENT_CONFIG_REQUIRED',
      variableName
    })
  }
  return value
}

export function getVirtualPaymentConfig(options = {}) {
  const env = options.env || process.env
  const nodeEnv = normalizeString(
    options.nodeEnv === undefined ? env && env.NODE_ENV : options.nodeEnv
  ).toLowerCase()
  const enabled = parseVirtualPaymentEnabled(env && env[ENABLED_VARIABLE])

  if (!enabled) {
    return Object.freeze({
      enabled: false,
      environment: null,
      wechatEnv: null,
      product: VIRTUAL_PAYMENT_PRODUCT
    })
  }

  if (nodeEnv === 'production') {
    throw configError('Virtual payment sandbox cannot be enabled when NODE_ENV=production.', {
      code: 'VIRTUAL_PAYMENT_SANDBOX_PRODUCTION_FORBIDDEN',
      variableName: ENABLED_VARIABLE
    })
  }

  const environment = requireVariable(env, ENVIRONMENT_VARIABLE).toLowerCase()
  if (environment !== 'sandbox') {
    throw configError(`${ENVIRONMENT_VARIABLE} must be sandbox in stage 1.`, {
      code: 'VIRTUAL_PAYMENT_ENVIRONMENT_UNSUPPORTED',
      variableName: ENVIRONMENT_VARIABLE
    })
  }

  const offerId = requireVariable(env, SANDBOX_OFFER_ID_VARIABLE)
  const productId = requireVariable(env, SANDBOX_PRODUCT_ID_VARIABLE)
  const appKey = requireVariable(env, SANDBOX_APP_KEY_VARIABLE)

  return Object.freeze({
    enabled: true,
    environment: 'sandbox',
    wechatEnv: 1,
    offerId,
    productId,
    appKey,
    product: VIRTUAL_PAYMENT_PRODUCT
  })
}

export const VIRTUAL_PAYMENT_CONFIG_VARIABLES = Object.freeze({
  enabled: ENABLED_VARIABLE,
  environment: ENVIRONMENT_VARIABLE,
  sandboxOfferId: SANDBOX_OFFER_ID_VARIABLE,
  sandboxProductId: SANDBOX_PRODUCT_ID_VARIABLE,
  sandboxAppKey: SANDBOX_APP_KEY_VARIABLE
})
