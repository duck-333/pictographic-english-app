import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'

const JWT_SECRET = 'invitation-api-test-jwt-secret'
const NOW = new Date('2026-09-26T00:00:00.000Z')

function testStore() { return { async getWordCount() { return 0 } } }

async function withServer(options, run) {
  const server = http.createServer(createApiHandler({
    store: testStore(),
    userStore: options.userStore || {},
    identityStore: options.identityStore || {},
    userEntitlementStore: options.userEntitlementStore,
    invitationRegistrationService: options.invitationRegistrationService,
    wechatLoginClient: options.wechatLoginClient || {},
    jwtSecret: JWT_SECRET,
    now: () => NOW
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function auth(userId = '10') {
  return `Bearer ${createUserSessionToken(userId, { jwtSecret: JWT_SECRET, now: () => NOW }).token}`
}

function expiredAuth(userId = '10') {
  return `Bearer ${createUserSessionToken(userId, {
    jwtSecret: JWT_SECRET,
    now: () => new Date('2026-09-25T00:00:00.000Z'),
    userSessionTtlMs: 1000
  }).token}`
}

function wrongSignatureAuth(userId = '10') {
  return `Bearer ${createUserSessionToken(userId, {
    jwtSecret: 'different-invitation-api-test-secret', now: () => NOW
  }).token}`
}

async function request(baseUrl, path, body, authorization = '') {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(body)
  })
  return { response, body: await response.json() }
}

function assertNoStore(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('pragma'), 'no-cache')
}

{
  let bonusCalls = 0
  await withServer({
    userStore: { async findOrCreateWechatUser() { return { id: '10', isNew: true } } },
    userEntitlementStore: { async ensureRegistrationBonus() { bonusCalls += 1 } },
    wechatLoginClient: { async code2Session() { return { openid: 'server-openid' } } },
    invitationRegistrationService: {}
  }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-login', { code: 'login-code' })
    assert.equal(result.response.status, 200)
    assertNoStore(result.response)
  })
  assert.equal(bonusCalls, 0, 'plain WeChat login must not grant REGISTER_BONUS')
}

{
  const calls = []
  const service = {
    async createShareCredential(input) {
      calls.push(input)
      return { credentialId: 'private-id', token: 'ivt1.return-once', expiresAt: new Date('2026-10-03T00:00:00Z') }
    },
    async captureCandidate(input) {
      calls.push(input)
      return { invitationId: 'private-invitation-id', candidateReceipt: 'icr1.return-once', candidateCapturedAt: NOW }
    }
  }
  await withServer({ invitationRegistrationService: service }, async baseUrl => {
    const unauthorized = await request(baseUrl, '/api/user/invitations/share-credentials', {})
    assert.equal(unauthorized.response.status, 401)
    assertNoStore(unauthorized.response)

    const share = await request(baseUrl, '/api/user/invitations/share-credentials', {}, auth('10'))
    assert.equal(share.response.status, 200)
    assertNoStore(share.response)
    assert.deepEqual(share.body, { ok: true, token: 'ivt1.return-once', expiresAt: '2026-10-03T00:00:00.000Z' })

    const candidate = await request(baseUrl, '/api/user/invitations/candidates', { token: 'ivt1.return-once' }, auth('20'))
    assert.equal(candidate.response.status, 200)
    assertNoStore(candidate.response)
    assert.deepEqual(candidate.body, { ok: true, candidateReceipt: 'icr1.return-once', candidateCapturedAt: NOW.toISOString() })
    assert.deepEqual(calls, [
      { authenticatedUserId: '10' },
      { authenticatedUserId: '20', token: 'ivt1.return-once' }
    ])

    const forbidden = await request(baseUrl, '/api/user/invitations/candidates', {
      token: 'ivt1.return-once', openid: 'client-forbidden'
    }, auth('20'))
    assert.equal(forbidden.response.status, 400)
    assert(!JSON.stringify(forbidden.body).includes('client-forbidden'))
  })
}

{
  const completeCalls = []
  const service = {
    async prepareWechatPhoneIdentity(identity) { return Object.freeze(identity) },
    async completePhoneRegistration(input) {
      completeCalls.push(input)
      return {
        identity: { id: '99', isNew: true, hasWechatBinding: true, hasPhoneBinding: true, phoneMasked: '138****8000' },
        registrationBonus: { granted: completeCalls.length === 1 },
        invitation: { invitationId: 'private', rewardStatus: 'REWARD_PENDING', rewardSlot: 1 }
      }
    }
  }
  const wechatLoginClient = {
    async code2Session() { return { openid: 'server-openid', unionid: 'server-unionid' } },
    async phoneCode2Number() { return { purePhoneNumber: '13800138000', countryCode: '86' } }
  }
  await withServer({ invitationRegistrationService: service, wechatLoginClient }, async baseUrl => {
    const ordinary = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', requestId: 'request-1'
    })
    assert.equal(ordinary.response.status, 200)
    assertNoStore(ordinary.response)
    assert.equal(completeCalls[0].candidateReceipt, '')
    assert(!JSON.stringify(ordinary.body).includes('REWARD_PENDING'))
    assert(!JSON.stringify(ordinary.body).includes('private'))

    const withoutAuth = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: 'icr1.receipt'
    })
    assert.equal(withoutAuth.response.status, 200)
    assertNoStore(withoutAuth.response)
    assert.equal(completeCalls.length, 2)
    assert.equal(completeCalls[1].candidateReceipt, '')
    assert.equal(completeCalls[1].authenticatedUserId, '')

    for (const authorization of [expiredAuth('30'), wrongSignatureAuth('30'), auth('not-a-user-id')]) {
      const degraded = await request(baseUrl, '/api/auth/wechat-phone-login', {
        loginCode: 'login', phoneCode: 'phone', candidateReceipt: 'icr1.receipt'
      }, authorization)
      assert.equal(degraded.response.status, 200)
      assertNoStore(degraded.response)
      const call = completeCalls.at(-1)
      assert.equal(call.candidateReceipt, '')
      assert.equal(call.authenticatedUserId, '')
    }

    const invited = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: 'icr1.receipt'
    }, auth('30'))
    assert.equal(invited.response.status, 200)
    assertNoStore(invited.response)
    assert.equal(completeCalls.at(-1).authenticatedUserId, '30')
    assert.equal(completeCalls.at(-1).openid, 'server-openid')
    assert.equal(completeCalls.at(-1).candidateReceipt, 'icr1.receipt')

    for (const forbiddenField of ['userId', 'inviterId', 'openid', 'receiptDigest', 'rewardSlot']) {
      const before = completeCalls.length
      const forbidden = await request(baseUrl, '/api/auth/wechat-phone-login', {
        loginCode: 'login', phoneCode: 'phone', candidateReceipt: 'icr1.receipt',
        [forbiddenField]: 'client-controlled'
      }, auth('30'))
      assert.equal(forbidden.response.status, 400)
      assertNoStore(forbidden.response)
      assert.equal(completeCalls.length, before)
      assert.equal(JSON.stringify(forbidden.body).includes('client-controlled'), false)
    }
  })
}

{
  await withServer({
    invitationRegistrationService: {
      async createShareCredential() {
        const error = new Error('ER_DUP_ENTRY table secret digest')
        error.code = 'ER_DUP_ENTRY'
        throw error
      }
    }
  }, async baseUrl => {
    const result = await request(baseUrl, '/api/user/invitations/share-credentials', {}, auth())
    assert.equal(result.response.status, 503)
    assert.deepEqual(result.body, {
      ok: false,
      code: 'INVITATION_SERVICE_UNAVAILABLE',
      message: 'Invitation service is unavailable.'
    })
    assert(!JSON.stringify(result.body).includes('ER_DUP_ENTRY'))
    assert(!JSON.stringify(result.body).includes('table'))
  })
}

console.log('invitation registration API tests passed')
