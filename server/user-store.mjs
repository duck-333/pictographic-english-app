import mysql from 'mysql2/promise'

import { hashPhone } from './identity-store.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const USERS_TABLE = 'users'
const WECHAT_BINDINGS_TABLE = 'wechat_user_bindings'
const PHONE_BINDINGS_TABLE = 'user_phone_bindings'

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

function formatDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }

  const text = normalizeString(value)
  if (!text) return null

  const parsed = new Date(text)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : text
}

function isLikelyUserId(value) {
  return /^\d+$/.test(normalizeString(value))
}

function shouldAttemptPhoneHashSearch(value) {
  return normalizeString(value).replace(/\D/g, '').length >= 7
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

  async function findUserProfileById(userId) {
    const normalizedUserId = normalizeString(userId)
    if (!normalizedUserId) {
      throw createUserStoreError('User id is required.', {
        code: 'USER_ID_REQUIRED',
        statusCode: 400
      })
    }

    const connection = await getPool().getConnection()
    try {
      const userColumns = await getTableColumns(connection, USERS_TABLE)
      const statusExpression = userColumns.status ? 'status' : `'active'`
      const createdAtExpression = userColumns.created_at ? 'created_at' : 'NULL'
      const [userRows] = await connection.execute(
        `SELECT id, ${statusExpression} AS status, ${createdAtExpression} AS created_at
           FROM ${quoteIdentifier(USERS_TABLE)}
          WHERE id = ?
          LIMIT 1`,
        [normalizedUserId]
      )
      const userRow = Array.isArray(userRows) && userRows.length ? userRows[0] : null
      if (!userRow || userRow.id === undefined || userRow.id === null) return null

      const [wechatRows] = await connection.execute(
        `SELECT user_id FROM ${quoteIdentifier(WECHAT_BINDINGS_TABLE)} WHERE user_id = ? LIMIT 1`,
        [normalizedUserId]
      )
      const hasWechatBinding = Array.isArray(wechatRows) && wechatRows.length > 0

      const [phoneRows] = await connection.execute(
        `SELECT phone_masked FROM ${quoteIdentifier(PHONE_BINDINGS_TABLE)} WHERE user_id = ? AND status = ? LIMIT 1`,
        [normalizedUserId, 'active']
      )
      const phoneRow = Array.isArray(phoneRows) && phoneRows.length ? phoneRows[0] : null
      const phoneMasked = normalizeString(phoneRow && phoneRow.phone_masked)

      return {
        id: String(userRow.id),
        status: normalizeString(userRow.status) || 'active',
        createdAt: formatDate(userRow.created_at),
        hasWechatBinding,
        hasPhoneBinding: Boolean(phoneRow),
        phoneMasked
      }
    } finally {
      connection.release()
    }
  }

  async function findUserProfilesByIds(connection, userIds) {
    const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : []).map((id) => normalizeString(id)).filter(Boolean)))
    if (!ids.length) return []

    const userColumns = await getTableColumns(connection, USERS_TABLE)
    const statusExpression = userColumns.status ? 'u.status' : `'active'`
    const createdAtExpression = userColumns.created_at ? 'u.created_at' : 'NULL'
    const placeholders = ids.map(() => '?').join(', ')
    const [rows] = await connection.execute(
      `SELECT u.id,
              ${statusExpression} AS status,
              ${createdAtExpression} AS created_at,
              EXISTS(
                SELECT 1
                  FROM ${quoteIdentifier(WECHAT_BINDINGS_TABLE)} wb
                 WHERE wb.user_id = u.id
                 LIMIT 1
              ) AS has_wechat_binding,
              (
                SELECT pb.phone_masked
                  FROM ${quoteIdentifier(PHONE_BINDINGS_TABLE)} pb
                 WHERE pb.user_id = u.id
                   AND pb.status = ?
                 ORDER BY pb.id DESC
                 LIMIT 1
              ) AS phone_masked
         FROM ${quoteIdentifier(USERS_TABLE)} u
        WHERE u.id IN (${placeholders})
        LIMIT 50`,
      ['active', ...ids]
    )

    const profileById = new Map()
    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row || row.id === undefined || row.id === null) return
      const phoneMasked = normalizeString(row.phone_masked)
      profileById.set(String(row.id), {
        id: String(row.id),
        status: normalizeString(row.status) || 'active',
        createdAt: formatDate(row.created_at),
        hasWechatBinding: Boolean(Number(row.has_wechat_binding || 0)),
        hasPhoneBinding: Boolean(phoneMasked),
        phoneMasked
      })
    })

    return ids.map((id) => profileById.get(String(id))).filter(Boolean)
  }

  async function searchAdminUsers(query, options = {}) {
    const keyword = normalizeString(query)
    if (!keyword) {
      throw createUserStoreError('Search query is required.', {
        code: 'ADMIN_USER_SEARCH_QUERY_REQUIRED',
        statusCode: 400
      })
    }

    const connection = await getPool().getConnection()
    try {
      const userIds = []

      if (isLikelyUserId(keyword)) {
        userIds.push(keyword)
      }

      if (shouldAttemptPhoneHashSearch(keyword)) {
        let phoneHash = ''
        try {
          phoneHash = hashPhone(keyword, {
            secret: options.phoneHashSecret === undefined ? process.env.PHONE_HASH_SECRET : options.phoneHashSecret,
            hashVersion: options.phoneHashVersion
          }).phoneHash
        } catch (error) {
          // Phone search is best-effort and depends on PHONE_HASH_SECRET. User id search remains available.
        }

        if (phoneHash) {
          const [phoneRows] = await connection.execute(
            `SELECT user_id
               FROM ${quoteIdentifier(PHONE_BINDINGS_TABLE)}
              WHERE phone_hash = ?
                AND status = ?
              LIMIT 20`,
            [phoneHash, 'active']
          )
          ;(Array.isArray(phoneRows) ? phoneRows : []).forEach((row) => {
            if (row && row.user_id !== undefined && row.user_id !== null) {
              userIds.push(String(row.user_id))
            }
          })
        }
      }

      return await findUserProfilesByIds(connection, userIds)
    } finally {
      connection.release()
    }
  }

  return {
    findOrCreateWechatUser,
    findUserProfileById,
    searchAdminUsers
  }
}
