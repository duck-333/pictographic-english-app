import mysql from 'mysql2/promise'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const USER_FAVORITES_TABLE = 'user_favorites'
const MAX_WORD_ID_LENGTH = 191

function normalizeString(value) {
  return String(value || '').trim()
}

function createUserFavoritesStoreError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_FAVORITES_STORE_ERROR'
  error.statusCode = Number(options.statusCode || 500)
  return error
}

function getDbConfig(options = {}) {
  const host = normalizeString(options.dbHost === undefined ? process.env.DB_HOST : options.dbHost) || DEFAULT_DB_HOST
  const port = Number(options.dbPort === undefined ? process.env.DB_PORT : options.dbPort) || DEFAULT_DB_PORT
  const database = normalizeString(options.dbName === undefined ? process.env.DB_NAME : options.dbName) || DEFAULT_DB_NAME
  const user = normalizeString(options.dbUser === undefined ? process.env.DB_USER : options.dbUser)
  const configuredPassword = options.dbPassword === undefined ? process.env.DB_PASSWORD : options.dbPassword
  const password = String(configuredPassword || '')

  return {
    host,
    port,
    database,
    user,
    password,
    configured: Boolean(database && user && password)
  }
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``
}

function normalizeUserId(userId) {
  const normalizedUserId = normalizeString(userId)
  if (!normalizedUserId) {
    throw createUserFavoritesStoreError('User id is required.', {
      code: 'USER_ID_REQUIRED',
      statusCode: 400
    })
  }
  return normalizedUserId
}

function normalizeWordId(wordId) {
  const normalizedWordId = normalizeString(wordId)
  if (!normalizedWordId) {
    throw createUserFavoritesStoreError('Word id is required.', {
      code: 'WORD_ID_REQUIRED',
      statusCode: 400
    })
  }
  if (normalizedWordId.length > MAX_WORD_ID_LENGTH) {
    throw createUserFavoritesStoreError('Word id is invalid.', {
      code: 'WORD_ID_INVALID',
      statusCode: 400
    })
  }
  return normalizedWordId
}

function formatCreatedAt(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }

  const text = normalizeString(value)
  if (!text) return ''

  const parsed = new Date(text)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text
}

function mapFavoriteRow(row) {
  return {
    wordId: normalizeString(row && row.word_id),
    createdAt: formatCreatedAt(row && row.created_at)
  }
}

export function createUserFavoritesStore(options = {}) {
  let pool = options.pool || null

  function getPool() {
    if (pool) return pool

    const dbConfig = getDbConfig(options)
    if (!dbConfig.configured) {
      throw createUserFavoritesStoreError('User favorites database is not configured.', {
        code: 'USER_FAVORITES_DB_CONFIG_MISSING',
        statusCode: 503
      })
    }

    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      waitForConnections: true,
      connectionLimit: Number(options.dbConnectionLimit || process.env.DB_CONNECTION_LIMIT || 5),
      namedPlaceholders: false
    })
    return pool
  }

  async function findFavorite(connection, userId, wordId) {
    const [rows] = await connection.execute(
      `SELECT word_id, created_at FROM ${quoteIdentifier(USER_FAVORITES_TABLE)} WHERE user_id = ? AND word_id = ? LIMIT 1`,
      [userId, wordId]
    )
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    return row ? mapFavoriteRow(row) : null
  }

  async function listFavorites(userId) {
    const normalizedUserId = normalizeUserId(userId)
    const connection = await getPool().getConnection()
    try {
      const [rows] = await connection.execute(
        `SELECT word_id, created_at FROM ${quoteIdentifier(USER_FAVORITES_TABLE)} WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
        [normalizedUserId]
      )
      return (Array.isArray(rows) ? rows : []).map(mapFavoriteRow)
    } finally {
      connection.release()
    }
  }

  async function addFavorite(userId, wordId) {
    const normalizedUserId = normalizeUserId(userId)
    const normalizedWordId = normalizeWordId(wordId)
    const connection = await getPool().getConnection()
    try {
      await connection.execute(
        `INSERT INTO ${quoteIdentifier(USER_FAVORITES_TABLE)} (user_id, word_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE word_id = word_id`,
        [normalizedUserId, normalizedWordId]
      )
      return await findFavorite(connection, normalizedUserId, normalizedWordId)
    } finally {
      connection.release()
    }
  }

  async function removeFavorite(userId, wordId) {
    const normalizedUserId = normalizeUserId(userId)
    const normalizedWordId = normalizeWordId(wordId)
    const connection = await getPool().getConnection()
    try {
      const [result] = await connection.execute(
        `DELETE FROM ${quoteIdentifier(USER_FAVORITES_TABLE)} WHERE user_id = ? AND word_id = ?`,
        [normalizedUserId, normalizedWordId]
      )
      return {
        wordId: normalizedWordId,
        deleted: Boolean(result && result.affectedRows)
      }
    } finally {
      connection.release()
    }
  }

  return {
    listFavorites,
    addFavorite,
    removeFavorite
  }
}
