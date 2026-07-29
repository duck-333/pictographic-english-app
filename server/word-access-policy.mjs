function cloneObject(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function setIfPresent(target, key, value) {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && !value.trim()) return
  if (isPlainObject(value) && Object.keys(value).length === 0) return
  target[key] = value
}

function normalizeBasicIllustrationImage(value) {
  const source = isPlainObject(value) ? value : {}
  const image = {}
  setIfPresent(image, 'url', normalizeString(source.url))
  setIfPresent(image, 'title', normalizeString(source.title))
  setIfPresent(image, 'alt', normalizeString(source.alt))
  setIfPresent(image, 'provider', normalizeString(source.provider))
  setIfPresent(image, 'uploadStatus', normalizeString(source.uploadStatus || source.upload_status))
  setIfPresent(image, 'uploadedAt', normalizeString(source.uploadedAt || source.uploaded_at))
  return image
}

function normalizeBasicPronunciationAudio(value, word = {}) {
  const source = isPlainObject(value) ? value : {}
  const audioUrl = normalizeString(source.audioUrl || source.audio_url || source.url || word.audioUrl || word.audio_url)
  if (!audioUrl) return {}

  const audio = {
    url: audioUrl,
    audioUrl
  }
  setIfPresent(audio, 'durationSec', normalizeOptionalNumber(source.durationSec || source.duration_sec))
  setIfPresent(audio, 'provider', normalizeString(source.provider))
  setIfPresent(audio, 'uploadedAt', normalizeString(source.uploadedAt || source.uploaded_at))
  return audio
}

export function createAccessPayload(options = {}) {
  const canAccessFull = Boolean(options.canAccessFull)
  const charged = Boolean(options.charged)
  const membershipActive = Boolean(options.membershipActive)
  const remainingQuota = normalizeOptionalNumber(options.remainingQuota)

  return {
    level: canAccessFull ? 'full' : 'basic',
    canAccessFull,
    reason: options.reason === undefined ? null : options.reason,
    charged,
    chargeAmount: charged ? normalizeNumber(options.chargeAmount, 1) : 0,
    remainingQuota,
    membershipActive,
    membershipType: normalizeString(options.membershipType) || 'none',
    membershipExpireAt: options.membershipExpireAt || null
  }
}

export function toBasicWord(sourceWord, accessOptions = {}) {
  const source = cloneObject(sourceWord)
  const word = {
    id: source.id,
    word: source.word,
    meaning: source.meaning || source.basicMeaning || source.basic_meaning || '',
    basicMeaning: source.basicMeaning || source.basic_meaning || source.meaning || '',
    phonetic: source.phonetic || '',
    level: source.level || '',
    group: source.group || '',
    status: source.status || '',
    cardType: source.cardType || source.card_type || '',
    bookPage: source.bookPage || source.book_page || '',
    image: normalizeString(source.image),
    intro: source.intro || '',
    updatedAt: source.updatedAt || source.updated_at || '',
    access: createAccessPayload({
      canAccessFull: false,
      ...accessOptions
    })
  }

  const illustrationImage = normalizeBasicIllustrationImage(source.illustrationImage || source.illustration_image)
  const pronunciationAudio = normalizeBasicPronunciationAudio(
    source.pronunciationAudio || source.pronunciation_audio || source.audio,
    source
  )
  setIfPresent(word, 'illustrationImage', illustrationImage)
  setIfPresent(word, 'pronunciationAudio', pronunciationAudio)
  setIfPresent(word, 'audioUrl', pronunciationAudio.audioUrl)

  return word
}

export function toFullWord(sourceWord, accessOptions = {}) {
  const word = cloneObject(sourceWord)
  word.access = createAccessPayload({
    canAccessFull: true,
    ...accessOptions
  })
  return word
}
