import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  INVITATION_EXPIRE_SHARE_CREDENTIAL_FIXTURE_SQL,
  INVITATION_FORMAL_HTTP_TIMEOUTS,
  runInvitationFormalHttpMysqlScenarios
} from './invitation-http-mysql-scenarios.mjs'

let capturedHandler = null
let capturedWork = null
let capturedAdapterOptions = null
const secret = label => crypto.createHash('sha256').update(`formal-timeout:${label}`).digest('hex')
const capturedResult = await runInvitationFormalHttpMysqlScenarios({
  pool: {
    async execute() { throw new Error('The captured adapter must not execute scenario SQL.') }
  },
  appid: 'wx-formal-timeout-test',
  jwtSecret: secret('jwt'),
  phoneHashSecret: secret('phone'),
  campaignPhoneIdentityHashSecret: secret('campaign-phone'),
  tokenSecret: secret('token'),
  candidateSecret: secret('candidate'),
  now: new Date('2026-09-28T00:00:00.000Z'),
  async httpAdapter(handler, work, adapterOptions) {
    capturedHandler = handler
    capturedWork = work
    capturedAdapterOptions = adapterOptions
    return 'adapter-options-captured'
  }
})

assert.equal(capturedResult, 'adapter-options-captured')
assert.equal(typeof capturedHandler, 'function')
assert.equal(typeof capturedWork, 'function')
assert.deepEqual(capturedAdapterOptions, {
  handlerTimeoutMs: 5000,
  responseTimeoutMs: 3000,
  closeTimeoutMs: 3000
})
assert.deepEqual(INVITATION_FORMAL_HTTP_TIMEOUTS, {
  requestTimeoutMs: 3000,
  responseTimeoutMs: 3000,
  handlerTimeoutMs: 5000,
  closeTimeoutMs: 3000
})
for (const value of [
  INVITATION_FORMAL_HTTP_TIMEOUTS.requestTimeoutMs,
  capturedAdapterOptions.responseTimeoutMs,
  capturedAdapterOptions.handlerTimeoutMs
]) {
  assert(Number.isSafeInteger(value) && value > 0)
  assert(value > 30)
}
assert(capturedAdapterOptions.handlerTimeoutMs >= capturedAdapterOptions.responseTimeoutMs)

const expirySql = INVITATION_EXPIRE_SHARE_CREDENTIAL_FIXTURE_SQL.replace(/\s+/gu, ' ').trim()
assert.match(expirySql,
  /SET expires_at=DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 1 SECOND\), created_at=DATE_SUB\( DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 1 SECOND\), INTERVAL 7 DAY \) WHERE id=\?$/u)
assert.equal((expirySql.match(/\?/gu) || []).length, 1)
assert.equal(/Date\.now|new Date|CURRENT_TIMESTAMP|NOW\(/u.test(expirySql), false)
assert.equal(/CHECK_CONSTRAINT_CHECKS|FOREIGN_KEY_CHECKS|sql_mode/iu.test(expirySql), false)
const scenarioSource = String(runInvitationFormalHttpMysqlScenarios)
assert.equal((scenarioSource.match(/expireShareCredentialFixture\([^)]*share_credential_id\)/gu) || []).length, 2)
assert.equal(/SET\s+expires_at\s*=\s*DATE_SUB/iu.test(scenarioSource), false)

console.log('invitation formal HTTP MySQL timeout configuration captured: request=3000 response=3000 handler=5000 close=3000')
