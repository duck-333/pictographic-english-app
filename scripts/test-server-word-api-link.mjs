import http from 'node:http'
import { once } from 'node:events'

import { DEFAULT_DEV_ADMIN_API_TOKEN } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'
import { createWordStore } from '../server/word-store.mjs'
import { getWordApiBaseUrl } from '../miniapp-uni/word-app1/common/api-config.js'

const testDataUrl = new URL('../server/local-data/test-words.json', import.meta.url)

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function startTestServer(options = {}) {
  const store = createWordStore({ dataPath: testDataUrl })
  await store.replaceWords([])
  const server = http.createServer(createApiHandler({
    store,
    nodeEnv: options.nodeEnv,
    adminApiToken: options.adminApiToken
  }))
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
        Authorization: `Bearer ${DEFAULT_DEV_ADMIN_API_TOKEN}`
      }
    }))
    assert(validAuthCheckToken.status === 200, 'GET /api/admin/auth/check with dev token should return 200')
    assert(validAuthCheckToken.body.ok === true, 'GET /api/admin/auth/check with dev token should return ok=true')

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
        Authorization: `Bearer ${DEFAULT_DEV_ADMIN_API_TOKEN}`
      },
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

  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  const productionServer = await startTestServer({
    nodeEnv: 'production',
    adminApiToken: ''
  })
  try {
    const productionDefaultToken = await readJson(await fetch(`${productionServer.baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEFAULT_DEV_ADMIN_API_TOKEN}`
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
    assert(productionDefaultToken.status === 401, 'production POST with default dev token and missing ADMIN_API_TOKEN should return 401')
    assert(productionDefaultToken.body.message === 'Unauthorized', 'production POST with default dev token should return Unauthorized')

    const productionAuthCheckMissingToken = await readJson(await fetch(`${productionServer.baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: `Bearer ${DEFAULT_DEV_ADMIN_API_TOKEN}`
      }
    }))
    assert(productionAuthCheckMissingToken.status === 401, 'production auth check with missing ADMIN_API_TOKEN should return 401')
    assert(productionAuthCheckMissingToken.body.message === 'Unauthorized', 'production auth check with missing ADMIN_API_TOKEN should return Unauthorized')
  } finally {
    await new Promise((resolve) => productionServer.server.close(resolve))
  }

  const productionDevTokenServer = await startTestServer({
    nodeEnv: 'production',
    adminApiToken: DEFAULT_DEV_ADMIN_API_TOKEN
  })
  try {
    const productionConfiguredDefaultToken = await readJson(await fetch(`${productionDevTokenServer.baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: `Bearer ${DEFAULT_DEV_ADMIN_API_TOKEN}`
      }
    }))
    assert(productionConfiguredDefaultToken.status === 401, 'production auth check should reject configured default dev token')
    assert(productionConfiguredDefaultToken.body.message === 'Unauthorized', 'production auth check with configured default dev token should return Unauthorized')
  } finally {
    await new Promise((resolve) => productionDevTokenServer.server.close(resolve))
  }

  const productionCustomTokenServer = await startTestServer({
    nodeEnv: 'production',
    adminApiToken: 'production-private-token'
  })
  try {
    const productionCustomAuthCheck = await readJson(await fetch(`${productionCustomTokenServer.baseUrl}/api/admin/auth/check`, {
      headers: {
        Authorization: 'Bearer production-private-token'
      }
    }))
    assert(productionCustomAuthCheck.status === 200, 'production auth check should allow configured custom token')
    assert(productionCustomAuthCheck.body.ok === true, 'production auth check with custom token should return ok=true')

    const productionCustomPost = await readJson(await fetch(`${productionCustomTokenServer.baseUrl}/api/admin/words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer production-private-token'
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
    assert(productionCustomPost.status === 200, 'production POST should allow configured custom token')
    assert(productionCustomPost.body.ok === true, 'production POST with custom token should return ok=true')
  } finally {
    await new Promise((resolve) => productionCustomTokenServer.server.close(resolve))
  }

  console.log('Server word API link test passed')
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
