import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  createWechatAesMessageSignature,
  decodeWechatMessageEncodingAesKey,
  decryptWechatAesMessage,
  encryptWechatAesMessage,
  normalizeWechatMessageAppId,
  parseWechatAesPostQuery,
  verifyWechatAesMessageSignature
} from '../server/virtual-payment-message-crypto.mjs'

const TOKEN = 'CryptoMessageToken1'
const APP_ID = 'wx1234567890abcdef'
const OTHER_APP_ID = 'wxfedcba0987654321'
const AES_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1))
const ENCODING_AES_KEY = AES_KEY.toString('base64').slice(0, -1)
// Fake key with the same decoded bytes as ENCODING_AES_KEY, but non-zero unused
// low bits in its final Base64 character, matching the WeChat generator behavior.
const NON_CANONICAL_ENCODING_AES_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyB'
const TIMESTAMP = '1789401600'
const NONCE = 'crypto-nonce-safe'
const RANDOM = Buffer.from(Array.from({ length: 16 }, (_, index) => 0xa0 + index))
const MESSAGE = JSON.stringify({ MsgType: 'event', OpenId: 'openid-safe', value: '往返' })
// Frozen vector generated once with a standalone Node crypto script implementing the
// documented WeChat packing rules. It uses only the fake constants above and was not
// produced by any function imported from the production module.
const FIXED_ENCRYPT = 'RfFaxMrah+xa7fe8XcqsR0dqCOiMAQn/Yq+G2jUCSIkd571SIObjvRTgFpTPk2sY/jwjKLo4X2ckFmrvW1jQndlEuR6y4Q79LO1FHggg0YzX4j8t4wPB2Dd1n0XlDNzGt6TLOrYgaGOCs48dbH/FjCHsM9h87F86xg+S7ogcNr8='
const FIXED_SIGNATURE = '8d145f6193d1d064d2a326a43abd68b5a006180e'

assert.deepEqual(decodeWechatMessageEncodingAesKey(ENCODING_AES_KEY), AES_KEY)
assert.equal(NON_CANONICAL_ENCODING_AES_KEY.length, 43)
assert.match(NON_CANONICAL_ENCODING_AES_KEY, /^[A-Za-z0-9+/]{43}$/)
const independentlyDecodedNonCanonicalKey = Buffer.from(`${NON_CANONICAL_ENCODING_AES_KEY}=`, 'base64')
assert.equal(independentlyDecodedNonCanonicalKey.length, 32)
assert.notEqual(
  independentlyDecodedNonCanonicalKey.toString('base64').slice(0, -1),
  NON_CANONICAL_ENCODING_AES_KEY
)
const decodedNonCanonicalKey = decodeWechatMessageEncodingAesKey(NON_CANONICAL_ENCODING_AES_KEY)
assert.deepEqual(decodedNonCanonicalKey, independentlyDecodedNonCanonicalKey)
assert.deepEqual(decodedNonCanonicalKey, AES_KEY)
assert.equal(normalizeWechatMessageAppId(APP_ID), APP_ID)
for (const invalid of [
  null, 42, '', 'x'.repeat(42), 'x'.repeat(44), '*'.repeat(43),
  `${ENCODING_AES_KEY.slice(0, -1)}*`, `${ENCODING_AES_KEY.slice(0, -1)}=`,
  `${ENCODING_AES_KEY.slice(0, -1)} `, `${ENCODING_AES_KEY.slice(0, -1)}\n`,
  `${ENCODING_AES_KEY.slice(0, -1)}-`, `${ENCODING_AES_KEY.slice(0, -1)}_`
]) {
  assert.throws(() => decodeWechatMessageEncodingAesKey(invalid))
}
for (const invalid of ['', '123456', 'wx-short', 'wx1234567890abcdeg']) {
  assert.throws(() => normalizeWechatMessageAppId(invalid))
}

const encrypted = Object.freeze({
  Encrypt: FIXED_ENCRYPT,
  MsgSignature: FIXED_SIGNATURE,
  TimeStamp: Number(TIMESTAMP),
  Nonce: NONCE
})
assert.deepEqual(Object.keys(encrypted), ['Encrypt', 'MsgSignature', 'TimeStamp', 'Nonce'])
assert.equal(encrypted.TimeStamp, Number(TIMESTAMP))
assert.equal(encrypted.Nonce, NONCE)
assert.equal(decryptWechatAesMessage(encrypted.Encrypt, { aesKey: AES_KEY, appId: APP_ID }).message, MESSAGE)
assert.deepEqual(decryptWechatAesMessage(encrypted.Encrypt, { aesKey: AES_KEY, appId: APP_ID }).body, JSON.parse(MESSAGE))
assert.equal(decryptWechatAesMessage(encrypted.Encrypt, {
  aesKey: decodedNonCanonicalKey, appId: APP_ID
}).message, MESSAGE)

// This compatibility round trip supplements the independently generated fixed
// request vector above; it is not the sole successful encryption oracle.
const nonCanonicalKeyRoundTrip = encryptWechatAesMessage(MESSAGE, {
  aesKey: decodedNonCanonicalKey, appId: APP_ID, token: TOKEN,
  timestamp: TIMESTAMP, nonce: NONCE, randomBytes: RANDOM
})
assert.equal(decryptWechatAesMessage(nonCanonicalKeyRoundTrip.Encrypt, {
  aesKey: decodedNonCanonicalKey, appId: APP_ID
}).message, MESSAGE)

const query = parseWechatAesPostQuery(new URL(
  `http://local.invalid/path?encrypt_type=aes&msg_signature=${encrypted.MsgSignature}&timestamp=${TIMESTAMP}&nonce=${NONCE}&signature=${'a'.repeat(40)}&openid=openid-safe`
))
assert.equal(query.openid, 'openid-safe')
assert.equal(verifyWechatAesMessageSignature(query, TOKEN, encrypted.Encrypt), true)
assert.equal(createWechatAesMessageSignature({
  token: TOKEN, timestamp: TIMESTAMP, nonce: NONCE, encrypted: encrypted.Encrypt
}), encrypted.MsgSignature)

for (const rawQuery of [
  `encrypt_type=aes&timestamp=${TIMESTAMP}&nonce=${NONCE}`,
  `encrypt_type=raw&msg_signature=${encrypted.MsgSignature}&timestamp=${TIMESTAMP}&nonce=${NONCE}`,
  `encrypt_type=aes&msg_signature=${encrypted.MsgSignature}&msg_signature=${encrypted.MsgSignature}&timestamp=${TIMESTAMP}&nonce=${NONCE}`,
  `encrypt_type=aes&msg_signature=${encrypted.MsgSignature}&timestamp=${TIMESTAMP}&nonce=${NONCE}&nonce=again`,
  `encrypt_type=aes&msg_signature=${encrypted.MsgSignature}&timestamp=${TIMESTAMP}&nonce=${NONCE}&unknown=1`,
  `encrypt_type=aes&msg_signature=${encrypted.MsgSignature}&timestamp=${TIMESTAMP}&nonce=${NONCE}&openid=one&openid=two`
]) assert.throws(() => parseWechatAesPostQuery(new URL(`http://local.invalid/path?${rawQuery}`)))

assert.throws(() => verifyWechatAesMessageSignature(
  { ...query, msgSignature: '0'.repeat(40) }, TOKEN, encrypted.Encrypt
), (error) => error.code === 'PAYMENT_MESSAGE_SIGNATURE_INVALID')
const changedCiphertext = `${encrypted.Encrypt.slice(0, -2)}${encrypted.Encrypt.at(-2) === 'A' ? 'B' : 'A'}=`
assert.throws(() => verifyWechatAesMessageSignature(query, TOKEN, changedCiphertext))
for (const invalid of ['', 'not-base64', 'AAAAA===', '****']) {
  assert.throws(() => decryptWechatAesMessage(invalid, { aesKey: AES_KEY, appId: APP_ID }))
}
assert.throws(() => decryptWechatAesMessage(encrypted.Encrypt, { aesKey: AES_KEY, appId: OTHER_APP_ID }))

function addPadding(value) {
  const length = 32 - (value.length % 32)
  return Buffer.concat([value, Buffer.alloc(length, length)])
}

function encryptPacked(packed) {
  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, AES_KEY.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(packed), cipher.final()]).toString('base64')
}

function pack(messageBytes, options = {}) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(options.messageLength === undefined ? messageBytes.length : options.messageLength)
  return Buffer.concat([RANDOM, length, messageBytes, Buffer.from(options.appId || APP_ID, 'utf8')])
}

const invalidPadding = addPadding(pack(Buffer.from('{}', 'utf8')))
invalidPadding[invalidPadding.length - 1] = 0
assert.throws(() => decryptWechatAesMessage(encryptPacked(invalidPadding), { aesKey: AES_KEY, appId: APP_ID }))
const nonWechatBlockLength = Buffer.concat([Buffer.alloc(32, 1), Buffer.alloc(16, 16)])
assert.equal(nonWechatBlockLength.length, 48)
assert.throws(() => decryptWechatAesMessage(
  encryptPacked(nonWechatBlockLength), { aesKey: AES_KEY, appId: APP_ID }
))
assert.throws(() => decryptWechatAesMessage(
  encryptPacked(addPadding(pack(Buffer.from('{}', 'utf8'), { messageLength: 9999 }))),
  { aesKey: AES_KEY, appId: APP_ID }
))
assert.throws(() => decryptWechatAesMessage(
  encryptPacked(addPadding(pack(Buffer.from([0xc3, 0x28])))),
  { aesKey: AES_KEY, appId: APP_ID }
))
for (const invalidMessage of ['not-json', '[]', 'null']) {
  const value = encryptWechatAesMessage(invalidMessage, {
    aesKey: AES_KEY, appId: APP_ID, token: TOKEN,
    timestamp: TIMESTAMP, nonce: NONCE, randomBytes: RANDOM
  })
  assert.throws(() => decryptWechatAesMessage(value.Encrypt, { aesKey: AES_KEY, appId: APP_ID }))
}

const successJson = JSON.stringify({ ErrCode: 0, ErrMsg: 'success' })
const response = encryptWechatAesMessage(successJson, {
  aesKey: AES_KEY, appId: APP_ID, token: TOKEN,
  timestamp: TIMESTAMP, nonce: NONCE, randomBytes: RANDOM
})
assert.equal(decryptWechatAesMessage(response.Encrypt, { aesKey: AES_KEY, appId: APP_ID }).message, successJson)
assert.equal(verifyWechatAesMessageSignature({
  timestamp: String(response.TimeStamp), nonce: response.Nonce, msgSignature: response.MsgSignature
}, TOKEN, response.Encrypt), true)

console.log('virtual payment message crypto tests passed')
