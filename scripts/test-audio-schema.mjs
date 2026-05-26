import assert from 'node:assert/strict'

import {
  normalizePronunciationAudio,
  normalizeWordRecord
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
