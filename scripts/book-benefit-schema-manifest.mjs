import crypto from 'node:crypto'

export const BOOK_BENEFIT_MANIFEST_FORMAT_VERSION = 1
export const BOOK_BENEFIT_REQUIRED_MYSQL_VERSION = '8.0.46'
export const BOOK_BENEFIT_SCHEMA_PLACEHOLDER = '**SCHEMA**'

export const BOOK_BENEFIT_TABLES = Object.freeze([
  'book_benefit_campaigns',
  'book_benefit_issuances',
  'book_benefit_codes',
  'book_benefit_redemptions',
  'book_benefit_audit_events'
])

export const BOOK_BENEFIT_LEGACY_TABLE = 'book_benefit_applications'
export const BOOK_BENEFIT_OBJECTS = Object.freeze([
  ...BOOK_BENEFIT_TABLES,
  BOOK_BENEFIT_LEGACY_TABLE
])

export const BOOK_BENEFIT_PHONE_BINDINGS_TABLE = 'user_phone_bindings'
export const BOOK_BENEFIT_PHONE_BINDING_COLUMNS = Object.freeze([
  'campaign_phone_identity_hash',
  'campaign_phone_hash_version'
])
export const BOOK_BENEFIT_PHONE_BINDING_INDEX = 'idx_user_phone_bindings_campaign_identity'

export const BOOK_BENEFIT_CLASSIFICATIONS = Object.freeze([
  'pristine',
  'exact_revised_007',
  'exact_revised_008',
  'legacy_application',
  'partial_mismatch',
  'unknown'
])

const SECTION_DEFINITIONS = Object.freeze({
  tables: ['TABLE_SCHEMA', 'TABLE_NAME', 'TABLE_TYPE', 'ENGINE', 'TABLE_COLLATION'],
  columns: [
    'TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME', 'ORDINAL_POSITION', 'COLUMN_DEFAULT',
    'IS_NULLABLE', 'DATA_TYPE', 'COLUMN_TYPE', 'CHARACTER_SET_NAME', 'COLLATION_NAME',
    'COLUMN_KEY', 'EXTRA', 'GENERATION_EXPRESSION', 'SRS_ID', 'COLUMN_COMMENT'
  ],
  statistics: [
    'TABLE_SCHEMA', 'TABLE_NAME', 'NON_UNIQUE', 'INDEX_SCHEMA', 'INDEX_NAME',
    'SEQ_IN_INDEX', 'COLUMN_NAME', 'COLLATION', 'SUB_PART', 'NULLABLE', 'INDEX_TYPE',
    'IS_VISIBLE', 'EXPRESSION'
  ],
  keyColumnUsage: [
    'CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_SCHEMA', 'TABLE_NAME', 'COLUMN_NAME',
    'ORDINAL_POSITION', 'POSITION_IN_UNIQUE_CONSTRAINT', 'REFERENCED_TABLE_SCHEMA',
    'REFERENCED_TABLE_NAME', 'REFERENCED_COLUMN_NAME'
  ],
  referentialConstraints: [
    'CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'UNIQUE_CONSTRAINT_SCHEMA',
    'UNIQUE_CONSTRAINT_NAME', 'MATCH_OPTION', 'UPDATE_RULE', 'DELETE_RULE',
    'TABLE_NAME', 'REFERENCED_TABLE_NAME'
  ],
  checkConstraints: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'CHECK_CLAUSE'],
  tableConstraints: [
    'CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME', 'TABLE_SCHEMA', 'TABLE_NAME',
    'CONSTRAINT_TYPE', 'ENFORCED'
  ],
  triggers: [
    'TRIGGER_SCHEMA', 'TRIGGER_NAME', 'EVENT_MANIPULATION', 'EVENT_OBJECT_SCHEMA',
    'EVENT_OBJECT_TABLE', 'ACTION_TIMING', 'ACTION_ORIENTATION', 'RELATED_OBJECTS'
  ],
  views: ['TABLE_SCHEMA', 'TABLE_NAME', 'CHECK_OPTION', 'IS_UPDATABLE', 'SECURITY_TYPE', 'RELATED_OBJECTS'],
  routines: ['ROUTINE_SCHEMA', 'ROUTINE_NAME', 'ROUTINE_TYPE', 'DATA_TYPE', 'SECURITY_TYPE', 'RELATED_OBJECTS'],
  events: ['EVENT_SCHEMA', 'EVENT_NAME', 'EVENT_TYPE', 'STATUS', 'ON_COMPLETION', 'RELATED_OBJECTS']
})

export const BOOK_BENEFIT_MANIFEST_SECTIONS = Object.freeze(Object.keys(SECTION_DEFINITIONS))

const INFORMATION_SCHEMA_REQUIREMENTS = Object.freeze({
  TABLES: SECTION_DEFINITIONS.tables,
  COLUMNS: SECTION_DEFINITIONS.columns,
  STATISTICS: SECTION_DEFINITIONS.statistics,
  KEY_COLUMN_USAGE: SECTION_DEFINITIONS.keyColumnUsage,
  REFERENTIAL_CONSTRAINTS: SECTION_DEFINITIONS.referentialConstraints,
  CHECK_CONSTRAINTS: SECTION_DEFINITIONS.checkConstraints,
  TABLE_CONSTRAINTS: SECTION_DEFINITIONS.tableConstraints,
  TRIGGERS: [
    'TRIGGER_SCHEMA', 'TRIGGER_NAME', 'EVENT_MANIPULATION', 'EVENT_OBJECT_SCHEMA',
    'EVENT_OBJECT_TABLE', 'ACTION_STATEMENT', 'ACTION_TIMING', 'ACTION_ORIENTATION'
  ],
  VIEWS: [
    'TABLE_SCHEMA', 'TABLE_NAME', 'VIEW_DEFINITION', 'CHECK_OPTION', 'IS_UPDATABLE', 'SECURITY_TYPE'
  ],
  ROUTINES: [
    'ROUTINE_SCHEMA', 'ROUTINE_NAME', 'ROUTINE_TYPE', 'DATA_TYPE', 'ROUTINE_DEFINITION', 'SECURITY_TYPE'
  ],
  EVENTS: [
    'EVENT_SCHEMA', 'EVENT_NAME', 'EVENT_TYPE', 'STATUS', 'ON_COMPLETION', 'EVENT_DEFINITION'
  ]
})

const NUMERIC_FIELDS = new Set([
  'ORDINAL_POSITION', 'SRS_ID', 'NON_UNIQUE', 'SEQ_IN_INDEX', 'SUB_PART',
  'POSITION_IN_UNIQUE_CONSTRAINT'
])

const SCHEMA_FIELDS = new Set([
  'TABLE_SCHEMA', 'INDEX_SCHEMA', 'CONSTRAINT_SCHEMA', 'UNIQUE_CONSTRAINT_SCHEMA',
  'REFERENCED_TABLE_SCHEMA', 'TRIGGER_SCHEMA', 'EVENT_OBJECT_SCHEMA', 'ROUTINE_SCHEMA',
  'EVENT_SCHEMA'
])

const LEGACY_REQUIRED_COLUMNS = Object.freeze([
  'id', 'application_no', 'campaign_id', 'applicant_user_id',
  'applicant_phone_identity_hash', 'applicant_phone_hash_version', 'order_claim_type',
  'approved_order_claim_hash', 'order_claim_hash_version', 'order_channel', 'status',
  'reviewed_by', 'review_reason_code', 'reviewed_at', 'create_idempotency_key',
  'created_at', 'updated_at'
])

const LEGACY_REQUIRED_INDEXES = Object.freeze([
  'PRIMARY',
  'uk_book_benefit_applications_no',
  'uk_book_benefit_applications_campaign_user',
  'uk_book_benefit_applications_campaign_phone',
  'uk_book_benefit_applications_campaign_order',
  'uk_book_benefit_applications_idempotency',
  'idx_book_benefit_applications_status_created'
])

const LEGACY_INDEX_SIGNATURES = Object.freeze({
  PRIMARY: { nonUnique: 0, columns: ['id'] },
  uk_book_benefit_applications_no: { nonUnique: 0, columns: ['application_no'] },
  uk_book_benefit_applications_campaign_user: { nonUnique: 0, columns: ['campaign_id', 'applicant_user_id'] },
  uk_book_benefit_applications_campaign_phone: { nonUnique: 0, columns: ['campaign_id', 'applicant_phone_identity_hash'] },
  uk_book_benefit_applications_campaign_order: { nonUnique: 0, columns: ['campaign_id', 'approved_order_claim_hash'] },
  uk_book_benefit_applications_idempotency: { nonUnique: 0, columns: ['create_idempotency_key'] },
  idx_book_benefit_applications_status_created: { nonUnique: 1, columns: ['status', 'created_at'] }
})

export class BookBenefitSchemaManifestError extends Error {
  constructor(code) {
    super(code)
    this.name = 'BookBenefitSchemaManifestError'
    this.code = code
  }
}

function stop(code) {
  throw new BookBenefitSchemaManifestError(code)
}

function assertSchemaName(schemaName) {
  if (typeof schemaName !== 'string' || !/^[A-Za-z0-9_$-]{1,64}$/.test(schemaName)) {
    stop('BOOK_BENEFIT_SCHEMA_NAME_INVALID')
  }
}

function comparePrimitive(left, right) {
  if (left === right) return 0
  if (left === null) return -1
  if (right === null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  const leftString = String(left)
  const rightString = String(right)
  return leftString < rightString ? -1 : 1
}

function compareRows(fields) {
  return (left, right) => {
    for (const field of fields) {
      const comparison = comparePrimitive(left[field], right[field])
      if (comparison !== 0) return comparison
    }
    return 0
  }
}

function normalizeNumeric(value, field) {
  if (value === null) return null
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value)
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    const number = Number(value)
    if (Number.isSafeInteger(number)) return number
  }
  stop(`BOOK_BENEFIT_NUMERIC_FIELD_INVALID_${field}`)
}

function normalizeScalar(value, field, schemaName) {
  if (value === null || value === undefined) return null
  if (NUMERIC_FIELDS.has(field)) return normalizeNumeric(value, field)
  if (SCHEMA_FIELDS.has(field) && String(value) === schemaName) return BOOK_BENEFIT_SCHEMA_PLACEHOLDER
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n')
  if (typeof value === 'number' || typeof value === 'boolean') return value
  stop(`BOOK_BENEFIT_FIELD_TYPE_INVALID_${field}`)
}

function normalizeRelatedObjects(value) {
  if (!Array.isArray(value)) stop('BOOK_BENEFIT_RELATED_OBJECTS_INVALID')
  const names = value.map((item) => String(item))
  return [...new Set(names)].sort((left, right) => left === right ? 0 : left < right ? -1 : 1)
}

function normalizeRow(row, fields, schemaName) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) stop('BOOK_BENEFIT_ROW_INVALID')
  const normalized = {}
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) stop(`BOOK_BENEFIT_ROW_FIELD_MISSING_${field}`)
    normalized[field] = field === 'RELATED_OBJECTS'
      ? normalizeRelatedObjects(row[field])
      : normalizeScalar(row[field], field, schemaName)
  }
  return normalized
}

export function normalizeBookBenefitSchemaManifest(input, { schemaName } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) stop('BOOK_BENEFIT_MANIFEST_INVALID')
  const sourceSchema = schemaName || input.sourceSchema || input.schema
  if (sourceSchema !== BOOK_BENEFIT_SCHEMA_PLACEHOLDER) assertSchemaName(sourceSchema)
  if (!input.sections || typeof input.sections !== 'object' || Array.isArray(input.sections)) {
    stop('BOOK_BENEFIT_MANIFEST_SECTIONS_INVALID')
  }

  const sections = {}
  for (const [section, fields] of Object.entries(SECTION_DEFINITIONS)) {
    const rows = input.sections[section]
    if (!Array.isArray(rows)) stop(`BOOK_BENEFIT_SECTION_MISSING_${section}`)
    sections[section] = rows
      .map((row) => normalizeRow(row, fields, sourceSchema))
      .sort(compareRows(fields))
  }

  return {
    formatVersion: BOOK_BENEFIT_MANIFEST_FORMAT_VERSION,
    schema: BOOK_BENEFIT_SCHEMA_PLACEHOLDER,
    sections
  }
}

export function createEmptyBookBenefitSchemaManifest() {
  return normalizeBookBenefitSchemaManifest({
    formatVersion: BOOK_BENEFIT_MANIFEST_FORMAT_VERSION,
    schema: BOOK_BENEFIT_SCHEMA_PLACEHOLDER,
    sections: Object.fromEntries(BOOK_BENEFIT_MANIFEST_SECTIONS.map((section) => [section, []]))
  }, { schemaName: BOOK_BENEFIT_SCHEMA_PLACEHOLDER })
}

export function serializeBookBenefitSchemaManifest(manifest) {
  const normalized = normalizeBookBenefitSchemaManifest(manifest, {
    schemaName: manifest && (manifest.sourceSchema || manifest.schema)
  })
  return `${JSON.stringify(normalized, null, 2)}\n`
}

export function hashBookBenefitSchemaManifest(manifest) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(serializeBookBenefitSchemaManifest(manifest), 'utf8'))
    .digest('hex')
}

function targetPlaceholders() {
  return BOOK_BENEFIT_OBJECTS.map(() => '?').join(', ')
}

function metadataTablePlaceholders() {
  return [...BOOK_BENEFIT_OBJECTS, BOOK_BENEFIT_PHONE_BINDINGS_TABLE].map(() => '?').join(', ')
}

const RELATED_OBJECT_REGEXP = `(^|[^a-z0-9_])(${BOOK_BENEFIT_OBJECTS.join('|')})([^a-z0-9_]|$)`
const BOOK_BENEFIT_NAME_REGEXP = '^book_benefit_'

function safeUnknown(code = 'BOOK_BENEFIT_COLLECTION_UNKNOWN') {
  return Object.freeze({ collectionState: 'unknown', code })
}

async function executeRows(connection, sql, parameters, unknownCode) {
  try {
    const result = await connection.execute(sql, parameters)
    if (!Array.isArray(result) || !Array.isArray(result[0])) return safeUnknown(unknownCode)
    return result[0]
  } catch {
    return safeUnknown(unknownCode)
  }
}

function isUnknown(value) {
  return Boolean(value && value.collectionState === 'unknown')
}

export async function verifyBookBenefitSchemaMetadataSupport(connection) {
  if (!connection || typeof connection.execute !== 'function') stop('BOOK_BENEFIT_CONNECTION_INVALID')

  let versionRows
  try {
    ;[versionRows] = await connection.execute('SELECT VERSION() AS version')
  } catch {
    return safeUnknown('BOOK_BENEFIT_VERSION_QUERY_DENIED')
  }
  const version = versionRows && versionRows[0] && String(versionRows[0].version || '')
  if (!new RegExp(`^${BOOK_BENEFIT_REQUIRED_MYSQL_VERSION.replace(/\./g, '\\.')}(?:[-+.]|$)`).test(version)) {
    stop('BOOK_BENEFIT_MYSQL_VERSION_UNSUPPORTED')
  }

  const requestedTables = Object.keys(INFORMATION_SCHEMA_REQUIREMENTS)
  const requestedColumns = [...new Set(Object.values(INFORMATION_SCHEMA_REQUIREMENTS).flat())]
  const rows = await executeRows(
    connection,
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'information_schema'
        AND TABLE_NAME IN (${requestedTables.map(() => '?').join(', ')})
        AND COLUMN_NAME IN (${requestedColumns.map(() => '?').join(', ')})`,
    [...requestedTables, ...requestedColumns],
    'BOOK_BENEFIT_METADATA_CAPABILITY_QUERY_DENIED'
  )
  if (isUnknown(rows)) return rows

  const available = new Map()
  for (const row of rows) {
    const table = String(row.TABLE_NAME || '').toUpperCase()
    const column = String(row.COLUMN_NAME || '').toUpperCase()
    if (!available.has(table)) available.set(table, new Set())
    available.get(table).add(column)
  }
  for (const [table, columns] of Object.entries(INFORMATION_SCHEMA_REQUIREMENTS)) {
    for (const column of columns) {
      if (!available.get(table)?.has(column)) stop(`BOOK_BENEFIT_METADATA_FIELD_MISSING_${table}_${column}`)
    }
  }
  return Object.freeze({ collectionState: 'ready', mysqlVersion: BOOK_BENEFIT_REQUIRED_MYSQL_VERSION })
}

function findRelatedObjects(row, definitionFields) {
  const haystack = definitionFields
    .map((field) => row[field])
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLowerCase()
  return BOOK_BENEFIT_OBJECTS.filter((name) => {
    const expression = new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`, 'i')
    return expression.test(haystack)
  })
}

function projectExtraRows(rows, fields, definitionFields) {
  return rows.flatMap((row) => {
    const related = findRelatedObjects(row, definitionFields)
    const objectName = String(
      row.TRIGGER_NAME || row.TABLE_NAME || row.ROUTINE_NAME || row.EVENT_NAME || ''
    ).toLowerCase()
    if (!related.length && !objectName.startsWith('book_benefit_')) return []
    const projected = { RELATED_OBJECTS: related }
    for (const field of fields) {
      if (field !== 'RELATED_OBJECTS') projected[field] = row[field]
    }
    return [projected]
  })
}

export async function collectBookBenefitSchemaManifest(connection, { schemaName } = {}) {
  assertSchemaName(schemaName)
  const support = await verifyBookBenefitSchemaMetadataSupport(connection)
  if (isUnknown(support)) return support

  const placeholders = targetPlaceholders()
  const metadataPlaceholders = metadataTablePlaceholders()
  const parameters = [schemaName, ...BOOK_BENEFIT_OBJECTS]
  const metadataTables = [...BOOK_BENEFIT_OBJECTS, BOOK_BENEFIT_PHONE_BINDINGS_TABLE]
  const metadataParameters = [schemaName, ...metadataTables]
  const visibilityChecks = [
    ['VIEWS', 'VIEW_DEFINITION'],
    ['ROUTINES', 'ROUTINE_DEFINITION'],
    ['EVENTS', 'EVENT_DEFINITION']
  ]
  for (const [table, definition] of visibilityChecks) {
    const schemaField = table === 'VIEWS' ? 'TABLE_SCHEMA' : table === 'ROUTINES' ? 'ROUTINE_SCHEMA' : 'EVENT_SCHEMA'
    const rows = await executeRows(
      connection,
      `SELECT COUNT(*) AS TOTAL_COUNT, SUM(${definition} IS NULL) AS HIDDEN_COUNT
         FROM INFORMATION_SCHEMA.${table}
        WHERE ${schemaField} = ?`,
      [schemaName],
      `BOOK_BENEFIT_COLLECTION_FAILED_${table.toLowerCase()}_visibility`
    )
    if (isUnknown(rows)) return rows
    if (rows.length !== 1) return safeUnknown(`BOOK_BENEFIT_COLLECTION_INCOMPLETE_${table.toLowerCase()}_visibility`)
    const hiddenCount = normalizeNumeric(rows[0].HIDDEN_COUNT === null ? 0 : rows[0].HIDDEN_COUNT, 'HIDDEN_COUNT')
    if (hiddenCount !== 0) return safeUnknown(`BOOK_BENEFIT_METADATA_HIDDEN_${table}`)
  }
  const queries = [
    ['tables', `SELECT ${SECTION_DEFINITIONS.tables.join(', ')} FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND REGEXP_LIKE(TABLE_NAME, ?, 'i')`, [schemaName, BOOK_BENEFIT_NAME_REGEXP]],
    ['columns', `SELECT ${SECTION_DEFINITIONS.columns.join(', ')} FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${metadataPlaceholders}) AND (TABLE_NAME <> ? OR COLUMN_NAME IN (?, ?))`, [...metadataParameters, BOOK_BENEFIT_PHONE_BINDINGS_TABLE, ...BOOK_BENEFIT_PHONE_BINDING_COLUMNS]],
    ['statistics', `SELECT ${SECTION_DEFINITIONS.statistics.join(', ')} FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${metadataPlaceholders}) AND (TABLE_NAME <> ? OR INDEX_NAME = ?)`, [...metadataParameters, BOOK_BENEFIT_PHONE_BINDINGS_TABLE, BOOK_BENEFIT_PHONE_BINDING_INDEX]],
    ['keyColumnUsage', `SELECT ${SECTION_DEFINITIONS.keyColumnUsage.join(', ')} FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`, parameters],
    ['referentialConstraints', `SELECT ${SECTION_DEFINITIONS.referentialConstraints.join(', ')} FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`, parameters],
    ['checkConstraintIdentities', `SELECT CONSTRAINT_SCHEMA, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders}) AND CONSTRAINT_TYPE = 'CHECK'`, parameters],
    ['tableConstraints', `SELECT ${SECTION_DEFINITIONS.tableConstraints.join(', ')} FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`, parameters],
    ['triggersRaw', `SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_SCHEMA, EVENT_OBJECT_TABLE, ACTION_STATEMENT, ACTION_TIMING, ACTION_ORIENTATION
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = ?
        AND (REGEXP_LIKE(TRIGGER_NAME, ?, 'i') OR REGEXP_LIKE(EVENT_OBJECT_TABLE, ?, 'i') OR REGEXP_LIKE(ACTION_STATEMENT, ?, 'i'))`, [schemaName, BOOK_BENEFIT_NAME_REGEXP, RELATED_OBJECT_REGEXP, RELATED_OBJECT_REGEXP]],
    ['viewsRaw', `SELECT TABLE_SCHEMA, TABLE_NAME, VIEW_DEFINITION, CHECK_OPTION, IS_UPDATABLE, SECURITY_TYPE
       FROM INFORMATION_SCHEMA.VIEWS
      WHERE TABLE_SCHEMA = ?
        AND (REGEXP_LIKE(TABLE_NAME, ?, 'i') OR REGEXP_LIKE(COALESCE(VIEW_DEFINITION, ''), ?, 'i'))`, [schemaName, BOOK_BENEFIT_NAME_REGEXP, RELATED_OBJECT_REGEXP]],
    ['routinesRaw', `SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE, ROUTINE_DEFINITION, SECURITY_TYPE
       FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_SCHEMA = ?
        AND (REGEXP_LIKE(ROUTINE_NAME, ?, 'i') OR REGEXP_LIKE(COALESCE(ROUTINE_DEFINITION, ''), ?, 'i'))`, [schemaName, BOOK_BENEFIT_NAME_REGEXP, RELATED_OBJECT_REGEXP]],
    ['eventsRaw', `SELECT EVENT_SCHEMA, EVENT_NAME, EVENT_TYPE, STATUS, ON_COMPLETION, EVENT_DEFINITION
       FROM INFORMATION_SCHEMA.EVENTS
      WHERE EVENT_SCHEMA = ?
        AND (REGEXP_LIKE(EVENT_NAME, ?, 'i') OR REGEXP_LIKE(COALESCE(EVENT_DEFINITION, ''), ?, 'i'))`, [schemaName, BOOK_BENEFIT_NAME_REGEXP, RELATED_OBJECT_REGEXP]]
  ]

  const collected = {}
  for (const [section, sql, values] of queries) {
    const rows = await executeRows(connection, sql, values, `BOOK_BENEFIT_COLLECTION_FAILED_${section}`)
    if (isUnknown(rows)) return rows
    collected[section] = rows
  }

  const checkConstraints = []
  for (const identity of collected.checkConstraintIdentities) {
    const rows = await executeRows(
      connection,
      `SELECT CONSTRAINT_SCHEMA, CONSTRAINT_NAME, CHECK_CLAUSE
         FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = ?`,
      [identity.CONSTRAINT_SCHEMA, identity.CONSTRAINT_NAME],
      'BOOK_BENEFIT_COLLECTION_FAILED_checkConstraints'
    )
    if (isUnknown(rows)) return rows
    if (rows.length !== 1) return safeUnknown('BOOK_BENEFIT_COLLECTION_INCOMPLETE_checkConstraints')
    checkConstraints.push(rows[0])
  }

  const unexpectedTargetRow = [
    ...collected.columns,
    ...collected.statistics,
    ...collected.keyColumnUsage,
    ...collected.referentialConstraints,
    ...collected.tableConstraints
  ].some((row) => row.TABLE_NAME && !metadataTables.includes(row.TABLE_NAME))
  if (unexpectedTargetRow) return safeUnknown('BOOK_BENEFIT_COLLECTION_OUT_OF_SCOPE')

  const existingTables = new Set(collected.tables.map((row) => row.TABLE_NAME))
  const orphanedMetadata = [
    ...collected.columns,
    ...collected.statistics,
    ...collected.keyColumnUsage,
    ...collected.referentialConstraints,
    ...collected.tableConstraints
  ].some((row) => row.TABLE_NAME &&
    row.TABLE_NAME !== BOOK_BENEFIT_PHONE_BINDINGS_TABLE &&
    !existingTables.has(row.TABLE_NAME))
  if (orphanedMetadata) return safeUnknown('BOOK_BENEFIT_COLLECTION_INCOMPLETE_TABLES')

  const sections = {
    tables: collected.tables,
    columns: collected.columns,
    statistics: collected.statistics,
    keyColumnUsage: collected.keyColumnUsage,
    referentialConstraints: collected.referentialConstraints,
    checkConstraints,
    tableConstraints: collected.tableConstraints,
    triggers: projectExtraRows(collected.triggersRaw, SECTION_DEFINITIONS.triggers, [
      'TRIGGER_NAME', 'EVENT_OBJECT_TABLE', 'ACTION_STATEMENT'
    ]),
    views: projectExtraRows(collected.viewsRaw, SECTION_DEFINITIONS.views, ['TABLE_NAME', 'VIEW_DEFINITION']),
    routines: projectExtraRows(collected.routinesRaw, SECTION_DEFINITIONS.routines, ['ROUTINE_NAME', 'ROUTINE_DEFINITION']),
    events: projectExtraRows(collected.eventsRaw, SECTION_DEFINITIONS.events, ['EVENT_NAME', 'EVENT_DEFINITION'])
  }

  try {
    return normalizeBookBenefitSchemaManifest({
      formatVersion: BOOK_BENEFIT_MANIFEST_FORMAT_VERSION,
      sourceSchema: schemaName,
      sections
    }, { schemaName })
  } catch (error) {
    if (error instanceof BookBenefitSchemaManifestError) return safeUnknown('BOOK_BENEFIT_COLLECTION_INCOMPLETE')
    return safeUnknown('BOOK_BENEFIT_SERIALIZATION_UNKNOWN')
  }
}

function hasExtraObjects(manifest) {
  return ['triggers', 'views', 'routines', 'events']
    .some((section) => manifest.sections[section].length > 0)
}

function tableNames(manifest) {
  return new Set(manifest.sections.tables.map((row) => row.TABLE_NAME))
}

function isMechanicallyRecognizedLegacy(manifest) {
  const names = tableNames(manifest)
  if (!names.has(BOOK_BENEFIT_LEGACY_TABLE)) return false
  const columnRows = manifest.sections.columns
    .filter((row) => row.TABLE_NAME === BOOK_BENEFIT_LEGACY_TABLE)
  const columns = new Set(
    columnRows.map((row) => row.COLUMN_NAME)
  )
  if (!LEGACY_REQUIRED_COLUMNS.every((column) => columns.has(column))) return false

  const byColumn = new Map(columnRows.map((row) => [row.COLUMN_NAME, row]))
  const orderClaim = byColumn.get('order_claim_type')
  const status = byColumn.get('status')
  if (!orderClaim || String(orderClaim.COLUMN_TYPE).toLowerCase() !== "enum('standard','manual_exception')" ||
      orderClaim.IS_NULLABLE !== 'NO' || orderClaim.COLUMN_DEFAULT !== null) return false
  if (!status || String(status.COLUMN_TYPE).toLowerCase() !== "enum('pending','approved','rejected','cancelled')" ||
      status.IS_NULLABLE !== 'NO' || status.COLUMN_DEFAULT !== 'pending') return false

  const indexRows = manifest.sections.statistics
    .filter((row) => row.TABLE_NAME === BOOK_BENEFIT_LEGACY_TABLE)
  const indexes = new Set(indexRows.map((row) => row.INDEX_NAME))
  if (!LEGACY_REQUIRED_INDEXES.every((index) => indexes.has(index))) return false
  for (const [indexName, signature] of Object.entries(LEGACY_INDEX_SIGNATURES)) {
    const rows = indexRows
      .filter((row) => row.INDEX_NAME === indexName)
      .sort((left, right) => left.SEQ_IN_INDEX - right.SEQ_IN_INDEX)
    if (rows.length !== signature.columns.length) return false
    if (rows.some((row) => row.NON_UNIQUE !== signature.nonUnique)) return false
    if (rows.some((row, index) => row.SEQ_IN_INDEX !== index + 1 || row.COLUMN_NAME !== signature.columns[index])) return false
  }
  return true
}

function equalManifests(left, right) {
  try {
    return serializeBookBenefitSchemaManifest(left) === serializeBookBenefitSchemaManifest(right)
  } catch {
    return false
  }
}

export function classifyBookBenefitSchemaManifest(actual, expected007, expected008) {
  if (isUnknown(actual)) return 'unknown'
  let normalizedActual
  try {
    normalizedActual = normalizeBookBenefitSchemaManifest(actual, {
      schemaName: actual && (actual.sourceSchema || actual.schema)
    })
  } catch {
    return 'unknown'
  }

  if (expected007 && equalManifests(normalizedActual, expected007)) return 'exact_revised_007'
  if (expected008 && equalManifests(normalizedActual, expected008)) return 'exact_revised_008'

  const phoneBindingFingerprintPresent = normalizedActual.sections.columns.some((row) =>
    row.TABLE_NAME === BOOK_BENEFIT_PHONE_BINDINGS_TABLE) ||
    normalizedActual.sections.statistics.some((row) =>
      row.TABLE_NAME === BOOK_BENEFIT_PHONE_BINDINGS_TABLE)
  if (normalizedActual.sections.tables.length === 0 &&
      !phoneBindingFingerprintPresent &&
      !hasExtraObjects(normalizedActual)) return 'pristine'
  const unknownPrefixedObject = normalizedActual.sections.tables.some((row) =>
    !BOOK_BENEFIT_OBJECTS.includes(row.TABLE_NAME))
  if (unknownPrefixedObject) return 'partial_mismatch'
  if (isMechanicallyRecognizedLegacy(normalizedActual)) return 'legacy_application'

  const abnormalTable = normalizedActual.sections.tables.some((row) =>
    BOOK_BENEFIT_OBJECTS.includes(row.TABLE_NAME) && row.TABLE_TYPE !== 'BASE TABLE'
  )
  if (abnormalTable) return 'unknown'
  return 'partial_mismatch'
}

export function exitCodeForBookBenefitSchemaClassification(classification) {
  if (!BOOK_BENEFIT_CLASSIFICATIONS.includes(classification)) return 2
  return classification === 'partial_mismatch' || classification === 'unknown' ? 1 : 0
}

export function summarizeBookBenefitSchemaManifest(manifest) {
  if (isUnknown(manifest)) return { collectionState: 'unknown', code: manifest.code }
  const normalized = normalizeBookBenefitSchemaManifest(manifest, {
    schemaName: manifest && (manifest.sourceSchema || manifest.schema)
  })
  return {
    formatVersion: normalized.formatVersion,
    sha256: hashBookBenefitSchemaManifest(normalized),
    sectionCounts: Object.fromEntries(
      BOOK_BENEFIT_MANIFEST_SECTIONS.map((section) => [section, normalized.sections[section].length])
    )
  }
}
