import assert from 'node:assert/strict'

import {
  cleanupInvitationMysqlTest,
  MYSQL_RESOURCE_STATES,
  throwInvitationMysqlTestErrors
} from './invitation-mysql-cleanup.mjs'
import {
  createDatabaseResource,
  createMysqlResource,
  createUserResource
} from './invitation-mysql-resource-lifecycle.mjs'

function rootFixture(options = {}) {
  const calls = []
  let userCountReads = 0
  return {
    calls,
    async execute(sql, values = []) {
      const text = String(sql)
      if (text.startsWith('CREATE USER')) {
        calls.push({ method: 'execute', sql: text, values: [...values] })
        throw Object.assign(new Error('Prepared CREATE USER must not be used.'), {
          code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000'
        })
      }
      calls.push({ method: 'execute', sql: text, values: [...values] })
      userCountReads += 1
      const exists = options.exists || (options.existsAfterCreateError && userCountReads > 1)
      return [[{ resource_count: exists ? '1' : '0' }], []]
    },
    async query(sql, values = []) {
      const text = String(sql)
      calls.push({ method: 'query', sql: text, values: [...values] })
      if (text.startsWith('CREATE USER')) {
        if (options.createUserError) throw options.createUserError
        return [{ affectedRows: 0 }, []]
      }
      if (text.startsWith('CREATE DATABASE')) {
        if (options.createDatabaseError) throw options.createDatabaseError
        return [[], []]
      }
      throw new Error(`Unexpected query: ${text}`)
    }
  }
}

function serializedErrorGraph(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  const result = {}
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue
    let child
    try { child = value[key] } catch { child = '[unreadable]' }
    result[key] = serializedErrorGraph(child, seen)
  }
  return JSON.stringify(result)
}

function assertSecretAbsent(value, secret) {
  assert.equal(String(value).includes(secret), false)
}

const createdDatabase = createMysqlResource('invitation_test_123456789abc')
await createDatabaseResource(rootFixture(), createdDatabase, { quoteDatabase: value => `\`${value}\`` })
assert.equal(createdDatabase.state, MYSQL_RESOURCE_STATES.CREATED)
assert.equal(createdDatabase.preflightAbsent, true)

const uncertainError = new Error('connection lost')
const uncertainDatabase = createMysqlResource('invitation_test_123456789abd')
await assert.rejects(() => createDatabaseResource(rootFixture({ createDatabaseError: uncertainError }),
  uncertainDatabase, { quoteDatabase: value => `\`${value}\`` }), error => error === uncertainError)
assert.equal(uncertainDatabase.state, MYSQL_RESOURCE_STATES.UNCERTAIN)

const databaseCollision = createMysqlResource('invitation_test_123456789abe')
await assert.rejects(() => createDatabaseResource(rootFixture({ exists: true }), databaseCollision,
  { quoteDatabase: value => value }), error => error.code === 'INVITATION_MYSQL_RESOURCE_NAME_COLLISION')
assert.equal(databaseCollision.state, MYSQL_RESOURCE_STATES.COLLISION)

const createdUser = createMysqlResource('invitation_r_123456789abc', {
  host: '127.0.0.1', label: 'runtime user'
})
const preparedProtocolMustFail = rootFixture()
const createPassword = 'v7-create-user-secret-28f4'
await createUserResource(preparedProtocolMustFail, createdUser, createPassword, {
  quoteTestAccount: (value, host) => `'${value}'@'${host}'`
})
assert.equal(createdUser.state, MYSQL_RESOURCE_STATES.CREATED)
const createUserQuery = preparedProtocolMustFail.calls.find(call => call.method === 'query' &&
  call.sql.startsWith('CREATE USER'))
assert.ok(createUserQuery)
assert.equal(preparedProtocolMustFail.calls.some(call => call.method === 'execute' &&
  call.sql.startsWith('CREATE USER')), false)
assert.equal(createUserQuery.sql,
  "CREATE USER 'invitation_r_123456789abc'@'127.0.0.1' IDENTIFIED BY ?")
assert.equal((createUserQuery.sql.match(/\?/gu) || []).length, 1)
assertSecretAbsent(createUserQuery.sql, createPassword)
assert.deepEqual(createUserQuery.values, [createPassword])

const createdMigrationUser = createMysqlResource('invitation_m_123456789abc', {
  host: '127.0.0.1', label: 'migration user'
})
const migrationUserRoot = rootFixture()
await createUserResource(migrationUserRoot, createdMigrationUser, createPassword, {
  quoteTestAccount: (value, host) => `'${value}'@'${host}'`
})
assert.equal(createdMigrationUser.state, MYSQL_RESOURCE_STATES.CREATED)
assert.equal(migrationUserRoot.calls.filter(call => call.method === 'query' &&
  call.sql.startsWith('CREATE USER')).length, 1)
assert.equal(migrationUserRoot.calls.some(call => call.method === 'execute' &&
  call.sql.startsWith('CREATE USER')), false)

const userCollisionError = Object.assign(new Error('collision'), { code: 'ER_CANNOT_USER' })
const racedUser = createMysqlResource('invitation_r_123456789abd', {
  host: '127.0.0.1', label: 'runtime user'
})
await assert.rejects(() => createUserResource(rootFixture({
  createUserError: userCollisionError,
  existsAfterCreateError: true
}),
  racedUser, createPassword, { quoteTestAccount: value => value }), error => {
  assert.notEqual(error, userCollisionError)
  return error.code === 'ER_CANNOT_USER' &&
    error.internalCode === 'INVITATION_MYSQL_CREATE_USER_FAILED' && error.cause === undefined
})
assert.equal(racedUser.state, MYSQL_RESOURCE_STATES.COLLISION)

const uncertainUser = createMysqlResource('invitation_r_123456789abe', {
  host: '127.0.0.1', label: 'runtime user'
})
await assert.rejects(() => createUserResource(rootFixture({ createUserError: userCollisionError }),
  uncertainUser, createPassword, { quoteTestAccount: value => value }), error => {
  assert.notEqual(error, userCollisionError)
  return error.code === 'ER_CANNOT_USER' && error.internalCode === 'INVITATION_MYSQL_CREATE_USER_FAILED'
})
assert.equal(uncertainUser.state, MYSQL_RESOURCE_STATES.UNCERTAIN)

const leakedPassword = 'v7-error-secret-4e91'
const leakingDriverError = Object.assign(new Error(`driver exposed ${leakedPassword}`), {
  code: 'ER_PARSE_ERROR',
  errno: 1064,
  sqlState: '42000',
  sql: `CREATE USER 'invitation_r_deadbeef0001'@'127.0.0.1' IDENTIFIED BY '${leakedPassword}'`,
  sqlMessage: `syntax near '${leakedPassword}'`,
  cause: new Error(`nested ${leakedPassword}`)
})
const sanitizedUser = createMysqlResource('invitation_r_deadbeef0001', {
  host: '127.0.0.1', label: 'runtime user'
})
let sanitizedCreateError
try {
  await createUserResource(rootFixture({ createUserError: leakingDriverError }), sanitizedUser,
    leakedPassword, { quoteTestAccount: (value, host) => `'${value}'@'${host}'` })
} catch (error) {
  sanitizedCreateError = error
}
assert.ok(sanitizedCreateError)
assert.equal(sanitizedCreateError.code, 'ER_PARSE_ERROR')
assert.equal(sanitizedCreateError.errno, 1064)
assert.equal(sanitizedCreateError.sqlState, '42000')
assert.equal(sanitizedCreateError.internalCode, 'INVITATION_MYSQL_CREATE_USER_FAILED')
assert.equal(sanitizedCreateError.sql, undefined)
assert.equal(sanitizedCreateError.sqlMessage, undefined)
assert.equal(sanitizedCreateError.cause, undefined)
assertSecretAbsent(String(sanitizedCreateError), leakedPassword)
assertSecretAbsent(sanitizedCreateError.stack, leakedPassword)
assertSecretAbsent(JSON.stringify(sanitizedCreateError,
  Object.getOwnPropertyNames(sanitizedCreateError)), leakedPassword)
assertSecretAbsent(serializedErrorGraph(sanitizedCreateError), leakedPassword)
let sanitizedAggregate
assert.throws(() => throwInvitationMysqlTestErrors(sanitizedCreateError, [{
  stage: 'synthetic cleanup', error: new Error('safe cleanup failure')
}]), error => {
  sanitizedAggregate = error
  return error.code === 'INVITATION_MYSQL_TEST_CLEANUP_FAILED'
})
assertSecretAbsent(String(sanitizedAggregate), leakedPassword)
assertSecretAbsent(sanitizedAggregate.stack, leakedPassword)
assertSecretAbsent(serializedErrorGraph(sanitizedAggregate), leakedPassword)

function ambiguousCreateFixture(kind, resource, options = {}) {
  const calls = []
  let exists = false
  let rootEndCount = 0
  const lostConfirmation = Object.assign(new Error(`${kind} create confirmation lost`), { code: 'ECONNRESET' })
  const root = {
    async execute(sql) {
      const text = String(sql)
      if (text.startsWith('CREATE USER')) {
        throw Object.assign(new Error('Prepared CREATE USER must not be used.'), {
          code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000'
        })
      }
      if (text.includes('INFORMATION_SCHEMA.SCHEMATA')) {
        calls.push(exists ? 'database count=1' : calls.length === 0 ? 'database preflight=0' : 'database count=0')
        return [[{ resource_count: exists ? '1' : '0' }], []]
      }
      if (text.includes('mysql.user')) {
        calls.push(exists ? `${kind} count=1` : calls.length === 0 ? `${kind} preflight=0` : `${kind} count=0`)
        return [[{ resource_count: exists ? '1' : '0' }], []]
      }
      if (text.startsWith('SELECT CAST(1')) {
        calls.push('mysql health check')
        if (options.healthError) throw options.healthError
        return [[{ mysql_healthy: '1' }], []]
      }
      throw new Error(`Unexpected execute: ${text}`)
    },
    async query(sql) {
      const text = String(sql)
      if (text.startsWith('CREATE DATABASE')) {
        calls.push(`create ${kind}`)
        exists = true
        throw lostConfirmation
      }
      if (text.startsWith('CREATE USER')) {
        calls.push(`create ${kind}`)
        exists = true
        throw lostConfirmation
      }
      if (text.startsWith('DROP DATABASE')) {
        calls.push('drop database')
        exists = false
        return [[], []]
      }
      if (text.startsWith('DROP USER')) {
        calls.push(`drop ${kind}`)
        exists = false
        return [[], []]
      }
      throw new Error(`Unexpected query: ${text}`)
    },
    async end() {
      calls.push('root.end')
      rootEndCount += 1
    }
  }
  return { calls, root, lostConfirmation, get rootEndCount() { return rootEndCount } }
}

for (const scenario of [
  {
    kind: 'database',
    resource: createMysqlResource('invitation_test_abcdef123456'),
    expectedCalls: ['database preflight=0', 'create database', 'database count=1', 'drop database',
      'database count=0', 'mysql health check', 'root.end']
  },
  {
    kind: 'migration user',
    resource: createMysqlResource('invitation_m_abcdef123456', {
      host: '127.0.0.1', label: 'migration user'
    }),
    expectedCalls: ['migration user preflight=0', 'create migration user', 'migration user count=1',
      'drop migration user', 'migration user count=0', 'mysql health check', 'root.end']
  },
  {
    kind: 'runtime user',
    resource: createMysqlResource('invitation_r_abcdef123456', {
      host: '127.0.0.1', label: 'runtime user'
    }),
    healthError: new Error('health check failed after cleanup'),
    expectedCalls: ['runtime user preflight=0', 'create runtime user', 'runtime user count=1',
      'drop runtime user', 'runtime user count=0', 'mysql health check', 'root.end']
  }
]) {
  const current = ambiguousCreateFixture(scenario.kind, scenario.resource, {
    healthError: scenario.healthError
  })
  let createError = null
  try {
    if (scenario.kind === 'database') {
      await createDatabaseResource(current.root, scenario.resource, {
        quoteDatabase: value => `\`${value}\``
      })
    } else {
      await createUserResource(current.root, scenario.resource, 'safe-password', {
        quoteTestAccount: value => `'${value}'@'127.0.0.1'`
      })
    }
  } catch (error) {
    createError = error
  }
  if (scenario.kind === 'database') {
    assert.equal(createError, current.lostConfirmation)
  } else {
    assert.notEqual(createError, current.lostConfirmation)
    assert.equal(createError.internalCode, 'INVITATION_MYSQL_CREATE_USER_FAILED')
    assert.equal(createError.cause, undefined)
  }
  assert.equal(createError.code, 'ECONNRESET')
  assert.equal(scenario.resource.state, MYSQL_RESOURCE_STATES.UNCERTAIN)
  const cleanupErrors = await cleanupInvitationMysqlTest({
    pools: [],
    root: current.root,
    databaseResource: scenario.kind === 'database' ? scenario.resource : null,
    userResources: scenario.kind === 'database' ? [] : [scenario.resource],
    quoteDatabase: value => `\`${value}\``,
    quoteTestAccount: value => `'${value}'@'127.0.0.1'`
  })
  assert.deepEqual(current.calls, scenario.expectedCalls)
  assert.equal(current.rootEndCount, 1)
  if (scenario.healthError) {
    let combined
    assert.throws(() => throwInvitationMysqlTestErrors(createError, cleanupErrors), error => {
      combined = error
      return error.code === 'INVITATION_MYSQL_TEST_CLEANUP_FAILED'
    })
    assert.equal(combined.originalError, createError)
    assert.equal(combined.cleanupErrors.length, 1)
    assert.equal(combined.cleanupErrors[0].error, scenario.healthError)
    assert.deepEqual(combined.errors, [createError, scenario.healthError])
  } else {
    assert.deepEqual(cleanupErrors, [])
    assert.throws(() => throwInvitationMysqlTestErrors(createError, cleanupErrors), error => error === createError)
  }
}

console.log('invitation MySQL resource lifecycle tests passed')
