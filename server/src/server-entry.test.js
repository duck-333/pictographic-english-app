import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))

test('start script uses the PM2-safe server entry point', async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  assert.equal(packageJson.scripts.start, 'node src/server.js')
})
