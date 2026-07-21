-- Phase 2.3-A user entitlement migration plan: create user_entitlements.
-- This file is for human review and controlled execution only.
-- Do not execute against production before backup verification and rollback approval.

-- MySQL compatibility:
-- - Uses InnoDB with utf8mb4 / utf8mb4_unicode_ci explicitly.
-- - Avoids CHECK constraints to stay compatible with older MySQL 5.7 style deployments.
-- - Uses CREATE TABLE IF NOT EXISTS for repeatable local review.
--
-- Foreign key strategy:
-- - No foreign key is declared in this migration.
-- - Reason: current user data migrations keep users.id relations at the service layer.
-- - The service layer must treat user_entitlements.user_id as users.id.
-- - last_transaction_id points to entitlement_transactions.id at the service layer.
--
-- IF EXISTS / IF NOT EXISTS strategy:
-- - Up uses CREATE TABLE IF NOT EXISTS to avoid accidental failure during local review.
-- - Rollback uses DROP TABLE IF EXISTS, but is intentionally left commented below.

CREATE TABLE IF NOT EXISTS `user_entitlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key for the entitlement snapshot row.',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Project user identity. References users.id at the service layer.',
  `quota_balance` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Current available non-membership complete-content access quota. Snapshot only, not the fact source.',
  `quota_total_granted` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total quota granted to this user from registration, share, admin, refund, or future sources.',
  `quota_total_consumed` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total quota consumed by complete-content Learning Object access.',
  `quota_total_expired` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total quota expired from time-limited grants.',
  `membership_type` VARCHAR(32) NOT NULL DEFAULT 'none' COMMENT 'Current membership type. MVP values may include none or monthly.',
  `membership_status` VARCHAR(32) NOT NULL DEFAULT 'none' COMMENT 'Current membership status. MVP values may include none, active, expired, or cancelled.',
  `membership_started_at` DATETIME NULL DEFAULT NULL COMMENT 'Current membership start time, if any.',
  `membership_expire_at` DATETIME NULL DEFAULT NULL COMMENT 'Current membership expiry time, if any.',
  `last_transaction_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Latest entitlement_transactions.id that changed this snapshot.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Snapshot row creation time.',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Snapshot row update time.',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_entitlements_user_id` (`user_id`),
  KEY `idx_user_entitlements_membership_status_expire` (`membership_status`, `membership_expire_at`),
  KEY `idx_user_entitlements_last_transaction` (`last_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Current entitlement snapshot for users.id. The fact source is entitlement_transactions.';

-- Rollback plan:
-- 1. Stop code paths that write or read user_entitlements.
-- 2. Export user_entitlements for audit if any environment has executed this migration.
-- 3. Confirm human approval for destructive rollback.
-- 4. Execute the statement below manually if rollback is approved.
--
-- DROP TABLE IF EXISTS `user_entitlements`;
