import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'

import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'
import { checkVirtualPaymentDeliverySchema } from './check-virtual-payment-delivery-schema.mjs'
import { applyDeliveryMigration, assertDeliverySchema, readDeliverySchemaContract } from '../server/virtual-payment-delivery-schema.mjs'
import { normalizeVerifiedWechatDeliveryQueryFact } from '../server/virtual-payment-delivery.mjs'
import { normalizeVerifiedWechatQueryFact } from '../server/virtual-payment-reconciliation.mjs'
import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'
import { runWithGuaranteedCleanup } from './test-virtual-payment-mysql-integration.mjs'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3308
const EXPECTED_VERSION = '8.0.46'
const EXPECTED_CONFIRMATION = 'local-docker-virtual-payment-only'
const SAFE_DATABASE_PATTERN = /^virtual_payment_delivery_test_[a-f0-9]{12}$/
const PRODUCT_ID = 'sandbox-product'
const T0 = new Date('2026-09-02T00:00:00.000Z')
const migrations = [
  '001_create_user_phone_bindings.sql',
  '004_create_user_entitlements.sql',
  '005_create_entitlement_transactions.sql',
  '006_create_membership_grants.sql',
  '009_create_virtual_payment_foundation.sql',
  '010_create_virtual_payment_delivery_attempts.sql'
].map((name) => new URL(`../database/migrations/${name}`, import.meta.url))

function configFrom(env) {
  const config = {
    host: String(env.VIRTUAL_PAYMENT_TEST_DB_HOST || '').trim(),
    port: Number(String(env.VIRTUAL_PAYMENT_TEST_DB_PORT || '').trim()),
    rawPort: String(env.VIRTUAL_PAYMENT_TEST_DB_PORT || '').trim(),
    user: String(env.VIRTUAL_PAYMENT_TEST_DB_USER || '').trim(),
    password: String(env.VIRTUAL_PAYMENT_TEST_DB_PASSWORD || ''),
    confirmation: String(env.VIRTUAL_PAYMENT_TEST_ALLOW_DESTRUCTIVE || '').trim()
  }
  assert.equal(config.host, EXPECTED_HOST)
  assert.equal(config.rawPort, String(EXPECTED_PORT))
  assert(config.user && config.password)
  assert.equal(config.confirmation, EXPECTED_CONFIRMATION)
  return config
}

function quoteDatabase(name) {
  assert.match(name, SAFE_DATABASE_PATTERN)
  return `\`${name}\``
}

async function assertDatabaseAbsent(connection, name) {
  const [rows] = await connection.execute(
    'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [name]
  )
  assert.equal(rows.length, 0)
}

function orderInput(userId, requestId) {
  return {
    userId, clientRequestId: requestId, internalSku: 'membership_30d', productId: PRODUCT_ID,
    productName: '30天学习会员', quantity: 1, unitPriceFen: 3000, orderAmountFen: 3000,
    currency: 'CNY', environment: 'sandbox', wechatEnv: 1,
    paymentChannel: 'wechat_virtual_payment', clientPlatform: 'android'
  }
}

async function createGrantedOrder(store, userId, requestId, suffix, now = T0) {
  const created = await store.createOrder(orderInput(userId, requestId))
  const pending = await store.markOrderPending(userId, created.order.orderNo)
  const rawQuery = {
    orderId: pending.orderNo,
    wechatOrderId: `WX${suffix}`,
    wechatPaymentOrderId: `WXPAY${suffix}`,
    status: 2, orderType: 0, orderFeeFen: 3000, paidFeeFen: 3000,
    paidAtSeconds: Math.floor(now.getTime() / 1000) - 3600,
    providedAtSeconds: 0, environmentType: 2, environment: 'sandbox'
  }
  const fact = normalizeVerifiedWechatQueryFact(rawQuery, pending, { now: () => now.getTime() })
  const paid = await store.reconcileVerifiedWechatQuery(userId, pending.orderNo, fact, { expectedProductId: PRODUCT_ID })
  const granted = await store.grantTrustedPaidOrderEntitlement(userId, pending.orderNo, {
    expectedProductId: PRODUCT_ID, now
  })
  assert.equal(paid.order.paymentStatus, 'paid')
  assert.equal(granted.order.entitlementStatus, 'granted')
  return { order: granted.order, rawQuery }
}

function clock(offsetMs = 0) {
  return new Date(T0.getTime() + offsetMs)
}

function deliveryFact(rawQuery, order, status, providedAtSeconds, now, query) {
  return normalizeVerifiedWechatDeliveryQueryFact({
    ...rawQuery,
    status,
    providedAtSeconds
  }, order, {
    now: now.getTime(), observationId: crypto.randomBytes(32).toString('hex'),
    queryOperationId: query.operationId, querySequence: query.querySequence,
    claimedOrderVersion: query.claimedOrderVersion
  })
}

function dispatchContext(now) {
  return { expectedProductId: PRODUCT_ID, now }
}

function proxyPool(pool, hooks = {}) {
  return {
    async getConnection() {
      const connection = await pool.getConnection()
      return {
        execute(sql, values) {
          return hooks.execute ? hooks.execute(connection, sql, values) : connection.execute(sql, values)
        },
        beginTransaction() {
          return hooks.beginTransaction ? hooks.beginTransaction(connection) : connection.beginTransaction()
        },
        commit() {
          return hooks.commit ? hooks.commit(connection) : connection.commit()
        },
        rollback() {
          return hooks.rollback ? hooks.rollback(connection) : connection.rollback()
        },
        release() {
          return hooks.release ? hooks.release(connection) : connection.release()
        }
      }
    }
  }
}

async function membershipSnapshot(pool, userId) {
  const [[entitlement]] = await pool.execute(
    `SELECT quota_balance, quota_total_granted, quota_total_consumed, quota_total_expired,
            membership_type, membership_status, membership_started_at, membership_expire_at,
            last_transaction_id
       FROM user_entitlements WHERE user_id = ?`, [userId]
  )
  const [[counts]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = ?) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = ? AND transaction_type = 'MEMBERSHIP_GRANT') AS membership_transactions`,
    [userId, userId]
  )
  return JSON.stringify({ entitlement, grants: Number(counts.grants), transactions: Number(counts.membership_transactions) })
}

async function runScenarios(pool, singleConnectionPool) {
  const entitlementStore = createUserEntitlementStore({ pool, now: () => new Date(T0) })
  const store = createVirtualPaymentStore({
    pool, userEntitlementStore: entitlementStore,
    orderNoFactory: () => `VP${crypto.randomBytes(15).toString('hex').toUpperCase()}`
  })
  async function createUncertainDelivery(userId, requestId, suffix) {
    const fixture = await createGrantedOrder(store, userId, requestId, suffix)
    const claim = await store.claimDeliveryWork(userId, fixture.order.orderNo, {
      expectedProductId: PRODUCT_ID, now: clock()
    })
    await store.markDeliveryDispatching(
      userId, fixture.order.orderNo, claim.attempt.operationId, dispatchContext(clock(1_000))
    )
    await store.finishDeliveryNotify(userId, fixture.order.orderNo, claim.attempt.operationId, {
      kind: 'uncertain', errorCode: 'DELIVERY_NOTIFY_UNCERTAIN', now: clock(2_000)
    })
    return fixture
  }
  function serviceFor(userId, customStore, client) {
    return createVirtualPaymentService({
      env: {
        VIRTUAL_PAYMENT_ENABLED: 'true', VIRTUAL_PAYMENT_ENV: 'sandbox',
        VIRTUAL_PAYMENT_SANDBOX_USER_IDS: userId,
        WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox.offer-001',
        WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: PRODUCT_ID,
        WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'sandbox-key'
      },
      now: () => clock(300_000), store: customStore,
      identityStore: { async findWechatOpenidByUserIdForPayment() { return `openid-${userId}` } },
      virtualPaymentClient: client,
      paymentSessionService: { async exchangeAndVerifyPaymentSession() { throw new Error('not used') } },
      signingService: { createPaymentParameters() { throw new Error('not used') } }
    })
  }

  const successful = await createGrantedOrder(store, '701', 'delivery-request-701', '701')
  const correctQueryExpression = "CASE WHEN query_status = 'claimed' THEN order_id ELSE NULL END"
  let wrongSchemaNotifyCalls = 0
  try {
    await pool.query(`ALTER TABLE virtual_payment_delivery_queries MODIFY COLUMN active_order_id BIGINT UNSIGNED GENERATED ALWAYS AS (${correctQueryExpression.replace("'claimed'", "'claim ed'")}) STORED`)
    await assert.rejects(assertDeliverySchema(pool), (error) => error.code === 'PAYMENT_DELIVERY_SCHEMA_MISMATCH')
    await assert.rejects(store.claimDeliveryWork('701', successful.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() }), (error) => error.code === 'PAYMENT_DELIVERY_SCHEMA_MISMATCH')
    const wrongSchemaService = serviceFor('701', store, { async notifyProvideGoods() { wrongSchemaNotifyCalls++ } })
    await assert.rejects(wrongSchemaService.deliverOwnedOrder({ authenticatedUserId: '701', orderNo: successful.order.orderNo }), (error) => error.code === 'PAYMENT_SERVICE_UNAVAILABLE')
    assert.equal(wrongSchemaNotifyCalls, 0)
  } finally {
    await pool.query(`ALTER TABLE virtual_payment_delivery_queries MODIFY COLUMN active_order_id BIGINT UNSIGNED GENERATED ALWAYS AS (${correctQueryExpression}) STORED`)
  }
  await assertDeliverySchema(pool)
  console.log('MySQL altered claim ed expression rejected by formal checker and delivery Store; notify=0.')
  const beforeSuccessfulMembership = await membershipSnapshot(pool, '701')
  const claimed = await store.claimDeliveryWork('701', successful.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() })
  assert.equal(claimed.action, 'notify')
  await store.markDeliveryDispatching('701', successful.order.orderNo, claimed.attempt.operationId, dispatchContext(clock(1_000)))
  const completed = await store.finishDeliveryNotify('701', successful.order.orderNo, claimed.attempt.operationId, {
    kind: 'success', now: clock(2_000)
  })
  assert.equal(completed.deliveryStatus, 'delivered')
  const replay = await store.claimDeliveryWork('701', successful.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(3_000) })
  assert.equal(replay.action, 'delivered')
  assert.equal(await membershipSnapshot(pool, '701'), beforeSuccessfulMembership)

  const concurrent = await createGrantedOrder(store, '702', 'delivery-request-702', '702')
  const concurrentResults = await Promise.all([
    store.claimDeliveryWork('702', concurrent.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() }),
    store.claimDeliveryWork('702', concurrent.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() })
  ])
  assert.equal(concurrentResults.filter((result) => result.action === 'notify').length, 1)
  assert.equal(concurrentResults.filter((result) => result.action === 'wait').length, 1)
  const [[concurrentAttemptCount]] = await pool.execute(
    'SELECT COUNT(*) AS count FROM virtual_payment_delivery_attempts WHERE order_id = ?', [concurrent.order.id]
  )
  assert.equal(Number(concurrentAttemptCount.count), 1)

  const uncertain = await createGrantedOrder(store, '703', 'delivery-request-703', '703')
  const uncertainBefore = await membershipSnapshot(pool, '703')
  const uncertainClaim = await store.claimDeliveryWork('703', uncertain.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() })
  await store.markDeliveryDispatching('703', uncertain.order.orderNo, uncertainClaim.attempt.operationId, dispatchContext(clock(1_000)))
  const uncertainResult = await store.finishDeliveryNotify('703', uncertain.order.orderNo, uncertainClaim.attempt.operationId, {
    kind: 'uncertain', errorCode: 'DELIVERY_NOTIFY_UNCERTAIN', now: clock(2_000)
  })
  assert.equal(uncertainResult.deliveryStatus, 'confirming')
  await assert.rejects(
    store.finishDeliveryNotify('703', uncertain.order.orderNo, uncertainClaim.attempt.operationId, {
      kind: 'success', now: clock(3_000)
    }),
    (error) => error.code === 'PAYMENT_DELIVERY_STALE_RESULT'
  )
  const queryWork = await store.claimDeliveryWork('703', uncertain.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(70_000)
  })
  assert.equal(queryWork.action, 'query')
  const providedAtSeconds = Math.floor(clock(60_000).getTime() / 1000)
  const recovered = await store.applyDeliveryQueryFact(
    '703', uncertain.order.orderNo,
    deliveryFact(uncertain.rawQuery, queryWork.order, 4, providedAtSeconds, clock(70_000), queryWork.query),
    { expectedProductId: PRODUCT_ID, now: clock(70_000) }
  )
  assert.equal(recovered.deliveryStatus, 'delivered')
  assert.equal(await membershipSnapshot(pool, '703'), uncertainBefore)

  const noRetry = await createGrantedOrder(store, '704', 'delivery-request-704', '704')
  const noRetryClaim = await store.claimDeliveryWork('704', noRetry.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() })
  await store.markDeliveryDispatching('704', noRetry.order.orderNo, noRetryClaim.attempt.operationId, dispatchContext(clock(1_000)))
  await assert.rejects(store.finishDeliveryNotify('704', noRetry.order.orderNo, noRetryClaim.attempt.operationId, {
    kind: 'explicit_failure', errorCode: 'DELIVERY_NOTIFY_EXPLICIT_FAILURE', now: clock(2_000)
  }), (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT')
  await store.finishDeliveryNotify('704', noRetry.order.orderNo, noRetryClaim.attempt.operationId, {
    kind: 'uncertain', errorCode: 'DELIVERY_NOTIFY_UNCERTAIN', now: clock(2_000)
  })
  const noRetryQueryWork = await store.claimDeliveryWork('704', noRetry.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(70_000)
  })
  assert.equal(noRetryQueryWork.action, 'query')
  const stillConfirming = await store.applyDeliveryQueryFact(
    '704', noRetry.order.orderNo,
    deliveryFact(noRetry.rawQuery, noRetryQueryWork.order, 2, 0, clock(70_000), noRetryQueryWork.query),
    { expectedProductId: PRODUCT_ID, now: clock(70_000) }
  )
  assert.equal(stillConfirming.action, 'wait')
  const [noRetryAttempts] = await pool.execute(
    'SELECT attempt_no, attempt_status FROM virtual_payment_delivery_attempts WHERE order_id = ? ORDER BY attempt_no',
    [noRetry.order.id]
  )
  assert.deepEqual(noRetryAttempts.map((row) => [row.attempt_no, row.attempt_status]), [[1, 'confirming']])

  const manual = await createGrantedOrder(store, '705', 'delivery-request-705', '705')
  const manualClaim = await store.claimDeliveryWork('705', manual.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() })
  await store.markDeliveryDispatching('705', manual.order.orderNo, manualClaim.attempt.operationId, dispatchContext(clock(1_000)))
  await store.finishDeliveryNotify('705', manual.order.orderNo, manualClaim.attempt.operationId, {
    kind: 'uncertain', errorCode: 'DELIVERY_NOTIFY_UNCERTAIN', now: clock(2_000)
  })
  for (let index = 0; index < 3; index += 1) {
    const at = clock(70_000 + index * 70_000)
    const currentWork = await store.claimDeliveryWork('705', manual.order.orderNo, {
      expectedProductId: PRODUCT_ID, now: at
    })
    assert.equal(currentWork.action, 'query')
    const outcome = await store.applyDeliveryQueryFact(
      '705', manual.order.orderNo,
      deliveryFact(manual.rawQuery, currentWork.order, 2, 0, at, currentWork.query),
      { expectedProductId: PRODUCT_ID, now: at }
    )
    if (index < 2) assert.equal(outcome.deliveryStatus, 'confirming')
    else assert.equal(outcome.deliveryStatus, 'manual_review')
  }

  const serialized = await createUncertainDelivery('716', 'delivery-request-716', '716')
  const serializedClaims = await Promise.all([
    store.claimDeliveryWork('716', serialized.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(70_000) }),
    store.claimDeliveryWork('716', serialized.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(70_000) })
  ])
  assert.equal(serializedClaims.filter((result) => result.action === 'query').length, 1)
  assert.equal(serializedClaims.filter((result) => result.action === 'wait').length, 1)
  const serializedQuery = serializedClaims.find((result) => result.action === 'query')
  await store.applyDeliveryQueryFact(
    '716', serialized.order.orderNo,
    deliveryFact(serialized.rawQuery, serializedQuery.order, 2, 0, clock(70_000), serializedQuery.query),
    { expectedProductId: PRODUCT_ID, now: clock(70_000) }
  )
  const [[serializedCounts]] = await pool.execute(
    `SELECT a.query_count, COUNT(q.id) AS applied_count
       FROM virtual_payment_delivery_attempts a
       LEFT JOIN virtual_payment_delivery_queries q
         ON q.attempt_id = a.id AND q.query_status = 'applied'
      WHERE a.order_id = ? GROUP BY a.id, a.query_count`,
    [serialized.order.id]
  )
  assert.equal(Number(serializedCounts.query_count), 1)
  assert.equal(Number(serializedCounts.applied_count), 1)

  const takeover = await createUncertainDelivery('717', 'delivery-request-717', '717')
  const oldQuery = await store.claimDeliveryWork('717', takeover.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(70_000)
  })
  const newQuery = await store.claimDeliveryWork('717', takeover.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(101_000)
  })
  assert.equal(newQuery.action, 'query')
  assert(newQuery.query.querySequence > oldQuery.query.querySequence)
  const staleStatus2 = await store.applyDeliveryQueryFact(
    '717', takeover.order.orderNo,
    deliveryFact(takeover.rawQuery, oldQuery.order, 2, 0, clock(70_000), oldQuery.query),
    { expectedProductId: PRODUCT_ID, now: clock(101_000) }
  )
  assert.equal(staleStatus2.action, 'stale')
  const takeoverDelivered = await store.applyDeliveryQueryFact(
    '717', takeover.order.orderNo,
    deliveryFact(takeover.rawQuery, newQuery.order, 4, Math.floor(clock(90_000).getTime() / 1000), clock(101_000), newQuery.query),
    { expectedProductId: PRODUCT_ID, now: clock(101_000) }
  )
  assert.equal(takeoverDelivered.deliveryStatus, 'delivered')

  const staleAfterManual = await createUncertainDelivery('718', 'delivery-request-718', '718')
  const oldDeliveredQuery = await store.claimDeliveryWork('718', staleAfterManual.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(70_000)
  })
  const manualQuery = await store.claimDeliveryWork('718', staleAfterManual.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(101_000)
  })
  const manualOutcome = await store.applyDeliveryQueryFact(
    '718', staleAfterManual.order.orderNo,
    deliveryFact(staleAfterManual.rawQuery, manualQuery.order, 6, 0, clock(101_000), manualQuery.query),
    { expectedProductId: PRODUCT_ID, now: clock(101_000) }
  )
  assert.equal(manualOutcome.deliveryStatus, 'manual_review')
  const staleStatus4 = await store.applyDeliveryQueryFact(
    '718', staleAfterManual.order.orderNo,
    deliveryFact(staleAfterManual.rawQuery, oldDeliveredQuery.order, 4, Math.floor(clock(90_000).getTime() / 1000), clock(70_000), oldDeliveredQuery.query),
    { expectedProductId: PRODUCT_ID, now: clock(102_000) }
  )
  assert.equal(staleStatus4.action, 'stale')

  async function deliverySnapshot(orderId) {
    const result = {}
    for (const table of ['virtual_payment_orders', 'virtual_payment_delivery_attempts', 'virtual_payment_delivery_queries', 'virtual_payment_events']) {
      const [rows] = await pool.execute(`SELECT * FROM ${table} WHERE ${table === 'virtual_payment_orders' ? 'id' : 'order_id'} = ? ORDER BY id`, [orderId])
      result[table] = rows
    }
    return JSON.stringify(result)
  }
  const expiring = await createUncertainDelivery('760', 'delivery-request-760', '760')
  const expiringQuery = await store.claimDeliveryWork('760', expiring.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(890_000) })
  assert.equal(expiringQuery.action, 'query')
  for (const fault of ['affectedRows', 'commit', 'rollback']) {
    const before = await deliverySnapshot(expiring.order.id)
    const faultStore = createVirtualPaymentStore({ pool: proxyPool(pool, {
      async execute(connection, sql, values) {
        const result = await connection.execute(sql, values)
        if (sql.includes("SET query_status = 'stale'") && fault !== 'commit') return [{ affectedRows: 0 }]
        return result
      },
      async commit(connection) { if (fault === 'commit') throw new Error('injected commit'); await connection.commit() },
      async rollback(connection) { await connection.rollback(); if (fault === 'rollback') throw new Error('injected rollback') }
    }), userEntitlementStore: entitlementStore })
    await assert.rejects(faultStore.claimDeliveryWork('760', expiring.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(901_000) }))
    assert.equal(await deliverySnapshot(expiring.order.id), before, fault)
  }
  const [[beforeTerminal]] = await pool.execute('SELECT version FROM virtual_payment_orders WHERE id = ?', [expiring.order.id])
  const terminals = await Promise.all(Array.from({ length: 3 }, () => store.claimDeliveryWork('760', expiring.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(901_000) })))
  assert(terminals.every((result) => result.action === 'manual_review'))
  const [[afterTerminal]] = await pool.execute('SELECT version FROM virtual_payment_orders WHERE id = ?', [expiring.order.id])
  assert.equal(Number(afterTerminal.version), Number(beforeTerminal.version) + 1)
  const [[closed]] = await pool.execute('SELECT query_status, completed_at, lease_expires_at FROM virtual_payment_delivery_queries WHERE operation_id = ?', [expiringQuery.query.operationId])
  assert.equal(closed.query_status, 'stale')
  assert(closed.completed_at)
  assert.equal(closed.lease_expires_at, null)
  const terminalSnapshot = await deliverySnapshot(expiring.order.id)
  for (const status of [2, 4]) {
    const result = await store.applyDeliveryQueryFact('760', expiring.order.orderNo,
      deliveryFact(expiring.rawQuery, expiringQuery.order, status, status === 4 ? Math.floor(clock(880_000).getTime() / 1000) : 0, clock(890_000), expiringQuery.query),
      { expectedProductId: PRODUCT_ID, now: clock(902_000) })
    assert.equal(result.action, 'stale')
    assert.equal(await deliverySnapshot(expiring.order.id), terminalSnapshot)
  }
  const [[activeTerminal]] = await pool.execute(`SELECT COUNT(*) AS n FROM virtual_payment_delivery_queries q JOIN virtual_payment_orders o ON o.id = q.order_id WHERE o.delivery_status IN ('manual_review', 'delivered') AND q.query_status = 'claimed'`)
  assert.equal(Number(activeTerminal.n), 0)

  // Each persisted canonical field is independently mutated, rejected, then restored.
  const canonicalMutations = {
    user_id: '999', request_env: 0, response_env_type: 1, observed_environment: 'production',
    observed_currency: 'USD', observed_order_no: 'VPWRONG1234567890',
    observed_provider_order_id: 'WXWRONG', observed_provider_transaction_id: 'WXPAYWRONG',
    wechat_status: 2, order_type: 1, order_amount_fen: 3001, paid_amount_fen: 2999,
    paid_at_seconds: 1, provided_at_seconds: 1, queried_at_seconds: 1,
    operation_id: 'a'.repeat(64), observation_id: 'b'.repeat(64), query_sequence: 2,
    claimed_order_version: 999, order_id: noRetry.order.id, attempt_id: claimed.attempt.id
  }
  const [[savedQuery]] = await pool.execute('SELECT * FROM virtual_payment_delivery_queries WHERE operation_id = ?', [queryWork.query.operationId])
  for (const [column, value] of Object.entries(canonicalMutations)) {
    await pool.execute(`UPDATE virtual_payment_delivery_queries SET ${column} = ? WHERE id = ?`, [value, savedQuery.id])
    try {
      await assert.rejects(store.claimDeliveryWork('703', uncertain.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(100_000) }), undefined, column)
    } finally {
      await pool.execute(`UPDATE virtual_payment_delivery_queries SET ${column} = ?, updated_at = ? WHERE id = ?`, [savedQuery[column], savedQuery.updated_at, savedQuery.id])
    }
  }
  for (const [orderId, userId, orderNo] of [[successful.order.id, '701', successful.order.orderNo], [uncertain.order.id, '703', uncertain.order.orderNo], [noRetry.order.id, '704', noRetry.order.orderNo]]) {
    const [[savedAttempt]] = await pool.execute('SELECT * FROM virtual_payment_delivery_attempts WHERE order_id = ?', [orderId])
    const mutations = userId === '701'
      ? [{ completion_source: 'query_confirmation' }, { result_kind: 'uncertain' }, { finished_at: clock() }, { provider_event_id: savedQuery.provider_event_id }]
      : userId === '703'
      ? [{ completion_source: 'direct_notify' }, { result_kind: 'uncertain' }, { finished_at: clock() }, { provider_event_id: null }]
      : [{ attempt_status: 'succeeded', result_kind: 'success', completion_source: 'query_confirmation', finished_at: clock(70_000), last_error_code: null, next_action_at: null }]
    for (const mutation of mutations) {
      const columns = Object.keys(mutation)
      await pool.execute(`UPDATE virtual_payment_delivery_attempts SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...Object.values(mutation), savedAttempt.id])
      try { await assert.rejects(store.claimDeliveryWork(userId, orderNo, { expectedProductId: PRODUCT_ID, now: clock(100_000) })) }
      finally { await pool.execute(`UPDATE virtual_payment_delivery_attempts SET ${columns.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...columns.map((c) => savedAttempt[c]), savedAttempt.updated_at, savedAttempt.id]) }
    }
  }
  assert.equal((await store.claimDeliveryWork('703', uncertain.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock(100_000) })).action, 'delivered')
  console.log('MySQL terminal closure, stale 2/4, rollback/concurrency, 21 canonical field mutations and success-source attacks passed.')

  const tamperCases = [
    {
      userId: '720', requestId: 'delivery-request-720', suffix: '720',
      mutate: async (fixture) => pool.execute(
        `UPDATE virtual_payment_events SET payload_hash = ?
          WHERE order_id = ? AND event_type = 'wechat_query_status_2_paid'`,
        [crypto.randomBytes(32), fixture.order.id]
      )
    },
    {
      userId: '721', requestId: 'delivery-request-721', suffix: '721',
      mutate: async (fixture) => pool.execute(
        'UPDATE membership_grants SET days_granted = 29 WHERE id = ?', [fixture.order.membershipGrantId]
      )
    },
    {
      userId: '722', requestId: 'delivery-request-722', suffix: '722',
      mutate: async (fixture) => pool.execute(
        'UPDATE entitlement_transactions SET amount = 999 WHERE transaction_id = ?',
        [fixture.order.entitlementTransactionId]
      )
    },
    {
      userId: '723', requestId: 'delivery-request-723', suffix: '723',
      mutate: async (fixture) => pool.execute(
        'UPDATE user_entitlements SET membership_expire_at = DATE_ADD(membership_expire_at, INTERVAL 1 SECOND) WHERE user_id = ?',
        [fixture.order.userId]
      )
    },
    {
      userId: '724', requestId: 'delivery-request-724', suffix: '724',
      mutate: async (fixture) => pool.execute(
        'UPDATE virtual_payment_delivery_attempts SET user_id = 999 WHERE order_id = ?', [fixture.order.id]
      ),
      restore: async (fixture) => pool.execute(
        'UPDATE virtual_payment_delivery_attempts SET user_id = ? WHERE order_id = ?',
        [fixture.order.userId, fixture.order.id]
      )
    }
  ]
  for (const testCase of tamperCases) {
    const fixture = await createGrantedOrder(store, testCase.userId, testCase.requestId, testCase.suffix)
    let notifyCallsForTamper = 0
    const tamperingStore = {
      ...store,
      async claimDeliveryWork(...args) {
        const result = await store.claimDeliveryWork(...args)
        await testCase.mutate(fixture)
        return result
      }
    }
    const tamperService = serviceFor(testCase.userId, tamperingStore, {
      async notifyProvideGoods() { notifyCallsForTamper += 1 },
      async queryOrder() { throw new Error('must not query') }
    })
    await assert.rejects(tamperService.deliverOwnedOrder({
      authenticatedUserId: testCase.userId, orderNo: fixture.order.orderNo
    }))
    if (notifyCallsForTamper !== 0) throw new Error(`tamper-${testCase.userId}-reached-http`)
    if (testCase.restore) await testCase.restore(fixture)
  }

  const attemptTamperCases = [
    {
      userId: '730',
      mutate: (fixture) => pool.execute(
        'UPDATE virtual_payment_delivery_attempts SET attempt_no = 0 WHERE order_id = ?', [fixture.order.id]
      )
    },
    {
      userId: '731',
      mutate: (fixture) => pool.execute(
        `UPDATE virtual_payment_delivery_attempts
            SET attempt_status = 'explicit_failed', result_kind = 'success',
                lease_owner = NULL, lease_expires_at = NULL,
                request_started_at = ?, response_received_at = ?, last_error_code = 'INVALID_COMBINATION'
          WHERE order_id = ?`,
        [clock(1_000), clock(2_000), fixture.order.id]
      )
    },
    {
      userId: '732',
      mutate: (fixture) => pool.execute(
        `UPDATE virtual_payment_delivery_attempts
            SET attempt_status = 'succeeded', result_kind = 'success',
                lease_owner = NULL, lease_expires_at = NULL, request_started_at = ?,
                response_received_at = NULL, provider_event_id = NULL
          WHERE order_id = ?`, [clock(1_000), fixture.order.id]
      )
    },
    {
      userId: '733',
      mutate: (fixture) => pool.execute(
        `UPDATE virtual_payment_delivery_attempts
            SET attempt_status = 'dispatching', request_started_at = NULL
          WHERE order_id = ?`, [fixture.order.id]
      )
    },
    {
      userId: '734',
      mutate: (fixture) => pool.execute(
        'UPDATE virtual_payment_orders SET retry_count = 1 WHERE id = ?', [fixture.order.id]
      )
    }
  ]
  for (const [index, testCase] of attemptTamperCases.entries()) {
    const fixture = await createGrantedOrder(
      store, testCase.userId, `delivery-request-${testCase.userId}`, testCase.userId
    )
    const claim = await store.claimDeliveryWork(testCase.userId, fixture.order.orderNo, {
      expectedProductId: PRODUCT_ID, now: clock(index * 10)
    })
    await testCase.mutate(fixture, claim)
    await assert.rejects(store.markDeliveryDispatching(
      testCase.userId, fixture.order.orderNo, claim.attempt.operationId,
      dispatchContext(clock(2_000 + index * 10))
    ), (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT')
  }

  const crossEvent = await createUncertainDelivery('735', 'delivery-request-735', '735')
  const [[foreignEvent]] = await pool.execute(
    `SELECT id FROM virtual_payment_events
      WHERE order_id = ? AND event_type = 'wechat_query_status_2_paid' LIMIT 1`,
    [successful.order.id]
  )
  await pool.execute(
    'UPDATE virtual_payment_delivery_attempts SET provider_event_id = ? WHERE order_id = ?',
    [foreignEvent.id, crossEvent.order.id]
  )
  await assert.rejects(store.claimDeliveryWork('735', crossEvent.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(70_000)
  }), (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT')

  const queryVersion = await createUncertainDelivery('736', 'delivery-request-736', '736')
  const queryVersionClaim = await store.claimDeliveryWork('736', queryVersion.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(70_000)
  })
  await pool.execute(
    'UPDATE virtual_payment_delivery_queries SET claimed_order_version = claimed_order_version + 1 WHERE operation_id = ?',
    [queryVersionClaim.query.operationId]
  )
  await assert.rejects(store.claimDeliveryWork('736', queryVersion.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock(70_001)
  }), (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT')

  const crossOrderA = await createGrantedOrder(store, '739', 'delivery-request-739-a', '739A')
  const crossOrderB = await createGrantedOrder(store, '739', 'delivery-request-739-b', '739B')
  const crossOrderClaim = await store.claimDeliveryWork('739', crossOrderA.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock()
  })
  await pool.execute(
    'UPDATE virtual_payment_delivery_attempts SET order_id = ? WHERE operation_id = ?',
    [crossOrderB.order.id, crossOrderClaim.attempt.operationId]
  )
  await assert.rejects(store.markDeliveryDispatching(
    '739', crossOrderA.order.orderNo, crossOrderClaim.attempt.operationId, dispatchContext(clock(1_000))
  ), (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT')

  const duplicateAttempt = await createGrantedOrder(store, '741', 'delivery-request-741', '741')
  const duplicateClaim = await store.claimDeliveryWork('741', duplicateAttempt.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock()
  })
  await assert.rejects(pool.execute(
    `INSERT INTO virtual_payment_delivery_attempts (
       operation_id, order_id, user_id, attempt_no, claimed_order_version,
       attempt_status, result_kind, request_started_at, response_received_at, last_error_code, claimed_at
     ) VALUES (?, ?, ?, 1, ?, 'explicit_failed', 'explicit_failure', ?, ?, 'DUPLICATE_ATTEMPT', CURRENT_TIMESTAMP)`,
    [crypto.randomBytes(32).toString('hex'), duplicateAttempt.order.id,
      duplicateAttempt.order.userId, duplicateClaim.attempt.claimedOrderVersion,
      clock(1_000), clock(2_000)]
  ), (error) => error && error.code === 'ER_DUP_ENTRY')

  await assert.rejects(pool.execute(
    `INSERT INTO virtual_payment_delivery_attempts (
       operation_id, order_id, user_id, attempt_no, claimed_order_version,
       attempt_status, result_kind, lease_owner, lease_expires_at, claimed_at
     ) VALUES (?, ?, 999, 1, 0, 'claimed', 'not_started', ?, ?, CURRENT_TIMESTAMP)`,
    [crypto.randomBytes(32).toString('hex'), '999999999999999999',
      crypto.randomBytes(32).toString('hex'), clock(30_000)]
  ), (error) => error && error.code === 'ER_NO_REFERENCED_ROW_2')
  const fkFixture = await createGrantedOrder(store, '737', 'delivery-request-737', '737')
  await assert.rejects(pool.execute(
    `INSERT INTO virtual_payment_delivery_attempts (
       operation_id, order_id, user_id, attempt_no, claimed_order_version,
       attempt_status, result_kind, provider_event_id, claimed_at
     ) VALUES (?, ?, ?, 1, 0, 'succeeded', 'success', ?, CURRENT_TIMESTAMP)`,
    [crypto.randomBytes(32).toString('hex'), fkFixture.order.id, fkFixture.order.userId, '999999999999999999']
  ), (error) => error && error.code === 'ER_NO_REFERENCED_ROW_2')

  const dispatchCommit = await createGrantedOrder(store, '725', 'delivery-request-725', '725')
  let dispatchNotifyCalls = 0
  let commitCalls = 0
  const dispatchCommitStore = createVirtualPaymentStore({
    pool: proxyPool(pool, {
      async commit(connection) {
        commitCalls += 1
        if (commitCalls === 1) {
          await connection.rollback()
          throw new Error('dispatch commit sentinel')
        }
        return connection.commit()
      }
    }),
    userEntitlementStore: entitlementStore
  })
  const dispatchCommitService = serviceFor('725', {
    ...store,
    markDeliveryDispatching: dispatchCommitStore.markDeliveryDispatching
  }, {
    async notifyProvideGoods() { dispatchNotifyCalls += 1 },
    async queryOrder() { throw new Error('must not query') }
  })
  await assert.rejects(dispatchCommitService.deliverOwnedOrder({
    authenticatedUserId: '725', orderNo: dispatchCommit.order.orderNo
  }))
  assert.equal(dispatchNotifyCalls, 0)

  const singleEntitlementStore = createUserEntitlementStore({ pool: singleConnectionPool, now: () => new Date(T0) })
  const singleStore = createVirtualPaymentStore({
    pool: singleConnectionPool, userEntitlementStore: singleEntitlementStore,
    orderNoFactory: () => `VP${crypto.randomBytes(15).toString('hex').toUpperCase()}`
  })
  const singleOrder = await createGrantedOrder(singleStore, '726', 'delivery-request-726', '726')
  let httpObservedFreeConnection = false
  const singleService = serviceFor('726', singleStore, {
    async notifyProvideGoods() {
      const connection = await singleConnectionPool.getConnection()
      httpObservedFreeConnection = true
      connection.release()
      return { accepted: true }
    },
    async queryOrder() { throw new Error('must not query') }
  })
  const singleResult = await Promise.race([
    singleService.deliverOwnedOrder({ authenticatedUserId: '726', orderNo: singleOrder.order.orderNo }),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('single-connection dispatch deadlocked')), 2_000))
  ])
  assert.equal(singleResult.deliveryStatus, 'delivered')
  assert.equal(httpObservedFreeConnection, true)

  const highConcurrencyOrder = await createGrantedOrder(store, '738', 'delivery-request-738', '738')
  let highConcurrencyNotifyCalls = 0
  const highConcurrencyService = serviceFor('738', store, {
    async notifyProvideGoods() {
      highConcurrencyNotifyCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { accepted: true }
    },
    async queryOrder() { throw new Error('must not query') }
  })
  await Promise.all(Array.from({ length: 12 }, () => highConcurrencyService.deliverOwnedOrder({
    authenticatedUserId: '738', orderNo: highConcurrencyOrder.order.orderNo
  })))
  assert.equal(highConcurrencyNotifyCalls, 1)

  const rollback = await createGrantedOrder(store, '799', 'delivery-request-799', '799')
  await pool.query(`CREATE TRIGGER vp7_attempt_failure BEFORE INSERT ON virtual_payment_delivery_attempts
    FOR EACH ROW BEGIN IF NEW.user_id = 799 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vp7 attempt failure'; END IF; END`)
  await assert.rejects(store.claimDeliveryWork('799', rollback.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock()
  }))
  const rollbackOrder = await store.findByUserAndOrderNo('799', rollback.order.orderNo)
  assert.equal(rollbackOrder.deliveryStatus, 'not_ready')
  const [[rollbackAttempts]] = await pool.execute(
    'SELECT COUNT(*) AS count FROM virtual_payment_delivery_attempts WHERE order_id = ?', [rollback.order.id]
  )
  assert.equal(Number(rollbackAttempts.count), 0)
  await pool.query('DROP TRIGGER vp7_attempt_failure')

  const affected = await createGrantedOrder(store, '710', 'delivery-request-710', '710')
  let affectedInjected = false
  const affectedStore = createVirtualPaymentStore({
    pool: proxyPool(pool, {
      async execute(connection, sql, values) {
        const result = await connection.execute(sql, values)
        if (!affectedInjected && /UPDATE virtual_payment_orders[\s\S]*delivery_status = 'pending'/.test(sql)) {
          affectedInjected = true
          return [{ ...result[0], affectedRows: 0 }, result[1]]
        }
        return result
      }
    }),
    userEntitlementStore: entitlementStore
  })
  await assert.rejects(affectedStore.claimDeliveryWork('710', affected.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock()
  }))
  assert.equal((await store.findByUserAndOrderNo('710', affected.order.orderNo)).deliveryStatus, 'not_ready')
  const [[affectedAttempts]] = await pool.execute(
    'SELECT COUNT(*) AS count FROM virtual_payment_delivery_attempts WHERE order_id = ?', [affected.order.id]
  )
  assert.equal(Number(affectedAttempts.count), 0)

  const commitFailure = await createGrantedOrder(store, '711', 'delivery-request-711', '711')
  const commitFailureStore = createVirtualPaymentStore({
    pool: proxyPool(pool, { async commit() { throw new Error('commit sentinel') } }),
    userEntitlementStore: entitlementStore
  })
  await assert.rejects(commitFailureStore.claimDeliveryWork('711', commitFailure.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock()
  }))
  assert.equal((await store.findByUserAndOrderNo('711', commitFailure.order.orderNo)).deliveryStatus, 'not_ready')

  const rollbackFailure = await createGrantedOrder(store, '712', 'delivery-request-712', '712')
  await pool.query(`CREATE TRIGGER vp7_rollback_failure BEFORE INSERT ON virtual_payment_delivery_attempts
    FOR EACH ROW BEGIN IF NEW.user_id = 712 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vp7 rollback failure'; END IF; END`)
  const rollbackFailureStore = createVirtualPaymentStore({
    pool: proxyPool(pool, {
      async rollback(connection) {
        await connection.rollback()
        throw new Error('rollback sentinel')
      }
    }),
    userEntitlementStore: entitlementStore
  })
  await assert.rejects(rollbackFailureStore.claimDeliveryWork('712', rollbackFailure.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock()
  }))
  await pool.query('DROP TRIGGER vp7_rollback_failure')
  assert.equal((await store.findByUserAndOrderNo('712', rollbackFailure.order.orderNo)).deliveryStatus, 'not_ready')

  const releaseFailure = await createGrantedOrder(store, '713', 'delivery-request-713', '713')
  const releaseFailureStore = createVirtualPaymentStore({
    pool: proxyPool(pool, {
      async release(connection) {
        connection.release()
        throw new Error('release sentinel')
      }
    }),
    userEntitlementStore: entitlementStore
  })
  await assert.rejects(releaseFailureStore.claimDeliveryWork('713', releaseFailure.order.orderNo, {
    expectedProductId: PRODUCT_ID, now: clock()
  }))
  const releaseOrder = await store.findByUserAndOrderNo('713', releaseFailure.order.orderNo)
  assert.equal(releaseOrder.deliveryStatus, 'pending')
  const [[releaseAttempts]] = await pool.execute(
    'SELECT COUNT(*) AS count FROM virtual_payment_delivery_attempts WHERE order_id = ?', [releaseFailure.order.id]
  )
  assert.equal(Number(releaseAttempts.count), 1)

  const independentA = await createGrantedOrder(store, '714', 'delivery-request-714', '714')
  const independentB = await createGrantedOrder(store, '715', 'delivery-request-715', '715')
  const independent = await Promise.race([
    Promise.all([
      store.claimDeliveryWork('714', independentA.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() }),
      store.claimDeliveryWork('715', independentB.order.orderNo, { expectedProductId: PRODUCT_ID, now: clock() })
    ]),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('independent delivery claims blocked')), 2_000))
  ])
  assert(independent.every((result) => result.action === 'notify'))

  const serviceOrder = await createGrantedOrder(store, '706', 'delivery-request-706', '706')
  let notifyCalls = 0
  const service = serviceFor('706', store, {
      async notifyProvideGoods() { notifyCalls += 1; return { accepted: true } },
      async queryOrder() { throw new Error('not used') }
  })
  const serviceResult = await service.deliverOwnedOrder({ authenticatedUserId: '706', orderNo: serviceOrder.order.orderNo })
  assert.equal(serviceResult.deliveryStatus, 'delivered')
  assert.equal(notifyCalls, 1)

  const [[orphans]] = await pool.execute(
    `SELECT COUNT(*) AS count FROM virtual_payment_delivery_attempts a
     LEFT JOIN virtual_payment_orders o ON o.id = a.order_id
     WHERE o.id IS NULL OR o.user_id <> a.user_id`
  )
  assert.equal(Number(orphans.count), 0)
}

async function testEntrySchema(connection, config, database) {
  async function listening(port) {
    return new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
  }
  async function launch(mode, good, databaseOverride = database) {
    const reservation = net.createServer()
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    const env = { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port),
      DB_HOST: config.host, DB_PORT: String(config.port), DB_NAME: databaseOverride, DB_USER: config.user, DB_PASSWORD: config.password,
      VIRTUAL_PAYMENT_ENABLED: 'true', VIRTUAL_PAYMENT_ENV: 'sandbox', VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '701',
      WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox.offer-001', WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: PRODUCT_ID,
      WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'entry-test-secret-token', JWT_SECRET: 'entry-test-jwt-secret-only',
      ...(mode === 'pm2-equivalent' ? { pm_id: '0', NODE_APP_INSTANCE: '0' } : {}) }
    const child = mode === 'npm'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run dev:api'], { cwd: resolve('.'), env, windowsHide: true })
      : spawn(process.execPath, [resolve('server/index.mjs')], { cwd: resolve('.'), env, windowsHide: true })
    let output = '', exitCode = null, exited = false, spawnError
    child.stdout.on('data', (value) => { output += value })
    child.stderr.on('data', (value) => { output += value })
    child.once('error', (error) => { spawnError = error; exited = true })
    child.once('exit', (code) => { exitCode = code; exited = true })
    let accepted = false
    try {
      const deadline = Date.now() + 12000
      while (Date.now() < deadline && !exited) {
        if (await listening(port)) { accepted = true; break }
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      assert(!spawnError, 'entry process must launch')
      assert.equal(accepted, good, `${mode}: unexpected listening state; ${output}`)
      if (!good) {
        assert(exited, 'failed startup must terminate')
        assert.notEqual(exitCode, 0)
        assert(output.includes('API_STARTUP_CHECK_FAILED'))
      }
      for (const secret of [config.password, 'entry-test-secret-token', 'SELECT ', 'CREATE TABLE', 'mysql://']) assert(!output.includes(secret), 'startup output must be sanitized')
      const [[connections]] = await connection.execute('SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB = ? AND ID <> CONNECTION_ID()', [database])
      assert.equal(Number(connections.n), 0, 'startup schema connection must already be released')
    } finally {
      if (!exited && child.pid) {
        if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        else child.kill('SIGTERM')
      }
      for (let i = 0; i < 50 && await listening(port); i++) await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(await listening(port), false, 'test process port must be released')
    }
  }
  const correct = "CASE WHEN query_status = 'claimed' THEN order_id ELSE NULL END"
  for (const mode of ['npm', 'node', 'pm2-equivalent']) {
    await launch(mode, true)
    await connection.query('RENAME TABLE virtual_payment_delivery_queries TO held_delivery_queries')
    try { await launch(mode, false) } finally { await connection.query('RENAME TABLE held_delivery_queries TO virtual_payment_delivery_queries') }
    await connection.query(`ALTER TABLE virtual_payment_delivery_queries MODIFY COLUMN active_order_id BIGINT UNSIGNED GENERATED ALWAYS AS (${correct.replace("'claimed'", "'claim ed'")}) STORED`)
    try { await launch(mode, false) } finally { await connection.query(`ALTER TABLE virtual_payment_delivery_queries MODIFY COLUMN active_order_id BIGINT UNSIGNED GENERATED ALWAYS AS (${correct}) STORED`) }
    await connection.query('ALTER TABLE virtual_payment_delivery_queries DROP FOREIGN KEY fk_virtual_payment_delivery_query_event')
    try { await launch(mode, false) } finally { await connection.query('ALTER TABLE virtual_payment_delivery_queries ADD CONSTRAINT fk_virtual_payment_delivery_query_event FOREIGN KEY (provider_event_id) REFERENCES virtual_payment_events (id) ON UPDATE RESTRICT ON DELETE RESTRICT') }
    await launch(mode, false, `${database}_absent`)
    console.log(`Startup ${mode}: correct schema listens; missing table / claim ed / missing FK / DB error exit nonzero without listening.`)
  }
}

async function testSchemaRecovery(root, config, baseSql) {
  const contract = await readDeliverySchemaContract()
  let freshSchema
  for (const scenario of ['fresh', 'second_create_failure', 'only_second', 'missing_column', 'wrong_index', 'missing_fk', 'wrong_generated', 'both_incomplete']) {
    const name = `virtual_payment_delivery_test_${crypto.randomBytes(6).toString('hex')}`
    await assertDatabaseAbsent(root, name)
    await root.query(`CREATE DATABASE ${quoteDatabase(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    let connection
    try {
      connection = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: name, timezone: 'Z', multipleStatements: true })
      await connection.query(baseSql)
      if (scenario === 'second_create_failure') {
        const injected = {
          execute: (...args) => connection.execute(...args),
          query: (sql) => connection.query(sql.includes('CREATE TABLE IF NOT EXISTS `virtual_payment_delivery_queries`')
            ? sql.replace('REFERENCES `virtual_payment_delivery_attempts`', 'REFERENCES `missing_delivery_parent`') : sql)
        }
        await assert.rejects(applyDeliveryMigration(injected))
        assert.deepEqual(await assertDeliverySchema(connection, { allowPartial: true }), [contract[0].table])
      } else if (scenario === 'only_second') {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0')
        await connection.query(contract[1].statement)
        await connection.query('SET FOREIGN_KEY_CHECKS = 1')
        assert.deepEqual(await assertDeliverySchema(connection, { allowPartial: true }), [contract[1].table])
      } else if (!['fresh'].includes(scenario)) {
        let first = contract[0].statement
        if (scenario === 'missing_column') first = first.replace(/  `completion_source`[^\n]+\n/, '')
        if (scenario === 'wrong_index') first = first.replace('(`attempt_status`, `next_action_at`)', '(`next_action_at`, `attempt_status`)')
        if (scenario === 'missing_fk') first = first.replace(/,\n  CONSTRAINT `fk_virtual_payment_delivery_attempt_event`[\s\S]*?ON DELETE RESTRICT/, '')
        if (scenario === 'wrong_generated') first = first.replace("'uncertain', 'confirming') THEN", "'uncertain') THEN")
        await connection.query(first)
        if (scenario === 'both_incomplete') await connection.query(contract[1].statement.replace(/  `response_env_type`[^\n]+\n/, ''))
        for (let retry = 0; retry < 2; retry++) {
          await assert.rejects(applyDeliveryMigration(connection), (error) => error.code === 'PAYMENT_DELIVERY_SCHEMA_MISMATCH' && error.message === 'Payment delivery schema mismatch; controlled manual recovery is required.')
          await assert.rejects(checkVirtualPaymentDeliverySchema({ VIRTUAL_PAYMENT_ENABLED: 'true', DB_USER: config.user, DB_PASSWORD: config.password }, async () => ({ execute: (...args) => connection.execute(...args), async end() {} })), (error) => error.code === 'PAYMENT_DELIVERY_SCHEMA_MISMATCH')
        }
        continue
      }
      await applyDeliveryMigration(connection)
      await applyDeliveryMigration(connection)
      if (scenario === 'fresh') await testEntrySchema(connection, config, name)
      await checkVirtualPaymentDeliverySchema({ VIRTUAL_PAYMENT_ENABLED: 'true', DB_USER: config.user, DB_PASSWORD: config.password }, async () => ({ execute: (...args) => connection.execute(...args), async end() {} }))
      const schema = []
      for (const table of contract) {
        const [[row]] = await connection.query(`SHOW CREATE TABLE \`${table.table}\``)
        schema.push(row['Create Table'])
      }
      if (scenario === 'fresh') freshSchema = schema
      else assert.deepEqual(schema, freshSchema, scenario)
    } finally {
      if (connection) await connection.end()
      await root.query(`DROP DATABASE ${quoteDatabase(name)}`)
      await assertDatabaseAbsent(root, name)
    }
  }
  console.log('MySQL exact-schema: partial second-create failure recovery, only-second recovery and five malformed-schema refusals passed.')
}

export async function runVirtualPaymentDeliveryMysqlIntegration(env = process.env) {
  const config = configFrom(env)
  const databaseName = `virtual_payment_delivery_test_${crypto.randomBytes(6).toString('hex')}`
  const migrationParts = await Promise.all(migrations.map((url) => readFile(url, 'utf8')))
  const deliveryMigrationSql = migrationParts[migrationParts.length - 1]
  const root = await mysql.createConnection({
    host: config.host, port: config.port, user: config.user, password: config.password,
    charset: 'utf8mb4', timezone: 'Z'
  })
  let owned = false
  let migrationConnection = null
  let pool = null
  let singleConnectionPool = null
  await runWithGuaranteedCleanup({
    secretValues: [config.password],
    cleanupSteps: [
      { phase: 'close_delivery_pool', run: async () => { if (pool) await pool.end() } },
      { phase: 'close_delivery_single_pool', run: async () => { if (singleConnectionPool) await singleConnectionPool.end() } },
      { phase: 'close_delivery_migration_connection', run: async () => { if (migrationConnection) await migrationConnection.end() } },
      { phase: 'drop_delivery_database', run: async () => { if (owned) await root.query(`DROP DATABASE IF EXISTS ${quoteDatabase(databaseName)}`) } },
      { phase: 'verify_delivery_database_absent', run: async () => assertDatabaseAbsent(root, databaseName) },
      { phase: 'close_delivery_root_connection', run: async () => root.end() }
    ],
    runMain: async () => {
      const [[version]] = await root.query('SELECT VERSION() AS mysql_version')
      assert.equal(version.mysql_version, EXPECTED_VERSION)
      await testSchemaRecovery(root, config, migrationParts.slice(0, -1).join('\n'))
      const failedDatabaseName = `virtual_payment_delivery_test_${crypto.randomBytes(6).toString('hex')}`
      await assertDatabaseAbsent(root, failedDatabaseName)
      await root.query(`CREATE DATABASE ${quoteDatabase(failedDatabaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      let failedMigrationConnection
      try {
        failedMigrationConnection = await mysql.createConnection({
          host: config.host, port: config.port, user: config.user, password: config.password,
          database: failedDatabaseName, charset: 'utf8mb4', timezone: 'Z', multipleStatements: true
        })
        await assert.rejects(failedMigrationConnection.query(deliveryMigrationSql))
        const [partialTables] = await failedMigrationConnection.execute(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?)`,
          [failedDatabaseName, 'virtual_payment_delivery_attempts', 'virtual_payment_delivery_queries']
        )
        assert.equal(partialTables.length, 0)
      } finally {
        if (failedMigrationConnection) await failedMigrationConnection.end()
        await root.query(`DROP DATABASE IF EXISTS ${quoteDatabase(failedDatabaseName)}`)
        await assertDatabaseAbsent(root, failedDatabaseName)
      }
      await assertDatabaseAbsent(root, databaseName)
      await root.query(`CREATE DATABASE ${quoteDatabase(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      owned = true
      migrationConnection = await mysql.createConnection({
        host: config.host, port: config.port, user: config.user, password: config.password,
        database: databaseName, charset: 'utf8mb4', timezone: 'Z', multipleStatements: true
      })
      await migrationConnection.query(migrationParts.slice(0, -1).join('\n'))
      await applyDeliveryMigration(migrationConnection)
      await applyDeliveryMigration(migrationConnection)
      const [foreignKeys] = await migrationConnection.execute(
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME IN (?, ?, ?, ?, ?)`,
        [databaseName,
          'fk_virtual_payment_delivery_attempt_order', 'fk_virtual_payment_delivery_attempt_event',
          'fk_virtual_payment_delivery_query_order', 'fk_virtual_payment_delivery_query_attempt',
          'fk_virtual_payment_delivery_query_event']
      )
      assert.equal(foreignKeys.length, 5)
      pool = mysql.createPool({
        host: config.host, port: config.port, user: config.user, password: config.password,
        database: databaseName, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 6,
        supportBigNumbers: true, bigNumberStrings: true
      })
      singleConnectionPool = mysql.createPool({
        host: config.host, port: config.port, user: config.user, password: config.password,
        database: databaseName, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 1,
        supportBigNumbers: true, bigNumberStrings: true
      })
      await runScenarios(pool, singleConnectionPool)
    }
  })
}

const isMain = Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
if (isMain) {
  await runVirtualPaymentDeliveryMysqlIntegration()
  console.log('Virtual payment delivery isolated MySQL tests passed with no database residue.')
}
