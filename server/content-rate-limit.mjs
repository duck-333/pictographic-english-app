import { isIP } from 'node:net'

// Process-local implementation for local development and injected tests ONLY.
// Production wiring requires verified instance/proxy topology or a shared adapter.
export function createLocalContentRateLimiter({ now = Date.now, limits = {}, maxEntries = 10000 } = {}) {
  const policies = {
    basicIp: { ratePerMinute: 1200, capacity: 200 },
    fullIp: { ratePerMinute: 600, capacity: 100 },
    account: { ratePerMinute: 30, capacity: 10 },
    ...limits
  }
  for (const policy of Object.values(policies)) {
    if (!Number.isFinite(policy.ratePerMinute) || !Number.isFinite(policy.capacity) || !(policy.ratePerMinute > 0) || !(policy.capacity >= 1)) throw new Error('Invalid content rate limit.')
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('Invalid rate limit capacity.')
  const buckets = new Map()
  return {
    scope: 'local-process',
    consume(group, key) {
      const policy = policies[group]
      if (!policy) throw new Error('Unknown content rate group.')
      const timestamp = Number(now())
      // Idle buckets are full again and need not occupy memory.
      for (const [id, bucket] of buckets) {
        if (timestamp - bucket.updatedAt >= bucket.idleMs) buckets.delete(id)
      }
      const id = `${group}:${key}`
      let bucket = buckets.get(id)
      if (!bucket) {
        if (buckets.size >= maxEntries) return { allowed: false, retryAfter: 60 }
        bucket = { tokens: policy.capacity, updatedAt: timestamp, idleMs: Math.max(60000, policy.capacity * 60000 / policy.ratePerMinute) }
        buckets.set(id, bucket)
      }
      bucket.tokens = Math.min(policy.capacity, bucket.tokens + Math.max(0, timestamp - bucket.updatedAt) * policy.ratePerMinute / 60000)
      bucket.updatedAt = timestamp
      if (bucket.tokens < 1) return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) * 60 / policy.ratePerMinute)) }
      bucket.tokens -= 1
      return { allowed: true }
    }
  }
}

export function getDirectPeerIp(req) {
  // Forwarding headers are deliberately ignored until the proxy boundary is verified.
  const raw = String(req.socket && req.socket.remoteAddress || '')
  const value = raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4 ? raw.slice(7) : raw
  return isIP(value) ? value : 'unknown-peer'
}
