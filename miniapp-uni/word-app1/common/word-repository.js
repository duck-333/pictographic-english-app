import {
  HOT_WORDS as LOCAL_HOT_WORDS,
  NAV_ITEMS as LOCAL_NAV_ITEMS,
  WORDS as LOCAL_WORDS
} from './mock-data.js'
import { DEV_PREVIEW_WORDS } from './dev-preview-data.js'
import { getWordApiBaseUrl } from './api-config.js'
import { createWordDraft, normalizeWordQuery, normalizeWordRecord, validateWordRecord } from './content-schema.js'
import {
  fetchServerHomepageFeaturedWord,
  fetchServerWordById,
  fetchServerWords
} from './word-api-client.js'

function mergePreviewWords(localWords, previewWords) {
  const result = []
  const used = new Set()

  ;(previewWords || []).forEach((word) => {
    if (!word || !word.id || !word.word) return
    result.push(word)
    used.add(String(word.id))
    used.add(String(word.word).toLowerCase())
  })

  ;(localWords || []).forEach((word) => {
    const id = String(word && word.id ? word.id : '')
    const text = String(word && word.word ? word.word : '').toLowerCase()
    if (used.has(id) || used.has(text)) return
    result.push(word)
  })

  return result
}

function getNodeEnv(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'nodeEnv')) {
    return String(options.nodeEnv || '').toLowerCase()
  }
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return String(process.env.NODE_ENV || '').toLowerCase()
}

export function isProductionRuntime(options = {}) {
  return getNodeEnv(options) !== 'development'
}

export function selectDevPreviewWordsForRuntime(previewWords = DEV_PREVIEW_WORDS, production = isProductionRuntime()) {
  if (production) return []
  return Array.isArray(previewWords) ? previewWords : []
}

function normalizeMediaUrl(url) {
  return String(url || '').trim()
}

function parseMediaUrl(url) {
  const value = normalizeMediaUrl(url)
  if (!value || typeof URL === 'undefined') return null
  try {
    return new URL(value)
  } catch (error) {
    return null
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '')
}

function isLoopbackHostname(hostname) {
  const host = normalizeHostname(hostname)
  if (host === 'localhost' || host === '::1') return true

  const octets = host.split('.')
  if (octets.length !== 4) return false
  if (!octets.every((item) => /^\d{1,3}$/.test(item) && Number(item) >= 0 && Number(item) <= 255)) return false
  return Number(octets[0]) === 127
}

export function isLocalPreviewMediaUrl(url) {
  const parsed = parseMediaUrl(url)
  return Boolean(parsed && /^https?:$/i.test(parsed.protocol) && isLoopbackHostname(parsed.hostname))
}

export function hasBlockedProductionMediaSource(url) {
  const value = normalizeMediaUrl(url)
  if (!value) return false
  const parsed = parseMediaUrl(value)
  return (
    !parsed ||
    isLoopbackHostname(parsed.hostname) ||
    /^mock-cloud:\/\//i.test(value) ||
    /^blob:/i.test(value) ||
    /^data:/i.test(value) ||
    /example\.com/i.test(value)
  )
}

function isCloudOrHttpsMediaUrl(url) {
  const parsed = parseMediaUrl(url)
  return Boolean(parsed && (parsed.protocol === 'https:' || parsed.protocol === 'cloud:'))
}

export function isPlayableMediaUrl(url, options = {}) {
  const value = normalizeMediaUrl(url)
  const production = Object.prototype.hasOwnProperty.call(options, 'production')
    ? Boolean(options.production)
    : isProductionRuntime()

  if (!value) return false
  if (production) {
    return isCloudOrHttpsMediaUrl(value) && !hasBlockedProductionMediaSource(value)
  }
  return isCloudOrHttpsMediaUrl(value) || isLocalPreviewMediaUrl(value)
}

const ACTIVE_DEV_PREVIEW_WORDS = selectDevPreviewWordsForRuntime(DEV_PREVIEW_WORDS)
const SOURCE_WORDS = mergePreviewWords(LOCAL_WORDS, ACTIVE_DEV_PREVIEW_WORDS)
let REMOTE_WORD_RECORDS = []

export const CONTENT_REPOSITORY_MODE = ACTIVE_DEV_PREVIEW_WORDS.length
  ? 'local-preview-bridge'
  : getWordApiBaseUrl()
    ? isProductionRuntime()
      ? 'production-api-with-explicit-local-fallback'
      : 'development-api-with-explicit-local-fallback'
    : 'offline-published-content'
export const HOT_WORDS = LOCAL_HOT_WORDS
export const NAV_ITEMS = LOCAL_NAV_ITEMS

const WORD_RECORDS = SOURCE_WORDS.map((item) => normalizeWordRecord(item))
const PUBLISHED_WORD_RECORDS = SOURCE_WORDS
  .filter((item) => item && item.status === 'published')
  .map((item) => normalizeWordRecord(item))

function getPublishedWordRecords() {
  return mergePreviewWords(PUBLISHED_WORD_RECORDS, REMOTE_WORD_RECORDS)
    .map((item) => normalizeWordRecord(item))
    .filter((item) => item.status === 'published')
}

function getAllWordRecords() {
  return mergePreviewWords(WORD_RECORDS, REMOTE_WORD_RECORDS).map((item) => normalizeWordRecord(item))
}

function normalizePublishedRemoteWords(words) {
  return (Array.isArray(words) ? words : [])
    .filter((item) => item && item.status === 'published')
    .map((item) => normalizeWordRecord(item))
    .filter((item) => item.status === 'published')
}

function cacheRemoteWords(words) {
  const publishedWords = normalizePublishedRemoteWords(words)
  if (!publishedWords.length) return []
  REMOTE_WORD_RECORDS = mergePreviewWords(REMOTE_WORD_RECORDS, publishedWords)
    .map((item) => normalizeWordRecord(item))
    .filter((item) => item.status === 'published')
  return publishedWords.map((item) => cloneWord(item))
}

function createRemoteFailure(error, fallback) {
  const repositoryError = new Error(error && error.message ? error.message : 'Word API request failed.')
  repositoryError.code = error && error.code ? error.code : 'WORD_API_ERROR'
  repositoryError.statusCode = error && error.statusCode ? error.statusCode : 0
  repositoryError.remoteFailed = true
  repositoryError.fallback = Array.isArray(fallback)
    ? fallback.map((item) => cloneWord(item))
    : cloneWord(fallback)
  return repositoryError
}

function getLookupCandidates(value) {
  const raw = (value || '').trim()
  if (!raw) return []
  return [
    raw,
    raw.indexOf('word-') === 0 || raw.indexOf('node-') === 0 ? raw : `word-${raw}`,
    raw.indexOf('word-') === 0 || raw.indexOf('node-') === 0 ? raw : `node-${raw}`
  ]
}

function findWordById(records, id) {
  const targetId = (id || '').trim()
  return records.find((item) => item.id === targetId)
}

function findAnyWordByValue(value) {
  const raw = (value || '').trim()
  const candidates = getLookupCandidates(raw)
  const records = getAllWordRecords()
  for (let index = 0; index < candidates.length; index += 1) {
    const byId = findWordById(records, candidates[index])
    if (byId) return byId
  }
  const keyword = normalizeWordQuery(raw)
  return records.find((item) => item.word.toLowerCase() === keyword)
}

function clonePart(part) {
  return { ...part }
}

function cloneExample(example) {
  return { ...example }
}

function cloneVideoClip(clip) {
  return { ...clip }
}

function clonePronunciationAudio(audio) {
  return audio ? { ...audio } : {}
}

function cloneWord(word) {
  if (!word) return null
  return {
    ...word,
    parts: Array.isArray(word.parts) ? word.parts.map((part) => clonePart(part)) : [],
    examples: Array.isArray(word.examples) ? word.examples.map((item) => cloneExample(item)) : [],
    siblingIds: Array.isArray(word.siblingIds) ? [...word.siblingIds] : [],
    pronunciationAudio: clonePronunciationAudio(word.pronunciationAudio),
    audioUrl: word.audioUrl || '',
    videoSegment: word.videoSegment ? { ...word.videoSegment } : {},
    videoClips: Array.isArray(word.videoClips) ? word.videoClips.map((clip) => cloneVideoClip(clip)) : []
  }
}

export { createWordDraft, normalizeWordQuery, validateWordRecord }

export function getContentRepositoryInfo() {
  const apiBaseUrl = getWordApiBaseUrl()
  return {
    mode: CONTENT_REPOSITORY_MODE,
    remoteEnabled: Boolean(apiBaseUrl),
    apiBaseUrl,
    note: ACTIVE_DEV_PREVIEW_WORDS.length
      ? 'Development runtime reads locally synchronized preview records before bundled content.'
      : apiBaseUrl
      ? 'Runtime reads published words from the remote API and uses bundled published content only after an explicit request failure.'
      : 'Runtime reads the bundled published word collection.'
  }
}

export function listWords() {
  return getPublishedWordRecords().map((item) => cloneWord(item))
}

export function searchWords(query) {
  const keyword = normalizeWordQuery(query)
  if (!keyword) {
    return []
  }
  return getPublishedWordRecords().filter((item) => item.word.toLowerCase().includes(keyword)).map((item) => cloneWord(item))
}

export function getWordById(id) {
  const word = findWordById(getPublishedWordRecords(), id)
  return cloneWord(word)
}

export function getWordByWord(word) {
  const keyword = normalizeWordQuery(word)
  const record = getPublishedWordRecords().find((item) => item.word.toLowerCase() === keyword)
  return cloneWord(record)
}

export function getWordAccessInfo(value) {
  const record = findAnyWordByValue(value)
  return {
    exists: Boolean(record),
    published: Boolean(record && record.status === 'published'),
    status: record ? record.status : '',
    id: record ? record.id : '',
    word: record ? record.word : ''
  }
}

export function getRelatedWords(word) {
  if (!word || !Array.isArray(word.siblingIds)) {
    return []
  }
  return word.siblingIds
    .map((id) => getWordById(id))
    .filter((item) => item)
}

export function fetchWords(query) {
  if (!getWordApiBaseUrl()) {
    return Promise.resolve(searchWords(query))
  }
  return fetchServerWords(query)
    .then((words) => cacheRemoteWords(words))
    .catch((error) => {
      throw createRemoteFailure(error, searchWords(query))
    })
}

export function fetchHomepageFeaturedWord() {
  if (!getWordApiBaseUrl()) {
    return Promise.resolve({
      word: null,
      source: 'empty'
    })
  }
  return fetchServerHomepageFeaturedWord()
    .then((result) => {
      const word = result && result.word
      if (!word || word.status !== 'published') {
        return {
          word: null,
          source: 'empty'
        }
      }
      cacheRemoteWords([word])
      return {
        word: cloneWord(normalizeWordRecord(word)),
        source: String(result.source || 'dailyRotation')
      }
    })
}

export function fetchWordById(id) {
  if (!getWordApiBaseUrl()) {
    return Promise.resolve(getWordById(id))
  }
  return fetchServerWordById(id)
    .then((word) => {
      if (!word || word.status !== 'published') return null
      cacheRemoteWords([word])
      return cloneWord(normalizeWordRecord(word))
    })
    .catch((error) => {
      throw createRemoteFailure(error, getWordById(id) || getWordByWord(id))
    })
}

export function fetchWordByWord(word) {
  if (!getWordApiBaseUrl()) {
    return Promise.resolve(getWordByWord(word))
  }
  return fetchServerWords(word)
    .then((words) => {
      const remoteWords = cacheRemoteWords(words)
      const keyword = normalizeWordQuery(word)
      return remoteWords.find((item) => item.word.toLowerCase() === keyword) || null
    })
    .catch((error) => {
      throw createRemoteFailure(error, getWordByWord(word))
    })
}
