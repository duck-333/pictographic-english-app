import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'

import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'
import { normalizeVerifiedWechatQueryFact } from '../server/virtual-payment-reconciliation.mjs'
import {
  createWechatGoodsDeliveryCanonicalFact,
  normalizeWechatGoodsDeliveryMessage
} from '../server/virtual-payment-message.mjs'
import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'
import { runWithGuaranteedCleanup } from './test-virtual-payment-mysql-integration.mjs'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3308
const EXPECTED_CONFIRMATION = 'local-docker-virtual-payment-only'
const SAFE_DATABASE_PATTERN = /^virtual_payment_message_test_[a-f0-9]{12}$/
const PRODUCT_ID = 'sandbox-product'
const TEST_PRODUCT_ID = 'sandbox-test-product'
const ORIGINAL_ID = 'gh_message_mysql'
const OPENID = 'openid-message-mysql'
const T0 = new Date('2026-09-14T08:00:00.000Z')
const DATABASE_FAILURE_CODES = new Set([
  'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'PAYMENT_DATABASE_TRANSACTION_FAILED'
])
const DATABASE_FAILURE_ERRNOS = new Set([1213, 1205])
const CONCURRENCY_TIMEOUT_MS = 15_000
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
    rawPort: String(env.VIRTUAL_PAYMENT_TEST_DB_PORT || '').trim(),
    port: Number(String(env.VIRTUAL_PAYMENT_TEST_DB_PORT || '').trim()),
    user: String(env.VIRTUAL_PAYMENT_TEST_DB_USER || '').trim(),
    password: String(env.VIRTUAL_PAYMENT_TEST_DB_PASSWORD || ''),
    confirmation: String(env.VIRTUAL_PAYMENT_TEST_ALLOW_DESTRUCTIVE || '').trim()
  }
  assert.equal(config.host, EXPECTED_HOST)
  assert.equal(config.rawPort, String(EXPECTED_PORT))
  assert(config.user && config.password)
  assert.equal(config.confirmation, EXPECTED_CONFIRMATION)
  for (const forbidden of ['production', 'prod', 'baxiaota', 'sandbox']) {
    assert(!config.host.toLowerCase().includes(forbidden))
  }
  return config
}

function quoteDatabase(name) {
  assert.match(name, SAFE_DATABASE_PATTERN)
  return `\`${name}\``
}

function orderInput(userId, requestId, product = { productId: PRODUCT_ID, priceFen: 3000 }) {
  return {
    userId, clientRequestId: requestId, internalSku: 'membership_30d', productId: product.productId,
    productName: '30天学习会员', quantity: 1, unitPriceFen: product.priceFen, orderAmountFen: product.priceFen,
    currency: 'CNY', environment: 'sandbox', wechatEnv: 1,
    paymentChannel: 'wechat_virtual_payment', clientPlatform: 'android'
  }
}

function messageBody(order, suffix, overrides = {}) {
  const paidAt = order.paidAt ? Math.floor(Date.parse(order.paidAt) / 1000) : Math.floor(T0.getTime() / 1000) - 10
  return {
    ToUserName: ORIGINAL_ID, FromUserName: 'wechat-message-sender',
    CreateTime: Math.floor(T0.getTime() / 1000), MsgType: 'event',
    Event: 'xpay_goods_deliver_notify', OpenId: OPENID, OutTradeNo: order.orderNo, Env: 1,
    GoodsInfo: {
      ProductId: order.productId, Quantity: 1, Attach: order.orderNo,
      TeamInfo: { ActivityId: `activity-${suffix}`, TeamId: `team-${suffix}`, TeamType: 1, TeamAction: 2 }
    },
    WeChatPayInfo: {
      MchOrderNo: `merchant-${suffix}`,
      TransactionId: order.providerTransactionId || `transaction-${suffix}`,
      PaidTime: paidAt
    },
    FutureRootField: 'ignored',
    ...overrides
  }
}

function messageFact(order, suffix, overrides = {}) {
  return normalizeWechatGoodsDeliveryMessage(messageBody(order, suffix, overrides), order, {
    originalId: ORIGINAL_ID, openid: OPENID, userId: order.userId, now: T0
  })
}

async function createPending(store, userId, suffix, product) {
  const created = await store.createOrder(orderInput(userId, `message-mysql-${suffix}`, product))
  return store.markOrderPending(userId, created.order.orderNo)
}

async function createPaid(store, userId, suffix) {
  const pending = await createPending(store, userId, suffix)
  const raw = {
    orderId: pending.orderNo, wechatOrderId: `WXORDER${suffix}`,
    wechatPaymentOrderId: `WXPAY${suffix}`, status: 2, orderType: 0,
    orderFeeFen: 3000, paidFeeFen: 3000,
    paidAtSeconds: Math.floor(T0.getTime() / 1000) - 3600,
    providedAtSeconds: 0, environmentType: 2, environment: 'sandbox'
  }
  const fact = normalizeVerifiedWechatQueryFact(raw, pending, { now: () => T0.getTime() })
  const paid = await store.reconcileVerifiedWechatQuery(userId, pending.orderNo, fact, { expectedProductId: PRODUCT_ID })
  return paid.order
}

async function createGranted(store, userId, suffix) {
  const paid = await createPaid(store, userId, suffix)
  const granted = await store.grantTrustedPaidOrderEntitlement(userId, paid.orderNo, {
    expectedProductId: PRODUCT_ID, now: T0
  })
  return granted.order
}

function withTimeout(promise, label) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: 'TEST_TIMEOUT' })), CONCURRENCY_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

function errorChain(reason, maxDepth = 4) {
  const chain = []
  const seen = new Set()
  let current = reason
  while (current && (typeof current === 'object' || typeof current === 'function') && chain.length < maxDepth && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = current.cause
  }
  return chain
}

function assertConcurrentResults(settled, allowedRejections = new Map()) {
  assert(Array.isArray(settled))
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') continue
    const chain = errorChain(result.reason)
    assert(chain.length > 0, `concurrent result ${index} rejected without an Error-like reason`)
    for (const error of chain) {
      assert(!DATABASE_FAILURE_CODES.has(error.code), `concurrent result ${index} failed with database code ${error.code}`)
      assert(!DATABASE_FAILURE_ERRNOS.has(error.errno), `concurrent result ${index} failed with database errno ${error.errno}`)
    }
    const allowedCodes = allowedRejections.get(index) || new Set()
    assert(allowedCodes.has(result.reason.code), `unexpected concurrent rejection ${index}: ${String(result.reason.code || 'missing-code')}`)
  }
}

for (const reason of [
  Object.assign(new Error('wrapped'), { code: 'PAYMENT_DATABASE_TRANSACTION_FAILED' }),
  Object.assign(new Error('wrapped'), { cause: Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }) }),
  Object.assign(new Error('wrapped'), { cause: Object.assign(new Error('timeout'), { errno: 1205 }) })
]) assert.throws(() => assertConcurrentResults([{ status: 'rejected', reason }]))

function createTwoConnectionBarrierPool(pool) {
  const waiting = []
  const threadIds = new Set()
  let released = false
  return {
    threadIds,
    async getConnection() {
      const connection = await pool.getConnection()
      const [[identity]] = await connection.execute('SELECT CONNECTION_ID() AS connection_id')
      threadIds.add(String(identity.connection_id))
      if (released) return connection
      return new Promise((resolve) => {
        waiting.push({ connection, resolve })
        if (waiting.length === 2) {
          released = true
          for (const item of waiting) item.resolve(item.connection)
        }
      })
    }
  }
}

async function membershipCounts(pool, userId) {
  const [[row]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = ?) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions
         WHERE user_id = ? AND transaction_type = 'MEMBERSHIP_GRANT') AS transactions`,
    [userId, userId]
  )
  return { grants: Number(row.grants), transactions: Number(row.transactions) }
}

async function runScenarios(pool) {
  const entitlementStore = createUserEntitlementStore({ pool, now: () => new Date(T0) })
  const createStore = (storePool = pool, storeEntitlement = entitlementStore) => createVirtualPaymentStore({
    pool: storePool, userEntitlementStore: storeEntitlement,
    orderNoFactory: () => `VP${crypto.randomBytes(15).toString('hex').toUpperCase()}`
  })
  const store = createStore()

  console.log('MySQL message scenario: first/repeat/conflict')
  const firstOrder = await createPending(store, '901', 'first-0001')
  const firstFact = messageFact(firstOrder, 'first')
  const first = await store.applyGoodsDeliveryNotification('901', firstOrder.orderNo, firstFact, { now: T0 })
  assert.equal(first.order.paymentStatus, 'paid')
  assert.equal(first.order.entitlementStatus, 'granted')
  assert.equal(first.order.deliveryStatus, 'delivered')
  assert.deepEqual(await membershipCounts(pool, '901'), { grants: 1, transactions: 1 })

  const conflictingAttach = 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
  const conflictingAttachCanonical = createWechatGoodsDeliveryCanonicalFact({
    source: firstFact.source, environment: 'sandbox', wechatEnv: 1,
    userId: firstFact.userId, orderNo: firstFact.orderNo,
    productId: firstFact.productId, internalSku: firstFact.internalSku,
    quantity: firstFact.quantity, attach: conflictingAttach,
    unitPriceFen: firstFact.unitPriceFen, orderAmountFen: firstFact.orderAmountFen,
    providerMerchantOrderNo: firstFact.providerMerchantOrderNo,
    providerTransactionId: firstFact.providerTransactionId,
    paidAtSeconds: firstFact.paidAtSeconds
  })
  await assert.rejects(
    store.applyGoodsDeliveryNotification('901', firstOrder.orderNo, {
      ...firstFact, attach: conflictingAttach,
      eventKey: conflictingAttachCanonical.eventKey,
      payloadHash: conflictingAttachCanonical.payloadHash
    }, { now: T0 }),
    (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
  )
  assert.deepEqual(await membershipCounts(pool, '901'), { grants: 1, transactions: 1 })
  assert.equal(await store.findTrustedWechatQueryPaidEvidence('901', firstOrder.orderNo), true)

  const duplicate = await store.applyGoodsDeliveryNotification('901', firstOrder.orderNo, firstFact, { now: T0 })
  assert.equal(duplicate.eventDuplicate, true)
  const [[duplicateEvent]] = await pool.execute(
    'SELECT provider_order_id, received_count FROM virtual_payment_events WHERE event_key = ?', [firstFact.eventKey]
  )
  assert.equal(duplicateEvent.provider_order_id, 'merchant-first')
  assert.equal(Number(duplicateEvent.received_count), 2)
  assert.deepEqual(await membershipCounts(pool, '901'), { grants: 1, transactions: 1 })

  const conflictingMerchant = messageFact(firstOrder, 'first', {
    WeChatPayInfo: { ...messageBody(firstOrder, 'first').WeChatPayInfo, MchOrderNo: 'merchant-conflict' }
  })
  await assert.rejects(
    store.applyGoodsDeliveryNotification('901', firstOrder.orderNo, conflictingMerchant, { now: T0 }),
    (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
  )
  const [[afterConflict]] = await pool.execute(
    'SELECT received_count FROM virtual_payment_events WHERE event_key = ?', [firstFact.eventKey]
  )
  assert.equal(Number(afterConflict.received_count), 2)
  assert.deepEqual(await membershipCounts(pool, '901'), { grants: 1, transactions: 1 })

  console.log('MySQL message scenario: concurrent duplicate')
  const concurrentOrder = await createPending(store, '902', 'concurrent-0002')
  const concurrentFact = messageFact(concurrentOrder, 'concurrent')
  const concurrentSettled = await withTimeout(Promise.allSettled([
    store.applyGoodsDeliveryNotification('902', concurrentOrder.orderNo, concurrentFact, { now: T0 }),
    store.applyGoodsDeliveryNotification('902', concurrentOrder.orderNo, concurrentFact, { now: T0 })
  ]), 'duplicate message concurrency')
  assertConcurrentResults(concurrentSettled)
  assert(concurrentSettled.every((result) => result.status === 'fulfilled'))
  const concurrent = concurrentSettled.map((result) => result.value)
  assert.equal(concurrent.filter((item) => item.eventDuplicate).length, 1)
  assert.deepEqual(await membershipCounts(pool, '902'), { grants: 1, transactions: 1 })

  console.log('MySQL message scenario: entitlement/message true concurrency')
  const paidConcurrent = await createPaid(store, '903', 'ENTMSG903')
  const entitlementMessageBarrier = createTwoConnectionBarrierPool(pool)
  const entitlementMessageStore = createStore(entitlementMessageBarrier)
  const entitlementMessageSettled = await withTimeout(Promise.allSettled([
    entitlementMessageStore.grantTrustedPaidOrderEntitlement('903', paidConcurrent.orderNo, {
      expectedProductId: PRODUCT_ID, now: T0
    }),
    entitlementMessageStore.applyGoodsDeliveryNotification(
      '903', paidConcurrent.orderNo, messageFact(paidConcurrent, 'entitlement-message'), { now: T0 }
    )
  ]), 'entitlement/message concurrency')
  assertConcurrentResults(entitlementMessageSettled, new Map([
    [0, new Set(['PAYMENT_PAID_FACT_INCOMPLETE'])]
  ]))
  assert.equal(entitlementMessageBarrier.threadIds.size, 2)
  assert.equal(entitlementMessageSettled[1].status, 'fulfilled')
  if (entitlementMessageSettled[0].status === 'rejected') {
    assert.equal(entitlementMessageSettled[0].reason.code, 'PAYMENT_PAID_FACT_INCOMPLETE')
  } else {
    assert.equal(entitlementMessageSettled[0].value.order.entitlementStatus, 'granted')
  }
  console.log(
    `MySQL entitlement/message results: entitlement=${entitlementMessageSettled[0].status === 'fulfilled' ? 'fulfilled' : entitlementMessageSettled[0].reason.code}; message=fulfilled`
  )
  const entitlementMessageOrder = await store.findByUserAndOrderNo('903', paidConcurrent.orderNo)
  assert.equal(entitlementMessageOrder.entitlementStatus, 'granted')
  assert.equal(entitlementMessageOrder.deliveryStatus, 'delivered')
  assert.deepEqual(await membershipCounts(pool, '903'), { grants: 1, transactions: 1 })
  const [[entitlementMessageFacts]] = await pool.execute(
    `SELECT COUNT(*) AS events,
            (SELECT SUM(duration_seconds) FROM membership_grants WHERE user_id = ?) AS duration_seconds
       FROM virtual_payment_events WHERE order_id = ? AND event_type = 'xpay_goods_deliver_notify'`,
    ['903', paidConcurrent.id]
  )
  assert.equal(Number(entitlementMessageFacts.events), 1)
  assert.equal(Number(entitlementMessageFacts.duration_seconds), 2_592_000)

  console.log('MySQL message scenario: same-user two-order 60-day true concurrency')
  const scheduleUserId = '907'
  const testProductOrder = await createPending(store, scheduleUserId, 'SCHEDULETEST907', {
    productId: TEST_PRODUCT_ID, priceFen: 100
  })
  const standardProductOrder = await createPending(store, scheduleUserId, 'SCHEDULESTANDARD907', {
    productId: PRODUCT_ID, priceFen: 3000
  })
  const scheduleBarrier = createTwoConnectionBarrierPool(pool)
  const scheduleStore = createStore(scheduleBarrier)
  const scheduleSettled = await withTimeout(Promise.allSettled([
    scheduleStore.applyGoodsDeliveryNotification(
      scheduleUserId, testProductOrder.orderNo, messageFact(testProductOrder, 'schedule-test'), { now: T0 }
    ),
    scheduleStore.applyGoodsDeliveryNotification(
      scheduleUserId, standardProductOrder.orderNo, messageFact(standardProductOrder, 'schedule-standard'), { now: T0 }
    )
  ]), 'same-user two-order concurrency')
  assertConcurrentResults(scheduleSettled)
  assert(scheduleSettled.every((result) => result.status === 'fulfilled'))
  assert.equal(scheduleBarrier.threadIds.size, 2)
  for (const order of [testProductOrder, standardProductOrder]) {
    const finalOrder = await store.findByUserAndOrderNo(scheduleUserId, order.orderNo)
    assert.equal(finalOrder.paymentStatus, 'paid')
    assert.equal(finalOrder.entitlementStatus, 'granted')
    assert.equal(finalOrder.deliveryStatus, 'delivered')
  }
  const [scheduleGrants] = await pool.execute(
    `SELECT source_id, idempotency_key, duration_seconds, effective_start_at, effective_end_at
       FROM membership_grants WHERE user_id = ? ORDER BY effective_start_at, id`,
    [scheduleUserId]
  )
  assert.equal(scheduleGrants.length, 2)
  assert.equal(new Set(scheduleGrants.map((row) => row.source_id)).size, 2)
  assert.equal(new Set(scheduleGrants.map((row) => row.idempotency_key)).size, 2)
  const firstStart = new Date(scheduleGrants[0].effective_start_at).getTime()
  const firstEnd = new Date(scheduleGrants[0].effective_end_at).getTime()
  const secondStart = new Date(scheduleGrants[1].effective_start_at).getTime()
  const secondEnd = new Date(scheduleGrants[1].effective_end_at).getTime()
  assert.equal(firstStart, T0.getTime())
  assert.equal(firstEnd - firstStart, 2_592_000_000)
  assert.equal(secondStart, firstEnd)
  assert.equal(secondEnd - secondStart, 2_592_000_000)
  assert.equal(secondEnd - firstStart, 5_184_000_000)
  assert(scheduleGrants.every((row) => Number(row.duration_seconds) === 2_592_000))
  assert.deepEqual(await membershipCounts(pool, scheduleUserId), { grants: 2, transactions: 2 })
  console.log(
    `MySQL membership intervals: ${new Date(firstStart).toISOString()} -> ${new Date(firstEnd).toISOString()} -> ${new Date(secondEnd).toISOString()} (5184000 seconds)`
  )
  const [scheduleEvents] = await pool.execute(
    `SELECT order_id, COUNT(*) AS total FROM virtual_payment_events
      WHERE order_id IN (?, ?) AND event_type = 'xpay_goods_deliver_notify'
      GROUP BY order_id`,
    [testProductOrder.id, standardProductOrder.id]
  )
  assert.equal(scheduleEvents.length, 2)
  assert(scheduleEvents.every((row) => Number(row.total) === 1))

  console.log('MySQL message scenario: four active attempt states')
  for (const [offset, targetStatus] of ['claimed', 'dispatching', 'uncertain', 'confirming'].entries()) {
    const userId = String(910 + offset)
    const activeOrder = await createGranted(store, userId, `ACTIVE${userId}`)
    const activeWork = await store.claimDeliveryWork(userId, activeOrder.orderNo, {
      expectedProductId: PRODUCT_ID, messagePushEnabled: false, now: T0
    })
    assert.equal(activeWork.action, 'notify')
    if (targetStatus !== 'claimed') {
      await store.markDeliveryDispatching(userId, activeOrder.orderNo, activeWork.attempt.operationId, {
        expectedProductId: PRODUCT_ID, now: new Date(T0.getTime() + 1_000)
      })
    }
    if (targetStatus === 'uncertain' || targetStatus === 'confirming') {
      await store.finishDeliveryNotify(userId, activeOrder.orderNo, activeWork.attempt.operationId, {
        kind: 'uncertain', errorCode: 'DELIVERY_NOTIFY_UNCERTAIN', now: new Date(T0.getTime() + 2_000)
      })
      if (targetStatus === 'uncertain') {
        const [changed] = await pool.execute(
          `UPDATE virtual_payment_delivery_attempts SET attempt_status = 'uncertain'
            WHERE operation_id = ? AND attempt_status = 'confirming'`,
          [activeWork.attempt.operationId]
        )
        assert.equal(changed.affectedRows, 1)
      }
    }
    const [[beforeAttempt]] = await pool.execute(
      `SELECT attempt_status, result_kind, completion_source, lease_owner, lease_expires_at,
              request_started_at, response_received_at, next_action_at, query_count,
              provider_event_id, last_error_code
         FROM virtual_payment_delivery_attempts WHERE operation_id = ?`,
      [activeWork.attempt.operationId]
    )
    assert.equal(beforeAttempt.attempt_status, targetStatus)
    const currentOrder = await store.findByUserAndOrderNo(userId, activeOrder.orderNo)
    await assert.rejects(
      store.applyGoodsDeliveryNotification(userId, activeOrder.orderNo, messageFact(currentOrder, `active-${targetStatus}`), { now: new Date(T0.getTime() + 3_000) }),
      (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT'
    )
    const [[afterAttempt]] = await pool.execute(
      `SELECT attempt_status, result_kind, completion_source, lease_owner, lease_expires_at,
              request_started_at, response_received_at, next_action_at, query_count,
              provider_event_id, last_error_code
         FROM virtual_payment_delivery_attempts WHERE operation_id = ?`,
      [activeWork.attempt.operationId]
    )
    assert.deepEqual(afterAttempt, beforeAttempt)
    assert.deepEqual(await membershipCounts(pool, userId), { grants: 1, transactions: 1 })
    const [[messageEvents]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM virtual_payment_events
        WHERE order_id = ? AND event_type = 'xpay_goods_deliver_notify'`, [activeOrder.id]
    )
    assert.equal(Number(messageEvents.total), 0)
  }

  console.log('MySQL message scenario: production Service creates uncertain result')
  const serviceUserId = '920'
  const serviceOrder = await createGranted(store, serviceUserId, 'SERVICEUNCERTAIN920')
  let notifyCalls = 0
  let serviceClock = 0
  const service = createVirtualPaymentService({
    env: {
      NODE_ENV: 'development', VIRTUAL_PAYMENT_ENABLED: 'true', VIRTUAL_PAYMENT_ENV: 'sandbox',
      VIRTUAL_PAYMENT_SANDBOX_USER_IDS: serviceUserId,
      WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox.offer-message-test',
      WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: PRODUCT_ID,
      VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ENABLED: 'true',
      WECHAT_VIRTUAL_PAYMENT_SANDBOX_TEST_PRODUCT_ID: TEST_PRODUCT_ID,
      WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'sandbox-message-test-key'
    },
    now: () => new Date(T0.getTime() + serviceClock++ * 1_000),
    store,
    messagePushEnabled: false,
    identityStore: { async findWechatOpenidByUserIdForPayment() { return OPENID } },
    virtualPaymentClient: {
      async notifyProvideGoods() {
        notifyCalls += 1
        throw Object.assign(new Error('uncertain fixture'), { code: 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE' })
      },
      async queryOrder() { throw new Error('query must not run') }
    },
    paymentSessionService: { async exchangeAndVerifyPaymentSession() { throw new Error('session must not run') } },
    signingService: { createPaymentParameters() { throw new Error('signing must not run') } }
  })
  const serviceResult = await service.deliverOwnedOrder({
    authenticatedUserId: serviceUserId, orderNo: serviceOrder.orderNo
  })
  assert.equal(serviceResult.deliveryStatus, 'confirming')
  assert.equal(notifyCalls, 1)
  const [[serviceAttemptBefore]] = await pool.execute(
    `SELECT attempt_status, result_kind, completion_source, request_started_at,
            response_received_at, last_error_code
       FROM virtual_payment_delivery_attempts WHERE order_id = ?`,
    [serviceOrder.id]
  )
  assert.equal(serviceAttemptBefore.attempt_status, 'confirming')
  assert.equal(serviceAttemptBefore.result_kind, 'uncertain')
  assert.equal(serviceAttemptBefore.completion_source, 'none')
  assert(serviceAttemptBefore.request_started_at instanceof Date)
  assert(serviceAttemptBefore.response_received_at instanceof Date)
  assert(serviceAttemptBefore.response_received_at.getTime() >= serviceAttemptBefore.request_started_at.getTime())
  assert.equal(serviceAttemptBefore.last_error_code, 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE')
  const serviceOrderAfter = await store.findByUserAndOrderNo(serviceUserId, serviceOrder.orderNo)
  assert.equal(serviceOrderAfter.deliveryStatus, 'confirming')
  assert.equal(serviceOrderAfter.lastErrorCode, 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE')
  await assert.rejects(
    store.applyGoodsDeliveryNotification(
      serviceUserId, serviceOrder.orderNo, messageFact(serviceOrderAfter, 'service-uncertain'),
      { now: new Date(T0.getTime() + 10_000) }
    ),
    (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT'
  )
  const [[serviceAttemptAfter]] = await pool.execute(
    `SELECT attempt_status, result_kind, completion_source, request_started_at,
            response_received_at, last_error_code
       FROM virtual_payment_delivery_attempts WHERE order_id = ?`,
    [serviceOrder.id]
  )
  assert.deepEqual(serviceAttemptAfter, serviceAttemptBefore)
  assert.equal(notifyCalls, 1)
  assert.deepEqual(await membershipCounts(pool, serviceUserId), { grants: 1, transactions: 1 })
  const [[serviceMessageEvents]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM virtual_payment_events
      WHERE order_id = ? AND event_type = 'xpay_goods_deliver_notify'`,
    [serviceOrder.id]
  )
  assert.equal(Number(serviceMessageEvents.total), 0)
  console.log('MySQL production Service result: confirming/uncertain; notify calls=1; message rejected')

  console.log('MySQL message scenario: callback within primary window')
  const primaryOrder = await createGranted(store, '904', 'PRIMARY904')
  const initialWait = await store.claimDeliveryWork('904', primaryOrder.orderNo, {
    expectedProductId: PRODUCT_ID, messagePushEnabled: true, now: T0
  })
  assert.equal(initialWait.action, 'wait')
  const beforeDeadline = await store.claimDeliveryWork('904', primaryOrder.orderNo, {
    expectedProductId: PRODUCT_ID, messagePushEnabled: true, now: new Date(T0.getTime() + 59_000)
  })
  assert.equal(beforeDeadline.action, 'wait')
  const [[noAttempt]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM virtual_payment_delivery_attempts WHERE order_id = ?', [primaryOrder.id]
  )
  assert.equal(Number(noAttempt.total), 0)
  await store.applyGoodsDeliveryNotification('904', primaryOrder.orderNo, messageFact(primaryOrder, 'primary'), {
    now: new Date(T0.getTime() + 59_000)
  })
  const afterMessage = await store.claimDeliveryWork('904', primaryOrder.orderNo, {
    expectedProductId: PRODUCT_ID, messagePushEnabled: true, now: new Date(T0.getTime() + 60_000)
  })
  assert.equal(afterMessage.action, 'delivered')

  console.log('MySQL message scenario: message/fallback true concurrency at deadline')
  const fallbackOrder = await createGranted(store, '905', 'FALLBACK905')
  await store.claimDeliveryWork('905', fallbackOrder.orderNo, {
    expectedProductId: PRODUCT_ID, messagePushEnabled: true, now: T0
  })
  const fallbackBarrier = createTwoConnectionBarrierPool(pool)
  const fallbackStore = createStore(fallbackBarrier)
  const fallbackSettled = await withTimeout(Promise.allSettled([
    fallbackStore.applyGoodsDeliveryNotification(
      '905', fallbackOrder.orderNo, messageFact(fallbackOrder, 'fallback-race'),
      { now: new Date(T0.getTime() + 60_000) }
    ),
    fallbackStore.claimDeliveryWork('905', fallbackOrder.orderNo, {
      expectedProductId: PRODUCT_ID, messagePushEnabled: true, now: new Date(T0.getTime() + 60_000)
    })
  ]), 'message/fallback concurrency')
  assertConcurrentResults(fallbackSettled, new Map([
    [0, new Set(['PAYMENT_DELIVERY_CONFLICT'])]
  ]))
  assert.equal(fallbackBarrier.threadIds.size, 2)
  const [[fallbackFacts]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM virtual_payment_delivery_attempts
         WHERE order_id = ? AND attempt_status IN ('claimed','dispatching','uncertain','confirming')) AS active_attempts,
       (SELECT COUNT(*) FROM virtual_payment_events
         WHERE order_id = ? AND event_type = 'xpay_goods_deliver_notify') AS message_events`,
    [fallbackOrder.id, fallbackOrder.id]
  )
  const finalFallbackOrder = await store.findByUserAndOrderNo('905', fallbackOrder.orderNo)
  const activeAttempts = Number(fallbackFacts.active_attempts)
  const messageEvents = Number(fallbackFacts.message_events)
  let fallbackWinner
  if (fallbackSettled[0].status === 'fulfilled') {
    fallbackWinner = 'message'
    assert.equal(fallbackSettled[1].status, 'fulfilled')
    assert.equal(fallbackSettled[1].value.action, 'delivered')
    assert.equal(finalFallbackOrder.deliveryStatus, 'delivered')
    assert.equal(activeAttempts, 0)
    assert.equal(messageEvents, 1)
  } else {
    fallbackWinner = 'fallback'
    assert.equal(fallbackSettled[0].reason.code, 'PAYMENT_DELIVERY_CONFLICT')
    assert.equal(fallbackSettled[1].status, 'fulfilled')
    assert.equal(fallbackSettled[1].value.action, 'notify')
    assert.equal(finalFallbackOrder.deliveryStatus, 'pending')
    assert.equal(activeAttempts, 1)
    assert.equal(messageEvents, 0)
  }
  assert.deepEqual(await membershipCounts(pool, '905'), { grants: 1, transactions: 1 })
  console.log(`MySQL message/fallback result: winner=${fallbackWinner}`)

  console.log('MySQL message scenario: injected post-grant rollback')
  const rollbackOrder = await createPending(store, '906', 'rollback-0906')
  const rollbackEntitlementStore = {
    ...entitlementStore,
    async grantMembershipDurationInTransaction(connection, input) {
      await entitlementStore.grantMembershipDurationInTransaction(connection, input)
      throw Object.assign(new Error('injected post-grant failure'), { code: 'INJECTED_POST_GRANT_FAILURE' })
    }
  }
  const rollbackStore = createStore(pool, rollbackEntitlementStore)
  await assert.rejects(
    rollbackStore.applyGoodsDeliveryNotification('906', rollbackOrder.orderNo, messageFact(rollbackOrder, 'rollback'), { now: T0 }),
    (error) => error.code === 'PAYMENT_MEMBERSHIP_GRANT_FAILED'
  )
  const rolledBackOrder = await store.findByUserAndOrderNo('906', rollbackOrder.orderNo)
  assert.equal(rolledBackOrder.paymentStatus, 'pending')
  assert.equal(rolledBackOrder.entitlementStatus, 'not_ready')
  assert.equal(rolledBackOrder.deliveryStatus, 'not_ready')
  assert.equal(rolledBackOrder.providerTransactionId, null)
  assert.equal(rolledBackOrder.paidAt, null)
  assert.deepEqual(await membershipCounts(pool, '906'), { grants: 0, transactions: 0 })
  const [[rollbackResidue]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM virtual_payment_events WHERE order_id = ?) AS events,
       (SELECT COUNT(*) FROM virtual_payment_delivery_attempts WHERE order_id = ?) AS attempts,
       (SELECT COUNT(*) FROM virtual_payment_delivery_queries WHERE order_id = ?) AS queries,
       (SELECT COALESCE(SUM(received_count), 0) FROM virtual_payment_events WHERE order_id = ?) AS received_count`,
    [rollbackOrder.id, rollbackOrder.id, rollbackOrder.id, rollbackOrder.id]
  )
  assert.deepEqual({
    events: Number(rollbackResidue.events), attempts: Number(rollbackResidue.attempts),
    queries: Number(rollbackResidue.queries), receivedCount: Number(rollbackResidue.received_count)
  }, { events: 0, attempts: 0, queries: 0, receivedCount: 0 })
}

const config = configFrom(process.env)
const databaseName = `virtual_payment_message_test_${crypto.randomBytes(6).toString('hex')}`
const root = await mysql.createConnection({
  host: config.host, port: config.port, user: config.user, password: config.password,
  multipleStatements: true, timezone: 'Z'
})
let pool = null
let owned = false
await runWithGuaranteedCleanup({
  secretValues: [config.password],
  cleanupSteps: [
    { phase: 'close_message_pool', run: async () => { if (pool) await pool.end() } },
    { phase: 'drop_message_database', run: async () => {
      if (!owned) return
      await root.query(`DROP DATABASE IF EXISTS ${quoteDatabase(databaseName)}`)
      const [remaining] = await root.execute(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [databaseName]
      )
      assert.equal(remaining.length, 0)
      console.log('MySQL random test database cleanup: deleted')
    } },
    { phase: 'close_message_root', run: async () => { await root.end() } }
  ],
  runMain: async () => {
    const [[versionRow]] = await root.execute('SELECT VERSION() AS version')
    assert.match(String(versionRow.version), /^8\./)
    console.log(`MySQL version: ${versionRow.version}`)
    const [existing] = await root.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [databaseName]
    )
    assert.equal(existing.length, 0)
    await root.query(`CREATE DATABASE ${quoteDatabase(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    owned = true
    const migrationSql = (await Promise.all(migrations.map((url) => readFile(url, 'utf8')))).join('\n')
    const migrationConnection = await mysql.createConnection({
      host: config.host, port: config.port, user: config.user, password: config.password,
      database: databaseName, multipleStatements: true, timezone: 'Z'
    })
    try { await migrationConnection.query(migrationSql) } finally { await migrationConnection.end() }
    const [engineRows] = await root.execute(
      `SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?, ?, ?, ?)`,
      [databaseName, 'virtual_payment_orders', 'virtual_payment_events',
        'virtual_payment_delivery_attempts', 'virtual_payment_delivery_queries',
        'user_entitlements', 'membership_grants', 'entitlement_transactions']
    )
    assert.equal(engineRows.length, 7)
    for (const row of engineRows) assert.equal(row.ENGINE, 'InnoDB', row.TABLE_NAME)
    console.log('MySQL storage engines: 7/7 InnoDB')
    pool = mysql.createPool({
      host: config.host, port: config.port, user: config.user, password: config.password,
      database: databaseName, connectionLimit: 8, timezone: 'Z',
      supportBigNumbers: true, bigNumberStrings: true
    })
    await runScenarios(pool)
  }
})

console.log('virtual payment message MySQL integration tests passed')
