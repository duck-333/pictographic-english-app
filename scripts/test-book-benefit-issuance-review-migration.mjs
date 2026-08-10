import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const canonicalUrl = new URL('../database/migrations/008_extend_book_benefit_issuance_review.sql', import.meta.url)
const releaseUrl = new URL('../server/migrations/008_extend_book_benefit_issuance_review.sql', import.meta.url)
const foundationUrl = new URL('../database/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)

const [canonicalSql, releaseSql, foundationSql] = await Promise.all([
  readFile(canonicalUrl, 'utf8'),
  readFile(releaseUrl, 'utf8'),
  readFile(foundationUrl, 'utf8')
])

assert.equal(releaseSql, canonicalSql, 'server 008 must be byte-for-byte identical to canonical 008')

const executableSql = canonicalSql.replace(/^\s*--.*$/gm, '')
const alterTargets = [...executableSql.matchAll(/ALTER\s+TABLE\s+`([^`]+)`/gi)].map((match) => match[1])
assert.deepEqual(alterTargets, ['book_benefit_campaigns', 'book_benefit_issuances'])
assert.equal((executableSql.match(/\bALTER\s+TABLE\b/gi) || []).length, 2)

const expectedAddedColumns = [
  'rules_version',
  'qualification_rules_version',
  'seller_verification_code',
  'customer_service_channel'
]
const addedColumns = [...executableSql.matchAll(/ADD\s+COLUMN\s+`([^`]+)`/gi)].map((match) => match[1])
assert.deepEqual(addedColumns, expectedAddedColumns)

for (const definition of [
  /ADD COLUMN `rules_version` VARCHAR\(32\) NULL DEFAULT NULL/,
  /ADD COLUMN `qualification_rules_version` VARCHAR\(32\) NULL DEFAULT NULL/,
  /ADD COLUMN `seller_verification_code` VARCHAR\(32\) NULL DEFAULT NULL/,
  /ADD COLUMN `customer_service_channel` VARCHAR\(32\) NULL DEFAULT NULL/
]) {
  assert.match(executableSql, definition)
}

const indexName = 'idx_book_benefit_issuances_campaign_status_created'
assert.match(
  executableSql,
  new RegExp('ADD KEY `' + indexName + '` \\(`campaign_id`, `status`, `created_at`, `id`\\)')
)
assert.doesNotMatch(executableSql, new RegExp('ADD UNIQUE (?:KEY|INDEX) `' + indexName + '`', 'i'))

assert.doesNotMatch(executableSql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|REPLACE|INSERT)\b/i)
assert.doesNotMatch(executableSql, /\bFOREIGN\s+KEY\b/i)
assert.doesNotMatch(executableSql, /\b(?:PREPARE|EXECUTE|DEALLOCATE)\b/i)
assert.doesNotMatch(executableSql, /CREATE\s+TABLE/i)
assert.match(canonicalSql, /INFORMATION_SCHEMA\.TABLES[\s\S]*book_benefit_applications/i)
assert.doesNotMatch(canonicalSql, /(CREATE|ALTER)\s+TABLE[^;]*book_benefit_applications|application_id|applicant_/i)

for (const term of [
  'external_session_ref', 'order_reference_masked', 'review_note', 'screenshot', 'image_url',
  'object_storage', 'storage_key', 'chat_record', 'order_display', 'metadata_json', 'payment_id',
  'plaintext_code', 'encrypted_code'
]) {
  assert(!canonicalSql.toLowerCase().includes(term), `008 contains forbidden schema concept: ${term}`)
}

assert.match(
  foundationSql,
  /`status` ENUM\('approved', 'cancelled'\) NOT NULL DEFAULT 'approved'/
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
assert.match(canonicalSql, /campaigns ALTER succeeds and the issuances ALTER fails/)

const STATUS = "enum('approved','cancelled')"
const CLAIM = "enum('standard','manual_exception')"
const expectedIndexColumns = ['campaign_id', 'status', 'created_at', 'id']

function expectedColumn(type) {
  return { type, nullable: 'YES', defaultValue: null }
}

function classifyPreflight(state) {
  if (state.legacyApplicationTable) return 'stop'
  const campaign = state.campaignRules || null
  const issuanceColumns = state.issuanceColumns || {}
  const addedColumnNames = Object.keys(issuanceColumns)
  const status = state.status
  const claim = state.claim
  const index = state.index || []
  const exactEnums = status.type === STATUS && status.nullable === 'NO' && status.defaultValue === 'approved' &&
    claim.type === CLAIM && claim.nullable === 'NO' && claim.defaultValue === null
  const exactCampaign = campaign && campaign.type === 'varchar(32)' && campaign.nullable === 'YES' && campaign.defaultValue === null
  const expectedIssuance = {
    qualification_rules_version: expectedColumn('varchar(32)'),
    seller_verification_code: expectedColumn('varchar(32)'),
    customer_service_channel: expectedColumn('varchar(32)')
  }
  const exactIssuance = Object.entries(expectedIssuance).every(([name, expected]) =>
    JSON.stringify(issuanceColumns[name]) === JSON.stringify(expected)
  ) && addedColumnNames.length === 3
  const exactIndex = index.length === 4 && index.every((entry, offset) =>
    entry.name === indexName && entry.nonUnique === 1 && entry.sequence === offset + 1 &&
    entry.column === expectedIndexColumns[offset]
  )

  if (!campaign && addedColumnNames.length === 0 && index.length === 0 && exactEnums) return 'execute'
  if (exactCampaign && exactIssuance && exactIndex && exactEnums) return 'skip'
  return 'stop'
}

function exact007State() {
  return {
    campaignRules: null,
    issuanceColumns: {},
    status: { type: STATUS, nullable: 'NO', defaultValue: 'approved' },
    claim: { type: CLAIM, nullable: 'NO', defaultValue: null },
    index: []
  }
}

function exact008State() {
  return {
    campaignRules: expectedColumn('varchar(32)'),
    issuanceColumns: {
      qualification_rules_version: expectedColumn('varchar(32)'),
      seller_verification_code: expectedColumn('varchar(32)'),
      customer_service_channel: expectedColumn('varchar(32)')
    },
    status: { type: STATUS, nullable: 'NO', defaultValue: 'approved' },
    claim: { type: CLAIM, nullable: 'NO', defaultValue: null },
    index: expectedIndexColumns.map((column, offset) => ({
      name: indexName,
      nonUnique: 1,
      sequence: offset + 1,
      column
    }))
  }
}

assert.equal(classifyPreflight(exact007State()), 'execute')
assert.equal(classifyPreflight(exact008State()), 'skip')

const campaignOnly = exact007State()
campaignOnly.campaignRules = expectedColumn('varchar(32)')
assert.equal(classifyPreflight(campaignOnly), 'stop')

const partialIssuance = exact007State()
partialIssuance.issuanceColumns.qualification_rules_version = expectedColumn('varchar(32)')
assert.equal(classifyPreflight(partialIssuance), 'stop')

const wrongEnum = exact008State()
wrongEnum.status.type = "enum('approved')"
assert.equal(classifyPreflight(wrongEnum), 'stop')

const wrongIndex = exact008State()
wrongIndex.index[1].column = 'created_at'
assert.equal(classifyPreflight(wrongIndex), 'stop')

const wrongColumn = exact008State()
wrongColumn.issuanceColumns.seller_verification_code.nullable = 'NO'
assert.equal(classifyPreflight(wrongColumn), 'stop')

const legacyStructure = exact007State()
legacyStructure.legacyApplicationTable = true
assert.equal(classifyPreflight(legacyStructure), 'stop')

console.log('book-benefit issuance review migration static tests passed')
