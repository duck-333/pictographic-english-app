import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createUserSessionToken } from '../server/auth.mjs'
import { createApiHandler } from '../server/index.mjs'

const NOW = new Date('2026-08-04T00:00:00.000Z')
const JWT_SECRET = 'membership-mvp-test-jwt-secret'
const ADMIN_API_TOKEN = 'membership-mvp-test-admin-token'
const USER_ID = '42'
const OTHER_USER_ID = '43'

function addDays(value, days) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function createUserStore() {
  return {
    async findUserProfileById(userId) {
      const normalizedUserId = String(userId)
      if (![USER_ID, OTHER_USER_ID].includes(normalizedUserId)) return null
      return {
        id: normalizedUserId,
        status: 'active',
        phoneMasked: '138****8000',
        hasWechatBinding: true,
        hasPhoneBinding: true
      }
    },
    async searchAdminUsers() {
      return []
    }
  }
}

function createEntitlementStore() {
  function createEntitlement(userId) {
    return {
      userId,
      quotaBalance: 7,
      quotaTotalGranted: 30,
      quotaTotalConsumed: 23,
      quotaTotalExpired: 0,
      membershipType: 'none',
      membershipStatus: 'none',
      membershipStartedAt: null,
      membershipExpireAt: null
    }
  }
  const entitlements = new Map([
    [USER_ID, createEntitlement(USER_ID)],
    [OTHER_USER_ID, createEntitlement(OTHER_USER_ID)]
  ])
  const grants = new Map()
  const transactions = []

  return {
    grants,
    transactions,
    get entitlement() {
      return { ...entitlements.get(USER_ID) }
    },
    async getUserEntitlement(userId) {
      const entitlement = entitlements.get(String(userId))
      return entitlement ? { ...entitlement } : null
    },
    async ensureRegistrationBonus(userId) {
      const entitlement = entitlements.get(String(userId)) || entitlements.get(USER_ID)
      return { entitlement: { ...entitlement } }
    },
    async grantMembershipDuration(input) {
      const existing = grants.get(input.idempotencyKey)
      if (existing) {
        if (
          existing.userId !== String(input.userId) ||
          existing.sourceType !== input.sourceType ||
          existing.sourceId !== input.sourceId
        ) {
          const error = new Error('Idempotency key is already used by another membership grant.')
          error.code = 'IDEMPOTENCY_KEY_CONFLICT'
          error.statusCode = 409
          throw error
        }
        return { ...existing.grant, idempotent: true }
      }

      const userId = String(input.userId)
      const entitlement = entitlements.get(userId)
      const effectiveStartAt = entitlement.membershipExpireAt && new Date(entitlement.membershipExpireAt) > NOW
        ? entitlement.membershipExpireAt
        : NOW.toISOString()
      const membershipExpireAt = addDays(new Date(effectiveStartAt), 30)
      const grantNumber = grants.size + 1
      const grant = {
        grantId: `membership-grant-${grantNumber}`,
        idempotent: false,
        effectiveStartAt,
        effectiveEndAt: membershipExpireAt,
        membershipType: 'monthly',
        membershipStatus: 'active',
        membershipExpireAt
      }
      const updatedEntitlement = {
        ...entitlement,
        membershipType: 'monthly',
        membershipStatus: 'active',
        membershipStartedAt: entitlement.membershipStartedAt || NOW.toISOString(),
        membershipExpireAt
      }
      entitlements.set(userId, updatedEntitlement)
      grants.set(input.idempotencyKey, {
        userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        grant
      })
      transactions.unshift({
        id: `membership-transaction-row-${grantNumber}`,
        transactionId: `membership-transaction-${grantNumber}`,
        userId,
        transactionType: 'MEMBERSHIP_GRANT',
        amount: 0,
        balanceAfter: updatedEntitlement.quotaBalance,
        source: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        operatorType: input.operatorType,
        operatorId: input.operatorId,
        reason: input.reason,
        createdAt: NOW.toISOString()
      })
      return { ...grant }
    },
    async listUserTransactions(userId, options = {}) {
      const type = String(options.transactionType || '').trim()
      const offset = Number(options.offset || 0)
      const limit = Number(options.limit || 50)
      return transactions
        .filter((transaction) => transaction.userId === String(userId))
        .filter((transaction) => !type || transaction.transactionType === type)
        .slice(offset, offset + limit)
        .map((transaction) => ({ ...transaction }))
    },
    async consumeQuota(input = {}) {
      const entitlement = entitlements.get(String(input.userId || USER_ID))
      return {
        allowed: true,
        reason: 'membership_active',
        membershipType: entitlement.membershipType,
        membershipExpireAt: entitlement.membershipExpireAt,
        remainingQuota: entitlement.quotaBalance,
        entitlement: { ...entitlement }
      }
    }
  }
}

function createWordStore() {
  return {
    async findWordById(id) {
      if (id !== 'word-study') return null
      return {
        id: 'word-study',
        word: 'study',
        meaning: '学习',
        status: 'published',
        explanation: 'Full membership content.',
        videoClips: [{ id: 'clip-1', url: 'https://cdn.baxiaota.com/study.mp4' }]
      }
    }
  }
}

async function startServer() {
  const userEntitlementStore = createEntitlementStore()
  const server = http.createServer(createApiHandler({
    store: createWordStore(),
    userStore: createUserStore(),
    userEntitlementStore,
    jwtSecret: JWT_SECRET,
    adminApiToken: ADMIN_API_TOKEN,
    now: () => new Date(NOW)
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    server,
    userEntitlementStore,
    baseUrl: `http://127.0.0.1:${address.port}`
  }
}

async function readJson(response) {
  return {
    status: response.status,
    body: await response.json()
  }
}

async function postMembershipGrant(baseUrl, payload, token = ADMIN_API_TOKEN, userId = USER_ID) {
  return await readJson(await fetch(`${baseUrl}/api/admin/entitlements/users/${userId}/membership-grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  }))
}

async function testMembershipMvpApi() {
  const { server, userEntitlementStore, baseUrl } = await startServer()
  try {
    const session = createUserSessionToken(USER_ID, {
      jwtSecret: JWT_SECRET,
      now: () => new Date(NOW)
    })
    const unauthorized = await postMembershipGrant(baseUrl, {
      operationId: 'review-operation-1',
      reason: 'MVP review gift.'
    }, 'wrong-token')
    assert.equal(unauthorized.status, 403)
    const userJwtUnauthorized = await postMembershipGrant(baseUrl, {
      operationId: 'review-operation-1',
      reason: 'MVP review gift.'
    }, session.token)
    assert.equal(userJwtUnauthorized.status, 403)

    const payload = {
      operationId: 'review-operation-1',
      reason: 'MVP review gift.'
    }
    const first = await postMembershipGrant(baseUrl, payload)
    assert.equal(first.status, 200)
    assert.equal(first.body.ok, true)
    assert.equal(first.body.grant.idempotent, false)
    assert.equal(first.body.entitlement.membershipActive, true)
    assert.equal(first.body.transaction.transactionType, 'MEMBERSHIP_GRANT')
    assert.equal(first.body.transaction.source, 'admin_gift')
    assert.equal(userEntitlementStore.transactions[0].sourceId, 'admin_membership_gift:review-operation-1')
    assert.equal(userEntitlementStore.transactions[0].idempotencyKey, 'admin_membership_grant:review-operation-1')

    const second = await postMembershipGrant(baseUrl, payload)
    assert.equal(second.status, 200)
    assert.equal(second.body.grant.idempotent, true)
    assert.equal(second.body.grant.grantId, first.body.grant.grantId)
    assert.equal(second.body.grant.effectiveStartAt, first.body.grant.effectiveStartAt)
    assert.equal(second.body.grant.effectiveEndAt, first.body.grant.effectiveEndAt)
    assert.equal(userEntitlementStore.grants.size, 1)
    assert.equal(userEntitlementStore.transactions.length, 1)

    const crossUserConflict = await postMembershipGrant(baseUrl, payload, ADMIN_API_TOKEN, OTHER_USER_ID)
    assert.equal(crossUserConflict.status, 409)
    assert.equal(crossUserConflict.body.code, 'MEMBERSHIP_OPERATION_ID_CONFLICT')
    assert.equal(userEntitlementStore.grants.size, 1)
    assert.equal(userEntitlementStore.transactions.length, 1)

    const differentOperation = await postMembershipGrant(baseUrl, {
      operationId: 'review-operation-2',
      reason: 'Second valid MVP review gift.'
    })
    assert.equal(differentOperation.status, 200)
    assert.equal(differentOperation.body.grant.idempotent, false)
    assert.notEqual(differentOperation.body.grant.grantId, first.body.grant.grantId)
    assert.equal(userEntitlementStore.grants.size, 2)
    assert.equal(userEntitlementStore.transactions.length, 2)

    const fixedDuration = await postMembershipGrant(baseUrl, {
      operationId: 'review-operation-3',
      reason: 'Must remain fixed.',
      days: 60
    })
    assert.equal(fixedDuration.status, 400)
    assert.equal(fixedDuration.body.code, 'MEMBERSHIP_DURATION_NOT_CONFIGURABLE')

    const authorization = `Bearer ${session.token}`
    const entitlements = await readJson(await fetch(`${baseUrl}/api/user/entitlements`, {
      headers: { Authorization: authorization }
    }))
    assert.equal(entitlements.status, 200)
    assert.equal(entitlements.body.membershipActive, true)

    const quotaBefore = userEntitlementStore.entitlement.quotaBalance
    const word = await readJson(await fetch(`${baseUrl}/api/words/word-study`, {
      headers: {
        Authorization: authorization,
        'X-Client-Request-Id': 'membership-word-access-1'
      }
    }))
    assert.equal(word.status, 200)
    assert.equal(word.body.access.canAccessFull, true)
    assert.equal(word.body.charged, false)
    assert.equal(word.body.membershipActive, true)
    assert.equal(userEntitlementStore.entitlement.quotaBalance, quotaBefore)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function testMiniappMembershipActiveNormalization() {
  const originalUni = globalThis.uni
  globalThis.uni = {
    request(options) {
      options.success({
        statusCode: 200,
        data: {
          ok: true,
          quotaBalance: 7,
          quotaTotalGranted: 30,
          quotaTotalConsumed: 23,
          membershipType: 'monthly',
          membershipStatus: 'active',
          membershipExpireAt: addDays(NOW, 30),
          membershipActive: true
        }
      })
      return { abort() {} }
    }
  }

  try {
    const { getUserEntitlements } = await import('../miniapp-uni/word-app1/common/user-entitlements-api-client.js')
    const entitlement = await getUserEntitlements({
      session: { token: 'test-session-token' }
    })
    assert.equal(entitlement.membershipActive, true)
    assert.equal(entitlement.membershipExpireAt, addDays(NOW, 30))
  } finally {
    if (originalUni === undefined) {
      delete globalThis.uni
    } else {
      globalThis.uni = originalUni
    }
  }
}

await testMembershipMvpApi()
await testMiniappMembershipActiveNormalization()

console.log('membership entitlement MVP tests passed')
