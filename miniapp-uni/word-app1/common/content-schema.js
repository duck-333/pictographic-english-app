export const CONTENT_COLLECTIONS = Object.freeze({
  words: 'words',
  wordNodes: 'word_nodes',
  videoSegments: 'video_segments',
  feedbacks: 'feedbacks',
  userWordStates: 'user_word_states'
})

export const CONTENT_STATUS = Object.freeze({
  draft: 'draft',
  published: 'published',
  archived: 'archived'
})

export const CARD_KIND = Object.freeze({
  word: 'word',
  root: 'root',
  letter: 'letter',
  prefix: 'prefix',
  suffix: 'suffix'
})

export function normalizeWordQuery(query) {
  return (query || '').trim().toLowerCase()
}

export function isEnglishToken(value) {
  return /^[a-z][a-z'-]{0,44}$/.test(normalizeWordQuery(value))
}

export function inferCardKind(record) {
  const id = record && record.id ? record.id : ''
  const cardType = record && record.cardType ? record.cardType : ''
  const level = record && record.level ? record.level : ''
  if (cardType.indexOf('字母') >= 0 || level.indexOf('字母') >= 0) return CARD_KIND.letter
  if (cardType.indexOf('前缀') >= 0 || level.indexOf('前缀') >= 0) return CARD_KIND.prefix
  if (cardType.indexOf('后缀') >= 0 || level.indexOf('后缀') >= 0) return CARD_KIND.suffix
  if (id.indexOf('node-') === 0) return CARD_KIND.root
  return CARD_KIND.word
}

export function normalizeWordPart(part) {
  const source = part || {}
  return {
    ...source,
    text: source.text || '',
    meaning: source.meaning || '',
    targetId: source.targetId || '',
    color: source.color || '#0e3a5c',
    bgColor: source.bgColor || '#f5fbff',
    borderColor: source.borderColor || '#dbeeff'
  }
}

export function normalizeExample(example) {
  const source = example || {}
  return {
    ...source,
    english: source.english || '',
    chinese: source.chinese || ''
  }
}

export function normalizeVideoSegment(segment) {
  const source = segment || {}
  return {
    ...source,
    videoUrl: source.videoUrl || source.video_url || source.url || '',
    startSec: Number(source.startSec || source.start_sec || 0),
    endSec: Number(source.endSec || source.end_sec || 0),
    segmentTitle: source.segmentTitle || source.segment_title || source.title || '',
    provider: source.provider || '',
    assetId: source.assetId || source.asset_id || '',
    storagePath: source.storagePath || source.storage_path || '',
    fileName: source.fileName || source.file_name || '',
    mimeType: source.mimeType || source.mime_type || '',
    size: source.size || '',
    uploadStatus: source.uploadStatus || source.upload_status || '',
    uploadedAt: source.uploadedAt || source.uploaded_at || ''
  }
}

export function createWordDraft(overrides = {}) {
  const word = normalizeWordQuery(overrides.word)
  return normalizeWordRecord({
    id: overrides.id || (word ? `word-${word}` : ''),
    kind: overrides.kind || CARD_KIND.word,
    status: overrides.status || CONTENT_STATUS.draft,
    word,
    cardType: overrides.cardType || '',
    phonetic: overrides.phonetic || '',
    meaning: overrides.meaning || '',
    level: overrides.level || '',
    bookPage: Number(overrides.bookPage || 0),
    parts: overrides.parts || [],
    tip: overrides.tip || '',
    pictograph: overrides.pictograph || '',
    richTextHtml: overrides.richTextHtml || '',
    videoTitle: overrides.videoTitle || '',
    videoDuration: overrides.videoDuration || '',
    videoSegment: overrides.videoSegment || {},
    examples: overrides.examples || [],
    siblingIds: overrides.siblingIds || [],
    updatedAt: overrides.updatedAt || ''
  })
}

export function normalizeWordRecord(record) {
  const source = record || {}
  const word = normalizeWordQuery(source.word)
  const parts = Array.isArray(source.parts) ? source.parts.map((part) => normalizeWordPart(part)) : []
  const examples = Array.isArray(source.examples) ? source.examples.map((item) => normalizeExample(item)) : []
  const siblingIds = Array.isArray(source.siblingIds) ? source.siblingIds.filter((id) => id) : []

  return {
    ...source,
    id: source.id || (word ? `word-${word}` : ''),
    kind: source.kind || inferCardKind(source),
    status: source.status || CONTENT_STATUS.published,
    word,
    cardType: source.cardType || '',
    phonetic: source.phonetic || '',
    meaning: source.meaning || '',
    level: source.level || '',
    bookPage: Number(source.bookPage || 0),
    parts,
    tip: source.tip || '',
    pictograph: source.pictograph || '',
    richTextHtml: source.richTextHtml || '',
    videoTitle: source.videoTitle || (source.video && source.video.title) || '',
    videoDuration: source.videoDuration || '',
    videoSegment: normalizeVideoSegment(source.videoSegment || source.video || {}),
    examples,
    siblingIds,
    updatedAt: source.updatedAt || ''
  }
}

export function validateWordRecord(record) {
  const source = record || {}
  const normalized = normalizeWordRecord(source)
  const errors = []

  if (!source.id || !String(source.id).trim()) {
    errors.push('id is required and must be stable')
  }
  if (!source.word || !String(source.word).trim()) {
    errors.push('word is required')
  }
  if (source.word && String(source.word) !== normalized.word) {
    errors.push('word must be lowercase and trimmed')
  }
  if (!Object.values(CARD_KIND).includes(normalized.kind)) {
    errors.push(`kind must be one of: ${Object.values(CARD_KIND).join(', ')}`)
  }
  if (!Object.values(CONTENT_STATUS).includes(normalized.status)) {
    errors.push(`status must be one of: ${Object.values(CONTENT_STATUS).join(', ')}`)
  }
  if (normalized.kind === CARD_KIND.word && !isEnglishToken(normalized.word)) {
    errors.push('word must be an English token within 45 chars')
  }
  if (!normalized.meaning && !normalized.richTextHtml && !normalized.pictograph) {
    errors.push('at least one explanation field is required')
  }
  normalized.parts.forEach((part, index) => {
    if (!part.text) {
      errors.push(`parts[${index}].text is required`)
    }
  })
  if (Number.isNaN(normalized.videoSegment.startSec) || normalized.videoSegment.startSec < 0) {
    errors.push('videoSegment.startSec must be a non-negative number')
  }
  if (Number.isNaN(normalized.videoSegment.endSec) || normalized.videoSegment.endSec < 0) {
    errors.push('videoSegment.endSec must be a non-negative number')
  }
  if (normalized.videoSegment.endSec > 0 && normalized.videoSegment.startSec >= normalized.videoSegment.endSec) {
    errors.push('videoSegment.endSec must be greater than videoSegment.startSec')
  }

  return {
    ok: errors.length === 0,
    errors,
    value: normalized
  }
}
