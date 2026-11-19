import { lockDatabaseUsersInTransaction, withDatabasePoolTransaction } from './database-transaction-context.mjs'

// Shared by post-registration delivery and recovery; no client claim endpoint.
export function createInvitationRewardService(options = {}) {
  const pool = () => options.getPool ? options.getPool() : options.pool
  const entitlementStore = options.entitlementStore
  let timer = null
  let running = false
  let stopped = true
  const batchSize = 20
  const intervalMs = 60000

  async function deliver(invitationId) {
    try {
      return await withDatabasePoolTransaction(pool(), async context => {
        const [hints] = await context.execute(`SELECT inviter_user_id FROM invitation_registration_relations
          WHERE invitation_id=? LIMIT 1`, [invitationId])
        if (!hints.length) return { granted: false }
        await lockDatabaseUsersInTransaction(context, [String(hints[0].inviter_user_id)])
        const [relations] = await context.execute(`SELECT *,
          (next_retry_at IS NULL OR next_retry_at<=UTC_TIMESTAMP(3)) AS retry_due FROM invitation_registration_relations
          WHERE invitation_id=? LIMIT 1 FOR UPDATE`, [invitationId])
        const row = relations[0]
        if (row.reward_status === 'REWARD_GRANTED') return { granted: true, idempotent: true }
        if (row.reward_status !== 'REWARD_PENDING') return { granted: false }
        if (!Number(row.retry_due)) return { granted: false }
        const reward = await entitlementStore.grantInvitationRewardInTransaction(context, {
          userId: String(row.inviter_user_id), invitationId: row.invitation_id
        })
        const tx = reward.transaction
        const [updated] = await context.execute(`UPDATE invitation_registration_relations
          SET reward_status='REWARD_GRANTED', reward_granted_at=?, reward_expires_at=?,
            entitlement_transaction_id=?, retry_count=0, last_error_code=NULL, next_retry_at=NULL
          WHERE invitation_id=? AND reward_status='REWARD_PENDING'`,
        [new Date(tx.createdAt), new Date(tx.expiresAt), tx.transactionId, invitationId])
        if (updated.affectedRows !== 1) throw new Error('Invitation reward update failed.')
        return { granted: true, idempotent: reward.idempotent === true }
      }, { maximumAttempts: 3 })
    } catch (error) {
      // Separate transaction, only after grant rollback. Ambiguous successful commits
      // cannot be changed back to pending. Failed delivery never releases the slot.
      try {
        await pool().execute(`UPDATE invitation_registration_relations
          SET last_error_code='INVITATION_REWARD_FAILED',
            next_retry_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL LEAST(3600, 60 * POW(2, LEAST(retry_count,6))) SECOND),
            retry_count=retry_count+1
          WHERE invitation_id=? AND reward_status='REWARD_PENDING'`, [invitationId])
      } catch {
        console.warn('invitation-retry-schedule failed code=INVITATION_REWARD_FAILED')
      }
      throw error
    }
  }

  async function runBatch() {
    if (running) return
    running = true
    try {
      const [pending] = await pool().execute(`SELECT invitation_id FROM invitation_registration_relations
        WHERE reward_status='REWARD_PENDING' AND (next_retry_at IS NULL OR next_retry_at<=UTC_TIMESTAMP(3))
        ORDER BY next_retry_at, id LIMIT ${batchSize}`)
      for (const row of pending) {
        try { await deliver(row.invitation_id) } catch {
          console.warn('invitation-recovery failed code=INVITATION_REWARD_FAILED')
        }
      }
    } catch {
      console.warn('invitation-recovery unavailable code=INVITATION_REWARD_FAILED')
    } finally { running = false }
  }

  async function tick() {
    await runBatch()
    if (!stopped) {
      timer = setTimeout(tick, intervalMs)
      timer.unref?.()
    }
  }
  function start() {
    if (!stopped) return
    stopped = false
    timer = setTimeout(tick, 0)
    timer.unref?.()
  }
  function stop() { stopped = true; clearTimeout(timer); timer = null }
  return { deliver, runBatch, start, stop }
}
