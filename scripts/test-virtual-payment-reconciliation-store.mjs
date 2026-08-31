import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { normalizeVerifiedWechatQueryFact } from '../server/virtual-payment-reconciliation.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-08-31T00:00:00.000Z')
const TRUSTED_CONTEXT = Object.freeze({ expectedProductId: 'sandbox-product' })

function row(overrides = {}) {
  return {
    id: 1,
    order_no: ORDER_NO,
    user_id: 42,
    client_request_id: 'request-12345678',
    internal_sku: 'membership_30d',
    product_id: 'sandbox-product',
    product_name: '30天学习会员',
    quantity: 1,
    unit_price_fen: 3000,
    order_amount_fen: 3000,
    paid_amount_fen: null,
    currency: 'CNY',
    environment: 'sandbox',
    wechat_env: 1,
    payment_channel: 'wechat_virtual_payment',
    client_platform: 'android',
    provider_order_id: null,
    provider_transaction_id: null,
    payment_status: 'pending',
    entitlement_status: 'not_ready',
    delivery_status: 'not_ready',
    client_result: null,
    membership_grant_id: null,
    entitlement_transaction_id: null,
    paid_at: null,
    entitlement_granted_at: null,
    delivered_at: null,
    last_queried_at: null,
    next_retry_at: null,
    retry_count: 0,
    last_error_code: null,
    version: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  }
}

function normalizedOrder(source) {
  return {
    orderNo: source.order_no,
    internalSku: source.internal_sku,
    productName: source.product_name,
    quantity: source.quantity,
    unitPriceFen: source.unit_price_fen,
    orderAmountFen: source.order_amount_fen,
    currency: source.currency,
    environment: source.environment,
    wechatEnv: source.wechat_env,
    paymentChannel: source.payment_channel
  }
}

function queryResult(status = 2) {
  const paid = [2, 3, 4].includes(status)
  return {
    orderId: ORDER_NO,
    wechatOrderId: 'WXORDER123456789',
    wechatPaymentOrderId: paid ? 'WXPAY123456789' : null,
    status,
    orderType: 0,
    orderFeeFen: 3000,
    paidFeeFen: paid ? 3000 : null,
    paidAtSeconds: paid ? Math.floor(NOW.getTime() / 1000) : null,
    providedAtSeconds: null,
    environmentType: 2,
    environment: 'sandbox'
  }
}

function createTransactionHarness(options = {}) {
  let orderRow = row(options.order)
  const eventRows = []
  const calls = []
  const counters = { connections: 0, executes: 0, begin: 0, commit: 0, rollback: 0, release: 0, orderUpdates: 0, eventInserts: 0, eventUpdates: 0 }
  const connection = {
    async beginTransaction() {
      counters.begin += 1
      calls.push('begin')
      if (options.beginError) throw options.beginError
    },
    async commit() {
      counters.commit += 1
      calls.push('commit')
      if (options.commitError) throw options.commitError
    },
    async rollback() {
      counters.rollback += 1
      calls.push('rollback')
      if (options.rollbackError) throw options.rollbackError
    },
    async release() {
      counters.release += 1
      calls.push('release')
      if (options.releaseError) throw options.releaseError
    },
    async execute(sql, params) {
      counters.executes += 1
      calls.push(sql.replace(/\s+/g, ' ').trim())
      if (options.operationError && sql.includes('FROM virtual_payment_orders')) throw options.operationError
      if (sql.includes('FROM virtual_payment_orders') && sql.includes('FOR UPDATE')) {
        return [[String(orderRow.user_id) === String(params[0]) && orderRow.order_no === params[1] ? { ...orderRow } : null].filter(Boolean)]
      }
      if (sql.includes('INNER JOIN virtual_payment_orders')) {
        if (options.evidenceError) throw options.evidenceError
        if (
          String(orderRow.user_id) !== String(params[0]) ||
          orderRow.order_no !== params[1] ||
          orderRow.payment_status !== 'paid'
        ) return [[]]
        return [eventRows
          .filter((eventRow) => (
            String(eventRow.order_id) === String(orderRow.id) ||
            eventRow.order_no === orderRow.order_no
          ))
          .slice(0, 5)
          .map((eventRow) => ({
            ...eventRow,
            linked_order_id: orderRow.id,
            linked_order_no: orderRow.order_no,
            linked_provider_order_id: orderRow.provider_order_id,
            linked_provider_transaction_id: orderRow.provider_transaction_id,
            order_amount_fen: orderRow.order_amount_fen,
            paid_amount_fen: orderRow.paid_amount_fen,
            paid_at: orderRow.paid_at,
            environment: orderRow.environment,
            wechat_env: orderRow.wechat_env
          }))]
      }
      if (sql.includes('FROM virtual_payment_events')) {
        return [eventRows.filter((eventRow) => eventRow.event_key === params[0]).map((eventRow) => ({ ...eventRow }))]
      }
      if (sql.startsWith('INSERT INTO virtual_payment_events')) {
        counters.eventInserts += 1
        if (options.eventInsertError) throw options.eventInsertError
        eventRows.push({
          id: 7,
          event_key: params[0],
          event_type: params[1],
          order_id: params[2],
          order_no: params[3],
          provider_order_id: params[4],
          provider_transaction_id: params[5],
          payload_hash: Buffer.from(params[6]),
          processing_status: 'processed',
          received_count: 1,
          processed_at: NOW,
          attempt_count: 1,
          last_error_code: null
        })
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('UPDATE virtual_payment_events')) {
        counters.eventUpdates += 1
        const eventRow = eventRows.find((candidate) => String(candidate.id) === String(params[0]) && candidate.event_key === params[1])
        eventRow.received_count += 1
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('UPDATE virtual_payment_orders')) {
        counters.orderUpdates += 1
        if (options.orderUpdateError) throw options.orderUpdateError
        if (options.orderUpdateAffectedRows === 0) return [{ affectedRows: 0 }]
        orderRow = {
          ...orderRow,
          payment_status: params[0],
          provider_order_id: orderRow.provider_order_id || params[1],
          provider_transaction_id: orderRow.provider_transaction_id || params[2],
          paid_amount_fen: orderRow.paid_amount_fen ?? params[3],
          paid_at: orderRow.paid_at || params[4],
          last_queried_at: NOW,
          last_error_code: null,
          version: orderRow.version + 1,
          updated_at: NOW
        }
        return [{ affectedRows: 1 }]
      }
      throw new Error('unexpected fake SQL')
    }
  }
  return {
    calls,
    counters,
    getOrder: () => orderRow,
    getEvent: () => eventRows[eventRows.length - 1] || null,
    getEvents: () => eventRows,
    store: createVirtualPaymentStore({
      pool: {
        async getConnection() {
          counters.connections += 1
          if (options.connectionError) throw options.connectionError
          return connection
        }
      }
    })
  }
}

const paidFact = normalizeVerifiedWechatQueryFact(queryResult(2), normalizedOrder(row()), {
  now: () => NOW.getTime()
})
const harness = createTransactionHarness()
const first = await harness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
assert.equal(first.order.paymentStatus, 'paid')
assert.equal(first.order.paidAmountFen, 3000)
assert.equal(first.eventDuplicate, false)
assert.equal(first.stateChanged, true)
assert.deepEqual(harness.counters, {
  connections: 1, executes: 5, begin: 1, commit: 1, rollback: 0, release: 1, orderUpdates: 1, eventInserts: 1, eventUpdates: 0
})
assert.equal(harness.getEvent().payload_hash.length, 32)
assert.equal(Object.hasOwn(first.order, 'orderType'), false)
assert.equal(await harness.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO), true)
assert.equal(await harness.store.findTrustedWechatQueryPaidEvidence('43', ORDER_NO), false)
const evidenceSql = harness.calls.find((call) => call.includes('INNER JOIN virtual_payment_orders'))
const evidenceWhere = evidenceSql.slice(evidenceSql.indexOf(' WHERE '))
assert.equal(evidenceWhere.includes('event_type'), false)
assert.equal(evidenceWhere.includes('processing_status'), false)
assert.equal(evidenceWhere.includes('provider_order_id'), false)
assert.equal(evidenceWhere.includes('provider_transaction_id'), false)

const repeated = await harness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
assert.equal(repeated.order.paymentStatus, 'paid')
assert.equal(repeated.eventDuplicate, true)
assert.equal(repeated.stateChanged, false)
assert.equal(harness.counters.orderUpdates, 1)
assert.equal(harness.counters.eventInserts, 1)
assert.equal(harness.counters.eventUpdates, 1)
assert.equal(harness.getEvent().received_count, 2)

for (const status of [3, 4]) {
  const paidStatusHarness = createTransactionHarness()
  const statusFact = normalizeVerifiedWechatQueryFact(queryResult(status), normalizedOrder(row()), {
    now: () => NOW.getTime()
  })
  await paidStatusHarness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, statusFact, TRUSTED_CONTEXT)
  assert.equal(await paidStatusHarness.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO), true)
}

for (const status of [2, 3, 4]) {
  const historyHarness = createTransactionHarness()
  const confirmingFact = normalizeVerifiedWechatQueryFact(queryResult(1), normalizedOrder(row()), {
    now: () => NOW.getTime()
  })
  await historyHarness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, confirmingFact, TRUSTED_CONTEXT)
  const paidStatusFact = normalizeVerifiedWechatQueryFact(queryResult(status), normalizedOrder(row()), {
    now: () => NOW.getTime()
  })
  await historyHarness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidStatusFact, TRUSTED_CONTEXT)
  assert.equal(historyHarness.getEvents().length, 2)
  assert.equal(await historyHarness.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO), true)
}

const confirmingOnly = createTransactionHarness()
const confirmingOnlyFact = normalizeVerifiedWechatQueryFact(queryResult(1), normalizedOrder(row()), {
  now: () => NOW.getTime()
})
await confirmingOnly.store.reconcileVerifiedWechatQuery('42', ORDER_NO, confirmingOnlyFact, TRUSTED_CONTEXT)
Object.assign(confirmingOnly.getOrder(), {
  payment_status: 'paid',
  provider_transaction_id: 'WXPAY123456789',
  paid_amount_fen: 3000,
  paid_at: NOW
})
assert.equal(await confirmingOnly.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO), false)

function createPaidWithExtraEvent(mutator) {
  const candidate = createTransactionHarness()
  return candidate.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
    .then(() => {
      const extra = {
        ...candidate.getEvent(),
        id: 99,
        event_key: `wechat_query:${'b'.repeat(64)}`,
        payload_hash: Buffer.from(candidate.getEvent().payload_hash)
      }
      mutator(extra, candidate)
      candidate.getEvents().push(extra)
      return candidate
    })
}

const oldCanonicalRaw = JSON.stringify({
  source: 'wechat_query',
  environment: 'sandbox',
  orderNo: ORDER_NO,
  providerOrderId: 'WXORDER123456789',
  providerTransactionId: 'WXPAY123456789',
  wechatStatus: 2,
  meaning: 'paid_pending_delivery',
  targetPaymentStatus: 'paid',
  orderFeeFen: 3000,
  paidAmountFen: 3000,
  paidAtSeconds: Math.floor(NOW.getTime() / 1000)
})
const oldCanonicalHash = crypto.createHash('sha256').update(oldCanonicalRaw, 'utf8').digest()
for (const mutate of [
  (extra) => { extra.event_type = 'wechat_query_status_2_paid_extra' },
  (extra) => { extra.event_type = 'prefix_wechat_query_status_2_paid' },
  (extra) => { extra.processing_status = 'retryable_failed' },
  (extra) => { extra.provider_order_id = 'OTHERPROVIDER' },
  (extra) => { extra.payload_hash = Buffer.alloc(32) },
  (extra) => { extra.event_key = `wechat_query:${'c'.repeat(64)}` },
  (extra) => { extra.event_type = 'wechat_query_status_6_closed' },
  (extra) => { extra.event_type = 'wechat_query_status_5_refunded' },
  (extra) => { extra.event_type = 'unknown' },
  (extra) => { extra.order_id = 999 },
  (extra) => {
    extra.payload_hash = oldCanonicalHash
    extra.event_key = `wechat_query:${oldCanonicalHash.toString('hex')}`
  }
]) {
  const corruptedHistory = await createPaidWithExtraEvent(mutate)
  await assert.rejects(
    () => corruptedHistory.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO),
    (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
  )
}

const overLimitHistory = createTransactionHarness()
await overLimitHistory.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
while (overLimitHistory.getEvents().length < 5) {
  overLimitHistory.getEvents().push({
    ...overLimitHistory.getEvent(),
    id: 100 + overLimitHistory.getEvents().length,
    event_key: `wechat_query:${String(overLimitHistory.getEvents().length).padStart(64, 'd')}`
  })
}
await assert.rejects(
  () => overLimitHistory.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)

for (const eventType of [
  'wechat_query_status_1_confirming',
  'wechat_query_status_6_closed',
  'wechat_query_status_5_refunded',
  'wechat_query_status_2_paid_extra',
  'prefix_wechat_query_status_2_paid',
  'unknown_paid'
]) {
  const untrusted = createTransactionHarness()
  await untrusted.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
  untrusted.getEvent().event_type = eventType
  await assert.rejects(
    () => untrusted.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO),
    (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
  )
}

const malformedEvidence = createTransactionHarness()
await malformedEvidence.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
malformedEvidence.getEvent().payload_hash = Buffer.alloc(32)
await assert.rejects(
  () => malformedEvidence.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)

const otherOrderEvidence = createTransactionHarness()
await otherOrderEvidence.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
otherOrderEvidence.getEvent().order_id = 99
await assert.rejects(
  () => otherOrderEvidence.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)

const evidenceFailure = createTransactionHarness({ evidenceError: new Error('EVENT SQL HOST PASSWORD PROVIDER SENTINEL') })
await evidenceFailure.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT)
await assert.rejects(
  () => evidenceFailure.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO),
  (error) => {
    const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}\n${String(error.cause)}\n${String(error.details)}`
    return error.code === 'PAYMENT_SERVICE_UNAVAILABLE' &&
      !/EVENT|SQL|HOST|PASSWORD|PROVIDER|SENTINEL/.test(exposed)
  }
)

for (const [status, target] of [[1, 'confirming'], [6, 'closed']]) {
  const statusHarness = createTransactionHarness()
  const fact = normalizeVerifiedWechatQueryFact(queryResult(status), normalizedOrder(row()), {
    now: () => NOW.getTime()
  })
  const result = await statusHarness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, fact, TRUSTED_CONTEXT)
  assert.equal(result.order.paymentStatus, target)
}

for (const forbidden of [
  { payment_status: 'initializing' },
  { payment_status: 'failed' },
  { payment_status: 'closed' },
  { entitlement_status: 'pending', payment_status: 'paid' },
  { membership_grant_id: 9, payment_status: 'paid' }
]) {
  const blocked = createTransactionHarness({ order: forbidden })
  await assert.rejects(
    () => blocked.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT),
    (error) => error.code === 'PAYMENT_ORDER_NOT_RECONCILABLE'
  )
  assert.equal(blocked.counters.orderUpdates, 0)
  assert.equal(blocked.counters.eventInserts, 0)
  assert.equal(blocked.counters.rollback, 1)
  assert.equal(blocked.counters.release, 1)
}

const conflict = createTransactionHarness({ order: { provider_order_id: 'OTHERPROVIDER' } })
await assert.rejects(
  () => conflict.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)
assert.equal(conflict.counters.eventInserts, 0)

const productRace = createTransactionHarness({ order: { product_id: 'CHANGED_PRODUCT_SENTINEL' } })
await assert.rejects(
  () => productRace.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT),
  (error) => {
    const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}\n${String(error.cause)}\n${String(error.details)}`
    return error.code === 'PAYMENT_ORDER_CONFLICT' && !exposed.includes('CHANGED_PRODUCT_SENTINEL')
  }
)
assert.equal(productRace.counters.orderUpdates, 0)
assert.equal(productRace.counters.eventInserts, 0)
assert.equal(productRace.counters.eventUpdates, 0)
assert.equal(productRace.counters.rollback, 1)
assert.equal(productRace.counters.release, 1)

const incompleteFactHarness = createTransactionHarness()
await assert.rejects(
  () => incompleteFactHarness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, {
    ...paidFact,
    providerTransactionId: null
  }, TRUSTED_CONTEXT),
  (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
)
assert.equal(incompleteFactHarness.counters.begin, 0)
assert.equal(incompleteFactHarness.counters.eventInserts, 0)

for (const invalidOrderType of [undefined, null, '0', false, 0.5, 1, {}, []]) {
  const invalidFactHarness = createTransactionHarness()
  const candidate = { ...paidFact, orderType: invalidOrderType }
  if (invalidOrderType === undefined) delete candidate.orderType
  await assert.rejects(
    () => invalidFactHarness.store.reconcileVerifiedWechatQuery('42', ORDER_NO, candidate, TRUSTED_CONTEXT),
    (error) => error.code === 'PAYMENT_QUERY_RESULT_INVALID'
  )
  assert.equal(invalidFactHarness.counters.begin, 0)
  assert.equal(invalidFactHarness.counters.connections, 0)
  assert.equal(invalidFactHarness.counters.executes, 0)
  assert.equal(invalidFactHarness.counters.eventInserts, 0)
  assert.equal(invalidFactHarness.counters.orderUpdates, 0)
}

const forgedHash = Buffer.alloc(32, 0x7f)
const factAttacks = [
  { payloadHash: forgedHash, eventKey: `wechat_query:${forgedHash.toString('hex')}` },
  { orderType: 1 },
  { orderNo: 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' },
  { providerOrderId: 'OTHERPROVIDER' },
  { providerTransactionId: 'OTHERTRANSACTION' },
  { wechatStatus: 3 },
  { meaning: 'delivering' },
  { targetPaymentStatus: 'confirming' },
  { environment: 'production' },
  { wechatEnv: 2 },
  { orderAmountFen: 2999 },
  { paidAmountFen: 2999 },
  { paidAtSeconds: paidFact.paidAtSeconds - 1 },
  { eventKey: `wechat_query:${'a'.repeat(64)}` },
  { payloadHash: Buffer.alloc(32, 1) },
  { payloadHash: Buffer.alloc(31) },
  { payloadHash: Buffer.alloc(33) },
  { eventKey: paidFact.eventKey.toUpperCase() },
  { eventKey: ` ${paidFact.eventKey}` },
  { eventKey: `${paidFact.eventKey} ` }
]
for (const mutation of factAttacks) {
  const attackHarness = createTransactionHarness()
  await assert.rejects(
    () => attackHarness.store.reconcileVerifiedWechatQuery(
      '42',
      ORDER_NO,
      { ...paidFact, ...mutation },
      TRUSTED_CONTEXT
    ),
    (error) => {
      const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}\n${String(error.cause)}\n${String(error.details)}`
      return error.code === 'PAYMENT_QUERY_RESULT_INVALID' &&
        !/OTHERPROVIDER|OTHERTRANSACTION|wechat_query:|7f7f7f|SELECT|INSERT|UPDATE/.test(exposed)
    }
  )
  assert.equal(attackHarness.counters.connections, 0)
  assert.equal(attackHarness.counters.begin, 0)
  assert.equal(attackHarness.counters.executes, 0)
  assert.equal(attackHarness.counters.eventInserts, 0)
  assert.equal(attackHarness.counters.orderUpdates, 0)
}

const mutablePayloadHarness = createTransactionHarness()
const mutablePayload = Buffer.from(paidFact.payloadHash)
const mutableFactPromise = mutablePayloadHarness.store.reconcileVerifiedWechatQuery(
  '42',
  ORDER_NO,
  { ...paidFact, payloadHash: mutablePayload },
  TRUSTED_CONTEXT
)
mutablePayload.fill(0)
await mutableFactPromise
assert.deepEqual(mutablePayloadHarness.getEvent().payload_hash, paidFact.payloadHash)
assert.notDeepEqual(mutablePayloadHarness.getEvent().payload_hash, mutablePayload)

const sentinel = 'SQL OPENID PASSWORD HOST ORDER_SENTINEL'
for (const failureOptions of [
  { connectionError: new Error(sentinel) },
  { beginError: new Error(sentinel) },
  { operationError: new Error(sentinel) },
  { orderUpdateError: new Error(sentinel) },
  { commitError: new Error(sentinel) },
  { orderUpdateError: new Error(sentinel), rollbackError: new Error(sentinel) },
  { releaseError: new Error(sentinel) }
]) {
  const failed = createTransactionHarness(failureOptions)
  await assert.rejects(
    () => failed.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT),
    (error) => {
      const serialized = `${error.message}\n${error.stack}\n${JSON.stringify(error)}\n${String(error.cause)}\n${String(error.details)}`
      return error.code === 'PAYMENT_SERVICE_UNAVAILABLE' && !serialized.includes(sentinel)
    }
  )
  assert(failed.counters.release <= 1)
}

const conditionalFailure = createTransactionHarness({ orderUpdateAffectedRows: 0 })
await assert.rejects(
  () => conditionalFailure.store.reconcileVerifiedWechatQuery('42', ORDER_NO, paidFact, TRUSTED_CONTEXT),
  (error) => error.code === 'PAYMENT_SERVICE_UNAVAILABLE'
)
assert.equal(conditionalFailure.counters.rollback, 1)
assert.equal(conditionalFailure.counters.release, 1)

console.log('virtual payment reconciliation store tests passed')
