import http from 'node:http'
import { once } from 'node:events'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createAdminSessionToken } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'
import { createWordStore } from '../server/word-store.mjs'
import { getWordApiBaseUrl } from '../miniapp-uni/word-app1/common/api-config.js'

const testDataUrl = pathToFileURL(join(
  tmpdir(),
  `pictographic-english-test-words-${process.pid}-${Date.now()}.json`
))

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function startTestServer(options = {}) {
  const store = createWordStore({
    dataPath: testDataUrl,
    now: options.now
  })
  await store.replaceWords([])
  const server = http.createServer(createApiHandler({
    store,
    userStore: options.userStore,
    wechatLoginClient: options.wechatLoginClient,
    jwtSecret: options.jwtSecret,
    nodeEnv: options.nodeEnv,
    adminUsername: options.adminUsername,
    adminPassword: options.adminPassword,
    now: options.now
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    server,
    store,
    baseUrl: `http://127.0.0.1:${address.port}`
  }
}

async function readJson(response) {
  const body = await response.json()
  return {
    status: response.status,
    body
  }
}

async function testAdminWordClientPreservesIllustrationPayload() {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options
    })
    const body = JSON.parse(String(options.body || '{}'))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        word: body.word
      })
    }
  }

  try {
    const { saveAdminWordToServer } = await import('../admin-portal/pictographic-admin/common/api-client.js')
    const illustrationImage = {
      url: 'https://cdn.baxiaota.com/images/admin-client.png',
      title: 'Admin client illustration',
      alt: 'Admin client payload visual'
    }

    await saveAdminWordToServer({
      id: 'word-adminclient',
      word: 'adminclient',
      status: 'published',
      meaning: 'admin client payload test',
      illustrationImage
    }, {
      adminApiToken: 'test-admin-token'
    })

    const payload = JSON.parse(String(calls[0].options.body || '{}'))
    assert(payload.word.illustrationImage.url === illustrationImage.url, 'admin client payload should include illustrationImage.url')
    assert(payload.word.illustrationImage.title === illustrationImage.title, 'admin client payload should include illustrationImage.title')
    assert(payload.word.illustrationImage.alt === illustrationImage.alt, 'admin client payload should include illustrationImage.alt')

    await saveAdminWordToServer({
      id: 'word-adminclient',
      word: 'adminclient',
      status: 'published',
      meaning: 'admin client payload test',
      illustration_image: illustrationImage
    }, {
      adminApiToken: 'test-admin-token'
    })

    const aliasPayload = JSON.parse(String(calls[1].options.body || '{}'))
    assert(aliasPayload.word.illustrationImage.url === illustrationImage.url, 'admin client payload should preserve illustration_image alias as illustrationImage')
    assert(!Object.prototype.hasOwnProperty.call(aliasPayload.word, 'illustration_image'), 'admin client payload should not send illustration_image alias')

    await saveAdminWordToServer({
      id: 'word-adminclient',
      word: 'adminclient',
      status: 'published',
      meaning: 'admin client clear payload test',
      illustrationImage: {
        url: '',
        title: '',
        alt: ''
      }
    }, {
      adminApiToken: 'test-admin-token'
    })

    const clearedPayload = JSON.parse(String(calls[2].options.body || '{}'))
    assert(Object.keys(clearedPayload.word.illustrationImage).length === 0, 'admin client payload should send an empty illustrationImage object when cleared')
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function testMiniappPublishedGuards() {
  const originalUni = globalThis.uni
  let requestHandler = null
  const storage = {}
  globalThis.uni = {
    request(options) {
      return requestHandler(options)
    },
    getStorageSync(key) {
      return storage[key]
    },
    setStorageSync(key, value) {
      storage[key] = value
    },
    removeStorageSync(key) {
      delete storage[key]
    }
  }

  try {
    const repository = await import('../miniapp-uni/word-app1/common/word-repository.js')
    const apiClient = await import('../miniapp-uni/word-app1/common/word-api-client.js')
    const userStore = await import('../miniapp-uni/word-app1/common/user-store.js')

    requestHandler = (options) => {
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          words: [
            { id: 'word-client-published', word: 'clientpublished', status: 'published', meaning: 'visible' },
            { id: 'word-client-draft', word: 'clientdraft', status: 'draft', meaning: 'hidden' },
            { id: 'word-client-missing', word: 'clientmissing', meaning: 'hidden' }
          ]
        }
      })
      return { abort() {} }
    }
    const filtered = await repository.fetchWords('client')
    assert(filtered.length === 1, 'mini program repository should keep only published remote search results')
    assert(filtered[0].id === 'word-client-published', 'mini program repository should return the published remote word')

    storage[userStore.USER_STATE_KEY] = {
      searchHistoryVersion: 1,
      recentWordIds: ['word-study', 'mock-study', 'demo-study', '', 'word-client-published'],
      favoriteWordIds: ['word-study']
    }
    const migratedUserState = userStore.getUserState()
    assert(migratedUserState.searchHistoryVersion === userStore.SEARCH_HISTORY_VERSION, 'user store should migrate search history version')
    assert(migratedUserState.recentWordIds.length === 1, 'user store should remove legacy mock/demo recent ids')
    assert(migratedUserState.recentWordIds[0] === 'word-client-published', 'user store should keep valid remote recent ids')
    assert(userStore.getRecentWords()[0].id === 'word-client-published', 'recent words should resolve from remote cache only')

    requestHandler = (options) => {
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          words: []
        }
      })
      return { abort() {} }
    }
    const authoritativeEmpty = await repository.fetchWords('study')
    assert(authoritativeEmpty.length === 0, 'remote empty search results must not silently fall back to bundled words')

    let featuredRequestUrl = ''
    requestHandler = (options) => {
      featuredRequestUrl = options.url
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          source: 'manual',
          word: {
            id: 'word-client-featured',
            word: 'clientfeatured',
            status: 'published',
            meaning: 'featured'
          }
        }
      })
      return { abort() {} }
    }
    const featured = await repository.fetchHomepageFeaturedWord()
    assert(featuredRequestUrl.endsWith('/api/homepage/featured-word'), 'mini program should call the public homepage featured endpoint')
    assert(featured.word && featured.word.id === 'word-client-featured', 'mini program should accept a published featured word')
    assert(featured.source === 'manual', 'mini program should preserve the featured source')

    requestHandler = (options) => {
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          source: 'manual',
          word: {
            id: 'word-client-hidden-featured',
            word: 'clienthiddenfeatured',
            status: 'draft',
            meaning: 'hidden'
          }
        }
      })
      return { abort() {} }
    }
    const hiddenFeatured = await repository.fetchHomepageFeaturedWord()
    assert(hiddenFeatured.word === null, 'mini program must reject non-published featured words')

    requestHandler = (options) => {
      options.fail({ errMsg: 'request:fail network unavailable' })
      return { abort() {} }
    }
    let remoteFailure = null
    try {
      await repository.fetchWords('study')
    } catch (error) {
      remoteFailure = error
    }
    assert(remoteFailure && remoteFailure.remoteFailed === true, 'remote request failures should stay distinguishable')
    assert(Array.isArray(remoteFailure.fallback), 'remote request failures should provide an explicit local fallback list')

    let aborted = false
    requestHandler = () => ({
      abort() {
        aborted = true
      }
    })
    let timeoutError = null
    try {
      await apiClient.fetchServerWords('study', { timeout: 20 })
    } catch (error) {
      timeoutError = error
    }
    assert(timeoutError && timeoutError.code === 'WORD_API_TIMEOUT', 'mini program word API should expose timeout errors')
    assert(aborted, 'mini program word API should abort the request task after timeout')
  } finally {
    if (originalUni === undefined) {
      delete globalThis.uni
    } else {
      globalThis.uni = originalUni
    }
  }
}

async function main() {
  await testAdminWordClientPreservesIllustrationPayload()

  const fixedNow = () => new Date('2026-06-23T08:00:00.000Z')
  const adminAuthOptions = {
    adminUsername: 'admin-test',
    adminPassword: 'admin-password',
    jwtSecret: 'test-session-secret',
    now: fixedNow
  }
  const adminToken = createAdminSessionToken(adminAuthOptions.adminUsername, adminAuthOptions).token
  const authTestUserStore = {
    async findOrCreateWechatUser(identity) {
      assert(identity.openid === 'openid-test', 'wechat login should pass openid to the user store')
      assert(identity.unionid === 'unionid-test', 'wechat login should pass unionid to the user store')
      return {
        id: '42',
        isNew: true
      }
    }
  }
  const authTestWechatLoginClient = {
    async code2Session(code) {
      assert(code === 'test-login-code', 'wechat login endpoint should pass code to code2Session')
      return {
        openid: 'openid-test',
        unionid: 'unionid-test'
      }
    }
  }
  const { server, store, baseUrl } = await startTestServer({
    now: fixedNow,
    userStore: authTestUserStore,
    wechatLoginClient: authTestWechatLoginClient,
    adminUsername: adminAuthOptions.adminUsername,
    adminPassword: adminAuthOptions.adminPassword,
    jwtSecret: adminAuthOptions.jwtSecret
  })
  try {
    const health = await readJson(await fetch(`${baseUrl}/api/health`))
    assert(health.status === 200, 'GET /api/health should return 200')
    assert(health.body.ok === true, 'GET /api/health should return ok=true')

    const authLogin = await readJson(await fetch(`${baseUrl}/api/auth/wechat-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: 'test-login-code'
      })
    }))
    assert(authLogin.status === 200, 'POST /api/auth/wechat-login should return 200')
    assert(authLogin.body.ok === true, 'POST /api/auth/wechat-login should return ok=true')
    assert(authLogin.body.tokenType === 'Bearer', 'wechat login should return a bearer token')
    assert(typeof authLogin.body.token === 'string' && authLogin.body.token.length > 20, 'wechat login should return a signed token')
    assert(authLogin.body.user.id === '42', 'wechat login should return the internal user id')
    assert(authLogin.body.user.hasWechatBinding === true, 'wechat login should report a WeChat binding')
    assert(!Object.prototype.hasOwnProperty.call(authLogin.body.user, 'openid'), 'wechat login must not return openid')
    assert(!Object.prototype.hasOwnProperty.call(authLogin.body, 'session_key'), 'wechat login must not return session_key')

    const word = {
      id: 'word-servertest',
      word: 'servertest',
      status: 'published',
      meaning: 'server link test word',
      pictograph: 'A minimal API integration test word.',
      illustrationImage: {
        url: 'https://cdn.baxiaota.com/images/servertest.png',
        title: 'Server test illustration',
        alt: 'Server test visual',
        provider: 'cos',
        assetId: 'images/servertest.png',
        uploadStatus: 'ready',
        uploadedAt: '2026-06-23T00:00:00.000Z'
      }
    }

    const missingAuthCheckToken = await readJson(await fetch(`${baseUrl}/api/admin/auth/check`))
    assert(missingAuthCheckToken.status === 401, 'GET /api/admin/auth/check without token should return 401')
    assert(missingAuthCheckToken.body.ok === false, 'GET /api/admin/auth/check without token should return ok=false')
    assert(missingAuthCheckToken.body.message === 'Unauthorized', 'GET /api/admin/auth/check without token should return Unauthorized')

    const wrongAuthCheckToken = await readJson(await fetch(`${baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: 'Bearer wrong-admin-token'
      }
    }))
    assert(wrongAuthCheckToken.status === 403, 'GET /api/admin/auth/check with wrong token should return 403')
    assert(wrongAuthCheckToken.body.ok === false, 'GET /api/admin/auth/check with wrong token should return ok=false')
    assert(wrongAuthCheckToken.body.message === 'Unauthorized', 'GET /api/admin/auth/check with wrong token should return Unauthorized')

    const validAuthCheckToken = await readJson(await fetch(`${baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    }))
    assert(validAuthCheckToken.status === 200, 'GET /api/admin/auth/check with session token should return 200')
    assert(validAuthCheckToken.body.ok === true, 'GET /api/admin/auth/check with session token should return ok=true')

    const missingToken = await readJson(await fetch(`${baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word })
    }))
    assert(missingToken.status === 401, 'POST /api/admin/words without token should return 401')
    assert(missingToken.body.ok === false, 'POST /api/admin/words without token should return ok=false')
    assert(missingToken.body.message === 'Unauthorized', 'POST /api/admin/words without token should return Unauthorized')

    const wrongToken = await readJson(await fetch(`${baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-admin-token'
      },
      body: JSON.stringify({ word })
    }))
    assert(wrongToken.status === 403, 'POST /api/admin/words with wrong token should return 403')
    assert(wrongToken.body.ok === false, 'POST /api/admin/words with wrong token should return ok=false')
    assert(wrongToken.body.message === 'Unauthorized', 'POST /api/admin/words with wrong token should return Unauthorized')

    const optionsResponse = await fetch(`${baseUrl}/api/admin/words`, {
      method: 'OPTIONS'
    })
    assert(optionsResponse.status === 204, 'OPTIONS /api/admin/words should return 204')
    assert(
      String(optionsResponse.headers.get('access-control-allow-headers') || '').includes('Authorization'),
      'OPTIONS /api/admin/words should allow Authorization header'
    )

    const authCheckOptionsResponse = await fetch(`${baseUrl}/api/admin/auth/check`, {
      method: 'OPTIONS'
    })
    assert(authCheckOptionsResponse.status === 204, 'OPTIONS /api/admin/auth/check should return 204')
    assert(
      String(authCheckOptionsResponse.headers.get('access-control-allow-headers') || '').includes('Authorization'),
      'OPTIONS /api/admin/auth/check should allow Authorization header'
    )

    const saved = await readJson(await fetch(`${baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ word })
    }))
    assert(saved.status === 200, 'POST /api/admin/words should return 200')
    assert(saved.body.ok === true, 'POST /api/admin/words should return ok=true')
    assert(saved.body.word.id === word.id, 'POST /api/admin/words should return the saved word')
    assert(saved.body.word.illustrationImage.url === word.illustrationImage.url, 'POST /api/admin/words should preserve illustrationImage')
    const persistedAfterSave = JSON.parse(await readFile(testDataUrl, 'utf8'))
    const persistedSavedWord = persistedAfterSave.words.find((item) => item.id === word.id)
    assert(
      persistedSavedWord.illustrationImage.url === word.illustrationImage.url,
      'POST /api/admin/words should persist illustrationImage to words.json'
    )

    const invalidIllustrationSave = await readJson(await fetch(`${baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        word: {
          id: 'word-invalidillustration',
          word: 'invalidillustration',
          status: 'published',
          meaning: 'invalid illustration',
          illustrationImage: {
            url: 'http://localhost/image.png'
          }
        }
      })
    }))
    assert(invalidIllustrationSave.status === 400, 'POST /api/admin/words should reject non-production illustration URLs')

    const list = await readJson(await fetch(`${baseUrl}/api/words?q=servertest`))
    assert(list.status === 200, 'GET /api/words should return 200')
    assert(Array.isArray(list.body.words), 'GET /api/words should return a words array')
    assert(list.body.words.some((item) => item.id === word.id), 'GET /api/words should include the saved published word')
    assert(
      list.body.words.find((item) => item.id === word.id).illustrationImage.url === word.illustrationImage.url,
      'GET /api/words should return illustrationImage for published words'
    )

    const detail = await readJson(await fetch(`${baseUrl}/api/words/${word.id}`))
    assert(detail.status === 200, 'GET /api/words/:id should return 200 for saved word')
    assert(detail.body.word.word === word.word, 'GET /api/words/:id should return the saved word payload')
    assert(detail.body.word.illustrationImage.url === word.illustrationImage.url, 'GET /api/words/:id should return illustrationImage')

    const storedStudentWord = {
      id: 'student',
      word: 'student',
      status: 'published',
      meaning: 'a learner',
      illustrationImage: {
        url: 'https://cdn.baxiaota.com/images/student.png',
        title: 'student illustration',
        alt: 'student pictographic explanation'
      }
    }
    const storedUnsafeWords = [
      ['unsafe-http', 'http://cdn.baxiaota.com/private.png'],
      ['unsafe-localhost', 'https://localhost/private.png'],
      ['unsafe-loopback', 'https://127.0.0.1/private.png'],
      ['unsafe-blob', 'blob:https://baxiaota.com/private'],
      ['unsafe-data', 'data:image/png;base64,AAAA'],
      ['unsafe-mock', 'mock-cloud://images/private.png']
    ].map(([id, url]) => ({
      id,
      word: id.replace(/-/g, ''),
      status: 'published',
      meaning: 'unsafe image test',
      illustrationImage: {
        url,
        title: 'must not be public'
      }
    }))
    await writeFile(testDataUrl, `${JSON.stringify({
      words: [storedStudentWord, ...storedUnsafeWords]
    }, null, 2)}\n`, 'utf8')

    const storedStudentDetail = await readJson(await fetch(`${baseUrl}/api/words/student`))
    assert(storedStudentDetail.status === 200, 'GET /api/words/student should read an existing words.json record')
    assert(
      storedStudentDetail.body.word.illustrationImage.url === storedStudentWord.illustrationImage.url,
      'GET /api/words/student should expose a stored production illustrationImage'
    )

    const storedStudentSearch = await readJson(await fetch(`${baseUrl}/api/words?q=student`))
    assert(storedStudentSearch.status === 200, 'GET /api/words?q=student should return 200')
    assert(
      storedStudentSearch.body.words[0].illustrationImage.url === storedStudentWord.illustrationImage.url,
      'GET /api/words?q=student should expose a stored production illustrationImage'
    )

    for (const unsafeWord of storedUnsafeWords) {
      const unsafeImageDetail = await readJson(await fetch(`${baseUrl}/api/words/${unsafeWord.id}`))
      assert(unsafeImageDetail.status === 200, 'published words with unsafe stored images should remain readable')
      assert(
        Object.keys(unsafeImageDetail.body.word.illustrationImage).length === 0,
        `public detail API should remove stored unsafe illustrationImage URL: ${unsafeWord.illustrationImage.url}`
      )
    }

    const hiddenWords = [
      { id: 'word-hidden-draft', word: 'hiddendraft', status: 'draft', meaning: 'hidden draft' },
      { id: 'word-hidden-unpublished', word: 'hiddenunpublished', status: 'unpublished', meaning: 'hidden unpublished' },
      { id: 'word-hidden-archived', word: 'hiddenarchived', status: 'archived', meaning: 'hidden archived' },
      { id: 'word-hidden-review', word: 'hiddenreview', status: 'review', meaning: 'hidden review' },
      { id: 'word-hidden-pending', word: 'hiddenpending', status: 'pending', meaning: 'hidden pending' },
      { id: 'word-hidden-missing', word: 'hiddenmissing', meaning: 'hidden missing status' }
    ]
    await store.replaceWords([word, ...hiddenWords])

    for (const hiddenWord of hiddenWords) {
      const hiddenList = await readJson(await fetch(`${baseUrl}/api/words?q=${hiddenWord.word}`))
      assert(hiddenList.status === 200, `GET /api/words should return 200 for hidden query ${hiddenWord.word}`)
      assert(hiddenList.body.words.length === 0, `GET /api/words must not expose ${hiddenWord.status || 'missing'} status`)

      const hiddenDetail = await readJson(await fetch(`${baseUrl}/api/words/${hiddenWord.id}`))
      assert(hiddenDetail.status === 404, `GET /api/words/:id must not expose ${hiddenWord.status || 'missing'} status`)
    }

    const featuredWords = [
      {
        id: 'tud',
        word: 'tud',
        status: 'published',
        meaning: 'strike root',
        explanation: 'tud explanation',
        illustrationImage: {
          url: 'https://cdn.baxiaota.com/images/tud.png',
          title: 'tud illustration'
        }
      },
      {
        id: 'cool',
        word: 'cool',
        status: 'published',
        meaning: 'cool meaning',
        explanation: 'cool explanation'
      },
      ...hiddenWords
    ]
    await store.replaceWords(featuredWords)

    const featuredMissingAuth = await readJson(await fetch(`${baseUrl}/api/admin/homepage-featured`))
    assert(featuredMissingAuth.status === 401, 'GET /api/admin/homepage-featured without token should return 401')

    const invalidFeaturedSave = await readJson(await fetch(`${baseUrl}/api/admin/homepage-featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        featuredWordIds: ['word-hidden-draft'],
        mode: 'dailyRotation',
        manualWordId: ''
      })
    }))
    assert(invalidFeaturedSave.status === 400, 'homepage featured config should reject draft words')

    const singleFeaturedSave = await readJson(await fetch(`${baseUrl}/api/admin/homepage-featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        featuredWordIds: ['tud'],
        mode: 'dailyRotation',
        manualWordId: ''
      })
    }))
    assert(singleFeaturedSave.status === 200, 'single-word homepage featured pool should save')
    const publicSingleFeatured = await readJson(await fetch(`${baseUrl}/api/homepage/featured-word`))
    assert(publicSingleFeatured.body.word.id === 'tud', 'single-word homepage featured pool should return tud')
    assert(
      publicSingleFeatured.body.word.illustrationImage.url === 'https://cdn.baxiaota.com/images/tud.png',
      'homepage featured API should preserve illustrationImage'
    )

    const dailyFeaturedSave = await readJson(await fetch(`${baseUrl}/api/admin/homepage-featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        featuredWordIds: ['tud', 'cool'],
        mode: 'dailyRotation',
        manualWordId: ''
      })
    }))
    assert(dailyFeaturedSave.status === 200, 'daily homepage featured config should save')
    assert(dailyFeaturedSave.body.config.featuredWordIds.length === 2, 'daily homepage featured pool should preserve both ids')

    const dayOne = await store.resolveHomepageFeaturedWord({
      date: new Date('2026-06-23T08:00:00.000Z')
    })
    const dayTwo = await store.resolveHomepageFeaturedWord({
      date: new Date('2026-06-24T08:00:00.000Z')
    })
    assert(dayOne.word && dayTwo.word, 'daily rotation should resolve one word each day')
    assert(dayOne.word.id !== dayTwo.word.id, 'two-word daily rotation should switch on the next day')

    const publicDailyFeatured = await readJson(await fetch(`${baseUrl}/api/homepage/featured-word`))
    assert(publicDailyFeatured.status === 200, 'GET /api/homepage/featured-word should return 200')
    assert(publicDailyFeatured.body.word && publicDailyFeatured.body.word.status === 'published', 'public featured API should return a published word')
    assert(publicDailyFeatured.body.source === 'dailyRotation', 'public featured API should identify daily rotation source')

    const featuredAdminGet = await readJson(await fetch(`${baseUrl}/api/admin/homepage-featured`, {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    }))
    assert(featuredAdminGet.status === 200, 'GET /api/admin/homepage-featured with token should return 200')
    assert(featuredAdminGet.body.publishedWords.length === 2, 'admin featured API should list published words only')

    const manualFeaturedSave = await readJson(await fetch(`${baseUrl}/api/admin/homepage-featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        featuredWordIds: ['tud', 'cool'],
        mode: 'manual',
        manualWordId: 'cool'
      })
    }))
    assert(manualFeaturedSave.status === 200, 'manual homepage featured config should save')
    assert(manualFeaturedSave.body.currentWord.id === 'cool', 'manual homepage featured config should select cool')

    const publicManualFeatured = await readJson(await fetch(`${baseUrl}/api/homepage/featured-word`))
    assert(publicManualFeatured.body.word.id === 'cool', 'public featured API should return manually selected cool')
    assert(publicManualFeatured.body.source === 'manual', 'public featured API should identify manual source')

    const unpublishCool = await readJson(await fetch(`${baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        word: {
          ...featuredWords[1],
          status: 'unpublished'
        }
      })
    }))
    assert(unpublishCool.status === 200, 'admin should be able to unpublish the manual featured word')

    const publicAfterUnpublish = await readJson(await fetch(`${baseUrl}/api/homepage/featured-word`))
    assert(publicAfterUnpublish.body.word && publicAfterUnpublish.body.word.id === 'tud', 'invalid manual word should fall back to a published pool word')
    assert(publicAfterUnpublish.body.source === 'dailyRotation', 'invalid manual word fallback should use daily rotation source')

    const preservedConfig = await store.getHomepageFeaturedConfig()
    assert(preservedConfig.mode === 'manual', 'saving a word status should preserve homepage featured config')
    assert(preservedConfig.manualWordId === 'cool', 'saving a word status should preserve manualWordId')

    const emptyFeaturedSave = await readJson(await fetch(`${baseUrl}/api/admin/homepage-featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        featuredWordIds: [],
        mode: 'dailyRotation',
        manualWordId: ''
      })
    }))
    assert(emptyFeaturedSave.status === 200, 'empty homepage featured pool should save')

    const publicEmptyFeatured = await readJson(await fetch(`${baseUrl}/api/homepage/featured-word`))
    assert(publicEmptyFeatured.body.word === null, 'empty homepage featured pool should return word=null')
    assert(publicEmptyFeatured.body.source === 'empty', 'empty homepage featured pool should return source=empty')

    assert(
      getWordApiBaseUrl({ nodeEnv: 'development', apiBaseUrl: 'http://127.0.0.1:3001' }) === 'http://127.0.0.1:3001',
      'development config should allow local HTTP API base URL'
    )
    assert(
      getWordApiBaseUrl({ nodeEnv: 'production', apiBaseUrl: 'http://127.0.0.1:3001' }) === 'https://baxiaota.com',
      'production config should ignore local overrides and use the official HTTPS API base URL'
    )
    assert(
      getWordApiBaseUrl({ nodeEnv: '', apiBaseUrl: 'http://127.0.0.1:3001' }) === 'https://baxiaota.com',
      'missing NODE_ENV should fail closed to the official production API base URL'
    )

  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  const productionServer = await startTestServer({
    nodeEnv: 'production'
  })
  try {
    const productionMissingCredentials = await readJson(await fetch(`${productionServer.baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-admin-token'
      },
      body: JSON.stringify({
        word: {
          id: 'word-productionguard',
          word: 'productionguard',
          status: 'published',
          meaning: 'production guard test'
        }
      })
    }))
    assert(productionMissingCredentials.status === 401, 'production POST without configured admin credentials should return 401')
    assert(productionMissingCredentials.body.message === 'Unauthorized', 'production POST without configured admin credentials should return Unauthorized')

    const productionAuthCheckMissingToken = await readJson(await fetch(`${productionServer.baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: 'Bearer wrong-admin-token'
      }
    }))
    assert(productionAuthCheckMissingToken.status === 401, 'production auth check without configured admin credentials should return 401')
    assert(productionAuthCheckMissingToken.body.message === 'Unauthorized', 'production auth check without configured admin credentials should return Unauthorized')
  } finally {
    await new Promise((resolve) => productionServer.server.close(resolve))
  }

  const productionAuthOptions = {
    adminUsername: 'production-admin',
    adminPassword: 'production-password',
    jwtSecret: 'production-test-session-secret',
    now: fixedNow
  }
  const productionAdminToken = createAdminSessionToken(productionAuthOptions.adminUsername, productionAuthOptions).token
  const productionSessionServer = await startTestServer({
    nodeEnv: 'production',
    adminUsername: productionAuthOptions.adminUsername,
    adminPassword: productionAuthOptions.adminPassword,
    jwtSecret: productionAuthOptions.jwtSecret,
    now: productionAuthOptions.now
  })
  try {
    const productionWrongToken = await readJson(await fetch(`${productionSessionServer.baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: 'Bearer wrong-admin-token'
      }
    }))
    assert(productionWrongToken.status === 403, 'production auth check should reject invalid session tokens')
    assert(productionWrongToken.body.message === 'Unauthorized', 'production auth check with invalid session token should return Unauthorized')

    const productionCustomAuthCheck = await readJson(await fetch(`${productionSessionServer.baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: `Bearer ${productionAdminToken}`
      }
    }))
    assert(productionCustomAuthCheck.status === 200, 'production auth check should allow a configured admin session')
    assert(productionCustomAuthCheck.body.ok === true, 'production auth check with a configured admin session should return ok=true')

    const productionCustomPost = await readJson(await fetch(`${productionSessionServer.baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${productionAdminToken}`
      },
      body: JSON.stringify({
        word: {
          id: 'word-productioncustom',
          word: 'productioncustom',
          status: 'published',
          meaning: 'production custom token test'
        }
      })
    }))
    assert(productionCustomPost.status === 200, 'production POST should allow a configured admin session')
    assert(productionCustomPost.body.ok === true, 'production POST with configured admin session should return ok=true')
  } finally {
    await new Promise((resolve) => productionSessionServer.server.close(resolve))
  }

  await testMiniappPublishedGuards()
  console.log('Server word API link test passed')
}

main()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
  .finally(() => unlink(testDataUrl).catch(() => {}))
