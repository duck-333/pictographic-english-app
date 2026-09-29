import { parseDatabaseSafeInteger } from './invitation-test-database-integers.mjs'

export const MYSQL_RESOURCE_STATES = Object.freeze({
  NOT_ATTEMPTED: 'not_attempted',
  UNCERTAIN: 'uncertain',
  CREATED: 'created',
  COLLISION: 'collision'
})

function cleanupEligible(resource) {
  if (!resource) return false
  return resource.state === MYSQL_RESOURCE_STATES.CREATED ||
    (resource.state === MYSQL_RESOURCE_STATES.UNCERTAIN && resource.preflightAbsent === true)
}

function record(errors, stage, error) {
  errors.push({ stage, error })
}

async function countDatabase(root, name) {
  const [rows] = await root.execute(`SELECT CAST(COUNT(*) AS CHAR) AS resource_count
    FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`, [name])
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Database residual query was malformed.')
  return parseDatabaseSafeInteger(rows[0].resource_count, 'database residual COUNT')
}

async function countUser(root, resource) {
  const [rows] = await root.execute(`SELECT CAST(COUNT(*) AS CHAR) AS resource_count
    FROM mysql.user WHERE User = ? AND Host = ?`, [resource.name, resource.host])
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('User residual query was malformed.')
  return parseDatabaseSafeInteger(rows[0].resource_count, 'test user residual COUNT')
}

export async function cleanupInvitationMysqlTest(options = {}) {
  const errors = []
  const pools = Array.isArray(options.pools)
    ? options.pools
    : options.pool ? [{ stage: 'pool.end', pool: options.pool }] : []
  for (const entry of pools) {
    if (!entry?.pool) continue
    try { await entry.pool.end() } catch (error) { record(errors, entry.stage || 'pool.end', error) }
  }

  const root = options.root
  const database = options.databaseResource || (options.owned ? {
    name: options.databaseName,
    state: MYSQL_RESOURCE_STATES.CREATED,
    preflightAbsent: true
  } : null)
  if (root && cleanupEligible(database)) {
    if (database.state === MYSQL_RESOURCE_STATES.UNCERTAIN) {
      try { await countDatabase(root, database.name) } catch (error) { record(errors, 'database uncertain check', error) }
    }
    try {
      await root.query(`DROP DATABASE IF EXISTS ${options.quoteDatabase(database.name)}`)
    } catch (error) { record(errors, 'drop database', error) }
    try {
      if (await countDatabase(root, database.name) !== 0) {
        const error = new Error('Invitation test database cleanup verification failed.')
        error.code = 'INVITATION_MYSQL_DATABASE_RESIDUAL'
        record(errors, 'database residual check', error)
      }
    } catch (error) { record(errors, 'database residual check', error) }
  }

  const userResources = Array.isArray(options.userResources)
    ? options.userResources
    : options.testUserCreated ? [{
      name: options.testUserName,
      host: options.testUserHost,
      state: MYSQL_RESOURCE_STATES.CREATED,
      preflightAbsent: true,
      label: 'test user'
    }] : []
  for (const resource of userResources) {
    if (!root || !cleanupEligible(resource)) continue
    const label = resource.label || 'test user'
    if (resource.state === MYSQL_RESOURCE_STATES.UNCERTAIN) {
      try { await countUser(root, resource) } catch (error) { record(errors, `${label} uncertain check`, error) }
    }
    try {
      await root.query(`DROP USER IF EXISTS ${options.quoteTestAccount(resource.name, resource.host)}`)
    } catch (error) { record(errors, `drop ${label}`, error) }
    try {
      if (await countUser(root, resource) !== 0) {
        const error = new Error('Invitation test user cleanup verification failed.')
        error.code = 'INVITATION_MYSQL_USER_RESIDUAL'
        record(errors, `${label} residual check`, error)
      }
    } catch (error) { record(errors, `${label} residual check`, error) }
  }

  if (root) {
    try {
      const [rows] = await root.execute('SELECT CAST(1 AS CHAR) AS mysql_healthy')
      if (!Array.isArray(rows) || rows.length !== 1 ||
          parseDatabaseSafeInteger(rows[0].mysql_healthy, 'MySQL health result') !== 1) {
        const error = new Error('Invitation test MySQL health check failed.')
        error.code = 'INVITATION_MYSQL_HEALTH_CHECK_FAILED'
        record(errors, 'mysql health check', error)
      }
    } catch (error) { record(errors, 'mysql health check', error) }
    try { await root.end() } catch (error) { record(errors, 'root.end', error) }
  }
  return errors
}

export function throwInvitationMysqlTestErrors(testError, cleanupErrors = []) {
  if (!testError && cleanupErrors.length === 0) return
  if (testError && cleanupErrors.length === 0) throw testError
  const cleanupCauses = cleanupErrors.map(item => item.error)
  const aggregate = new AggregateError(testError ? [testError, ...cleanupCauses] : cleanupCauses,
    testError ? 'Invitation MySQL test and cleanup failed.' : 'Invitation MySQL cleanup failed.',
    testError ? { cause: testError } : undefined)
  aggregate.code = 'INVITATION_MYSQL_TEST_CLEANUP_FAILED'
  aggregate.originalError = testError || null
  aggregate.cleanupErrors = cleanupErrors
  throw aggregate
}
