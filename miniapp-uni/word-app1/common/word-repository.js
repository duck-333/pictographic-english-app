import {
  HOT_WORDS as LOCAL_HOT_WORDS,
  NAV_ITEMS as LOCAL_NAV_ITEMS,
  TODAY_WORD_ID as LOCAL_TODAY_WORD_ID,
  WORDS as LOCAL_WORDS
} from './mock-data.js'
import { DEV_PREVIEW_WORDS } from './dev-preview-data.js'
import { createWordDraft, normalizeWordQuery, normalizeWordRecord, validateWordRecord } from './content-schema.js'

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

function getNodeEnv() {
  if (typeof process === 'undefined' || !process || !process.env) return ''
  return String(process.env.NODE_ENV || '').toLowerCase()
}

export function isProductionRuntime() {
  return getNodeEnv() === 'production'
}

export function selectDevPreviewWordsForRuntime(previewWords = DEV_PREVIEW_WORDS, production = isProductionRuntime()) {
  if (production) return []
  return Array.isArray(previewWords) ? previewWords : []
}

function normalizeMediaUrl(url) {
  return String(url || '').trim()
}

export function isLocalPreviewMediaUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?([/?#]|$)/i.test(normalizeMediaUrl(url))
}

export function hasBlockedProductionMediaSource(url) {
  const value = normalizeMediaUrl(url)
  return (
    isLocalPreviewMediaUrl(value) ||
    /^mock-cloud:\/\//i.test(value) ||
    /example\.com/i.test(value)
  )
}

function isCloudOrHttpsMediaUrl(url) {
  const value = normalizeMediaUrl(url)
  return /^https:\/\//i.test(value) || /^cloud:\/\//i.test(value)
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

export const CONTENT_REPOSITORY_MODE = ACTIVE_DEV_PREVIEW_WORDS.length ? 'local-preview-bridge' : 'local-mock'
export const HOT_WORDS = LOCAL_HOT_WORDS
export const TODAY_WORD_ID = LOCAL_TODAY_WORD_ID
export const NAV_ITEMS = LOCAL_NAV_ITEMS

const WORD_RECORDS = SOURCE_WORDS.map((item) => normalizeWordRecord(item))
const PUBLISHED_WORD_RECORDS = WORD_RECORDS.filter((item) => item.status === 'published')

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
  for (let index = 0; index < candidates.length; index += 1) {
    const byId = findWordById(WORD_RECORDS, candidates[index])
    if (byId) return byId
  }
  const keyword = normalizeWordQuery(raw)
  return WORD_RECORDS.find((item) => item.word.toLowerCase() === keyword)
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
  return {
    mode: CONTENT_REPOSITORY_MODE,
    remoteEnabled: false,
    note: isProductionRuntime()
      ? 'Production runtime ignores local preview bridge records.'
      : ACTIVE_DEV_PREVIEW_WORDS.length
      ? 'Current MVP reads admin-synced local preview records before mock records.'
      : 'Current MVP reads local mock records through this repository facade.'
  }
}

export function listWords() {
  return PUBLISHED_WORD_RECORDS.map((item) => cloneWord(item))
}

export function searchWords(query) {
  const keyword = normalizeWordQuery(query)
  if (!keyword) {
    return []
  }
  return PUBLISHED_WORD_RECORDS.filter((item) => item.word.toLowerCase().includes(keyword)).map((item) => cloneWord(item))
}

export function getWordById(id) {
  const word = findWordById(PUBLISHED_WORD_RECORDS, id)
  return cloneWord(word)
}

export function getWordByWord(word) {
  const keyword = normalizeWordQuery(word)
  const record = PUBLISHED_WORD_RECORDS.find((item) => item.word.toLowerCase() === keyword)
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
  return Promise.resolve(searchWords(query))
}

export function fetchWordById(id) {
  return Promise.resolve(getWordById(id))
}

export function fetchWordByWord(word) {
  return Promise.resolve(getWordByWord(word))
}
