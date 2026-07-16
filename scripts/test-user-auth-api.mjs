import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import {
  createAdminSessionToken,
  createUserSessionToken,
  requireUserAuth,
  verifyUserSessionToken
} from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'

const JWT_SECRET = 'test-user-session-secret'
const NOW = new Date('2026-07-10T00:00:00.000Z')

function createError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code
  error.statusCode = options.statusCode
  return error
}

function createTestStore() {
  return {
    async getWordCount() {
      return 0
    }
  }
}

async function startTestServer(options = {}) {
  const server = http.createServer(createApiHandler({
    store: createTestStore(),
    userStore: options.userStore,
    identityStore: options.identityStore,
    wechatLoginClient: options.wechatLoginClient,
    jwtSecret: JWT_SECRET,
    adminUsername: 'admin',
    adminPassword: 'admin-password',
    now: () => NOW
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  }
}

async function withServer(options, run) {
  const { server, baseUrl } = await startTestServer(options)
  try {
    await run(baseUrl)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function readJson(response) {
  const body = await response.json()
  return {
    status: response.status,
    body
  }
}

function assertSafeMeResponse(body) {
  const serialized = JSON.stringify(body)
  assert(!serialized.includes('openid-secret'), 'response must not include openid')
  assert(!serialized.includes('unionid-secret'), 'response must not include unionid')
  assert(!serialized.includes('session-key-secret'), 'response must not include session_key')
  assert(!serialized.includes('phone-hash-secret'), 'response must not include phone hash')
  assert(!serialized.includes('13800138000'), 'response must not include phone plaintext')
  assert(!serialized.includes('+8613800138000'), 'response must not include e164 phone plaintext')
}

function testVerifyUserSessionTokenAcceptsUserToken() {
  const session = createUserSessionToken('42', {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  const result = verifyUserSessionToken(session.token, {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  assert.deepEqual(result, {
    ok: true,
    userId: '42',
    expiresAt: '2026-08-09T00:00:00.000Z'
  })
}

function testVerifyUserSessionTokenRejectsAdminToken() {
  const session = createAdminSessionToken('admin', {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  const result = verifyUserSessionToken(session.token, {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 403)
}

function testVerifyUserSessionTokenRejectsExpiredToken() {
  const session = createUserSessionToken('42', {
    jwtSecret: JWT_SECRET,
    userSessionTtlMs: 1000,
    now: () => NOW
  })

  const result = verifyUserSessionToken(session.token, {
    jwtSecret: JWT_SECRET,
    now: () => new Date('2026-07-10T00:00:02.000Z')
  })

  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 401)
}

function testVerifyUserSessionTokenRejectsBadSignature() {
  const session = createUserSessionToken('42', {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })
  const badToken = `${session.token.slice(0, -1)}x`

  const result = verifyUserSessionToken(badToken, {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  assert.equal(result.ok, false)
  assert.equal(result.statusCode, 403)
}

function testRequireUserAuth() {
  const session = createUserSessionToken('42', {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  assert.deepEqual(requireUserAuth({
    headers: {
      authorization: `Bearer ${session.token}`
    }
  }, {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  }), {
    ok: true,
    userId: '42',
    expiresAt: '2026-08-09T00:00:00.000Z'
  })

  const missing = requireUserAuth({
    headers: {}
  }, {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.statusCode, 401)
}

async function testWechatLoginTokenCanCallMe() {
  let profileLookupUserId = ''

  await withServer({
    wechatLoginClient: {
      async code2Session(code) {
        assert.equal(code, 'wechat-login-code')
        return {
          openid: 'openid-secret',
          unionid: 'unionid-secret'
        }
      },
      async phoneCode2Number() {
        throw new Error('phone code exchange should not be called')
      }
    },
    userStore: {
      async findOrCreateWechatUser(identity) {
        assert.equal(identity.openid, 'openid-secret')
        assert.equal(identity.unionid, 'unionid-secret')
        return {
          id: '42',
          isNew: false
        }
      },
      async findUserProfileById(userId) {
        profileLookupUserId = userId
        return {
          id: userId,
          hasWechatBinding: true,
          hasPhoneBinding: false,
          phoneMasked: ''
        }
      }
    }
  }, async (baseUrl) => {
    const login = await readJson(await fetch(`${baseUrl}/api/auth/wechat-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'wechat-login-code'
      })
    }))

    assert.equal(login.status, 200)
    assert.equal(login.body.ok, true)
    assert.equal(login.body.tokenType, 'Bearer')

    const me = await readJson(await fetch(`${baseUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${login.body.token}`
      }
    }))

    assert.equal(me.status, 200)
    assert.deepEqual(me.body, {
      ok: true,
      user: {
        id: '42',
        hasWechatBinding: true,
        hasPhoneBinding: false,
        phoneMasked: ''
      },
      session: {
        tokenType: 'Bearer',
        expiresAt: '2026-08-09T00:00:00.000Z'
      }
    })
    assertSafeMeResponse(me.body)
  })

  assert.equal(profileLookupUserId, '42')
}

async function testWechatPhoneLoginTokenCanCallMe() {
  let profileLookupUserId = ''

  await withServer({
    wechatLoginClient: {
      async code2Session(code) {
        assert.equal(code, 'phone-login-code')
        return {
          openid: 'openid-secret',
          unionid: 'unionid-secret'
        }
      },
      async phoneCode2Number(code) {
        assert.equal(code, 'phone-code')
        return {
          phoneNumber: '+8613800138000',
          purePhoneNumber: '13800138000',
          countryCode: '86'
        }
      }
    },
    identityStore: {
      async resolveWechatPhoneIdentity(identity) {
        assert.equal(identity.openid, 'openid-secret')
        return {
          id: '1001',
          isNew: true,
          phoneMasked: '138****8000'
        }
      }
    },
    userStore: {
      async findUserProfileById(userId) {
        profileLookupUserId = userId
        return {
          id: userId,
          hasWechatBinding: true,
          hasPhoneBinding: true,
          phoneMasked: '138****8000'
        }
      }
    }
  }, async (baseUrl) => {
    const login = await readJson(await fetch(`${baseUrl}/api/auth/wechat-phone-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        loginCode: 'phone-login-code',
        phoneCode: 'phone-code'
      })
    }))

    assert.equal(login.status, 200)
    assert.equal(login.body.ok, true)
    assert.equal(login.body.tokenType, 'Bearer')

    const me = await readJson(await fetch(`${baseUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${login.body.token}`
      }
    }))

    assert.equal(me.status, 200)
    assert.deepEqual(me.body, {
      ok: true,
      user: {
        id: '1001',
        hasWechatBinding: true,
        hasPhoneBinding: true,
        phoneMasked: '138****8000'
      },
      session: {
        tokenType: 'Bearer',
        expiresAt: '2026-08-09T00:00:00.000Z'
      }
    })
    assertSafeMeResponse(me.body)
  })

  assert.equal(profileLookupUserId, '1001')
}

async function testGetMeRejectsMissingToken() {
  await withServer({
    userStore: {
      async findUserProfileById() {
        throw new Error('user store should not be called')
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/me`))
    assert.equal(result.status, 401)
    assert.deepEqual(result.body, {
      ok: false,
      message: 'Unauthorized'
    })
  })
}

async function testGetMeRejectsAdminToken() {
  const adminSession = createAdminSessionToken('admin', {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  await withServer({
    userStore: {
      async findUserProfileById() {
        throw new Error('user store should not be called')
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${adminSession.token}`
      }
    }))
    assert.equal(result.status, 403)
    assert.deepEqual(result.body, {
      ok: false,
      message: 'Unauthorized'
    })
  })
}

async function testGetMeSanitizesDatabaseError() {
  const userSession = createUserSessionToken('42', {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  })

  await withServer({
    userStore: {
      async findUserProfileById() {
        throw createError('Table users does not exist.', {
          code: 'ER_NO_SUCH_TABLE'
        })
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${userSession.token}`
      }
    }))
    assert.equal(result.status, 503)
    assert.deepEqual(result.body, {
      ok: false,
      code: 'USER_DB_ERROR',
      message: 'User database is unavailable.'
    })
    assert(!JSON.stringify(result.body).includes('ER_NO_SUCH_TABLE'), 'response must not include raw MySQL error code')
  })
}

testVerifyUserSessionTokenAcceptsUserToken()
testVerifyUserSessionTokenRejectsAdminToken()
testVerifyUserSessionTokenRejectsExpiredToken()
testVerifyUserSessionTokenRejectsBadSignature()
testRequireUserAuth()
await testWechatLoginTokenCanCallMe()
await testWechatPhoneLoginTokenCanCallMe()
await testGetMeRejectsMissingToken()
await testGetMeRejectsAdminToken()
await testGetMeSanitizesDatabaseError()

console.log('user auth API tests passed')
