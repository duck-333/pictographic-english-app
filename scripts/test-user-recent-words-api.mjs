import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'

const JWT_SECRET = 'test-user-recent-words-secret'
const NOW = new Date('2026-07-20T00:00:00.000Z')

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

function createMemoryRecentWordsStore() {
  const recentWords = new Map()
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
    async listRecentWords(userId) {
      return [...recentWords.values()]
        .filter((recentWord) => recentWord.userId === String(userId))
        .sort((left, right) => right.viewedAt.localeCompare(left.viewedAt))
        .map((recentWord) => ({
          wordId: recentWord.wordId,
          viewedAt: recentWord.viewedAt
        }))
    },

    async recordRecentWord(userId, wordId) {
      const normalizedUserId = String(userId)
      const normalizedWordId = String(wordId)
      const key = keyFor(normalizedUserId, normalizedWordId)
      const existing = recentWords.get(key)
      const viewedAt = nextTimestamp()
      recentWords.set(key, {
        userId: normalizedUserId,
        wordId: normalizedWordId,
        viewedAt,
        createdAt: existing ? existing.createdAt : viewedAt
      })
      const recentWord = recentWords.get(key)
      return {
        wordId: recentWord.wordId,
        viewedAt: recentWord.viewedAt
      }
    }
  }
}

async function startTestServer() {
  const server = http.createServer(createApiHandler({
    store: createTestStore(),
    userRecentWordsStore: createMemoryRecentWordsStore(),
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
  const result = await requestJson(baseUrl, '/api/user/recent-words')
  assert.equal(result.status, 401)
  assert.deepEqual(result.body, {
    ok: false,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized'
  })
}

async function testCreatesAndQueriesRecentWord(baseUrl) {
  const token = createUserToken('101')

  const created = await requestJson(baseUrl, '/api/user/recent-words', {
    method: 'POST',
    token,
    body: {
      wordId: 'asia'
    }
  })
  assert.equal(created.status, 200)
  assert.deepEqual(created.body, {
    ok: true,
    recentWord: {
      wordId: 'asia',
      viewedAt: '2026-07-20T00:00:00.000Z'
    }
  })

  const listed = await requestJson(baseUrl, '/api/user/recent-words', {
    token
  })
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body, {
    ok: true,
    recentWords: [created.body.recentWord],
    count: 1
  })
}

async function testDuplicateRecordUpdatesWithoutDuplicate(baseUrl) {
  const token = createUserToken('201')

  const first = await requestJson(baseUrl, '/api/user/recent-words', {
    method: 'POST',
    token,
    body: {
      wordId: 'asia'
    }
  })
  assert.equal(first.status, 200)

  const second = await requestJson(baseUrl, '/api/user/recent-words', {
    method: 'POST',
    token,
    body: {
      wordId: 'asia'
    }
  })
  assert.equal(second.status, 200)
  assert.equal(second.body.ok, true)
  assert.equal(second.body.recentWord.wordId, 'asia')
  assert(second.body.recentWord.viewedAt > first.body.recentWord.viewedAt)

  const listed = await requestJson(baseUrl, '/api/user/recent-words', {
    token
  })
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body, {
    ok: true,
    recentWords: [second.body.recentWord],
    count: 1
  })
}

let exitCode = 0

try {
  await withServer(async (baseUrl) => {
    await testRejectsMissingToken(baseUrl)
    await testCreatesAndQueriesRecentWord(baseUrl)
    await testDuplicateRecordUpdatesWithoutDuplicate(baseUrl)
  })
  console.log('user recent words API tests passed')
} catch (error) {
  exitCode = 1
  console.error(error)
} finally {
  process.exit(exitCode)
}
