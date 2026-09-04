import assert from 'node:assert/strict'
import { inspect } from 'node:util'

import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const SECOND_ORDER_NO = 'VPBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const NOW = new Date('2026-08-30T00:00:00.000Z')

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
    payment_status: 'initializing',
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

function createInput(overrides = {}) {
  return {
    userId: '42',
    clientRequestId: 'request-12345678',
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
    clientPlatform: 'android',
    ...overrides
  }
}

function duplicateKey(key) {
  const message = `Duplicate entry 'safe-value' for key '${key}'`
  const error = new Error(message)
  error.code = 'ER_DUP_ENTRY'
  error.errno = 1062
  error.sqlState = '23000'
  error.sqlMessage = message
  return error
}

function duplicate(indexName) {
  return duplicateKey(`virtual_payment_orders.${indexName}`)
}

const statements = []
let storedRow = null
const pool = {
  async execute(sql, params) {
    statements.push({ sql, params })
    assert.equal(sql.includes('loginCode'), false)
    assert.equal(sql.includes('sessionKey'), false)
    assert.equal(sql.includes('paySig'), false)
    if (sql.startsWith('INSERT')) {
      storedRow = row({
        order_no: params[0],
        user_id: params[1],
        client_request_id: params[2],
        product_id: params[4],
        client_platform: params[13]
      })
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('UPDATE')) {
      if (storedRow && storedRow.user_id === params[0] && storedRow.order_no === params[1]) {
        storedRow.payment_status = 'pending'
        return [{ affectedRows: 1 }]
      }
      return [{ affectedRows: 0 }]
    }
    if (sql.includes('client_request_id = ?')) {
      return [[storedRow && String(storedRow.user_id) === String(params[0]) && storedRow.client_request_id === params[1]
        ? storedRow
        : null].filter(Boolean)]
    }
    if (sql.includes('order_no = ?')) {
      return [[storedRow && String(storedRow.user_id) === String(params[0]) && storedRow.order_no === params[1]
        ? storedRow
        : null].filter(Boolean)]
    }
    throw new Error('unexpected SQL')
  }
}

const store = createVirtualPaymentStore({ pool, orderNoFactory: () => ORDER_NO })
const created = await store.createOrder(createInput())
assert.equal(created.idempotent, false)
assert.equal(created.order.orderNo, ORDER_NO)
assert.equal(created.order.paymentStatus, 'initializing')
assert.equal(created.order.unitPriceFen, 3000)
assert.equal(created.order.wechatEnv, 1)
assert.deepEqual(statements[0].params, [
  ORDER_NO, '42', 'request-12345678', 'membership_30d', 'sandbox-product', '30天学习会员',
  1, 3000, 3000, 'CNY', 'sandbox', 1, 'wechat_virtual_payment', 'android'
])
assert(statements.every(({ sql }) => !/42|request-12345678/.test(sql)), 'user data must be parameterized')

const pending = await store.markOrderPending('42', ORDER_NO)
assert.equal(pending.paymentStatus, 'pending')
assert.match(statements.find(({ sql }) => sql.startsWith('UPDATE')).sql, /payment_status = 'initializing'/)
assert.equal((await store.findByUserAndOrderNo('43', ORDER_NO)), null, 'ownership lookup must not reveal another user order')

let duplicateSelects = 0
const idempotentStore = createVirtualPaymentStore({
  orderNoFactory: () => SECOND_ORDER_NO,
  pool: {
    async execute(sql, params) {
      if (sql.startsWith('INSERT')) throw duplicate('uk_virtual_payment_orders_user_request')
      if (sql.includes('client_request_id = ?')) {
        duplicateSelects += 1
        assert.deepEqual(params, ['42', 'request-12345678'])
        return [[row()]]
      }
      throw new Error('unexpected SQL')
    }
  }
})
const idempotent = await idempotentStore.createOrder(createInput())
assert.equal(idempotent.idempotent, true)
assert.equal(idempotent.order.orderNo, ORDER_NO)
assert.equal(duplicateSelects, 1)

const conflictingIdempotentStore = createVirtualPaymentStore({
  orderNoFactory: () => SECOND_ORDER_NO,
  pool: {
    async execute(sql) {
      if (sql.startsWith('INSERT')) throw duplicate('uk_virtual_payment_orders_user_request')
      if (sql.includes('client_request_id = ?')) return [[row({ product_id: 'different-sandbox-product' })]]
      throw new Error('unexpected SQL')
    }
  }
})
await assert.rejects(
  () => conflictingIdempotentStore.createOrder(createInput()),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)

let insertAttempts = 0
const orderCollisionStore = createVirtualPaymentStore({
  orderNoFactory: () => (insertAttempts === 0 ? ORDER_NO : SECOND_ORDER_NO),
  pool: {
    async execute(sql, params) {
      if (sql.startsWith('INSERT')) {
        insertAttempts += 1
        if (insertAttempts === 1) throw duplicate('uk_virtual_payment_orders_order_no')
        storedRow = row({ order_no: params[0] })
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('order_no = ?')) return [[storedRow]]
      throw new Error('unexpected SQL')
    }
  }
})
assert.equal((await orderCollisionStore.createOrder(createInput())).order.orderNo, SECOND_ORDER_NO)
assert.equal(insertAttempts, 2)

const supportedDuplicateKeys = {
  orderNo: [
    'uk_virtual_payment_orders_order_no',
    'virtual_payment_orders.uk_virtual_payment_orders_order_no',
    '`uk_virtual_payment_orders_order_no`',
    '`virtual_payment_orders`.`uk_virtual_payment_orders_order_no`'
  ],
  userRequest: [
    'uk_virtual_payment_orders_user_request',
    'virtual_payment_orders.uk_virtual_payment_orders_user_request',
    '`uk_virtual_payment_orders_user_request`',
    '`virtual_payment_orders`.`uk_virtual_payment_orders_user_request`'
  ]
}

for (const key of supportedDuplicateKeys.orderNo) {
  let operations = 0
  let generatedOrderNumbers = 0
  const strictOrderCollisionStore = createVirtualPaymentStore({
    orderNoFactory: () => {
      generatedOrderNumbers += 1
      return generatedOrderNumbers === 1 ? ORDER_NO : SECOND_ORDER_NO
    },
    pool: {
      async execute(sql, params) {
        operations += 1
        if (operations === 1) throw duplicateKey(key)
        if (sql.startsWith('INSERT')) return [{ affectedRows: 1 }]
        if (sql.includes('order_no = ?')) return [[row({ order_no: params[1] })]]
        throw new Error('unexpected SQL')
      }
    }
  })
  const result = await strictOrderCollisionStore.createOrder(createInput())
  assert.equal(result.order.orderNo, SECOND_ORDER_NO)
  assert.equal(generatedOrderNumbers, 2)
  assert.equal(operations, 3)
}

for (const key of supportedDuplicateKeys.userRequest) {
  const executedSql = []
  const strictIdempotentStore = createVirtualPaymentStore({
    orderNoFactory: () => SECOND_ORDER_NO,
    pool: {
      async execute(sql) {
        executedSql.push(sql)
        if (sql.startsWith('INSERT')) throw duplicateKey(key)
        if (sql.includes('client_request_id = ?')) return [[row()]]
        throw new Error('unexpected SQL')
      }
    }
  })
  const result = await strictIdempotentStore.createOrder(createInput())
  assert.equal(result.idempotent, true)
  assert.equal(executedSql.length, 2)
  assert(executedSql[0].startsWith('INSERT'))
  assert(executedSql[1].includes('client_request_id = ?'))
}

for (const override of [
  { unitPriceFen: 1 },
  { quantity: 2 },
  { environment: 'production' },
  { wechatEnv: 0 },
  { clientPlatform: 'invalid' },
  { loginCode: 'must-not-be-stored' }
]) {
  await assert.rejects(() => store.createOrder(createInput(override)), (error) => error.code === 'PAYMENT_REQUEST_INVALID')
}

const sensitiveDatabaseError = new Error('SQL password=secret order=request-12345678')
sensitiveDatabaseError.code = 'ER_ACCESS_DENIED_ERROR'
const failingStore = createVirtualPaymentStore({
  pool: { async execute() { throw sensitiveDatabaseError } }
})
await assert.rejects(
  () => failingStore.findByUserAndClientRequestId('42', 'request-12345678'),
  (error) => {
    assert.equal(error.code, 'PAYMENT_SERVICE_UNAVAILABLE')
    assert.equal(Object.hasOwn(error, 'cause'), false)
    assert(!inspect(error).includes('password=secret'))
    assert(!inspect(error).includes('request-12345678'))
    return true
  }
)

const invalidRowStore = createVirtualPaymentStore({
  pool: { async execute() { return [[row({ payment_status: 'unknown' })]] } }
})
await assert.rejects(
  () => invalidRowStore.findByUserAndOrderNo('42', ORDER_NO),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)

for (const overrides of [
  { quantity: null },
  { quantity: false },
  { quantity: '' },
  { quantity: '1' },
  { quantity: '1e0' },
  { unit_price_fen: '3000' },
  { order_amount_fen: true },
  { paid_amount_fen: false },
  { id: 0 },
  { id: '-1' },
  { id: ' 1' },
  { id: '1.0' },
  { id: '1e2' },
  { id: '9007199254740992' },
  { user_id: false },
  { membership_grant_id: '' },
  { created_at: null },
  { created_at: false },
  { created_at: 0 },
  { created_at: '2026-02-30 00:00:00' },
  { updated_at: undefined },
  { paid_at: false },
  { paid_at: '' },
  { retry_count: '0' },
  { version: false },
  { client_result: 'unknown' },
  { environment: 1 },
  { currency: new String('CNY') },
  { client_platform: 'unknown' }
]) {
  const abnormalStore = createVirtualPaymentStore({
    pool: { async execute() { return [[row(overrides)]] } }
  })
  await assert.rejects(
    () => abnormalStore.findByUserAndOrderNo('42', ORDER_NO),
    (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
  )
}

for (const validDates of [
  new Date('2026-08-30T00:00:00.000Z'),
  '2026-08-30 00:00:00'
]) {
  const validDateStore = createVirtualPaymentStore({
    pool: {
      async execute() {
        return [[row({ created_at: validDates, updated_at: validDates, paid_at: null })]]
      }
    }
  })
  const normalized = await validDateStore.findByUserAndOrderNo('42', ORDER_NO)
  assert.equal(normalized.createdAt, '2026-08-30T00:00:00.000Z')
  assert.equal(normalized.paidAt, null)
}

const inconsistentRowStore = createVirtualPaymentStore({
  pool: {
    async execute() {
      return [[row({ payment_status: 'pending', entitlement_status: 'pending' })]]
    }
  }
})
await assert.rejects(
  () => inconsistentRowStore.findByUserAndOrderNo('42', ORDER_NO),
  (error) => error.code === 'PAYMENT_ORDER_CONFLICT'
)

const duplicateLeakSentinels = [
  'SQL_SENTINEL',
  'SQL_MESSAGE_SENTINEL',
  'OPENID_SENTINEL',
  'PASSWORD_SENTINEL',
  'HOST_SENTINEL',
  'PORT_SENTINEL',
  'USERNAME_SENTINEL',
  'DATABASE_SENTINEL',
  'request-12345678',
  ORDER_NO
]

function assertSanitizedStoreError(error) {
  const exposed = inspect(error)
  assert.equal(error.code, 'PAYMENT_SERVICE_UNAVAILABLE')
  assert.equal(Object.hasOwn(error, 'cause'), false)
  assert.equal(Object.hasOwn(error, 'details'), false)
  duplicateLeakSentinels.forEach((sentinel) => assert(!exposed.includes(sentinel)))
  return true
}

function rawDatabaseError(message = duplicateLeakSentinels.join(' ')) {
  const error = new Error(message)
  error.sqlMessage = `SQL_MESSAGE_SENTINEL ${message}`
  error.host = 'HOST_SENTINEL'
  error.port = 'PORT_SENTINEL'
  error.username = 'USERNAME_SENTINEL'
  error.password = 'PASSWORD_SENTINEL'
  error.database = 'DATABASE_SENTINEL'
  return error
}

function assertSafeFailure(error, expectedMessage) {
  assert.equal(error.code, 'PAYMENT_SERVICE_UNAVAILABLE')
  assert.equal(error.message, expectedMessage)
  assert.equal(Object.hasOwn(error, 'cause'), false)
  assert.equal(Object.hasOwn(error, 'details'), false)
  const surfaces = [error.message, error.stack, JSON.stringify(error), inspect(error)]
  duplicateLeakSentinels.forEach((sentinel) => {
    surfaces.forEach((surface) => assert(!String(surface).includes(sentinel)))
  })
  return true
}

const rejectedDuplicateKeys = [
  'virtual_payment_orders.uk_virtual_payment_orders_order_`no`',
  'uk_virtual_payment_orders_order_`no`',
  '`uk_virtual_payment_orders_order_no',
  'uk_virtual_payment_orders_order_no`',
  '`virtual_payment_orders`.uk_virtual_payment_orders_order_no',
  'virtual_payment_orders.`uk_virtual_payment_orders_order_no',
  'other_table.uk_virtual_payment_orders_order_no',
  'other_schema.virtual_payment_orders.uk_virtual_payment_orders_order_no',
  'uk_virtual_payment_orders_order_no_extra',
  'prefix_uk_virtual_payment_orders_order_no',
  'uk_virtual_payment_orders_user_request_extra',
  'uk_virtual_payment_orders_provider_order',
  ''
]

for (const key of rejectedDuplicateKeys) {
  const executedSql = []
  let generatedOrderNumbers = 0
  const strictDuplicateStore = createVirtualPaymentStore({
    orderNoFactory: () => {
      generatedOrderNumbers += 1
      return ORDER_NO
    },
    pool: {
      async execute(sql) {
        executedSql.push(sql)
        throw duplicateKey(key)
      }
    }
  })
  await assert.rejects(
    () => strictDuplicateStore.createOrder(createInput()),
    (error) => assertSafeFailure(error, 'Payment database operation failed.')
  )
  assert.equal(generatedOrderNumbers, 1, 'invalid duplicate key must not regenerate an order number')
  assert.equal(executedSql.length, 1, 'invalid duplicate key must not trigger a second database operation')
  assert(executedSql[0].startsWith('INSERT'), 'invalid duplicate key must not trigger idempotent lookup')
}

for (const malformedDuplicate of [
  Object.assign(duplicateKey('uk_virtual_payment_orders_order_no'), { message: null, sqlMessage: null }),
  Object.assign(duplicateKey('uk_virtual_payment_orders_order_no'), { message: { unsafe: true }, sqlMessage: 1062 }),
  Object.assign(duplicateKey('uk_virtual_payment_orders_order_no'), {
    message: 'Duplicate key without the required MySQL grammar',
    sqlMessage: undefined
  })
]) {
  let operations = 0
  let generatedOrderNumbers = 0
  const malformedDuplicateStore = createVirtualPaymentStore({
    orderNoFactory: () => {
      generatedOrderNumbers += 1
      return ORDER_NO
    },
    pool: {
      async execute() {
        operations += 1
        throw malformedDuplicate
      }
    }
  })
  await assert.rejects(
    () => malformedDuplicateStore.createOrder(createInput()),
    (error) => assertSafeFailure(error, 'Payment database operation failed.')
  )
  assert.equal(generatedOrderNumbers, 1)
  assert.equal(operations, 1)
}

for (const constraintName of [
  'uk_virtual_payment_orders_order_no_suffix',
  'prefix_uk_virtual_payment_orders_order_no',
  'uk_virtual_payment_orders_provider_order'
]) {
  const strictDuplicateStore = createVirtualPaymentStore({
    orderNoFactory: () => SECOND_ORDER_NO,
    pool: { async execute() { throw duplicate(constraintName) } }
  })
  await assert.rejects(() => strictDuplicateStore.createOrder(createInput()), assertSanitizedStoreError)
}

const unparseableDuplicate = new Error(
  `SQL_SENTINEL OPENID_SENTINEL PASSWORD_SENTINEL HOST_SENTINEL ${ORDER_NO}`
)
unparseableDuplicate.code = 'ER_DUP_ENTRY'
unparseableDuplicate.errno = 1062
unparseableDuplicate.sqlState = '23000'
const unparseableStore = createVirtualPaymentStore({
  pool: { async execute() { throw unparseableDuplicate } }
})
await assert.rejects(() => unparseableStore.createOrder(createInput()), assertSanitizedStoreError)
await assert.rejects(
  () => unparseableStore.findByUserAndOrderNo('42', ORDER_NO),
  assertSanitizedStoreError
)
await assert.rejects(
  () => unparseableStore.markOrderPending('42', ORDER_NO),
  assertSanitizedStoreError
)

const duplicateOutsideCreateStore = createVirtualPaymentStore({
  pool: { async execute() { throw duplicate('uk_virtual_payment_orders_user_request') } }
})
await assert.rejects(
  () => duplicateOutsideCreateStore.findByUserAndOrderNo('42', ORDER_NO),
  assertSanitizedStoreError
)
await assert.rejects(
  () => duplicateOutsideCreateStore.markOrderPending('42', ORDER_NO),
  assertSanitizedStoreError
)

const getConnectionStore = createVirtualPaymentStore({
  pool: {
    async getConnection() {
      throw new Error('PASSWORD_SENTINEL HOST_SENTINEL SQL_SENTINEL')
    }
  }
})
await assert.rejects(
  () => getConnectionStore.findByUserAndOrderNo('42', ORDER_NO),
  assertSanitizedStoreError
)

let releaseCalled = 0
const releaseFailureStore = createVirtualPaymentStore({
  pool: {
    async getConnection() {
      return {
        async execute() { return [[row()]] },
        release() {
          releaseCalled += 1
          throw new Error('PASSWORD_SENTINEL HOST_SENTINEL SQL_SENTINEL')
        }
      }
    }
  }
})
await assert.rejects(
  () => releaseFailureStore.findByUserAndOrderNo('42', ORDER_NO),
  assertSanitizedStoreError
)
assert.equal(releaseCalled, 1)

for (const missingField of ['errno', 'sqlState']) {
  let operationCount = 0
  const incomplete = duplicate('uk_virtual_payment_orders_order_no')
  delete incomplete[missingField]
  const incompleteDuplicateStore = createVirtualPaymentStore({
    pool: {
      async execute() {
        operationCount += 1
        throw incomplete
      }
    }
  })
  await assert.rejects(
    () => incompleteDuplicateStore.createOrder(createInput()),
    (error) => assertSafeFailure(error, 'Payment database operation failed.')
  )
  assert.equal(operationCount, 1, 'incomplete duplicate metadata must not retry or read idempotent order')
}

for (const metadataOverride of [
  { errno: 9999 },
  { sqlState: '99999' },
  { code: 'ER_OTHER' }
]) {
  let operationCount = 0
  const invalidMetadata = Object.assign(duplicate('uk_virtual_payment_orders_user_request'), metadataOverride)
  const invalidDuplicateStore = createVirtualPaymentStore({
    pool: {
      async execute() {
        operationCount += 1
        throw invalidMetadata
      }
    }
  })
  await assert.rejects(
    () => invalidDuplicateStore.createOrder(createInput()),
    (error) => assertSafeFailure(error, 'Payment database operation failed.')
  )
  assert.equal(operationCount, 1, 'invalid duplicate metadata must not retry or read idempotent order')
}

function createConnectionFailureHarness({ operationError = null, releaseError = null, result = [[row()]] } = {}) {
  const calls = { getConnection: 0, execute: 0, release: 0 }
  const loggerCalls = []
  const pool = {
    async getConnection() {
      calls.getConnection += 1
      return {
        async execute() {
          calls.execute += 1
          if (operationError) throw operationError
          return result
        },
        release() {
          calls.release += 1
          if (releaseError) throw releaseError
        }
      }
    }
  }
  const store = createVirtualPaymentStore({
    pool,
    logger: {
      error(...args) { loggerCalls.push(args) },
      warn(...args) { loggerCalls.push(args) },
      info(...args) { loggerCalls.push(args) }
    }
  })
  return { calls, loggerCalls, store }
}

const operationOnly = createConnectionFailureHarness({ operationError: rawDatabaseError() })
await assert.rejects(
  () => operationOnly.store.findByUserAndOrderNo('42', ORDER_NO),
  (error) => assertSafeFailure(error, 'Payment database operation failed.')
)
assert.deepEqual(operationOnly.calls, { getConnection: 1, execute: 1, release: 1 })
assert.deepEqual(operationOnly.loggerCalls, [])

const releaseOnly = createConnectionFailureHarness({ releaseError: rawDatabaseError() })
await assert.rejects(
  () => releaseOnly.store.findByUserAndOrderNo('42', ORDER_NO),
  (error) => assertSafeFailure(error, 'Payment database connection release failed.')
)
assert.deepEqual(releaseOnly.calls, { getConnection: 1, execute: 1, release: 1 })
assert.deepEqual(releaseOnly.loggerCalls, [])

const operationAndRelease = createConnectionFailureHarness({
  operationError: rawDatabaseError('SQL_SENTINEL OPENID_SENTINEL request-12345678'),
  releaseError: rawDatabaseError('PASSWORD_SENTINEL HOST_SENTINEL PORT_SENTINEL DATABASE_SENTINEL')
})
await assert.rejects(
  () => operationAndRelease.store.findByUserAndOrderNo('42', ORDER_NO),
  (error) => assertSafeFailure(error, 'Payment database operation and connection release both failed.')
)
assert.deepEqual(operationAndRelease.calls, { getConnection: 1, execute: 1, release: 1 })
assert.deepEqual(operationAndRelease.loggerCalls, [])

const duplicateAndReleaseError = duplicate('uk_virtual_payment_orders_order_no')
duplicateAndReleaseError.sqlMessage = `Duplicate entry '${ORDER_NO}' for key 'virtual_payment_orders.uk_virtual_payment_orders_order_no'`
duplicateAndReleaseError.message = duplicateAndReleaseError.sqlMessage
const duplicateAndRelease = createConnectionFailureHarness({
  operationError: duplicateAndReleaseError,
  releaseError: rawDatabaseError(),
  result: [{ affectedRows: 1 }]
})
await assert.rejects(
  () => duplicateAndRelease.store.createOrder(createInput()),
  (error) => assertSafeFailure(error, 'Payment database operation and connection release both failed.')
)
assert.deepEqual(duplicateAndRelease.calls, { getConnection: 1, execute: 1, release: 1 })
assert.deepEqual(duplicateAndRelease.loggerCalls, [])

const ambiguousUpdateStore = createVirtualPaymentStore({
  pool: {
    async execute(sql) {
      if (sql.startsWith('UPDATE')) return [{ affectedRows: 2 }]
      throw new Error('unexpected SQL')
    }
  }
})
await assert.rejects(
  () => ambiguousUpdateStore.markOrderPending('42', ORDER_NO),
  (error) => error.code === 'PAYMENT_SERVICE_UNAVAILABLE'
)

console.log('Virtual payment store tests passed.')

{
  const queries = [], source = Array.from({ length: 21 }, (_, i) => row({ id: 30 - i, order_no: `VP${(30 - i).toString(16).toUpperCase().padStart(30, '0')}`, client_request_id: `recovery-${30 - i}` }))
  let release = 0, answer = source
  const recovery = createVirtualPaymentStore({ pool: { async getConnection() { return {
    async execute(sql, values) { queries.push({ sql, values }); assert.match(sql, /^SELECT /); assert(!/FOR UPDATE|provider|events|attempt|queries/i.test(sql)); return [answer] },
    release() { release++ }
  } } } })
  const result = await recovery.listRecoveryOrders('42')
  assert.equal(result.orders.length, 20)
  assert.equal(result.nextCursor, source[19].order_no)
  assert.equal(release, 1)
  assert.match(queries[0].sql, /ORDER BY created_at DESC, id DESC LIMIT 21/)
  assert.deepEqual(queries[0].values, ['42', 'sandbox', 1])
  assert.deepEqual(Object.keys(result.orders[0]), ['orderNo', 'clientRequestId', 'paymentStatus', 'entitlementStatus', 'deliveryStatus', 'createdAt', 'updatedAt'])
  answer = []
  assert.deepEqual(await recovery.listRecoveryOrders('42'), { orders: [], nextCursor: null })
  await assert.rejects(recovery.listRecoveryOrders('42', ORDER_NO), { code: 'PAYMENT_REQUEST_INVALID' })
  for (const bad of [row({ user_id: 43 }), row({ environment: 'production' }), row({ wechat_env: 0 }), row({ payment_status: 'pending', entitlement_status: 'granted' }), row({ payment_status: 'closed' }), row({ delivery_status: 'delivered' })]) {
    answer = [bad]
    await assert.rejects(recovery.listRecoveryOrders('42'))
  }
  assert.equal(release, queries.length)
  let released = 0
  const failed = createVirtualPaymentStore({ pool: { async getConnection() { return { execute() { throw new Error('SQL password token') }, release() { released++ } } } } })
  await assert.rejects(failed.listRecoveryOrders('42'), (error) => error.code === 'PAYMENT_SERVICE_UNAVAILABLE' && !/password|token|SQL/.test(error.message))
  assert.equal(released, 1)
  console.log('Recovery Store: bounded read-only SQL, row validation, whitelist and release passed.')
}
