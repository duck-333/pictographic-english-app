import assert from 'node:assert/strict'

import { parseDatabaseSafeInteger } from './invitation-test-database-integers.mjs'

const SAFE_RUNTIME_DDL_PROBE_TABLE = /^invitation_runtime_ddl_[a-f0-9]{12}$/u

export function quoteRuntimeDdlProbeTable(name) {
  assert.equal(typeof name, 'string')
  assert.match(name, SAFE_RUNTIME_DDL_PROBE_TABLE)
  return `\`${name}\``
}

export function assertRuntimeDdlPermissionDenied(error) {
  assert(error instanceof Error)
  assert.equal(error.code, 'ER_TABLEACCESS_DENIED_ERROR')
  assert.equal(parseDatabaseSafeInteger(error.errno, 'runtime DDL denial errno'), 1142)
  assert.equal(error.sqlState, '42000')
  return error
}

export async function assertRuntimeDdlDeniedAndAbsent(options = {}) {
  const runtimePool = options.runtimePool
  const inspectionConnection = options.inspectionConnection
  assert(runtimePool && typeof runtimePool.query === 'function')
  assert(inspectionConnection && typeof inspectionConnection.execute === 'function')
  assert.equal(typeof options.databaseName, 'string')
  const quotedTable = quoteRuntimeDdlProbeTable(options.tableName)
  let ddlError = null
  try {
    await runtimePool.query(`CREATE TABLE ${quotedTable} (id BIGINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB`)
  } catch (error) {
    ddlError = error
  }

  const [rows] = await inspectionConnection.execute(`SELECT CAST(COUNT(*) AS CHAR) AS table_count
    FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
  [options.databaseName, options.tableName])
  assert.equal(rows.length, 1)
  assert.equal(parseDatabaseSafeInteger(rows[0].table_count, 'runtime DDL probe table COUNT'), 0)
  if (!ddlError) {
    const error = new Error('Runtime MySQL user unexpectedly created a DDL probe table.')
    error.code = 'INVITATION_MYSQL_RUNTIME_DDL_UNEXPECTEDLY_ALLOWED'
    throw error
  }
  assertRuntimeDdlPermissionDenied(ddlError)
  return Object.freeze({ deniedCode: ddlError.code, deniedErrno: 1142, tableAbsent: true })
}
