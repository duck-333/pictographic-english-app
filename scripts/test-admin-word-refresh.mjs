import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

import { normalizeWordRecord } from '../miniapp-uni/word-app1/common/content-schema.js'

const ADMIN_PAGE_PATH = new URL('../admin-portal/pictographic-admin/pages/index/index.vue', import.meta.url)

function loadVueComponent(globals = {}) {
  const source = fs.readFileSync(ADMIN_PAGE_PATH, 'utf8')
  const scriptMatch = source.match(/<script>\s*([\s\S]*?)<\/script>/)
  assert(scriptMatch, 'Admin page must contain a script block')
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
    ...globals
  })
  new vm.Script(script, { filename: ADMIN_PAGE_PATH.pathname }).runInContext(context)
  return context.__component
}

function createHarness(options = {}) {
  const storage = { ...(options.storage || {}) }
  const modals = []
  const toasts = []
  const saveCalls = []
  let listCalls = 0
  let writeCalls = 0
  const uni = {
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) {
      writeCalls += 1
      if (typeof options.failStorageWrite === 'function' && options.failStorageWrite({ key, value, writeCalls })) {
        throw new Error('Simulated storage write failure')
      }
      storage[key] = JSON.parse(JSON.stringify(value))
    },
    removeStorageSync(key) { delete storage[key] },
    showToast(config) { toasts.push(config) },
    showModal(config) {
      modals.push(config)
      const confirm = typeof options.confirmModal === 'function' ? options.confirmModal(config) : true
      if (config.success) config.success({ confirm, cancel: !confirm })
    },
    navigateTo() {}
  }
  const globals = {
    uni,
    checkAdminAuth: async () => ({}),
    deductAdminUserQuota: async () => ({}),
    getAdminApiToken: () => 'ADMIN_TOKEN',
    getBookBenefitCampaign: async () => ({}),
    getBookBenefitIssueStatus: async () => ({}),
    getAdminHomepageFeatured: async () => ({}),
    getAdminUserEntitlement: async () => ({}),
    grantAdminUserMembership: async () => ({}),
    grantAdminUserQuota: async () => ({}),
    issueBookBenefitCode: async () => ({}),
    listPublishedAdminWords: async () => {
      listCalls += 1
      if (options.listError) throw options.listError
      if (Object.hasOwn(options, 'listResult')) return JSON.parse(JSON.stringify(options.listResult))
      return { ok: true, words: JSON.parse(JSON.stringify(options.serverWords || [])) }
    },
    listAdminUserEntitlementTransactions: async () => ({ transactions: [] }),
    getPublicWordFromServer: async () => null,
    saveAdminApiToken: (value) => value,
    saveAdminHomepageFeatured: async () => ({}),
    saveAdminWordToServer: async (word) => {
      saveCalls.push(JSON.parse(JSON.stringify(word)))
      if (options.saveError) throw options.saveError
      return { ok: true, word: JSON.parse(JSON.stringify(word)) }
    },
    searchAdminEntitlementUsers: async () => ({ users: [] }),
    searchPublicWordsFromServer: async () => [],
    replaceBookBenefitCode: async () => ({})
  }
  const component = loadVueComponent(globals)
  const page = component.data.call({})
  for (const [name, method] of Object.entries(component.methods || {})) page[name] = method
  for (const [name, getter] of Object.entries(component.computed || {})) {
    Object.defineProperty(page, name, { configurable: true, get: () => getter.call(page) })
  }
  page.$set = (target, key, value) => { target[key] = value }
  page.$nextTick = (callback) => { if (callback) callback() }
  page.$refs = {}
  page.syncVideoUploadStateFromForm = () => {}
  page.adminUnlocked = true
  page.adminApiTokenDraft = 'ADMIN_TOKEN'
  page.loadDraft()
  return {
    page,
    storage,
    modals,
    toasts,
    saveCalls,
    get listCalls() { return listCalls },
    get writeCalls() { return writeCalls }
  }
}

function publishedWord(id, overrides = {}) {
  return {
    id,
    word: id,
    status: 'published',
    meaning: `${id} meaning`,
    explanation: `${id} explanation`,
    ...overrides
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function contentSnapshot(harness) {
  return plain({
    words: harness.page.words,
    form: harness.page.form,
    pendingWords: harness.page.pendingWords,
    storage: harness.storage,
    selectedSource: harness.page.selectedSource,
    selectedId: harness.page.selectedId,
    activeBucket: harness.page.activeBucket
  })
}

async function testSeedAndPublishedRefresh() {
  const harness = createHarness({
    storage: {
      'pictographic-admin:pending-imports': [{ id: 'pending-one', word: 'pending', status: 'pending', meaning: 'pending' }]
    },
    serverWords: [
      publishedWord('study', { explanation: 'latest study' }),
      publishedWord('transport', { explanation: 'server transport' }),
      publishedWord('servernew', { explanation: 'new from server' })
    ]
  })
  const pendingBefore = JSON.parse(JSON.stringify(harness.page.pendingWords))
  const serverMissingBefore = JSON.parse(JSON.stringify(harness.page.words.find((item) => item.id === 'tud')))
  await harness.page.refreshPublishedWordsFromServer()
  assert.equal(harness.listCalls, 1)
  assert.equal(harness.page.words.find((item) => item.id === 'study').explanation, 'latest study')
  assert.equal(harness.page.words.find((item) => item.id === 'transport').status, 'published', 'default seed draft must not block the server version')
  assert.equal(harness.page.words.find((item) => item.id === 'servernew').explanation, 'new from server')
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.page.pendingWords)),
    pendingBefore,
    'pendingWords must stay local unchanged'
  )
  assert.equal(harness.page.form.explanation, 'latest study', 'selected form must refresh with the latest server content')
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.page.words.find((item) => item.id === 'tud'))),
    serverMissingBefore,
    'local records missing from the server list must keep their content and status unchanged'
  )
}

async function testRealDraftWins() {
  const localDraft = publishedWord('study', { status: 'draft', explanation: 'local draft work' })
  const harness = createHarness({
    storage: { 'pictographic-admin:words-draft': [localDraft] },
    serverWords: [publishedWord('study', { explanation: 'server latest' })]
  })
  await harness.page.refreshPublishedWordsFromServer()
  assert.equal(harness.page.words[0].status, 'draft')
  assert.equal(harness.page.words[0].explanation, 'local draft work')
  assert.match(harness.modals.at(-1).content, /未覆盖本地草稿：study/)
}

async function testUnsafeSessionEditsBlockRefresh() {
  const local = publishedWord('study', { explanation: 'stored copy' })
  const harness = createHarness({
    storage: { 'pictographic-admin:words-draft': [local] },
    serverWords: [publishedWord('study', { explanation: 'server latest' })]
  })
  harness.page.form.explanation = 'unsaved form edit'
  await harness.page.refreshPublishedWordsFromServer()
  assert.equal(harness.listCalls, 0, 'dirty current form must block the server read')
  assert.match(harness.modals.at(-1).title, /请先保存本机编辑/)

  harness.page.form = JSON.parse(JSON.stringify(harness.page.words[0]))
  harness.page.words[0].explanation = 'switched in-memory edit'
  harness.page.form = JSON.parse(JSON.stringify(harness.page.words[0]))
  await harness.page.refreshPublishedWordsFromServer()
  assert.equal(harness.listCalls, 0, 'in-memory edits left by switching words must block refresh')
}

async function testPublishedCacheConfirmation() {
  const local = publishedWord('study', { explanation: 'possibly local unpublished work' })
  const cancelled = createHarness({
    storage: { 'pictographic-admin:words-draft': [local] },
    serverWords: [publishedWord('study', { explanation: 'server latest' })],
    confirmModal: (modal) => !/已发布缓存差异/.test(modal.title)
  })
  const cancelledBefore = contentSnapshot(cancelled)
  await cancelled.page.refreshPublishedWordsFromServer()
  assert.deepEqual(contentSnapshot(cancelled), cancelledBefore, 'cancelled refresh must keep every local content snapshot unchanged')
  assert.equal(cancelled.writeCalls, 0, 'cancelled conflict confirmation must not rewrite local storage')

  const accepted = createHarness({
    storage: { 'pictographic-admin:words-draft': [local] },
    serverWords: [publishedWord('study', { explanation: 'server latest' })]
  })
  await accepted.page.refreshPublishedWordsFromServer()
  assert.equal(accepted.page.words[0].explanation, 'server latest')
  assert(accepted.writeCalls > 0)
}

async function testPendingSelectionStaysUntouched() {
  const harness = createHarness({
    storage: {
      'pictographic-admin:pending-imports': [publishedWord('pending-one', {
        status: 'pending',
        explanation: 'stored pending content'
      })]
    },
    serverWords: [publishedWord('study', { explanation: 'server study' })]
  })
  harness.page.applySelectedEntry(harness.page.pendingWords[0], 'pending')
  harness.page.form.explanation = 'unsaved pending form content'
  const formBefore = plain(harness.page.form)
  const pendingBefore = plain(harness.page.pendingWords)

  await harness.page.refreshPublishedWordsFromServer()

  assert.deepEqual(plain(harness.page.form), formBefore, 'the selected pending form must stay unchanged')
  assert.deepEqual(plain(harness.page.pendingWords), pendingBefore, 'pendingWords must stay unchanged')
  assert.equal(harness.page.selectedSource, 'pending')
  assert.equal(harness.saveCalls.length, 0, 'refresh must not publish pending content')
}

async function testArchivedConflictAcceptAndCancel() {
  const archived = publishedWord('study', { status: 'archived', explanation: 'local archived content' })
  const cancelled = createHarness({
    storage: { 'pictographic-admin:words-draft': [archived] },
    serverWords: [publishedWord('study', { explanation: 'server published content' })],
    confirmModal: (modal) => !/已发布缓存差异/.test(modal.title)
  })
  const cancelledBefore = contentSnapshot(cancelled)
  await cancelled.page.refreshPublishedWordsFromServer()
  assert.deepEqual(contentSnapshot(cancelled), cancelledBefore, 'cancelling an archived conflict must preserve the archived record')

  const accepted = createHarness({
    storage: { 'pictographic-admin:words-draft': [archived] },
    serverWords: [publishedWord('study', { explanation: 'server published content' })]
  })
  await accepted.page.refreshPublishedWordsFromServer()
  assert.equal(accepted.page.words[0].status, 'published')
  assert.equal(accepted.page.words[0].explanation, 'server published content')
}

async function testRefreshFailuresKeepSnapshots() {
  const local = publishedWord('study', { explanation: 'local content' })
  for (const options of [
    { listError: new Error('simulated read failure') },
    { listResult: { ok: true, words: null } }
  ]) {
    const harness = createHarness({
      storage: {
        'pictographic-admin:words-draft': [local],
        'pictographic-admin:pending-imports': [publishedWord('pending-one', { status: 'pending' })]
      },
      ...options
    })
    const before = contentSnapshot(harness)
    await harness.page.refreshPublishedWordsFromServer()
    assert.deepEqual(contentSnapshot(harness), before, 'failed or invalid refresh must preserve all local content')
    assert.equal(harness.saveCalls.length, 0)
    assert.match(harness.modals.at(-1).title, /刷新失败/)
  }
}

async function testRefreshStorageFailureRollsBackWithoutSuccess() {
  const harness = createHarness({
    storage: {
      'pictographic-admin:words-draft': [publishedWord('study', { explanation: 'local content' })],
      'pictographic-admin:pending-imports': [publishedWord('pending-one', { status: 'pending' })]
    },
    serverWords: [publishedWord('study', { explanation: 'server content' })],
    failStorageWrite: () => true
  })
  const before = contentSnapshot(harness)
  await harness.page.refreshPublishedWordsFromServer()
  assert.deepEqual(contentSnapshot(harness), before, 'storage failure must restore memory while leaving storage unchanged')
  assert(!harness.modals.some((modal) => modal.title === '从服务器刷新完成'), 'storage failure must not show refresh success')
  assert(!harness.toasts.some((toast) => /成功|完成/.test(String(toast.title || ''))), 'storage failure must not show a success toast')
  assert.match(harness.modals.at(-1).title, /刷新失败/)
}

async function testActualPublishPreservesNodeAndPrimaryVideoEdits() {
  const serverWord = publishedWord('complete', {
    parts: [{
      text: 'canonical text', label: 'stale label', meaning: 'canonical meaning', title: 'stale title',
      color: '#123456', bgColor: '#abcdef', borderColor: '#654321', customPartField: 'keep-part'
    }],
    video: {
      clipId: 'stale-main', videoUrl: 'https://cdn.baxiaota.com/video/stale-main.mp4',
      segmentTitle: 'stale main title', startSec: 0, endSec: 99
    },
    videoClips: [{
      clipId: 'clip-1', videoUrl: 'https://cdn.baxiaota.com/video/one.mp4',
      segmentTitle: 'first title', startSec: 1, endSec: 6, customClipField: 'keep-first'
    }, {
      clipId: 'clip-2', videoUrl: 'https://cdn.baxiaota.com/video/two.mp4',
      segmentTitle: 'second title', startSec: 8, endSec: 14, customClipField: 'keep-second'
    }]
  })
  const harness = createHarness({ serverWords: [serverWord] })
  await harness.page.refreshPublishedWordsFromServer()
  const refreshed = harness.page.words.find((item) => item.id === 'complete')
  harness.page.applySelectedEntry(refreshed, 'uploaded')
  assert.equal(harness.page.form.parts[0].label, 'canonical text', 'server text must beat a stale label')
  assert.equal(harness.page.form.parts[0].title, 'canonical meaning', 'server meaning must beat a stale title')
  assert.equal(harness.page.form.video.clipId, 'clip-1', 'canonical first clip must beat stale server main video')

  harness.page.form.parts[0].label = 'edited label'
  harness.page.form.parts[0].title = 'edited meaning'
  harness.page.form.video.url = 'https://cdn.baxiaota.com/video/edited-main.mp4'
  harness.page.form.video.title = 'edited main title'
  harness.page.form.video.endSec = 17
  await harness.page.publishCurrent()

  const editedPayload = harness.saveCalls.at(-1)
  assert.equal(editedPayload.parts[0].label, 'edited label')
  assert.equal(editedPayload.parts[0].text, 'edited label')
  assert.equal(editedPayload.parts[0].title, 'edited meaning')
  assert.equal(editedPayload.parts[0].meaning, 'edited meaning')
  assert.equal(editedPayload.parts[0].color, '#123456')
  assert.equal(editedPayload.parts[0].customPartField, 'keep-part')
  assert.equal(editedPayload.videoClips[0].videoUrl, 'https://cdn.baxiaota.com/video/edited-main.mp4')
  assert.equal(editedPayload.videoClips[0].segmentTitle, 'edited main title')
  assert.equal(editedPayload.videoClips[0].endSec, 17)
  assert.equal(editedPayload.videoClips[1].clipId, 'clip-2')

  harness.page.form.parts[0].label = ''
  harness.page.form.parts[0].title = ''
  harness.page.form.video.title = ''
  await harness.page.publishCurrent()
  const clearedPayload = harness.saveCalls.at(-1)
  assert.equal(clearedPayload.parts[0].label, '')
  assert.equal(clearedPayload.parts[0].text, '')
  assert.equal(clearedPayload.parts[0].title, '')
  assert.equal(clearedPayload.parts[0].meaning, '')
  assert.equal(clearedPayload.videoClips[0].title, '')
  assert.equal(clearedPayload.videoClips[0].segmentTitle, '')
}

async function testActualSecondaryClipEditingAndInvalidClear() {
  const local = publishedWord('study', {
    videoClips: [{
      clipId: 'clip-1', url: 'https://cdn.baxiaota.com/video/one.mp4', title: 'first title', startSec: 1, endSec: 6
    }, {
      clipId: 'clip-2', url: 'https://cdn.baxiaota.com/video/two.mp4', title: 'second title', startSec: 8, endSec: 14
    }]
  })
  const harness = createHarness({ storage: { 'pictographic-admin:words-draft': [local] } })
  harness.page.loadVideoClipForEditing(1)
  harness.page.form.video.url = 'https://cdn.baxiaota.com/video/edited-two.mp4'
  harness.page.form.video.title = 'edited second title'
  harness.page.form.video.endSec = 18
  await harness.page.publishCurrent()

  const editedPayload = harness.saveCalls.at(-1)
  assert.deepEqual(editedPayload.videoClips.map((clip) => clip.clipId), ['clip-1', 'clip-2'])
  assert.equal(editedPayload.videoClips[0].videoUrl, 'https://cdn.baxiaota.com/video/one.mp4')
  assert.equal(editedPayload.videoClips[0].segmentTitle, 'first title')
  assert.equal(editedPayload.videoClips[1].videoUrl, 'https://cdn.baxiaota.com/video/edited-two.mp4')
  assert.equal(editedPayload.videoClips[1].segmentTitle, 'edited second title')
  assert.equal(editedPayload.videoClips[1].endSec, 18)

  harness.page.loadVideoClipForEditing(1)
  harness.page.form.video.title = ''
  await harness.page.publishCurrent()
  const titleClearedPayload = harness.saveCalls.at(-1)
  assert.equal(titleClearedPayload.videoClips[1].title, '')
  assert.equal(titleClearedPayload.videoClips[1].segmentTitle, '')
  assert.equal(titleClearedPayload.videoClips[0].segmentTitle, 'first title')

  const callsBeforeInvalidClear = harness.saveCalls.length
  harness.page.loadVideoClipForEditing(1)
  harness.page.form.video.url = ''
  await harness.page.publishCurrent()
  assert.equal(harness.saveCalls.length, callsBeforeInvalidClear, 'an invalid empty secondary video URL must not publish')
  assert.match(harness.toasts.at(-1).title, /请选择视频|播放地址/)
}

async function testFullFieldRoundTrip() {
  const serverWord = publishedWord('complete', {
    kind: 'root',
    entryType: '',
    cardType: '词根卡',
    tip: 'hidden tip',
    pictograph: 'hidden pictograph',
    richTextHtml: '<p>hidden rich text</p>',
    siblingIds: ['sibling-a'],
    examples: [{ english: 'Complete it.', chinese: '完成它。', customExampleField: 'keep-example' }],
    parts: [{
      text: 'com', label: 'stale-label', meaning: 'together', title: 'stale-title', targetId: 'com',
      color: '#112233', bgColor: '#ddeeff', borderColor: '#445566', customPartField: 'keep-part'
    }],
    illustrationImage: {
      url: 'https://cdn.baxiaota.com/images/complete.png', title: 'image', alt: 'alt',
      provider: 'cos', assetId: 'image-complete', uploadStatus: 'ready', uploadedAt: '2026-10-01T00:00:00.000Z'
    },
    pronunciationAudio: {
      url: 'https://cdn.baxiaota.com/audio/complete.mp3', assetId: 'audio-complete',
      storagePath: 'audio/complete.mp3', customAudioField: 'keep-audio', localPreviewUrl: 'blob:local-audio'
    },
    videoClips: [{
      clipId: 'clip-2', videoUrl: 'https://cdn.baxiaota.com/video/two.mp4', url: 'https://cdn.baxiaota.com/video/stale-two.mp4',
      segmentTitle: 'canonical title', title: 'stale title', startSec: 8, endSec: 14, targetPart: 'plete',
      customClipField: 'keep-two', localPreviewUrl: 'blob:local-video'
    }, {
      clipId: 'clip-1', videoUrl: 'https://cdn.baxiaota.com/video/one.mp4', startSec: 1, endSec: 6, targetPart: 'com', customClipField: 'keep-one'
    }]
  })
  const harness = createHarness({ serverWords: [serverWord] })
  await harness.page.refreshPublishedWordsFromServer()
  const refreshed = harness.page.words.find((item) => item.id === 'complete')
  assert.equal(refreshed.parts[0].label, 'com', 'canonical server text must win over a stale label alias')
  assert.equal(refreshed.parts[0].title, 'together', 'canonical server meaning must win over a stale title alias')
  assert.equal(refreshed.videoClips[0].url, 'https://cdn.baxiaota.com/video/two.mp4', 'canonical videoUrl must win on read')
  assert.equal(refreshed.videoClips[0].title, 'canonical title', 'canonical segmentTitle must win on read')
  const republished = normalizeWordRecord(harness.page.buildServerWordPayload(refreshed))
  assert.equal(republished.parts[0].label, 'com')
  assert.equal(republished.parts[0].text, 'com')
  assert.equal(republished.parts[0].title, 'together')
  assert.equal(republished.parts[0].meaning, 'together')
  assert.equal(republished.parts[0].color, '#112233')
  assert.equal(republished.parts[0].bgColor, '#ddeeff')
  assert.equal(republished.parts[0].borderColor, '#445566')
  assert.equal(republished.parts[0].customPartField, 'keep-part')
  assert.deepEqual(republished.videoClips.map((clip) => clip.clipId), ['clip-2', 'clip-1'])
  assert.equal(republished.videoClips[0].videoUrl, 'https://cdn.baxiaota.com/video/two.mp4')
  assert.equal(republished.videoClips[0].segmentTitle, 'canonical title')
  assert.equal(republished.videoClips[0].startSec, 8)
  assert.equal(republished.videoClips[0].endSec, 14)
  assert.equal(republished.videoClips[0].targetPart, 'plete')
  assert.equal(republished.videoClips[0].customClipField, 'keep-two')
  assert.equal(Object.hasOwn(republished.videoClips[0], 'localPreviewUrl'), false)
  assert.equal(republished.pronunciationAudio.customAudioField, 'keep-audio')
  assert.equal(Object.hasOwn(republished.pronunciationAudio, 'localPreviewUrl'), false)
  assert.equal(republished.illustrationImage.assetId, 'image-complete')
  assert.equal(republished.examples[0].customExampleField, 'keep-example')
  assert.equal(republished.tip, 'hidden tip')
  assert.equal(republished.pictograph, 'hidden pictograph')
  assert.equal(republished.richTextHtml, '<p>hidden rich text</p>')
  assert.deepEqual(republished.siblingIds, ['sibling-a'])
  assert.equal(republished.kind, 'root')

  refreshed.videoClips.splice(0, 1, harness.page.normalizeVideoClip({
    ...refreshed.videoClips[0],
    url: 'https://cdn.baxiaota.com/video/edited-two.mp4',
    title: 'edited title'
  }, 0))
  refreshed.video = { ...refreshed.videoClips[0] }
  const republishedAfterEdit = normalizeWordRecord(harness.page.buildServerWordPayload(refreshed))
  assert.equal(republishedAfterEdit.videoClips[0].videoUrl, 'https://cdn.baxiaota.com/video/edited-two.mp4')
  assert.equal(republishedAfterEdit.videoClips[0].segmentTitle, 'edited title')
  assert.equal(republishedAfterEdit.videoClips[0].endSec, 14)
}

await testSeedAndPublishedRefresh()
await testRealDraftWins()
await testUnsafeSessionEditsBlockRefresh()
await testPublishedCacheConfirmation()
await testPendingSelectionStaysUntouched()
await testArchivedConflictAcceptAndCancel()
await testRefreshFailuresKeepSnapshots()
await testRefreshStorageFailureRollsBackWithoutSuccess()
await testActualPublishPreservesNodeAndPrimaryVideoEdits()
await testActualSecondaryClipEditingAndInvalidClear()
await testFullFieldRoundTrip()
console.log('Admin published word refresh tests passed')
