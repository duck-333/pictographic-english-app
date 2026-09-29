const QUOTED_IDENTIFIER = '`((?:``|[^`])*)`'
const USAGE_GRANT = new RegExp(`^GRANT USAGE ON \\*\\.\\* TO ${QUOTED_IDENTIFIER}@${QUOTED_IDENTIFIER}$`, 'u')
const DATABASE_GRANT = new RegExp(`^GRANT (.+) ON ${QUOTED_IDENTIFIER}\\.\\* TO ${QUOTED_IDENTIFIER}@${QUOTED_IDENTIFIER}$`, 'u')
const PRIVILEGE_NAME = /^[A-Z][A-Z0-9_]*(?: [A-Z][A-Z0-9_]*)*$/u
const INTERNAL_VIOLATIONS = new WeakMap()
const SAFE_CATEGORIES = new Set([
  'ACCOUNT_MISMATCH',
  'ALL_PRIVILEGES_FORBIDDEN',
  'DATABASE_GRANT_COUNT_INVALID',
  'DATABASE_MISMATCH',
  'GRANT_SYNTAX_UNRECOGNIZED',
  'PRIVILEGE_DUPLICATE',
  'PRIVILEGE_LIST_INVALID',
  'PRIVILEGE_SET_MISMATCH',
  'PROCESS_FORBIDDEN',
  'QUERY_FAILED',
  'ROW_COLUMN_MISMATCH',
  'ROW_SHAPE_INVALID',
  'ROWSET_INVALID',
  'UNEXPECTED_VERIFICATION_FAILURE',
  'USAGE_GRANT_COUNT_INVALID'
])

function violation(category, count) {
  if (!SAFE_CATEGORIES.has(category)) category = 'UNEXPECTED_VERIFICATION_FAILURE'
  const signal = new Error('Internal grant verification signal.')
  INTERNAL_VIOLATIONS.set(signal, {
    category,
    count: Number.isSafeInteger(count) && count >= 0 ? count : undefined
  })
  return signal
}

function sanitized(error) {
  const details = INTERNAL_VIOLATIONS.get(error) || {
    category: 'UNEXPECTED_VERIFICATION_FAILURE',
    count: undefined
  }
  const sanitizedError = new Error('Invitation MySQL grant verification failed.')
  sanitizedError.code = 'INVITATION_MYSQL_GRANTS_INVALID'
  sanitizedError.category = details.category
  if (details.count !== undefined) sanitizedError.count = details.count
  return sanitizedError
}

function decodeQuotedIdentifier(value) {
  return value.replace(/``/gu, '`')
}

function parsePrivileges(value) {
  const items = value.split(',').map(item => item.trim().toUpperCase())
  if (items.length === 0 || items.some(item => item.length === 0 || !PRIVILEGE_NAME.test(item))) {
    throw violation('PRIVILEGE_LIST_INVALID', items.length)
  }
  const privileges = new Set(items)
  if (privileges.size !== items.length) throw violation('PRIVILEGE_DUPLICATE', items.length)
  if (privileges.has('ALL PRIVILEGES')) throw violation('ALL_PRIVILEGES_FORBIDDEN', items.length)
  if (privileges.has('PROCESS')) throw violation('PROCESS_FORBIDDEN', items.length)
  return privileges
}

function parseGrant(grant) {
  if (grant.includes('\r') || grant.includes('\n')) throw violation('GRANT_SYNTAX_UNRECOGNIZED')
  let match = USAGE_GRANT.exec(grant)
  if (match) {
    return {
      kind: 'usage',
      user: decodeQuotedIdentifier(match[1]),
      host: decodeQuotedIdentifier(match[2])
    }
  }
  match = DATABASE_GRANT.exec(grant)
  if (match) {
    return {
      kind: 'database',
      privileges: parsePrivileges(match[1]),
      database: decodeQuotedIdentifier(match[2]),
      user: decodeQuotedIdentifier(match[3]),
      host: decodeQuotedIdentifier(match[4])
    }
  }
  throw violation('GRANT_SYNTAX_UNRECOGNIZED')
}

function readGrantRows(rows, expectedColumn) {
  if (!Array.isArray(rows)) throw violation('ROWSET_INVALID')
  return rows.map(row => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw violation('ROW_SHAPE_INVALID')
    }
    const keys = Reflect.ownKeys(row)
    if (keys.length !== 1 || typeof keys[0] !== 'string') {
      throw violation('ROW_SHAPE_INVALID', keys.length)
    }
    if (keys[0] !== expectedColumn) throw violation('ROW_COLUMN_MISMATCH')
    const descriptor = Object.getOwnPropertyDescriptor(row, keys[0])
    if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
        Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set') ||
        typeof descriptor.value !== 'string' || descriptor.value.length === 0) {
      throw violation('ROW_SHAPE_INVALID')
    }
    return descriptor.value
  })
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every(value => expected.has(value))
}

export async function assertExactDatabaseGrants(root, resource, databaseName, expectedPrivileges, quoteAccount) {
  try {
    const account = quoteAccount(resource.name, resource.host)
    let rows
    try {
      ;[rows] = await root.query(`SHOW GRANTS FOR ${account}`)
    } catch {
      throw violation('QUERY_FAILED')
    }
    const expectedColumn = `Grants for ${resource.name}@${resource.host}`
    const parsed = readGrantRows(rows, expectedColumn).map(parseGrant)
    const usage = parsed.filter(item => item.kind === 'usage')
    const database = parsed.filter(item => item.kind === 'database')
    if (usage.length !== 1) throw violation('USAGE_GRANT_COUNT_INVALID', usage.length)
    if (database.length !== 1) throw violation('DATABASE_GRANT_COUNT_INVALID', database.length)
    for (const item of parsed) {
      if (item.user !== resource.name || item.host !== resource.host) {
        throw violation('ACCOUNT_MISMATCH')
      }
    }
    if (database[0].database !== databaseName) throw violation('DATABASE_MISMATCH')
    const expected = new Set([...expectedPrivileges].map(value => String(value).toUpperCase()))
    if (!sameSet(database[0].privileges, expected)) {
      throw violation('PRIVILEGE_SET_MISMATCH', database[0].privileges.size)
    }
    return Object.freeze({
      grantCount: parsed.length,
      usageCount: usage.length,
      databaseGrantCount: database.length,
      privilegeCount: database[0].privileges.size
    })
  } catch (error) {
    throw sanitized(error)
  }
}
