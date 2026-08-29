import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  getVirtualPaymentConfig,
  parseVirtualPaymentEnabled,
  VIRTUAL_PAYMENT_CONFIG_VARIABLES,
  VIRTUAL_PAYMENT_PRODUCT
} from '../server/virtual-payment-config.mjs'

const SECRET_SENTINELS = {
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'offer-secret-sentinel',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'product-secret-sentinel',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'app-key-secret-sentinel'
}

function enabledEnv(overrides = {}) {
  return {
    NODE_ENV: 'development',
    VIRTUAL_PAYMENT_ENABLED: 'true',
    VIRTUAL_PAYMENT_ENV: 'sandbox',
    ...SECRET_SENTINELS,
    ...overrides
  }
}

function assertErrorDoesNotLeak(error) {
  const serialized = JSON.stringify({
    message: error && error.message,
    code: error && error.code,
    variableName: error && error.variableName
  })
  Object.values(SECRET_SENTINELS).forEach((secret) => {
    assert(!serialized.includes(secret), 'configuration error must not include a configured value')
  })
}

assert.equal(parseVirtualPaymentEnabled(undefined), false)
assert.equal(parseVirtualPaymentEnabled(null), false)
assert.equal(parseVirtualPaymentEnabled(false), false)
assert.equal(parseVirtualPaymentEnabled(''), false)
assert.equal(parseVirtualPaymentEnabled('false'), false)
assert.equal(parseVirtualPaymentEnabled('0'), false)
assert.equal(parseVirtualPaymentEnabled(true), true)
assert.equal(parseVirtualPaymentEnabled('true'), true)
assert.equal(parseVirtualPaymentEnabled('1'), true)
assert.throws(
  () => parseVirtualPaymentEnabled('yes'),
  (error) => error && error.code === 'VIRTUAL_PAYMENT_CONFIG_INVALID'
)

for (const env of [{}, { VIRTUAL_PAYMENT_ENABLED: 'false' }, {
  VIRTUAL_PAYMENT_ENABLED: '0',
  VIRTUAL_PAYMENT_ENV: 'production'
}]) {
  assert.deepEqual(getVirtualPaymentConfig({ env }), {
    enabled: false,
    environment: null,
    wechatEnv: null,
    product: VIRTUAL_PAYMENT_PRODUCT
  })
}

for (const variableName of [
  'VIRTUAL_PAYMENT_ENV',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY'
]) {
  const env = enabledEnv()
  delete env[variableName]
  assert.throws(
    () => getVirtualPaymentConfig({ env }),
    (error) => {
      assert.equal(error.code, 'VIRTUAL_PAYMENT_CONFIG_REQUIRED')
      assert.equal(error.variableName, variableName)
      assertErrorDoesNotLeak(error)
      return true
    }
  )
}

for (const environment of ['production', 'prod', 'live', 'test']) {
  assert.throws(
    () => getVirtualPaymentConfig({ env: enabledEnv({ VIRTUAL_PAYMENT_ENV: environment }) }),
    (error) => {
      assert.equal(error.code, 'VIRTUAL_PAYMENT_ENVIRONMENT_UNSUPPORTED')
      assert.equal(error.variableName, 'VIRTUAL_PAYMENT_ENV')
      assertErrorDoesNotLeak(error)
      return true
    }
  )
}

assert.throws(
  () => getVirtualPaymentConfig({ env: enabledEnv({ NODE_ENV: 'production' }) }),
  (error) => {
    assert.equal(error.code, 'VIRTUAL_PAYMENT_SANDBOX_PRODUCTION_FORBIDDEN')
    assertErrorDoesNotLeak(error)
    return true
  }
)

const configured = getVirtualPaymentConfig({ env: enabledEnv() })
assert.equal(configured.enabled, true)
assert.equal(configured.environment, 'sandbox')
assert.equal(configured.wechatEnv, 1)
assert.equal(configured.offerId, SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID)
assert.equal(configured.productId, SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID)
assert.equal(configured.appKey, SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY)
assert.deepEqual(configured.product, {
  internalSku: 'membership_30d',
  mode: 'short_series_goods',
  displayName: '30天学习会员',
  priceFen: 3000,
  quantity: 1,
  durationSeconds: 2592000,
  currency: 'CNY',
  membershipSourceType: 'wechat_order'
})
assert(Object.isFrozen(configured))
assert(Object.isFrozen(VIRTUAL_PAYMENT_PRODUCT))

assert.deepEqual(VIRTUAL_PAYMENT_CONFIG_VARIABLES, {
  enabled: 'VIRTUAL_PAYMENT_ENABLED',
  environment: 'VIRTUAL_PAYMENT_ENV',
  sandboxOfferId: 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID',
  sandboxProductId: 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID',
  sandboxAppKey: 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY'
})

const source = await readFile(new URL('../server/virtual-payment-config.mjs', import.meta.url), 'utf8')
assert(!/PRODUCTION_[A-Z_]*APP_KEY/.test(source), 'stage 1 must not contain a production AppKey read path')
assert(!/VUE_APP_[A-Z_]*APP_KEY/.test(source), 'payment secrets must not use client-exposed VUE_APP variables')

console.log('virtual payment config tests passed')
