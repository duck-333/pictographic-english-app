import { membershipProductForPrice, membershipProductForSku } from './membership-products.js'

const STORAGE_KEY = 'pictographic:purchase-diagnostics:v1'
const MAX_RECORDS = 10
const STEPS = [
  'createHttp', 'createError', 'createResponse', 'createCheck', 'invokeCheck',
  'nativeCall', 'nativeReturned', 'nativeSuccess', 'nativeFail', 'nativeComplete',
  'nativeThrow', 'nativeTimeout', 'nativeExit', 'pageExit',
  'getHttp', 'getError', 'reconcileHttp', 'reconcileError'
]
const CODES = new Set([
  'UNAUTHORIZED', 'USER_AUTH_REQUIRED', 'WECHAT_CODE_EXCHANGE_FAILED', 'WECHAT_IDENTITY_NOT_BOUND',
  'WECHAT_IDENTITY_MISMATCH', 'WECHAT_IDENTITY_AMBIGUOUS',
  ...[
    'DISABLED', 'PRODUCT_UNAVAILABLE', 'PRODUCT_NOT_CONFIGURED', 'SANDBOX_FORBIDDEN_IN_PRODUCTION',
    'SANDBOX_UNAVAILABLE', 'TEST_USER_NOT_ALLOWED', 'REQUEST_INVALID', 'PLATFORM_UNSUPPORTED',
    'RUNTIME_UNSUPPORTED', 'LOGIN_CODE_INVALID', 'ORDER_CONFLICT', 'ORDER_NOT_PAYABLE', 'ORDER_NOT_FOUND',
    'ORDER_CREATE_FAILED', 'SIGNATURE_FAILED', 'ORDER_NOT_RECONCILABLE', 'QUERY_UNAVAILABLE',
    'QUERY_RESULT_INVALID', 'QUERY_STATUS_UNSUPPORTED', 'PAID_FACT_INCOMPLETE', 'SERVICE_UNAVAILABLE',
    'CONTEXT_CHANGED', 'NETWORK_UNKNOWN', 'RESPONSE_INVALID', 'RECORDS_INVALID', 'STORAGE_FAILED'
  ].map(code => `PAYMENT_${code}`)
])
const ORDER_NO = /^VP[A-F0-9]{30}$/
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/
const VERSION = /^\d{1,4}(?:\.\d{1,4}){0,3}$/
const SYSTEM = /^(?:iOS|Android|HarmonyOS|Windows|macOS|Mac OS X|OHOS) ?\d{1,4}(?:\.\d{1,4}){0,3}$/i
const TEXT_ERR_CODE = /(?:^|[\s(,;])errCode[ \t]*[=:][ \t]*(-150\d{2})(?=$|[\s),;])/i
const MESSAGE_REASONS = [
  [/\bIAP\s+is\s+disabled\b/i, 'IAP 已禁用'],
  [/\bcurrent\s+environment\s+does\s+not\s+match\b/i, '当前环境不匹配'],
  [/session[_ ]?key.{0,24}(?:expir|过期)|会话已过期/i, '会话已过期'],
  [/signature|pay.?sig|签名/i, '签名相关'],
  [/(?:product|goods).{0,24}(?:not found|does not exist)|(?:商品|道具)不存在/i, '商品不存在'],
  [/(?:product|goods).{0,24}(?:not published|unpublished)|(?:商品|道具)未发布/i, '商品未发布'],
  [/product|商品|道具/i, '商品相关'],
  [/offer.?id/i, 'OfferID 相关'],
  [/amount|price|金额|价格/i, '金额相关'],
  [/not supported|unsupported|不支持/i, '当前环境不支持'],
  [/permission denied|not authori[sz]ed|未授权|无权限/i, '权限受限'],
  [/cancel|取消/i, '已取消'],
  [/timed? ?out|超时/i, '超时'],
  [/network|网络/i, '网络异常'],
  [/system error|internal error|系统错误/i, '系统错误'],
  [/invalid (?:param|argument)|参数错误/i, '参数错误']
]
const safeString = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : undefined
const choice = (value, values) => values.includes(value) ? value : undefined

// Keep diagnostic phrases, never persist arbitrary text supplied by an SDK or server.
function safeMessage(value) {
  if (typeof value !== 'string' || !value) return undefined
  const message = value.slice(0, 512)
  const outcome = message.match(/^requestVirtualPayment:(fail|ok|cancel)(?=\s|$)/i)?.[1].toLowerCase()
  const reason = MESSAGE_REASONS.find(([pattern, label]) => message.includes(label) || pattern.test(message))?.[1]
  const prefix = outcome ? `requestVirtualPayment:${outcome}` : ''
  if (outcome === 'ok') return prefix
  return [prefix, reason || '错误详情已隐藏'].filter(Boolean).join(' · ')
}

function safeErrCode(code, message) {
  // Only an explicitly labelled -150xx code can be recovered from free text.
  if (code == null && typeof message === 'string') {
    const text = message.length > 512 ? message.slice(0, 512) + '#' : message
    const match = TEXT_ERR_CODE.exec(text)
    return match ? Number(match[1]) : undefined
  }
  const number = safeString(code, /^-?\d{1,10}$/) ? Number(code) : code
  return Number.isInteger(number) && number >= -2147483648 && number <= 2147483647 ? number : undefined
}

function safeEvent(value) {
  return {
    at: Number.isSafeInteger(value.at) ? value.at : undefined,
    httpStatus: Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : undefined,
    code: CODES.has(value.code) ? value.code : typeof value.code === 'string' ? 'UNRECOGNIZED_CODE' : undefined,
    errCode: safeErrCode(value.errCode, value.errMsg),
    errMsg: safeMessage(value.errMsg),
    orderNo: safeString(value.orderNo, ORDER_NO),
    sku: typeof value.sku === 'string' ? membershipProductForSku(value.sku)?.internalSku : undefined,
    priceFen: typeof value.priceFen === 'number' ? membershipProductForPrice(value.priceFen)?.priceFen : undefined,
    paymentStatus: choice(value.paymentStatus, ['initializing', 'pending', 'confirming', 'paid', 'closed', 'failed']),
    entitlementStatus: choice(value.entitlementStatus, ['not_ready', 'pending', 'granting', 'granted', 'retryable_failed', 'failed']),
    deliveryStatus: choice(value.deliveryStatus, ['not_ready', 'pending', 'confirming', 'delivered', 'retryable_failed', 'manual_review']),
    hasPaymentParams: typeof value.hasPaymentParams === 'boolean' ? value.hasPaymentParams : undefined,
    passed: typeof value.passed === 'boolean' ? value.passed : undefined
  }
}

function safeRuntime(value = {}) {
  return {
    miniProgramVersion: safeString(value.miniProgramVersion, VERSION),
    envVersion: choice(value.envVersion, ['develop', 'trial', 'release']),
    wechatVersion: safeString(value.wechatVersion, VERSION),
    system: safeString(value.system, SYSTEM)
  }
}

function readRuntime() {
  if (typeof wx === 'undefined') return {}
  const read = (method) => {
    try { return wx[method]?.() || {} } catch (_) { return {} }
  }
  const miniProgram = read('getAccountInfoSync').miniProgram || {}
  const app = read('getAppBaseInfo'), device = read('getDeviceInfo')
  const fallback = app.version && device.system ? {} : read('getSystemInfoSync')
  return safeRuntime({ miniProgramVersion: miniProgram.version, envVersion: miniProgram.envVersion,
    wechatVersion: app.version || fallback.version, system: device.system || fallback.system })
}

export function createPaymentDiagnostics(storage, now) {
  const scope = owner => JSON.stringify([owner.environment, owner.baseUrl, owner.userId])
  function read() {
    const rows = storage.get(STORAGE_KEY)
    if (!Array.isArray(rows)) return []
    return rows.slice(-MAX_RECORDS).filter(row => row && typeof row.scope === 'string' &&
      safeString(row.clientRequestId, REQUEST_ID) && row.steps && typeof row.steps === 'object').map(row => ({
      scope: row.scope,
      clientRequestId: row.clientRequestId,
      orderNo: safeString(row.orderNo, ORDER_NO),
      environment: choice(row.environment, ['production', 'sandbox']),
      runtime: safeRuntime(row.runtime || {}),
      steps: Object.fromEntries(STEPS.filter(step => row.steps[step] && typeof row.steps[step] === 'object')
        .map(step => [step, safeEvent(row.steps[step])]))
    }))
  }
  return {
    record(owner, record, step, details = {}) {
      try {
        if (!STEPS.includes(step) || !safeString(record.clientRequestId, REQUEST_ID)) return
        const rows = read()
        const ownerScope = scope(owner)
        const index = rows.findIndex(row => row.scope === ownerScope && row.clientRequestId === record.clientRequestId)
        const row = index < 0 ? { scope: ownerScope, clientRequestId: record.clientRequestId,
          environment: owner.environment, runtime: readRuntime(), steps: {} } : rows.splice(index, 1)[0]
        const orderNo = safeString(record.orderNo, ORDER_NO)
        if (row.orderNo && orderNo && row.orderNo !== orderNo) return
        row.orderNo = orderNo || row.orderNo
        row.steps[step] = safeEvent({ ...details, at: now() })
        rows.push(row)
        storage.set(STORAGE_KEY, rows.slice(-MAX_RECORDS))
      } catch (_) {}
    },
    report(owner, clientRequestId) {
      let row
      try {
        const ownerScope = scope(owner)
        row = read().find(item => item.scope === ownerScope && item.clientRequestId === clientRequestId)
      } catch (_) { return { status: 'read_failed' } }
      if (!row) return { status: 'not_found' }
      try {
        const { scope: ignored, ...report } = row
        return { status: 'ok', text: JSON.stringify(report, null, 2) }
      } catch (_) { return { status: 'serialize_failed' } }
    }
  }
}
