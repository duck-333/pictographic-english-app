import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  BOOK_BENEFIT_MANIFEST_SECTIONS,
  BookBenefitSchemaManifestError,
  classifyBookBenefitSchemaManifest,
  collectBookBenefitSchemaManifest,
  createEmptyBookBenefitSchemaManifest,
  exitCodeForBookBenefitSchemaClassification,
  hashBookBenefitSchemaManifest,
  normalizeBookBenefitSchemaManifest,
  serializeBookBenefitSchemaManifest,
  summarizeBookBenefitSchemaManifest,
  verifyBookBenefitSchemaMetadataSupport
} from './book-benefit-schema-manifest.mjs'
import {
  assertBookBenefitMigrationCopies,
  createOwnedBookBenefitDatabase,
  dropOwnedBookBenefitDatabase,
  extractBookBenefitExact007Statements
} from './book-benefit-mysql-test-support.mjs'

const canonical007Url = new URL('../database/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)
const phoneBindingsUrl = new URL('../database/migrations/001_create_user_phone_bindings.sql', import.meta.url)
const release007Url = new URL('../server/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)
const canonical008Url = new URL('../database/migrations/008_extend_book_benefit_issuance_review.sql', import.meta.url)
const release008Url = new URL('../server/migrations/008_extend_book_benefit_issuance_review.sql', import.meta.url)

function clone(value) {
  return structuredClone(value)
}

function tableRow(schema, name, type = 'BASE TABLE') {
  return {
    TABLE_SCHEMA: schema,
    TABLE_NAME: name,
    TABLE_TYPE: type,
    ENGINE: type === 'BASE TABLE' ? 'InnoDB' : null,
    TABLE_COLLATION: type === 'BASE TABLE' ? 'utf8mb4_unicode_ci' : null
  }
}

function columnRow(schema, table, name, ordinal, overrides = {}) {
  return {
    TABLE_SCHEMA: schema,
    TABLE_NAME: table,
    COLUMN_NAME: name,
    ORDINAL_POSITION: ordinal,
    COLUMN_DEFAULT: null,
    IS_NULLABLE: 'NO',
    DATA_TYPE: 'varchar',
    COLUMN_TYPE: 'varchar(64)',
    CHARACTER_SET_NAME: 'utf8mb4',
    COLLATION_NAME: 'utf8mb4_unicode_ci',
    COLUMN_KEY: '',
    EXTRA: '',
    GENERATION_EXPRESSION: '',
    SRS_ID: null,
    COLUMN_COMMENT: '',
    ...overrides
  }
}

function statisticRow(schema, table, index, sequence, column, overrides = {}) {
  return {
    TABLE_SCHEMA: schema,
    TABLE_NAME: table,
    NON_UNIQUE: 0,
    INDEX_SCHEMA: schema,
    INDEX_NAME: index,
    SEQ_IN_INDEX: sequence,
    COLUMN_NAME: column,
    COLLATION: 'A',
    SUB_PART: null,
    NULLABLE: '',
    INDEX_TYPE: 'BTREE',
    IS_VISIBLE: 'YES',
    EXPRESSION: null,
    ...overrides
  }
}

function phoneBindingFingerprint(schema) {
  return {
    columns: [
      columnRow(schema, 'user_phone_bindings', 'campaign_phone_identity_hash', 14, {
        DATA_TYPE: 'binary',
        COLUMN_TYPE: 'binary(32)',
        CHARACTER_SET_NAME: null,
        COLLATION_NAME: null,
        IS_NULLABLE: 'YES',
        COLUMN_COMMENT: 'Stable campaign phone identity HMAC; populated only after verified phone input.'
      }),
      columnRow(schema, 'user_phone_bindings', 'campaign_phone_hash_version', 15, {
        DATA_TYPE: 'varchar',
        COLUMN_TYPE: 'varchar(16)',
        IS_NULLABLE: 'YES',
        COLUMN_COMMENT: 'Campaign phone identity hash version, initially v1.'
      })
    ],
    statistics: [statisticRow(
      schema,
      'user_phone_bindings',
      'idx_user_phone_bindings_campaign_identity',
      1,
      'campaign_phone_identity_hash',
      { NON_UNIQUE: 1, NULLABLE: 'YES' }
    )]
  }
}

function manifestWith(schemaName, { tableName = 'book_benefit_campaigns' } = {}) {
  const empty = createEmptyBookBenefitSchemaManifest()
  const phone = phoneBindingFingerprint(schemaName)
  return normalizeBookBenefitSchemaManifest({
    sourceSchema: schemaName,
    sections: {
      ...empty.sections,
      tables: [tableRow(schemaName, tableName)],
      columns: [columnRow(schemaName, tableName, 'id', '1'), ...phone.columns],
      statistics: [statisticRow(schemaName, tableName, 'PRIMARY', '1', 'id'), ...phone.statistics]
    }
  }, { schemaName })
}

function makeExtraRow(section, name = 'book_benefit_extra') {
  if (section === 'triggers') return {
    TRIGGER_SCHEMA: '**SCHEMA**', TRIGGER_NAME: name, EVENT_MANIPULATION: 'INSERT',
    EVENT_OBJECT_SCHEMA: '**SCHEMA**', EVENT_OBJECT_TABLE: 'book_benefit_campaigns',
    ACTION_TIMING: 'BEFORE', ACTION_ORIENTATION: 'ROW', RELATED_OBJECTS: ['book_benefit_campaigns']
  }
  if (section === 'views') return {
    TABLE_SCHEMA: '**SCHEMA**', TABLE_NAME: name, CHECK_OPTION: 'NONE',
    IS_UPDATABLE: 'NO', SECURITY_TYPE: 'DEFINER', RELATED_OBJECTS: ['book_benefit_campaigns']
  }
  if (section === 'routines') return {
    ROUTINE_SCHEMA: '**SCHEMA**', ROUTINE_NAME: name, ROUTINE_TYPE: 'FUNCTION',
    DATA_TYPE: 'int', SECURITY_TYPE: 'DEFINER', RELATED_OBJECTS: ['book_benefit_campaigns']
  }
  return {
    EVENT_SCHEMA: '**SCHEMA**', EVENT_NAME: name, EVENT_TYPE: 'ONE TIME', STATUS: 'ENABLED',
    ON_COMPLETION: 'NOT PRESERVE', RELATED_OBJECTS: ['book_benefit_campaigns']
  }
}

function nameOnlyTriggerRow(schema = '**SCHEMA**') {
  return {
    TRIGGER_SCHEMA: schema,
    TRIGGER_NAME: 'book_benefit_unknown_trigger',
    EVENT_MANIPULATION: 'INSERT',
    EVENT_OBJECT_SCHEMA: schema,
    EVENT_OBJECT_TABLE: 'unrelated_business_table',
    ACTION_TIMING: 'BEFORE',
    ACTION_ORIENTATION: 'ROW',
    RELATED_OBJECTS: []
  }
}

function legacyManifest() {
  const schema = 'legacy_db'
  const manifest = createEmptyBookBenefitSchemaManifest()
  const columns = [
    'id', 'application_no', 'campaign_id', 'applicant_user_id',
    'applicant_phone_identity_hash', 'applicant_phone_hash_version', 'order_claim_type',
    'approved_order_claim_hash', 'order_claim_hash_version', 'order_channel', 'status',
    'reviewed_by', 'review_reason_code', 'reviewed_at', 'create_idempotency_key',
    'created_at', 'updated_at'
  ]
  const indexes = [
    'PRIMARY', 'uk_book_benefit_applications_no',
    'uk_book_benefit_applications_campaign_user',
    'uk_book_benefit_applications_campaign_phone',
    'uk_book_benefit_applications_campaign_order',
    'uk_book_benefit_applications_idempotency',
    'idx_book_benefit_applications_status_created'
  ]
  return normalizeBookBenefitSchemaManifest({
    sourceSchema: schema,
    sections: {
      ...manifest.sections,
      tables: [tableRow(schema, 'book_benefit_applications')],
      columns: columns.map((name, index) => columnRow(schema, 'book_benefit_applications', name, index + 1,
        name === 'order_claim_type'
          ? { DATA_TYPE: 'enum', COLUMN_TYPE: "enum('standard','manual_exception')" }
          : name === 'status'
            ? { DATA_TYPE: 'enum', COLUMN_TYPE: "enum('pending','approved','rejected','cancelled')", COLUMN_DEFAULT: 'pending' }
            : {})),
      statistics: [
        statisticRow(schema, 'book_benefit_applications', indexes[0], 1, 'id'),
        statisticRow(schema, 'book_benefit_applications', indexes[1], 1, 'application_no'),
        statisticRow(schema, 'book_benefit_applications', indexes[2], 1, 'campaign_id'),
        statisticRow(schema, 'book_benefit_applications', indexes[2], 2, 'applicant_user_id'),
        statisticRow(schema, 'book_benefit_applications', indexes[3], 1, 'campaign_id'),
        statisticRow(schema, 'book_benefit_applications', indexes[3], 2, 'applicant_phone_identity_hash'),
        statisticRow(schema, 'book_benefit_applications', indexes[4], 1, 'campaign_id'),
        statisticRow(schema, 'book_benefit_applications', indexes[4], 2, 'approved_order_claim_hash'),
        statisticRow(schema, 'book_benefit_applications', indexes[5], 1, 'create_idempotency_key'),
        statisticRow(schema, 'book_benefit_applications', indexes[6], 1, 'status', { NON_UNIQUE: 1 }),
        statisticRow(schema, 'book_benefit_applications', indexes[6], 2, 'created_at', { NON_UNIQUE: 1 })
      ]
    }
  }, { schemaName: schema })
}

function testStableManifestPureFunctions() {
  const left = manifestWith('book_benefit_manifest_a')
  const right = manifestWith('book_benefit_manifest_b')
  assert.equal(hashBookBenefitSchemaManifest(left), hashBookBenefitSchemaManifest(right))

  const serialized = serializeBookBenefitSchemaManifest(left)
  assert(serialized.endsWith('\n'))
  assert(!serialized.startsWith('\uFEFF'))
  assert(!serialized.includes('book_benefit_manifest_a'))
  assert.equal(JSON.parse(serialized).schema, '**SCHEMA**')
  assert.deepEqual(Object.keys(JSON.parse(serialized).sections), BOOK_BENEFIT_MANIFEST_SECTIONS)

  const crlf = clone(left)
  crlf.sections.columns[0].COLUMN_COMMENT = 'line one\r\nline two'
  const lf = clone(left)
  lf.sections.columns[0].COLUMN_COMMENT = 'line one\nline two'
  assert.equal(hashBookBenefitSchemaManifest(crlf), hashBookBenefitSchemaManifest(lf))

  const nullDefault = clone(left)
  const emptyDefault = clone(left)
  emptyDefault.sections.columns[0].COLUMN_DEFAULT = ''
  assert.notEqual(hashBookBenefitSchemaManifest(nullDefault), hashBookBenefitSchemaManifest(emptyDefault))

  for (const [field, initial, changed] of [
    ['COLUMN_COMMENT', '', 'comment'],
    ['GENERATION_EXPRESSION', '', '`id` + 1']
  ]) {
    const changedManifest = clone(left)
    changedManifest.sections.columns[0][field] = changed
    assert.equal(left.sections.columns[0][field], initial)
    assert.notEqual(hashBookBenefitSchemaManifest(left), hashBookBenefitSchemaManifest(changedManifest))
  }
  const expression = clone(left)
  expression.sections.statistics[0].EXPRESSION = 'lower(`id`)'
  assert.notEqual(hashBookBenefitSchemaManifest(left), hashBookBenefitSchemaManifest(expression))

  const reversed = clone(left)
  reversed.sections.tables.reverse()
  reversed.sections.columns.reverse()
  assert.equal(hashBookBenefitSchemaManifest(left), hashBookBenefitSchemaManifest(reversed))

  const unicodeOrder = clone(left)
  unicodeOrder.sections.views = [
    makeExtraRow('views', '象形'),
    makeExtraRow('views', 'alpha'),
    makeExtraRow('views', 'Alpha')
  ]
  const orderedNames = JSON.parse(serializeBookBenefitSchemaManifest(unicodeOrder))
    .sections.views.map((row) => row.TABLE_NAME)
  assert.deepEqual(orderedNames, ['Alpha', 'alpha', '象形'])

  const summary = summarizeBookBenefitSchemaManifest(left)
  assert.match(summary.sha256, /^[a-f0-9]{64}$/)
  assert.equal(summary.sectionCounts.tables, 1)
  assert(!JSON.stringify(summary).includes('comment'))
}

function testClassification() {
  const pristine = createEmptyBookBenefitSchemaManifest()
  const expected007 = manifestWith('expected_007')
  const expected008 = clone(expected007)
  expected008.sections.columns[0].COLUMN_COMMENT = '008 marker'

  assert.equal(classifyBookBenefitSchemaManifest(pristine, expected007, expected008), 'pristine')
  assert.equal(classifyBookBenefitSchemaManifest(clone(expected007), expected007, expected008), 'exact_revised_007')
  assert.equal(classifyBookBenefitSchemaManifest(clone(expected008), expected007, expected008), 'exact_revised_008')
  assert.equal(classifyBookBenefitSchemaManifest(legacyManifest(), expected007, expected008), 'legacy_application')

  const mutations = [
    (value) => value.sections.columns.pop(),
    (value) => { value.sections.columns[0].COLUMN_TYPE = 'bigint unsigned' },
    (value) => { value.sections.columns[0].COLUMN_DEFAULT = '' },
    (value) => { value.sections.columns[0].IS_NULLABLE = 'YES' },
    (value) => value.sections.statistics.pop(),
    (value) => { value.sections.statistics[0].NON_UNIQUE = 1 },
    (value) => { value.sections.statistics[0].SEQ_IN_INDEX = 2 },
    (value) => { value.sections.keyColumnUsage.push({
      CONSTRAINT_SCHEMA: '**SCHEMA**', CONSTRAINT_NAME: 'fk_changed', TABLE_SCHEMA: '**SCHEMA**',
      TABLE_NAME: 'book_benefit_campaigns', COLUMN_NAME: 'id', ORDINAL_POSITION: 1,
      POSITION_IN_UNIQUE_CONSTRAINT: null, REFERENCED_TABLE_SCHEMA: '**SCHEMA**',
      REFERENCED_TABLE_NAME: 'book_benefit_campaigns', REFERENCED_COLUMN_NAME: 'id'
    }) },
    (value) => { value.sections.checkConstraints.push({
      CONSTRAINT_SCHEMA: '**SCHEMA**', CONSTRAINT_NAME: 'ck_changed', CHECK_CLAUSE: '(`id` > 0)'
    }) },
    (value) => { value.sections.tableConstraints.push({
      CONSTRAINT_SCHEMA: '**SCHEMA**', CONSTRAINT_NAME: 'ck_changed', TABLE_SCHEMA: '**SCHEMA**',
      TABLE_NAME: 'book_benefit_campaigns', CONSTRAINT_TYPE: 'CHECK', ENFORCED: 'YES'
    }) }
  ]
  for (const mutate of mutations) {
    const actual = clone(expected007)
    mutate(actual)
    assert.equal(classifyBookBenefitSchemaManifest(actual, expected007, expected008), 'partial_mismatch')
  }

  const phoneMutations = [
    (value) => {
      value.sections.columns = value.sections.columns.filter((row) =>
        row.COLUMN_NAME !== 'campaign_phone_identity_hash')
    },
    (value) => {
      value.sections.columns.find((row) =>
        row.COLUMN_NAME === 'campaign_phone_hash_version').COLUMN_TYPE = 'varchar(32)'
    },
    (value) => {
      const row = value.sections.columns.find((item) =>
        item.COLUMN_NAME === 'campaign_phone_identity_hash')
      row.COLUMN_DEFAULT = ''
      row.IS_NULLABLE = 'NO'
      row.CHARACTER_SET_NAME = 'utf8mb4'
      row.COLLATION_NAME = 'utf8mb4_unicode_ci'
    },
    (value) => {
      value.sections.statistics = value.sections.statistics.filter((row) =>
        row.INDEX_NAME !== 'idx_user_phone_bindings_campaign_identity')
    },
    (value) => {
      const row = value.sections.statistics.find((item) =>
        item.INDEX_NAME === 'idx_user_phone_bindings_campaign_identity')
      row.NON_UNIQUE = 0
      row.COLUMN_NAME = 'campaign_phone_hash_version'
      row.SEQ_IN_INDEX = 2
    }
  ]
  for (const mutate of phoneMutations) {
    const actual = clone(expected007)
    mutate(actual)
    const classification = classifyBookBenefitSchemaManifest(actual, expected007, expected008)
    assert.equal(classification, 'partial_mismatch')
    assert.equal(exitCodeForBookBenefitSchemaClassification(classification), 1)
  }

  for (const type of ['BASE TABLE', 'VIEW']) {
    const actual = clone(expected007)
    actual.sections.tables.push(tableRow('expected_007', 'book_benefit_extra', type))
    const classification = classifyBookBenefitSchemaManifest(actual, expected007, expected008)
    assert.equal(classification, 'partial_mismatch')
    assert.equal(exitCodeForBookBenefitSchemaClassification(classification), 1)
  }
  const unknownOnly = createEmptyBookBenefitSchemaManifest()
  unknownOnly.sections.tables.push(tableRow('unknown_prefix', 'book_benefit_extra'))
  assert.equal(classifyBookBenefitSchemaManifest(unknownOnly, expected007, expected008), 'partial_mismatch')
  const legacyWithUnknown = legacyManifest()
  legacyWithUnknown.sections.tables.push(tableRow('legacy_db', 'book_benefit_extra'))
  assert.equal(
    classifyBookBenefitSchemaManifest(legacyWithUnknown, expected007, expected008),
    'partial_mismatch'
  )
  assert.equal(classifyBookBenefitSchemaManifest(
    createEmptyBookBenefitSchemaManifest(), expected007, expected008
  ), 'pristine')

  for (const section of ['triggers', 'views', 'routines', 'events']) {
    const actual = clone(expected007)
    actual.sections[section].push(makeExtraRow(section))
    assert.equal(classifyBookBenefitSchemaManifest(actual, expected007, expected008), 'partial_mismatch')
  }

  for (const expected of [expected007, expected008]) {
    const actual = clone(expected)
    actual.sections.triggers.push(nameOnlyTriggerRow())
    const classification = classifyBookBenefitSchemaManifest(actual, expected007, expected008)
    assert.equal(classification, 'partial_mismatch')
    assert.equal(exitCodeForBookBenefitSchemaClassification(classification), 1)
  }

  const abnormal = manifestWith('abnormal')
  abnormal.sections.tables[0].TABLE_TYPE = 'VIEW'
  abnormal.sections.tables[0].ENGINE = null
  abnormal.sections.tables[0].TABLE_COLLATION = null
  assert.equal(classifyBookBenefitSchemaManifest(abnormal, expected007, expected008), 'unknown')
  assert.equal(classifyBookBenefitSchemaManifest({ collectionState: 'unknown', code: 'SAFE' }), 'unknown')
  assert.equal(exitCodeForBookBenefitSchemaClassification('pristine'), 0)
  assert.equal(exitCodeForBookBenefitSchemaClassification('exact_revised_007'), 0)
  assert.equal(exitCodeForBookBenefitSchemaClassification('partial_mismatch'), 1)
  assert.equal(exitCodeForBookBenefitSchemaClassification('unknown'), 1)
  assert.equal(exitCodeForBookBenefitSchemaClassification('invalid'), 2)
}

function metadataRows() {
  const requirements = {
    TABLES: ['TABLE_SCHEMA', 'TABLE_NAME', 'TABLE_TYPE', 'ENGINE', 'TABLE_COLLATION'],
    COLUMNS: ['TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'ORDINAL_POSITION', 'COLUMN_DEFAULT', 'IS_NULLABLE', 'DATA_TYPE', 'COLUMN_TYPE', 'CHARACTER_SET_NAME', 'COLLATION_NAME', 'COLUMN_KEY', 'EXTRA', 'GENERATION_EXPRESSION', 'SRS_ID', 'COLUMN_COMMENT'],
    STATISTICS: ['TABLE_SCHEMA', 'TABLE_NAME', 'NON_UNIQUE', 'INDEX_SCHEMA', 'INDEX_NAME', 'SEQ_IN_INDEX', 'COLUMN_NAME', 'COLLATION', 'SUB_PART', 'NULLABLE', 'INDEX_TYPE', 'IS_VISIBLE', 'EXPRESSION'],
    KEY_COLUMN_USAGE: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'ORDINAL_POSITION', 'POSITION_IN_UNIQUE_CONSTRAINT', 'REFERENCED_TABLE_SCHEMA', 'REFERENCED_TABLE_NAME', 'REFERENCED_COLUMN_NAME'],
    REFERENTIAL_CONSTRAINTS: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'UNIQUE_CONSTRAINT_SCHEMA', 'UNIQUE_CONSTRAINT_NAME', 'MATCH_OPTION', 'UPDATE_RULE', 'DELETE_RULE', 'TABLE_NAME', 'REFERENCED_TABLE_NAME'],
    CHECK_CONSTRAINTS: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'CHECK_CLAUSE'],
    TABLE_CONSTRAINTS: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_SCHEMA', 'TABLE_NAME', 'CONSTRAINT_TYPE', 'ENFORCED'],
    TRIGGERS: ['TRIGGER_SCHEMA', 'TRIGGER_NAME', 'EVENT_MANIPULATION', 'EVENT_OBJECT_SCHEMA', 'EVENT_OBJECT_TABLE', 'ACTION_STATEMENT', 'ACTION_TIMING', 'ACTION_ORIENTATION'],
    VIEWS: ['TABLE_SCHEMA', 'TABLE_NAME', 'VIEW_DEFINITION', 'CHECK_OPTION', 'IS_UPDATABLE', 'SECURITY_TYPE'],
    ROUTINES: ['ROUTINE_SCHEMA', 'ROUTINE_NAME', 'ROUTINE_TYPE', 'DATA_TYPE', 'ROUTINE_DEFINITION', 'SECURITY_TYPE'],
    EVENTS: ['EVENT_SCHEMA', 'EVENT_NAME', 'EVENT_TYPE', 'STATUS', 'ON_COMPLETION', 'EVENT_DEFINITION']
  }
  return Object.entries(requirements).flatMap(([TABLE_NAME, columns]) =>
    columns.map((COLUMN_NAME) => ({ TABLE_NAME, COLUMN_NAME })))
}

function fakeConnection({
  version = '8.0.46',
  omitMetadataField = null,
  failSection = null,
  hiddenDefinitions = false,
  tableRows = [],
  columnRows = [],
  statisticRows = [],
  triggerRows = null
} = {}) {
  const sqlLog = []
  return {
    sqlLog,
    async execute(sql) {
      sqlLog.push(sql)
      if (sql === 'SELECT VERSION() AS version') return [[{ version }], []]
      if (sql.includes("TABLE_SCHEMA = 'information_schema'")) {
        const rows = metadataRows().filter((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}` !== omitMetadataField)
        return [rows, []]
      }
      if (/SELECT COUNT\(\*\) AS TOTAL_COUNT, SUM\(.+ IS NULL\) AS HIDDEN_COUNT/.test(sql)) {
        return [[{ TOTAL_COUNT: hiddenDefinitions ? 1 : 0, HIDDEN_COUNT: hiddenDefinitions ? 1 : null }], []]
      }
      if (failSection && sql.includes(`INFORMATION_SCHEMA.${failSection}`)) throw new Error('PASSWORD_SENTINEL_DO_NOT_PRINT')
      if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [tableRows, []]
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [columnRows, []]
      if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) return [statisticRows, []]
      if (sql.includes('INFORMATION_SCHEMA.TRIGGERS')) return [triggerRows || [{
        TRIGGER_SCHEMA: 'test_schema', TRIGGER_NAME: 'audit_book_benefit_campaigns',
        EVENT_MANIPULATION: 'INSERT', EVENT_OBJECT_SCHEMA: 'test_schema',
        EVENT_OBJECT_TABLE: 'unrelated_business_table',
        ACTION_STATEMENT: 'SET @marker = (SELECT COUNT(*) FROM book_benefit_campaigns)',
        ACTION_TIMING: 'BEFORE', ACTION_ORIENTATION: 'ROW'
      }], []]
      if (sql.includes('INFORMATION_SCHEMA.VIEWS')) return [[{
        TABLE_SCHEMA: 'test_schema', TABLE_NAME: 'book_benefit_campaign_view',
        VIEW_DEFINITION: 'select * from `book_benefit_campaigns`', CHECK_OPTION: 'NONE',
        IS_UPDATABLE: 'YES', SECURITY_TYPE: 'DEFINER'
      }], []]
      return [[], []]
    }
  }
}

async function testCollectorSafetyAndFailures() {
  const connection = fakeConnection()
  const manifest = await collectBookBenefitSchemaManifest(connection, { schemaName: 'test_schema' })
  assert.equal(manifest.sections.triggers.length, 1)
  assert.deepEqual(manifest.sections.triggers[0].EVENT_OBJECT_TABLE, 'unrelated_business_table')
  assert.equal(manifest.sections.views.length, 1)
  assert.deepEqual(manifest.sections.views[0].RELATED_OBJECTS, ['book_benefit_campaigns'])

  const nameOnlyConnection = fakeConnection({
    triggerRows: [{
      ...nameOnlyTriggerRow('test_schema'),
      ACTION_STATEMENT: 'SET NEW.marker = NEW.marker'
    }]
  })
  const nameOnlyManifest = await collectBookBenefitSchemaManifest(nameOnlyConnection, {
    schemaName: 'test_schema'
  })
  assert.equal(nameOnlyManifest.sections.triggers.length, 1)
  assert.equal(nameOnlyManifest.sections.triggers[0].TRIGGER_NAME, 'book_benefit_unknown_trigger')
  assert.equal(nameOnlyManifest.sections.triggers[0].EVENT_OBJECT_TABLE, 'unrelated_business_table')
  assert.deepEqual(nameOnlyManifest.sections.triggers[0].RELATED_OBJECTS, [])
  assert(!JSON.stringify(nameOnlyManifest).includes('SET NEW.marker'))
  const nameOnlyClassification = classifyBookBenefitSchemaManifest(
    nameOnlyManifest,
    manifestWith('expected_007'),
    manifestWith('expected_008')
  )
  assert.notEqual(nameOnlyClassification, 'pristine')
  assert.equal(nameOnlyClassification, 'partial_mismatch')
  assert.equal(exitCodeForBookBenefitSchemaClassification(nameOnlyClassification), 1)

  const phone = phoneBindingFingerprint('test_schema')
  const phoneConnection = fakeConnection({
    columnRows: phone.columns,
    statisticRows: phone.statistics
  })
  const phoneManifest = await collectBookBenefitSchemaManifest(phoneConnection, {
    schemaName: 'test_schema'
  })
  assert.deepEqual(
    phoneManifest.sections.columns.map((row) => row.COLUMN_NAME),
    ['campaign_phone_hash_version', 'campaign_phone_identity_hash']
  )
  assert.deepEqual(
    phoneManifest.sections.statistics.map((row) => [row.INDEX_NAME, row.COLUMN_NAME, row.NON_UNIQUE]),
    [['idx_user_phone_bindings_campaign_identity', 'campaign_phone_identity_hash', 1]]
  )
  assert.equal(phoneManifest.sections.columns[0].TABLE_SCHEMA, '**SCHEMA**')
  const allSql = connection.sqlLog.join('\n')
  assert(!/SHOW\s+CREATE|PROCESSLIST|mysql\.user|FROM\s+book_benefit_/i.test(allSql))
  assert(!allSql.includes('AUTO_INCREMENT'))
  assert(!allSql.includes('SCHEMATA'))
  assert(connection.sqlLog.every((sql) => !/SELECT\s+\*/i.test(sql)))
  for (const metadataTable of ['TRIGGERS', 'VIEWS', 'ROUTINES', 'EVENTS']) {
    const query = connection.sqlLog.find((sql) =>
      sql.includes(`INFORMATION_SCHEMA.${metadataTable}`) && sql.includes('REGEXP_LIKE'))
    assert(query && query.includes('REGEXP_LIKE'), `${metadataTable} query must filter related objects in SQL`)
  }

  await assert.rejects(
    () => verifyBookBenefitSchemaMetadataSupport(fakeConnection({ version: '8.0.45' })),
    (error) => error instanceof BookBenefitSchemaManifestError && error.code === 'BOOK_BENEFIT_MYSQL_VERSION_UNSUPPORTED'
  )
  await assert.rejects(
    () => verifyBookBenefitSchemaMetadataSupport(fakeConnection({ omitMetadataField: 'STATISTICS.EXPRESSION' })),
    (error) => error instanceof BookBenefitSchemaManifestError &&
      error.code === 'BOOK_BENEFIT_METADATA_FIELD_MISSING_STATISTICS_EXPRESSION'
  )
  const denied = await collectBookBenefitSchemaManifest(fakeConnection({ failSection: 'STATISTICS' }), {
    schemaName: 'test_schema'
  })
  assert.deepEqual(denied, {
    collectionState: 'unknown', code: 'BOOK_BENEFIT_COLLECTION_FAILED_statistics'
  })
  assert(!JSON.stringify(denied).includes('PASSWORD_SENTINEL'))

  const hidden = await collectBookBenefitSchemaManifest(fakeConnection({ hiddenDefinitions: true }), {
    schemaName: 'test_schema'
  })
  assert.deepEqual(hidden, {
    collectionState: 'unknown', code: 'BOOK_BENEFIT_METADATA_HIDDEN_VIEWS'
  })

  const versionDenied = fakeConnection()
  versionDenied.execute = async () => { throw new Error('CONNECTION_STRING_SENTINEL_DO_NOT_PRINT') }
  const result = await verifyBookBenefitSchemaMetadataSupport(versionDenied)
  assert.deepEqual(result, {
    collectionState: 'unknown', code: 'BOOK_BENEFIT_VERSION_QUERY_DENIED'
  })
  assert(!JSON.stringify(result).includes('CONNECTION_STRING_SENTINEL'))

  for (const type of ['BASE TABLE', 'VIEW']) {
    const unknownConnection = fakeConnection({
      tableRows: [tableRow('test_schema', 'book_benefit_extra', type)]
    })
    const unknownManifest = await collectBookBenefitSchemaManifest(unknownConnection, {
      schemaName: 'test_schema'
    })
    assert.equal(unknownManifest.sections.tables[0].TABLE_NAME, 'book_benefit_extra')
    assert.equal(classifyBookBenefitSchemaManifest(
      unknownManifest, manifestWith('expected_007'), manifestWith('expected_008')
    ), 'partial_mismatch')
  }
  const tableQuery = connection.sqlLog.find((sql) => sql.includes('INFORMATION_SCHEMA.TABLES'))
  assert(tableQuery.includes('REGEXP_LIKE(TABLE_NAME'), 'TABLES query must enumerate every book_benefit_% object')
}

async function testOwnedDatabaseCleanupBehavior() {
  const pattern = /^book_benefit_manifest_cleanup_[a-f0-9]{12}$/
  const databaseName = 'book_benefit_manifest_cleanup_abcdef123456'
  const ownedDatabases = new Set()
  const sql = []
  const connection = { async query(statement) { sql.push(statement); return [[], []] } }
  const config = {
    host: '127.0.0.1', port: 3308, confirmation: 'manifest-cleanup-test'
  }
  await createOwnedBookBenefitDatabase(connection, databaseName, ownedDatabases, pattern)
  assert(ownedDatabases.has(databaseName))
  await dropOwnedBookBenefitDatabase(connection, config, {
    databaseName, ownedDatabases, databasePattern: pattern, confirmation: 'manifest-cleanup-test'
  })
  assert(!ownedDatabases.has(databaseName))
  assert.match(sql[0], /^CREATE DATABASE `book_benefit_manifest_cleanup_[a-f0-9]{12}`/)
  assert.match(sql[1], /^DROP DATABASE `book_benefit_manifest_cleanup_[a-f0-9]{12}`$/)

  const unowned = new Set()
  await assert.rejects(
    () => dropOwnedBookBenefitDatabase(connection, config, {
      databaseName, ownedDatabases: unowned, databasePattern: pattern,
      confirmation: 'manifest-cleanup-test'
    }),
    /not owned/
  )

  const failingOwned = new Set([databaseName])
  const failingConnection = { async query() { throw new Error('cleanup failure') } }
  await assert.rejects(
    () => dropOwnedBookBenefitDatabase(failingConnection, config, {
      databaseName, ownedDatabases: failingOwned, databasePattern: pattern,
      confirmation: 'manifest-cleanup-test'
    }),
    /cleanup failure/
  )
  assert(failingOwned.has(databaseName), 'failed cleanup must remain tracked as owned')

  const createFailOwned = new Set()
  await assert.rejects(
    () => createOwnedBookBenefitDatabase(failingConnection, databaseName, createFailOwned, pattern),
    /cleanup failure/
  )
  assert(createFailOwned.has(databaseName), 'uncertain CREATE outcome must remain tracked for cleanup')
}

async function testMigrationCopies() {
  const [phoneBindingsSql, canonical007, release007, canonical008, release008] = await Promise.all([
    readFile(phoneBindingsUrl, 'utf8'),
    readFile(canonical007Url, 'utf8'), readFile(release007Url, 'utf8'),
    readFile(canonical008Url, 'utf8'), readFile(release008Url, 'utf8')
  ])
  assertBookBenefitMigrationCopies(canonical007, release007, '007')
  assertBookBenefitMigrationCopies(canonical008, release008, '008')
  assert.throws(
    () => assertBookBenefitMigrationCopies(canonical007, `${release007}\n-- mismatch`, '007'),
    /canonical\/server mismatch: STOP/
  )
  assert.match(canonical007, /CREATE TABLE IF NOT EXISTS `book_benefit_campaigns`/)
  assert.match(canonical008, /ALTER TABLE `book_benefit_issuances`/)
  const exact007Statements = extractBookBenefitExact007Statements(phoneBindingsSql, canonical007, [
    'book_benefit_campaigns', 'book_benefit_issuances', 'book_benefit_codes',
    'book_benefit_redemptions', 'book_benefit_audit_events'
  ])
  assert.equal(exact007Statements.length, 7)
  assert.match(exact007Statements[0], /CREATE TABLE IF NOT EXISTS `user_phone_bindings`/)
  assert.match(exact007Statements[6], /ALTER TABLE `user_phone_bindings`/)
  assert.match(exact007Statements[6], /campaign_phone_identity_hash/)
  assert.match(exact007Statements[6], /campaign_phone_hash_version/)
  assert.match(exact007Statements[6], /idx_user_phone_bindings_campaign_identity/)
}

await testMigrationCopies()
testStableManifestPureFunctions()
testClassification()
await testCollectorSafetyAndFailures()
await testOwnedDatabaseCleanupBehavior()

console.log('book-benefit schema manifest static tests passed')
