import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'

import { createApp } from '../app.js'

test('GET /api/health returns API service status', async (t) => {
  const app = createApp()
  const server = http.createServer(app)

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const { port } = server.address()
  const response = await fetch(`http://127.0.0.1:${port}/api/health`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.service, 'pictographic-english-api')
  assert.equal(body.version, '0.1.0')
  assert.match(body.time, /^\d{4}-\d{2}-\d{2}T/)
})
