import assert from 'node:assert/strict'
import { getWordApiBaseUrl, isDevelopmentApiBaseUrl } from '../miniapp-uni/word-app1/common/api-config.js'

const keys = ['NODE_ENV', 'VUE_APP_WORD_API_BASE_URL', 'UNI_APP_WORD_API_BASE_URL', 'WORD_API_BASE_URL']
const saved = keys.map((key) => [key, process.env[key]])
try {
  for (const key of keys) delete process.env[key]
  process.env.NODE_ENV = 'development'
  assert.equal(getWordApiBaseUrl(), 'https://sandbox.invalid')
  const invalidValues = ['', '   ', 'not-a-url', ['https://baxiaota.com'],
    ['https://sandbox.invalid'], new String('https://baxiaota.com'), {}, 42, true, false, null, undefined]
  for (const apiBaseUrl of invalidValues) {
    assert.equal(getWordApiBaseUrl({ apiBaseUrl }), 'https://sandbox.invalid')
    assert.equal(isDevelopmentApiBaseUrl(apiBaseUrl), false)
  }
  assert.equal(getWordApiBaseUrl({ apiBaseUrl: '  https://isolated.example.test///  ' }), 'https://isolated.example.test')
  process.env.VUE_APP_WORD_API_BASE_URL = 'https://configured.example.test'
  assert.equal(getWordApiBaseUrl(), 'https://configured.example.test')
  assert.equal(getWordApiBaseUrl({ apiBaseUrl: 'http://127.0.0.1:3001' }), 'http://127.0.0.1:3001')
  delete process.env.VUE_APP_WORD_API_BASE_URL
  process.env.NODE_ENV = 'production'
  assert.equal(getWordApiBaseUrl(), 'https://baxiaota.com')
  for (const apiBaseUrl of invalidValues) {
    assert.equal(getWordApiBaseUrl({ apiBaseUrl }), 'https://baxiaota.com')
  }
  // Preserve release behavior: development overrides do not redirect production.
  assert.equal(getWordApiBaseUrl({ apiBaseUrl: 'https://isolated.example.test' }), 'https://baxiaota.com')
  process.env.VUE_APP_WORD_API_BASE_URL = 'https://configured.example.test'
  assert.equal(getWordApiBaseUrl(), 'https://baxiaota.com')
} finally {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
console.log('API config: development default/invalid isolated; explicit development honored; production unchanged. No network calls.')
