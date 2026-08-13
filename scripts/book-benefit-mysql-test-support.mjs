import assert from 'node:assert/strict'
import { inspect } from 'node:util'

export const BOOK_BENEFIT_TEST_HOST = '127.0.0.1'
export const BOOK_BENEFIT_TEST_PORT = 3308

export function assertBookBenefitMigrationCopies(canonicalSql, releaseSql, label) {
  assert.equal(releaseSql, canonicalSql, `${label} canonical/server mismatch: STOP`)
}

export function extractBookBenefitCreateTable(sql, tableName) {
  const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = sql.match(new RegExp(
    'CREATE TABLE IF NOT EXISTS `' + escapedTableName + '` \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB[^\\n]*\\nCOMMENT=\'[^\']*\';'
  ))
  assert(match, `migration is missing ${tableName}`)
  return match[0]
}

export function extractBookBenefitExact007Statements(phoneBindingsSql, migration007, bookBenefitTables) {
  assert(Array.isArray(bookBenefitTables) && bookBenefitTables.length === 5, 'exact 007 requires five book-benefit tables')
  const alterMatch = migration007.match(
    /^ALTER TABLE `user_phone_bindings`[\s\S]*?^\s*ADD KEY `idx_user_phone_bindings_campaign_identity`[^\r\n]*;\s*$/m
  )
  assert(alterMatch, '007 is missing the user_phone_bindings ALTER')
  return [
    extractBookBenefitCreateTable(phoneBindingsSql, 'user_phone_bindings'),
    ...bookBenefitTables.map((tableName) => extractBookBenefitCreateTable(migration007, tableName)),
    alterMatch[0]
  ]
}

export function readBookBenefitMysqlTestConfig(env, {
  prefix,
  confirmation,
  label = 'book-benefit'
}) {
  const host = String(env[`${prefix}_DB_HOST`] || '').trim()
  const rawPort = String(env[`${prefix}_DB_PORT`] || '').trim()
  const user = String(env[`${prefix}_DB_USER`] || '').trim()
  const password = String(env[`${prefix}_DB_PASSWORD`] || '')
  const actualConfirmation = String(env[`${prefix}_ALLOW_DESTRUCTIVE`] || '').trim()

  assert.equal(host, BOOK_BENEFIT_TEST_HOST, `${label} integration host must be exactly ${BOOK_BENEFIT_TEST_HOST}`)
  assert.equal(rawPort, String(BOOK_BENEFIT_TEST_PORT), `${label} integration port must be exactly ${BOOK_BENEFIT_TEST_PORT}`)
  assert(user, `${prefix}_DB_USER is required`)
  assert(password, `${prefix}_DB_PASSWORD is required`)
  assert.equal(actualConfirmation, confirmation, `${label} destructive confirmation does not match`)

  return {
    host: BOOK_BENEFIT_TEST_HOST,
    port: BOOK_BENEFIT_TEST_PORT,
    user,
    password,
    confirmation: actualConfirmation
  }
}

export function quoteOwnedBookBenefitDatabase(databaseName, databasePattern) {
  assert(databasePattern instanceof RegExp, 'database pattern is required')
  assert.match(databaseName, databasePattern, 'unsafe book-benefit test database name')
  return `\`${databaseName}\``
}

export async function createOwnedBookBenefitDatabase(
  connection,
  databaseName,
  ownedDatabases,
  databasePattern
) {
  assert(!ownedDatabases.has(databaseName), 'database is already owned by this process')
  const identifier = quoteOwnedBookBenefitDatabase(databaseName, databasePattern)
  ownedDatabases.add(databaseName)
  await connection.query(`CREATE DATABASE ${identifier} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
}

export async function dropOwnedBookBenefitDatabase(connection, config, {
  databaseName,
  ownedDatabases,
  databasePattern,
  confirmation
}) {
  assert.equal(config.host, BOOK_BENEFIT_TEST_HOST, 'refusing DROP outside the dedicated host')
  assert.equal(config.port, BOOK_BENEFIT_TEST_PORT, 'refusing DROP outside the dedicated port')
  assert.equal(config.confirmation, confirmation, 'refusing DROP without the expected confirmation')
  assert(ownedDatabases.has(databaseName), 'refusing DROP for a database not owned by this process')
  const identifier = quoteOwnedBookBenefitDatabase(databaseName, databasePattern)
  await connection.query(`DROP DATABASE ${identifier}`)
  ownedDatabases.delete(databaseName)
}

export async function verifyBookBenefitMysqlTestServer(connection) {
  const [[versionRow]] = await connection.query('SELECT VERSION() AS version, DATABASE() AS current_database')
  assert.match(String(versionRow.version), /^8\.0\.46(?:[-+.]|$)/, 'integration test requires MySQL 8.0.46')
  assert.equal(versionRow.current_database, null, 'root test connection must not select a database')
  return String(versionRow.version)
}

function safeErrorName(error) {
  const rawName = error && typeof error.name === 'string' ? error.name : 'UnknownError'
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName) ? rawName : 'UnknownError'
}

function safeErrorCode(error) {
  const rawCode = error && (typeof error.code === 'string' || typeof error.code === 'number')
    ? String(error.code)
    : ''
  return /^[A-Za-z0-9_.-]{1,64}$/.test(rawCode) ? rawCode : ''
}

export function formatBookBenefitMysqlTestError(error, {
  heading = 'Book-benefit MySQL integration test failed.'
} = {}) {
  const lines = [heading, `Error type: ${safeErrorName(error)}`]
  const code = safeErrorCode(error)
  if (code) lines.push(`Error code: ${code}`)
  const cleanupErrors = error && Array.isArray(error.cleanupErrors) ? error.cleanupErrors : []
  if (cleanupErrors.length) {
    lines.push(`Cleanup failures: ${cleanupErrors.length}`)
    cleanupErrors.forEach((cleanupError, index) => {
      const cleanupCode = safeErrorCode(cleanupError)
      lines.push(`Cleanup ${index + 1}: ${safeErrorName(cleanupError)}${cleanupCode ? ` code=${cleanupCode}` : ''}`)
    })
  }
  return lines.join('\n')
}

export function attachBookBenefitCleanupErrors(primaryError, cleanupErrors = [], formatterOptions = {}) {
  const errors = Array.isArray(cleanupErrors) ? [...cleanupErrors] : []
  if (!errors.length) return primaryError || null
  let finalError = primaryError
  if (!finalError) {
    finalError = errors.length === 1 && errors[0] instanceof Error
      ? errors[0]
      : new AggregateError(errors, 'Multiple cleanup failures occurred.')
  }
  if (!Object.prototype.hasOwnProperty.call(finalError, 'cleanupErrors')) {
    Object.defineProperty(finalError, 'cleanupErrors', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze(errors)
    })
  }
  if (!Object.prototype.hasOwnProperty.call(finalError, inspect.custom)) {
    Object.defineProperty(finalError, inspect.custom, {
      configurable: false,
      enumerable: false,
      writable: false,
      value() {
        return formatBookBenefitMysqlTestError(this, formatterOptions)
      }
    })
  }
  const summary = [
    `Cleanup failures also occurred (${errors.length}):`,
    ...errors.map((error, index) => {
      const code = safeErrorCode(error)
      return `  [${index + 1}] ${safeErrorName(error)}${code ? ` code=${code}` : ''}`
    })
  ].join('\n')
  if (typeof finalError.stack === 'string' && !finalError.stack.includes('Cleanup failures also occurred (')) {
    finalError.stack = `${finalError.stack}\n${summary}`
  }
  return finalError
}
