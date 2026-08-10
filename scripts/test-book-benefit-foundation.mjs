import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  createCampaignPhoneIdentity,
  createManualExceptionIssuanceClaimHash,
  createStandardOrderClaimHash,
  normalizeOrderChannel,
  normalizeOrderNumber
} from '../server/book-benefit-foundation.mjs'

const campaignSecret = 'campaign-phone-test-secret-32-bytes-minimum'
const orderSecret = 'book-order-claim-test-secret-32-bytes-minimum'

function expectCode(action, code) {
  assert.throws(action, (error) => error && error.code === code)
}

function testCampaignPhoneIdentity() {
  const first = createCampaignPhoneIdentity('+86 100 0000 0000', {
    secret: campaignSecret,
    env: {},
    userId: '4',
    phoneBindingId: '10',
    campaignId: '20'
  })
  const samePhoneDifferentContext = createCampaignPhoneIdentity('8610000000000', {
    secret: campaignSecret,
    env: {},
    userId: '999',
    phoneBindingId: '888',
    campaignId: '777'
  })
  const differentPhone = createCampaignPhoneIdentity('+86 100 0000 0001', {
    secret: campaignSecret,
    env: {}
  })
  const productionEnvironmentSecret = createCampaignPhoneIdentity('+86 100 0000 0000', {
    env: {
      NODE_ENV: 'production',
      CAMPAIGN_PHONE_IDENTITY_HASH_SECRET: campaignSecret
    }
  })

  assert(Buffer.isBuffer(first.campaignPhoneIdentityHash))
  assert.equal(first.campaignPhoneIdentityHash.length, 32)
  assert.equal(first.hashVersion, 'v1')
  assert.deepEqual(first.campaignPhoneIdentityHash, samePhoneDifferentContext.campaignPhoneIdentityHash)
  assert.deepEqual(first.campaignPhoneIdentityHash, productionEnvironmentSecret.campaignPhoneIdentityHash)
  assert.notDeepEqual(first.campaignPhoneIdentityHash, differentPhone.campaignPhoneIdentityHash)

  const expected = crypto
    .createHmac('sha256', campaignSecret)
    .update('campaign-phone-identity:v1|+8610000000000')
    .digest()
  assert.deepEqual(first.campaignPhoneIdentityHash, expected)

  expectCode(
    () => createCampaignPhoneIdentity('not-a-phone', { secret: campaignSecret, env: {} }),
    'PHONE_INVALID'
  )
  expectCode(
    () => createCampaignPhoneIdentity('+86 100 0000 0000', { env: { NODE_ENV: 'production' } }),
    'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_MISSING'
  )
  expectCode(
    () => createCampaignPhoneIdentity('+86 100 0000 0000', {
      env: {
        NODE_ENV: 'production',
        CAMPAIGN_PHONE_IDENTITY_HASH_SECRET: 'too-short'
      }
    }),
    'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_TOO_SHORT'
  )
  for (const secretName of [
    'PHONE_HASH_SECRET',
    'JWT_SECRET',
    'ADMIN_API_TOKEN',
    'REDEMPTION_CODE_HASH_SECRET',
    'BOOK_ORDER_CLAIM_HASH_SECRET'
  ]) {
    expectCode(
      () => createCampaignPhoneIdentity('+86 100 0000 0000', {
        secret: campaignSecret,
        env: { [secretName]: campaignSecret }
      }),
      'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_REUSED'
    )
  }
}

function testOrderClaims() {
  assert.equal(normalizeOrderChannel(' Taobao '), 'taobao')
  assert.equal(normalizeOrderNumber(' ab １２３ '), 'AB123')

  const first = createStandardOrderClaimHash({
    channel: ' Taobao ',
    orderNumber: ' ab １２３ '
  }, {
    secret: orderSecret,
    env: {}
  })
  const sameNormalizedOrder = createStandardOrderClaimHash({
    channel: 'taobao',
    orderNumber: 'AB123'
  }, {
    secret: orderSecret,
    env: {}
  })
  const productionEnvironmentSecret = createStandardOrderClaimHash({
    channel: 'taobao',
    orderNumber: 'AB123'
  }, {
    env: {
      NODE_ENV: 'production',
      BOOK_ORDER_CLAIM_HASH_SECRET: orderSecret
    }
  })

  assert(Buffer.isBuffer(first.orderClaimHash))
  assert.equal(first.orderClaimHash.length, 32)
  assert.equal(first.hashVersion, 'v1')
  assert.equal(first.normalizedChannel, 'taobao')
  assert.deepEqual(first.orderClaimHash, sameNormalizedOrder.orderClaimHash)
  assert.deepEqual(first.orderClaimHash, productionEnvironmentSecret.orderClaimHash)
  assert.deepEqual(
    first.orderClaimHash,
    crypto.createHmac('sha256', orderSecret).update('taobao|AB123').digest()
  )

  const manualFirst = createManualExceptionIssuanceClaimHash({
    campaignId: '7',
    issuanceId: '11'
  }, {
    secret: orderSecret,
    env: {}
  })
  const manualSame = createManualExceptionIssuanceClaimHash({
    campaignId: '007',
    issuanceId: 11
  }, {
    secret: orderSecret,
    env: {}
  })
  const manualDifferentIssuance = createManualExceptionIssuanceClaimHash({
    campaignId: '7',
    issuanceId: '12'
  }, {
    secret: orderSecret,
    env: {}
  })

  assert.equal(manualFirst.orderClaimHash.length, 32)
  assert.deepEqual(manualFirst.orderClaimHash, manualSame.orderClaimHash)
  assert.notDeepEqual(manualFirst.orderClaimHash, manualDifferentIssuance.orderClaimHash)
  assert.deepEqual(
    manualFirst.orderClaimHash,
    crypto.createHmac('sha256', orderSecret).update('manual-exception:7:11').digest()
  )

  expectCode(
    () => createStandardOrderClaimHash(
      { channel: 'taobao', orderNumber: 'AB123' },
      { env: { NODE_ENV: 'production' } }
    ),
    'BOOK_ORDER_CLAIM_HASH_SECRET_MISSING'
  )
  expectCode(
    () => createStandardOrderClaimHash({ channel: 'taobao', orderNumber: 'AB123' }, {
      env: {
        NODE_ENV: 'production',
        BOOK_ORDER_CLAIM_HASH_SECRET: 'too-short'
      }
    }),
    'BOOK_ORDER_CLAIM_HASH_SECRET_TOO_SHORT'
  )
  for (const secretName of [
    'PHONE_HASH_SECRET',
    'JWT_SECRET',
    'ADMIN_API_TOKEN',
    'REDEMPTION_CODE_HASH_SECRET',
    'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET'
  ]) {
    expectCode(
      () => createStandardOrderClaimHash({ channel: 'taobao', orderNumber: 'AB123' }, {
        secret: orderSecret,
        env: { [secretName]: orderSecret }
      }),
      'BOOK_ORDER_CLAIM_HASH_SECRET_REUSED'
    )
  }

  expectCode(() => normalizeOrderChannel('taobao|other'), 'BOOK_ORDER_CHANNEL_INVALID')
  expectCode(() => normalizeOrderNumber('AB|123'), 'BOOK_ORDER_NUMBER_INVALID')
  expectCode(
    () => createManualExceptionIssuanceClaimHash({ campaignId: '0', issuanceId: '11' }, {
      secret: orderSecret,
      env: {}
    }),
    'BOOK_BENEFIT_ID_INVALID'
  )
}

testCampaignPhoneIdentity()
testOrderClaims()

console.log('book-benefit foundation unit tests passed')
