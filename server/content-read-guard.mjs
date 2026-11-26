// Conservative starting values, pending calibration against real learning data.
export const CONTENT_READ_POLICY = Object.freeze({
  windowMs: 6 * 60 * 60 * 1000,
  maxDistinct: 360,
  cooldownMs: 6 * 60 * 60 * 1000
})

export function contentReadPolicy(overrides = {}) {
  const policy = { ...CONTENT_READ_POLICY, ...overrides }
  for (const value of Object.values(policy)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid content read policy')
  }
  // Guarantees automatic recovery without immediately hitting the old window.
  if (policy.cooldownMs < policy.windowMs) throw new RangeError('Cooldown must cover the observation window')
  return Object.freeze(policy)
}

// Caller MUST hold the user_entitlements row lock until commit/rollback.
// Recording, quota deduction and cooldown are in that same transaction.
export async function guardContentRead(connection, { userId, wordId, nowMs, policy }) {
  const cutoff = nowMs - policy.windowMs
  await connection.execute('DELETE FROM content_read_words WHERE user_id = ? AND first_read_ms <= ?', [userId, cutoff])
  await connection.execute('DELETE FROM content_read_cooldowns WHERE user_id = ? AND until_ms <= ?', [userId, nowMs])
  const [seen] = await connection.execute(
    'SELECT word_id FROM content_read_words WHERE user_id = ? AND word_id = ? FOR UPDATE', [userId, wordId])
  if (seen.length) return null
  const [cooldowns] = await connection.execute(
    'SELECT until_ms FROM content_read_cooldowns WHERE user_id = ? FOR UPDATE', [userId])
  let until = Number(cooldowns[0]?.until_ms || 0)
  if (until <= nowMs) {
    const [counts] = await connection.execute(
      'SELECT COUNT(*) AS total FROM content_read_words WHERE user_id = ? AND first_read_ms > ? FOR UPDATE', [userId, cutoff])
    if (Number(counts[0].total) >= policy.maxDistinct) {
      until = nowMs + policy.cooldownMs
      await connection.execute(
        'INSERT INTO content_read_cooldowns (user_id, until_ms) VALUES (?, ?) ON DUPLICATE KEY UPDATE until_ms = VALUES(until_ms)', [userId, until])
    }
  }
  if (until > nowMs) return {
    allowed: false, reason: 'CONTENT_READ_COOLDOWN',
    retryAfter: Math.max(1, Math.ceil((until - nowMs) / 1000))
  }
  await connection.execute('INSERT INTO content_read_words (user_id, word_id, first_read_ms) VALUES (?, ?, ?)', [userId, wordId, nowMs])
  return null
}

// Run in small independent batches; never delete a live window or cooldown.
// No account lock is needed: expired rows never participate in a live decision.
export async function cleanupContentReads(connection, { nowMs = Date.now(), policy = CONTENT_READ_POLICY } = {}) {
  const [words] = await connection.execute('DELETE FROM content_read_words WHERE first_read_ms <= ? LIMIT 1000', [nowMs - policy.windowMs])
  const [cooldowns] = await connection.execute('DELETE FROM content_read_cooldowns WHERE until_ms <= ? LIMIT 1000', [nowMs])
  return { words: words.affectedRows, cooldowns: cooldowns.affectedRows }
}
