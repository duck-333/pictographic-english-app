import assert from 'node:assert/strict'

function createUniMock(options = {}) {
  const storage = new Map()
  const loginCalls = []
  const requestCalls = []

  return {
    storage,
    loginCalls,
    requestCalls,
    login(loginOptions = {}) {
      loginCalls.push(loginOptions)
      if (options.loginFail) {
        loginOptions.fail && loginOptions.fail({
          errMsg: options.loginFail
        })
        return
      }
      loginOptions.success && loginOptions.success({
        code: options.loginCode || 'login-code-1'
      })
    },
    request(requestOptions = {}) {
      requestCalls.push(requestOptions)
      if (options.requestFail) {
        requestOptions.fail && requestOptions.fail({
          errMsg: options.requestFail
        })
        return {
          abort() {}
        }
      }
      requestOptions.success && requestOptions.success({
        statusCode: options.statusCode || 200,
        data: options.responseData || {}
      })
      return {
        abort() {}
      }
    },
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : null
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    removeStorageSync(key) {
      storage.delete(key)
    }
  }
}

function installUniMock(options = {}) {
  const uniMock = createUniMock(options)
  globalThis.uni = uniMock
  return uniMock
}

installUniMock()

const {
  AUTH_SESSION_KEY,
  clearAuthSession,
  getAuthSession,
  saveAuthSession
} = await import('../miniapp-uni/word-app1/common/auth-store.js')
const {
  loginWithWechatPhone
} = await import('../miniapp-uni/word-app1/common/auth-api-client.js')

function assertNoSensitiveFields(value) {
  const serialized = JSON.stringify(value)
  assert(!serialized.includes('openid-secret'), 'stored session must not include openid')
  assert(!serialized.includes('session-key-secret'), 'stored session must not include session_key')
  assert(!serialized.includes('access-token-secret'), 'stored session must not include access_token')
  assert(!serialized.includes('13800138000'), 'stored session must not include phone plaintext')
  assert(!serialized.includes('+8613800138000'), 'stored session must not include e164 phone plaintext')
}

async function testLoginWithWechatPhoneSuccess() {
  const uniMock = installUniMock({
    loginCode: 'login-code-1',
    responseData: {
      ok: true,
      token: 'user-token-1',
      tokenType: 'Bearer',
      expiresAt: '2099-01-01T00:00:00.000Z',
      openid: 'openid-secret',
      session_key: 'session-key-secret',
      access_token: 'access-token-secret',
      phoneNumber: '+8613800138000',
      user: {
        id: '1001',
        hasWechatBinding: true,
        hasPhoneBinding: true,
        phoneMasked: '138****8000',
        openid: 'openid-secret',
        session_key: 'session-key-secret',
        access_token: 'access-token-secret',
        phoneNumber: '13800138000'
      }
    }
  })

  const session = await loginWithWechatPhone(' phone-code-1 ', {
    apiBaseUrl: 'https://api.example.test',
    nodeEnv: 'development',
    requestId: 'request-1'
  })

  assert.equal(uniMock.loginCalls.length, 1)
  assert.equal(uniMock.loginCalls[0].provider, 'weixin')
  assert.equal(uniMock.requestCalls.length, 1)
  assert.equal(uniMock.requestCalls[0].url, 'https://api.example.test/api/auth/wechat-phone-login')
  assert.equal(uniMock.requestCalls[0].method, 'POST')
  assert.deepEqual(uniMock.requestCalls[0].data, {
    loginCode: 'login-code-1',
    phoneCode: 'phone-code-1',
    requestId: 'request-1'
  })

  assert.deepEqual(session, {
    token: 'user-token-1',
    tokenType: 'Bearer',
    expiresAt: '2099-01-01T00:00:00.000Z',
    user: {
      id: '1001',
      hasWechatBinding: true,
      hasPhoneBinding: true,
      phoneMasked: '138****8000'
    }
  })

  const storedSession = uniMock.storage.get(AUTH_SESSION_KEY)
  assert.equal(storedSession.user.hasPhoneBinding, true)
  assert.equal(storedSession.user.phoneMasked, '138****8000')
  assertNoSensitiveFields(storedSession)
}

async function testMissingPhoneCodeDoesNotCallBackend() {
  const uniMock = installUniMock({
    responseData: {
      ok: true
    }
  })

  await assert.rejects(
    () => loginWithWechatPhone('', {
      apiBaseUrl: 'https://api.example.test',
      nodeEnv: 'development'
    }),
    (error) => {
      assert.equal(error.code, 'WECHAT_PHONE_CODE_REQUIRED')
      return true
    }
  )

  assert.equal(uniMock.loginCalls.length, 0)
  assert.equal(uniMock.requestCalls.length, 0)
  assert.equal(uniMock.storage.has(AUTH_SESSION_KEY), false)
}

function testOldWechatSessionCompatibility() {
  installUniMock()
  const savedSession = saveAuthSession({
    token: 'old-user-token',
    tokenType: 'Bearer',
    expiresAt: '2099-01-01T00:00:00.000Z',
    user: {
      id: '42',
      hasWechatBinding: true
    }
  })
  const restoredSession = getAuthSession()

  assert.deepEqual(savedSession, {
    token: 'old-user-token',
    tokenType: 'Bearer',
    expiresAt: '2099-01-01T00:00:00.000Z',
    user: {
      id: '42',
      hasWechatBinding: true,
      hasPhoneBinding: false,
      phoneMasked: ''
    }
  })
  assert.deepEqual(restoredSession, savedSession)
  clearAuthSession()
  assert.equal(getAuthSession(), null)
}

await testLoginWithWechatPhoneSuccess()
await testMissingPhoneCodeDoesNotCallBackend()
testOldWechatSessionCompatibility()

console.log('miniapp auth phone login tests passed')
