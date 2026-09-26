export async function cleanupInvitationMysqlTest(options = {}) {
  const errors = []
  if (options.pool) {
    try { await options.pool.end() } catch (error) { errors.push({ stage: 'pool.end', error }) }
  }
  if (options.owned && options.root) {
    try {
      await options.root.query(`DROP DATABASE ${options.quoteDatabase(options.databaseName)}`)
    } catch (error) { errors.push({ stage: 'drop database', error }) }
    try {
      const [remaining] = await options.root.execute(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [options.databaseName])
      if (!Array.isArray(remaining) || remaining.length !== 0) {
        const error = new Error('Invitation test database cleanup verification failed.')
        error.code = 'INVITATION_MYSQL_DATABASE_RESIDUAL'
        errors.push({ stage: 'database residual check', error })
      }
    } catch (error) { errors.push({ stage: 'database residual check', error }) }
  }
  if (options.root) {
    try { await options.root.end() } catch (error) { errors.push({ stage: 'root.end', error }) }
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
