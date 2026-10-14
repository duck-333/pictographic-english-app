export const AUTH_SESSION_KEY = 'pictographic:authSession'
let sessionVersion = 0
const sessionListeners = new Set()
let expiryTimer = null
let scheduledExpiry = ''

function scheduleExpiry(session) {
  if (scheduledExpiry === session.expiresAt && expiryTimer) return
  clearTimeout(expiryTimer)
  scheduledExpiry = session.expiresAt
  expiryTimer = setTimeout(() => {
    expiryTimer = null
    getAuthSession() // Re-read storage; a renewed session must not be logged out.
  }, Math.min(2147483647, Math.max(1, Date.parse(session.expiresAt) - Date.now())))
  if (expiryTimer && typeof expiryTimer.unref === 'function') expiryTimer.unref()
}

function notifySessionChange() {
  sessionVersion += 1
  sessionListeners.forEach((listener) => {
    try { listener() } catch (error) { console.warn('AUTH_SESSION_LISTENER_FAILED') }
  })
}

export function subscribeAuthSession(listener) {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

export function captureAuthSession() {
  const session = getAuthSession()
  return { userId: session ? session.user.id : '', version: sessionVersion }
}

export function isAuthSessionCurrent(snapshot) {
  const current = captureAuthSession()
  return Boolean(snapshot && snapshot.version === current.version && snapshot.userId === current.userId)
}

export function invalidateAuthSession(snapshot, token) {
  const current = getAuthSession()
  if (current && current.token === token && isAuthSessionCurrent(snapshot)) clearAuthSession()
}

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
      hasWechatBinding: Boolean(user.hasWechatBinding),
      hasPhoneBinding: Boolean(user.hasPhoneBinding),
      phoneMasked: String(user.phoneMasked || '').trim()
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
  if (isAuthSessionValid(session)) scheduleExpiry(session)
  return session
}

export function saveAuthSession(value) {
  const session = normalizeSession(value)
  if (!session.token || !session.user.id) return null
  const previous = getAuthSession()
  uni.setStorageSync(AUTH_SESSION_KEY, session)
  if (isAuthSessionValid(session)) scheduleExpiry(session)
  // A valid renewal for the same account preserves in-flight access and request IDs.
  if (!previous || previous.user.id !== session.user.id) notifySessionChange()
  return session
}

export function clearAuthSession() {
  clearTimeout(expiryTimer)
  expiryTimer = null
  scheduledExpiry = ''
  try {
    uni.removeStorageSync(AUTH_SESSION_KEY)
  } catch (error) {}
  notifySessionChange()
}
