export const MEMBERSHIP_GRANT_DAYS = 30
export const MEMBERSHIP_GRANT_DURATION_SECONDS = 30 * 24 * 60 * 60

function parseDate(value, fieldName) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid date.`)
  }
  return date
}

function parseNonNegativeInteger(value, fieldName) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer.`)
  }
  return number
}

function parsePositiveInteger(value, fieldName) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer.`)
  }
  return number
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000)
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function compareGrantIds(left, right) {
  const leftId = String(left.id)
  const rightId = String(right.id)
  if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
    const leftNumber = BigInt(leftId)
    const rightNumber = BigInt(rightId)
    if (leftNumber < rightNumber) return -1
    if (leftNumber > rightNumber) return 1
    return 0
  }
  return leftId.localeCompare(rightId)
}

function compareGrants(left, right) {
  const grantedAtDifference = left.grantedAt.getTime() - right.grantedAt.getTime()
  return grantedAtDifference || compareGrantIds(left, right)
}

function normalizeGrant(source, index) {
  const grant = source && typeof source === 'object' ? source : {}
  const id = String(grant.id ?? '').trim()
  if (!id) throw new TypeError(`grants[${index}].id is required.`)

  const durationSeconds = parseNonNegativeInteger(grant.durationSeconds, `grants[${index}].durationSeconds`)
  const effectiveStartAt = parseDate(grant.effectiveStartAt, `grants[${index}].effectiveStartAt`)
  const effectiveEndAt = parseDate(grant.effectiveEndAt, `grants[${index}].effectiveEndAt`)
  if (effectiveEndAt.getTime() < effectiveStartAt.getTime()) {
    throw new RangeError(`grants[${index}] ends before it starts.`)
  }

  const status = String(grant.status || 'granted').trim().toLowerCase()
  if (status !== 'granted' && status !== 'revoked') {
    throw new TypeError(`grants[${index}].status is invalid.`)
  }

  const consumedSecondsAtRevoke = status === 'revoked'
    ? clamp(parseNonNegativeInteger(grant.consumedSecondsAtRevoke || 0, `grants[${index}].consumedSecondsAtRevoke`), 0, durationSeconds)
    : 0
  const revokedSeconds = status === 'revoked'
    ? clamp(parseNonNegativeInteger(grant.revokedSeconds || 0, `grants[${index}].revokedSeconds`), 0, durationSeconds)
    : 0

  return {
    ...grant,
    id,
    status,
    durationSeconds,
    grantedAt: parseDate(grant.grantedAt, `grants[${index}].grantedAt`),
    effectiveStartAt,
    effectiveEndAt,
    consumedSecondsAtRevoke,
    revokedSeconds
  }
}

function serializeGrant(grant) {
  return {
    ...grant,
    grantedAt: grant.grantedAt.toISOString(),
    effectiveStartAt: grant.effectiveStartAt.toISOString(),
    effectiveEndAt: grant.effectiveEndAt.toISOString()
  }
}

function normalizeGrantList(grants, legacyBaseline) {
  if (!Array.isArray(grants)) throw new TypeError('grants must be an array.')
  const sources = legacyBaseline ? [legacyBaseline, ...grants] : [...grants]
  return sources.map(normalizeGrant).sort(compareGrants)
}

function getLatestEndAt(grants, predicate = () => true) {
  return grants.reduce((latest, grant) => {
    if (!predicate(grant)) return latest
    if (!latest || grant.effectiveEndAt.getTime() > latest.getTime()) {
      return grant.effectiveEndAt
    }
    return latest
  }, null)
}

export function scheduleMembershipGrant(input = {}) {
  const now = parseDate(input.now, 'now')
  const durationSeconds = input.durationSeconds === undefined
    ? MEMBERSHIP_GRANT_DURATION_SECONDS
    : parsePositiveInteger(input.durationSeconds, 'durationSeconds')
  if (durationSeconds !== MEMBERSHIP_GRANT_DURATION_SECONDS) {
    throw new RangeError(`durationSeconds must be ${MEMBERSHIP_GRANT_DURATION_SECONDS}.`)
  }

  const grants = normalizeGrantList(input.grants || [], input.legacyBaseline)
  const snapshotExpireAt = input.membershipExpireAt
    ? parseDate(input.membershipExpireAt, 'membershipExpireAt')
    : null
  const scheduledExpireAt = getLatestEndAt(grants)
  const activeCandidates = [snapshotExpireAt, scheduledExpireAt]
    .filter((date) => date && date.getTime() > now.getTime())
  const effectiveStartAt = activeCandidates.reduce((latest, date) => {
    return !latest || date.getTime() > latest.getTime() ? date : latest
  }, now)
  const effectiveEndAt = addSeconds(effectiveStartAt, durationSeconds)

  return {
    effectiveStartAt: effectiveStartAt.toISOString(),
    effectiveEndAt: effectiveEndAt.toISOString(),
    membershipExpireAt: effectiveEndAt.toISOString(),
    durationSeconds
  }
}

export function revokeMembershipGrantSchedule(input = {}) {
  const now = parseDate(input.now, 'now')
  const targetGrantId = String(input.targetGrantId ?? input.grantId ?? '').trim()
  if (!targetGrantId) throw new TypeError('targetGrantId is required.')

  const grants = normalizeGrantList(input.grants || [], input.legacyBaseline)
  const targetIndex = grants.findIndex((grant) => grant.id === targetGrantId)
  if (targetIndex < 0) throw new RangeError('Target membership grant was not found.')

  const target = grants[targetIndex]
  const membershipExpireAtBeforeDate = getLatestEndAt(grants, (grant) => grant.status === 'granted')
  const membershipExpireAtBefore = membershipExpireAtBeforeDate
    ? membershipExpireAtBeforeDate.toISOString()
    : null

  if (target.status === 'revoked') {
    const replayExpireAtDate = membershipExpireAtBeforeDate || target.effectiveEndAt
    const replayExpireAt = replayExpireAtDate ? replayExpireAtDate.toISOString() : null
    const finalStatus = replayExpireAtDate && replayExpireAtDate.getTime() > now.getTime()
      ? 'active'
      : 'expired'
    return {
      grantId: targetGrantId,
      usedSeconds: target.consumedSecondsAtRevoke,
      revokedSeconds: target.revokedSeconds,
      grants: grants.map(serializeGrant),
      targetUpdate: null,
      rescheduleUpdates: [],
      updates: [],
      affectedGrants: [],
      membershipExpireAtBefore,
      membershipExpireAt: replayExpireAt,
      membershipStatus: finalStatus,
      alreadyRevoked: true,
      shortened: false
    }
  }

  const elapsedSeconds = Math.floor((now.getTime() - target.effectiveStartAt.getTime()) / 1000)
  const usedSeconds = clamp(elapsedSeconds, 0, target.durationSeconds)
  const revokedSeconds = clamp(target.durationSeconds - usedSeconds, 0, target.durationSeconds)
  const updated = grants.map((grant) => ({ ...grant }))
  const affectedGrants = []

  updated[targetIndex].status = 'revoked'
  updated[targetIndex].consumedSecondsAtRevoke = usedSeconds
  updated[targetIndex].revokedSeconds = revokedSeconds
  updated[targetIndex].effectiveEndAt = addSeconds(updated[targetIndex].effectiveStartAt, usedSeconds)
  const targetUpdate = updated[targetIndex]
  affectedGrants.push(targetUpdate)

  let cursor = targetUpdate.effectiveEndAt
  const rescheduleUpdates = []
  for (let index = targetIndex + 1; index < updated.length; index += 1) {
    const grant = updated[index]
    // Historical revoked rows are immutable audit records. They neither move nor consume
    // future scheduling cursor when a different active grant is revoked later.
    if (grant.status === 'revoked') continue
    const retainedSeconds = grant.durationSeconds
    grant.effectiveStartAt = new Date(cursor.getTime())
    grant.effectiveEndAt = addSeconds(grant.effectiveStartAt, retainedSeconds)
    cursor = grant.effectiveEndAt
    rescheduleUpdates.push(grant)
    affectedGrants.push(grant)
  }

  const membershipExpireAtAfterDate = getLatestEndAt(
    updated,
    (grant) => grant.status === 'granted' || grant.id === targetGrantId
  )
  const membershipExpireAt = membershipExpireAtAfterDate
    ? membershipExpireAtAfterDate.toISOString()
    : null
  const membershipStatus = membershipExpireAtAfterDate && membershipExpireAtAfterDate.getTime() > now.getTime()
    ? 'active'
    : 'expired'

  return {
    grantId: targetGrantId,
    usedSeconds,
    revokedSeconds,
    grants: updated.map(serializeGrant),
    targetUpdate: serializeGrant(targetUpdate),
    rescheduleUpdates: rescheduleUpdates.map(serializeGrant),
    updates: affectedGrants.map(serializeGrant),
    affectedGrants: affectedGrants.map(serializeGrant),
    membershipExpireAtBefore,
    membershipExpireAt,
    membershipStatus,
    alreadyRevoked: false,
    shortened: Boolean(
      membershipExpireAtBeforeDate &&
      membershipExpireAtAfterDate &&
      membershipExpireAtAfterDate.getTime() < membershipExpireAtBeforeDate.getTime()
    )
  }
}
