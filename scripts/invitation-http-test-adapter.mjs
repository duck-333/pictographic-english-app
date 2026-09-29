import http from 'node:http'

function adapterError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  return error
}

function startTrackedTimer(timers, callback, timeoutMs) {
  const handle = setTimeout(() => {
    timers.delete(handle)
    callback()
  }, timeoutMs)
  timers.add(handle)
  return handle
}

function clearTrackedTimer(timers, handle) {
  if (!handle) return
  clearTimeout(handle)
  timers.delete(handle)
}

async function settleWithin(promise, timeoutMs, timers) {
  let timer = null
  return await new Promise(resolve => {
    let completed = false
    const finish = value => {
      if (completed) return
      completed = true
      clearTrackedTimer(timers, timer)
      resolve(value)
    }
    timer = startTrackedTimer(timers, () => finish(false), timeoutMs)
    promise.then(() => finish(true), () => finish(true))
  })
}

export async function closeHttpServerBounded(server, sockets, timeoutMs, timers = new Set()) {
  const errors = []
  let closeFinished = false
  const closePromise = new Promise(resolve => {
    try {
      server.close(error => {
        closeFinished = true
        if (error) errors.push(adapterError(
          'INVITATION_HTTP_SERVER_CLOSE_FAILED',
          'HTTP test server close failed.',
          error
        ))
        resolve()
      })
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
    } catch (error) {
      closeFinished = true
      errors.push(adapterError('INVITATION_HTTP_SERVER_CLOSE_FAILED', 'HTTP test server close threw.', error))
      resolve()
    }
  })
  await settleWithin(closePromise, timeoutMs, timers)
  if (!closeFinished) {
    for (const socket of sockets) socket.destroy()
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    await settleWithin(closePromise, timeoutMs, timers)
  }
  if (!closeFinished) {
    errors.push(adapterError('INVITATION_HTTP_SERVER_CLOSE_TIMEOUT', 'HTTP test server did not close in time.'))
  }
  for (const socket of sockets) socket.destroy()
  return errors
}

async function superviseHandler(handler, req, res, timeoutMs, timers, supervisorErrors) {
  const rawHandlerPromise = Promise.resolve().then(() => handler(req, res))
  // Only the bounded wrapper is awaited by shutdown. This observer prevents a
  // rejection arriving after the deadline from becoming unhandled.
  rawHandlerPromise.catch(() => {})
  let timer = null
  const outcome = await new Promise(resolve => {
    let completed = false
    const finish = value => {
      if (completed) return
      completed = true
      clearTrackedTimer(timers, timer)
      resolve(value)
    }
    timer = startTrackedTimer(timers, () => finish({ status: 'timeout' }), timeoutMs)
    rawHandlerPromise.then(
      () => finish({ status: 'fulfilled' }),
      error => finish({ status: 'rejected', error })
    )
  })

  if (outcome.status === 'timeout') {
    const error = adapterError(
      'INVITATION_HTTP_HANDLER_TIMEOUT',
      'HTTP test handler did not settle before its supervision deadline.'
    )
    supervisorErrors.push(error)
    if (!res.destroyed) res.destroy(error)
    else if (!req.socket.destroyed) req.socket.destroy(error)
    return outcome.status
  }
  if (outcome.status === 'rejected') {
    const error = adapterError('INVITATION_HTTP_HANDLER_FAILED', 'HTTP test handler failed.', outcome.error)
    supervisorErrors.push(error)
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, code: 'TEST_HANDLER_FAILED' }))
    } else if (!res.writableEnded && !res.destroyed) {
      res.destroy(error)
    }
  }
  return outcome.status
}

async function waitForResponseCompletion(res, timeoutMs, timers) {
  if (res.writableEnded) return true
  if (res.destroyed) return false
  let timer = null
  let finishListener
  let closeListener
  return await new Promise(resolve => {
    let completed = false
    const finish = value => {
      if (completed) return
      completed = true
      clearTrackedTimer(timers, timer)
      res.off('finish', finishListener)
      res.off('close', closeListener)
      resolve(value)
    }
    finishListener = () => finish(true)
    closeListener = () => finish(res.writableEnded)
    res.once('finish', finishListener)
    res.once('close', closeListener)
    timer = startTrackedTimer(timers, () => finish(false), timeoutMs)
  })
}

function waitForListening(server) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('listening', onListening)
      server.off('error', onError)
    }
    const onListening = () => {
      cleanup()
      resolve()
    }
    const onError = error => {
      cleanup()
      reject(error)
    }
    server.once('listening', onListening)
    server.once('error', onError)
  })
}

export async function requestJsonWithTimeout(baseUrl, pathname, options = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs || 2000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || 'POST',
      headers: options.headers,
      body: options.body,
      signal: controller.signal
    })
    return { status: response.status, headers: response.headers, body: await response.json() }
  } catch (error) {
    if (controller.signal.aborted) {
      throw adapterError('INVITATION_HTTP_REQUEST_TIMEOUT', 'HTTP test request timed out.', error)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function withSupervisedHttpTestServer(handler, work, options = {}) {
  const host = '127.0.0.1'
  const handlerTimeoutMs = options.handlerTimeoutMs || 1000
  const responseTimeoutMs = options.responseTimeoutMs || 1000
  const closeTimeoutMs = options.closeTimeoutMs || 1000
  const sockets = new Set()
  const socketCloseListeners = new Map()
  const timers = new Set()
  const supervisorErrors = []
  const pendingRequests = new Set()
  const server = http.createServer((req, res) => {
    let endCount = 0
    const originalEnd = res.end.bind(res)
    res.end = (...args) => {
      endCount += 1
      if (endCount > 1) {
        supervisorErrors.push(adapterError(
          'INVITATION_HTTP_RESPONSE_ENDED_MULTIPLE_TIMES',
          'HTTP test handler ended one response more than once.'
        ))
        return res
      }
      return originalEnd(...args)
    }

    const supervised = (async () => {
      const handlerStatus = await superviseHandler(
        handler, req, res, handlerTimeoutMs, timers, supervisorErrors
      )
      if (handlerStatus === 'timeout') return
      const completed = await waitForResponseCompletion(res, responseTimeoutMs, timers)
      if (!completed) {
        const error = adapterError(
          'INVITATION_HTTP_RESPONSE_NOT_COMPLETED',
          'HTTP test handler returned without completing its response.'
        )
        supervisorErrors.push(error)
        if (!res.destroyed) res.destroy(error)
      }
    })()
    pendingRequests.add(supervised)
    supervised.finally(() => pendingRequests.delete(supervised)).catch(() => {})
  })
  const connectionListener = socket => {
    sockets.add(socket)
    const closeListener = () => {
      sockets.delete(socket)
      socketCloseListeners.delete(socket)
    }
    socketCloseListeners.set(socket, closeListener)
    socket.once('close', closeListener)
  }
  server.on('connection', connectionListener)

  let result
  let workError = null
  let listening = false
  const runtimeErrorListener = error => {
    supervisorErrors.push(adapterError('INVITATION_HTTP_SERVER_ERROR', 'HTTP test server emitted an error.', error))
  }
  try {
    server.listen(0, host)
    await waitForListening(server)
    listening = true
    server.on('error', runtimeErrorListener)
    const address = server.address()
    result = await work(`http://${host}:${address.port}`, { server, sockets, timers })
  } catch (error) {
    workError = error
  }

  const closeErrors = listening
    ? await closeHttpServerBounded(server, sockets, closeTimeoutMs, timers)
    : []
  await Promise.allSettled([...pendingRequests])
  server.off('error', runtimeErrorListener)
  server.off('connection', connectionListener)
  for (const [socket, closeListener] of socketCloseListeners) {
    socket.off('close', closeListener)
    socket.destroy()
  }
  socketCloseListeners.clear()
  sockets.clear()
  for (const timer of timers) clearTimeout(timer)
  timers.clear()
  const cleanupState = Object.freeze({
    activeTimerCount: timers.size,
    serverErrorListenerCount: server.listeners('error').includes(runtimeErrorListener) ? 1 : 0,
    serverConnectionListenerCount: server.listeners('connection').includes(connectionListener) ? 1 : 0,
    socketCloseListenerCount: socketCloseListeners.size
  })
  if (typeof options.onCleanup === 'function') options.onCleanup(cleanupState)
  const errors = [workError, ...supervisorErrors, ...closeErrors].filter(Boolean)
  if (errors.length) {
    const aggregate = new AggregateError(errors, 'Supervised HTTP test server failed.',
      workError ? { cause: workError } : undefined)
    aggregate.code = 'INVITATION_HTTP_TEST_SERVER_FAILED'
    aggregate.workError = workError
    aggregate.supervisorErrors = supervisorErrors
    aggregate.closeErrors = closeErrors
    aggregate.cleanupState = cleanupState
    throw aggregate
  }
  return result
}
