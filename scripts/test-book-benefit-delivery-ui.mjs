import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const ADMIN_CLIENT_PATH = '../admin-portal/pictographic-admin/common/api-client.js'
const MINI_CLIENT_PATH = '../miniapp-uni/word-app1/common/book-benefit-api-client.js'
const ADMIN_PAGE_PATH = new URL('../admin-portal/pictographic-admin/pages/index/index.vue', import.meta.url)
const MINI_PAGE_PATH = new URL('../miniapp-uni/word-app1/pages/mine/index.vue', import.meta.url)

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data }
  }
}

function loadVueComponent(fileUrl, globals = {}) {
  const source = fs.readFileSync(fileUrl, 'utf8')
  const scriptMatch = source.match(/<script>\s*([\s\S]*?)<\/script>/)
  assert(scriptMatch, `Missing script block in ${fileUrl.pathname}`)
  const script = scriptMatch[1]
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*/g, '')
    .replace('export default', 'globalThis.__component =')
  const context = vm.createContext({
    console,
    Date,
    Math,
    Promise,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Set,
    Map,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    BottomNav: {},
    ...globals
  })
  new vm.Script(script, { filename: fileUrl.pathname }).runInContext(context)
  return { component: context.__component, source, context }
}

function createComponentInstance(component) {
  const instance = component.data.call({})
  for (const [name, method] of Object.entries(component.methods || {})) instance[name] = method
  for (const [name, getter] of Object.entries(component.computed || {})) {
    Object.defineProperty(instance, name, { configurable: true, get: () => getter.call(instance) })
  }
  return instance
}

async function testAdminApiClient() {
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return response(200, { ok: true, status: 'not_found' })
  }
  try {
    const client = await import(ADMIN_CLIENT_PATH)
    const requestOptions = { apiBaseUrl: 'https://admin.invalid', adminApiToken: 'FAKE_ADMIN_TOKEN' }
    await client.getBookBenefitCampaign(requestOptions)
    await client.issueBookBenefitCode({ operationId: 'issue-1', userId: '42' }, requestOptions)
    await client.getBookBenefitIssueStatus('issue-1', requestOptions)
    await client.replaceBookBenefitCode({ codeId: '7', operationId: 'replace-1', reasonCode: 'delivery_failed' }, requestOptions)

    assert.deepEqual(requests.map((item) => [item.url, item.options.method]), [
      ['https://admin.invalid/api/admin/book-benefits/campaign', 'GET'],
      ['https://admin.invalid/api/admin/book-benefits/codes/issue', 'POST'],
      ['https://admin.invalid/api/admin/book-benefits/codes/issue-status', 'POST'],
      ['https://admin.invalid/api/admin/book-benefits/codes/replace', 'POST']
    ])
    for (const item of requests) assert.equal(item.options.headers.Authorization, 'Bearer FAKE_ADMIN_TOKEN')
    assert.deepEqual(JSON.parse(requests[1].options.body), { operationId: 'issue-1', userId: '42' })
    assert.deepEqual(JSON.parse(requests[2].options.body), { operationId: 'issue-1' })
    assert.deepEqual(JSON.parse(requests[3].options.body), { codeId: '7', operationId: 'replace-1', reasonCode: 'delivery_failed' })
  } finally {
    globalThis.fetch = originalFetch
    process.env.NODE_ENV = previousNodeEnv
  }
}

async function testMiniappApiClient() {
  const requests = []
  let removedAuthSessions = 0
  const originalUni = globalThis.uni
  globalThis.uni = {
    request(options) {
      requests.push(options)
      queueMicrotask(() => options.success({ statusCode: 200, data: {
        ok: true,
        membershipType: 'monthly',
        membershipStatus: 'active',
        membershipExpireAt: '2026-09-12T00:00:00.000Z',
        quotaBalance: 7,
        idempotent: false
      } }))
      return { abort() {} }
    },
    removeStorageSync() { removedAuthSessions += 1 },
    getStorageSync() { return null }
  }
  try {
    const client = await import(MINI_CLIENT_PATH)
    const session = { token: 'FAKE_USER_JWT', user: { id: '42' } }
    await client.redeemBookBenefitCode({
      code: 'BOOK-FAKE-CODE',
      operationId: 'redeem-ui-1',
      userId: 'attacker',
      campaignId: 'attacker',
      membershipDays: 999,
      sourceType: 'attacker',
      phoneHash: 'attacker',
      now: 'attacker'
    }, { nodeEnv: 'development', apiBaseUrl: 'https://mini.invalid', session })
    assert.equal(requests[0].url, 'https://mini.invalid/api/user/book-benefits/redeem')
    assert.equal(requests[0].method, 'POST')
    assert.equal(requests[0].header.Authorization, 'Bearer FAKE_USER_JWT')
    assert.deepEqual(requests[0].data, { code: 'BOOK-FAKE-CODE', operationId: 'redeem-ui-1' })

    globalThis.uni.request = (options) => {
      queueMicrotask(() => options.success({ statusCode: 401, data: { ok: false, code: 'UNAUTHORIZED', message: 'PRIVATE TOKEN SENTINEL' } }))
      return { abort() {} }
    }
    await assert.rejects(
      client.redeemBookBenefitCode({ code: 'BOOK-FAKE-CODE', operationId: 'redeem-ui-2' }, {
        nodeEnv: 'development', apiBaseUrl: 'https://mini.invalid', session
      }),
      (error) => error.code === 'UNAUTHORIZED' && !error.message.includes('PRIVATE TOKEN SENTINEL')
    )
    assert.equal(removedAuthSessions, 1)
  } finally {
    globalThis.uni = originalUni
  }
}

async function testAdminPageBehavior() {
  const api = {
    issueCalls: [],
    replaceCalls: [],
    issueImpl: async () => ({
      applicationNo: 'BBA-1', codeId: '7', plaintextCode: 'BOOK-ONE-TIME',
      codeExpiresAt: '2026-09-12T00:00:00.000Z', userId: '42', status: 'issued'
    }),
    statusImpl: async () => ({ status: 'not_found' }),
    replaceImpl: async () => ({
      originalCodeId: '7', replacementCodeId: '8', plaintextCode: 'BOOK-REPLACEMENT',
      codeExpiresAt: '2026-09-13T00:00:00.000Z', applicationId: '6', userId: '42', generationNo: 2, status: 'issued'
    })
  }
  const clipboard = []
  let modalCount = 0
  const globals = {
    checkAdminAuth: async () => ({}),
    deductAdminUserQuota: async () => ({}),
    getAdminApiToken: () => '',
    getAdminHomepageFeatured: async () => ({}),
    getAdminUserEntitlement: async () => ({}),
    grantAdminUserMembership: async () => ({}),
    grantAdminUserQuota: async () => ({}),
    listAdminUserEntitlementTransactions: async () => ({ transactions: [] }),
    getPublicWordFromServer: async () => null,
    saveAdminApiToken: () => '',
    saveAdminHomepageFeatured: async () => ({}),
    saveAdminWordToServer: async () => ({}),
    searchAdminEntitlementUsers: async () => ({ users: [] }),
    searchPublicWordsFromServer: async () => [],
    getBookBenefitCampaign: async () => ({ status: 'active', startsAt: null, endsAt: null }),
    issueBookBenefitCode: async (payload) => { api.issueCalls.push(payload); return api.issueImpl(payload) },
    getBookBenefitIssueStatus: async () => api.statusImpl(),
    replaceBookBenefitCode: async (payload) => { api.replaceCalls.push(payload); return api.replaceImpl(payload) },
    uni: {
      showToast() {},
      showModal(options) { modalCount += 1; options.success({ confirm: true }) },
      setClipboardData(options) { clipboard.push(options.data); options.success() },
      navigateTo() {}
    }
  }
  const { component, source } = loadVueComponent(ADMIN_PAGE_PATH, globals)
  const page = createComponentInstance(component)
  page.adminUnlocked = true
  page.adminApiTokenDraft = 'FAKE_ADMIN_TOKEN'
  page.bookBenefit.campaign = { status: 'active', startsAt: null, endsAt: null }

  await page.submitBookBenefitIssue()
  assert.equal(api.issueCalls.length, 0, 'Issuance must require a selected user')
  page.entitlementManagement.selectedUser = { id: '42', phoneMasked: '138****0000' }
  page.bookBenefit.campaign.status = 'paused'
  assert.equal(page.bookBenefitCanIssue, false)
  page.bookBenefit.campaign.status = 'active'
  page.bookBenefit.form.orderNumber = 'FAKE-ORDER-UI-001'

  let resolveIssue = null
  api.issueImpl = () => new Promise((resolve) => { resolveIssue = resolve })
  const first = page.submitBookBenefitIssue()
  const second = page.submitBookBenefitIssue()
  assert.equal(api.issueCalls.length, 1, 'Double click must issue once')
  const firstOperationId = page.bookBenefit.operationId
  resolveIssue({
    applicationNo: 'BBA-1', codeId: '7', plaintextCode: 'BOOK-ONE-TIME',
    codeExpiresAt: '2026-09-12T00:00:00.000Z', userId: '42', status: 'issued'
  })
  await Promise.all([first, second])
  const issuedPayload = api.issueCalls[0]
  assert.equal(issuedPayload.operationId, firstOperationId)
  assert.equal(issuedPayload.userId, '42')
  assert.equal(issuedPayload.orderClaimType, 'standard')
  assert.equal(issuedPayload.orderNumber, 'FAKE-ORDER-UI-001')
  assert.equal(Object.hasOwn(issuedPayload, 'campaignId'), false)
  assert.equal(page.bookBenefit.result.plaintextCode, 'BOOK-ONE-TIME')
  assert.match(page.bookBenefit.customerReply, /BOOK-ONE-TIME/)
  page.copyBookBenefitText(page.bookBenefit.result.plaintextCode, 'copied')
  page.copyBookBenefitText(page.bookBenefit.customerReply, 'copied')
  assert.equal(clipboard.length, 2)
  page.closeBookBenefitResult()
  assert.equal(page.bookBenefit.result, null)
  assert.equal(page.bookBenefit.customerReply, '')

  page.bookBenefit.form.orderNumber = 'FAKE-ORDER-UI-STALE'
  let resolveStaleIssue = null
  api.issueImpl = () => new Promise((resolve) => { resolveStaleIssue = resolve })
  const staleIssue = page.submitBookBenefitIssue()
  const staleOperationId = page.bookBenefit.operationId
  assert(staleOperationId)
  await page.selectEntitlementUser({ id: '43', phoneMasked: '139****0000' })
  assert.equal(page.bookBenefit.operationId, '')
  resolveStaleIssue({
    applicationNo: 'BBA-STALE', codeId: '70', plaintextCode: 'BOOK-STALE-USER-42',
    codeExpiresAt: '2026-09-12T00:00:00.000Z', userId: '42', status: 'issued'
  })
  await staleIssue
  assert.equal(page.entitlementManagement.selectedUser.id, '43')
  assert.equal(page.bookBenefit.result, null, 'A stale issuance result must not be applied to the newly selected user')
  assert.equal(page.bookBenefit.customerReply, '')
  assert.equal(page.bookBenefit.message, '')
  await page.selectEntitlementUser({ id: '42', phoneMasked: '138****0000' })

  page.bookBenefit.form.orderClaimType = 'manual_exception'
  page.bookBenefit.form.manualExceptionReasonCode = 'customer_service_approved_exception'
  page.bookBenefit.form.sellerVerificationCode = 'unverified'
  page.bookBenefit.operationId = 'manual-operation-1'
  const manualPayload = page.buildBookBenefitIssuePayload()
  assert.equal(manualPayload.manualExceptionReasonCode, 'customer_service_approved_exception')
  assert.equal(Object.hasOwn(manualPayload, 'orderChannel'), false)
  assert.equal(Object.hasOwn(manualPayload, 'orderNumber'), false)

  page.bookBenefit.form.orderClaimType = 'standard'
  page.bookBenefit.form.orderNumber = 'FAKE-ORDER-UI-002'
  page.resetBookBenefitOperation()
  api.issueImpl = async () => { throw { code: 'ADMIN_API_NETWORK_ERROR', statusCode: 0 } }
  await page.submitBookBenefitIssue()
  const uncertainOperationId = page.bookBenefit.operationId
  assert(uncertainOperationId)
  assert.equal(page.bookBenefit.pendingConfirmation, true)

  for (const statusResult of [
    { status: 'not_found' },
    { status: 'issued_plaintext_unavailable', codeId: '7', applicationNo: 'BBA-1' },
    { status: 'replaced', codeId: '7', replacementCodeId: '8' },
    { status: 'inconsistent' }
  ]) {
    page.bookBenefit.operationId = uncertainOperationId
    page.bookBenefit.pendingConfirmation = true
    api.statusImpl = async () => statusResult
    await page.checkBookBenefitIssueStatus()
    if (statusResult.status === 'issued_plaintext_unavailable') {
      assert.equal(page.bookBenefit.message, '兑换码已经生成，但明文无法恢复。')
    }
  }

  page.bookBenefit.statusResult = { status: 'issued_plaintext_unavailable', codeId: '7' }
  api.replaceImpl = async () => new Promise((resolve) => setTimeout(() => resolve({
    originalCodeId: '7', replacementCodeId: '8', plaintextCode: 'BOOK-REPLACEMENT',
    codeExpiresAt: '2026-09-13T00:00:00.000Z', applicationId: '6', userId: '42', generationNo: 2, status: 'issued'
  }), 0))
  const replaceFirst = page.replaceBookBenefitIssue()
  const replaceSecond = page.replaceBookBenefitIssue()
  await Promise.all([replaceFirst, replaceSecond])
  assert.equal(api.replaceCalls.length, 1, 'Double click must replace once')
  assert.equal(modalCount, 1, 'Replacement must require one confirmation')
  assert(api.replaceCalls[0].operationId)
  assert.equal(page.bookBenefit.result.plaintextCode, 'BOOK-REPLACEMENT')

  page.bookBenefit.statusResult = null
  page.bookBenefit.result = {
    applicationNo: 'BBA-1', codeId: '8', plaintextCode: 'BOOK-DELIVERY-FAILED',
    codeExpiresAt: '2026-09-13T00:00:00.000Z'
  }
  page.bookBenefit.customerReply = 'PRIVATE TEMPORARY REPLY'
  await page.replaceBookBenefitIssue('delivery_failed')
  assert.equal(api.replaceCalls[1].reasonCode, 'delivery_failed')
  assert.notEqual(api.replaceCalls[1].operationId, api.replaceCalls[0].operationId)
  assert.equal(page.bookBenefit.customerReply.includes('PRIVATE TEMPORARY REPLY'), false)

  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*(orderNumber|plaintextCode|customerReply)/)
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*(orderNumber|plaintextCode|adminApiToken)/)
}

async function testMiniappPageBehavior() {
  const api = { calls: [], impl: null }
  let clearAuthCount = 0
  const session = {
    token: 'FAKE_USER_JWT', expiresAt: '2099-01-01T00:00:00.000Z',
    user: { id: '42', hasPhoneBinding: true, phoneMasked: '138****0000' }
  }
  const globals = {
    getUserState: () => ({ streakDays: 0 }),
    getAuthSession: () => session,
    clearAuthSession() { clearAuthCount += 1 },
    loginWithWechatPhone: async () => session,
    redeemBookBenefitCode: async (payload) => { api.calls.push(payload); return api.impl(payload) },
    getUserEntitlements: async () => ({
      quotaBalance: 9, quotaTotalGranted: 10, quotaTotalConsumed: 1,
      membershipType: 'monthly', membershipStatus: 'active',
      membershipExpireAt: '2026-09-12T00:00:00.000Z', membershipActive: true
    }),
    listUserFavorites: async () => [],
    listUserRecentWords: async () => [],
    fetchWordById: async () => null,
    getCachedPublishedRemoteWordById: () => null,
    getRecentWords: () => [],
    savePendingWordId() {},
    uni: { showToast() {}, showModal() {}, navigateTo() {}, reLaunch() {} }
  }
  const { component, source } = loadVueComponent(MINI_PAGE_PATH, globals)
  const page = createComponentInstance(component)

  page.authSession = null
  page.bookBenefitCode = 'BOOK-ONE'
  await page.submitBookBenefitRedemption()
  assert.equal(api.calls.length, 0)
  page.authSession = { ...session, user: { ...session.user, hasPhoneBinding: false } }
  await page.submitBookBenefitRedemption()
  assert.equal(api.calls.length, 0)

  page.authSession = session
  page.bookBenefitCode = 'BOOK-ONE'
  let resolveRedeem = null
  api.impl = () => new Promise((resolve) => { resolveRedeem = resolve })
  const first = page.submitBookBenefitRedemption()
  const second = page.submitBookBenefitRedemption()
  assert.equal(api.calls.length, 1, 'Double click must redeem once')
  assert.equal(api.calls[0].code, 'BOOK-ONE')
  assert.equal(api.calls[0].operationId, page.bookBenefitOperationId)
  assert.equal(Object.hasOwn(api.calls[0], 'userId'), false)
  resolveRedeem({
    membershipType: 'monthly', membershipStatus: 'active',
    membershipExpireAt: '2026-09-12T00:00:00.000Z', quotaBalance: 999, idempotent: false
  })
  await Promise.all([first, second])
  assert.equal(page.bookBenefitCode, '')
  assert.equal(page.bookBenefitOperationId, '')
  assert.equal(page.entitlement.quotaBalance, 9, 'Quota must come from entitlement refresh, not local arithmetic')

  page.bookBenefitCode = 'BOOK-TWO'
  api.impl = async () => { throw { code: 'BOOK_BENEFIT_API_NETWORK_ERROR', statusCode: 0 } }
  await page.submitBookBenefitRedemption()
  const pendingOperationId = page.bookBenefitOperationId
  assert(pendingOperationId)
  assert.equal(page.bookBenefitPending, true)
  assert.equal(page.bookBenefitCode, 'BOOK-TWO')
  await page.submitBookBenefitRedemption()
  assert.equal(api.calls.at(-1).operationId, pendingOperationId)
  page.handleBookBenefitCodeInput({ detail: { value: 'BOOK-THREE' } })
  assert.equal(page.bookBenefitOperationId, '')
  assert.equal(page.bookBenefitPending, false)

  for (const statusCode of [401, 403]) {
    page.authSession = session
    page.entitlement = { quotaBalance: 9 }
    page.bookBenefitCode = `BOOK-AUTH-${statusCode}`
    page.bookBenefitOperationId = `auth-operation-${statusCode}`
    page.bookBenefitPending = true
    page.bookBenefitSuccess = { membershipExpireAt: '2026-09-12T00:00:00.000Z' }
    api.impl = async () => { throw { code: statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', statusCode } }
    await page.submitBookBenefitRedemption()
    assert.equal(page.authSession, null)
    assert.equal(page.entitlement, null)
    assert.equal(page.bookBenefitCode, '')
    assert.equal(page.bookBenefitOperationId, '')
    assert.equal(page.bookBenefitPending, false)
    assert.equal(page.bookBenefitSuccess, null)
    assert.equal(page.bookBenefitRedeeming, false)
    assert.match(page.bookBenefitMessage, /重新登录/)
  }
  assert.equal(clearAuthCount, 2)

  assert.equal(page.getBookBenefitRedemptionMessage({ code: 'BOOK_BENEFIT_CODE_REDEEMED' }), '福利码已使用。')
  assert.equal(page.getBookBenefitRedemptionMessage({ code: 'BOOK_BENEFIT_CODE_VOIDED' }), '福利码已作废，请联系官方客服。')
  assert.equal(page.getBookBenefitRedemptionMessage({ code: 'UNKNOWN' }), '服务暂时不可用，请稍后重试。')
  assert.doesNotMatch(source, /(setStorageSync|localStorage\.setItem)[^\n]*(bookBenefitCode|operationId)/)
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*(bookBenefitCode|operationId)/)
}

await testAdminApiClient()
await testMiniappApiClient()
await testAdminPageBehavior()
await testMiniappPageBehavior()

console.log('Book-benefit delivery UI tests passed.')
