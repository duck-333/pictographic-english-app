import { captureAuthSession, getAuthSession, isAuthSessionCurrent, subscribeAuthSession } from './auth-store.js'
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
// Presentation only: restored invitations remain usable without reopening a dialog.
let noticeHidden = true
let noticeKind = 'feedback'

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
    noticeKind = 'feedback'
    persist()
  }
}
export function clearPendingInvitation() {
  epoch++
  task = null
  candidate = null
  incoming = null
  message = ''
  noticeHidden = true
  try { persist() } catch (error) {}
  notify()
}
subscribeAuthSession(clearPendingInvitation)

export function invitationState() {
  initialize()
  expireCandidate()
  const registered = Boolean(getAuthSession()?.user?.hasPhoneBinding)
  return { candidate: Boolean(candidate), pending: Boolean(incoming), saving: Boolean(task), message,
    expiresAt: candidate ? candidate.expiresAt : '',
    guideVisible: !noticeHidden && noticeKind === 'guide' && !registered && Boolean(candidate) && !incoming && !task,
    feedbackVisible: !noticeHidden && !task && Boolean(message) && noticeKind === 'feedback' }
}
export function subscribeInvitation(listener) { listeners.add(listener); return () => listeners.delete(listener) }
export function dismissInvitationNotice() { noticeHidden = true; notify() }

export function receiveInvitation(query = {}, options = {}) {
  initialize()
  const token = typeof query.invitationToken === 'string' ? query.invitationToken : ''
  if (!token) return Promise.resolve()
  if (token.length > 128) { message = '此邀请无效，可继续正常注册'; noticeHidden = false; noticeKind = 'feedback'; notify(); return Promise.resolve() }
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
        message = ''
        noticeHidden = false
        noticeKind = 'guide'
        if (incoming === target) incoming = null
      } catch (error) {
        if (epoch !== activeEpoch || !isAuthSessionCurrent(snapshot)) return
        message = invitationMessage(error) + (candidate && error.code === 'INVITATION_CREDENTIAL_INVALID' ? '；此前有效邀请已保留' : '')
        noticeHidden = false
        noticeKind = 'feedback'
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
