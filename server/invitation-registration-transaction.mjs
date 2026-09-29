import {
  lockDatabaseUsersInTransaction,
  requireDatabaseTransactionContext,
  withDatabasePoolTransaction,
  withDatabaseTransaction
} from './database-transaction-context.mjs'

function requireMethod(value, name) {
  if (!value || typeof value[name] !== 'function') {
    const error = new Error(`Invitation registration dependency is missing ${name}.`)
    error.code = 'INVITATION_REGISTRATION_DEPENDENCY_INVALID'
    error.statusCode = 500
    throw error
  }
}

export async function completeInvitedPhoneRegistrationInTransaction(transactionContext, input = {}, dependencies = {}) {
  const context = requireDatabaseTransactionContext(transactionContext)
  const identityStore = dependencies.identityStore
  const entitlementStore = dependencies.entitlementStore
  const invitationStore = dependencies.invitationStore
  const testHooks = dependencies.enableTestHooks === true && dependencies.testHooks &&
    typeof dependencies.testHooks === 'object' ? dependencies.testHooks : Object.freeze({})
  requireMethod(identityStore, 'locateWechatPhoneIdentityParticipantsInTransaction')
  requireMethod(identityStore, 'resolveWechatPhoneIdentityInTransaction')
  requireMethod(entitlementStore, 'ensureRegistrationBonusInTransaction')
  const hasCandidateReceipt = typeof input.candidateReceipt === 'string' && input.candidateReceipt.length > 0
  if (hasCandidateReceipt) {
    requireMethod(identityStore, 'verifyWechatBindingOwnerInTransaction')
    requireMethod(invitationStore, 'locateRegistrationRewardParticipantsInTransaction')
    requireMethod(invitationStore, 'reserveRegistrationRewardInTransaction')
  }

  const identityParticipants = await identityStore.locateWechatPhoneIdentityParticipantsInTransaction(
    context, input.preparedIdentity)
  const candidateContinuityVerified = hasCandidateReceipt &&
    await identityStore.verifyWechatBindingOwnerInTransaction(context, {
      userId: input.candidateSessionUserId,
      openid: input.candidateOpenid
    })
  const effectiveCandidateSubject = candidateContinuityVerified
    ? input.trustedCandidateSubject
    : `wechat-session-mismatch:${String(input.candidateSessionUserId || '')}`
  const invitationParticipants = hasCandidateReceipt
    ? await invitationStore.locateRegistrationRewardParticipantsInTransaction(context, {
        candidateReceipt: input.candidateReceipt,
        trustedCandidateSubject: effectiveCandidateSubject
      })
    : Object.freeze({ inviterUserId: null, candidateLocated: false })
  if (typeof testHooks.beforeUnifiedUserLock === 'function') await testHooks.beforeUnifiedUserLock()
  await lockDatabaseUsersInTransaction(context, [
    ...(identityParticipants.userIds || []),
    invitationParticipants.inviterUserId,
    hasCandidateReceipt ? input.candidateSessionUserId : null
  ].filter(Boolean), { allowMissing: true })

  const lockedCandidateContinuityVerified = candidateContinuityVerified &&
    await identityStore.verifyWechatBindingOwnerInTransaction(context, {
      userId: input.candidateSessionUserId,
      openid: input.candidateOpenid
    })
  const reservationCandidateSubject = lockedCandidateContinuityVerified
    ? effectiveCandidateSubject
    : `wechat-session-mismatch:${String(input.candidateSessionUserId || '')}`

  const identity = await identityStore.resolveWechatPhoneIdentityInTransaction(context, input.preparedIdentity)
  const registrationBonus = identity.isFirstPhoneRegistration
    ? await entitlementStore.ensureRegistrationBonusInTransaction(context, identity.id)
    : Object.freeze({ granted: false, idempotent: true, skipped: 'NOT_FIRST_PHONE_REGISTRATION' })
  const invitation = hasCandidateReceipt
    ? await invitationStore.reserveRegistrationRewardInTransaction(context, {
        inviteeUserId: identity.id,
        candidateReceipt: input.candidateReceipt,
        trustedCandidateSubject: reservationCandidateSubject,
        isFirstPhoneRegistration: identity.isFirstPhoneRegistration === true
      })
    : Object.freeze({ invitationId: null, relationStatus: null, rewardStatus: 'NO_REWARD',
        noRewardReason: 'CANDIDATE_MISSING', rewardReserved: false,
        registrationAllowed: true, candidateAccepted: false })
  return Object.freeze({ identity, registrationBonus, invitation })
}

const INVITED_REGISTRATION_RETRY_CODES = Object.freeze([
  'IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT',
  'IDENTITY_WECHAT_BINDING_CONCURRENT_CONFLICT',
  'IDENTITY_PARTICIPANTS_CHANGED'
])

function sanitizeIdentityConflict(error) {
  if (INVITED_REGISTRATION_RETRY_CODES.includes(error?.code)) {
    const publicError = new Error('Identity binding conflict.')
    publicError.code = 'IDENTITY_CONFLICT'
    publicError.statusCode = 409
    throw publicError
  }
  throw error
}

export async function withInvitedPhoneRegistrationTransaction(connection, input = {}, dependencies = {}) {
  try {
    return await withDatabaseTransaction(
      connection,
      context => completeInvitedPhoneRegistrationInTransaction(context, input, dependencies),
      {
        maximumAttempts: 3,
        retryableCodes: INVITED_REGISTRATION_RETRY_CODES
      }
    )
  } catch (error) {
    sanitizeIdentityConflict(error)
  }
}

export async function withInvitedPhoneRegistrationPoolTransaction(pool, input = {}, dependencies = {}) {
  try {
    return await withDatabasePoolTransaction(
      pool,
      context => completeInvitedPhoneRegistrationInTransaction(context, input, dependencies),
      { maximumAttempts: 3, retryableCodes: INVITED_REGISTRATION_RETRY_CODES }
    )
  } catch (error) {
    sanitizeIdentityConflict(error)
  }
}
