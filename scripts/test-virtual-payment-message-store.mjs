import assert from 'node:assert/strict'

import { readDeliverySchemaContract } from '../server/virtual-payment-delivery-schema.mjs'
import {
  createWechatGoodsDeliveryCanonicalFact,
  normalizeWechatGoodsDeliveryMessage
} from '../server/virtual-payment-message.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-09-14T08:00:00.000Z')
const PAID_AT = new Date(NOW.getTime() - 10_000)
const PRODUCT_ID = 'sandbox-product'
const schemaContract = new Map((await readDeliverySchemaContract()).map((item) => [item.table, item]))

function orderRow(overrides = {}) {
  return {
    id: 7, order_no: ORDER_NO, user_id: 42, client_request_id: 'message-request-1234',
    internal_sku: 'membership_30d', product_id: PRODUCT_ID, product_name: '30天学习会员',
    quantity: 1, unit_price_fen: 3000, order_amount_fen: 3000, paid_amount_fen: null,
    currency: 'CNY', environment: 'sandbox', wechat_env: 1,
    payment_channel: 'wechat_virtual_payment', client_platform: 'android',
    provider_order_id: null, provider_transaction_id: null, payment_status: 'pending',
    entitlement_status: 'not_ready', delivery_status: 'not_ready', client_result: null,
    membership_grant_id: null, entitlement_transaction_id: null, paid_at: null,
    entitlement_granted_at: null, delivered_at: null, last_queried_at: null,
    next_retry_at: null, retry_count: 0, last_error_code: null, version: 1,
    created_at: new Date(NOW.getTime() - 60_000), updated_at: new Date(NOW.getTime() - 30_000),
    ...overrides
  }
}

function body(transactionId = 'transaction-store-safe') {
  return {
    ToUserName: 'gh_store_original', FromUserName: 'wechat-official-openid',
    CreateTime: Math.floor(NOW.getTime() / 1000), MsgType: 'event',
    Event: 'xpay_goods_deliver_notify', OpenId: 'openid-store-safe', OutTradeNo: ORDER_NO, Env: 1,
    GoodsInfo: { ProductId: PRODUCT_ID, Quantity: 1, Attach: ORDER_NO },
    WeChatPayInfo: { MchOrderNo: 'merchant-store-safe', TransactionId: transactionId, PaidTime: Math.floor(PAID_AT.getTime() / 1000) }
  }
}

function fact(order, transactionId = 'transaction-store-safe') {
  const normalizedOrder = {
    userId: String(order.user_id), orderNo: order.order_no, internalSku: order.internal_sku,
    productId: order.product_id, productName: order.product_name, quantity: order.quantity,
    unitPriceFen: order.unit_price_fen, orderAmountFen: order.order_amount_fen,
    currency: order.currency, environment: order.environment, wechatEnv: order.wechat_env,
    paymentChannel: order.payment_channel, clientPlatform: order.client_platform,
    providerTransactionId: order.provider_transaction_id,
    paidAt: order.paid_at instanceof Date ? order.paid_at.toISOString() : null
  }
  return normalizeWechatGoodsDeliveryMessage(body(transactionId), normalizedOrder, {
    originalId: 'gh_store_original', openid: 'openid-store-safe', userId: '42', now: NOW
  })
}

function schemaRows(sql, values) {
  const table = values && values[0]
  const expected = schemaContract.get(table)
  if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [[{ ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_unicode_ci' }]]
  if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
    const generated = table === 'virtual_payment_delivery_attempts'
      ? "CASE WHEN `attempt_status` IN ('claimed', 'dispatching', 'uncertain', 'confirming') THEN `order_id` ELSE NULL END"
      : "CASE WHEN `query_status` = 'claimed' THEN `order_id` ELSE NULL END"
    return [expected.columns.map((column) => ({
      COLUMN_NAME: column.name, COLUMN_TYPE: column.type, IS_NULLABLE: column.nullable ? 'YES' : 'NO',
      COLUMN_DEFAULT: column.default, EXTRA: [column.auto ? 'auto_increment' : '', column.update ? 'on update CURRENT_TIMESTAMP' : '', column.stored ? 'STORED GENERATED' : ''].filter(Boolean).join(' '),
      GENERATION_EXPRESSION: column.generated === '[]' ? '' : generated,
      COLLATION_NAME: column.collation
    }))]
  }
  if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) {
    return [expected.indexes.flatMap((index) => index.columns.map((column, offset) => ({
      INDEX_NAME: index.name, NON_UNIQUE: index.unique ? 0 : 1, COLUMN_NAME: column,
      SEQ_IN_INDEX: offset + 1, SUB_PART: null, INDEX_TYPE: 'BTREE', IS_VISIBLE: 'YES', COLLATION: 'A'
    })))]
  }
  if (sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE')) {
    return [expected.foreignKeys.map((foreignKey) => ({
      CONSTRAINT_NAME: foreignKey.name, COLUMN_NAME: foreignKey.column,
      REFERENCED_TABLE_NAME: foreignKey.table, REFERENCED_COLUMN_NAME: foreignKey.referencedColumn,
      REFERENCED_TABLE_SCHEMA: 'test_schema', UPDATE_RULE: foreignKey.update, DELETE_RULE: foreignKey.delete
    }))]
  }
  if (sql.includes('SELECT DATABASE() AS schema_name')) return [[{ schema_name: 'test_schema' }]]
  return null
}

function harness(overrides = {}) {
  const state = { order: orderRow(overrides.order), event: null, attempt: overrides.attempt || null, grants: overrides.granted ? 1 : 0, commits: 0, rollbacks: 0, lockOrder: [] }
  let tail = Promise.resolve()
  function connection() {
    let unlock = null
    return {
      async beginTransaction() {
        const previous = tail
        tail = new Promise((resolve) => { unlock = resolve })
        await previous
      },
      async commit() { state.commits += 1; unlock?.(); unlock = null },
      async rollback() { state.rollbacks += 1; unlock?.(); unlock = null },
      async release() { unlock?.(); unlock = null },
      async execute(sql, values = []) {
        const schema = schemaRows(sql, values)
        if (schema) return schema
        if (sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED') return [{ affectedRows: 0 }]
        if (sql.includes('FROM virtual_payment_orders') && sql.includes('FOR UPDATE')) {
          state.lockOrder.push('order')
          return [[String(state.order.user_id) === String(values[0]) && state.order.order_no === values[1] ? { ...state.order } : null].filter(Boolean)]
        }
        if (sql.includes('FROM virtual_payment_events') && sql.includes('WHERE event_key')) {
          state.lockOrder.push('event')
          return [[state.event ? { ...state.event, payload_hash: Buffer.from(state.event.payload_hash) } : null].filter(Boolean)]
        }
        if (sql.includes('INNER JOIN virtual_payment_orders')) {
          if (!state.event) return [[]]
          return [[{
            ...state.event, payload_hash: Buffer.from(state.event.payload_hash),
            linked_order_id: state.order.id, linked_order_no: state.order.order_no,
            linked_user_id: state.order.user_id, linked_product_id: state.order.product_id,
            linked_internal_sku: state.order.internal_sku, linked_quantity: state.order.quantity,
            linked_unit_price_fen: state.order.unit_price_fen,
            linked_provider_order_id: state.order.provider_order_id,
            linked_provider_transaction_id: state.order.provider_transaction_id,
            order_amount_fen: state.order.order_amount_fen, paid_amount_fen: state.order.paid_amount_fen,
            paid_at: state.order.paid_at, environment: state.order.environment, wechat_env: state.order.wechat_env
          }]]
        }
        if (sql.includes('FROM virtual_payment_delivery_attempts')) { state.lockOrder.push('attempts'); return [[state.attempt ? { ...state.attempt } : null].filter(Boolean)] }
        if (sql.includes('FROM virtual_payment_delivery_queries')) { state.lockOrder.push('queries'); return [[]] }
        if (sql.startsWith('UPDATE virtual_payment_orders') && sql.includes("SET payment_status = 'paid'")) {
          state.order = { ...state.order, payment_status: 'paid', provider_transaction_id: state.order.provider_transaction_id || values[0], paid_amount_fen: state.order.paid_amount_fen ?? values[1], paid_at: state.order.paid_at || values[2], version: state.order.version + 1, last_error_code: null }
          return [{ affectedRows: 1 }]
        }
        if (sql.startsWith('UPDATE virtual_payment_orders') && sql.includes("SET entitlement_status = 'granted'")) {
          state.order = { ...state.order, entitlement_status: 'granted', membership_grant_id: Number(values[0]), entitlement_transaction_id: values[1], entitlement_granted_at: values[2], version: state.order.version + 1 }
          return [{ affectedRows: 1 }]
        }
        if (sql.startsWith('UPDATE virtual_payment_orders') && sql.includes("SET delivery_status = 'delivered'")) {
          state.order = { ...state.order, delivery_status: 'delivered', delivered_at: values[0], next_retry_at: null, last_error_code: null, version: state.order.version + 1 }
          return [{ affectedRows: 1 }]
        }
        if (sql.startsWith('UPDATE virtual_payment_events') && sql.includes('received_count = received_count + 1')) {
          state.event.received_count += 1
          return [{ affectedRows: 1 }]
        }
        if (sql.startsWith('INSERT INTO virtual_payment_events')) {
          state.event = {
            id: 11, event_key: values[0], event_type: values[1], order_id: Number(values[2]),
            order_no: values[3], provider_order_id: values[4], provider_transaction_id: values[5],
            payload_hash: Buffer.from(values[6]), processing_status: 'processed', received_count: 1,
            processed_at: values[7], attempt_count: 1, last_error_code: null
          }
          return [{ affectedRows: 1, insertId: 11 }]
        }
        throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`)
      }
    }
  }
  const membership = {
    grantId: '9', transactionId: 'ent-message', sourceType: 'wechat_order', sourceId: ORDER_NO,
    idempotent: false, effectiveStartAt: NOW.toISOString(),
    effectiveEndAt: new Date(NOW.getTime() + 2_592_000_000).toISOString()
  }
  const entitlementStore = {
    async lockMembershipScheduleInTransaction() { state.lockOrder.push('membership') },
    async grantMembershipDurationInTransaction() {
      if (state.grants !== 0) return { ...membership, idempotent: true }
      state.grants += 1
      return membership
    },
    async verifyMembershipGrantInTransaction(_connection, input) {
      if (state.grants !== 1 || String(input.grantId) !== '9' || input.transactionId !== 'ent-message') throw new Error('invalid grant')
      return { ...membership, idempotent: true }
    }
  }
  const store = createVirtualPaymentStore({ pool: { async getConnection() { return connection() } }, entitlementStore })
  return { store, state }
}

const firstHarness = harness()
const trustedFact = fact(firstHarness.state.order)
const first = await firstHarness.store.applyGoodsDeliveryNotification('42', ORDER_NO, trustedFact, { now: NOW })
assert.equal(first.eventDuplicate, false)
assert.equal(first.entitlementIdempotent, false)
assert.equal(firstHarness.state.order.payment_status, 'paid')
assert.equal(firstHarness.state.order.entitlement_status, 'granted')
assert.equal(firstHarness.state.order.delivery_status, 'delivered')
assert.equal(firstHarness.state.grants, 1)
assert.equal(firstHarness.state.event.received_count, 1)
assert.equal(firstHarness.state.event.provider_order_id, 'merchant-store-safe')
assert.deepEqual(firstHarness.state.lockOrder.slice(0, 5), ['order', 'membership', 'attempts', 'queries', 'event'])
assert.equal(await firstHarness.store.findTrustedWechatQueryPaidEvidence('42', ORDER_NO), true)
const deliveryRecovery = await firstHarness.store.claimDeliveryWork('42', ORDER_NO, {
  expectedProductId: PRODUCT_ID, now: NOW
})
assert.equal(deliveryRecovery.action, 'delivered')

const repeated = await firstHarness.store.applyGoodsDeliveryNotification('42', ORDER_NO, trustedFact, { now: NOW })
assert.equal(repeated.eventDuplicate, true)
assert.equal(firstHarness.state.event.received_count, 2)
assert.equal(firstHarness.state.grants, 1)

const otherAttach = 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const conflictingAttachCanonical = createWechatGoodsDeliveryCanonicalFact({
  source: trustedFact.source, environment: 'sandbox', wechatEnv: 1,
  userId: trustedFact.userId, orderNo: trustedFact.orderNo,
  productId: trustedFact.productId, internalSku: trustedFact.internalSku,
  quantity: trustedFact.quantity, attach: otherAttach,
  unitPriceFen: trustedFact.unitPriceFen, orderAmountFen: trustedFact.orderAmountFen,
  providerMerchantOrderNo: trustedFact.providerMerchantOrderNo,
  providerTransactionId: trustedFact.providerTransactionId,
  paidAtSeconds: trustedFact.paidAtSeconds
})
await assert.rejects(
  firstHarness.store.applyGoodsDeliveryNotification('42', ORDER_NO, {
    ...trustedFact, attach: otherAttach,
    eventKey: conflictingAttachCanonical.eventKey,
    payloadHash: conflictingAttachCanonical.payloadHash
  }, { now: NOW }),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)
assert.equal(firstHarness.state.event.received_count, 2)
assert.equal(firstHarness.state.grants, 1)

const conflictingFact = fact(orderRow(), 'different-transaction')
await assert.rejects(
  firstHarness.store.applyGoodsDeliveryNotification('42', ORDER_NO, conflictingFact, { now: NOW }),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)
assert.equal(firstHarness.state.event.received_count, 2)
assert.equal(firstHarness.state.grants, 1)

const concurrentHarness = harness()
const concurrentFact = fact(concurrentHarness.state.order)
const concurrent = await Promise.all([
  concurrentHarness.store.applyGoodsDeliveryNotification('42', ORDER_NO, concurrentFact, { now: NOW }),
  concurrentHarness.store.applyGoodsDeliveryNotification('42', ORDER_NO, concurrentFact, { now: NOW })
])
assert.equal(concurrent.filter((item) => item.eventDuplicate === false).length, 1)
assert.equal(concurrent.filter((item) => item.eventDuplicate === true).length, 1)
assert.equal(concurrentHarness.state.grants, 1)
assert.equal(concurrentHarness.state.event.received_count, 2)
assert.equal(concurrentHarness.state.order.delivery_status, 'delivered')

const alreadyGranted = harness({
  granted: true,
  order: {
    payment_status: 'paid', paid_amount_fen: 3000, paid_at: PAID_AT,
    provider_transaction_id: 'transaction-store-safe', entitlement_status: 'granted',
    membership_grant_id: 9, entitlement_transaction_id: 'ent-message', entitlement_granted_at: NOW,
    delivery_status: 'not_ready', version: 4
  }
})
const completed = await alreadyGranted.store.applyGoodsDeliveryNotification('42', ORDER_NO, fact(alreadyGranted.state.order), { now: NOW })
assert.equal(completed.entitlementIdempotent, true)
assert.equal(alreadyGranted.state.grants, 1)
assert.equal(alreadyGranted.state.order.delivery_status, 'delivered')

const confirming = harness({
  granted: true,
  order: {
    payment_status: 'paid', paid_amount_fen: 3000, paid_at: PAID_AT,
    provider_transaction_id: 'transaction-store-safe', entitlement_status: 'granted',
    membership_grant_id: 9, entitlement_transaction_id: 'ent-message', entitlement_granted_at: NOW,
    delivery_status: 'confirming', version: 5, last_error_code: 'DELIVERY_NOTIFY_UNCERTAIN'
  },
  attempt: {
    id: 21, operation_id: 'a'.repeat(64), order_id: 7, user_id: 42, attempt_no: 1,
    claimed_order_version: 4, attempt_status: 'confirming', result_kind: 'uncertain',
    completion_source: 'none', claimed_at: new Date(NOW.getTime() - 20_000), finished_at: null,
    lease_owner: null, lease_expires_at: null, request_started_at: new Date(NOW.getTime() - 19_000),
    response_received_at: null, next_action_at: new Date(NOW.getTime() + 60_000), query_count: 0,
    provider_event_id: null, last_error_code: 'DELIVERY_NOTIFY_UNCERTAIN',
    created_at: new Date(NOW.getTime() - 20_000), updated_at: new Date(NOW.getTime() - 10_000)
  }
})
await assert.rejects(
  confirming.store.applyGoodsDeliveryNotification('42', ORDER_NO, fact(confirming.state.order), { now: NOW }),
  (error) => error.code === 'PAYMENT_DELIVERY_CONFLICT'
)
assert.equal(confirming.state.order.delivery_status, 'confirming')
assert.equal(confirming.state.attempt.attempt_status, 'confirming')
assert.equal(confirming.state.grants, 1)

for (const deliveryStatus of ['manual_review', 'delivered']) {
  const late = harness({
    granted: true,
    order: {
      payment_status: 'paid', paid_amount_fen: 3000, paid_at: PAID_AT,
      provider_transaction_id: 'transaction-store-safe', entitlement_status: 'granted',
      membership_grant_id: 9, entitlement_transaction_id: 'ent-message', entitlement_granted_at: NOW,
      delivery_status: deliveryStatus, delivered_at: deliveryStatus === 'delivered' ? NOW : null,
      version: 8
    },
    attempt: deliveryStatus === 'manual_review' ? {
      id: 31, operation_id: 'b'.repeat(64), order_id: 7, user_id: 42, attempt_no: 1,
      claimed_order_version: 4, attempt_status: 'manual_review', result_kind: 'uncertain',
      completion_source: 'none', claimed_at: new Date(NOW.getTime() - 30_000), finished_at: null,
      lease_owner: null, lease_expires_at: null, request_started_at: new Date(NOW.getTime() - 29_000),
      response_received_at: null, next_action_at: null, query_count: 0,
      provider_event_id: null, last_error_code: 'DELIVERY_CONFIRMATION_EXHAUSTED',
      created_at: new Date(NOW.getTime() - 30_000), updated_at: NOW
    } : {
      id: 32, operation_id: 'c'.repeat(64), order_id: 7, user_id: 42, attempt_no: 1,
      claimed_order_version: 7, attempt_status: 'succeeded', result_kind: 'success',
      completion_source: 'direct_notify', claimed_at: new Date(NOW.getTime() - 30_000), finished_at: new Date(NOW.getTime() - 28_000),
      lease_owner: null, lease_expires_at: null, request_started_at: new Date(NOW.getTime() - 29_000),
      response_received_at: new Date(NOW.getTime() - 28_000), next_action_at: null, query_count: 0,
      provider_event_id: null, last_error_code: null,
      created_at: new Date(NOW.getTime() - 30_000), updated_at: NOW
    }
  })
  await late.store.applyGoodsDeliveryNotification('42', ORDER_NO, fact(late.state.order), { now: NOW })
  assert.equal(late.state.order.delivery_status, 'delivered')
  assert.equal(late.state.grants, 1)
  assert.equal(late.state.event.received_count, 1)
}

console.log('virtual payment message store transaction tests passed')
