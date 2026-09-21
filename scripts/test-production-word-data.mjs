import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { constants } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createApiHandler, startServer } from '../server/index.mjs'
import { createRuntimeWordStore, createWordStore } from '../server/word-store.mjs'

const prefix = `pictographic-word-data-${process.pid}-${Date.now()}`
const paths = {
  unreadable: join(tmpdir(), `${prefix}-unreadable.json`),
  invalidJson: join(tmpdir(), `${prefix}-invalid-json.json`),
  invalidStructure: join(tmpdir(), `${prefix}-invalid-structure.json`),
  noPublished: join(tmpdir(), `${prefix}-no-published.json`),
  development: join(tmpdir(), `${prefix}-development.json`),
  valid: join(tmpdir(), `${prefix}-valid.json`),
  missing: join(tmpdir(), `${prefix}-missing.json`)
}
const createdFiles = []

function expectCode(expectedCode, callback) {
  assert.throws(callback, (error) => {
    assert.equal(error && error.code, expectedCode)
    assert(!String(error && error.message).includes(prefix))
    return true
  })
}

async function writeTestFile(path, content) {
  await writeFile(path, content, 'utf8')
  createdFiles.push(path)
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function getAvailablePort() {
  const server = http.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await closeServer(server)
  return port
}

async function assertProductionFailureDoesNotListen() {
  const port = await getAvailablePort()
  expectCode('WORD_DATA_PATH_REQUIRED', () => startServer({
    nodeEnv: 'production',
    wordDataPath: '   ',
    host: '127.0.0.1',
    port
  }))

  const probe = http.createServer()
  probe.listen(port, '127.0.0.1')
  await once(probe, 'listening')
  await closeServer(probe)
}

try {
  expectCode('WORD_DATA_PATH_REQUIRED', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: '   '
  }))
  await assertProductionFailureDoesNotListen()
  expectCode('WORD_DATA_PATH_NOT_ABSOLUTE', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: 'words.json'
  }))
  expectCode('WORD_DATA_FILE_NOT_FOUND', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: paths.missing
  }))
  expectCode('WORD_DATA_PATH_NOT_FILE', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: tmpdir()
  }))
  expectCode('WORD_DATA_PATH_INSIDE_RELEASE', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: fileURLToPath(new URL('../package.json', import.meta.url))
  }))

  await writeTestFile(paths.unreadable, '[]\n')
  expectCode('WORD_DATA_FILE_NOT_READABLE', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: paths.unreadable,
    fileSystem: {
      statSync: () => ({ isFile: () => true }),
      realpathSync: () => paths.unreadable,
      accessSync: () => {
        const error = new Error('simulated unreadable file')
        error.code = 'EACCES'
        throw error
      },
      readFileSync: () => {
        throw new Error('readFileSync must not run after access failure')
      }
    }
  }))

  await writeTestFile(paths.invalidJson, '{not-json}\n')
  expectCode('WORD_DATA_JSON_INVALID', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: paths.invalidJson
  }))

  await writeTestFile(paths.invalidStructure, JSON.stringify({ entries: [] }))
  expectCode('WORD_DATA_STRUCTURE_INVALID', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: paths.invalidStructure
  }))

  await writeTestFile(paths.noPublished, JSON.stringify({
    words: [
      { id: 'word-draft', word: 'draft', status: 'draft', meaning: 'draft entry' },
      { id: '', word: 'broken', status: 'published', meaning: 'invalid published entry' }
    ]
  }))
  expectCode('WORD_DATA_PUBLISHED_WORD_REQUIRED', () => createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: paths.noPublished
  }))

  await writeTestFile(paths.valid, JSON.stringify([
    { id: 'word-ready', word: 'ready', status: 'published', meaning: 'prepared' }
  ]))
  const productionStore = createRuntimeWordStore({
    nodeEnv: 'production',
    wordDataPath: paths.valid
  })
  assert.equal(await productionStore.getWordCount(), 1)
  assert.equal(productionStore.dataPath.protocol, 'file:')

  const defaultStore = createRuntimeWordStore({ nodeEnv: 'development', wordDataPath: '' })
  assert.equal(defaultStore.dataPath.href, createWordStore().dataPath.href)

  await writeTestFile(paths.development, JSON.stringify({
    words: [
      { id: 'word-development-draft', word: 'development', status: 'draft', meaning: 'draft only' }
    ]
  }))
  const developmentStore = createRuntimeWordStore({
    nodeEnv: 'development',
    wordDataPath: paths.development
  })
  assert.equal(await developmentStore.getWordCount(), 1)
  assert.equal((await developmentStore.listWords({ publishedOnly: false }))[0].status, 'draft')

  const relativeDevelopmentStore = createRuntimeWordStore({
    nodeEnv: 'test',
    wordDataPath: 'server/local-data/relative-test-words.json'
  })
  assert.equal(
    relativeDevelopmentStore.dataPath.href,
    new URL('../server/local-data/relative-test-words.json', import.meta.url).href
  )

  const injectedStore = { marker: 'explicit-test-store' }
  assert.equal(typeof createApiHandler({
    nodeEnv: 'production',
    wordDataPath: '',
    store: injectedStore
  }), 'function')

  console.log('production word data tests passed')
} finally {
  for (const path of createdFiles) {
    await unlink(path).catch((error) => {
      if (!error || error.code !== 'ENOENT') throw error
    })
  }
}
