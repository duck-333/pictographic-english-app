import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

import mysql from 'mysql2/promise'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3308
const EXPECTED_CONFIRMATION = 'local-docker-book-benefit-review-only'
const DATABASE_PATTERN = /^book_benefit_review_(?:complete|campaign_only|application_partial|enum_mismatch|index_mismatch|column_mismatch)_[a-f0-9]{12}$/
const INDEX_NAME = 'idx_book_benefit_applications_campaign_status_created'
const INDEX_COLUMNS = ['campaign_id', 'status', 'created_at', 'id']
const OLD_STATUS = "enum('pending','approved','rejected','cancelled')"
const NEW_STATUS = "enum('pending','needs_more_info','approved','rejected','cancelled')"
const OLD_CLAIM = "enum('standard','manual_exception')"
const NEW_CLAIM = "enum('unreviewed','standard','manual_exception')"

const foundationUrl = new URL('../database/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)
const canonicalUrl = new URL('../database/migrations/008_extend_book_benefit_application_review.sql', import.meta.url)
const releaseUrl = new URL('../server/migrations/008_extend_book_benefit_application_review.sql', import.meta.url)

function readConfig(env = process.env) {
  const host = String(env.BOOK_BENEFIT_REVIEW_TEST_DB_HOST || '').trim()
  const rawPort = String(env.BOOK_BENEFIT_REVIEW_TEST_DB_PORT || '').trim()
  const user = String(env.BOOK_BENEFIT_REVIEW_TEST_DB_USER || '').trim()
  const password = String(env.BOOK_BENEFIT_REVIEW_TEST_DB_PASSWORD || '')
  const confirmation = String(env.BOOK_BENEFIT_REVIEW_TEST_ALLOW_DESTRUCTIVE || '').trim()

  assert.equal(host, EXPECTED_HOST, `review integration host must be exactly ${EXPECTED_HOST}`)
  assert.equal(rawPort, String(EXPECTED_PORT), `review integration port must be exactly ${EXPECTED_PORT}`)
  assert(user, 'BOOK_BENEFIT_REVIEW_TEST_DB_USER is required')
  assert(password, 'BOOK_BENEFIT_REVIEW_TEST_DB_PASSWORD is required')
  assert.equal(
    confirmation,
    EXPECTED_CONFIRMATION,
    'BOOK_BENEFIT_REVIEW_TEST_ALLOW_DESTRUCTIVE confirmation does not match'
  )
  return { host, port: EXPECTED_PORT, user, password, confirmation }
}

function quoteDatabase(databaseName) {
  assert.match(databaseName, DATABASE_PATTERN, 'unsafe review test database name')
  return `\`${databaseName}\``
}

function hash(seed) {
  return crypto.createHash('sha256').update(`book-benefit-review:${seed}`).digest()
}

function extractCreateTable(sql, tableName) {
  const match = sql.match(new RegExp(
    'CREATE TABLE IF NOT EXISTS `' + tableName + '` \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB[^\\n]*\\nCOMMENT=\'[^\']*\';'
  ))
  assert(match, `007 is missing ${tableName}`)
  return match[0]
}

function extractAlterStatements(sql) {
  const statements = sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  assert.equal(statements.length, 2, '008 must contain exactly two executable ALTER statements')
  return statements
}

async function createDatabaseConnection(config, databaseName) {
  assert.match(databaseName, DATABASE_PATTERN)
  return await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: databaseName,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true
  })
}

async function createOwnedDatabase(rootConnection, databaseName, ownedDatabases) {
  assert.match(databaseName, DATABASE_PATTERN)
  assert(!ownedDatabases.has(databaseName))
  await rootConnection.query(
    `CREATE DATABASE ${quoteDatabase(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  )
  ownedDatabases.add(databaseName)
}

async function dropOwnedDatabase(rootConnection, config, databaseName, ownedDatabases) {
  assert.equal(config.host, EXPECTED_HOST)
  assert.equal(config.port, EXPECTED_PORT)
  assert.equal(config.confirmation, EXPECTED_CONFIRMATION)
  assert.match(databaseName, DATABASE_PATTERN)
  assert(ownedDatabases.has(databaseName), 'refusing to drop a database not owned by this process')
  await rootConnection.query(`DROP DATABASE ${quoteDatabase(databaseName)}`)
  ownedDatabases.delete(databaseName)
}

async function buildExact007(connection, foundationSql) {
  await connection.query(extractCreateTable(foundationSql, 'book_benefit_campaigns'))
  await connection.query(extractCreateTable(foundationSql, 'book_benefit_applications'))
}

function normalizeColumn(row) {
  if (!row) return null
  return {
    type: String(row.COLUMN_TYPE).toLowerCase(),
    nullable: row.IS_NULLABLE,
    defaultValue: row.COLUMN_DEFAULT,
    extra: String(row.EXTRA || '')
  }
}

function expectedNullableColumn(type) {
  return { type, nullable: 'YES', defaultValue: null, extra: '' }
}

async function readPreflight(connection, databaseName) {
  const [columnRows] = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND ((TABLE_NAME = 'book_benefit_campaigns' AND COLUMN_NAME = 'rules_version')
          OR (TABLE_NAME = 'book_benefit_applications' AND COLUMN_NAME IN
            ('accepted_rules_version', 'rules_accepted_at', 'seller_verification_code',
             'customer_service_channel', 'status', 'order_claim_type')))
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    [databaseName]
  )
  const [indexRows] = await connection.execute(
    `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'book_benefit_applications' AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX`,
    [databaseName, INDEX_NAME]
  )
  const campaignRows = columnRows.filter((row) => row.TABLE_NAME === 'book_benefit_campaigns')
  const applicationRows = columnRows.filter((row) => row.TABLE_NAME === 'book_benefit_applications')
  const applicationColumns = Object.fromEntries(applicationRows.map((row) => [row.COLUMN_NAME, normalizeColumn(row)]))
  return {
    campaignRules: normalizeColumn(campaignRows.find((row) => row.COLUMN_NAME === 'rules_version')),
    applicationColumns,
    status: applicationColumns.status || null,
    claim: applicationColumns.order_claim_type || null,
    index: indexRows.map((row) => ({
      name: row.INDEX_NAME,
      nonUnique: Number(row.NON_UNIQUE),
      sequence: Number(row.SEQ_IN_INDEX),
      column: row.COLUMN_NAME
    }))
  }
}

function classifyPreflight(state) {
  const applicationColumns = { ...state.applicationColumns }
  delete applicationColumns.status
  delete applicationColumns.order_claim_type
  const applicationNames = Object.keys(applicationColumns)
  const exactOldEnums = state.status && state.claim &&
    state.status.type === OLD_STATUS && state.status.nullable === 'NO' && state.status.defaultValue === 'pending' &&
    state.claim.type === OLD_CLAIM && state.claim.nullable === 'NO' && state.claim.defaultValue === null
  const exactNewEnums = state.status && state.claim &&
    state.status.type === NEW_STATUS && state.status.nullable === 'NO' && state.status.defaultValue === 'pending' &&
    state.claim.type === NEW_CLAIM && state.claim.nullable === 'NO' && state.claim.defaultValue === null
  const expectedApplication = {
    accepted_rules_version: expectedNullableColumn('varchar(32)'),
    rules_accepted_at: expectedNullableColumn('datetime'),
    seller_verification_code: expectedNullableColumn('varchar(32)'),
    customer_service_channel: expectedNullableColumn('varchar(32)')
  }
  const exactCampaign = JSON.stringify(state.campaignRules) === JSON.stringify(expectedNullableColumn('varchar(32)'))
  const exactApplication = applicationNames.length === 4 && Object.entries(expectedApplication).every(
    ([name, expected]) => JSON.stringify(applicationColumns[name]) === JSON.stringify(expected)
  )
  const exactIndex = state.index.length === 4 && state.index.every((entry, offset) =>
    entry.name === INDEX_NAME && entry.nonUnique === 1 && entry.sequence === offset + 1 &&
    entry.column === INDEX_COLUMNS[offset]
  )

  if (!state.campaignRules && applicationNames.length === 0 && state.index.length === 0 && exactOldEnums) return 'execute'
  if (exactCampaign && exactApplication && exactIndex && exactNewEnums) return 'skip'
  return 'stop'
}

async function expectDuplicate(label, action) {
  let caught = null
  try {
    await action()
  } catch (error) {
    caught = error
  }
  assert(caught, `${label}: expected duplicate-key failure`)
  assert(caught.code === 'ER_DUP_ENTRY' || Number(caught.errno) === 1062, `${label}: unexpected error`)
}

async function insertApplication(connection, input) {
  await connection.execute(
    `INSERT INTO book_benefit_applications
      (application_no, campaign_id, applicant_user_id, applicant_phone_identity_hash,
       applicant_phone_hash_version, order_claim_type, approved_order_claim_hash,
       order_claim_hash_version, order_channel, status, create_idempotency_key)
     VALUES (?, ?, ?, ?, 'v1', ?, ?, ?, 'taobao', ?, ?)`,
    [
      input.applicationNo,
      input.campaignId,
      input.userId,
      input.phoneHash,
      input.claimType,
      input.orderHash || null,
      input.orderHash ? 'v1' : null,
      input.status,
      input.idempotencyKey
    ]
  )
}

async function runCompleteScenario(config, databaseName, foundationSql, migration008) {
  const connection = await createDatabaseConnection(config, databaseName)
  try {
    await buildExact007(connection, foundationSql)
    await connection.query(
      `INSERT INTO book_benefit_campaigns (campaign_key, name, status)
       VALUES ('review-campaign', 'Review Campaign', 'active')`
    )
    const [[campaign]] = await connection.query('SELECT id FROM book_benefit_campaigns WHERE campaign_key = ?', ['review-campaign'])
    const oldRows = [
      ['review-app-1', 101, 'pending', 'standard'],
      ['review-app-2', 102, 'approved', 'manual_exception'],
      ['review-app-3', 103, 'rejected', 'standard'],
      ['review-app-4', 104, 'cancelled', 'manual_exception']
    ]
    for (const [applicationNo, userId, status, claimType] of oldRows) {
      await insertApplication(connection, {
        applicationNo,
        campaignId: campaign.id,
        userId,
        phoneHash: hash(`phone-${userId}`),
        orderHash: status === 'approved' ? hash(`order-${userId}`) : null,
        claimType,
        status,
        idempotencyKey: `review-idempotency-${userId}`
      })
    }
    const [beforeRows] = await connection.query(
      'SELECT id, application_no, status, order_claim_type FROM book_benefit_applications ORDER BY id'
    )
    assert.equal(classifyPreflight(await readPreflight(connection, databaseName)), 'execute')

    await connection.query(migration008)
    assert.equal(classifyPreflight(await readPreflight(connection, databaseName)), 'skip')
    const [[campaignAfterMigration]] = await connection.query(
      'SELECT rules_version FROM book_benefit_campaigns WHERE id = ?',
      [campaign.id]
    )
    assert.equal(campaignAfterMigration.rules_version, null)

    const [afterRows] = await connection.query(
      `SELECT id, application_no, status, order_claim_type, accepted_rules_version,
              rules_accepted_at, seller_verification_code, customer_service_channel
         FROM book_benefit_applications ORDER BY id`
    )
    assert.deepEqual(
      afterRows.map((row) => [Number(row.id), row.application_no, row.status, row.order_claim_type]),
      beforeRows.map((row) => [Number(row.id), row.application_no, row.status, row.order_claim_type])
    )
    assert(afterRows.every((row) =>
      row.accepted_rules_version === null && row.rules_accepted_at === null &&
      row.seller_verification_code === null && row.customer_service_channel === null
    ))

    await connection.execute(
      `UPDATE book_benefit_applications
          SET status = 'needs_more_info', order_claim_type = 'unreviewed',
              accepted_rules_version = 'rules-v1', rules_accepted_at = ?,
              seller_verification_code = 'seller-confirmed', customer_service_channel = 'wechat-service'
        WHERE application_no = 'review-app-1'`,
      [new Date('2026-08-08T03:00:00.000Z')]
    )
    const [[updated]] = await connection.query(
      `SELECT status, order_claim_type, accepted_rules_version, rules_accepted_at,
              seller_verification_code, customer_service_channel
         FROM book_benefit_applications WHERE application_no = 'review-app-1'`
    )
    assert.equal(updated.status, 'needs_more_info')
    assert.equal(updated.order_claim_type, 'unreviewed')
    assert.equal(updated.accepted_rules_version, 'rules-v1')
    assert(updated.rules_accepted_at instanceof Date)
    assert.equal(updated.seller_verification_code, 'seller-confirmed')
    assert.equal(updated.customer_service_channel, 'wechat-service')

    await connection.execute('UPDATE book_benefit_campaigns SET rules_version = ? WHERE id = ?', ['rules-v1', campaign.id])
    const [[updatedCampaign]] = await connection.query('SELECT rules_version FROM book_benefit_campaigns WHERE id = ?', [campaign.id])
    assert.equal(updatedCampaign.rules_version, 'rules-v1')

    const duplicateBase = {
      campaignId: campaign.id,
      claimType: 'unreviewed',
      status: 'pending'
    }
    await expectDuplicate('application number', () => insertApplication(connection, {
      ...duplicateBase, applicationNo: 'review-app-2', userId: 201, phoneHash: hash('unique-phone-201'),
      idempotencyKey: 'unique-idempotency-201'
    }))
    await expectDuplicate('campaign user', () => insertApplication(connection, {
      ...duplicateBase, applicationNo: 'unique-app-user', userId: 102, phoneHash: hash('unique-phone-202'),
      idempotencyKey: 'unique-idempotency-202'
    }))
    await expectDuplicate('campaign phone', () => insertApplication(connection, {
      ...duplicateBase, applicationNo: 'unique-app-phone', userId: 203, phoneHash: hash('phone-103'),
      idempotencyKey: 'unique-idempotency-203'
    }))
    await expectDuplicate('create idempotency', () => insertApplication(connection, {
      ...duplicateBase, applicationNo: 'unique-app-idempotency', userId: 204, phoneHash: hash('unique-phone-204'),
      idempotencyKey: 'review-idempotency-104'
    }))
    await expectDuplicate('campaign order', () => insertApplication(connection, {
      ...duplicateBase, applicationNo: 'unique-app-order', userId: 205, phoneHash: hash('unique-phone-205'),
      orderHash: hash('order-102'), idempotencyKey: 'unique-idempotency-205'
    }))

    return { oldRowsPreserved: oldRows.length, exact008Recognized: true, originalUniqueConstraintsVerified: true }
  } finally {
    await connection.end()
  }
}

async function runStateScenario(config, databaseName, foundationSql, migration008, scenario) {
  const connection = await createDatabaseConnection(config, databaseName)
  try {
    await buildExact007(connection, foundationSql)
    const [campaignAlter, applicationAlter] = extractAlterStatements(migration008)
    if (scenario === 'campaign_only') await connection.query(campaignAlter)
    if (scenario === 'application_partial') {
      await connection.query('ALTER TABLE book_benefit_applications ADD COLUMN accepted_rules_version VARCHAR(32) NULL DEFAULT NULL')
    }
    if (scenario === 'enum_mismatch') {
      await connection.query("ALTER TABLE book_benefit_applications MODIFY COLUMN status ENUM('pending','approved','rejected','cancelled','other') NOT NULL DEFAULT 'pending'")
    }
    if (scenario === 'index_mismatch') {
      await connection.query(
        `ALTER TABLE book_benefit_applications
           ADD KEY ${INDEX_NAME} (campaign_id, created_at, status, id)`
      )
    }
    if (scenario === 'column_mismatch') {
      await connection.query(campaignAlter)
      await connection.query(applicationAlter)
      await connection.query('ALTER TABLE book_benefit_applications MODIFY COLUMN accepted_rules_version VARCHAR(64) NULL DEFAULT NULL')
      assert.equal(classifyPreflight(await readPreflight(connection, databaseName)), 'stop')
      await connection.query('ALTER TABLE book_benefit_applications MODIFY COLUMN accepted_rules_version VARCHAR(32) NOT NULL')
      assert.equal(classifyPreflight(await readPreflight(connection, databaseName)), 'stop')
      await connection.query("ALTER TABLE book_benefit_applications MODIFY COLUMN accepted_rules_version VARCHAR(32) NULL DEFAULT 'rules-v0'")
    }
    assert.equal(classifyPreflight(await readPreflight(connection, databaseName)), 'stop')
    return true
  } finally {
    await connection.end()
  }
}

function describeCleanupError(error) {
  const rawName = error && typeof error.name === 'string' ? error.name : 'UnknownError'
  const name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName) ? rawName : 'UnknownError'
  const rawCode = error && (typeof error.code === 'string' || typeof error.code === 'number')
    ? String(error.code)
    : ''
  const code = /^[A-Za-z0-9_.-]{1,64}$/.test(rawCode) ? ` code=${rawCode}` : ''
  return `${name}${code}`
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

export function formatSafeTopLevelError(error) {
  const lines = [
    'Book-benefit application review integration test failed.',
    `Error type: ${safeErrorName(error)}`
  ]
  const code = safeErrorCode(error)
  if (code) lines.push(`Error code: ${code}`)

  const cleanupErrors = error && Array.isArray(error.cleanupErrors)
    ? error.cleanupErrors
    : []
  if (cleanupErrors.length) {
    lines.push(`Cleanup failures: ${cleanupErrors.length}`)
    cleanupErrors.forEach((cleanupError, index) => {
      lines.push(`Cleanup ${index + 1}: ${describeCleanupError(cleanupError)}`)
    })
  }
  return lines.join('\n')
}

export function attachCleanupErrors(primaryError, cleanupErrors = []) {
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
      value: Object.freeze([...errors])
    })
  }
  if (!Object.prototype.hasOwnProperty.call(finalError, inspect.custom)) {
    Object.defineProperty(finalError, inspect.custom, {
      configurable: false,
      enumerable: false,
      writable: false,
      value() {
        return formatSafeTopLevelError(this)
      }
    })
  }

  const summary = [
    `Cleanup failures also occurred (${errors.length}):`,
    ...errors.map((error, index) => `  [${index + 1}] ${describeCleanupError(error)}`)
  ].join('\n')
  if (typeof finalError.stack === 'string' && !finalError.stack.includes('Cleanup failures also occurred (')) {
    finalError.stack = `${finalError.stack}\n${summary}`
  }
  return finalError
}

function testCleanupErrorAttachment() {
  const primary = new Error('primary failure')
  primary.code = 'PRIMARY_CODE'
  const originalCause = new Error('original cause')
  primary.cause = originalCause

  assert.equal(attachCleanupErrors(primary, []), primary)
  assert.equal(primary.code, 'PRIMARY_CODE')
  assert.equal(primary.message, 'primary failure')

  const sentinels = [
    'FAKE_PASSWORD_SENTINEL_DO_NOT_PRINT',
    'FAKE_SQL_SENTINEL_DO_NOT_PRINT',
    'FAKE_CONNECTION_SENTINEL_DO_NOT_PRINT'
  ]
  const cleanupOne = new Error(sentinels[0])
  cleanupOne.code = 'CLEANUP_ONE'
  cleanupOne.sqlMessage = sentinels[1]
  cleanupOne.stack = sentinels[2]
  const withOne = attachCleanupErrors(primary, [cleanupOne])
  assert.equal(withOne, primary)
  assert.equal(withOne.code, 'PRIMARY_CODE')
  assert.equal(withOne.message, 'primary failure')
  assert.equal(withOne.cause, originalCause)
  assert.deepEqual(withOne.cleanupErrors, [cleanupOne])
  assert(Object.isFrozen(withOne.cleanupErrors))
  assert.equal(Object.prototype.propertyIsEnumerable.call(withOne, 'cleanupErrors'), false)
  assert.throws(() => {
    withOne.cleanupErrors = []
  }, TypeError)
  assert.match(withOne.stack, /Cleanup failures also occurred \(1\):/)
  for (const sentinel of sentinels) {
    assert(!Object.keys(withOne).join('\n').includes(sentinel))
    assert(!JSON.stringify(withOne).includes(sentinel))
    assert(!inspect(withOne).includes(sentinel))
    assert(!formatSafeTopLevelError(withOne).includes(sentinel))
  }
  const stackAfterFirstAttachment = withOne.stack
  assert.equal(attachCleanupErrors(withOne, [cleanupOne]), withOne)
  assert.equal(withOne.stack, stackAfterFirstAttachment)

  const cleanupTwo = new Error('second cleanup failure')
  cleanupTwo.code = 'CLEANUP_TWO'
  const primaryMultiple = new Error('another primary failure')
  primaryMultiple.code = 'ANOTHER_PRIMARY'
  const withMultiple = attachCleanupErrors(primaryMultiple, [cleanupOne, cleanupTwo])
  assert.equal(withMultiple, primaryMultiple)
  assert.deepEqual(withMultiple.cleanupErrors, [cleanupOne, cleanupTwo])
  assert.match(withMultiple.stack, /Cleanup failures also occurred \(2\):/)

  const cleanupOnly = new Error('single cleanup failure')
  cleanupOnly.code = 'SINGLE_CLEANUP'
  const singleOnlyResult = attachCleanupErrors(null, [cleanupOnly])
  assert.equal(singleOnlyResult, cleanupOnly)
  assert.deepEqual(singleOnlyResult.cleanupErrors, [cleanupOnly])

  const multipleOnlyResult = attachCleanupErrors(null, [cleanupOne, cleanupTwo])
  assert(multipleOnlyResult instanceof AggregateError)
  assert.deepEqual(multipleOnlyResult.errors, [cleanupOne, cleanupTwo])
  assert.deepEqual(multipleOnlyResult.cleanupErrors, [cleanupOne, cleanupTwo])
  assert.match(multipleOnlyResult.stack, /Cleanup failures also occurred \(2\):/)
  for (const sentinel of sentinels) {
    assert(!inspect(multipleOnlyResult).includes(sentinel))
    assert(!formatSafeTopLevelError(multipleOnlyResult).includes(sentinel))
  }

  assert.equal(attachCleanupErrors(null, []), null)
}

function createSafeOutputTestError() {
  const primary = new Error('FAKE_PRIMARY_DATABASE_MESSAGE_DO_NOT_PRINT')
  primary.name = 'Error'
  primary.code = 'SAFE_TEST_PRIMARY'
  primary.sqlMessage = 'FAKE_PRIMARY_SQL_SENTINEL_DO_NOT_PRINT'
  primary.stack = 'FAKE_PRIMARY_CONNECTION_SENTINEL_DO_NOT_PRINT'
  const cleanup = new Error('FAKE_CLEANUP_PASSWORD_SENTINEL_DO_NOT_PRINT')
  cleanup.code = 'SAFE_TEST_CLEANUP'
  cleanup.sqlMessage = 'FAKE_CLEANUP_SQL_SENTINEL_DO_NOT_PRINT'
  cleanup.stack = 'FAKE_CLEANUP_CONNECTION_SENTINEL_DO_NOT_PRINT'
  return attachCleanupErrors(primary, [cleanup])
}

function testSafeTopLevelErrorOutput() {
  const childEnvironment = {}
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATH', 'PATHEXT']) {
    if (process.env[name]) childEnvironment[name] = process.env[name]
  }
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), '--test-safe-top-level-error-output-child'],
    {
      encoding: 'utf8',
      env: childEnvironment,
      windowsHide: true
    }
  )
  assert.equal(child.status, 1)
  assert.equal(child.stdout, '')
  assert.match(child.stderr, /Book-benefit application review integration test failed\./)
  assert.match(child.stderr, /Error type: Error/)
  assert.match(child.stderr, /Error code: SAFE_TEST_PRIMARY/)
  assert.match(child.stderr, /Cleanup failures: 1/)
  assert.match(child.stderr, /Cleanup 1: Error code=SAFE_TEST_CLEANUP/)
  for (const sentinel of [
    'FAKE_PRIMARY_DATABASE_MESSAGE_DO_NOT_PRINT',
    'FAKE_PRIMARY_SQL_SENTINEL_DO_NOT_PRINT',
    'FAKE_PRIMARY_CONNECTION_SENTINEL_DO_NOT_PRINT',
    'FAKE_CLEANUP_PASSWORD_SENTINEL_DO_NOT_PRINT',
    'FAKE_CLEANUP_SQL_SENTINEL_DO_NOT_PRINT',
    'FAKE_CLEANUP_CONNECTION_SENTINEL_DO_NOT_PRINT'
  ]) {
    assert(!child.stderr.includes(sentinel))
  }
}

function createFormatterFallbackTestError() {
  const error = {}

  Object.defineProperty(error, 'name', {
    enumerable: false,
    configurable: false,
    get() {
      throw new Error('FAKE_FALLBACK_GETTER_SENTINEL_DO_NOT_PRINT')
    }
  })
  Object.defineProperty(error, 'code', {
    enumerable: false,
    configurable: false,
    get() {
      throw new Error('FAKE_FALLBACK_CODE_GETTER_SENTINEL_DO_NOT_PRINT')
    }
  })
  Object.defineProperty(error, 'cleanupErrors', {
    enumerable: false,
    configurable: false,
    get() {
      throw new Error('FAKE_FALLBACK_CLEANUP_GETTER_SENTINEL_DO_NOT_PRINT')
    }
  })
  Object.defineProperty(error, 'originalSensitiveValue', {
    enumerable: true,
    configurable: false,
    value: 'FAKE_FALLBACK_ORIGINAL_SENTINEL_DO_NOT_PRINT'
  })

  return error
}

function testSafeTopLevelFormatterFallback() {
  const childEnvironment = {}
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATH', 'PATHEXT']) {
    if (process.env[name]) childEnvironment[name] = process.env[name]
  }
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), '--test-safe-top-level-formatter-fallback-child'],
    {
      encoding: 'utf8',
      env: childEnvironment,
      windowsHide: true
    }
  )
  const expectedOutput =
    'Book-benefit application review integration test failed.\n' +
    'Error details unavailable.\n'

  assert.equal(child.status, 1)
  assert.equal(child.signal, null)
  assert.equal(child.stdout, '')
  assert.equal(child.stderr, expectedOutput)
  for (const sentinel of [
    'FAKE_FALLBACK_GETTER_SENTINEL_DO_NOT_PRINT',
    'FAKE_FALLBACK_CODE_GETTER_SENTINEL_DO_NOT_PRINT',
    'FAKE_FALLBACK_CLEANUP_GETTER_SENTINEL_DO_NOT_PRINT',
    'FAKE_FALLBACK_ORIGINAL_SENTINEL_DO_NOT_PRINT'
  ]) {
    assert(!child.stdout.includes(sentinel))
    assert(!child.stderr.includes(sentinel))
  }
  assert(!child.stderr.includes('node:internal'))
  assert(!child.stderr.includes('triggerUncaughtException'))
  assert(!child.stderr.includes('Unhandled'))
}

async function main() {
  const config = readConfig()
  const suffix = crypto.randomBytes(6).toString('hex')
  const databaseNames = Object.fromEntries([
    'complete', 'campaign_only', 'application_partial', 'enum_mismatch', 'index_mismatch', 'column_mismatch'
  ].map((scenario) => [scenario, `book_benefit_review_${scenario}_${suffix}`]))
  for (const databaseName of Object.values(databaseNames)) assert.match(databaseName, DATABASE_PATTERN)

  const [foundationSql, migration008, releaseSql] = await Promise.all([
    readFile(foundationUrl, 'utf8'),
    readFile(canonicalUrl, 'utf8'),
    readFile(releaseUrl, 'utf8')
  ])
  assert.equal(releaseSql, migration008)

  const rootConnection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: 'utf8mb4',
    timezone: 'Z'
  })
  const ownedDatabases = new Set()
  let primaryError = null
  let result = null
  try {
    const [[versionRow]] = await rootConnection.query('SELECT VERSION() AS version, DATABASE() AS current_database')
    assert.match(String(versionRow.version), /^8\.0\.46(?:[-+.]|$)/, 'integration test requires MySQL 8.0.46')
    assert.equal(versionRow.current_database, null)

    for (const databaseName of Object.values(databaseNames)) {
      await createOwnedDatabase(rootConnection, databaseName, ownedDatabases)
    }
    const complete = await runCompleteScenario(config, databaseNames.complete, foundationSql, migration008)
    for (const scenario of ['campaign_only', 'application_partial', 'enum_mismatch', 'index_mismatch', 'column_mismatch']) {
      await runStateScenario(config, databaseNames[scenario], foundationSql, migration008, scenario)
    }
    result = { mysqlVersion: versionRow.version, complete, partialStatesRejected: 5 }
  } catch (error) {
    primaryError = error
  } finally {
    const cleanupErrors = []
    for (const databaseName of [...ownedDatabases]) {
      try {
        await dropOwnedDatabase(rootConnection, config, databaseName, ownedDatabases)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      const placeholders = Object.values(databaseNames).map(() => '?').join(', ')
      const [remaining] = await rootConnection.query(
        `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME IN (${placeholders})`,
        Object.values(databaseNames)
      )
      assert.equal(remaining.length, 0, 'review test databases remain after cleanup')
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await rootConnection.end()
    } catch (error) {
      cleanupErrors.push(error)
    }
    primaryError = attachCleanupErrors(primaryError, cleanupErrors)
  }
  if (primaryError) throw primaryError
  console.log('book-benefit application review MySQL 8.0.46 integration tests passed')
  console.log(JSON.stringify({ ...result, testDatabasesCleaned: true }, null, 2))
}

async function runEntryPoint() {
  if (process.argv.includes('--test-cleanup-error-attachment')) {
    testCleanupErrorAttachment()
    console.log('book-benefit review cleanup error attachment tests passed')
    return
  }
  if (process.argv.includes('--test-safe-top-level-error-output')) {
    testSafeTopLevelErrorOutput()
    console.log('book-benefit review safe top-level error output tests passed')
    return
  }
  if (process.argv.includes('--test-safe-top-level-error-output-child')) {
    throw createSafeOutputTestError()
  }
  if (process.argv.includes('--test-safe-top-level-formatter-fallback')) {
    testSafeTopLevelFormatterFallback()
    console.log('book-benefit review safe top-level formatter fallback tests passed')
    return
  }
  if (process.argv.includes('--test-safe-top-level-formatter-fallback-child')) {
    throw createFormatterFallbackTestError()
  }
  await main()
}

try {
  await runEntryPoint()
} catch (error) {
  process.exitCode = 1

  let safeOutput =
    'Book-benefit application review integration test failed.\n' +
    'Error details unavailable.'

  try {
    safeOutput = formatSafeTopLevelError(error)
  } catch {
    // Keep the fixed safe output without inspecting the formatter failure.
  }

  process.stderr.write(`${safeOutput}\n`)
}
