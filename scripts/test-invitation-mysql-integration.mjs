import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { withDatabasePoolTransaction } from '../server/database-transaction-context.mjs'
import { createIdentityStore } from '../server/identity-store.mjs'
import { createInvitationStore } from '../server/invitation-store.mjs'
import {
  withInvitedPhoneRegistrationTransaction
} from '../server/invitation-registration-transaction.mjs'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'
import { cleanupInvitationMysqlTest, throwInvitationMysqlTestErrors } from './invitation-mysql-cleanup.mjs'
import { createTwoPartyBarrier } from './invitation-test-barrier.mjs'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3309
const EXPECTED_CONFIRMATION = 'local-docker-invitation-only'
const SAFE_DATABASE = /^invitation_test_[a-f0-9]{12}$/u
const migrationUrl = new URL('../database/migrations/011_create_invitation_reward_foundation.sql', import.meta.url)
const releaseMigrationUrl = new URL('../server/migrations/011_create_invitation_reward_foundation.sql', import.meta.url)
const phoneMigrationUrl = new URL('../database/migrations/001_create_user_phone_bindings.sql', import.meta.url)
const entitlementMigrationUrl = new URL('../database/migrations/004_create_user_entitlements.sql', import.meta.url)
const transactionMigrationUrl = new URL('../database/migrations/005_create_entitlement_transactions.sql', import.meta.url)

function readConfig(env = process.env) {
  const value = { host: String(env.INVITATION_TEST_DB_HOST || ''), port: Number(env.INVITATION_TEST_DB_PORT || 0),
    user: String(env.INVITATION_TEST_DB_USER || ''), password: String(env.INVITATION_TEST_DB_PASSWORD || ''),
    confirmation: String(env.INVITATION_TEST_ALLOW_DESTRUCTIVE || '') }
  assert.equal(value.host, EXPECTED_HOST)
  assert.equal(value.port, EXPECTED_PORT)
  assert(value.user && value.password)
  assert.equal(value.confirmation, EXPECTED_CONFIRMATION)
  return value
}

function quoteDatabase(name) { assert.match(name, SAFE_DATABASE); return `\`${name}\`` }

async function runBarrierParticipant(barrier, operation) {
  try {
    return await operation()
  } catch (error) {
    barrier.abort(error)
    throw error
  }
}

function throwUnexpectedConcurrentFailures(results, allowedCodes, message) {
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
  const unexpected = failures.filter(error => !allowedCodes.has(error?.code))
  if (unexpected.length > 0) throw new AggregateError(failures, message)
}

async function inTransaction(pool, work) {
  return await withDatabasePoolTransaction(pool, work)
}

const dbConfig = readConfig()
const databaseName = `invitation_test_${crypto.randomBytes(6).toString('hex')}`
const mysqlOptions = { host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password }
const root = await mysql.createConnection({ ...mysqlOptions, multipleStatements: true, timezone: 'Z' })
let pool = null
let owned = false
let testError = null
try {
  await root.query(`CREATE DATABASE ${quoteDatabase(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  owned = true
  pool = mysql.createPool({ ...mysqlOptions, database: databaseName, multipleStatements: true,
    connectionLimit: 6, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z' })
  await pool.query(`CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_login_at DATETIME(3) NULL DEFAULT NULL
  ) ENGINE=InnoDB`)
  await pool.query(`CREATE TABLE wechat_user_bindings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    openid VARCHAR(191) NOT NULL,
    unionid VARCHAR(191) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_wechat_user_bindings_openid (openid),
    KEY idx_wechat_user_bindings_user_id (user_id)
  ) ENGINE=InnoDB`)
  await pool.query(`INSERT INTO users (id) VALUES
    (100),(110),(201),(202),(203),(204),(205),(206),(207),(208),(209),(210),(211),(212),
    (501),(502),(503),(504),(505),(506),(507),(508)`)
  const [phoneMigration, entitlementMigration, transactionMigration, canonicalMigration, releaseMigration] = await Promise.all([
    readFile(phoneMigrationUrl, 'utf8'), readFile(entitlementMigrationUrl, 'utf8'),
    readFile(transactionMigrationUrl, 'utf8'), readFile(migrationUrl, 'utf8'), readFile(releaseMigrationUrl, 'utf8')
  ])
  assert.equal(releaseMigration, canonicalMigration)
  await pool.query(phoneMigration)
  await pool.query(`ALTER TABLE user_phone_bindings
    ADD COLUMN campaign_phone_identity_hash BINARY(32) NULL DEFAULT NULL,
    ADD COLUMN campaign_phone_hash_version VARCHAR(16) NULL DEFAULT NULL,
    ADD KEY idx_user_phone_bindings_campaign_identity (campaign_phone_identity_hash)`)
  await pool.query(entitlementMigration)
  await pool.query(transactionMigration)
  await pool.query(canonicalMigration)
  await pool.query(releaseMigration)

  const [tables] = await pool.execute(`SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('invitation_share_credentials', 'invitation_registration_relations')`, [databaseName])
  assert.equal(tables.length, 2)
  assert(tables.every((row) => row.ENGINE === 'InnoDB'))

  const store = createInvitationStore({ env: {
    INVITATION_TOKEN_HMAC_SECRET: 'mysql-invitation-token-secret-0123456789abcdef',
    INVITATION_CANDIDATE_HMAC_SECRET: 'mysql-candidate-receipt-secret-0123456789abcdef'
  } })
  let activePhoneInsertBarrier = null
  let activeWechatInsertBarrier = null
  const identityStore = createIdentityStore({
    pool,
    enableTestHooks: true,
    testHooks: {
      async beforePhoneBindingInsert() { if (activePhoneInsertBarrier) await activePhoneInsertBarrier.wait() },
      async beforeWechatBindingInsert() { if (activeWechatInsertBarrier) await activeWechatInsertBarrier.wait() }
    },
    phoneHashSecret: 'mysql-phone-hash-secret-0123456789abcdef',
    campaignPhoneIdentityFactory: async normalizedPhone => ({
      campaignPhoneIdentityHash: crypto.createHash('sha256').update(`campaign:${normalizedPhone}`).digest(),
      campaignPhoneHashVersion: 'v1'
    })
  })
  const entitlementStore = createUserEntitlementStore({ pool })
  const registrationDependencies = { identityStore, entitlementStore, invitationStore: store }
  async function completeRegistration(input) {
    const connection = await pool.getConnection()
    try {
      return await withInvitedPhoneRegistrationTransaction(connection, input, registrationDependencies)
    } finally {
      connection.release()
    }
  }

  const missingInviterShare = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '508' }))
  const missingInviterSubject = 'server-session:full-missing-inviter'
  const missingInviterCandidate = await inTransaction(pool, context =>
    store.captureNewValidCandidateInTransaction(context, {
      token: missingInviterShare.token,
      trustedCandidateSubject: missingInviterSubject
    }))
  const [missingInviterDelete] = await pool.execute('DELETE FROM users WHERE id=508')
  assert.equal(missingInviterDelete.affectedRows, 1)
  const preparedMissingInviter = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: 'openid-missing-inviter-new-user',
    phone: { phoneNumber: '13600000508', countryCode: '86' }
  })
  const missingInviterRegistration = await completeRegistration({
    preparedIdentity: preparedMissingInviter,
    candidateReceipt: missingInviterCandidate.candidateReceipt,
    trustedCandidateSubject: missingInviterSubject
  })
  assert.equal(missingInviterRegistration.identity.isFirstPhoneRegistration, true)
  assert.equal(missingInviterRegistration.registrationBonus.transaction.transactionType, 'REGISTER_BONUS')
  assert.equal(missingInviterRegistration.invitation.relationStatus, 'FINAL')
  assert.equal(missingInviterRegistration.invitation.rewardStatus, 'NO_REWARD')
  assert.equal(missingInviterRegistration.invitation.noRewardReason, 'INVITER_NOT_FOUND')
  assert.equal(missingInviterRegistration.invitation.rewardReserved, false)
  assert.equal(missingInviterRegistration.invitation.registrationAllowed, true)
  const [[missingInviterFacts]] = await pool.execute(`SELECT
    (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id=?) AS phone_count,
    (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id=? AND transaction_type='REGISTER_BONUS') AS bonus_count,
    (SELECT COUNT(*) FROM invitation_registration_relations
      WHERE invitation_id=? AND invitee_user_id=? AND relation_status='FINAL'
        AND reward_status='NO_REWARD' AND no_reward_reason='INVITER_NOT_FOUND' AND reward_slot IS NULL) AS final_count,
    (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id=508 AND transaction_type='SHARE_REWARD') AS share_reward_count`,
  [missingInviterRegistration.identity.id, missingInviterRegistration.identity.id,
    missingInviterCandidate.invitationId, missingInviterRegistration.identity.id])
  assert.deepEqual([
    Number(missingInviterFacts.phone_count), Number(missingInviterFacts.bonus_count),
    Number(missingInviterFacts.final_count), Number(missingInviterFacts.share_reward_count)
  ], [1, 1, 1, 0])

  const share = await inTransaction(pool, (context) => store.createShareCredentialInTransaction(context, { inviterUserId: '100' }))
  const [[storedCredential]] = await pool.execute('SELECT token_digest FROM invitation_share_credentials WHERE credential_id = ?', [share.credentialId])
  assert(Buffer.isBuffer(storedCredential.token_digest) && storedCredential.token_digest.length === 32)
  assert.notEqual(storedCredential.token_digest.toString('utf8'), share.token)

  const replacementShare = await inTransaction(pool, (context) => store.createShareCredentialInTransaction(context, { inviterUserId: '110' }))
  const replacementSubject = 'server-session:replacement'
  const candidateA = await inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: share.token, trustedCandidateSubject: replacementSubject
  }))
  const candidateB = await inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: replacementShare.token, trustedCandidateSubject: replacementSubject
  }))
  const staleA = await inTransaction(pool, (context) => store.reserveRegistrationRewardInTransaction(context, {
    candidateReceipt: candidateA.candidateReceipt, trustedCandidateSubject: replacementSubject,
    inviteeUserId: '211', isFirstPhoneRegistration: true
  }))
  assert.equal(staleA.noRewardReason, 'CANDIDATE_SUPERSEDED')
  assert.equal(staleA.registrationAllowed, true)
  const finalB = await inTransaction(pool, (context) => store.reserveRegistrationRewardInTransaction(context, {
    candidateReceipt: candidateB.candidateReceipt, trustedCandidateSubject: replacementSubject,
    inviteeUserId: '211', isFirstPhoneRegistration: true
  }))
  assert.equal(finalB.invitationId, candidateB.invitationId)
  await assert.rejects(() => inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: share.token, trustedCandidateSubject: replacementSubject
  })), (error) => error.code === 'INVITATION_RELATION_LOCKED')

  const concurrentSubject = 'server-session:concurrent-candidate'
  const concurrentCandidates = await Promise.all([
    inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
      token: share.token, trustedCandidateSubject: concurrentSubject
    })),
    inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
      token: replacementShare.token, trustedCandidateSubject: concurrentSubject
    }))
  ])
  const [concurrentCandidateRows] = await pool.query(`SELECT invitation_id, relation_status
    FROM invitation_registration_relations
    WHERE invitation_id IN (?, ?) ORDER BY id`, concurrentCandidates.map((value) => value.invitationId))
  assert.equal(concurrentCandidateRows.length, 2)
  assert.deepEqual(concurrentCandidateRows.map((row) => row.relation_status), ['SUPERSEDED', 'CANDIDATE'])

  const preservedSubject = 'server-session:preserved-valid-candidate'
  const preserved = await inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: share.token, trustedCandidateSubject: preservedSubject
  }))
  await assert.rejects(() => inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: 'invalid-token', trustedCandidateSubject: preservedSubject
  })), (error) => error.code === 'INVITATION_CREDENTIAL_INVALID')
  const revokedShare = await inTransaction(pool, (context) => store.createShareCredentialInTransaction(context, { inviterUserId: '110' }))
  await inTransaction(pool, (context) => store.revokeShareCredentialInTransaction(context, { credentialId: revokedShare.credentialId }))
  await assert.rejects(() => inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: revokedShare.token, trustedCandidateSubject: preservedSubject
  })), (error) => error.code === 'INVITATION_CREDENTIAL_REVOKED')
  const expiredShare = await inTransaction(pool, (context) => store.createShareCredentialInTransaction(context, { inviterUserId: '110' }))
  await pool.execute(`UPDATE invitation_share_credentials
    SET created_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 8 DAY), expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
    WHERE credential_id=?`, [expiredShare.credentialId])
  await assert.rejects(() => inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: expiredShare.token, trustedCandidateSubject: preservedSubject
  })), (error) => error.code === 'INVITATION_CREDENTIAL_EXPIRED')
  const [[preservedRow]] = await pool.execute(`SELECT invitation_id, relation_status
    FROM invitation_registration_relations WHERE invitation_id=?`, [preserved.invitationId])
  assert.equal(preservedRow.relation_status, 'CANDIDATE')

  await pool.query(`INSERT INTO wechat_user_bindings (user_id, openid) VALUES
    (501, 'openid-cross-a'), (502, 'openid-cross-b'),
    (503, 'openid-phone-race-a'), (504, 'openid-phone-race-b')`)

  const crossShareA = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '501' }))
  const crossShareB = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '502' }))
  const crossSubjectA = 'server-session:full-cross-a'
  const crossSubjectB = 'server-session:full-cross-b'
  const crossCandidateA = await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: crossShareB.token, trustedCandidateSubject: crossSubjectA
  }))
  const crossCandidateB = await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: crossShareA.token, trustedCandidateSubject: crossSubjectB
  }))
  const preparedCrossA = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: 'openid-cross-a', phone: { phoneNumber: '13800000501', countryCode: '86' }
  })
  const preparedCrossB = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: 'openid-cross-b', phone: { phoneNumber: '13800000502', countryCode: '86' }
  })
  const crossFullResults = await Promise.all([
    completeRegistration({ preparedIdentity: preparedCrossA, candidateReceipt: crossCandidateA.candidateReceipt,
      trustedCandidateSubject: crossSubjectA }),
    completeRegistration({ preparedIdentity: preparedCrossB, candidateReceipt: crossCandidateB.candidateReceipt,
      trustedCandidateSubject: crossSubjectB })
  ])
  assert.deepEqual(crossFullResults.map(result => result.identity.id).sort(), ['501', '502'])
  assert(crossFullResults.every(result => result.registrationBonus.transaction.transactionType === 'REGISTER_BONUS'))
  assert(crossFullResults.every(result => result.invitation.rewardStatus === 'REWARD_PENDING'))
  const [[crossFullFacts]] = await pool.execute(`SELECT
    (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id IN (501,502)) AS phone_count,
    (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id IN (501,502) AND transaction_type='REGISTER_BONUS') AS bonus_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id IN (501,502) AND relation_status='FINAL') AS final_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id IN (501,502) AND reward_slot IS NOT NULL) AS slot_count`)
  assert.deepEqual([
    Number(crossFullFacts.phone_count), Number(crossFullFacts.bonus_count),
    Number(crossFullFacts.final_count), Number(crossFullFacts.slot_count)
  ], [2, 2, 2, 2])

  const raceShareA = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '505' }))
  const raceShareB = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '506' }))
  const raceSubjectA = 'server-session:full-phone-race-a'
  const raceSubjectB = 'server-session:full-phone-race-b'
  const raceCandidateA = await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: raceShareA.token, trustedCandidateSubject: raceSubjectA
  }))
  const raceCandidateB = await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: raceShareB.token, trustedCandidateSubject: raceSubjectB
  }))
  const preparedRaceA = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: 'openid-phone-race-a', phone: { phoneNumber: '13900000000', countryCode: '86' }
  })
  const preparedRaceB = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: 'openid-phone-race-b', phone: { phoneNumber: '13900000000', countryCode: '86' }
  })
  const phoneInsertBarrier = createTwoPartyBarrier({ timeoutMs: 5000 })
  activePhoneInsertBarrier = phoneInsertBarrier
  let phoneRaceResults
  try {
    phoneRaceResults = await Promise.allSettled([
      runBarrierParticipant(phoneInsertBarrier, () => completeRegistration({
        preparedIdentity: preparedRaceA, candidateReceipt: raceCandidateA.candidateReceipt,
        trustedCandidateSubject: raceSubjectA
      })),
      runBarrierParticipant(phoneInsertBarrier, () => completeRegistration({
        preparedIdentity: preparedRaceB, candidateReceipt: raceCandidateB.candidateReceipt,
        trustedCandidateSubject: raceSubjectB
      }))
    ])
  } finally {
    phoneInsertBarrier.abort(new Error('Phone insert race finished before the barrier settled.'))
    activePhoneInsertBarrier = null
  }
  throwUnexpectedConcurrentFailures(phoneRaceResults, new Set(['IDENTITY_CONFLICT']),
    'Phone insert race failed before reaching its expected concurrent result.')
  assert.equal(phoneInsertBarrier.arrivals, 2)
  assert.equal(phoneRaceResults.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(phoneRaceResults.filter(result => result.status === 'rejected').length, 1)
  const phoneRaceFailure = phoneRaceResults.find(result => result.status === 'rejected').reason
  assert.equal(phoneRaceFailure.code, 'IDENTITY_CONFLICT')
  assert.notEqual(phoneRaceFailure.code, 'ER_DUP_ENTRY')
  const [[phoneRaceFacts]] = await pool.execute(`SELECT
    (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id IN (503,504)) AS phone_count,
    (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id IN (503,504) AND transaction_type='REGISTER_BONUS') AS bonus_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id IN (503,504) AND relation_status='FINAL') AS final_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id IN (503,504) AND reward_slot IS NOT NULL) AS slot_count`)
  assert.deepEqual([
    Number(phoneRaceFacts.phone_count), Number(phoneRaceFacts.bonus_count),
    Number(phoneRaceFacts.final_count), Number(phoneRaceFacts.slot_count)
  ], [1, 1, 1, 1])

  const [registrationBonusWindows] = await pool.execute(`SELECT user_id,
      expires_at = DATE_ADD(created_at, INTERVAL 1 YEAR) AS exact_year,
      MICROSECOND(created_at) AS created_microseconds,
      MICROSECOND(expires_at) AS expires_microseconds
    FROM entitlement_transactions WHERE transaction_type='REGISTER_BONUS' AND user_id IN (501,502,503,504)`)
  assert(registrationBonusWindows.length === 3)
  assert(registrationBonusWindows.every(row => Number(row.exact_year) === 1))
  assert(registrationBonusWindows.every(row => Number(row.created_microseconds) === 0 && Number(row.expires_microseconds) === 0))

  const fulfilledPhoneRace = phoneRaceResults.find(result => result.status === 'fulfilled').value
  await inTransaction(pool, context =>
    entitlementStore.ensureRegistrationBonusInTransaction(context, fulfilledPhoneRace.identity.id))
  await pool.execute(`UPDATE entitlement_transactions SET expires_at=DATE_SUB(expires_at, INTERVAL 1 SECOND)
    WHERE user_id=? AND transaction_type='REGISTER_BONUS'`, [fulfilledPhoneRace.identity.id])
  await assert.rejects(() => inTransaction(pool, context =>
    entitlementStore.ensureRegistrationBonusInTransaction(context, fulfilledPhoneRace.identity.id)),
  error => error.code === 'IDEMPOTENCY_KEY_CONFLICT')
  await pool.execute(`UPDATE entitlement_transactions SET expires_at=DATE_ADD(created_at, INTERVAL 1 YEAR)
    WHERE user_id=? AND transaction_type='REGISTER_BONUS'`, [fulfilledPhoneRace.identity.id])
  await pool.execute(`UPDATE entitlement_transactions SET expires_at=DATE_ADD(expires_at, INTERVAL 1 SECOND)
    WHERE user_id=? AND transaction_type='REGISTER_BONUS'`, [fulfilledPhoneRace.identity.id])
  await assert.rejects(() => inTransaction(pool, context =>
    entitlementStore.ensureRegistrationBonusInTransaction(context, fulfilledPhoneRace.identity.id)),
  error => error.code === 'IDEMPOTENCY_KEY_CONFLICT')
  await pool.execute(`UPDATE entitlement_transactions SET expires_at=DATE_ADD(created_at, INTERVAL 1 YEAR)
    WHERE user_id=? AND transaction_type='REGISTER_BONUS'`, [fulfilledPhoneRace.identity.id])

  await pool.execute(`INSERT INTO user_entitlements
    (user_id, quota_balance, quota_total_granted, last_transaction_id) VALUES (507,30,30,NULL)`)
  const [leapInsert] = await pool.execute(`INSERT INTO entitlement_transactions
    (transaction_id,user_id,transaction_type,amount,balance_after,source,source_id,expires_at,
     idempotency_key,operator_type,operator_id,reason,created_at)
    VALUES (?,507,'REGISTER_BONUS',30,30,'registration','507','2025-02-28 12:34:56',
     'registration_bonus:507','system','auth-registration','Registration bonus complete-content access quota.',
     '2024-02-29 12:34:56')`, [crypto.randomUUID()])
  await pool.execute('UPDATE user_entitlements SET last_transaction_id=? WHERE user_id=507', [leapInsert.insertId])
  const leapReplay = await inTransaction(pool, context =>
    entitlementStore.ensureRegistrationBonusInTransaction(context, '507'))
  assert.equal(leapReplay.idempotent, true)
  assert.equal(leapReplay.transaction.createdAt, '2024-02-29T12:34:56.000Z')
  assert.equal(leapReplay.transaction.expiresAt, '2025-02-28T12:34:56.000Z')

  const sameOpenidShareA = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '505' }))
  const sameOpenidShareB = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '506' }))
  const sameOpenidSubjectA = 'server-session:same-new-openid-a'
  const sameOpenidSubjectB = 'server-session:same-new-openid-b'
  const sameOpenidCandidateA = await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: sameOpenidShareA.token, trustedCandidateSubject: sameOpenidSubjectA
  }))
  const sameOpenidCandidateB = await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: sameOpenidShareB.token, trustedCandidateSubject: sameOpenidSubjectB
  }))
  const sameOpenidPreparedA = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: 'openid-new-concurrent', phone: { phoneNumber: '13700000999', countryCode: '86' }
  })
  const sameOpenidPreparedB = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: 'openid-new-concurrent', phone: { phoneNumber: '13700000999', countryCode: '86' }
  })
  const wechatInsertBarrier = createTwoPartyBarrier({ timeoutMs: 5000 })
  activeWechatInsertBarrier = wechatInsertBarrier
  let sameOpenidResults
  try {
    sameOpenidResults = await Promise.allSettled([
      runBarrierParticipant(wechatInsertBarrier, () => completeRegistration({
        preparedIdentity: sameOpenidPreparedA,
        candidateReceipt: sameOpenidCandidateA.candidateReceipt, trustedCandidateSubject: sameOpenidSubjectA
      })),
      runBarrierParticipant(wechatInsertBarrier, () => completeRegistration({
        preparedIdentity: sameOpenidPreparedB,
        candidateReceipt: sameOpenidCandidateB.candidateReceipt, trustedCandidateSubject: sameOpenidSubjectB
      }))
    ])
  } finally {
    wechatInsertBarrier.abort(new Error('WeChat insert race finished before the barrier settled.'))
    activeWechatInsertBarrier = null
  }
  throwUnexpectedConcurrentFailures(sameOpenidResults, new Set(),
    'WeChat insert race failed before reaching its expected concurrent result.')
  assert.equal(wechatInsertBarrier.arrivals, 2)
  assert(sameOpenidResults.every(result => result.status === 'fulfilled'))
  const sameOpenidUserIds = sameOpenidResults.map(result => result.value.identity.id)
  assert.equal(new Set(sameOpenidUserIds).size, 1)
  const sameOpenidUserId = sameOpenidUserIds[0]
  const [[sameOpenidFacts]] = await pool.execute(`SELECT
    (SELECT COUNT(*) FROM wechat_user_bindings WHERE openid='openid-new-concurrent') AS wechat_count,
    (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id=?) AS phone_count,
    (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id=? AND transaction_type='REGISTER_BONUS') AS bonus_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id=? AND relation_status='FINAL') AS final_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id=? AND reward_slot IS NOT NULL) AS slot_count`,
  [sameOpenidUserId, sameOpenidUserId, sameOpenidUserId, sameOpenidUserId])
  assert.deepEqual([
    Number(sameOpenidFacts.wechat_count), Number(sameOpenidFacts.phone_count), Number(sameOpenidFacts.bonus_count),
    Number(sameOpenidFacts.final_count), Number(sameOpenidFacts.slot_count)
  ], [1, 1, 1, 1, 1])

  async function expectConstraint(action) {
    await assert.rejects(action, (error) => error && (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || Number(error.errno) === 3819))
  }
  async function insertGranted(inviterId, inviteeId, grantedAt, expiresAt) {
    return pool.execute(`INSERT INTO invitation_registration_relations
      (invitation_id, share_credential_id, inviter_user_id, invitee_user_id, candidate_subject_digest,
       candidate_receipt_digest, candidate_key_version, relation_status, qualification_status, reward_status,
       reward_slot, reward_amount, reward_reserved_at, reward_granted_at, reward_expires_at,
       entitlement_transaction_id, candidate_captured_at, relation_locked_at)
      VALUES (?, 1, ?, ?, ?, ?, 'v1', 'FINAL', 'ELIGIBLE', 'REWARD_GRANTED', 1, 30,
       ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), inviterId, inviteeId, crypto.randomBytes(32), crypto.randomBytes(32),
      grantedAt, grantedAt, expiresAt, crypto.randomUUID(), grantedAt, grantedAt])
  }
  await insertGranted(301, 401, '2024-02-29 12:34:56.789', '2025-02-28 12:34:56.789')
  await insertGranted(302, 402, '2026-09-24 01:02:03.456', '2027-09-24 01:02:03.456')
  await expectConstraint(() => insertGranted(303, 403, '2026-09-24 01:02:03.456', '2027-09-24 01:02:03.455'))
  await expectConstraint(() => insertGranted(304, 404, '2026-09-24 01:02:03.456', '2027-09-24 01:02:03.457'))
  await expectConstraint(() => pool.execute(`INSERT INTO invitation_registration_relations
    (invitation_id, share_credential_id, inviter_user_id, invitee_user_id, candidate_subject_digest,
     candidate_receipt_digest, candidate_key_version, relation_status, qualification_status, reward_status,
     no_reward_reason, candidate_captured_at, relation_locked_at, next_retry_at)
    VALUES (?, 1, 305, 405, ?, ?, 'v1', 'FINAL', 'INELIGIBLE', 'NO_REWARD',
     'INVITER_REWARD_LIMIT_REACHED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
  [crypto.randomUUID(), crypto.randomBytes(32), crypto.randomBytes(32)]))
  await expectConstraint(() => pool.execute(`INSERT INTO invitation_registration_relations
    (invitation_id, share_credential_id, inviter_user_id, invitee_user_id, candidate_subject_digest,
     candidate_receipt_digest, candidate_key_version, relation_status, qualification_status, reward_status,
     reward_slot, reward_amount, reward_reserved_at, candidate_captured_at, relation_locked_at)
    VALUES (?, 1, 306, 406, ?, ?, 'v1', 'FINAL', 'ELIGIBLE', 'MANUAL_REVIEW',
     1, 30, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
  [crypto.randomUUID(), crypto.randomBytes(32), crypto.randomBytes(32)]))

  let subjectSequence = 0
  const candidate = (subject = `server-session:${++subjectSequence}`) => inTransaction(pool, (context) =>
    store.captureNewValidCandidateInTransaction(context, { token: share.token, trustedCandidateSubject: subject }))
  const reserve = (candidateValue, inviteeUserId, subject = candidateValue.subject) => inTransaction(pool, (context) => store.reserveRegistrationRewardInTransaction(context, {
    candidateReceipt: candidateValue.candidateReceipt, trustedCandidateSubject: subject, inviteeUserId, isFirstPhoneRegistration: true
  }))

  const replayCandidateOne = { ...(await inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: replacementShare.token, trustedCandidateSubject: 'server-session:replay-one'
  }))), subject: 'server-session:replay-one' }
  const replayCandidateTwo = { ...(await inTransaction(pool, (context) => store.captureNewValidCandidateInTransaction(context, {
    token: replacementShare.token, trustedCandidateSubject: 'server-session:replay-two'
  }))), subject: 'server-session:replay-two' }
  const concurrentReplayResults = await Promise.all([
    reserve(replayCandidateOne, '212'), reserve(replayCandidateTwo, '212')
  ])
  assert.equal(concurrentReplayResults[0].invitationId, concurrentReplayResults[1].invitationId)
  const [[replayCounts]] = await pool.execute(`SELECT COUNT(*) AS final_count, COUNT(DISTINCT reward_slot) AS slot_count
    FROM invitation_registration_relations WHERE invitee_user_id=212 AND relation_status='FINAL'`)
  assert.equal(Number(replayCounts.final_count), 1)
  assert.equal(Number(replayCounts.slot_count), 1)

  const firstSubject = 'server-session:first'
  const first = { ...(await candidate(firstSubject)), subject: firstSubject }
  const firstResult = await reserve(first, '201')
  assert.equal(firstResult.rewardStatus, 'REWARD_PENDING')
  const firstReplay = await reserve(first, '201')
  assert.equal(firstReplay.invitationId, firstResult.invitationId)
  for (const invitee of ['202', '203', '204']) {
    const subject = `server-session:${invitee}`; const value = { ...(await candidate(subject)), subject }
    assert.equal((await reserve(value, invitee)).rewardStatus, 'REWARD_PENDING')
  }
  await pool.execute(`UPDATE invitation_registration_relations
    SET reward_status='MANUAL_REVIEW', retry_count=1, last_error_code='TEST_REVIEW', next_retry_at=NULL
    WHERE inviter_user_id=100 AND invitee_user_id=204`)

  const rollbackCandidate = { ...(await candidate('server-session:rollback-slot')), subject: 'server-session:rollback-slot' }
  const rollbackMarker = new Error('intentional rollback after slot reservation')
  let rolledBack
  await assert.rejects(() => inTransaction(pool, async context => {
    rolledBack = await store.reserveRegistrationRewardInTransaction(context, {
      candidateReceipt: rollbackCandidate.candidateReceipt, trustedCandidateSubject: rollbackCandidate.subject,
      inviteeUserId: '207', isFirstPhoneRegistration: true
    })
    throw rollbackMarker
  }), error => error === rollbackMarker)
  assert.equal(rolledBack.rewardStatus, 'REWARD_PENDING')
  const [[rollbackState]] = await pool.execute('SELECT relation_status FROM invitation_registration_relations WHERE invitation_id=?', [rollbackCandidate.invitationId])
  assert.equal(rollbackState.relation_status, 'CANDIDATE')

  const fifthCandidate = { ...(await candidate('server-session:205')), subject: 'server-session:205' }
  const sixthCandidate = { ...(await candidate('server-session:206')), subject: 'server-session:206' }
  const concurrentResults = await Promise.all([
    reserve(fifthCandidate, '205'), reserve(sixthCandidate, '206')
  ])
  assert.equal(concurrentResults.filter((value) => value.rewardStatus === 'REWARD_PENDING').length, 1)
  assert.equal(concurrentResults.filter((value) => value.noRewardReason === 'INVITER_REWARD_LIMIT_REACHED').length, 1)
  assert(concurrentResults.every((value) => value.registrationAllowed === true))
  const [[counts]] = await pool.query(`SELECT SUM(reward_status = 'REWARD_PENDING') AS pending_count,
    SUM(no_reward_reason = 'INVITER_REWARD_LIMIT_REACHED') AS capped_count
    FROM invitation_registration_relations WHERE inviter_user_id = 100`)
  assert.equal(Number(counts.pending_count), 4)
  assert.equal(Number(counts.capped_count), 1)

  const duplicate = { ...(await candidate('server-session:duplicate')), subject: 'server-session:duplicate' }
  const duplicateReplay = await reserve(duplicate, '201')
  assert.equal(duplicateReplay.invitationId, firstResult.invitationId)

  const selfCandidate = { ...(await candidate('server-session:self')), subject: 'server-session:self' }
  const selfResult = await reserve(selfCandidate, '100')
  assert.equal(selfResult.noRewardReason, 'SELF_INVITE')
  assert.equal(selfResult.registrationAllowed, true)

  const crossShare208 = await inTransaction(pool, context => store.createShareCredentialInTransaction(context, { inviterUserId: '208' }))
  const crossShare210 = await inTransaction(pool, context => store.createShareCredentialInTransaction(context, { inviterUserId: '210' }))
  const crossCandidateFor210 = { ...(await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: crossShare208.token, trustedCandidateSubject: 'server-session:cross-210'
  }))), subject: 'server-session:cross-210' }
  const crossCandidateFor208 = { ...(await inTransaction(pool, context => store.captureNewValidCandidateInTransaction(context, {
    token: crossShare210.token, trustedCandidateSubject: 'server-session:cross-208'
  }))), subject: 'server-session:cross-208' }
  const crossResults = await Promise.all([
    reserve(crossCandidateFor210, '210'), reserve(crossCandidateFor208, '208')
  ])
  assert(crossResults.every(value => value.rewardStatus === 'REWARD_PENDING'))
  assert(crossResults.every(value => value.registrationAllowed === true))

  await assert.rejects(() => pool.execute(`INSERT INTO invitation_registration_relations
    (invitation_id, share_credential_id, inviter_user_id, invitee_user_id, candidate_subject_digest, candidate_receipt_digest,
     candidate_key_version, relation_status, qualification_status, reward_status, candidate_captured_at, relation_locked_at)
    VALUES (?, 1, 100, 209, ?, ?, 'v1', 'FINAL', 'ELIGIBLE', 'REWARD_PENDING', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
  [crypto.randomUUID(), crypto.randomBytes(32), crypto.randomBytes(32)]),
  (error) => error && (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || Number(error.errno) === 3819))

} catch (error) {
  testError = error
}
const cleanupErrors = await cleanupInvitationMysqlTest({ pool, root, owned, databaseName, quoteDatabase })
throwInvitationMysqlTestErrors(testError, cleanupErrors)
console.log('invitation isolated MySQL integration tests passed')
