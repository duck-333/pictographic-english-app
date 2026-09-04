import { requireUserAuth } from './auth.mjs'
import { getVirtualPaymentConfig } from './virtual-payment-config.mjs'
import { createVirtualPaymentClient } from './virtual-payment-client.mjs'
import { createVirtualPaymentService } from './virtual-payment-service.mjs'
import { createVirtualPaymentSessionService } from './virtual-payment-session.mjs'
import { createVirtualPaymentSigningService } from './virtual-payment-signing.mjs'
import { createVirtualPaymentStore } from './virtual-payment-store.mjs'

const COLLECTION_PATH = '/api/user/virtual-payment/orders'
const MAX_BODY_BYTES = 16 * 1024
const CREATE_FIELDS = new Set(['clientRequestId', 'loginCode', 'sku', 'platform'])
const RECONCILE_FIELDS = new Set(['loginCode'])
const ENTITLEMENT_FIELDS = new Set()
const DELIVERY_FIELDS = new Set()
const PUBLIC_ERROR_CODES = new Set([
  'PAYMENT_DISABLED',
  'PAYMENT_SANDBOX_FORBIDDEN_IN_PRODUCTION',
  'PAYMENT_TEST_USER_NOT_ALLOWED',
  'PAYMENT_REQUEST_INVALID',
  'PAYMENT_PLATFORM_UNSUPPORTED',
  'PAYMENT_LOGIN_CODE_INVALID',
  'WECHAT_CODE_EXCHANGE_FAILED',
  'WECHAT_IDENTITY_NOT_BOUND',
  'WECHAT_IDENTITY_MISMATCH',
  'WECHAT_IDENTITY_AMBIGUOUS',
  'PAYMENT_ORDER_CONFLICT',
  'PAYMENT_ORDER_NOT_PAYABLE',
  'PAYMENT_ORDER_NOT_FOUND',
  'PAYMENT_ORDER_CREATE_FAILED',
  'PAYMENT_SIGNATURE_FAILED',
  'PAYMENT_ORDER_NOT_RECONCILABLE',
  'PAYMENT_QUERY_UNAVAILABLE',
  'PAYMENT_QUERY_RESULT_INVALID',
  'PAYMENT_QUERY_STATUS_UNSUPPORTED',
  'PAYMENT_PAID_FACT_INCOMPLETE',
  'PAYMENT_ENTITLEMENT_INCOMPLETE',
  'PAYMENT_ENTITLEMENT_NOT_GRANTABLE',
  'PAYMENT_MEMBERSHIP_SCHEDULE_UNAVAILABLE',
  'PAYMENT_MEMBERSHIP_GRANT_FAILED',
  'PAYMENT_DELIVERY_NOT_READY',
  'PAYMENT_DELIVERY_CONFLICT',
  'PAYMENT_DELIVERY_STALE_RESULT',
  'PAYMENT_DELIVERY_MANUAL_REVIEW',
  'PAYMENT_DELIVERY_QUERY_INVALID',
  'PAYMENT_DELIVERY_QUERY_UNAVAILABLE',
  'PAYMENT_SERVICE_UNAVAILABLE'
])

function sendNoStoreJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Request-Id',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache'
  })
  res.end(JSON.stringify(payload))
}

function createRouteError(message, code = 'PAYMENT_REQUEST_INVALID', statusCode = 400) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function readPaymentJsonBody(req, allowedFields) {
  const contentType = String(req.headers && req.headers['content-type'] || '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    throw createRouteError('Payment request must be JSON.')
  }
  return new Promise((resolve, reject) => {
    let size = 0
    let raw = ''
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk, 'utf8')
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        raw = ''
        return
      }
      if (!tooLarge) raw += chunk
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(createRouteError('Payment request body is too large.'))
        return
      }
      if (!raw.trim()) {
        reject(createRouteError('Payment request is invalid.'))
        return
      }
      if (/\\u[0-9a-f]{4}/i.test(raw)) {
        reject(createRouteError('Payment request contains unsupported escaped field data.'))
        return
      }
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        reject(createRouteError('Payment request must be valid JSON.'))
        return
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        reject(createRouteError('Payment request is invalid.'))
        return
      }
      const fields = Object.keys(body)
      if (fields.some((field) => !allowedFields.has(field))) {
        reject(createRouteError('Payment request contains unsupported fields.'))
        return
      }
      for (const field of fields) {
        const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const matches = raw.match(new RegExp(`"${escaped}"\\s*:`, 'g')) || []
        if (matches.length !== 1) {
          reject(createRouteError('Payment request contains duplicate fields.'))
          return
        }
      }
      resolve(body)
    })
    req.on('error', () => reject(createRouteError('Payment request could not be read.')))
  })
}

function sendSafeError(res, error) {
  const code = error && PUBLIC_ERROR_CODES.has(error.code) ? error.code : 'PAYMENT_SERVICE_UNAVAILABLE'
  const statusCode = code === 'PAYMENT_ORDER_NOT_FOUND'
    ? 404
    : Math.min(599, Math.max(400, Number(error && error.statusCode || 503)))
  sendNoStoreJson(res, statusCode, {
    ok: false,
    code,
    message: code === 'PAYMENT_ORDER_NOT_FOUND'
      ? 'Payment order was not found.'
      : code === 'PAYMENT_REQUEST_INVALID'
        ? 'Payment request is invalid.'
        : 'Payment operation failed.'
  })
}

export function createVirtualPaymentRoutes(options = {}) {
  let runtime = null

  function getService() {
    if (options.virtualPaymentService) return options.virtualPaymentService
    if (runtime) {
      if (runtime.error) throw runtime.error
      return runtime.service
    }
    let config
    try {
      config = getVirtualPaymentConfig({ env: options.env, nodeEnv: options.nodeEnv })
    } catch (error) {
      const mapped = createRouteError(
        'Payment service is unavailable.',
        error && error.code === 'VIRTUAL_PAYMENT_SANDBOX_PRODUCTION_FORBIDDEN'
          ? 'PAYMENT_SANDBOX_FORBIDDEN_IN_PRODUCTION'
          : 'PAYMENT_SERVICE_UNAVAILABLE',
        503
      )
      runtime = { error: mapped }
      throw mapped
    }
    if (!config.enabled) {
      const disabled = createRouteError('Payment is disabled.', 'PAYMENT_DISABLED', 503)
      runtime = { error: disabled }
      throw disabled
    }
    try {
      const store = options.virtualPaymentStore || createVirtualPaymentStore(options)
      const paymentSessionService = options.virtualPaymentSessionService || createVirtualPaymentSessionService({
        wechatLoginClient: options.wechatLoginClient,
        identityStore: options.identityStore
      })
      const signingService = options.virtualPaymentSigningService || createVirtualPaymentSigningService(options)
      const virtualPaymentClient = options.virtualPaymentClient || createVirtualPaymentClient({
        ...options,
        signingService
      })
      runtime = {
        service: createVirtualPaymentService({
          ...options,
          store,
          paymentSessionService,
          signingService,
          virtualPaymentClient
        })
      }
      return runtime.service
    } catch {
      const unavailable = createRouteError('Payment service is unavailable.', 'PAYMENT_SERVICE_UNAVAILABLE', 503)
      runtime = { error: unavailable }
      throw unavailable
    }
  }

  async function handle(req, res, pathname, userAuthOptions) {
    const isCollection = pathname === COLLECTION_PATH
    const itemSuffix = pathname.startsWith(`${COLLECTION_PATH}/`)
      ? pathname.slice(`${COLLECTION_PATH}/`.length)
      : ''
    const itemSegments = itemSuffix.split('/')
    const isReconciliation = itemSegments.length === 2 && itemSegments[1] === 'reconcile'
    const isEntitlement = itemSegments.length === 2 && itemSegments[1] === 'entitlement'
    const isDelivery = itemSegments.length === 2 && itemSegments[1] === 'delivery'
    const isItem = itemSegments.length === 1 && Boolean(itemSegments[0])
    if (!isCollection && !isItem && !isReconciliation && !isEntitlement && !isDelivery) return false

    const allowedMethod = (isCollection && req.method === 'POST') ||
      (isItem && req.method === 'GET') ||
      (isReconciliation && req.method === 'POST') ||
      (isEntitlement && req.method === 'POST') ||
      (isDelivery && req.method === 'POST')
    if (!allowedMethod) {
      sendNoStoreJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' })
      return true
    }

    const authResult = requireUserAuth(req, userAuthOptions)
    if (!authResult.ok) {
      sendNoStoreJson(res, 401, { ok: false, code: 'UNAUTHORIZED', message: 'Unauthorized' })
      return true
    }

    try {
      const service = getService()
      if (isCollection) {
        const body = await readPaymentJsonBody(req, CREATE_FIELDS)
        const result = await service.createOrResumeOrder({
          authenticatedUserId: authResult.userId,
          clientRequestId: body.clientRequestId,
          loginCode: body.loginCode,
          sku: body.sku,
          platform: body.platform
        })
        sendNoStoreJson(res, 200, { ok: true, ...result })
        return true
      }

      if (isReconciliation) {
        let reconciliationOrderNo
        try {
          reconciliationOrderNo = decodeURIComponent(itemSegments[0])
        } catch {
          throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
        }
        if (!/^VP[A-F0-9]{30}$/.test(reconciliationOrderNo)) {
          throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
        }
        const body = await readPaymentJsonBody(req, RECONCILE_FIELDS)
        const result = await service.reconcileOwnedOrder({
          authenticatedUserId: authResult.userId,
          orderNo: reconciliationOrderNo,
          loginCode: body.loginCode
        })
        sendNoStoreJson(res, 200, { ok: true, ...result })
        return true
      }

      if (isEntitlement) {
        let entitlementOrderNo
        try {
          entitlementOrderNo = decodeURIComponent(itemSegments[0])
        } catch {
          throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
        }
        if (!/^VP[A-F0-9]{30}$/.test(entitlementOrderNo)) {
          throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
        }
        await readPaymentJsonBody(req, ENTITLEMENT_FIELDS)
        const result = await service.grantOwnedOrderEntitlement({
          authenticatedUserId: authResult.userId,
          orderNo: entitlementOrderNo
        })
        sendNoStoreJson(res, 200, { ok: true, ...result })
        return true
      }

      if (isDelivery) {
        let deliveryOrderNo
        try {
          deliveryOrderNo = decodeURIComponent(itemSegments[0])
        } catch {
          throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
        }
        if (!/^VP[A-F0-9]{30}$/.test(deliveryOrderNo)) {
          throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
        }
        await readPaymentJsonBody(req, DELIVERY_FIELDS)
        const result = await service.deliverOwnedOrder({
          authenticatedUserId: authResult.userId,
          orderNo: deliveryOrderNo
        })
        sendNoStoreJson(res, 200, { ok: true, ...result })
        return true
      }

      let orderNo
      try {
        orderNo = decodeURIComponent(pathname.slice(`${COLLECTION_PATH}/`.length))
      } catch {
        throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      }
      if (!/^VP[A-F0-9]{30}$/.test(orderNo)) {
        throw createRouteError('Payment order was not found.', 'PAYMENT_ORDER_NOT_FOUND', 404)
      }
      const result = await service.getOwnedOrder({
        authenticatedUserId: authResult.userId,
        orderNo
      })
      sendNoStoreJson(res, 200, { ok: true, ...result })
      return true
    } catch (error) {
      sendSafeError(res, error)
      return true
    }
  }

  return Object.freeze({ handle })
}
