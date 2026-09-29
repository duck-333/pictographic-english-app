import assert from 'node:assert/strict'

import { resolveInvitationMysqlClientHost } from './invitation-mysql-client-host.mjs'

const query = "SELECT SUBSTRING_INDEX(USER(), '@', -1) AS clientHost"
const secret = 'client-host-test-password-90af'

function rootWith(rows) {
  return {
    calls: [],
    async execute(sql) {
      this.calls.push(String(sql))
      return [typeof rows === 'function' ? rows() : rows, []]
    }
  }
}

for (const value of [
  '127.0.0.1',
  '127.255.255.254',
  '172.17.0.1',
  '172.16.0.1',
  '172.31.255.254',
  '10.0.0.1',
  '10.255.255.254',
  '192.168.0.1',
  '192.168.255.254'
]) {
  const root = rootWith([{ clientHost: value }])
  assert.equal(await resolveInvitationMysqlClientHost(root), value)
  assert.deepEqual(root.calls, [query])
}

let getterExecutionCount = 0
const accessorRow = {}
Object.defineProperty(accessorRow, 'clientHost', {
  enumerable: true,
  get() {
    getterExecutionCount += 1
    throw new Error(`${secret} SELECT USER() 172.17.0.1`)
  }
})
const ownKeysProxy = new Proxy({}, {
  ownKeys() {
    throw Object.assign(new Error(`${secret} SELECT USER()`), {
      code: 'INVITATION_MYSQL_CLIENT_HOST_INVALID',
      category: 'CLIENT_HOST_NOT_ALLOWED'
    })
  }
})
const descriptorProxy = new Proxy({}, {
  ownKeys() { return ['clientHost'] },
  getOwnPropertyDescriptor() { throw new Error(`${secret} 172.17.0.1`) }
})

const invalidFixtures = [
  ['wildcard', [{ clientHost: '%' }]],
  ['localhost', [{ clientHost: 'localhost' }]],
  ['public IPv4', [{ clientHost: '8.8.8.8' }]],
  ['public 172 range low', [{ clientHost: '172.15.0.1' }]],
  ['public 172 range high', [{ clientHost: '172.32.0.1' }]],
  ['IPv6 loopback', [{ clientHost: '::1' }]],
  ['empty', [{ clientHost: '' }]],
  ['whitespace', [{ clientHost: ' 172.17.0.1 ' }]],
  ['control character', [{ clientHost: '172.17.0.1\n' }]],
  ['noncanonical IPv4', [{ clientHost: '172.017.0.1' }]],
  ['null value', [{ clientHost: null }]],
  ['object value', [{ clientHost: { value: '172.17.0.1' } }]],
  ['number value', [{ clientHost: 1721701 }]],
  ['zero rows', []],
  ['multiple rows', [{ clientHost: '172.17.0.1' }, { clientHost: '172.17.0.2' }]],
  ['null row', [null]],
  ['array row', [['172.17.0.1']]],
  ['wrong field', [{ host: '172.17.0.1' }]],
  ['extra field', [{ clientHost: '172.17.0.1', extra: true }]],
  ['symbol field', [{ clientHost: '172.17.0.1', [Symbol('extra')]: true }]],
  ['accessor', [accessorRow]],
  ['ownKeys proxy', [ownKeysProxy]],
  ['descriptor proxy', [descriptorProxy]],
  ['non-array rows', { clientHost: '172.17.0.1' }]
]

function errorGraph(value, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return String(value)
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  const output = {}
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    const label = typeof key === 'symbol' ? key.toString() : key
    output[label] = descriptor && Object.hasOwn(descriptor, 'value')
      ? errorGraph(descriptor.value, seen)
      : '[accessor]'
  }
  return JSON.stringify(output)
}

function assertSafe(error, label) {
  assert.equal(error.code, 'INVITATION_MYSQL_CLIENT_HOST_INVALID', label)
  assert.equal(typeof error.category, 'string', label)
  assert.equal(error.cause, undefined, label)
  const surfaces = [String(error), error.stack, JSON.stringify(error), errorGraph(error)]
  const cyclic = { error }
  cyclic.self = cyclic
  surfaces.push(errorGraph(cyclic), errorGraph(new AggregateError([error], 'safe aggregate')))
  for (const surface of surfaces) {
    for (const sensitive of [secret, 'SELECT USER()', '172.17.0.1']) {
      assert.equal(String(surface).includes(sensitive), false, label)
    }
  }
}

for (const [label, rows] of invalidFixtures) {
  await assert.rejects(() => resolveInvitationMysqlClientHost(rootWith(rows)), error => {
    assertSafe(error, label)
    return true
  })
}

const queryFailure = Object.assign(new Error(`${secret} SELECT USER() 172.17.0.1`), {
  sql: query,
  sqlMessage: `${secret} 172.17.0.1`
})
await assert.rejects(() => resolveInvitationMysqlClientHost({
  async execute() { throw queryFailure }
}), error => {
  assertSafe(error, 'query failure')
  assert.equal(error.category, 'QUERY_FAILED')
  return true
})

assert.equal(getterExecutionCount, 0)
console.log(`invitation MySQL client host tests passed; ${invalidFixtures.length} fail-closed fixtures`)
