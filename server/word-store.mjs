import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  normalizeWordQuery,
  normalizeWordRecord,
  validateWordRecord
} from '../miniapp-uni/word-app1/common/content-schema.js'

const DEFAULT_DATA_PATH = new URL('./local-data/words.json', import.meta.url)
const HOMEPAGE_FEATURED_MODES = ['dailyRotation', 'manual']
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const DEFAULT_HOMEPAGE_FEATURED_CONFIG = Object.freeze({
  featuredWordIds: [],
  mode: 'dailyRotation',
  manualWordId: '',
  updatedAt: '',
  updatedBy: ''
})

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

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeLookupKey(value) {
  return normalizeId(value).toLowerCase()
}

function normalizeIdList(values) {
  const result = []
  const used = new Set()
  ;(Array.isArray(values) ? values : []).forEach((value) => {
    const id = normalizeId(value)
    if (!id || used.has(id)) return
    used.add(id)
    result.push(id)
  })
  return result
}

function normalizeHomepageFeaturedConfig(source) {
  const config = source && typeof source === 'object' ? source : {}
  const mode = HOMEPAGE_FEATURED_MODES.includes(config.mode)
    ? config.mode
    : DEFAULT_HOMEPAGE_FEATURED_CONFIG.mode
  return {
    featuredWordIds: normalizeIdList(config.featuredWordIds),
    mode,
    manualWordId: mode === 'manual' ? normalizeId(config.manualWordId) : '',
    updatedAt: String(config.updatedAt || ''),
    updatedBy: String(config.updatedBy || '')
  }
}

function getShanghaiDayNumber(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return 0
  return Math.floor((date.getTime() + SHANGHAI_UTC_OFFSET_MS) / 86400000)
}

function matchesQuery(word, query) {
  const keyword = normalizeWordQuery(query)
  if (!keyword) return true
  return [word.id, word.word, word.meaning, word.phonetic, word.level]
    .some((value) => String(value || '').toLowerCase().includes(keyword))
}

function normalizePublicText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isProductionIllustrationImageUrl(value) {
  const source = normalizePublicText(value)
  if (!source || /\s/.test(source)) return false

  try {
    const parsed = new URL(source)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    if (parsed.protocol !== 'https:' || !hostname) return false
    if (hostname === 'localhost' || hostname === '::1') return false
    if (hostname === 'example.com' || hostname.endsWith('.example.com')) return false
    const octets = hostname.split('.')
    if (octets.length === 4 && octets.every((item) => /^\d{1,3}$/.test(item))) {
      return Number(octets[0]) !== 127
    }
    return true
  } catch (error) {
    return false
  }
}

function normalizePublicIllustrationImage(image) {
  const source = image && typeof image === 'object' && !Array.isArray(image) ? image : {}
  const url = normalizePublicText(source.url)
  if (!isProductionIllustrationImageUrl(url)) return {}

  return {
    url,
    title: normalizePublicText(source.title),
    alt: normalizePublicText(source.alt),
    provider: normalizePublicText(source.provider),
    assetId: normalizePublicText(source.assetId || source.asset_id),
    uploadStatus: normalizePublicText(source.uploadStatus || source.upload_status),
    uploadedAt: normalizePublicText(source.uploadedAt || source.uploaded_at)
  }
}

function normalizePublicWord(source) {
  const word = normalizeWordRecord(source)
  const illustrationImage = normalizePublicIllustrationImage(
    source && typeof source === 'object'
      ? source.illustrationImage || source.illustration_image || word.illustrationImage
      : word.illustrationImage
  )

  return {
    ...word,
    illustrationImage
  }
}

export function createWordStore(options = {}) {
  const dataPath = options.dataPath ? new URL(options.dataPath, import.meta.url) : DEFAULT_DATA_PATH
  const dataFilePath = fileURLToPath(dataPath)
  const now = options.now || (() => new Date())

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
    const payload = await readPayload()
    await writePayload({
      ...payload,
      words: normalizedWords
    })
    return normalizedWords.map((word) => clone(word))
  }

  async function listWords(options = {}) {
    const payload = await readPayload()
    const allNormalized = payload.words.map((word) => normalizeWordRecord(word))
    const limit = Number(options.limit || 0)
    const filtered = allNormalized
      .filter((word) => (options.publishedOnly === false ? true : word.status === 'published'))
      .filter((word) => matchesQuery(word, options.query))
      .slice(0, limit > 0 ? limit : undefined)
      .map((word) => clone(
        options.publishedOnly === false
          ? word
          : normalizePublicWord(word)
      ))
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
    const targetKey = normalizeLookupKey(targetId)
    const word = words.find((item) => item.id === targetId) ||
      words.find((item) => normalizeLookupKey(item.id) === targetKey)
    return word ? clone(word) : null
  }

  async function saveWord(sourceWord) {
    const normalized = normalizeWordRecord(sourceWord)
    const validation = validateWordRecord(sourceWord)
    if (!validation.ok) {
      return {
        ok: false,
        errors: validation.errors,
        word: normalized
      }
    }

    const payload = await readPayload()
    const words = payload.words.map((word) => normalizeWordRecord(word))
    const targetKey = normalizeLookupKey(validation.value.id)
    const exactIndex = words.findIndex((word) => word.id === validation.value.id)
    const index = exactIndex >= 0
      ? exactIndex
      : words.findIndex((word) => normalizeLookupKey(word.id) === targetKey)
    if (index >= 0) {
      words.splice(index, 1, validation.value)
    } else {
      words.unshift(validation.value)
    }

    await writePayload({
      ...payload,
      words
    })
    return {
      ok: true,
      errors: [],
      word: clone(validation.value)
    }
  }

  async function getHomepageFeaturedConfig() {
    const payload = await readPayload()
    return clone(normalizeHomepageFeaturedConfig(payload.homepageFeatured))
  }

  async function saveHomepageFeaturedConfig(sourceConfig, options = {}) {
    const source = sourceConfig && typeof sourceConfig === 'object' ? sourceConfig : {}
    const errors = []
    if (source.mode && !HOMEPAGE_FEATURED_MODES.includes(source.mode)) {
      errors.push(`mode must be one of: ${HOMEPAGE_FEATURED_MODES.join(', ')}`)
    }

    const config = normalizeHomepageFeaturedConfig(source)
    const payload = await readPayload()
    const words = payload.words.map((word) => normalizeWordRecord(word))
    const publishedIds = new Set(
      words
        .filter((word) => word.status === 'published')
        .map((word) => word.id)
    )
    const invalidFeaturedWordIds = config.featuredWordIds.filter((id) => !publishedIds.has(id))
    if (invalidFeaturedWordIds.length) {
      errors.push(`featuredWordIds must contain published words only: ${invalidFeaturedWordIds.join(', ')}`)
    }
    if (config.mode === 'manual' && !config.manualWordId) {
      errors.push('manualWordId is required when mode is manual')
    }
    if (config.mode === 'manual' && config.manualWordId && !publishedIds.has(config.manualWordId)) {
      errors.push(`manualWordId must reference a published word: ${config.manualWordId}`)
    }
    if (errors.length) {
      return {
        ok: false,
        errors,
        config
      }
    }

    const savedConfig = {
      ...config,
      updatedAt: now().toISOString(),
      updatedBy: String(options.updatedBy || config.updatedBy || 'admin-api')
    }
    await writePayload({
      ...payload,
      homepageFeatured: savedConfig
    })
    return {
      ok: true,
      errors: [],
      config: clone(savedConfig)
    }
  }

  async function resolveHomepageFeaturedWord(options = {}) {
    const payload = await readPayload()
    const config = normalizeHomepageFeaturedConfig(payload.homepageFeatured)
    const publishedWords = payload.words
      .map((word) => normalizeWordRecord(word))
      .filter((word) => word.status === 'published')
    const publishedById = new Map(publishedWords.map((word) => [word.id, word]))
    const featuredWords = config.featuredWordIds
      .map((id) => publishedById.get(id))
      .filter((word) => word)

    if (config.mode === 'manual') {
      const manualWord = publishedById.get(config.manualWordId)
      if (manualWord) {
        return {
          word: clone(normalizePublicWord(manualWord)),
          source: 'manual',
          config: clone(config)
        }
      }
    }

    if (featuredWords.length) {
      const index = getShanghaiDayNumber(options.date || now()) % featuredWords.length
      return {
        word: clone(normalizePublicWord(featuredWords[index])),
        source: 'dailyRotation',
        config: clone(config)
      }
    }

    return {
      word: null,
      source: 'empty',
      config: clone(config)
    }
  }

  return {
    dataPath,
    replaceWords,
    listWords,
    getWordCount,
    findWordById,
    saveWord,
    getHomepageFeaturedConfig,
    saveHomepageFeaturedConfig,
    resolveHomepageFeaturedWord
  }
}
