const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/u

function invalid(label) {
  const error = new TypeError(`${label} must be a canonical non-negative database integer.`)
  error.code = 'INVITATION_TEST_DATABASE_INTEGER_INVALID'
  return error
}

export function parseDatabaseUnsignedBigInt(value, label = 'Database integer') {
  if (typeof value === 'bigint') {
    if (value < 0n) throw invalid(label)
    return value
  }
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) throw invalid(label)
  return BigInt(value)
}

export function parseDatabaseSafeInteger(value, label = 'Database integer') {
  let parsed
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw invalid(label)
    parsed = BigInt(value)
  } else {
    parsed = parseDatabaseUnsignedBigInt(value, label)
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid(label)
  return Number(parsed)
}

export function parseDatabaseInsertId(value, label = 'Database insertId') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw invalid(label)
    return BigInt(value)
  }
  const parsed = parseDatabaseUnsignedBigInt(value, label)
  if (parsed <= 0n) throw invalid(label)
  return parsed
}

export function requireDatabaseInteger(value, expected, label = 'Database integer') {
  const actual = parseDatabaseUnsignedBigInt(value, label)
  const wanted = typeof expected === 'bigint'
    ? expected
    : parseDatabaseUnsignedBigInt(String(expected), `${label} expectation`)
  if (actual !== wanted) {
    const error = new Error(`${label} did not match the expected value.`)
    error.code = 'INVITATION_TEST_DATABASE_INTEGER_MISMATCH'
    throw error
  }
  return actual
}
