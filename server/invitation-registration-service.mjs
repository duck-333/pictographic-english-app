import mysql from 'mysql2/promise'

import { lockDatabaseUsersInTransaction, withDatabasePoolTransaction } from './database-transaction-context.mjs'
import { createIdentityStore } from './identity-store.mjs'
import { withInvitedPhoneRegistrationPoolTransaction } from './invitation-registration-transaction.mjs'
import { createInvitationStore } from './invitation-store.mjs'
import { createUserEntitlementStore } from './user-entitlement-store.mjs'

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

function optionalCandidateUserId(value) {
  try { return normalizeUserId(value) } catch { return '' }
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

  function getPool() {
    if (pool) return pool
    const config = getDbConfig(options)
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: Number(options.dbConnectionLimit || (options.env || process.env).DB_CONNECTION_LIMIT || 5),
      namedPlaceholders: false
    })
    return pool
  }

  function getStores() {
    if (stores) return stores
    const sharedPool = getPool()
    stores = Object.freeze({
      identityStore: options.identityStore || createIdentityStore({ ...options, pool: sharedPool }),
      entitlementStore: options.entitlementStore || options.userEntitlementStore ||
        createUserEntitlementStore({ ...options, pool: sharedPool }),
      invitationStore: options.invitationStore || createInvitationStore(options)
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
      if (!Array.isArray(bindings) || bindings.length !== 1) {
        throw serviceError('Phone registration is required.', 'INVITATION_PHONE_REGISTRATION_REQUIRED', 409)
      }
      return await invitationStore.createShareCredentialInTransaction(context, {
        inviterUserId: authenticatedUserId
      })
    }, { maximumAttempts: 3 })
  }

  async function captureCandidate(input = {}) {
    const authenticatedUserId = normalizeUserId(input.authenticatedUserId)
    const { identityStore, invitationStore } = getStores()
    const openid = await identityStore.findWechatOpenidByUserIdForPayment(authenticatedUserId)
    const subject = createTrustedWechatCandidateSubject(getAppId(options), openid)
    return await withDatabasePoolTransaction(getPool(), context => (
      invitationStore.captureNewValidCandidateInTransaction(context, {
        token: input.token,
        trustedCandidateSubject: subject
      })
    ), { maximumAttempts: 3 })
  }

  async function prepareWechatPhoneIdentity(identity) {
    return await getStores().identityStore.prepareWechatPhoneIdentityForTransaction({
      ...identity,
      appid: getAppId(options)
    })
  }

  async function completePhoneRegistration(input = {}) {
    const { identityStore, entitlementStore, invitationStore } = getStores()
    const candidateReceipt = typeof input.candidateReceipt === 'string' ? input.candidateReceipt : ''
    const authenticatedUserId = candidateReceipt ? optionalCandidateUserId(input.authenticatedUserId) : ''
    let trustedCandidateSubject = ''
    let candidateOpenid = ''
    if (candidateReceipt && authenticatedUserId) {
      try {
        candidateOpenid = normalizeWechatValue(input.openid, 'Wechat openid')
        trustedCandidateSubject = createTrustedWechatCandidateSubject(getAppId(options), candidateOpenid)
      } catch {
        // Invitation continuity failures must not block phone identity or REGISTER_BONUS.
        trustedCandidateSubject = ''
        candidateOpenid = ''
      }
    }
    const usableCandidateReceipt = trustedCandidateSubject ? candidateReceipt : ''
    return await withInvitedPhoneRegistrationPoolTransaction(getPool(), {
      preparedIdentity: input.preparedIdentity,
      candidateReceipt: usableCandidateReceipt,
      trustedCandidateSubject,
      candidateSessionUserId: usableCandidateReceipt ? authenticatedUserId : '',
      candidateOpenid: usableCandidateReceipt ? candidateOpenid : ''
    }, { identityStore, entitlementStore, invitationStore })
  }

  return Object.freeze({
    createShareCredential,
    captureCandidate,
    prepareWechatPhoneIdentity,
    completePhoneRegistration
  })
}
