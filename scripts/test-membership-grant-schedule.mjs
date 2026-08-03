import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MEMBERSHIP_GRANT_DURATION_SECONDS,
  revokeMembershipGrantSchedule,
  scheduleMembershipGrant
} from '../server/membership-grant-schedule.mjs'
import { createUserEntitlementStore } from '../server/user-entitlement-store.mjs'

const DAY_SECONDS = 24 * 60 * 60

function addSeconds(value, seconds) {
  return new Date(new Date(value).getTime() + seconds * 1000).toISOString()
}

function grant(id, startAt, options = {}) {
  const durationSeconds = options.durationSeconds ?? MEMBERSHIP_GRANT_DURATION_SECONDS
  return {
    id: String(id),
    sourceType: options.sourceType || 'admin_gift',
    sourceId: options.sourceId || `source-${id}`,
    status: options.status || 'granted',
    grantedAt: options.grantedAt || addSeconds(startAt, Number(id) || 0),
    effectiveStartAt: startAt,
    effectiveEndAt: options.effectiveEndAt || addSeconds(startAt, durationSeconds),
    durationSeconds,
    consumedSecondsAtRevoke: options.consumedSecondsAtRevoke || 0,
    revokedSeconds: options.revokedSeconds || 0
  }
}

function testGrantWithoutMembership() {
  const result = scheduleMembershipGrant({
    now: '2026-01-01T00:00:00.000Z',
    grants: []
  })
  assert.equal(result.effectiveStartAt, '2026-01-01T00:00:00.000Z')
  assert.equal(result.effectiveEndAt, '2026-01-31T00:00:00.000Z')
}

function testGrantStacksAfterActiveMembership() {
  const result = scheduleMembershipGrant({
    now: '2026-01-01T00:00:00.000Z',
    membershipExpireAt: '2026-01-10T00:00:00.000Z',
    grants: []
  })
  assert.equal(result.effectiveStartAt, '2026-01-10T00:00:00.000Z')
  assert.equal(result.effectiveEndAt, '2026-02-09T00:00:00.000Z')
}

function testExpiredMembershipStartsNow() {
  const result = scheduleMembershipGrant({
    now: '2026-02-01T00:00:00.000Z',
    membershipExpireAt: '2026-01-10T00:00:00.000Z',
    grants: []
  })
  assert.equal(result.effectiveStartAt, '2026-02-01T00:00:00.000Z')
}

function testFixedDuration() {
  const result = scheduleMembershipGrant({
    now: '2026-01-01T00:00:00.000Z',
    grants: []
  })
  assert.equal(result.durationSeconds, 2592000)
  assert.equal((Date.parse(result.effectiveEndAt) - Date.parse(result.effectiveStartAt)) / 1000, 2592000)
  assert.throws(() => scheduleMembershipGrant({
    now: '2026-01-01T00:00:00.000Z',
    grants: [],
    durationSeconds: 1
  }), /2592000/)
}

function testCrossMonthUsesFixedSeconds() {
  const result = scheduleMembershipGrant({
    now: '2026-01-31T12:00:00.000Z',
    grants: []
  })
  assert.equal(result.effectiveEndAt, '2026-03-02T12:00:00.000Z')
}

function testCrossDstUsesFixedSeconds() {
  const result = scheduleMembershipGrant({
    now: '2026-03-01T06:30:00.000Z',
    grants: []
  })
  assert.equal((Date.parse(result.effectiveEndAt) - Date.parse(result.effectiveStartAt)) / 1000, 2592000)
}

function testThreeConsecutiveGrants() {
  const start = '2026-01-01T00:00:00.000Z'
  const a = grant(1, start)
  const bSchedule = scheduleMembershipGrant({ now: start, grants: [a] })
  const b = grant(2, bSchedule.effectiveStartAt)
  const cSchedule = scheduleMembershipGrant({ now: start, grants: [b, a] })
  assert.equal(b.effectiveStartAt, '2026-01-31T00:00:00.000Z')
  assert.equal(cSchedule.effectiveStartAt, '2026-03-02T00:00:00.000Z')
  assert.equal(cSchedule.effectiveEndAt, '2026-04-01T00:00:00.000Z')
}

function testRevokeAfterTenDays() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-11T00:00:00.000Z',
    grants: [a],
    targetGrantId: '1'
  })
  assert.equal(result.usedSeconds, 10 * DAY_SECONDS)
  assert.equal(result.revokedSeconds, 20 * DAY_SECONDS)
  assert.equal(result.membershipExpireAt, '2026-01-11T00:00:00.000Z')
}

function testRevokeNotStartedGrant() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const b = grant(2, a.effectiveEndAt)
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-10T00:00:00.000Z',
    grants: [a, b],
    targetGrantId: '2'
  })
  assert.equal(result.usedSeconds, 0)
  assert.equal(result.revokedSeconds, MEMBERSHIP_GRANT_DURATION_SECONDS)
  assert.equal(result.membershipExpireAt, a.effectiveEndAt)
}

function testRevokeFullyUsedGrant() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const result = revokeMembershipGrantSchedule({
    now: '2026-02-10T00:00:00.000Z',
    grants: [a],
    targetGrantId: '1'
  })
  assert.equal(result.usedSeconds, MEMBERSHIP_GRANT_DURATION_SECONDS)
  assert.equal(result.revokedSeconds, 0)
  assert.equal(result.membershipExpireAt, a.effectiveEndAt)
  assert.equal(result.shortened, false)
}

function testRevokeMiddleMovesLaterGrant() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const b = grant(2, a.effectiveEndAt)
  const c = grant(3, b.effectiveEndAt)
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-10T00:00:00.000Z',
    grants: [a, b, c],
    targetGrantId: '2'
  })
  const movedC = result.grants.find((item) => item.id === '3')
  assert.equal(movedC.effectiveStartAt, a.effectiveEndAt)
  assert.equal(result.membershipExpireAt, b.effectiveEndAt)
}

function testRevokeFirstMovesAllLaterGrants() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const b = grant(2, a.effectiveEndAt)
  const c = grant(3, b.effectiveEndAt)
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-11T00:00:00.000Z',
    grants: [a, b, c],
    targetGrantId: '1'
  })
  assert.equal(result.grants.find((item) => item.id === '2').effectiveStartAt, '2026-01-11T00:00:00.000Z')
  assert.equal(result.grants.find((item) => item.id === '3').effectiveStartAt, '2026-02-10T00:00:00.000Z')
}

function testRepeatedRevokeDoesNotShortenAgain() {
  const revoked = grant(1, '2026-01-01T00:00:00.000Z', {
    status: 'revoked',
    durationSeconds: MEMBERSHIP_GRANT_DURATION_SECONDS,
    effectiveEndAt: '2026-01-11T00:00:00.000Z',
    consumedSecondsAtRevoke: 10 * DAY_SECONDS,
    revokedSeconds: 20 * DAY_SECONDS
  })
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-20T00:00:00.000Z',
    grants: [revoked],
    targetGrantId: '1'
  })
  assert.equal(result.alreadyRevoked, true)
  assert.equal(result.shortened, false)
  assert.equal(result.membershipExpireAt, revoked.effectiveEndAt)
}

function testInputOrderUsesGrantedAtThenId() {
  const start = '2026-01-01T00:00:00.000Z'
  const a = grant(10, start, { grantedAt: '2026-01-01T01:00:00.000Z' })
  const b = grant(2, a.effectiveEndAt, { grantedAt: '2026-01-01T01:00:00.000Z' })
  const result = revokeMembershipGrantSchedule({
    now: '2025-12-31T00:00:00.000Z',
    grants: [a, b],
    targetGrantId: '2'
  })
  assert.deepEqual(result.grants.map((item) => item.id), ['2', '10'])
}

function testLegacyBaselineWithNewGrant() {
  const legacy = grant('legacy', '2025-12-01T00:00:00.000Z', {
    sourceType: 'legacy_membership',
    durationSeconds: 45 * DAY_SECONDS,
    effectiveEndAt: '2026-01-15T00:00:00.000Z',
    grantedAt: '2025-12-01T00:00:00.000Z'
  })
  const result = scheduleMembershipGrant({
    now: '2026-01-01T00:00:00.000Z',
    membershipExpireAt: legacy.effectiveEndAt,
    grants: [],
    legacyBaseline: legacy
  })
  assert.equal(result.effectiveStartAt, legacy.effectiveEndAt)
  assert.equal(result.effectiveEndAt, '2026-02-14T00:00:00.000Z')
}

function testRevokeNewGrantPreservesLegacyExpiry() {
  const legacy = grant(1, '2025-12-01T00:00:00.000Z', {
    sourceType: 'legacy_membership',
    durationSeconds: 45 * DAY_SECONDS,
    effectiveEndAt: '2026-01-15T00:00:00.000Z',
    grantedAt: '2025-12-01T00:00:00.000Z'
  })
  const current = grant(2, legacy.effectiveEndAt)
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-01T00:00:00.000Z',
    grants: [current, legacy],
    targetGrantId: '2'
  })
  assert.equal(result.membershipExpireAt, legacy.effectiveEndAt)
}

function testConservativeLegacyBaselineDoesNotShortenSnapshot() {
  const now = '2026-01-01T00:00:00.000Z'
  const expireAt = '2026-01-10T00:00:00.000Z'
  const conservativeLegacy = grant('legacy', now, {
    sourceType: 'legacy_membership',
    durationSeconds: 9 * DAY_SECONDS,
    effectiveEndAt: expireAt,
    grantedAt: now
  })
  const result = scheduleMembershipGrant({
    now,
    membershipExpireAt: expireAt,
    grants: [],
    legacyBaseline: conservativeLegacy
  })
  assert.equal(conservativeLegacy.effectiveStartAt, now)
  assert.equal(result.effectiveStartAt, expireAt)
}

function testEmptyGrants() {
  const result = scheduleMembershipGrant({
    now: '2026-01-01T00:00:00.000Z',
    grants: []
  })
  assert.equal(result.membershipExpireAt, '2026-01-31T00:00:00.000Z')
  assert.throws(() => revokeMembershipGrantSchedule({
    now: '2026-01-01T00:00:00.000Z',
    grants: [],
    targetGrantId: 'missing'
  }), /not found/)
}

function testInvalidDurationAndBackwardTimeRejected() {
  assert.throws(() => revokeMembershipGrantSchedule({
    now: '2026-01-01T00:00:00.000Z',
    targetGrantId: '1',
    grants: [grant(1, '2026-01-01T00:00:00.000Z', { durationSeconds: -1 })]
  }), /non-negative/)
  assert.throws(() => revokeMembershipGrantSchedule({
    now: '2026-01-01T00:00:00.000Z',
    targetGrantId: '1',
    grants: [{
      ...grant(1, '2026-01-01T00:00:00.000Z'),
      effectiveEndAt: '2025-12-31T00:00:00.000Z'
    }]
  }), /before it starts/)
}

function testInputsAreNotMutated() {
  const grants = [
    grant(1, '2026-01-01T00:00:00.000Z'),
    grant(2, '2026-01-31T00:00:00.000Z')
  ]
  const before = JSON.stringify(grants)
  scheduleMembershipGrant({ now: '2026-01-01T00:00:00.000Z', grants })
  revokeMembershipGrantSchedule({
    now: '2026-01-10T00:00:00.000Z',
    grants,
    targetGrantId: '1'
  })
  assert.equal(JSON.stringify(grants), before)
}

function testHistoricalRevokedGrantDoesNotMove() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const b = grant(2, a.effectiveEndAt, {
    status: 'revoked',
    effectiveEndAt: '2026-02-10T00:00:00.000Z',
    consumedSecondsAtRevoke: 10 * DAY_SECONDS,
    revokedSeconds: 20 * DAY_SECONDS
  })
  const c = grant(3, b.effectiveEndAt)
  const beforeB = JSON.stringify(b)
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-11T00:00:00.000Z',
    grants: [a, b, c],
    targetGrantId: '1'
  })
  const resultB = result.grants.find((item) => item.id === '2')
  const resultC = result.grants.find((item) => item.id === '3')
  assert.equal(JSON.stringify({
    ...b,
    grantedAt: new Date(b.grantedAt).toISOString(),
    effectiveStartAt: new Date(b.effectiveStartAt).toISOString(),
    effectiveEndAt: new Date(b.effectiveEndAt).toISOString()
  }), JSON.stringify(resultB))
  assert.equal(JSON.stringify(b), beforeB)
  assert(!result.updates.some((item) => item.id === '2'))
  assert.equal(resultC.effectiveStartAt, '2026-01-11T00:00:00.000Z')
  assert.equal(result.membershipExpireAt, '2026-02-10T00:00:00.000Z')
}

function testRevokeGrantedAfterHistoricalRevokedGrant() {
  const a = grant(1, '2026-01-01T00:00:00.000Z', {
    status: 'revoked',
    effectiveEndAt: '2026-01-11T00:00:00.000Z',
    consumedSecondsAtRevoke: 10 * DAY_SECONDS,
    revokedSeconds: 20 * DAY_SECONDS
  })
  const b = grant(2, a.effectiveEndAt)
  const originalA = JSON.stringify(a)
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-20T00:00:00.000Z',
    grants: [a, b],
    targetGrantId: '2'
  })
  assert.equal(JSON.stringify(a), originalA)
  assert.deepEqual(result.updates.map((item) => item.id), ['2'])
  assert.equal(result.usedSeconds, 9 * DAY_SECONDS)
  assert.equal(result.membershipExpireAt, '2026-01-20T00:00:00.000Z')
}

function testMultipleHistoricalRevokedGrantsStayImmutable() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const revokedB = grant(2, a.effectiveEndAt, {
    status: 'revoked',
    effectiveEndAt: '2026-02-05T00:00:00.000Z',
    consumedSecondsAtRevoke: 5 * DAY_SECONDS,
    revokedSeconds: 25 * DAY_SECONDS
  })
  const c = grant(3, revokedB.effectiveEndAt)
  const revokedD = grant(4, c.effectiveEndAt, {
    status: 'revoked',
    effectiveEndAt: '2026-03-08T00:00:00.000Z',
    consumedSecondsAtRevoke: DAY_SECONDS,
    revokedSeconds: 29 * DAY_SECONDS
  })
  const e = grant(5, revokedD.effectiveEndAt)
  const revokedBefore = new Map([
    ['2', JSON.stringify(revokedB)],
    ['4', JSON.stringify(revokedD)]
  ])
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-11T00:00:00.000Z',
    grants: [e, revokedD, c, revokedB, a],
    targetGrantId: '1'
  })
  assert.deepEqual(result.updates.map((item) => item.id), ['1', '3', '5'])
  assert.deepEqual(result.rescheduleUpdates.map((item) => item.id), ['3', '5'])
  assert.equal(result.targetUpdate.id, '1')
  assert.equal(result.grants.find((item) => item.id === '2').effectiveStartAt, revokedB.effectiveStartAt)
  assert.equal(result.grants.find((item) => item.id === '2').effectiveEndAt, revokedB.effectiveEndAt)
  assert.equal(result.grants.find((item) => item.id === '2').consumedSecondsAtRevoke, revokedB.consumedSecondsAtRevoke)
  assert.equal(result.grants.find((item) => item.id === '2').revokedSeconds, revokedB.revokedSeconds)
  assert.equal(result.grants.find((item) => item.id === '4').effectiveStartAt, revokedD.effectiveStartAt)
  assert.equal(result.grants.find((item) => item.id === '4').effectiveEndAt, revokedD.effectiveEndAt)
  assert.equal(result.grants.find((item) => item.id === '4').consumedSecondsAtRevoke, revokedD.consumedSecondsAtRevoke)
  assert.equal(result.grants.find((item) => item.id === '4').revokedSeconds, revokedD.revokedSeconds)
  assert.equal(JSON.stringify(revokedB), revokedBefore.get('2'))
  assert.equal(JSON.stringify(revokedD), revokedBefore.get('4'))
  assert.equal(result.membershipExpireAt, '2026-03-12T00:00:00.000Z')
}

function testTargetAndGrantedUpdatesAreSeparated() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const b = grant(2, a.effectiveEndAt)
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-11T00:00:00.000Z',
    grants: [a, b],
    targetGrantId: '1'
  })
  assert.equal(result.targetUpdate.id, '1')
  assert.deepEqual(result.rescheduleUpdates.map((item) => item.id), ['2'])
  assert.deepEqual(result.updates.map((item) => item.id), ['1', '2'])
}

function testNowExactlyAtTargetStart() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const result = revokeMembershipGrantSchedule({
    now: a.effectiveStartAt,
    grants: [a],
    targetGrantId: '1'
  })
  assert.equal(result.usedSeconds, 0)
  assert.equal(result.revokedSeconds, MEMBERSHIP_GRANT_DURATION_SECONDS)
}

function testNowExactlyAtTargetEnd() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const result = revokeMembershipGrantSchedule({
    now: a.effectiveEndAt,
    grants: [a],
    targetGrantId: '1'
  })
  assert.equal(result.usedSeconds, MEMBERSHIP_GRANT_DURATION_SECONDS)
  assert.equal(result.revokedSeconds, 0)
}

function testNowOneSecondBeforeTargetEnd() {
  const a = grant(1, '2026-01-01T00:00:00.000Z')
  const result = revokeMembershipGrantSchedule({
    now: addSeconds(a.effectiveEndAt, -1),
    grants: [a],
    targetGrantId: '1'
  })
  assert.equal(result.usedSeconds, MEMBERSHIP_GRANT_DURATION_SECONDS - 1)
  assert.equal(result.revokedSeconds, 1)
}

function testRevokedTargetReplayHasNoUpdates() {
  const a = grant(1, '2026-01-01T00:00:00.000Z', {
    status: 'revoked',
    effectiveEndAt: '2026-01-11T00:00:00.000Z',
    consumedSecondsAtRevoke: 10 * DAY_SECONDS,
    revokedSeconds: 20 * DAY_SECONDS
  })
  const result = revokeMembershipGrantSchedule({
    now: '2026-01-20T00:00:00.000Z',
    grants: [a],
    targetGrantId: '1'
  })
  assert.equal(result.targetUpdate, null)
  assert.deepEqual(result.rescheduleUpdates, [])
  assert.deepEqual(result.updates, [])
  assert.deepEqual(result.affectedGrants, [])
}

async function testLegacyGrantMembershipFailsFastOnCustomIntervals() {
  const store = createUserEntitlementStore({
    pool: {
      getConnection() {
        throw new Error('database must not be reached by compatibility validation')
      }
    }
  })
  const baseInput = {
    userId: '42',
    sourceType: 'admin_gift',
    sourceId: 'gift-42',
    idempotencyKey: 'membership-grant-42',
    operatorType: 'admin',
    operatorId: 'review-admin',
    reason: 'Compatibility contract test.'
  }
  await assert.rejects(
    store.grantMembership({ ...baseInput, startedAt: '2026-01-01T00:00:00.000Z' }),
    (error) => error && error.code === 'CUSTOM_MEMBERSHIP_INTERVAL_UNSUPPORTED'
  )
  await assert.rejects(
    store.grantMembership({ ...baseInput, durationSeconds: 1 }),
    (error) => error && error.code === 'CUSTOM_MEMBERSHIP_INTERVAL_UNSUPPORTED'
  )
  await assert.rejects(
    store.grantMembership({ ...baseInput, membershipType: 'annual' }),
    (error) => error && error.code === 'CUSTOM_MEMBERSHIP_INTERVAL_UNSUPPORTED'
  )
}

function testMembershipStoreStaticSafetyContract() {
  const source = readFileSync(new URL('../server/user-entitlement-store.mjs', import.meta.url), 'utf8')
  const revokeStart = source.indexOf('  async function revokeMembershipGrant(input = {})')
  const revokeEnd = source.indexOf('  async function consumeQuota(input = {})', revokeStart)
  const revokeSource = source.slice(revokeStart, revokeEnd)
  const hintRead = revokeSource.indexOf('targetHint = await findMembershipGrantHint(connection, grantId)')
  const transactionStart = revokeSource.indexOf('await connection.beginTransaction()')
  const entitlementLock = revokeSource.indexOf('ensureUserEntitlementInTransaction(connection, targetHint.userId)')
  const grantsLock = revokeSource.indexOf("listUserMembershipGrants(connection, targetHint.userId, { forUpdate: true })")
  const targetRelocation = revokeSource.indexOf('grants.find((grant) => grant.id === grantId)')
  const idempotencyRead = revokeSource.indexOf('findTransactionByIdempotencyKey(connection, idempotencyKey, { forUpdate: true })')
  const revokedShortCircuit = revokeSource.indexOf("if (targetGrant.status === 'revoked')")

  assert(hintRead >= 0 && transactionStart > hintRead)
  assert(entitlementLock > transactionStart && grantsLock > entitlementLock)
  assert(targetRelocation > grantsLock)
  assert(idempotencyRead > grantsLock && revokedShortCircuit > idempotencyRead)
  assert(!revokeSource.includes("findMembershipGrantById(connection, grantId, { forUpdate: true })"))
  assert(source.includes("const lockClause = options.forUpdate ? ' FOR UPDATE' : ''"))
  assert(source.includes('LIMIT 1${lockClause}`'))
  assert(revokeSource.includes("WHERE id = ? AND user_id = ? AND status = 'granted'"))
  assert(revokeSource.includes("assertSingleRowUpdate(targetUpdateResult, 'membership grant revoke target')"))
  assert(revokeSource.includes("assertSingleRowUpdate(rescheduleUpdateResult, 'membership grant FIFO reschedule')"))
  assert(revokeSource.includes("assertSingleRowUpdate(snapshotUpdateResult, 'membership revoke entitlement snapshot')"))
  assert(source.includes('transaction.transactionType === ENTITLEMENT_TRANSACTION_TYPES.MEMBERSHIP_REVOKE'))
  assert(source.includes("typeof metadata.membershipGrantId === 'string'"))
  assert(source.includes('metadata.membershipGrantId === targetGrant.id'))
}

function testMembershipRevokeReplayStaticContract() {
  const source = readFileSync(new URL('../server/user-entitlement-store.mjs', import.meta.url), 'utf8')
  const restoreStart = source.indexOf('function restoreMembershipRevokeReplay(transaction, targetGrant)')
  const restoreEnd = source.indexOf('function mapMembershipGrantRow(row)', restoreStart)
  const restoreSource = source.slice(restoreStart, restoreEnd)
  const revokeStart = source.indexOf('  async function revokeMembershipGrant(input = {})')
  const revokeEnd = source.indexOf('  async function consumeQuota(input = {})', revokeStart)
  const revokeSource = source.slice(revokeStart, revokeEnd)

  assert(restoreSource.includes('alreadyRevoked: metadata.alreadyRevoked'))
  assert(!restoreSource.includes('alreadyRevoked: true'))
  assert(restoreSource.includes('const membershipStatus = normalizeString(metadata.membershipStatus)'))
  assert(restoreSource.includes("typeof usedSeconds !== 'number'"))
  assert(restoreSource.includes("typeof metadata.membershipExpireAtAfter !== 'string'"))
  assert(restoreSource.includes('metadata.alreadyRevoked !== false'))
  assert(revokeSource.includes('membershipStatus: schedule.membershipStatus'))
  assert(revokeSource.includes('alreadyRevoked: false'))
  assert(revokeSource.includes("if (targetGrant.status === 'revoked')"))
  assert(revokeSource.includes('idempotent: false,\n          alreadyRevoked: true'))
}

function testMembershipGrantDuplicateConflictStaticContract() {
  const source = readFileSync(new URL('../server/user-entitlement-store.mjs', import.meta.url), 'utf8')
  const grantStart = source.indexOf('  async function grantMembershipDuration(input = {})')
  const grantEnd = source.indexOf('  async function grantMembership(input = {})', grantStart)
  const grantSource = source.slice(grantStart, grantEnd)
  const duplicateStart = grantSource.indexOf('if (isDuplicateEntryError(error))')
  const duplicateSource = grantSource.slice(duplicateStart)
  const idempotencyGrantRead = duplicateSource.indexOf('findMembershipGrantByIdempotencyKey(connection, idempotencyKey)')
  const sourceRead = duplicateSource.indexOf('findMembershipGrantBySource(connection, sourceType, sourceId)')
  const transactionRead = duplicateSource.indexOf('findTransactionByIdempotencyKey(connection, idempotencyKey)')
  const sanitizedFallback = duplicateSource.indexOf("code: 'MEMBERSHIP_GRANT_CONFLICT'")

  assert(duplicateStart >= 0)
  assert(idempotencyGrantRead >= 0 && sourceRead > idempotencyGrantRead)
  assert(transactionRead > sourceRead && sanitizedFallback > transactionRead)
  assert(duplicateSource.includes("code: 'MEMBERSHIP_SOURCE_CONFLICT'"))
  assert(duplicateSource.includes('if (existingGrant) throw createIdempotencyConflictError()'))
}

testGrantWithoutMembership()
testGrantStacksAfterActiveMembership()
testExpiredMembershipStartsNow()
testFixedDuration()
testCrossMonthUsesFixedSeconds()
testCrossDstUsesFixedSeconds()
testThreeConsecutiveGrants()
testRevokeAfterTenDays()
testRevokeNotStartedGrant()
testRevokeFullyUsedGrant()
testRevokeMiddleMovesLaterGrant()
testRevokeFirstMovesAllLaterGrants()
testRepeatedRevokeDoesNotShortenAgain()
testInputOrderUsesGrantedAtThenId()
testLegacyBaselineWithNewGrant()
testRevokeNewGrantPreservesLegacyExpiry()
testConservativeLegacyBaselineDoesNotShortenSnapshot()
testEmptyGrants()
testInvalidDurationAndBackwardTimeRejected()
testInputsAreNotMutated()
testHistoricalRevokedGrantDoesNotMove()
testRevokeGrantedAfterHistoricalRevokedGrant()
testMultipleHistoricalRevokedGrantsStayImmutable()
testTargetAndGrantedUpdatesAreSeparated()
testNowExactlyAtTargetStart()
testNowExactlyAtTargetEnd()
testNowOneSecondBeforeTargetEnd()
testRevokedTargetReplayHasNoUpdates()
await testLegacyGrantMembershipFailsFastOnCustomIntervals()
testMembershipStoreStaticSafetyContract()
testMembershipRevokeReplayStaticContract()
testMembershipGrantDuplicateConflictStaticContract()

console.log('membership grant schedule tests passed (32 cases)')
