import assert from 'node:assert/strict'
import test from 'node:test'

import { config } from './env.js'

test('default port is 3001 when PORT is not set', () => {
  assert.equal(config.port, 3001)
})
