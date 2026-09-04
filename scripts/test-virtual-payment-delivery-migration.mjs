import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readDeliverySchemaContract, assertDeliverySchema } from '../server/virtual-payment-delivery-schema.mjs'
import { checkVirtualPaymentDeliverySchema } from './check-virtual-payment-delivery-schema.mjs'

const canonicalUrl = new URL('../database/migrations/010_create_virtual_payment_delivery_attempts.sql', import.meta.url)
const releaseUrl = new URL('../server/migrations/010_create_virtual_payment_delivery_attempts.sql', import.meta.url)
const [canonical, release] = await Promise.all([readFile(canonicalUrl, 'utf8'), readFile(releaseUrl, 'utf8')])

assert.equal(release, canonical)
for (const url of [canonicalUrl, releaseUrl]) {
  const bytes = await readFile(url)
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes), canonical)
}
const schema = await readDeliverySchemaContract()
assert.equal(schema.length, 2)
assert.equal(schema.reduce((sum, table) => sum + table.foreignKeys.length, 0), 5)
assert(schema[0].columns.some((column) => column.name === 'completion_source'))
assert(schema[1].columns.some((column) => column.name === 'response_env_type'))
for (const expected of [
  'CREATE TABLE IF NOT EXISTS `virtual_payment_delivery_attempts`',
  'CREATE TABLE IF NOT EXISTS `virtual_payment_delivery_queries`',
  "ENUM('claimed', 'dispatching', 'explicit_failed', 'uncertain', 'confirming', 'succeeded', 'manual_review', 'superseded')",
  "ENUM('not_started', 'success', 'explicit_failure', 'uncertain')",
  'UNIQUE KEY `uk_virtual_payment_delivery_operation` (`operation_id`)',
  'UNIQUE KEY `uk_virtual_payment_delivery_lease_owner` (`lease_owner`)',
  'UNIQUE KEY `uk_virtual_payment_delivery_order_attempt` (`order_id`, `attempt_no`)',
  'UNIQUE KEY `uk_virtual_payment_delivery_active_order` (`active_order_id`)',
  "CASE WHEN `attempt_status` IN ('claimed', 'dispatching', 'uncertain', 'confirming')",
  '`lease_expires_at` DATETIME NULL DEFAULT NULL',
  '`request_started_at` DATETIME NULL DEFAULT NULL',
  '`provider_event_id` BIGINT UNSIGNED NULL DEFAULT NULL',
  '`claimed_order_version` BIGINT UNSIGNED NOT NULL',
  'UNIQUE KEY `uk_virtual_payment_delivery_active_query` (`active_order_id`)',
  'UNIQUE KEY `uk_virtual_payment_delivery_query_sequence` (`attempt_id`, `query_sequence`)',
  'CONSTRAINT `fk_virtual_payment_delivery_attempt_order`',
  'CONSTRAINT `fk_virtual_payment_delivery_attempt_event`',
  'CONSTRAINT `fk_virtual_payment_delivery_query_order`',
  'CONSTRAINT `fk_virtual_payment_delivery_query_attempt`',
  'CONSTRAINT `fk_virtual_payment_delivery_query_event`',
  'ON UPDATE RESTRICT ON DELETE RESTRICT'
]) assert(canonical.includes(expected), expected)

for (const forbidden of ['access_token', 'app_secret', 'session_key', 'request_url', 'response_body', 'DROP TABLE']) {
  assert(!canonical.toLowerCase().includes(forbidden))
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(packageJson.scripts['predev:api'], undefined, 'actual entry owns the single startup connection')
assert.equal(packageJson.scripts['check:virtual-payment-delivery-schema'], 'node scripts/check-virtual-payment-delivery-schema.mjs')
assert(packageJson.scripts['check:server:delivery'].includes('node scripts/test-virtual-payment-delivery-migration.mjs'))
function schemaFixture(transform) {
  return { async execute(sql, params) {
    const table = schema.find((item) => item.table === params?.[0])
    if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [[{ ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_unicode_ci' }]]
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [table.columns.map((c) => ({
      COLUMN_NAME: c.name, COLUMN_TYPE: c.type, IS_NULLABLE: c.nullable ? 'YES' : 'NO', COLUMN_DEFAULT: c.default,
      EXTRA: [c.auto ? 'auto_increment' : '', c.update ? 'on update CURRENT_TIMESTAMP' : '', c.stored ? 'STORED GENERATED' : ''].join(' '),
      GENERATION_EXPRESSION: c.stored ? transform(table.statement.match(/GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/)[1]) : '', COLLATION_NAME: c.collation
    }))]
    if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) return [table.indexes.flatMap((idx) => idx.columns.map((column, i) => ({ INDEX_NAME: idx.name, NON_UNIQUE: idx.unique ? 0 : 1, COLUMN_NAME: column, SEQ_IN_INDEX: i + 1, SUB_PART: null, INDEX_TYPE: 'BTREE', IS_VISIBLE: 'YES', COLLATION: 'A' })))]
    if (sql.includes('KEY_COLUMN_USAGE')) return [table.foreignKeys.map((fk) => ({ CONSTRAINT_NAME: fk.name, COLUMN_NAME: fk.column, REFERENCED_TABLE_NAME: fk.table, REFERENCED_COLUMN_NAME: fk.referencedColumn, REFERENCED_TABLE_SCHEMA: 'fixture', UPDATE_RULE: fk.update, DELETE_RULE: fk.delete }))]
    if (sql.includes('DATABASE() AS')) return [[{ schema_name: 'fixture' }]]
    throw new Error('Unexpected fixture query')
  } }
}
await assertDeliverySchema(schemaFixture((sql) => sql))
await assertDeliverySchema(schemaFixture((sql) => sql.replace(/ CASE WHEN /i, ' CASE\n WHEN ').replace(/ THEN /i, '\n THEN\t').replace(/,/g, ',\n ')))
for (const [from, to] of [["'claimed'", "'claim ed'"], ["'claimed'", "' claimed'"], ["'claimed'", "'claimed '"], ["'claimed'", "'Claimed'"], ["'dispatching'", "'dispatching '"], ["'claimed'", "'other'"], [' IN ', ' NOT IN '], ['THEN `order_id`', 'THEN `user_id`'], ['`order_id`', '`order id`'], ["'claimed'", "'claim\\'ed'"], ["'claimed'", "'claim''ed'"]]) {
  await assert.rejects(assertDeliverySchema(schemaFixture((sql) => sql.replace(from, to))), (error) => error.code === 'PAYMENT_DELIVERY_SCHEMA_MISMATCH' && error.message === 'Payment delivery schema mismatch; controlled manual recovery is required.')
}
let connects = 0, ends = 0
await assert.rejects(checkVirtualPaymentDeliverySchema({ VIRTUAL_PAYMENT_ENABLED: 'true', DB_USER: 'fixture', DB_PASSWORD: 'secret-sentinel' }, async () => {
  connects++
  return { async execute() { throw new Error('secret-sentinel SELECT * FROM private') }, async end() { ends++ } }
}), (error) => error.code === 'PAYMENT_DELIVERY_SCHEMA_MISMATCH' && !error.message.includes('secret-sentinel'))
assert.equal(connects, 1)
assert.equal(ends, 1)
console.log('virtual payment delivery migration tests passed, including quote-aware formal fixtures and connection cleanup')
