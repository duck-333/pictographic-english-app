import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'
import { hashPhone } from '../server/identity-store.mjs'
import { createInvitationCredentialSecurity } from '../server/invitation-credential-security.mjs'
import {
  createTrustedWechatCandidateSubject
} from '../server/invitation-registration-service.mjs'
import { createApiHandler } from '../server/index.mjs'

const NOW = new Date('2026-09-27T00:00:00.000Z')
const APP_ID = 'wx-full-chain-app'
const JWT_SECRET = 'full-chain-jwt-secret-that-is-not-reused'
const PHONE_SECRET = 'full-chain-phone-hash-secret-that-is-independent'
const CAMPAIGN_SECRET = 'full-chain-campaign-secret-that-is-independent'
const INVITATION_TOKEN_SECRET = 'full-chain-invitation-token-secret-9Qx7-L2v-unique'
const INVITATION_CANDIDATE_SECRET = 'full-chain-candidate-secret-4Kp8-Z6m-unique'
const BASE_OPTIONS = Object.freeze({
  appid: APP_ID,
  jwtSecret: JWT_SECRET,
  phoneHashSecret: PHONE_SECRET,
  campaignPhoneIdentityHashSecret: CAMPAIGN_SECRET,
  tokenSecret: INVITATION_TOKEN_SECRET,
  candidateSecret: INVITATION_CANDIDATE_SECRET,
  now: () => NOW
})
const security = createInvitationCredentialSecurity(BASE_OPTIONS)

function copyValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(copyValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]))
  }
  return value
}

function cloneState(state) {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, copyValue(value)]))
}

function baseState() {
  return {
    users: [], wechat: [], phones: [], entitlements: [], transactions: [], memberships: [],
    favorites: [], recents: [], bookRedemptions: [], paymentOrders: [], deliveryAttempts: [],
    deliveryQueries: [], shares: [], relations: [],
    nextUserId: 100, nextEntitlementId: 1, nextTransactionId: 1, nextShareId: 1, nextRelationId: 1
  }
}

function addUser(state, id, openid = '', unionid = '') {
  state.users.push({ id: String(id), status: 'active', last_login_at: NOW })
  if (openid) state.wechat.push({ user_id: String(id), openid, unionid: unionid || null })
}

function phoneIdentity(phone) {
  return hashPhone(phone, { secret: PHONE_SECRET })
}

function addPhone(state, userId, phone, status = 'active') {
  const identity = phoneIdentity(phone)
  state.phones.push({
    id: String(state.phones.length + 1), user_id: String(userId), phone_hash: identity.phoneHash,
    phone_masked: `${phone.slice(0, 3)}****${phone.slice(-4)}`, hash_version: identity.hashVersion,
    country_code: '86', status, verified_at: NOW, last_verified_at: NOW,
    campaign_phone_identity_hash: Buffer.alloc(32, 7), campaign_phone_hash_version: 'v1'
  })
}

function normalizeSql(sql) { return String(sql).replace(/\s+/gu, ' ').trim() }
function rows(values) { return [values, []] }
function sameBuffer(left, right) {
  return Buffer.from(left || []).equals(Buffer.from(right || []))
}

function entitlementRow(userId, id) {
  return {
    id: String(id), user_id: String(userId), quota_balance: 0, quota_total_granted: 0,
    quota_total_consumed: 0, quota_total_expired: 0, membership_type: 'none',
    membership_status: 'none', membership_started_at: null, membership_expire_at: null,
    last_transaction_id: null, created_at: NOW, updated_at: NOW
  }
}

function createMemoryDatabase(seed = {}) {
  const database = {
    state: Object.assign(baseState(), copyValue(seed)),
    calls: [], failOnFinalUpdate: false,
    concurrentRevocationUserId: '', pendingRevocationUserId: '',
    connection: null
  }
  const connection = {
    working: null,
    lastInsertId: null,
    async beginTransaction() { this.working = cloneState(database.state); database.calls.push('begin') },
    async commit() {
      database.state = this.working; this.working = null; database.calls.push('commit')
      if (database.pendingRevocationUserId) {
        const phone = database.state.phones.find(item => item.user_id === database.pendingRevocationUserId)
        if (phone) phone.status = 'unbound'
        database.calls.push('concurrent-revocation-after-lock-holder-commit')
        database.pendingRevocationUserId = ''
      }
    },
    async rollback() { this.working = null; database.calls.push('rollback') },
    async release() { database.calls.push('release') },
    async query(sql, params = []) { return await this.execute(sql, params) },
    async execute(sql, params = []) {
      const compact = normalizeSql(sql)
      database.calls.push({ sql: compact, params: copyValue(params) })
      const state = this.working || database.state

      if (compact === 'SELECT UTC_TIMESTAMP(3) AS database_now') return rows([{ database_now: NOW }])
      if (/^SELECT UTC_TIMESTAMP\(\) AS granted_at/u.test(compact)) {
        return rows([{ granted_at: NOW, expires_at: new Date('2027-09-27T00:00:00.000Z') }])
      }
      if (/^SELECT id FROM users WHERE id IN/u.test(compact)) {
        const found = params.filter(id => state.users.some(user => user.id === String(id)))
        if (database.concurrentRevocationUserId && params.map(String).includes(database.concurrentRevocationUserId)) {
          database.pendingRevocationUserId = database.concurrentRevocationUserId
          database.concurrentRevocationUserId = ''
          database.calls.push('concurrent-revocation-blocked-by-user-lock')
        }
        return rows(found.map(id => ({ id: String(id) })))
      }
      if (/^SELECT id FROM users WHERE id = LAST_INSERT_ID/u.test(compact)) {
        return rows(this.lastInsertId ? [{ id: this.lastInsertId }] : [])
      }
      if (/^SHOW COLUMNS FROM `users`/u.test(compact)) {
        return rows(['id', 'status', 'created_at', 'last_login_at'].map(Field => ({
          Field, Null: Field === 'id' ? 'NO' : 'YES', Default: null,
          Extra: Field === 'id' ? 'auto_increment' : ''
        })))
      }
      if (/^SHOW COLUMNS FROM `wechat_user_bindings`/u.test(compact)) {
        return rows(['user_id', 'openid', 'unionid', 'created_at', 'updated_at'].map(Field => ({
          Field, Null: 'YES', Default: null, Extra: ''
        })))
      }
      if (/^SHOW COLUMNS FROM `user_phone_bindings`/u.test(compact)) {
        return rows([
          ['user_id', 'bigint unsigned'], ['phone_hash', 'char(64)'], ['phone_masked', 'varchar(32)'],
          ['hash_version', 'varchar(32)'], ['country_code', 'varchar(8)'],
          ['campaign_phone_identity_hash', 'binary(32)'], ['campaign_phone_hash_version', 'varchar(16)'],
          ['status', 'varchar(32)'], ['bound_at', 'datetime'], ['verified_at', 'datetime'],
          ['last_verified_at', 'datetime'], ['created_at', 'datetime'], ['updated_at', 'datetime']
        ].map(([Field, Type]) => ({ Field, Type, Null: 'YES', Default: null, Extra: '' })))
      }
      if (/^SELECT user_id, openid, unionid FROM `wechat_user_bindings` WHERE openid = \?/u.test(compact)) {
        return rows(state.wechat.filter(item => item.openid === params[0]).slice(0, 1))
      }
      if (/^SELECT openid FROM `wechat_user_bindings` WHERE user_id = \? LIMIT 2/u.test(compact)) {
        return rows(state.wechat.filter(item => item.user_id === String(params[0])).slice(0, 2)
          .map(item => ({ openid: item.openid })))
      }
      if (/^SELECT user_id, phone_hash, phone_masked/u.test(compact)) {
        return rows(state.phones.filter(item => item.phone_hash === params[0]).slice(0, 1))
      }
      if (/^INSERT INTO users/u.test(compact)) {
        const id = String(state.nextUserId++)
        state.users.push({ id, status: 'active', last_login_at: NOW })
        this.lastInsertId = id
        return [{ affectedRows: 1, insertId: id }, []]
      }
      if (/^UPDATE `users` SET/u.test(compact)) {
        const userId = String(params.at(-1)); const user = state.users.find(item => item.id === userId)
        if (user) user.last_login_at = params[0]
        return [{ affectedRows: user ? 1 : 0 }, []]
      }
      if (/^UPDATE `wechat_user_bindings` SET/u.test(compact)) {
        const openid = params.at(-1); const binding = state.wechat.find(item => item.openid === openid)
        if (binding && params.length > 1 && typeof params[0] === 'string') binding.unionid = params[0]
        return [{ affectedRows: binding ? 1 : 0 }, []]
      }
      if (/^INSERT INTO `wechat_user_bindings`/u.test(compact)) {
        state.wechat.push({ user_id: String(params[0]), openid: params[1], unionid: params[2] })
        return [{ affectedRows: 1, insertId: state.wechat.length }, []]
      }
      if (/^UPDATE `user_phone_bindings` SET/u.test(compact)) {
        const phoneHash = params.at(-1); const binding = state.phones.find(item => item.phone_hash === phoneHash)
        if (!binding) return [{ affectedRows: 0 }, []]
        binding.phone_masked = params[0]; binding.status = 'active'; binding.last_verified_at = NOW
        return [{ affectedRows: 1 }, []]
      }
      if (/^INSERT INTO `user_phone_bindings`/u.test(compact)) {
        state.phones.push({
          id: String(state.phones.length + 1), user_id: String(params[0]), phone_hash: params[1],
          phone_masked: params[2], hash_version: params[3], country_code: params[4],
          campaign_phone_identity_hash: Buffer.from(params[5]), campaign_phone_hash_version: params[6],
          status: 'active', verified_at: NOW, last_verified_at: NOW
        })
        return [{ affectedRows: 1, insertId: state.phones.length }, []]
      }

      if (/^SELECT id, user_id, quota_balance/u.test(compact)) {
        return rows(state.entitlements.filter(item => item.user_id === String(params[0])).slice(0, 1))
      }
      if (/^INSERT IGNORE INTO `user_entitlements`/u.test(compact)) {
        if (state.entitlements.some(item => item.user_id === String(params[0]))) return [{ affectedRows: 0 }, []]
        state.entitlements.push(entitlementRow(params[0], state.nextEntitlementId++))
        return [{ affectedRows: 1, insertId: state.entitlements.at(-1).id }, []]
      }
      if (/^SELECT id, transaction_id, user_id, transaction_type/u.test(compact)) {
        return rows(state.transactions.filter(item => item.idempotency_key === params[0]).slice(0, 1))
      }
      if (/^INSERT INTO `entitlement_transactions`/u.test(compact)) {
        const id = String(state.nextTransactionId++)
        const row = {
          id, transaction_id: params[0], user_id: String(params[1]), transaction_type: params[2],
          amount: params[3], balance_after: params[4], source: params[5], source_id: params[6],
          expires_at: params[7], grant_transaction_id: params[8], root_learning_object_id: params[9],
          current_learning_object_id: params[10], access_context_json: params[11], idempotency_key: params[12],
          operator_type: params[13], operator_id: params[14], reason: params[15], metadata_json: params[16],
          created_at: params[17] || NOW
        }
        state.transactions.push(row)
        return [{ affectedRows: 1, insertId: id }, []]
      }
      if (/^UPDATE `user_entitlements` SET quota_balance/u.test(compact)) {
        const userId = String(params[3]); const item = state.entitlements.find(row => row.user_id === userId)
        item.quota_balance = params[0]; item.quota_total_granted += params[1]
        item.last_transaction_id = String(params[2]); item.updated_at = NOW
        return [{ affectedRows: 1 }, []]
      }

      if (/^INSERT INTO invitation_share_credentials/u.test(compact)) {
        state.shares.push({
          id: String(state.nextShareId++), credential_id: params[0], inviter_user_id: String(params[1]),
          token_digest: Buffer.from(params[2]), token_key_version: params[3], credential_status: 'ACTIVE',
          expires_at: new Date(NOW.getTime() + 604800000), revoked_at: null
        })
        return [{ affectedRows: 1, insertId: state.shares.at(-1).id }, []]
      }
      if (/^SELECT id, credential_id, inviter_user_id/u.test(compact)) {
        return rows(state.shares.filter(item => sameBuffer(item.token_digest, params[0])).slice(0, 2))
      }
      if (/^SELECT id, invitation_id, relation_status/u.test(compact)) {
        return rows(state.relations.filter(item => sameBuffer(item.active_candidate_subject_digest, params[0])).slice(0, 2))
      }
      if (/^INSERT INTO invitation_registration_relations/u.test(compact)) {
        const relation = {
          id: String(state.nextRelationId++), invitation_id: params[0], share_credential_id: String(params[1]),
          inviter_user_id: String(params[2]), invitee_user_id: null,
          candidate_subject_digest: Buffer.from(params[3]), candidate_receipt_digest: Buffer.from(params[4]),
          active_candidate_subject_digest: Buffer.from(params[3]), candidate_key_version: params[5],
          relation_status: 'CANDIDATE', qualification_status: 'UNRESOLVED', reward_status: 'NOT_RESERVED',
          no_reward_reason: null, reward_slot: null
        }
        state.relations.push(relation)
        return [{ affectedRows: 1, insertId: relation.id }, []]
      }
      if (/^UPDATE invitation_registration_relations SET relation_status = 'SUPERSEDED'/u.test(compact)) {
        const relation = state.relations.find(item => item.id === String(params[3]))
        relation.relation_status = 'SUPERSEDED'; relation.active_candidate_subject_digest = null
        return [{ affectedRows: 1 }, []]
      }
      if (/^SELECT id, share_credential_id, inviter_user_id, relation_status FROM invitation_registration_relations/u.test(compact)) {
        return rows(state.relations.filter(item => sameBuffer(item.candidate_receipt_digest, params[0]) &&
          sameBuffer(item.candidate_subject_digest, params[1])).slice(0, 2))
      }
      if (/^SELECT invitation_id, reward_status, no_reward_reason FROM invitation_registration_relations/u.test(compact)) {
        return rows(state.relations.filter(item => item.invitee_user_id === String(params[0]) &&
          item.relation_status === 'FINAL').slice(0, 2))
      }
      if (/^SELECT id, inviter_user_id, credential_status, expires_at, revoked_at FROM invitation_share_credentials/u.test(compact)) {
        return rows(state.shares.filter(item => item.id === String(params[0])).slice(0, 1))
      }
      if (/^SELECT id, invitation_id, share_credential_id, inviter_user_id,/u.test(compact)) {
        return rows(state.relations.filter(item => item.id === String(params[0])).slice(0, 1))
      }
      if (/^SELECT user_id FROM user_phone_bindings WHERE user_id = \? AND status = 'active' LIMIT 2 FOR UPDATE$/u.test(compact)) {
        return rows(state.phones.filter(item => item.user_id === String(params[0]) && item.status === 'active')
          .slice(0, 2).map(item => ({ user_id: item.user_id })))
      }
      if (/^SELECT reward_slot FROM invitation_registration_relations/u.test(compact)) {
        return rows(state.relations.filter(item => item.inviter_user_id === String(params[0]) &&
          ['REWARD_PENDING', 'REWARD_GRANTED', 'MANUAL_REVIEW'].includes(item.reward_status))
          .map(item => ({ reward_slot: item.reward_slot })).sort((a, b) => a.reward_slot - b.reward_slot))
      }
      if (/^UPDATE invitation_registration_relations SET invitee_user_id=\?/u.test(compact)) {
        if (database.failOnFinalUpdate) {
          const error = new Error('injected final write failure with secret receipt/openid')
          error.code = 'ER_LOCK_DEADLOCK'
          throw error
        }
        const relationId = String(params.at(-1)); const relation = state.relations.find(item => item.id === relationId)
        if (!relation || relation.relation_status !== 'CANDIDATE') return [{ affectedRows: 0 }, []]
        relation.invitee_user_id = String(params[0]); relation.relation_status = 'FINAL'
        if (compact.includes("reward_status='NO_REWARD'")) {
          relation.qualification_status = 'INELIGIBLE'; relation.reward_status = 'NO_REWARD'
          relation.no_reward_reason = params[1]; relation.reward_slot = null
        } else {
          relation.qualification_status = 'ELIGIBLE'; relation.reward_status = 'REWARD_PENDING'
          relation.reward_slot = Number(params[1]); relation.reward_amount = 30
        }
        return [{ affectedRows: 1 }, []]
      }

      throw new Error(`Unexpected full-chain SQL: ${compact}`)
    }
  }
  database.connection = connection
  database.pool = { async getConnection() { return connection } }
  return database
}

function auth(userId, options = {}) {
  return `Bearer ${createUserSessionToken(userId, {
    jwtSecret: options.secret || JWT_SECRET,
    now: options.now || (() => NOW),
    userSessionTtlMs: options.ttl || 86400000
  }).token}`
}

async function request(baseUrl, path, body, authorization = '') {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {})
    }, body: JSON.stringify(body)
  })
  return { response, body: await response.json() }
}

async function withFullChain(database, identities, run, extraOptions = {}) {
  let loginIndex = 0
  const wechatLoginClient = {
    async code2Session() {
      const identity = Array.isArray(identities) ? identities[Math.min(loginIndex++, identities.length - 1)] : identities
      return { openid: identity.openid, unionid: identity.unionid || '' }
    },
    async phoneCode2Number() {
      const identity = Array.isArray(identities) ? identities[Math.max(0, loginIndex - 1)] : identities
      return { purePhoneNumber: identity.phone, countryCode: '86' }
    }
  }
  const server = http.createServer(createApiHandler({
    ...BASE_OPTIONS, ...extraOptions, pool: database.pool, wechatLoginClient,
    store: { async getWordCount() { return 0 } },
    testHooks: {
      async beforeWechatBindingInsert() { throw new Error('default path enabled a test hook') },
      async beforePhoneBindingInsert() { throw new Error('default path enabled a test hook') }
    }
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { await run(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise(resolve => server.close(resolve)) }
}

async function createCandidate(baseUrl, inviterId, candidateId) {
  const share = await request(baseUrl, '/api/user/invitations/share-credentials', {}, auth(inviterId))
  assert.equal(share.response.status, 200)
  const candidate = await request(baseUrl, '/api/user/invitations/candidates', { token: share.body.token }, auth(candidateId))
  assert.equal(candidate.response.status, 200)
  return candidate.body.candidateReceipt
}

function assertSuccessfulPhoneLogin(result, expectedUserId) {
  assert.equal(result.response.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.user.id, String(expectedUserId))
  assert.equal(result.response.headers.get('cache-control'), 'no-store')
  assert.equal(result.response.headers.get('pragma'), 'no-cache')
  const serialized = JSON.stringify(result.body)
  for (const forbidden of ['candidateReceipt', 'rewardStatus', 'rewardSlot', 'invitationId', 'openid']) {
    assert.equal(serialized.includes(forbidden), false)
  }
}

function seedCandidate(state, input = {}) {
  const shareId = String(state.nextShareId++)
  state.shares.push({
    id: shareId, credential_id: `00000000-0000-4000-8000-${shareId.padStart(12, '0')}`,
    inviter_user_id: String(input.inviterUserId), token_digest: Buffer.alloc(32, 1),
    token_key_version: 'v1', credential_status: input.credentialStatus || 'ACTIVE',
    expires_at: input.expiresAt || new Date('2026-10-04T00:00:00.000Z'),
    revoked_at: input.credentialStatus === 'REVOKED' ? NOW : null
  })
  const receipt = input.receipt || security.generateCandidateReceipt()
  const subject = createTrustedWechatCandidateSubject(APP_ID, input.openid)
  const relationId = String(state.nextRelationId++)
  state.relations.push({
    id: relationId, invitation_id: `10000000-0000-4000-8000-${relationId.padStart(12, '0')}`,
    share_credential_id: shareId, inviter_user_id: String(input.inviterUserId), invitee_user_id: null,
    candidate_subject_digest: security.digestTrustedCandidateSubject(subject),
    candidate_receipt_digest: security.digestCandidateReceipt(receipt),
    active_candidate_subject_digest: security.digestTrustedCandidateSubject(subject),
    candidate_key_version: 'v1', relation_status: 'CANDIDATE', qualification_status: 'UNRESOLVED',
    reward_status: 'NOT_RESERVED', no_reward_reason: null, reward_slot: null
  })
  return receipt
}

// Normal first registration traverses every production layer and reserves one reward slot.
{
  const db = createMemoryDatabase()
  addUser(db.state, '10', 'openid-inviter'); addPhone(db.state, '10', '13800138010')
  addUser(db.state, '20', 'openid-new', 'union-new')
  await withFullChain(db, { openid: 'openid-new', unionid: 'union-new', phone: '13800138020' }, async baseUrl => {
    const receipt = await createCandidate(baseUrl, '10', '20')
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', requestId: 'full-chain-normal', candidateReceipt: receipt
    }, auth('20'))
    assertSuccessfulPhoneLogin(result, '20')
  })
  assert.equal(db.state.transactions.filter(item => item.transaction_type === 'REGISTER_BONUS').length, 1)
  assert.equal(db.state.transactions[0].amount, 30)
  assert.equal(db.state.relations.at(-1).relation_status, 'FINAL')
  assert.equal(db.state.relations.at(-1).reward_status, 'REWARD_PENDING')
  assert.equal(db.state.relations.at(-1).reward_slot, 1)
}

// A/B identity conflicts fail closed through the real Identity Store and roll back the whole shared transaction.
{
  const db = createMemoryDatabase()
  addUser(db.state, '30', 'openid-shell', 'union-shell')
  addUser(db.state, '31'); addPhone(db.state, '31', '13800138031')
  addUser(db.state, '32', 'openid-inviter-32'); addPhone(db.state, '32', '13800138032')
  const receipt = seedCandidate(db.state, { inviterUserId: '32', openid: 'openid-shell' })
  const before = cloneState(db.state)
  await withFullChain(db, { openid: 'openid-shell', unionid: 'union-shell', phone: '13800138031' }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', requestId: 'full-chain-conflict', candidateReceipt: receipt
    }, auth('30'))
    assert.equal(result.response.status, 409)
    assert.equal(result.body.code, 'IDENTITY_CONFLICT')
    assert.equal(result.response.headers.get('cache-control'), 'no-store')
    const serialized = JSON.stringify(result.body)
    for (const forbidden of ['30', '31', 'openid-shell', 'wechat_user_bindings', 'ER_DUP_ENTRY']) {
      assert.equal(serialized.includes(forbidden), false)
    }
  })
  assert.deepEqual(db.state, before)
  assert.equal(db.state.wechat.find(item => item.openid === 'openid-shell').user_id, '30')
  assert.equal(db.state.phones.find(item => item.phone_hash === phoneIdentity('13800138031').phoneHash).user_id, '31')
  assert.equal(db.state.transactions.length, 0)
  assert.equal(db.state.relations.at(-1).relation_status, 'CANDIDATE')
  assert.equal(db.state.relations.at(-1).reward_slot, null)
  const lockCall = db.calls.find(call => typeof call === 'object' && /^SELECT id FROM users WHERE id IN/u.test(call.sql))
  assert.deepEqual(lockCall.params, ['30', '31', '32'])
  assert(db.calls.some(call => typeof call === 'object' &&
    /^SELECT user_id, phone_hash, phone_masked/u.test(call.sql)), 'real Identity Store must locate phone ownership')
  assert.equal(db.calls.some(call => typeof call === 'object' &&
    /^UPDATE `wechat_user_bindings` SET user_id/u.test(call.sql)), false)
  assert.equal(db.calls.filter(item => item === 'rollback').length, 1)
}

// Existing shell facts do not weaken the same stable fail-closed conflict.
for (const mode of ['business-fact', 'unionid-conflict']) {
  const db = createMemoryDatabase()
  addUser(db.state, '40', 'openid-shell-conflict', 'union-shell')
  addUser(db.state, '41'); addPhone(db.state, '41', '13800138041')
  if (mode === 'business-fact') db.state.favorites.push({ user_id: '40', word_id: 'study' })
  else addUser(db.state, '42', 'openid-other', 'union-shell')
  await withFullChain(db, { openid: 'openid-shell-conflict', unionid: 'union-shell', phone: '13800138041' }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', { loginCode: 'login', phoneCode: 'phone' })
    assert.equal(result.response.status, 409)
    assert.equal(result.body.code, 'IDENTITY_CONFLICT')
  })
  assert.equal(db.state.wechat.find(item => item.openid === 'openid-shell-conflict').user_id, '40')
}

// Missing/expired/bad-signature/invalid-sub JWTs and malformed receipts all degrade invitation only.
for (const variant of ['missing', 'expired', 'bad-signature', 'invalid-sub', 'malformed']) {
  const db = createMemoryDatabase()
  addUser(db.state, '50', 'openid-inviter-50'); addPhone(db.state, '50', '13800138050')
  addUser(db.state, '51', 'openid-degrade')
  const receipt = seedCandidate(db.state, { inviterUserId: '50', openid: 'openid-degrade' })
  let authorization = auth('51')
  if (variant === 'missing') authorization = ''
  if (variant === 'expired') authorization = auth('51', {
    now: () => new Date('2026-09-25T00:00:00.000Z'), ttl: 1000
  })
  if (variant === 'bad-signature') authorization = auth('51', { secret: 'wrong-full-chain-secret' })
  if (variant === 'invalid-sub') authorization = auth('invalid-sub')
  await withFullChain(db, { openid: 'openid-degrade', phone: '13800138151' }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: variant === 'malformed' ? 'bad' : receipt
    }, authorization)
    assertSuccessfulPhoneLogin(result, '51')
  })
  assert.equal(db.state.transactions.length, 1)
  assert.equal(db.state.relations[0].relation_status, 'CANDIDATE')
}

// JWT/WeChat discontinuity and unknown-subject receipt neither touch nor reveal the other candidate.
{
  const db = createMemoryDatabase()
  addUser(db.state, '60', 'openid-owner'); addUser(db.state, '61', 'openid-current')
  addUser(db.state, '62', 'openid-inviter-62'); addPhone(db.state, '62', '13800138062')
  const receipt = seedCandidate(db.state, { inviterUserId: '62', openid: 'openid-owner' })
  await withFullChain(db, { openid: 'openid-current', phone: '13800138161' }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: receipt
    }, auth('60'))
    assertSuccessfulPhoneLogin(result, '61')
  })
  assert.equal(db.state.relations[0].relation_status, 'CANDIDATE')
}

// Expired and revoked candidates still register and finalize without a reward.
for (const variant of ['expired', 'revoked']) {
  const db = createMemoryDatabase()
  addUser(db.state, '70', 'openid-inviter-70'); addPhone(db.state, '70', '13800138070')
  addUser(db.state, '71', `openid-${variant}`)
  const receipt = seedCandidate(db.state, {
    inviterUserId: '70', openid: `openid-${variant}`,
    expiresAt: variant === 'expired' ? new Date('2026-09-26T00:00:00.000Z') : undefined,
    credentialStatus: variant === 'revoked' ? 'REVOKED' : 'ACTIVE'
  })
  await withFullChain(db, { openid: `openid-${variant}`, phone: '13800138171' }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: receipt
    }, auth('71'))
    assertSuccessfulPhoneLogin(result, '71')
  })
  assert.equal(db.state.relations[0].reward_status, 'NO_REWARD')
  assert.equal(db.state.relations[0].no_reward_reason,
    variant === 'expired' ? 'INVITATION_EXPIRED' : 'INVITATION_REVOKED')
}

// Inviter phone eligibility is re-read after the user lock and before any slot scan.
{
  const db = createMemoryDatabase()
  addUser(db.state, '80', 'openid-inviter-80'); addPhone(db.state, '80', '13800138080')
  addUser(db.state, '81', 'openid-invitee-81')
  const receipt = seedCandidate(db.state, { inviterUserId: '80', openid: 'openid-invitee-81' })
  db.state.phones.find(item => item.user_id === '80').status = 'unbound'
  await withFullChain(db, { openid: 'openid-invitee-81', phone: '13800138181' }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: receipt
    }, auth('81'))
    assertSuccessfulPhoneLogin(result, '81')
    const replay = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login-replay', phoneCode: 'phone-replay', candidateReceipt: receipt
    }, auth('81'))
    assertSuccessfulPhoneLogin(replay, '81')
  })
  const relation = db.state.relations[0]
  assert.equal(relation.relation_status, 'FINAL')
  assert.equal(relation.reward_status, 'NO_REWARD')
  assert.equal(relation.no_reward_reason, 'INVITER_PHONE_REGISTRATION_REQUIRED')
  assert.equal(relation.reward_slot, null)
  const lockIndex = db.calls.findIndex(call => typeof call === 'object' && /^SELECT id FROM users WHERE id IN/u.test(call.sql))
  const eligibilityIndex = db.calls.findIndex(call => typeof call === 'object' &&
    /^SELECT user_id FROM user_phone_bindings[\s\S]*LIMIT 2 FOR UPDATE$/u.test(call.sql) && call.params[0] === '80')
  const slotIndex = db.calls.findIndex(call => typeof call === 'object' && /^SELECT reward_slot/u.test(call.sql))
  assert(lockIndex >= 0 && eligibilityIndex > lockIndex)
  assert.equal(slotIndex, -1)
}

// A concurrent compliant unbind is serialized by the same inviter user lock.
{
  const db = createMemoryDatabase()
  addUser(db.state, '85', 'openid-inviter-85'); addPhone(db.state, '85', '13800138085')
  addUser(db.state, '86', 'openid-invitee-86')
  const receipt = seedCandidate(db.state, { inviterUserId: '85', openid: 'openid-invitee-86' })
  db.concurrentRevocationUserId = '85'
  await withFullChain(db, { openid: 'openid-invitee-86', phone: '13800138186' }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: receipt
    }, auth('86'))
    assertSuccessfulPhoneLogin(result, '86')
  })
  assert.equal(db.state.relations[0].reward_status, 'REWARD_PENDING')
  assert.equal(db.state.phones.find(item => item.user_id === '85').status, 'unbound')
  assert(db.calls.indexOf('concurrent-revocation-blocked-by-user-lock') < db.calls.indexOf('commit'))
  assert(db.calls.indexOf('concurrent-revocation-after-lock-holder-commit') > db.calls.indexOf('commit'))
}

// Self invite, missing inviter, non-new phone user, and sixth slot all remain successful registrations.
for (const variant of ['self', 'missing-inviter', 'non-new', 'sixth']) {
  const db = createMemoryDatabase()
  const inviteeId = variant === 'self' ? '90' : '91'
  const inviterId = variant === 'self' ? inviteeId : variant === 'missing-inviter' ? '999' : '92'
  addUser(db.state, inviteeId, `openid-${variant}`)
  if (variant === 'non-new') addPhone(db.state, inviteeId, '13800138191')
  if (!['self', 'missing-inviter'].includes(variant)) {
    addUser(db.state, inviterId, `openid-inviter-${variant}`); addPhone(db.state, inviterId, '13800138092')
  }
  if (variant === 'self') db.state.users.find(item => item.id === inviteeId)
  const receipt = seedCandidate(db.state, { inviterUserId: inviterId, openid: `openid-${variant}` })
  if (variant === 'sixth') {
    for (let slot = 1; slot <= 5; slot += 1) db.state.relations.push({
      id: String(db.state.nextRelationId++), invitation_id: `slot-${slot}`, share_credential_id: 'other',
      inviter_user_id: inviterId, invitee_user_id: String(200 + slot), relation_status: 'FINAL',
      qualification_status: 'ELIGIBLE', reward_status: 'REWARD_PENDING', reward_slot: slot,
      no_reward_reason: null, candidate_subject_digest: Buffer.alloc(32, slot),
      candidate_receipt_digest: Buffer.alloc(32, slot + 10), active_candidate_subject_digest: Buffer.alloc(32, slot)
    })
  }
  const phone = variant === 'non-new' ? '13800138191' : `13800138${variant === 'self' ? '090' : '191'}`
  await withFullChain(db, { openid: `openid-${variant}`, phone }, async baseUrl => {
    const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
      loginCode: 'login', phoneCode: 'phone', candidateReceipt: receipt
    }, auth(inviteeId))
    assertSuccessfulPhoneLogin(result, inviteeId)
  })
  const relation = db.state.relations.find(item => sameBuffer(item.candidate_receipt_digest,
    security.digestCandidateReceipt(receipt)))
  assert.equal(relation.reward_status, 'NO_REWARD')
  assert.equal(relation.no_reward_reason, {
    self: 'SELF_INVITE', 'missing-inviter': 'INVITER_NOT_FOUND', 'non-new': 'NOT_FIRST_PHONE_REGISTRATION',
    sixth: 'INVITER_REWARD_LIMIT_REACHED'
  }[variant])
}

// A final-write failure rolls back identity, bonus, FINAL, and slot atomically.
{
  const db = createMemoryDatabase()
  addUser(db.state, '110', 'openid-rollback')
  addUser(db.state, '112', 'openid-inviter-112'); addPhone(db.state, '112', '13800138112')
  const receipt = seedCandidate(db.state, { inviterUserId: '112', openid: 'openid-rollback' })
  const before = cloneState(db.state)
  db.failOnFinalUpdate = true
  const warnings = []
  const originalWarn = console.warn
  console.warn = message => warnings.push(String(message))
  try {
    await withFullChain(db, { openid: 'openid-rollback', phone: '13800138111' }, async baseUrl => {
      const result = await request(baseUrl, '/api/auth/wechat-phone-login', {
        loginCode: 'login', phoneCode: 'phone', requestId: 'safe-request-id', candidateReceipt: receipt
      }, auth('110'))
      assert.equal(result.response.status, 503)
      const serialized = JSON.stringify(result.body)
      for (const forbidden of [receipt, 'openid-rollback', 'user_phone_bindings', 'ER_LOCK_DEADLOCK']) {
        assert.equal(serialized.includes(forbidden), false)
      }
    })
  } finally { console.warn = originalWarn }
  assert.deepEqual(db.state, before)
  assert(warnings.length >= 1)
  for (const warning of warnings) {
    for (const forbidden of [receipt, 'openid-rollback', '13800138111', 'Bearer', JWT_SECRET]) {
      assert.equal(warning.includes(forbidden), false)
    }
  }
  assert.equal(db.calls.filter(item => item === 'rollback').length, 3)
}

console.log('invitation registration formal full-chain scripted-connection tests passed')
