import fs from 'node:fs'

import { DEV_PREVIEW_WORDS } from '../miniapp-uni/word-app1/common/dev-preview-data.js'
import { WORDS } from '../miniapp-uni/word-app1/common/mock-data.js'
import { normalizeWordRecord } from '../miniapp-uni/word-app1/common/content-schema.js'
import {
  hasBlockedProductionMediaSource,
  isPlayableMediaUrl,
  isProductionRuntime,
  selectDevPreviewWordsForRuntime
} from '../miniapp-uni/word-app1/common/word-repository.js'

const APP_WORD_DATA_PATH = 'miniapp-uni/word-app1/common/mock-data.js'
const DEV_PREVIEW_DATA_PATH = 'miniapp-uni/word-app1/common/dev-preview-data.js'
const WORD_DETAIL_PATH = 'miniapp-uni/word-app1/pages/word-detail/index.vue'

const BLOCKED_PRODUCTION_VALUES = [
  { label: 'mock-cloud://', pattern: /mock-cloud:\/\//i },
  { label: 'blob:', pattern: /blob:/i },
  { label: 'data:', pattern: /data:/i },
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
  const missingEnvPreviewWords = selectDevPreviewWordsForRuntime(fakePreviewWords, isProductionRuntime({ nodeEnv: '' }))

  const runtimeCases = [
    [{ nodeEnv: '' }, true, 'missing NODE_ENV'],
    [{ nodeEnv: 'production' }, true, 'production NODE_ENV'],
    [{ nodeEnv: 'test' }, true, 'non-development NODE_ENV'],
    [{ nodeEnv: 'development' }, false, 'development NODE_ENV']
  ]

  if (productionPreviewWords.length !== 0) {
    addError(errors, `${DEV_PREVIEW_DATA_PATH}: production runtime must ignore non-empty preview words.`)
  }
  if (developmentPreviewWords.length !== fakePreviewWords.length) {
    addError(errors, `${DEV_PREVIEW_DATA_PATH}: development runtime must keep preview words for local bridge testing.`)
  }
  if (missingEnvPreviewWords.length !== 0) {
    addError(errors, `${DEV_PREVIEW_DATA_PATH}: missing NODE_ENV must fail closed and ignore local preview words.`)
  }
  runtimeCases.forEach(([options, expected, label]) => {
    const actual = isProductionRuntime(options)
    if (actual !== expected) {
      addError(errors, `${DEV_PREVIEW_DATA_PATH}: ${label} production runtime mismatch: expected ${expected}, received ${actual}`)
    }
  })
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
    ['http://127.0.0.1:8787/videos/study.mp4', false, true],
    ['http://127.42.0.8:8787/videos/study.mp4', false, true],
    ['http://localhost:8787/audios/study.mp3', false, true],
    ['https://127.0.0.1/videos/study.mp4', false, true],
    ['https://user@127.0.0.1/videos/study.mp4', false, true],
    ['https://localhost/audios/study.mp3', false, true],
    ['https://user@localhost/audios/study.mp3', false, true],
    ['https://[::1]/videos/study.mp4', false, true],
    ['mock-cloud://videos/study.mp4', false, true],
    ['blob:http://localhost:8787/videos/study.mp4', false, true],
    ['data:video/mp4;base64,AAAA', false, true],
    ['https://example.com/videos/study.mp4', false, true],
    ['not a media url', false, true],
    ['ftp://cdn.pictographic-english.test/videos/study.mp4', false, false],
    ['https://cdn.pictographic-english.test/videos/study.mp4', true, false]
  ]

  productionCases.forEach(([url, expectedPlayable, expectedBlocked]) => {
    const actualPlayable = isPlayableMediaUrl(url, { production: true })
    const actualBlocked = hasBlockedProductionMediaSource(url)
    if (actualPlayable !== expectedPlayable) {
      addError(errors, `production media guard mismatch for ${url}: expected ${expectedPlayable}, received ${actualPlayable}`)
    }
    if (actualBlocked !== expectedBlocked) {
      addError(errors, `production blocked-source guard mismatch for ${url}: expected ${expectedBlocked}, received ${actualBlocked}`)
    }
  })

  const localPreviewAllowed = isPlayableMediaUrl('http://127.0.0.1:8787/videos/study.mp4', { production: false })
  if (!localPreviewAllowed) {
    addError(errors, 'development media guard must allow local preview bridge URLs.')
  }

  const missingEnvLocalPreviewAllowed = isPlayableMediaUrl('http://127.0.0.1:8787/videos/study.mp4')
  if (missingEnvLocalPreviewAllowed) {
    addError(errors, 'media guard must fail closed and block local preview bridge URLs when NODE_ENV is missing.')
  }
}

function checkWordDetailUsesMediaGuard(errors) {
  const sourceText = fs.readFileSync(new URL(`../${WORD_DETAIL_PATH}`, import.meta.url), 'utf8')
  if (!/hasPlayableVideo\(\)\s*\{[\s\S]*?return\s+isPlayableMediaUrl\(this\.activeVideoUrl\)\s*&&\s*this\.activeClipHasValidRange[\s\S]*?\}/.test(sourceText)) {
    addError(errors, `${WORD_DETAIL_PATH}: hasPlayableVideo must use the shared production media guard for activeVideoUrl.`)
  }
  if (!/isPlayableAudioUrl\(url\)\s*\{[\s\S]*?return\s+isPlayableMediaUrl\(url\)[\s\S]*?\}/.test(sourceText)) {
    addError(errors, `${WORD_DETAIL_PATH}: isPlayableAudioUrl must delegate to the shared production media guard.`)
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
  console.log('- production media guard blocks local/mock/blob/data/example URLs')
}

main()
