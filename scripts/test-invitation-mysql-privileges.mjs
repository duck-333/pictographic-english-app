import assert from 'node:assert/strict'

import { assertExactDatabaseGrants } from './invitation-mysql-privileges.mjs'

const database = 'invitation_test_123456789abc'
const resource = { name: 'invitation_r_123456789abc', host: '127.0.0.1' }
const quote = (value, host) => `'${value}'@'${host}'`
const runtime = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
const migration = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES'])
const leakPassword = 'row-shape-test-password-7f39'

function grantsColumn(currentResource) {
  return `Grants for ${currentResource.name}@${currentResource.host}`
}

function grantRow(currentResource, grant) {
  return { [grantsColumn(currentResource)]: grant }
}

function rootWith(grants, currentResource = resource) {
  return {
    queries: [],
    async query(sql) {
      this.queries.push(String(sql))
      const rows = typeof grants === 'function' ? grants() : grants
      return [Array.isArray(rows)
        ? rows.map(grant => typeof grant === 'string'
          ? grantRow(currentResource, grant)
          : grant)
        : rows, []]
    }
  }
}

const runtimeAccount = '`invitation_r_123456789abc`@`127.0.0.1`'
const migrationAccount = '`invitation_m_123456789abc`@`127.0.0.1`'
const runtimeUsage = `GRANT USAGE ON *.* TO ${runtimeAccount}`
const runtimeDatabaseGrant = `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO ${runtimeAccount}`
const runtimeDifferentOrder = `GRANT DELETE, SELECT, UPDATE, INSERT ON \`${database}\`.* TO ${runtimeAccount}`

const runtimeRoot = rootWith([runtimeUsage, runtimeDatabaseGrant])
const runtimeSummary = await assertExactDatabaseGrants(runtimeRoot, resource, database, runtime, quote)
assert.deepEqual(runtimeSummary, {
  grantCount: 2, usageCount: 1, databaseGrantCount: 1, privilegeCount: 4
})
assert.deepEqual(runtimeRoot.queries, [
  "SHOW GRANTS FOR 'invitation_r_123456789abc'@'127.0.0.1'"
])

await assertExactDatabaseGrants(rootWith([
  runtimeDifferentOrder,
  runtimeUsage
]), resource, database, runtime, quote)

await assertExactDatabaseGrants(rootWith([
  `GRANT USAGE ON *.* TO ${migrationAccount}`,
  `GRANT REFERENCES, UPDATE, SELECT, ALTER, DELETE, INDEX, INSERT, CREATE ON \`${database}\`.* TO ${migrationAccount}`
], { ...resource, name: 'invitation_m_123456789abc' }),
{ ...resource, name: 'invitation_m_123456789abc' }, database, migration, quote)

const escapedResource = { name: 'invitation_r_tick`name', host: '127.0.0.1' }
await assertExactDatabaseGrants(rootWith([
  'GRANT USAGE ON *.* TO `invitation_r_tick``name`@`127.0.0.1`',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON `invitation_test_tick``name`.* TO `invitation_r_tick``name`@`127.0.0.1`'
], escapedResource), escapedResource, 'invitation_test_tick`name', runtime, quote)

let accessorExecutionCount = 0
const throwingAccessorRow = {}
Object.defineProperty(throwingAccessorRow, grantsColumn(resource), {
  enumerable: true,
  get() {
    accessorExecutionCount += 1
    throw new Error(`${leakPassword} ${resource.name} ${runtimeDatabaseGrant}`)
  }
})
const ownKeysTrapRow = new Proxy({}, {
  ownKeys() {
    throw Object.assign(new Error(`${leakPassword} ${runtimeDatabaseGrant}`), {
      code: 'INVITATION_MYSQL_GRANTS_INVALID',
      category: 'DATABASE_MISMATCH',
      sql: `SHOW GRANTS FOR '${resource.name}'@'${resource.host}'`
    })
  }
})
const descriptorTrapRow = new Proxy({}, {
  ownKeys() { return [grantsColumn(resource)] },
  getOwnPropertyDescriptor() {
    throw new Error(`${leakPassword} ${database} ${runtimeDatabaseGrant}`)
  }
})
const inheritedRow = Object.create({ [grantsColumn(resource)]: runtimeUsage })

const negativeMatrix = [
  ['single-quoted fake output', [
    "GRANT USAGE ON *.* TO 'invitation_r_123456789abc'@'127.0.0.1'",
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO 'invitation_r_123456789abc'@'127.0.0.1'`
  ]],
  ['missing privilege', [runtimeUsage,
    `GRANT SELECT, INSERT, UPDATE ON \`${database}\`.* TO ${runtimeAccount}`]],
  ['extra privilege', [runtimeUsage,
    `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON \`${database}\`.* TO ${runtimeAccount}`]],
  ['duplicate privilege', [runtimeUsage,
    `GRANT SELECT, INSERT, SELECT, UPDATE, DELETE ON \`${database}\`.* TO ${runtimeAccount}`]],
  ['empty privilege item', [runtimeUsage,
    `GRANT SELECT, , INSERT, UPDATE, DELETE ON \`${database}\`.* TO ${runtimeAccount}`]],
  ['all privileges', [runtimeUsage,
    `GRANT ALL PRIVILEGES ON \`${database}\`.* TO ${runtimeAccount}`]],
  ['process global privilege', [runtimeUsage, runtimeDatabaseGrant,
    `GRANT PROCESS ON *.* TO ${runtimeAccount}`]],
  ['grant option', [runtimeUsage,
    `${runtimeDatabaseGrant} WITH GRANT OPTION`]],
  ['other schema', [runtimeUsage,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`other_database\`.* TO ${runtimeAccount}`]],
  ['extra schema', [runtimeUsage, runtimeDatabaseGrant,
    `GRANT SELECT ON \`other_database\`.* TO ${runtimeAccount}`]],
  ['global all privileges', [runtimeUsage, runtimeDatabaseGrant,
    `GRANT ALL PRIVILEGES ON *.* TO ${runtimeAccount}`]],
  ['table-level grant', [runtimeUsage,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.\`users\` TO ${runtimeAccount}`]],
  ['column-level grant', [runtimeUsage,
    `GRANT SELECT (id), INSERT, UPDATE, DELETE ON \`${database}\`.\`users\` TO ${runtimeAccount}`]],
  ['other user', [runtimeUsage,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO \`invitation_r_other000000\`@\`127.0.0.1\``]],
  ['other host', [runtimeUsage,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO \`invitation_r_123456789abc\`@\`localhost\``]],
  ['duplicate target grant', [runtimeUsage, runtimeDatabaseGrant, runtimeDatabaseGrant]],
  ['missing usage', [runtimeDatabaseGrant]],
  ['missing target database grant', [runtimeUsage]],
  ['role grant', [runtimeUsage, runtimeDatabaseGrant,
    `GRANT \`invitation_role\`@\`%\` TO ${runtimeAccount}`]],
  ['proxy grant', [runtimeUsage, runtimeDatabaseGrant,
    `GRANT PROXY ON ''@'' TO ${runtimeAccount}`]],
  ['dynamic global privilege', [runtimeUsage, runtimeDatabaseGrant,
    `GRANT BACKUP_ADMIN ON *.* TO ${runtimeAccount}`]],
  ['unrecognized suffix', [runtimeUsage,
    `${runtimeDatabaseGrant} REQUIRE SSL`]],
  ['trailing newline', [runtimeUsage, `${runtimeDatabaseGrant}\n`]],
  ['wrong column', [{ wrong_column: runtimeUsage }]],
  ['empty column', [{ '': runtimeUsage }]],
  ['column for other username', [{
    'Grants for invitation_r_other000000@127.0.0.1': runtimeUsage
  }]],
  ['column for other host', [{
    'Grants for invitation_r_123456789abc@localhost': runtimeUsage
  }]],
  ['column case mismatch', [{
    'grants for invitation_r_123456789abc@127.0.0.1': runtimeUsage
  }]],
  ['throwing accessor property', [throwingAccessorRow]],
  ['proxy ownKeys throws', [ownKeysTrapRow]],
  ['proxy descriptor throws', [descriptorTrapRow]],
  ['non-array rowset', { unexpected: true }],
  ['null row', [null]],
  ['array row', [[runtimeUsage]]],
  ['two-value row', [{ first: runtimeUsage, second: runtimeDatabaseGrant }]],
  ['zero-field row', [{}]],
  ['inherited-field row', [inheritedRow]],
  ['symbol-bearing row', [{
    [grantsColumn(resource)]: runtimeUsage,
    [Symbol('extra')]: runtimeDatabaseGrant
  }]],
  ['numeric grant value', [{ [grantsColumn(resource)]: 123 }]],
  ['empty grant value', [{ [grantsColumn(resource)]: '' }]]
]

const sensitiveValues = [
  leakPassword,
  resource.name,
  resource.host,
  database,
  runtimeDatabaseGrant,
  `SHOW GRANTS FOR '${resource.name}'@'${resource.host}'`
]

function serializedGraph(value, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return String(value)
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  const result = {}
  for (const key of Reflect.ownKeys(value)) {
    const label = typeof key === 'symbol' ? key.toString() : key
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      result[label] = '[accessor]'
      continue
    }
    result[label] = serializedGraph(descriptor.value, seen)
  }
  return JSON.stringify(result)
}

function assertSafeError(error, label) {
  assert.equal(error.code, 'INVITATION_MYSQL_GRANTS_INVALID', label)
  assert.equal(typeof error.category, 'string', label)
  assert.equal(error.cause, undefined, label)
  assert.deepEqual(Reflect.ownKeys(error).sort(),
    Reflect.ownKeys(error).includes('count')
      ? ['category', 'code', 'count', 'message', 'stack'].sort()
      : ['category', 'code', 'message', 'stack'].sort(), label)
  const surfaces = [
    error.message,
    error.stack,
    String(error),
    serializedGraph(error),
    JSON.stringify(error),
    JSON.stringify(error, Reflect.ownKeys(error).filter(key => typeof key === 'string'))
  ]
  const aggregate = new AggregateError([error], 'safe aggregate')
  assert.equal(aggregate.errors[0], error, label)
  surfaces.push(serializedGraph(aggregate))
  const cyclic = { error }
  cyclic.self = cyclic
  surfaces.push(serializedGraph(cyclic))
  for (const surface of surfaces) {
    for (const secret of sensitiveValues) assert.equal(String(surface).includes(secret), false, label)
  }
}

for (const [label, invalidRows] of negativeMatrix) {
  await assert.rejects(
    () => assertExactDatabaseGrants(rootWith(invalidRows), resource, database, runtime, quote),
    error => {
      assertSafeError(error, label)
      return true
    }
  )
}

const rawQueryError = Object.assign(new Error(`driver echoed ${runtimeDatabaseGrant}`), {
  sql: `SHOW GRANTS FOR '${resource.name}'@'${resource.host}'`,
  sqlMessage: runtimeDatabaseGrant
})
await assert.rejects(
  () => assertExactDatabaseGrants({ async query() { throw rawQueryError } },
    resource, database, runtime, quote),
  error => {
    assertSafeError(error, 'query error')
    assert.equal(error.category, 'QUERY_FAILED')
    return true
  }
)

assert.equal(accessorExecutionCount, 0)

console.log(`invitation MySQL 8.0.46 SHOW GRANTS parser tests passed; ${negativeMatrix.length} fail-closed fixtures`)
