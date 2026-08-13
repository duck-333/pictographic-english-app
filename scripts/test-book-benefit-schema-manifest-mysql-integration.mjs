import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'

import mysql from 'mysql2/promise'

import {
  classifyBookBenefitSchemaManifest,
  collectBookBenefitSchemaManifest,
  exitCodeForBookBenefitSchemaClassification,
  hashBookBenefitSchemaManifest,
  summarizeBookBenefitSchemaManifest
} from './book-benefit-schema-manifest.mjs'
import {
  assertBookBenefitMigrationCopies,
  attachBookBenefitCleanupErrors,
  createOwnedBookBenefitDatabase,
  dropOwnedBookBenefitDatabase,
  extractBookBenefitExact007Statements,
  formatBookBenefitMysqlTestError,
  readBookBenefitMysqlTestConfig,
  verifyBookBenefitMysqlTestServer
} from './book-benefit-mysql-test-support.mjs'

const CONFIRMATION = 'local-docker-book-benefit-manifest-only'
const DATABASE_PATTERN = /^book_benefit_manifest_(?:expected|actual|other|legacy|partial|trigger_only|cleanup)_[a-f0-9]{12}$/
const TABLES = [
  'book_benefit_campaigns',
  'book_benefit_issuances',
  'book_benefit_codes',
  'book_benefit_redemptions',
  'book_benefit_audit_events'
]

const canonical007Url = new URL('../database/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)
const phoneBindingsUrl = new URL('../database/migrations/001_create_user_phone_bindings.sql', import.meta.url)
const release007Url = new URL('../server/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)
const canonical008Url = new URL('../database/migrations/008_extend_book_benefit_issuance_review.sql', import.meta.url)
const release008Url = new URL('../server/migrations/008_extend_book_benefit_issuance_review.sql', import.meta.url)

function extract008Statements(sql) {
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
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: databaseName,
    charset: 'utf8mb4',
    timezone: 'Z'
  })
}

async function applyStatements(connection, statements) {
  for (const statement of statements) await connection.query(statement)
}

async function buildExpectedManifests(config, databaseName, phoneBindingsSql, migration007, migration008) {
  const connection = await createDatabaseConnection(config, databaseName)
  try {
    await applyStatements(connection, extractBookBenefitExact007Statements(phoneBindingsSql, migration007, TABLES))
    const expected007 = await collectBookBenefitSchemaManifest(connection, { schemaName: databaseName })
    assert.notEqual(expected007.collectionState, 'unknown')
    await applyStatements(connection, extract008Statements(migration008))
    const expected008 = await collectBookBenefitSchemaManifest(connection, { schemaName: databaseName })
    assert.notEqual(expected008.collectionState, 'unknown')
    return { expected007, expected008 }
  } finally {
    await connection.end()
  }
}

async function buildActual007(config, databaseName, phoneBindingsSql, migration007, expected007, expected008) {
  const connection = await createDatabaseConnection(config, databaseName)
  try {
    await connection.query('CREATE TABLE unrelated_business_table (id BIGINT NOT NULL PRIMARY KEY, secret_value VARCHAR(64))')
    await applyStatements(connection, extractBookBenefitExact007Statements(phoneBindingsSql, migration007, TABLES))
    const actual = await collectBookBenefitSchemaManifest(connection, { schemaName: databaseName })
    assert.equal(classifyBookBenefitSchemaManifest(actual, expected007, expected008), 'exact_revised_007')
    assert.equal(hashBookBenefitSchemaManifest(actual), hashBookBenefitSchemaManifest(expected007))
    assert(!JSON.stringify(actual).includes('unrelated_business_table'))
    assert(!JSON.stringify(actual).includes('secret_value'))
    return actual
  } finally {
    await connection.end()
  }
}

async function buildOther008(config, databaseName, phoneBindingsSql, migration007, migration008, expected007, expected008) {
  const connection = await createDatabaseConnection(config, databaseName)
  try {
    await applyStatements(connection, extractBookBenefitExact007Statements(phoneBindingsSql, migration007, TABLES))
    await applyStatements(connection, extract008Statements(migration008))
    const actual = await collectBookBenefitSchemaManifest(connection, { schemaName: databaseName })
    assert.equal(classifyBookBenefitSchemaManifest(actual, expected007, expected008), 'exact_revised_008')
    assert.equal(hashBookBenefitSchemaManifest(actual), hashBookBenefitSchemaManifest(expected008))
    return actual
  } finally {
    await connection.end()
  }
}

async function testPristineAndLegacy(config, names, expected007, expected008) {
  const pristineConnection = await createDatabaseConnection(config, names.cleanup)
  try {
    await pristineConnection.query('CREATE TABLE unrelated_business_table (id BIGINT NOT NULL PRIMARY KEY)')
    const pristine = await collectBookBenefitSchemaManifest(pristineConnection, { schemaName: names.cleanup })
    assert.equal(classifyBookBenefitSchemaManifest(pristine, expected007, expected008), 'pristine')
  } finally {
    await pristineConnection.end()
  }

  const legacyConnection = await createDatabaseConnection(config, names.legacy)
  try {
    await legacyConnection.query(`CREATE TABLE book_benefit_applications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      application_no VARCHAR(64) NOT NULL,
      campaign_id BIGINT UNSIGNED NOT NULL,
      applicant_user_id BIGINT UNSIGNED NOT NULL,
      applicant_phone_identity_hash BINARY(32) NOT NULL,
      applicant_phone_hash_version VARCHAR(16) NOT NULL,
      order_claim_type ENUM('standard','manual_exception') NOT NULL,
      approved_order_claim_hash BINARY(32) NULL DEFAULT NULL,
      order_claim_hash_version VARCHAR(16) NULL DEFAULT NULL,
      order_channel VARCHAR(64) NULL DEFAULT NULL,
      status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
      reviewed_by VARCHAR(191) NULL DEFAULT NULL,
      review_reason_code VARCHAR(64) NULL DEFAULT NULL,
      reviewed_at DATETIME NULL DEFAULT NULL,
      create_idempotency_key VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_book_benefit_applications_no (application_no),
      UNIQUE KEY uk_book_benefit_applications_campaign_user (campaign_id, applicant_user_id),
      UNIQUE KEY uk_book_benefit_applications_campaign_phone (campaign_id, applicant_phone_identity_hash),
      UNIQUE KEY uk_book_benefit_applications_campaign_order (campaign_id, approved_order_claim_hash),
      UNIQUE KEY uk_book_benefit_applications_idempotency (create_idempotency_key),
      KEY idx_book_benefit_applications_status_created (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    const legacy = await collectBookBenefitSchemaManifest(legacyConnection, { schemaName: names.legacy })
    assert.equal(classifyBookBenefitSchemaManifest(legacy, expected007, expected008), 'legacy_application')
  } finally {
    await legacyConnection.end()
  }
}

async function testPartialAndExtraObjects(config, names, phoneBindingsSql, migration007, expected007, expected008) {
  const connection = await createDatabaseConnection(config, names.partial)
  try {
    await applyStatements(connection, extractBookBenefitExact007Statements(phoneBindingsSql, migration007, TABLES))
    await connection.query('ALTER TABLE book_benefit_campaigns MODIFY COLUMN name VARCHAR(190) NOT NULL')
    let actual = await collectBookBenefitSchemaManifest(connection, { schemaName: names.partial })
    assert.equal(classifyBookBenefitSchemaManifest(actual, expected007, expected008), 'partial_mismatch')
    assert.equal(exitCodeForBookBenefitSchemaClassification('partial_mismatch'), 1)

    await connection.query(`CREATE TRIGGER book_benefit_campaign_trigger BEFORE INSERT ON book_benefit_campaigns
      FOR EACH ROW SET NEW.name = NEW.name`)
    await connection.query(`CREATE VIEW book_benefit_campaign_view AS
      SELECT id, campaign_key FROM book_benefit_campaigns`)
    await connection.query(`CREATE FUNCTION book_benefit_campaign_count() RETURNS INTEGER
      READS SQL DATA RETURN (SELECT COUNT(*) FROM book_benefit_campaigns)`)
    await connection.query(`CREATE EVENT book_benefit_campaign_event
      ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 DAY
      DO SELECT COUNT(*) FROM book_benefit_campaigns`)
    actual = await collectBookBenefitSchemaManifest(connection, { schemaName: names.partial })
    for (const section of ['triggers', 'views', 'routines', 'events']) {
      assert.equal(actual.sections[section].length, 1, `${section} must include the related object`)
    }
    assert.equal(classifyBookBenefitSchemaManifest(actual, expected007, expected008), 'partial_mismatch')
  } finally {
    await connection.end()
  }
}

async function testNameOnlyTrigger(config, databaseName, expected007, expected008) {
  const connection = await createDatabaseConnection(config, databaseName)
  try {
    await connection.query('CREATE TABLE unrelated_business_table (id BIGINT NOT NULL PRIMARY KEY, marker INT NOT NULL)')
    await connection.query(`CREATE TRIGGER book_benefit_unknown_trigger
      BEFORE INSERT ON unrelated_business_table
      FOR EACH ROW SET NEW.marker = NEW.marker`)
    const actual = await collectBookBenefitSchemaManifest(connection, { schemaName: databaseName })
    assert.equal(actual.sections.triggers.length, 1)
    assert.equal(actual.sections.triggers[0].TRIGGER_NAME, 'book_benefit_unknown_trigger')
    assert.equal(actual.sections.triggers[0].EVENT_OBJECT_TABLE, 'unrelated_business_table')
    assert.deepEqual(actual.sections.triggers[0].RELATED_OBJECTS, [])
    const classification = classifyBookBenefitSchemaManifest(actual, expected007, expected008)
    assert.equal(classification, 'partial_mismatch')
    assert.equal(exitCodeForBookBenefitSchemaClassification(classification), 1)
  } finally {
    await connection.end()
  }
}

function testCleanupHelpers() {
  const primary = new Error('PASSWORD_SENTINEL_DO_NOT_PRINT')
  primary.code = 'SAFE_PRIMARY'
  primary.sqlMessage = 'CONNECTION_STRING_SENTINEL_DO_NOT_PRINT'
  const cleanup = new Error('CLEANUP_PASSWORD_SENTINEL_DO_NOT_PRINT')
  cleanup.code = 'SAFE_CLEANUP'
  const attached = attachBookBenefitCleanupErrors(primary, [cleanup])
  const output = formatBookBenefitMysqlTestError(attached, {
    heading: 'Book-benefit schema manifest integration test failed.'
  })
  assert.match(output, /SAFE_PRIMARY/)
  assert.match(output, /SAFE_CLEANUP/)
  assert(!output.includes('PASSWORD_SENTINEL'))
  assert(!output.includes('CONNECTION_STRING_SENTINEL'))
  assert.equal(attached.cleanupErrors.length, 1)
}

async function main() {
  testCleanupHelpers()
  const config = readBookBenefitMysqlTestConfig(process.env, {
    prefix: 'BOOK_BENEFIT_MANIFEST_TEST',
    confirmation: CONFIRMATION,
    label: 'book-benefit manifest'
  })
  const suffix = crypto.randomBytes(6).toString('hex')
  const names = Object.fromEntries(
    ['expected', 'actual', 'other', 'legacy', 'partial', 'trigger_only', 'cleanup']
      .map((kind) => [kind, `book_benefit_manifest_${kind}_${suffix}`])
  )
  for (const databaseName of Object.values(names)) assert.match(databaseName, DATABASE_PATTERN)

  const [phoneBindingsSql, migration007, release007, migration008, release008] = await Promise.all([
    readFile(phoneBindingsUrl, 'utf8'),
    readFile(canonical007Url, 'utf8'), readFile(release007Url, 'utf8'),
    readFile(canonical008Url, 'utf8'), readFile(release008Url, 'utf8')
  ])
  assertBookBenefitMigrationCopies(migration007, release007, '007')
  assertBookBenefitMigrationCopies(migration008, release008, '008')

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
    const mysqlVersion = await verifyBookBenefitMysqlTestServer(rootConnection)
    for (const databaseName of Object.values(names)) {
      await createOwnedBookBenefitDatabase(rootConnection, databaseName, ownedDatabases, DATABASE_PATTERN)
    }
    const { expected007, expected008 } = await buildExpectedManifests(
      config, names.expected, phoneBindingsSql, migration007, migration008
    )
    const actual007 = await buildActual007(
      config, names.actual, phoneBindingsSql, migration007, expected007, expected008
    )
    const actual008 = await buildOther008(
      config, names.other, phoneBindingsSql, migration007, migration008, expected007, expected008
    )
    await testPristineAndLegacy(config, names, expected007, expected008)
    await testPartialAndExtraObjects(config, names, phoneBindingsSql, migration007, expected007, expected008)
    await testNameOnlyTrigger(config, names.trigger_only, expected007, expected008)
    result = {
      mysqlVersion,
      expected007: summarizeBookBenefitSchemaManifest(expected007),
      expected008: summarizeBookBenefitSchemaManifest(expected008),
      actual007Classification: classifyBookBenefitSchemaManifest(actual007, expected007, expected008),
      actual008Classification: classifyBookBenefitSchemaManifest(actual008, expected007, expected008)
    }
  } catch (error) {
    primaryError = error
  } finally {
    const cleanupErrors = []
    for (const databaseName of [...ownedDatabases]) {
      try {
        await dropOwnedBookBenefitDatabase(rootConnection, config, {
          databaseName,
          ownedDatabases,
          databasePattern: DATABASE_PATTERN,
          confirmation: CONFIRMATION
        })
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      const placeholders = Object.values(names).map(() => '?').join(', ')
      const [remaining] = await rootConnection.query(
        `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME IN (${placeholders})`,
        Object.values(names)
      )
      assert.equal(remaining.length, 0, 'owned manifest test databases remain after cleanup')
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await rootConnection.end()
    } catch (error) {
      cleanupErrors.push(error)
    }
    primaryError = attachBookBenefitCleanupErrors(primaryError, cleanupErrors, {
      heading: 'Book-benefit schema manifest integration test failed.'
    })
  }

  if (primaryError) throw primaryError
  console.log('book-benefit schema manifest MySQL 8.0.46 integration tests passed')
  console.log(JSON.stringify({ ...result, testDatabasesCleaned: true }, null, 2))
}

try {
  await main()
} catch (error) {
  process.exitCode = 1
  let output = 'Book-benefit schema manifest integration test failed.\nError details unavailable.'
  try {
    output = formatBookBenefitMysqlTestError(error, {
      heading: 'Book-benefit schema manifest integration test failed.'
    })
  } catch {
    // Retain the fixed safe fallback.
  }
  process.stderr.write(`${output}\n`)
}
