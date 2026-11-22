import { saveAuthSession, captureAuthSession, isAuthSessionCurrent } from './auth-store.js'
import { requestAuthJson as requestJson, requestWechatLoginCode, createAuthError } from './auth-request.js'
import { beginInvitationRegistration, prepareInvitationRegistration, hasIncomingInvitation, finishInvitationRegistration } from './invitation-state.js'
export { AUTH_API_TIMEOUT_MS, requestWechatLoginCode } from './auth-request.js'

function normalizePhoneCode(value) {
  return String(value || '').trim()
}

function createRequestId(options = {}) {
  const configured = String(options.requestId || '').trim()
  if (configured) return configured
  return `phone-login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function loginWithWechat(options = {}) {
  const code = await requestWechatLoginCode(options)
  const session = await requestJson('/api/auth/wechat-login', {
    ...options,
    method: 'POST',
    data: {
      code
    }
  })
  const savedSession = saveAuthSession(session)
  if (!savedSession) {
    throw createAuthError('Auth API response is invalid.', {
      code: 'AUTH_SESSION_INVALID'
    })
  }
  return savedSession
}

export async function loginWithWechatPhone(phoneCode, options = {}) {
  const normalizedPhoneCode = normalizePhoneCode(phoneCode)
  if (!normalizedPhoneCode) {
    throw createAuthError('Phone code is required.', {
      code: 'WECHAT_PHONE_CODE_REQUIRED',
      statusCode: 400
    })
  }

  const owner = captureAuthSession()
  beginInvitationRegistration()
  try {
    let candidateReceipt = '', loginCode = ''
    do {
      candidateReceipt = await prepareInvitationRegistration(options)
      loginCode = await requestWechatLoginCode(options)
      if (!isAuthSessionCurrent(owner)) throw createAuthError('账号已切换', { code: 'AUTH_SESSION_CHANGED' })
    } while (hasIncomingInvitation())
    const session = await requestJson('/api/auth/wechat-phone-login', {
      ...options, method: 'POST', data: {
        loginCode, phoneCode: normalizedPhoneCode, requestId: createRequestId(options),
        ...(candidateReceipt ? { candidateReceipt } : {})
      }
    })
    if (!isAuthSessionCurrent(owner)) throw createAuthError('账号已切换', { code: 'AUTH_SESSION_CHANGED' })
    const savedSession = saveAuthSession(session)
    if (!savedSession) throw createAuthError('Auth API response is invalid.', { code: 'AUTH_SESSION_INVALID' })
    finishInvitationRegistration(true)
    return session.invitation ? { ...savedSession, invitation: session.invitation } : savedSession
  } finally {
    finishInvitationRegistration(false)
  }
}
