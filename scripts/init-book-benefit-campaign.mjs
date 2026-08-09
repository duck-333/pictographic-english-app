import mysql from 'mysql2/promise'
import { pathToFileURL } from 'node:url'

const CAMPAIGN_KEY = 'book-benefit-30d-v1'
const CAMPAIGN_NAME = '购书用户30天会员福利'
const BENEFIT_DAYS = 30
const RULES_VERSION = 'book-benefit-rules-v1'
const MUTATING_ACTIONS = new Set(['create-draft', 'activate', 'pause', 'end'])
const ACTIONS = new Set([...MUTATING_ACTIONS, 'status'])

function campaignError(message, code = 'BOOK_BENEFIT_CAMPAIGN_INIT_ERROR') {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeNow(value) {
  const date = value === undefined ? new Date() : new Date(value)
  if (Number.isNaN(date.getTime())) throw campaignError('Campaign operation time is invalid.')
  return date
}

function normalizeOperatorId(value) {
  if (typeof value !== 'string') throw campaignError('Campaign operator id is invalid.')
  const normalized = value.normalize('NFKC').trim()
  if (!normalized || normalized.length > 191 || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/.test(normalized)) {
    throw campaignError('Campaign operator id is invalid.')
  }
  return normalized
}

function mapCampaign(row) {
  if (!row) return null
  const startsAt = row.starts_at === null ? null : new Date(row.starts_at)
  const endsAt = row.ends_at === null ? null : new Date(row.ends_at)
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) {
    throw campaignError('Campaign time fields are invalid.')
  }
  return {
    campaignId: String(row.id),
    campaignKey: row.campaign_key,
    name: row.name,
    status: row.status,
    benefitDays: Number(row.benefit_days),
    rulesVersion: row.rules_version,
    startsAt,
    endsAt
  }
}

function assertFixedCampaign(row) {
  if (
    row.campaign_key !== CAMPAIGN_KEY ||
    row.name !== CAMPAIGN_NAME ||
    Number(row.benefit_days) !== BENEFIT_DAYS ||
    row.rules_version !== RULES_VERSION
  ) {
    throw campaignError('Existing fixed campaign does not match the required definition.', 'BOOK_BENEFIT_CAMPAIGN_CONFIG_CONFLICT')
  }
}

async function selectCampaign(connection, forUpdate) {
  const [rows] = await connection.execute(
    `SELECT id, campaign_key, name, status, benefit_days, rules_version, starts_at, ends_at
       FROM book_benefit_campaigns
      WHERE campaign_key = ?
      LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [CAMPAIGN_KEY]
  )
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

async function runMutation(connection, action, options) {
  const now = normalizeNow(options.now)
  const existing = await selectCampaign(connection, true)
  if (action === 'create-draft') {
    if (existing) {
      assertFixedCampaign(existing)
      return { ...mapCampaign(existing), created: false }
    }
    const operatorId = normalizeOperatorId(options.operatorId)
    const [result] = await connection.execute(
      `INSERT INTO book_benefit_campaigns (
         campaign_key, name, status, benefit_days, starts_at, ends_at,
         created_by, created_at, updated_at, rules_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [CAMPAIGN_KEY, CAMPAIGN_NAME, 'draft', BENEFIT_DAYS, null, null, operatorId, now, now, RULES_VERSION]
    )
    if (!result || !result.insertId) throw campaignError('Fixed campaign was not created.')
    return {
      campaignId: String(result.insertId), campaignKey: CAMPAIGN_KEY, name: CAMPAIGN_NAME,
      status: 'draft', benefitDays: BENEFIT_DAYS, rulesVersion: RULES_VERSION,
      startsAt: null, endsAt: null, created: true
    }
  }

  if (!existing) throw campaignError('Fixed campaign was not found.', 'BOOK_BENEFIT_CAMPAIGN_NOT_FOUND')
  assertFixedCampaign(existing)
  let sql = ''
  let params = []
  if (action === 'activate') {
    if (!['draft', 'paused'].includes(existing.status)) {
      throw campaignError('Fixed campaign cannot be activated from its current status.', 'BOOK_BENEFIT_CAMPAIGN_STATE_CONFLICT')
    }
    sql = `UPDATE book_benefit_campaigns
              SET status = 'active', starts_at = COALESCE(starts_at, ?), updated_at = ?
            WHERE campaign_key = ? AND status IN ('draft', 'paused')`
    params = [now, now, CAMPAIGN_KEY]
  } else if (action === 'pause') {
    if (existing.status !== 'active') {
      throw campaignError('Fixed campaign cannot be paused from its current status.', 'BOOK_BENEFIT_CAMPAIGN_STATE_CONFLICT')
    }
    sql = `UPDATE book_benefit_campaigns SET status = 'paused', updated_at = ?
            WHERE campaign_key = ? AND status = 'active'`
    params = [now, CAMPAIGN_KEY]
  } else if (action === 'end') {
    if (!['active', 'paused'].includes(existing.status)) {
      throw campaignError('Fixed campaign cannot be ended from its current status.', 'BOOK_BENEFIT_CAMPAIGN_STATE_CONFLICT')
    }
    sql = `UPDATE book_benefit_campaigns SET status = 'ended', ends_at = ?, updated_at = ?
            WHERE campaign_key = ? AND status IN ('active', 'paused')`
    params = [now, now, CAMPAIGN_KEY]
  }
  const [result] = await connection.execute(sql, params)
  if (!result || Number(result.affectedRows) !== 1) {
    throw campaignError('Fixed campaign state changed concurrently.', 'BOOK_BENEFIT_CAMPAIGN_STATE_CONFLICT')
  }
  const updated = await selectCampaign(connection, false)
  assertFixedCampaign(updated)
  return mapCampaign(updated)
}

export async function runBookBenefitCampaignAction(action, options = {}) {
  if (!ACTIONS.has(action)) throw campaignError('Unsupported fixed campaign action.')
  const pool = options.pool
  if (!pool || typeof pool.getConnection !== 'function') throw campaignError('Campaign database pool is required.')
  const connection = await pool.getConnection()
  if (action === 'status') {
    let result = null
    let primaryError = null
    try {
      const row = await selectCampaign(connection, false)
      if (!row) throw campaignError('Fixed campaign was not found.', 'BOOK_BENEFIT_CAMPAIGN_NOT_FOUND')
      assertFixedCampaign(row)
      result = mapCampaign(row)
    } catch (error) {
      primaryError = error
    }
    let releaseError = null
    try { connection.release() } catch (error) { releaseError = error }
    if (primaryError) throw primaryError
    if (releaseError) throw releaseError
    return result
  }

  let transactionStarted = false
  let transactionCommitted = false
  let result = null
  let primaryError = null
  try {
    await connection.beginTransaction()
    transactionStarted = true
    result = await runMutation(connection, action, options)
    await connection.commit()
    transactionStarted = false
    transactionCommitted = true
  } catch (error) {
    primaryError = error
    if (transactionStarted && !transactionCommitted) {
      try { await connection.rollback() } catch { /* Preserve the primary error. */ }
    }
  }
  let releaseError = null
  try { connection.release() } catch (error) { releaseError = error }
  if (primaryError) throw primaryError
  if (releaseError) throw releaseError
  return result
}

function createCliPool(action) {
  if (MUTATING_ACTIONS.has(action) && process.env.BOOK_BENEFIT_INIT_CONFIRM !== CAMPAIGN_KEY) {
    throw campaignError('Campaign mutation confirmation is missing.')
  }
  const host = String(process.env.BOOK_BENEFIT_INIT_DB_HOST || '').trim()
  const port = Number(process.env.BOOK_BENEFIT_INIT_DB_PORT)
  const database = String(process.env.BOOK_BENEFIT_INIT_DB_NAME || '').trim()
  const user = String(process.env.BOOK_BENEFIT_INIT_DB_USER || '').trim()
  const password = String(process.env.BOOK_BENEFIT_INIT_DB_PASSWORD || '')
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || !database || !user || !password) {
    throw campaignError('Dedicated campaign database configuration is incomplete.')
  }
  return mysql.createPool({ host, port, database, user, password, connectionLimit: 1, namedPlaceholders: false })
}

async function main() {
  const action = String(process.argv[2] || '').trim()
  if (!ACTIONS.has(action)) throw campaignError('Action must be create-draft, activate, pause, end, or status.')
  const pool = createCliPool(action)
  try {
    const result = await runBookBenefitCampaignAction(action, {
      pool,
      operatorId: process.env.BOOK_BENEFIT_INIT_OPERATOR_ID
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.exitCode = 1
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'BOOK_BENEFIT_CAMPAIGN_INIT_ERROR'
    process.stderr.write(`Book-benefit campaign command failed (${code}).\n`)
  })
}
