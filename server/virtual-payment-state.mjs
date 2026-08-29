export const PAYMENT_STATUSES = Object.freeze([
  'initializing',
  'pending',
  'confirming',
  'paid',
  'closed',
  'failed'
])

export const ENTITLEMENT_STATUSES = Object.freeze([
  'not_ready',
  'pending',
  'granting',
  'granted',
  'retryable_failed',
  'failed'
])

export const DELIVERY_STATUSES = Object.freeze([
  'not_ready',
  'pending',
  'confirming',
  'delivered',
  'retryable_failed',
  'manual_review'
])

export const PAYMENT_TRANSITION_SOURCES = Object.freeze({
  CLIENT: 'client',
  SYSTEM: 'system',
  WECHAT_NOTIFICATION: 'wechat_notification',
  WECHAT_QUERY: 'wechat_query'
})

const PAYMENT_TRANSITIONS = new Map([
  ['initializing', new Set(['pending', 'failed'])],
  ['pending', new Set(['confirming', 'paid', 'closed', 'failed'])],
  ['confirming', new Set(['paid', 'closed', 'failed'])],
  ['paid', new Set()],
  ['closed', new Set()],
  ['failed', new Set()]
])

const ENTITLEMENT_TRANSITIONS = new Map([
  ['not_ready', new Set(['pending'])],
  ['pending', new Set(['granting', 'retryable_failed', 'failed'])],
  ['granting', new Set(['granted', 'retryable_failed', 'failed'])],
  ['granted', new Set()],
  ['retryable_failed', new Set(['granting', 'failed'])],
  ['failed', new Set()]
])

const DELIVERY_TRANSITIONS = new Map([
  ['not_ready', new Set(['pending'])],
  ['pending', new Set(['confirming', 'retryable_failed', 'manual_review'])],
  ['confirming', new Set(['delivered', 'retryable_failed', 'manual_review'])],
  ['delivered', new Set()],
  ['retryable_failed', new Set(['confirming', 'manual_review'])],
  ['manual_review', new Set()]
])

function transitionError(message, code = 'VIRTUAL_PAYMENT_STATE_TRANSITION_INVALID') {
  const error = new Error(message)
  error.code = code
  return error
}

function assertKnownStatus(status, statuses, dimension) {
  if (!statuses.includes(status)) {
    throw transitionError(`Unknown ${dimension} status.`, 'VIRTUAL_PAYMENT_STATUS_INVALID')
  }
}

function transition(current, next, transitions, statuses, dimension) {
  assertKnownStatus(current, statuses, dimension)
  assertKnownStatus(next, statuses, dimension)
  if (current === next) {
    return Object.freeze({ status: next, idempotent: true })
  }
  if (!transitions.get(current).has(next)) {
    throw transitionError(`Illegal ${dimension} status transition.`)
  }
  return Object.freeze({ status: next, idempotent: false })
}

function assertUnrecoverableFailure(next, failureKind) {
  if (next === 'failed' && failureKind !== 'unrecoverable') {
    throw transitionError(
      'Only an explicitly unrecoverable failure can enter failed status.',
      'VIRTUAL_PAYMENT_RECOVERABLE_FAILURE_REQUIRED'
    )
  }
}

export function transitionPaymentStatus(current, next, options = {}) {
  const source = String(options.source || PAYMENT_TRANSITION_SOURCES.SYSTEM)
  if (next === 'paid' && ![
    PAYMENT_TRANSITION_SOURCES.WECHAT_NOTIFICATION,
    PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY
  ].includes(source)) {
    throw transitionError(
      'Only a verified WeChat notification or query can confirm payment.',
      'VIRTUAL_PAYMENT_PAID_SOURCE_INVALID'
    )
  }
  if (
    next === 'closed' &&
    (source !== PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY || options.failureKind)
  ) {
    throw transitionError(
      'Only a verified WeChat query result can close a payment.',
      'VIRTUAL_PAYMENT_CLOSED_SOURCE_INVALID'
    )
  }
  if (source === PAYMENT_TRANSITION_SOURCES.CLIENT && ['paid', 'closed', 'failed'].includes(next)) {
    throw transitionError(
      'A client observation cannot set a terminal payment status.',
      'VIRTUAL_PAYMENT_CLIENT_STATUS_FORBIDDEN'
    )
  }
  assertUnrecoverableFailure(next, options.failureKind)
  return transition(current, next, PAYMENT_TRANSITIONS, PAYMENT_STATUSES, 'payment')
}

export function transitionEntitlementStatus(current, next, options = {}) {
  if (next !== 'not_ready' && options.paymentStatus !== 'paid') {
    throw transitionError(
      'Entitlement processing requires verified paid status.',
      'VIRTUAL_PAYMENT_ENTITLEMENT_BEFORE_PAID'
    )
  }
  assertUnrecoverableFailure(next, options.failureKind)
  return transition(current, next, ENTITLEMENT_TRANSITIONS, ENTITLEMENT_STATUSES, 'entitlement')
}

export function transitionDeliveryStatus(current, next, options = {}) {
  if (next !== 'not_ready' && options.entitlementStatus !== 'granted') {
    throw transitionError(
      'Delivery processing requires granted entitlement status.',
      'VIRTUAL_PAYMENT_DELIVERY_BEFORE_GRANT'
    )
  }
  return transition(current, next, DELIVERY_TRANSITIONS, DELIVERY_STATUSES, 'delivery')
}

export function assertVirtualPaymentState(state = {}) {
  assertKnownStatus(state.paymentStatus, PAYMENT_STATUSES, 'payment')
  assertKnownStatus(state.entitlementStatus, ENTITLEMENT_STATUSES, 'entitlement')
  assertKnownStatus(state.deliveryStatus, DELIVERY_STATUSES, 'delivery')

  if (state.entitlementStatus !== 'not_ready' && state.paymentStatus !== 'paid') {
    throw transitionError(
      'A non-idle entitlement state requires paid status.',
      'VIRTUAL_PAYMENT_ENTITLEMENT_BEFORE_PAID'
    )
  }
  if (state.deliveryStatus !== 'not_ready' && state.entitlementStatus !== 'granted') {
    throw transitionError(
      'A non-idle delivery state requires granted entitlement status.',
      'VIRTUAL_PAYMENT_DELIVERY_BEFORE_GRANT'
    )
  }
  return true
}

// A later batch must make the server the only serializer of the exact signData string.
// The client must receive that signed representation and must never reserialize it.
