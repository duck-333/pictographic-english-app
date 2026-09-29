import assert from 'node:assert/strict'
import http from 'node:http'

import {
  closeHttpServerBounded,
  requestJsonWithTimeout,
  withSupervisedHttpTestServer
} from './invitation-http-test-adapter.mjs'

const CLEAN_STATE = Object.freeze({
  activeTimerCount: 0,
  serverErrorListenerCount: 0,
  serverConnectionListenerCount: 0,
  socketCloseListenerCount: 0
})

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return Object.freeze({ promise, resolve, reject })
}

async function waitForSignal(promise, label, timeoutMs = 500) {
  let timeout = null
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`${label} was not reached before its test deadline.`)
          error.code = 'INVITATION_HTTP_TEST_SIGNAL_TIMEOUT'
          reject(error)
        }, timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function expectSupervisedFailure(handler, expectedCode, exercise, overrides = {}) {
  let cleanupCount = 0
  let cleanupState = null
  let capturedError = null
  const startedAt = Date.now()
  await assert.rejects(() => withSupervisedHttpTestServer(handler, exercise, {
    handlerTimeoutMs: 500,
    responseTimeoutMs: 50,
    closeTimeoutMs: 100,
    ...overrides,
    onCleanup(state) {
      cleanupCount += 1
      cleanupState = state
    }
  }), error => {
    capturedError = error
    return error.code === 'INVITATION_HTTP_TEST_SERVER_FAILED' &&
      error.errors.some(item => item.code === expectedCode)
  })
  assert.equal(cleanupCount, 1)
  assert.deepEqual(cleanupState, CLEAN_STATE)
  assert.equal(capturedError.errors.filter(item => item.code === expectedCode).length, 1)
  return Object.freeze({ elapsedMs: Date.now() - startedAt, error: capturedError, cleanupCount })
}

await expectSupervisedFailure(() => { throw new Error('sync') }, 'INVITATION_HTTP_HANDLER_FAILED',
  async baseUrl => {
    const result = await requestJsonWithTimeout(baseUrl, '/', { timeoutMs: 1000 })
    assert.equal(result.status, 500)
  })

await expectSupervisedFailure(async () => { throw new Error('rejection') }, 'INVITATION_HTTP_HANDLER_FAILED',
  async baseUrl => {
    const result = await requestJsonWithTimeout(baseUrl, '/', { timeoutMs: 1000 })
    assert.equal(result.status, 500)
  })

async function runReturnedWithoutResponseRound() {
  const handlerEntered = createDeferred()
  let handlerEnteredCount = 0
  let clientNonTimeoutErrorCount = 0
  const outcome = await expectSupervisedFailure(() => {
    handlerEnteredCount += 1
    handlerEntered.resolve()
  }, 'INVITATION_HTTP_RESPONSE_NOT_COMPLETED', async baseUrl => {
    const request = requestJsonWithTimeout(baseUrl, '/', { timeoutMs: 1000 })
    request.catch(() => {})
    await waitForSignal(handlerEntered.promise, 'returned-without-response handler entry')
    await assert.rejects(() => request, error => {
      assert.notEqual(error.code, 'INVITATION_HTTP_REQUEST_TIMEOUT')
      clientNonTimeoutErrorCount += 1
      return true
    })
  }, { handlerTimeoutMs: 500, responseTimeoutMs: 40, closeTimeoutMs: 100 })
  assert.equal(handlerEnteredCount, 1)
  assert.equal(clientNonTimeoutErrorCount, 1)
  assert.equal(outcome.cleanupCount, 1)
}

async function runDestroyedResponseRound() {
  const handlerEntered = createDeferred()
  let handlerEnteredCount = 0
  let abnormalCloseCount = 0
  const outcome = await expectSupervisedFailure((req, res) => {
    handlerEnteredCount += 1
    handlerEntered.resolve()
    res.destroy()
  }, 'INVITATION_HTTP_RESPONSE_NOT_COMPLETED', async baseUrl => {
    const request = requestJsonWithTimeout(baseUrl, '/', { timeoutMs: 1000 })
    request.catch(() => {})
    await waitForSignal(handlerEntered.promise, 'destroyed-response handler entry')
    await assert.rejects(() => request, error => {
      assert.notEqual(error.code, 'INVITATION_HTTP_REQUEST_TIMEOUT')
      abnormalCloseCount += 1
      return true
    })
  })
  assert.equal(handlerEnteredCount, 1)
  assert.equal(abnormalCloseCount, 1)
  assert.equal(outcome.cleanupCount, 1)
}

for (let round = 1; round <= 6; round += 1) {
  await runReturnedWithoutResponseRound()
  await runDestroyedResponseRound()
}

// Client request timeout is a separate proof. The handler is known to have entered before
// the assertion waits for the client deadline, then is explicitly released without sleeps.
const clientTimeoutHandlerEntered = createDeferred()
const releaseClientTimeoutHandler = createDeferred()
let clientTimeoutHandlerEnteredCount = 0
let clientTimeoutErrorCount = 0
await expectSupervisedFailure(async () => {
  clientTimeoutHandlerEnteredCount += 1
  clientTimeoutHandlerEntered.resolve()
  await releaseClientTimeoutHandler.promise
}, 'INVITATION_HTTP_RESPONSE_NOT_COMPLETED', async baseUrl => {
  const request = requestJsonWithTimeout(baseUrl, '/', { timeoutMs: 500 })
  request.catch(() => {})
  await waitForSignal(clientTimeoutHandlerEntered.promise, 'client-timeout handler entry')
  await assert.rejects(() => request, error => {
    assert.equal(error.code, 'INVITATION_HTTP_REQUEST_TIMEOUT')
    clientTimeoutErrorCount += 1
    return true
  })
  releaseClientTimeoutHandler.resolve()
}, { handlerTimeoutMs: 1000, responseTimeoutMs: 100, closeTimeoutMs: 100 })
assert.equal(clientTimeoutHandlerEnteredCount, 1)
assert.equal(clientTimeoutErrorCount, 1)

await expectSupervisedFailure((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ ok: true }))
  res.end(JSON.stringify({ ok: false }))
}, 'INVITATION_HTTP_RESPONSE_ENDED_MULTIPLE_TIMES', async baseUrl => {
  const result = await requestJsonWithTimeout(baseUrl, '/', { timeoutMs: 1000 })
  assert.equal(result.status, 200)
})

const neverSettlesEntered = createDeferred()
let neverSettlesEnteredCount = 0
const neverSettlesOutcome = await expectSupervisedFailure(
  () => {
    neverSettlesEnteredCount += 1
    neverSettlesEntered.resolve()
    return new Promise(() => {})
  },
  'INVITATION_HTTP_HANDLER_TIMEOUT',
  async baseUrl => {
    const request = requestJsonWithTimeout(baseUrl, '/', { timeoutMs: 1000 })
    request.catch(() => {})
    await waitForSignal(neverSettlesEntered.promise, 'never-settling handler entry')
    await assert.rejects(() => request, error => {
      assert.notEqual(error.code, 'INVITATION_HTTP_REQUEST_TIMEOUT')
      return true
    })
  },
  { handlerTimeoutMs: 25, responseTimeoutMs: 100, closeTimeoutMs: 100 }
)
assert.equal(neverSettlesEnteredCount, 1)
assert(neverSettlesOutcome.elapsedMs < 500,
  `never-settling handler exceeded bound: ${neverSettlesOutcome.elapsedMs}ms`)

const closeTimers = new Set()
let closeCallCount = 0
let socketDestroyCount = 0
let closeAllCount = 0
const closeStartedAt = Date.now()
const closeTimeoutErrors = await closeHttpServerBounded({
  close() { closeCallCount += 1 },
  closeIdleConnections() {},
  closeAllConnections() { closeAllCount += 1 }
}, new Set([{ destroy() { socketDestroyCount += 1 } }]), 10, closeTimers)
const closeElapsedMs = Date.now() - closeStartedAt
assert.equal(closeTimeoutErrors.filter(error => error.code === 'INVITATION_HTTP_SERVER_CLOSE_TIMEOUT').length, 1)
assert.equal(closeCallCount, 1)
assert.equal(socketDestroyCount, 2)
assert.equal(closeAllCount, 1)
assert.equal(closeTimers.size, 0)
assert(closeElapsedMs >= 15 && closeElapsedMs < 500)

let keepAliveCleanupCount = 0
let keepAliveCleanupState = null
let trackedSocketsAtWorkEnd = 0
const agent = new http.Agent({ keepAlive: true })
await withSupervisedHttpTestServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ ok: true }))
}, async (baseUrl, state) => {
  await new Promise((resolve, reject) => {
    const url = new URL(baseUrl)
    const request = http.request({ hostname: url.hostname, port: url.port, path: '/', agent }, response => {
      response.resume()
      response.once('end', resolve)
    })
    request.once('error', reject)
    request.end()
  })
  trackedSocketsAtWorkEnd = state.sockets.size
}, {
  handlerTimeoutMs: 500,
  responseTimeoutMs: 500,
  closeTimeoutMs: 100,
  onCleanup(state) {
    keepAliveCleanupCount += 1
    keepAliveCleanupState = state
  }
})
agent.destroy()
assert(trackedSocketsAtWorkEnd >= 1)
assert.equal(keepAliveCleanupCount, 1)
assert.deepEqual(keepAliveCleanupState, CLEAN_STATE)

console.log(`invitation supervised HTTP adapter deterministic tests passed; ` +
  `6 no-response rounds + 6 destroyed-response rounds; never-settling=${neverSettlesOutcome.elapsedMs}ms; ` +
  `close-timeout=${closeElapsedMs}ms`)
