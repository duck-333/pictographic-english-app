import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const canonicalMigrationUrl = new URL('../database/migrations/006_create_membership_grants.sql', import.meta.url)
const releaseMigrationUrl = new URL('../server/migrations/006_create_membership_grants.sql', import.meta.url)

const [canonicalSql, releaseSql] = await Promise.all([
  readFile(canonicalMigrationUrl, 'utf8'),
  readFile(releaseMigrationUrl, 'utf8')
])

assert.equal(releaseSql, canonicalSql, 'server release migration must remain identical to the reviewed canonical migration')
assert.match(releaseSql, /CREATE TABLE IF NOT EXISTS `membership_grants`/)
const executableSql = releaseSql.replace(/^\s*--.*$/gm, '')
assert.doesNotMatch(executableSql, /\b(?:DROP|TRUNCATE|DELETE|REPLACE|ALTER)\b/i)

const requiredColumns = new Map([
  ['id', 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT'],
  ['user_id', 'BIGINT UNSIGNED NOT NULL'],
  ['source_type', 'VARCHAR(64) NOT NULL'],
  ['source_id', 'VARCHAR(191) NOT NULL'],
  ['redemption_code_id', 'BIGINT UNSIGNED NULL DEFAULT NULL'],
  ['days_granted', 'INT UNSIGNED NOT NULL'],
  ['duration_seconds', 'BIGINT UNSIGNED NOT NULL'],
  ['status', "ENUM('granted', 'revoked') NOT NULL DEFAULT 'granted'"],
  ['granted_at', 'DATETIME NOT NULL'],
  ['effective_start_at', 'DATETIME NOT NULL'],
  ['effective_end_at', 'DATETIME NOT NULL'],
  ['consumed_seconds_at_revoke', 'BIGINT UNSIGNED NOT NULL DEFAULT 0'],
  ['revoked_seconds', 'BIGINT UNSIGNED NOT NULL DEFAULT 0'],
  ['revoked_at', 'DATETIME NULL DEFAULT NULL'],
  ['revoked_by', 'VARCHAR(191) NULL DEFAULT NULL'],
  ['revoke_reason', 'VARCHAR(512) NULL DEFAULT NULL'],
  ['idempotency_key', 'VARCHAR(191) NOT NULL'],
  ['grant_transaction_id', 'VARCHAR(64) NULL DEFAULT NULL'],
  ['revoke_transaction_id', 'VARCHAR(64) NULL DEFAULT NULL'],
  ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
  ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP']
])

for (const [column, definition] of requiredColumns) {
  assert(
    releaseSql.includes(`\`${column}\` ${definition}`),
    `membership_grants migration is missing the required ${column} definition`
  )
}

const requiredConstraints = [
  'PRIMARY KEY (`id`)',
  'UNIQUE KEY `uk_membership_grants_idempotency` (`idempotency_key`)',
  'UNIQUE KEY `uk_membership_grants_source` (`source_type`, `source_id`)',
  'UNIQUE KEY `uk_membership_grants_redemption_code` (`redemption_code_id`)',
  'KEY `idx_membership_grants_user_fifo` (`user_id`, `granted_at`, `id`)',
  'KEY `idx_membership_grants_user_end` (`user_id`, `effective_end_at`)',
  'KEY `idx_membership_grants_user_status` (`user_id`, `status`)'
]

for (const constraint of requiredConstraints) {
  assert(releaseSql.includes(constraint), `membership_grants migration is missing: ${constraint}`)
}

assert.match(releaseSql, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/)
assert.doesNotMatch(executableSql, /FOREIGN KEY/i)

console.log('membership_grants migration tests passed')
