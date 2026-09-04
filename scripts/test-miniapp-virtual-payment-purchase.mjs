import assert from 'node:assert/strict'
import { createPurchaseController, EXTRA_PURCHASE_WARNING, recordMessage } from '../miniapp-uni/word-app1/common/virtual-payment-purchase.js'

const clone = (x) => JSON.parse(JSON.stringify(x))
const paymentParams = (orderNo) => ({ mode: 'short_series_goods', signData: JSON.stringify({ env: 1, buyQuantity: 1, currencyType: 'CNY', goodsPrice: 3000, outTradeNo: orderNo }, null, 2), paySig: 'a'.repeat(64), signature: 'b'.repeat(64) })
function harness(overrides = {}) {
  const disk = new Map(), calls = [], confirmations = [], createdOrders = new Map()
  let current = { userId: '42', token: 'jwt', baseUrl: 'https://sandbox.test', environment: 'sandbox' }
  let count = 0, writes = 0
  const order = (n, paymentStatus = 'pending', entitlementStatus = 'not_ready', deliveryStatus = 'not_ready') => ({ orderNo: n, paymentStatus, entitlementStatus, deliveryStatus })
  const api = {
    context: () => ({ ...current }),
    assertContext(owner) { assert.deepEqual(owner, current) },
    async prepare() { calls.push('code'); return 'secret-code' },
    async create(owner, id) { calls.push(['create', id]); if (overrides.createFailure) throw new Error('network'); if (!createdOrders.has(id)) createdOrders.set(id, 'VP' + (++count).toString(16).toUpperCase().padStart(30, '0')); return { ...order(createdOrders.get(id)), paymentParams: paymentParams(createdOrders.get(id)) } },
    async invoke(owner, params) {
      calls.push('invoke')
      const rows = [...disk.values()].flat()
      assert(rows.some((r) => r.orderNo && r.mayHaveInvoked), 'persist possible invocation BEFORE native call')
      assert.equal(params.signData, paymentParams(JSON.parse(params.signData).outTradeNo).signData)
      if (overrides.crashAtInvoke) throw new Error('simulated crash after durable marker')
      return overrides.cancel ? 'cancelled' : 'unknown'
    },
    async get(owner, n) { calls.push('get'); if (overrides.pauseAtGet) controller.pause(); return overrides.getOrder ? overrides.getOrder(n) : order(n) },
    async reconcile(owner, n) { calls.push('reconcile'); return overrides.unpaid ? order(n, 'confirming') : order(n, 'paid') },
    async entitlement(owner, n) { calls.push('entitlement'); if (overrides.grantInterrupted) throw new Error('grant response lost'); return { orderNo: n, paymentStatus: 'paid', entitlementStatus: 'granted', membershipStartedAt: '2026-09-01T00:00:00.000Z', membershipExpiresAt: '2026-10-01T00:00:00.000Z', idempotent: false } },
    async refresh() { calls.push('refresh'); return { membershipActive: true } },
    async delivery(owner, n) { calls.push('delivery'); const status = overrides.delivery || 'confirming'; return { ...order(n, 'paid', 'granted', status), idempotent: false, confirming: status === 'confirming', manualReview: status === 'manual_review', retryable: status === 'retryable_failed' } }
  }
  const storage = { get(key) { return disk.has(key) ? clone(disk.get(key)) : '' }, set(key, value) { writes++; if (overrides.failWrite === writes || overrides.failWrites) throw new Error('disk full'); disk.set(key, clone(value)) } }
  const controller = createPurchaseController({ api, storage, confirm: async (text) => { confirmations.push(text); return overrides.rejectConfirmation !== true },
    onEntitlement: () => calls.push('display-granted') })
  return { controller, api, calls, confirmations, disk, overrides, order, reopen: () => createPurchaseController({ api, storage, confirm: async () => true }), setOwner: (value) => { current = { ...current, ...value } } }
}
// Endpoint contract matrix. Mutations stop at the response boundary: no later calls.
const remove = (field) => (value) => { delete value[field] }
const assign = (field, value) => (response) => { response[field] = value }
const states = ['orderNo', 'paymentStatus', 'entitlementStatus', 'deliveryStatus']
const summaryMutations = states.flatMap((field) => [remove(field), assign(field, null), assign(field, 2), assign(field, 'unknown')])
summaryMutations.push(assign('entitlementStatus', 'granted'), assign('deliveryStatus', 'delivered'))
const entitlementMutations = ['orderNo', 'paymentStatus', 'entitlementStatus', 'membershipStartedAt', 'membershipExpiresAt', 'idempotent'].map(remove)
for (const field of ['membershipStartedAt', 'membershipExpiresAt']) {
  for (const value of [null, 0, {}, '2026-09-01', '2026-09-01T00:00:00Z', '2026-02-30T00:00:00.000Z', 'invalid']) entitlementMutations.push(assign(field, value))
}
entitlementMutations.push(assign('membershipStartedAt', '2026-10-01T00:00:00.000Z'), assign('membershipStartedAt', '2026-10-02T00:00:00.000Z'), assign('paymentStatus', 'pending'), assign('entitlementStatus', 'not_ready'))
for (const value of ['true', 'false', 0, 1, null]) entitlementMutations.push(assign('idempotent', value))
const deliveryMutations = ['orderNo', 'paymentStatus', 'entitlementStatus', 'deliveryStatus'].map(remove)
for (const field of ['idempotent', 'confirming', 'manualReview', 'retryable']) {
  deliveryMutations.push(remove(field))
  for (const value of ['true', 'false', 0, 1, null]) deliveryMutations.push(assign(field, value))
}
deliveryMutations.push(assign('deliveryStatus', 'unknown'), assign('paymentStatus', 'pending'), assign('entitlementStatus', 'not_ready'))
for (const status of ['not_ready', 'pending', 'confirming', 'manual_review', 'retryable_failed', 'delivered']) {
  for (const flag of ['confirming', 'manualReview', 'retryable']) deliveryMutations.push((value) => {
    value.deliveryStatus = status
    value.confirming = status === 'confirming'; value.manualReview = status === 'manual_review'; value.retryable = status === 'retryable_failed'
    value[flag] = !value[flag]
  })
}
const createMutations = [...summaryMutations, remove('paymentParams')]
for (const field of ['mode', 'signData', 'paySig', 'signature']) {
  createMutations.push((value) => { delete value.paymentParams[field] })
  for (const invalid of [null, 1, {}, [], '']) createMutations.push((value) => { value.paymentParams[field] = invalid })
}
const expectedCounts = { create: [0, 0, 0, 0, 0], get: [1, 0, 0, 0, 0], reconcile: [1, 1, 0, 0, 0], entitlement: [1, 1, 1, 0, 0], delivery: [1, 1, 1, 1, 1] }
for (const [endpoint, mutations] of Object.entries({ create: createMutations, get: summaryMutations, reconcile: summaryMutations, entitlement: entitlementMutations, delivery: deliveryMutations })) {
  for (const mutate of mutations) {
    const h = harness({ unpaid: endpoint === 'reconcile' }), original = h.api[endpoint]
    let boundary
    h.api[endpoint] = async (...args) => { const value = await original(...args); mutate(value); boundary = h.calls.slice(); return value }
    await assert.rejects(h.controller.buy(), { code: 'PAYMENT_RESPONSE_INVALID' })
    assert.deepEqual(h.calls, boundary, `${endpoint}: no calls after rejected response`)
    assert.deepEqual(['invoke', 'reconcile', 'entitlement', 'refresh', 'delivery'].map((name) => h.calls.filter((c) => c === name).length), expectedCounts[endpoint])
    const record = h.controller.list()[0]
    if (endpoint === 'create') assert.equal(record.mayHaveInvoked, false)
    if (endpoint !== 'delivery') assert(!['granted', 'delivered', 'manual_review'].includes(record.hint))
    else assert.equal(record.hint, 'granted', 'bad delivery must not undo a previously verified grant or manufacture delivery success')
  }
  console.log(`${endpoint}: ${mutations.length} invalid contracts rejected; invoke/reconcile/entitlement/refresh/delivery=${expectedCounts[endpoint].join('/')}; subsequent calls=0`)
}
for (const delivery of ['delivered', 'confirming', 'manual_review', 'retryable_failed']) {
  const h = harness({ delivery })
  await h.controller.buy()
  assert.equal(h.controller.list()[0].hint, ['delivered', 'manual_review'].includes(delivery) ? delivery : 'granted')
}
{
  const h = harness()
  const first = h.controller.buy(), second = h.controller.buy()
  assert.equal(first, second, 'double click must share exactly one Promise')
  await first
  assert.deepEqual(h.calls.filter((c) => typeof c === 'string'), ['code', 'invoke', 'get', 'reconcile', 'entitlement', 'refresh', 'display-granted', 'delivery'])
  assert.equal(h.controller.list()[0].hint, 'granted')
  assert.equal(recordMessage(h.controller.list()[0]), '会员已到账，订单确认中')
  const serialized = JSON.stringify([...h.disk.values()])
  for (const secret of ['secret-code', 'secret-sign-data', 'secret-pay-sig', 'jwt', 'loginCode', 'paymentParams', 'signature', 'openid', 'provider']) assert(!serialized.includes(secret))
  h.overrides.getOrder = (n) => h.order(n, 'paid', 'granted', 'confirming')
  h.calls.length = 0
  await h.controller.query(h.controller.list()[0].clientRequestId)
  assert.deepEqual(h.calls, ['get', 'refresh', 'display-granted', 'delivery'])
  await h.controller.buy()
  assert.equal(h.controller.list().length, 2, 'granted/confirming does not block renewal')
}
{
  const h = harness({ cancel: true, unpaid: true })
  await h.controller.buy()
  const old = h.controller.list()[0]
  assert(old.mayHaveInvoked)
  assert(!['failed', 'closed', 'paid', 'granted'].includes(old.hint))
  const before = clone(old)
  h.calls.length = 0
  await h.controller.buy(old.clientRequestId)
  assert.deepEqual(h.calls, ['get', 'reconcile'], 'possible invocation can ONLY query, never native retry')
  h.overrides.rejectConfirmation = true
  await h.controller.buy()
  assert.equal(h.confirmations.at(-1), EXTRA_PURCHASE_WARNING)
  assert.equal(h.controller.list().length, 1)
  assert(!h.calls.some((c) => Array.isArray(c)))
  h.overrides.rejectConfirmation = false
  await h.controller.buy()
  const rows = h.controller.list()
  assert.equal(rows.length, 2)
  assert.notEqual(rows[0].clientRequestId, old.clientRequestId)
  assert.notEqual(rows[0].orderNo, old.orderNo)
  assert.equal(rows[1].orderNo, before.orderNo)
  assert.equal(rows[1].hint, before.hint)
}
{
  const h = harness({ createFailure: true })
  await assert.rejects(h.controller.buy())
  const original = h.controller.list()[0]
  assert.equal(original.mayHaveInvoked, false)
  h.overrides.createFailure = false
  await h.controller.buy(original.clientRequestId)
  assert.deepEqual(h.calls.filter(Array.isArray).map((c) => c[1]), [original.clientRequestId, original.clientRequestId])
}
for (const failWrite of [1, 2, 3]) {
  const h = harness({ failWrite })
  await assert.rejects(h.controller.buy())
  assert(!h.calls.includes('invoke'), `storage write ${failWrite} failure cannot reach native payment`)
}
{
  const h = harness({ pauseAtGet: true })
  await h.controller.buy()
  assert(!h.calls.includes('reconcile'))
  assert(!h.calls.includes('entitlement'))
  h.controller.resume()
  const id = h.controller.list()[0].clientRequestId
  h.setOwner({ userId: '43' })
  assert.deepEqual(h.controller.list(), [])
  await assert.rejects(h.controller.query(id))
  h.setOwner({ userId: '42', baseUrl: 'https://another-sandbox.test' })
  assert.deepEqual(h.controller.list(), [])
}
for (const status of ['delivered', 'manual_review']) {
  const h = harness({ getOrder: (n) => ({ orderNo: n, paymentStatus: 'paid', entitlementStatus: 'granted', deliveryStatus: status }) })
  await h.controller.buy()
  assert(!h.calls.includes('entitlement') && !h.calls.includes('reconcile') && !h.calls.includes('delivery'))
  assert.equal(h.controller.list()[0].hint, status)
  await h.controller.buy()
  assert.equal(h.controller.list().length, 2)
}
for (const invalid of [2, 3]) {
  const h = harness({ getOrder: (n) => ({ orderNo: n, paymentStatus: invalid, entitlementStatus: 'not_ready', deliveryStatus: 'not_ready' }) })
  await assert.rejects(h.controller.buy())
  assert(!h.calls.includes('entitlement') && !h.calls.includes('delivery'))
}
{
  const h = harness({ rejectConfirmation: true })
  await h.controller.buy()
  assert.deepEqual(h.calls, [])
  assert.equal(h.disk.size, 0)
}
{
  const h = harness({ crashAtInvoke: true })
  await assert.rejects(h.controller.buy())
  const record = h.controller.list()[0]
  assert.equal(record.mayHaveInvoked, true)
  h.overrides.crashAtInvoke = false
  h.calls.length = 0
  await h.reopen().buy(record.clientRequestId)
  assert(!h.calls.includes('invoke') && !h.calls.some(Array.isArray))
  assert(h.calls.includes('get'))
}
{
  const h = harness({ grantInterrupted: true })
  await assert.rejects(h.controller.buy())
  assert.equal(h.controller.list()[0].hint, 'paid')
  h.overrides.getOrder = (n) => h.order(n, 'paid', 'granted', 'not_ready')
  h.calls.length = 0
  await h.reopen().query(h.controller.list()[0].clientRequestId)
  assert.deepEqual(h.calls, ['get', 'refresh', 'delivery'])
}
{
  const h = harness({ grantInterrupted: true })
  await assert.rejects(h.controller.buy())
  h.overrides.getOrder = (n) => h.order(n, 'paid')
  h.overrides.grantInterrupted = false
  h.calls.length = 0
  await h.controller.query(h.controller.list()[0].clientRequestId)
  assert.deepEqual(h.calls, ['get', 'entitlement', 'refresh', 'display-granted', 'delivery'])
}
console.log('Batch8 purchase, cancellation, explicit additional orders, persistence, resume, grant and lifecycle tests passed.')

// Original review attack: true/false duplicates must never buy the same order twice.
for (const flags of [[false, true], [true, false], [false, true, false]]) {
  const h = harness({ unpaid: true })
  await h.controller.buy()
  const original = h.controller.list()[0], key = [...h.disk.keys()][0]
  h.disk.set(key, flags.map((mayHaveInvoked, index) => ({ ...original, mayHaveInvoked,
    createdAt: original.createdAt - index, updatedAt: original.updatedAt + index })))
  await h.controller.buy(original.clientRequestId)
  const rows = h.controller.list()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].mayHaveInvoked, true)
  assert.equal(rows[0].createdAt, original.createdAt - flags.length + 1)
  assert.equal(h.calls.filter((c) => c === 'invoke').length, 1)
  console.log(`Duplicate ${flags.join('+')}: total native calls=1`)
}
for (const mutation of [
  (r) => ({ ...r, orderNo: 'VP' + 'F'.repeat(30) }),
  (r) => ({ ...r, clientRequestId: 'different-intent' }),
  (r) => ({ ...r, userId: 'other-user' }),
  (r) => ({ ...r, environment: 'production' }),
  (r) => ({ ...r, baseUrl: 'https://other.test' }),
  (r) => ({ ...r, mayHaveInvoked: 'false' })
]) {
  const h = harness({ unpaid: true })
  await h.controller.buy()
  const record = h.controller.list()[0], key = [...h.disk.keys()][0]
  h.disk.set(key, [record, mutation(record)])
  const before = JSON.stringify([...h.disk])
  h.calls.length = 0
  await assert.rejects(h.controller.buy(), { code: 'PAYMENT_RECORDS_INVALID' })
  assert.deepEqual(h.calls, [])
  assert.equal(JSON.stringify([...h.disk]), before)
}
{
  const h = harness({ unpaid: true })
  await h.controller.buy()
  const record = h.controller.list()[0], key = [...h.disk.keys()][0]
  h.disk.set(key, [{ ...record, mayHaveInvoked: false }, record])
  h.overrides.failWrites = true
  h.calls.length = 0
  await assert.rejects(h.controller.buy(record.clientRequestId), { code: 'PAYMENT_STORAGE_FAILED' })
  assert.deepEqual(h.calls, [])
  assert.equal(h.disk.get(key).length, 2)
}
for (const invalid of [undefined, null, 2, 'unknown', {}, 'pending']) {
  const h = harness({ unpaid: true })
  await h.controller.buy()
  const record = h.controller.list()[0]
  // pending delivery with ungranted entitlement is also contradictory.
  h.overrides.getOrder = (n) => ({ orderNo: n, paymentStatus: 'paid',
    entitlementStatus: invalid === 'pending' ? 'not_ready' : 'granted', deliveryStatus: invalid })
  h.calls.length = 0
  await assert.rejects(h.controller.query(record.clientRequestId), { code: 'PAYMENT_RESPONSE_INVALID' })
  assert.deepEqual(h.calls, ['get'], 'bad GET: reconcile/entitlement/refresh/delivery all zero')
  assert.equal(h.controller.list()[0].hint, record.hint)
}
for (const endpoint of ['create', 'reconcile', 'entitlement', 'delivery']) {
  const h = harness()
  const original = h.api[endpoint]
  h.api[endpoint] = async (...args) => {
    const response = await original(...args)
    delete response[endpoint === 'entitlement' ? 'entitlementStatus' : 'deliveryStatus']
    return response
  }
  await assert.rejects(h.controller.buy(), { code: 'PAYMENT_RESPONSE_INVALID' })
  if (endpoint === 'create') assert(!h.calls.includes('invoke'))
  if (endpoint === 'reconcile') assert(!h.calls.includes('entitlement'))
  if (endpoint === 'entitlement') assert(!h.calls.includes('refresh') && !h.calls.includes('delivery'))
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
{
  const h = harness({ unpaid: true })
  await h.controller.buy()
  const record = h.controller.list()[0], oldGet = deferred(), newGet = deferred()
  h.calls.length = 0
  h.overrides.getOrder = () => oldGet.promise
  const old = h.controller.query(record.clientRequestId)
  await Promise.resolve()
  h.controller.pause()
  h.controller.resume()
  h.overrides.getOrder = () => newGet.promise
  const current = h.controller.query(record.clientRequestId)
  await Promise.resolve()
  oldGet.resolve(h.order(record.orderNo))
  await old
  assert.deepEqual(h.calls, ['get', 'get'], 'old GET cannot reconcile after resume')
  assert.equal(h.controller.query(record.clientRequestId), current, 'old finally cannot release new lock')
  newGet.resolve(h.order(record.orderNo))
  await current
  assert.deepEqual(h.calls, ['get', 'get', 'reconcile'])
  const late = deferred()
  h.overrides.getOrder = () => late.promise
  const pending = h.controller.query(record.clientRequestId)
  await Promise.resolve()
  h.controller.dispose()
  h.controller.resume()
  const disk = JSON.stringify([...h.disk])
  late.resolve(h.order(record.orderNo, 'paid', 'granted', 'delivered'))
  await pending
  assert.equal(JSON.stringify([...h.disk]), disk)
  const count = h.calls.length
  await h.controller.query(record.clientRequestId)
  assert.equal(h.calls.length, count, 'disposed controller cannot resume')
}
for (const result of ['unknown', 'cancelled']) {
  const h = harness(), late = deferred()
  h.api.invoke = async () => { h.calls.push('invoke'); return late.promise }
  const purchase = h.controller.buy()
  while (!h.calls.includes('invoke')) await Promise.resolve()
  h.controller.pause(); h.controller.resume()
  const before = JSON.stringify([...h.disk])
  late.resolve(result)
  await purchase
  assert(!h.calls.includes('get'))
  assert.equal(JSON.stringify([...h.disk]), before)
  assert.equal(h.controller.list()[0].mayHaveInvoked, true)
}
console.log('Review fixtures: duplicates/conflicts, per-endpoint states, missing deliveryStatus (all downstream=0), epochs and late callbacks passed.')

{
  const h = harness({ unpaid: true })
  await h.controller.buy()
  const record = h.controller.list()[0], key = [...h.disk.keys()][0]
  h.disk.set(key, [{ ...record, orderNo: '', mayHaveInvoked: false }, record])
  assert.equal(h.controller.list()[0].orderNo, record.orderNo)
  assert.equal(h.controller.list()[0].mayHaveInvoked, true)
  await h.controller.buy(record.clientRequestId)
  assert.equal(h.calls.filter((c) => c === 'invoke').length, 1)
}
for (const endpoint of ['prepare', 'create', 'entitlement', 'refresh', 'delivery']) {
  const h = harness(), late = deferred(), original = h.api[endpoint]
  let response, waiting = false
  h.api[endpoint] = async (...args) => { response = await original(...args); waiting = true; return late.promise }
  const operation = h.controller.buy()
  while (!waiting) await Promise.resolve()
  h.controller.pause(); h.controller.resume()
  const snapshot = JSON.stringify([...h.disk]), count = h.calls.length
  late.resolve(response)
  await operation
  assert.equal(h.calls.length, count, `${endpoint}: no downstream action from old epoch`)
  assert.equal(JSON.stringify([...h.disk]), snapshot, `${endpoint}: no stale persistence`)
}
