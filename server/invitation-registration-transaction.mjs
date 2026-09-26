import {
  lockDatabaseUsersInTransaction,
  requireDatabaseTransactionContext,
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
  requireMethod(identityStore, 'locateWechatPhoneIdentityParticipantsInTransaction')
  requireMethod(identityStore, 'resolveWechatPhoneIdentityInTransaction')
  requireMethod(entitlementStore, 'ensureRegistrationBonusInTransaction')
  requireMethod(invitationStore, 'locateRegistrationRewardParticipantsInTransaction')
  requireMethod(invitationStore, 'reserveRegistrationRewardInTransaction')

  const identityParticipants = await identityStore.locateWechatPhoneIdentityParticipantsInTransaction(
    context, input.preparedIdentity)
  const invitationParticipants = await invitationStore.locateRegistrationRewardParticipantsInTransaction(context, {
    candidateReceipt: input.candidateReceipt,
    trustedCandidateSubject: input.trustedCandidateSubject
  })
  await lockDatabaseUsersInTransaction(context, [
    ...(identityParticipants.userIds || []),
    invitationParticipants.inviterUserId
  ].filter(Boolean), { allowMissing: true })

  const identity = await identityStore.resolveWechatPhoneIdentityInTransaction(context, input.preparedIdentity)
  const registrationBonus = identity.isFirstPhoneRegistration
    ? await entitlementStore.ensureRegistrationBonusInTransaction(context, identity.id)
    : Object.freeze({ granted: false, idempotent: true, skipped: 'NOT_FIRST_PHONE_REGISTRATION' })
  const invitation = await invitationStore.reserveRegistrationRewardInTransaction(context, {
    inviteeUserId: identity.id,
    candidateReceipt: input.candidateReceipt,
    trustedCandidateSubject: input.trustedCandidateSubject,
    isFirstPhoneRegistration: identity.isFirstPhoneRegistration === true
  })
  return Object.freeze({ identity, registrationBonus, invitation })
}

export async function withInvitedPhoneRegistrationTransaction(connection, input = {}, dependencies = {}) {
  try {
    return await withDatabaseTransaction(
      connection,
      context => completeInvitedPhoneRegistrationInTransaction(context, input, dependencies),
      {
        maximumAttempts: 3,
        retryableCodes: [
          'IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT',
          'IDENTITY_WECHAT_BINDING_CONCURRENT_CONFLICT',
          'IDENTITY_PARTICIPANTS_CHANGED'
        ]
      }
    )
  } catch (error) {
    if (['IDENTITY_PHONE_BINDING_CONCURRENT_CONFLICT', 'IDENTITY_WECHAT_BINDING_CONCURRENT_CONFLICT',
      'IDENTITY_PARTICIPANTS_CHANGED'].includes(error?.code)) {
      const publicError = new Error('Identity binding conflict.')
      publicError.code = 'IDENTITY_CONFLICT'
      publicError.statusCode = 409
      throw publicError
    }
    throw error
  }
}
