import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  getVirtualPaymentConfig,
  isVirtualPaymentProductId,
  parseVirtualPaymentEnabled,
  VIRTUAL_PAYMENT_CONFIG_VARIABLES,
  VIRTUAL_PAYMENT_PRODUCT,
  VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT
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
    VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '42,1001',
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
    sandboxTestProductEnabled: false,
    product: VIRTUAL_PAYMENT_PRODUCT
  })
}

for (const variableName of [
  'VIRTUAL_PAYMENT_ENV',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY',
  'VIRTUAL_PAYMENT_SANDBOX_USER_IDS'
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
assert.equal(configured.standardProductId, SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID)
assert.equal(configured.sandboxTestProductId, null)
assert.equal(configured.sandboxTestProductEnabled, false)
assert.equal(configured.appKey, SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY)
assert.deepEqual(configured.sandboxUserIds, ['42', '1001'])
assert(Object.isFrozen(configured.sandboxUserIds))
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
assert(Object.isFrozen(VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT))

const sandboxTest = getVirtualPaymentConfig({ env: enabledEnv({
  VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'true',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID: 'sandbox-test-product-fixture'
}) })
assert.equal(sandboxTest.productId, 'sandbox-test-product-fixture')
assert.equal(sandboxTest.standardProductId, SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID)
assert.equal(sandboxTest.sandboxTestProductEnabled, true)
assert.equal(sandboxTest.product, VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT)
assert.equal(sandboxTest.product.priceFen, 100)
assert.equal(sandboxTest.product.currency, 'CNY')
assert.equal(sandboxTest.product.durationSeconds, 2592000)
const sandboxTestDisabled = getVirtualPaymentConfig({ env: enabledEnv({
  VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'false',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID: 'sandbox-test-product-fixture'
}) })
assert.equal(sandboxTestDisabled.productId, SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID)
assert.equal(sandboxTestDisabled.product, VIRTUAL_PAYMENT_PRODUCT)
assert.equal(sandboxTestDisabled.sandboxTestProductId, 'sandbox-test-product-fixture')
for (const disabled of [undefined, null, '', 'false']) {
  const config = getVirtualPaymentConfig({ env: enabledEnv({ VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: disabled }) })
  assert.equal(config.sandboxTestProductEnabled, false)
  assert.equal(config.product, VIRTUAL_PAYMENT_PRODUCT)
}
for (const invalid of ['TRUE', 'True', '1', ' true ', 'yes', 'sandbox', true, false, 2, {}]) {
  assert.throws(() => getVirtualPaymentConfig({ env: enabledEnv({ VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: invalid }) }),
    (error) => error.code === 'VIRTUAL_PAYMENT_CONFIG_INVALID' && error.variableName === 'VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED')
}
assert.throws(() => getVirtualPaymentConfig({ env: enabledEnv({ VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'true' }) }),
  (error) => error.code === 'VIRTUAL_PAYMENT_CONFIG_REQUIRED' && error.variableName === 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID')
assert.throws(() => getVirtualPaymentConfig({ env: enabledEnv({
  VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'true',
  WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID: SECRET_SENTINELS.WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID
}) }), (error) => error.code === 'VIRTUAL_PAYMENT_CONFIG_INVALID')

for (const validProductId of ['a', 'A'.repeat(128), 'sandbox.product_1:test-value']) {
  assert.equal(isVirtualPaymentProductId(validProductId), true)
  assert.equal(getVirtualPaymentConfig({ env: enabledEnv({ WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: validProductId }) }).standardProductId, validProductId)
}
for (const invalidProductId of [
  '', 'https://sandbox.example.test/product', 'space is invalid', 'slash/invalid',
  'control\ninvalid', 'x'.repeat(129), 'x'.repeat(192), 1, true, {}, ['valid-looking-id']
]) {
  assert.equal(isVirtualPaymentProductId(invalidProductId), false)
  assert.throws(
    () => getVirtualPaymentConfig({ env: enabledEnv({ WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: invalidProductId }) }),
    (error) => ['VIRTUAL_PAYMENT_CONFIG_INVALID', 'VIRTUAL_PAYMENT_CONFIG_REQUIRED'].includes(error.code) &&
      error.variableName === 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID'
  )
  assert.throws(
    () => getVirtualPaymentConfig({ env: enabledEnv({
      VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'true',
      WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID: invalidProductId
    }) }),
    (error) => ['VIRTUAL_PAYMENT_CONFIG_INVALID', 'VIRTUAL_PAYMENT_CONFIG_REQUIRED'].includes(error.code) &&
      error.variableName === 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID'
  )
}

assert.deepEqual(VIRTUAL_PAYMENT_CONFIG_VARIABLES, {
  enabled: 'VIRTUAL_PAYMENT_ENABLED',
  environment: 'VIRTUAL_PAYMENT_ENV',
  sandboxOfferId: 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID',
  sandboxProductId: 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID',
  sandboxTestProductEnabled: 'VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED',
  sandboxTestProductId: 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID',
  sandboxAppKey: 'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY',
  sandboxUserIds: 'VIRTUAL_PAYMENT_SANDBOX_USER_IDS'
})

for (const invalidUserIds of ['', 'abc', '0', '-1', '1.5', '9007199254740992']) {
  assert.throws(
    () => getVirtualPaymentConfig({ env: enabledEnv({ VIRTUAL_PAYMENT_SANDBOX_USER_IDS: invalidUserIds }) }),
    (error) => error && ['VIRTUAL_PAYMENT_CONFIG_REQUIRED', 'VIRTUAL_PAYMENT_CONFIG_INVALID'].includes(error.code)
  )
}

const source = await readFile(new URL('../server/virtual-payment-config.mjs', import.meta.url), 'utf8')
assert(!/PRODUCTION_[A-Z_]*APP_KEY/.test(source), 'stage 1 must not contain a production AppKey read path')
assert(!/VUE_APP_[A-Z_]*APP_KEY/.test(source), 'payment secrets must not use client-exposed VUE_APP variables')

console.log('virtual payment config tests passed')
