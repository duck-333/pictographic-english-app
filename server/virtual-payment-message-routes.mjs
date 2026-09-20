import { getVirtualPaymentConfig } from './virtual-payment-config.mjs'
import {
  decryptWechatAesMessage,
  encryptWechatAesMessage,
  parseWechatAesPostQuery,
  verifyWechatAesMessageSignature
} from './virtual-payment-message-crypto.mjs'
import {
  getVirtualPaymentMessageConfig,
  normalizeWechatGoodsDeliveryMessage,
  parseWechatMessageQuery,
  verifyWechatMessageSignature
} from './virtual-payment-message.mjs'
import { createVirtualPaymentStore } from './virtual-payment-store.mjs'

const MESSAGE_PATH = '/api/wechat/virtual-payment/message'
const MAX_MESSAGE_BODY_BYTES = 16 * 1024

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache'
  })
  res.end(JSON.stringify(payload))
}

function sendFailure(res, error) {
  const statusCode = error && error.code === 'PAYMENT_MESSAGE_SIGNATURE_INVALID'
    ? 401
    : error && (
      String(error.code || '').includes('CONFIG') ||
      error.code === 'PAYMENT_MESSAGE_DISABLED' ||
      error.code === 'PAYMENT_SERVICE_UNAVAILABLE' ||
      Number(error.statusCode) >= 500
    )
      ? 503
      : 400
  sendJson(res, statusCode, { ErrCode: -1, ErrMsg: 'failed' })
}

export function readRawJsonBody(req) {
  const contentType = req.headers && req.headers['content-type']
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    return Promise.reject(new Error('invalid content type'))
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    let ended = false
    let settled = false
    const cleanup = () => {
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      req.removeListener('aborted', onAborted)
      req.removeListener('close', onClose)
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value)
    }
    const fail = () => finish(new Error('invalid body'))
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      length += bytes.length
      if (length > MAX_MESSAGE_BODY_BYTES) {
        chunks.length = 0
        fail()
        if (typeof req.resume === 'function') req.resume()
        return
      }
      chunks.push(bytes)
    }
    const onEnd = () => {
      ended = true
      if (length === 0) return fail()
      let raw
      try { raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) } catch { return fail() }
      if (!raw.trim()) return fail()
      try {
        const body = JSON.parse(raw)
        if (!body || typeof body !== 'object' || Array.isArray(body)) return fail()
        finish(null, body)
      } catch { fail() }
    }
    const onError = () => fail()
    const onAborted = () => fail()
    const onClose = () => { if (!ended) fail() }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
    req.on('close', onClose)
  })
}

export function createVirtualPaymentMessageRoutes(options = {}) {
  let runtime = null
  function getRuntime() {
    if (runtime) return runtime
    const messageConfig = getVirtualPaymentMessageConfig(options)
    const paymentConfig = getVirtualPaymentConfig(options)
    if (!paymentConfig.enabled || messageConfig.environment !== paymentConfig.environment ||
        messageConfig.wechatEnv !== paymentConfig.wechatEnv) {
      throw new Error('message unavailable')
    }
    const store = options.virtualPaymentStore || createVirtualPaymentStore(options)
    if (!options.identityStore || typeof options.identityStore.findWechatBindingForPayment !== 'function') {
      throw new Error('message unavailable')
    }
    runtime = { messageConfig, paymentConfig, store, identityStore: options.identityStore }
    return runtime
  }

  async function processBusinessMessage(body, current, now, queryOpenid = null) {
    if (
      typeof body.OpenId !== 'string' || !/^[^\s\u0000-\u001f\u007f]{1,128}$/u.test(body.OpenId) ||
      typeof body.OutTradeNo !== 'string' || !/^VP[A-F0-9]{30}$/.test(body.OutTradeNo) ||
      (queryOpenid !== null && queryOpenid !== body.OpenId)
    ) throw new Error('message rejected')
    const binding = await current.identityStore.findWechatBindingForPayment(body.OpenId)
    if (!binding || typeof binding.userId !== 'string' ||
        (current.paymentConfig.environment === 'sandbox' && !current.paymentConfig.sandboxUserIds.includes(binding.userId))) {
      throw new Error('message rejected')
    }
    const order = await current.store.findByUserAndOrderNo(binding.userId, body.OutTradeNo)
    if (!order) throw new Error('message rejected')
    const expectedProductId = current.paymentConfig.environment === 'production'
      ? current.paymentConfig.standardProductId
      : order.unitPriceFen === 100
      ? current.paymentConfig.sandboxTestProductId
      : current.paymentConfig.standardProductId
    if (!expectedProductId || order.productId !== expectedProductId ||
        order.environment !== current.paymentConfig.environment || order.wechatEnv !== current.paymentConfig.wechatEnv) {
      throw new Error('message rejected')
    }
    const fact = normalizeWechatGoodsDeliveryMessage(body, order, {
      originalId: current.messageConfig.originalId,
      openid: body.OpenId,
      userId: binding.userId,
      now
    })
    await current.store.applyGoodsDeliveryNotification(binding.userId, order.orderNo, fact, { now })
  }

  async function handle(req, res, pathname) {
    if (pathname !== MESSAGE_PATH) return false
    if (!['GET', 'POST'].includes(req.method)) {
      sendJson(res, 405, { ErrCode: -1, ErrMsg: 'failed' })
      return true
    }
    try {
      const current = getRuntime()
      const requestUrl = new URL(req.url || '/', 'http://local.invalid')
      if (req.method === 'GET') {
        const query = parseWechatMessageQuery(requestUrl, { method: 'GET' })
        verifyWechatMessageSignature(query, current.messageConfig.token)
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' })
        res.end(query.echostr)
        return true
      }
      const now = options.now ? options.now() : new Date()
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('message rejected')
      if (current.messageConfig.mode === 'plaintext') {
        const query = parseWechatMessageQuery(requestUrl, { method: 'POST' })
        verifyWechatMessageSignature(query, current.messageConfig.token)
        const body = await readRawJsonBody(req)
        await processBusinessMessage(body, current, now)
        sendJson(res, 200, { ErrCode: 0, ErrMsg: 'success' })
        return true
      }
      const query = parseWechatAesPostQuery(requestUrl)
      const envelope = await readRawJsonBody(req)
      if (typeof envelope.Encrypt !== 'string' || envelope.Encrypt.length === 0) throw new Error('message rejected')
      verifyWechatAesMessageSignature(query, current.messageConfig.token, envelope.Encrypt)
      if (
        !Object.hasOwn(envelope, 'ToUserName') || typeof envelope.ToUserName !== 'string' ||
        envelope.ToUserName !== current.messageConfig.originalId
      ) {
        throw new Error('message rejected')
      }
      const decrypted = decryptWechatAesMessage(envelope.Encrypt, {
        aesKey: current.messageConfig.aesKey,
        appId: current.messageConfig.appId
      })
      await processBusinessMessage(decrypted.body, current, now, query.openid)
      const responseOptions = options.messageAesResponse || {}
      const encryptedResponse = encryptWechatAesMessage(JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }), {
        aesKey: current.messageConfig.aesKey,
        appId: current.messageConfig.appId,
        token: current.messageConfig.token,
        timestamp: responseOptions.timestamp === undefined ? Math.floor(now.getTime() / 1000) : responseOptions.timestamp,
        nonce: responseOptions.nonce,
        randomBytes: responseOptions.randomBytes
      })
      sendJson(res, 200, encryptedResponse)
      return true
    } catch (error) {
      sendFailure(res, error)
      return true
    }
  }

  return Object.freeze({ handle })
}
