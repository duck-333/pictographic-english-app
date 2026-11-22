import { requestAuthJson, requestWechatLoginCode, createAuthError } from './auth-request.js'
import { getAuthSession, captureAuthSession, isAuthSessionCurrent, invalidateAuthSession } from './auth-store.js'

export const INVITATION_LABEL = '邀请好友，得30次'
export const INVITATION_RULE = '好友通过你的分享首次完成注册后，你可获得30次查词权益；好友也享注册赠送30次。最多奖励5位新用户。'
export const ORDINARY_SHARE = { title: '象形英语｜以形释义解码单词', path: '/pages/index/index' }

async function authenticatedRequest(path, options) {
  const session = getAuthSession()
  if (!session || !session.user.hasPhoneBinding) throw createAuthError('请先完成手机号快捷注册', { code: 'INVITATION_PHONE_REGISTRATION_REQUIRED' })
  const snapshot = captureAuthSession()
  try {
    const result = await requestAuthJson(path, { ...options, header: { Authorization: `Bearer ${session.token}` } })
    if (!isAuthSessionCurrent(snapshot)) throw createAuthError('账号已切换，请重试', { code: 'AUTH_SESSION_CHANGED' })
    return result
  } catch (error) {
    if (error.statusCode === 401) invalidateAuthSession(snapshot, session.token)
    throw error
  }
}

export async function createInvitationShare(options = {}) {
  const result = await authenticatedRequest('/api/user/invitations/share-credentials', { ...options, method: 'POST', data: {} })
  if (!result.token || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) {
    throw createAuthError('邀请凭证不可用，请重试', { code: 'INVITATION_RESPONSE_INVALID' })
  }
  return { token: result.token, createdAt: result.createdAt, expiresAt: result.expiresAt }
}

export async function captureInvitationCandidate(token, options = {}) {
  const loginCode = await requestWechatLoginCode(options)
  if (options.isOperationCurrent && !options.isOperationCurrent()) return null
  const result = await requestAuthJson('/api/user/invitations/candidates', { ...options, method: 'POST', data: { token, loginCode } })
  if (!result.candidateReceipt || !Number.isFinite(Date.parse(result.expiresAt))) {
    throw createAuthError('邀请回执暂不可用，请重试', { code: 'INVITATION_RESPONSE_INVALID' })
  }
  return { candidateReceipt: result.candidateReceipt, expiresAt: result.expiresAt }
}

export async function getInvitationSummary(options = {}) {
  const data = await authenticatedRequest('/api/user/invitations/summary', options)
  for (const field of ['successfulInvitations', 'totalRewardQuota', 'pendingRewards', 'remainingRewardSlots']) {
    if (!Number.isSafeInteger(data[field]) || data[field] < 0) throw createAuthError('邀请统计加载失败', { code: 'INVITATION_RESPONSE_INVALID' })
  }
  if (typeof data.limitReached !== 'boolean') throw createAuthError('邀请统计加载失败', { code: 'INVITATION_RESPONSE_INVALID' })
  return data
}

export function invitationMessage(error) {
  const messages = {
    INVITER_REWARD_LIMIT_REACHED: '奖励名额已满',
    INVITATION_PHONE_REGISTRATION_REQUIRED: '请先完成手机号快捷注册',
    INVITATION_CREDENTIAL_INVALID: '此邀请无效或已过期，可继续正常注册',
    INVITATION_RELATION_LOCKED: '账号已完成注册，不能再接受邀请',
    INVITATION_RATE_LIMITED: '操作较频繁，请稍后重试',
    WECHAT_RATE_LIMITED: '操作较频繁，请稍后重试',
    AUTH_SESSION_CHANGED: '账号已切换，请重试',
    UNAUTHORIZED: '登录已失效，请重新登录'
  }
  return messages[error && error.code] || '邀请服务连接失败，请重试'
}

export function invitationRegistrationMessage(result) {
  if (!result) return ''
  if (result.status === 'REWARD_GRANTED') return '好友邀请已确认，邀请人的30次奖励已到账'
  if (result.status === 'REWARD_PENDING' || result.status === 'MANUAL_REVIEW') return '好友邀请已确认，邀请人的30次奖励待到账'
  const reasons = {
    INVITER_REWARD_LIMIT_REACHED: '邀请人奖励名额已满，不影响你的注册权益',
    NOT_FIRST_PHONE_REGISTRATION: '账号已完成过注册，本次不产生邀请奖励',
    INVITATION_EXPIRED: '邀请已过期，不影响正常注册登录',
    INVITATION_REVOKED: '邀请已失效，不影响正常注册登录',
    CANDIDATE_INVALID: '邀请回执无效，不影响正常注册登录',
    SELF_INVITE: '本人邀请不产生奖励',
    INVITATION_UNAVAILABLE: '邀请服务暂不可用，本次未确认邀请奖励'
  }
  return reasons[result.reason] || (result.reason === 'CANDIDATE_MISSING' ? '' : '本次未产生邀请奖励，可正常使用账号')
}

export function invitationShareMessage(event, card) {
  const requested = event && event.from === 'button' && event.target && event.target.dataset && event.target.dataset.invitationShare
  if (requested && card) return card.shareMessage()
  return { ...ORDINARY_SHARE }
}
