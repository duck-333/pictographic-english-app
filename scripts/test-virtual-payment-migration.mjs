import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const canonicalUrl = new URL('../database/migrations/009_create_virtual_payment_foundation.sql', import.meta.url)
const releaseUrl = new URL('../server/migrations/009_create_virtual_payment_foundation.sql', import.meta.url)

const [canonicalSql, releaseSql] = await Promise.all([
  readFile(canonicalUrl, 'utf8'),
  readFile(releaseUrl, 'utf8')
])

assert.equal(releaseSql, canonicalSql, 'server migration must be byte-identical to the canonical migration')
const executableSql = canonicalSql.replace(/^\s*--.*$/gm, '')
assert.doesNotMatch(executableSql, /^\s*(?:DROP|TRUNCATE|DELETE|ALTER|UPDATE|INSERT|REPLACE)\b/im)
const statementSql = executableSql.replace(/'(?:''|[^'])*'/g, "''")
for (const statement of statementSql.split(';').map((value) => value.trim()).filter(Boolean)) {
  assert.match(statement, /^CREATE TABLE IF NOT EXISTS\b/i, 'migration may only contain additive CREATE TABLE statements')
}
assert.equal((executableSql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 2)
assert.match(executableSql, /CREATE TABLE IF NOT EXISTS `virtual_payment_orders`/)
assert.match(executableSql, /CREATE TABLE IF NOT EXISTS `virtual_payment_events`/)
assert.doesNotMatch(executableSql, /FOREIGN KEY/i)

const orderColumns = [
  'id', 'order_no', 'user_id', 'client_request_id', 'internal_sku', 'product_id', 'product_name',
  'quantity', 'unit_price_fen', 'order_amount_fen', 'paid_amount_fen', 'currency', 'environment',
  'wechat_env', 'payment_channel', 'client_platform', 'provider_order_id', 'provider_transaction_id',
  'payment_status', 'entitlement_status', 'delivery_status', 'client_result', 'membership_grant_id',
  'entitlement_transaction_id', 'paid_at', 'entitlement_granted_at', 'delivered_at', 'last_queried_at',
  'next_retry_at', 'retry_count', 'last_error_code', 'version', 'created_at', 'updated_at'
]
const eventColumns = [
  'id', 'event_key', 'event_type', 'order_id', 'order_no', 'provider_order_id',
  'provider_transaction_id', 'payload_hash', 'processing_status', 'received_count',
  'processed_at', 'attempt_count', 'last_error_code', 'created_at', 'updated_at'
]
for (const column of [...orderColumns, ...eventColumns]) {
  assert(canonicalSql.includes(`\`${column}\``), `migration is missing required column ${column}`)
}

for (const constraint of [
  'UNIQUE KEY `uk_virtual_payment_orders_order_no` (`order_no`)',
  'UNIQUE KEY `uk_virtual_payment_orders_user_request` (`user_id`, `client_request_id`)',
  'UNIQUE KEY `uk_virtual_payment_orders_provider_order` (`environment`, `provider_order_id`)',
  'UNIQUE KEY `uk_virtual_payment_orders_provider_transaction` (`environment`, `provider_transaction_id`)',
  'UNIQUE KEY `uk_virtual_payment_orders_membership_grant` (`membership_grant_id`)',
  'KEY `idx_virtual_payment_orders_user_created` (`user_id`, `created_at`)',
  'KEY `idx_virtual_payment_orders_payment_retry` (`payment_status`, `next_retry_at`)',
  'KEY `idx_virtual_payment_orders_entitlement_retry` (`entitlement_status`, `next_retry_at`)',
  'KEY `idx_virtual_payment_orders_delivery_retry` (`delivery_status`, `next_retry_at`)',
  'UNIQUE KEY `uk_virtual_payment_events_event_key` (`event_key`)'
]) {
  assert(canonicalSql.includes(constraint), `migration is missing required constraint: ${constraint}`)
}

assert.match(canonicalSql, /`payment_status` ENUM\('initializing', 'pending', 'confirming', 'paid', 'closed', 'failed'\)/)
assert.match(canonicalSql, /`entitlement_status` ENUM\('not_ready', 'pending', 'granting', 'granted', 'retryable_failed', 'failed'\)/)
assert.match(canonicalSql, /`delivery_status` ENUM\('not_ready', 'pending', 'confirming', 'delivered', 'retryable_failed', 'manual_review'\)/)
assert.match(canonicalSql, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/)

const declaredColumns = [...canonicalSql.matchAll(/^\s*`([^`]+)`\s+/gm)].map((match) => match[1])
for (const forbidden of [
  'app_key', 'app_secret', 'session_key', 'access_token', 'jwt', 'admin_token',
  'pay_sig', 'signature', 'phone', 'phone_number', 'raw_payload', 'notification_payload'
]) {
  assert(!declaredColumns.includes(forbidden), `migration must not persist sensitive column ${forbidden}`)
}

assert.match(canonicalSql, /`provider_order_id` VARCHAR\(191\) NULL DEFAULT NULL/)
assert.match(canonicalSql, /`provider_transaction_id` VARCHAR\(191\) NULL DEFAULT NULL/)
assert.match(canonicalSql, /`membership_grant_id` BIGINT UNSIGNED NULL DEFAULT NULL/)
assert.match(canonicalSql, /`payload_hash` BINARY\(32\) NOT NULL/)

console.log('virtual payment migration static tests passed')
