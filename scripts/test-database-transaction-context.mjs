import assert from 'node:assert/strict'

import {
  insertDatabaseUserInTransaction,
  lockDatabaseUsersInTransaction,
  requireDatabaseUsersLocked,
  withDatabasePoolTransaction,
  withDatabaseTransaction
} from '../server/database-transaction-context.mjs'

function deferred() {
  let resolve
  const promise = new Promise(value => { resolve = value })
  return { promise, resolve }
}

function connectionFixture(overrides = {}) {
  const calls = []
  const connection = {
    calls,
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    async execute(sql) { calls.push(`execute:${sql}`); return [[], []] },
    async query(sql) { calls.push(`query:${sql}`); return [[], []] },
    async destroy() { calls.push('destroy') },
    async release() { calls.push('release') },
    ...overrides
  }
  return connection
}

const nestedConnection = connectionFixture()
await withDatabaseTransaction(nestedConnection, async context => {
  assert.deepEqual(Object.keys(context), ['execute', 'query'])
  for (const name of ['beginTransaction', 'commit', 'rollback', 'release', 'getConnection']) assert.equal(context[name], undefined)
  await assert.rejects(() => withDatabaseTransaction(nestedConnection, async () => {}),
    error => error.code === 'DATABASE_TRANSACTION_CONNECTION_BUSY')
})
assert.deepEqual(nestedConnection.calls, ['begin', 'commit'])

const concurrentConnection = connectionFixture()
const entered = deferred(); const finish = deferred()
const first = withDatabaseTransaction(concurrentConnection, async () => { entered.resolve(); await finish.promise })
await entered.promise
await assert.rejects(() => withDatabaseTransaction(concurrentConnection, async () => {}),
  error => error.code === 'DATABASE_TRANSACTION_CONNECTION_BUSY')
assert.equal(concurrentConnection.calls.filter(value => value === 'begin').length, 1)
finish.resolve()
await first
await withDatabaseTransaction(concurrentConnection, async () => {})
assert.deepEqual(concurrentConnection.calls, ['begin', 'commit', 'begin', 'commit'])

const businessError = Object.assign(new Error('business failed'), { code: 'BUSINESS_FAILED' })
const rollbackError = Object.assign(new Error('rollback failed'), { code: 'ROLLBACK_FAILED' })
const failedRollbackConnection = connectionFixture({
  async rollback() { failedRollbackConnection.calls.push('rollback'); throw rollbackError }
})
let cleanupError
await assert.rejects(() => withDatabaseTransaction(failedRollbackConnection, async () => { throw businessError }), error => {
  cleanupError = error
  return error.code === 'DATABASE_TRANSACTION_CLEANUP_FAILED'
})
assert.equal(cleanupError.originalError, businessError)
assert.equal(cleanupError.rollbackError, rollbackError)
assert.equal(cleanupError.cause, businessError)
assert.deepEqual(failedRollbackConnection.calls, ['begin', 'rollback', 'destroy'])
await assert.rejects(() => withDatabaseTransaction(failedRollbackConnection, async () => {}),
  error => error.code === 'DATABASE_TRANSACTION_CONNECTION_UNUSABLE')
assert.equal(failedRollbackConnection.calls.filter(value => value === 'begin').length, 1)
await assert.rejects(() => withDatabasePoolTransaction({ async getConnection() { return failedRollbackConnection } }, async () => {}),
  error => error.code === 'DATABASE_TRANSACTION_CONNECTION_UNUSABLE')
assert.equal(failedRollbackConnection.calls.includes('release'), false)

const deadlock = Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' })
const deadlockRollback = Object.assign(new Error('deadlock rollback failed'), { code: 'ROLLBACK_FAILED' })
const deadlockCleanupConnection = connectionFixture({
  async rollback() { deadlockCleanupConnection.calls.push('rollback'); throw deadlockRollback }
})
await assert.rejects(() => withDatabaseTransaction(deadlockCleanupConnection, async () => { throw deadlock }), error =>
  error.code === 'DATABASE_TRANSACTION_CLEANUP_FAILED' && error.originalError === deadlock && error.rollbackError === deadlockRollback)
assert.equal(deadlockCleanupConnection.calls.filter(value => value === 'begin').length, 1)

const destroyError = new Error('destroy failed')
const destroyFailureConnection = connectionFixture({
  async rollback() { destroyFailureConnection.calls.push('rollback'); throw rollbackError },
  async destroy() { destroyFailureConnection.calls.push('destroy'); throw destroyError }
})
let destroyCleanupError
await assert.rejects(() => withDatabaseTransaction(destroyFailureConnection, async () => { throw businessError }), error => {
  destroyCleanupError = error; return error.code === 'DATABASE_TRANSACTION_CLEANUP_FAILED'
})
assert.equal(destroyCleanupError.destroyError, destroyError)
await assert.rejects(() => withDatabaseTransaction(destroyFailureConnection, async () => {}),
  error => error.code === 'DATABASE_TRANSACTION_CONNECTION_UNUSABLE')

const safeRollbackConnection = connectionFixture()
await assert.rejects(() => withDatabaseTransaction(safeRollbackConnection, async () => { throw businessError }),
  error => error === businessError)
await withDatabaseTransaction(safeRollbackConnection, async () => {})
assert.deepEqual(safeRollbackConnection.calls, ['begin', 'rollback', 'begin', 'commit'])

const lockConnection = connectionFixture({
  async execute(sql, params) {
    lockConnection.calls.push({ sql, params })
    return [params.map(id => ({ id })), []]
  }
})
await withDatabaseTransaction(lockConnection, async context => {
  const locked = await lockDatabaseUsersInTransaction(context, ['18446744073709551615', '2', '10', '2'])
  assert.deepEqual(locked, ['2', '10', '18446744073709551615'])
  requireDatabaseUsersLocked(context, ['10', '2'])
  await lockDatabaseUsersInTransaction(context, ['2', '10'])
  await assert.rejects(() => lockDatabaseUsersInTransaction(context, ['1', '2', '10']),
    error => error.code === 'DATABASE_TRANSACTION_USER_LOCK_EXPANSION_FORBIDDEN')
})
const lockCall = lockConnection.calls.find(value => typeof value === 'object')
assert.match(lockCall.sql, /ORDER BY id FOR UPDATE/u)
assert.deepEqual(lockCall.params, ['2', '10', '18446744073709551615'])

const missingScopedUserConnection = connectionFixture({
  async execute(sql, params) {
    missingScopedUserConnection.calls.push({ sql, params })
    if (/SELECT id FROM users WHERE id IN/u.test(sql)) return [[{ id: '20' }], []]
    throw new Error(`Unexpected missing-scoped-user SQL: ${sql}`)
  }
})
await withDatabaseTransaction(missingScopedUserConnection, async context => {
  assert.deepEqual(await lockDatabaseUsersInTransaction(context, ['10', '20'], { allowMissing: true }), ['20'])
  assert.deepEqual(await lockDatabaseUsersInTransaction(context, ['10', '20'], { allowMissing: true }), ['20'])
  assert.deepEqual(await lockDatabaseUsersInTransaction(context, ['10'], { allowMissing: true }), [])
  assert.throws(() => requireDatabaseUsersLocked(context, ['10']),
    error => error.code === 'DATABASE_TRANSACTION_USERS_NOT_LOCKED')
  await assert.rejects(() => lockDatabaseUsersInTransaction(context, ['10']),
    error => error.code === 'DATABASE_TRANSACTION_USER_NOT_FOUND')
  await assert.rejects(() => lockDatabaseUsersInTransaction(context, ['21'], { allowMissing: true }),
    error => error.code === 'DATABASE_TRANSACTION_USER_LOCK_EXPANSION_FORBIDDEN')
})
assert.equal(missingScopedUserConnection.calls.filter(call => (
  typeof call === 'object' && /SELECT id FROM users WHERE id IN/u.test(call.sql)
)).length, 1)

const initializingEntered = deferred()
const initializingFinish = deferred()
const initializingConnection = connectionFixture({
  async execute(sql) {
    if (!/SELECT id FROM users WHERE id IN/u.test(sql)) throw new Error(`Unexpected initializing SQL: ${sql}`)
    initializingEntered.resolve()
    await initializingFinish.promise
    return [[{ id: '30' }], []]
  }
})
await withDatabaseTransaction(initializingConnection, async context => {
  const initializingLock = lockDatabaseUsersInTransaction(context, ['30'])
  await initializingEntered.promise
  await assert.rejects(() => lockDatabaseUsersInTransaction(context, ['30']),
    error => error.code === 'DATABASE_TRANSACTION_USER_LOCK_SCOPE_UNAVAILABLE')
  initializingFinish.resolve()
  assert.deepEqual(await initializingLock, ['30'])
})

for (const invalidId of ['0', '-1', '18446744073709551616', '1.5', '1e3', ' 1', '1 ', '', true, Number.MAX_SAFE_INTEGER + 1]) {
  await assert.rejects(() => withDatabaseTransaction(connectionFixture(), context =>
    lockDatabaseUsersInTransaction(context, [invalidId])),
  error => error.code === 'DATABASE_TRANSACTION_USER_ID_INVALID')
}

const transactionModule = await import('../server/database-transaction-context.mjs')
assert.equal(transactionModule.recordDatabaseUserCreatedInTransaction, undefined)

const uninitializedEmptyConnection = connectionFixture()
await assert.rejects(() => withDatabaseTransaction(uninitializedEmptyConnection, async context => {
  requireDatabaseUsersLocked(context, [])
}), error => error.code === 'DATABASE_USER_LOCK_SCOPE_REQUIRED')
assert.deepEqual(uninitializedEmptyConnection.calls, ['begin', 'rollback'])

const uninitializedInsertConnection = connectionFixture()
await assert.rejects(() => withDatabaseTransaction(uninitializedInsertConnection, context =>
  insertDatabaseUserInTransaction(context, { values: { status: 'active' } })),
error => error.code === 'DATABASE_USER_LOCK_SCOPE_REQUIRED')
assert.equal(uninitializedInsertConnection.calls.some(call => String(call).includes('INSERT INTO users')), false)
assert.equal(uninitializedInsertConnection.calls.some(call => String(call).includes('LAST_INSERT_ID')), false)
assert.deepEqual(uninitializedInsertConnection.calls, ['begin', 'rollback'])

const failedScopeConnection = connectionFixture({
  async execute(sql) {
    failedScopeConnection.calls.push(`execute:${sql}`)
    if (/SELECT id FROM users WHERE id IN/u.test(sql)) return [[], []]
    throw new Error(`Unexpected SQL after failed user lock scope: ${sql}`)
  }
})
await withDatabaseTransaction(failedScopeConnection, async context => {
  await assert.rejects(() => lockDatabaseUsersInTransaction(context, ['44']),
    error => error.code === 'DATABASE_TRANSACTION_USER_NOT_FOUND')
  await assert.rejects(() => lockDatabaseUsersInTransaction(context, ['44'], { allowMissing: true }),
    error => error.code === 'DATABASE_TRANSACTION_USER_LOCK_SCOPE_UNAVAILABLE')
  await assert.rejects(() => insertDatabaseUserInTransaction(context, { values: { status: 'active' } }),
    error => error.code === 'DATABASE_USER_LOCK_SCOPE_REQUIRED')
  assert.equal(failedScopeConnection.calls.some(call => String(call).includes('INSERT INTO users')), false)
  assert.equal(failedScopeConnection.calls.some(call => String(call).includes('LAST_INSERT_ID')), false)
})

let createdContext
const controlledInsertConnection = connectionFixture({
  async execute(sql) {
    controlledInsertConnection.calls.push(sql)
    if (/^INSERT INTO users/u.test(sql)) return [{ affectedRows: 1, insertId: '55' }, []]
    if (/LAST_INSERT_ID/u.test(sql)) return [[{ id: '55' }], []]
    return [[], []]
  }
})
await withDatabaseTransaction(controlledInsertConnection, async context => {
  createdContext = context
  assert.equal(context.recordDatabaseUserCreated, undefined)
  await lockDatabaseUsersInTransaction(context, [])
  requireDatabaseUsersLocked(context, [])
  assert.throws(() => requireDatabaseUsersLocked(context, ['55']),
    error => error.code === 'DATABASE_TRANSACTION_USERS_NOT_LOCKED')
  const createdId = await insertDatabaseUserInTransaction(context, { values: { status: 'active' } })
  assert.equal(createdId, '55')
  requireDatabaseUsersLocked(context, ['55'])
  assert.deepEqual(await lockDatabaseUsersInTransaction(context, ['55']), ['55'])
  await assert.rejects(() => lockDatabaseUsersInTransaction(context, ['55', '56']),
    error => error.code === 'DATABASE_TRANSACTION_USER_LOCK_EXPANSION_FORBIDDEN')
  await assert.rejects(() => insertDatabaseUserInTransaction(context, { values: { id: '999' } }),
    error => error.code === 'DATABASE_TRANSACTION_USER_INSERT_INVALID')
})
await assert.rejects(() => insertDatabaseUserInTransaction(createdContext, { values: { status: 'active' } }),
  error => error.code === 'DATABASE_TRANSACTION_REQUIRED')

let rolledBackCreatedContext
await assert.rejects(() => withDatabaseTransaction(controlledInsertConnection, async context => {
  rolledBackCreatedContext = context
  await lockDatabaseUsersInTransaction(context, [])
  await insertDatabaseUserInTransaction(context, { values: { status: 'active' } })
  throw businessError
}), error => error === businessError)
await assert.rejects(() => insertDatabaseUserInTransaction(rolledBackCreatedContext, { values: { status: 'active' } }),
  error => error.code === 'DATABASE_TRANSACTION_REQUIRED')

const failedInsertConnection = connectionFixture({
  async execute(sql) {
    if (/^INSERT INTO users/u.test(sql)) return [{ affectedRows: 0, insertId: '77' }, []]
    throw new Error(`Unexpected failed insert SQL: ${sql}`)
  }
})
await assert.rejects(() => withDatabaseTransaction(failedInsertConnection, async context => {
  await lockDatabaseUsersInTransaction(context, [])
  return insertDatabaseUserInTransaction(context, { values: { status: 'active' } })
}),
error => error.code === 'DATABASE_TRANSACTION_USER_INSERT_FAILED')

const forgedInsertConnection = connectionFixture({
  async execute(sql) {
    if (/^INSERT INTO users/u.test(sql)) return [{ affectedRows: 1, insertId: '88' }, []]
    if (/LAST_INSERT_ID/u.test(sql)) return [[{ id: '89' }], []]
    throw new Error(`Unexpected forged insert SQL: ${sql}`)
  }
})
await assert.rejects(() => withDatabaseTransaction(forgedInsertConnection, async context => {
  await lockDatabaseUsersInTransaction(context, [])
  return insertDatabaseUserInTransaction(context, { values: { status: 'active' } })
}),
error => error.code === 'DATABASE_TRANSACTION_USER_INSERT_FAILED')

const existingThenNewConnection = connectionFixture({
  async execute(sql, params = []) {
    existingThenNewConnection.calls.push({ sql, params })
    if (/SELECT id FROM users WHERE id IN/u.test(sql)) return [[{ id: '10' }], []]
    if (/^INSERT INTO users/u.test(sql)) return [{ affectedRows: 1, insertId: '60' }, []]
    if (/LAST_INSERT_ID/u.test(sql)) return [[{ id: '60' }], []]
    throw new Error(`Unexpected existing-then-new SQL: ${sql}`)
  }
})
await withDatabaseTransaction(existingThenNewConnection, async context => {
  assert.deepEqual(await lockDatabaseUsersInTransaction(context, ['10']), ['10'])
  assert.equal(await insertDatabaseUserInTransaction(context, { values: { status: 'active' } }), '60')
  requireDatabaseUsersLocked(context, ['10', '60'])
})

let customAttempts = 0
const customRetryConnection = connectionFixture()
await withDatabaseTransaction(customRetryConnection, async () => {
  customAttempts += 1
  if (customAttempts < 3) throw Object.assign(new Error('phone race'), {
    code: 'IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT'
  })
}, { maximumAttempts: 3, retryableCodes: ['IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT'] })
assert.equal(customAttempts, 3)
assert.deepEqual(customRetryConnection.calls, ['begin', 'rollback', 'begin', 'rollback', 'begin', 'commit'])

let exhaustedPhoneAttempts = 0
const exhaustedPhoneError = Object.assign(new Error('persistent phone race'), {
  code: 'IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT'
})
await assert.rejects(() => withDatabaseTransaction(connectionFixture(), async () => {
  exhaustedPhoneAttempts += 1
  throw exhaustedPhoneError
}, { maximumAttempts: 3, retryableCodes: ['IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT'] }),
error => error === exhaustedPhoneError)
assert.equal(exhaustedPhoneAttempts, 3)

let unexpectedAttempts = 0
const unexpectedDuplicate = Object.assign(new Error('unexpected duplicate'), { code: 'ER_DUP_ENTRY' })
await assert.rejects(() => withDatabaseTransaction(connectionFixture(), async () => {
  unexpectedAttempts += 1
  throw unexpectedDuplicate
}, { retryableCodes: ['IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT'] }), error => error === unexpectedDuplicate)
assert.equal(unexpectedAttempts, 1)

const releaseFailure = new Error('release failed')
const releaseConnection = connectionFixture({
  async release() { releaseConnection.calls.push('release'); throw releaseFailure }
})
await assert.rejects(() => withDatabasePoolTransaction({
  async getConnection() { return releaseConnection }
}, async () => {}), error =>
  error.code === 'DATABASE_TRANSACTION_RELEASE_FAILED' && error.releaseError === releaseFailure &&
  error.rollbackError === undefined)
assert.deepEqual(releaseConnection.calls, ['begin', 'commit', 'release', 'destroy'])
await assert.rejects(() => withDatabaseTransaction(releaseConnection, async () => {}),
  error => error.code === 'DATABASE_TRANSACTION_CONNECTION_UNUSABLE')

const operationAndReleaseConnection = connectionFixture({
  async release() { operationAndReleaseConnection.calls.push('release'); throw releaseFailure }
})
await assert.rejects(() => withDatabasePoolTransaction({
  async getConnection() { return operationAndReleaseConnection }
}, async () => { throw businessError }), error =>
  error.code === 'DATABASE_TRANSACTION_RELEASE_FAILED' && error.originalError === businessError &&
  error.releaseError === releaseFailure && error.rollbackError === undefined)
assert.equal(operationAndReleaseConnection.calls.filter(value => value === 'release').length, 1)
assert.equal(operationAndReleaseConnection.calls.includes('destroy'), true)

const releaseDestroyFailure = new Error('release destroy failed')
const releaseAndDestroyConnection = connectionFixture({
  async release() { releaseAndDestroyConnection.calls.push('release'); throw releaseFailure },
  async destroy() { releaseAndDestroyConnection.calls.push('destroy'); throw releaseDestroyFailure }
})
await assert.rejects(() => withDatabasePoolTransaction({
  async getConnection() { return releaseAndDestroyConnection }
}, async () => 'must-not-return'), error =>
  error.code === 'DATABASE_TRANSACTION_RELEASE_FAILED' && error.releaseError === releaseFailure &&
  error.destroyError === releaseDestroyFailure && error.originalError === undefined)
await assert.rejects(() => withDatabaseTransaction(releaseAndDestroyConnection, async () => {}),
  error => error.code === 'DATABASE_TRANSACTION_CONNECTION_UNUSABLE')
assert.equal(releaseAndDestroyConnection.calls.filter(value => value === 'release').length, 1)

console.log('shared database transaction context tests passed')
