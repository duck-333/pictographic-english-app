import assert from 'node:assert/strict'

import {
  assertVirtualPaymentState,
  DELIVERY_STATUSES,
  ENTITLEMENT_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITION_SOURCES,
  transitionDeliveryStatus,
  transitionEntitlementStatus,
  transitionPaymentStatus
} from '../server/virtual-payment-state.mjs'

const paymentTransitions = [
  ['initializing', 'pending', {}],
  ['initializing', 'failed', { failureKind: 'unrecoverable' }],
  ['pending', 'confirming', { source: PAYMENT_TRANSITION_SOURCES.CLIENT }],
  ['pending', 'paid', { source: PAYMENT_TRANSITION_SOURCES.WECHAT_NOTIFICATION }],
  ['pending', 'closed', { source: PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY }],
  ['pending', 'failed', { failureKind: 'unrecoverable' }],
  ['confirming', 'paid', { source: PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY }],
  ['confirming', 'closed', { source: PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY }],
  ['confirming', 'failed', { failureKind: 'unrecoverable' }]
]

paymentTransitions.forEach(([from, to, options]) => {
  assert.deepEqual(transitionPaymentStatus(from, to, options), { status: to, idempotent: false })
})

const entitlementTransitions = [
  ['not_ready', 'pending', {}],
  ['pending', 'granting', {}],
  ['pending', 'retryable_failed', {}],
  ['pending', 'failed', { failureKind: 'unrecoverable' }],
  ['granting', 'granted', {}],
  ['granting', 'retryable_failed', {}],
  ['granting', 'failed', { failureKind: 'unrecoverable' }],
  ['retryable_failed', 'granting', {}],
  ['retryable_failed', 'failed', { failureKind: 'unrecoverable' }]
]

entitlementTransitions.forEach(([from, to, options]) => {
  assert.deepEqual(transitionEntitlementStatus(from, to, {
    paymentStatus: 'paid',
    ...options
  }), { status: to, idempotent: false })
})

const deliveryTransitions = [
  ['not_ready', 'pending'],
  ['pending', 'confirming'],
  ['pending', 'retryable_failed'],
  ['pending', 'manual_review'],
  ['confirming', 'delivered'],
  ['confirming', 'retryable_failed'],
  ['confirming', 'manual_review'],
  ['retryable_failed', 'confirming'],
  ['retryable_failed', 'manual_review']
]

deliveryTransitions.forEach(([from, to]) => {
  assert.deepEqual(transitionDeliveryStatus(from, to, {
    entitlementStatus: 'granted'
  }), { status: to, idempotent: false })
})

assert.deepEqual(
  transitionPaymentStatus('paid', 'paid', { source: PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY }),
  { status: 'paid', idempotent: true }
)
assert.deepEqual(
  transitionEntitlementStatus('granted', 'granted', { paymentStatus: 'paid' }),
  { status: 'granted', idempotent: true }
)
assert.deepEqual(
  transitionDeliveryStatus('delivered', 'delivered', { entitlementStatus: 'granted' }),
  { status: 'delivered', idempotent: true }
)

for (const from of ['initializing', 'pending', 'confirming']) {
  assert.throws(
    () => transitionPaymentStatus(from, 'paid', { source: PAYMENT_TRANSITION_SOURCES.CLIENT }),
    (error) => error && error.code === 'VIRTUAL_PAYMENT_PAID_SOURCE_INVALID'
  )
}

for (const from of ['pending', 'confirming']) {
  for (const options of [
    {},
    { source: PAYMENT_TRANSITION_SOURCES.CLIENT },
    { source: 'unknown_source' }
  ]) {
    assert.throws(
      () => transitionPaymentStatus(from, 'closed', options),
      (error) => error && error.code === 'VIRTUAL_PAYMENT_CLOSED_SOURCE_INVALID'
    )
  }
  assert.deepEqual(
    transitionPaymentStatus(from, 'closed', { source: PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY }),
    { status: 'closed', idempotent: false }
  )
}
assert.throws(
  () => transitionPaymentStatus('pending', 'closed', {
    source: PAYMENT_TRANSITION_SOURCES.WECHAT_QUERY,
    failureKind: 'network'
  }),
  (error) => error && error.code === 'VIRTUAL_PAYMENT_CLOSED_SOURCE_INVALID'
)
assert.throws(
  () => transitionPaymentStatus('pending', 'closed', {
    source: PAYMENT_TRANSITION_SOURCES.CLIENT,
    clientResult: 'cancel'
  }),
  (error) => error && error.code === 'VIRTUAL_PAYMENT_CLOSED_SOURCE_INVALID'
)
assert.throws(
  () => transitionPaymentStatus('pending', 'failed', { failureKind: 'network' }),
  (error) => error && error.code === 'VIRTUAL_PAYMENT_RECOVERABLE_FAILURE_REQUIRED'
)
assert.deepEqual(
  transitionPaymentStatus('pending', 'confirming', { source: PAYMENT_TRANSITION_SOURCES.SYSTEM }),
  { status: 'confirming', idempotent: false }
)

assert.throws(
  () => transitionEntitlementStatus('not_ready', 'pending', { paymentStatus: 'confirming' }),
  (error) => error && error.code === 'VIRTUAL_PAYMENT_ENTITLEMENT_BEFORE_PAID'
)
assert.throws(
  () => transitionEntitlementStatus('granting', 'failed', {
    paymentStatus: 'paid',
    failureKind: 'network'
  }),
  (error) => error && error.code === 'VIRTUAL_PAYMENT_RECOVERABLE_FAILURE_REQUIRED'
)
assert.throws(
  () => transitionDeliveryStatus('confirming', 'delivered', { entitlementStatus: 'granting' }),
  (error) => error && error.code === 'VIRTUAL_PAYMENT_DELIVERY_BEFORE_GRANT'
)

for (const invalid of [
  ['paid', 'pending'],
  ['closed', 'pending'],
  ['failed', 'pending']
]) {
  assert.throws(() => transitionPaymentStatus(invalid[0], invalid[1]))
}
assert.throws(() => transitionEntitlementStatus('granted', 'granting', { paymentStatus: 'paid' }))
assert.throws(() => transitionDeliveryStatus('delivered', 'confirming', { entitlementStatus: 'granted' }))

assert.equal(assertVirtualPaymentState({
  paymentStatus: 'pending',
  entitlementStatus: 'not_ready',
  deliveryStatus: 'not_ready'
}), true)
assert.equal(assertVirtualPaymentState({
  paymentStatus: 'paid',
  entitlementStatus: 'granted',
  deliveryStatus: 'delivered'
}), true)
assert.throws(() => assertVirtualPaymentState({
  paymentStatus: 'pending',
  entitlementStatus: 'granting',
  deliveryStatus: 'not_ready'
}))
assert.throws(() => assertVirtualPaymentState({
  paymentStatus: 'paid',
  entitlementStatus: 'granting',
  deliveryStatus: 'delivered'
}))

assert.deepEqual(PAYMENT_STATUSES, ['initializing', 'pending', 'confirming', 'paid', 'closed', 'failed'])
assert.deepEqual(ENTITLEMENT_STATUSES, ['not_ready', 'pending', 'granting', 'granted', 'retryable_failed', 'failed'])
assert.deepEqual(DELIVERY_STATUSES, ['not_ready', 'pending', 'confirming', 'delivered', 'retryable_failed', 'manual_review'])

console.log('virtual payment state tests passed')
