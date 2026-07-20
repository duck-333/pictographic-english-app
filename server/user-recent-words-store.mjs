import mysql from 'mysql2/promise'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const USER_RECENT_WORDS_TABLE = 'user_recent_words'
const MAX_WORD_ID_LENGTH = 191

function normalizeString(value) {
  return String(value || '').trim()
}

function createUserRecentWordsStoreError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_RECENT_WORDS_STORE_ERROR'
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
    throw createUserRecentWordsStoreError('User id is required.', {
      code: 'USER_ID_REQUIRED',
      statusCode: 400
    })
  }
  return normalizedUserId
}

function normalizeWordId(wordId) {
  const normalizedWordId = normalizeString(wordId)
  if (!normalizedWordId) {
    throw createUserRecentWordsStoreError('Word id is required.', {
      code: 'WORD_ID_REQUIRED',
      statusCode: 400
    })
  }
  if (normalizedWordId.length > MAX_WORD_ID_LENGTH) {
    throw createUserRecentWordsStoreError('Word id is invalid.', {
      code: 'WORD_ID_INVALID',
      statusCode: 400
    })
  }
  return normalizedWordId
}

function formatViewedAt(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }

  const text = normalizeString(value)
  if (!text) return ''

  const parsed = new Date(text)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text
}

function mapRecentWordRow(row) {
  return {
    wordId: normalizeString(row && row.word_id),
    viewedAt: formatViewedAt(row && row.viewed_at)
  }
}

export function createUserRecentWordsStore(options = {}) {
  let pool = options.pool || null

  function getPool() {
    if (pool) return pool

    const dbConfig = getDbConfig(options)
    if (!dbConfig.configured) {
      throw createUserRecentWordsStoreError('User recent words database is not configured.', {
        code: 'USER_RECENT_WORDS_DB_CONFIG_MISSING',
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

  async function findRecentWord(connection, userId, wordId) {
    const [rows] = await connection.execute(
      `SELECT word_id, viewed_at FROM ${quoteIdentifier(USER_RECENT_WORDS_TABLE)} WHERE user_id = ? AND word_id = ? LIMIT 1`,
      [userId, wordId]
    )
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    return row ? mapRecentWordRow(row) : null
  }

  async function listRecentWords(userId) {
    const normalizedUserId = normalizeUserId(userId)
    const connection = await getPool().getConnection()
    try {
      const [rows] = await connection.execute(
        `SELECT word_id, viewed_at FROM ${quoteIdentifier(USER_RECENT_WORDS_TABLE)} WHERE user_id = ? ORDER BY viewed_at DESC, id DESC`,
        [normalizedUserId]
      )
      return (Array.isArray(rows) ? rows : []).map(mapRecentWordRow)
    } finally {
      connection.release()
    }
  }

  async function recordRecentWord(userId, wordId) {
    const normalizedUserId = normalizeUserId(userId)
    const normalizedWordId = normalizeWordId(wordId)
    const connection = await getPool().getConnection()
    try {
      await connection.execute(
        `INSERT INTO ${quoteIdentifier(USER_RECENT_WORDS_TABLE)} (user_id, word_id, viewed_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE viewed_at = CURRENT_TIMESTAMP`,
        [normalizedUserId, normalizedWordId]
      )
      return await findRecentWord(connection, normalizedUserId, normalizedWordId)
    } finally {
      connection.release()
    }
  }

  return {
    listRecentWords,
    recordRecentWord
  }
}
