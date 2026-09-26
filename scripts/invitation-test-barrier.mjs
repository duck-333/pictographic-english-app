const DEFAULT_TIMEOUT_MS = 1000
const EXPECTED_ARRIVALS = 2

function barrierError(message, code, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.code = code
  if (cause !== undefined) error.originalError = cause
  return error
}

export function createTwoPartyBarrier(options = {}) {
  const requestedTimeout = Number(options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs)
  if (!Number.isSafeInteger(requestedTimeout) || requestedTimeout < 1 || requestedTimeout > 30000) {
    throw barrierError('Invitation test barrier timeout is invalid.', 'INVITATION_TEST_BARRIER_INVALID')
  }

  let arrivals = 0
  let settled = false
  let aborted = false
  let settlementError = null
  let timeoutHandle = null
  const waiters = []

  function clearBarrierTimeout() {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle)
    timeoutHandle = null
  }

  function rejectAll(error) {
    if (settled) return false
    settled = true
    aborted = true
    settlementError = error
    clearBarrierTimeout()
    const pending = waiters.splice(0)
    for (const waiter of pending) waiter.reject(error)
    return true
  }

  function resolveAll() {
    if (settled) return
    settled = true
    clearBarrierTimeout()
    const pending = waiters.splice(0)
    for (const waiter of pending) waiter.resolve()
  }

  function startTimeout() {
    if (timeoutHandle !== null || settled) return
    timeoutHandle = setTimeout(() => {
      rejectAll(barrierError('Invitation test barrier timed out.', 'INVITATION_TEST_BARRIER_TIMEOUT'))
    }, requestedTimeout)
  }

  const barrier = {
    wait() {
      if (settled) {
        if (settlementError) return Promise.reject(settlementError)
        return Promise.reject(barrierError(
          'Invitation test barrier received more than two arrivals.',
          'INVITATION_TEST_BARRIER_EXCESS_ARRIVAL'
        ))
      }
      arrivals += 1
      if (arrivals > EXPECTED_ARRIVALS) {
        const error = barrierError(
          'Invitation test barrier received more than two arrivals.',
          'INVITATION_TEST_BARRIER_EXCESS_ARRIVAL'
        )
        rejectAll(error)
        return Promise.reject(error)
      }
      const waiting = new Promise((resolve, reject) => waiters.push({ resolve, reject }))
      if (arrivals === 1) startTimeout()
      if (arrivals === EXPECTED_ARRIVALS) resolveAll()
      return waiting
    },
    abort(cause) {
      return rejectAll(barrierError(
        'Invitation test barrier was aborted.',
        'INVITATION_TEST_BARRIER_ABORTED',
        cause
      ))
    },
    get arrivals() { return arrivals },
    get settled() { return settled },
    get aborted() { return aborted },
    get timeoutActive() { return timeoutHandle !== null }
  }
  return Object.freeze(barrier)
}
