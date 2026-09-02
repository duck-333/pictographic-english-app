import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

import { hashBookBenefitRedemptionCode } from '../server/book-benefit-code.mjs'
import { createBookBenefitStore } from '../server/book-benefit-store.mjs'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'
import { normalizeVerifiedWechatQueryFact } from '../server/virtual-payment-reconciliation.mjs'
import { createVirtualPaymentStore } from '../server/virtual-payment-store.mjs'
import { runWithGuaranteedCleanup } from './test-virtual-payment-mysql-integration.mjs'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3308
const EXPECTED_VERSION = '8.0.46'
const EXPECTED_CONFIRMATION = 'local-docker-virtual-payment-only'
const SAFE_DATABASE_PATTERN = /^virtual_payment_entitlement_test_[a-f0-9]{12}$/
const NOW = new Date('2026-08-31T00:00:00.000Z')
const MIGRATIONS = [
  '001_create_user_phone_bindings.sql',
  '004_create_user_entitlements.sql',
  '005_create_entitlement_transactions.sql',
  '006_create_membership_grants.sql',
  '007_create_book_benefit_redemption_foundation.sql',
  '008_extend_book_benefit_issuance_review.sql',
  '009_create_virtual_payment_foundation.sql'
].map((fileName) => new URL(`../database/migrations/${fileName}`, import.meta.url))
const BOOK_CODE = 'BF30-2345-6789-ABCD-EFGH'
const BOOK_CODE_SECRET = 'vp6-isolated-book-benefit-code-secret-20260831'

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

function quoteDatabase(value) {
  assert.match(value, SAFE_DATABASE_PATTERN)
  return `\`${value}\``
}

async function assertDatabaseAbsent(connection, databaseName) {
  const [rows] = await connection.execute(
    'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [databaseName]
  )
  assert.equal(rows.length, 0)
}

function orderInput(userId, clientRequestId) {
  return {
    userId, clientRequestId, internalSku: 'membership_30d', productId: 'sandbox-product',
    productName: '30天学习会员', quantity: 1, unitPriceFen: 3000, orderAmountFen: 3000,
    currency: 'CNY', environment: 'sandbox', wechatEnv: 1,
    paymentChannel: 'wechat_virtual_payment', clientPlatform: 'android'
  }
}

async function createTrustedPaidOrder(store, userId, clientRequestId, suffix, paidAt = NOW) {
  const created = await store.createOrder(orderInput(userId, clientRequestId))
  const pending = await store.markOrderPending(userId, created.order.orderNo)
  const query = {
    orderId: pending.orderNo, wechatOrderId: `WXORDER${suffix}`,
    wechatPaymentOrderId: `WXPAY${suffix}`, status: 2, orderType: 0,
    orderFeeFen: 3000, paidFeeFen: 3000, paidAtSeconds: Math.floor(paidAt.getTime() / 1000),
    providedAtSeconds: null, environmentType: 2, environment: 'sandbox'
  }
  const fact = normalizeVerifiedWechatQueryFact(query, pending, { now: () => paidAt.getTime() })
  const reconciled = await store.reconcileVerifiedWechatQuery(userId, pending.orderNo, fact, {
    expectedProductId: 'sandbox-product'
  })
  assert.equal(reconciled.order.paymentStatus, 'paid')
  return reconciled.order
}

function createTwoConnectionBarrierPool(pool) {
  let arrivals = 0
  let connectionRequests = 0
  let openBarrier
  const barrier = new Promise((resolveBarrier) => { openBarrier = resolveBarrier })
  return {
    get arrivals() { return arrivals },
    get connectionRequests() { return connectionRequests },
    async getConnection() {
      connectionRequests += 1
      const connection = await pool.getConnection()
      if (arrivals < 2) {
        arrivals += 1
        if (arrivals === 2) openBarrier()
        await barrier
      }
      return connection
    }
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function createExecuteInterceptingPool(pool, interceptExecute) {
  return {
    async getConnection() {
      const connection = await pool.getConnection()
      return {
        beginTransaction: connection.beginTransaction.bind(connection),
        commit: connection.commit.bind(connection),
        rollback: connection.rollback.bind(connection),
        release: connection.release.bind(connection),
        execute(sql, values) {
          return interceptExecute(connection, sql, values)
        }
      }
    }
  }
}

async function runScenarios(pool, databaseConfig) {
  const entitlementStore = createUserEntitlementStore({ pool, now: () => new Date(NOW) })
  const bookBenefitStore = createBookBenefitStore({
    pool,
    entitlementStore,
    redemptionCodeHashSecret: BOOK_CODE_SECRET,
    secretEnv: { NODE_ENV: 'test', REDEMPTION_CODE_HASH_SECRET: BOOK_CODE_SECRET }
  })
  const store = createVirtualPaymentStore({
    pool, userEntitlementStore: entitlementStore,
    orderNoFactory: () => `VP${crypto.randomBytes(15).toString('hex').toUpperCase()}`
  })
  const first = await createTrustedPaidOrder(store, '301', 'entitlement-request-301-a', '301A')
  const firstGrant = await store.grantTrustedPaidOrderEntitlement('301', first.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(firstGrant.idempotent, false)
  assert.equal(Date.parse(firstGrant.membership.effectiveEndAt) - Date.parse(firstGrant.membership.effectiveStartAt), 2_592_000_000)
  assert.equal(firstGrant.order.deliveryStatus, 'not_ready')
  const replay = await store.grantTrustedPaidOrderEntitlement('301', first.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(replay.idempotent, true)
  assert.equal(replay.membership.grantId, firstGrant.membership.grantId)
  const [[firstSnapshot]] = await pool.execute(
    'SELECT user_id, quota_balance, membership_type, membership_status, membership_started_at, membership_expire_at FROM user_entitlements WHERE user_id = ?',
    ['301']
  )
  const [firstTransactions] = await pool.execute(
    'SELECT user_id, transaction_type, amount, balance_after, expires_at, source, source_id, grant_transaction_id, metadata_json FROM entitlement_transactions WHERE transaction_id = ?',
    [firstGrant.membership.transactionId]
  )
  assert.equal(firstTransactions.length, 1)
  assert.equal(Number(firstTransactions[0].user_id), 301)
  assert.equal(firstTransactions[0].transaction_type, 'MEMBERSHIP_GRANT')
  assert.equal(firstTransactions[0].amount, 0)
  assert.equal(firstTransactions[0].balance_after, firstSnapshot.quota_balance)
  assert.equal(firstTransactions[0].expires_at, null)
  assert.equal(firstTransactions[0].source, 'wechat_order')
  assert.equal(firstTransactions[0].source_id, first.orderNo)
  assert.equal(firstTransactions[0].grant_transaction_id, null)
  assert.equal(firstSnapshot.membership_type, 'monthly')
  assert.equal(firstSnapshot.membership_status, 'active')
  assert.equal(new Date(firstSnapshot.membership_started_at).toISOString(), firstGrant.membership.membershipStartedAt)
  assert.equal(new Date(firstSnapshot.membership_expire_at).toISOString(), firstGrant.membership.membershipExpireAt)

  await entitlementStore.grantQuota({
    userId: '301', amount: 5, source: 'admin', sourceId: 'vp6-admin-quota-301',
    expiresAt: new Date('2027-08-31T00:00:00.000Z'), idempotencyKey: 'vp6-admin-quota-301',
    operatorType: 'admin', operatorId: 'admin-test', reason: 'VP6 historical balance verification.'
  })
  const replayAfterQuotaChange = await store.grantTrustedPaidOrderEntitlement('301', first.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(replayAfterQuotaChange.idempotent, true)
  assert.equal(replayAfterQuotaChange.membership.quotaBalance, 5)

  const second = await createTrustedPaidOrder(store, '301', 'entitlement-request-301-b', '301B')
  const [sameOrderA, sameOrderB] = await Promise.all([
    store.grantTrustedPaidOrderEntitlement('301', second.orderNo, { expectedProductId: 'sandbox-product', now: NOW }),
    store.grantTrustedPaidOrderEntitlement('301', second.orderNo, { expectedProductId: 'sandbox-product', now: NOW })
  ])
  assert.equal(sameOrderA.membership.grantId, sameOrderB.membership.grantId)
  assert.equal(
    Date.parse(sameOrderA.membership.effectiveStartAt),
    Date.parse(firstGrant.membership.effectiveEndAt)
  )

  const third = await createTrustedPaidOrder(store, '301', 'entitlement-request-301-c', '301C')
  const fourth = await createTrustedPaidOrder(store, '301', 'entitlement-request-301-d', '301D')
  await Promise.all([
    store.grantTrustedPaidOrderEntitlement('301', third.orderNo, { expectedProductId: 'sandbox-product', now: NOW }),
    store.grantTrustedPaidOrderEntitlement('301', fourth.orderNo, { expectedProductId: 'sandbox-product', now: NOW })
  ])

  const fifth = await createTrustedPaidOrder(store, '301', 'entitlement-request-301-e', '301E')
  await Promise.all([
    store.grantTrustedPaidOrderEntitlement('301', fifth.orderNo, { expectedProductId: 'sandbox-product', now: NOW }),
    entitlementStore.grantMembershipDuration({
      userId: '301', sourceType: 'admin_gift', sourceId: 'admin-concurrent-301',
      idempotencyKey: 'membership_grant:admin_concurrent_301', operatorType: 'admin',
      operatorId: 'admin-test', reason: 'Concurrent admin membership test.', now: NOW
    })
  ])

  const sixth = await createTrustedPaidOrder(store, '301', 'entitlement-request-301-f', '301F')
  const campaignPhoneIdentityHash = crypto.createHash('sha256').update('vp6-book-phone-301').digest()
  const codeIdentity = hashBookBenefitRedemptionCode(BOOK_CODE, {
    secret: BOOK_CODE_SECRET,
    env: { NODE_ENV: 'test', REDEMPTION_CODE_HASH_SECRET: BOOK_CODE_SECRET }
  })
  const [campaignInsert] = await pool.execute(
    `INSERT INTO book_benefit_campaigns
      (campaign_key, name, status, benefit_days, starts_at, ends_at, created_by)
     VALUES (?, ?, 'active', 30, ?, ?, ?)`,
    ['vp6-campaign', 'VP6 isolated campaign', new Date('2026-01-01T00:00:00.000Z'),
      new Date('2027-01-01T00:00:00.000Z'), 'vp6-test']
  )
  const [issuanceInsert] = await pool.execute(
    `INSERT INTO book_benefit_issuances
      (issuance_no, campaign_id, order_claim_type, approved_order_claim_hash, order_claim_hash_version,
       order_channel, status, reviewed_by, review_reason_code, reviewed_at, create_idempotency_key)
     VALUES (?, ?, 'standard', ?, 'v1', 'test', 'approved', ?, 'test_approved', ?, ?)`,
    ['VP6-ISSUANCE-301', campaignInsert.insertId, crypto.createHash('sha256').update('vp6-order-claim').digest(),
      'vp6-test', NOW, 'vp6-issuance-operation']
  )
  const [codeInsert] = await pool.execute(
    `INSERT INTO book_benefit_codes
      (issuance_id, generation_no, code_hash, code_hash_version, status, issue_idempotency_key, issued_by, issued_at, expires_at)
     VALUES (?, 1, ?, 'v1', 'issued', ?, ?, ?, ?)`,
    [issuanceInsert.insertId, codeIdentity.codeHash, 'vp6-code-operation', 'vp6-test', NOW, new Date('2027-01-01T00:00:00.000Z')]
  )
  await pool.execute(
    `INSERT INTO user_phone_bindings
      (user_id, phone_hash, phone_masked, hash_version, country_code, status, bound_at, verified_at,
       last_verified_at, campaign_phone_identity_hash, campaign_phone_hash_version)
     VALUES (?, ?, ?, 'v1', '86', 'active', ?, ?, ?, ?, 'v1')`,
    ['301', crypto.createHash('sha256').update('vp6-phone-hash-301').digest('hex'), '138****0301',
      NOW, NOW, NOW, campaignPhoneIdentityHash]
  )
  assert(codeInsert.insertId)
  await Promise.all([
    store.grantTrustedPaidOrderEntitlement('301', sixth.orderNo, { expectedProductId: 'sandbox-product', now: NOW }),
    bookBenefitStore.redeemBookBenefitCode({
      userId: '301', plaintextCode: BOOK_CODE, operationId: 'vp6-book-redeem-operation-301', now: NOW
    })
  ])

  const [grants] = await pool.execute(
    'SELECT id, user_id, source_type, source_id, duration_seconds, status, effective_start_at, effective_end_at FROM membership_grants WHERE user_id = ? ORDER BY effective_start_at, id',
    ['301']
  )
  assert.equal(grants.length, 8)
  assert(grants.every((grant) => Number(grant.duration_seconds) === 2_592_000 && grant.status === 'granted'))
  for (let index = 1; index < grants.length; index += 1) {
    assert.equal(
      new Date(grants[index - 1].effective_end_at).getTime(),
      new Date(grants[index].effective_start_at).getTime()
    )
  }
  const [orders] = await pool.execute(
    'SELECT entitlement_status, delivery_status, membership_grant_id, entitlement_transaction_id FROM virtual_payment_orders WHERE user_id = ?',
    ['301']
  )
  assert.equal(orders.length, 6)
  assert(orders.every((order) => order.entitlement_status === 'granted' && order.delivery_status === 'not_ready'))
  assert(orders.every((order) => order.membership_grant_id && order.entitlement_transaction_id))

  await entitlementStore.grantQuota({
    userId: '314', amount: 30, source: 'registration', sourceId: '314',
    transactionType: 'REGISTER_BONUS', expiresAt: new Date('2027-08-31T00:00:00.000Z'),
    idempotencyKey: 'registration_bonus:314', operatorType: 'system',
    operatorId: 'auth-registration', reason: 'New user registration bonus.'
  })
  await entitlementStore.deductQuota({
    userId: '314', amount: 1, source: 'admin', sourceId: 'vp6-admin-deduct-314',
    idempotencyKey: 'vp6-admin-deduct-314', operatorType: 'admin',
    operatorId: 'admin-test', reason: 'VP6 ledger semantics verification.'
  })
  const ledgerOrder = await createTrustedPaidOrder(store, '314', 'entitlement-request-314-a', '314A')
  const ledgerGrant = await store.grantTrustedPaidOrderEntitlement('314', ledgerOrder.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(ledgerGrant.membership.quotaBalance, 29)
  const ledgerReplay = await store.grantTrustedPaidOrderEntitlement('314', ledgerOrder.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(ledgerReplay.idempotent, true)
  assert.equal(ledgerReplay.membership.quotaBalance, 29)
  const [[ledgerSnapshot]] = await pool.execute(
    `SELECT quota_balance, quota_total_granted, quota_total_consumed, quota_total_expired
       FROM user_entitlements WHERE user_id = ?`, ['314']
  )
  assert.equal(ledgerSnapshot.quota_balance, 29)
  assert.equal(ledgerSnapshot.quota_total_granted, 30)
  assert.equal(ledgerSnapshot.quota_total_consumed, 0)
  assert.equal(ledgerSnapshot.quota_total_expired, 0)

  const damaged = await createTrustedPaidOrder(store, '302', 'entitlement-request-302-a', '302A')
  await pool.execute('DELETE FROM virtual_payment_events WHERE order_no = ?', [damaged.orderNo])
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('302', damaged.orderNo, { expectedProductId: 'sandbox-product', now: NOW }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )
  const [[orphanCount]] = await pool.execute('SELECT COUNT(*) AS count FROM membership_grants WHERE user_id = ?', ['302'])
  assert.equal(Number(orphanCount.count), 0)
  const stillPaid = await store.findByUserAndOrderNo('302', damaged.orderNo)
  assert.equal(stillPaid.entitlementStatus, 'not_ready')
  assert.equal(stillPaid.membershipGrantId, null)

  const corrupt = await createTrustedPaidOrder(store, '303', 'entitlement-request-303-a', '303A')
  const corruptGrant = await store.grantTrustedPaidOrderEntitlement('303', corrupt.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  await pool.execute('UPDATE entitlement_transactions SET amount = 1 WHERE transaction_id = ?', [corruptGrant.membership.transactionId])
  const [[corruptBefore]] = await pool.execute(
    'SELECT (SELECT COUNT(*) FROM membership_grants WHERE user_id = ?) AS grants, (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = ?) AS transactions',
    ['303', '303']
  )
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('303', corrupt.orderNo, { expectedProductId: 'sandbox-product', now: NOW }),
    (error) => error.code === 'PAYMENT_ENTITLEMENT_INCOMPLETE'
  )
  const [[corruptAfter]] = await pool.execute(
    'SELECT (SELECT COUNT(*) FROM membership_grants WHERE user_id = ?) AS grants, (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = ?) AS transactions',
    ['303', '303']
  )
  assert.deepEqual(corruptAfter, corruptBefore)

  await pool.execute(
    `INSERT INTO user_entitlements
      (user_id, membership_type, membership_status, membership_started_at, membership_expire_at)
     VALUES (?, 'monthly', 'active', ?, ?)`,
    ['304', new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-31T00:00:00.000Z')]
  )
  await pool.execute(
    `INSERT INTO membership_grants
      (user_id, source_type, source_id, days_granted, duration_seconds, status, granted_at,
       effective_start_at, effective_end_at, consumed_seconds_at_revoke, revoked_seconds,
       revoked_at, revoked_by, revoke_reason, idempotency_key, grant_transaction_id, revoke_transaction_id)
     VALUES (?, 'admin_gift', ?, 30, 2592000, 'revoked', ?, ?, ?, 0, 2592000, ?, ?, ?, ?, ?, ?)`,
    ['304', 'revoked-future-304', new Date('2025-12-01T00:00:00.000Z'),
      new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-01T00:00:00.000Z'), NOW,
      'admin-test', 'Revoked before activation.', 'membership_grant:revoked_future_304',
      'ent-revoked-future-304', 'ent-revoke-future-304']
  )
  const revokedFutureOrder = await createTrustedPaidOrder(store, '304', 'entitlement-request-304-a', '304A')
  const revokedFutureGrant = await store.grantTrustedPaidOrderEntitlement('304', revokedFutureOrder.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(revokedFutureGrant.membership.effectiveStartAt, NOW.toISOString())
  assert.equal(revokedFutureGrant.membership.effectiveEndAt, new Date(NOW.getTime() + 2_592_000_000).toISOString())
  const revokedReplay = await store.grantTrustedPaidOrderEntitlement('304', revokedFutureOrder.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(revokedReplay.idempotent, true)

  const january = new Date('2026-01-01T00:00:00.000Z')
  const historicalOrderA = await createTrustedPaidOrder(
    store, '309', 'entitlement-request-309-a', '309A', january
  )
  const historicalPaymentA = await store.grantTrustedPaidOrderEntitlement('309', historicalOrderA.orderNo, {
    expectedProductId: 'sandbox-product', now: january
  })
  const currentOrderB = await createTrustedPaidOrder(store, '309', 'entitlement-request-309-b', '309B')
  const currentPaymentB = await store.grantTrustedPaidOrderEntitlement('309', currentOrderB.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(historicalPaymentA.membership.effectiveStartAt, january.toISOString())
  assert.equal(historicalPaymentA.membership.effectiveEndAt, '2026-01-31T00:00:00.000Z')
  assert.equal(currentPaymentB.membership.effectiveStartAt, NOW.toISOString())
  assert.equal(currentPaymentB.membership.effectiveEndAt, new Date(NOW.getTime() + 2_592_000_000).toISOString())
  const historicalReplay = await store.grantTrustedPaidOrderEntitlement('309', historicalOrderA.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  const currentReplay = await store.grantTrustedPaidOrderEntitlement('309', currentOrderB.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(historicalReplay.idempotent, true)
  assert.equal(currentReplay.idempotent, true)
  assert.equal(historicalReplay.membership.grantId, historicalPaymentA.membership.grantId)
  assert.equal(historicalReplay.membership.membershipStartedAt, NOW.toISOString())
  assert.equal(historicalReplay.membership.membershipExpireAt, currentPaymentB.membership.membershipExpireAt)
  const [[gapSnapshot]] = await pool.execute(
    'SELECT membership_started_at, membership_expire_at FROM user_entitlements WHERE user_id = ?', ['309']
  )
  assert.equal(new Date(gapSnapshot.membership_started_at).toISOString(), NOW.toISOString())
  assert.equal(
    new Date(gapSnapshot.membership_expire_at).toISOString(),
    currentPaymentB.membership.membershipExpireAt,
    'historical payment replay must preserve the current August snapshot'
  )
  const [gapPaymentGrants] = await pool.execute(
    `SELECT source_type, source_id, grant_transaction_id FROM membership_grants
      WHERE user_id = ? ORDER BY granted_at, id`, ['309']
  )
  assert.equal(gapPaymentGrants.length, 2)
  assert(gapPaymentGrants.every((row) => row.source_type === 'wechat_order' && row.grant_transaction_id))

  const newUserOrderA = await createTrustedPaidOrder(store, '310', 'entitlement-request-310-a', '310A')
  const newUserOrderB = await createTrustedPaidOrder(store, '310', 'entitlement-request-310-b', '310B')
  const twoConnectionPool = mysql.createPool({
    ...databaseConfig, connectionLimit: 2, supportBigNumbers: true, bigNumberStrings: true
  })
  const barrierPool = createTwoConnectionBarrierPool(twoConnectionPool)
  const barrierEntitlementStore = createUserEntitlementStore({ pool: barrierPool, now: () => new Date(NOW) })
  const barrierStore = createVirtualPaymentStore({
    pool: barrierPool,
    userEntitlementStore: barrierEntitlementStore,
    orderNoFactory: () => `VP${crypto.randomBytes(15).toString('hex').toUpperCase()}`
  })
  let newUserGrantA
  let newUserGrantB
  try {
    const concurrentGrants = await withTimeout(Promise.all([
      barrierStore.grantTrustedPaidOrderEntitlement('310', newUserOrderA.orderNo, {
        expectedProductId: 'sandbox-product', now: NOW
      }),
      barrierStore.grantTrustedPaidOrderEntitlement('310', newUserOrderB.orderNo, {
        expectedProductId: 'sandbox-product', now: NOW
      })
    ]), 10_000, 'two-connection membership grant concurrency timed out')
    newUserGrantA = concurrentGrants[0]
    newUserGrantB = concurrentGrants[1]
  } finally {
    await twoConnectionPool.end()
  }
  assert.equal(barrierPool.arrivals, 2)
  assert.equal(barrierPool.connectionRequests, 2)
  assert.notEqual(newUserGrantA.membership.grantId, newUserGrantB.membership.grantId)
  const [newUserGrants] = await pool.execute(
    'SELECT id, effective_start_at, effective_end_at FROM membership_grants WHERE user_id = ? ORDER BY effective_start_at, id',
    ['310']
  )
  assert.equal(newUserGrants.length, 2)
  assert.equal(new Date(newUserGrants[0].effective_end_at).getTime(), new Date(newUserGrants[1].effective_start_at).getTime())
  assert(newUserGrants.every((row) => new Date(row.effective_end_at).getTime() - new Date(row.effective_start_at).getTime() === 2_592_000_000))
  const [[newUserSnapshot]] = await pool.execute(
    'SELECT membership_started_at, membership_expire_at FROM user_entitlements WHERE user_id = ?', ['310']
  )
  assert.equal(
    new Date(newUserSnapshot.membership_started_at).getTime(),
    new Date(newUserGrants[0].effective_start_at).getTime(),
    'two-connection snapshot start must match the first grant'
  )
  assert.equal(
    new Date(newUserSnapshot.membership_expire_at).getTime(),
    new Date(newUserGrants[1].effective_end_at).getTime(),
    'two-connection snapshot expiry must match the second grant'
  )
  const [newUserTransactions] = await pool.execute(
    "SELECT source_id, COUNT(*) AS count FROM entitlement_transactions WHERE user_id = ? AND transaction_type = 'MEMBERSHIP_GRANT' GROUP BY source_id ORDER BY source_id",
    ['310']
  )
  assert.equal(newUserTransactions.length, 2)
  assert(newUserTransactions.every((row) => Number(row.count) === 1))
  const [newUserOrderLinks] = await pool.execute(
    `SELECT o.order_no, o.membership_grant_id, o.entitlement_transaction_id,
            g.source_id AS grant_source_id, t.source_id AS transaction_source_id
       FROM virtual_payment_orders o
       INNER JOIN membership_grants g ON g.id = o.membership_grant_id
       INNER JOIN entitlement_transactions t ON t.transaction_id = o.entitlement_transaction_id
      WHERE o.user_id = ? ORDER BY o.order_no`,
    ['310']
  )
  assert.equal(newUserOrderLinks.length, 2)
  assert(newUserOrderLinks.every((row) => (
    row.order_no === row.grant_source_id && row.order_no === row.transaction_source_id &&
    row.membership_grant_id && row.entitlement_transaction_id
  )))
  const newUserReplayA = await store.grantTrustedPaidOrderEntitlement('310', newUserOrderA.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  const newUserReplayB = await store.grantTrustedPaidOrderEntitlement('310', newUserOrderB.orderNo, {
    expectedProductId: 'sandbox-product', now: NOW
  })
  assert.equal(newUserReplayA.idempotent, true)
  assert.equal(newUserReplayB.idempotent, true)
  const [[newUserReplayCounts]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = 310) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = 310 AND transaction_type = 'MEMBERSHIP_GRANT') AS transactions`
  )
  assert.equal(Number(newUserReplayCounts.grants), 2)
  assert.equal(Number(newUserReplayCounts.transactions), 2)

  const snapshotFailure = await createTrustedPaidOrder(store, '311', 'entitlement-request-311-a', '311A')
  await pool.query(
    `CREATE TRIGGER fail_payment_membership_snapshot BEFORE UPDATE ON user_entitlements
     FOR EACH ROW BEGIN IF NEW.membership_status = 'active' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled failure'; END IF; END`
  )
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('311', snapshotFailure.orderNo, { expectedProductId: 'sandbox-product', now: NOW })
  )
  await pool.query('DROP TRIGGER fail_payment_membership_snapshot')
  const [[snapshotFailureState]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = 311) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = 311) AS transactions,
       (SELECT membership_type FROM user_entitlements WHERE user_id = 311) AS membership_type,
       (SELECT entitlement_status FROM virtual_payment_orders WHERE order_no = ?) AS entitlement_status`,
    [snapshotFailure.orderNo]
  )
  assert.equal(Number(snapshotFailureState.grants), 0)
  assert.equal(Number(snapshotFailureState.transactions), 0)
  assert.equal(snapshotFailureState.membership_type, null)
  assert.equal(snapshotFailureState.entitlement_status, 'not_ready')

  const affectedRowsFailure = await createTrustedPaidOrder(store, '312', 'entitlement-request-312-a', '312A')
  let interceptedOrderLinkUpdates = 0
  const affectedRowsPool = createExecuteInterceptingPool(pool, async (connection, sql, values) => {
    if (sql.startsWith('UPDATE virtual_payment_orders') && sql.includes("entitlement_status = 'granted'")) {
      interceptedOrderLinkUpdates += 1
      return [{ affectedRows: 0 }]
    }
    return connection.execute(sql, values)
  })
  const affectedRowsEntitlementStore = createUserEntitlementStore({ pool: affectedRowsPool, now: () => new Date(NOW) })
  const affectedRowsStore = createVirtualPaymentStore({ pool: affectedRowsPool, userEntitlementStore: affectedRowsEntitlementStore })
  await assert.rejects(
    affectedRowsStore.grantTrustedPaidOrderEntitlement('312', affectedRowsFailure.orderNo, {
      expectedProductId: 'sandbox-product', now: NOW
    })
  )
  assert.equal(interceptedOrderLinkUpdates, 1)
  const [[affectedRowsFailureState]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = 312) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = 312) AS transactions,
       (SELECT membership_type FROM user_entitlements WHERE user_id = 312) AS membership_type,
       (SELECT entitlement_status FROM virtual_payment_orders WHERE order_no = ?) AS entitlement_status`,
    [affectedRowsFailure.orderNo]
  )
  assert.equal(Number(affectedRowsFailureState.grants), 0)
  assert.equal(Number(affectedRowsFailureState.transactions), 0)
  assert.equal(affectedRowsFailureState.membership_type, null)
  assert.equal(affectedRowsFailureState.entitlement_status, 'not_ready')

  const evidenceChange = await createTrustedPaidOrder(store, '313', 'entitlement-request-313-a', '313A')
  let changedEvidenceInsideLock = 0
  const evidenceChangingPool = createExecuteInterceptingPool(pool, async (connection, sql, values) => {
    if (sql.includes('FROM virtual_payment_events e') && changedEvidenceInsideLock === 0) {
      changedEvidenceInsideLock += 1
      return [[]]
    }
    return connection.execute(sql, values)
  })
  const evidenceChangingEntitlementStore = createUserEntitlementStore({ pool: evidenceChangingPool, now: () => new Date(NOW) })
  const evidenceChangingStore = createVirtualPaymentStore({
    pool: evidenceChangingPool, userEntitlementStore: evidenceChangingEntitlementStore
  })
  await assert.rejects(
    evidenceChangingStore.grantTrustedPaidOrderEntitlement('313', evidenceChange.orderNo, {
      expectedProductId: 'sandbox-product', now: NOW
    }),
    (error) => error.code === 'PAYMENT_PAID_FACT_INCOMPLETE'
  )
  assert.equal(changedEvidenceInsideLock, 1)
  const [[evidenceChangeState]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = 313) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = 313) AS transactions,
       (SELECT entitlement_status FROM virtual_payment_orders WHERE order_no = ?) AS entitlement_status`,
    [evidenceChange.orderNo]
  )
  assert.equal(Number(evidenceChangeState.grants), 0)
  assert.equal(Number(evidenceChangeState.transactions), 0)
  assert.equal(evidenceChangeState.entitlement_status, 'not_ready')

  const transactionFailure = await createTrustedPaidOrder(store, '305', 'entitlement-request-305-a', '305A')
  await pool.query(
    `CREATE TRIGGER fail_payment_membership_transaction BEFORE INSERT ON entitlement_transactions
     FOR EACH ROW BEGIN IF NEW.source = 'wechat_order' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled failure'; END IF; END`
  )
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('305', transactionFailure.orderNo, { expectedProductId: 'sandbox-product', now: NOW })
  )
  await pool.query('DROP TRIGGER fail_payment_membership_transaction')
  const [[transactionFailureState]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = 305) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = 305) AS transactions,
       (SELECT membership_type FROM user_entitlements WHERE user_id = 305) AS membership_type,
       (SELECT entitlement_status FROM virtual_payment_orders WHERE order_no = ?) AS entitlement_status`,
    [transactionFailure.orderNo]
  )
  assert.equal(Number(transactionFailureState.grants), 0)
  assert.equal(Number(transactionFailureState.transactions), 0)
  assert.equal(transactionFailureState.membership_type, null)
  assert.equal(transactionFailureState.entitlement_status, 'not_ready')

  const orderLinkFailure = await createTrustedPaidOrder(store, '306', 'entitlement-request-306-a', '306A')
  await pool.query(
    `CREATE TRIGGER fail_payment_order_entitlement_link BEFORE UPDATE ON virtual_payment_orders
     FOR EACH ROW BEGIN IF NEW.entitlement_status = 'granted' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled failure'; END IF; END`
  )
  await assert.rejects(
    store.grantTrustedPaidOrderEntitlement('306', orderLinkFailure.orderNo, { expectedProductId: 'sandbox-product', now: NOW })
  )
  await pool.query('DROP TRIGGER fail_payment_order_entitlement_link')
  const [[orderLinkFailureState]] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM membership_grants WHERE user_id = 306) AS grants,
       (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id = 306) AS transactions,
       (SELECT membership_type FROM user_entitlements WHERE user_id = 306) AS membership_type,
       (SELECT entitlement_status FROM virtual_payment_orders WHERE order_no = ?) AS entitlement_status`,
    [orderLinkFailure.orderNo]
  )
  assert.equal(Number(orderLinkFailureState.grants), 0)
  assert.equal(Number(orderLinkFailureState.transactions), 0)
  assert.equal(orderLinkFailureState.membership_type, null)
  assert.equal(orderLinkFailureState.entitlement_status, 'not_ready')

  await pool.execute(
    'INSERT INTO user_entitlements (user_id) VALUES (?), (?)',
    ['307', '308']
  )
  const connectionA = await pool.getConnection()
  const connectionB = await pool.getConnection()
  try {
    await connectionA.beginTransaction()
    await entitlementStore.lockMembershipScheduleInTransaction(connectionA, '307')
    await connectionB.beginTransaction()
    const userBGrant = await entitlementStore.grantMembershipDurationInTransaction(connectionB, {
      userId: '308', sourceType: 'admin_gift', sourceId: 'admin-independent-308',
      idempotencyKey: 'membership_grant:admin_independent_308', operatorType: 'admin',
      operatorId: 'admin-test', reason: 'Independent user lock test.', now: NOW
    })
    await connectionB.commit()
    assert.equal(userBGrant.userId, '308')
    await connectionA.rollback()
  } finally {
    connectionA.release()
    connectionB.release()
  }
}

export async function runVirtualPaymentEntitlementMysqlIntegration(env = process.env) {
  const config = readConfig(env)
  const databaseName = `virtual_payment_entitlement_test_${crypto.randomBytes(6).toString('hex')}`
  const migrationSql = (await Promise.all(MIGRATIONS.map((url) => readFile(url, 'utf8')))).join('\n')
  let rootConnection
  try {
    rootConnection = await mysql.createConnection({
      host: config.host, port: config.port, user: config.user, password: config.password,
      charset: 'utf8mb4', timezone: 'Z'
    })
  } catch {
    throw new Error('isolated MySQL root connection failed')
  }
  let databaseOwned = false
  let migrationConnection = null
  let pool = null
  await runWithGuaranteedCleanup({
    secretValues: [config.password],
    cleanupSteps: [
      { phase: 'close_entitlement_pool', run: async () => { if (pool) await pool.end() } },
      { phase: 'close_entitlement_migration_connection', run: async () => { if (migrationConnection) await migrationConnection.end() } },
      { phase: 'drop_entitlement_database', run: async () => {
        if (databaseOwned) await rootConnection.query(`DROP DATABASE IF EXISTS ${quoteDatabase(databaseName)}`)
      } },
      { phase: 'verify_entitlement_database_absent', run: async () => assertDatabaseAbsent(rootConnection, databaseName) },
      { phase: 'close_entitlement_root_connection', run: async () => rootConnection.end() }
    ],
    runMain: async () => {
      const [[version]] = await rootConnection.query('SELECT VERSION() AS mysql_version')
      assert.equal(version.mysql_version, EXPECTED_VERSION)
      await assertDatabaseAbsent(rootConnection, databaseName)
      databaseOwned = true
      await rootConnection.query(`CREATE DATABASE ${quoteDatabase(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      migrationConnection = await mysql.createConnection({
        host: config.host, port: config.port, user: config.user, password: config.password,
        database: databaseName, charset: 'utf8mb4', timezone: 'Z', multipleStatements: true
      })
      await migrationConnection.query(migrationSql)
      pool = mysql.createPool({
        host: config.host, port: config.port, user: config.user, password: config.password,
        database: databaseName, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 8,
        supportBigNumbers: true, bigNumberStrings: true
      })
      await runScenarios(pool, {
        host: config.host, port: config.port, user: config.user, password: config.password,
        database: databaseName, charset: 'utf8mb4', timezone: 'Z'
      })
    }
  })
}

const isMain = Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
if (isMain) {
  await runVirtualPaymentEntitlementMysqlIntegration()
  console.log('Virtual payment entitlement isolated MySQL tests passed with no database residue.')
}
