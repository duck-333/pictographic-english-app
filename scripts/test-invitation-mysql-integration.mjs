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
import { runInvitationFormalHttpMysqlScenarios } from './invitation-http-mysql-scenarios.mjs'
import {
  cleanupInvitationMysqlTest,
  throwInvitationMysqlTestErrors
} from './invitation-mysql-cleanup.mjs'
import {
  INVITATION_MIGRATION_FILES,
  runInvitationRepositoryMigrations
} from './invitation-mysql-migrations.mjs'
import { resolveInvitationMysqlClientHost } from './invitation-mysql-client-host.mjs'
import {
  createDatabaseResource,
  createMysqlResource
} from './invitation-mysql-resource-lifecycle.mjs'
import {
  createInvitationMysqlTestUserResources,
  provisionInvitationMysqlTestUsers
} from './invitation-mysql-test-users.mjs'
import { assertRuntimeDdlDeniedAndAbsent } from './invitation-mysql-runtime-ddl-guard.mjs'
import {
  parseDatabaseInsertId,
  parseDatabaseSafeInteger,
} from './invitation-test-database-integers.mjs'
import { createTwoPartyBarrier } from './invitation-test-barrier.mjs'

const EXPECTED_HOST = '127.0.0.1'
const EXPECTED_PORT = 3309
const EXPECTED_CONFIRMATION = 'local-docker-invitation-only'
const SAFE_DATABASE = /^invitation_test_[a-f0-9]{12}$/u
const SAFE_TEST_USER = /^invitation_[mr]_[a-f0-9]{12}$/u
const SAFE_TEST_PASSWORD = /^[a-f0-9]{64}$/u
const EXPECTED_011_LF_SHA256 = '9ce82a0c87d2bdad877c326aa6ef52d34983af648a78a49968447e2bd1d0eb1b'
const migrationUrl = new URL('../database/migrations/011_create_invitation_reward_foundation.sql', import.meta.url)
const releaseMigrationUrl = new URL('../server/migrations/011_create_invitation_reward_foundation.sql', import.meta.url)

function readConfig(env = process.env) {
  const value = { host: String(env.INVITATION_TEST_DB_HOST || ''),
    port: parseDatabaseSafeInteger(String(env.INVITATION_TEST_DB_PORT || ''), 'invitation test DB port'),
    user: String(env.INVITATION_TEST_DB_USER || ''), password: String(env.INVITATION_TEST_DB_PASSWORD || ''),
    confirmation: String(env.INVITATION_TEST_ALLOW_DESTRUCTIVE || '') }
  assert.equal(value.host, EXPECTED_HOST)
  assert.equal(value.port, EXPECTED_PORT)
  assert(value.user && value.password)
  assert.equal(value.confirmation, EXPECTED_CONFIRMATION)
  return value
}

function quoteDatabase(name) { assert.match(name, SAFE_DATABASE); return `\`${name}\`` }
let testUserHost = null
function quoteTestAccount(name, host) {
  assert.match(name, SAFE_TEST_USER)
  assert.equal(typeof testUserHost, 'string')
  assert.equal(host, testUserHost)
  return `'${name}'@'${host}'`
}

function canonicalLfSha256(value) {
  return crypto.createHash('sha256').update(String(value).replace(/\r\n?/gu, '\n'), 'utf8').digest('hex')
}

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

function databaseSafeInteger(value, label) {
  return parseDatabaseSafeInteger(value, label)
}

const dbConfig = readConfig()
const databaseName = `invitation_test_${crypto.randomBytes(6).toString('hex')}`
const migrationUserName = `invitation_m_${crypto.randomBytes(6).toString('hex')}`
const runtimeUserName = `invitation_r_${crypto.randomBytes(6).toString('hex')}`
const runtimeDdlProbeTableName = `invitation_runtime_ddl_${crypto.randomBytes(6).toString('hex')}`
const migrationUserPassword = crypto.randomBytes(32).toString('hex')
const runtimeUserPassword = crypto.randomBytes(32).toString('hex')
assert.match(migrationUserPassword, SAFE_TEST_PASSWORD)
assert.match(runtimeUserPassword, SAFE_TEST_PASSWORD)
const mysqlOptions = { host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password }
const root = await mysql.createConnection({ ...mysqlOptions, multipleStatements: true, timezone: 'Z' })
const databaseResource = createMysqlResource(databaseName)
let migrationUserResource = null
let runtimeUserResource = null
let migrationPool = null
let pool = null
let testError = null
try {
  testUserHost = await resolveInvitationMysqlClientHost(root)
  ;({ migrationUserResource, runtimeUserResource } = createInvitationMysqlTestUserResources({
    clientHost: testUserHost,
    migrationUserName,
    runtimeUserName
  }))
  await createDatabaseResource(root, databaseResource, { quoteDatabase })
  await provisionInvitationMysqlTestUsers({
    root,
    databaseName,
    migrationUserResource,
    runtimeUserResource,
    migrationUserPassword,
    runtimeUserPassword,
    quoteDatabase,
    quoteTestAccount
  })

  migrationPool = mysql.createPool({ host: EXPECTED_HOST, port: EXPECTED_PORT, user: migrationUserName,
    password: migrationUserPassword, database: databaseName, multipleStatements: true,
    connectionLimit: 6, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z' })
  const executedMigrations = await runInvitationRepositoryMigrations(migrationPool)
  assert.deepEqual(executedMigrations, INVITATION_MIGRATION_FILES)
  await migrationPool.end()
  migrationPool = null

  const [canonicalMigration, releaseMigration] = await Promise.all([
    readFile(migrationUrl, 'utf8'), readFile(releaseMigrationUrl, 'utf8')
  ])
  assert.equal(releaseMigration, canonicalMigration)
  assert.equal(canonicalLfSha256(canonicalMigration), EXPECTED_011_LF_SHA256)
  assert.equal(canonicalLfSha256(releaseMigration), EXPECTED_011_LF_SHA256)

  pool = mysql.createPool({ host: EXPECTED_HOST, port: EXPECTED_PORT, user: runtimeUserName,
    password: runtimeUserPassword, database: databaseName, multipleStatements: true,
    connectionLimit: 6, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z' })
  await assertRuntimeDdlDeniedAndAbsent({
    runtimePool: pool,
    inspectionConnection: root,
    databaseName,
    tableName: runtimeDdlProbeTableName
  })
  const [seedUsers] = await pool.query(`INSERT INTO users (id) VALUES
    (100),(110),(201),(202),(203),(204),(205),(206),(207),(208),(209),(210),(211),(212),
    (501),(502),(503),(504),(505),(506),(507),(508)`)
  assert.equal(parseDatabaseSafeInteger(seedUsers.affectedRows, 'seed users affectedRows'), 22)

  const [tables] = await pool.execute(`SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('invitation_share_credentials', 'invitation_registration_relations')`, [databaseName])
  assert.equal(tables.length, 2)
  assert(tables.every((row) => row.ENGINE === 'InnoDB'))

  const formalSecrets = Object.freeze({
    appid: 'wx-mysql-formal-http-app',
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    phoneHashSecret: crypto.randomBytes(32).toString('hex'),
    campaignPhoneIdentityHashSecret: crypto.randomBytes(32).toString('hex'),
    tokenSecret: crypto.randomBytes(32).toString('hex'),
    candidateSecret: crypto.randomBytes(32).toString('hex')
  })
  await runInvitationFormalHttpMysqlScenarios({ pool, ...formalSecrets, now: new Date() })

  const directTokenSecret = crypto.randomBytes(32).toString('hex')
  const directCandidateSecret = crypto.randomBytes(32).toString('hex')
  const directPhoneSecret = crypto.randomBytes(32).toString('hex')
  const store = createInvitationStore({ tokenSecret: directTokenSecret, candidateSecret: directCandidateSecret })
  let activePhoneInsertBarrier = null
  let activeWechatInsertBarrier = null
  let activeBeforeUnifiedUserLockBarrier = null
  const identityStore = createIdentityStore({
    pool,
    enableTestHooks: true,
    testHooks: {
      async beforePhoneBindingInsert() { if (activePhoneInsertBarrier) await activePhoneInsertBarrier.wait() },
      async beforeWechatBindingInsert() { if (activeWechatInsertBarrier) await activeWechatInsertBarrier.wait() }
    },
    phoneHashSecret: directPhoneSecret,
    campaignPhoneIdentityFactory: async normalizedPhone => ({
      campaignPhoneIdentityHash: crypto.createHash('sha256').update(`campaign:${normalizedPhone}`).digest(),
      campaignPhoneHashVersion: 'v1'
    })
  })
  const entitlementStore = createUserEntitlementStore({ pool })
  const registrationDependencies = {
    identityStore,
    entitlementStore,
    invitationStore: store,
    enableTestHooks: true,
    testHooks: {
      async beforeUnifiedUserLock() {
        if (activeBeforeUnifiedUserLockBarrier) await activeBeforeUnifiedUserLockBarrier.wait()
      }
    }
  }
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
  assert.equal(databaseSafeInteger(missingInviterDelete.affectedRows, 'missing inviter delete affectedRows'), 1)
  const missingInviteeOpenid = 'openid-missing-inviter-new-user'
  const [missingInviteeUserInsert] = await pool.execute(
    'INSERT INTO users (status, created_at) VALUES (?, UTC_TIMESTAMP(3))',
    ['active']
  )
  assert.equal(parseDatabaseSafeInteger(
    missingInviteeUserInsert.affectedRows,
    'missing inviter invitee user affectedRows'
  ), 1)
  const missingInviteeUserId = parseDatabaseInsertId(
    missingInviteeUserInsert.insertId,
    'missing inviter invitee user insertId'
  ).toString()
  const [missingInviteeWechatInsert] = await pool.execute(`INSERT INTO wechat_user_bindings
    (user_id, openid, unionid, created_at, updated_at)
    VALUES (?, ?, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
  [missingInviteeUserId, missingInviteeOpenid])
  assert.equal(parseDatabaseSafeInteger(
    missingInviteeWechatInsert.affectedRows,
    'missing inviter invitee WeChat affectedRows'
  ), 1)
  const preparedMissingInviter = await identityStore.prepareWechatPhoneIdentityForTransaction({
    openid: missingInviteeOpenid,
    phone: { phoneNumber: '13600000508', countryCode: '86' }
  })
  const missingInviterRegistration = await completeRegistration({
    preparedIdentity: preparedMissingInviter,
    candidateReceipt: missingInviterCandidate.candidateReceipt,
    trustedCandidateSubject: missingInviterSubject,
    candidateSessionUserId: missingInviteeUserId,
    candidateOpenid: missingInviteeOpenid
  })
  assert.equal(missingInviterRegistration.identity.id, missingInviteeUserId)
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
    databaseSafeInteger(missingInviterFacts.phone_count, 'missing inviter phone COUNT'),
    databaseSafeInteger(missingInviterFacts.bonus_count, 'missing inviter bonus COUNT'),
    databaseSafeInteger(missingInviterFacts.final_count, 'missing inviter FINAL COUNT'),
    databaseSafeInteger(missingInviterFacts.share_reward_count, 'missing inviter SHARE_REWARD COUNT')
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
  const crossPreLockBarrier = createTwoPartyBarrier({ timeoutMs: 5000 })
  activeBeforeUnifiedUserLockBarrier = crossPreLockBarrier
  let crossFullResults
  try {
    crossFullResults = await Promise.all([
      runBarrierParticipant(crossPreLockBarrier, () => completeRegistration({
        preparedIdentity: preparedCrossA, candidateReceipt: crossCandidateA.candidateReceipt,
        trustedCandidateSubject: crossSubjectA, candidateSessionUserId: '501', candidateOpenid: 'openid-cross-a'
      })),
      runBarrierParticipant(crossPreLockBarrier, () => completeRegistration({
        preparedIdentity: preparedCrossB, candidateReceipt: crossCandidateB.candidateReceipt,
        trustedCandidateSubject: crossSubjectB, candidateSessionUserId: '502', candidateOpenid: 'openid-cross-b'
      }))
    ])
  } finally {
    crossPreLockBarrier.abort(new Error('Cross registration finished before the pre-lock barrier settled.'))
    activeBeforeUnifiedUserLockBarrier = null
  }
  assert.equal(crossPreLockBarrier.arrivals, 2)
  assert.equal(crossPreLockBarrier.settled, true)
  assert.equal(crossPreLockBarrier.timeoutActive, false)
  assert.deepEqual(crossFullResults.map(result => result.identity.id).sort(), ['501', '502'])
  assert(crossFullResults.every(result => result.registrationBonus.transaction.transactionType === 'REGISTER_BONUS'))
  assert.deepEqual(crossFullResults.map(result => result.invitation.rewardStatus).sort(),
    ['NO_REWARD', 'REWARD_PENDING'])
  const crossNoReward = crossFullResults.find(result => result.invitation.rewardStatus === 'NO_REWARD').invitation
  assert.equal(crossNoReward.noRewardReason, 'INVITER_PHONE_REGISTRATION_REQUIRED')
  const [[crossFullFacts]] = await pool.execute(`SELECT
    (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id IN (501,502)) AS phone_count,
    (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id IN (501,502) AND transaction_type='REGISTER_BONUS') AS bonus_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id IN (501,502) AND relation_status='FINAL') AS final_count,
    (SELECT COUNT(*) FROM invitation_registration_relations
      WHERE invitee_user_id IN (501,502) AND reward_status='REWARD_PENDING' AND reward_slot IS NOT NULL) AS pending_slot_count,
    (SELECT COUNT(*) FROM invitation_registration_relations
      WHERE invitee_user_id IN (501,502) AND reward_status='NO_REWARD'
        AND no_reward_reason='INVITER_PHONE_REGISTRATION_REQUIRED' AND reward_slot IS NULL) AS phone_required_count`)
  assert.deepEqual([
    databaseSafeInteger(crossFullFacts.phone_count, 'cross phone COUNT'),
    databaseSafeInteger(crossFullFacts.bonus_count, 'cross bonus COUNT'),
    databaseSafeInteger(crossFullFacts.final_count, 'cross FINAL COUNT'),
    databaseSafeInteger(crossFullFacts.pending_slot_count, 'cross pending slot COUNT'),
    databaseSafeInteger(crossFullFacts.phone_required_count, 'cross phone-required COUNT')
  ], [2, 2, 2, 1, 1])

  const raceShareA = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '501' }))
  const raceShareB = await inTransaction(pool, context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: '502' }))
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
        trustedCandidateSubject: raceSubjectA,
        candidateSessionUserId: '503', candidateOpenid: 'openid-phone-race-a'
      })),
      runBarrierParticipant(phoneInsertBarrier, () => completeRegistration({
        preparedIdentity: preparedRaceB, candidateReceipt: raceCandidateB.candidateReceipt,
        trustedCandidateSubject: raceSubjectB,
        candidateSessionUserId: '504', candidateOpenid: 'openid-phone-race-b'
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
  const fulfilledPhoneRace = phoneRaceResults.find(result => result.status === 'fulfilled').value
  assert.equal(fulfilledPhoneRace.invitation.relationStatus, 'FINAL')
  assert.equal(fulfilledPhoneRace.invitation.rewardStatus, 'REWARD_PENDING')
  assert.equal(fulfilledPhoneRace.invitation.rewardReserved, true)
  const [[phoneRaceFacts]] = await pool.execute(`SELECT
    (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id IN (503,504)) AS phone_count,
    (SELECT COUNT(*) FROM entitlement_transactions WHERE user_id IN (503,504) AND transaction_type='REGISTER_BONUS') AS bonus_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id IN (503,504) AND relation_status='FINAL') AS final_count,
    (SELECT COUNT(*) FROM invitation_registration_relations WHERE invitee_user_id IN (503,504) AND reward_slot IS NOT NULL) AS slot_count`)
  assert.deepEqual([
    databaseSafeInteger(phoneRaceFacts.phone_count, 'phone race phone COUNT'),
    databaseSafeInteger(phoneRaceFacts.bonus_count, 'phone race bonus COUNT'),
    databaseSafeInteger(phoneRaceFacts.final_count, 'phone race FINAL COUNT'),
    databaseSafeInteger(phoneRaceFacts.slot_count, 'phone race slot COUNT')
  ], [1, 1, 1, 1])

  const [registrationBonusWindows] = await pool.execute(`SELECT user_id,
      expires_at = DATE_ADD(created_at, INTERVAL 1 YEAR) AS exact_year,
      MICROSECOND(created_at) AS created_microseconds,
      MICROSECOND(expires_at) AS expires_microseconds
    FROM entitlement_transactions WHERE transaction_type='REGISTER_BONUS' AND user_id IN (501,502,503,504)`)
  assert(registrationBonusWindows.length === 3)
  assert(registrationBonusWindows.every(row => databaseSafeInteger(row.exact_year, 'exact year result') === 1))
  assert(registrationBonusWindows.every(row =>
    databaseSafeInteger(row.created_microseconds, 'created microseconds') === 0 &&
    databaseSafeInteger(row.expires_microseconds, 'expires microseconds') === 0))

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
  assert.equal(databaseSafeInteger(leapInsert.affectedRows, 'leap insert affectedRows'), 1)
  const leapInsertId = parseDatabaseInsertId(leapInsert.insertId, 'entitlement transaction insertId').toString()
  const [leapSnapshotUpdate] = await pool.execute(
    'UPDATE user_entitlements SET last_transaction_id=? WHERE user_id=507', [leapInsertId])
  assert.equal(databaseSafeInteger(leapSnapshotUpdate.affectedRows, 'leap snapshot affectedRows'), 1)
  const leapReplay = await inTransaction(pool, context =>
    entitlementStore.ensureRegistrationBonusInTransaction(context, '507'))
  assert.equal(leapReplay.idempotent, true)
  assert.equal(leapReplay.transaction.createdAt, '2024-02-29T12:34:56.000Z')
  assert.equal(leapReplay.transaction.expiresAt, '2025-02-28T12:34:56.000Z')

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
        preparedIdentity: sameOpenidPreparedA
      })),
      runBarrierParticipant(wechatInsertBarrier, () => completeRegistration({
        preparedIdentity: sameOpenidPreparedB
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
  assert(sameOpenidResults.every(result => result.value.invitation.relationStatus === null))
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
    databaseSafeInteger(sameOpenidFacts.wechat_count, 'same openid WeChat COUNT'),
    databaseSafeInteger(sameOpenidFacts.phone_count, 'same openid phone COUNT'),
    databaseSafeInteger(sameOpenidFacts.bonus_count, 'same openid bonus COUNT'),
    databaseSafeInteger(sameOpenidFacts.final_count, 'same openid FINAL COUNT'),
    databaseSafeInteger(sameOpenidFacts.slot_count, 'same openid slot COUNT')
  ], [1, 1, 1, 0, 0])

  async function expectConstraint(action) {
    await assert.rejects(action, (error) => error && (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
      databaseSafeInteger(error.errno, 'constraint errno') === 3819))
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
  await pool.execute(`INSERT INTO invitation_registration_relations
    (invitation_id, share_credential_id, inviter_user_id, invitee_user_id, candidate_subject_digest,
     candidate_receipt_digest, candidate_key_version, relation_status, qualification_status, reward_status,
     no_reward_reason, candidate_captured_at, relation_locked_at)
    VALUES (?, 1, 307, 407, ?, ?, 'v1', 'FINAL', 'INELIGIBLE', 'NO_REWARD',
     'INVITER_PHONE_REGISTRATION_REQUIRED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
  [crypto.randomUUID(), crypto.randomBytes(32), crypto.randomBytes(32)])
  await expectConstraint(() => pool.execute(`INSERT INTO invitation_registration_relations
    (invitation_id, share_credential_id, inviter_user_id, invitee_user_id, candidate_subject_digest,
     candidate_receipt_digest, candidate_key_version, relation_status, qualification_status, reward_status,
     no_reward_reason, reward_slot, reward_amount, reward_reserved_at, candidate_captured_at, relation_locked_at)
    VALUES (?, 1, 308, 408, ?, ?, 'v1', 'FINAL', 'INELIGIBLE', 'NO_REWARD',
     'INVITER_PHONE_REGISTRATION_REQUIRED', 1, 30, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
  [crypto.randomUUID(), crypto.randomBytes(32), crypto.randomBytes(32)]))
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

  const qualifiedDirectInviterIds = Object.freeze(['100', '110', '208', '210'])
  async function insertQualifiedDirectInviterPhoneFixture(userId) {
    assert(qualifiedDirectInviterIds.includes(userId), 'direct inviter phone fixture user is not allowed')
    const phoneHash = crypto.createHash('sha256').update(`qualified-direct-inviter:${userId}`).digest('hex')
    assert.match(phoneHash, /^[a-f0-9]{64}$/u)
    const [insert] = await pool.execute(`INSERT INTO user_phone_bindings
      (user_id, phone_hash, phone_masked, hash_version, country_code, status)
      VALUES (?, ?, ?, 'v1', '86', 'active')`,
    [userId, phoneHash, `138****${userId.padStart(4, '0')}`])
    assert.equal(parseDatabaseSafeInteger(
      insert.affectedRows,
      `qualified direct inviter ${userId} phone affectedRows`
    ), 1)
  }
  for (const userId of qualifiedDirectInviterIds) {
    await insertQualifiedDirectInviterPhoneFixture(userId)
  }
  const [qualifiedDirectInviterRows] = await pool.execute(`SELECT user_id, COUNT(*) AS active_count
    FROM user_phone_bindings
    WHERE user_id IN (100,110,208,210) AND status='active'
    GROUP BY user_id ORDER BY user_id`)
  assert.deepEqual(qualifiedDirectInviterRows.map(row => String(row.user_id)), qualifiedDirectInviterIds)
  assert(qualifiedDirectInviterRows.every(row =>
    parseDatabaseSafeInteger(row.active_count, `qualified direct inviter ${row.user_id} active COUNT`) === 1))

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
  assert.equal(databaseSafeInteger(replayCounts.final_count, 'replay FINAL COUNT'), 1)
  assert.equal(databaseSafeInteger(replayCounts.slot_count, 'replay slot COUNT'), 1)

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
  assert.equal(databaseSafeInteger(counts.pending_count, 'pending SUM'), 4)
  assert.equal(databaseSafeInteger(counts.capped_count, 'capped SUM'), 1)

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
  (error) => error && (error.code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
    databaseSafeInteger(error.errno, 'constraint errno') === 3819))

} catch (error) {
  testError = error
}
const cleanupErrors = await cleanupInvitationMysqlTest({
  pools: [
    { stage: 'runtime pool.end', pool },
    { stage: 'migration pool.end', pool: migrationPool }
  ],
  root,
  databaseResource,
  userResources: [migrationUserResource, runtimeUserResource],
  quoteDatabase,
  quoteTestAccount
})
throwInvitationMysqlTestErrors(testError, cleanupErrors)
console.log('invitation isolated MySQL integration tests passed')
