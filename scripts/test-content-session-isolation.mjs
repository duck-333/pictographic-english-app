import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const storage = new Map()
const requests = []
globalThis.uni = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  request(options) { requests.push(options); return { abort() {} } }
}
const auth = await import('../miniapp-uni/word-app1/common/auth-store.js')
const repository = await import('../miniapp-uni/word-app1/common/word-repository.js')
const publicWords = await import('../miniapp-uni/word-app1/common/public-word.js')
const bookClient = await import('../miniapp-uni/word-app1/common/book-benefit-api-client.js')
const full = {
  id: 'word-security', word: 'security', status: 'published', meaning: '安全',
  parts: [{ text: 'private' }], pictograph: 'private explanation', intro: 'private intro',
  illustrationImage: { url: 'https://fixture.invalid/private.png' },
  access: { level: 'full', canAccessFull: true, charged: true }
}
function session(id, token = id, ttl = 60000) {
  return { user: { id, hasPhoneBinding: true }, token, expiresAt: new Date(Date.now() + ttl).toISOString() }
}
function respond(request, word = full, statusCode = 200) {
  request.success({ statusCode, data: { ok: statusCode === 200, word, access: word.access }, header: {} })
}
function noFull(word) {
  assert.equal(word.access.canAccessFull, false)
  for (const field of ['parts', 'pictograph', 'intro', 'illustrationImage', 'videoClips']) assert.equal(Object.hasOwn(word, field), false)
}

// Execute the actual Vue page script with native UI side effects stubbed.
const source = await readFile(new URL('../miniapp-uni/word-app1/pages/word-detail/index.vue', import.meta.url), 'utf8')
const script = source.split('<script>')[1].split('</script>')[0]
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\r?\n/gm, '')
  .replace('export default', 'return')
const definition = new Function('dependencies', `with (dependencies) { ${script} }`)({
  ...auth, ...repository, ...publicWords, BottomNav: {}, getPendingWordId: () => '',
  recordLearningActivity() {}, addRecentWord() {}, recordUserRecentWord: async () => {},
  listUserFavorites: async () => []
})
const page = definition.data()
Object.entries(definition.methods).forEach(([name, method]) => { page[name] = method.bind(page) })
page.resetWordViewState = () => {}
page.stopPronunciationAudio = () => {}
page.clearClipPlaybackTimer = () => {}
page.destroyPronunciationAudio = () => {}
page.recordRecentWordView = () => {}
page.refreshFavoriteState = () => {}
const load = page.loadWord
page.loadWord = (options) => { page.lastLoad = load(options); return page.lastLoad }

try {
  auth.saveAuthSession(session('A'))
  definition.onLoad.call(page, { id: full.id })
  const firstRequestId = requests.at(-1).header['X-Client-Request-Id']
  respond(requests.at(-1))
  await page.lastLoad
  assert.equal(page.word.pictograph, full.pictograph)
  noFull(repository.getCachedPublishedRemoteWordById(full.id))
  noFull(repository.getWordById(full.id))

  // Same-account renewal accepts the in-flight reply and retains the access ID.
  const renewalLoad = page.loadWord({ id: full.id })
  const renewalRequest = requests.at(-1)
  auth.saveAuthSession(session('A', 'renewed-token'))
  assert.equal(page.wordAccessClientRequestId, firstRequestId)
  respond(renewalRequest)
  await renewalLoad
  assert.equal(page.word.access.canAccessFull, true)

  auth.clearAuthSession()
  noFull(page.word)
  assert.equal(repository.getCachedPublishedRemoteWordById(full.id), null)
  auth.saveAuthSession(session('A'))
  const logoutLoad = page.loadWord({ id: full.id })
  const logoutRequest = requests.at(-1)
  auth.clearAuthSession()
  auth.saveAuthSession(session('A'))
  respond(logoutRequest)
  await logoutLoad
  assert.equal(page.word, null)
  assert.equal(repository.getCachedPublishedRemoteWordById(full.id), null)

  const switchLoad = page.loadWord({ id: full.id })
  const switchRequest = requests.at(-1)
  auth.saveAuthSession(session('B'))
  respond(switchRequest)
  await switchLoad
  assert.equal(page.word, null)
  assert.equal(repository.getCachedPublishedRemoteWordById(full.id), null)

  const authorizedLoad = page.loadWord({ id: full.id })
  respond(requests.at(-1))
  await authorizedLoad
  assert.equal(page.word.access.canAccessFull, true)
  auth.saveAuthSession(session('B', 'short-session', 30))
  await new Promise((resolve) => setTimeout(resolve, 60))
  noFull(page.word)
  assert.equal(auth.getAuthSession(), null)

  // A public endpoint returning unexpected full fields cannot promote the cache.
  const search = repository.fetchWords('security')
  requests.at(-1).success({ statusCode: 200, data: { ok: true, words: [full] } })
  noFull((await search)[0])
  noFull(repository.getCachedPublishedRemoteWordById(full.id))

  auth.saveAuthSession(session('C'))
  const deniedLoad = page.loadWord({ id: full.id })
  respond(requests.at(-1), full, 401)
  await deniedLoad
  assert.equal(auth.getAuthSession(), null)
  assert.equal(page.word, null)

  const mineSource = await readFile(new URL('../miniapp-uni/word-app1/pages/mine/index.vue', import.meta.url), 'utf8')
  const mineScript = mineSource.split('<script>')[1].split('</script>')[0]
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"]\r?\n/gm, '').replace('export default', 'return')
  const mineDefinition = new Function('dependencies', `with (dependencies) { ${mineScript} }`)({
    ...auth, ...bookClient, BottomNav: {}, getUserState: () => ({})
  })
  const mine = mineDefinition.data()
  Object.entries(mineDefinition.methods).forEach(([name, method]) => { mine[name] = method.bind(mine) })
  Object.entries(mineDefinition.computed).forEach(([name, getter]) => { Object.defineProperty(mine, name, { get: getter.bind(mine) }) })
  mine.refreshUserEntitlement = async () => { throw new Error('A stale success must not refresh the new account.') }
  async function staleBookReply(changeSession, statusCode) {
    auth.saveAuthSession(session('book-A'))
    mine.authSession = auth.getAuthSession()
    mine.bookBenefitCode = 'OWN-TEST-CODE'
    mine.bookBenefitOperationId = 'book-access-1'
    const pending = mine.submitBookBenefitRedemption()
    const request = requests.at(-1)
    changeSession()
    mine.authSession = auth.getAuthSession()
    const requestId = page.wordAccessClientRequestId
    request.success({ statusCode, data: { ok: statusCode === 200, code: 'UNAUTHORIZED' } })
    await pending
    assert.ok(auth.getAuthSession(), 'A stale book reply must not log out the current account.')
    assert.equal(mine.authSession.token, auth.getAuthSession().token)
    assert.equal(page.wordAccessClientRequestId, requestId, 'A stale denial must not reset detail access IDs.')
  }
  await staleBookReply(() => auth.saveAuthSession(session('book-B')), 401)
  await staleBookReply(() => auth.saveAuthSession(session('book-A', 'renewed-book-token')), 403)
  await staleBookReply(() => { auth.clearAuthSession(); auth.saveAuthSession(session('book-A')) }, 401)
  await staleBookReply(() => auth.saveAuthSession(session('book-B')), 200)
} finally {
  definition.onUnload.call(page)
  auth.clearAuthSession()
  delete globalThis.uni
}
console.log('Actual detail/mine scripts: public cache, logout, account switch, relogin race, renewal ID, expiration/401 and stale book replies passed (native UI stubbed).')
