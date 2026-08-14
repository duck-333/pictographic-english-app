import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sqlUrl = new URL('./book-benefit-production-preflight.sql', import.meta.url)
const packageUrl = new URL('../package.json', import.meta.url)
const sqlBytes = await readFile(sqlUrl)
const sql = sqlBytes.toString('utf8')
const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'))

const CLASSIFICATIONS = Object.freeze([
  'PRISTINE_CANDIDATE',
  'NON_PRISTINE_REVIEW_REQUIRED',
  'UNKNOWN_STOP'
])

const COUNT_FIELDS = Object.freeze([
  'prefix_table_view_count',
  'target_legacy_table_view_count',
  'phone_column_count',
  'phone_index_count',
  'related_view_count',
  'related_trigger_count',
  'related_routine_count',
  'related_event_count'
])

const HIDDEN_FIELDS = Object.freeze([
  'hidden_view_count',
  'hidden_trigger_count',
  'hidden_routine_count',
  'hidden_event_count'
])

const RESULT_FIELDS = Object.freeze([
  'query_protocol_version',
  'server_version_compatible',
  'schema_count',
  ...COUNT_FIELDS,
  ...HIDDEN_FIELDS,
  'classification'
])

function occurrences(value, expression) {
  return [...value.matchAll(expression)].length
}

function classifyMetrics(metrics) {
  const numericFields = [
    'query_protocol_version',
    'server_version_compatible',
    'schema_count',
    ...COUNT_FIELDS,
    ...HIDDEN_FIELDS
  ]
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return 'UNKNOWN_STOP'
  if (!numericFields.every((field) => Number.isSafeInteger(metrics[field]) && metrics[field] >= 0)) {
    return 'UNKNOWN_STOP'
  }
  if (metrics.query_protocol_version !== 1 ||
      metrics.server_version_compatible !== 1 ||
      metrics.schema_count !== 1 ||
      HIDDEN_FIELDS.some((field) => metrics[field] !== 0)) return 'UNKNOWN_STOP'
  if (COUNT_FIELDS.some((field) => metrics[field] !== 0)) return 'NON_PRISTINE_REVIEW_REQUIRED'
  return 'PRISTINE_CANDIDATE'
}

function parseBatchOutput(output, { clientExitCode = 0 } = {}) {
  if (clientExitCode !== 0 || typeof output !== 'string') {
    return { classification: 'UNKNOWN_STOP', exitCode: 1, unknownCode: 'CLIENT_OR_OUTPUT_ERROR' }
  }
  const lines = output.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.length > 0)
  const marker = 'BOOK_BENEFIT_PRODUCTION_PREFLIGHT_COMPLETE'
  if (lines.filter((line) => line === marker).length !== 1 || lines.at(-1) !== marker) {
    return { classification: 'UNKNOWN_STOP', exitCode: 1, unknownCode: 'COMPLETION_MARKER_MISSING' }
  }
  if (lines.length !== 4 || lines[2] !== 'completion_marker') {
    return { classification: 'UNKNOWN_STOP', exitCode: 1, unknownCode: 'OUTPUT_FRAME_INVALID' }
  }
  const headers = lines[0].split('\t')
  const values = lines[1].split('\t')
  if (headers.length !== RESULT_FIELDS.length || values.length !== RESULT_FIELDS.length ||
      headers.some((header, index) => header !== RESULT_FIELDS[index])) {
    return { classification: 'UNKNOWN_STOP', exitCode: 1, unknownCode: 'RESULT_COLUMNS_INVALID' }
  }
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]))
  const metrics = Object.fromEntries(
    RESULT_FIELDS.filter((field) => field !== 'classification')
      .map((field) => [field, /^(0|[1-9][0-9]*)$/.test(row[field]) ? Number(row[field]) : NaN])
  )
  const classification = classifyMetrics(metrics)
  if (!CLASSIFICATIONS.includes(row.classification) || row.classification !== classification) {
    return { classification: 'UNKNOWN_STOP', exitCode: 1, unknownCode: 'CLASSIFICATION_INVALID' }
  }
  return {
    classification,
    exitCode: classification === 'PRISTINE_CANDIDATE' ? 0 : 1,
    unknownCode: classification === 'UNKNOWN_STOP' ? 'PREFLIGHT_UNKNOWN' : null
  }
}

function pristineMetrics(overrides = {}) {
  return {
    query_protocol_version: 1,
    server_version_compatible: 1,
    schema_count: 1,
    ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])),
    ...Object.fromEntries(HIDDEN_FIELDS.map((field) => [field, 0])),
    ...overrides
  }
}

function renderBatch(metrics, classification = classifyMetrics(metrics)) {
  const row = { ...metrics, classification }
  return `${RESULT_FIELDS.join('\t')}\n${RESULT_FIELDS.map((field) => row[field]).join('\t')}\ncompletion_marker\nBOOK_BENEFIT_PRODUCTION_PREFLIGHT_COMPLETE\n`
}

function testSqlArtifact() {
  assert(sqlBytes.length > 0)
  assert.notEqual(sqlBytes[0], 0xef, 'SQL must not contain a UTF-8 BOM')
  assert(!sql.includes('\r'), 'SQL must use LF line endings')
  assert(sql.endsWith('\n') && !sql.endsWith('\n\n'), 'SQL must have exactly one final LF')
  assert.equal(Buffer.from(sql, 'utf8').compare(sqlBytes), 0, 'SQL must be valid UTF-8')

  assert.equal(occurrences(sql, /START\s+TRANSACTION\s+READ\s+ONLY\s*;/gi), 1)
  assert.equal(occurrences(sql, /\bCOMMIT\s*;/gi), 1)
  assert.equal(occurrences(sql, /BOOK_BENEFIT_PRODUCTION_PREFLIGHT_COMPLETE/g), 1)
  assert.equal(occurrences(sql, /query_protocol_version/g), 1)
  assert.equal(occurrences(sql, /'baxiaota'/g), 1, 'schema must be one fixed literal')
  assert.match(sql, /zero-object result does not prove complete metadata visibility/i)
  assert.match(sql, /independently approved/i)

  const fromJoinTargets = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_.]+)/gi)]
    .map((match) => match[1].toUpperCase())
  const allowedCtes = new Set(['PREFLIGHT_CONSTANTS', 'PREFLIGHT_METRICS', 'PREFLIGHT_CLASSIFICATION'])
  for (const target of fromJoinTargets) {
    assert(
      target.startsWith('INFORMATION_SCHEMA.') || allowedCtes.has(target),
      `unexpected FROM/JOIN target: ${target}`
    )
  }
  assert(fromJoinTargets.some((target) => target === 'INFORMATION_SCHEMA.SCHEMATA'))
  for (const table of ['TABLES', 'COLUMNS', 'STATISTICS', 'VIEWS', 'TRIGGERS', 'ROUTINES', 'EVENTS']) {
    assert(fromJoinTargets.includes(`INFORMATION_SCHEMA.${table}`), `${table} check is required`)
  }

  assert(!/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|CALL|PREPARE|EXECUTE|DEALLOCATE|LOCK|UNLOCK)\b/i.test(sql))
  assert(!/\b(?:SHOW\s+CREATE\s+TABLE|SHOW\s+GRANTS|PROCESSLIST|mysql\.user|transaction_read_only)\b/i.test(sql))
  assert(!/\b(?:KEY_COLUMN_USAGE|REFERENTIAL_CONSTRAINTS|TABLE_CONSTRAINTS|CHECK_CONSTRAINTS)\b/i.test(sql))
  assert(!/\b(?:target_columns|target_statistics|metadata_sections_completed)\b/i.test(sql))
  assert(!/\b(?:PASSWORD|USERNAME|HOST|PORT|SOCKET|MYSQL_PWD|CONNECTION STRING)\b/i.test(sql))
  assert(!/--force|-p[^\s]/i.test(sql))

  const finalProjection = sql.match(/SELECT\s+1 AS query_protocol_version,[\s\S]*?FROM preflight_classification;/i)
  assert(finalProjection, 'fixed result projection is required')
  assert(!/DEFINITION|ACTION_STATEMENT|COMMENT|CHECK_CLAUSE|HASH/i.test(finalProjection[0]))
  assert.match(sql, /VIEW_DEFINITION IS NULL/)
  assert.match(sql, /ACTION_STATEMENT IS NULL/)
  assert.match(sql, /ROUTINE_DEFINITION IS NULL/)
  assert.match(sql, /EVENT_DEFINITION IS NULL/)
  assert.match(sql, /REGEXP_LIKE\(COALESCE\(v\.VIEW_DEFINITION/)
  assert.match(sql, /REGEXP_LIKE\(COALESCE\(tr\.ACTION_STATEMENT/)

  const literals = [...new Set([...sql.matchAll(/'(PRISTINE_CANDIDATE|NON_PRISTINE_REVIEW_REQUIRED|UNKNOWN_STOP)'/g)]
    .map((match) => match[1]))].sort()
  assert.deepEqual(literals, [...CLASSIFICATIONS].sort())

  assert.match(sql, /server_version_compatible\s*<>\s*1/i)
  assert.match(sql, /schema_count\s*<>\s*1/i)
  for (const field of HIDDEN_FIELDS) {
    assert.match(sql, new RegExp(`${field}\\s*<>\\s*0`, 'i'), `${field} must force UNKNOWN_STOP`)
  }
  for (const field of COUNT_FIELDS) {
    assert.match(sql, new RegExp(`${field}\\s*<>\\s*0`, 'i'), `${field} must prevent pristine`)
  }
  const pristineBranch = sql.match(/WHEN[\s\S]*?THEN 'NON_PRISTINE_REVIEW_REQUIRED'[\s\S]*?ELSE 'PRISTINE_CANDIDATE'/i)
  assert(pristineBranch, 'pristine must be the final branch after every nonzero count check')
}

function testPackageEntry() {
  assert.equal(
    packageJson.scripts['test:book-benefit-production-preflight'],
    'node scripts/test-book-benefit-production-preflight.mjs'
  )
}

function testClassificationAndProtocol() {
  const pristine = pristineMetrics()
  assert.equal(classifyMetrics(pristine), 'PRISTINE_CANDIDATE')
  assert.deepEqual(parseBatchOutput(renderBatch(pristine)), {
    classification: 'PRISTINE_CANDIDATE', exitCode: 0, unknownCode: null
  })

  for (const field of COUNT_FIELDS) {
    const metrics = pristineMetrics({ [field]: 1 })
    assert.equal(classifyMetrics(metrics), 'NON_PRISTINE_REVIEW_REQUIRED')
    assert.equal(parseBatchOutput(renderBatch(metrics)).exitCode, 1)
  }
  for (const field of HIDDEN_FIELDS) {
    const metrics = pristineMetrics({ [field]: 1 })
    assert.equal(classifyMetrics(metrics), 'UNKNOWN_STOP')
    assert.equal(parseBatchOutput(renderBatch(metrics)).exitCode, 1)
  }
  for (const overrides of [
    { server_version_compatible: 0 },
    { schema_count: 0 },
    { schema_count: 2 },
    { query_protocol_version: 2 }
  ]) {
    assert.equal(classifyMetrics(pristineMetrics(overrides)), 'UNKNOWN_STOP')
  }

  const complete = renderBatch(pristine)
  assert.equal(parseBatchOutput(complete.replace(/BOOK_BENEFIT_PRODUCTION_PREFLIGHT_COMPLETE\n/, '')).classification, 'UNKNOWN_STOP')
  assert.equal(parseBatchOutput(complete.slice(0, 40)).classification, 'UNKNOWN_STOP')
  assert.equal(parseBatchOutput(`${complete}unexpected\n`).classification, 'UNKNOWN_STOP')
  assert.equal(parseBatchOutput(complete.replace('completion_marker', 'marker')).classification, 'UNKNOWN_STOP')
  assert.equal(parseBatchOutput(complete, { clientExitCode: 1 }).classification, 'UNKNOWN_STOP')
  assert.equal(parseBatchOutput(renderBatch(pristine, 'NON_PRISTINE_REVIEW_REQUIRED')).classification, 'UNKNOWN_STOP')
  assert.equal(parseBatchOutput(complete.replace('schema_count', 'schema_total')).classification, 'UNKNOWN_STOP')
  assert.equal(parseBatchOutput(complete.replace('\t1\t1\t', '\tNaN\t1\t')).classification, 'UNKNOWN_STOP')
}

testSqlArtifact()
testPackageEntry()
testClassificationAndProtocol()

console.log('book-benefit minimal production preflight static tests passed')
