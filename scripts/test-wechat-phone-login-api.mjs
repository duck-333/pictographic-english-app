import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createApiHandler } from '../server/index.mjs'

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
    jwtSecret: 'test-user-session-secret',
    now: () => new Date('2026-07-10T00:00:00.000Z')
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  }
}

async function readJson(response) {
  const body = await response.json()
  return {
    status: response.status,
    body
  }
}

function assertSafeAuthResponse(body) {
  const serialized = JSON.stringify(body)
  assert(!serialized.includes('openid-secret'), 'response must not include openid')
  assert(!serialized.includes('session-key-secret'), 'response must not include session_key')
  assert(!serialized.includes('access-token-secret'), 'response must not include access_token')
  assert(!serialized.includes('13800138000'), 'response must not include phone plaintext')
  assert(!serialized.includes('+8613800138000'), 'response must not include e164 phone plaintext')
}

async function withServer(options, run) {
  const { server, baseUrl } = await startTestServer(options)
  try {
    await run(baseUrl)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function testWechatPhoneLoginSuccess() {
  let code2SessionCalled = false
  let phoneCodeCalled = false
  let identityStoreCalled = false

  await withServer({
    wechatLoginClient: {
      async code2Session(code) {
        code2SessionCalled = true
        assert.equal(code, 'login-code-1')
        return {
          openid: 'openid-secret',
          unionid: 'unionid-secret'
        }
      },
      async phoneCode2Number(code) {
        phoneCodeCalled = true
        assert.equal(code, 'phone-code-1')
        return {
          phoneNumber: '+8613800138000',
          purePhoneNumber: '13800138000',
          countryCode: '86'
        }
      }
    },
    identityStore: {
      async resolveWechatPhoneIdentity(identity) {
        identityStoreCalled = true
        assert.equal(identity.openid, 'openid-secret')
        assert.equal(identity.unionid, 'unionid-secret')
        assert.deepEqual(identity.phone, {
          phoneNumber: '+8613800138000',
          purePhoneNumber: '13800138000',
          countryCode: '86'
        })
        return {
          id: '1001',
          isNew: true,
          hasWechatBinding: true,
          hasPhoneBinding: true,
          phoneMasked: '138****8000'
        }
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/auth/wechat-phone-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        loginCode: 'login-code-1',
        phoneCode: 'phone-code-1',
        requestId: 'request-1'
      })
    }))

    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.tokenType, 'Bearer')
    assert.equal(typeof result.body.token, 'string')
    assert(result.body.token.length > 20, 'phone login should return a signed token')
    assert.equal(result.body.expiresAt, '2026-08-09T00:00:00.000Z')
    assert.deepEqual(result.body.user, {
      id: '1001',
      hasWechatBinding: true,
      hasPhoneBinding: true,
      phoneMasked: '138****8000',
      isNew: true
    })
    assertSafeAuthResponse(result.body)
  })

  assert.equal(code2SessionCalled, true)
  assert.equal(phoneCodeCalled, true)
  assert.equal(identityStoreCalled, true)
}

async function testMissingLoginCode() {
  let phoneCodeCalled = false
  await withServer({
    wechatLoginClient: {
      async code2Session(code) {
        assert.equal(code, undefined)
        throw createError('Login code is required.', {
          code: 'WECHAT_CODE_REQUIRED',
          statusCode: 400
        })
      },
      async phoneCode2Number() {
        phoneCodeCalled = true
      }
    },
    identityStore: {
      async resolveWechatPhoneIdentity() {
        throw new Error('identity store should not be called')
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/auth/wechat-phone-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phoneCode: 'phone-code-1'
      })
    }))

    assert.equal(result.status, 400)
    assert.deepEqual(result.body, {
      ok: false,
      code: 'WECHAT_CODE_REQUIRED',
      message: 'Login code is required.'
    })
    assertSafeAuthResponse(result.body)
  })
  assert.equal(phoneCodeCalled, false)
}

async function testMissingPhoneCode() {
  let identityStoreCalled = false
  await withServer({
    wechatLoginClient: {
      async code2Session(code) {
        assert.equal(code, 'login-code-1')
        return {
          openid: 'openid-secret',
          unionid: ''
        }
      },
      async phoneCode2Number(code) {
        assert.equal(code, undefined)
        throw createError('Phone code is required.', {
          code: 'WECHAT_PHONE_CODE_REQUIRED',
          statusCode: 400
        })
      }
    },
    identityStore: {
      async resolveWechatPhoneIdentity() {
        identityStoreCalled = true
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/auth/wechat-phone-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        loginCode: 'login-code-1'
      })
    }))

    assert.equal(result.status, 400)
    assert.deepEqual(result.body, {
      ok: false,
      code: 'WECHAT_PHONE_CODE_REQUIRED',
      message: 'Phone code is required.'
    })
    assertSafeAuthResponse(result.body)
  })
  assert.equal(identityStoreCalled, false)
}

async function testWechatConfigMissing() {
  await withServer({
    wechatLoginClient: {
      async code2Session() {
        throw createError('Wechat mini program login is not configured.', {
          code: 'WECHAT_CONFIG_MISSING',
          statusCode: 503
        })
      },
      async phoneCode2Number() {
        throw new Error('phone exchange should not be called')
      }
    },
    identityStore: {
      async resolveWechatPhoneIdentity() {
        throw new Error('identity store should not be called')
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/auth/wechat-phone-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        loginCode: 'login-code-1',
        phoneCode: 'phone-code-1'
      })
    }))

    assert.equal(result.status, 503)
    assert.deepEqual(result.body, {
      ok: false,
      code: 'WECHAT_CONFIG_MISSING',
      message: 'Wechat login is not configured.'
    })
    assertSafeAuthResponse(result.body)
  })
}

async function testIdentityConflict() {
  await withServer({
    wechatLoginClient: {
      async code2Session() {
        return {
          openid: 'openid-secret',
          unionid: 'unionid-secret'
        }
      },
      async phoneCode2Number() {
        return {
          phoneNumber: '+8613800138000',
          purePhoneNumber: '13800138000',
          countryCode: '86'
        }
      }
    },
    identityStore: {
      async resolveWechatPhoneIdentity() {
        throw createError('Identity binding conflict.', {
          code: 'IDENTITY_CONFLICT',
          statusCode: 409
        })
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/auth/wechat-phone-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        loginCode: 'login-code-1',
        phoneCode: 'phone-code-1'
      })
    }))

    assert.equal(result.status, 409)
    assert.deepEqual(result.body, {
      ok: false,
      code: 'IDENTITY_CONFLICT',
      message: 'Identity binding conflict.'
    })
    assertSafeAuthResponse(result.body)
  })
}

async function testExistingWechatLoginCompatibility() {
  let identityStoreCalled = false
  await withServer({
    wechatLoginClient: {
      async code2Session(code) {
        assert.equal(code, 'old-login-code')
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
      }
    },
    identityStore: {
      async resolveWechatPhoneIdentity() {
        identityStoreCalled = true
      }
    }
  }, async (baseUrl) => {
    const result = await readJson(await fetch(`${baseUrl}/api/auth/wechat-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'old-login-code'
      })
    }))

    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.tokenType, 'Bearer')
    assert.equal(typeof result.body.token, 'string')
    assert.equal(result.body.user.id, '42')
    assert.equal(result.body.user.hasWechatBinding, true)
    assert.equal(result.body.user.isNew, false)
    assert.equal(Object.prototype.hasOwnProperty.call(result.body.user, 'hasPhoneBinding'), false)
    assertSafeAuthResponse(result.body)
  })
  assert.equal(identityStoreCalled, false)
}

await testWechatPhoneLoginSuccess()
await testMissingLoginCode()
await testMissingPhoneCode()
await testWechatConfigMissing()
await testIdentityConflict()
await testExistingWechatLoginCompatibility()

console.log('wechat phone login API tests passed')
