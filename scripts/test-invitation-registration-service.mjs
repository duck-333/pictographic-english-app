import assert from 'node:assert/strict'

import {
  createInvitationRegistrationService,
  createTrustedWechatCandidateSubject
} from '../server/invitation-registration-service.mjs'

const APP_ID = 'wx-test-appid'

assert.equal(
  createTrustedWechatCandidateSubject('wx:a', 'open:id'),
  'wechat-miniapp-v1:4:wx:a:7:open:id'
)
assert.notEqual(
  createTrustedWechatCandidateSubject('wx', 'a:b'),
  createTrustedWechatCandidateSubject('wx:a', 'b')
)
for (const invalid of ['', ' openid', 'openid ', 'open id', 'open\nid']) {
  assert.throws(() => createTrustedWechatCandidateSubject(APP_ID, invalid),
    error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')
}
for (const invalid of [null, false, 1, {}, []]) {
  assert.throws(() => createTrustedWechatCandidateSubject(APP_ID, invalid),
    error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')
}
assert.doesNotThrow(() => createTrustedWechatCandidateSubject('a'.repeat(128), 'b'.repeat(128)))
assert.throws(() => createTrustedWechatCandidateSubject('a'.repeat(129), 'openid'),
  error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')
assert.throws(() => createTrustedWechatCandidateSubject(APP_ID, 'b'.repeat(129)),
  error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')
assert.doesNotThrow(() => createTrustedWechatCandidateSubject(APP_ID, '界'.repeat(42)))
assert.throws(() => createTrustedWechatCandidateSubject(APP_ID, '界'.repeat(43)),
  error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')
assert.doesNotThrow(() => createTrustedWechatCandidateSubject(APP_ID, '😀'.repeat(32)))
assert.throws(() => createTrustedWechatCandidateSubject(APP_ID, '😀'.repeat(33)),
  error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')
assert.doesNotThrow(() => createTrustedWechatCandidateSubject('界'.repeat(42), 'openid'))
assert.throws(() => createTrustedWechatCandidateSubject('界'.repeat(43), 'openid'),
  error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')
assert.doesNotThrow(() => createTrustedWechatCandidateSubject('😀'.repeat(32), 'openid'))
assert.throws(() => createTrustedWechatCandidateSubject('😀'.repeat(33), 'openid'),
  error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID')

function createConnection(options = {}) {
  const calls = []
  return {
    calls,
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    async release() { calls.push('release') },
    async execute(sql, params = []) {
      calls.push({ sql, params })
      if (/^SELECT id FROM users/u.test(sql)) return [params.map(id => ({ id })), []]
      if (/^SELECT user_id FROM user_phone_bindings/u.test(sql)) {
        return [options.phoneRegistered === false ? [] : [{ user_id: params[0] }], []]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    }
  }
}

function createPool(connection) {
  let acquisitions = 0
  return {
    get acquisitions() { return acquisitions },
    async getConnection() { acquisitions += 1; return connection }
  }
}

{
  const connection = createConnection()
  const pool = createPool(connection)
  let shareInput
  const service = createInvitationRegistrationService({
    pool,
    appid: APP_ID,
    identityStore: {},
    entitlementStore: {},
    invitationStore: {
      async createShareCredentialInTransaction(context, input) {
        shareInput = input
        assert.equal(typeof context.execute, 'function')
        return { credentialId: 'internal-id', token: 'ivt1.public-once', expiresAt: new Date('2026-10-03T00:00:00Z') }
      }
    }
  })
  const result = await service.createShareCredential({ authenticatedUserId: '10' })
  assert.equal(result.token, 'ivt1.public-once')
  assert.deepEqual(shareInput, { inviterUserId: '10' })
  assert.equal(pool.acquisitions, 1)
  assert.deepEqual(connection.calls.filter(item => typeof item === 'string'), ['begin', 'commit', 'release'])
}

{
  const connection = createConnection({ phoneRegistered: false })
  const service = createInvitationRegistrationService({
    pool: createPool(connection),
    appid: APP_ID,
    identityStore: {}, entitlementStore: {}, invitationStore: {}
  })
  await assert.rejects(
    () => service.createShareCredential({ authenticatedUserId: '11' }),
    error => error.code === 'INVITATION_PHONE_REGISTRATION_REQUIRED'
  )
  assert.deepEqual(connection.calls.filter(item => typeof item === 'string'), ['begin', 'rollback', 'release'])
}

{
  const captured = []
  const connection = createConnection()
  const identityStore = {
    async findWechatOpenidByUserIdForPayment(userId) { return `openid-${userId}` }
  }
  const invitationStore = {
    async captureNewValidCandidateInTransaction(context, input) {
      captured.push(input)
      return { candidateReceipt: `receipt-${captured.length}`, candidateCapturedAt: new Date() }
    }
  }
  const service = createInvitationRegistrationService({
    pool: createPool(connection), appid: APP_ID, identityStore, entitlementStore: {}, invitationStore
  })
  await service.captureCandidate({ authenticatedUserId: '20', token: 'same-share-token' })
  await service.captureCandidate({ authenticatedUserId: '21', token: 'same-share-token' })
  assert.equal(captured[0].token, 'same-share-token')
  assert.equal(captured[1].token, 'same-share-token')
  assert.equal(captured[0].trustedCandidateSubject, `wechat-miniapp-v1:13:${APP_ID}:9:openid-20`)
  assert.equal(captured[1].trustedCandidateSubject, `wechat-miniapp-v1:13:${APP_ID}:9:openid-21`)
  assert.notEqual(captured[0].trustedCandidateSubject, captured[1].trustedCandidateSubject)
}

{
  const service = createInvitationRegistrationService({
    pool: createPool(createConnection()), appid: APP_ID,
    identityStore: { async findWechatOpenidByUserIdForPayment() { return null } },
    entitlementStore: {}, invitationStore: {
      async captureNewValidCandidateInTransaction() { throw new Error('unreachable') }
    }
  })
  await assert.rejects(
    () => service.captureCandidate({ authenticatedUserId: '22', token: 'server-token' }),
    error => error.code === 'INVITATION_WECHAT_SUBJECT_INVALID'
  )
}

{
  const connection = createConnection()
  const pool = createPool(connection)
  const contexts = []
  let bonusCalls = 0
  let reserveInput
  const identityStore = {
    async findWechatOpenidByUserIdForPayment() { return 'openid-current' },
    async prepareWechatPhoneIdentityForTransaction(identity) { return Object.freeze(identity) },
    async locateWechatPhoneIdentityParticipantsInTransaction(context) { contexts.push(context); return { userIds: ['30'] } },
    async verifyWechatBindingOwnerInTransaction(context) { contexts.push(context); return true },
    async resolveWechatPhoneIdentityInTransaction(context) {
      contexts.push(context)
      return { id: '30', isNew: false, isFirstPhoneRegistration: true, phoneMasked: '138****8000' }
    }
  }
  const entitlementStore = {
    async ensureRegistrationBonusInTransaction(context) {
      contexts.push(context); bonusCalls += 1; return { granted: true }
    }
  }
  const invitationStore = {
    async locateRegistrationRewardParticipantsInTransaction(context) {
      contexts.push(context); return { inviterUserId: '50', candidateLocated: true }
    },
    async reserveRegistrationRewardInTransaction(context, input) {
      contexts.push(context); reserveInput = input
      return { rewardStatus: 'REWARD_PENDING', registrationAllowed: true }
    }
  }
  const service = createInvitationRegistrationService({
    pool, appid: APP_ID, identityStore, entitlementStore, invitationStore
  })
  const preparedIdentity = await service.prepareWechatPhoneIdentity({ openid: 'openid-current', phone: {} })
  const result = await service.completePhoneRegistration({
    preparedIdentity,
    openid: 'openid-current',
    authenticatedUserId: '30',
    candidateReceipt: 'icr1.valid-looking-receipt'
  })
  assert.equal(result.identity.id, '30', 'same-account phone completion must keep the authenticated user id')
  assert.equal(bonusCalls, 1)
  assert.equal(reserveInput.inviteeUserId, '30')
  assert.equal(reserveInput.trustedCandidateSubject, `wechat-miniapp-v1:13:${APP_ID}:14:openid-current`)
  assert(contexts.every(context => context === contexts[0]))
  assert.equal(pool.acquisitions, 1, 'the composed transaction must acquire only one connection')
}

{
  const connection = createConnection()
  let receivedSubject = ''
  const identityStore = {
    async findWechatOpenidByUserIdForPayment() { return 'openid-other-session' },
    async locateWechatPhoneIdentityParticipantsInTransaction() { return { userIds: ['60'] } },
    async verifyWechatBindingOwnerInTransaction() { return false },
    async resolveWechatPhoneIdentityInTransaction() {
      return { id: '60', isFirstPhoneRegistration: true }
    }
  }
  const service = createInvitationRegistrationService({
    pool: createPool(connection), appid: APP_ID, identityStore,
    entitlementStore: { async ensureRegistrationBonusInTransaction() { return { granted: true } } },
    invitationStore: {
      async locateRegistrationRewardParticipantsInTransaction(context, input) {
        receivedSubject = input.trustedCandidateSubject
        return { inviterUserId: null, candidateLocated: false }
      },
      async reserveRegistrationRewardInTransaction() {
        return { rewardStatus: 'NO_REWARD', registrationAllowed: true, candidateAccepted: false }
      }
    }
  })
  const result = await service.completePhoneRegistration({
    preparedIdentity: Object.freeze({}), openid: 'openid-current', authenticatedUserId: '60', candidateReceipt: 'stolen'
  })
  assert.equal(result.registrationBonus.granted, true)
  assert.match(receivedSubject, /^wechat-session-mismatch:/u)
}

{
  const connection = createConnection()
  let resolutions = 0
  let bonusCalls = 0
  const service = createInvitationRegistrationService({
    pool: createPool(connection), appid: APP_ID,
    identityStore: {
      async locateWechatPhoneIdentityParticipantsInTransaction() { return { userIds: ['70'] } },
      async resolveWechatPhoneIdentityInTransaction() {
        resolutions += 1
        return { id: '70', isNew: false, isFirstPhoneRegistration: resolutions === 1 }
      }
    },
    entitlementStore: {
      async ensureRegistrationBonusInTransaction() { bonusCalls += 1; return { granted: true, amount: 30 } }
    },
    invitationStore: {
      async locateRegistrationRewardParticipantsInTransaction() { throw new Error('missing candidate must not be read') },
      async reserveRegistrationRewardInTransaction() { throw new Error('missing candidate must not be finalized') }
    }
  })
  const first = await service.completePhoneRegistration({ preparedIdentity: Object.freeze({}), openid: 'openid-70' })
  const replay = await service.completePhoneRegistration({ preparedIdentity: Object.freeze({}), openid: 'openid-70' })
  assert.equal(first.registrationBonus.amount, 30)
  assert.equal(first.invitation.noRewardReason, 'CANDIDATE_MISSING')
  assert.equal(replay.registrationBonus.skipped, 'NOT_FIRST_PHONE_REGISTRATION')
  assert.equal(bonusCalls, 1, 'phone registration replay must not issue a second REGISTER_BONUS')
}

console.log('invitation registration service tests passed')
