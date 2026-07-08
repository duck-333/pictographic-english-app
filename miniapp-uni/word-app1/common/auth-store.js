export const AUTH_SESSION_KEY = 'pictographic:authSession'

function readStorage(key) {
  try {
    const value = uni.getStorageSync(key)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch (error) {
    return null
  }
}

function normalizeSession(value) {
  const source = value && typeof value === 'object' ? value : {}
  const user = source.user && typeof source.user === 'object' ? source.user : {}
  return {
    token: String(source.token || '').trim(),
    tokenType: String(source.tokenType || 'Bearer').trim() || 'Bearer',
    expiresAt: String(source.expiresAt || '').trim(),
    user: {
      id: String(user.id || '').trim(),
      hasWechatBinding: Boolean(user.hasWechatBinding)
    }
  }
}

export function isAuthSessionValid(session) {
  const value = session || getAuthSession({ allowExpired: true })
  if (!value || !value.token || !value.user.id) return false
  const expiresAtMs = Date.parse(value.expiresAt)
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()
}

export function getAuthSession(options = {}) {
  const session = normalizeSession(readStorage(AUTH_SESSION_KEY))
  if (!session.token || !session.user.id) return null
  if (!options.allowExpired && !isAuthSessionValid(session)) {
    clearAuthSession()
    return null
  }
  return session
}

export function saveAuthSession(value) {
  const session = normalizeSession(value)
  if (!session.token || !session.user.id) return null
  uni.setStorageSync(AUTH_SESSION_KEY, session)
  return session
}

export function clearAuthSession() {
  try {
    uni.removeStorageSync(AUTH_SESSION_KEY)
  } catch (error) {}
}
