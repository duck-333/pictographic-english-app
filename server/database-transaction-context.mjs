const ACTIVE_CONTEXTS = new WeakSet()
const CONTEXT_CONNECTIONS = new WeakMap()
const CONTEXT_USER_LOCK_STATES = new WeakMap()
const ACTIVE_CONNECTIONS = new WeakSet()
const QUARANTINED_CONNECTIONS = new WeakSet()
const MAX_UNSIGNED_BIGINT = 18446744073709551615n
const USER_INSERT_COLUMNS = new Set(['status', 'openid', 'created_at', 'last_login_at'])

function transactionError(message, code, options = {}) {
  const error = new Error(message, options.cause === undefined ? undefined : { cause: options.cause })
  error.code = code
  error.statusCode = 500
  if (options.originalError !== undefined) error.originalError = options.originalError
  if (options.rollbackError !== undefined) error.rollbackError = options.rollbackError
  if (options.releaseError !== undefined) error.releaseError = options.releaseError
  if (options.destroyError !== undefined) error.destroyError = options.destroyError
  return error
}

function requireConnection(connection) {
  if (!connection || typeof connection !== 'object' || typeof connection.execute !== 'function' ||
      typeof connection.beginTransaction !== 'function' || typeof connection.commit !== 'function' ||
      typeof connection.rollback !== 'function') {
    throw transactionError('A usable database transaction connection is required.', 'DATABASE_TRANSACTION_CONNECTION_INVALID')
  }
}

function isRetryable(error, retryableCodes) {
  return error?.code === 'ER_LOCK_DEADLOCK' || error?.code === 'ER_LOCK_WAIT_TIMEOUT' || retryableCodes.has(error?.code)
}

function invalidateContext(context) {
  if (!context) return
  ACTIVE_CONTEXTS.delete(context)
  CONTEXT_CONNECTIONS.delete(context)
  CONTEXT_USER_LOCK_STATES.delete(context)
}

function createContext(connection) {
  let context
  context = Object.freeze({
    execute: async (sql, params = []) => {
      requireDatabaseTransactionContext(context)
      return connection.execute(sql, params)
    },
    query: async (sql, params = []) => {
      requireDatabaseTransactionContext(context)
      if (typeof connection.query === 'function') return connection.query(sql, params)
      return connection.execute(sql, params)
    }
  })
  ACTIVE_CONTEXTS.add(context)
  CONTEXT_CONNECTIONS.set(context, connection)
  CONTEXT_USER_LOCK_STATES.set(context, {
    status: 'UNINITIALIZED',
    existingUserScope: null,
    lockedUserIds: new Set(),
    createdUserIds: new Set()
  })
  return context
}

function normalizeUserId(value) {
  let normalized
  if (typeof value === 'bigint') normalized = value.toString()
  else if (typeof value === 'number' && Number.isSafeInteger(value)) normalized = String(value)
  else if (typeof value === 'string') normalized = value
  else normalized = ''
  if (!/^[1-9]\d{0,19}$/u.test(normalized) || BigInt(normalized) > MAX_UNSIGNED_BIGINT) {
    throw transactionError('Database transaction user id is invalid.', 'DATABASE_TRANSACTION_USER_ID_INVALID')
  }
  return normalized
}

function normalizeUserIds(values) {
  const normalized = [...new Set(Array.from(values || [], normalizeUserId))]
  return normalized.sort((left, right) => {
    const a = BigInt(left)
    const b = BigInt(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

async function quarantineAfterRollbackFailure(connection, originalError, rollbackError) {
  QUARANTINED_CONNECTIONS.add(connection)
  let destroyError
  try {
    if (typeof connection.destroy === 'function') await connection.destroy()
  } catch (error) {
    destroyError = error
  }
  throw transactionError('Database transaction rollback failed; connection was quarantined.',
    'DATABASE_TRANSACTION_CLEANUP_FAILED', { cause: originalError, originalError, rollbackError, destroyError })
}

export function requireDatabaseTransactionContext(context) {
  if (!context || typeof context !== 'object' || !ACTIVE_CONTEXTS.has(context) || !CONTEXT_CONNECTIONS.has(context)) {
    throw transactionError('An active database transaction context is required.', 'DATABASE_TRANSACTION_REQUIRED')
  }
  return context
}

export async function lockDatabaseUsersInTransaction(context, userIds, options = {}) {
  const activeContext = requireDatabaseTransactionContext(context)
  const requested = normalizeUserIds(userIds)
  const state = CONTEXT_USER_LOCK_STATES.get(activeContext)
  if (state.status === 'READY') {
    const staysWithinClosedScope = requested.every(userId => (
      state.existingUserScope.has(userId) || state.createdUserIds.has(userId)
    ))
    if (!staysWithinClosedScope) {
      throw transactionError('Database transaction user lock set cannot be expanded after locking.',
        'DATABASE_TRANSACTION_USER_LOCK_EXPANSION_FORBIDDEN')
    }
    const lockedRequested = requested.filter(userId => state.lockedUserIds.has(userId))
    if (options.allowMissing !== true && lockedRequested.length !== requested.length) {
      throw transactionError('A database transaction participant user does not exist.',
        'DATABASE_TRANSACTION_USER_NOT_FOUND')
    }
    return Object.freeze(lockedRequested)
  }
  if (state.status !== 'UNINITIALIZED') {
    throw transactionError('Database transaction user lock scope is not available for reinitialization.',
      'DATABASE_TRANSACTION_USER_LOCK_SCOPE_UNAVAILABLE')
  }
  state.status = 'INITIALIZING'
  state.existingUserScope = new Set(requested)
  if (requested.length === 0) {
    state.status = 'READY'
    return Object.freeze([])
  }
  const placeholders = requested.map(() => '?').join(', ')
  try {
    const [rows] = await activeContext.execute(
      `SELECT id FROM users WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`, requested)
    const found = new Set(Array.isArray(rows) ? rows.map(row => String(row.id)) : [])
    if (options.allowMissing !== true && requested.some(userId => !found.has(userId))) {
      throw transactionError('A database transaction participant user does not exist.',
        'DATABASE_TRANSACTION_USER_NOT_FOUND')
    }
    for (const userId of requested) if (found.has(userId)) state.lockedUserIds.add(userId)
    state.status = 'READY'
    return Object.freeze(requested.filter(userId => state.lockedUserIds.has(userId)))
  } catch (error) {
    state.status = 'FAILED'
    throw error
  }
}

export function requireDatabaseUsersLocked(context, userIds) {
  const activeContext = requireDatabaseTransactionContext(context)
  const requested = normalizeUserIds(userIds)
  const state = CONTEXT_USER_LOCK_STATES.get(activeContext)
  if (state.status !== 'READY') {
    throw transactionError('Database transaction user lock scope must be initialized before identity mutation.',
      'DATABASE_USER_LOCK_SCOPE_REQUIRED')
  }
  if (requested.some(userId => !state.lockedUserIds.has(userId))) {
    throw transactionError('All existing identity participants must be locked before mutation.',
      'DATABASE_TRANSACTION_USERS_NOT_LOCKED')
  }
  return Object.freeze([...requested])
}

export async function insertDatabaseUserInTransaction(context, input = {}) {
  const activeContext = requireDatabaseTransactionContext(context)
  const state = CONTEXT_USER_LOCK_STATES.get(activeContext)
  if (state.status !== 'READY') {
    throw transactionError('Database transaction user lock scope must be initialized before creating a user.',
      'DATABASE_USER_LOCK_SCOPE_REQUIRED')
  }
  const values = input && typeof input.values === 'object' && !Array.isArray(input.values) ? input.values : null
  if (!values) throw transactionError('Controlled user insert values are invalid.', 'DATABASE_TRANSACTION_USER_INSERT_INVALID')
  const columns = Object.keys(values).filter(column => values[column] !== undefined)
  if (columns.some(column => !USER_INSERT_COLUMNS.has(column))) {
    throw transactionError('Controlled user insert contains a forbidden column.', 'DATABASE_TRANSACTION_USER_INSERT_INVALID')
  }
  const sql = columns.length
    ? `INSERT INTO users (${columns.map(column => `\`${column}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    : 'INSERT INTO users () VALUES ()'
  const [result] = await activeContext.execute(sql, columns.map(column => values[column]))
  if (!result || result.affectedRows !== 1) {
    throw transactionError('Controlled user insert did not create exactly one user.', 'DATABASE_TRANSACTION_USER_INSERT_FAILED')
  }
  const insertedId = normalizeUserId(result.insertId)
  const [verificationRows] = await activeContext.execute(
    'SELECT id FROM users WHERE id = LAST_INSERT_ID() LIMIT 2 FOR UPDATE')
  if (!Array.isArray(verificationRows) || verificationRows.length !== 1 ||
      normalizeUserId(verificationRows[0].id) !== insertedId) {
    throw transactionError('Controlled user insert result could not be verified.', 'DATABASE_TRANSACTION_USER_INSERT_FAILED')
  }
  state.lockedUserIds.add(insertedId)
  state.createdUserIds.add(insertedId)
  return insertedId
}

export async function withDatabaseTransaction(connection, callback, options = {}) {
  if (connection && typeof connection === 'object' && QUARANTINED_CONNECTIONS.has(connection)) {
    throw transactionError('Database connection is quarantined and cannot be reused.', 'DATABASE_TRANSACTION_CONNECTION_UNUSABLE')
  }
  if (connection && typeof connection === 'object' && ACTIVE_CONNECTIONS.has(connection)) {
    throw transactionError('Database connection already has an active transaction.', 'DATABASE_TRANSACTION_CONNECTION_BUSY')
  }
  requireConnection(connection)
  if (typeof callback !== 'function') {
    throw transactionError('A database transaction callback is required.', 'DATABASE_TRANSACTION_CALLBACK_INVALID')
  }

  ACTIVE_CONNECTIONS.add(connection)
  try {
    const requestedAttempts = Number(options.maximumAttempts === undefined ? 3 : options.maximumAttempts)
    const maximumAttempts = Number.isSafeInteger(requestedAttempts) && requestedAttempts >= 1 && requestedAttempts <= 3
      ? requestedAttempts
      : 3
    const retryableCodes = new Set(Array.isArray(options.retryableCodes) ? options.retryableCodes : [])
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      let context = null
      let started = false
      let committed = false
      try {
        await connection.beginTransaction()
        started = true
        context = createContext(connection)
        const result = await callback(context)
        await connection.commit()
        committed = true
        return result
      } catch (originalError) {
        invalidateContext(context)
        context = null
        if (!started) throw originalError
        if (!committed) {
          try {
            await connection.rollback()
          } catch (rollbackError) {
            await quarantineAfterRollbackFailure(connection, originalError, rollbackError)
          }
        }
        if (!isRetryable(originalError, retryableCodes) || attempt === maximumAttempts) throw originalError
      } finally {
        invalidateContext(context)
      }
    }
  } finally {
    ACTIVE_CONNECTIONS.delete(connection)
  }
}

export async function withDatabasePoolTransaction(pool, callback, options = {}) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw transactionError('A usable database pool is required.', 'DATABASE_TRANSACTION_POOL_INVALID')
  }
  const connection = await pool.getConnection()
  let result
  let operationError
  try {
    result = await withDatabaseTransaction(connection, callback, options)
  } catch (error) {
    operationError = error
  }
  if (!QUARANTINED_CONNECTIONS.has(connection)) {
    try {
      await connection.release()
    } catch (releaseError) {
      QUARANTINED_CONNECTIONS.add(connection)
      let destroyError
      try {
        if (typeof connection.destroy === 'function') await connection.destroy()
      } catch (error) {
        destroyError = error
      }
      operationError = transactionError(
        operationError ? 'Database transaction and connection release both failed.' : 'Database connection release failed.',
        'DATABASE_TRANSACTION_RELEASE_FAILED',
        { cause: operationError || releaseError, originalError: operationError || undefined, releaseError, destroyError })
    }
  }
  if (operationError) throw operationError
  return result
}
