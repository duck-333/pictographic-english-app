const ENABLED_VARIABLE = 'VIRTUAL_PAYMENT_ENABLED'
const ENVIRONMENT_VARIABLE = 'VIRTUAL_PAYMENT_ENV'
const SANDBOX_OFFER_ID_VARIABLE = 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID'
const SANDBOX_PRODUCT_ID_VARIABLE = 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID'
const SANDBOX_TEST_PRODUCT_ENABLED_VARIABLE = 'VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED'
const SANDBOX_TEST_PRODUCT_ID_VARIABLE = 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID'
const SANDBOX_APP_KEY_VARIABLE = 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY'
const SANDBOX_USER_IDS_VARIABLE = 'VIRTUAL_PAYMENT_SANDBOX_USER_IDS'
const MAX_SAFE_USER_ID = BigInt(Number.MAX_SAFE_INTEGER)
const VIRTUAL_PAYMENT_PRODUCT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

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

export const VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT = Object.freeze({
  ...VIRTUAL_PAYMENT_PRODUCT,
  priceFen: 100
})

export function virtualPaymentProductForPrice(priceFen) {
  if (priceFen === VIRTUAL_PAYMENT_PRODUCT.priceFen) return VIRTUAL_PAYMENT_PRODUCT
  if (priceFen === VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT.priceFen) return VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT
  return null
}

export function isVirtualPaymentProductId(value) {
  return typeof value === 'string' && VIRTUAL_PAYMENT_PRODUCT_ID_PATTERN.test(value)
}

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

function parseSandboxTestProductEnabled(value) {
  if (value === undefined || value === null || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw configError(`${SANDBOX_TEST_PRODUCT_ENABLED_VARIABLE} must be exactly true or false.`, {
    variableName: SANDBOX_TEST_PRODUCT_ENABLED_VARIABLE
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

function readProductId(env, variableName, options = {}) {
  const raw = env && env[variableName]
  if (raw === undefined || raw === null || raw === '') {
    if (options.optional) return null
    throw configError(`${variableName} is required when virtual payment is enabled.`, {
      code: 'VIRTUAL_PAYMENT_CONFIG_REQUIRED',
      variableName
    })
  }
  if (!isVirtualPaymentProductId(raw)) {
    throw configError(`${variableName} is invalid.`, { variableName })
  }
  return raw
}

function parseSandboxUserIds(value) {
  const raw = normalizeString(value)
  if (!raw) {
    throw configError(`${SANDBOX_USER_IDS_VARIABLE} is required when virtual payment is enabled.`, {
      code: 'VIRTUAL_PAYMENT_CONFIG_REQUIRED',
      variableName: SANDBOX_USER_IDS_VARIABLE
    })
  }
  const normalized = []
  const seen = new Set()
  for (const valuePart of raw.split(',')) {
    const value = valuePart.trim()
    if (!/^\d+$/.test(value)) {
      throw configError(`${SANDBOX_USER_IDS_VARIABLE} must contain positive safe integer user ids.`, {
        variableName: SANDBOX_USER_IDS_VARIABLE
      })
    }
    const numeric = BigInt(value)
    if (numeric <= 0n || numeric > MAX_SAFE_USER_ID) {
      throw configError(`${SANDBOX_USER_IDS_VARIABLE} must contain positive safe integer user ids.`, {
        variableName: SANDBOX_USER_IDS_VARIABLE
      })
    }
    const userId = numeric.toString()
    if (!seen.has(userId)) {
      seen.add(userId)
      normalized.push(userId)
    }
  }
  return Object.freeze(normalized)
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
      sandboxTestProductEnabled: false,
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
  const productId = readProductId(env, SANDBOX_PRODUCT_ID_VARIABLE)
  const sandboxTestProductEnabled = parseSandboxTestProductEnabled(
    env && env[SANDBOX_TEST_PRODUCT_ENABLED_VARIABLE]
  )
  const sandboxTestProductId = readProductId(env, SANDBOX_TEST_PRODUCT_ID_VARIABLE, { optional: true })
  if (sandboxTestProductEnabled && !sandboxTestProductId) {
    throw configError(`${SANDBOX_TEST_PRODUCT_ID_VARIABLE} is required when the sandbox test product is enabled.`, {
      code: 'VIRTUAL_PAYMENT_CONFIG_REQUIRED',
      variableName: SANDBOX_TEST_PRODUCT_ID_VARIABLE
    })
  }
  if (sandboxTestProductId && sandboxTestProductId === productId) {
    throw configError('Sandbox products must use distinct product ids.', {
      variableName: SANDBOX_TEST_PRODUCT_ID_VARIABLE
    })
  }
  const appKey = requireVariable(env, SANDBOX_APP_KEY_VARIABLE)
  const sandboxUserIds = parseSandboxUserIds(env && env[SANDBOX_USER_IDS_VARIABLE])

  const activeProduct = sandboxTestProductEnabled
    ? VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT
    : VIRTUAL_PAYMENT_PRODUCT
  const activeProductId = sandboxTestProductEnabled ? sandboxTestProductId : productId
  return Object.freeze({
    enabled: true,
    environment: 'sandbox',
    wechatEnv: 1,
    offerId,
    productId: activeProductId,
    standardProductId: productId,
    sandboxTestProductId,
    sandboxTestProductEnabled,
    appKey,
    sandboxUserIds,
    product: activeProduct
  })
}

export const VIRTUAL_PAYMENT_CONFIG_VARIABLES = Object.freeze({
  enabled: ENABLED_VARIABLE,
  environment: ENVIRONMENT_VARIABLE,
  sandboxOfferId: SANDBOX_OFFER_ID_VARIABLE,
  sandboxProductId: SANDBOX_PRODUCT_ID_VARIABLE,
  sandboxTestProductEnabled: SANDBOX_TEST_PRODUCT_ENABLED_VARIABLE,
  sandboxTestProductId: SANDBOX_TEST_PRODUCT_ID_VARIABLE,
  sandboxAppKey: SANDBOX_APP_KEY_VARIABLE,
  sandboxUserIds: SANDBOX_USER_IDS_VARIABLE
})
