import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { withDatabaseTransaction as withInvitationTransaction } from '../server/database-transaction-context.mjs'
import { createInvitationCredentialSecurity } from '../server/invitation-credential-security.mjs'
import { chooseInvitationRewardSlot, createInvitationStore } from '../server/invitation-store.mjs'

const TOKEN = 'unit-token-secret-0123456789-ABCDEFGHIJK'
const CANDIDATE = 'unit-candidate-secret-0123456789-ABCDEFG'
const env = { INVITATION_TOKEN_HMAC_SECRET: TOKEN, INVITATION_CANDIDATE_HMAC_SECRET: CANDIDATE }
const security = createInvitationCredentialSecurity({ env })
const token = security.generateInvitationToken()
const receipt = security.generateCandidateReceipt()
assert.match(token, /^ivt1\.[A-Za-z0-9_-]{43}$/u)
assert.match(receipt, /^icr1\.[A-Za-z0-9_-]{43}$/u)
assert.equal(security.digestInvitationToken(token).length, 32)
assert.equal(security.digestCandidateReceipt(receipt).length, 32)
for (const [method, value] of [['digestInvitationToken', token], ['digestCandidateReceipt', receipt]]) {
  const encoded = value.slice(5)
  const last = encoded.at(-1)
  const noncanonical = `${value.slice(0, -1)}${last === 'A' ? 'B' : last === 'Q' ? 'R' : last === 'g' ? 'h' : 'x'}`
  assert.throws(() => security[method](noncanonical))
  assert.throws(() => security[method](value.slice(0, -1)))
  assert.throws(() => security[method](`${value.slice(0, -1)}+`))
}
for (const name of ['WECHAT_SECRET', 'WECHAT_MINIAPP_SECRET',
  'WECHAT_VIRTUAL_PAYMENT_SANDBOX_APP_KEY', 'WECHAT_VIRTUAL_PAYMENT_PRODUCTION_APP_KEY']) {
  assert.throws(() => createInvitationCredentialSecurity({ env: { ...env, [name]: TOKEN } }),
    error => error.code === 'INVITATION_TOKEN_HMAC_SECRET_REUSED')
  assert.throws(() => createInvitationCredentialSecurity({ env: { ...env, [name]: CANDIDATE } }),
    error => error.code === 'INVITATION_CANDIDATE_HMAC_SECRET_REUSED')
}
const repeatedSecret = '01234567012345670123456701234567'
assert.throws(() => createInvitationCredentialSecurity({ env: { ...env, INVITATION_TOKEN_HMAC_SECRET: repeatedSecret } }),
  error => error.code === 'INVITATION_TOKEN_HMAC_SECRET_PLACEHOLDER')
assert.throws(() => createInvitationCredentialSecurity({ env: { ...env, INVITATION_CANDIDATE_HMAC_SECRET: repeatedSecret } }),
  error => error.code === 'INVITATION_CANDIDATE_HMAC_SECRET_PLACEHOLDER')
assert.equal(chooseInvitationRewardSlot([1, 2, 3, 4]), 5)
assert.equal(chooseInvitationRewardSlot([1, 2, 3, 4, 5]), null)

function resultRows(value) { return [value, []] }
const DATABASE_NOW = new Date('2026-09-24T00:00:00.123Z')
function scripted(steps, lifecycle = []) {
  const connection = {
    async beginTransaction() { lifecycle.push('begin') },
    async commit() { lifecycle.push('commit') },
    async rollback() { lifecycle.push('rollback') },
    async execute(sql, params = []) {
      assert.equal(this, connection, 'all SQL must use the supplied underlying connection')
      if (sql === 'SELECT UTC_TIMESTAMP(3) AS database_now') {
        lifecycle.push('database-now')
        return resultRows([{ database_now: DATABASE_NOW }])
      }
      const step = steps.shift(); assert(step, `unexpected SQL: ${sql}`); assert.match(sql, step.match)
      return typeof step.result === 'function' ? step.result(params) : step.result
    },
    done() { assert.equal(steps.length, 0) }
  }
  return connection
}
let ids = 0
const store = createInvitationStore({ security, idFactory: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` })
await assert.rejects(() => store.createShareCredentialInTransaction(scripted([]), { inviterUserId: '1' }),
  error => error.code === 'DATABASE_TRANSACTION_REQUIRED')
await assert.rejects(() => store.createShareCredentialInTransaction({ execute: async () => resultRows([]) }, { inviterUserId: '1' }),
  error => error.code === 'DATABASE_TRANSACTION_REQUIRED')

let expiredContext
const contextLifecycle = []
const contextConnection = scripted([], contextLifecycle)
await withInvitationTransaction(contextConnection, async context => {
  expiredContext = context
  assert.deepEqual(Object.keys(context), ['execute', 'query'])
  for (const method of ['beginTransaction', 'commit', 'rollback', 'release', 'getConnection']) assert.equal(context[method], undefined)
  const [timeRows] = await context.execute('SELECT UTC_TIMESTAMP(3) AS database_now')
  assert.equal(timeRows[0].database_now, DATABASE_NOW)
})
assert.deepEqual(contextLifecycle, ['begin', 'database-now', 'commit'])
await assert.rejects(() => expiredContext.execute('SELECT UTC_TIMESTAMP(3) AS database_now'),
  error => error.code === 'DATABASE_TRANSACTION_REQUIRED')
await assert.rejects(() => store.createShareCredentialInTransaction(expiredContext, { inviterUserId: '1' }),
  error => error.code === 'DATABASE_TRANSACTION_REQUIRED')
for (const invalidUserId of ['0', '-1', '18446744073709551616', '1.5', '1e3', ' 1', '1 ', true]) {
  await assert.rejects(() => withInvitationTransaction(scripted([]), context =>
    store.createShareCredentialInTransaction(context, { inviterUserId: invalidUserId })),
  error => error.code === 'INVITATION_USER_ID_INVALID')
}

const share = { id: '1', credential_id: 'share', inviter_user_id: '10', credential_status: 'ACTIVE',
  expires_at: new Date('2026-10-01T00:00:00Z'), revoked_at: null }
const receiptDigest = security.digestCandidateReceipt(receipt)
const subjectDigest = security.digestTrustedCandidateSubject('server-session:abc')
function locatedRelation(status, invitationId) {
  return { id: invitationId === 'A' ? '7' : '8', invitation_id: invitationId, share_credential_id: '1',
    inviter_user_id: '10', relation_status: status, candidate_receipt_digest: receiptDigest,
    candidate_subject_digest: subjectDigest }
}
const generated = scripted([
  { match: /^SELECT id, credential_id/u, result: resultRows([share]) },
  { match: /^SELECT id, invitation_id/u, result: resultRows([]) },
  { match: /^INSERT INTO invitation_registration_relations/u, result: [{ affectedRows: 1 }, []] }
])
const candidateA = await withInvitationTransaction(generated, context => store.captureNewValidCandidateInTransaction(context,
  { token, trustedCandidateSubject: 'server-session:abc' }))
assert.match(candidateA.candidateReceipt, /^icr1\./u)
generated.done()
await assert.rejects(() => withInvitationTransaction(scripted([]), context => store.captureNewValidCandidateInTransaction(context,
  { token: 'invalid', trustedCandidateSubject: 'server-session:abc' })), error => error.code === 'INVITATION_CREDENTIAL_INVALID')
const expiredConnection = scripted([{ match: /^SELECT id, credential_id/u, result: resultRows([{ ...share, expires_at: new Date('2026-09-23T00:00:00Z') }]) }])
await assert.rejects(() => withInvitationTransaction(expiredConnection, context => store.captureNewValidCandidateInTransaction(context,
  { token, trustedCandidateSubject: 'server-session:abc' })), error => error.code === 'INVITATION_CREDENTIAL_EXPIRED')
await assert.rejects(() => withInvitationTransaction(scripted([]), context => store.captureNewValidCandidateInTransaction(context,
  { token, trustedCandidateSubject: 'server-session:abc', candidateReceipt: `icr1.${'A'.repeat(43)}` })),
error => error.code === 'INVITATION_RECEIPT_CALLER_SELECTED')

const unknown = scripted([{ match: /^SELECT invitation_id/u, result: resultRows([]) }])
await assert.rejects(() => withInvitationTransaction(unknown, context => store.resolveCurrentCandidateInTransaction(context,
  { candidateReceipt: receipt, trustedCandidateSubject: 'server-session:abc' })),
error => error.code === 'INVITATION_CANDIDATE_RECEIPT_UNKNOWN')
const known = scripted([{ match: /^SELECT invitation_id/u, result: resultRows([{ invitation_id: 'known-id', relation_status: 'CANDIDATE' }]) }])
const recovered = await withInvitationTransaction(known, context => store.resolveCurrentCandidateInTransaction(context,
  { candidateReceipt: receipt, trustedCandidateSubject: 'server-session:abc' }))
assert.deepEqual(recovered, { invitationId: 'known-id', candidateAccepted: true })

const old = scripted([
  { match: /^SELECT id, share_credential_id/u, result: resultRows([locatedRelation('SUPERSEDED', 'A')]) },
  { match: /^SELECT id FROM users/u, result: params => { assert.deepEqual(params, ['10', '20']); return resultRows([{ id: '10' }, { id: '20' }]) } },
  { match: /^SELECT invitation_id, reward_status/u, result: resultRows([]) },
  { match: /^SELECT id, inviter_user_id, credential_status/u, result: resultRows([share]) },
  { match: /^SELECT id, invitation_id, share_credential_id/u, result: resultRows([locatedRelation('SUPERSEDED', 'A')]) },
  { match: /^SELECT invitation_id, reward_status[\s\S]*FOR UPDATE$/u, result: resultRows([]) }
])
const stale = await withInvitationTransaction(old, context => store.reserveRegistrationRewardInTransaction(context,
  { inviteeUserId: '20', candidateReceipt: receipt, trustedCandidateSubject: 'server-session:abc', isFirstPhoneRegistration: true }))
assert.equal(stale.candidateAccepted, false)
assert.equal(stale.noRewardReason, 'CANDIDATE_SUPERSEDED')
assert.equal(stale.registrationAllowed, true)

const largeInviter = '9007199254740992'; const largeInvitee = '9007199254740993'
const largeLocation = { ...locatedRelation('SUPERSEDED', 'A'), inviter_user_id: largeInviter }
const largeShare = { ...share, inviter_user_id: largeInviter }
const largeOrder = scripted([
  { match: /^SELECT id, share_credential_id/u, result: resultRows([largeLocation]) },
  { match: /^SELECT id FROM users/u, result: params => {
    assert.deepEqual(params, [largeInviter, largeInvitee]); return resultRows([{ id: largeInviter }, { id: largeInvitee }])
  } },
  { match: /^SELECT invitation_id, reward_status/u, result: resultRows([]) },
  { match: /^SELECT id, inviter_user_id, credential_status/u, result: resultRows([largeShare]) },
  { match: /^SELECT id, invitation_id, share_credential_id/u, result: resultRows([largeLocation]) },
  { match: /^SELECT invitation_id, reward_status[\s\S]*FOR UPDATE$/u, result: resultRows([]) }
])
const largeOrderedResult = await withInvitationTransaction(largeOrder, context => store.reserveRegistrationRewardInTransaction(context,
  { inviteeUserId: largeInvitee, candidateReceipt: receipt, trustedCandidateSubject: 'server-session:abc', isFirstPhoneRegistration: true }))
assert.equal(largeOrderedResult.noRewardReason, 'CANDIDATE_SUPERSEDED')

const changedAfterLocate = scripted([
  { match: /^SELECT id, share_credential_id/u, result: resultRows([locatedRelation('CANDIDATE', 'B')]) },
  { match: /^SELECT id FROM users/u, result: resultRows([{ id: '10' }, { id: '20' }]) },
  { match: /^SELECT invitation_id, reward_status/u, result: resultRows([]) },
  { match: /^SELECT id, inviter_user_id, credential_status/u, result: resultRows([share]) },
  { match: /^SELECT id, invitation_id, share_credential_id/u,
    result: resultRows([{ ...locatedRelation('CANDIDATE', 'B'), candidate_subject_digest: crypto.randomBytes(32) }]) }
])
const changedResult = await withInvitationTransaction(changedAfterLocate, context => store.reserveRegistrationRewardInTransaction(context,
  { inviteeUserId: '20', candidateReceipt: receipt, trustedCandidateSubject: 'server-session:abc', isFirstPhoneRegistration: true }))
assert.equal(changedResult.noRewardReason, 'CANDIDATE_INVALID')
assert.equal(changedResult.registrationAllowed, true)

const current = scripted([
  { match: /^SELECT id, share_credential_id/u, result: resultRows([locatedRelation('CANDIDATE', 'B')]) },
  { match: /^SELECT id FROM users/u, result: params => { assert.deepEqual(params, ['10', '20']); return resultRows([{ id: '10' }, { id: '20' }]) } },
  { match: /^SELECT invitation_id, reward_status/u, result: resultRows([]) },
  { match: /^SELECT id, inviter_user_id, credential_status/u, result: resultRows([share]) },
  { match: /^SELECT id, invitation_id, share_credential_id/u, result: resultRows([locatedRelation('CANDIDATE', 'B')]) },
  { match: /^SELECT invitation_id, reward_status[\s\S]*FOR UPDATE$/u, result: resultRows([]) },
  { match: /^SELECT reward_slot/u, result: resultRows([]) },
  { match: /^UPDATE invitation_registration_relations/u, result: [{ affectedRows: 1 }, []] }
])
const finalized = await withInvitationTransaction(current, context => store.reserveRegistrationRewardInTransaction(context,
  { inviteeUserId: '20', candidateReceipt: receipt, trustedCandidateSubject: 'server-session:abc', isFirstPhoneRegistration: true }))
assert.equal(finalized.invitationId, 'B')
assert.equal(finalized.rewardStatus, 'REWARD_PENDING')

const replay = scripted([
  { match: /^SELECT id, share_credential_id/u, result: resultRows([locatedRelation('CANDIDATE', 'B')]) },
  { match: /^SELECT id FROM users/u, result: params => { assert.deepEqual(params, ['10', '20']); return resultRows([{ id: '10' }, { id: '20' }]) } },
  { match: /^SELECT invitation_id, reward_status/u, result: resultRows([{ invitation_id: 'B', reward_status: 'REWARD_PENDING', no_reward_reason: null }]) }
])
const replayed = await withInvitationTransaction(replay, context => store.reserveRegistrationRewardInTransaction(context,
  { inviteeUserId: '20', candidateReceipt: receipt, trustedCandidateSubject: 'server-session:abc', isFirstPhoneRegistration: true }))
assert.equal(replayed.invitationId, 'B')
assert.equal(replayed.rewardReserved, true)

const lifecycle = []
const txConnection = scripted([{ match: /^INSERT INTO invitation_share_credentials/u, result: () => { throw new Error('injected') } }])
txConnection.beginTransaction = async () => lifecycle.push('begin')
txConnection.commit = async () => lifecycle.push('commit')
txConnection.rollback = async () => lifecycle.push('rollback')
await assert.rejects(() => withInvitationTransaction(txConnection,
  context => store.createShareCredentialInTransaction(context, { inviterUserId: '10' })), /injected/u)
assert.deepEqual(lifecycle, ['begin', 'rollback'])
const committedLifecycle = []
const committedConnection = scripted([{ match: /^INSERT INTO invitation_share_credentials/u, result: [{ affectedRows: 1 }, []] }])
committedConnection.beginTransaction = async () => committedLifecycle.push('begin')
committedConnection.commit = async () => committedLifecycle.push('commit')
const created = await withInvitationTransaction(committedConnection,
  context => store.createShareCredentialInTransaction(context, { inviterUserId: '10' }))
assert.deepEqual(committedLifecycle, ['begin', 'commit'])
assert.equal(created.createdAt.getTime(), DATABASE_NOW.getTime())

function retryConnection(lifecycle) {
  return { async beginTransaction() { lifecycle.push('begin') }, async commit() { lifecycle.push('commit') },
    async rollback() { lifecycle.push('rollback') }, async execute() { return resultRows([]) } }
}
function databaseError(code) { return Object.assign(new Error(code), { code }) }
const deadlockLifecycle = []; const retryContexts = []; let deadlockRuns = 0
const retryResult = await withInvitationTransaction(retryConnection(deadlockLifecycle), async context => {
  retryContexts.push(context); deadlockRuns += 1
  if (deadlockRuns === 1) throw databaseError('ER_LOCK_DEADLOCK')
  return 'committed-result'
})
assert.equal(retryResult, 'committed-result')
assert.equal(deadlockRuns, 2)
assert.notEqual(retryContexts[0], retryContexts[1])
assert.deepEqual(deadlockLifecycle, ['begin', 'rollback', 'begin', 'commit'])
await assert.rejects(() => retryContexts[0].execute('SELECT 1'), error => error.code === 'DATABASE_TRANSACTION_REQUIRED')
await assert.rejects(() => retryContexts[1].execute('SELECT 1'), error => error.code === 'DATABASE_TRANSACTION_REQUIRED')

const commitRetryLifecycle = []; let commitCalls = 0; let commitCallbackRuns = 0
const commitRetryConnection = { async beginTransaction() { commitRetryLifecycle.push('begin') },
  async commit() { commitCalls += 1; commitRetryLifecycle.push('commit'); if (commitCalls === 1) throw databaseError('ER_LOCK_DEADLOCK') },
  async rollback() { commitRetryLifecycle.push('rollback') }, async execute() { return resultRows([]) } }
const committedAttemptResult = await withInvitationTransaction(commitRetryConnection, async () => {
  commitCallbackRuns += 1; return `attempt-${commitCallbackRuns}`
})
assert.equal(committedAttemptResult, 'attempt-2')
assert.deepEqual(commitRetryLifecycle, ['begin', 'commit', 'rollback', 'begin', 'commit'])

const timeoutLifecycle = []; let timeoutRuns = 0
await withInvitationTransaction(retryConnection(timeoutLifecycle), async () => {
  timeoutRuns += 1
  if (timeoutRuns === 1) throw databaseError('ER_LOCK_WAIT_TIMEOUT')
})
assert.equal(timeoutRuns, 2)
assert.deepEqual(timeoutLifecycle, ['begin', 'rollback', 'begin', 'commit'])

const ordinaryLifecycle = []; let ordinaryRuns = 0
await assert.rejects(() => withInvitationTransaction(retryConnection(ordinaryLifecycle), async () => {
  ordinaryRuns += 1; throw databaseError('ER_DUP_ENTRY')
}), error => error.code === 'ER_DUP_ENTRY')
assert.equal(ordinaryRuns, 1)
assert.deepEqual(ordinaryLifecycle, ['begin', 'rollback'])

const exhaustedLifecycle = []; const exhaustedContexts = []; let exhaustedRuns = 0
await assert.rejects(() => withInvitationTransaction(retryConnection(exhaustedLifecycle), async context => {
  exhaustedContexts.push(context); exhaustedRuns += 1; throw databaseError('ER_LOCK_DEADLOCK')
}), error => error.code === 'ER_LOCK_DEADLOCK')
assert.equal(exhaustedRuns, 3)
assert.equal(new Set(exhaustedContexts).size, 3)
assert.deepEqual(exhaustedLifecycle, ['begin', 'rollback', 'begin', 'rollback', 'begin', 'rollback'])
for (const context of exhaustedContexts) {
  await assert.rejects(() => context.execute('SELECT 1'), error => error.code === 'DATABASE_TRANSACTION_REQUIRED')
}
const storeSource = await readFile(new URL('../server/invitation-store.mjs', import.meta.url), 'utf8')
for (const forbidden of [
  ['@@session', 'in_transaction'].join('.'),
  ['events', 'transactions', 'current'].join('_'),
  ['information_schema', 'innodb_trx'].join('.'),
  ['@@', 'autocommit'].join(''),
  ['get', 'Connection'].join(''),
  ['create', 'Pool'].join(''),
  ['fetch', '('].join(''),
  ['console', '.'].join('')
]) assert.equal(storeSource.includes(forbidden), false, `forbidden invitation-store dependency: ${forbidden}`)
assert.equal(storeSource.includes(' JOIN '), false, 'invitation store must not use a cross-table locking join')
assert.match(storeSource, /lockDatabaseUsersInTransaction\(value, \[invitee, inviter\], \{ allowMissing: true \}\)/u)
const transactionSource = await readFile(new URL('../server/database-transaction-context.mjs', import.meta.url), 'utf8')
assert.match(transactionSource, /SELECT id FROM users WHERE id IN \(\$\{placeholders\}\) ORDER BY id FOR UPDATE/u)
assert.match(storeSource, /candidate_receipt_digest, candidate_subject_digest, relation_status FROM \$\{RELATION\}[\s\S]+WHERE id = \? LIMIT 1 FOR UPDATE/u)
console.log('invitation credential and store unit tests passed')
