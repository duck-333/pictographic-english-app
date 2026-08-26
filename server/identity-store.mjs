import crypto from 'crypto'
import mysql from 'mysql2/promise'

import { createIdentityConflictDiagnostic } from './identity-conflict-diagnostic.mjs'

const DEFAULT_DB_HOST = '127.0.0.1'
const DEFAULT_DB_PORT = 3306
const DEFAULT_DB_NAME = 'baxiaota'
const DEFAULT_COUNTRY_CODE = '86'
const DEFAULT_HASH_VERSION = 'v1'
const USERS_TABLE = 'users'
const WECHAT_BINDINGS_TABLE = 'wechat_user_bindings'
const PHONE_BINDINGS_TABLE = 'user_phone_bindings'
const CAMPAIGN_PHONE_HASH_VERSION = 'v1'
const CAMPAIGN_PHONE_IDENTITY_CONFIG_ERROR_CODES = new Set([
  'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_MISSING',
  'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_TOO_SHORT',
  'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_REUSED'
])
let campaignPhoneIdentityModulePromise = null

function normalizeString(value) {
  return String(value || '').trim()
}

function createIdentityStoreError(message, options = {}) {
  const error = new Error(message)
  error.code = options.code || 'IDENTITY_STORE_ERROR'
  error.statusCode = Number(options.statusCode || 500)
  return error
}

function isDuplicateEntryError(error) {
  return Boolean(error && error.code === 'ER_DUP_ENTRY')
}

function createIdentityConflictError(diagnostic = null) {
  const error = createIdentityStoreError('Identity binding conflict.', {
    code: 'IDENTITY_CONFLICT',
    statusCode: 409
  })
  if (diagnostic) {
    Object.defineProperty(error, 'identityConflictDiagnostic', {
      value: diagnostic
    })
  }
  return error
}

async function emitIdentityConflictDiagnostic(error, diagnostic) {
  const marker = await diagnostic.emit(error && error.identityConflictDiagnostic)
  if (marker) {
    Object.defineProperty(error, 'diagnosticMarker', {
      value: marker
    })
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

async function rollbackIdentityConflict(connection) {
  try {
    await connection.rollback()
    return false
  } catch {
    try {
      connection.destroy()
    } catch {
      // A failed rollback must never return this connection to the pool.
    }
    return true
  }
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
    throw createIdentityStoreError('No values to insert.', {
      code: 'IDENTITY_STORE_INVALID_INSERT'
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

async function getTableColumns(connection, tableName) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM ${quoteIdentifier(tableName)}`)
  const columns = {}
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    if (row && row.Field) columns[row.Field] = row
  })
  return columns
}

async function createDefaultCampaignPhoneIdentity(phone, options = {}) {
  if (!campaignPhoneIdentityModulePromise) {
    campaignPhoneIdentityModulePromise = import('./book-benefit-foundation.mjs')
  }
  const foundation = await campaignPhoneIdentityModulePromise
  return foundation.createCampaignPhoneIdentity(phone, options)
}

function normalizeCampaignPhoneIdentity(value) {
  const hash = value && value.campaignPhoneIdentityHash
  const hashVersion = normalizeString(
    value && (value.campaignPhoneHashVersion || value.hashVersion)
  )
  if (!Buffer.isBuffer(hash) || hash.length !== 32 || hashVersion !== CAMPAIGN_PHONE_HASH_VERSION) {
    throw createIdentityStoreError('Campaign phone identity is invalid.')
  }
  return {
    campaignPhoneIdentityHash: Buffer.from(hash),
    campaignPhoneHashVersion: hashVersion
  }
}

async function resolveCampaignPhoneIdentity(factory, phone, options) {
  try {
    return normalizeCampaignPhoneIdentity(await factory(phone, options))
  } catch (error) {
    const code = error && error.code ? String(error.code) : ''
    if (CAMPAIGN_PHONE_IDENTITY_CONFIG_ERROR_CODES.has(code)) {
      throw createIdentityStoreError('Campaign phone identity is unavailable.', {
        code,
        statusCode: 503
      })
    }
    throw createIdentityStoreError('Campaign phone identity is unavailable.')
  }
}

function requireCampaignPhoneBindingColumns(columns) {
  const hashColumn = columns.campaign_phone_identity_hash
  const versionColumn = columns.campaign_phone_hash_version
  const hashType = normalizeString(hashColumn && hashColumn.Type).toLowerCase()
  const versionType = normalizeString(versionColumn && versionColumn.Type).toLowerCase()
  const hashExtra = normalizeString(hashColumn && hashColumn.Extra).toLowerCase()
  const versionExtra = normalizeString(versionColumn && versionColumn.Extra).toLowerCase()

  if (
    !hashColumn ||
    !versionColumn ||
    hashType !== 'binary(32)' ||
    versionType !== 'varchar(16)' ||
    hashExtra.includes('generated') ||
    versionExtra.includes('generated')
  ) {
    throw createIdentityStoreError('Campaign phone identity schema is unavailable.')
  }
}

function getPhoneInput(value) {
  if (value && typeof value === 'object') {
    return value.purePhoneNumber || value.phoneNumber || value.number || ''
  }
  return value
}

function normalizeCountryCode(value) {
  const countryCode = normalizeString(value || DEFAULT_COUNTRY_CODE).replace(/^\+/, '')
  return countryCode || DEFAULT_COUNTRY_CODE
}

function ensureNormalizedPhone(phone, options = {}) {
  if (phone && typeof phone === 'object' && phone.e164 && phone.countryCode && phone.nationalNumber) {
    return {
      countryCode: String(phone.countryCode),
      nationalNumber: String(phone.nationalNumber),
      e164: String(phone.e164)
    }
  }
  return normalizePhone(phone, options)
}

export function normalizePhone(value, options = {}) {
  const rawInput = normalizeString(getPhoneInput(value))
  if (!rawInput) {
    throw createIdentityStoreError('Phone number is required.', {
      code: 'PHONE_REQUIRED',
      statusCode: 400
    })
  }

  const configuredCountryCode = normalizeCountryCode(
    value && typeof value === 'object' ? value.countryCode || options.countryCode : options.countryCode
  )
  const compact = rawInput.replace(/[\s\-().]/g, '')
  const digits = compact.replace(/\D/g, '')

  let countryCode = configuredCountryCode
  let nationalNumber = digits
  if (compact.startsWith('+')) {
    if (digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length === 13) {
      countryCode = DEFAULT_COUNTRY_CODE
      nationalNumber = digits.slice(2)
    } else if (digits.length > configuredCountryCode.length) {
      countryCode = configuredCountryCode
      nationalNumber = digits.slice(configuredCountryCode.length)
    }
  } else if (configuredCountryCode === DEFAULT_COUNTRY_CODE && digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length === 13) {
    nationalNumber = digits.slice(2)
  }

  if (countryCode === DEFAULT_COUNTRY_CODE && !/^1\d{10}$/.test(nationalNumber)) {
    throw createIdentityStoreError('Phone number is invalid.', {
      code: 'PHONE_INVALID',
      statusCode: 400
    })
  }

  if (countryCode !== DEFAULT_COUNTRY_CODE && !/^\d{4,20}$/.test(nationalNumber)) {
    throw createIdentityStoreError('Phone number is invalid.', {
      code: 'PHONE_INVALID',
      statusCode: 400
    })
  }

  return {
    countryCode,
    nationalNumber,
    e164: `+${countryCode}${nationalNumber}`
  }
}

export function hashPhone(phone, options = {}) {
  const normalizedPhone = ensureNormalizedPhone(phone, options)
  const secret = normalizeString(options.secret === undefined ? process.env.PHONE_HASH_SECRET : options.secret)
  if (!secret) {
    throw createIdentityStoreError('Phone hash secret is not configured.', {
      code: 'PHONE_HASH_SECRET_MISSING',
      statusCode: 503
    })
  }

  const hashVersion = normalizeString(options.hashVersion || DEFAULT_HASH_VERSION)
  return {
    phoneHash: crypto.createHmac('sha256', secret).update(normalizedPhone.e164).digest('hex'),
    hashVersion,
    countryCode: normalizedPhone.countryCode
  }
}

export function maskPhone(phone, options = {}) {
  const normalizedPhone = ensureNormalizedPhone(phone, options)
  const national = normalizedPhone.nationalNumber
  if (national.length <= 7) {
    return `${national.slice(0, 1)}****${national.slice(-1)}`
  }
  return `${national.slice(0, 3)}****${national.slice(-4)}`
}

function normalizeBinding(binding) {
  if (!binding || binding.userId === undefined || binding.userId === null) return null
  return {
    ...binding,
    userId: String(binding.userId)
  }
}

export function resolveIdentityConflict(input = {}) {
  const wechatBinding = normalizeBinding(input.wechatBinding)
  const phoneBinding = normalizeBinding(input.phoneBinding)

  if (!wechatBinding && !phoneBinding) {
    return {
      action: 'create_user',
      conflict: false,
      userId: null
    }
  }

  if (wechatBinding && !phoneBinding) {
    return {
      action: 'bind_phone_to_wechat_user',
      conflict: false,
      userId: wechatBinding.userId
    }
  }

  if (!wechatBinding && phoneBinding) {
    return {
      action: 'bind_wechat_to_phone_user',
      conflict: false,
      userId: phoneBinding.userId
    }
  }

  if (wechatBinding.userId === phoneBinding.userId) {
    return {
      action: 'use_existing_user',
      conflict: false,
      userId: wechatBinding.userId
    }
  }

  return {
    action: 'identity_conflict',
    conflict: true,
    code: 'IDENTITY_CONFLICT',
    statusCode: 409
  }
}

async function findWechatBinding(connection, openid) {
  const [rows] = await connection.execute(
    `SELECT user_id, openid, unionid FROM ${quoteIdentifier(WECHAT_BINDINGS_TABLE)} WHERE openid = ? LIMIT 1`,
    [openid]
  )
  const row = Array.isArray(rows) && rows.length ? rows[0] : null
  if (!row || !row.user_id) return null
  return {
    userId: String(row.user_id),
    openid: row.openid,
    unionid: row.unionid || ''
  }
}

async function findPhoneBinding(connection, phoneHash) {
  const [rows] = await connection.execute(
    `SELECT user_id, phone_hash, phone_masked, hash_version, country_code, status, verified_at
       FROM ${quoteIdentifier(PHONE_BINDINGS_TABLE)}
      WHERE phone_hash = ?
      LIMIT 1`,
    [phoneHash]
  )
  const row = Array.isArray(rows) && rows.length ? rows[0] : null
  if (!row || !row.user_id) return null
  return {
    userId: String(row.user_id),
    phoneHash: row.phone_hash,
    phoneMasked: row.phone_masked,
    hashVersion: row.hash_version,
    countryCode: row.country_code,
    status: row.status,
    verifiedAt: row.verified_at || null
  }
}

export async function findIdentityBinding(connection, identity = {}) {
  const openid = normalizeString(identity.openid)
  const phoneHash = normalizeString(identity.phoneHash)
  return {
    wechatBinding: openid ? await findWechatBinding(connection, openid) : null,
    phoneBinding: phoneHash ? await findPhoneBinding(connection, phoneHash) : null
  }
}

async function updateUserLogin(connection, userId, timestamp) {
  const userColumns = await getTableColumns(connection, USERS_TABLE)
  const userUpdate = buildUpdate(
    USERS_TABLE,
    {
      last_login_at: userColumns.last_login_at ? timestamp : undefined
    },
    'WHERE id = ?'
  )
  if (userUpdate) {
    await connection.execute(userUpdate.sql, [...userUpdate.values, userId])
  }
}

async function createUser(connection, openid, timestamp) {
  const userColumns = await getTableColumns(connection, USERS_TABLE)
  const userValues = {
    status: userColumns.status ? 'active' : undefined,
    created_at: userColumns.created_at ? timestamp : undefined,
    last_login_at: userColumns.last_login_at ? timestamp : undefined
  }

  // Compatibility only: identity lookup remains binding-table based.
  if (isRequiredWithoutDefault(userColumns.openid)) {
    userValues.openid = openid
  }

  const userInsert = buildInsert(USERS_TABLE, userValues)
  const [insertResult] = await connection.execute(userInsert.sql, userInsert.values)
  const userId = insertResult && insertResult.insertId
  if (!userId) {
    throw createIdentityStoreError('Failed to create user.', {
      code: 'USER_CREATE_FAILED'
    })
  }
  return String(userId)
}

async function createOrUpdateWechatBinding(connection, userId, identity, timestamp) {
  const openid = normalizeString(identity && identity.openid)
  const unionid = normalizeString(identity && identity.unionid)
  if (!openid) {
    throw createIdentityStoreError('Wechat openid is required.', {
      code: 'WECHAT_OPENID_REQUIRED',
      statusCode: 400
    })
  }

  const existingBinding = await findWechatBinding(connection, openid)
  if (existingBinding && existingBinding.userId !== String(userId)) {
    throw createIdentityStoreError('Identity binding conflict.', {
      code: 'IDENTITY_CONFLICT',
      statusCode: 409
    })
  }

  const bindingColumns = await getTableColumns(connection, WECHAT_BINDINGS_TABLE)
  if (existingBinding) {
    const bindingUpdate = buildUpdate(
      WECHAT_BINDINGS_TABLE,
      {
        unionid: bindingColumns.unionid && unionid ? unionid : undefined,
        updated_at: bindingColumns.updated_at ? timestamp : undefined
      },
      'WHERE openid = ?'
    )
    if (bindingUpdate) {
      await connection.execute(bindingUpdate.sql, [...bindingUpdate.values, openid])
    }
    return
  }

  const bindingInsert = buildInsert(WECHAT_BINDINGS_TABLE, {
    user_id: userId,
    openid,
    unionid: bindingColumns.unionid ? unionid || null : undefined,
    created_at: bindingColumns.created_at ? timestamp : undefined,
    updated_at: bindingColumns.updated_at ? timestamp : undefined
  })
  await connection.execute(bindingInsert.sql, bindingInsert.values)
}

export async function createOrUpdatePhoneBinding(connection, userId, phoneIdentity = {}, options = {}) {
  const phoneHash = normalizeString(phoneIdentity.phoneHash)
  if (!phoneHash) {
    throw createIdentityStoreError('Phone hash is required.', {
      code: 'PHONE_HASH_REQUIRED',
      statusCode: 400
    })
  }

  const timestamp = options.timestamp || new Date()
  const phoneMasked = normalizeString(phoneIdentity.phoneMasked)
  if (!phoneMasked) {
    throw createIdentityStoreError('Masked phone is required.', {
      code: 'PHONE_MASKED_REQUIRED',
      statusCode: 400
    })
  }

  const hashVersion = normalizeString(phoneIdentity.hashVersion || DEFAULT_HASH_VERSION)
  const countryCode = normalizeCountryCode(phoneIdentity.countryCode)
  const campaignPhoneIdentity = normalizeCampaignPhoneIdentity(phoneIdentity)
  const existingBinding = await findPhoneBinding(connection, phoneHash)
  if (existingBinding && existingBinding.userId !== String(userId)) {
    throw createIdentityStoreError('Identity binding conflict.', {
      code: 'IDENTITY_CONFLICT',
      statusCode: 409
    })
  }

  const bindingColumns = await getTableColumns(connection, PHONE_BINDINGS_TABLE)
  requireCampaignPhoneBindingColumns(bindingColumns)
  if (existingBinding) {
    const bindingUpdate = buildUpdate(
      PHONE_BINDINGS_TABLE,
      {
        phone_masked: bindingColumns.phone_masked && phoneMasked ? phoneMasked : undefined,
        hash_version: bindingColumns.hash_version ? hashVersion : undefined,
        country_code: bindingColumns.country_code ? countryCode : undefined,
        campaign_phone_identity_hash: campaignPhoneIdentity.campaignPhoneIdentityHash,
        campaign_phone_hash_version: campaignPhoneIdentity.campaignPhoneHashVersion,
        status: bindingColumns.status ? 'active' : undefined,
        verified_at: bindingColumns.verified_at && !existingBinding.verifiedAt ? timestamp : undefined,
        last_verified_at: bindingColumns.last_verified_at ? timestamp : undefined,
        updated_at: bindingColumns.updated_at ? timestamp : undefined
      },
      'WHERE phone_hash = ?'
    )
    if (bindingUpdate) {
      await connection.execute(bindingUpdate.sql, [...bindingUpdate.values, phoneHash])
    }
    return
  }

  const bindingInsert = buildInsert(PHONE_BINDINGS_TABLE, {
    user_id: userId,
    phone_hash: phoneHash,
    phone_masked: phoneMasked,
    hash_version: bindingColumns.hash_version ? hashVersion : undefined,
    country_code: bindingColumns.country_code ? countryCode : undefined,
    campaign_phone_identity_hash: campaignPhoneIdentity.campaignPhoneIdentityHash,
    campaign_phone_hash_version: campaignPhoneIdentity.campaignPhoneHashVersion,
    status: bindingColumns.status ? 'active' : undefined,
    bound_at: bindingColumns.bound_at ? timestamp : undefined,
    verified_at: bindingColumns.verified_at ? timestamp : undefined,
    last_verified_at: bindingColumns.last_verified_at ? timestamp : undefined,
    created_at: bindingColumns.created_at ? timestamp : undefined,
    updated_at: bindingColumns.updated_at ? timestamp : undefined
  })
  await connection.execute(bindingInsert.sql, bindingInsert.values)
}

export async function findCurrentCampaignPhoneIdentityInTransaction(connection, userId, options = {}) {
  if (!connection || typeof connection.execute !== 'function') {
    throw createIdentityStoreError('Database connection is required.')
  }
  const normalizedUserId = normalizeString(userId)
  if (!normalizedUserId) {
    throw createIdentityStoreError('User id is required.')
  }

  const lockClause = options.forUpdate === true ? ' FOR UPDATE' : ''
  const [rows] = await connection.execute(
    `SELECT campaign_phone_identity_hash, campaign_phone_hash_version
       FROM ${quoteIdentifier(PHONE_BINDINGS_TABLE)}
      WHERE user_id = ?
        AND status = 'active'
      ORDER BY last_verified_at DESC, id DESC
      LIMIT 1${lockClause}`,
    [normalizedUserId]
  )
  const row = Array.isArray(rows) && rows.length ? rows[0] : null
  if (!row) return null
  if (row.campaign_phone_identity_hash === null || row.campaign_phone_hash_version === null) {
    return null
  }

  return normalizeCampaignPhoneIdentity({
    campaignPhoneIdentityHash: row.campaign_phone_identity_hash,
    hashVersion: row.campaign_phone_hash_version
  })
}

export function createIdentityStore(options = {}) {
  let pool = options.pool || null
  const now = options.now || (() => new Date())
  const campaignPhoneIdentityFactory = options.campaignPhoneIdentityFactory || createDefaultCampaignPhoneIdentity
  const identityConflictDiagnostic = createIdentityConflictDiagnostic({
    env: options.identityConflictDiagnosticEnv || process.env,
    logger: options.identityConflictDiagnosticLogger,
    randomUUID: options.identityConflictDiagnosticRandomUUID,
    fileSwitchChecker: options.identityConflictDiagnosticFileSwitchChecker
  })

  function getPool() {
    if (pool) return pool

    const dbConfig = getDbConfig(options)
    if (!dbConfig.configured) {
      throw createIdentityStoreError('User database is not configured.', {
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

  async function resolveWechatPhoneIdentity(identity = {}) {
    const openid = normalizeString(identity.openid)
    const unionid = normalizeString(identity.unionid)
    if (!openid) {
      throw createIdentityStoreError('Wechat openid is required.', {
        code: 'WECHAT_OPENID_REQUIRED',
        statusCode: 400
      })
    }

    const trustedPhone = identity.phone
    const normalizedPhone = normalizePhone(trustedPhone, {
      countryCode: trustedPhone && trustedPhone.countryCode
    })
    const hashedPhone = hashPhone(normalizedPhone, {
      secret: options.phoneHashSecret === undefined ? process.env.PHONE_HASH_SECRET : options.phoneHashSecret,
      hashVersion: options.phoneHashVersion || DEFAULT_HASH_VERSION
    })
    const campaignPhoneIdentity = await resolveCampaignPhoneIdentity(
      campaignPhoneIdentityFactory,
      normalizedPhone.e164,
      {
        secret: options.campaignPhoneIdentityHashSecret === undefined
          ? process.env.CAMPAIGN_PHONE_IDENTITY_HASH_SECRET
          : options.campaignPhoneIdentityHashSecret,
        env: options.campaignPhoneIdentityEnv || process.env
      }
    )
    const phoneIdentity = {
      phoneHash: hashedPhone.phoneHash,
      phoneMasked: maskPhone(normalizedPhone),
      hashVersion: hashedPhone.hashVersion,
      countryCode: hashedPhone.countryCode,
      ...campaignPhoneIdentity
    }

    const connection = await getPool().getConnection()
    const timestamp = now()
    let connectionDisposed = false
    try {
      await connection.beginTransaction()
      const result = await resolveIdentityInTransaction(connection, {
        openid,
        unionid,
        phoneIdentity,
        timestamp,
        allowCreateUser: true
      })
      await connection.commit()
      return result
    } catch (error) {
      if (error && error.code === 'IDENTITY_CONFLICT') {
        connectionDisposed = await rollbackIdentityConflict(connection)
        await emitIdentityConflictDiagnostic(error, identityConflictDiagnostic)
        throw error
      }
      await connection.rollback()
      if (isDuplicateEntryError(error)) {
        return resolveDuplicateIdentity({
          openid,
          unionid,
          phoneIdentity,
          timestamp
        })
      }
      throw error
    } finally {
      if (!connectionDisposed) connection.release()
    }
  }

  async function resolveIdentityInTransaction(connection, options = {}) {
    const bindings = await findIdentityBinding(connection, {
      openid: options.openid,
      phoneHash: options.phoneIdentity.phoneHash
    })
    const resolution = resolveIdentityConflict(bindings)
    if (resolution.conflict) {
      const diagnostic = await identityConflictDiagnostic.collect(connection, {
        aUserId: bindings.wechatBinding.userId,
        bUserId: bindings.phoneBinding.userId,
        requestUnionid: options.unionid,
        aStoredUnionid: bindings.wechatBinding.unionid
      })
      throw createIdentityConflictError(diagnostic)
    }

    if (resolution.action === 'create_user' && !options.allowCreateUser) {
      throw createIdentityStoreError('Identity binding was not ready after duplicate entry.', {
        code: 'IDENTITY_DUPLICATE_RETRY_PENDING',
        statusCode: 409
      })
    }

    const isNew = resolution.action === 'create_user'
    const userId = isNew ? await createUser(connection, options.openid, options.timestamp) : resolution.userId
    await updateUserLogin(connection, userId, options.timestamp)
    await createOrUpdateWechatBinding(connection, userId, {
      openid: options.openid,
      unionid: options.unionid
    }, options.timestamp)
    await createOrUpdatePhoneBinding(connection, userId, options.phoneIdentity, {
      timestamp: options.timestamp
    })

    return {
      id: String(userId),
      isNew,
      hasWechatBinding: true,
      hasPhoneBinding: true,
      phoneMasked: options.phoneIdentity.phoneMasked
    }
  }

  async function resolveDuplicateIdentity(options = {}) {
    const maxAttempts = 3
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) await wait(25)
      const retryConnection = await getPool().getConnection()
      let retryConnectionDisposed = false
      try {
        await retryConnection.beginTransaction()
        const result = await resolveIdentityInTransaction(retryConnection, {
          openid: options.openid,
          unionid: options.unionid,
          phoneIdentity: options.phoneIdentity,
          timestamp: options.timestamp,
          allowCreateUser: false
        })
        await retryConnection.commit()
        return {
          ...result,
          isNew: false
        }
      } catch (error) {
        if (error && error.code === 'IDENTITY_CONFLICT') {
          retryConnectionDisposed = await rollbackIdentityConflict(retryConnection)
          await emitIdentityConflictDiagnostic(error, identityConflictDiagnostic)
          throw error
        }
        await retryConnection.rollback()
        const shouldRetry =
          error.code === 'IDENTITY_DUPLICATE_RETRY_PENDING' ||
          isDuplicateEntryError(error)
        if (shouldRetry && attempt < maxAttempts - 1) {
          continue
        }
        if (isDuplicateEntryError(error)) {
          throw createIdentityConflictError()
        }
        throw error
      } finally {
        if (!retryConnectionDisposed) retryConnection.release()
      }
    }

    throw createIdentityStoreError('Identity binding was not resolved after duplicate entry.', {
      code: 'IDENTITY_DUPLICATE_RETRY_FAILED',
      statusCode: 409
    })
  }

  return {
    resolveWechatPhoneIdentity
  }
}
