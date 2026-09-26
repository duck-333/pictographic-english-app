import assert from 'node:assert/strict'

import {
  insertDatabaseUserInTransaction,
  withDatabaseTransaction
} from '../server/database-transaction-context.mjs'
import { createInvitationCredentialSecurity } from '../server/invitation-credential-security.mjs'
import {
  completeInvitedPhoneRegistrationInTransaction,
  withInvitedPhoneRegistrationTransaction
} from '../server/invitation-registration-transaction.mjs'
import { createInvitationStore } from '../server/invitation-store.mjs'

function cloneState(state) {
  return { identities: new Set(state.identities), bonuses: new Set(state.bonuses), finals: new Set(state.finals), slots: new Set(state.slots) }
}

const committed = { identities: new Set(), bonuses: new Set(), finals: new Set(), slots: new Set() }
let working = null
const lifecycle = []
const connection = {
  async beginTransaction() { lifecycle.push('begin'); working = cloneState(committed) },
  async commit() {
    lifecycle.push('commit')
    committed.identities = working.identities; committed.bonuses = working.bonuses
    committed.finals = working.finals; committed.slots = working.slots; working = null
  },
  async rollback() { lifecycle.push('rollback'); working = null },
  async execute(sql, params) {
    if (/SELECT id FROM users/u.test(sql)) return [params.map(id => ({ id })), []]
    const [value] = params
    if (sql === 'TEST_BIND_IDENTITY') working.identities.add(value)
    else if (sql === 'TEST_ENSURE_REGISTER_BONUS') working.bonuses.add(value)
    else if (sql === 'TEST_FINAL_INVITATION') working.finals.add(value)
    else if (sql === 'TEST_RESERVE_SLOT') working.slots.add(value)
    else throw new Error(`Unexpected test SQL: ${sql}`)
    return [{ affectedRows: 1 }, []]
  }
}

let attempts = 0
const contextsByAttempt = []
const identityStore = {
  async locateWechatPhoneIdentityParticipantsInTransaction() {
    return { userIds: ['20'] }
  },
  async resolveWechatPhoneIdentityInTransaction(context) {
    contextsByAttempt.push([context])
    await context.execute('TEST_BIND_IDENTITY', ['phone-hash-1'])
    return { id: '20', isFirstPhoneRegistration: true, hasPhoneBinding: true }
  }
}
const entitlementStore = {
  async ensureRegistrationBonusInTransaction(context, userId) {
    contextsByAttempt.at(-1).push(context)
    await context.execute('TEST_ENSURE_REGISTER_BONUS', [`registration_bonus:${userId}`])
    return { granted: true, idempotent: false }
  }
}
const invitationStore = {
  async locateRegistrationRewardParticipantsInTransaction() {
    return { inviterUserId: '10', candidateLocated: true }
  },
  async reserveRegistrationRewardInTransaction(context) {
    contextsByAttempt.at(-1).push(context)
    await context.execute('TEST_FINAL_INVITATION', ['invitation-1'])
    await context.execute('TEST_RESERVE_SLOT', ['inviter-10:slot-1'])
    attempts += 1
    if (attempts === 1) throw Object.assign(new Error('injected after invitation reservation'), { code: 'ER_LOCK_DEADLOCK' })
    return { invitationId: 'invitation-1', rewardStatus: 'REWARD_PENDING', registrationAllowed: true }
  }
}

const result = await withDatabaseTransaction(connection, context => completeInvitedPhoneRegistrationInTransaction(context, {
  preparedIdentity: Object.freeze({ testTrustedIdentity: true }),
  candidateReceipt: 'candidate-receipt', trustedCandidateSubject: 'server-session:subject-1'
}, { identityStore, entitlementStore, invitationStore }))

assert.equal(attempts, 2)
assert.deepEqual(lifecycle, ['begin', 'rollback', 'begin', 'commit'])
assert.equal(contextsByAttempt.length, 2)
assert(contextsByAttempt.every(values => values[0] === values[1] && values[1] === values[2]))
assert.notEqual(contextsByAttempt[0][0], contextsByAttempt[1][0])
assert.equal(committed.identities.size, 1)
assert.equal(committed.bonuses.size, 1)
assert.equal(committed.finals.size, 1)
assert.equal(committed.slots.size, 1)
assert.equal(result.invitation.rewardStatus, 'REWARD_PENDING')
for (const context of contextsByAttempt.flat()) {
  await assert.rejects(() => context.execute('TEST_BIND_IDENTITY', ['late']),
    error => error.code === 'DATABASE_TRANSACTION_REQUIRED')
}

const phoneLifecycle = []
const phoneContexts = []
let phoneLocateRuns = 0
let phoneResolveRuns = 0
const phoneConnection = {
  async beginTransaction() { phoneLifecycle.push('begin') },
  async commit() { phoneLifecycle.push('commit') },
  async rollback() { phoneLifecycle.push('rollback') },
  async execute(sql, params = []) {
    if (/SELECT id FROM users/u.test(sql)) return [params.map(id => ({ id })), []]
    throw new Error(`Unexpected phone retry SQL: ${sql}`)
  }
}
const phoneDependencies = {
  identityStore: {
    async locateWechatPhoneIdentityParticipantsInTransaction(context) {
      phoneContexts.push(context); phoneLocateRuns += 1; return { userIds: ['20'] }
    },
    async resolveWechatPhoneIdentityInTransaction() {
      phoneResolveRuns += 1
      if (phoneResolveRuns === 1) throw Object.assign(new Error('expected phone race'), {
        code: 'IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT'
      })
      return { id: '20', isFirstPhoneRegistration: false }
    }
  },
  entitlementStore: {
    async ensureRegistrationBonusInTransaction() { throw new Error('bonus must be skipped on retry convergence') }
  },
  invitationStore: {
    async locateRegistrationRewardParticipantsInTransaction() { return { inviterUserId: '10' } },
    async reserveRegistrationRewardInTransaction() {
      return { registrationAllowed: true, rewardStatus: 'NO_REWARD', noRewardReason: 'NOT_FIRST_PHONE_REGISTRATION' }
    }
  }
}
const converged = await withInvitedPhoneRegistrationTransaction(phoneConnection,
  { preparedIdentity: {}, candidateReceipt: 'receipt', trustedCandidateSubject: 'subject' }, phoneDependencies)
assert.equal(converged.identity.id, '20')
assert.equal(phoneLocateRuns, 2)
assert.equal(phoneResolveRuns, 2)
assert.deepEqual(phoneLifecycle, ['begin', 'rollback', 'begin', 'commit'])
assert.notEqual(phoneContexts[0], phoneContexts[1])
for (const context of phoneContexts) {
  await assert.rejects(() => context.execute('SELECT 1'), error => error.code === 'DATABASE_TRANSACTION_REQUIRED')
}

for (const internalCode of ['IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT', 'IDENTITY_WECHAT_BINDING_CONCURRENT_CONFLICT']) {
  let exhaustedAttempts = 0
  const exhaustedConnection = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    async execute(sql, params = []) {
      if (/SELECT id FROM users/u.test(sql)) return [params.map(id => ({ id })), []]
      throw new Error(`Unexpected exhausted identity SQL: ${sql}`)
    }
  }
  const exhaustedDependencies = {
    identityStore: {
      async locateWechatPhoneIdentityParticipantsInTransaction() { return { userIds: ['20'] } },
      async resolveWechatPhoneIdentityInTransaction() {
        exhaustedAttempts += 1
        const error = new Error('Duplicate entry for secret identity table constraint')
        error.code = internalCode
        error.sqlMessage = 'INSERT INTO secret_table failed'
        throw error
      }
    },
    entitlementStore: { async ensureRegistrationBonusInTransaction() { throw new Error('unreachable') } },
    invitationStore: {
      async locateRegistrationRewardParticipantsInTransaction() { return { inviterUserId: '10' } },
      async reserveRegistrationRewardInTransaction() { throw new Error('unreachable') }
    }
  }
  await assert.rejects(() => withInvitedPhoneRegistrationTransaction(exhaustedConnection,
    { preparedIdentity: {}, candidateReceipt: 'receipt', trustedCandidateSubject: 'subject' }, exhaustedDependencies),
  error => error.code === 'IDENTITY_CONFLICT' && error.message === 'Identity binding conflict.' &&
    error.sqlMessage === undefined && !/secret_table|constraint|INSERT/iu.test(error.message))
  assert.equal(exhaustedAttempts, 3)
}

let unknownDuplicateAttempts = 0
const unknownDuplicate = Object.assign(new Error('unrelated invitation duplicate'), { code: 'ER_DUP_ENTRY' })
await assert.rejects(() => withInvitedPhoneRegistrationTransaction(phoneConnection,
  { preparedIdentity: {}, candidateReceipt: 'receipt', trustedCandidateSubject: 'subject' }, {
    identityStore: {
      async locateWechatPhoneIdentityParticipantsInTransaction() { return { userIds: ['20'] } },
      async resolveWechatPhoneIdentityInTransaction() { unknownDuplicateAttempts += 1; throw unknownDuplicate }
    },
    entitlementStore: { async ensureRegistrationBonusInTransaction() {} },
    invitationStore: {
      async locateRegistrationRewardParticipantsInTransaction() { return { inviterUserId: '10' } },
      async reserveRegistrationRewardInTransaction() {}
    }
  }), error => error === unknownDuplicate)
assert.equal(unknownDuplicateAttempts, 1)

const missingInviterSecurity = createInvitationCredentialSecurity({
  env: {
    INVITATION_TOKEN_HMAC_SECRET: 'token-secret-for-missing-inviter-composition-9Qx7!L2v',
    INVITATION_CANDIDATE_HMAC_SECRET: 'candidate-secret-for-missing-inviter-composition-4Kp8@Z6m'
  }
})
const missingInviterReceipt = missingInviterSecurity.generateCandidateReceipt()
const missingInviterSubject = 'trusted-session:missing-inviter-composition'
const missingInviterReceiptDigest = missingInviterSecurity.digestCandidateReceipt(missingInviterReceipt)
const missingInviterSubjectDigest = missingInviterSecurity.digestTrustedCandidateSubject(missingInviterSubject)
const missingInviterRelation = {
  id: '900',
  invitation_id: '00000000-0000-4000-8000-000000000900',
  share_credential_id: '901',
  inviter_user_id: '10',
  candidate_receipt_digest: missingInviterReceiptDigest,
  candidate_subject_digest: missingInviterSubjectDigest,
  relation_status: 'CANDIDATE'
}
const missingInviterShare = {
  id: '901',
  inviter_user_id: '10',
  credential_status: 'ACTIVE',
  expires_at: new Date('2030-01-08T00:00:00.000Z'),
  revoked_at: null
}
const missingInviterCalls = []
const missingInviterLifecycle = []
const missingInviterConnection = {
  async beginTransaction() { missingInviterLifecycle.push('begin') },
  async commit() { missingInviterLifecycle.push('commit') },
  async rollback() { missingInviterLifecycle.push('rollback') },
  async execute(sql, params = []) {
    missingInviterCalls.push({ sql, params })
    if (/SELECT id FROM users WHERE id IN/u.test(sql)) return [[], []]
    if (/^INSERT INTO users/u.test(sql)) return [{ affectedRows: 1, insertId: '20' }, []]
    if (/LAST_INSERT_ID/u.test(sql)) return [[{ id: '20' }], []]
    if (sql === 'TEST_BIND_NEW_PHONE_IDENTITY') return [{ affectedRows: 1 }, []]
    if (sql === 'TEST_GRANT_REGISTER_BONUS') return [{ affectedRows: 1 }, []]
    if (sql === 'SELECT UTC_TIMESTAMP(3) AS database_now') {
      return [[{ database_now: new Date('2030-01-01T00:00:00.000Z') }], []]
    }
    if (/SELECT id, share_credential_id, inviter_user_id, relation_status\s+FROM invitation_registration_relations/u.test(sql)) {
      return [[missingInviterRelation], []]
    }
    if (/SELECT invitation_id, reward_status, no_reward_reason FROM invitation_registration_relations/u.test(sql)) {
      return [[], []]
    }
    if (/SELECT id, inviter_user_id, credential_status, expires_at, revoked_at\s+FROM invitation_share_credentials/u.test(sql)) {
      return [[missingInviterShare], []]
    }
    if (/SELECT id, invitation_id, share_credential_id, inviter_user_id,/u.test(sql)) {
      return [[missingInviterRelation], []]
    }
    if (/UPDATE invitation_registration_relations SET invitee_user_id=\?/u.test(sql)) {
      assert.equal(params[0], '20')
      assert.equal(params[1], 'INVITER_NOT_FOUND')
      return [{ affectedRows: 1 }, []]
    }
    throw new Error(`Unexpected missing-inviter composition SQL: ${sql}`)
  }
}
const realMissingInviterStore = createInvitationStore({ security: missingInviterSecurity })
const missingInviterResult = await withDatabaseTransaction(missingInviterConnection,
  context => completeInvitedPhoneRegistrationInTransaction(context, {
    preparedIdentity: Object.freeze({ trustedPhoneIdentity: true }),
    candidateReceipt: missingInviterReceipt,
    trustedCandidateSubject: missingInviterSubject
  }, {
    identityStore: {
      async locateWechatPhoneIdentityParticipantsInTransaction() { return { userIds: [] } },
      async resolveWechatPhoneIdentityInTransaction(transactionContext) {
        const id = await insertDatabaseUserInTransaction(transactionContext, { values: { status: 'active' } })
        await transactionContext.execute('TEST_BIND_NEW_PHONE_IDENTITY', [id])
        return { id, isFirstPhoneRegistration: true, hasPhoneBinding: true }
      }
    },
    entitlementStore: {
      async ensureRegistrationBonusInTransaction(transactionContext, userId) {
        await transactionContext.execute('TEST_GRANT_REGISTER_BONUS', [userId])
        return { granted: true, idempotent: false, amount: 30 }
      }
    },
    invitationStore: realMissingInviterStore
  }))
assert.deepEqual(missingInviterLifecycle, ['begin', 'commit'])
assert.equal(missingInviterResult.identity.id, '20')
assert.equal(missingInviterResult.identity.isFirstPhoneRegistration, true)
assert.equal(missingInviterResult.registrationBonus.granted, true)
assert.equal(missingInviterResult.invitation.relationStatus, 'FINAL')
assert.equal(missingInviterResult.invitation.rewardStatus, 'NO_REWARD')
assert.equal(missingInviterResult.invitation.noRewardReason, 'INVITER_NOT_FOUND')
assert.equal(missingInviterResult.invitation.rewardReserved, false)
assert.equal(missingInviterResult.invitation.registrationAllowed, true)
assert.equal(missingInviterCalls.filter(call => /SELECT id FROM users WHERE id IN/u.test(call.sql)).length, 1)
assert.equal(missingInviterCalls.some(call => /SELECT reward_slot FROM invitation_registration_relations/u.test(call.sql)), false)

console.log('invitation registration shared-transaction composition tests passed')
