import { getVirtualPaymentConfig } from './virtual-payment-config.mjs'
import { createVirtualPaymentSigningService } from './virtual-payment-signing.mjs'
import { createWechatAccessTokenProvider } from './wechat-login.mjs'

const WECHAT_API_ORIGIN = 'https://api.weixin.qq.com'
const QUERY_ORDER_PATH = '/xpay/query_order'
const NOTIFY_PROVIDE_GOODS_PATH = '/xpay/notify_provide_goods'
const DEFAULT_TIMEOUT_MS = 7000
const MAX_RESPONSE_BYTES = 64 * 1024
const ORDER_NUMBER_PATTERN = /^(?!_)[A-Za-z0-9_\-|*@]{8,32}$/
const WECHAT_ORDER_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_OPENID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/u
const KNOWN_ORDER_STATUSES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

function createClientError(message, code = 'VIRTUAL_PAYMENT_CLIENT_FAILED', statusCode = 502) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function normalizeOpenid(value) {
  if (typeof value !== 'string' || !SAFE_OPENID_PATTERN.test(value)) {
    throw createClientError('Virtual payment identity is invalid.', 'VIRTUAL_PAYMENT_IDENTITY_INVALID', 400)
  }
  return value
}

function normalizeOrderReference(input, options = {}) {
  if (!isPlainObject(input)) {
    throw createClientError('Virtual payment order reference is invalid.', 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID', 400)
  }
  const requireOpenid = options.requireOpenid === true
  const allowedKeys = new Set(requireOpenid
    ? ['openid', 'orderNo', 'wechatOrderId']
    : ['orderNo', 'wechatOrderId'])
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw createClientError('Virtual payment order reference is invalid.', 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID', 400)
  }
  const hasOrderNo = input.orderNo !== undefined && input.orderNo !== null && input.orderNo !== ''
  const hasWechatOrderId = input.wechatOrderId !== undefined && input.wechatOrderId !== null && input.wechatOrderId !== ''
  if (hasOrderNo === hasWechatOrderId) {
    throw createClientError('Exactly one virtual payment order reference is required.', 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID', 400)
  }
  if (hasOrderNo && (typeof input.orderNo !== 'string' || !ORDER_NUMBER_PATTERN.test(input.orderNo))) {
    throw createClientError('Virtual payment order reference is invalid.', 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID', 400)
  }
  if (
    hasWechatOrderId &&
    (typeof input.wechatOrderId !== 'string' || !WECHAT_ORDER_NUMBER_PATTERN.test(input.wechatOrderId))
  ) {
    throw createClientError('Virtual payment order reference is invalid.', 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID', 400)
  }
  return Object.freeze({
    openid: requireOpenid ? normalizeOpenid(input.openid) : null,
    orderNo: hasOrderNo ? input.orderNo : null,
    wechatOrderId: hasWechatOrderId ? input.wechatOrderId : null
  })
}

function normalizeNotifyReference(input) {
  if (
    !isPlainObject(input) ||
    Object.keys(input).length !== 1 ||
    !Object.hasOwn(input, 'orderNo') ||
    typeof input.orderNo !== 'string' ||
    !ORDER_NUMBER_PATTERN.test(input.orderNo)
  ) {
    throw createClientError('Virtual payment order reference is invalid.', 'VIRTUAL_PAYMENT_ORDER_REFERENCE_INVALID', 400)
  }
  return Object.freeze({ orderNo: input.orderNo })
}

function assertEnabledSandbox(config) {
  if (!config || !config.enabled) {
    throw createClientError('Virtual payment is disabled.', 'VIRTUAL_PAYMENT_DISABLED', 503)
  }
  if (config.environment !== 'sandbox' || config.wechatEnv !== 1) {
    throw createClientError('Virtual payment environment is invalid.', 'VIRTUAL_PAYMENT_ENVIRONMENT_INVALID', 503)
  }
}

function createRequestBody(reference) {
  if (reference.orderNo) {
    return Object.freeze({
      openid: reference.openid,
      env: 1,
      order_id: reference.orderNo
    })
  }
  return Object.freeze({
    openid: reference.openid,
    env: 1,
    wx_order_id: reference.wechatOrderId
  })
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, consumeResponse) {
  const controller = new AbortController()
  let timeoutId
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(createClientError('Wechat virtual payment request timed out.', 'VIRTUAL_PAYMENT_CLIENT_TIMEOUT', 504))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchImpl(url, { ...options, signal: controller.signal })
        return consumeResponse(response, controller.signal)
      }),
      timeoutPromise
    ])
  } catch (error) {
    if (error && error.code === 'VIRTUAL_PAYMENT_CLIENT_TIMEOUT') throw error
    if (error && typeof error.code === 'string' && error.code.startsWith('VIRTUAL_PAYMENT_')) throw error
    throw createClientError('Wechat virtual payment service is unavailable.', 'VIRTUAL_PAYMENT_CLIENT_UNAVAILABLE', 503)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function readWechatResponseBody(response, signal) {
  if (!response || !Number.isInteger(response.status)) {
    try { await response?.body?.cancel() } catch {}
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  if (response.status < 200 || response.status >= 300) {
    try { await response.body?.cancel() } catch {}
    throw createClientError('Wechat virtual payment request failed.', 'VIRTUAL_PAYMENT_HTTP_ERROR')
  }
  let contentLengthValue
  try {
    contentLengthValue = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-length') : null
  } catch {
    try { await response.body?.cancel() } catch {}
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  const contentLength = contentLengthValue === null ? null : Number(contentLengthValue)
  if (contentLength !== null && (!/^\d+$/.test(contentLengthValue) || !Number.isSafeInteger(contentLength) || contentLength < 0)) {
    try { await response.body?.cancel() } catch {}
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  if (contentLength !== null && contentLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel() } catch {}
    throw createClientError('Wechat virtual payment response is too large.', 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE')
  }
  if (response.body === null) {
    if (contentLength !== null && contentLength !== 0) {
      throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
    }
    return ''
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    try { await response.body?.cancel() } catch {}
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  let reader
  const chunks = []
  let byteLength = 0
  let completed = false
  let cancelled = false
  const cancelReader = async () => {
    if (cancelled || !reader) return
    cancelled = true
    try { await reader.cancel() } catch {}
  }
  const onAbort = () => { void cancelReader() }
  try {
    reader = response.body.getReader()
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) throw new Error('Aborted response.')
    while (true) {
      const result = await reader.read()
      if (!result || typeof result.done !== 'boolean') {
        throw new Error('Invalid response stream result.')
      }
      if (signal?.aborted) throw new Error('Aborted response.')
      if (result.done) { completed = true; break }
      if (!(result.value instanceof Uint8Array)) {
        throw new Error('Invalid response stream chunk.')
      }
      byteLength += result.value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await cancelReader()
        throw createClientError('Wechat virtual payment response is too large.', 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE')
      }
      chunks.push(result.value)
    }
  } catch {
    if (byteLength > MAX_RESPONSE_BYTES) {
      throw createClientError('Wechat virtual payment response is too large.', 'VIRTUAL_PAYMENT_RESPONSE_TOO_LARGE')
    }
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!reader) { try { await response.body?.cancel() } catch {} }
    if (!completed) await cancelReader()
    try { reader?.releaseLock() } catch {}
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
}

async function readWechatJson(response, signal) {
  const raw = await readWechatResponseBody(response, signal)
  if (!raw) {
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  if (!isPlainObject(payload)) {
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  if (
    typeof payload.errcode !== 'number' ||
    !Number.isFinite(payload.errcode) ||
    !Number.isInteger(payload.errcode)
  ) {
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  if (payload.errcode !== 0) {
    throw createClientError('Wechat virtual payment request was rejected.', 'VIRTUAL_PAYMENT_WECHAT_ERROR')
  }
  return payload
}

async function requireEmptyWechatResponse(response, signal) {
  const raw = await readWechatResponseBody(response, signal)
  if (!raw.trim()) return
  // There is currently no documented public errcode that proves the request was
  // rejected before WeChat could accept it. Keep the explicit-rejection allowlist empty.
  throw createClientError('Wechat virtual payment response is unexpected.', 'VIRTUAL_PAYMENT_UNEXPECTED_RESPONSE')
}

function optionalInteger(value, fieldName) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw createClientError(`Wechat virtual payment ${fieldName} is invalid.`, 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  return value
}

function optionalSafeString(value, maximumLength = 128) {
  if (value === undefined || value === null || value === '') return null
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw createClientError('Wechat virtual payment response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  return value
}

function normalizeQueryOrderResponse(payload) {
  if (!isPlainObject(payload.order)) {
    throw createClientError('Wechat virtual payment order response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  const order = payload.order
  if (
    typeof order.status !== 'number' ||
    !Number.isInteger(order.status) ||
    !KNOWN_ORDER_STATUSES.has(order.status)
  ) {
    throw createClientError('Wechat virtual payment order status is unknown.', 'VIRTUAL_PAYMENT_QUERY_STATUS_UNKNOWN')
  }
  const orderId = optionalSafeString(order.order_id, 32)
  const wechatOrderId = optionalSafeString(order.wx_order_id, 128)
  if (!orderId && !wechatOrderId) {
    throw createClientError('Wechat virtual payment order response is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  const environmentType = optionalInteger(order.env_type, 'environment type')
  if (environmentType !== 2) {
    throw createClientError('Wechat virtual payment order environment is invalid.', 'VIRTUAL_PAYMENT_RESPONSE_INVALID')
  }
  return Object.freeze({
    orderId,
    wechatOrderId,
    wechatPaymentOrderId: optionalSafeString(order.wxpay_order_id, 128),
    status: order.status,
    orderType: optionalInteger(order.order_type, 'order type'),
    orderFeeFen: optionalInteger(order.order_fee, 'order fee'),
    paidFeeFen: optionalInteger(order.paid_fee, 'paid fee'),
    paidAtSeconds: optionalInteger(order.paid_time, 'paid time'),
    providedAtSeconds: optionalInteger(order.provide_time, 'provide time'),
    environmentType,
    environment: 'sandbox'
  })
}

export function createVirtualPaymentClient(options = {}) {
  const config = getVirtualPaymentConfig({
    env: options.env,
    nodeEnv: options.nodeEnv
  })
  const signingService = options.signingService || createVirtualPaymentSigningService({
    env: options.env,
    nodeEnv: options.nodeEnv
  })
  const accessTokenProvider = options.accessTokenProvider || createWechatAccessTokenProvider(options.wechat || {})
  const fetchImpl = options.fetch || globalThis.fetch
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
    throw createClientError('Virtual payment client configuration is invalid.', 'VIRTUAL_PAYMENT_CLIENT_CONFIG_INVALID', 500)
  }

  async function postWechat(path, requestBody, query = {}, options = {}) {
    let accessToken
    try {
      accessToken = await accessTokenProvider.getAccessToken()
    } catch {
      throw createClientError('Wechat access token is unavailable.', 'WECHAT_ACCESS_TOKEN_UNAVAILABLE', 503)
    }
    if (typeof accessToken !== 'string' || !accessToken || /[\u0000-\u001f\u007f]/.test(accessToken)) {
      throw createClientError('Wechat access token is unavailable.', 'WECHAT_ACCESS_TOKEN_UNAVAILABLE', 503)
    }
    const requestUrl = new URL(path, WECHAT_API_ORIGIN)
    requestUrl.searchParams.set('access_token', accessToken)
    for (const [key, value] of Object.entries(query)) requestUrl.searchParams.set(key, value)
    return fetchWithTimeout(fetchImpl, requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      ...(requestBody === undefined ? {} : { body: requestBody }),
      redirect: 'error'
    }, timeoutMs, async (response, signal) => {
      if (options.expectEmptyResponse) {
        await requireEmptyWechatResponse(response, signal)
        return null
      }
      return readWechatJson(response, signal)
    })
  }

  async function queryOrder(input = {}) {
    assertEnabledSandbox(config)
    const reference = normalizeOrderReference(input, { requireOpenid: true })
    const requestBody = JSON.stringify(createRequestBody(reference))
    const paySig = signingService.signQueryOrderPayload(requestBody)
    const payload = await postWechat(QUERY_ORDER_PATH, requestBody, { pay_sig: paySig })
    return normalizeQueryOrderResponse(payload)
  }

  async function notifyProvideGoods(input = {}) {
    assertEnabledSandbox(config)
    const reference = normalizeNotifyReference(input)
    await postWechat(NOTIFY_PROVIDE_GOODS_PATH, undefined, {
      order_id: reference.orderNo,
      env: '1'
    }, { expectEmptyResponse: true })
    return Object.freeze({ accepted: true })
  }

  return Object.freeze({
    queryOrder,
    notifyProvideGoods
  })
}
