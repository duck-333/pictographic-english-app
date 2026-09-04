import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const root = new URL('../miniapp-uni/word-app1/', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const pages = JSON.parse(await read('pages.json'))
assert.equal(pages.pages[0].path, 'pages/index/index', 'home route must remain first')
assert.equal(pages.pages.filter((p) => p.path === 'pages/learning-benefits/index').length, 1)
const benefits = await read('pages/learning-benefits/index.vue')
const mine = await read('pages/mine/index.vue')
const detail = await read('pages/word-detail/index.vue')
for (const text of ['购买30天会员', '¥30.00', '一次性购买，非自动续费', '会员期间不限学习次数', '购买后顺延30天', '查询上次购买结果', '仍要另购30天会员']) assert(benefits.includes(text))
assert(!benefits.includes('邀请'))
assert(benefits.includes('uni.showModal') && benefits.includes('result.confirm === true'))
assert(benefits.includes('this.purchase.pause()'))
assert(benefits.includes(':disabled="busy || !purchaseAllowed"'))
assert(mine.includes('openLearningBenefits') && mine.includes('兑换30天学习权益'))
assert(detail.includes("uni.navigateTo({ url: '/pages/learning-benefits/index' })"))
assert(detail.includes('refreshAccessOnReturn') && detail.includes('this.wordAccessClientRequestId = createWordDetailClientRequestId()'))
for (const [name, source] of [['benefits', benefits], ['mine', mine], ['detail', detail]]) {
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' })
  assert.equal(checked.status, 0, `${name}: ${checked.stderr}`)
}
assert((await read('main.js')).includes("import Vue from 'vue'"))
// Execute the page's actual script methods/lifecycle, without a browser or real API.
const script = benefits.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/from '([^']+)'/g, (_, path) => `from '${new URL(path, new URL('pages/learning-benefits/index.vue', root)).href}'`)
const component = (await import(`data:text/javascript,${encodeURIComponent(script)}`)).default
const page = component.data()
for (const [name, fn] of Object.entries(component.methods)) page[name] = fn.bind(page)
for (const [name, fn] of Object.entries(component.computed)) Object.defineProperty(page, name, { get: () => fn.call(page) })
page.records = [{ hint: 'granted' }, { hint: 'unknown' }]
assert.equal(page.pendingRecord.hint, 'unknown')
page.records = [{ hint: 'granted' }, { hint: 'manual_review' }]
assert.equal(page.pendingRecord, null, 'delayed delivery must not disable new purchase')
let pauses = 0, disposals = 0, operations = 0, reloads = 0, release
page.purchase = { pause() { pauses++ }, dispose() { disposals++ }, list: () => { reloads++; return [] } }
const pending = page.run(() => { operations++; return new Promise((resolve) => { release = resolve }) })
await page.run(() => { operations++ })
assert.equal(operations, 1)
release()
await pending
assert.equal(page.busy, false)
for (const fail of [false, true]) {
  page.pageDisposed = false; page.pageVisible = true
  let finish
  const old = page.run(() => new Promise((resolve, reject) => { finish = fail ? reject : resolve }))
  component.onHide.call(page)
  component.onUnload.call(page)
  const snapshot = JSON.stringify({ busy: page.busy, message: page.message, records: page.records, entitlement: page.entitlement })
  const count = reloads
  finish(new Error('late response must not appear'))
  await old
  assert.equal(reloads, count)
  assert.equal(JSON.stringify({ busy: page.busy, message: page.message, records: page.records, entitlement: page.entitlement }), snapshot)
  page.reloadRecords()
  assert.equal(reloads, count)
  component.onShow.call(page)
  assert.equal(page.pageVisible, false, 'unloaded page cannot resume')
  page.busy = false
}
assert.equal(pauses, 2)
assert.equal(disposals, 2)
// A hidden old run may finish after a new visible run without clearing its busy flag.
page.pageDisposed = false; page.pageVisible = true
let finishOld, finishNew
const old = page.run(() => new Promise((resolve) => { finishOld = resolve }))
component.onHide.call(page)
page.pageVisible = true; page.busy = false
const current = page.run(() => new Promise((resolve) => { finishNew = resolve }))
finishOld(); await old
assert.equal(page.busy, true)
finishNew(); await current
assert.equal(page.busy, false)
console.log('Batch8 routes, page contracts and Vue script syntax passed (not a full uni-app build).')

assert(benefits.includes('加载更多') && benefits.includes('重新查找购买记录'))
{
  page.pageDisposed = false; page.pageVisible = true; page.busy = false
  const cursors = []
  page.purchase.discover = async (cursor) => { cursors.push(cursor); return { ok: true, orders: [], nextCursor: cursor === null ? 'next-fixture' : null } }
  await page.discover()
  assert.deepEqual(cursors, [null]); assert.equal(page.nextCursor, 'next-fixture')
  await page.discover(page.nextCursor)
  assert.deepEqual(cursors, [null, 'next-fixture']); assert.equal(page.nextCursor, null)
  let finish
  page.purchase.discover = () => new Promise((resolve) => { finish = resolve })
  const old = page.discover()
  component.onUnload.call(page)
  const snapshot = JSON.stringify({ nextCursor: page.nextCursor, discoveryFailed: page.discoveryFailed, records: page.records, busy: page.busy })
  finish({ nextCursor: 'late' }); await old
  assert.equal(JSON.stringify({ nextCursor: page.nextCursor, discoveryFailed: page.discoveryFailed, records: page.records, busy: page.busy }), snapshot)
}
console.log('Recovery page: manual pagination and unloaded discovery responses passed.')

{
  const entry = component.data(), savedUni = globalThis.uni
  globalThis.uni = { getStorageSync: () => ({ token: 'fixture', expiresAt: '2099-01-01', user: { id: '42', hasWechatBinding: true } }) }
  for (const [name, fn] of Object.entries(component.methods)) entry[name] = fn.bind(entry)
  let finish, refreshPromise, discoveryCount = 0, purchases = 0
  entry.purchase = { resume() {}, list: () => [], api: { context: () => ({}), refresh: async () => ({ membershipActive: true }) },
    discover: () => { discoveryCount++; return new Promise((resolve) => { finish = resolve }) }, buy: () => { purchases++ } }
  entry.refresh = () => { refreshPromise = component.methods.refresh.call(entry); return refreshPromise }
  try {
    component.onShow.call(entry)
    assert.equal(discoveryCount, 1); assert.equal(entry.busy, true)
    await entry.buy(); assert.equal(purchases, 0)
    finish({ ok: true, orders: [], nextCursor: null }); await refreshPromise
    assert.equal(discoveryCount, 1, 'entry does not poll or auto-load another page')
    assert.equal(entry.busy, false); assert.equal(entry.discoveryFailed, false)
    assert.equal(entry.entitlement.membershipActive, true)
  } finally { globalThis.uni = savedUni }
}
