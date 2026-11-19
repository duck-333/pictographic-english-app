import assert from 'node:assert/strict'
import { createInvitationRegistrationService } from '../server/invitation-registration-service.mjs'
import { createInvitationRewardService } from '../server/invitation-reward-service.mjs'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'
import { createApiHandler } from '../server/index.mjs'
import { createInvitationStore } from '../server/invitation-store.mjs'
import { withDatabaseTransaction } from '../server/database-transaction-context.mjs'
import { withSupervisedHttpTestServer } from './invitation-http-test-adapter.mjs'

export async function runInvitationRewardMysqlScenarios(options) {
  const { pool } = options
  const entitlementStore = createUserEntitlementStore({ ...options, pool })
  const service = createInvitationRegistrationService({ ...options, pool })
  let sequence = 0
  const phone = () => `138765${String(++sequence).padStart(5, '0')}`
  const openid = () => `reward-mysql-${++sequence}`
  async function register(subject, number, candidateReceipt = '', target = service) {
    const preparedIdentity = await target.prepareWechatPhoneIdentity({ openid: subject,
      phone: { purePhoneNumber: number, countryCode: '86' } })
    return target.completePhoneRegistration({ preparedIdentity, openid: subject, candidateReceipt })
  }
  async function share(inviter) { return service.createShareCredential({ authenticatedUserId: inviter }) }
  async function candidate(token, subject) { return service.captureCandidate({ token, openid: subject }) }
  async function countRewards(id) {
    const [[row]] = await pool.execute(`SELECT COUNT(*) AS count FROM entitlement_transactions
      WHERE user_id=? AND transaction_type='SHARE_REWARD'`, [id])
    return Number(row.count)
  }
  async function relation(id) {
    const [[row]] = await pool.execute('SELECT * FROM invitation_registration_relations WHERE invitation_id=?', [id])
    return row
  }
  const inviter = (await register(openid(), phone())).identity.id
  const otherInviter = (await register(openid(), phone())).identity.id
  const token = (await share(inviter)).token
  const otherToken = (await share(otherInviter)).token

  // Candidate capture uses a verified subject without creating any user or binding.
  const firstSubject = openid()
  const firstNumber = phone()
  const first = await candidate(token, firstSubject)
  const [[noAccount]] = await pool.execute('SELECT COUNT(*) AS count FROM wechat_user_bindings WHERE openid=?', [firstSubject])
  assert.equal(Number(noAccount.count), 0)
  // Invalid new token preserves the current candidate; a valid later one supersedes it.
  await assert.rejects(() => candidate('bad', firstSubject))
  const last = await candidate(otherToken, firstSubject)
  const [one, replay] = await Promise.all([
    register(firstSubject, firstNumber, first.candidateReceipt),
    register(firstSubject, firstNumber, last.candidateReceipt)
  ])
  assert.equal(one.identity.id, replay.identity.id)
  assert.equal((await relation(last.invitationId)).reward_status, 'REWARD_GRANTED')
  assert.equal(await countRewards(inviter), 0)

  // Simultaneous first registrations with two unused numbers for one WeChat shell
  // must read account history after acquiring its user lock, not an old snapshot.
  const shell = openid()
  const [inserted] = await pool.execute("INSERT INTO users (status) VALUES ('active')")
  await pool.execute('INSERT INTO wechat_user_bindings (user_id,openid) VALUES (?,?)', [inserted.insertId, shell])
  const shellReceipt = await candidate(otherToken, shell)
  const shellResults = await Promise.all([
    register(shell, phone(), shellReceipt.candidateReceipt), register(shell, phone(), shellReceipt.candidateReceipt)
  ])
  assert.equal(shellResults.filter(result => result.identity.isFirstPhoneRegistration).length, 1)
  assert.equal((await entitlementStore.getUserEntitlement(String(inserted.insertId))).quotaTotalGranted, 30)
  assert.equal(await countRewards(otherInviter), 2)
  assert.equal((await entitlementStore.getUserEntitlement(one.identity.id)).quotaBalance, 30)
  await assert.rejects(() => candidate(token, firstSubject), error => error.code === 'INVITATION_RELATION_LOCKED')

  // Cross-subject receipt and returning-account phone changes cannot earn a reward.
  const foreign = await candidate(token, openid())
  const cross = await register(openid(), phone(), foreign.candidateReceipt)
  assert.equal(cross.invitation.rewardReserved, false)
  const oldSubject = openid(), oldNumber = phone()
  const old = await register(oldSubject, oldNumber)
  const changed = await register(oldSubject, phone(), foreign.candidateReceipt)
  assert.equal(changed.identity.isFirstPhoneRegistration, false)
  assert.equal((await entitlementStore.getUserEntitlement(old.identity.id)).quotaTotalGranted, 30)
  const knownPhone = await register(openid(), oldNumber, foreign.candidateReceipt)
  assert.equal(knownPhone.identity.isFirstPhoneRegistration, false)
  assert.equal(await countRewards(inviter), 0)

  const unconfigured = createInvitationRegistrationService({ ...options, pool,
    env: {}, tokenSecret: '', candidateSecret: '' })
  const withoutFeature = await register(openid(), phone(), foreign.candidateReceipt, unconfigured)
  assert.equal(withoutFeature.invitation.noRewardReason, 'INVITATION_UNAVAILABLE')
  assert.equal((await entitlementStore.getUserEntitlement(withoutFeature.identity.id)).quotaBalance, 30)

  // Inject an actual failure after the ledger/balance write, before relation update.
  // The real transaction must roll both writes back and preserve a durable pending slot.
  let failDelivery = true
  const failingEntitlements = { ...entitlementStore,
    async grantInvitationRewardInTransaction(context, input) {
      const result = await entitlementStore.grantInvitationRewardInTransaction(context, input)
      if (failDelivery) throw new Error('injected after real quota grant')
      return result
    }
  }
  const failureService = createInvitationRegistrationService({ ...options, pool, entitlementStore: failingEntitlements })
  const pendingSubject = openid()
  const pending = await candidate(token, pendingSubject)
  const registered = await register(pendingSubject, phone(), pending.candidateReceipt, failureService)
  assert.equal(registered.invitation.rewardStatus, 'REWARD_PENDING')
  assert.equal(await countRewards(inviter), 0)
  assert.equal((await entitlementStore.getUserEntitlement(inviter)).quotaBalance, 30)
  assert.equal((await relation(pending.invitationId)).retry_count, 1)
  assert.deepEqual(await service.getSummary({ authenticatedUserId: inviter }), {
    successfulInvitations: 1, totalRewardQuota: 0, pendingRewards: 1, remainingRewardSlots: 4, limitReached: false
  })
  // Pending confirmation survives credential expiry. Recovery honors backoff.
  await pool.execute(`UPDATE invitation_share_credentials SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 8 DAY),
    expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=?`, [(await relation(pending.invitationId)).share_credential_id])
  failDelivery = false
  const recovery = createInvitationRewardService({ pool, entitlementStore })
  await recovery.runBatch()
  assert.equal(await countRewards(inviter), 0)
  await pool.execute('UPDATE invitation_registration_relations SET next_retry_at=UTC_TIMESTAMP(3) WHERE invitation_id=?', [pending.invitationId])
  // A fresh worker represents restart recovery and races with immediate delivery.
  const restarted = createInvitationRewardService({ pool, entitlementStore })
  await Promise.all([restarted.runBatch(), recovery.deliver(pending.invitationId), recovery.deliver(pending.invitationId)])
  assert.equal(await countRewards(inviter), 1)
  const delivered = await relation(pending.invitationId)
  await recovery.deliver(pending.invitationId) // caller lost the successful response
  assert.equal(await countRewards(inviter), 1)
  assert.equal((await relation(pending.invitationId)).reward_granted_at.getTime(), delivered.reward_granted_at.getTime())
  const [[window]] = await pool.execute(`SELECT reward_expires_at=DATE_ADD(reward_granted_at,INTERVAL 1 YEAR) AS exact_year
    FROM invitation_registration_relations WHERE invitation_id=?`, [pending.invitationId])
  assert.equal(Number(window.exact_year), 1)

  // Use a dedicated MySQL session clock for exact expiry and leap-year delivery.
  const timedConnection = await pool.getConnection()
  const timedStore = createInvitationStore(options)
  try {
    await timedConnection.execute('SET timestamp=1708603200') // 2024-02-22 12:00 UTC
    const timedShare = await withDatabaseTransaction(timedConnection, context => timedStore.createShareCredentialInTransaction(context, { inviterUserId: otherInviter }))
    await timedConnection.execute('SET timestamp=1709207999') // one second before expiry
    await withDatabaseTransaction(timedConnection, context => timedStore.resolveValidShareCredentialInTransaction(context, timedShare.token))
    await timedConnection.execute('SET timestamp=1709208000') // exactly 2024-02-29 12:00 UTC
    await assert.rejects(() => withDatabaseTransaction(timedConnection, context => timedStore.resolveValidShareCredentialInTransaction(context, timedShare.token)), error => error.code === 'INVITATION_CREDENTIAL_EXPIRED')
    const leapGrant = await withDatabaseTransaction(timedConnection, context => entitlementStore.grantInvitationRewardInTransaction(context,
      { userId: otherInviter, invitationId: 'test-leap-calendar-year' }))
    assert.equal(leapGrant.transaction.createdAt, '2024-02-29T12:00:00.000Z')
    assert.equal(leapGrant.transaction.expiresAt, '2025-02-28T12:00:00.000Z')
    await timedConnection.execute('SET timestamp=1709294400')
    const replayGrant = await withDatabaseTransaction(timedConnection, context => entitlementStore.grantInvitationRewardInTransaction(context,
      { userId: otherInviter, invitationId: 'test-leap-calendar-year' }))
    assert.equal(replayGrant.transaction.createdAt, leapGrant.transaction.createdAt)
    assert.equal(replayGrant.transaction.expiresAt, leapGrant.transaction.expiresAt)
  } finally {
    await timedConnection.execute('SET timestamp=0')
    timedConnection.release()
  }

  // Four more concurrent first registrations compete for the last three slots.
  const freshToken = (await share(inviter)).token
  for (let i = 0; i < 3; i++) {
    const subject = openid(), receipt = await candidate(freshToken, subject)
    await register(subject, phone(), receipt.candidateReceipt)
  }
  const subjects = [openid(), openid()]
  const candidates = await Promise.all(subjects.map(subject => candidate(freshToken, subject)))
  const capped = await Promise.all(subjects.map((subject, i) => register(subject, phone(), candidates[i].candidateReceipt)))
  assert.equal(capped.filter(result => result.invitation.rewardStatus === 'REWARD_GRANTED').length, 1)
  assert.equal(capped.filter(result => result.invitation.noRewardReason === 'INVITER_REWARD_LIMIT_REACHED').length, 1)
  for (const result of capped) assert.equal((await entitlementStore.getUserEntitlement(result.identity.id)).quotaBalance, 30)
  assert.equal(await countRewards(inviter), 5)
  await assert.rejects(() => share(inviter), error => error.code === 'INVITER_REWARD_LIMIT_REACHED')
  const expectedSummary = { successfulInvitations: 5, totalRewardQuota: 150,
    pendingRewards: 0, remainingRewardSlots: 0, limitReached: true }
  assert.deepEqual(await service.getSummary({ authenticatedUserId: inviter }), expectedSummary)
  await entitlementStore.consumeQuota({ userId: inviter, amount: 1, rootLearningObjectId: 'study', idempotencyKey: 'reward-test-consume' })
  assert.deepEqual(await service.getSummary({ authenticatedUserId: inviter }), expectedSummary)
  // Advance access time to expire all grants, without mutating the append-only ledger.
  const futureStore = createUserEntitlementStore({ ...options, pool, now: () => new Date('2040-01-01T00:00:00Z') })
  await futureStore.consumeQuota({ userId: inviter, amount: 1, rootLearningObjectId: 'future', idempotencyKey: 'reward-test-expiry' })
  assert.deepEqual(await service.getSummary({ authenticatedUserId: inviter }), expectedSummary)

  // Actual anonymous HTTP candidate + phone registration uses separate one-use codes.
  const codes = new Set(['candidate-code', 'registration-code'])
  const httpSubject = openid()
  const httpPhone = phone()
  const httpToken = (await share(otherInviter)).token
  const handler = createApiHandler({ ...options, pool, invitationRegistrationService: service,
    store: { async getWordCount() { return 0 } },
    wechatLoginClient: {
      async code2Session(code) { assert(codes.delete(code), 'wx.login codes must not be reused'); return { openid: httpSubject } },
      async phoneCode2Number() { return { purePhoneNumber: httpPhone, countryCode: '86' } }
    }
  })
  await withSupervisedHttpTestServer(handler, async baseUrl => {
    const post = async (path, body) => {
      const res = await fetch(baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(res.status, 200)
      return res.json()
    }
    const captured = await post('/api/user/invitations/candidates', { token: httpToken, loginCode: 'candidate-code' })
    const login = await post('/api/auth/wechat-phone-login', { loginCode: 'registration-code', phoneCode: 'phone', candidateReceipt: captured.candidateReceipt })
    assert.equal(login.invitation.status, 'REWARD_GRANTED')
    const summary = await fetch(baseUrl + '/api/user/invitations/summary?userId=' + inviter,
      { headers: { Authorization: 'Bearer ' + login.token } })
    assert.equal(summary.status, 200)
    assert.equal((await summary.json()).successfulInvitations, 0, 'query cannot select another user')
  })
  console.log('invitation reward MySQL scenarios passed: anonymous registration, history, last candidate, atomic failure, recovery, concurrency, cap, calendar year, summary and access')
}
