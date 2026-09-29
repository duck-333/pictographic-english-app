import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

export const INVITATION_MIGRATION_FILES = Object.freeze([
  '001_create_user_phone_bindings.sql',
  '002_create_user_favorites.sql',
  '003_create_user_recent_words.sql',
  '004_create_user_entitlements.sql',
  '005_create_entitlement_transactions.sql',
  '006_create_membership_grants.sql',
  '007_create_book_benefit_redemption_foundation.sql',
  '008_extend_book_benefit_issuance_review.sql',
  '009_create_virtual_payment_foundation.sql',
  '010_create_virtual_payment_delivery_attempts.sql',
  '011_create_invitation_reward_foundation.sql'
])

// Minimal bootstrap fixture only: these two formal base tables have no repository migration source.
export const INVITATION_MYSQL_BOOTSTRAP_FIXTURES = Object.freeze([
  Object.freeze({
    name: 'users',
    reason: 'No users base-table migration exists in database/migrations.',
    sql: `CREATE TABLE users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_login_at DATETIME(3) NULL DEFAULT NULL
    ) ENGINE=InnoDB`
  }),
  Object.freeze({
    name: 'wechat_user_bindings',
    reason: 'No WeChat binding base-table migration exists in database/migrations.',
    sql: `CREATE TABLE wechat_user_bindings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      openid VARCHAR(191) NOT NULL,
      unionid VARCHAR(191) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uk_wechat_user_bindings_openid (openid),
      KEY idx_wechat_user_bindings_user_id (user_id)
    ) ENGINE=InnoDB`
  })
])

const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/u

function manifestError(message) {
  const error = new Error(message)
  error.code = 'INVITATION_MYSQL_MIGRATION_MANIFEST_INVALID'
  return error
}

function parseManifestEntries(entries) {
  if (!Array.isArray(entries)) throw manifestError('Frozen migration manifest must be an array.')
  const parsed = []
  const versions = new Set()
  for (const entry of entries) {
    if (typeof entry !== 'string') throw manifestError('Frozen migration manifest contains a non-string entry.')
    const match = MIGRATION_FILENAME.exec(entry)
    if (!match) throw manifestError('Frozen migration manifest contains an invalid migration filename.')
    const version = match[1]
    if (versions.has(version)) throw manifestError('Frozen migration manifest contains a duplicate migration version.')
    versions.add(version)
    parsed.push({ filename: entry, version })
  }
  return parsed
}

function parseDirectoryEntries(entries) {
  if (!Array.isArray(entries)) throw manifestError('Migration directory listing must be an array.')
  const parsed = []
  const versions = new Set()
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || typeof entry.isFile !== 'function') {
      throw manifestError('Migration directory returned an invalid directory entry.')
    }
    if (!entry.isFile()) throw manifestError('Migration directory contains a non-file entry.')
    const match = MIGRATION_FILENAME.exec(entry.name)
    if (!match) throw manifestError('Migration directory contains a non-canonical filename.')
    const version = match[1]
    if (versions.has(version)) throw manifestError('Migration directory contains a duplicate migration version.')
    versions.add(version)
    parsed.push({ filename: entry.name, version })
  }
  return parsed
}

export function validateInvitationMigrationManifest(actualEntries, manifest = INVITATION_MIGRATION_FILES) {
  const parsedManifest = parseManifestEntries([...manifest])
  const canonicalManifest = [...parsedManifest].sort((left, right) =>
    left.version.localeCompare(right.version) || left.filename.localeCompare(right.filename))
  const manifestNames = parsedManifest.map(entry => entry.filename)
  const canonicalManifestNames = canonicalManifest.map(entry => entry.filename)
  if (!manifestNames.every((filename, index) => filename === canonicalManifestNames[index])) {
    throw manifestError('Frozen migration manifest is not in canonical version order.')
  }

  const parsedActual = parseDirectoryEntries(actualEntries)
  const canonicalActualNames = [...parsedActual]
    .sort((left, right) => left.version.localeCompare(right.version) ||
      left.filename.localeCompare(right.filename))
    .map(entry => entry.filename)
  if (canonicalActualNames.length !== manifestNames.length ||
      !canonicalActualNames.every((filename, index) => filename === manifestNames[index])) {
    throw manifestError('Migration directory does not exactly match the frozen manifest.')
  }
  return Object.freeze([...canonicalActualNames])
}

export async function runInvitationRepositoryMigrations(connection, options = {}) {
  assert(connection && typeof connection.query === 'function')
  const read = options.readFile || readFile
  const listDirectory = options.readdir || readdir
  const manifest = options.manifest || INVITATION_MIGRATION_FILES
  const directoryUrl = new URL('../database/migrations/', import.meta.url)
  const actualEntries = await listDirectory(directoryUrl, { withFileTypes: true })
  const validatedManifest = validateInvitationMigrationManifest(actualEntries, manifest)
  const executed = []
  for (const fixture of INVITATION_MYSQL_BOOTSTRAP_FIXTURES) {
    assert(fixture.reason)
    await connection.query(fixture.sql)
  }
  for (const filename of validatedManifest) {
    const url = new URL(filename, directoryUrl)
    const sql = await read(url, 'utf8')
    assert.equal(typeof sql, 'string')
    assert(sql.trim())
    await connection.query(sql)
    executed.push(filename)
  }
  assert.deepEqual(executed, validatedManifest)
  return Object.freeze([...executed])
}
