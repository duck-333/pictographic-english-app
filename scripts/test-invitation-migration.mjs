import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const [canonical, release] = await Promise.all([
  readFile(new URL('../database/migrations/011_create_invitation_reward_foundation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../server/migrations/011_create_invitation_reward_foundation.sql', import.meta.url), 'utf8')
])
assert.equal(canonical, release)
for (const value of [
  'candidate_subject_digest', 'active_candidate_subject_digest',
  "ENUM('CANDIDATE', 'SUPERSEDED', 'FINAL')",
  'uk_invitation_relation_active_subject', 'uk_invitation_relation_invitee',
  'uk_invitation_relation_reward_slot', 'chk_invitation_relation_compensation',
  "reward_expires_at\` = DATE_ADD(\`reward_granted_at\`, INTERVAL 1 YEAR)",
  'reward_expires_at\` IS NOT NULL', 'reward_amount\` IS NOT NULL',
  "reward_status\` = 'MANUAL_REVIEW'", 'last_error_code\` IS NOT NULL'
]) assert(canonical.includes(value), `missing schema invariant: ${value}`)
assert.doesNotMatch(canonical.replace(/^\s*--.*$/gm, ''), /^\s*(?:DROP|DELETE|UPDATE|INSERT)\b/im)
assert.doesNotMatch(canonical, /ALTER TABLE\s+`?entitlement_transactions`?|MODIFY COLUMN\s+`?(?:expires_at|created_at)`?/iu)
console.log('invitation migration static tests passed')
