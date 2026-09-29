import assert from 'node:assert/strict'

import { cleanupInvitationMysqlTest } from './invitation-mysql-cleanup.mjs'
import { resolveInvitationMysqlClientHost } from './invitation-mysql-client-host.mjs'
import {
  createInvitationMysqlTestUserResources,
  provisionInvitationMysqlTestUsers
} from './invitation-mysql-test-users.mjs'

const observedHost = '172.17.0.1'
const databaseName = 'invitation_test_123456789abc'
const migrationUserName = 'invitation_m_123456789abc'
const runtimeUserName = 'invitation_r_123456789abc'
const calls = []
const existingUsers = new Set()

function account(name, host) {
  assert.equal(host, observedHost)
  return `'${name}'@'${host}'`
}

function grantRows(name, privileges) {
  const key = `Grants for ${name}@${observedHost}`
  return [
    { [key]: `GRANT USAGE ON *.* TO \`${name}\`@\`${observedHost}\`` },
    { [key]: `GRANT ${privileges} ON \`${databaseName}\`.* TO \`${name}\`@\`${observedHost}\`` }
  ]
}

const root = {
  async execute(sql, values = []) {
    const text = String(sql)
    calls.push({ method: 'execute', sql: text, values: [...values] })
    if (text.includes('SUBSTRING_INDEX(USER()')) return [[{ clientHost: observedHost }], []]
    if (text.includes('FROM mysql.user')) {
      assert.deepEqual(values.slice(1), [observedHost])
      return [[{ resource_count: existingUsers.has(values[0]) ? '1' : '0' }], []]
    }
    if (text.startsWith('SELECT CAST(1')) return [[{ mysql_healthy: '1' }], []]
    throw new Error('Unexpected execute in exact-host wiring fixture.')
  },
  async query(sql, values = []) {
    const text = String(sql)
    calls.push({ method: 'query', sql: text, values: [...values] })
    if (text.startsWith('CREATE USER')) {
      const name = text.includes(migrationUserName) ? migrationUserName : runtimeUserName
      assert(text.includes(`'${name}'@'${observedHost}'`))
      existingUsers.add(name)
      return [{ affectedRows: 0 }, []]
    }
    if (text.startsWith('GRANT ')) {
      assert(text.includes(`@'${observedHost}'`))
      return [[], []]
    }
    if (text.startsWith('SHOW GRANTS FOR')) {
      assert(text.includes(`@'${observedHost}'`))
      return text.includes(migrationUserName)
        ? [grantRows(migrationUserName,
          'SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES'), []]
        : [grantRows(runtimeUserName, 'SELECT, INSERT, UPDATE, DELETE'), []]
    }
    if (text.startsWith('DROP USER')) {
      const name = text.includes(migrationUserName) ? migrationUserName : runtimeUserName
      assert(text.includes(`'${name}'@'${observedHost}'`))
      existingUsers.delete(name)
      return [[], []]
    }
    throw new Error('Unexpected query in exact-host wiring fixture.')
  },
  async end() { calls.push({ method: 'end' }) }
}

const clientHost = await resolveInvitationMysqlClientHost(root)
const resources = createInvitationMysqlTestUserResources({
  clientHost,
  migrationUserName,
  runtimeUserName
})
assert.equal(resources.migrationUserResource.host, observedHost)
assert.equal(resources.runtimeUserResource.host, observedHost)
await provisionInvitationMysqlTestUsers({
  root,
  databaseName,
  ...resources,
  migrationUserPassword: 'migration-test-password',
  runtimeUserPassword: 'runtime-test-password',
  quoteDatabase: value => `\`${value}\``,
  quoteTestAccount: account
})
assert.deepEqual([...existingUsers].sort(), [migrationUserName, runtimeUserName].sort())

const cleanupErrors = await cleanupInvitationMysqlTest({
  pools: [],
  root,
  databaseResource: null,
  userResources: [resources.migrationUserResource, resources.runtimeUserResource],
  quoteDatabase: value => `\`${value}\``,
  quoteTestAccount: account
})
assert.deepEqual(cleanupErrors, [])
assert.deepEqual([...existingUsers], [])

const createCalls = calls.filter(call => call.method === 'query' && call.sql.startsWith('CREATE USER'))
const grantCalls = calls.filter(call => call.method === 'query' && call.sql.startsWith('GRANT '))
const showCalls = calls.filter(call => call.method === 'query' && call.sql.startsWith('SHOW GRANTS'))
const dropCalls = calls.filter(call => call.method === 'query' && call.sql.startsWith('DROP USER'))
const residualCalls = calls.filter(call => call.method === 'execute' && call.sql.includes('FROM mysql.user'))
assert.deepEqual([createCalls.length, grantCalls.length, showCalls.length, dropCalls.length], [2, 2, 2, 2])
assert.equal(residualCalls.length, 4)
assert(calls.filter(call => call.sql).every(call => !call.sql.includes("@'127.0.0.1'")))
assert(calls.filter(call => call.sql && /(?:CREATE USER|GRANT |SHOW GRANTS|DROP USER)/u.test(call.sql))
  .every(call => call.sql.includes(observedHost)))
assert(residualCalls.every(call => call.values[1] === observedHost))
assert.equal(calls.filter(call => call.method === 'end').length, 1)

console.log('invitation MySQL exact observed-host account wiring tests passed')
