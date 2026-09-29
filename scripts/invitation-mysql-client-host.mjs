import { isIP } from 'node:net'

const INTERNAL_VIOLATIONS = new WeakMap()
const SAFE_CATEGORIES = new Set([
  'CLIENT_HOST_NOT_ALLOWED',
  'CLIENT_HOST_NOT_CANONICAL_IPV4',
  'QUERY_FAILED',
  'ROWSET_INVALID',
  'ROW_SHAPE_INVALID',
  'UNEXPECTED_RESOLUTION_FAILURE'
])

function violation(category, count) {
  if (!SAFE_CATEGORIES.has(category)) category = 'UNEXPECTED_RESOLUTION_FAILURE'
  const signal = new Error('Internal MySQL client host resolution signal.')
  INTERNAL_VIOLATIONS.set(signal, {
    category,
    count: Number.isSafeInteger(count) && count >= 0 ? count : undefined
  })
  return signal
}

function sanitized(error) {
  const details = INTERNAL_VIOLATIONS.get(error) || {
    category: 'UNEXPECTED_RESOLUTION_FAILURE',
    count: undefined
  }
  const sanitizedError = new Error('Invitation MySQL client host verification failed.')
  sanitizedError.code = 'INVITATION_MYSQL_CLIENT_HOST_INVALID'
  sanitizedError.category = details.category
  if (details.count !== undefined) sanitizedError.count = details.count
  return sanitizedError
}

function isAllowedPrivateIpv4(value) {
  const octets = value.split('.').map(part => Number(part))
  return octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
}

export async function resolveInvitationMysqlClientHost(root) {
  try {
    let result
    try {
      result = await root.execute("SELECT SUBSTRING_INDEX(USER(), '@', -1) AS clientHost")
    } catch {
      throw violation('QUERY_FAILED')
    }
    if (!Array.isArray(result) || result.length < 1 || !Array.isArray(result[0])) {
      throw violation('ROWSET_INVALID')
    }
    const rows = result[0]
    if (rows.length !== 1) throw violation('ROWSET_INVALID', rows.length)
    const row = rows[0]
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw violation('ROW_SHAPE_INVALID')
    }
    const keys = Reflect.ownKeys(row)
    if (keys.length !== 1 || keys[0] !== 'clientHost') {
      throw violation('ROW_SHAPE_INVALID', keys.length)
    }
    const descriptor = Object.getOwnPropertyDescriptor(row, 'clientHost')
    if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
        Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set') ||
        typeof descriptor.value !== 'string' || descriptor.value.length === 0) {
      throw violation('ROW_SHAPE_INVALID')
    }
    const clientHost = descriptor.value
    if (isIP(clientHost) !== 4 ||
        clientHost.split('.').map(part => BigInt(part).toString()).join('.') !== clientHost) {
      throw violation('CLIENT_HOST_NOT_CANONICAL_IPV4')
    }
    if (!isAllowedPrivateIpv4(clientHost)) throw violation('CLIENT_HOST_NOT_ALLOWED')
    return clientHost
  } catch (error) {
    throw sanitized(error)
  }
}
