import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'

const JWT_SECRET = 'test-user-favorites-secret'
const NOW = new Date('2026-07-17T00:00:00.000Z')

async function getAvailablePort() {
  const server = http.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

process.env.HOST = '127.0.0.1'
process.env.PORT = String(await getAvailablePort())

const { createApiHandler } = await import('../server/index.mjs')

function createTestStore() {
  return {
    async getWordCount() {
      return 0
    }
  }
}

function createMemoryFavoritesStore() {
  const favorites = new Map()
  let nextSecond = 0

  function keyFor(userId, wordId) {
    return `${userId}::${wordId}`
  }

  function nextTimestamp() {
    const value = new Date(NOW.getTime() + nextSecond * 1000).toISOString()
    nextSecond += 1
    return value
  }

  return {
    async listFavorites(userId) {
      return [...favorites.values()]
        .filter((favorite) => favorite.userId === String(userId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((favorite) => ({
          wordId: favorite.wordId,
          createdAt: favorite.createdAt
        }))
    },

    async addFavorite(userId, wordId) {
      const normalizedUserId = String(userId)
      const normalizedWordId = String(wordId)
      const key = keyFor(normalizedUserId, normalizedWordId)
      if (!favorites.has(key)) {
        favorites.set(key, {
          userId: normalizedUserId,
          wordId: normalizedWordId,
          createdAt: nextTimestamp()
        })
      }
      const favorite = favorites.get(key)
      return {
        wordId: favorite.wordId,
        createdAt: favorite.createdAt
      }
    },

    async removeFavorite(userId, wordId) {
      const normalizedUserId = String(userId)
      const normalizedWordId = String(wordId)
      const key = keyFor(normalizedUserId, normalizedWordId)
      const deleted = favorites.delete(key)
      return {
        wordId: normalizedWordId,
        deleted
      }
    }
  }
}

async function startTestServer() {
  const server = http.createServer(createApiHandler({
    store: createTestStore(),
    userFavoritesStore: createMemoryFavoritesStore(),
    jwtSecret: JWT_SECRET,
    now: () => NOW
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  }
}

async function withServer(run) {
  const { server, baseUrl } = await startTestServer()
  try {
    await run(baseUrl)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function createUserToken(userId) {
  return createUserSessionToken(userId, {
    jwtSecret: JWT_SECRET,
    now: () => NOW
  }).token
}

async function readJson(response) {
  const body = await response.json()
  return {
    status: response.status,
    body
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const headers = {
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  }
  return readJson(await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }))
}

async function testRejectsMissingToken(baseUrl) {
  const result = await requestJson(baseUrl, '/api/user/favorites')
  assert.equal(result.status, 401)
  assert.deepEqual(result.body, {
    ok: false,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized'
  })
}

async function testRejectsInvalidUserTokens(baseUrl) {
  const forgedToken = await requestJson(baseUrl, '/api/user/favorites', {
    token: 'forged.user.token'
  })
  assert.equal(forgedToken.status, 403)
  assert.deepEqual(forgedToken.body, {
    ok: false,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized'
  })

  const adminToken = await requestJson(baseUrl, '/api/user/favorites', {
    token: 'admin-api-token'
  })
  assert.equal(adminToken.status, 403)
  assert.deepEqual(adminToken.body, {
    ok: false,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized'
  })
}

async function testPostRejectsInvalidWordId(baseUrl) {
  const userToken = createUserToken('301')
  const tooLongWordId = 'a'.repeat(192)

  const missing = await requestJson(baseUrl, '/api/user/favorites', {
    method: 'POST',
    token: userToken,
    body: {}
  })
  assert.equal(missing.status, 400)
  assert.deepEqual(missing.body, {
    ok: false,
    code: 'WORD_ID_REQUIRED',
    message: 'Word id is required.'
  })

  const empty = await requestJson(baseUrl, '/api/user/favorites', {
    method: 'POST',
    token: userToken,
    body: {
      wordId: '   '
    }
  })
  assert.equal(empty.status, 400)
  assert.deepEqual(empty.body, {
    ok: false,
    code: 'WORD_ID_REQUIRED',
    message: 'Word id is required.'
  })

  const tooLong = await requestJson(baseUrl, '/api/user/favorites', {
    method: 'POST',
    token: userToken,
    body: {
      wordId: tooLongWordId
    }
  })
  assert.equal(tooLong.status, 400)
  assert.deepEqual(tooLong.body, {
    ok: false,
    code: 'WORD_ID_INVALID',
    message: 'Word id is invalid.'
  })
}

async function testDeleteRejectsInvalidWordId(baseUrl) {
  const userToken = createUserToken('302')
  const tooLongWordId = 'a'.repeat(192)

  const empty = await requestJson(baseUrl, '/api/user/favorites/%20%20%20', {
    method: 'DELETE',
    token: userToken
  })
  assert.equal(empty.status, 400)
  assert.deepEqual(empty.body, {
    ok: false,
    code: 'WORD_ID_REQUIRED',
    message: 'Word id is required.'
  })

  const tooLong = await requestJson(baseUrl, `/api/user/favorites/${tooLongWordId}`, {
    method: 'DELETE',
    token: userToken
  })
  assert.equal(tooLong.status, 400)
  assert.deepEqual(tooLong.body, {
    ok: false,
    code: 'WORD_ID_INVALID',
    message: 'Word id is invalid.'
  })
}

async function testFavoritesLifecycleAndIdempotency(baseUrl) {
  const userAToken = createUserToken('101')

  const created = await requestJson(baseUrl, '/api/user/favorites', {
    method: 'POST',
    token: userAToken,
    body: {
      wordId: 'asia'
    }
  })
  assert.equal(created.status, 200)
  assert.equal(created.body.ok, true)
  assert.deepEqual(created.body.favorite, {
    wordId: 'asia',
    createdAt: '2026-07-17T00:00:00.000Z'
  })

  const duplicate = await requestJson(baseUrl, '/api/user/favorites', {
    method: 'POST',
    token: userAToken,
    body: {
      wordId: 'asia'
    }
  })
  assert.equal(duplicate.status, 200)
  assert.deepEqual(duplicate.body.favorite, created.body.favorite)

  const listed = await requestJson(baseUrl, '/api/user/favorites', {
    token: userAToken
  })
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body, {
    ok: true,
    favorites: [created.body.favorite],
    count: 1
  })

  const deleted = await requestJson(baseUrl, '/api/user/favorites/asia', {
    method: 'DELETE',
    token: userAToken
  })
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body, {
    ok: true,
    wordId: 'asia',
    deleted: true
  })

  const deletedAgain = await requestJson(baseUrl, '/api/user/favorites/asia', {
    method: 'DELETE',
    token: userAToken
  })
  assert.equal(deletedAgain.status, 200)
  assert.deepEqual(deletedAgain.body, {
    ok: true,
    wordId: 'asia',
    deleted: false
  })
}

async function testUserIsolation(baseUrl) {
  const userAToken = createUserToken('201')
  const userBToken = createUserToken('202')

  const userAAsia = await requestJson(baseUrl, '/api/user/favorites', {
    method: 'POST',
    token: userAToken,
    body: {
      wordId: 'asia'
    }
  })
  assert.equal(userAAsia.status, 200)

  const userBEurope = await requestJson(baseUrl, '/api/user/favorites', {
    method: 'POST',
    token: userBToken,
    body: {
      wordId: 'europe'
    }
  })
  assert.equal(userBEurope.status, 200)

  const userAList = await requestJson(baseUrl, '/api/user/favorites', {
    token: userAToken
  })
  assert.equal(userAList.status, 200)
  assert.deepEqual(userAList.body, {
    ok: true,
    favorites: [userAAsia.body.favorite],
    count: 1
  })

  const userBList = await requestJson(baseUrl, '/api/user/favorites', {
    token: userBToken
  })
  assert.equal(userBList.status, 200)
  assert.deepEqual(userBList.body, {
    ok: true,
    favorites: [userBEurope.body.favorite],
    count: 1
  })
}

let exitCode = 0

try {
  await withServer(async (baseUrl) => {
    await testRejectsMissingToken(baseUrl)
    await testRejectsInvalidUserTokens(baseUrl)
    await testPostRejectsInvalidWordId(baseUrl)
    await testDeleteRejectsInvalidWordId(baseUrl)
    await testFavoritesLifecycleAndIdempotency(baseUrl)
    await testUserIsolation(baseUrl)
  })
  console.log('user favorites API tests passed')
} catch (error) {
  exitCode = 1
  console.error(error)
} finally {
  process.exit(exitCode)
}
