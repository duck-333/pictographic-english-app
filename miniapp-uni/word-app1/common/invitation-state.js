import { captureAuthSession, isAuthSessionCurrent, subscribeAuthSession } from './auth-store.js'
import { captureInvitationCandidate, invitationMessage } from './invitation-api-client.js'

const KEY = 'pictographic:pendingInvitation'
const listeners = new Set()
let candidate = null
let incoming = null
let message = ''
let epoch = 0
let task = null
let registering = false
let initialized = false

function persist() {
  const value = { ownerId: captureAuthSession().userId, candidate, incoming }
  if (!candidate && !incoming) uni.removeStorageSync(KEY)
  else uni.setStorageSync(KEY, value)
}
function notify() { listeners.forEach(fn => fn()) }
function initialize() {
  if (initialized) return
  initialized = true
  try {
    const stored = uni.getStorageSync(KEY)
    if (stored && stored.ownerId === captureAuthSession().userId) {
      candidate = stored.candidate || null
      incoming = stored.incoming || null
    }
  } catch (error) {}
  expireCandidate()
}
function expireCandidate() {
  if (candidate && !(Date.parse(candidate.expiresAt) > Date.now())) {
    candidate = null
    message = '好友邀请已过期，可继续正常注册'
    persist()
  }
}
export function clearPendingInvitation() {
  epoch++
  task = null
  candidate = null
  incoming = null
  message = ''
  try { persist() } catch (error) {}
  notify()
}
subscribeAuthSession(clearPendingInvitation)

export function invitationState() {
  initialize()
  expireCandidate()
  return { candidate: Boolean(candidate), pending: Boolean(incoming), saving: Boolean(task), message }
}
export function subscribeInvitation(listener) { listeners.add(listener); return () => listeners.delete(listener) }

export function receiveInvitation(query = {}, options = {}) {
  initialize()
  const token = typeof query.invitationToken === 'string' ? query.invitationToken : ''
  if (!token) return Promise.resolve()
  if (token.length > 128) { message = '此邀请无效，可继续正常注册'; notify(); return Promise.resolve() }
  if (!incoming && candidate && candidate.token === token) return Promise.resolve()
  if (!incoming || incoming.token !== token) {
    incoming = { token }
    persist()
  }
  notify()
  if (registering) return Promise.resolve()
  return saveIncomingInvitation(options)
}

export function saveIncomingInvitation(options = {}) {
  initialize()
  if (task) return task
  if (!incoming) return Promise.resolve()
  const activeEpoch = epoch
  const operation = (async () => {
    while (incoming && epoch === activeEpoch) {
      const target = incoming
      const snapshot = captureAuthSession()
      const isOperationCurrent = () => epoch === activeEpoch && isAuthSessionCurrent(snapshot)
      try {
        const result = await captureInvitationCandidate(target.token, { ...options, isOperationCurrent })
        if (epoch !== activeEpoch || !isAuthSessionCurrent(snapshot)) return
        candidate = { ...result, token: target.token }
        message = '好友邀请已保存，首次手机号注册时由服务器确认权益'
        if (incoming === target) incoming = null
      } catch (error) {
        if (epoch !== activeEpoch || !isAuthSessionCurrent(snapshot)) return
        message = invitationMessage(error) + (candidate && error.code === 'INVITATION_CREDENTIAL_INVALID' ? '；此前有效邀请已保留' : '')
        if (['INVITATION_CREDENTIAL_INVALID', 'INVITATION_RELATION_LOCKED'].includes(error.code)) {
          if (incoming === target) incoming = null
          if (error.code === 'INVITATION_RELATION_LOCKED') candidate = null
        } else {
          persist()
          throw error
        }
      }
      persist()
      notify()
    }
  })().finally(() => { if (task === operation) { task = null; notify() } })
  task = operation
  notify()
  return task
}

export function beginInvitationRegistration() {
  if (registering) throw new Error('手机号登录正在进行，请稍候')
  registering = true
}
export function hasIncomingInvitation() { return Boolean(incoming) }
export async function prepareInvitationRegistration(options = {}) {
  initialize()
  try { await saveIncomingInvitation(options) } catch (error) {
    const failure = new Error('好友邀请尚未保存，请先重试保存后重新授权手机号')
    failure.code = 'INVITATION_CAPTURE_RETRY'
    throw failure
  }
  expireCandidate()
  return candidate ? candidate.candidateReceipt : ''
}
export function finishInvitationRegistration(success) {
  registering = false
  if (success) clearPendingInvitation()
}
