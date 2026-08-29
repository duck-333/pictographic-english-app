import assert from 'node:assert/strict'

import {
  createIsolatedDatabaseCleanupSteps,
  runWithGuaranteedCleanup
} from './test-virtual-payment-mysql-integration.mjs'

const PASSWORD_SENTINEL = 'database-password-must-not-leak'

function cleanupSteps(calls, failures = {}) {
  const testConnection = {
    end: async () => {
      calls.push('testConnection.end')
      if (failures.close_test_connection) throw failures.close_test_connection
    }
  }
  const rootConnection = {
    query: async () => {
      calls.push('DROP DATABASE')
      if (failures.drop_test_database) throw failures.drop_test_database
    },
    execute: async () => {
      calls.push('assertDatabaseAbsent')
      if (failures.verify_database_absent) throw failures.verify_database_absent
      return [[]]
    },
    end: async () => {
      calls.push('rootConnection.end')
      if (failures.close_root_connection) throw failures.close_root_connection
    }
  }
  return createIsolatedDatabaseCleanupSteps({
    getTestConnection: () => testConnection,
    rootConnection,
    isDatabaseOwned: () => true,
    databaseName: 'virtual_payment_test_abcdef123456',
    config: {
      host: '127.0.0.1',
      port: 3308,
      confirmation: 'local-docker-virtual-payment-only'
    }
  })
}

async function captureFailure(action) {
  try {
    await action()
  } catch (error) {
    return error
  }
  assert.fail('expected operation to fail')
}

for (const failedPhase of [
  'close_test_connection',
  'drop_test_database',
  'verify_database_absent'
]) {
  const calls = []
  const error = await captureFailure(() => runWithGuaranteedCleanup({
    runMain: async () => undefined,
    cleanupSteps: cleanupSteps(calls, {
      [failedPhase]: new Error(`${failedPhase} failed`)
    })
  }))
  assert.equal(error.phase, failedPhase)
  assert.deepEqual(calls, [
    'testConnection.end',
    'DROP DATABASE',
    'assertDatabaseAbsent',
    'rootConnection.end'
  ])
}

const mainOnlyCalls = []
const mainOnlyError = await captureFailure(() => runWithGuaranteedCleanup({
  runMain: async () => {
    const error = new Error('migration execution failed')
    error.code = 'MIGRATION_FAILED'
    throw error
  },
  cleanupSteps: cleanupSteps(mainOnlyCalls)
}))
assert.equal(mainOnlyError.phase, 'main_test')
assert.equal(mainOnlyError.code, 'MIGRATION_FAILED')
assert.match(mainOnlyError.message, /migration execution failed/)
assert.equal(mainOnlyCalls.length, 4)

const cleanupOnlyError = await captureFailure(() => runWithGuaranteedCleanup({
  runMain: async () => 'main succeeded',
  cleanupSteps: cleanupSteps([], {
    drop_test_database: new Error('drop failed')
  })
}))
assert.equal(cleanupOnlyError.phase, 'drop_test_database')

const combinedError = await captureFailure(() => runWithGuaranteedCleanup({
  secretValues: [PASSWORD_SENTINEL],
  runMain: async () => {
    throw new Error(`main failed near ${PASSWORD_SENTINEL}`)
  },
  cleanupSteps: cleanupSteps([], {
    close_test_connection: new Error(`close failed near ${PASSWORD_SENTINEL}`),
    drop_test_database: new Error('drop failed independently')
  })
}))
assert(combinedError instanceof AggregateError)
assert.deepEqual(
  combinedError.errors.map((error) => error.phase),
  ['main_test', 'close_test_connection', 'drop_test_database']
)
const serializedCombinedError = JSON.stringify({
  message: combinedError.message,
  errors: combinedError.errors.map((error) => ({
    message: error.message,
    code: error.code,
    phase: error.phase
  }))
})
assert(!serializedCombinedError.includes(PASSWORD_SENTINEL))
assert.match(serializedCombinedError, /\[REDACTED\]/)

console.log('virtual payment MySQL cleanup control-flow tests passed')
