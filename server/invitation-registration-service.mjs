import mysql from 'mysql2/promise'

import { lockDatabaseUsersInTransaction, withDatabasePoolTransaction } from './database-transaction-context.mjs'
import { createIdentityStore } from './identity-store.mjs'
import { withInvitedPhoneRegistrationPoolTransaction } from './invitation-registration-transaction.mjs'
import { createInvitationStore } from './invitation-store.mjs'
import { createUserEntitlementStore } from './user-entitlement-store.mjs'
import { createInvitationRewardService } from './invitation-reward-service.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const MAX_UNSIGNED_BIGINT = 18446744073709551615n

function serviceError(message, code = 'INVITATION_SERVICE_UNAVAILABLE', statusCode = 503) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function normalizeUserId(value) {
  const text = typeof value === 'string' ? value : String(value || '')
  if (!/^[1-9]\d{0,19}$/u.test(text) || BigInt(text) > MAX_UNSIGNED_BIGINT) {
    throw serviceError('Authenticated user is invalid.', 'INVITATION_AUTH_INVALID', 401)
  }
  return text
}

function normalizeWechatValue(value, label) {
  const text = typeof value === 'string' ? value : ''
  const byteLength = Buffer.byteLength(text, 'utf8')
  if (!text || text !== text.trim() || byteLength > 128 || /[\s\u0000-\u001f\u007f]/u.test(text)) {
    throw serviceError(`${label} is invalid.`, 'INVITATION_WECHAT_SUBJECT_INVALID', 400)
  }
  return text
}

function getAppId(options = {}) {
  return normalizeWechatValue(
    options.appid === undefined
      ? (options.env || process.env).WECHAT_MINIAPP_APPID || (options.env || process.env).WECHAT_APPID
      : options.appid,
    'Wechat app id'
  )
}

export function createTrustedWechatCandidateSubject(appidValue, openidValue) {
  const appid = normalizeWechatValue(appidValue, 'Wechat app id')
  const openid = normalizeWechatValue(openidValue, 'Wechat openid')
  return `wechat-miniapp-v1:${Buffer.byteLength(appid, 'utf8')}:${appid}:${Buffer.byteLength(openid, 'utf8')}:${openid}`
}

function getDbConfig(options = {}) {
  const env = options.env || process.env
  const host = String(options.dbHost === undefined ? env.DB_HOST || DEFAULT_DB_HOST : options.dbHost).trim()
  const port = Number(options.dbPort === undefined ? env.DB_PORT || DEFAULT_DB_PORT : options.dbPort)
  const database = String(options.dbName === undefined ? env.DB_NAME || DEFAULT_DB_NAME : options.dbName).trim()
  const user = String(options.dbUser === undefined ? env.DB_USER || '' : options.dbUser).trim()
  const password = String(options.dbPassword === undefined ? env.DB_PASSWORD || '' : options.dbPassword)
  if (!host || !port || !database || !user || !password) {
    throw serviceError('Invitation database is unavailable.')
  }
  return { host, port, database, user, password }
}

export function createInvitationRegistrationService(options = {}) {
  let pool = options.pool || null
  let stores = null
  let rewards = null
  let invitationStoreInstance = options.invitationStore || null

  function getPool() {
    if (pool) return pool
    const config = getDbConfig(options)
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: Number(options.dbConnectionLimit || (options.env || process.env).DB_CONNECTION_LIMIT || 5),
      timezone: 'Z',
      namedPlaceholders: false
    })
    return pool
  }

  function getRewards() {
    if (!rewards) rewards = createInvitationRewardService({ ...options, getPool,
      entitlementStore: getStores().entitlementStore })
    return rewards
  }

  async function getSummary(input = {}) {
    const userId = normalizeUserId(input.authenticatedUserId)
    const [rows] = await getPool().execute(`SELECT COUNT(reward_slot) AS successful,
      COALESCE(SUM(CASE WHEN reward_status='REWARD_GRANTED' THEN reward_amount ELSE 0 END),0) AS earned,
      COALESCE(SUM(reward_status IN ('REWARD_PENDING','MANUAL_REVIEW')),0) AS pending
      FROM invitation_registration_relations WHERE inviter_user_id=?`, [userId])
    if (!Array.isArray(rows) || rows.length !== 1) throw serviceError('Invitation summary is unavailable.')
    const successfulInvitations = Number(rows[0].successful)
    if (![successfulInvitations, Number(rows[0].earned), Number(rows[0].pending)]
      .every(value => Number.isSafeInteger(value) && value >= 0)) throw serviceError('Invitation summary is invalid.')
    return { successfulInvitations, totalRewardQuota: Number(rows[0].earned),
      pendingRewards: Number(rows[0].pending), remainingRewardSlots: Math.max(0, 5 - successfulInvitations),
      limitReached: successfulInvitations >= 5 }
  }

  function getStores() {
    if (stores) return stores
    const sharedPool = getPool()
    stores = Object.freeze({
      identityStore: options.identityStore || createIdentityStore({ ...options, pool: sharedPool }),
      entitlementStore: options.entitlementStore || options.userEntitlementStore ||
        createUserEntitlementStore({ ...options, pool: sharedPool }),
      get invitationStore() {
        if (!invitationStoreInstance) invitationStoreInstance = createInvitationStore(options)
        return invitationStoreInstance
      }
    })
    return stores
  }

  async function createShareCredential(input = {}) {
    const authenticatedUserId = normalizeUserId(input.authenticatedUserId)
    const { invitationStore } = getStores()
    return await withDatabasePoolTransaction(getPool(), async context => {
      await lockDatabaseUsersInTransaction(context, [authenticatedUserId])
      const [bindings] = await context.execute(
        `SELECT user_id FROM user_phone_bindings
          WHERE user_id = ? AND status = 'active' LIMIT 2 FOR UPDATE`,
        [authenticatedUserId]
      )
      if (!Array.isArray(bindings) || bindings.length === 0) {
        throw serviceError('Phone registration is required.', 'INVITATION_PHONE_REGISTRATION_REQUIRED', 409)
      }
      const [slots] = await context.execute(`SELECT reward_slot FROM invitation_registration_relations
        WHERE inviter_user_id=? AND reward_slot IS NOT NULL FOR UPDATE`, [authenticatedUserId])
      if (slots.length >= 5) throw serviceError('Invitation reward limit reached.', 'INVITER_REWARD_LIMIT_REACHED', 409)
      return await invitationStore.createShareCredentialInTransaction(context, {
        inviterUserId: authenticatedUserId
      })
    }, { maximumAttempts: 3 })
  }

  async function captureCandidate(input = {}) {
    const { identityStore, invitationStore } = getStores()
    const openid = input.openid || await identityStore.findWechatOpenidByUserIdForPayment(normalizeUserId(input.authenticatedUserId))
    const subject = createTrustedWechatCandidateSubject(getAppId(options), openid)
    return await withDatabasePoolTransaction(getPool(), async context => {
      const [bindings] = await context.execute('SELECT user_id FROM wechat_user_bindings WHERE openid=? LIMIT 1', [openid])
      if (bindings.length) {
        const id = String(bindings[0].user_id)
        await lockDatabaseUsersInTransaction(context, [id])
        const [history] = await context.execute(`SELECT user_id FROM user_phone_bindings WHERE user_id=? LIMIT 1 FOR UPDATE`, [id])
        const [bonuses] = await context.execute(`SELECT user_id FROM entitlement_transactions
          WHERE user_id=? AND transaction_type='REGISTER_BONUS' LIMIT 1 FOR UPDATE`, [id])
        if (history.length || bonuses.length) throw serviceError('Phone registration is already complete.', 'INVITATION_RELATION_LOCKED', 409)
      }
      return await invitationStore.captureNewValidCandidateInTransaction(context, {
        token: input.token,
        trustedCandidateSubject: subject
      })
    }, { maximumAttempts: 3 })
  }

  async function prepareWechatPhoneIdentity(identity) {
    return await getStores().identityStore.prepareWechatPhoneIdentityForTransaction({
      ...identity,
      appid: getAppId(options)
    })
  }

  async function completePhoneRegistration(input = {}) {
    const { identityStore, entitlementStore } = getStores()
    const candidateReceipt = typeof input.candidateReceipt === 'string' ? input.candidateReceipt : ''
    let trustedCandidateSubject = ''
    let candidateOpenid = ''
    if (candidateReceipt) {
      try {
        candidateOpenid = normalizeWechatValue(input.openid, 'Wechat openid')
        trustedCandidateSubject = createTrustedWechatCandidateSubject(getAppId(options), candidateOpenid)
      } catch {
        // Invitation continuity failures must not block phone identity or REGISTER_BONUS.
        trustedCandidateSubject = ''
        candidateOpenid = ''
      }
    }
    let usableCandidateReceipt = trustedCandidateSubject ? candidateReceipt : ''
    let invitationStore = null
    let invitationUnavailable = false
    if (usableCandidateReceipt) {
      try { invitationStore = getStores().invitationStore } catch (error) {
        if (!/^INVITATION_(TOKEN|CANDIDATE)_HMAC_SECRET_/u.test(error?.code || '')) throw error
        usableCandidateReceipt = ''
        invitationUnavailable = true
      }
    }
    const registration = await withInvitedPhoneRegistrationPoolTransaction(getPool(), {
      preparedIdentity: input.preparedIdentity,
      candidateReceipt: usableCandidateReceipt,
      trustedCandidateSubject
    }, { identityStore, entitlementStore, invitationStore })
    if (invitationUnavailable) return { ...registration,
      invitation: { ...registration.invitation, noRewardReason: 'INVITATION_UNAVAILABLE' } }
    if (registration.invitation.rewardStatus !== 'REWARD_PENDING') return registration
    try {
      const delivered = await getRewards().deliver(registration.invitation.invitationId)
      if (delivered.granted) return { ...registration,
        invitation: { ...registration.invitation, rewardStatus: 'REWARD_GRANTED' } }
    } catch {
      // Registration is committed. The durable pending row is recovered by the worker.
      console.warn('invitation-immediate-reward failed code=INVITATION_REWARD_FAILED')
    }
    return registration
  }

  return Object.freeze({
    createShareCredential,
    captureCandidate,
    getSummary,
    startRewardRecovery() {
      // Validate the existing invitation opt-in configuration before scanning.
      getStores().invitationStore
      return getRewards().start()
    },
    stopRewardRecovery() { return rewards?.stop() },
    prepareWechatPhoneIdentity,
    completePhoneRegistration
  })
}
