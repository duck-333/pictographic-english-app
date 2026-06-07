import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeWordQuery, normalizeWordRecord, validateWordRecord } from '../miniapp-uni/word-app1/common/content-schema.js'

const DEFAULT_DATA_PATH = new URL('./local-data/words.json', import.meta.url)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeStorePayload(payload) {
  if (Array.isArray(payload)) {
    return { words: payload }
  }
  if (payload && typeof payload === 'object') {
    return {
      ...payload,
      words: Array.isArray(payload.words) ? payload.words : []
    }
  }
  return { words: [] }
}

function matchesQuery(word, query) {
  const keyword = normalizeWordQuery(query)
  if (!keyword) return true
  return [word.id, word.word, word.meaning, word.phonetic, word.level]
    .some((value) => String(value || '').toLowerCase().includes(keyword))
}

export function createWordStore(options = {}) {
  const dataPath = options.dataPath ? new URL(options.dataPath, import.meta.url) : DEFAULT_DATA_PATH
  const dataFilePath = fileURLToPath(dataPath)

  async function readPayload() {
    try {
      const raw = await readFile(dataPath, 'utf8')
      return normalizeStorePayload(JSON.parse(raw))
    } catch (error) {
      if (error && error.code === 'ENOENT') return { words: [] }
      throw error
    }
  }

  async function writePayload(payload) {
    await mkdir(dirname(dataFilePath), { recursive: true })
    const nextPayload = {
      ...normalizeStorePayload(payload),
      updatedAt: new Date().toISOString()
    }
    await writeFile(dataPath, `${JSON.stringify(nextPayload, null, 2)}\n`, 'utf8')
    return nextPayload
  }

  async function replaceWords(words) {
    const normalizedWords = (Array.isArray(words) ? words : []).map((word) => normalizeWordRecord(word))
    await writePayload({ words: normalizedWords })
    return normalizedWords.map((word) => clone(word))
  }

  async function listWords(options = {}) {
    const payload = await readPayload()
    const allNormalized = payload.words.map((word) => normalizeWordRecord(word))
    const filtered = allNormalized
      .filter((word) => (options.publishedOnly === false ? true : word.status === 'published'))
      .filter((word) => matchesQuery(word, options.query))
      .map((word) => clone(word))
    return filtered
  }

  async function getWordCount() {
    const payload = await readPayload()
    return payload.words.length
  }

  async function findWordById(id, options = {}) {
    const targetId = String(id || '').trim()
    if (!targetId) return null
    const words = await listWords({ publishedOnly: options.publishedOnly, query: '' })
    const word = words.find((item) => item.id === targetId)
    return word ? clone(word) : null
  }

  async function saveWord(sourceWord) {
    const normalized = normalizeWordRecord(sourceWord)
    const validation = validateWordRecord(normalized)
    if (!validation.ok) {
      return {
        ok: false,
        errors: validation.errors,
        word: normalized
      }
    }

    const payload = await readPayload()
    const words = payload.words.map((word) => normalizeWordRecord(word))
    const index = words.findIndex((word) => word.id === validation.value.id)
    if (index >= 0) {
      words.splice(index, 1, validation.value)
    } else {
      words.unshift(validation.value)
    }

    await writePayload({ words })
    return {
      ok: true,
      errors: [],
      word: clone(validation.value)
    }
  }

  return {
    dataPath,
    replaceWords,
    listWords,
    getWordCount,
    findWordById,
    saveWord
  }
}
