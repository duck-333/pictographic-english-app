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

const SOURCE_WORDS = mergePreviewWords(LOCAL_WORDS, DEV_PREVIEW_WORDS)

export const CONTENT_REPOSITORY_MODE = DEV_PREVIEW_WORDS.length ? 'local-preview-bridge' : 'local-mock'
export const HOT_WORDS = LOCAL_HOT_WORDS
export const TODAY_WORD_ID = LOCAL_TODAY_WORD_ID
export const NAV_ITEMS = LOCAL_NAV_ITEMS

const WORD_RECORDS = SOURCE_WORDS.map((item) => normalizeWordRecord(item))

function clonePart(part) {
  return { ...part }
}

function cloneExample(example) {
  return { ...example }
}

function cloneVideoClip(clip) {
  return { ...clip }
}

function cloneWord(word) {
  if (!word) return null
  return {
    ...word,
    parts: Array.isArray(word.parts) ? word.parts.map((part) => clonePart(part)) : [],
    examples: Array.isArray(word.examples) ? word.examples.map((item) => cloneExample(item)) : [],
    siblingIds: Array.isArray(word.siblingIds) ? [...word.siblingIds] : [],
    videoSegment: word.videoSegment ? { ...word.videoSegment } : {},
    videoClips: Array.isArray(word.videoClips) ? word.videoClips.map((clip) => cloneVideoClip(clip)) : []
  }
}

export { createWordDraft, normalizeWordQuery, validateWordRecord }

export function getContentRepositoryInfo() {
  return {
    mode: CONTENT_REPOSITORY_MODE,
    remoteEnabled: false,
    note: DEV_PREVIEW_WORDS.length
      ? 'Current MVP reads admin-synced local preview records before mock records.'
      : 'Current MVP reads local mock records through this repository facade.'
  }
}

export function listWords() {
  return WORD_RECORDS.map((item) => cloneWord(item))
}

export function searchWords(query) {
  const keyword = normalizeWordQuery(query)
  if (!keyword) {
    return []
  }
  return WORD_RECORDS.filter((item) => item.word.toLowerCase().includes(keyword)).map((item) => cloneWord(item))
}

export function getWordById(id) {
  const targetId = (id || '').trim()
  const word = WORD_RECORDS.find((item) => item.id === targetId)
  return cloneWord(word)
}

export function getWordByWord(word) {
  const keyword = normalizeWordQuery(word)
  const record = WORD_RECORDS.find((item) => item.word.toLowerCase() === keyword)
  return cloneWord(record)
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
