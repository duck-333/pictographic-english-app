import assert from 'node:assert/strict'
import { createWechatQueryCanonicalFact } from '../server/virtual-payment-reconciliation.mjs'
import { scheduleMembershipGrant } from '../server/membership-grant-schedule.mjs'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'

const ORDER_NO = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = new Date('2026-08-31T00:00:00.000Z')
const END = new Date(NOW.getTime() + 2_592_000_000).toISOString()

function orderRow(overrides = {}) {
  return {
    id: 1, order_no: ORDER_NO, user_id: 42, client_request_id: 'request-12345678',
    internal_sku: 'membership_30d', product_id: 'sandbox-product', product_name: '30天学习会员',
    quantity: 1, unit_price_fen: 3000, order_amount_fen: 3000, paid_amount_fen: 3000,
    currency: 'CNY', environment: 'sandbox', wechat_env: 1,
    payment_channel: 'wechat_virtual_payment', client_platform: 'android',
    provider_order_id: 'WXORDER123', provider_transaction_id: 'WXTX123', payment_status: 'paid',
    entitlement_status: 'not_ready', delivery_status: 'not_ready', client_result: null,
    membership_grant_id: null, entitlement_transaction_id: null, paid_at: NOW,
    entitlement_granted_at: null, delivered_at: null, last_queried_at: NOW,
    next_retry_at: null, retry_count: 0, last_error_code: null, version: 2,
    created_at: NOW, updated_at: NOW, ...overrides
  }
}

const canonical = createWechatQueryCanonicalFact({
  source: 'wechat_query', environment: 'sandbox', wechatEnv: 1, orderNo: ORDER_NO,
  providerOrderId: 'WXORDER123', providerTransactionId: 'WXTX123', wechatStatus: 2,
  meaning: 'paid_pending_delivery', targetPaymentStatus: 'paid', orderType: 0,
  orderAmountFen: 3000, paidAmountFen: 3000, paidAtSeconds: Math.floor(NOW.getTime() / 1000)
})

function harness(overrides = {}) {
  let row = orderRow(overrides.order)
  let evidence = overrides.evidence === undefined ? true : overrides.evidence
  const calls = { begin: 0, commit: 0, rollback: 0, release: 0, execute: 0, lock: 0, grant: 0, verify: 0, updates: 0 }
  const connection = {
    async beginTransaction() { calls.begin += 1 },
    async commit() { calls.commit += 1; if (overrides.commitError) throw new Error('commit failed') },
    async rollback() { calls.rollback += 1; if (overrides.rollbackError) throw new Error('rollback failed') },
    async release() { calls.release += 1; if (overrides.releaseError) throw new Error('release failed') },
    async execute(sql, params) {
      calls.execute += 1
      if (sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED') return [{ affectedRows: 0 }]
      if (sql.includes('FROM virtual_payment_orders') && sql.includes('FOR UPDATE')) {
        return [[String(row.user_id) === String(params[0]) && row.order_no === params[1] ? { ...row } : null].filter(Boolean)]
      }
      if (sql.includes('INNER JOIN virtual_payment_orders')) {
        if (!evidence) return [[]]
        return [[{
          event_key: canonical.eventKey, event_type: 'wechat_query_status_2_paid', order_id: row.id,
          order_no: row.order_no, provider_order_id: row.provider_order_id,
          provider_transaction_id: row.provider_transaction_id, payload_hash: Buffer.from(canonical.payloadHash),
          processing_status: 'processed', received_count: 1, processed_at: NOW, attempt_count: 1,
          last_error_code: null, linked_order_id: row.id, linked_order_no: row.order_no,
          linked_provider_order_id: row.provider_order_id,
          linked_provider_transaction_id: row.provider_transaction_id,
          order_amount_fen: row.order_amount_fen, paid_amount_fen: row.paid_amount_fen,
          paid_at: row.paid_at, environment: row.environment, wechat_env: row.wechat_env
        }]]
      }
      if (sql.startsWith('UPDATE virtual_payment_orders')) {
        calls.updates += 1
        row = {
          ...row, entitlement_status: 'granted', membership_grant_id: Number(params[0]),
          entitlement_transaction_id: params[1], entitlement_granted_at: params[2],
          version: row.version + 1, updated_at: params[2]
        }
        return [{ affectedRows: overrides.updateAffectedRows === undefined ? 1 : overrides.updateAffectedRows }]
      }
      throw new Error('unexpected SQL')
    }
  }
  const membership = {
    grantId: '9', transactionId: 'ent-payment', sourceType: 'wechat_order', sourceId: ORDER_NO,
    idempotent: false, effectiveStartAt: NOW.toISOString(), effectiveEndAt: END,
    membershipStartedAt: NOW.toISOString(), membershipExpireAt: END
  }
  const entitlementStore = {
    async lockMembershipScheduleInTransaction(receivedConnection, userId) {
      calls.lock += 1; assert.equal(receivedConnection, connection); assert.equal(userId, '42')
      if (overrides.evidenceChangeAfterLock) evidence = false
      return { entitlement: {}, grants: [] }
    },
    async grantMembershipDurationInTransaction(receivedConnection, input) {
      calls.grant += 1; assert.equal(receivedConnection, connection)
      if (overrides.grantError) throw new Error('membership core failed')
      assert.equal(input.userId, '42'); assert.equal(input.sourceType, 'wechat_order')
      assert.equal(input.sourceId, ORDER_NO)
      assert.equal(input.idempotencyKey, `membership_grant:wechat_order:${ORDER_NO}`)
      assert.equal(Object.hasOwn(input, 'durationSeconds'), false)
      return membership
    },
    async verifyMembershipGrantInTransaction(receivedConnection, input) {
      calls.verify += 1; assert.equal(receivedConnection, connection)
      assert.equal(input.grantId, '9'); assert.equal(input.transactionId, 'ent-payment')
      return { ...membership, idempotent: true }
    }
  }
  const store = createVirtualPaymentStore({
    pool: { async getConnection() { return connection } }, entitlementStore
  })
  return { store, calls, getRow: () => row, setEvidence: (value) => { evidence = value } }
}

for (const failure of [
  { grantError: true, expectedUpdates: 0, expectedRollback: 1 },
  { updateAffectedRows: 0, expectedUpdates: 1, expectedRollback: 1 },
  { commitError: true, expectedUpdates: 1, expectedRollback: 1 },
  { grantError: true, rollbackError: true, expectedUpdates: 0, expectedRollback: 1 },
  { grantError: true, rollbackError: true, releaseError: true, expectedUpdates: 0, expectedRollback: 1 },
  { releaseError: true, expectedUpdates: 1, expectedRollback: 0 }
]) {
  const { store, calls } = harness(failure)
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('42', ORDER_NO, { expectedProductId: 'sandbox-product', now: NOW }),
    (error) => {
      const serialized = JSON.stringify(error)
      return ['PAYMENT_DATABASE_FAILED', 'PAYMENT_MEMBERSHIP_GRANT_FAILED', 'PAYMENT_SERVICE_UNAVAILABLE'].includes(error.code) &&
        !serialized.includes('membership core failed') && !serialized.includes('rollback failed') &&
        !serialized.includes('release failed')
    }
  )
  assert.equal(calls.updates, failure.expectedUpdates)
  assert.equal(calls.rollback, failure.expectedRollback)
  assert.equal(calls.release, 1)
}

{
  const { store, calls } = harness({ evidenceChangeAfterLock: true })
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('42', ORDER_NO, { expectedProductId: 'sandbox-product', now: NOW }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )
  assert.equal(calls.lock, 1)
  assert.equal(calls.grant, 0)
  assert.equal(calls.updates, 0)
  assert.equal(calls.rollback, 1)
  assert.equal(calls.release, 1)
}

{
  const { store, calls, getRow } = harness()
  const result = await store.grantTrustedPaidOrderEntitlement('42', ORDER_NO, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(result.idempotent, false)
  assert.equal(result.order.entitlementStatus, 'granted')
  assert.equal(result.order.deliveryStatus, 'not_ready')
  assert.equal(getRow().membership_grant_id, 9)
  assert.deepEqual(calls, { begin: 1, commit: 1, rollback: 0, release: 1, execute: 5, lock: 1, grant: 1, verify: 0, updates: 1 })
}

{
  const { store, calls } = harness({ order: {
    entitlement_status: 'granted', membership_grant_id: 9,
    entitlement_transaction_id: 'ent-payment', entitlement_granted_at: NOW
  } })
  const result = await store.grantTrustedPaidOrderEntitlement('42', ORDER_NO, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(result.idempotent, true)
  assert.equal(calls.grant, 0)
  assert.equal(calls.verify, 1)
  assert.equal(calls.updates, 0)
}

{
  const { store, calls } = harness({ evidence: false })
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('42', ORDER_NO, { expectedProductId: 'sandbox-product', now: NOW }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )
  assert.equal(calls.grant, 0)
  assert.equal(calls.updates, 0)
  assert.equal(calls.rollback, 1)
}

for (const mutation of [
  { payment_status: 'pending' }, { paid_amount_fen: 2999 }, { product_id: 'wrong' },
  { delivery_status: 'delivered', delivered_at: NOW }
]) {
  const { store, calls } = harness({ order: mutation })
  await assert.rejects(store.grantTrustedPaidOrderEntitlement('42', ORDER_NO, {
    expectedProductId: 'sandbox-product', now: NOW
  }))
  assert.equal(calls.grant, 0)
  assert.equal(calls.updates, 0)
}

function membershipIntegrityFixture(overrides = {}) {
  const grantId = String(overrides.targetGrantId || '9')
  const sourceId = overrides.targetSourceId || ORDER_NO
  const transactionId = overrides.targetTransactionId || 'ent-payment'
  const idempotencyKey = overrides.targetIdempotencyKey || `membership_grant:wechat_order:${sourceId}`
  const grant = {
    id: Number(grantId), user_id: 42, source_type: 'wechat_order', source_id: sourceId,
    redemption_code_id: null, days_granted: 30, duration_seconds: 2_592_000,
    status: 'granted', granted_at: NOW, effective_start_at: NOW, effective_end_at: new Date(END),
    consumed_seconds_at_revoke: 0, revoked_seconds: 0, revoked_at: null, revoked_by: null,
    revoke_reason: null, idempotency_key: idempotencyKey, grant_transaction_id: transactionId,
    revoke_transaction_id: null, created_at: NOW, updated_at: NOW,
    ...(overrides.grant || {})
  }
  const entitlement = {
    id: 3, user_id: 42, quota_balance: 30, quota_total_granted: 30,
    quota_total_consumed: 0, quota_total_expired: 0, membership_type: 'monthly',
    membership_status: 'active', membership_started_at: NOW, membership_expire_at: new Date(END),
    last_transaction_id: 7, created_at: NOW, updated_at: NOW,
    ...(overrides.entitlement || {})
  }
  const metadata = {
    membershipGrantId: grantId, membershipType: 'monthly', daysGranted: 30,
    durationSeconds: 2_592_000, effectiveStartAt: NOW.toISOString(), effectiveEndAt: END,
    durationRule: '30x24_hours_not_calendar_month', ...(overrides.metadata || {})
  }
  const transaction = {
    id: 7, transaction_id: transactionId, user_id: 42, transaction_type: 'MEMBERSHIP_GRANT',
    amount: 0, balance_after: 30, source: 'wechat_order', source_id: sourceId,
    expires_at: null, grant_transaction_id: null, root_learning_object_id: null,
    current_learning_object_id: null, access_context_json: null, idempotency_key: idempotencyKey,
    operator_type: 'system', operator_id: 'virtual-payment-entitlement',
    reason: 'Verified WeChat virtual payment membership grant.', metadata_json: metadata,
    created_at: NOW, ...(overrides.transaction || {})
  }
  const registrationTransaction = {
    id: 6, transaction_id: 'ent-registration', user_id: 42, transaction_type: 'REGISTER_BONUS',
    amount: 30, balance_after: 30, source: 'registration', source_id: '42',
    expires_at: new Date('2027-08-31T00:00:00.000Z'), grant_transaction_id: null,
    root_learning_object_id: null, current_learning_object_id: null, access_context_json: null,
    idempotency_key: 'registration_bonus:42', operator_type: 'system', operator_id: 'auth-registration',
    reason: 'New user registration bonus.', metadata_json: null,
    created_at: new Date(NOW.getTime() - 1_000)
  }
  const transactions = overrides.transactions || [registrationTransaction, transaction]
  const grants = overrides.grants || [grant]
  const calls = { execute: 0, writes: 0 }
  const connection = {
    async execute(sql) {
      calls.execute += 1
      if (!/^\s*SELECT\b/.test(sql)) calls.writes += 1
      if (sql.includes('FROM `user_entitlements`')) return [[entitlement]]
      if (sql.includes('FROM `membership_grants`')) return [grants]
      if (sql.includes('FROM `entitlement_transactions`')) return [transactions]
      throw new Error('unexpected membership integrity SQL')
    }
  }
  const store = createUserEntitlementStore({ pool: {} })
  return {
    calls,
    verify: () => store.verifyMembershipGrantInTransaction(connection, {
      userId: '42', grantId, sourceType: 'wechat_order', sourceId,
      idempotencyKey, transactionId
    })
  }
}

function ledgerTransaction({
  id, transactionId, transactionType, amount, balanceAfter, createdAt,
  source = 'admin', sourceId = null, idempotencyKey = transactionId,
  operatorType = 'system', operatorId = null, reason = null, metadata = null
}) {
  return {
    id, transaction_id: transactionId, user_id: 42, transaction_type: transactionType,
    amount, balance_after: balanceAfter, source, source_id: sourceId, expires_at: null,
    grant_transaction_id: null, root_learning_object_id: null,
    current_learning_object_id: null, access_context_json: null,
    idempotency_key: idempotencyKey, operator_type: operatorType,
    operator_id: operatorId, reason, metadata_json: metadata, created_at: createdAt
  }
}

function paymentMembershipTransaction({
  id = 7, transactionId = 'ent-payment', sourceId = ORDER_NO,
  grantId = '9', balanceAfter = 30, effectiveStartAt = NOW,
  effectiveEndAt = new Date(END), createdAt = NOW
} = {}) {
  const idempotencyKey = `membership_grant:wechat_order:${sourceId}`
  return {
    id, transaction_id: transactionId, user_id: 42, transaction_type: 'MEMBERSHIP_GRANT',
    amount: 0, balance_after: balanceAfter, source: 'wechat_order', source_id: sourceId,
    expires_at: null, grant_transaction_id: null, root_learning_object_id: null,
    current_learning_object_id: null, access_context_json: null, idempotency_key: idempotencyKey,
    operator_type: 'system', operator_id: 'virtual-payment-entitlement',
    reason: 'Verified WeChat virtual payment membership grant.',
    metadata_json: {
      membershipGrantId: String(grantId), membershipType: 'monthly', daysGranted: 30,
      durationSeconds: 2_592_000, effectiveStartAt: effectiveStartAt.toISOString(),
      effectiveEndAt: effectiveEndAt.toISOString(), durationRule: '30x24_hours_not_calendar_month'
    },
    created_at: createdAt
  }
}

{
  const laterAdminGrant = {
    id: 8, transaction_id: 'ent-admin-later', user_id: 42, transaction_type: 'ADMIN_GRANT',
    amount: 5, balance_after: 35, source: 'admin', source_id: 'admin-op-later', expires_at: null,
    grant_transaction_id: null, root_learning_object_id: null, current_learning_object_id: null,
    access_context_json: null, idempotency_key: 'admin_grant:later', operator_type: 'admin',
    operator_id: 'admin-1', reason: 'Later quota adjustment.', metadata_json: null,
    created_at: new Date(NOW.getTime() + 1_000)
  }
  const withLaterGrant = membershipIntegrityFixture({
    entitlement: { quota_balance: 35, quota_total_granted: 35, last_transaction_id: 8 },
    transactions: [
      {
        id: 6, transaction_id: 'ent-registration', user_id: 42, transaction_type: 'REGISTER_BONUS',
        amount: 30, balance_after: 30, source: 'registration', source_id: '42',
        expires_at: new Date('2027-08-31T00:00:00.000Z'), grant_transaction_id: null,
        root_learning_object_id: null, current_learning_object_id: null, access_context_json: null,
        idempotency_key: 'registration_bonus:42', operator_type: 'system', operator_id: 'auth-registration',
        reason: 'New user registration bonus.', metadata_json: null,
        created_at: new Date(NOW.getTime() - 1_000)
      },
      {
        id: 7, transaction_id: 'ent-payment', user_id: 42, transaction_type: 'MEMBERSHIP_GRANT',
        amount: 0, balance_after: 30, source: 'wechat_order', source_id: ORDER_NO,
        expires_at: null, grant_transaction_id: null, root_learning_object_id: null,
        current_learning_object_id: null, access_context_json: null,
        idempotency_key: `membership_grant:wechat_order:${ORDER_NO}`, operator_type: 'system',
        operator_id: 'virtual-payment-entitlement', reason: 'Verified WeChat virtual payment membership grant.',
        metadata_json: {
          membershipGrantId: '9', membershipType: 'monthly', daysGranted: 30,
          durationSeconds: 2_592_000, effectiveStartAt: NOW.toISOString(), effectiveEndAt: END,
          durationRule: '30x24_hours_not_calendar_month'
        }, created_at: NOW
      },
      laterAdminGrant
    ]
  })
  const result = await withLaterGrant.verify()
  assert.equal(result.idempotent, true)
  assert.equal(result.quotaBalance, 35)
  assert.equal(withLaterGrant.calls.writes, 0)

  for (const invalid of [
    { transactionBalance: 29, snapshotBalance: 35, snapshotGranted: 35 },
    { transactionBalance: 30, snapshotBalance: 34, snapshotGranted: 35 }
  ]) {
    const broken = membershipIntegrityFixture({
      entitlement: {
        quota_balance: invalid.snapshotBalance,
        quota_total_granted: invalid.snapshotGranted,
        last_transaction_id: 8
      },
      transactions: [
        {
          id: 6, transaction_id: 'ent-registration', user_id: 42, transaction_type: 'REGISTER_BONUS',
          amount: 30, balance_after: 30, source: 'registration', source_id: '42', expires_at: null,
          grant_transaction_id: null, root_learning_object_id: null, current_learning_object_id: null,
          access_context_json: null, idempotency_key: 'registration_bonus:42', operator_type: 'system',
          operator_id: 'auth-registration', reason: null, metadata_json: null,
          created_at: new Date(NOW.getTime() - 1_000)
        },
        {
          id: 7, transaction_id: 'ent-payment', user_id: 42, transaction_type: 'MEMBERSHIP_GRANT',
          amount: 0, balance_after: invalid.transactionBalance, source: 'wechat_order', source_id: ORDER_NO,
          expires_at: null, grant_transaction_id: null, root_learning_object_id: null,
          current_learning_object_id: null, access_context_json: null,
          idempotency_key: `membership_grant:wechat_order:${ORDER_NO}`, operator_type: 'system',
          operator_id: 'virtual-payment-entitlement', reason: 'Verified WeChat virtual payment membership grant.',
          metadata_json: {
            membershipGrantId: '9', membershipType: 'monthly', daysGranted: 30,
            durationSeconds: 2_592_000, effectiveStartAt: NOW.toISOString(), effectiveEndAt: END,
            durationRule: '30x24_hours_not_calendar_month'
          }, created_at: NOW
        },
        laterAdminGrant
      ]
    })
    await assert.rejects(broken.verify(), (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID')
    assert.equal(broken.calls.writes, 0)
  }
}

{
  const fixture = membershipIntegrityFixture()
  const result = await fixture.verify()
  assert.equal(result.idempotent, true)
  assert.equal(result.grantId, '9')
  assert.equal(fixture.calls.writes, 0)
}

{
  const registration = ledgerTransaction({
    id: 5, transactionId: 'ent-registration-ledger', transactionType: 'REGISTER_BONUS',
    amount: 30, balanceAfter: 30, source: 'registration', sourceId: '42',
    idempotencyKey: 'registration_bonus:ledger-42', createdAt: new Date(NOW.getTime() - 2_000)
  })
  const adminDeduct = ledgerTransaction({
    id: 6, transactionId: 'ent-admin-deduct', transactionType: 'ADMIN_DEDUCT',
    amount: -1, balanceAfter: 29, sourceId: 'admin-deduct-1',
    idempotencyKey: 'admin_deduct:ledger-42', operatorType: 'admin', operatorId: 'admin-1',
    createdAt: new Date(NOW.getTime() - 1_000)
  })
  const fixture = membershipIntegrityFixture({
    entitlement: { quota_balance: 29, quota_total_granted: 30, last_transaction_id: 7 },
    transaction: { id: 7, balance_after: 29 },
    transactions: [registration, adminDeduct, paymentMembershipTransaction({ balanceAfter: 29 })]
  })
  const result = await fixture.verify()
  assert.equal(result.quotaBalance, 29)
  assert.equal(fixture.calls.writes, 0)

  for (const entitlement of [
    { quota_total_granted: 29 },
    { quota_total_consumed: 1 },
    { quota_total_expired: 1 },
    { quota_balance: 30 }
  ]) {
    const corrupted = membershipIntegrityFixture({
      entitlement: { quota_balance: 29, quota_total_granted: 30, last_transaction_id: 7, ...entitlement },
      transaction: { id: 7, balance_after: 29 },
      transactions: [registration, adminDeduct, paymentMembershipTransaction({ balanceAfter: 29 })]
    })
    await assert.rejects(corrupted.verify(), (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID')
    assert.equal(corrupted.calls.writes, 0)
  }
}

{
  const ledger = [
    ledgerTransaction({
      id: 5, transactionId: 'ent-ledger-register', transactionType: 'REGISTER_BONUS',
      amount: 30, balanceAfter: 30, source: 'registration', sourceId: '42',
      createdAt: new Date(NOW.getTime() - 5_000)
    }),
    ledgerTransaction({
      id: 6, transactionId: 'ent-ledger-admin-deduct', transactionType: 'ADMIN_DEDUCT',
      amount: -1, balanceAfter: 29, sourceId: 'admin-deduct-ledger',
      createdAt: new Date(NOW.getTime() - 4_000)
    }),
    ledgerTransaction({
      id: 7, transactionId: 'ent-ledger-content', transactionType: 'CONTENT_ACCESS',
      amount: -2, balanceAfter: 27, source: 'word_access', sourceId: 'word-1',
      createdAt: new Date(NOW.getTime() - 3_000)
    }),
    ledgerTransaction({
      id: 8, transactionId: 'ent-ledger-expire', transactionType: 'EXPIRE_DEDUCT',
      amount: -3, balanceAfter: 24, source: 'expiry', sourceId: 'expiry-1',
      createdAt: new Date(NOW.getTime() - 2_000)
    }),
    ledgerTransaction({
      id: 9, transactionId: 'ent-ledger-admin-grant', transactionType: 'ADMIN_GRANT',
      amount: 5, balanceAfter: 29, sourceId: 'admin-grant-ledger',
      createdAt: new Date(NOW.getTime() - 1_000)
    }),
    paymentMembershipTransaction({ id: 10, balanceAfter: 29 })
  ]
  const fixture = membershipIntegrityFixture({
    transaction: { id: 10, balance_after: 29 },
    entitlement: {
      quota_balance: 29, quota_total_granted: 35, quota_total_consumed: 2,
      quota_total_expired: 3, last_transaction_id: 10
    },
    transactions: ledger
  })
  assert.equal((await fixture.verify()).quotaBalance, 29)
  assert.equal(fixture.calls.writes, 0)

  for (const [index, mutation] of [
    [1, { amount: 1 }],
    [2, { amount: 2 }],
    [3, { amount: 3 }],
    [4, { amount: -5 }],
    [2, { transaction_type: 'REFUND_RESTORE' }]
  ]) {
    const corruptedLedger = ledger.map((transaction, transactionIndex) => (
      transactionIndex === index ? { ...transaction, ...mutation } : transaction
    ))
    const corrupted = membershipIntegrityFixture({
      transaction: { id: 10, balance_after: 29 },
      entitlement: {
        quota_balance: 29, quota_total_granted: 35, quota_total_consumed: 2,
        quota_total_expired: 3, last_transaction_id: 10
      },
      transactions: corruptedLedger
    })
    await assert.rejects(corrupted.verify(), (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID')
    assert.equal(corrupted.calls.writes, 0)
  }
}

for (const corruption of [
  { transaction: { amount: 1 } },
  { transaction: { balance_after: 29 } },
  { transaction: { expires_at: NOW } },
  { transaction: { grant_transaction_id: 8 } },
  { transaction: { source: 'admin_gift' } },
  { transaction: { transaction_type: 'ADMIN_GRANT' } },
  { transaction: { operator_id: 'another-operation' } },
  { transaction: { reason: 'Different membership operation.' } },
  { transaction: { root_learning_object_id: 'word-1' } },
  { metadata: { membershipType: 'annual' } },
  { metadata: { unexpected: true } },
  { entitlement: { membership_type: 'none' } },
  { entitlement: { membership_status: 'none' } },
  { entitlement: { membership_started_at: null } },
  { entitlement: { membership_expire_at: new Date(NOW.getTime() + 1_000) } }
]) {
  const fixture = membershipIntegrityFixture(corruption)
  await assert.rejects(fixture.verify(), (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID')
  assert.equal(fixture.calls.writes, 0)
}

{
  const fixture = membershipIntegrityFixture({ grant: {
    status: 'revoked', effective_end_at: NOW, consumed_seconds_at_revoke: 0,
    revoked_seconds: 2_592_000, revoked_at: NOW, revoked_by: 'admin-test',
    revoke_reason: 'revoked', revoke_transaction_id: 'ent-revoke'
  } })
  await assert.rejects(fixture.verify(), (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID')
  assert.equal(fixture.calls.writes, 0)
}

{
  const historicalStart = new Date('2026-01-01T00:00:00.000Z')
  const historicalEnd = new Date('2026-01-31T00:00:00.000Z')
  const historicalGrant = {
    id: 8, user_id: 42, source_type: 'admin_gift', source_id: 'historical-january',
    redemption_code_id: null, days_granted: 30, duration_seconds: 2_592_000,
    status: 'granted', granted_at: historicalStart, effective_start_at: historicalStart,
    effective_end_at: historicalEnd, consumed_seconds_at_revoke: 0, revoked_seconds: 0,
    revoked_at: null, revoked_by: null, revoke_reason: null,
    idempotency_key: 'membership_grant:admin:historical-january',
    grant_transaction_id: 'ent-historical', revoke_transaction_id: null,
    created_at: historicalStart, updated_at: historicalStart
  }
  const currentGrant = {
    id: 9, user_id: 42, source_type: 'wechat_order', source_id: ORDER_NO,
    redemption_code_id: null, days_granted: 30, duration_seconds: 2_592_000,
    status: 'granted', granted_at: NOW, effective_start_at: NOW, effective_end_at: new Date(END),
    consumed_seconds_at_revoke: 0, revoked_seconds: 0, revoked_at: null, revoked_by: null,
    revoke_reason: null, idempotency_key: `membership_grant:wechat_order:${ORDER_NO}`,
    grant_transaction_id: 'ent-payment', revoke_transaction_id: null, created_at: NOW, updated_at: NOW
  }
  const gapFixture = membershipIntegrityFixture({ grants: [historicalGrant, currentGrant] })
  const gapResult = await gapFixture.verify()
  assert.equal(gapResult.membershipStartedAt, NOW.toISOString())
  assert.equal(gapResult.membershipExpireAt, END)
  assert.equal(gapFixture.calls.writes, 0)

  const continuousStart = new Date(NOW.getTime() - 2_592_000_000)
  const continuousGrant = {
    ...historicalGrant,
    granted_at: continuousStart,
    effective_start_at: continuousStart,
    effective_end_at: NOW,
    created_at: continuousStart,
    updated_at: continuousStart
  }
  const continuousFixture = membershipIntegrityFixture({
    grants: [continuousGrant, currentGrant],
    entitlement: { membership_started_at: continuousStart }
  })
  const continuousResult = await continuousFixture.verify()
  assert.equal(continuousResult.membershipStartedAt, continuousStart.toISOString())
  assert.equal(continuousResult.membershipExpireAt, END)
  assert.equal(continuousFixture.calls.writes, 0)
}

{
  const januaryStart = new Date('2026-01-01T00:00:00.000Z')
  const januaryEnd = new Date('2026-01-31T00:00:00.000Z')
  const orderA = 'VPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB'
  const orderB = ORDER_NO
  const grantA = {
    id: 8, user_id: 42, source_type: 'wechat_order', source_id: orderA,
    redemption_code_id: null, days_granted: 30, duration_seconds: 2_592_000,
    status: 'granted', granted_at: januaryStart, effective_start_at: januaryStart,
    effective_end_at: januaryEnd, consumed_seconds_at_revoke: 0, revoked_seconds: 0,
    revoked_at: null, revoked_by: null, revoke_reason: null,
    idempotency_key: `membership_grant:wechat_order:${orderA}`,
    grant_transaction_id: 'ent-payment-a', revoke_transaction_id: null,
    created_at: januaryStart, updated_at: januaryStart
  }
  const grantB = {
    id: 9, user_id: 42, source_type: 'wechat_order', source_id: orderB,
    redemption_code_id: null, days_granted: 30, duration_seconds: 2_592_000,
    status: 'granted', granted_at: NOW, effective_start_at: NOW, effective_end_at: new Date(END),
    consumed_seconds_at_revoke: 0, revoked_seconds: 0, revoked_at: null, revoked_by: null,
    revoke_reason: null, idempotency_key: `membership_grant:wechat_order:${orderB}`,
    grant_transaction_id: 'ent-payment-b', revoke_transaction_id: null,
    created_at: NOW, updated_at: NOW
  }
  const registration = ledgerTransaction({
    id: 5, transactionId: 'ent-registration-gap', transactionType: 'REGISTER_BONUS',
    amount: 30, balanceAfter: 30, source: 'registration', sourceId: '42',
    idempotencyKey: 'registration_bonus:gap-42', createdAt: new Date(januaryStart.getTime() - 1_000)
  })
  const transactions = [
    registration,
    paymentMembershipTransaction({
      id: 6, transactionId: 'ent-payment-a', sourceId: orderA, grantId: '8',
      effectiveStartAt: januaryStart, effectiveEndAt: januaryEnd, createdAt: januaryStart
    }),
    paymentMembershipTransaction({
      id: 7, transactionId: 'ent-payment-b', sourceId: orderB, grantId: '9',
      effectiveStartAt: NOW, effectiveEndAt: new Date(END), createdAt: NOW
    })
  ]
  const common = {
    grants: [grantA, grantB], transactions,
    entitlement: {
      membership_started_at: NOW, membership_expire_at: new Date(END), last_transaction_id: 7
    }
  }
  const replayA = membershipIntegrityFixture({
    ...common, targetGrantId: '8', targetSourceId: orderA,
    targetTransactionId: 'ent-payment-a',
    targetIdempotencyKey: `membership_grant:wechat_order:${orderA}`
  })
  const replayAResult = await replayA.verify()
  assert.equal(replayAResult.grantId, '8')
  assert.equal(replayAResult.effectiveStartAt, januaryStart.toISOString())
  assert.equal(replayAResult.membershipStartedAt, NOW.toISOString())
  assert.equal(replayAResult.membershipExpireAt, END)
  assert.equal(replayA.calls.writes, 0)

  const replayB = membershipIntegrityFixture({
    ...common, targetGrantId: '9', targetSourceId: orderB,
    targetTransactionId: 'ent-payment-b',
    targetIdempotencyKey: `membership_grant:wechat_order:${orderB}`
  })
  const replayBResult = await replayB.verify()
  assert.equal(replayBResult.grantId, '9')
  assert.equal(replayBResult.membershipStartedAt, NOW.toISOString())
  assert.equal(replayB.calls.writes, 0)
  assert.equal(common.grants.filter((candidate) => candidate.source_id === orderA).length, 1)
  assert.equal(common.grants.filter((candidate) => candidate.source_id === orderB).length, 1)
  assert.equal(common.transactions.filter((candidate) => candidate.source_id === orderA).length, 1)
  assert.equal(common.transactions.filter((candidate) => candidate.source_id === orderB).length, 1)

  const tamperedHistoricalGrant = membershipIntegrityFixture({
    ...common,
    grants: [{ ...grantA, grant_transaction_id: 'ent-payment-tampered' }, grantB],
    targetGrantId: '8', targetSourceId: orderA, targetTransactionId: 'ent-payment-a',
    targetIdempotencyKey: `membership_grant:wechat_order:${orderA}`
  })
  await assert.rejects(
    tamperedHistoricalGrant.verify(),
    (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID'
  )

  for (const target of [
    { grantId: '8', sourceId: orderA, transactionId: 'ent-payment-a' },
    { grantId: '9', sourceId: orderB, transactionId: 'ent-payment-b' }
  ]) {
    const tamperedCurrentSnapshot = membershipIntegrityFixture({
      ...common,
      entitlement: {
        membership_started_at: januaryStart, membership_expire_at: januaryEnd, last_transaction_id: 7
      },
      targetGrantId: target.grantId, targetSourceId: target.sourceId,
      targetTransactionId: target.transactionId,
      targetIdempotencyKey: `membership_grant:wechat_order:${target.sourceId}`
    })
    await assert.rejects(
      tamperedCurrentSnapshot.verify(),
      (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID'
    )
    assert.equal(tamperedCurrentSnapshot.calls.writes, 0)
  }
}

{
  const secondStart = new Date(NOW.getTime() + 1_000)
  const secondEnd = new Date(secondStart.getTime() + 2_592_000_000)
  const fixture = membershipIntegrityFixture({
    grants: [{
      id: 9, user_id: 42, source_type: 'wechat_order', source_id: ORDER_NO,
      redemption_code_id: null, days_granted: 30, duration_seconds: 2_592_000,
      status: 'granted', granted_at: NOW, effective_start_at: NOW, effective_end_at: new Date(END),
      consumed_seconds_at_revoke: 0, revoked_seconds: 0, revoked_at: null, revoked_by: null,
      revoke_reason: null, idempotency_key: `membership_grant:wechat_order:${ORDER_NO}`,
      grant_transaction_id: 'ent-payment', revoke_transaction_id: null, created_at: NOW, updated_at: NOW
    }, {
      id: 10, user_id: 42, source_type: 'admin_gift', source_id: 'admin-op',
      redemption_code_id: null, days_granted: 30, duration_seconds: 2_592_000,
      status: 'granted', granted_at: secondStart, effective_start_at: secondStart, effective_end_at: secondEnd,
      consumed_seconds_at_revoke: 0, revoked_seconds: 0, revoked_at: null, revoked_by: null,
      revoke_reason: null, idempotency_key: 'membership_grant:admin:admin-op',
      grant_transaction_id: 'ent-admin', revoke_transaction_id: null, created_at: secondStart, updated_at: secondStart
    }]
  })
  await assert.rejects(fixture.verify(), (error) => error.code === 'MEMBERSHIP_GRANT_INTEGRITY_INVALID')
  assert.equal(fixture.calls.writes, 0)
}

{
  let poolConnectionCalls = 0
  let executeCalls = 0
  const connection = {
    async execute(sql) {
      executeCalls += 1
      if (sql.startsWith('INSERT IGNORE INTO `user_entitlements`')) return [{ affectedRows: 1 }]
      if (sql.includes('FROM `user_entitlements`')) {
        return [[{
          id: 1, user_id: 42, quota_balance: 0, quota_total_granted: 0,
          quota_total_consumed: 0, quota_total_expired: 0, membership_type: null,
          membership_status: 'none', membership_started_at: null, membership_expire_at: null,
          last_transaction_id: null, created_at: NOW, updated_at: NOW
        }]]
      }
      if (sql.includes('FROM `membership_grants`')) return [[]]
      throw new Error('unexpected membership lock SQL')
    }
  }
  const store = createUserEntitlementStore({
    pool: { async getConnection() { poolConnectionCalls += 1; throw new Error('second connection forbidden') } }
  })
  const locked = await store.lockMembershipScheduleInTransaction(connection, '42')
  assert.equal(locked.entitlement.userId, '42')
  assert.deepEqual(locked.grants, [])
  assert.equal(executeCalls, 3)
  assert.equal(poolConnectionCalls, 0)
}

{
  const now = new Date('2026-01-01T00:00:00.000Z')
  const schedule = scheduleMembershipGrant({
    now,
    membershipExpireAt: '2026-03-31T00:00:00.000Z',
    grants: [{
      id: 'revoked-future', status: 'revoked', grantedAt: '2025-12-01T00:00:00.000Z',
      durationSeconds: 2_592_000, effectiveStartAt: '2026-03-01T00:00:00.000Z',
      effectiveEndAt: '2026-03-01T00:00:00.000Z', consumedSecondsAtRevoke: 0,
      revokedSeconds: 2_592_000
    }]
  })
  assert.equal(schedule.effectiveStartAt, now.toISOString())
  assert.equal(schedule.effectiveEndAt, '2026-01-31T00:00:00.000Z')
}

console.log('virtual payment entitlement store tests passed')
