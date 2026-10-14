import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { WORDS } from './fixtures/development-full-word-data.mjs'

const root = process.argv[2]
assert.ok(root, 'Pass the fresh HBuilderX mp-weixin release output directory.')
const inventoryPath = process.argv[3]
assert.ok(inventoryPath, 'Module inventory is required: pass the compiler module inventory JSON as the second argument.')
let inventory
try {
  inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
} catch (error) {
  throw new Error('Module inventory could not be read or parsed as JSON.', { cause: error })
}
assert.ok(Array.isArray(inventory) && inventory.length > 0, 'Module inventory must be a non-empty module array.')
function validateModules(modules, topLevel = false) {
  for (const module of modules) {
    assert.ok(module && typeof module === 'object' && !Array.isArray(module) &&
      typeof module.name === 'string' && module.name.trim(), 'Module inventory entries require a non-empty name.')
    if (topLevel || Object.hasOwn(module, 'chunks')) {
      assert.ok(Array.isArray(module.chunks) && module.chunks.every((chunk) =>
        (typeof chunk === 'string' && chunk.trim()) || (Number.isSafeInteger(chunk) && chunk >= 0)),
      'Module inventory chunks must be an array of non-empty names or non-negative integer IDs.')
    }
    if (Object.hasOwn(module, 'modules')) {
      assert.ok(Array.isArray(module.modules), 'Nested module inventory must be an array.')
      validateModules(module.modules)
    }
  }
}
validateModules(inventory, true)
assert.equal(/dev-preview-data|development-full-word-data/.test(JSON.stringify(inventory)), false,
  'Development data remains in the actual compiler module graph.')
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
for (const file of ['game-baxiaota/static/guide-detail.png', 'game-baxiaota/static/guide-search.png', 'static/baxiaota/entry.png']) {
  assert.ok((await stat(path.join(root, file))).size > 0, `Public demo asset missing: ${file}`)
}
console.log(`Fresh HBuilderX release: ${jsFiles.length} JS files, ${checked} private fixture strings absent; dependency graph checked (${inventory.length} top-level modules), dev preview/full fixture dependencies absent; public game/tutorial assets retained. Source commit binding is not verified by this scan.`)
