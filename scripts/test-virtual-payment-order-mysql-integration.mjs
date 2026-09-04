import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import mysql from 'mysql2/promise'

import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'
import { runWithGuaranteedCleanup } from './test-virtual-payment-mysql-integration.mjs'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3308
const EXPECTED_VERSION = '8.0.46'
const EXPECTED_CONFIRMATION = 'local-docker-virtual-payment-only'
const SAFE_DATABASE_PATTERN = /^virtual_payment_order_test_[a-f0-9]{12}$/
const migrationUrl = new URL('../database/migrations/009_create_virtual_payment_foundation.sql', import.meta.url)

function readConfig(env = process.env) {
  const config = {
    host: String(env.VIRTUAL_PAYMENT_TEST_DB_HOST || '').trim(),
    port: Number(String(env.VIRTUAL_PAYMENT_TEST_DB_PORT || '').trim()),
    rawPort: String(env.VIRTUAL_PAYMENT_TEST_DB_PORT || '').trim(),
    user: String(env.VIRTUAL_PAYMENT_TEST_DB_USER || '').trim(),
    password: String(env.VIRTUAL_PAYMENT_TEST_DB_PASSWORD || ''),
    confirmation: String(env.VIRTUAL_PAYMENT_TEST_ALLOW_DESTRUCTIVE || '').trim()
  }
  assert.equal(config.host, EXPECTED_HOST, `integration test host must be exactly ${EXPECTED_HOST}`)
  assert.equal(config.rawPort, String(EXPECTED_PORT), `integration test port must be exactly ${EXPECTED_PORT}`)
  assert(config.user, 'VIRTUAL_PAYMENT_TEST_DB_USER is required')
  assert(config.password, 'VIRTUAL_PAYMENT_TEST_DB_PASSWORD is required')
  assert.equal(config.confirmation, EXPECTED_CONFIRMATION, 'destructive confirmation does not match')
  return config
}

function quoteDatabase(databaseName) {
  assert.match(databaseName, SAFE_DATABASE_PATTERN, 'unsafe isolated test database name')
  return `\`${databaseName}\``
}

async function assertDatabaseAbsent(rootConnection, databaseName) {
  const [rows] = await rootConnection.execute(
    'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
    [databaseName]
  )
  assert.equal(rows.length, 0, 'isolated order-store test database was not removed')
}

function input(userId, clientRequestId) {
  return {
    userId,
    clientRequestId,
    internalSku: 'membership_30d',
    productId: 'sandbox-product',
    productName: '30天学习会员',
    quantity: 1,
    unitPriceFen: 3000,
    orderAmountFen: 3000,
    currency: 'CNY',
    environment: 'sandbox',
    wechatEnv: 1,
    paymentChannel: 'wechat_virtual_payment',
    clientPlatform: 'android'
  }
}

function fixedOrderNo(character) {
  return `VP${character.repeat(30)}`
}

async function testOrderStore(pool) {
  const firstStore = createVirtualPaymentStore({ pool, orderNoFactory: () => fixedOrderNo('A') })
  const first = await firstStore.createOrder(input('101', 'mysql-request-first'))
  assert.equal(first.idempotent, false)
  assert.equal(first.order.productName, '30天学习会员')
  assert.equal(first.order.paymentStatus, 'initializing')

  const concurrentInput = input('102', 'mysql-request-concurrent')
  const stores = [
    createVirtualPaymentStore({ pool, orderNoFactory: () => fixedOrderNo('B') }),
    createVirtualPaymentStore({ pool, orderNoFactory: () => fixedOrderNo('C') })
  ]
  const concurrent = await Promise.all(stores.map((store) => store.createOrder(concurrentInput)))
  assert.equal(new Set(concurrent.map((result) => result.order.orderNo)).size, 1)
  const [[concurrentCount]] = await pool.execute(
    'SELECT COUNT(*) AS row_count FROM virtual_payment_orders WHERE user_id = ? AND client_request_id = ?',
    ['102', 'mysql-request-concurrent']
  )
  assert.equal(Number(concurrentCount.row_count), 1, 'concurrent idempotent creation must persist one order')

  const otherUserStore = createVirtualPaymentStore({ pool, orderNoFactory: () => fixedOrderNo('D') })
  const otherUser = await otherUserStore.createOrder(input('103', 'mysql-request-concurrent'))
  assert.notEqual(otherUser.order.orderNo, concurrent[0].order.orderNo)

  assert.equal(await firstStore.findByUserAndOrderNo('999', first.order.orderNo), null)
  assert.equal((await firstStore.findByUserAndOrderNo('101', first.order.orderNo)).orderNo, first.order.orderNo)

  const pending = await firstStore.markOrderPending('101', first.order.orderNo)
  assert.equal(pending.paymentStatus, 'pending')
  assert.equal((await firstStore.markOrderPending('101', first.order.orderNo)).paymentStatus, 'pending')

  const [[beforeConflict]] = await pool.execute('SELECT COUNT(*) AS row_count FROM virtual_payment_orders')
  const collisionStore = createVirtualPaymentStore({ pool, orderNoFactory: () => first.order.orderNo })
  await assert.rejects(
    () => collisionStore.createOrder(input('104', 'mysql-request-collision')),
    (error) => error.code === 'PAYMENT_ORDER_CREATE_FAILED'
  )
  const [[afterConflict]] = await pool.execute('SELECT COUNT(*) AS row_count FROM virtual_payment_orders')
  assert.equal(afterConflict.row_count, beforeConflict.row_count, 'failed insert attempts must leave no partial order')

  await pool.execute(
    "UPDATE virtual_payment_orders SET payment_status = 'paid' WHERE user_id = ? AND order_no = ?",
    ['103', otherUser.order.orderNo]
  )
  await assert.rejects(
    () => otherUserStore.markOrderPending('103', otherUser.order.orderNo),
    (error) => error.code === 'PAYMENT_ORDER_NOT_PAYABLE'
  )
  assert.equal(
    (await otherUserStore.findByUserAndOrderNo('103', otherUser.order.orderNo)).paymentStatus,
    'paid',
    'conditional pending update must not overwrite a terminal state'
  )
}

export async function runVirtualPaymentOrderMysqlIntegration(env = process.env) {
  const config = readConfig(env)
  const databaseName = `virtual_payment_order_test_${crypto.randomBytes(6).toString('hex')}`
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
  } catch {
    throw new Error('isolated MySQL root connection failed')
  }

  let databaseOwned = false
  let migrationConnection = null
  let pool = null
  const cleanupSteps = [
    { phase: 'close_order_store_pool', run: async () => { if (pool) await pool.end() } },
    { phase: 'close_migration_connection', run: async () => { if (migrationConnection) await migrationConnection.end() } },
    {
      phase: 'drop_order_store_database',
      run: async () => {
        if (!databaseOwned) return
        assert.equal(config.host, EXPECTED_HOST)
        assert.equal(config.port, EXPECTED_PORT)
        assert.equal(config.confirmation, EXPECTED_CONFIRMATION)
        await rootConnection.query(`DROP DATABASE IF EXISTS ${quoteDatabase(databaseName)}`)
      }
    },
    { phase: 'verify_order_store_database_absent', run: async () => assertDatabaseAbsent(rootConnection, databaseName) },
    { phase: 'close_order_store_root_connection', run: async () => rootConnection.end() }
  ]

  await runWithGuaranteedCleanup({
    secretValues: [config.password],
    cleanupSteps,
    runMain: async () => {
      const [[versionRow]] = await rootConnection.query('SELECT VERSION() AS mysql_version')
      assert.equal(versionRow.mysql_version, EXPECTED_VERSION, `MySQL version must be exactly ${EXPECTED_VERSION}`)
      await assertDatabaseAbsent(rootConnection, databaseName)
      databaseOwned = true
      await rootConnection.query(
        `CREATE DATABASE ${quoteDatabase(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      )
      migrationConnection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: databaseName,
        charset: 'utf8mb4',
        timezone: 'Z',
        multipleStatements: true
      })
      await migrationConnection.query(migrationSql)
      pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: databaseName,
        charset: 'utf8mb4',
        timezone: 'Z',
        connectionLimit: 4
      })
      await testOrderStore(pool)
      await testRecoveryStore(pool)
    }
  })
}

const isMainModule = Boolean(
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
async function testRecoveryStore(pool) {
  const store = createVirtualPaymentStore({ pool })
  const created = []
  for (let i = 0; i < 45; i++) created.push((await store.createOrder(input('501', `recovery-intent-${i}`))).order.orderNo)
  for (let i = 0; i < 120; i++) await store.createOrder(input('502', `other-intent-${i}`))
  const combinations = [
    ['initializing', 'not_ready', 'not_ready'], ['pending', 'not_ready', 'not_ready'], ['confirming', 'not_ready', 'not_ready'],
    ...['not_ready', 'pending', 'granting', 'retryable_failed', 'failed'].map((status) => ['paid', status, 'not_ready']),
    ...['not_ready', 'pending', 'confirming', 'retryable_failed', 'manual_review'].map((status) => ['paid', 'granted', status])
  ]
  for (let i = 0; i < created.length; i++) await pool.execute('UPDATE virtual_payment_orders SET payment_status = ?, entitlement_status = ?, delivery_status = ? WHERE order_no = ?', [...combinations[i % combinations.length], created[i]])
  await pool.execute("UPDATE virtual_payment_orders SET payment_status='closed', entitlement_status='not_ready', delivery_status='not_ready' WHERE order_no=?", [created[0]])
  await pool.execute("UPDATE virtual_payment_orders SET payment_status='failed', entitlement_status='not_ready', delivery_status='not_ready' WHERE order_no=?", [created[1]])
  await pool.execute("UPDATE virtual_payment_orders SET payment_status='paid', entitlement_status='granted', delivery_status='delivered' WHERE order_no=?", [created[2]])
  await pool.execute("UPDATE virtual_payment_orders SET environment='production', wechat_env=0 WHERE order_no=?", [created[3]])
  await pool.execute("UPDATE virtual_payment_orders SET wechat_env=0 WHERE order_no=?", [created[4]])
  await pool.execute("UPDATE virtual_payment_orders SET created_at='2026-09-04 00:00:00', updated_at='2026-09-04 00:00:00'")
  const [expected] = await pool.execute("SELECT order_no FROM virtual_payment_orders WHERE user_id=501 AND environment='sandbox' AND wechat_env=1 AND payment_status NOT IN ('closed','failed') AND delivery_status <> 'delivered' ORDER BY created_at DESC,id DESC")
  const first = await store.listRecoveryOrders('501')
  assert.equal(first.orders.length, 20); assert.equal(first.nextCursor, first.orders[19].orderNo)
  await pool.execute("UPDATE virtual_payment_orders SET payment_status='paid', entitlement_status='granted', delivery_status='delivered' WHERE order_no=?", [first.nextCursor])
  const second = await store.listRecoveryOrders('501', first.nextCursor)
  assert.equal(second.orders.length, 20); assert.equal(second.nextCursor, null)
  assert.deepEqual([...first.orders, ...second.orders].map((r) => r.orderNo), expected.map((r) => r.order_no))
  assert.equal(new Set([...first.orders, ...second.orders].map((r) => r.orderNo)).size, 40)
  assert(first.orders.concat(second.orders).some((r) => r.entitlementStatus === 'failed'))
  assert(first.orders.concat(second.orders).some((r) => r.deliveryStatus === 'manual_review'))
  for (const cursor of [created[3], created[4], `VP${'0'.repeat(30)}`]) await assert.rejects(store.listRecoveryOrders('501', cursor), { code: 'PAYMENT_REQUEST_INVALID' })
  await assert.rejects(store.listRecoveryOrders('502', created[5]), { code: 'PAYMENT_REQUEST_INVALID' })
  assert.deepEqual(await store.listRecoveryOrders('503'), { orders: [], nextCursor: null })
  const [[before]] = await pool.query('SELECT COUNT(*) AS count, SUM(version) AS versions, MAX(updated_at) AS latest FROM virtual_payment_orders')
  await store.listRecoveryOrders('501')
  const [[after]] = await pool.query('SELECT COUNT(*) AS count, SUM(version) AS versions, MAX(updated_at) AS latest FROM virtual_payment_orders')
  assert.deepEqual(after, before)
  const [plan] = await pool.execute("EXPLAIN SELECT id,user_id,environment,wechat_env,order_no,client_request_id,payment_status,entitlement_status,delivery_status,created_at,updated_at FROM virtual_payment_orders WHERE user_id=? AND environment=? AND wechat_env=? AND payment_status NOT IN ('closed','failed') AND delivery_status <> 'delivered' ORDER BY created_at DESC,id DESC LIMIT 21", ['501', 'sandbox', 1])
  console.log('Recovery EXPLAIN:', JSON.stringify(plan.map(({ type, key, rows, Extra }) => ({ type, key, rows, Extra }))))
  assert(['idx_virtual_payment_orders_user_created', 'uk_virtual_payment_orders_user_request'].includes(plan[0].key))
  console.log('Recovery MySQL 8.0.46: 40 rows, two stable pages, terminal cursor, ownership/environment/status isolation, no missing/duplicate orders, no writes passed.')
}
if (isMainModule) {
  await runVirtualPaymentOrderMysqlIntegration()
  console.log('Virtual payment order Store isolated MySQL tests passed with no database residue.')
}
