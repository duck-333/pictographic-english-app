import { isIP } from 'node:net'

// Process-local token buckets: counters are not shared across workers and reset
// on restart. Production use requires a verified single API process.
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
  return normalizeClientIp(req.socket && req.socket.remoteAddress) || 'unknown-peer'
}

function normalizeClientIp(value) {
  if (typeof value !== 'string' || value.includes('%')) return null
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value)
  if (mapped && isIP(mapped[1]) === 4) return mapped[1]
  if (isIP(value) === 4) return value
  if (isIP(value) === 6) {
    const canonical = new URL(`http://[${value}]`).hostname.slice(1, -1)
    const hexMapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical)
    if (hexMapped) {
      const high = parseInt(hexMapped[1], 16), low = parseInt(hexMapped[2], 16)
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
    }
    return canonical
  }
  return null
}

export function getContentClientIp(req) {
  const peer = getDirectPeerIp(req)
  // The verified Nginx upstream is 127.0.0.1:3002 and overwrites X-Real-IP.
  // Do not trust other loopback/private addresses or any X-Forwarded-For chain.
  if (peer !== '127.0.0.1') return peer
  const header = req.headers && req.headers['x-real-ip']
  return normalizeClientIp(header) || peer
}
