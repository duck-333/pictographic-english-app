import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import mysql from 'mysql2/promise'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3308
const EXPECTED_CONFIRMATION = 'local-docker-virtual-payment-only'
const SAFE_DATABASE_PATTERN = /^virtual_payment_test_[a-f0-9]{12}$/
const migrationUrl = new URL('../database/migrations/009_create_virtual_payment_foundation.sql', import.meta.url)

function readConfig(env = process.env) {
  const host = String(env.VIRTUAL_PAYMENT_TEST_DB_HOST || '').trim()
  const rawPort = String(env.VIRTUAL_PAYMENT_TEST_DB_PORT || '').trim()
  const user = String(env.VIRTUAL_PAYMENT_TEST_DB_USER || '').trim()
  const password = String(env.VIRTUAL_PAYMENT_TEST_DB_PASSWORD || '')
  const confirmation = String(env.VIRTUAL_PAYMENT_TEST_ALLOW_DESTRUCTIVE || '').trim()

  assert.equal(host, EXPECTED_HOST, `integration test host must be exactly ${EXPECTED_HOST}`)
  assert.equal(rawPort, String(EXPECTED_PORT), `integration test port must be exactly ${EXPECTED_PORT}`)
  assert(user, 'VIRTUAL_PAYMENT_TEST_DB_USER is required')
  assert(password, 'VIRTUAL_PAYMENT_TEST_DB_PASSWORD is required')
  assert.equal(
    confirmation,
    EXPECTED_CONFIRMATION,
    'VIRTUAL_PAYMENT_TEST_ALLOW_DESTRUCTIVE confirmation does not match'
  )

  return { host, port: EXPECTED_PORT, user, password, confirmation }
}

function quoteDatabase(databaseName) {
  assert.match(databaseName, SAFE_DATABASE_PATTERN, 'unsafe isolated test database name')
  return `\`${databaseName}\``
}

async function expectDuplicate(label, action) {
  let caught = null
  try {
    await action()
  } catch (error) {
    caught = error
  }
  assert(caught, `${label}: expected duplicate-key rejection`)
  assert(
    caught.code === 'ER_DUP_ENTRY' || Number(caught.errno) === 1062,
    `${label}: expected ER_DUP_ENTRY/1062, received ${caught.code || caught.errno || 'unknown'}`
  )
}

async function insertOrder(connection, overrides = {}) {
  const base = {
    orderNo: `vp-${crypto.randomUUID()}`,
    userId: 101,
    clientRequestId: `request-${crypto.randomUUID()}`,
    providerOrderId: null,
    providerTransactionId: null,
    membershipGrantId: null,
    ...overrides
  }
  await connection.execute(
    `INSERT INTO virtual_payment_orders (
       order_no, user_id, client_request_id, internal_sku, product_id, product_name,
       quantity, unit_price_fen, order_amount_fen, currency, environment, wechat_env,
       payment_channel, client_platform, provider_order_id, provider_transaction_id,
       membership_grant_id
     ) VALUES (?, ?, ?, 'membership_30d', 'sandbox-product', '30天学习会员',
       1, 3000, 3000, 'CNY', 'sandbox', 1,
       'wechat_virtual_payment', 'android', ?, ?, ?)`,
    [
      base.orderNo,
      base.userId,
      base.clientRequestId,
      base.providerOrderId,
      base.providerTransactionId,
      base.membershipGrantId
    ]
  )
  return base
}

async function testConstraints(connection) {
  const first = await insertOrder(connection)
  await expectDuplicate('order number uniqueness', () => insertOrder(connection, {
    orderNo: first.orderNo
  }))
  await expectDuplicate('user/client request uniqueness', () => insertOrder(connection, {
    userId: first.userId,
    clientRequestId: first.clientRequestId
  }))

  await insertOrder(connection)
  const [nullProviderRows] = await connection.query(
    `SELECT COUNT(*) AS row_count
       FROM virtual_payment_orders
      WHERE provider_order_id IS NULL
        AND provider_transaction_id IS NULL
        AND membership_grant_id IS NULL`
  )
  assert(Number(nullProviderRows[0].row_count) >= 2, 'nullable unique references must permit multiple unbound orders')

  await insertOrder(connection, {
    providerOrderId: 'provider-order-1',
    providerTransactionId: 'provider-transaction-1',
    membershipGrantId: 7001
  })
  await expectDuplicate('provider order uniqueness within environment', () => insertOrder(connection, {
    providerOrderId: 'provider-order-1'
  }))
  await expectDuplicate('provider transaction uniqueness within environment', () => insertOrder(connection, {
    providerTransactionId: 'provider-transaction-1'
  }))
  await expectDuplicate('membership grant uniqueness', () => insertOrder(connection, {
    membershipGrantId: 7001
  }))

  const payloadHash = crypto.createHash('sha256').update('verified-event-fixture').digest()
  await connection.execute(
    `INSERT INTO virtual_payment_events
      (event_key, event_type, order_no, payload_hash)
     VALUES ('event-1', 'xpay_goods_deliver_notify', ?, ?)`,
    [first.orderNo, payloadHash]
  )
  await expectDuplicate('event key uniqueness', () => connection.execute(
    `INSERT INTO virtual_payment_events
      (event_key, event_type, order_no, payload_hash)
     VALUES ('event-1', 'xpay_goods_deliver_notify', ?, ?)`,
    [first.orderNo, payloadHash]
  ))
}

async function assertIndexes(connection, databaseName) {
  const expected = new Set([
    'uk_virtual_payment_orders_order_no',
    'uk_virtual_payment_orders_user_request',
    'uk_virtual_payment_orders_provider_order',
    'uk_virtual_payment_orders_provider_transaction',
    'uk_virtual_payment_orders_membership_grant',
    'idx_virtual_payment_orders_user_created',
    'idx_virtual_payment_orders_payment_retry',
    'idx_virtual_payment_orders_entitlement_retry',
    'idx_virtual_payment_orders_delivery_retry'
  ])
  const [rows] = await connection.execute(
    `SELECT DISTINCT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'virtual_payment_orders'`,
    [databaseName]
  )
  const actual = new Set(rows.map((row) => row.INDEX_NAME))
  expected.forEach((indexName) => assert(actual.has(indexName), `missing MySQL index ${indexName}`))
}

async function assertDatabaseAbsent(rootConnection, databaseName) {
  const [rows] = await rootConnection.execute(
    `SELECT SCHEMA_NAME
       FROM INFORMATION_SCHEMA.SCHEMATA
      WHERE SCHEMA_NAME = ?`,
    [databaseName]
  )
  assert.equal(rows.length, 0, 'isolated virtual payment test database was not removed')
}

export function createIsolatedDatabaseCleanupSteps({
  getTestConnection,
  rootConnection,
  isDatabaseOwned,
  databaseName,
  config
}) {
  return [
    {
      phase: 'close_test_connection',
      run: async () => {
        const testConnection = getTestConnection()
        if (testConnection) await testConnection.end()
      }
    },
    {
      phase: 'drop_test_database',
      run: async () => {
        if (!isDatabaseOwned()) return
        assert.equal(config.host, EXPECTED_HOST)
        assert.equal(config.port, EXPECTED_PORT)
        assert.equal(config.confirmation, EXPECTED_CONFIRMATION)
        await rootConnection.query(`DROP DATABASE IF EXISTS ${quoteDatabase(databaseName)}`)
      }
    },
    {
      phase: 'verify_database_absent',
      run: async () => assertDatabaseAbsent(rootConnection, databaseName)
    },
    {
      phase: 'close_root_connection',
      run: async () => rootConnection.end()
    }
  ]
}

function safeFailure(error, phase, secretValues = []) {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secretValues) {
    if (secret) message = message.split(String(secret)).join('[REDACTED]')
  }
  const failure = new Error(`${phase}: ${message}`)
  failure.name = 'VirtualPaymentTestFailure'
  failure.code = error && error.code ? error.code : 'VIRTUAL_PAYMENT_TEST_FAILED'
  failure.phase = phase
  return failure
}

export async function runWithGuaranteedCleanup({ runMain, cleanupSteps, secretValues = [] }) {
  let result
  const failures = []
  try {
    result = await runMain()
  } catch (error) {
    failures.push(safeFailure(error, 'main_test', secretValues))
  }

  for (const step of cleanupSteps) {
    try {
      await step.run()
    } catch (error) {
      failures.push(safeFailure(error, step.phase, secretValues))
    }
  }

  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Virtual payment MySQL test and/or cleanup failed.')
  }
  return result
}

export async function runVirtualPaymentMysqlIntegration(env = process.env) {
  const config = readConfig(env)
  const databaseName = `virtual_payment_test_${crypto.randomBytes(6).toString('hex')}`
  assert.match(databaseName, SAFE_DATABASE_PATTERN)
  const migrationSql = await readFile(migrationUrl, 'utf8')
  let rootConnection
  try {
    rootConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      charset: 'utf8mb4',
      timezone: 'Z'
    })
  } catch (error) {
    throw safeFailure(error, 'connect_root', [config.password])
  }

  let databaseOwned = false
  let testConnection = null
  const cleanupSteps = createIsolatedDatabaseCleanupSteps({
    getTestConnection: () => testConnection,
    rootConnection,
    isDatabaseOwned: () => databaseOwned,
    databaseName,
    config
  })

  await runWithGuaranteedCleanup({
    secretValues: [config.password],
    cleanupSteps,
    runMain: async () => {
      await assertDatabaseAbsent(rootConnection, databaseName)
      databaseOwned = true
      await rootConnection.query(
        `CREATE DATABASE ${quoteDatabase(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      )
      testConnection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: databaseName,
        charset: 'utf8mb4',
        timezone: 'Z',
        multipleStatements: true
      })
      await testConnection.query(migrationSql)
      await testConstraints(testConnection)
      await assertIndexes(testConnection, databaseName)
    }
  })
}

const isMainModule = Boolean(
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
if (isMainModule) {
  await runVirtualPaymentMysqlIntegration()
  console.log('virtual payment isolated MySQL integration tests passed with no database residue')
}
