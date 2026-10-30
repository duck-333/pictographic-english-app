import { isIP } from 'node:net'
import { createHmac, randomBytes } from 'node:crypto'

// Per-group exact buckets plus bounded spill buckets. Exact keys are never
// evicted/promoted: neither churn nor expiry can reset an exhausted spill key.
// Spill collisions share a budget conservatively; they never grant extra tokens.
// Process-local only: counters reset on restart and are not shared by workers.
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
  const groups = new Map(Object.entries(policies).map(([name, policy]) => [name, { policy, exact: new Map(), spill: new Map() }]))
  // A per-instance secret makes deliberate targeting of another spill slot harder.
  const secret = randomBytes(32)
  return {
    scope: 'local-process',
    consume(group, key) {
      const state = groups.get(group)
      if (!state) throw new Error('Unknown content rate group.')
      const { policy, exact, spill } = state
      const timestamp = Number(now())
      const identity = group === 'basicIp' || group === 'fullIp' ? getIpBucketKey(key) : String(key)
      let bucket = exact.get(identity)
      if (!bucket) {
        if (exact.size < maxEntries) {
          bucket = { tokens: policy.capacity, updatedAt: timestamp }
          exact.set(identity, bucket)
        } else {
          const slot = createHmac('sha256', secret).update(group).update('\0').update(identity).digest().readUInt32BE(0) % maxEntries
          bucket = spill.get(slot)
          if (!bucket) {
            bucket = { tokens: policy.capacity, updatedAt: timestamp }
            spill.set(slot, bucket)
          }
        }
      }
      bucket.tokens = Math.min(policy.capacity, bucket.tokens + Math.max(0, timestamp - bucket.updatedAt) * policy.ratePerMinute / 60000)
      bucket.updatedAt = Math.max(bucket.updatedAt, timestamp)
      if (bucket.tokens < 1) return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) * 60 / policy.ratePerMinute)) }
      bucket.tokens -= 1
      return { allowed: true }
    }
  }
}

// IPv6 privacy-address rotation inside one /64 shares the existing IP policy.
// This does not change which proxy header is trusted; mapped IPv4 remains IPv4.
function getIpBucketKey(key) {
  const normalized = normalizeClientIp(key)
  if (!normalized || isIP(normalized) !== 6) return normalized || String(key)
  const [left, right] = normalized.split('::')
  const head = left ? left.split(':') : []
  const tail = right ? right.split(':') : []
  const words = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
  return words.slice(0, 4).map(word => parseInt(word, 16).toString(16)).join(':') + '::/64'
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
