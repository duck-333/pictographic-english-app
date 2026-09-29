import assert from 'node:assert/strict'

import { MYSQL_RESOURCE_STATES } from './invitation-mysql-cleanup.mjs'
import { parseDatabaseSafeInteger } from './invitation-test-database-integers.mjs'

function collision(message) {
  const error = new Error(message)
  error.code = 'INVITATION_MYSQL_RESOURCE_NAME_COLLISION'
  return error
}

const SAFE_MYSQL_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u
const SAFE_MYSQL_SQL_STATE = /^[0-9A-Z]{5}$/u

function sanitizeCreateUserError(error) {
  const sanitized = new Error('Invitation MySQL test user creation failed.')
  sanitized.code = typeof error?.code === 'string' && SAFE_MYSQL_ERROR_CODE.test(error.code)
    ? error.code
    : 'INVITATION_MYSQL_CREATE_USER_ERROR'
  sanitized.internalCode = 'INVITATION_MYSQL_CREATE_USER_FAILED'
  try {
    if (error?.errno !== undefined) {
      sanitized.errno = parseDatabaseSafeInteger(error.errno, 'CREATE USER errno')
    }
  } catch {
    // Malformed driver metadata is omitted instead of copied into the public error.
  }
  if (typeof error?.sqlState === 'string' && SAFE_MYSQL_SQL_STATE.test(error.sqlState)) {
    sanitized.sqlState = error.sqlState
  }
  return sanitized
}

async function exactUserCount(root, resource, label) {
  const [rows] = await root.execute(`SELECT CAST(COUNT(*) AS CHAR) AS resource_count
    FROM mysql.user WHERE User=? AND Host=?`, [resource.name, resource.host])
  assert.equal(rows.length, 1)
  return parseDatabaseSafeInteger(rows[0].resource_count, label)
}

export function createMysqlResource(name, options = {}) {
  return {
    name,
    host: options.host,
    label: options.label,
    state: MYSQL_RESOURCE_STATES.NOT_ATTEMPTED,
    preflightAbsent: false
  }
}

export async function createDatabaseResource(root, resource, options = {}) {
  const [rows] = await root.execute(`SELECT CAST(COUNT(*) AS CHAR) AS resource_count
    FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?`, [resource.name])
  assert.equal(rows.length, 1)
  if (parseDatabaseSafeInteger(rows[0].resource_count, 'database preflight COUNT') !== 0) {
    resource.state = MYSQL_RESOURCE_STATES.COLLISION
    throw collision('Random test database name already exists.')
  }
  resource.preflightAbsent = true
  resource.state = MYSQL_RESOURCE_STATES.UNCERTAIN
  try {
    await root.query(`CREATE DATABASE ${options.quoteDatabase(resource.name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    resource.state = MYSQL_RESOURCE_STATES.CREATED
  } catch (error) {
    if (error?.code === 'ER_DB_CREATE_EXISTS') resource.state = MYSQL_RESOURCE_STATES.COLLISION
    throw error
  }
}

export async function createUserResource(root, resource, password, options = {}) {
  if (await exactUserCount(root, resource, 'user preflight COUNT') !== 0) {
    resource.state = MYSQL_RESOURCE_STATES.COLLISION
    throw collision(`Random ${resource.label} name already exists.`)
  }
  resource.preflightAbsent = true
  resource.state = MYSQL_RESOURCE_STATES.UNCERTAIN
  try {
    await root.query(`CREATE USER ${options.quoteTestAccount(resource.name, resource.host)} IDENTIFIED BY ?`, [password])
    resource.state = MYSQL_RESOURCE_STATES.CREATED
  } catch (error) {
    if (error?.code === 'ER_CANNOT_USER') {
      try {
        if (await exactUserCount(root, resource, 'user collision verification COUNT') !== 0) {
          resource.state = MYSQL_RESOURCE_STATES.COLLISION
        }
      } catch {
        // The CREATE result remains uncertain when the exact verification itself fails.
      }
    }
    throw sanitizeCreateUserError(error)
  }
}
