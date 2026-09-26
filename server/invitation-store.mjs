import crypto from 'node:crypto'
import { lockDatabaseUsersInTransaction, requireDatabaseTransactionContext } from './database-transaction-context.mjs'
import { createInvitationCredentialSecurity } from './invitation-credential-security.mjs'

const SHARE = 'invitation_share_credentials'
const RELATION = 'invitation_registration_relations'
const MAX_UNSIGNED_BIGINT = 18446744073709551615n

function failure(message, code = 'INVITATION_STORE_ERROR', statusCode = 500) {
  const error = new Error(message); error.code = code; error.statusCode = statusCode; return error
}
function transactionRequired() {
  return failure('Active database transaction context is required.', 'DATABASE_TRANSACTION_REQUIRED')
}
function connectionOf(value) {
  try { return requireDatabaseTransactionContext(value) } catch { throw transactionRequired() }
}
function rows(result) {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw failure('Invitation database result is invalid.')
  return result[0]
}
function oneUpdate(result, label) {
  if (!Array.isArray(result) || Number(result[0]?.affectedRows) !== 1) throw failure(`Invitation update failed: ${label}.`)
}
function userId(value, label = 'User id') {
  let text
  if (typeof value === 'bigint') text = value.toString()
  else if (typeof value === 'number' && Number.isSafeInteger(value)) text = String(value)
  else if (typeof value === 'string') text = value
  else text = ''
  if (!/^[1-9]\d{0,19}$/u.test(text) || BigInt(text) > MAX_UNSIGNED_BIGINT) {
    throw failure(`${label} is invalid.`, 'INVITATION_USER_ID_INVALID', 400)
  }
  return text
}
function isDuplicate(error, key) {
  return Boolean(error?.code === 'ER_DUP_ENTRY' && String(error.sqlMessage || error.message || '').includes(key))
}
function sameDigest(actual, expected) {
  const left = Buffer.from(actual || []); const right = Buffer.from(expected || [])
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}
function finalResult(row) {
  return Object.freeze({ invitationId: String(row.invitation_id), relationStatus: 'FINAL',
    rewardStatus: String(row.reward_status), noRewardReason: row.no_reward_reason === null ? null : String(row.no_reward_reason),
    rewardReserved: ['REWARD_PENDING', 'REWARD_GRANTED', 'MANUAL_REVIEW'].includes(String(row.reward_status)),
    registrationAllowed: true, candidateAccepted: true })
}
function rejectedCandidate(reason) {
  return Object.freeze({ invitationId: null, relationStatus: null, rewardStatus: 'NO_REWARD',
    noRewardReason: reason, rewardReserved: false, registrationAllowed: true, candidateAccepted: false })
}
async function databaseNow(connection) {
  const result = await connection.execute('SELECT UTC_TIMESTAMP(3) AS database_now')
  const row = rows(result)[0]
  const now = new Date(row.database_now)
  if (!Number.isFinite(now.getTime())) throw failure('Database transaction time is invalid.')
  return now
}

async function activeBySubject(connection, subjectDigest) {
  const found = rows(await connection.execute(`SELECT id, invitation_id, relation_status FROM ${RELATION}
    WHERE active_candidate_subject_digest = ? LIMIT 2 FOR UPDATE`, [subjectDigest]))
  if (found.length > 1) throw failure('Candidate subject state is invalid.')
  return found[0] || null
}

export function chooseInvitationRewardSlot(values) {
  const used = new Set(Array.from(values || [], Number))
  for (let slot = 1; slot <= 5; slot += 1) if (!used.has(slot)) return slot
  return null
}

export function createInvitationStore(options = {}) {
  const security = options.security || createInvitationCredentialSecurity(options)
  const idFactory = options.idFactory || crypto.randomUUID

  async function createShareCredentialInTransaction(value, input = {}) {
    const connection = connectionOf(value); const now = await databaseNow(connection)
    const inviter = userId(input.inviterUserId, 'Inviter user id')
    const token = security.generateInvitationToken(); const credentialId = idFactory()
    await connection.execute(`INSERT INTO ${SHARE}
      (credential_id, inviter_user_id, token_digest, token_key_version, credential_status, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', DATE_ADD(?, INTERVAL 7 DAY), ?, ?)`,
    [credentialId, inviter, security.digestInvitationToken(token), security.hashVersion, now, now, now])
    return Object.freeze({ credentialId, token, createdAt: now, expiresAt: new Date(now.getTime() + 604800000) })
  }

  async function validShare(connection, token, now) {
    let digest
    try { digest = security.digestInvitationToken(token) } catch { throw failure('Invitation credential is invalid.', 'INVITATION_CREDENTIAL_INVALID', 400) }
    const found = rows(await connection.execute(`SELECT id, credential_id, inviter_user_id, credential_status, expires_at, revoked_at
      FROM ${SHARE} WHERE token_digest = ? LIMIT 2 FOR UPDATE`, [digest]))
    if (found.length !== 1) throw failure('Invitation credential is invalid.', 'INVITATION_CREDENTIAL_INVALID', 400)
    const row = found[0]
    if (row.credential_status !== 'ACTIVE' || row.revoked_at !== null) throw failure('Invitation credential is invalid.', 'INVITATION_CREDENTIAL_REVOKED', 400)
    if (new Date(row.expires_at).getTime() <= now.getTime()) throw failure('Invitation credential is invalid.', 'INVITATION_CREDENTIAL_EXPIRED', 400)
    return row
  }

  async function resolveValidShareCredentialInTransaction(value, token) {
    const connection = connectionOf(value); const now = await databaseNow(connection); const row = await validShare(connection, token, now)
    return Object.freeze({ credentialId: String(row.credential_id), inviterUserId: String(row.inviter_user_id), expiresAt: new Date(row.expires_at) })
  }

  async function revokeShareCredentialInTransaction(value, input = {}) {
    const connection = connectionOf(value); const now = await databaseNow(connection)
    const credentialId = String(input.credentialId || '').trim()
    if (!/^[0-9a-f-]{36}$/iu.test(credentialId)) throw failure('Invitation credential id is invalid.', 'INVITATION_CREDENTIAL_ID_INVALID', 400)
    oneUpdate(await connection.execute(`UPDATE ${SHARE} SET credential_status='REVOKED', revoked_at=?, updated_at=?
      WHERE credential_id=? AND credential_status='ACTIVE' AND revoked_at IS NULL`, [now, now, credentialId]), 'credential revocation')
    return Object.freeze({ credentialId, revoked: true, revokedAt: now })
  }

  async function insertCandidate(connection, share, subjectDigest, now, invitationId, receipt) {
    await connection.execute(`INSERT INTO ${RELATION}
      (invitation_id, share_credential_id, inviter_user_id, candidate_subject_digest, candidate_receipt_digest,
       candidate_key_version, relation_status, qualification_status, reward_status, candidate_captured_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'CANDIDATE', 'UNRESOLVED', 'NOT_RESERVED', ?, ?, ?)`,
    [invitationId, share.id, share.inviter_user_id, subjectDigest, security.digestCandidateReceipt(receipt), security.hashVersion, now, now, now])
  }

  async function replaceCandidate(connection, current, share, subjectDigest, now, invitationId, receipt) {
    if (current.relation_status === 'FINAL') throw failure('Invitation relationship is permanently locked.', 'INVITATION_RELATION_LOCKED', 409)
    oneUpdate(await connection.execute(`UPDATE ${RELATION} SET relation_status = 'SUPERSEDED',
      candidate_superseded_at = ?, superseded_by_invitation_id = ?, updated_at = ?
      WHERE id = ? AND relation_status = 'CANDIDATE'`, [now, invitationId, now, current.id]), 'candidate supersession')
    await insertCandidate(connection, share, subjectDigest, now, invitationId, receipt)
  }

  async function captureNewValidCandidateInTransaction(value, input = {}) {
    const connection = connectionOf(value); const now = await databaseNow(connection)
    if (Object.prototype.hasOwnProperty.call(input, 'candidateReceipt')) throw failure('Caller-selected receipt is forbidden.', 'INVITATION_RECEIPT_CALLER_SELECTED', 400)
    const subjectDigest = security.digestTrustedCandidateSubject(input.trustedCandidateSubject)
    const share = await validShare(connection, input.token, now)
    const invitationId = idFactory(); const candidateReceipt = security.generateCandidateReceipt()
    const current = await activeBySubject(connection, subjectDigest)
    if (current) await replaceCandidate(connection, current, share, subjectDigest, now, invitationId, candidateReceipt)
    else {
      try { await insertCandidate(connection, share, subjectDigest, now, invitationId, candidateReceipt) } catch (error) {
        if (!isDuplicate(error, 'uk_invitation_relation_active_subject')) throw error
        const concurrent = await activeBySubject(connection, subjectDigest)
        if (!concurrent) throw failure('Concurrent candidate state is invalid.')
        await replaceCandidate(connection, concurrent, share, subjectDigest, now, invitationId, candidateReceipt)
      }
    }
    return Object.freeze({ invitationId, candidateReceipt, candidateCapturedAt: now })
  }

  async function resolveCurrentCandidateInTransaction(value, input = {}) {
    const connection = connectionOf(value); await databaseNow(connection)
    const subject = security.digestTrustedCandidateSubject(input.trustedCandidateSubject)
    let receipt
    try { receipt = security.digestCandidateReceipt(input.candidateReceipt) } catch { throw failure('Candidate receipt is invalid.', 'INVITATION_CANDIDATE_RECEIPT_INVALID', 400) }
    const found = rows(await connection.execute(`SELECT invitation_id, relation_status FROM ${RELATION}
      WHERE candidate_receipt_digest = ? AND candidate_subject_digest = ? LIMIT 2 FOR UPDATE`, [receipt, subject]))
    if (found.length !== 1) throw failure('Candidate receipt is unknown for this subject.', 'INVITATION_CANDIDATE_RECEIPT_UNKNOWN', 400)
    if (found[0].relation_status !== 'CANDIDATE') return rejectedCandidate('CANDIDATE_SUPERSEDED')
    return Object.freeze({ invitationId: String(found[0].invitation_id), candidateAccepted: true })
  }

  async function locateCandidate(connection, input = {}) {
    const subject = security.digestTrustedCandidateSubject(input.trustedCandidateSubject)
    let receipt
    try { receipt = security.digestCandidateReceipt(input.candidateReceipt) } catch { return null }
    const located = rows(await connection.execute(`SELECT id, share_credential_id, inviter_user_id, relation_status
      FROM ${RELATION} WHERE candidate_receipt_digest = ? AND candidate_subject_digest = ? LIMIT 2`, [receipt, subject]))
    if (located.length !== 1) return null
    return Object.freeze({ row: located[0], receipt, subject })
  }

  async function locateRegistrationRewardParticipantsInTransaction(value, input = {}) {
    const connection = connectionOf(value)
    const location = await locateCandidate(connection, input)
    return Object.freeze({
      inviterUserId: location ? userId(location.row.inviter_user_id, 'Inviter user id') : null,
      candidateLocated: Boolean(location)
    })
  }

  async function reserveRegistrationRewardInTransaction(value, input = {}) {
    const connection = connectionOf(value); const now = await databaseNow(connection)
    const invitee = userId(input.inviteeUserId, 'Invitee user id')
    const located = await locateCandidate(connection, input)
    if (!located) return rejectedCandidate('CANDIDATE_INVALID')
    const { row: location, receipt, subject } = located
    const inviter = userId(location.inviter_user_id, 'Inviter user id')
    const lockedUserIds = new Set(await lockDatabaseUsersInTransaction(value, [invitee, inviter], { allowMissing: true }))
    if (!lockedUserIds.has(invitee)) throw failure('Invitee user is unavailable.', 'INVITATION_INVITEE_NOT_FOUND')
    const existing = rows(await connection.execute(`SELECT invitation_id, reward_status, no_reward_reason FROM ${RELATION}
      WHERE invitee_user_id = ? AND relation_status = 'FINAL' LIMIT 2`, [invitee]))
    if (existing.length === 1) return finalResult(existing[0])
    const shares = rows(await connection.execute(`SELECT id, inviter_user_id, credential_status, expires_at, revoked_at
      FROM ${SHARE} WHERE id = ? LIMIT 1 FOR UPDATE`, [location.share_credential_id]))
    if (shares.length !== 1) return rejectedCandidate('CANDIDATE_INVALID')
    const relations = rows(await connection.execute(`SELECT id, invitation_id, share_credential_id, inviter_user_id,
      candidate_receipt_digest, candidate_subject_digest, relation_status FROM ${RELATION}
      WHERE id = ? LIMIT 1 FOR UPDATE`, [location.id]))
    if (relations.length !== 1) return rejectedCandidate('CANDIDATE_INVALID')
    const row = relations[0]; const share = shares[0]
    if (String(row.id) !== String(location.id) || String(row.share_credential_id) !== String(location.share_credential_id) ||
        String(row.inviter_user_id) !== inviter || String(share.id) !== String(location.share_credential_id) ||
        String(share.inviter_user_id) !== inviter || !sameDigest(row.candidate_receipt_digest, receipt) ||
        !sameDigest(row.candidate_subject_digest, subject)) return rejectedCandidate('CANDIDATE_INVALID')
    const lockedExisting = rows(await connection.execute(`SELECT invitation_id, reward_status, no_reward_reason FROM ${RELATION}
      WHERE invitee_user_id = ? AND relation_status = 'FINAL' LIMIT 2 FOR UPDATE`, [invitee]))
    if (lockedExisting.length === 1) return finalResult(lockedExisting[0])
    if (row.relation_status !== 'CANDIDATE') return rejectedCandidate('CANDIDATE_SUPERSEDED')
    let reason = input.isFirstPhoneRegistration === true ? null : 'NOT_FIRST_PHONE_REGISTRATION'
    if (!reason && String(row.inviter_user_id) === invitee) reason = 'SELF_INVITE'
    if (!reason && (share.credential_status !== 'ACTIVE' || share.revoked_at !== null)) reason = 'INVITATION_REVOKED'
    if (!reason && new Date(share.expires_at).getTime() <= now.getTime()) reason = 'INVITATION_EXPIRED'
    let slot = null
    if (!reason) {
      if (!lockedUserIds.has(inviter)) reason = 'INVITER_NOT_FOUND'
      else {
        const slots = rows(await connection.execute(`SELECT reward_slot FROM ${RELATION}
          WHERE inviter_user_id = ? AND reward_status IN ('REWARD_PENDING','REWARD_GRANTED','MANUAL_REVIEW')
          ORDER BY reward_slot FOR UPDATE`, [inviter]))
        slot = chooseInvitationRewardSlot(slots.map(item => item.reward_slot))
        if (slot === null) reason = 'INVITER_REWARD_LIMIT_REACHED'
      }
    }
    try {
      if (reason) oneUpdate(await connection.execute(`UPDATE ${RELATION} SET invitee_user_id=?, relation_status='FINAL',
        qualification_status='INELIGIBLE', reward_status='NO_REWARD', no_reward_reason=?, relation_locked_at=?, updated_at=?
        WHERE id=? AND relation_status='CANDIDATE'`, [invitee, reason, now, now, row.id]), 'no reward finalization')
      else oneUpdate(await connection.execute(`UPDATE ${RELATION} SET invitee_user_id=?, relation_status='FINAL',
        qualification_status='ELIGIBLE', reward_status='REWARD_PENDING', reward_slot=?, reward_amount=30,
        reward_reserved_at=?, relation_locked_at=?, updated_at=? WHERE id=? AND relation_status='CANDIDATE'`,
      [invitee, slot, now, now, now, row.id]), 'reward reservation')
    } catch (error) {
      if (!isDuplicate(error, 'uk_invitation_relation_invitee')) throw error
      const replay = rows(await connection.execute(`SELECT invitation_id, reward_status, no_reward_reason FROM ${RELATION}
        WHERE invitee_user_id = ? AND relation_status='FINAL' LIMIT 2 FOR UPDATE`, [invitee]))
      if (replay.length !== 1) throw failure('Final invitation replay is inconsistent.')
      return finalResult(replay[0])
    }
    return Object.freeze({ invitationId: String(row.invitation_id), relationStatus: 'FINAL',
      rewardStatus: reason ? 'NO_REWARD' : 'REWARD_PENDING', noRewardReason: reason,
      rewardReserved: !reason, registrationAllowed: true, candidateAccepted: true })
  }

  return Object.freeze({ createShareCredentialInTransaction, resolveValidShareCredentialInTransaction,
    revokeShareCredentialInTransaction, captureNewValidCandidateInTransaction,
    resolveCurrentCandidateInTransaction, locateRegistrationRewardParticipantsInTransaction,
    reserveRegistrationRewardInTransaction })
}
