import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createVirtualPaymentApi } from '../miniapp-uni/word-app1/common/virtual-payment-api-client.js'
import { createPaymentDiagnostics } from '../miniapp-uni/word-app1/common/virtual-payment-diagnostics.js'
import { createPurchaseController } from '../miniapp-uni/word-app1/common/virtual-payment-purchase.js'
import { MONTHLY_MEMBERSHIP_PRODUCT } from '../miniapp-uni/word-app1/common/membership-products.js'

const pageUrl = new URL('../miniapp-uni/word-app1/pages/learning-benefits/index.vue', import.meta.url)
const vue = await readFile(pageUrl, 'utf8')
const script = vue.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/from '([^']+)'/g, (_, path) => `from '${new URL(path, pageUrl).href}'`)
const page = (await import(`data:text/javascript,${encodeURIComponent(script)}`)).default
assert(vue.includes('@tap="copyDiagnostic(record)"'))

const diagnosticsKey = 'pictographic:purchase-diagnostics:v1'
const orderNo = 'VP' + 'A'.repeat(30)
const secrets = {
  token: 'fixture-auth-token', sessionKey: 'fixture-session-key', loginCode: 'fixture-login-code',
  paySig: 'a'.repeat(64), signature: 'b'.repeat(64), extra: 'fixture-response-field',
  openid: 'fixture-openid'
}
const leaked = Object.values(secrets).join(' ')
const nativeFailure = { errCode: -15014, errMsg: `requestVirtualPayment:fail product not found ${leaked}`, ...secrets }
const failureCode = 'PAYMENT_QUERY_UNAVAILABLE'

function fixture(options = {}) {
  const disk = new Map(), calls = []
  let session = { token: secrets.token, user: { id: '42', hasWechatBinding: true }, expiresAt: '2099-01-01' }
  let nativeArgs, entered
  const nativeEntered = new Promise(resolve => { entered = resolve })
  const storage = {
    get(key) {
      if (options.brokenStorage && key === diagnosticsKey) throw new Error('diagnostic read failed')
      return disk.has(key) ? JSON.parse(disk.get(key)) : ''
    },
    set(key, value) {
      if (options.brokenWrite && key === diagnosticsKey) throw new Error('diagnostic write failed')
      disk.set(key, JSON.stringify(value))
    }
  }
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release', version: '2.0.3', extra: leaked } }),
    getAppBaseInfo: () => ({ version: '8.0.79', extra: leaked }),
    getDeviceInfo: () => ({ platform: 'ios', system: 'iOS 18.7.8', extra: leaked }),
    canIUse: name => name === 'requestVirtualPayment',
    requestVirtualPayment(args) {
      calls.push('native')
      nativeArgs = args
      entered()
      if (options.native === 'throw') throw new Error('signature error ' + leaked)
      if (options.native === 'wait') return
      const result = options.nativeFailure || nativeFailure
      args.fail(result)
      args.complete(result)
    }
  }
  globalThis.wx = wx
  const summary = { ok: true, orderNo, product: MONTHLY_MEMBERSHIP_PRODUCT,
    paymentStatus: 'pending', entitlementStatus: 'not_ready', deliveryStatus: 'not_ready' }
  const api = createVirtualPaymentApi({
    env: { NODE_ENV: 'production', VUE_APP_WORD_API_BASE_URL: 'https://baxiaota.com' },
    wx, getSession: () => session, loginCode: async () => secrets.loginCode, paymentTimeout: options.timeout || 5000,
    request(args) {
      if (args.url.endsWith('/orders') && args.method === 'POST') {
        calls.push('create')
        args.success({ statusCode: 200, data: { ...summary, ...secrets, paymentParams: {
          mode: 'short_series_goods', signData: JSON.stringify({ env: 0, buyQuantity: 1, currencyType: 'CNY',
            goodsPrice: options.invalidCreate ? 9800 : 1200, outTradeNo: orderNo, secret: leaked }),
          paySig: secrets.paySig, signature: secrets.signature
        } } })
      } else if (args.url.endsWith('/reconcile')) {
        calls.push('reconcile')
        args.success({ statusCode: 503, data: { ok: false, code: failureCode, ...secrets } })
      } else if (args.method === 'GET' && args.url.endsWith(orderNo)) {
        calls.push('get')
        args.success({ statusCode: 200, data: summary })
      } else throw new Error(`unexpected request: ${args.method} ${args.url}`)
      return { abort() {} }
    }
  })
  const open = () => createPurchaseController({ api, storage, diagnosticStorage: storage, confirm: async () => true })
  return { open, disk, calls, storage, nativeEntered, lateNativeError: () => {
    nativeArgs.fail(nativeFailure)
    nativeArgs.complete(nativeFailure)
  }, switchAccount: () => { session = { ...session, user: { ...session.user, id: '43' } } } }
}

function view(purchase) {
  const instance = { ...page.data(), purchase }
  for (const [name, fn] of Object.entries(page.methods)) instance[name] = fn.bind(instance)
  // Use the actual page lifecycle and clipboard method without fetching profile/history.
  instance.refresh = () => instance.reloadRecords()
  return instance
}

function assertPrivate(text) {
  for (const value of Object.values(secrets)) assert(!text.includes(value), 'raw secret escaped')
  assert(!/"(?:token|sessionKey|session_key|openid|signature|paySig|signData|loginCode|scope)"\s*:/.test(text))
}

{
  const h = fixture(), controller = h.open()
  await assert.rejects(controller.buy(), { code: failureCode })
  assert.deepEqual(h.calls, ['create', 'native', 'get', 'reconcile'])
  assert.equal(controller.list()[0].hint, 'unknown')
  page.onUnload.call(view(controller))

  const reopened = view(h.open())
  page.onShow.call(reopened)
  const record = reopened.records[0]
  assert(reopened.diagnosticIds.includes(record.clientRequestId))
  let clipboard, failures = 0
  globalThis.uni = { setClipboardData: ({ data }) => { clipboard = data }, showToast: () => { failures++ } }
  reopened.copyDiagnostic(record)
  const report = JSON.parse(clipboard)
  assert.equal(report.orderNo, orderNo)
  assert.equal(report.environment, 'production')
  assert.deepEqual(report.runtime, { miniProgramVersion: '2.0.3', envVersion: 'release',
    wechatVersion: '8.0.79', system: 'iOS 18.7.8' })
  assert.equal(report.steps.createHttp.httpStatus, 200)
  assert.equal(report.steps.createResponse.sku, 'membership_30d_v2')
  assert.equal(report.steps.createResponse.priceFen, 1200)
  assert.equal(report.steps.createResponse.hasPaymentParams, true)
  assert.equal(report.steps.createCheck.passed, true)
  assert.equal(report.steps.invokeCheck.passed, true)
  assert(Number.isSafeInteger(report.steps.nativeCall.at))
  assert(report.steps.nativeReturned)
  for (const stage of ['nativeFail', 'nativeComplete']) {
    assert.equal(report.steps[stage].errCode, -15014)
    assert.equal(report.steps[stage].errMsg, 'requestVirtualPayment:fail · 商品不存在')
  }
  assert.equal(report.steps.getHttp.httpStatus, 200)
  for (const stage of ['reconcileHttp', 'reconcileError']) {
    assert.equal(report.steps[stage].httpStatus, 503)
    assert.equal(report.steps[stage].code, failureCode)
  }
  assertPrivate(clipboard)
  assertPrivate(h.disk.get(diagnosticsKey).replace(/"scope"\s*:/g, '"partition":'))

  const injected = h.storage.get(diagnosticsKey)
  injected[0].token = secrets.token
  injected[0].steps.nativeFail.paySig = secrets.paySig
  injected[0].steps.nativeFail.errMsg = 'unrecognized SDK text ' + leaked
  h.storage.set(diagnosticsKey, injected)
  reopened.copyDiagnostic(record)
  assertPrivate(clipboard)
  assert.equal(JSON.parse(clipboard).steps.nativeFail.errMsg, '错误详情已隐藏')
  const purchaseState = reopened.purchase.list()
  uni.setClipboardData = ({ fail }) => fail({ errMsg: leaked })
  reopened.copyDiagnostic(record)
  uni.setClipboardData = () => { throw new Error(leaked) }
  reopened.copyDiagnostic(record)
  assert.equal(failures, 2)
  assert.deepEqual(reopened.purchase.list(), purchaseState)
  h.switchAccount()
  assert.equal(reopened.purchase.diagnosticText(record.clientRequestId), '')
  assert.deepEqual(reopened.purchase.diagnosticIds(), [])
}

for (const [native, step] of [['throw', 'nativeThrow'], ['wait', 'nativeTimeout']]) {
  const h = fixture({ native, timeout: 5 }), controller = h.open()
  await assert.rejects(controller.buy(), { code: failureCode })
  const { steps } = JSON.parse(controller.diagnosticText(controller.list()[0].clientRequestId))
  assert(steps[step])
  assert(!steps.nativeExit)
  assert.equal(steps.reconcileError.httpStatus, 503)
}

{
  const errMsg = `requestVirtualPayment:fail IAP is disabled errCode=-15017 ${leaked}`
  const h = fixture({ nativeFailure: { errMsg } }), controller = h.open()
  await assert.rejects(controller.buy(), { code: failureCode })
  page.onUnload.call(view(controller))

  const reopened = view(h.open())
  page.onShow.call(reopened)
  let clipboard
  globalThis.uni = { setClipboardData: ({ data }) => { clipboard = data } }
  reopened.copyDiagnostic(reopened.records[0])
  const { steps } = JSON.parse(clipboard)
  for (const name of ['nativeFail', 'nativeComplete']) {
    assert.equal(steps[name].errCode, -15017)
    assert.equal(steps[name].errMsg, 'requestVirtualPayment:fail · IAP 已禁用')
  }
  assert.equal(steps.reconcileError.httpStatus, 503)
  assert.equal(steps.reconcileError.code, failureCode)
  assertPrivate(clipboard)
  const stored = h.disk.get(diagnosticsKey)
  assertPrivate(stored.replace(/"scope"\s*:/g, '"partition":'))
  assert(!stored.includes('IAP is disabled'))
  assert(!clipboard.includes('IAP is disabled'))
}

{
  const h = fixture(), diagnostics = createPaymentDiagnostics(h.storage, Date.now)
  const owner = { environment: 'production', baseUrl: 'https://baxiaota.com', userId: '42' }
  const record = { clientRequestId: 'purchase-err-msg', orderNo }
  const mismatch = 'requestVirtualPayment:fail current environment does not match'
  const cases = [
    [{ errMsg: mismatch }, undefined, 'requestVirtualPayment:fail · 当前环境不匹配'],
    [{ errMsg: `${mismatch}; errCode: -15017` }, -15017, 'requestVirtualPayment:fail · 当前环境不匹配'],
    [{ errCode: '-15014', errMsg: `${mismatch} errCode=-15017` }, -15014, 'requestVirtualPayment:fail · 当前环境不匹配'],
    [{ errCode: 0, errMsg: 'errCode=-15017' }, 0, '错误详情已隐藏'],
    ...['unrecognised text -15017', 'otherErrCode=-15017', 'errCode=-15017.5',
      'errCode=-150170', 'errCode=-15100', 'errCode=268490002',
      ' '.repeat(498) + 'errCode=-150170'].map(errMsg => [{ errMsg }, undefined, '错误详情已隐藏'])
  ]
  for (const [input, expectedCode, expectedMessage] of cases) {
    diagnostics.record(owner, record, 'nativeFail', input)
    const exported = diagnostics.text(owner, record.clientRequestId)
    const { nativeFail } = JSON.parse(exported).steps
    assert.equal(nativeFail.errCode, expectedCode, input.errMsg)
    assert.equal(nativeFail.errMsg, expectedMessage, input.errMsg)
    assertPrivate(exported)
    assert(!exported.includes('current environment does not match'))
  }
}

{
  const h = fixture({ native: 'wait' }), controller = h.open()
  const buying = controller.buy()
  await h.nativeEntered
  page.onUnload.call(view(controller))
  await buying
  h.lateNativeError()
  assert.deepEqual(h.calls, ['create', 'native'])
  const reopened = h.open()
  const { steps } = JSON.parse(reopened.diagnosticText(reopened.list()[0].clientRequestId))
  assert(steps.pageExit && steps.nativeExit && !steps.nativeTimeout)
  assert.equal(steps.nativeFail.errCode, -15014)
  assert.equal(steps.nativeComplete.errCode, -15014)
}

{
  const h = fixture({ invalidCreate: true }), controller = h.open()
  await assert.rejects(controller.buy(), { code: 'PAYMENT_RESPONSE_INVALID' })
  const { steps } = JSON.parse(controller.diagnosticText(controller.list()[0].clientRequestId))
  assert.equal(steps.createCheck.passed, false)
  assert(!steps.nativeCall)
  assert.deepEqual(h.calls, ['create'])
}

for (const failure of [{ brokenStorage: true }, { brokenWrite: true }]) {
  const h = fixture(failure), controller = h.open()
  await assert.rejects(controller.buy(), { code: failureCode })
  assert.deepEqual(h.calls, ['create', 'native', 'get', 'reconcile'])
  assert.equal(controller.list()[0].hint, 'unknown')
  assert.equal(controller.diagnosticText(controller.list()[0].clientRequestId), '')
}

{
  const h = fixture(), diagnostics = createPaymentDiagnostics(h.storage, Date.now)
  const owner = { environment: 'production', baseUrl: 'https://baxiaota.com', userId: '42' }
  for (let i = 0; i < 12; i++) diagnostics.record(owner, { clientRequestId: `purchase-limit-${i}` }, 'nativeCall')
  assert.equal(h.storage.get(diagnosticsKey).length, 10)
  assert.equal(diagnostics.text(owner, 'purchase-limit-0'), '')
  assert(diagnostics.text(owner, 'purchase-limit-11'))
}

delete globalThis.wx
delete globalThis.uni
console.log('Payment diagnostics: native fail + reconcile 503 survive reopen and clipboard export, with redaction, isolation and bounded storage.')
console.log('Validation failure, synchronous throw, timeout, page exit, late callbacks and diagnostic I/O failures passed.')
console.log('P2: errMsg-only categories, bounded explicit error codes, field precedence and reopened export passed.')
