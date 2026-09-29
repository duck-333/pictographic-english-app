import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  INVITATION_MIGRATION_FILES,
  INVITATION_MYSQL_BOOTSTRAP_FIXTURES,
  runInvitationRepositoryMigrations,
  validateInvitationMigrationManifest
} from './invitation-mysql-migrations.mjs'

function file(name) {
  return Object.freeze({ name, isFile: () => true })
}

function directory(name) {
  return Object.freeze({ name, isFile: () => false })
}

function files(names = INVITATION_MIGRATION_FILES) {
  return names.map(file)
}

function manifestFailure(entries, manifest = INVITATION_MIGRATION_FILES) {
  assert.throws(() => validateInvitationMigrationManifest(entries, manifest),
    error => error.code === 'INVITATION_MYSQL_MIGRATION_MANIFEST_INVALID')
}

manifestFailure(files(INVITATION_MIGRATION_FILES.slice(0, -1)))
manifestFailure(files([...INVITATION_MIGRATION_FILES, '001_duplicate.sql']))
manifestFailure(files([...INVITATION_MIGRATION_FILES, '012_uncreated_extra.sql']))
manifestFailure(files(), [...INVITATION_MIGRATION_FILES].reverse())

const invalidDirectoryCases = Object.freeze([
  ['README.md', file('README.md')],
  ['.DS_Store', file('.DS_Store')],
  ['subdirectory', directory('archive')],
  ['notes.txt', file('notes.txt')],
  ['duplicate version', file('001_duplicate.sql')],
  ['uppercase filename', file('001_BAD.sql')],
  ['special character filename', file('001_bad-name.sql')],
  ['backup filename', file('001_backup.sql.bak')]
])
for (const [, invalidEntry] of invalidDirectoryCases) {
  manifestFailure([...files(), invalidEntry])
}

const unorderedNames = [
  INVITATION_MIGRATION_FILES[7],
  INVITATION_MIGRATION_FILES[1],
  INVITATION_MIGRATION_FILES[10],
  INVITATION_MIGRATION_FILES[0],
  ...INVITATION_MIGRATION_FILES.slice(2, 7),
  ...INVITATION_MIGRATION_FILES.slice(8, 10)
]
const unordered = files(unorderedNames)
assert.deepEqual(validateInvitationMigrationManifest(unordered), INVITATION_MIGRATION_FILES)

const failClosedCases = [
  files(INVITATION_MIGRATION_FILES.slice(1)),
  files([...INVITATION_MIGRATION_FILES, '001_duplicate.sql']),
  files([...INVITATION_MIGRATION_FILES, '012_uncreated_extra.sql']),
  ...invalidDirectoryCases.map(([, entry]) => [...files(), entry])
]
for (const entries of failClosedCases) {
  const queries = []
  let readdirOptions = null
  await assert.rejects(() => runInvitationRepositoryMigrations({
    async query(sql) { queries.push(String(sql)); return [[], []] }
  }, {
    async readdir(url, options) {
      assert(url instanceof URL)
      readdirOptions = options
      return entries
    }
  }), error => error.code === 'INVITATION_MYSQL_MIGRATION_MANIFEST_INVALID')
  assert.deepEqual(readdirOptions, { withFileTypes: true })
  assert.equal(queries.length, 0, 'directory validation must finish before bootstrap or migration SQL')
}

const reads = []
const queries = []
let successfulReaddirOptions = null
const connection = { async query(sql) { queries.push(String(sql)); return [[], []] } }
const executed = await runInvitationRepositoryMigrations(connection, {
  async readdir(url, options) {
    assert(url instanceof URL)
    successfulReaddirOptions = options
    return unordered
  },
  async readFile(url) {
    const filename = decodeURIComponent(String(url.pathname).split('/').at(-1))
    reads.push(filename)
    return `-- ${filename}\nSELECT '${filename}'`
  }
})

assert.deepEqual(successfulReaddirOptions, { withFileTypes: true })
assert.deepEqual(reads, INVITATION_MIGRATION_FILES)
assert.deepEqual(executed, INVITATION_MIGRATION_FILES)
assert.equal(new Set(reads).size, 11)
assert.equal(queries.length, INVITATION_MYSQL_BOOTSTRAP_FIXTURES.length + 11)
assert(queries[0].includes('CREATE TABLE users'))
assert(queries[1].includes('CREATE TABLE wechat_user_bindings'))

const actualQueries = []
const actualExecuted = await runInvitationRepositoryMigrations({
  async query(sql) { actualQueries.push(String(sql)); return [[], []] }
})
assert.deepEqual(actualExecuted, INVITATION_MIGRATION_FILES)
assert.equal(actualQueries.length, INVITATION_MYSQL_BOOTSTRAP_FIXTURES.length + 11)
for (const [index, filename] of INVITATION_MIGRATION_FILES.entries()) {
  const expected = await readFile(new URL(`../database/migrations/${filename}`, import.meta.url), 'utf8')
  assert.equal(actualQueries[INVITATION_MYSQL_BOOTSTRAP_FIXTURES.length + index], expected)
}

console.log(`invitation migration directory strictly equals frozen 001-011 manifest; ${invalidDirectoryCases.length} invalid-entry classes rejected before SQL`)
