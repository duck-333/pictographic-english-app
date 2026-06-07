import http from 'node:http'
import { once } from 'node:events'

import { createApiHandler } from '../server/index.mjs'
import { createWordStore } from '../server/word-store.mjs'
import { getWordApiBaseUrl } from '../miniapp-uni/word-app1/common/api-config.js'

const testDataUrl = new URL('../server/local-data/test-words.json', import.meta.url)

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function startTestServer() {
  const store = createWordStore({ dataPath: testDataUrl })
  await store.replaceWords([])
  const server = http.createServer(createApiHandler({ store }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    server,
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

async function main() {
  const { server, baseUrl } = await startTestServer()
  try {
    const health = await readJson(await fetch(`${baseUrl}/api/health`))
    assert(health.status === 200, 'GET /api/health should return 200')
    assert(health.body.ok === true, 'GET /api/health should return ok=true')

    const word = {
      id: 'word-servertest',
      word: 'servertest',
      status: 'published',
      meaning: 'server link test word',
      pictograph: 'A minimal API integration test word.'
    }

    const saved = await readJson(await fetch(`${baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word })
    }))
    assert(saved.status === 200, 'POST /api/admin/words should return 200')
    assert(saved.body.ok === true, 'POST /api/admin/words should return ok=true')
    assert(saved.body.word.id === word.id, 'POST /api/admin/words should return the saved word')

    const list = await readJson(await fetch(`${baseUrl}/api/words?q=servertest`))
    assert(list.status === 200, 'GET /api/words should return 200')
    assert(Array.isArray(list.body.words), 'GET /api/words should return a words array')
    assert(list.body.words.some((item) => item.id === word.id), 'GET /api/words should include the saved published word')

    const detail = await readJson(await fetch(`${baseUrl}/api/words/${word.id}`))
    assert(detail.status === 200, 'GET /api/words/:id should return 200 for saved word')
    assert(detail.body.word.word === word.word, 'GET /api/words/:id should return the saved word payload')

    assert(
      getWordApiBaseUrl({ nodeEnv: 'development', apiBaseUrl: 'http://127.0.0.1:3001' }) === 'http://127.0.0.1:3001',
      'development config should allow local HTTP API base URL'
    )
    assert(
      getWordApiBaseUrl({ nodeEnv: 'production', apiBaseUrl: 'http://127.0.0.1:3001' }) === '',
      'production config should block local HTTP API base URL'
    )
    assert(
      getWordApiBaseUrl({ nodeEnv: '', apiBaseUrl: 'http://127.0.0.1:3001' }) === 'http://127.0.0.1:3001',
      'missing NODE_ENV should default to development-like mode and allow local API base URL'
    )

    console.log('Server word API link test passed')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
