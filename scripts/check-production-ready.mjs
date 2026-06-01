import fs from 'node:fs'

import { DEV_PREVIEW_WORDS } from '../miniapp-uni/word-app1/common/dev-preview-data.js'
import { WORDS } from '../miniapp-uni/word-app1/common/mock-data.js'
import { normalizeWordRecord } from '../miniapp-uni/word-app1/common/content-schema.js'
import {
  isPlayableMediaUrl,
  selectDevPreviewWordsForRuntime
} from '../miniapp-uni/word-app1/common/word-repository.js'

const APP_WORD_DATA_PATH = 'miniapp-uni/word-app1/common/mock-data.js'
const DEV_PREVIEW_DATA_PATH = 'miniapp-uni/word-app1/common/dev-preview-data.js'
const WORD_DETAIL_PATH = 'miniapp-uni/word-app1/pages/word-detail/index.vue'

const BLOCKED_PRODUCTION_VALUES = [
  { label: 'mock-cloud://', pattern: /mock-cloud:\/\//i },
  { label: 'localhost', pattern: /localhost/i },
  { label: '127.0.0.1', pattern: /127\.0\.0\.1/i },
  { label: 'example.com', pattern: /example\.com/i }
]

function collectStrings(value, pathParts = []) {
  if (typeof value === 'string') {
    return [{ value, path: pathParts.join('.') || '<root>' }]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStrings(item, [...pathParts, `[${index}]`]))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => collectStrings(item, [...pathParts, key]))
  }
  return []
}

function findLineHint(sourceText, needle) {
  if (!needle) return ''
  const lineIndex = sourceText.split(/\r?\n/).findIndex((line) => line.includes(needle))
  return lineIndex >= 0 ? `:${lineIndex + 1}` : ''
}

function addError(errors, message) {
  errors.push(message)
}

function checkDevPreviewData(errors) {
  if (!Array.isArray(DEV_PREVIEW_WORDS)) {
    addError(errors, `${DEV_PREVIEW_DATA_PATH}: DEV_PREVIEW_WORDS must be an array.`)
    return
  }

  if (DEV_PREVIEW_WORDS.length > 0) {
    addError(errors, `${DEV_PREVIEW_DATA_PATH}: DEV_PREVIEW_WORDS must stay empty before production release.`)
  }

  const fakePreviewWords = [{ id: 'word-preview-only', word: 'previewonly', status: 'published' }]
  const productionPreviewWords = selectDevPreviewWordsForRuntime(fakePreviewWords, true)
  const developmentPreviewWords = selectDevPreviewWordsForRuntime(fakePreviewWords, false)

  if (productionPreviewWords.length !== 0) {
    addError(errors, `${DEV_PREVIEW_DATA_PATH}: production runtime must ignore non-empty preview words.`)
  }
  if (developmentPreviewWords.length !== fakePreviewWords.length) {
    addError(errors, `${DEV_PREVIEW_DATA_PATH}: development runtime must keep preview words for local bridge testing.`)
  }
}

function checkPublishedWords(errors) {
  const sourceText = fs.readFileSync(new URL(`../${APP_WORD_DATA_PATH}`, import.meta.url), 'utf8')

  WORDS.map((word) => normalizeWordRecord(word)).forEach((word) => {
    if (word.status !== 'published') return

    collectStrings(word).forEach((entry) => {
      BLOCKED_PRODUCTION_VALUES.forEach((blocked) => {
        if (!blocked.pattern.test(entry.value)) return
        const lineHint = findLineHint(sourceText, entry.value)
        addError(
          errors,
          `${APP_WORD_DATA_PATH}${lineHint}: published word "${word.word}" has blocked production value at ${entry.path}: ${blocked.label}`
        )
      })
    })
  })
}

function checkMediaGuards(errors) {
  const productionCases = [
    ['http://127.0.0.1:8787/videos/study.mp4', false],
    ['http://localhost:8787/audios/study.mp3', false],
    ['https://127.0.0.1/videos/study.mp4', false],
    ['https://localhost/audios/study.mp3', false],
    ['mock-cloud://videos/study.mp4', false],
    ['https://example.com/videos/study.mp4', false],
    ['https://cdn.pictographic-english.test/videos/study.mp4', true]
  ]

  productionCases.forEach(([url, expected]) => {
    const actual = isPlayableMediaUrl(url, { production: true })
    if (actual !== expected) {
      addError(errors, `production media guard mismatch for ${url}: expected ${expected}, received ${actual}`)
    }
  })

  const localPreviewAllowed = isPlayableMediaUrl('http://127.0.0.1:8787/videos/study.mp4', { production: false })
  if (!localPreviewAllowed) {
    addError(errors, 'development media guard must allow local preview bridge URLs.')
  }
}

function checkWordDetailUsesMediaGuard(errors) {
  const sourceText = fs.readFileSync(new URL(`../${WORD_DETAIL_PATH}`, import.meta.url), 'utf8')
  if (!sourceText.includes('isPlayableMediaUrl')) {
    addError(errors, `${WORD_DETAIL_PATH}: word detail page must use the shared production media guard.`)
  }
  if (/isLocalBridgeVideo|127\\\.0\\\.0\\\.1\|localhost/.test(sourceText)) {
    addError(errors, `${WORD_DETAIL_PATH}: word detail page must not keep local preview playback regexes outside the shared guard.`)
  }
}

function main() {
  const errors = []

  checkDevPreviewData(errors)
  checkPublishedWords(errors)
  checkMediaGuards(errors)
  checkWordDetailUsesMediaGuard(errors)

  if (errors.length > 0) {
    console.error('Production readiness check failed')
    errors.forEach((message) => console.error(`- ${message}`))
    process.exitCode = 1
    return
  }

  console.log('Production readiness check passed')
  console.log('- dev-preview-data.js is an empty fallback')
  console.log('- production runtime ignores local preview words')
  console.log('- published words do not contain blocked preview URLs')
  console.log('- production media guard blocks local/mock/example URLs')
}

main()
