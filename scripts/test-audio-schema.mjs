import assert from 'node:assert/strict'

import {
  isProductionIllustrationImageUrl,
  normalizeIllustrationImage,
  normalizePronunciationAudio,
  normalizeWordRecord,
  validateWordRecord
} from '../miniapp-uni/word-app1/common/content-schema.js'

const audio = normalizePronunciationAudio({
  audio_url: 'https://cdn.example.com/study.mp3',
  file_name: 'study.mp3',
  mime_type: 'audio/mpeg',
  duration_sec: '1.4',
  asset_id: 'audio-study'
})

assert.equal(audio.url, 'https://cdn.example.com/study.mp3')
assert.equal(audio.audioUrl, 'https://cdn.example.com/study.mp3')
assert.equal(audio.fileName, 'study.mp3')
assert.equal(audio.mimeType, 'audio/mpeg')
assert.equal(audio.durationSec, 1.4)
assert.equal(audio.assetId, 'audio-study')

const word = normalizeWordRecord({
  id: 'word-study',
  word: 'study',
  meaning: '学习',
  pronunciation_audio: audio
})

assert.equal(word.pronunciationAudio.url, 'https://cdn.example.com/study.mp3')
assert.equal(word.audioUrl, 'https://cdn.example.com/study.mp3')

const wordWithoutAudio = normalizeWordRecord({
  id: 'word-empty',
  word: 'empty',
  meaning: '空'
})

assert.deepEqual(wordWithoutAudio.pronunciationAudio, {})
assert.equal(wordWithoutAudio.audioUrl, '')

const illustration = normalizeIllustrationImage({
  url: 'https://cdn.baxiaota.com/images/study.png',
  title: ' study illustration ',
  alt: ' study visual ',
  provider: 'cos',
  asset_id: 'images/study.png',
  upload_status: 'ready',
  uploaded_at: '2026-06-23T00:00:00.000Z'
})

assert.equal(illustration.url, 'https://cdn.baxiaota.com/images/study.png')
assert.equal(illustration.title, 'study illustration')
assert.equal(illustration.alt, 'study visual')
assert.equal(illustration.provider, 'cos')
assert.equal(illustration.assetId, 'images/study.png')
assert.equal(illustration.uploadStatus, 'ready')

assert.equal(isProductionIllustrationImageUrl('https://cdn.baxiaota.com/image.png'), true)
assert.equal(isProductionIllustrationImageUrl('http://cdn.baxiaota.com/image.png'), false)
assert.equal(isProductionIllustrationImageUrl('https://localhost/image.png'), false)
assert.equal(isProductionIllustrationImageUrl('https://127.0.0.1/image.png'), false)
assert.equal(isProductionIllustrationImageUrl('blob:https://cdn.baxiaota.com/id'), false)
assert.equal(isProductionIllustrationImageUrl('data:image/png;base64,AAAA'), false)
assert.equal(isProductionIllustrationImageUrl('https://example.com/image.png'), false)

const wordWithIllustration = normalizeWordRecord({
  id: 'word-illustration',
  word: 'illustration',
  status: 'published',
  meaning: 'illustration test',
  illustrationImage: illustration
})
assert.equal(wordWithIllustration.illustrationImage.url, illustration.url)

const invalidIllustrationValidation = validateWordRecord({
  id: 'word-invalidimage',
  word: 'invalidimage',
  status: 'published',
  meaning: 'invalid illustration test',
  illustrationImage: {
    url: 'http://localhost/image.png'
  }
})
assert.equal(invalidIllustrationValidation.ok, false)
assert(
  invalidIllustrationValidation.errors.some((message) => message.includes('production HTTPS URL'))
)
