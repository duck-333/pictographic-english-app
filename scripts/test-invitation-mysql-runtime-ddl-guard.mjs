import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  assertRuntimeDdlDeniedAndAbsent,
  assertRuntimeDdlPermissionDenied,
  quoteRuntimeDdlProbeTable
} from './invitation-mysql-runtime-ddl-guard.mjs'

const tableName = 'invitation_runtime_ddl_123456abcdef'
const denied = Object.assign(new Error('CREATE command denied'), {
  code: 'ER_TABLEACCESS_DENIED_ERROR',
  errno: 1142,
  sqlState: '42000'
})
assert.equal(quoteRuntimeDdlProbeTable(tableName), `\`${tableName}\``)
assert.equal(assertRuntimeDdlPermissionDenied(denied), denied)
for (const name of ['', 'invitation_runtime_ddl_123', 'invitation_runtime_ddl_123456ABCDE',
  'invitation_runtime_ddl_123456abcde`']) {
  assert.throws(() => quoteRuntimeDdlProbeTable(name))
}

function fixture(runtimeError = denied, tableCount = '0') {
  const calls = []
  return {
    calls,
    options: {
      tableName,
      databaseName: 'invitation_test_123456abcdef',
      runtimePool: {
        async query(sql) {
          calls.push(['runtime-create', sql])
          if (runtimeError) throw runtimeError
          return [{ affectedRows: 0 }, []]
        }
      },
      inspectionConnection: {
        async execute(sql, params) {
          calls.push(['root-absence-check', sql, params])
          return [[{ table_count: tableCount }], []]
        }
      }
    }
  }
}

const accepted = fixture()
assert.deepEqual(await assertRuntimeDdlDeniedAndAbsent(accepted.options), {
  deniedCode: 'ER_TABLEACCESS_DENIED_ERROR', deniedErrno: 1142, tableAbsent: true
})
assert.deepEqual(accepted.calls.map(call => call[0]), ['runtime-create', 'root-absence-check'])

for (const wrongError of [
  Object.assign(new Error('syntax'), { code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000' }),
  Object.assign(new Error('wrong errno'), { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1044, sqlState: '42000' }),
  Object.assign(new Error('wrong state'), { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142, sqlState: 'HY000' })
]) {
  const wrong = fixture(wrongError)
  await assert.rejects(() => assertRuntimeDdlDeniedAndAbsent(wrong.options))
  assert.deepEqual(wrong.calls.map(call => call[0]), ['runtime-create', 'root-absence-check'])
}

const unexpectedlyCreated = fixture(null, '1')
await assert.rejects(() => assertRuntimeDdlDeniedAndAbsent(unexpectedlyCreated.options))
assert.deepEqual(unexpectedlyCreated.calls.map(call => call[0]), ['runtime-create', 'root-absence-check'])

const integrationSource = await readFile(new URL('./test-invitation-mysql-integration.mjs', import.meta.url), 'utf8')
const ddlGuardCall = integrationSource.indexOf('await assertRuntimeDdlDeniedAndAbsent({')
const formalHttpCall = integrationSource.indexOf('await runInvitationFormalHttpMysqlScenarios({')
assert(ddlGuardCall > 0)
assert(formalHttpCall > ddlGuardCall)

console.log('invitation runtime DDL denial structure tests passed (ER_TABLEACCESS_DENIED_ERROR/1142/42000)')
