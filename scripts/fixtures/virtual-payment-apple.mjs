import crypto from 'node:crypto'

// Official query_order fields and xpay_goods_deliver_notify goods fields.
// Apple payment is order_type=7; non-WeChat notifications omit WeChatPayInfo.
// https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order.html
// https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
export function appleQueryPayload(order, now, overrides = {}) {
  return { errcode: 0, errmsg: 'ok', order: {
    order_id: order.orderNo, wx_order_id: `APPLE${order.orderNo}`,
    wxpay_order_id: `apple-transaction-${order.orderNo}`, status: 2, order_type: 7,
    order_fee: order.orderAmountFen, paid_fee: order.orderAmountFen,
    paid_time: Math.floor(now.getTime() / 1000) - 10, provide_time: 0, env_type: 1,
    ...overrides
  } }
}

export function appleQueryResult(order, now, overrides = {}) {
  const { order: value } = appleQueryPayload(order, now)
  return {
    orderId: value.order_id, wechatOrderId: value.wx_order_id, wechatPaymentOrderId: value.wxpay_order_id,
    status: value.status, orderType: value.order_type, orderFeeFen: value.order_fee, paidFeeFen: value.paid_fee,
    paidAtSeconds: value.paid_time, providedAtSeconds: value.provide_time,
    environmentType: value.env_type, environment: 'production', ...overrides
  }
}

export function appleMessageBody(order, { originalId, openid, now }) {
  return {
    ToUserName: originalId, FromUserName: 'wechat-message-sender', CreateTime: Math.floor(now.getTime() / 1000),
    MsgType: 'event', Event: 'xpay_goods_deliver_notify', OpenId: openid, OutTradeNo: order.orderNo, Env: 0,
    GoodsInfo: { ProductId: order.productId, Quantity: 1, Attach: order.orderNo }
  }
}

// Independent encoder: exercises the production route's signature/decryption,
// rather than generating test requests with the production crypto implementation.
export function appleAesRequest(body, { aesKey, appId, token }) {
  const bytes = Buffer.from(JSON.stringify(body))
  const size = Buffer.alloc(4)
  size.writeUInt32BE(bytes.length)
  const packed = Buffer.concat([Buffer.alloc(16, 9), size, bytes, Buffer.from(appId)])
  const padding = 32 - packed.length % 32
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([packed, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64')
  const timestamp = String(body.CreateTime), nonce = 'apple-fixture-nonce'
  const signature = crypto.createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
  return {
    body: JSON.stringify({ ToUserName: body.ToUserName, Encrypt: encrypted }),
    query: new URLSearchParams({ encrypt_type: 'aes', msg_signature: signature, timestamp, nonce, openid: body.OpenId }).toString()
  }
}
