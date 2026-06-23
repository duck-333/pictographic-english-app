import fs from 'node:fs'

import { DEFAULT_DEV_ADMIN_API_TOKEN, getAdminApiToken } from '../server/auth.mjs'
import {
  PRODUCTION_WORD_API_BASE_URL,
  getWordApiBaseUrl
} from '../miniapp-uni/word-app1/common/api-config.js'
import { DEV_PREVIEW_WORDS } from '../miniapp-uni/word-app1/common/dev-preview-data.js'
import { WORDS } from '../miniapp-uni/word-app1/common/mock-data.js'
import {
  isProductionIllustrationImageUrl,
  normalizeWordRecord
} from '../miniapp-uni/word-app1/common/content-schema.js'
import {
  hasBlockedProductionMediaSource,
  isPlayableMediaUrl,
  isProductionRuntime,
  selectDevPreviewWordsForRuntime
} from '../miniapp-uni/word-app1/common/word-repository.js'

const APP_WORD_DATA_PATH = 'miniapp-uni/word-app1/common/mock-data.js'
const DEV_PREVIEW_DATA_PATH = 'miniapp-uni/word-app1/common/dev-preview-data.js'
const HOME_PAGE_PATH = 'miniapp-uni/word-app1/pages/index/index.vue'
const WORD_DETAIL_PATH = 'miniapp-uni/word-app1/pages/word-detail/index.vue'
const MINIAPP_PAGES_PATH = 'miniapp-uni/word-app1/pages'
const MINIAPP_PAGES_JSON_PATH = 'miniapp-uni/word-app1/pages.json'

const BLOCKED_PRODUCTION_VALUES = [
  { label: 'mock-cloud://', pattern: /mock-cloud:\/\//i },
  { label: 'blob:', pattern: /blob:/i },
  { label: 'data:', pattern: /data:/i },
  { label: '::1', pattern: /(\[::1\]|::1)/i },
  { label: 'localhost', pattern: /localhost/i },
  { label: '127.0.0.1', pattern: /127\.0\.0\.1/i },
  { label: 'example.com', pattern: /example\.com/i }
]

const BLOCKED_USER_FACING_TEXT = [
  { label: 'test video', pattern: /测试视频/i },
  { label: 'local mock', pattern: /本地\s*mock|local-mock/i },
  { label: 'mock cloud', pattern: /mock-cloud:\/\//i },
  { label: 'development preview', pattern: /开发预览|dev-preview/i },
  { label: 'upgrade/unlock', pattern: /升级后解锁|升级|解锁/i },
  { label: 'membership/payment', pattern: /会员|充值|兑换码|购买|付费/i },
  { label: 'admin token', pattern: /Admin API Token|dev-admin-token/i }
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

function checkUserFacingSource(errors) {
  const pagesRoot = new URL(`../${MINIAPP_PAGES_PATH}/`, import.meta.url)
  const pageFiles = fs.readdirSync(pagesRoot, { recursive: true }).filter((file) => String(file).endsWith('.vue'))

  pageFiles.forEach((file) => {
    const normalizedFile = String(file).replace(/\\/g, '/')
    const relativePath = `${MINIAPP_PAGES_PATH}/${normalizedFile}`
    const sourceText = fs.readFileSync(new URL(normalizedFile, pagesRoot), 'utf8')
    BLOCKED_USER_FACING_TEXT.forEach((blocked) => {
      if (blocked.pattern.test(sourceText)) {
        addError(errors, `${relativePath}: contains blocked user-facing ${blocked.label} text.`)
      }
    })
  })

  const pagesJson = fs.readFileSync(new URL(`../${MINIAPP_PAGES_JSON_PATH}`, import.meta.url), 'utf8')
  ;['pages/network/index', 'pages/word-list/index', 'pages/classroom/index'].forEach((route) => {
    if (pagesJson.includes(route)) {
      addError(errors, `${MINIAPP_PAGES_JSON_PATH}: unfinished route must not be registered: ${route}`)
    }
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

function checkIllustrationImageGuards(errors) {
  const cases = [
    ['https://cdn.baxiaota.com/images/study.png', true],
    ['http://cdn.baxiaota.com/images/study.png', false],
    ['https://localhost/images/study.png', false],
    ['https://127.0.0.1/images/study.png', false],
    ['https://[::1]/images/study.png', false],
    ['blob:https://cdn.baxiaota.com/id', false],
    ['data:image/png;base64,AAAA', false],
    ['mock-cloud://images/study.png', false],
    ['https://example.com/images/study.png', false]
  ]
  cases.forEach(([url, expected]) => {
    const actual = isProductionIllustrationImageUrl(url)
    if (actual !== expected) {
      addError(errors, `illustration image URL guard mismatch for ${url}: expected ${expected}, received ${actual}`)
    }
  })

  const detailSource = fs.readFileSync(new URL(`../${WORD_DETAIL_PATH}`, import.meta.url), 'utf8')
  if (!/v-if="hasIllustrationImage"[\s\S]*?id="section-illustration"/.test(detailSource)) {
    addError(errors, `${WORD_DETAIL_PATH}: illustration card must render only for a valid image.`)
  }
  if (!/uni\.previewImage\(/.test(detailSource)) {
    addError(errors, `${WORD_DETAIL_PATH}: illustration image must support previewImage.`)
  }
}

function checkApiBaseGuards(errors) {
  const developmentLocalApi = getWordApiBaseUrl({ nodeEnv: 'development', apiBaseUrl: 'http://127.0.0.1:3001' })
  const productionDefaultApi = getWordApiBaseUrl({ nodeEnv: 'production' })
  const productionLocalApi = getWordApiBaseUrl({ nodeEnv: 'production', apiBaseUrl: 'http://127.0.0.1:3001' })
  const missingEnvLocalApi = getWordApiBaseUrl({ nodeEnv: '', apiBaseUrl: 'http://127.0.0.1:3001' })
  const productionHttpsApi = getWordApiBaseUrl({ nodeEnv: 'production', apiBaseUrl: 'https://api.pictographic-english.test' })
  const originalUni = globalThis.uni

  globalThis.uni = { request() {} }
  const productionMiniappDefaultApi = getWordApiBaseUrl({ nodeEnv: 'production' })
  const productionMiniappLocalApi = getWordApiBaseUrl({ nodeEnv: 'production', apiBaseUrl: 'http://127.0.0.1:3001' })
  const productionMiniappHttpsApi = getWordApiBaseUrl({ nodeEnv: 'production', apiBaseUrl: 'https://api.pictographic-english.test' })

  if (originalUni === undefined) {
    delete globalThis.uni
  } else {
    globalThis.uni = originalUni
  }

  if (developmentLocalApi !== 'http://127.0.0.1:3001') {
    addError(errors, 'development API config must allow local/server HTTP API base URLs for testing.')
  }
  if (productionDefaultApi !== PRODUCTION_WORD_API_BASE_URL) {
    addError(errors, 'production API config must use the official HTTPS word API base URL.')
  }
  if (productionLocalApi !== PRODUCTION_WORD_API_BASE_URL) {
    addError(errors, 'production API config must ignore local HTTP overrides.')
  }
  if (missingEnvLocalApi !== PRODUCTION_WORD_API_BASE_URL) {
    addError(errors, 'missing NODE_ENV must fail closed to the official production API base URL.')
  }
  if (productionHttpsApi !== PRODUCTION_WORD_API_BASE_URL) {
    addError(errors, 'production API config must ignore non-official HTTPS overrides.')
  }
  if (productionMiniappDefaultApi !== PRODUCTION_WORD_API_BASE_URL) {
    addError(errors, 'production mini program runtime must use the official HTTPS API base URL.')
  }
  if (productionMiniappLocalApi !== PRODUCTION_WORD_API_BASE_URL) {
    addError(errors, 'production mini program runtime must ignore local HTTP API base URLs.')
  }
  if (productionMiniappHttpsApi !== PRODUCTION_WORD_API_BASE_URL) {
    addError(errors, 'production mini program runtime must ignore non-official HTTPS API base URLs.')
  }
}

function checkAdminAuthGuards(errors) {
  const productionMissingToken = getAdminApiToken({ nodeEnv: 'production', adminApiToken: '' })
  const productionDefaultToken = getAdminApiToken({
    nodeEnv: 'production',
    adminApiToken: DEFAULT_DEV_ADMIN_API_TOKEN
  })
  const productionConfiguredToken = getAdminApiToken({
    nodeEnv: 'production',
    adminApiToken: 'real-production-admin-token'
  })
  const developmentDefaultToken = getAdminApiToken({ nodeEnv: 'development', adminApiToken: '' })

  if (productionMissingToken) {
    addError(errors, 'production admin API auth must fail closed when ADMIN_API_TOKEN is missing.')
  }
  if (productionDefaultToken) {
    addError(errors, 'production admin API auth must not allow the default dev-admin-token.')
  }
  if (productionConfiguredToken !== 'real-production-admin-token') {
    addError(errors, 'production admin API auth must use a configured non-default ADMIN_API_TOKEN.')
  }
  if (developmentDefaultToken !== DEFAULT_DEV_ADMIN_API_TOKEN) {
    addError(errors, 'development admin API auth should allow the explicit dev-admin-token fallback.')
  }
}

function checkWordDetailUsesMediaGuard(errors) {
  const sourceText = fs.readFileSync(new URL(`../${WORD_DETAIL_PATH}`, import.meta.url), 'utf8')
  if (!/const\s+ENABLE_VIDEO_MODULE\s*=\s*false/.test(sourceText)) {
    addError(errors, `${WORD_DETAIL_PATH}: second-release text-only build must keep the video module disabled.`)
  }
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

function checkHomepageFeaturedGuards(errors) {
  const homeSource = fs.readFileSync(new URL(`../${HOME_PAGE_PATH}`, import.meta.url), 'utf8')
  const repositorySource = fs.readFileSync(
    new URL('../miniapp-uni/word-app1/common/word-repository.js', import.meta.url),
    'utf8'
  )
  const clientSource = fs.readFileSync(
    new URL('../miniapp-uni/word-app1/common/word-api-client.js', import.meta.url),
    'utf8'
  )
  const miniappPublicSources = [homeSource, repositorySource, clientSource].join('\n')

  if (!/fetchHomepageFeaturedWord/.test(homeSource)) {
    addError(errors, `${HOME_PAGE_PATH}: homepage must load the server-managed featured word.`)
  }
  if (/TODAY_WORD_ID|initialTodayWord|word-study/.test(homeSource)) {
    addError(errors, `${HOME_PAGE_PATH}: homepage must not keep the old static study recommendation.`)
  }
  if (!/\/api\/homepage\/featured-word/.test(clientSource)) {
    addError(errors, 'word-api-client.js: homepage featured request must use the public featured endpoint.')
  }
  if (!/fetchHomepageFeaturedWord\(\)[\s\S]*?word\.status\s*!==\s*['"]published['"]/.test(repositorySource)) {
    addError(errors, 'word-repository.js: homepage featured words must be filtered to published status.')
  }
  if (/\/api\/admin\//.test(miniappPublicSources)) {
    addError(errors, 'mini program public code must not call admin APIs.')
  }
}

function main() {
  const errors = []

  checkDevPreviewData(errors)
  checkPublishedWords(errors)
  checkUserFacingSource(errors)
  checkMediaGuards(errors)
  checkIllustrationImageGuards(errors)
  checkApiBaseGuards(errors)
  checkAdminAuthGuards(errors)
  checkWordDetailUsesMediaGuard(errors)
  checkHomepageFeaturedGuards(errors)

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
  console.log('- illustration images allow production HTTPS URLs only')
  console.log(`- production runtime uses ${PRODUCTION_WORD_API_BASE_URL}`)
  console.log('- production admin API auth rejects empty/default tokens')
  console.log('- homepage featured word uses the public API with published filtering')
}

main()
