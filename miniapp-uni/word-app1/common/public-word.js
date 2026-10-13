// This projection also runs AFTER normalization. Defaults and cache merges must
// never promote a public record into an authorized detail response.
export function toPublicWord(source = {}) {
  const word = {}
  const fields = ['id', 'word', 'phonetic', 'level', 'group', 'status', 'cardType', 'bookPage', 'image', 'updatedAt']
  fields.forEach((key) => { if (source[key] !== undefined) word[key] = source[key] })
  word.meaning = source.basicMeaning || source.basic_meaning || source.meaning || ''
  word.basicMeaning = word.meaning
  if (source.pronunciationAudio) {
    word.pronunciationAudio = {}
    ;['url', 'audioUrl', 'durationSec', 'provider', 'uploadedAt'].forEach((key) => {
      if (source.pronunciationAudio[key] !== undefined) word.pronunciationAudio[key] = source.pronunciationAudio[key]
    })
  }
  if (source.audioUrl) word.audioUrl = source.audioUrl
  const access = source.access || {}
  word.access = {
    level: 'basic', canAccessFull: false, charged: false, chargeAmount: 0,
    reason: access.canAccessFull ? 'LOGIN_REQUIRED' : access.reason || 'LOGIN_REQUIRED',
    remainingQuota: access.remainingQuota == null ? null : access.remainingQuota,
    membershipActive: false
  }
  return word
}
