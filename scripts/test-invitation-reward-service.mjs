import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createInvitationRewardService } from '../server/invitation-reward-service.mjs'
import { startServer } from '../server/index.mjs'

let scans = 0
let unblock
const blocked = new Promise(resolve => { unblock = resolve })
const recovery = createInvitationRewardService({ pool: {
  async execute(sql) { assert.match(sql, /LIMIT 20/u); scans++; await blocked; return [[], []] }
} })
const first = recovery.runBatch()
await recovery.runBatch()
assert.equal(scans, 1, 'batches must not overlap')
unblock()
await first
recovery.start()
recovery.start()
await new Promise(resolve => setTimeout(resolve, 15))
recovery.stop()
assert.equal(scans, 2, 'startup runs once; no high-frequency empty polling')

let stopped = false
const server = startServer({ port: '0', host: '127.0.0.1',
  jwtSecret: 'reward-worker-lifecycle-local-test', tokenSecret: 'configured', candidateSecret: 'configured',
  store: { async getWordCount() { return 0 } }, userStore: {}, identityStore: {},
  invitationRegistrationService: {
    startRewardRecovery() { throw new Error('worker unavailable') },
    stopRewardRecovery() { stopped = true },
    async prepareWechatPhoneIdentity(input) { return input },
    async completePhoneRegistration() { return { identity: { id: '1', phoneMasked: '138****0000' } } }
  },
  wechatLoginClient: { async code2Session() { return { openid: 'verified' } }, async phoneCode2Number() { return {} } }
})
await once(server, 'listening')
try {
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(base + '/api/health')).status, 200)
  assert.equal((await fetch(base + '/api/auth/wechat-phone-login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginCode: 'fresh', phoneCode: 'phone' }) })).status, 200)
} finally { await new Promise(resolve => server.close(resolve)) }
assert(stopped)
console.log('invitation recovery overlap, startup, bounded polling and login isolation tests passed')
