import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { lockDatabaseUsersInTransaction, withDatabaseTransaction } from '../server/database-transaction-context.mjs'
import {
  createIdentityStore,
  isExpectedPhoneBindingUniqueConflict,
  isExpectedWechatBindingUniqueConflict
} from '../server/identity-store.mjs'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'

let forbiddenPoolCalls = 0
const forbiddenPool = { async getConnection() { forbiddenPoolCalls += 1; throw new Error('must not acquire a second connection') } }

assert.equal(isExpectedPhoneBindingUniqueConflict({
  code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'user_phone_bindings.uk_user_phone_bindings_phone_hash'"
}), true)
assert.equal(isExpectedPhoneBindingUniqueConflict({
  code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'wechat_user_bindings.uk_wechat_user_bindings_openid'"
}), false)
assert.equal(isExpectedPhoneBindingUniqueConflict({
  code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'user_phone_bindings.uk_user_phone_bindings_phone_hash_shadow'"
}), false)
assert.equal(isExpectedPhoneBindingUniqueConflict({
  code: 'ER_DUP_ENTRY', constraint: 'uk_user_phone_bindings_phone_hash'
}), true)
assert.equal(isExpectedPhoneBindingUniqueConflict({ code: 'ER_LOCK_DEADLOCK' }), false)
assert.equal(isExpectedWechatBindingUniqueConflict({
  code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'wechat_user_bindings.uk_wechat_user_bindings_openid'"
}), true)
assert.equal(isExpectedWechatBindingUniqueConflict({
  code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry 'x' for key 'invitation_registration_relations.uk_invitation_relation_invitee'"
}), false)

const campaignHash = crypto.randomBytes(32)
const identityStore = createIdentityStore({
  pool: forbiddenPool,
  phoneHashSecret: 'shared-transaction-phone-secret',
  now: () => new Date('2026-09-24T00:00:00.000Z'),
  campaignPhoneIdentityFactory: async () => ({ campaignPhoneIdentityHash: campaignHash, campaignPhoneHashVersion: 'v1' })
})
const identityConnection = {
  async beginTransaction() {}, async commit() {}, async rollback() {},
  async query(sql) {
    if (/SHOW COLUMNS FROM `users`/u.test(sql)) return [[], []]
    if (/SHOW COLUMNS FROM `wechat_user_bindings`/u.test(sql)) return [[], []]
    if (/SHOW COLUMNS FROM `user_phone_bindings`/u.test(sql)) return [[
      { Field: 'campaign_phone_identity_hash', Type: 'binary(32)', Extra: '', Null: 'NO', Default: null },
      { Field: 'campaign_phone_hash_version', Type: 'varchar(16)', Extra: '', Null: 'NO', Default: null }
    ], []]
    throw new Error(`Unexpected identity query: ${sql}`)
  },
  async execute(sql, params = []) {
    if (/SELECT id FROM users/u.test(sql)) return [params.map(id => ({ id })), []]
    if (/SELECT user_id, openid, unionid FROM `wechat_user_bindings`/u.test(sql)) {
      return [[{ user_id: '20', openid: 'openid-20', unionid: null }], []]
    }
    if (/SELECT user_id, phone_hash/u.test(sql)) return [[], []]
    if (/INSERT INTO `user_phone_bindings`/u.test(sql)) return [{ affectedRows: 1, insertId: 1 }, []]
    throw new Error(`Unexpected identity SQL: ${sql}`)
  }
}
const preparedIdentity = await identityStore.prepareWechatPhoneIdentityForTransaction({
  openid: 'openid-20', phone: { phoneNumber: '10000000000', countryCode: '86' }
})
const identityResult = await withDatabaseTransaction(identityConnection, async context => {
  const participants = await identityStore.locateWechatPhoneIdentityParticipantsInTransaction(context, preparedIdentity)
  await lockDatabaseUsersInTransaction(context, participants.userIds)
  return await identityStore.resolveWechatPhoneIdentityInTransaction(context, preparedIdentity)
})
assert.equal(identityResult.id, '20')
assert.equal(identityResult.isFirstPhoneRegistration, true)
assert.equal(forbiddenPoolCalls, 0)

let unknownIdentityDuplicateAttempts = 0
const unknownIdentityDuplicateConnection = {
  async beginTransaction() {}, async commit() {}, async rollback() {},
  query: identityConnection.query,
  async execute(sql, params = []) {
    if (/SELECT id FROM users/u.test(sql)) return [params.map(id => ({ id })), []]
    if (/SELECT user_id, openid, unionid/u.test(sql)) {
      return [[{ user_id: '20', openid: 'openid-20', unionid: null }], []]
    }
    if (/SELECT user_id, phone_hash/u.test(sql)) return [[], []]
    if (/INSERT INTO `user_phone_bindings`/u.test(sql)) {
      unknownIdentityDuplicateAttempts += 1
      const error = new Error("Duplicate entry for key 'unrelated_identity_constraint'")
      error.code = 'ER_DUP_ENTRY'
      error.sqlMessage = 'INSERT INTO user_phone_bindings secret SQL'
      throw error
    }
    throw new Error(`Unexpected unknown-duplicate identity SQL: ${sql}`)
  }
}
await assert.rejects(() => withDatabaseTransaction(unknownIdentityDuplicateConnection, async context => {
  const participants = await identityStore.locateWechatPhoneIdentityParticipantsInTransaction(context, preparedIdentity)
  await lockDatabaseUsersInTransaction(context, participants.userIds)
  return await identityStore.resolveWechatPhoneIdentityInTransaction(context, preparedIdentity)
}), error => error.code === 'IDENTITY_CONFLICT' && error.sqlMessage === undefined &&
  error.message === 'Identity binding conflict.')
assert.equal(unknownIdentityDuplicateAttempts, 1)

const createdUserSql = []
const newUserIdentityStore = createIdentityStore({
  pool: forbiddenPool,
  phoneHashSecret: 'shared-transaction-phone-secret',
  now: () => new Date('2026-09-24T00:00:00.000Z'),
  campaignPhoneIdentityFactory: async () => ({ campaignPhoneIdentityHash: campaignHash, campaignPhoneHashVersion: 'v1' })
})
const newUserConnection = {
  async beginTransaction() {}, async commit() {}, async rollback() {},
  async query(sql) {
    if (/SHOW COLUMNS FROM `users`/u.test(sql)) return [[
      { Field: 'id', Type: 'bigint unsigned', Extra: 'auto_increment', Null: 'NO', Default: null },
      { Field: 'status', Type: 'varchar(32)', Extra: '', Null: 'NO', Default: 'active' },
      { Field: 'created_at', Type: 'datetime', Extra: '', Null: 'NO', Default: 'CURRENT_TIMESTAMP' },
      { Field: 'last_login_at', Type: 'datetime', Extra: '', Null: 'YES', Default: null }
    ], []]
    if (/SHOW COLUMNS FROM `wechat_user_bindings`/u.test(sql)) return [[
      { Field: 'user_id', Type: 'bigint unsigned', Extra: '', Null: 'NO', Default: null },
      { Field: 'openid', Type: 'varchar(191)', Extra: '', Null: 'NO', Default: null },
      { Field: 'unionid', Type: 'varchar(191)', Extra: '', Null: 'YES', Default: null },
      { Field: 'created_at', Type: 'datetime', Extra: '', Null: 'NO', Default: 'CURRENT_TIMESTAMP' },
      { Field: 'updated_at', Type: 'datetime', Extra: '', Null: 'NO', Default: 'CURRENT_TIMESTAMP' }
    ], []]
    if (/SHOW COLUMNS FROM `user_phone_bindings`/u.test(sql)) return [[
      { Field: 'user_id', Type: 'bigint unsigned', Extra: '', Null: 'NO', Default: null },
      { Field: 'phone_hash', Type: 'char(64)', Extra: '', Null: 'NO', Default: null },
      { Field: 'phone_masked', Type: 'varchar(32)', Extra: '', Null: 'NO', Default: null },
      { Field: 'hash_version', Type: 'varchar(16)', Extra: '', Null: 'NO', Default: null },
      { Field: 'country_code', Type: 'varchar(8)', Extra: '', Null: 'NO', Default: null },
      { Field: 'status', Type: 'varchar(16)', Extra: '', Null: 'NO', Default: 'verified' },
      { Field: 'verified_at', Type: 'datetime', Extra: '', Null: 'YES', Default: null },
      { Field: 'created_at', Type: 'datetime', Extra: '', Null: 'NO', Default: 'CURRENT_TIMESTAMP' },
      { Field: 'updated_at', Type: 'datetime', Extra: '', Null: 'NO', Default: 'CURRENT_TIMESTAMP' },
      { Field: 'campaign_phone_identity_hash', Type: 'binary(32)', Extra: '', Null: 'NO', Default: null },
      { Field: 'campaign_phone_hash_version', Type: 'varchar(16)', Extra: '', Null: 'NO', Default: null }
    ], []]
    throw new Error(`Unexpected new-user identity query: ${sql}`)
  },
  async execute(sql) {
    createdUserSql.push(sql)
    if (/SELECT user_id, openid, unionid/u.test(sql) || /SELECT user_id, phone_hash/u.test(sql)) return [[], []]
    if (/^INSERT INTO users/u.test(sql)) return [{ affectedRows: 1, insertId: '21' }, []]
    if (/LAST_INSERT_ID/u.test(sql)) return [[{ id: '21' }], []]
    if (/UPDATE `users`/u.test(sql) || /INSERT INTO `wechat_user_bindings`/u.test(sql) ||
        /INSERT INTO `user_phone_bindings`/u.test(sql)) return [{ affectedRows: 1, insertId: '1' }, []]
    throw new Error(`Unexpected new-user identity SQL: ${sql}`)
  }
}
const newPreparedIdentity = await newUserIdentityStore.prepareWechatPhoneIdentityForTransaction({
  openid: 'openid-new-21', phone: { phoneNumber: '10000000021', countryCode: '86' }
})
const sqlCountBeforeMissingScope = createdUserSql.length
await assert.rejects(() => withDatabaseTransaction(newUserConnection, context =>
  newUserIdentityStore.resolveWechatPhoneIdentityInTransaction(context, newPreparedIdentity)),
error => error.code === 'DATABASE_USER_LOCK_SCOPE_REQUIRED')
assert.equal(createdUserSql.slice(sqlCountBeforeMissingScope).some(sql => /^INSERT INTO users/u.test(sql)), false)
const newIdentityResult = await withDatabaseTransaction(newUserConnection, async context => {
  const participants = await newUserIdentityStore.locateWechatPhoneIdentityParticipantsInTransaction(context, newPreparedIdentity)
  await lockDatabaseUsersInTransaction(context, participants.userIds)
  const created = await newUserIdentityStore.resolveWechatPhoneIdentityInTransaction(context, newPreparedIdentity)
  assert.deepEqual(created, { id: '21', isNew: true, isFirstPhoneRegistration: true,
    hasWechatBinding: true, hasPhoneBinding: true, phoneMasked: '100****0021' })
  return created
})
assert.equal(newIdentityResult.id, '21')
assert(createdUserSql.some(sql => /LAST_INSERT_ID/u.test(sql)))

function entitlementFixture(databaseNow = '2026-09-24T01:02:03.000Z') {
  const state = {
    databaseNow: new Date(databaseNow),
    transaction: null,
    entitlement: {
      id: 1, user_id: '20', quota_balance: 0, quota_total_granted: 0,
      quota_total_consumed: 0, quota_total_expired: 0, membership_type: 'none', membership_status: 'none',
      membership_started_at: null, membership_expire_at: null, last_transaction_id: null,
      created_at: databaseNow, updated_at: databaseNow
    },
    insertedExpiresAt: null,
    insertedCreatedAt: null,
    exactYear: 1,
    latestBalanceOverride: null,
    latestIdOverride: undefined,
    totalGrantedOverride: undefined,
    previousRows: [],
    countOverride: undefined
  }
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    async execute(sql, params = []) {
      if (/SELECT COUNT\(\*\) AS row_count/u.test(sql)) {
        return [[{ row_count: state.countOverride === undefined ? (state.transaction ? '1' : '0') : state.countOverride }], []]
      }
      if (/AS exact_year/u.test(sql)) {
        return [state.transaction ? [{ ...state.transaction, exact_year: state.exactYear }] : [], []]
      }
      if (/FROM `user_entitlements`/u.test(sql)) return [[{ ...state.entitlement }], []]
      if (/WHERE idempotency_key = \?/u.test(sql)) return [state.transaction ? [{ ...state.transaction }] : [], []]
      if (/SELECT UTC_TIMESTAMP\(\) AS granted_at/u.test(sql)) {
        const expiresAt = new Date(state.databaseNow)
        expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)
        if (state.databaseNow.getUTCMonth() === 1 && state.databaseNow.getUTCDate() === 29 && expiresAt.getUTCMonth() === 2) {
          expiresAt.setUTCDate(0)
        }
        return [[{ granted_at: state.databaseNow, expires_at: expiresAt }], []]
      }
      if (/INSERT INTO `entitlement_transactions`/u.test(sql)) {
        state.insertedExpiresAt = params[7]
        state.insertedCreatedAt = params[17]
        state.transaction = {
          id: 99, transaction_id: params[0], user_id: params[1], transaction_type: params[2], amount: params[3],
          balance_after: params[4], source: params[5], source_id: params[6], expires_at: params[7],
          grant_transaction_id: null, root_learning_object_id: null, current_learning_object_id: null,
          access_context_json: null, idempotency_key: params[12], operator_type: params[13], operator_id: params[14],
          reason: params[15], metadata_json: null, created_at: params[17]
        }
        return [{ affectedRows: 1, insertId: 99 }, []]
      }
      if (/UPDATE `user_entitlements`/u.test(sql)) {
        state.entitlement.quota_balance = params[0]
        state.entitlement.quota_total_granted += params[1]
        state.entitlement.last_transaction_id = params[2]
        return [{ affectedRows: 1 }, []]
      }
      if (/AND id < \?/u.test(sql)) return [state.previousRows.map(row => ({ ...row })), []]
      if (/ORDER BY id DESC LIMIT 1/u.test(sql)) {
        return [state.transaction ? [{ id: state.latestIdOverride === undefined ? state.transaction.id : state.latestIdOverride, balance_after:
          state.latestBalanceOverride === null ? state.transaction.balance_after : state.latestBalanceOverride }] : [], []]
      }
      if (/SUM\(amount\) AS total_granted/u.test(sql)) {
        return [[{ total_granted: state.totalGrantedOverride === undefined
          ? state.entitlement.quota_total_granted
          : state.totalGrantedOverride }], []]
      }
      throw new Error(`Unexpected entitlement SQL: ${sql}`)
    }
  }
  return { state, connection }
}

const entitlementStore = createUserEntitlementStore({
  pool: forbiddenPool,
  now: () => new Date('1999-01-01T00:00:00.000Z')
})
const regular = entitlementFixture()
const bonusResult = await withDatabaseTransaction(regular.connection,
  context => entitlementStore.ensureRegistrationBonusInTransaction(context, '20'))
assert.equal(bonusResult.granted, true)
assert.equal(bonusResult.transaction.transactionType, 'REGISTER_BONUS')
assert.equal(bonusResult.entitlement.quotaBalance, 30)
assert.equal(regular.state.insertedCreatedAt.toISOString(), '2026-09-24T01:02:03.000Z')
assert.equal(regular.state.insertedExpiresAt.toISOString(), '2027-09-24T01:02:03.000Z')
assert.equal(forbiddenPoolCalls, 0)

const replayResult = await withDatabaseTransaction(regular.connection,
  context => entitlementStore.ensureRegistrationBonusInTransaction(context, '20'))
assert.equal(replayResult.granted, false)
assert.equal(replayResult.idempotent, true)
assert.equal(replayResult.entitlement.quotaBalance, 30)

const validReplayTransaction = { ...regular.state.transaction }
const validReplayEntitlement = { ...regular.state.entitlement }
async function expectRegistrationConflict(change) {
  regular.state.transaction = { ...validReplayTransaction }
  regular.state.entitlement = { ...validReplayEntitlement }
  regular.state.exactYear = 1
  regular.state.latestBalanceOverride = null
  regular.state.latestIdOverride = undefined
  regular.state.totalGrantedOverride = undefined
  regular.state.previousRows = []
  regular.state.countOverride = undefined
  change(regular.state)
  await assert.rejects(() => withDatabaseTransaction(regular.connection,
    context => entitlementStore.ensureRegistrationBonusInTransaction(context, '20')),
  error => error.code === 'IDEMPOTENCY_KEY_CONFLICT')
}
await expectRegistrationConflict(state => { state.transaction.transaction_type = 'ADMIN_GRANT' })
await expectRegistrationConflict(state => { state.transaction.transaction_type = 'SHARE_REWARD' })
await expectRegistrationConflict(state => { state.transaction.amount = 1 })
await expectRegistrationConflict(state => { state.transaction.source = 'admin' })
await expectRegistrationConflict(state => { state.transaction.source_id = '21' })
await expectRegistrationConflict(state => { state.transaction.operator_type = 'admin' })
await expectRegistrationConflict(state => { state.transaction.operator_id = 'another-operator' })
await expectRegistrationConflict(state => { state.transaction.expires_at = null })
await expectRegistrationConflict(state => {
  state.transaction.expires_at = new Date('2027-09-24T01:02:02.000Z'); state.exactYear = 0
})
await expectRegistrationConflict(state => {
  state.transaction.expires_at = new Date('2027-09-24T01:02:04.000Z'); state.exactYear = 0
})
await expectRegistrationConflict(state => { state.latestBalanceOverride = 29 })
await expectRegistrationConflict(state => { state.totalGrantedOverride = 31 })
for (const invalid of [null, '', 'not-a-number', '1.5', -1, '-0', '1e3', ' 0', Number.POSITIVE_INFINITY]) {
  await expectRegistrationConflict(state => { state.previousRows = [{ id: '1', balance_after: invalid }] })
}
for (const invalid of [null, '', 'not-a-number', '1.5', -1, '9007199254740992']) {
  await expectRegistrationConflict(state => { state.transaction.amount = invalid })
  await expectRegistrationConflict(state => { state.transaction.balance_after = invalid })
  await expectRegistrationConflict(state => { state.entitlement.quota_balance = invalid })
  await expectRegistrationConflict(state => { state.entitlement.quota_total_granted = invalid })
  await expectRegistrationConflict(state => { state.totalGrantedOverride = invalid })
}
await expectRegistrationConflict(state => { state.countOverride = null })
await expectRegistrationConflict(state => { state.countOverride = '1.5' })
await expectRegistrationConflict(state => { state.latestIdOverride = null })
await expectRegistrationConflict(state => { state.latestIdOverride = Number.MAX_SAFE_INTEGER + 1 })

regular.state.transaction = { ...validReplayTransaction, amount: '30', balance_after: '30', id: '99', user_id: '20' }
regular.state.entitlement = { ...validReplayEntitlement, quota_balance: '30', quota_total_granted: '30', last_transaction_id: '99' }
regular.state.exactYear = 1
regular.state.latestBalanceOverride = null
regular.state.latestIdOverride = undefined
regular.state.previousRows = []
regular.state.countOverride = undefined
regular.state.totalGrantedOverride = '30'
const decimalStringReplay = await withDatabaseTransaction(regular.connection,
  context => entitlementStore.ensureRegistrationBonusInTransaction(context, '20'))
assert.equal(decimalStringReplay.idempotent, true)
regular.state.previousRows = [{ id: '1', balance_after: '0' }]
const explicitZeroReplay = await withDatabaseTransaction(regular.connection,
  context => entitlementStore.ensureRegistrationBonusInTransaction(context, '20'))
assert.equal(explicitZeroReplay.idempotent, true)

const leap = entitlementFixture('2024-02-29T12:34:56.000Z')
await withDatabaseTransaction(leap.connection,
  context => entitlementStore.ensureRegistrationBonusInTransaction(context, '20'))
assert.equal(leap.state.insertedCreatedAt.toISOString(), '2024-02-29T12:34:56.000Z')
assert.equal(leap.state.insertedExpiresAt.toISOString(), '2025-02-28T12:34:56.000Z')

console.log('shared identity and registration bonus transaction tests passed')
