import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { WORDS } from './fixtures/development-full-word-data.mjs'

const root = process.argv[2]
assert.ok(root, 'Pass the fresh HBuilderX mp-weixin release output directory.')
async function collect(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collect(target))
    else files.push(target)
  }
  return files
}
const files = await collect(root)
const jsFiles = files.filter((file) => file.endsWith('.js'))
assert.ok(jsFiles.length > 5, 'Release JavaScript output missing.')
const payload = (await Promise.all(jsFiles.map((file) => readFile(file, 'utf8')))).join('\n')
let checked = 0
for (const word of WORDS) {
  for (const field of ['tip', 'pictograph']) {
    const value = word[field]
    if (!value || value.length < 16) continue
    assert.equal(payload.includes(value), false, `Private development ${word.id}.${field} remains in release.`)
    const escaped = Array.from(value).map((char) => char.charCodeAt(0) > 127 ? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}` : char).join('')
    assert.equal(payload.includes(escaped), false, `Escaped private development ${word.id}.${field} remains.`)
    checked += 1
  }
}
assert.equal(payload.includes('dev-preview-data.js'), false)
assert.equal(payload.includes('development-full-word-data'), false)
if (process.argv[3]) {
  const inventory = await readFile(process.argv[3], 'utf8')
  assert.equal(/dev-preview-data|development-full-word-data/.test(inventory), false, 'Development data remains in the actual compiler module graph.')
}
for (const file of ['game-baxiaota/static/guide-detail.png', 'game-baxiaota/static/guide-search.png', 'static/baxiaota/entry.png']) {
  assert.ok((await stat(path.join(root, file))).size > 0, `Public demo asset missing: ${file}`)
}
console.log(`Fresh HBuilderX release: ${jsFiles.length} JS files, ${checked} private fixture strings absent; dev preview/full fixture dependencies absent; public game/tutorial assets retained.`)
