import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { inspect } from 'node:util'

import { createWechatAccessTokenProvider } from '../server/wechat-login.mjs'

const APP_SECRET = 'app-secret-sensitive-value'
const ROTATED_SECRET = 'rotated-app-secret-sensitive-value'
const ACCESS_TOKEN = 'access-token-sensitive-value'
const ROTATED_TOKEN = 'rotated-access-token-sensitive-value'
const FULL_URL_MARKER = 'https://api.weixin.qq.com/cgi-bin/token?secret='

function fingerprint(appid, secret) {
  return crypto.createHash('sha256').update(appid).update('\u0000').update(secret).digest('hex')
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createFakeRequest(handler) {
  return (url, options, callback) => {
    const req = new EventEmitter()
    req.destroyed = false
    req.destroy = () => {
      req.destroyed = true
    }
    req.end = () => {
      Promise.resolve()
        .then(() => handler(url, options, req))
        .then((spec = {}) => {
          if (spec.timeout) {
            req.emit('timeout')
            return
          }
          if (spec.requestError) {
            req.emit('error', spec.requestError)
            return
          }
          const res = new EventEmitter()
          res.statusCode = spec.statusCode === undefined ? 200 : spec.statusCode
          res.headers = spec.headers || {}
          res.destroyed = false
          res.setEncoding = () => {}
          res.destroy = () => {
            res.destroyed = true
          }
          callback(res)
          queueMicrotask(() => {
            for (const chunk of spec.chunks || [spec.body === undefined ? '' : spec.body]) {
              if (res.destroyed) break
              res.emit('data', chunk)
            }
            if (res.destroyed) return
            if (spec.responseError) {
              res.emit('error', spec.responseError)
              return
            }
            if (spec.responseAborted) {
              res.emit('aborted')
              return
            }
            if (spec.responseClosed) {
              res.emit('close')
              return
            }
            res.emit('end')
          })
        })
        .catch((error) => req.emit('error', error))
    }
    return req
  }
}

function jsonResponse(token = ACCESS_TOKEN, expiresIn = 7200) {
  return {
    statusCode: 200,
    body: JSON.stringify({ access_token: token, expires_in: expiresIn })
  }
}

function assertSafeError(error, expectedCode = 'WECHAT_ACCESS_TOKEN_UNAVAILABLE') {
  assert.equal(error.code, expectedCode)
  assert.equal(Object.hasOwn(error, 'cause'), false)
  assert.equal(Object.hasOwn(error, 'details'), false)
  const serialized = [
    error.message,
    error.stack,
    inspect(error),
    JSON.stringify(error)
  ].join('\n')
  for (const sensitive of [
    APP_SECRET,
    ROTATED_SECRET,
    ACCESS_TOKEN,
    ROTATED_TOKEN,
    FULL_URL_MARKER,
    fingerprint('appid-one', APP_SECRET),
    fingerprint('appid-one', ROTATED_SECRET)
  ]) {
    assert(!serialized.includes(sensitive))
  }
  return true
}

async function expectSafeError(run, expectedCode) {
  await assert.rejects(run, (error) => assertSafeError(error, expectedCode))
}

let nowMs = Date.parse('2026-08-30T00:00:00.000Z')
let requestCount = 0
const requestedAppids = []
const providerOptions = {
  appid: 'appid-one',
  secret: APP_SECRET,
  now: () => nowMs,
  request: createFakeRequest((url, options) => {
    requestCount += 1
    requestedAppids.push(url.searchParams.get('appid'))
    assert.equal(options.method, 'GET')
    assert.equal(options.timeout, 7000)
    return jsonResponse()
  })
}
const provider = createWechatAccessTokenProvider(providerOptions)

assert.equal(await provider.getAccessToken(), ACCESS_TOKEN)
assert.equal(await provider.getAccessToken(), ACCESS_TOKEN)
assert.equal(requestCount, 1)
nowMs += 7139 * 1000
assert.equal(await provider.getAccessToken(), ACCESS_TOKEN)
assert.equal(requestCount, 1)
nowMs += 2 * 1000
assert.equal(await provider.getAccessToken(), ACCESS_TOKEN)
assert.equal(requestCount, 2)
assert.deepEqual(requestedAppids, ['appid-one', 'appid-one'])

let concurrentRequests = 0
const concurrentRefresh = deferred()
const concurrentProvider = createWechatAccessTokenProvider({
  appid: 'appid-concurrent',
  secret: APP_SECRET,
  request: createFakeRequest(async () => {
    concurrentRequests += 1
    await concurrentRefresh.promise
    return jsonResponse()
  })
})
const pendingTokens = [
  concurrentProvider.getAccessToken(),
  concurrentProvider.getAccessToken(),
  concurrentProvider.getAccessToken()
]
await Promise.resolve()
await Promise.resolve()
assert.equal(concurrentRequests, 1)
concurrentRefresh.resolve()
assert.deepEqual(await Promise.all(pendingTokens), [ACCESS_TOKEN, ACCESS_TOKEN, ACCESS_TOKEN])

const rotationCalls = []
const oldRefresh = deferred()
const newRefresh = deferred()
const rotationOptions = {
  appid: 'appid-one',
  secret: APP_SECRET,
  request: createFakeRequest(async (url) => {
    const secret = url.searchParams.get('secret')
    rotationCalls.push(secret === APP_SECRET ? 'old' : 'new')
    if (secret === APP_SECRET) {
      await oldRefresh.promise
      return jsonResponse(ACCESS_TOKEN)
    }
    await newRefresh.promise
    return jsonResponse(ROTATED_TOKEN)
  })
}
const rotationProvider = createWechatAccessTokenProvider(rotationOptions)
const oldPending = rotationProvider.getAccessToken()
await Promise.resolve()
rotationOptions.secret = ROTATED_SECRET
const newPending = rotationProvider.getAccessToken()
await Promise.resolve()
await Promise.resolve()
assert.deepEqual(rotationCalls, ['old', 'new'], 'secret rotation must start an independent refresh')
newRefresh.resolve()
assert.equal(await newPending, ROTATED_TOKEN)
oldRefresh.resolve()
assert.equal(await oldPending, ACCESS_TOKEN)
assert.equal(await rotationProvider.getAccessToken(), ROTATED_TOKEN, 'late old refresh must not overwrite new cache')
assert.deepEqual(rotationCalls, ['old', 'new'])

let retryCount = 0
const retryOptions = {
  appid: 'appid-retry',
  secret: APP_SECRET,
  request: createFakeRequest(() => {
    retryCount += 1
    if (retryCount === 1) return { statusCode: 503, body: 'unavailable' }
    return jsonResponse()
  })
}
const retryProvider = createWechatAccessTokenProvider(retryOptions)
await expectSafeError(() => retryProvider.getAccessToken())
assert.equal(await retryProvider.getAccessToken(), ACCESS_TOKEN)
assert.equal(retryCount, 2)

let shortNow = Date.parse('2026-08-30T00:00:00.000Z')
let shortRequests = 0
const shortProvider = createWechatAccessTokenProvider({
  appid: 'appid-short',
  secret: APP_SECRET,
  now: () => shortNow,
  request: createFakeRequest(() => {
    shortRequests += 1
    return jsonResponse(ACCESS_TOKEN, 1)
  })
})
assert.equal(await shortProvider.getAccessToken(), ACCESS_TOKEN)
assert.equal(await shortProvider.getAccessToken(), ACCESS_TOKEN)
assert.equal(shortRequests, 1, 'short expiry must not cause an immediate refresh loop')
shortNow += 901
assert.equal(await shortProvider.getAccessToken(), ACCESS_TOKEN)
assert.equal(shortRequests, 2)

const invalidCases = [
  { spec: jsonResponse(ACCESS_TOKEN, 7201) },
  { spec: { statusCode: 200, body: JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: '7200' }) } },
  { spec: { statusCode: 200, body: JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: null }) } },
  { spec: { statusCode: 200, body: JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 1.5 }) } },
  { spec: { statusCode: 200, body: JSON.stringify({ access_token: '', expires_in: 7200 }) } },
  { spec: { statusCode: 503, body: JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 7200 }) } },
  { spec: { statusCode: 200, body: '' } },
  { spec: { statusCode: 200, body: 'not-json' } },
  { spec: { statusCode: 200, body: 'null' } },
  { spec: { statusCode: 200, body: '[]' } },
  { spec: { statusCode: 200, body: '{}' } },
  { spec: { statusCode: 200, body: JSON.stringify({ errcode: 40013, errmsg: `${APP_SECRET} ${ACCESS_TOKEN}` }) } },
  { spec: { statusCode: 200, headers: { 'content-length': String(64 * 1024 + 1) }, body: '' } },
  { spec: { statusCode: 200, body: 'x'.repeat(64 * 1024 + 1) } },
  { spec: { timeout: true } },
  { spec: { requestError: new Error(`${APP_SECRET} ${ACCESS_TOKEN} ${FULL_URL_MARKER}`) } },
  { spec: { statusCode: 200, responseError: new Error(`${APP_SECRET} ${ACCESS_TOKEN}`) } },
  { spec: { statusCode: 200, responseAborted: true } },
  { spec: { statusCode: 200, responseClosed: true } }
]
for (const testCase of invalidCases) {
  const invalidProvider = createWechatAccessTokenProvider({
    appid: 'appid-invalid',
    secret: APP_SECRET,
    request: createFakeRequest(() => testCase.spec)
  })
  await expectSafeError(() => invalidProvider.getAccessToken())
}

for (const expiresIn of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
  const raw = `{"access_token":"${ACCESS_TOKEN}","expires_in":${String(expiresIn)}}`
  const invalidProvider = createWechatAccessTokenProvider({
    appid: 'appid-invalid-number',
    secret: APP_SECRET,
    request: createFakeRequest(() => ({ statusCode: 200, body: raw }))
  })
  await expectSafeError(() => invalidProvider.getAccessToken())
}

const missingProvider = createWechatAccessTokenProvider({ appid: '', secret: '' })
await expectSafeError(() => missingProvider.getAccessToken(), 'WECHAT_ACCESS_TOKEN_CONFIG_MISSING')

const captured = []
const originals = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error
}
for (const method of Object.keys(originals)) console[method] = (...args) => captured.push(args)
try {
  const silentProvider = createWechatAccessTokenProvider({
    appid: 'appid-one',
    secret: APP_SECRET,
    request: createFakeRequest(() => ({
      statusCode: 502,
      body: `${APP_SECRET} ${ACCESS_TOKEN} ${fingerprint('appid-one', APP_SECRET)}`
    }))
  })
  await expectSafeError(() => silentProvider.getAccessToken())
} finally {
  Object.assign(console, originals)
}
assert.equal(captured.length, 0)

console.log('Wechat access token tests passed.')
