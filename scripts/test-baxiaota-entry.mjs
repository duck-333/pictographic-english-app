import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Execute the actual Vue2 component methods, with deterministic native events
// and timers. This does not replace device tests for hit-testing and scrolling.
const source = readFileSync(new URL('../miniapp-uni/word-app1/components/BaxiaotaEntry.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace('export default', 'globalThis.component =')
function harness(saved) {
  const calls = { writes: [], navigation: [], loading: 0, hidden: 0, toasts: [] }
  const ticks = [], measurements = [], timers = new Map()
  let nextId = 0, keyboard, removed = false
  const context = vm.createContext({
    uni: {
      getStorageSync: () => saved,
      setStorageSync: (...args) => calls.writes.push(args),
      onKeyboardHeightChange: fn => { keyboard = fn },
      offKeyboardHeightChange: fn => { assert.equal(fn, keyboard); removed = true },
      createSelectorQuery: () => {
        const query = { in: () => query, select: () => query,
          boundingClientRect: fn => { query.callback = fn; return query },
          exec: () => measurements.push(query.callback) }
        return query
      },
      showLoading: () => calls.loading++, hideLoading: () => calls.hidden++,
      navigateTo: options => calls.navigation.push(options),
      showToast: options => calls.toasts.push(options)
    },
    setTimeout: fn => { const id = ++nextId; timers.set(id, fn); return id },
    clearTimeout: id => timers.delete(id)
  })
  vm.runInContext(script, context)
  const component = context.component
  const instance = { ...component.data(), active: true, searchFocused: false,
    bounds: { width: 390, bottom: 680 }, $nextTick: fn => ticks.push(fn) }
  for (const [key, fn] of Object.entries(component.methods)) instance[key] = fn.bind(instance)
  for (const [key, get] of Object.entries(component.computed)) Object.defineProperty(instance, key, { get: get.bind(instance) })
  component.mounted.call(instance)
  const flush = () => {
    while (ticks.length) ticks.shift()()
    while (measurements.length) measurements.shift()({ width: 366, height: 664 })
    for (const [id, fn] of timers) { timers.delete(id); fn() }
  }
  // Model Vue watcher dispatch explicitly; no Vue runtime or native layout is simulated.
  const update = mutate => {
    const visible = instance.visible, active = instance.active
    mutate()
    if (active !== instance.active) component.watch.active.call(instance, instance.active)
    if (visible !== instance.visible) component.watch.visible.call(instance, instance.visible)
  }
  flush()
  return { instance, calls, keyboard: height => update(() => keyboard({ height })),
    update, flush,
    destroy: () => { component.beforeDestroy.call(instance); assert.equal(removed, true) },
    changeBounds: bounds => { instance.bounds = bounds; component.watch.bounds.call(instance) }
  }
}
const point = (clientX, clientY) => ({ clientX, clientY })
function gesture(h, dx, dy) {
  const c = h.instance
  c.onTouchStart({ touches: [point(0, 0)] })
  c.onTouchMove({ touches: [point(dx, dy)] })
  c.onPositionChange({ detail: { x: c.x + dx, y: c.y + dy, source: 'touch' } })
  c.onTouchEnd({ changedTouches: [point(dx, dy)] })
}

const h = harness(), c = h.instance
assert.equal(c.x, 286)
assert.equal(c.y, 554)
assert.equal(c.visible, true)
gesture(h, -240, -130)
assert.equal(h.calls.writes.length, 0, 'moving must not write storage')
c.openGame()
assert.equal(h.calls.navigation.length, 0, 'drag release must not navigate')
h.flush()
assert.equal(c.x, 0)
assert.equal(c.y, 424)
assert.equal(h.calls.writes.length, 1)
c.openGame()
assert.equal(h.calls.navigation.length, 0, 'delayed tap after drag remains suppressed')
gesture(h, 0, 0)
c.openGame(); c.openGame()
assert.equal(h.calls.navigation.length, 1, 'repeat taps cannot stack pages')
assert.equal(h.calls.navigation[0].url, '/game-baxiaota/pages/index')
h.calls.navigation[0].fail(); h.calls.navigation[0].complete()
assert.equal(c.opening, false)
assert.equal(h.calls.hidden, 1)
assert.equal(h.calls.toasts.length, 1)
h.flush()

const restored = harness(h.calls.writes[0][1])
restored.changeBounds({ width: 320, bottom: 500 })
assert.equal(restored.instance.x, 0)
assert.ok(Math.abs(restored.instance.y - 424 / 554 * 374) < 0.001)
gesture(restored, 9999, 9999); restored.flush()
assert.equal(restored.instance.x, 216)
assert.equal(restored.instance.y, 374)
const threshold = harness()
gesture(threshold, -6, 0); threshold.instance.openGame()
assert.equal(threshold.calls.navigation.length, 1, '6px is still a click')
const over = harness()
gesture(over, -6.1, 0); over.flush(); over.instance.openGame()
assert.equal(over.calls.navigation.length, 0, 'over 6px is a drag')
const outAndBack = harness()
outAndBack.instance.onTouchStart({ touches: [point(0, 0)] })
outAndBack.instance.onTouchMove({ touches: [point(20, 0)] })
outAndBack.instance.onTouchEnd({ changedTouches: [point(0, 0)] })
outAndBack.flush(); outAndBack.instance.openGame()
assert.equal(outAndBack.calls.navigation.length, 0)
const cancel = harness()
cancel.instance.onTouchStart({ touches: [point(0, 0)] })
cancel.instance.onTouchCancel(); cancel.flush(); cancel.instance.openGame()
assert.equal(cancel.calls.navigation.length, 0)
h.keyboard(250); assert.equal(c.visible, false)
h.keyboard(0); assert.equal(c.visible, true)
h.update(() => { c.searchFocused = true }); assert.equal(c.visible, false)
assert.equal(c.positionReady, false); assert.equal(c.touching, false)
h.update(() => { c.searchFocused = false }); h.flush()
assert.equal(c.visible, true); assert.equal(c.positionReady, true)
h.update(() => { c.active = false }); assert.equal(c.visible, false)
h.update(() => { c.active = true }); h.flush()
assert.equal(c.visible, true); assert.equal(c.positionReady, true); assert.equal(c.opening, false)
for (const multiAtStart of [true, false]) {
  const multi = harness(), entry = multi.instance
  entry.onTouchStart({ touches: multiAtStart ? [point(0, 0), point(1, 1)] : [point(0, 0)] })
  if (!multiAtStart) entry.onTouchMove({ touches: [point(0, 0), point(1, 1)] })
  entry.onTouchEnd({ changedTouches: [point(0, 0)] })
  multi.flush(); entry.openGame()
  assert.equal(multi.calls.navigation.length, 0, 'two touches at start or during movement suppress tap')
  gesture(multi, 0, 0); entry.openGame()
  assert.equal(multi.calls.navigation.length, 1, 'next independent single-touch tap recovers')
}
const keyboardWatch = harness()
keyboardWatch.instance.onTouchStart({ touches: [point(0, 0)] })
keyboardWatch.keyboard(250)
assert.equal(keyboardWatch.instance.positionReady, false)
assert.equal(keyboardWatch.instance.touching, false)
keyboardWatch.keyboard(0); keyboardWatch.flush()
assert.equal(keyboardWatch.instance.visible, true)
assert.equal(keyboardWatch.instance.positionReady, true)
const disposed = harness()
gesture(disposed, -60, -40); disposed.destroy(); disposed.flush()
assert.equal(disposed.calls.writes.length, 0, 'destroy before nextTick must cancel pending save')
const malformed = harness({ side: 'left', ratio: 'bad' })
assert.equal(malformed.instance.x, 286)

// Actual homepage methods/lifecycle; selector exec only queues callbacks.
// Tests choose nextTick execution and native response order independently.
const pageSource = readFileSync(new URL('../miniapp-uni/word-app1/pages/index/index.vue', import.meta.url), 'utf8')
const pageScript = pageSource.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  .replace('export default', 'globalThis.page =')
function pageHarness() {
  const ticks = [], responses = [], business = [], timers = new Map()
  let timerId = 0
  let info = { windowWidth: 390, windowHeight: 700 }
  const context = vm.createContext({ BottomNav: {}, BaxiaotaEntry: {}, getUserState: () => ({}),
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id },
    clearTimeout: id => timers.delete(id), uni: {
      getWindowInfo: () => ({ ...info }),
      createSelectorQuery: () => {
        const q = { in: () => q, select: () => q,
          boundingClientRect: cb => { q.cb = cb; return q }, exec: () => responses.push(q.cb) }
        return q
      }
    }
  })
  vm.runInContext(pageScript, context)
  const page = context.page
  const instance = { ...page.data(), $refs: { bottomNav: {} }, $nextTick: cb => ticks.push(cb) }
  for (const [key, fn] of Object.entries(page.methods)) instance[key] = fn.bind(instance)
  instance.refreshUserData = () => business.push('refreshUserData')
  instance.loadTodayWord = () => business.push('loadTodayWord')
  return { instance, ticks, responses, business,
    flushTimers: () => { for (const [id, fn] of timers) { timers.delete(id); fn() } },
    lifecycle: name => page[name].call(instance),
    window: value => { info = value },
    tick: (index = 0) => ticks.splice(index, 1)[0](),
    reply: (index, top) => responses[index]({ top }) }
}
const race = pageHarness()
race.lifecycle('onShow'); race.tick()
race.window({ windowWidth: 320, windowHeight: 500 })
race.lifecycle('onResize'); race.tick()
race.reply(1, 480); race.reply(0, 680)
assert.equal(race.instance.gameEntryBounds.width, 320)
assert.equal(race.instance.gameEntryBounds.bottom, 480, 'old response cannot overwrite newer boundary')
assert.deepEqual(race.business, ['refreshUserData', 'loadTodayWord'])
const hidden = pageHarness()
hidden.lifecycle('onShow'); hidden.tick(); hidden.lifecycle('onHide')
hidden.reply(0, 650)
assert.equal(hidden.instance.gameEntryBounds.bottom, 0)
hidden.lifecycle('onShow'); hidden.tick(); hidden.reply(1, 600); hidden.reply(0, 680)
assert.equal(hidden.instance.gameEntryBounds.bottom, 600, 'pre-hide response stays stale after show')
const unloaded = pageHarness()
unloaded.lifecycle('onShow'); unloaded.tick(); unloaded.lifecycle('onUnload'); unloaded.reply(0, 680)
assert.equal(unloaded.instance.gameEntryBounds.bottom, 0)
assert.equal(unloaded.instance.gameEntryActive, false)
const delayed = pageHarness()
delayed.lifecycle('onShow'); delayed.lifecycle('onResize')
delayed.tick(1); delayed.reply(0, 620); delayed.tick(0)
assert.equal(delayed.responses.length, 1, 'old nextTick must not acquire a new request id')
assert.equal(delayed.instance.gameEntryBounds.bottom, 620)
for (const lifecycle of ['onHide', 'onUnload']) {
  const pending = pageHarness()
  pending.lifecycle('onShow'); pending.lifecycle(lifecycle); pending.tick()
  assert.equal(pending.responses.length, 0, `${lifecycle} invalidates queued nextTick`)
}
const clamped = pageHarness()
clamped.lifecycle('onShow'); clamped.tick(); clamped.reply(0, 999)
assert.equal(clamped.instance.gameEntryBounds.bottom, 700, 'window clamp preserved')
clamped.instance.handleSearchFocus()
assert.equal(clamped.instance.focused, true)
const searchEntry = harness()
searchEntry.instance.onTouchStart({ touches: [point(0, 0)] })
searchEntry.update(() => { searchEntry.instance.searchFocused = clamped.instance.focused })
assert.equal(searchEntry.instance.visible, false)
assert.equal(searchEntry.instance.touching, false)
assert.equal(searchEntry.instance.positionReady, false)
clamped.instance.handleSearchBlur(); clamped.flushTimers()
assert.equal(clamped.instance.focused, false)
assert.equal(clamped.instance.searchPanelOpen, false)
searchEntry.update(() => { searchEntry.instance.searchFocused = clamped.instance.focused })
searchEntry.flush()
assert.equal(searchEntry.instance.visible, true)
assert.equal(searchEntry.instance.positionReady, true)
// Homepage lifecycle -> component active watcher, including enter lock reset.
const lifecycleEntry = harness()
lifecycleEntry.instance.opening = true
clamped.lifecycle('onHide')
lifecycleEntry.update(() => { lifecycleEntry.instance.active = clamped.instance.gameEntryActive })
assert.equal(lifecycleEntry.instance.visible, false)
clamped.lifecycle('onShow')
lifecycleEntry.update(() => { lifecycleEntry.instance.active = clamped.instance.gameEntryActive })
lifecycleEntry.flush()
assert.equal(lifecycleEntry.instance.positionReady, true)
assert.equal(lifecycleEntry.instance.opening, false)

const navigationSource = readFileSync(new URL('../miniapp-uni/word-app1/game-baxiaota/common/navigation.js', import.meta.url), 'utf8')
const { returnToSearchHome } = await import(`data:text/javascript;base64,${Buffer.from(navigationSource).toString('base64')}`)
const navCalls = []
globalThis.uni = {
  navigateBack: options => { navCalls.push(['back', options.delta]); options.success() },
  reLaunch: options => { navCalls.push(['home', options.url]); options.success() }
}
globalThis.getCurrentPages = () => [{ route: 'pages/index/index' }, { route: 'other' }, { route: 'game-baxiaota/pages/index' }]
await returnToSearchHome()
assert.deepEqual(navCalls.pop(), ['back', 2])
globalThis.getCurrentPages = () => [{ route: 'game-baxiaota/pages/index' }]
await returnToSearchHome()
assert.deepEqual(navCalls.pop(), ['home', '/pages/index/index'])
globalThis.getCurrentPages = () => [{ route: 'pages/index/index' }]
await returnToSearchHome(); assert.equal(navCalls.length, 0)
globalThis.getCurrentPages = () => [{ route: 'other' }]
globalThis.uni.reLaunch = options => options.fail(new Error('navigation failed'))
await assert.rejects(returnToSearchHome(), /navigation failed/)
delete globalThis.uni; delete globalThis.getCurrentPages
console.log('Baxiaota entry, asynchronous homepage measurement, watcher/lifecycle and home navigation tests passed (native touch/scroll still requires device validation).')
