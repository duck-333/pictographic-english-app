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
  unpublished: 'unpublished',
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
    text: source.text || source.label || '',
    meaning: source.meaning || source.title || '',
    targetId: source.targetId || '',
    color: source.color || '',
    bgColor: source.bgColor || '',
    borderColor: source.borderColor || ''
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

function normalizeStringField(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getHttpsHostname(value) {
  const normalized = normalizeStringField(value)
  if (!normalized || /\s/.test(normalized)) return ''
  const match = normalized.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i)
  if (!match) return ''
  const authority = match[1].split('@').pop() || ''
  if (authority.startsWith('[')) {
    const closingIndex = authority.indexOf(']')
    return closingIndex > -1
      ? authority.slice(1, closingIndex).toLowerCase()
      : ''
  }
  return authority.split(':')[0].replace(/\.$/, '').toLowerCase()
}

export function isProductionIllustrationImageUrl(value) {
  const hostname = getHttpsHostname(value)
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '::1') return false
  if (hostname === 'example.com' || hostname.endsWith('.example.com')) return false
  const octets = hostname.split('.')
  if (octets.length === 4 && octets.every((item) => /^\d{1,3}$/.test(item))) {
    return Number(octets[0]) !== 127
  }
  return true
}

export function normalizeIllustrationImage(image) {
  const source = image && typeof image === 'object' && !Array.isArray(image) ? image : {}
  const rawUrl = typeof source.url === 'string' ? source.url.trim() : ''
  const url = rawUrl && isProductionIllustrationImageUrl(rawUrl) ? rawUrl : ''
  const normalized = {
    url,
    title: normalizeStringField(source.title),
    alt: normalizeStringField(source.alt),
    provider: normalizeStringField(source.provider),
    assetId: normalizeStringField(source.assetId || source.asset_id),
    uploadStatus: normalizeStringField(source.uploadStatus || source.upload_status),
    uploadedAt: normalizeStringField(source.uploadedAt || source.uploaded_at)
  }
  return Object.values(normalized).some((value) => value) ? normalized : {}
}

export function normalizeVideoSegment(segment) {
  const source = segment || {}
  const segmentTitle = source.segmentTitle || source.segment_title || source.title || ''
  return {
    ...source,
    clipId: source.clipId || source.clip_id || source.id || '',
    videoUrl: source.videoUrl || source.video_url || source.url || '',
    startSec: Number(source.startSec || source.start_sec || 0),
    endSec: Number(source.endSec || source.end_sec || 0),
    segmentTitle,
    title: source.title || segmentTitle,
    focus: source.focus || '',
    targetPart: source.targetPart || source.target_part || '',
    note: source.note || '',
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

export function normalizePronunciationAudio(audio) {
  const source = audio || {}
  const audioUrl = source.audioUrl || source.audio_url || source.url || ''
  const duration = Number(source.durationSec || source.duration_sec || 0)
  return hasPronunciationAudioPayload({
    ...source,
    audioUrl,
    url: audioUrl,
    durationSec: duration
  })
    ? {
        ...source,
        url: audioUrl,
        audioUrl,
        provider: source.provider || '',
        assetId: source.assetId || source.asset_id || '',
        storagePath: source.storagePath || source.storage_path || '',
        fileName: source.fileName || source.file_name || '',
        mimeType: source.mimeType || source.mime_type || '',
        size: source.size || '',
        durationSec: Number.isNaN(duration) ? 0 : duration,
        uploadStatus: source.uploadStatus || source.upload_status || '',
        uploadedAt: source.uploadedAt || source.uploaded_at || ''
      }
    : {}
}

function hasPronunciationAudioPayload(audio) {
  return Boolean(
    audio.url ||
      audio.audioUrl ||
      audio.assetId ||
      audio.storagePath ||
      audio.fileName ||
      audio.mimeType ||
      audio.size ||
      audio.durationSec > 0
  )
}

function hasVideoSegmentPayload(segment) {
  return Boolean(
    segment.videoUrl ||
      segment.assetId ||
      segment.storagePath ||
      segment.segmentTitle ||
      segment.focus ||
      segment.targetPart ||
      segment.note ||
      segment.startSec > 0 ||
      segment.endSec > 0
  )
}

export function normalizeVideoClips(recordOrClips) {
  const source = recordOrClips || {}
  const rawClips = Array.isArray(recordOrClips)
    ? recordOrClips
    : Array.isArray(source.videoClips)
      ? source.videoClips
      : Array.isArray(source.video_clips)
        ? source.video_clips
        : []

  const clips = rawClips
    .map((clip, index) => {
      const normalized = normalizeVideoSegment(clip)
      return {
        ...normalized,
        clipId: normalized.clipId || `clip-${index + 1}`
      }
    })
    .filter((clip) => hasVideoSegmentPayload(clip))

  if (clips.length || Array.isArray(recordOrClips)) {
    return clips
  }

  const legacyClip = normalizeVideoSegment(source.videoSegment || source.video || {})
  if (!hasVideoSegmentPayload(legacyClip)) {
    return []
  }

  return [
    {
      ...legacyClip,
      clipId: legacyClip.clipId || 'clip-1'
    }
  ]
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
    illustrationImage: overrides.illustrationImage || {},
    pronunciationAudio: overrides.pronunciationAudio || {},
    audioUrl: overrides.audioUrl || '',
    videoSegment: overrides.videoSegment || {},
    videoClips: overrides.videoClips || [],
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
  const videoClips = normalizeVideoClips(source)
  const videoSegment = videoClips.length
    ? normalizeVideoSegment(videoClips[0])
    : normalizeVideoSegment(source.videoSegment || source.video || {})
  const pronunciationAudio = normalizePronunciationAudio(
    source.pronunciationAudio ||
      source.pronunciation_audio ||
      source.audio ||
      {
        url: source.audioUrl || source.audio_url || source.pronunciationAudioUrl || source.pronunciation_audio_url || ''
      }
  )
  const illustrationImage = normalizeIllustrationImage(
    source.illustrationImage ||
      source.illustration_image ||
      {}
  )

  return {
    ...source,
    id: source.id || (word ? `word-${word}` : ''),
    kind: source.kind || inferCardKind(source),
    status: source.status || CONTENT_STATUS.draft,
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
    illustrationImage,
    pronunciationAudio,
    audioUrl: pronunciationAudio.url || '',
    videoTitle: source.videoTitle || (source.video && source.video.title) || '',
    videoDuration: source.videoDuration || '',
    videoSegment,
    videoClips,
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
  const rawIllustrationImage = source.illustrationImage || source.illustration_image
  if (rawIllustrationImage !== undefined && rawIllustrationImage !== null) {
    if (typeof rawIllustrationImage !== 'object' || Array.isArray(rawIllustrationImage)) {
      errors.push('illustrationImage must be an object')
    } else if (
      rawIllustrationImage.url !== undefined &&
      rawIllustrationImage.url !== null &&
      typeof rawIllustrationImage.url !== 'string'
    ) {
      errors.push('illustrationImage.url must be a string')
    } else {
      const rawIllustrationUrl = normalizeStringField(rawIllustrationImage.url)
      if (rawIllustrationUrl && !isProductionIllustrationImageUrl(rawIllustrationUrl)) {
        errors.push('illustrationImage.url must be a production HTTPS URL')
      }
    }
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
  normalized.videoClips.forEach((clip, index) => {
    if (Number.isNaN(clip.startSec) || clip.startSec < 0) {
      errors.push(`videoClips[${index}].startSec must be a non-negative number`)
    }
    if (Number.isNaN(clip.endSec) || clip.endSec < 0) {
      errors.push(`videoClips[${index}].endSec must be a non-negative number`)
    }
    if (clip.endSec > 0 && clip.startSec >= clip.endSec) {
      errors.push(`videoClips[${index}].endSec must be greater than startSec`)
    }
  })

  return {
    ok: errors.length === 0,
    errors,
    value: normalized
  }
}
