import { createMysqlResource, createUserResource } from './invitation-mysql-resource-lifecycle.mjs'
import { assertExactDatabaseGrants } from './invitation-mysql-privileges.mjs'

export const INVITATION_MIGRATION_USER_PRIVILEGES = Object.freeze([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES'
])
export const INVITATION_RUNTIME_USER_PRIVILEGES = Object.freeze([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE'
])

export function createInvitationMysqlTestUserResources(options) {
  return Object.freeze({
    migrationUserResource: createMysqlResource(options.migrationUserName, {
      host: options.clientHost,
      label: 'migration user'
    }),
    runtimeUserResource: createMysqlResource(options.runtimeUserName, {
      host: options.clientHost,
      label: 'runtime user'
    })
  })
}

export async function provisionInvitationMysqlTestUsers(options) {
  const {
    root,
    databaseName,
    migrationUserResource,
    runtimeUserResource,
    migrationUserPassword,
    runtimeUserPassword,
    quoteDatabase,
    quoteTestAccount
  } = options
  await createUserResource(root, migrationUserResource, migrationUserPassword, { quoteTestAccount })
  await createUserResource(root, runtimeUserResource, runtimeUserPassword, { quoteTestAccount })
  await root.query(`GRANT ${INVITATION_MIGRATION_USER_PRIVILEGES.join(', ')}
    ON ${quoteDatabase(databaseName)}.* TO ${quoteTestAccount(migrationUserResource.name, migrationUserResource.host)}`)
  await root.query(`GRANT ${INVITATION_RUNTIME_USER_PRIVILEGES.join(', ')}
    ON ${quoteDatabase(databaseName)}.* TO ${quoteTestAccount(runtimeUserResource.name, runtimeUserResource.host)}`)
  await assertExactDatabaseGrants(root, migrationUserResource, databaseName,
    new Set(INVITATION_MIGRATION_USER_PRIVILEGES), quoteTestAccount)
  await assertExactDatabaseGrants(root, runtimeUserResource, databaseName,
    new Set(INVITATION_RUNTIME_USER_PRIVILEGES), quoteTestAccount)
}
