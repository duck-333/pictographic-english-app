import { createVirtualPaymentApi, paymentError, validatePaymentParams } from './virtual-payment-api-client.js'

export const EXTRA_PURCHASE_WARNING = '上次购买结果尚未确认。继续将新购买一份30天会员；若两笔均支付成功，将分别到账并顺延。是否继续？'
export const PURCHASE_CONFIRMATION = '购买30天会员，¥30.00，一次性购买，非自动续费。有效会员购买后顺延30天。是否继续？'
let running = null
let sequence = 0
const STALE = Symbol('inactive purchase operation')
const hints = ['ready', 'unknown', 'cancelled', 'confirming', 'paid', 'granted', 'delivered', 'closed', 'failed', 'manual_review']
export function recordMessage(record) {
  return ({ ready: '购买尚未完成，可继续', unknown: '支付结果尚未确认，请查询购买结果', cancelled: '已取消本次支付，可查询购买结果',
    confirming: '支付结果确认中，可稍后回来查看', paid: '支付已确认，正在开通会员', granted: '会员已到账，订单确认中',
    delivered: '会员已到账', closed: '本次购买已关闭', failed: '本次购买未完成', manual_review: '会员已到账，订单处理中，请稍后查询或联系客服' })[record.hint] || '请查询购买结果'
}
export function createPurchaseController(options = {}) {
  const api = options.api || createVirtualPaymentApi()
  const storage = options.storage || { get: (key) => uni.getStorageSync(key), set: (key, value) => uni.setStorageSync(key, value) }
  const now = options.now || Date.now
  let visible = true
  let epoch = 0, disposed = false, currentRun = null
  const key = (owner) => `pictographic:purchase:sandbox:${encodeURIComponent(owner.baseUrl)}:${owner.userId}`
  function records(owner) {
    api.assertContext(owner)
    let raw
    try { raw = storage.get(key(owner)) } catch (_) { throw paymentError('PAYMENT_STORAGE_FAILED') }
    if (raw === '' || raw === null || raw === undefined) return []
    if (!Array.isArray(raw)) throw paymentError('PAYMENT_RECORDS_INVALID')
    const intents = new Map(), orders = new Map()
    for (const r of raw) {
      if (!r || r.userId !== owner.userId || r.environment !== 'sandbox' ||
          (r.baseUrl !== undefined && r.baseUrl !== owner.baseUrl) ||
          typeof r.clientRequestId !== 'string' || typeof r.orderNo !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/.test(r.clientRequestId) ||
          (r.orderNo !== '' && !/^VP[A-F0-9]{30}$/.test(r.orderNo)) ||
          typeof r.mayHaveInvoked !== 'boolean' || !hints.includes(r.hint) ||
          !Number.isFinite(r.createdAt) || !Number.isFinite(r.updatedAt) || r.createdAt < 0 || r.updatedAt < r.createdAt ||
          (r.mayHaveInvoked && !r.orderNo)) throw paymentError('PAYMENT_RECORDS_INVALID')
      const previous = intents.get(r.clientRequestId)
      if ((previous && previous.orderNo && r.orderNo && previous.orderNo !== r.orderNo) ||
          (r.orderNo && orders.has(r.orderNo) && orders.get(r.orderNo) !== r.clientRequestId)) throw paymentError('PAYMENT_RECORDS_INVALID')
      if (r.orderNo) orders.set(r.orderNo, r.clientRequestId)
      const merged = { userId: r.userId, environment: 'sandbox', clientRequestId: r.clientRequestId,
        orderNo: r.orderNo || (previous && previous.orderNo) || '',
        mayHaveInvoked: r.mayHaveInvoked || Boolean(previous && previous.mayHaveInvoked),
        createdAt: previous ? Math.min(previous.createdAt, r.createdAt) : r.createdAt,
        updatedAt: previous ? Math.max(previous.updatedAt, r.updatedAt) : r.updatedAt,
        hint: previous && previous.hint !== r.hint ? 'unknown' : r.hint }
      intents.set(r.clientRequestId, merged)
    }
    const normalized = [...intents.values()]
    // Validate the WHOLE collection before an optional canonical write or selection.
    if (normalized.length !== raw.length) write(owner, normalized)
    return normalized
  }
  function write(owner, list) {
    try {
      storage.set(key(owner), list)
      if (JSON.stringify(storage.get(key(owner))) !== JSON.stringify(list)) throw new Error('Storage verification failed')
    } catch (_) { throw paymentError('PAYMENT_STORAGE_FAILED') }
  }
  function save(owner, record) {
    const list = records(owner)
    const index = list.findIndex((r) => r.clientRequestId === record.clientRequestId)
    const safe = { userId: owner.userId, environment: 'sandbox', clientRequestId: record.clientRequestId, orderNo: record.orderNo,
      mayHaveInvoked: record.mayHaveInvoked, createdAt: record.createdAt, updatedAt: now(), hint: record.hint }
    if (list.some((r) => safe.orderNo && r.orderNo === safe.orderNo && r.clientRequestId !== safe.clientRequestId) ||
        (index >= 0 && list[index].orderNo && list[index].orderNo !== safe.orderNo)) throw paymentError('PAYMENT_RECORDS_INVALID')
    if (index >= 0) safe.mayHaveInvoked = safe.mayHaveInvoked || list[index].mayHaveInvoked
    if (index < 0) list.push(safe); else list[index] = safe
    write(owner, list)
    return safe
  }
  function active(owner, run) {
    if (disposed || !visible || run.epoch !== epoch) throw STALE
    api.assertContext(owner)
    return true
  }
  function publish(owner, record, hint) {
    const result = save(owner, { ...record, hint })
    if (options.onChange) options.onChange()
    return result
  }
  function validatePaymentEntitlement(value, record) {
    if (!value || value.orderNo !== record.orderNo || !['initializing', 'pending', 'confirming', 'paid', 'closed', 'failed'].includes(value.paymentStatus) ||
        !['not_ready', 'pending', 'granting', 'granted', 'retryable_failed', 'failed'].includes(value.entitlementStatus)) throw paymentError('PAYMENT_RESPONSE_INVALID')
    if (value.entitlementStatus !== 'not_ready' && value.paymentStatus !== 'paid') throw paymentError('PAYMENT_RESPONSE_INVALID')
    return value
  }
  function validateSummary(value, record) {
    validatePaymentEntitlement(value, record)
    if (!['not_ready', 'pending', 'confirming', 'retryable_failed', 'delivered', 'manual_review'].includes(value.deliveryStatus) ||
        (value.deliveryStatus !== 'not_ready' && value.entitlementStatus !== 'granted')) throw paymentError('PAYMENT_RESPONSE_INVALID')
    return value
  }
  function validateCreate(value, record) {
    validateSummary(value, record)
    validatePaymentParams(value.paymentParams, record.orderNo)
    return value
  }
  function validateReconcile(value, record) { return validateSummary(value, record) }
  function isoTime(value) {
    const time = typeof value === 'string' ? Date.parse(value) : NaN
    if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw paymentError('PAYMENT_RESPONSE_INVALID')
    return time
  }
  function validateEntitlement(value, record) {
    validatePaymentEntitlement(value, record)
    if (value.paymentStatus !== 'paid' || value.entitlementStatus !== 'granted') throw paymentError('PAYMENT_RESPONSE_INVALID')
    if (typeof value.idempotent !== 'boolean' || isoTime(value.membershipStartedAt) >= isoTime(value.membershipExpiresAt)) throw paymentError('PAYMENT_RESPONSE_INVALID')
    return value
  }
  function validateDelivery(value, record) {
    validateSummary(value, record)
    if (value.paymentStatus !== 'paid' || value.entitlementStatus !== 'granted') throw paymentError('PAYMENT_RESPONSE_INVALID')
    // Mirrors deliveryResponse in the service; these flags are not independent.
    const flags = { confirming: 'confirming', manualReview: 'manual_review', retryable: 'retryable_failed' }
    if (typeof value.idempotent !== 'boolean' || Object.entries(flags).some(([flag, status]) =>
      typeof value[flag] !== 'boolean' || value[flag] !== (value.deliveryStatus === status))) throw paymentError('PAYMENT_RESPONSE_INVALID')
    return value
  }
  async function recover(owner, record, run) {
    if (!record.orderNo || !active(owner, run)) return record
    let order = await api.get(owner, record.orderNo, run)
    active(owner, run)
    order = validateSummary(order, record)
    if (order.entitlementStatus !== 'granted' && ['pending', 'confirming'].includes(order.paymentStatus)) {
      order = await api.reconcile(owner, record.orderNo, run)
      active(owner, run)
      order = validateReconcile(order, record)
    }
    if (['closed', 'failed'].includes(order.paymentStatus)) return publish(owner, record, order.paymentStatus)
    if (order.paymentStatus !== 'paid') return publish(owner, record, 'confirming')
    if (order.entitlementStatus !== 'granted') {
      record = publish(owner, record, 'paid')
      if (order.entitlementStatus !== 'not_ready' || order.deliveryStatus !== 'not_ready') return record
      order = await api.entitlement(owner, record.orderNo, run)
      active(owner, run)
      order = validateEntitlement(order, record)
    }
    if (order.entitlementStatus !== 'granted') return record
    record = publish(owner, record, 'granted')
    // A failed display refresh must never undo a reliable grant or regrant it.
    try {
      const entitlement = await api.refresh(owner)
      if (active(owner, run) && options.onEntitlement) options.onEntitlement(entitlement)
    } catch (_) { if (active(owner, run) && options.onRefreshFailed) options.onRefreshFailed() }
    active(owner, run)
    if (order.deliveryStatus === 'delivered') return publish(owner, record, 'delivered')
    if (order.deliveryStatus === 'manual_review') return publish(owner, record, 'manual_review')
    const response = await api.delivery(owner, record.orderNo, run)
    active(owner, run)
    const delivered = validateDelivery(response, record)
    return publish(owner, record, delivered.deliveryStatus === 'delivered' ? 'delivered' : delivered.deliveryStatus === 'manual_review' ? 'manual_review' : 'granted')
  }
  function single(work) {
    if (disposed || !visible) return Promise.resolve()
    if (running) return running.promise
    const listeners = new Set()
    const run = { epoch, check() { if (disposed || !visible || epoch !== run.epoch) throw STALE },
      onCancel(fn) { listeners.add(fn); return () => listeners.delete(fn) },
      cancel() { for (const fn of listeners) fn(); listeners.clear() } }
    currentRun = run
    run.promise = Promise.resolve().then(() => {
      if (disposed || !visible || run.epoch !== epoch) throw STALE
      return work(run)
    }).catch((error) => {
      if (disposed || !visible || run.epoch !== epoch || error === STALE) return
      throw error
    }).finally(() => { if (running === run) running = null; if (currentRun === run) currentRun = null })
    running = run
    return run.promise
  }
  function pause() {
    visible = false
    epoch++
    if (currentRun) { currentRun.cancel(); if (running === currentRun) running = null; currentRun = null }
  }
  async function pay(owner, record, loginCode, run) {
    active(owner, run)
    api.assertContext(owner, true)
    if (record.mayHaveInvoked) return recover(owner, record, run)
    const created = await api.create(owner, record.clientRequestId, loginCode, run)
    active(owner, run)
    if (!created || !/^VP[A-F0-9]{30}$/.test(created.orderNo) || (record.orderNo && created.orderNo !== record.orderNo)) throw paymentError('PAYMENT_RESPONSE_INVALID')
    record = save(owner, { ...record, orderNo: created.orderNo })
    validateCreate(created, record)
    if (record.mayHaveInvoked) return recover(owner, record, run)
    if (!['initializing', 'pending'].includes(created.paymentStatus) || created.entitlementStatus !== 'not_ready' || created.deliveryStatus !== 'not_ready') return recover(owner, record, run)
    // Durable write BEFORE entering the native API. A crash after this line is
    // unknown, even when native payment was not actually reached.
    record = publish(owner, { ...record, mayHaveInvoked: true }, 'unknown')
    active(owner, run)
    const hint = await api.invoke(owner, created.paymentParams, record.orderNo, run)
    active(owner, run)
    record = publish(owner, record, hint === 'cancelled' ? 'cancelled' : 'unknown')
    return recover(owner, record, run)
  }
  return {
    api,
    list() { return records(api.context()).slice().reverse() },
    pause, resume() { if (!disposed) visible = true }, dispose() { pause(); disposed = true },
    query(clientRequestId) {
      return single(async (run) => {
        const owner = api.context()
        const record = records(owner).find((r) => r.clientRequestId === clientRequestId)
        if (!record) throw paymentError('PAYMENT_STORAGE_FAILED')
        if (!record.orderNo) throw paymentError('PAYMENT_ORDER_NOT_CREATED')
        return recover(owner, record, run)
      })
    },
    buy(resumeId) {
      return single(async (run) => {
        const owner = api.context(true)
        const list = records(owner)
        let record = resumeId ? list.find((r) => r.clientRequestId === resumeId) : null
        if (resumeId && !record) throw paymentError('PAYMENT_STORAGE_FAILED')
        if (record && record.mayHaveInvoked) return recover(owner, record, run)
        const unresolved = list.some((r) => !['granted', 'delivered', 'manual_review', 'closed', 'failed'].includes(r.hint) && r.clientRequestId !== resumeId)
        if (!await options.confirm(unresolved ? EXTRA_PURCHASE_WARNING : PURCHASE_CONFIRMATION)) return null
        active(owner, run)
        api.assertContext(owner, true)
        const loginCode = await api.prepare(owner)
        active(owner, run)
        if (!record) {
          const clientRequestId = `purchase-${now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`
          record = save(owner, { clientRequestId, orderNo: '', mayHaveInvoked: false, createdAt: now(), hint: 'ready' })
        }
        return pay(owner, record, loginCode, run)
      })
    }
  }
}
