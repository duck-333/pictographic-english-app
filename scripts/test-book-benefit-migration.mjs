import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const canonicalMigrationUrl = new URL('../database/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)
const releaseMigrationUrl = new URL('../server/migrations/007_create_book_benefit_redemption_foundation.sql', import.meta.url)

const [canonicalSql, releaseSql] = await Promise.all([
  readFile(canonicalMigrationUrl, 'utf8'),
  readFile(releaseMigrationUrl, 'utf8')
])

assert.equal(releaseSql, canonicalSql, 'server release migration must remain byte-for-byte identical to canonical SQL')

const expectedTables = [
  'book_benefit_campaigns',
  'book_benefit_issuances',
  'book_benefit_codes',
  'book_benefit_redemptions',
  'book_benefit_audit_events'
]
const createdTables = [...releaseSql.matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`/g)].map((match) => match[1])
assert.deepEqual(createdTables, expectedTables)

const executableSql = releaseSql.replace(/^\s*--.*$/gm, '')
assert.doesNotMatch(executableSql, /\b(?:DROP|TRUNCATE|DELETE|REPLACE)\b/i)
assert.doesNotMatch(executableSql, /^\s*(?:INSERT|UPDATE)\b/im)
assert.doesNotMatch(executableSql, /\bFOREIGN\s+KEY\s*\(/i)

assert.match(releaseSql, /`campaign_phone_identity_hash` BINARY\(32\) NULL DEFAULT NULL/)
assert.match(releaseSql, /`campaign_phone_hash_version` VARCHAR\(16\) NULL DEFAULT NULL/)
assert.match(releaseSql, /ADD KEY `idx_user_phone_bindings_campaign_identity` \(`campaign_phone_identity_hash`\)/)
assert.doesNotMatch(releaseSql, /UNIQUE KEY `[^`]*campaign_identity[^`]*` \(`campaign_phone_identity_hash`\)/)
assert.match(releaseSql, /INFORMATION_SCHEMA\.COLUMNS/)
assert.match(releaseSql, /INFORMATION_SCHEMA\.STATISTICS/)
assert.match(releaseSql, /index must report NON_UNIQUE=1/)
assert.match(releaseSql, /Execute the ALTER only when both columns and the index are absent/)

const requiredConstraints = [
  'UNIQUE KEY `uk_book_benefit_campaigns_key` (`campaign_key`)',
  'UNIQUE KEY `uk_book_benefit_issuances_no` (`issuance_no`)',
  'UNIQUE KEY `uk_book_benefit_issuances_campaign_order` (`campaign_id`, `approved_order_claim_hash`)',
  'UNIQUE KEY `uk_book_benefit_issuances_idempotency` (`create_idempotency_key`)',
  'UNIQUE KEY `uk_book_benefit_codes_hash` (`code_hash`)',
  'UNIQUE KEY `uk_book_benefit_codes_issuance_generation` (`issuance_id`, `generation_no`)',
  'UNIQUE KEY `uk_book_benefit_codes_issue_idempotency` (`issue_idempotency_key`)',
  'UNIQUE KEY `uk_book_benefit_codes_replacement` (`replacement_code_id`)',
  'UNIQUE KEY `uk_book_benefit_codes_active_issuance` (`active_issuance_id`)',
  'UNIQUE KEY `uk_book_benefit_redemptions_redemption_id` (`redemption_id`)',
  'UNIQUE KEY `uk_book_benefit_redemptions_code` (`code_id`)',
  'UNIQUE KEY `uk_book_benefit_redemptions_campaign_user` (`campaign_id`, `redeemer_user_id`)',
  'UNIQUE KEY `uk_book_benefit_redemptions_campaign_phone` (`campaign_id`, `redeemer_phone_identity_hash`)',
  'UNIQUE KEY `uk_book_benefit_redemptions_idempotency` (`idempotency_key`)',
  'UNIQUE KEY `uk_book_benefit_redemptions_membership_grant` (`membership_grant_id`)',
  'UNIQUE KEY `uk_book_benefit_redemptions_entitlement_transaction` (`entitlement_transaction_id`)'
]

for (const constraint of requiredConstraints) {
  assert(releaseSql.includes(constraint), `migration is missing required constraint: ${constraint}`)
}

assert.match(releaseSql, /`code_hash` BINARY\(32\) NOT NULL/)
assert.match(releaseSql, /`code_hash_version` VARCHAR\(16\) NOT NULL/)
assert.match(
  releaseSql,
  /`active_issuance_id` BIGINT UNSIGNED GENERATED ALWAYS AS \(\s*CASE WHEN `status` = 'issued' THEN `issuance_id` ELSE NULL END\s*\) VIRTUAL/
)

function activeIssuanceId(status, issuanceId) {
  return status === 'issued' ? issuanceId : null
}

function insertCode(rows, status, issuanceId) {
  const activeId = activeIssuanceId(status, issuanceId)
  if (activeId !== null && rows.some((row) => row.activeIssuanceId === activeId)) {
    const error = new Error('simulated unique-index conflict')
    error.code = 'ER_DUP_ENTRY'
    throw error
  }
  rows.push({ status, issuanceId, activeIssuanceId: activeId })
}

const issuedRows = []
insertCode(issuedRows, 'issued', 42)
assert.throws(() => insertCode(issuedRows, 'issued', 42), (error) => error.code === 'ER_DUP_ENTRY')
issuedRows[0].status = 'voided'
issuedRows[0].activeIssuanceId = activeIssuanceId('voided', 42)
insertCode(issuedRows, 'issued', 42)

const inactiveRows = []
for (const status of ['redeemed', 'voided', 'expired', 'voided']) insertCode(inactiveRows, status, 42)
assert.deepEqual(
  inactiveRows.map((row) => row.activeIssuanceId),
  [null, null, null, null],
  'non-issued rows remain NULL and rely on MySQL unique-index multiple-NULL semantics'
)

function extractColumnNames(tableName) {
  const tableMatch = releaseSql.match(new RegExp(
    'CREATE TABLE IF NOT EXISTS `' + tableName + '` \\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB'
  ))
  assert(tableMatch, `missing table body for ${tableName}`)
  return [...tableMatch[1].matchAll(/^\s+`([^`]+)`/gm)].map((match) => match[1])
}

const codeColumns = extractColumnNames('book_benefit_codes')
assert(!codeColumns.includes('plaintext_code'))
assert(!codeColumns.includes('encrypted_code'))
assert(!codeColumns.some((column) => /plain|encrypted|recoverable/i.test(column)))

for (const tableName of expectedTables) {
  const columns = extractColumnNames(tableName)
  assert(!columns.some((column) => /screenshot|image_url|object_storage|storage_key|chat/i.test(column)))
}

const auditColumns = extractColumnNames('book_benefit_audit_events')
assert(!auditColumns.some((column) => /hash|phone|order|screenshot|token|chat/i.test(column)))

const expectedColumns = new Map([
  ['book_benefit_campaigns', [
    'id', 'campaign_key', 'name', 'status', 'benefit_days', 'starts_at', 'ends_at', 'created_by', 'created_at', 'updated_at'
  ]],
  ['book_benefit_issuances', [
    'id', 'issuance_no', 'campaign_id', 'order_claim_type', 'approved_order_claim_hash', 'order_claim_hash_version',
    'order_channel', 'status', 'reviewed_by', 'review_reason_code', 'reviewed_at', 'create_idempotency_key',
    'created_at', 'updated_at'
  ]],
  ['book_benefit_codes', [
    'id', 'issuance_id', 'generation_no', 'code_hash', 'code_hash_version', 'status', 'active_issuance_id',
    'issue_idempotency_key', 'replacement_code_id', 'issued_by', 'issued_at', 'expires_at', 'redeemed_at',
    'voided_at', 'voided_by', 'void_reason_code', 'created_at', 'updated_at'
  ]],
  ['book_benefit_redemptions', [
    'id', 'redemption_id', 'code_id', 'campaign_id', 'issuance_id', 'redeemer_user_id',
    'redeemer_phone_identity_hash', 'redeemer_phone_hash_version', 'idempotency_key', 'membership_grant_id',
    'entitlement_transaction_id', 'redeemed_at', 'created_at'
  ]],
  ['book_benefit_audit_events', [
    'id', 'event_id', 'campaign_id', 'issuance_id', 'code_id', 'redemption_record_id', 'event_type',
    'actor_type', 'actor_id', 'result', 'reason_code', 'created_at'
  ]]
])

for (const [tableName, columns] of expectedColumns) {
  assert.deepEqual(extractColumnNames(tableName), columns, `${tableName} columns changed unexpectedly`)
}

assert.match(releaseSql, /`membership_grant_id` BIGINT UNSIGNED NOT NULL/)
assert.match(releaseSql, /`entitlement_transaction_id` VARCHAR\(64\) NOT NULL/)
assert.match(releaseSql, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/g)

console.log('book-benefit migration static tests passed')
