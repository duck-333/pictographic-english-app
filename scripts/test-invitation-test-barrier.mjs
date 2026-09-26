import assert from 'node:assert/strict'

import { createTwoPartyBarrier } from './invitation-test-barrier.mjs'

const completed = createTwoPartyBarrier({ timeoutMs: 100 })
const completedResults = await Promise.all([completed.wait(), completed.wait()])
assert.deepEqual(completedResults, [undefined, undefined])
assert.equal(completed.arrivals, 2)
assert.equal(completed.settled, true)
assert.equal(completed.aborted, false)
assert.equal(completed.timeoutActive, false)
await assert.rejects(() => completed.wait(), error => error.code === 'INVITATION_TEST_BARRIER_EXCESS_ARRIVAL')

const timedOut = createTwoPartyBarrier({ timeoutMs: 30 })
await assert.rejects(() => timedOut.wait(), error => error.code === 'INVITATION_TEST_BARRIER_TIMEOUT')
assert.equal(timedOut.arrivals, 1)
assert.equal(timedOut.settled, true)
assert.equal(timedOut.aborted, true)
assert.equal(timedOut.timeoutActive, false)
await assert.rejects(() => timedOut.wait(), error => error.code === 'INVITATION_TEST_BARRIER_TIMEOUT')

const originalFailure = Object.assign(new Error('participant failed before hook'), { code: 'ORIGINAL_BRANCH_FAILURE' })
const aborted = createTwoPartyBarrier({ timeoutMs: 100 })
const waitingBranch = aborted.wait()
assert.equal(aborted.abort(originalFailure), true)
assert.equal(aborted.abort(new Error('duplicate abort')), false)
let abortError
await assert.rejects(() => waitingBranch, error => {
  abortError = error
  return error.code === 'INVITATION_TEST_BARRIER_ABORTED'
})
assert.equal(abortError.cause, originalFailure)
assert.equal(abortError.originalError, originalFailure)
await assert.rejects(() => aborted.wait(), error =>
  error.code === 'INVITATION_TEST_BARRIER_ABORTED' && error.cause === originalFailure)
assert.equal(aborted.timeoutActive, false)

const aggregateBarrier = createTwoPartyBarrier({ timeoutMs: 100 })
const peerWait = aggregateBarrier.wait()
const failingBranch = Promise.resolve().then(() => { throw originalFailure }).catch(error => {
  aggregateBarrier.abort(error)
  throw error
})
const aggregateResults = await Promise.allSettled([failingBranch, peerWait])
assert.equal(aggregateResults[0].status, 'rejected')
assert.equal(aggregateResults[0].reason, originalFailure)
assert.equal(aggregateResults[1].status, 'rejected')
assert.equal(aggregateResults[1].reason.code, 'INVITATION_TEST_BARRIER_ABORTED')
assert.equal(aggregateResults[1].reason.cause, originalFailure)

let activeBarrier = createTwoPartyBarrier({ timeoutMs: 100 })
const activeWait = activeBarrier.wait()
try {
  activeBarrier.abort(originalFailure)
  await assert.rejects(() => activeWait, error => error.code === 'INVITATION_TEST_BARRIER_ABORTED')
} finally {
  activeBarrier.abort(new Error('finally cleanup'))
  activeBarrier = null
}
assert.equal(activeBarrier, null)

console.log('invitation bounded test barrier tests passed')
