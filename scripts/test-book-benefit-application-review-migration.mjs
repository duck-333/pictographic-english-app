import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const canonicalUrl = new URL('../database/migrations/008_extend_book_benefit_application_review.sql', import.meta.url)
const releaseUrl = new URL('../server/migrations/008_extend_book_benefit_application_review.sql', import.meta.url)
const foundationUrl = new URL('../database/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)

const [canonicalSql, releaseSql, foundationSql] = await Promise.all([
  readFile(canonicalUrl, 'utf8'),
  readFile(releaseUrl, 'utf8'),
  readFile(foundationUrl, 'utf8')
])

assert.equal(releaseSql, canonicalSql, 'server 008 must be byte-for-byte identical to canonical 008')

const executableSql = canonicalSql.replace(/^\s*--.*$/gm, '')
const alterTargets = [...executableSql.matchAll(/ALTER\s+TABLE\s+`([^`]+)`/gi)].map((match) => match[1])
assert.deepEqual(alterTargets, ['book_benefit_campaigns', 'book_benefit_applications'])
assert.equal((executableSql.match(/\bALTER\s+TABLE\b/gi) || []).length, 2)

const expectedAddedColumns = [
  'rules_version',
  'accepted_rules_version',
  'rules_accepted_at',
  'seller_verification_code',
  'customer_service_channel'
]
const addedColumns = [...executableSql.matchAll(/ADD\s+COLUMN\s+`([^`]+)`/gi)].map((match) => match[1])
assert.deepEqual(addedColumns, expectedAddedColumns)

const requiredDefinitions = [
  /ADD COLUMN `rules_version` VARCHAR\(32\) NULL DEFAULT NULL/,
  /ADD COLUMN `accepted_rules_version` VARCHAR\(32\) NULL DEFAULT NULL/,
  /ADD COLUMN `rules_accepted_at` DATETIME NULL DEFAULT NULL/,
  /ADD COLUMN `seller_verification_code` VARCHAR\(32\) NULL DEFAULT NULL/,
  /ADD COLUMN `customer_service_channel` VARCHAR\(32\) NULL DEFAULT NULL/
]
for (const definition of requiredDefinitions) assert.match(executableSql, definition)

const statusClause = executableSql.match(/MODIFY COLUMN `status` ([^;\n]+(?:\n[^;\n]+)*)/)
assert(statusClause)
assert.match(
  statusClause[0],
  /ENUM\('pending', 'needs_more_info', 'approved', 'rejected', 'cancelled'\) NOT NULL DEFAULT 'pending'/
)

const claimClause = executableSql.match(/MODIFY COLUMN `order_claim_type` ([^\n;]+)/)
assert(claimClause)
assert.match(claimClause[0], /ENUM\('unreviewed', 'standard', 'manual_exception'\) NOT NULL/)
assert.doesNotMatch(claimClause[0], /\bDEFAULT\b/i)

const indexName = 'idx_book_benefit_applications_campaign_status_created'
assert.match(
  executableSql,
  new RegExp('ADD KEY `' + indexName + '` \\(`campaign_id`, `status`, `created_at`, `id`\\)')
)
assert.doesNotMatch(executableSql, new RegExp('ADD UNIQUE (?:KEY|INDEX) `' + indexName + '`', 'i'))

assert.doesNotMatch(executableSql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|REPLACE|INSERT)\b/i)
assert.doesNotMatch(executableSql, /\bFOREIGN\s+KEY\b/i)
assert.doesNotMatch(executableSql, /\b(?:PREPARE|EXECUTE|DEALLOCATE)\b/i)
assert.doesNotMatch(executableSql, /CREATE\s+TABLE/i)

const forbiddenSchemaTerms = [
  'external_session_ref',
  'order_reference_masked',
  'review_note',
  'screenshot',
  'image_url',
  'object_storage',
  'storage_key',
  'chat_record',
  'order_display',
  'metadata_json',
  'payment_id',
  'redemption_code',
  'membership_grant',
  'entitlement_transaction'
]
for (const term of forbiddenSchemaTerms) {
  assert(!canonicalSql.toLowerCase().includes(term), `008 contains forbidden schema concept: ${term}`)
}

for (const preservedColumn of [
  'order_channel',
  'review_reason_code',
  'reviewed_by',
  'reviewed_at',
  'approved_order_claim_hash',
  'approved_order_claim_hash_version'
]) {
  assert(!addedColumns.includes(preservedColumn), `008 must not recreate or rename ${preservedColumn}`)
}

assert.match(
  foundationSql,
  /`status` ENUM\('pending', 'approved', 'rejected', 'cancelled'\) NOT NULL DEFAULT 'pending'/
)
assert.match(
  foundationSql,
  /`order_claim_type` ENUM\('standard', 'manual_exception'\) NOT NULL COMMENT/
)
for (const column of expectedAddedColumns) {
  assert(!foundationSql.includes('`' + column + '`'), `007 unexpectedly contains 008 column ${column}`)
}

assert.match(canonicalSql, /INFORMATION_SCHEMA\.COLUMNS/)
assert.match(canonicalSql, /INFORMATION_SCHEMA\.STATISTICS/)
assert.match(canonicalSql, /EXACT_007 -> EXECUTE 008/)
assert.match(canonicalSql, /EXACT_008 -> SKIP 008/)
assert.match(canonicalSql, /PARTIAL_OR_MISMATCH -> STOP/)
assert.match(canonicalSql, /campaigns ALTER succeeds and the applications ALTER fails/)

const OLD_STATUS = "enum('pending','approved','rejected','cancelled')"
const NEW_STATUS = "enum('pending','needs_more_info','approved','rejected','cancelled')"
const OLD_CLAIM = "enum('standard','manual_exception')"
const NEW_CLAIM = "enum('unreviewed','standard','manual_exception')"
const expectedIndexColumns = ['campaign_id', 'status', 'created_at', 'id']

function expectedColumn(type) {
  return { type, nullable: 'YES', defaultValue: null }
}

function classifyPreflight(state) {
  const campaign = state.campaignRules || null
  const applicationColumns = state.applicationColumns || {}
  const addedColumnNames = Object.keys(applicationColumns)
  const status = state.status
  const claim = state.claim
  const index = state.index || []
  const exactOldEnums = status.type === OLD_STATUS && status.nullable === 'NO' && status.defaultValue === 'pending' &&
    claim.type === OLD_CLAIM && claim.nullable === 'NO' && claim.defaultValue === null
  const exactNewEnums = status.type === NEW_STATUS && status.nullable === 'NO' && status.defaultValue === 'pending' &&
    claim.type === NEW_CLAIM && claim.nullable === 'NO' && claim.defaultValue === null
  const exactCampaign = campaign && campaign.type === 'varchar(32)' && campaign.nullable === 'YES' && campaign.defaultValue === null
  const expectedApplication = {
    accepted_rules_version: expectedColumn('varchar(32)'),
    rules_accepted_at: expectedColumn('datetime'),
    seller_verification_code: expectedColumn('varchar(32)'),
    customer_service_channel: expectedColumn('varchar(32)')
  }
  const exactApplication = Object.entries(expectedApplication).every(([name, expected]) =>
    JSON.stringify(applicationColumns[name]) === JSON.stringify(expected)
  ) && addedColumnNames.length === 4
  const exactIndex = index.length === 4 && index.every((entry, offset) =>
    entry.name === indexName && entry.nonUnique === 1 && entry.sequence === offset + 1 &&
    entry.column === expectedIndexColumns[offset]
  )

  if (!campaign && addedColumnNames.length === 0 && index.length === 0 && exactOldEnums) return 'execute'
  if (exactCampaign && exactApplication && exactIndex && exactNewEnums) return 'skip'
  return 'stop'
}

function oldState() {
  return {
    campaignRules: null,
    applicationColumns: {},
    status: { type: OLD_STATUS, nullable: 'NO', defaultValue: 'pending' },
    claim: { type: OLD_CLAIM, nullable: 'NO', defaultValue: null },
    index: []
  }
}

function migratedState() {
  return {
    campaignRules: expectedColumn('varchar(32)'),
    applicationColumns: {
      accepted_rules_version: expectedColumn('varchar(32)'),
      rules_accepted_at: expectedColumn('datetime'),
      seller_verification_code: expectedColumn('varchar(32)'),
      customer_service_channel: expectedColumn('varchar(32)')
    },
    status: { type: NEW_STATUS, nullable: 'NO', defaultValue: 'pending' },
    claim: { type: NEW_CLAIM, nullable: 'NO', defaultValue: null },
    index: expectedIndexColumns.map((column, index) => ({
      name: indexName,
      nonUnique: 1,
      sequence: index + 1,
      column
    }))
  }
}

assert.equal(classifyPreflight(oldState()), 'execute')
assert.equal(classifyPreflight(migratedState()), 'skip')

const campaignOnly = oldState()
campaignOnly.campaignRules = expectedColumn('varchar(32)')
assert.equal(classifyPreflight(campaignOnly), 'stop')

const partialApplication = oldState()
partialApplication.applicationColumns.accepted_rules_version = expectedColumn('varchar(32)')
assert.equal(classifyPreflight(partialApplication), 'stop')

const wrongEnum = migratedState()
wrongEnum.status.type = "enum('pending','approved')"
assert.equal(classifyPreflight(wrongEnum), 'stop')

const wrongIndex = migratedState()
wrongIndex.index[1].column = 'created_at'
assert.equal(classifyPreflight(wrongIndex), 'stop')

const wrongColumn = migratedState()
wrongColumn.applicationColumns.rules_accepted_at.nullable = 'NO'
assert.equal(classifyPreflight(wrongColumn), 'stop')

console.log('book-benefit application review migration static tests passed')
