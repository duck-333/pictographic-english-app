import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { WORDS } from './fixtures/development-full-word-data.mjs'

// Isolated generated fixtures outside the repository; never delete user files.
const fixture = await mkdtemp(path.join(tmpdir(), 'content-release-verifier-'))
const release = path.join(fixture, 'release')
await mkdir(release)
for (let index = 0; index < 6; index += 1) {
  await writeFile(path.join(release, `${index}.js`), '// public fixture\n')
}
for (const asset of ['game-baxiaota/static/guide-detail.png', 'game-baxiaota/static/guide-search.png', 'static/baxiaota/entry.png']) {
  const target = path.join(release, asset)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, 'public fixture asset')
}
const verifier = fileURLToPath(new URL('./verify-content-security-release.mjs', import.meta.url))
const clean = [{ name: './common/public-word.js', chunks: ['common/vendor'], modules: [{ name: './common/mock-data.js' }] }]
let cases = 0
async function check(name, data, expectedError, options = {}) {
  const inventory = path.join(fixture, `${name}.json`)
  if (data !== undefined) await writeFile(inventory, typeof data === 'string' ? data : JSON.stringify(data))
  const argument = options.omit ? [] : [options.directory ? fixture : inventory]
  const result = spawnSync(process.execPath, [verifier, release, ...argument], { encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  const output = `${result.stdout}${result.stderr}`
  if (expectedError) {
    assert.notEqual(result.status, 0, `${name}: expected failure`)
    assert.match(output, expectedError, name)
    assert.doesNotMatch(output, /Fresh HBuilderX release:|dependencies absent/, `${name}: false pass conclusion`)
  } else {
    assert.equal(result.status, 0, output)
    assert.match(result.stdout, /dependency graph checked \(1 top-level modules\)/)
    assert.match(result.stdout, /private fixture strings absent/)
    assert.match(result.stdout, /Source commit binding is not verified/)
  }
  cases += 1
}
await check('missing-argument', undefined, /Module inventory is required/, { omit: true })
await check('missing-file', undefined, /could not be read or parsed/)
await check('unreadable-directory', undefined, /could not be read or parsed/, { directory: true })
await check('malformed-json', '{', /could not be read or parsed/)
for (const [name, data] of [['empty-array', []], ['object', {}], ['null', null]]) {
  await check(name, data, /non-empty module array/)
}
for (const [name, data] of [
  ['invalid-entry', [null]], ['missing-name', [{ chunks: [] }]],
  ['blank-name', [{ name: ' ', chunks: [] }]], ['missing-chunks', [{ name: 'main' }]],
  ['invalid-chunks', [{ name: 'main', chunks: [null] }]],
  ['invalid-nested', [{ name: 'main', chunks: [], modules: {} }]],
  ['invalid-nested-entry', [{ name: 'main', chunks: [], modules: [null] }]]
]) await check(name, data, /Module inventory|module inventory/)
await check('preview-dependency', [{ name: './common/dev-preview-data.js', chunks: [] }], /Development data remains/)
await check('full-dependency', [{ name: './scripts/fixtures/development-full-word-data.mjs', chunks: [] }], /Development data remains/)
await check('nested-dependency', [{ name: 'main', chunks: [], modules: [{ name: './common/dev-preview-data.js' }] }], /Development data remains/)
await check('escaped-dependency', '[{"name":"./common/dev-preview-\\u0064ata.js","chunks":[]}]', /Development data remains/)
await check('clean', clean)
const privateText = WORDS.find((word) => word.pictograph && word.pictograph.length >= 16).pictograph
await writeFile(path.join(release, '0.js'), `// ${privateText}\n`)
await check('private-artifact', clean, /Private development .* remains in release/)
const escaped = Array.from(privateText).map((char) => char.charCodeAt(0) > 127 ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}` : char).join('')
await writeFile(path.join(release, '0.js'), `// ${escaped}\n`)
await check('escaped-private-artifact', clean, /Escaped private development .* remains/)
console.log(`Release verifier: ${cases} subprocess exit-code/conclusion cases passed. Generated fixtures retained outside the repository: ${fixture}`)
