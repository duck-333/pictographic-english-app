import assert from 'node:assert/strict'

import { cleanupInvitationMysqlTest, throwInvitationMysqlTestErrors } from './invitation-mysql-cleanup.mjs'

function fixtures(failures = {}) {
  const calls = []
  return {
    calls,
    pool: { async end() { calls.push('pool.end'); if (failures.pool) throw failures.pool } },
    root: {
      async query() { calls.push('drop'); if (failures.drop) throw failures.drop },
      async execute() { calls.push('residual'); if (failures.residual) throw failures.residual; return [[], []] },
      async end() { calls.push('root.end'); if (failures.root) throw failures.root }
    }
  }
}

const poolFailure = new Error('pool end failed')
const first = fixtures({ pool: poolFailure })
const firstErrors = await cleanupInvitationMysqlTest({ ...first, owned: true, databaseName: 'invitation_test_123456789abc', quoteDatabase: value => value })
assert.deepEqual(first.calls, ['pool.end', 'drop', 'residual', 'root.end'])
assert.equal(firstErrors[0].error, poolFailure)

const dropFailure = new Error('drop failed')
const second = fixtures({ drop: dropFailure })
const secondErrors = await cleanupInvitationMysqlTest({ ...second, owned: true, databaseName: 'invitation_test_123456789abc', quoteDatabase: value => value })
assert.deepEqual(second.calls, ['pool.end', 'drop', 'residual', 'root.end'])
assert.equal(secondErrors.some(item => item.error === dropFailure), true)

const bodyFailure = new Error('test body failed')
let combined
assert.throws(() => throwInvitationMysqlTestErrors(bodyFailure, firstErrors), error => {
  combined = error; return error.code === 'INVITATION_MYSQL_TEST_CLEANUP_FAILED'
})
assert.equal(combined.originalError, bodyFailure)
assert.equal(combined.cleanupErrors[0].error, poolFailure)
assert.equal(combined.errors.includes(bodyFailure), true)
assert.equal(combined.errors.includes(poolFailure), true)
assert.throws(() => throwInvitationMysqlTestErrors(null, secondErrors),
  error => error.code === 'INVITATION_MYSQL_TEST_CLEANUP_FAILED')

console.log('invitation MySQL cleanup best-effort tests passed')
