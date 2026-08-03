-- Stage 1 membership grant foundation: create membership_grants.
-- This migration is for human review and controlled execution only.
-- Do not execute against production before read-only schema verification, backup verification, and rollback approval.

-- Production compatibility prerequisite:
-- - user_id follows migrations 004/005 as BIGINT UNSIGNED.
-- - The complete production users DDL is not stored in this repository.
-- - Before execution, verify that users.id, user_entitlements.user_id, and this user_id have identical types.
-- - No users foreign key is declared until that production type and existing data are verified.
-- - All DATETIME values are application-supplied absolute UTC time points, following the existing entitlement convention.
-- - New product grants always use days_granted=30 and duration_seconds=2592000 (30x24 hours, not a calendar month).
-- - legacy_membership rows may preserve a shorter or longer audited historical interval when the old snapshot is imported.

CREATE TABLE IF NOT EXISTS `membership_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key and FIFO tie-breaker after granted_at.',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Project user identity; references users.id at the service layer.',
  `source_type` VARCHAR(64) NOT NULL COMMENT 'Stable source category: redemption_code, admin_gift, book_order, wechat_order, or legacy_membership.',
  `source_id` VARCHAR(191) NOT NULL COMMENT 'Stable source business id. Never store redemption-code plaintext here.',
  `redemption_code_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Future redemption_codes.id reference; nullable until that subsystem exists.',
  `days_granted` INT UNSIGNED NOT NULL COMMENT '30 for new product grants; legacy imports reflect their preserved audited interval.',
  `duration_seconds` BIGINT UNSIGNED NOT NULL COMMENT '2592000 for new grants; legacy imports may preserve a different existing snapshot interval.',
  `status` ENUM('granted', 'revoked') NOT NULL DEFAULT 'granted' COMMENT 'Stage 1 membership grant lifecycle.',
  `granted_at` DATETIME NOT NULL COMMENT 'Absolute UTC grant ordering time. FIFO order is granted_at ASC, id ASC.',
  `effective_start_at` DATETIME NOT NULL COMMENT 'Absolute UTC start of this scheduled grant interval.',
  `effective_end_at` DATETIME NOT NULL COMMENT 'Absolute UTC end of this scheduled grant interval.',
  `consumed_seconds_at_revoke` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Already-used seconds retained when the grant is revoked.',
  `revoked_seconds` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Unused seconds removed when the grant is revoked.',
  `revoked_at` DATETIME NULL DEFAULT NULL COMMENT 'Absolute UTC revocation time.',
  `revoked_by` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Stable operator id or operator type when no id is available.',
  `revoke_reason` VARCHAR(512) NULL DEFAULT NULL COMMENT 'Required human-readable revocation reason.',
  `idempotency_key` VARCHAR(191) NOT NULL COMMENT 'Required unique key preventing duplicate grant creation.',
  `grant_transaction_id` VARCHAR(64) NULL DEFAULT NULL COMMENT 'entitlement_transactions.transaction_id for the grant ledger row.',
  `revoke_transaction_id` VARCHAR(64) NULL DEFAULT NULL COMMENT 'entitlement_transactions.transaction_id for the revoke ledger row.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_membership_grants_idempotency` (`idempotency_key`),
  UNIQUE KEY `uk_membership_grants_source` (`source_type`, `source_id`),
  UNIQUE KEY `uk_membership_grants_redemption_code` (`redemption_code_id`),
  KEY `idx_membership_grants_user_fifo` (`user_id`, `granted_at`, `id`),
  KEY `idx_membership_grants_user_end` (`user_id`, `effective_end_at`),
  KEY `idx_membership_grants_user_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Auditable FIFO schedule of membership duration grants. Entitlement transactions remain the fact ledger.';

-- MySQL UNIQUE indexes allow multiple NULL values, so future non-redemption sources can all leave
-- redemption_code_id NULL without colliding. A populated redemption_code_id can belong to only one grant.

-- Rollback is intentionally not executable in this reviewed migration file.
-- If rollback is approved, stop all membership-grant writers, export the table for audit, and remove
-- one explicitly confirmed table using the project destructive-action policy.
