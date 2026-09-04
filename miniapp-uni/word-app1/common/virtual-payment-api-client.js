import { getWordApiBaseUrl, PRODUCTION_WORD_API_BASE_URL } from './api-config.js'
import { getAuthSession } from './auth-store.js'
import { requestWechatLoginCode } from './auth-api-client.js'
import { getUserEntitlements } from './user-entitlements-api-client.js'

const ROOT = '/api/user/virtual-payment/orders'
export function validateRecoveryPage(value, cursor = null) {
  const fail = () => { throw paymentError('PAYMENT_RESPONSE_INVALID') }
  const exact = (object, fields) => object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(object, field))
  const orderNo = (v) => typeof v === 'string' && /^VP[A-F0-9]{30}$/.test(v)
  const time = (v) => { const n = typeof v === 'string' ? Date.parse(v) : NaN; if (!Number.isFinite(n) || new Date(n).toISOString() !== v) fail(); return n }
  if (!exact(value, ['ok', 'orders', 'nextCursor']) || value.ok !== true || !Array.isArray(value.orders) || value.orders.length > 20 ||
      (value.nextCursor !== null && !orderNo(value.nextCursor))) fail()
  const ids = new Set(), requests = new Set()
  for (const row of value.orders) {
    if (!exact(row, ['orderNo', 'clientRequestId', 'paymentStatus', 'entitlementStatus', 'deliveryStatus', 'createdAt', 'updatedAt']) ||
        !orderNo(row.orderNo) || row.orderNo === cursor || typeof row.clientRequestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/.test(row.clientRequestId) ||
        !['initializing', 'pending', 'confirming', 'paid'].includes(row.paymentStatus) ||
        !['not_ready', 'pending', 'granting', 'granted', 'retryable_failed', 'failed'].includes(row.entitlementStatus) ||
        !['not_ready', 'pending', 'confirming', 'retryable_failed', 'manual_review'].includes(row.deliveryStatus) ||
        (row.entitlementStatus !== 'not_ready' && row.paymentStatus !== 'paid') || (row.deliveryStatus !== 'not_ready' && row.entitlementStatus !== 'granted') ||
        ids.has(row.orderNo) || requests.has(row.clientRequestId)) fail()
    if (time(row.createdAt) > time(row.updatedAt)) fail()
    ids.add(row.orderNo); requests.add(row.clientRequestId)
  }
  if (value.nextCursor !== null && (value.orders.length !== 20 || value.nextCursor !== value.orders[19].orderNo || value.nextCursor === cursor)) fail()
  return value
}
export function paymentError(code) { const error = new Error('购买操作暂未完成'); error.code = code; return error }
export function validatePaymentParams(params, orderNo) {
  if (!params || Array.isArray(params) || params.mode !== 'short_series_goods' ||
      typeof params.signData !== 'string' || !params.signData.length ||
      typeof params.paySig !== 'string' || !/^[a-f0-9]{64}$/.test(params.paySig) ||
      typeof params.signature !== 'string' || !/^[a-f0-9]{64}$/.test(params.signature)) throw paymentError('PAYMENT_RESPONSE_INVALID')
  let data
  try { data = JSON.parse(params.signData) } catch (_) { throw paymentError('PAYMENT_RESPONSE_INVALID') }
  if (!data || data.env !== 1 || data.buyQuantity !== 1 || data.currencyType !== 'CNY' || data.goodsPrice !== 3000 ||
      data.outTradeNo !== orderNo || typeof orderNo !== 'string' || !/^VP[A-F0-9]{30}$/.test(orderNo)) throw paymentError('PAYMENT_RESPONSE_INVALID')
  return params
}
export function paymentMessage(error) {
  const code = error && error.code
  if (['UNAUTHORIZED', 'USER_AUTH_REQUIRED'].includes(code)) return '请先登录后再操作'
  if (code === 'PAYMENT_RUNTIME_UNSUPPORTED') return '当前设备暂不支持本次购买'
  if (code === 'PAYMENT_SANDBOX_UNAVAILABLE') return '购买功能暂未开放'
  if (code === 'PAYMENT_STORAGE_FAILED') return '无法保存购买记录，请检查存储空间后重试'
  if (code === 'PAYMENT_RECORDS_INVALID') return '本地购买记录异常，请查询订单或联系客服'
  if (code === 'PAYMENT_ORDER_NOT_CREATED') return '尚未发起微信支付，请选择继续未完成的购买'
  if (code === 'PAYMENT_TEST_USER_NOT_ALLOWED' || code === 'PAYMENT_DISABLED') return '当前账号暂未开放购买'
  if (code === 'PAYMENT_CONTEXT_CHANGED') return '登录状态或环境已变化，请重新进入'
  if (code === 'PAYMENT_ORDER_NOT_FOUND') return '暂未找到购买记录，请稍后查询或联系客服'
  return '暂时无法确认购买结果，请稍后查询或联系客服'
}

export function createVirtualPaymentApi(options = {}) {
  const runtime = () => {
    if (options.wx) return options.wx
    let native = null
    // #ifdef MP-WEIXIN
    native = typeof wx !== 'undefined' ? wx : null
    // #endif
    return native
  }
  const session = options.getSession || getAuthSession
  function environment(purchase = false) {
    const env = options.env || (typeof process !== 'undefined' && process.env ? process.env : {})
    const configured = String(env.VUE_APP_WORD_API_BASE_URL || env.UNI_APP_WORD_API_BASE_URL || env.WORD_API_BASE_URL || '').trim().replace(/\/+$/, '')
    const baseUrl = getWordApiBaseUrl({ nodeEnv: env.NODE_ENV, apiBaseUrl: configured })
    // Use the same explicit development backend as login and entitlements. Never
    // let the global production fallback authorize a sandbox payment request.
    const authority = configured.match(/^https?:\/\/([^/?#]+)(?:\/[^?#]*)?$/i)
    const host = authority && authority[1].toLowerCase().split(':')[0]
    if (env.NODE_ENV !== 'development' || !authority || authority[1].includes('@') ||
        baseUrl !== configured || baseUrl === PRODUCTION_WORD_API_BASE_URL ||
        host === 'baxiaota.com' || host.endsWith('.baxiaota.com')) throw paymentError('PAYMENT_SANDBOX_UNAVAILABLE')
    const native = runtime()
    let version
    try { version = native.getAccountInfoSync().miniProgram.envVersion } catch (_) {}
    if (!native || !['develop', 'trial'].includes(version)) throw paymentError('PAYMENT_SANDBOX_UNAVAILABLE')
    let platform = ''
    if (purchase) {
      try { platform = (native.getDeviceInfo ? native.getDeviceInfo() : native.getSystemInfoSync()).platform } catch (_) {}
      if (!['android', 'harmony', 'windows'].includes(platform) || typeof native.requestVirtualPayment !== 'function') throw paymentError('PAYMENT_RUNTIME_UNSUPPORTED')
    }
    return { baseUrl, platform, environment: 'sandbox' }
  }
  function context(purchase = false) {
    const target = environment(purchase)
    const auth = session()
    if (!auth || !auth.token || !auth.user || !auth.user.id || Date.parse(auth.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(auth.expiresAt))) throw paymentError('USER_AUTH_REQUIRED')
    if (!auth.user.hasWechatBinding) throw paymentError('PAYMENT_CONTEXT_CHANGED')
    return { ...target, userId: String(auth.user.id), token: auth.token, session: auth }
  }
  function assertContext(owner, purchase = false) {
    const current = context(purchase)
    if (current.userId !== owner.userId || current.token !== owner.token || current.baseUrl !== owner.baseUrl) throw paymentError('PAYMENT_CONTEXT_CHANGED')
    return current
  }
  async function request(owner, method, path, data, run) {
    if (run) run.check()
    assertContext(owner)
    const requestImpl = options.request || ((args) => uni.request(args))
    return new Promise((resolve, reject) => {
      let settled = false, task, unsubscribe = () => {}
      const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); unsubscribe(); fn(value) }
      const timer = setTimeout(() => { finish(reject, paymentError('PAYMENT_NETWORK_UNKNOWN')); if (task && task.abort) task.abort() }, options.timeout || 7000)
      if (run) unsubscribe = run.onCancel(() => { finish(reject, paymentError('PAYMENT_CONTEXT_CHANGED')); if (task && task.abort) task.abort() })
      try {
        task = requestImpl({ url: owner.baseUrl + path, method, data, timeout: options.timeout || 7000,
          header: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
          success(response) {
            if (settled) return
            try { assertContext(owner) } catch (error) { finish(reject, error); return }
            const body = response.data
            if (response.statusCode >= 200 && response.statusCode < 300 && body && body.ok === true) finish(resolve, body)
            else finish(reject, paymentError(response.statusCode === 401 ? 'UNAUTHORIZED' : String(body && body.code || 'PAYMENT_RESPONSE_INVALID')))
          },
          fail() { finish(reject, paymentError('PAYMENT_NETWORK_UNKNOWN')) }
        })
      } catch (_) { finish(reject, paymentError('PAYMENT_NETWORK_UNKNOWN')) }
    })
  }
  const orderPath = (orderNo) => {
    if (!/^VP[A-F0-9]{30}$/.test(orderNo)) throw paymentError('PAYMENT_RESPONSE_INVALID')
    return `${ROOT}/${orderNo}`
  }
  const freshCode = options.loginCode || requestWechatLoginCode
  return {
    environment, context, assertContext,
    async discover(owner, cursor = null, run) {
      if (cursor !== null && (typeof cursor !== 'string' || !/^VP[A-F0-9]{30}$/.test(cursor))) throw paymentError('PAYMENT_RESPONSE_INVALID')
      const result = await request(owner, 'GET', `${ROOT}/recovery${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`, undefined, run)
      if (run) run.check()
      return validateRecoveryPage(result, cursor)
    },
    async prepare(owner) { assertContext(owner, true); const code = await freshCode(); assertContext(owner, true); return code },
    async create(owner, clientRequestId, preparedCode, run) {
      const current = assertContext(owner, true)
      const loginCode = preparedCode || await freshCode()
      assertContext(owner, true)
      return request(owner, 'POST', ROOT, { clientRequestId, loginCode, sku: 'membership_30d', platform: current.platform }, run)
    },
    get(owner, orderNo, run) { return request(owner, 'GET', orderPath(orderNo), undefined, run) },
    async reconcile(owner, orderNo, run) {
      const loginCode = await freshCode()
      assertContext(owner)
      return request(owner, 'POST', `${orderPath(orderNo)}/reconcile`, { loginCode }, run)
    },
    entitlement(owner, orderNo, run) { return request(owner, 'POST', `${orderPath(orderNo)}/entitlement`, {}, run) },
    delivery(owner, orderNo, run) { return request(owner, 'POST', `${orderPath(orderNo)}/delivery`, {}, run) },
    async refresh(owner) {
      assertContext(owner)
      const result = await (options.entitlements || getUserEntitlements)({ session: owner.session, nodeEnv: 'development', apiBaseUrl: owner.baseUrl })
      assertContext(owner)
      return result
    },
    invoke(owner, params, orderNo, run) {
      if (run) run.check()
      assertContext(owner, true)
      validatePaymentParams(params, orderNo)
      return new Promise((resolve) => {
        let settled = false, unsubscribe = () => {}
        const finish = (hint) => { if (settled) return; settled = true; clearTimeout(timer); unsubscribe(); resolve(hint) }
        const timer = setTimeout(() => finish('unknown'), options.paymentTimeout || 15000)
        if (run) unsubscribe = run.onCancel(() => finish('unknown'))
        try { runtime().requestVirtualPayment({ mode: params.mode, signData: params.signData, paySig: params.paySig, signature: params.signature,
          success() { finish('unknown') }, fail(error) { finish(error && error.errCode === -2 ? 'cancelled' : 'unknown') }
        }) } catch (_) { finish('unknown') }
      })
    }
  }
}
