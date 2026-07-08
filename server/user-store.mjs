import mysql from 'mysql2/promise'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const USERS_TABLE = 'users'
const WECHAT_BINDINGS_TABLE = 'wechat_user_bindings'

function normalizeString(value) {
  return String(value || '').trim()
}

function createUserStoreError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'USER_STORE_ERROR'
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

function isRequiredWithoutDefault(column) {
  if (!column) return false
  const extra = String(column.Extra || '').toLowerCase()
  if (extra.includes('auto_increment')) return false
  return String(column.Null || '').toUpperCase() === 'NO' && column.Default === null
}

function buildInsert(tableName, values) {
  const entries = Object.entries(values).filter((entry) => entry[1] !== undefined)
  if (!entries.length) {
    throw createUserStoreError('No values to insert.', {
      code: 'USER_STORE_INVALID_INSERT'
    })
  }

  const columns = entries.map(([key]) => quoteIdentifier(key)).join(', ')
  const placeholders = entries.map(() => '?').join(', ')
  return {
    sql: `INSERT INTO ${quoteIdentifier(tableName)} (${columns}) VALUES (${placeholders})`,
    values: entries.map((entry) => entry[1])
  }
}

function buildUpdate(tableName, assignments, whereSql) {
  const entries = Object.entries(assignments).filter((entry) => entry[1] !== undefined)
  if (!entries.length) return null
  const setSql = entries.map(([key]) => `${quoteIdentifier(key)} = ?`).join(', ')
  return {
    sql: `UPDATE ${quoteIdentifier(tableName)} SET ${setSql} ${whereSql}`,
    values: entries.map((entry) => entry[1])
  }
}

export function createUserStore(options = {}) {
  let pool = options.pool || null
  const columnCache = new Map()
  const now = options.now || (() => new Date())

  function getPool() {
    if (pool) return pool

    const dbConfig = getDbConfig(options)
    if (!dbConfig.configured) {
      throw createUserStoreError('User database is not configured.', {
        code: 'USER_DB_CONFIG_MISSING',
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

  async function getTableColumns(connection, tableName) {
    if (columnCache.has(tableName)) return columnCache.get(tableName)
    const [rows] = await connection.query(`SHOW COLUMNS FROM ${quoteIdentifier(tableName)}`)
    const columns = {}
    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      if (row && row.Field) columns[row.Field] = row
    })
    columnCache.set(tableName, columns)
    return columns
  }

  async function findWechatBinding(connection, openid) {
    const [rows] = await connection.execute(
      `SELECT user_id, openid, unionid FROM ${quoteIdentifier(WECHAT_BINDINGS_TABLE)} WHERE openid = ? LIMIT 1`,
      [openid]
    )
    const row = Array.isArray(rows) && rows.length ? rows[0] : null
    if (!row || !row.user_id) return null
    return {
      userId: row.user_id,
      openid: row.openid,
      unionid: row.unionid || ''
    }
  }

  async function updateExistingLogin(connection, binding, unionid, timestamp) {
    const userColumns = await getTableColumns(connection, USERS_TABLE)
    const userUpdate = buildUpdate(
      USERS_TABLE,
      {
        last_login_at: userColumns.last_login_at ? timestamp : undefined
      },
      'WHERE id = ?'
    )
    if (userUpdate) {
      await connection.execute(userUpdate.sql, [...userUpdate.values, binding.userId])
    }

    const bindingColumns = await getTableColumns(connection, WECHAT_BINDINGS_TABLE)
    const bindingUpdate = buildUpdate(
      WECHAT_BINDINGS_TABLE,
      {
        unionid: bindingColumns.unionid && unionid ? unionid : undefined,
        updated_at: bindingColumns.updated_at ? timestamp : undefined
      },
      'WHERE openid = ?'
    )
    if (bindingUpdate) {
      await connection.execute(bindingUpdate.sql, [...bindingUpdate.values, binding.openid])
    }
  }

  async function createWechatUser(connection, openid, unionid, timestamp) {
    const userColumns = await getTableColumns(connection, USERS_TABLE)
    const userValues = {
      status: userColumns.status ? 'active' : undefined,
      created_at: userColumns.created_at ? timestamp : undefined,
      last_login_at: userColumns.last_login_at ? timestamp : undefined
    }

    // Compatibility only: identity lookup remains wechat_user_bindings.openid.
    if (isRequiredWithoutDefault(userColumns.openid)) {
      userValues.openid = openid
    }

    const userInsert = buildInsert(USERS_TABLE, userValues)
    const [insertResult] = await connection.execute(userInsert.sql, userInsert.values)
    const userId = insertResult && insertResult.insertId
    if (!userId) {
      throw createUserStoreError('Failed to create user.', {
        code: 'USER_CREATE_FAILED'
      })
    }

    const bindingColumns = await getTableColumns(connection, WECHAT_BINDINGS_TABLE)
    const bindingValues = {
      user_id: userId,
      openid,
      unionid: bindingColumns.unionid ? unionid || null : undefined,
      created_at: bindingColumns.created_at ? timestamp : undefined,
      updated_at: bindingColumns.updated_at ? timestamp : undefined
    }
    const bindingInsert = buildInsert(WECHAT_BINDINGS_TABLE, bindingValues)
    await connection.execute(bindingInsert.sql, bindingInsert.values)

    return {
      id: String(userId),
      isNew: true
    }
  }

  async function findOrCreateWechatUser(identity) {
    const openid = normalizeString(identity && identity.openid)
    const unionid = normalizeString(identity && identity.unionid)
    if (!openid) {
      throw createUserStoreError('Wechat openid is required.', {
        code: 'WECHAT_OPENID_REQUIRED',
        statusCode: 400
      })
    }

    const connection = await getPool().getConnection()
    const timestamp = now()
    try {
      await connection.beginTransaction()

      const existingBinding = await findWechatBinding(connection, openid)
      if (existingBinding) {
        await updateExistingLogin(connection, existingBinding, unionid, timestamp)
        await connection.commit()
        return {
          id: String(existingBinding.userId),
          isNew: false
        }
      }

      const user = await createWechatUser(connection, openid, unionid, timestamp)
      await connection.commit()
      return user
    } catch (error) {
      await connection.rollback()
      if (error && error.code === 'ER_DUP_ENTRY') {
        const retryConnection = await getPool().getConnection()
        try {
          const binding = await findWechatBinding(retryConnection, openid)
          if (binding) {
            await updateExistingLogin(retryConnection, binding, unionid, timestamp)
            return {
              id: String(binding.userId),
              isNew: false
            }
          }
        } finally {
          retryConnection.release()
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  return {
    findOrCreateWechatUser
  }
}
