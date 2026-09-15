import crypto from 'node:crypto'

const SIGNATURE_PATTERN = /^[a-f0-9]{40}$/
const APP_ID_PATTERN = /^wx[0-9a-fA-F]{16}$/
const SAFE_QUERY_VALUE_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/u
const AES_BLOCK_BYTES = 16
const WECHAT_PADDING_BLOCK_BYTES = 32
const RANDOM_PREFIX_BYTES = 16
const LENGTH_PREFIX_BYTES = 4
const MAX_UINT32 = 0xffffffff

function cryptoError(message = 'Wechat virtual payment encrypted message is invalid.', code = 'PAYMENT_MESSAGE_CRYPTO_INVALID', statusCode = 400) {
  const error = new Error(message)
  error.code = code
  error.statusCode = statusCode
  return error
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function decodeStrictBase64(value) {
  if (
    typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) throw cryptoError()
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== value) throw cryptoError()
  return decoded
}

function requireAesKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw cryptoError()
  return value
}

function requireAppId(value) {
  if (typeof value !== 'string' || !APP_ID_PATTERN.test(value)) throw cryptoError()
  return value
}

function requireToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{3,32}$/.test(value)) throw cryptoError()
  return value
}

function requireTimestamp(value) {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof raw !== 'string' || !/^[0-9]{1,10}$/.test(raw)) throw cryptoError()
  return raw
}

function requireNonce(value) {
  if (typeof value !== 'string' || !SAFE_QUERY_VALUE_PATTERN.test(value)) throw cryptoError()
  return value
}

function removeWechatPadding(value) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length % WECHAT_PADDING_BLOCK_BYTES !== 0) throw cryptoError()
  const paddingLength = value[value.length - 1]
  if (paddingLength < 1 || paddingLength > WECHAT_PADDING_BLOCK_BYTES || paddingLength > value.length) throw cryptoError()
  for (let index = value.length - paddingLength; index < value.length; index += 1) {
    if (value[index] !== paddingLength) throw cryptoError()
  }
  return value.subarray(0, value.length - paddingLength)
}

function addWechatPadding(value) {
  const paddingLength = WECHAT_PADDING_BLOCK_BYTES - (value.length % WECHAT_PADDING_BLOCK_BYTES)
  return Buffer.concat([value, Buffer.alloc(paddingLength, paddingLength)])
}

function decodeUtf8(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw cryptoError()
  }
}

export function decodeWechatMessageEncodingAesKey(value) {
  if (typeof value !== 'string' || value.length !== 43 || !/^[A-Za-z0-9+/]{43}$/.test(value)) throw cryptoError()
  const decoded = Buffer.from(`${value}=`, 'base64')
  if (decoded.length !== 32) throw cryptoError()
  return decoded
}

export function normalizeWechatMessageAppId(value) {
  return requireAppId(value)
}

export function parseWechatAesPostQuery(requestUrl) {
  if (!requestUrl || !(requestUrl.searchParams instanceof URLSearchParams)) throw cryptoError()
  const required = ['encrypt_type', 'msg_signature', 'timestamp', 'nonce']
  const optional = ['signature', 'openid']
  const allowed = new Set([...required, ...optional])
  const params = requestUrl.searchParams
  const keys = [...params.keys()]
  if (keys.some((key) => !allowed.has(key)) || required.some((key) => params.getAll(key).length !== 1)) throw cryptoError()
  for (const key of optional) {
    if (params.getAll(key).length > 1) throw cryptoError()
  }
  const encryptType = params.get('encrypt_type')
  const msgSignature = params.get('msg_signature')
  const timestamp = params.get('timestamp')
  const nonce = params.get('nonce')
  const signature = params.has('signature') ? params.get('signature') : null
  const openid = params.has('openid') ? params.get('openid') : null
  if (
    encryptType !== 'aes' || typeof msgSignature !== 'string' || !SIGNATURE_PATTERN.test(msgSignature) ||
    typeof timestamp !== 'string' || !/^[0-9]{1,10}$/.test(timestamp) ||
    typeof nonce !== 'string' || !SAFE_QUERY_VALUE_PATTERN.test(nonce) ||
    (signature !== null && !SIGNATURE_PATTERN.test(signature)) ||
    (openid !== null && !SAFE_QUERY_VALUE_PATTERN.test(openid))
  ) throw cryptoError()
  return Object.freeze({ encryptType, msgSignature, timestamp, nonce, signature, openid })
}

export function createWechatAesMessageSignature({ token, timestamp, nonce, encrypted }) {
  requireToken(token)
  const safeTimestamp = requireTimestamp(timestamp)
  requireNonce(nonce)
  if (typeof encrypted !== 'string' || encrypted.length === 0) throw cryptoError()
  return crypto.createHash('sha1')
    .update([token, safeTimestamp, nonce, encrypted].sort().join(''), 'utf8')
    .digest('hex')
}

export function verifyWechatAesMessageSignature(query, token, encrypted) {
  if (!query || typeof query.msgSignature !== 'string' || !SIGNATURE_PATTERN.test(query.msgSignature)) throw cryptoError()
  const expected = Buffer.from(createWechatAesMessageSignature({
    token, timestamp: query.timestamp, nonce: query.nonce, encrypted
  }), 'hex')
  const provided = Buffer.from(query.msgSignature, 'hex')
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw cryptoError('Wechat virtual payment message signature is invalid.', 'PAYMENT_MESSAGE_SIGNATURE_INVALID', 401)
  }
  return true
}

export function decryptWechatAesMessage(encrypted, options = {}) {
  const aesKey = requireAesKey(options.aesKey)
  const appId = requireAppId(options.appId)
  const ciphertext = decodeStrictBase64(encrypted)
  if (ciphertext.length % AES_BLOCK_BYTES !== 0) throw cryptoError()
  let padded
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, AES_BLOCK_BYTES))
    decipher.setAutoPadding(false)
    padded = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw cryptoError()
  }
  const plaintext = removeWechatPadding(padded)
  if (plaintext.length < RANDOM_PREFIX_BYTES + LENGTH_PREFIX_BYTES + 1) throw cryptoError()
  const messageLength = plaintext.readUInt32BE(RANDOM_PREFIX_BYTES)
  const messageStart = RANDOM_PREFIX_BYTES + LENGTH_PREFIX_BYTES
  const messageEnd = messageStart + messageLength
  if (messageLength < 1 || messageEnd >= plaintext.length) throw cryptoError()
  const message = decodeUtf8(plaintext.subarray(messageStart, messageEnd))
  const embeddedAppId = decodeUtf8(plaintext.subarray(messageEnd))
  if (embeddedAppId !== appId) throw cryptoError()
  let body
  try { body = JSON.parse(message) } catch { throw cryptoError() }
  if (!isPlainObject(body)) throw cryptoError()
  return Object.freeze({ message, body })
}

export function encryptWechatAesMessage(message, options = {}) {
  const aesKey = requireAesKey(options.aesKey)
  const appId = requireAppId(options.appId)
  const token = requireToken(options.token)
  if (typeof message !== 'string') throw cryptoError()
  const messageBytes = Buffer.from(message, 'utf8')
  if (messageBytes.length < 1 || messageBytes.length > MAX_UINT32) throw cryptoError()
  const randomPrefix = options.randomBytes === undefined
    ? crypto.randomBytes(RANDOM_PREFIX_BYTES)
    : typeof options.randomBytes === 'function'
      ? options.randomBytes(RANDOM_PREFIX_BYTES)
      : options.randomBytes
  if (!Buffer.isBuffer(randomPrefix) || randomPrefix.length !== RANDOM_PREFIX_BYTES) throw cryptoError()
  const lengthPrefix = Buffer.alloc(LENGTH_PREFIX_BYTES)
  lengthPrefix.writeUInt32BE(messageBytes.length)
  const packed = addWechatPadding(Buffer.concat([randomPrefix, lengthPrefix, messageBytes, Buffer.from(appId, 'utf8')]))
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, AES_BLOCK_BYTES))
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(packed), cipher.final()]).toString('base64')
  const timestamp = requireTimestamp(options.timestamp === undefined ? Math.floor(Date.now() / 1000) : options.timestamp)
  const nonce = requireNonce(options.nonce === undefined ? crypto.randomBytes(16).toString('hex') : options.nonce)
  const msgSignature = createWechatAesMessageSignature({ token, timestamp, nonce, encrypted })
  return Object.freeze({
    Encrypt: encrypted,
    MsgSignature: msgSignature,
    TimeStamp: Number(timestamp),
    Nonce: nonce
  })
}
