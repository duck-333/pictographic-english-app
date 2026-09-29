import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { createUserSessionToken } from '../server/auth.mjs'
import { hashPhone } from '../server/identity-store.mjs'
import { createInvitationCredentialSecurity } from '../server/invitation-credential-security.mjs'
import { createTrustedWechatCandidateSubject } from '../server/invitation-registration-service.mjs'
import { createApiHandler } from '../server/index.mjs'
import {
  requestJsonWithTimeout,
  withSupervisedHttpTestServer
} from './invitation-http-test-adapter.mjs'
import {
  parseDatabaseInsertId,
  parseDatabaseSafeInteger,
} from './invitation-test-database-integers.mjs'

export const INVITATION_FORMAL_HTTP_TIMEOUTS = Object.freeze({
  requestTimeoutMs: 3000,
  responseTimeoutMs: 3000,
  handlerTimeoutMs: 5000,
  closeTimeoutMs: 3000
})

export const INVITATION_EXPIRE_SHARE_CREDENTIAL_FIXTURE_SQL = `UPDATE invitation_share_credentials
  SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND),
      created_at=DATE_SUB(
        DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND),
        INTERVAL 7 DAY
      )
  WHERE id=?`

function validatedFormalHttpTimeouts() {
  for (const value of Object.values(INVITATION_FORMAL_HTTP_TIMEOUTS)) {
    assert(Number.isSafeInteger(value) && value > 0)
  }
  assert(INVITATION_FORMAL_HTTP_TIMEOUTS.handlerTimeoutMs >=
    INVITATION_FORMAL_HTTP_TIMEOUTS.responseTimeoutMs)
  assert(INVITATION_FORMAL_HTTP_TIMEOUTS.handlerTimeoutMs > 30)
  assert(INVITATION_FORMAL_HTTP_TIMEOUTS.responseTimeoutMs > 30)
  return INVITATION_FORMAL_HTTP_TIMEOUTS
}

function count(value) {
  return parseDatabaseSafeInteger(value, 'MySQL COUNT/SUM result')
}

function assertNoStore(result) {
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.equal(result.headers.get('pragma'), 'no-cache')
}

function assertPhoneResponseIsPublic(result) {
  const serialized = JSON.stringify(result.body)
  for (const forbidden of [
    'candidateReceipt', 'invitationId', 'rewardStatus', 'rewardSlot', 'noRewardReason',
    'tokenDigest', 'receiptDigest', 'keyVersion', 'openid', 'ER_DUP_ENTRY', 'wechat_user_bindings'
  ]) assert.equal(serialized.includes(forbidden), false)
}

function maskPhone(phone) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

export async function runInvitationFormalHttpMysqlScenarios(options = {}) {
  const pool = options.pool
  assert(pool && typeof pool.execute === 'function')
  const now = options.now instanceof Date ? options.now : new Date()
  const timeouts = validatedFormalHttpTimeouts()
  const security = createInvitationCredentialSecurity({
    tokenSecret: options.tokenSecret,
    candidateSecret: options.candidateSecret
  })
  const loginFacts = new Map()
  const phoneFacts = new Map()
  let exchangeSequence = 0

  const wechatLoginClient = Object.freeze({
    async code2Session(code) {
      const fact = loginFacts.get(String(code))
      if (!fact) throw Object.assign(new Error('Unknown test login code.'), { code: 'WECHAT_LOGIN_FAILED' })
      return { openid: fact.openid, unionid: fact.unionid || '' }
    },
    async phoneCode2Number(code) {
      const fact = phoneFacts.get(String(code))
      if (!fact) throw Object.assign(new Error('Unknown test phone code.'), { code: 'WECHAT_PHONE_FAILED' })
      return { purePhoneNumber: fact.phone, countryCode: '86' }
    }
  })

  function exchange(openid, phone, unionid = '') {
    exchangeSequence += 1
    const loginCode = `mysql-login-${exchangeSequence}`
    const phoneCode = `mysql-phone-${exchangeSequence}`
    loginFacts.set(loginCode, Object.freeze({ openid, unionid }))
    phoneFacts.set(phoneCode, Object.freeze({ phone }))
    return Object.freeze({ loginCode, phoneCode })
  }

  function bearer(userId, overrides = {}) {
    return `Bearer ${createUserSessionToken(userId, {
      jwtSecret: overrides.jwtSecret || options.jwtSecret,
      now: overrides.now || (() => now),
      userSessionTtlMs: overrides.userSessionTtlMs || 86400000
    }).token}`
  }

  async function executeOneMutation(sql, params = []) {
    const [result] = await pool.execute(sql, params)
    assert.equal(parseDatabaseSafeInteger(result.affectedRows, 'mutation affectedRows'), 1)
    return result
  }

  async function expireShareCredentialFixture(credentialId) {
    await executeOneMutation(INVITATION_EXPIRE_SHARE_CREDENTIAL_FIXTURE_SQL, [credentialId])
    const [rows] = await pool.execute(`SELECT
      CAST(expires_at < UTC_TIMESTAMP(3) AS CHAR) AS is_expired,
      CAST(expires_at = DATE_ADD(created_at, INTERVAL 7 DAY) AS CHAR) AS has_exact_seven_day_window
      FROM invitation_share_credentials WHERE id=?`, [credentialId])
    assert.equal(rows.length, 1)
    assert.equal(count(rows[0].is_expired), 1)
    assert.equal(count(rows[0].has_exact_seven_day_window), 1)
  }

  async function seedUser(openid = '') {
    const insert = await executeOneMutation(
      'INSERT INTO users (status, created_at) VALUES (?, ?)', ['active', now])
    const userId = parseDatabaseInsertId(insert.insertId, 'users insertId').toString()
    if (openid) {
      await executeOneMutation(`INSERT INTO wechat_user_bindings
        (user_id, openid, unionid, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`,
      [userId, openid, now, now])
    }
    return userId
  }

  async function seedPhone(userId, phone, status = 'active') {
    const identity = hashPhone({ phoneNumber: phone, countryCode: '86' }, {
      secret: options.phoneHashSecret
    })
    await executeOneMutation(`INSERT INTO user_phone_bindings
      (user_id, phone_hash, phone_masked, hash_version, country_code, status,
       bound_at, verified_at, last_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, '86', ?, ?, ?, ?, ?, ?)`,
    [userId, identity.phoneHash, maskPhone(phone), identity.hashVersion, status,
      now, now, now, now, now])
    return identity.phoneHash
  }

  async function request(baseUrl, pathname, body, authorization = '') {
    const result = await requestJsonWithTimeout(baseUrl, pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify(body),
      timeoutMs: timeouts.requestTimeoutMs
    })
    assertNoStore(result)
    return result
  }

  async function createShare(baseUrl, inviterId) {
    const result = await request(baseUrl, '/api/user/invitations/share-credentials', {}, bearer(inviterId))
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(typeof result.body.token, 'string')
    assert.equal(Object.hasOwn(result.body, 'credentialId'), false)
    return result.body.token
  }

  async function capture(baseUrl, token, subjectUserId) {
    const result = await request(baseUrl, '/api/user/invitations/candidates', { token }, bearer(subjectUserId))
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(typeof result.body.candidateReceipt, 'string')
    assert.equal(Object.hasOwn(result.body, 'invitationId'), false)
    return result.body.candidateReceipt
  }

  async function phoneLogin(baseUrl, input) {
    const codes = exchange(input.openid, input.phone, input.unionid)
    return await request(baseUrl, '/api/auth/wechat-phone-login', {
      ...codes,
      ...(input.candidateReceipt ? { candidateReceipt: input.candidateReceipt } : {}),
      ...(input.extraBody || {})
    }, input.authorization || '')
  }

  async function successfulPhoneLogin(baseUrl, input, expectedUserId) {
    const result = await phoneLogin(baseUrl, input)
    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.user.id, String(expectedUserId))
    assertPhoneResponseIsPublic(result)
    return result
  }

  async function relationForReceipt(receipt) {
    const [rows] = await pool.execute(`SELECT id, invitation_id, share_credential_id, inviter_user_id,
      invitee_user_id, relation_status, reward_status, no_reward_reason, reward_slot
      FROM invitation_registration_relations WHERE candidate_receipt_digest = ? LIMIT 2`,
    [security.digestCandidateReceipt(receipt)])
    assert.equal(rows.length, 1)
    return rows[0]
  }

  async function assertRegistrationFacts(userId, expectedBonus = 1) {
    const [[row]] = await pool.execute(`SELECT
      (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id=? AND status='active') AS phone_count,
      (SELECT COUNT(*) FROM entitlement_transactions
        WHERE user_id=? AND transaction_type='REGISTER_BONUS') AS bonus_count,
      (SELECT COUNT(*) FROM entitlement_transactions
        WHERE user_id=? AND transaction_type='REGISTER_BONUS' AND amount=30
          AND idempotency_key=CONCAT('registration_bonus:', ?)) AS exact_bonus_count,
      (SELECT COUNT(*) FROM entitlement_transactions
        WHERE user_id=? AND transaction_type='SHARE_REWARD') AS share_reward_count`,
    [userId, userId, userId, userId, userId])
    assert.equal(count(row.phone_count), 1)
    assert.equal(count(row.bonus_count), expectedBonus)
    assert.equal(count(row.exact_bonus_count), expectedBonus)
    assert.equal(count(row.share_reward_count), 0)
  }

  const handler = createApiHandler({
    pool,
    appid: options.appid,
    jwtSecret: options.jwtSecret,
    phoneHashSecret: options.phoneHashSecret,
    campaignPhoneIdentityHashSecret: options.campaignPhoneIdentityHashSecret,
    tokenSecret: options.tokenSecret,
    candidateSecret: options.candidateSecret,
    env: Object.freeze({}),
    now: () => now,
    wechatLoginClient
  })
  const runHttpServer = options.httpAdapter || withSupervisedHttpTestServer
  return await runHttpServer(handler, async baseUrl => {
    // Normal invited registration, strict request fields, database facts, and replay idempotency.
    const inviterOpenid = 'mysql-http-inviter'
    const inviteeOpenid = 'mysql-http-invitee'
    const inviterId = await seedUser(inviterOpenid)
    await seedPhone(inviterId, '13910000001')
    const inviteeId = await seedUser(inviteeOpenid)
    const shareToken = await createShare(baseUrl, inviterId)
    const beforeForbidden = await pool.execute('SELECT COUNT(*) AS total FROM invitation_registration_relations')
    const forbidden = await request(baseUrl, '/api/user/invitations/candidates', {
      token: shareToken, userId: inviteeId
    }, bearer(inviteeId))
    assert.equal(forbidden.status, 400)
    assert.equal(forbidden.body.code, 'INVITATION_REQUEST_INVALID')
    const afterForbidden = await pool.execute('SELECT COUNT(*) AS total FROM invitation_registration_relations')
    assert.equal(count(afterForbidden[0][0].total), count(beforeForbidden[0][0].total))
    const receipt = await capture(baseUrl, shareToken, inviteeId)
    const subject = createTrustedWechatCandidateSubject(options.appid, inviteeOpenid)
    const candidateBefore = await relationForReceipt(receipt)
    const [subjectRows] = await pool.execute(`SELECT candidate_subject_digest FROM invitation_registration_relations
      WHERE id=?`, [candidateBefore.id])
    assert(Buffer.from(subjectRows[0].candidate_subject_digest)
      .equals(security.digestTrustedCandidateSubject(subject)))
    for (const extraBody of [
      { userId: inviteeId }, { inviterId }, { openid: inviteeOpenid },
      { candidateDigest: 'forbidden' }, { rewardSlot: 1 }
    ]) {
      const rejected = await phoneLogin(baseUrl, {
        openid: inviteeOpenid,
        phone: '13910000002',
        candidateReceipt: receipt,
        authorization: bearer(inviteeId),
        extraBody
      })
      assert.equal(rejected.status, 400)
      assert.equal(rejected.body.code, 'INVITATION_REQUEST_INVALID')
    }
    const candidateAfterForbiddenBodies = await relationForReceipt(receipt)
    assert.equal(candidateAfterForbiddenBodies.relation_status, 'CANDIDATE')
    assert.equal(candidateAfterForbiddenBodies.invitee_user_id, null)
    const normal = await successfulPhoneLogin(baseUrl, {
      openid: inviteeOpenid,
      phone: '13910000002',
      candidateReceipt: receipt,
      authorization: bearer(inviteeId)
    }, inviteeId)
    assert.equal(typeof normal.body.token, 'string')
    await assertRegistrationFacts(inviteeId, 1)
    const normalRelation = await relationForReceipt(receipt)
    assert.equal(normalRelation.relation_status, 'FINAL')
    assert.equal(normalRelation.reward_status, 'REWARD_PENDING')
    const normalRewardSlot = parseDatabaseSafeInteger(normalRelation.reward_slot, 'normal reward slot')
    assert(normalRewardSlot >= 1 && normalRewardSlot <= 5)
    const [[normalCounts]] = await pool.execute(`SELECT
      (SELECT COUNT(*) FROM invitation_registration_relations WHERE id=? AND relation_status='FINAL') AS final_count,
      (SELECT COUNT(*) FROM entitlement_transactions WHERE transaction_type='SHARE_REWARD') AS share_count,
      (SELECT COUNT(*) FROM users) AS user_count,
      (SELECT COUNT(*) FROM wechat_user_bindings) AS wechat_count,
      (SELECT COUNT(*) FROM user_phone_bindings) AS phone_count`, [normalRelation.id])
    assert.equal(count(normalCounts.final_count), 1)
    assert.equal(count(normalCounts.share_count), 0)
    const [secretRows] = await pool.execute(`SELECT s.token_digest, r.candidate_receipt_digest,
      s.token_key_version, r.candidate_key_version
      FROM invitation_share_credentials s JOIN invitation_registration_relations r
        ON r.share_credential_id=s.id WHERE r.id=?`, [normalRelation.id])
    assert.equal(secretRows.length, 1)
    assert.equal(Buffer.from(secretRows[0].token_digest).equals(Buffer.from(shareToken, 'utf8')), false)
    assert.equal(Buffer.from(secretRows[0].candidate_receipt_digest).equals(Buffer.from(receipt, 'utf8')), false)

    await successfulPhoneLogin(baseUrl, {
      openid: inviteeOpenid,
      phone: '13910000002',
      candidateReceipt: receipt,
      authorization: bearer(inviteeId)
    }, inviteeId)
    await assertRegistrationFacts(inviteeId, 1)
    const [[replayCounts]] = await pool.execute(`SELECT
      (SELECT COUNT(*) FROM users) AS user_count,
      (SELECT COUNT(*) FROM wechat_user_bindings) AS wechat_count,
      (SELECT COUNT(*) FROM user_phone_bindings) AS phone_count,
      (SELECT COUNT(*) FROM invitation_registration_relations WHERE id=? AND relation_status='FINAL') AS final_count,
      (SELECT COUNT(DISTINCT reward_slot) FROM invitation_registration_relations WHERE id=?) AS slot_count`,
    [normalRelation.id, normalRelation.id])
    assert.deepEqual([
      count(replayCounts.user_count), count(replayCounts.wechat_count), count(replayCounts.phone_count)
    ], [count(normalCounts.user_count), count(normalCounts.wechat_count), count(normalCounts.phone_count)])
    assert.equal(count(replayCounts.final_count), 1)
    assert.equal(count(replayCounts.slot_count), 1)

    // A/B identity conflict must come from the real Identity Store and roll back every write.
    const conflictAOpenid = 'mysql-http-conflict-a'
    const conflictA = await seedUser(conflictAOpenid)
    const conflictB = await seedUser('mysql-http-conflict-b')
    const conflictPhoneHash = await seedPhone(conflictB, '13910000003')
    const conflictReceipt = await capture(baseUrl, shareToken, conflictA)
    const [[beforeConflict]] = await pool.execute(`SELECT
      (SELECT COUNT(*) FROM users) AS users_count,
      (SELECT COUNT(*) FROM entitlement_transactions) AS transaction_count,
      (SELECT COUNT(*) FROM entitlement_transactions WHERE transaction_type='REGISTER_BONUS') AS bonus_count`)
    const conflict = await phoneLogin(baseUrl, {
      openid: conflictAOpenid,
      phone: '13910000003',
      candidateReceipt: conflictReceipt,
      authorization: bearer(conflictA)
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.code, 'IDENTITY_CONFLICT')
    assertPhoneResponseIsPublic(conflict)
    const conflictSerialized = JSON.stringify(conflict.body)
    for (const forbiddenValue of [conflictA, conflictB, conflictAOpenid, 'user_phone_bindings', 'uk_user_phone_bindings_phone_hash']) {
      assert.equal(conflictSerialized.includes(String(forbiddenValue)), false)
    }
    const [[afterConflict]] = await pool.execute(`SELECT
      (SELECT COUNT(*) FROM users) AS users_count,
      (SELECT COUNT(*) FROM entitlement_transactions) AS transaction_count,
      (SELECT COUNT(*) FROM entitlement_transactions WHERE transaction_type='REGISTER_BONUS') AS bonus_count,
      (SELECT COUNT(*) FROM wechat_user_bindings WHERE user_id=? AND openid=?) AS a_wechat_count,
      (SELECT COUNT(*) FROM user_phone_bindings WHERE user_id=? AND phone_hash=?) AS b_phone_count`,
    [conflictA, conflictAOpenid, conflictB, conflictPhoneHash])
    assert.deepEqual([
      count(afterConflict.users_count), count(afterConflict.transaction_count), count(afterConflict.bonus_count)
    ], [count(beforeConflict.users_count), count(beforeConflict.transaction_count), count(beforeConflict.bonus_count)])
    assert.equal(count(afterConflict.a_wechat_count), 1)
    assert.equal(count(afterConflict.b_phone_count), 1)
    const conflictRelation = await relationForReceipt(conflictReceipt)
    assert.equal(conflictRelation.relation_status, 'CANDIDATE')
    assert.equal(conflictRelation.reward_slot, null)

    // Invitation JWT failures downgrade only invitation handling; every subject is isolated.
    const jwtVariants = ['missing', 'expired', 'bad-signature', 'invalid-sub', 'discontinuous']
    for (let index = 0; index < jwtVariants.length; index += 1) {
      const variant = jwtVariants[index]
      const openid = `mysql-http-jwt-${variant}`
      const userId = await seedUser(openid)
      const variantReceipt = await capture(baseUrl, shareToken, userId)
      let authorization = bearer(userId)
      if (variant === 'missing') authorization = ''
      if (variant === 'expired') authorization = bearer(userId, {
        now: () => new Date(now.getTime() - 86400000), userSessionTtlMs: 1000
      })
      if (variant === 'bad-signature') authorization = bearer(userId, {
        jwtSecret: crypto.randomBytes(32).toString('hex')
      })
      if (variant === 'invalid-sub') authorization = bearer('invalid-sub')
      if (variant === 'discontinuous') {
        const otherUserId = await seedUser(`mysql-http-jwt-other-${index}`)
        authorization = bearer(otherUserId)
      }
      const result = await successfulPhoneLogin(baseUrl, {
        openid,
        phone: `139100001${String(index).padStart(2, '0')}`,
        candidateReceipt: variantReceipt,
        authorization
      }, userId)
      assert.notEqual(result.status, 401)
      assert.notEqual(result.status, 403)
      await assertRegistrationFacts(userId, 1)
      const relation = await relationForReceipt(variantReceipt)
      assert.equal(relation.relation_status, 'CANDIDATE')
      assert.equal(relation.invitee_user_id, null)
      assert.equal(relation.reward_slot, null)
    }

    // Malformed, unknown, subject-mismatched, and auth-discarded expired/revoked receipts cannot alter candidates.
    const receiptVariants = ['malformed', 'unknown', 'subject-mismatch', 'expired', 'revoked']
    for (let index = 0; index < receiptVariants.length; index += 1) {
      const variant = receiptVariants[index]
      const ownerOpenid = `mysql-http-receipt-owner-${variant}`
      const ownerId = await seedUser(ownerOpenid)
      const variantToken = ['expired', 'revoked'].includes(variant)
        ? await createShare(baseUrl, inviterId)
        : shareToken
      const ownedReceipt = await capture(baseUrl, variantToken, ownerId)
      let loginOpenid = ownerOpenid
      let loginUserId = ownerId
      let submittedReceipt = ownedReceipt
      let authorization = bearer(ownerId)
      if (variant === 'malformed') submittedReceipt = 'malformed'
      if (variant === 'unknown') submittedReceipt = security.generateCandidateReceipt()
      if (variant === 'subject-mismatch') {
        loginOpenid = `mysql-http-receipt-other-${index}`
        loginUserId = await seedUser(loginOpenid)
        authorization = bearer(loginUserId)
      }
      if (variant === 'expired' || variant === 'revoked') {
        const owned = await relationForReceipt(ownedReceipt)
        if (variant === 'expired') {
          await expireShareCredentialFixture(owned.share_credential_id)
        } else {
          await executeOneMutation(`UPDATE invitation_share_credentials
            SET credential_status='REVOKED', revoked_at=UTC_TIMESTAMP(3) WHERE id=?`, [owned.share_credential_id])
        }
        authorization = ''
      }
      await successfulPhoneLogin(baseUrl, {
        openid: loginOpenid,
        phone: `139100002${String(index).padStart(2, '0')}`,
        candidateReceipt: submittedReceipt,
        authorization
      }, loginUserId)
      await assertRegistrationFacts(loginUserId, 1)
      const preserved = await relationForReceipt(ownedReceipt)
      assert.equal(preserved.relation_status, 'CANDIDATE')
      assert.equal(preserved.invitee_user_id, null)
      assert.equal(preserved.reward_slot, null)
    }

    // Inviter loses active-phone eligibility after share/candidate creation.
    const ineligibleInviter = await seedUser('mysql-http-ineligible-inviter')
    await seedPhone(ineligibleInviter, '13910000301')
    const ineligibleInviteeOpenid = 'mysql-http-ineligible-invitee'
    const ineligibleInvitee = await seedUser(ineligibleInviteeOpenid)
    const ineligibleToken = await createShare(baseUrl, ineligibleInviter)
    const ineligibleReceipt = await capture(baseUrl, ineligibleToken, ineligibleInvitee)
    await executeOneMutation(`UPDATE user_phone_bindings SET status='unbound', unbound_at=UTC_TIMESTAMP()
      WHERE user_id=? AND status='active'`, [ineligibleInviter])
    await successfulPhoneLogin(baseUrl, {
      openid: ineligibleInviteeOpenid,
      phone: '13910000302', candidateReceipt: ineligibleReceipt, authorization: bearer(ineligibleInvitee)
    }, ineligibleInvitee)
    await assertRegistrationFacts(ineligibleInvitee, 1)
    const ineligibleRelation = await relationForReceipt(ineligibleReceipt)
    assert.equal(ineligibleRelation.relation_status, 'FINAL')
    assert.equal(ineligibleRelation.reward_status, 'NO_REWARD')
    assert.equal(ineligibleRelation.no_reward_reason, 'INVITER_PHONE_REGISTRATION_REQUIRED')
    assert.equal(ineligibleRelation.reward_slot, null)

    // Self invite: create/capture while eligible, then retire the old phone and register a new phone.
    const selfOpenid = 'mysql-http-self'
    const selfUser = await seedUser(selfOpenid)
    await seedPhone(selfUser, '13910000401')
    const selfToken = await createShare(baseUrl, selfUser)
    const selfReceipt = await capture(baseUrl, selfToken, selfUser)
    await executeOneMutation(`UPDATE user_phone_bindings SET status='unbound', unbound_at=UTC_TIMESTAMP()
      WHERE user_id=? AND status='active'`, [selfUser])
    await successfulPhoneLogin(baseUrl, {
      openid: selfOpenid, phone: '13910000402', candidateReceipt: selfReceipt, authorization: bearer(selfUser)
    }, selfUser)
    await assertRegistrationFacts(selfUser, 1)
    const selfRelation = await relationForReceipt(selfReceipt)
    assert.equal(selfRelation.no_reward_reason, 'SELF_INVITE')
    assert.equal(selfRelation.reward_slot, null)

    // Expired credential with valid continuity finalizes the current product's explicit NO_REWARD result.
    const expiredInviter = await seedUser('mysql-http-expired-inviter')
    await seedPhone(expiredInviter, '13910000501')
    const expiredInviteeOpenid = 'mysql-http-expired-invitee'
    const expiredInvitee = await seedUser(expiredInviteeOpenid)
    const expiredToken = await createShare(baseUrl, expiredInviter)
    const expiredReceipt = await capture(baseUrl, expiredToken, expiredInvitee)
    const expiredRelationBefore = await relationForReceipt(expiredReceipt)
    await expireShareCredentialFixture(expiredRelationBefore.share_credential_id)
    await successfulPhoneLogin(baseUrl, {
      openid: expiredInviteeOpenid, phone: '13910000502',
      candidateReceipt: expiredReceipt, authorization: bearer(expiredInvitee)
    }, expiredInvitee)
    await assertRegistrationFacts(expiredInvitee, 1)
    const expiredRelation = await relationForReceipt(expiredReceipt)
    assert.equal(expiredRelation.relation_status, 'FINAL')
    assert.equal(expiredRelation.no_reward_reason, 'INVITATION_EXPIRED')
    assert.equal(expiredRelation.reward_slot, null)

    const revokedInviter = await seedUser('mysql-http-revoked-inviter')
    await seedPhone(revokedInviter, '13910000511')
    const revokedInviteeOpenid = 'mysql-http-revoked-invitee'
    const revokedInvitee = await seedUser(revokedInviteeOpenid)
    const revokedToken = await createShare(baseUrl, revokedInviter)
    const revokedReceipt = await capture(baseUrl, revokedToken, revokedInvitee)
    const revokedRelationBefore = await relationForReceipt(revokedReceipt)
    await executeOneMutation(`UPDATE invitation_share_credentials
      SET credential_status='REVOKED', revoked_at=UTC_TIMESTAMP(3)
      WHERE id=?`, [revokedRelationBefore.share_credential_id])
    await successfulPhoneLogin(baseUrl, {
      openid: revokedInviteeOpenid, phone: '13910000512',
      candidateReceipt: revokedReceipt, authorization: bearer(revokedInvitee)
    }, revokedInvitee)
    await assertRegistrationFacts(revokedInvitee, 1)
    const revokedRelation = await relationForReceipt(revokedReceipt)
    assert.equal(revokedRelation.relation_status, 'FINAL')
    assert.equal(revokedRelation.no_reward_reason, 'INVITATION_REVOKED')
    assert.equal(revokedRelation.reward_slot, null)

    // Missing inviter after a valid formal capture.
    const missingInviter = await seedUser('mysql-http-missing-inviter')
    await seedPhone(missingInviter, '13910000601')
    const missingInviteeOpenid = 'mysql-http-missing-invitee'
    const missingInvitee = await seedUser(missingInviteeOpenid)
    const missingToken = await createShare(baseUrl, missingInviter)
    const missingReceipt = await capture(baseUrl, missingToken, missingInvitee)
    await executeOneMutation('DELETE FROM user_phone_bindings WHERE user_id=?', [missingInviter])
    await executeOneMutation('DELETE FROM wechat_user_bindings WHERE user_id=?', [missingInviter])
    await executeOneMutation('DELETE FROM users WHERE id=?', [missingInviter])
    await successfulPhoneLogin(baseUrl, {
      openid: missingInviteeOpenid, phone: '13910000602',
      candidateReceipt: missingReceipt, authorization: bearer(missingInvitee)
    }, missingInvitee)
    await assertRegistrationFacts(missingInvitee, 1)
    const missingRelation = await relationForReceipt(missingReceipt)
    assert.equal(missingRelation.no_reward_reason, 'INVITER_NOT_FOUND')
    assert.equal(missingRelation.reward_slot, null)

    // Existing-phone user is not a first registration and receives no duplicate bonus.
    const nonNewOpenid = 'mysql-http-non-new'
    const nonNewUser = await seedUser(nonNewOpenid)
    await seedPhone(nonNewUser, '13910000701')
    const nonNewReceipt = await capture(baseUrl, shareToken, nonNewUser)
    await successfulPhoneLogin(baseUrl, {
      openid: nonNewOpenid, phone: '13910000701',
      candidateReceipt: nonNewReceipt, authorization: bearer(nonNewUser)
    }, nonNewUser)
    await assertRegistrationFacts(nonNewUser, 0)
    const nonNewRelation = await relationForReceipt(nonNewReceipt)
    assert.equal(nonNewRelation.no_reward_reason, 'NOT_FIRST_PHONE_REGISTRATION')
    assert.equal(nonNewRelation.reward_slot, null)

    // Five formal closures reserve slots; the sixth still registers and receives its own bonus.
    const cappedInviter = await seedUser('mysql-http-capped-inviter')
    await seedPhone(cappedInviter, '13910000801')
    const cappedToken = await createShare(baseUrl, cappedInviter)
    const cappedRelations = []
    for (let index = 1; index <= 6; index += 1) {
      const openid = `mysql-http-capped-${index}`
      const userId = await seedUser(openid)
      const cappedReceipt = await capture(baseUrl, cappedToken, userId)
      await successfulPhoneLogin(baseUrl, {
        openid, phone: `139100008${String(index + 1).padStart(2, '0')}`,
        candidateReceipt: cappedReceipt, authorization: bearer(userId)
      }, userId)
      await assertRegistrationFacts(userId, 1)
      cappedRelations.push(await relationForReceipt(cappedReceipt))
    }
    assert.equal(cappedRelations.slice(0, 5).filter(row => row.reward_status === 'REWARD_PENDING').length, 5)
    assert.equal(new Set(cappedRelations.slice(0, 5)
      .map(row => parseDatabaseSafeInteger(row.reward_slot, 'capped reward slot'))).size, 5)
    assert.equal(cappedRelations[5].relation_status, 'FINAL')
    assert.equal(cappedRelations[5].reward_status, 'NO_REWARD')
    assert.equal(cappedRelations[5].no_reward_reason, 'INVITER_REWARD_LIMIT_REACHED')
    assert.equal(cappedRelations[5].reward_slot, null)

    const [[globalShareRewards]] = await pool.execute(`SELECT COUNT(*) AS total
      FROM entitlement_transactions WHERE transaction_type='SHARE_REWARD'`)
    assert.equal(count(globalShareRewards.total), 0)
  }, {
    handlerTimeoutMs: timeouts.handlerTimeoutMs,
    responseTimeoutMs: timeouts.responseTimeoutMs,
    closeTimeoutMs: timeouts.closeTimeoutMs
  })
}
