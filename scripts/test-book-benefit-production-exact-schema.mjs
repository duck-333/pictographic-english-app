import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  BOOK_BENEFIT_SCHEMA_PLACEHOLDER,
  createEmptyBookBenefitSchemaManifest,
  normalizeBookBenefitSchemaManifest
} from './book-benefit-schema-manifest.mjs'
import { readBookBenefitMysqlTestConfig } from './book-benefit-mysql-test-support.mjs'
import {
  assertSchemaNeutralExpectedArtifact,
  buildBookBenefitExpectedArtifact,
  compareBookBenefitExpectedArtifact,
  executeProductionExactSchema,
  formatProductionExactSchemaOutput,
  parseBookBenefitExpectedArtifact,
  parseExpectedArtifactWriteMode,
  parseProductionExactSchemaArgs,
  runProductionExactSchemaCli,
  serializeBookBenefitExpectedArtifact
} from './book-benefit-production-exact-schema.mjs'

const productionUrl = new URL('./book-benefit-production-exact-schema.mjs', import.meta.url)
const integrationUrl = new URL('./test-book-benefit-schema-manifest-mysql-integration.mjs', import.meta.url)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function triggerManifest(name) {
  const manifest = createEmptyBookBenefitSchemaManifest()
  manifest.sections.triggers.push({
    TRIGGER_SCHEMA: BOOK_BENEFIT_SCHEMA_PLACEHOLDER,
    TRIGGER_NAME: name,
    EVENT_MANIPULATION: 'INSERT',
    EVENT_OBJECT_SCHEMA: BOOK_BENEFIT_SCHEMA_PLACEHOLDER,
    EVENT_OBJECT_TABLE: 'unrelated_business_table',
    ACTION_TIMING: 'BEFORE',
    ACTION_ORIENTATION: 'ROW',
    RELATED_OBJECTS: []
  })
  return normalizeBookBenefitSchemaManifest(manifest, {
    schemaName: BOOK_BENEFIT_SCHEMA_PLACEHOLDER
  })
}

const expected007 = triggerManifest('book_benefit_expected_007')
const expected008 = triggerManifest('book_benefit_expected_008')
const artifact = buildBookBenefitExpectedArtifact(expected007, expected008)

function fakeConnection({ failCollection = false } = {}) {
  const calls = []
  return {
    calls,
    ended: false,
    async query(sql) {
      calls.push(sql)
    },
    async end() {
      this.ended = true
    },
    failCollection
  }
}

async function execute(actual, expectedState, overrides = {}) {
  const connection = overrides.connection || fakeConnection()
  let connectionConfig = null
  const result = await executeProductionExactSchema({
    expectedState,
    socketPath: '/run/mysqld/mysqld.sock',
    user: 'schema_reader'
  }, {
    loadExpectedArtifact: async () => artifact,
    stdinIsTTY: true,
    readPassword: async () => 'PRIVATE_PASSWORD_SENTINEL',
    createConnection: async (config) => {
      connectionConfig = config
      return connection
    },
    collectManifest: async () => {
      if (overrides.throwCollection) throw new Error('PRIVATE_SQL_SENTINEL')
      return clone(actual)
    },
    registerSigint: () => () => {},
    ...overrides.dependencies
  })
  return { result, connection, connectionConfig }
}

function testArtifactContract() {
  assert.deepEqual(Object.keys(artifact), [
    'formatVersion',
    'expectedRevised007',
    'expectedRevised008'
  ])
  assert.equal(artifact.formatVersion, 1)
  const serialized = serializeBookBenefitExpectedArtifact(artifact)
  assert(!serialized.startsWith('\ufeff'))
  assert(!serialized.includes('\r'))
  assert(serialized.endsWith('\n'))
  assert(!serialized.endsWith('\n\n'))
  assert.deepEqual(parseBookBenefitExpectedArtifact(serialized), artifact)

  const extraField = { ...artifact, unexpected: true }
  assert.throws(() => assertSchemaNeutralExpectedArtifact(extraField), /EXPECTED_ARTIFACT_INVALID/)
  assert.throws(() => parseBookBenefitExpectedArtifact(`\ufeff${serialized}`), /ENCODING_INVALID/)
  assert.throws(() => parseBookBenefitExpectedArtifact(serialized.replace(/\n/g, '\r\n')), /ENCODING_INVALID/)

  for (const sentinel of [
    'baxiaota',
    'book_benefit_manifest_expected_abcdef123456',
    '127.0.0.1',
    '/var/run/mysql.sock',
    'schema_audit_ro',
    'C:\\private\\artifact.json'
  ]) {
    const unsafe = clone(artifact)
    unsafe.expectedRevised007.sections.triggers[0].TRIGGER_NAME = sentinel
    assert.throws(() => assertSchemaNeutralExpectedArtifact(unsafe), /NOT_SCHEMA_NEUTRAL|NOT_NORMALIZED/)
  }
  const runtimeAccount = clone(artifact)
  runtimeAccount.expectedRevised007.sections.triggers[0].TRIGGER_NAME = 'local_generation_account'
  assert.throws(() => assertSchemaNeutralExpectedArtifact(runtimeAccount, {
    forbiddenValues: ['local_generation_account']
  }), /NOT_SCHEMA_NEUTRAL/)

  const mismatch = clone(artifact)
  mismatch.expectedRevised008 = clone(expected007)
  assert.throws(() => compareBookBenefitExpectedArtifact(artifact, mismatch), /EXPECTED_ARTIFACT_MISMATCH/)
}

function testArgumentGates() {
  assert.equal(parseExpectedArtifactWriteMode([]), false)
  assert.equal(parseExpectedArtifactWriteMode(['--write-expected-artifact']), true)
  assert.throws(() => parseExpectedArtifactWriteMode(['--write-expected-artifact', 'other.json']))
  assert.throws(() => parseExpectedArtifactWriteMode(['--output', 'other.json']))

  const parsed = parseProductionExactSchemaArgs([
    '--expected-state', 'revised-007',
    '--socket', '/run/mysqld/mysqld.sock',
    '--user', 'schema_reader'
  ])
  assert.equal(parsed.expectedState, 'revised-007')
  for (const args of [
    ['--expected-state', 'revised-007', '--host', '127.0.0.1', '--socket', '/run/mysql.sock', '--user', 'reader'],
    ['--expected-state', 'revised-007', '--port', '3306', '--socket', '/run/mysql.sock', '--user', 'reader'],
    ['--expected-state', 'revised-007', '--schema', 'baxiaota', '--socket', '/run/mysql.sock', '--user', 'reader'],
    ['--expected-state', 'revised-007', '--socket', 'C:\\mysql.sock', '--user', 'reader'],
    ['--expected-state', 'revised-009', '--socket', '/run/mysql.sock', '--user', 'reader']
  ]) assert.throws(() => parseProductionExactSchemaArgs(args), /ARGUMENT_INVALID/)

  const baseEnv = {
    BOOK_BENEFIT_MANIFEST_TEST_DB_PORT: '3308',
    BOOK_BENEFIT_MANIFEST_TEST_DB_USER: 'local_test',
    BOOK_BENEFIT_MANIFEST_TEST_DB_PASSWORD: 'local_only',
    BOOK_BENEFIT_MANIFEST_TEST_ALLOW_DESTRUCTIVE: 'local-docker-book-benefit-manifest-only'
  }
  assert.throws(() => readBookBenefitMysqlTestConfig({
    ...baseEnv,
    BOOK_BENEFIT_MANIFEST_TEST_DB_HOST: '127.0.0.2'
  }, {
    prefix: 'BOOK_BENEFIT_MANIFEST_TEST',
    confirmation: 'local-docker-book-benefit-manifest-only'
  }), /127\.0\.0\.1/)
  assert.throws(() => readBookBenefitMysqlTestConfig({
    ...baseEnv,
    BOOK_BENEFIT_MANIFEST_TEST_DB_HOST: '127.0.0.1',
    BOOK_BENEFIT_MANIFEST_TEST_DB_PORT: '3306'
  }, {
    prefix: 'BOOK_BENEFIT_MANIFEST_TEST',
    confirmation: 'local-docker-book-benefit-manifest-only'
  }), /3308/)
}

async function testClassificationMatrix() {
  let execution = await execute(expected007, 'revised-007')
  assert.equal(execution.result.actualClassification, 'exact_revised_007')
  assert.equal(execution.result.pass, true)
  assert.equal(execution.connectionConfig.database, 'baxiaota')
  assert.equal(execution.connectionConfig.socketPath, '/run/mysqld/mysqld.sock')
  assert(!Object.hasOwn(execution.connectionConfig, 'host'))
  assert(!Object.hasOwn(execution.connectionConfig, 'port'))

  execution = await execute(expected008, 'revised-008')
  assert.equal(execution.result.actualClassification, 'exact_revised_008')
  assert.equal(execution.result.pass, true)

  execution = await execute(expected008, 'revised-007')
  assert.equal(execution.result.actualClassification, 'exact_revised_008')
  assert.equal(execution.result.pass, false)
  execution = await execute(expected007, 'revised-008')
  assert.equal(execution.result.actualClassification, 'exact_revised_007')
  assert.equal(execution.result.pass, false)

  const pristine = createEmptyBookBenefitSchemaManifest()
  execution = await execute(pristine, 'revised-007')
  assert.equal(execution.result.actualClassification, 'pristine')
  assert.equal(execution.result.pass, false)

  const partial = clone(expected007)
  partial.sections.triggers.push(clone(expected008.sections.triggers[0]))
  execution = await execute(partial, 'revised-007')
  assert.equal(execution.result.actualClassification, 'partial_mismatch')
  assert.equal(execution.result.pass, false)

  execution = await execute({ collectionState: 'unknown', code: 'SAFE' }, 'revised-007')
  assert.equal(execution.result.actualClassification, 'unknown')
  assert.equal(execution.result.collectorState, 'unknown')
  assert.equal(execution.result.pass, false)
  assert.equal(execution.result.safetyErrorCategory, 'COLLECTOR_UNKNOWN')
}

async function testCredentialAndCleanupBoundaries() {
  let passwordRead = false
  let result = await executeProductionExactSchema({
    expectedState: 'revised-007',
    socketPath: '/run/mysql.sock',
    user: 'reader'
  }, {
    loadExpectedArtifact: async () => artifact,
    stdinIsTTY: false,
    readPassword: async () => { passwordRead = true; return 'secret' }
  })
  assert.equal(result.pass, false)
  assert.equal(result.safetyErrorCategory, 'TTY_REQUIRED')
  assert.equal(passwordRead, false)

  const connection = fakeConnection()
  const execution = await execute(expected007, 'revised-007', {
    connection,
    throwCollection: true
  })
  assert.equal(execution.result.pass, false)
  assert.equal(execution.result.safetyErrorCategory, 'COLLECTION_FAILED')
  assert.deepEqual(connection.calls, ['START TRANSACTION READ ONLY', 'ROLLBACK'])
  assert.equal(connection.ended, true)

  const interruptedConnection = fakeConnection()
  let sigintHandler
  const interrupted = await execute(expected007, 'revised-007', {
    connection: interruptedConnection,
    dependencies: {
      registerSigint(handler) {
        sigintHandler = handler
        return () => {}
      },
      collectManifest: async () => {
        sigintHandler()
        return expected007
      }
    }
  })
  assert.equal(interrupted.result.pass, false)
  assert.equal(interrupted.result.safetyErrorCategory, 'INTERRUPTED')
  assert.deepEqual(interruptedConnection.calls, ['START TRANSACTION READ ONLY', 'ROLLBACK'])
  assert.equal(interruptedConnection.ended, true)

  result = await executeProductionExactSchema({
    expectedState: 'revised-007',
    socketPath: '/run/mysql.sock',
    user: 'reader'
  }, {
    loadExpectedArtifact: async () => { const error = new Error('missing'); error.code = 'EXPECTED_ARTIFACT_GENERATION_REQUIRED'; throw error },
    stdinIsTTY: true
  })
  assert.equal(result.safetyErrorCategory, 'EXPECTED_ARTIFACT_GENERATION_REQUIRED')
}

async function testOutputWhitelist() {
  const lines = formatProductionExactSchemaOutput({
    expectedState: 'revised-007',
    actualClassification: 'partial_mismatch',
    collectorState: 'ready',
    pass: false,
    safetyErrorCategory: 'NONE'
  }).trimEnd().split('\n')
  assert.deepEqual(lines.map((line) => line.split('=')[0]), [
    'EXACT_SCHEMA_PROTOCOL_VERSION',
    'EXPECTED_STATE',
    'ACTUAL_CLASSIFICATION',
    'COLLECTOR_STATE',
    'EXACT_SCHEMA_PASS',
    'SAFETY_ERROR_CATEGORY'
  ])

  let output = ''
  const exitCode = await runProductionExactSchemaCli([
    '--expected-state', 'revised-007',
    '--socket', '/run/mysql.sock',
    '--user', 'reader'
  ], {
    stdout: { write(value) { output += value } },
    loadExpectedArtifact: async () => artifact,
    stdinIsTTY: true,
    readPassword: async () => 'PRIVATE_PASSWORD_SENTINEL',
    createConnection: async () => fakeConnection(),
    collectManifest: async () => expected007,
    registerSigint: () => () => {}
  })
  assert.equal(exitCode, 0)
  assert(!/PRIVATE|password|schema_reader|mysql\.sock|\/run\//i.test(output))
  assert.equal(output.trimEnd().split('\n').length, 6)
}

async function testStaticSafety() {
  const [source, integrationSource] = await Promise.all([
    readFile(productionUrl, 'utf8'),
    readFile(integrationUrl, 'utf8')
  ])
  assert.doesNotMatch(source, /\b(?:CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|REPLACE)\b/i)
  assert.match(source, /START TRANSACTION READ ONLY/)
  assert.match(source, /connection\.query\('ROLLBACK'\)/)
  assert.match(source, /connection\.end\(\)/)
  assert.doesNotMatch(source, /process\.env|\.env|login-path|option file|host\s*:|port\s*:/i)
  assert.match(integrationSource, /parseExpectedArtifactWriteMode\(process\.argv\.slice\(2\)\)/)
  assert.match(integrationSource, /if \(writeExpectedArtifact\)/)
  assert.match(integrationSource, /compareBookBenefitExpectedArtifact\(generatedArtifact, committedArtifact\)/)
  assert.doesNotMatch(integrationSource, /--output|outputPath|artifactPath/)
}

testArtifactContract()
testArgumentGates()
await testClassificationMatrix()
await testCredentialAndCleanupBoundaries()
await testOutputWhitelist()
await testStaticSafety()

console.log('book-benefit production exact schema fake/static tests passed')
