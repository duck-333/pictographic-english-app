import assert from 'node:assert/strict'

import {
  createIdentityStore,
  hashPhone,
  maskPhone,
  normalizePhone,
  resolveIdentityConflict
} from '../server/identity-store.mjs'

function testNormalizePhone() {
  const normalized = normalizePhone({
    phoneNumber: '+86 100 0000 0000',
    countryCode: '86'
  })

  assert.deepEqual(normalized, {
    countryCode: '86',
    nationalNumber: '10000000000',
    e164: '+8610000000000'
  })
}

function testHashPhone() {
  const normalized = normalizePhone('+86 100 0000 0000')
  const first = hashPhone(normalized, {
    secret: 'test-phone-hash-secret'
  })
  const second = hashPhone(normalized, {
    secret: 'test-phone-hash-secret'
  })
  const differentSecret = hashPhone(normalized, {
    secret: 'other-test-phone-hash-secret'
  })

  assert.equal(first.hashVersion, 'v1')
  assert.equal(first.phoneHash, second.phoneHash)
  assert.match(first.phoneHash, /^[a-f0-9]{64}$/)
  assert.notEqual(first.phoneHash, differentSecret.phoneHash)
}

function testMaskPhone() {
  assert.equal(maskPhone('+86 100 0000 0000'), '100****0000')
}

function testResolveIdentityConflict() {
  assert.deepEqual(resolveIdentityConflict({}), {
    action: 'create_user',
    conflict: false,
    userId: null
  })

  assert.deepEqual(
    resolveIdentityConflict({
      wechatBinding: {
        userId: 'wechat-user'
      }
    }),
    {
      action: 'bind_phone_to_wechat_user',
      conflict: false,
      userId: 'wechat-user'
    }
  )

  assert.deepEqual(
    resolveIdentityConflict({
      phoneBinding: {
        userId: 'phone-user'
      }
    }),
    {
      action: 'bind_wechat_to_phone_user',
      conflict: false,
      userId: 'phone-user'
    }
  )

  assert.deepEqual(
    resolveIdentityConflict({
      wechatBinding: {
        userId: 'same-user'
      },
      phoneBinding: {
        userId: 'same-user'
      }
    }),
    {
      action: 'use_existing_user',
      conflict: false,
      userId: 'same-user'
    }
  )

  assert.deepEqual(
    resolveIdentityConflict({
      wechatBinding: {
        userId: 'wechat-user'
      },
      phoneBinding: {
        userId: 'phone-user'
      }
    }),
    {
      action: 'identity_conflict',
      conflict: true,
      code: 'IDENTITY_CONFLICT',
      statusCode: 409
    }
  )
}

async function testPaymentOpenidReverseLookup() {
  let releases = 0
  const store = createIdentityStore({
    pool: {
      async getConnection() {
        return {
          async execute(sql, values) {
            assert.match(sql, /SELECT openid FROM `wechat_user_bindings` WHERE user_id = \? LIMIT 2/)
            assert.deepEqual(values, ['42'])
            return [[{ openid: 'openid-payment-42' }], []]
          },
          release() { releases += 1 }
        }
      }
    }
  })
  assert.equal(await store.findWechatOpenidByUserIdForPayment('42'), 'openid-payment-42')
  assert.equal(releases, 1)
}

testNormalizePhone()
testHashPhone()
testMaskPhone()
testResolveIdentityConflict()
await testPaymentOpenidReverseLookup()

console.log('identity-store tests passed')
