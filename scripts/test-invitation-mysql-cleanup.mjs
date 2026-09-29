import assert from 'node:assert/strict'

import {
  cleanupInvitationMysqlTest,
  MYSQL_RESOURCE_STATES,
  throwInvitationMysqlTestErrors
} from './invitation-mysql-cleanup.mjs'

const databaseName = 'invitation_test_123456789abc'
const migrationUser = 'invitation_m_123456789abc'
const runtimeUser = 'invitation_r_123456789abc'

function resource(name, label, state = MYSQL_RESOURCE_STATES.CREATED) {
  return { name, label, host: '127.0.0.1', state, preflightAbsent: true }
}

function fixture(failureStages = [], options = {}) {
  const failures = new Set(failureStages)
  const calls = []
  const probes = new Map()
  const fail = stage => {
    calls.push(stage)
    if (failures.has(stage)) throw new Error(`${stage} failed`)
  }
  const pools = [
    { stage: 'runtime pool.end', pool: { async end() { fail('runtime pool.end') } } },
    { stage: 'migration pool.end', pool: { async end() { fail('migration pool.end') } } }
  ]
  const users = options.userResources || [
    resource(migrationUser, 'migration user'),
    resource(runtimeUser, 'runtime user')
  ]
  const databaseResource = options.databaseResource || {
    name: databaseName,
    state: MYSQL_RESOURCE_STATES.CREATED,
    preflightAbsent: true
  }
  const root = {
    async query(sql) {
      const text = String(sql)
      if (text.startsWith('DROP DATABASE')) fail('drop database')
      else if (text.includes(migrationUser)) fail('drop migration user')
      else if (text.includes(runtimeUser)) fail('drop runtime user')
      else throw new Error('Unexpected cleanup query.')
    },
    async execute(sql, params = []) {
      const text = String(sql)
      if (text.includes('INFORMATION_SCHEMA.SCHEMATA')) {
        const seen = probes.get('database') || 0
        probes.set('database', seen + 1)
        const stage = databaseResource.state === MYSQL_RESOURCE_STATES.UNCERTAIN && seen === 0
          ? 'database uncertain check' : 'database residual check'
        fail(stage)
        return [[{ resource_count: '0' }], []]
      }
      if (text.includes('mysql.user')) {
        const name = params[0]
        const entry = users.find(item => item.name === name)
        const seen = probes.get(name) || 0
        probes.set(name, seen + 1)
        const stage = entry.state === MYSQL_RESOURCE_STATES.UNCERTAIN && seen === 0
          ? `${entry.label} uncertain check` : `${entry.label} residual check`
        fail(stage)
        return [[{ resource_count: '0' }], []]
      }
      if (text.startsWith('SELECT CAST(1')) {
        fail('mysql health check')
        return [[{ mysql_healthy: '1' }], []]
      }
      throw new Error('Unexpected cleanup execute.')
    },
    async end() { fail('root.end') }
  }
  return {
    calls,
    cleanupOptions: {
      pools,
      root,
      databaseResource,
      userResources: users,
      quoteDatabase: value => `\`${value}\``,
      quoteTestAccount: value => `'${value}'@'127.0.0.1'`
    }
  }
}

const cleanupStages = [
  'runtime pool.end',
  'migration pool.end',
  'drop database',
  'database residual check',
  'drop migration user',
  'migration user residual check',
  'drop runtime user',
  'runtime user residual check',
  'mysql health check',
  'root.end'
]

for (const stage of cleanupStages) {
  const current = fixture([stage])
  const errors = await cleanupInvitationMysqlTest(current.cleanupOptions)
  assert(errors.some(item => item.stage === stage), stage)
  assert.equal(current.calls.filter(item => item === 'root.end').length, 1)
  assert(current.calls.includes('mysql health check') || stage === 'mysql health check')
}

for (const { stage, options } of [
  {
    stage: 'database uncertain check',
    options: { databaseResource: { name: databaseName, state: MYSQL_RESOURCE_STATES.UNCERTAIN, preflightAbsent: true } }
  },
  {
    stage: 'migration user uncertain check',
    options: { userResources: [
      resource(migrationUser, 'migration user', MYSQL_RESOURCE_STATES.UNCERTAIN),
      resource(runtimeUser, 'runtime user')
    ] }
  },
  {
    stage: 'runtime user uncertain check',
    options: { userResources: [
      resource(migrationUser, 'migration user'),
      resource(runtimeUser, 'runtime user', MYSQL_RESOURCE_STATES.UNCERTAIN)
    ] }
  }
]) {
  const current = fixture([stage], options)
  const errors = await cleanupInvitationMysqlTest(current.cleanupOptions)
  assert(errors.some(item => item.stage === stage), stage)
  assert(current.calls.includes('mysql health check'))
  assert.equal(current.calls.filter(item => item === 'root.end').length, 1)
}

const uncertain = fixture([], {
  databaseResource: {
    name: databaseName,
    state: MYSQL_RESOURCE_STATES.UNCERTAIN,
    preflightAbsent: true
  },
  userResources: [
    resource(migrationUser, 'migration user', MYSQL_RESOURCE_STATES.UNCERTAIN),
    resource(runtimeUser, 'runtime user', MYSQL_RESOURCE_STATES.UNCERTAIN)
  ]
})
assert.deepEqual(await cleanupInvitationMysqlTest(uncertain.cleanupOptions), [])
for (const stage of ['database uncertain check', 'migration user uncertain check', 'runtime user uncertain check']) {
  assert(uncertain.calls.includes(stage))
}

const collisions = fixture([], {
  databaseResource: {
    name: databaseName,
    state: MYSQL_RESOURCE_STATES.COLLISION,
    preflightAbsent: false
  },
  userResources: [
    resource(migrationUser, 'migration user', MYSQL_RESOURCE_STATES.COLLISION),
    resource(runtimeUser, 'runtime user', MYSQL_RESOURCE_STATES.NOT_ATTEMPTED)
  ]
})
assert.deepEqual(await cleanupInvitationMysqlTest(collisions.cleanupOptions), [])
assert.equal(collisions.calls.some(stage => stage.startsWith('drop ')), false)
assert.equal(collisions.calls.filter(stage => stage === 'root.end').length, 1)

const multipleStages = ['runtime pool.end', 'drop database', 'migration user residual check', 'mysql health check']
const multiple = fixture(multipleStages)
const multipleErrors = await cleanupInvitationMysqlTest(multiple.cleanupOptions)
assert.deepEqual(multipleErrors.map(item => item.stage), multipleStages)
assert(multiple.calls.includes('drop runtime user'))
assert.equal(multiple.calls.filter(stage => stage === 'root.end').length, 1)

const bodyFailure = new Error('test body failed')
let combined
assert.throws(() => throwInvitationMysqlTestErrors(bodyFailure, multipleErrors), error => {
  combined = error
  return error.code === 'INVITATION_MYSQL_TEST_CLEANUP_FAILED'
})
assert.equal(combined.originalError, bodyFailure)
assert.equal(combined.cleanupErrors.length, multipleStages.length)
assert.equal(combined.errors[0], bodyFailure)
for (const item of multipleErrors) assert(combined.errors.includes(item.error))

console.log('invitation MySQL cleanup state-machine and failure-matrix tests passed')
