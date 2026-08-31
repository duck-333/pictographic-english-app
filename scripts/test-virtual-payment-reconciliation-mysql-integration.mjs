import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import mysql from 'mysql2/promise'

import {
  createWechatQueryCanonicalFact,
  normalizeVerifiedWechatQueryFact
} from '../server/virtual-payment-reconciliation.mjs'
import { createVirtualPaymentService } from '../server/virtual-payment-service.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'
import { runWithGuaranteedCleanup } from './test-virtual-payment-mysql-integration.mjs'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3308
const EXPECTED_VERSION = '8.0.46'
const EXPECTED_CONFIRMATION = 'local-docker-virtual-payment-only'
const SAFE_DATABASE_PATTERN = /^virtual_payment_reconcile_test_[a-f0-9]{12}$/
const migrationUrl = new URL('../database/migrations/009_create_virtual_payment_foundation.sql', import.meta.url)
const NOW = Date.parse('2026-08-31T00:00:00.000Z')
const TRUSTED_CONTEXT = Object.freeze({ expectedProductId: 'sandbox-product' })

function readConfig(env = process.env) {
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
  assert(config.user)
  assert(config.password)
  assert.equal(config.confirmation, EXPECTED_CONFIRMATION)
  return config
}

function quoteDatabase(databaseName) {
  assert.match(databaseName, SAFE_DATABASE_PATTERN)
  return `\`${databaseName}\``
}

async function assertDatabaseAbsent(connection, databaseName) {
  const [rows] = await connection.execute(
    'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
    [databaseName]
  )
  assert.equal(rows.length, 0)
}

function createInput(userId, clientRequestId) {
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

function enabledEnv() {
  return {
    NODE_ENV: 'development',
    VIRTUAL_PAYMENT_ENABLED: 'true',
    VIRTUAL_PAYMENT_ENV: 'sandbox',
    VIRTUAL_PAYMENT_SANDBOX_USER_IDS: '201,206,208',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_OFFER_ID: 'sandbox-offer',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_PRODUCT_ID: 'sandbox-product',
    WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY: 'fake-app-key'
  }
}

function queryResult(orderNo, status, providerOrderId, providerTransactionId = null, overrides = {}) {
  const paid = [2, 3, 4].includes(status)
  return {
    orderId: orderNo,
    wechatOrderId: providerOrderId,
    wechatPaymentOrderId: paid ? providerTransactionId : null,
    status,
    orderType: 0,
    orderFeeFen: 3000,
    paidFeeFen: paid ? 3000 : null,
    paidAtSeconds: paid ? Math.floor(NOW / 1000) : null,
    providedAtSeconds: null,
    environmentType: 2,
    environment: 'sandbox',
    ...overrides
  }
}

async function createPending(store, userId, clientRequestId) {
  const created = await store.createOrder(createInput(userId, clientRequestId))
  return store.markOrderPending(userId, created.order.orderNo)
}

async function testReconciliation(pool) {
  const store = createVirtualPaymentStore({
    pool,
    orderNoFactory: () => `VP${crypto.randomBytes(15).toString('hex').toUpperCase()}`
  })

  const paidOrder = await createPending(store, '201', 'reconcile-paid-request')
  const paidFact = normalizeVerifiedWechatQueryFact(
    queryResult(paidOrder.orderNo, 2, 'WXORDERPAID201', 'WXPAYPAID201'),
    paidOrder,
    { now: () => NOW }
  )
  const forgedOrder = await createPending(store, '198', 'reconcile-forged-summary')
  const forgedFact = normalizeVerifiedWechatQueryFact(
    queryResult(forgedOrder.orderNo, 2, 'WXORDERFORGED198', 'WXPAYFORGED198'),
    forgedOrder,
    { now: () => NOW }
  )
  const forgedPayloadHash = Buffer.alloc(32, 0x7f)
  await assert.rejects(
    () => store.reconcileVerifiedWechatQuery('198', forgedOrder.orderNo, {
      ...forgedFact,
      payloadHash: forgedPayloadHash,
      eventKey: `wechat_query:${forgedPayloadHash.toString('hex')}`
    }, TRUSTED_CONTEXT),
    (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
  )
  assert.equal((await store.findByUserAndOrderNo('198', forgedOrder.orderNo)).paymentStatus, 'pending')
  const [[forgedEventCount]] = await pool.execute(
    'SELECT COUNT(*) AS event_count FROM virtual_payment_events WHERE order_no = ?',
    [forgedOrder.orderNo]
  )
  assert.equal(Number(forgedEventCount.event_count), 0)
  const concurrent = await Promise.all([
    store.reconcileVerifiedWechatQuery('201', paidOrder.orderNo, paidFact, TRUSTED_CONTEXT),
    store.reconcileVerifiedWechatQuery('201', paidOrder.orderNo, paidFact, TRUSTED_CONTEXT)
  ])
  assert(concurrent.every((result) => result.order.paymentStatus === 'paid'))
  assert.equal(concurrent.filter((result) => result.stateChanged).length, 1)
  assert.equal(concurrent.filter((result) => result.eventDuplicate).length, 1)
  const [[paidEvent]] = await pool.execute(
    `SELECT COUNT(*) AS event_count, MAX(received_count) AS received_count,
            MAX(event_type) AS event_type, MAX(processing_status) AS processing_status
     FROM virtual_payment_events WHERE event_key = ?`,
    [paidFact.eventKey]
  )
  assert.equal(Number(paidEvent.event_count), 1)
  assert.equal(Number(paidEvent.received_count), 2)
  assert.equal(paidEvent.event_type, 'wechat_query_status_2_paid')
  assert.equal(paidEvent.processing_status, 'processed')
  const [[storedPaidEvent]] = await pool.execute(
    'SELECT event_key, payload_hash FROM virtual_payment_events WHERE order_no = ? LIMIT 1',
    [paidOrder.orderNo]
  )
  const independentCanonical = createWechatQueryCanonicalFact({
    source: paidFact.source,
    environment: paidFact.environment,
    wechatEnv: paidFact.wechatEnv,
    orderNo: paidFact.orderNo,
    providerOrderId: paidFact.providerOrderId,
    providerTransactionId: paidFact.providerTransactionId,
    wechatStatus: paidFact.wechatStatus,
    meaning: paidFact.meaning,
    targetPaymentStatus: paidFact.targetPaymentStatus,
    orderType: paidFact.orderType,
    orderAmountFen: paidFact.orderAmountFen,
    paidAmountFen: paidFact.paidAmountFen,
    paidAtSeconds: paidFact.paidAtSeconds
  })
  const independentlyHashed = crypto.createHash('sha256').update(independentCanonical.raw, 'utf8').digest()
  assert.deepEqual(storedPaidEvent.payload_hash, independentlyHashed)
  assert.equal(storedPaidEvent.event_key, `wechat_query:${independentlyHashed.toString('hex')}`)
  const persistedPaid = await store.findByUserAndOrderNo('201', paidOrder.orderNo)
  assert.equal(Object.hasOwn(persistedPaid, 'orderType'), false)
  assert.equal(persistedPaid.paidAmountFen, 3000)
  assert.equal(persistedPaid.providerOrderId, 'WXORDERPAID201')
  assert.equal(persistedPaid.providerTransactionId, 'WXPAYPAID201')
  assert.equal(await store.findTrustedWechatQueryPaidEvidence('201', paidOrder.orderNo), true)

  const historyOrder = await createPending(store, '220', 'reconcile-confirming-paid-history')
  const historyConfirmingFact = normalizeVerifiedWechatQueryFact(
    queryResult(historyOrder.orderNo, 1, 'WXORDERHISTORY220'),
    historyOrder,
    { now: () => NOW }
  )
  await store.reconcileVerifiedWechatQuery('220', historyOrder.orderNo, historyConfirmingFact, TRUSTED_CONTEXT)
  const historyPaidFact = normalizeVerifiedWechatQueryFact(
    queryResult(historyOrder.orderNo, 2, 'WXORDERHISTORY220', 'WXPAYHISTORY220'),
    historyOrder,
    { now: () => NOW }
  )
  await store.reconcileVerifiedWechatQuery('220', historyOrder.orderNo, historyPaidFact, TRUSTED_CONTEXT)
  assert.equal(await store.findTrustedWechatQueryPaidEvidence('220', historyOrder.orderNo), true)
  const [[historyCount]] = await pool.execute(
    'SELECT COUNT(*) AS event_count FROM virtual_payment_events WHERE order_no = ?',
    [historyOrder.orderNo]
  )
  assert.equal(Number(historyCount.event_count), 2)

  for (const [status, userId] of [[3, '221'], [4, '222']]) {
    const statusHistoryOrder = await createPending(store, userId, `reconcile-confirming-status-${status}`)
    const statusConfirmingFact = normalizeVerifiedWechatQueryFact(
      queryResult(statusHistoryOrder.orderNo, 1, `WXORDERHISTORY${userId}`),
      statusHistoryOrder,
      { now: () => NOW }
    )
    await store.reconcileVerifiedWechatQuery(userId, statusHistoryOrder.orderNo, statusConfirmingFact, TRUSTED_CONTEXT)
    const statusPaidFact = normalizeVerifiedWechatQueryFact(
      queryResult(statusHistoryOrder.orderNo, status, `WXORDERHISTORY${userId}`, `WXPAYHISTORY${userId}`),
      statusHistoryOrder,
      { now: () => NOW }
    )
    await store.reconcileVerifiedWechatQuery(userId, statusHistoryOrder.orderNo, statusPaidFact, TRUSTED_CONTEXT)
    assert.equal(await store.findTrustedWechatQueryPaidEvidence(userId, statusHistoryOrder.orderNo), true)
  }

  async function createPaidEvidenceOrder(userId, suffix) {
    const candidate = await createPending(store, userId, `evidence-${suffix}`)
    const fact = normalizeVerifiedWechatQueryFact(
      queryResult(candidate.orderNo, 2, `WXORDER${suffix}`, `WXPAY${suffix}`),
      candidate,
      { now: () => NOW }
    )
    await store.reconcileVerifiedWechatQuery(userId, candidate.orderNo, fact, TRUSTED_CONTEXT)
    return store.findByUserAndOrderNo(userId, candidate.orderNo)
  }

  function canonicalForOrder(candidate, status, overrides = {}) {
    const rules = new Map([
      [1, ['order_created', 'confirming', null, null]],
      [2, ['paid_pending_delivery', 'paid', 3000, Math.floor(NOW / 1000)]],
      [3, ['delivering', 'paid', 3000, Math.floor(NOW / 1000)]],
      [4, ['delivered', 'paid', 3000, Math.floor(NOW / 1000)]]
    ])
    const [meaning, targetPaymentStatus, paidAmountFen, paidAtSeconds] = rules.get(status)
    return createWechatQueryCanonicalFact({
      source: 'wechat_query',
      environment: 'sandbox',
      wechatEnv: 1,
      orderNo: candidate.orderNo,
      providerOrderId: candidate.providerOrderId,
      providerTransactionId: status === 1 ? null : candidate.providerTransactionId,
      wechatStatus: status,
      meaning,
      targetPaymentStatus,
      orderType: 0,
      orderAmountFen: 3000,
      paidAmountFen,
      paidAtSeconds,
      ...overrides
    })
  }

  async function insertEvidenceCandidate(candidate, values) {
    await pool.execute(
      `INSERT INTO virtual_payment_events (
         event_key, event_type, order_id, order_no, provider_order_id,
         provider_transaction_id, payload_hash, processing_status,
         received_count, processed_at, attempt_count, last_error_code
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(), 1, NULL)`,
      [
        values.eventKey,
        values.eventType,
        candidate.id,
        candidate.orderNo,
        values.providerOrderId,
        values.providerTransactionId,
        values.payloadHash,
        values.processingStatus || 'processed'
      ]
    )
  }

  const anomalyCases = [
    {
      userId: '301', suffix: 'SIMILAR301',
      create(candidate) {
        const canonical = canonicalForOrder(candidate, 3)
        return { ...canonical, eventType: 'wechat_query_status_3_paid_extra', providerOrderId: candidate.providerOrderId, providerTransactionId: candidate.providerTransactionId }
      }
    },
    {
      userId: '302', suffix: 'FAILED302',
      create(candidate) {
        const canonical = canonicalForOrder(candidate, 1)
        return { ...canonical, eventType: 'wechat_query_status_1_confirming', providerOrderId: candidate.providerOrderId, providerTransactionId: null, processingStatus: 'retryable_failed' }
      }
    },
    {
      userId: '303', suffix: 'PROVIDER303',
      create(candidate) {
        const providerOrderId = 'OTHERPROVIDER303'
        const providerTransactionId = 'OTHERTRANSACTION303'
        const canonical = canonicalForOrder(candidate, 3, { providerOrderId, providerTransactionId })
        return { ...canonical, eventType: 'wechat_query_status_3_paid', providerOrderId, providerTransactionId }
      }
    },
    {
      userId: '304', suffix: 'HASH304',
      create(candidate) {
        const canonical = canonicalForOrder(candidate, 3)
        return { ...canonical, payloadHash: Buffer.alloc(32), eventType: 'wechat_query_status_3_paid', providerOrderId: candidate.providerOrderId, providerTransactionId: candidate.providerTransactionId }
      }
    },
    {
      userId: '305', suffix: 'UNKNOWN305',
      create(candidate) {
        const canonical = canonicalForOrder(candidate, 3)
        return { ...canonical, eventType: 'wechat_query_unknown', providerOrderId: candidate.providerOrderId, providerTransactionId: candidate.providerTransactionId }
      }
    },
    {
      userId: '306', suffix: 'LEGACY306',
      create(candidate) {
        const paidAtSeconds = Math.floor(NOW / 1000)
        const legacyRaw = JSON.stringify({
          source: 'wechat_query', environment: 'sandbox', orderNo: candidate.orderNo,
          providerOrderId: candidate.providerOrderId,
          providerTransactionId: candidate.providerTransactionId,
          wechatStatus: 3, meaning: 'delivering', targetPaymentStatus: 'paid',
          orderFeeFen: 3000, paidAmountFen: 3000, paidAtSeconds
        })
        const payloadHash = crypto.createHash('sha256').update(legacyRaw, 'utf8').digest()
        return {
          eventKey: `wechat_query:${payloadHash.toString('hex')}`,
          payloadHash,
          eventType: 'wechat_query_status_3_paid',
          providerOrderId: candidate.providerOrderId,
          providerTransactionId: candidate.providerTransactionId
        }
      }
    }
  ]
  for (const anomaly of anomalyCases) {
    const candidate = await createPaidEvidenceOrder(anomaly.userId, anomaly.suffix)
    await insertEvidenceCandidate(candidate, anomaly.create(candidate))
    const [[candidateCount]] = await pool.execute(
      'SELECT COUNT(*) AS event_count FROM virtual_payment_events WHERE order_no = ?',
      [candidate.orderNo]
    )
    assert.equal(Number(candidateCount.event_count), 2)
    await assert.rejects(
      () => store.findTrustedWechatQueryPaidEvidence(anomaly.userId, candidate.orderNo),
      (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
    )
  }

  const overLimitCandidate = await createPaidEvidenceOrder('307', 'LIMIT307')
  for (let index = 0; index < 4; index += 1) {
    const payloadHash = crypto.createHash('sha256').update(`limit-${index}`, 'utf8').digest()
    await insertEvidenceCandidate(overLimitCandidate, {
      eventKey: `wechat_query:${payloadHash.toString('hex')}`,
      eventType: `unknown_limit_${index}`,
      providerOrderId: overLimitCandidate.providerOrderId,
      providerTransactionId: overLimitCandidate.providerTransactionId,
      payloadHash
    })
  }
  const [[overLimitCount]] = await pool.execute(
    'SELECT COUNT(*) AS event_count FROM virtual_payment_events WHERE order_no = ?',
    [overLimitCandidate.orderNo]
  )
  assert.equal(Number(overLimitCount.event_count), 5)
  await assert.rejects(
    () => store.findTrustedWechatQueryPaidEvidence('307', overLimitCandidate.orderNo),
    (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
  )

  let paidFastPathExternalCalls = 0
  const paidFastPathService = createVirtualPaymentService({
    env: enabledEnv(),
    now: () => NOW,
    store,
    paymentSessionService: {
      async exchangeAndVerifyPaymentSession() {
        paidFastPathExternalCalls += 1
        throw new Error('paid fast path must not exchange session')
      }
    },
    signingService: { createPaymentParameters() { throw new Error('not used') } },
    virtualPaymentClient: {
      async queryOrder() {
        paidFastPathExternalCalls += 1
        throw new Error('paid fast path must not query WeChat')
      }
    }
  })
  assert.equal((await paidFastPathService.reconcileOwnedOrder({
    authenticatedUserId: '201',
    orderNo: paidOrder.orderNo,
    loginCode: 'fresh-code'
  })).paymentStatus, 'paid')
  assert.equal(paidFastPathExternalCalls, 0)

  for (const status of [2, 3, 4]) {
    const incompleteOrder = await createPending(store, String(210 + status), `missing-transaction-${status}`)
    assert.throws(
      () => normalizeVerifiedWechatQueryFact(
        queryResult(incompleteOrder.orderNo, status, `WXORDERMISSING${status}`, null),
        incompleteOrder,
        { now: () => NOW }
      ),
      (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
    )
    assert.equal((await store.findByUserAndOrderNo(String(210 + status), incompleteOrder.orderNo)).paymentStatus, 'pending')
    const [[missingEvent]] = await pool.execute(
      'SELECT COUNT(*) AS event_count FROM virtual_payment_events WHERE order_no = ?',
      [incompleteOrder.orderNo]
    )
    assert.equal(Number(missingEvent.event_count), 0)
  }

  const missingEvidencePaidOrder = await createPending(store, '206', 'missing-paid-evidence')
  await pool.execute(
    `UPDATE virtual_payment_orders
     SET payment_status = 'paid', paid_amount_fen = 3000, paid_at = ?,
         provider_order_id = ?, provider_transaction_id = ?, version = version + 1
     WHERE user_id = ? AND order_no = ?`,
    [new Date(NOW - 60_000), 'WXORDERMISSING206', 'WXPAYMISSING206', '206', missingEvidencePaidOrder.orderNo]
  )
  await assert.rejects(
    () => paidFastPathService.reconcileOwnedOrder({
      authenticatedUserId: '206',
      orderNo: missingEvidencePaidOrder.orderNo,
      loginCode: 'fresh-code'
    }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )
  assert.equal(await store.findTrustedWechatQueryPaidEvidence('206', missingEvidencePaidOrder.orderNo), false)
  const confirmingEvidence = createWechatQueryCanonicalFact({
    source: 'wechat_query',
    environment: 'sandbox',
    wechatEnv: 1,
    orderNo: missingEvidencePaidOrder.orderNo,
    providerOrderId: 'WXORDERMISSING206',
    providerTransactionId: null,
    wechatStatus: 1,
    meaning: 'order_created',
    targetPaymentStatus: 'confirming',
    orderType: 0,
    orderAmountFen: 3000,
    paidAmountFen: null,
    paidAtSeconds: null
  })
  await pool.execute(
    `INSERT INTO virtual_payment_events (
       event_key, event_type, order_id, order_no, provider_order_id,
       provider_transaction_id, payload_hash, processing_status,
       received_count, processed_at, attempt_count
     ) SELECT ?, 'wechat_query_status_1_confirming', id, order_no,
              provider_order_id, NULL, ?, 'processed', 1, UTC_TIMESTAMP(), 1
       FROM virtual_payment_orders WHERE user_id = ? AND order_no = ?`,
    [
      confirmingEvidence.eventKey,
      confirmingEvidence.payloadHash,
      '206',
      missingEvidencePaidOrder.orderNo
    ]
  )
  assert.equal(await store.findTrustedWechatQueryPaidEvidence('206', missingEvidencePaidOrder.orderNo), false)
  await assert.rejects(
    () => paidFastPathService.reconcileOwnedOrder({
      authenticatedUserId: '206',
      orderNo: missingEvidencePaidOrder.orderNo,
      loginCode: 'fresh-code'
    }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )

  const damagedPaidOrder = await createPending(store, '208', 'damaged-paid-fast-path')
  await pool.execute(
    "UPDATE virtual_payment_orders SET payment_status = 'paid' WHERE user_id = ? AND order_no = ?",
    ['208', damagedPaidOrder.orderNo]
  )
  await assert.rejects(
    () => paidFastPathService.reconcileOwnedOrder({
      authenticatedUserId: '208',
      orderNo: damagedPaidOrder.orderNo,
      loginCode: 'fresh-code'
    }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )
  assert.equal(paidFastPathExternalCalls, 0)

  const confirmingOrder = await createPending(store, '202', 'reconcile-confirming-request')
  const confirmingFact = normalizeVerifiedWechatQueryFact(
    queryResult(confirmingOrder.orderNo, 1, 'WXORDERCONFIRM202'),
    confirmingOrder,
    { now: () => NOW }
  )
  assert.equal(
    (await store.reconcileVerifiedWechatQuery('202', confirmingOrder.orderNo, confirmingFact, TRUSTED_CONTEXT)).order.paymentStatus,
    'confirming'
  )

  const closedOrder = await createPending(store, '203', 'reconcile-closed-request')
  const closedFact = normalizeVerifiedWechatQueryFact(
    queryResult(closedOrder.orderNo, 6, 'WXORDERCLOSED203'),
    closedOrder,
    { now: () => NOW }
  )
  assert.equal(
    (await store.reconcileVerifiedWechatQuery('203', closedOrder.orderNo, closedFact, TRUSTED_CONTEXT)).order.paymentStatus,
    'closed'
  )
  const invalidTerminalFact = normalizeVerifiedWechatQueryFact(
    queryResult(closedOrder.orderNo, 2, 'WXORDERCLOSED203', 'WXPAYCLOSED203'),
    closedOrder,
    { now: () => NOW }
  )
  await assert.rejects(
    () => store.reconcileVerifiedWechatQuery('203', closedOrder.orderNo, invalidTerminalFact, TRUSTED_CONTEXT),
    (error) => error.code === 'PAYMENT_ORDER_NOT_RECONCILABLE'
  )
  assert.equal((await store.findByUserAndOrderNo('203', closedOrder.orderNo)).paymentStatus, 'closed')

  const conflictOrder = await createPending(store, '204', 'reconcile-provider-conflict')
  const conflictingFact = normalizeVerifiedWechatQueryFact(
    queryResult(conflictOrder.orderNo, 2, 'WXORDERPAID201', 'WXPAYCONFLICT204'),
    conflictOrder,
    { now: () => NOW }
  )
  await assert.rejects(
    () => store.reconcileVerifiedWechatQuery('204', conflictOrder.orderNo, conflictingFact, TRUSTED_CONTEXT),
    (error) => error.code === 'PAYMENT_SERVICE_UNAVAILABLE'
  )
  assert.equal((await store.findByUserAndOrderNo('204', conflictOrder.orderNo)).paymentStatus, 'pending')
  const [[rolledBackEvent]] = await pool.execute(
    'SELECT COUNT(*) AS event_count FROM virtual_payment_events WHERE order_no = ?',
    [conflictOrder.orderNo]
  )
  assert.equal(Number(rolledBackEvent.event_count), 0)

  const amountOrder = await createPending(store, '205', 'reconcile-amount-mismatch')
  assert.throws(
    () => normalizeVerifiedWechatQueryFact(
      queryResult(amountOrder.orderNo, 2, 'WXORDERAMOUNT205', 'WXPAYAMOUNT205', { paidFeeFen: 2999 }),
      amountOrder,
      { now: () => NOW }
    ),
    (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
  )
  assert.equal((await store.findByUserAndOrderNo('205', amountOrder.orderNo)).paymentStatus, 'pending')

  const productRaceOrder = await createPending(store, '207', 'reconcile-product-race')
  const productRaceFact = normalizeVerifiedWechatQueryFact(
    queryResult(productRaceOrder.orderNo, 2, 'WXORDERPRODUCT207', 'WXPAYPRODUCT207'),
    productRaceOrder,
    { now: () => NOW }
  )
  await pool.execute(
    'UPDATE virtual_payment_orders SET product_id = ? WHERE user_id = ? AND order_no = ?',
    ['changed-product-after-query', '207', productRaceOrder.orderNo]
  )
  await assert.rejects(
    () => store.reconcileVerifiedWechatQuery('207', productRaceOrder.orderNo, productRaceFact, TRUSTED_CONTEXT),
    (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
  )
  const productRacePersisted = await store.findByUserAndOrderNo('207', productRaceOrder.orderNo)
  assert.equal(productRacePersisted.paymentStatus, 'pending')
  assert.equal(productRacePersisted.productId, 'changed-product-after-query')
  const [[productRaceEvent]] = await pool.execute(
    'SELECT COUNT(*) AS event_count FROM virtual_payment_events WHERE order_no = ?',
    [productRaceOrder.orderNo]
  )
  assert.equal(Number(productRaceEvent.event_count), 0)

  const [sensitiveColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('virtual_payment_orders', 'virtual_payment_events')
       AND COLUMN_NAME IN ('login_code', 'session_key', 'app_key', 'app_secret', 'access_token', 'pay_sig', 'signature', 'openid')`
  )
  assert.deepEqual(sensitiveColumns, [])
}

export async function runVirtualPaymentReconciliationMysqlIntegration(env = process.env) {
  const config = readConfig(env)
  const databaseName = `virtual_payment_reconcile_test_${crypto.randomBytes(6).toString('hex')}`
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
    { phase: 'close_reconciliation_pool', run: async () => { if (pool) await pool.end() } },
    { phase: 'close_reconciliation_migration_connection', run: async () => { if (migrationConnection) await migrationConnection.end() } },
    {
      phase: 'drop_reconciliation_database',
      run: async () => {
        if (!databaseOwned) return
        assert.equal(config.host, EXPECTED_HOST)
        assert.equal(config.port, EXPECTED_PORT)
        assert.equal(config.confirmation, EXPECTED_CONFIRMATION)
        await rootConnection.query(`DROP DATABASE IF EXISTS ${quoteDatabase(databaseName)}`)
      }
    },
    { phase: 'verify_reconciliation_database_absent', run: async () => assertDatabaseAbsent(rootConnection, databaseName) },
    { phase: 'close_reconciliation_root_connection', run: async () => rootConnection.end() }
  ]

  await runWithGuaranteedCleanup({
    secretValues: [config.password],
    cleanupSteps,
    runMain: async () => {
      const [[versionRow]] = await rootConnection.query('SELECT VERSION() AS mysql_version')
      assert.equal(versionRow.mysql_version, EXPECTED_VERSION)
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
        connectionLimit: 6
      })
      await testReconciliation(pool)
    }
  })
}

const isMainModule = Boolean(
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
if (isMainModule) {
  await runVirtualPaymentReconciliationMysqlIntegration()
  console.log('Virtual payment reconciliation isolated MySQL tests passed with no database residue.')
}
