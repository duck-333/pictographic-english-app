-- Phase 2.3-A user entitlement migration plan: create entitlement_transactions.
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
-- - The service layer must treat entitlement_transactions.user_id as users.id.
-- - grant_transaction_id points to entitlement_transactions.id at the service layer.
--
-- IF EXISTS / IF NOT EXISTS strategy:
-- - Up uses CREATE TABLE IF NOT EXISTS to avoid accidental failure during local review.
-- - Rollback uses DROP TABLE IF EXISTS, but is intentionally left commented below.

CREATE TABLE IF NOT EXISTS `entitlement_transactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key for the entitlement transaction row.',
  `transaction_id` VARCHAR(64) NOT NULL COMMENT 'Globally unique business transaction id for audit and external references.',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Project user identity. References users.id at the service layer.',
  `transaction_type` VARCHAR(64) NOT NULL COMMENT 'Transaction type, for example REGISTER_BONUS, CONTENT_ACCESS, SHARE_REWARD, ADMIN_GRANT, TAOBAO_BOOK_MEMBERSHIP_GRANT, MEMBERSHIP_ACTIVATED, REFUND_RESTORE, or EXPIRE_DEDUCT.',
  `amount` INT NOT NULL COMMENT 'Quota delta for this transaction. Positive grants quota, negative consumes quota, zero may record membership-only changes.',
  `balance_after` INT UNSIGNED NOT NULL COMMENT 'User quota balance after this transaction is applied.',
  `source` VARCHAR(64) NOT NULL COMMENT 'Source category, for example registration, full_content_access, share, admin, taobao_book, order, payment, or refund.',
  `source_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Optional source record id, such as order id, invitation id, campaign id, or admin operation id.',
  `expires_at` DATETIME NULL DEFAULT NULL COMMENT 'Expiry time for quota grants. Consumption and membership-only rows may leave this null.',
  `grant_transaction_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Grant transaction consumed by this row when a simple one-grant allocation is used.',
  `root_learning_object_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Root Learning Object actively entered by the user for complete-content access.',
  `current_learning_object_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Current Learning Object shown or expanded during the access.',
  `access_context_json` JSON NULL COMMENT 'Learning Object access context, including root/current/relation/access_reason when applicable.',
  `idempotency_key` VARCHAR(191) NOT NULL COMMENT 'Required idempotency key to prevent duplicate grants, duplicate deductions, or repeated callback handling.',
  `operator_type` VARCHAR(32) NOT NULL DEFAULT 'system' COMMENT 'Operator category, for example system, admin, payment_callback, or customer_service.',
  `operator_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Operator identifier when available, such as admin id, system task id, or payment callback source.',
  `reason` VARCHAR(512) NULL DEFAULT NULL COMMENT 'Human-readable reason or admin operation note.',
  `metadata_json` JSON NULL COMMENT 'Whitelisted extension metadata. Do not store tokens, openid, plaintext phone numbers, or other sensitive secrets.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Transaction creation time. Ledger rows should be treated as append-only.',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_entitlement_transactions_transaction_id` (`transaction_id`),
  UNIQUE KEY `uk_entitlement_transactions_idempotency_key` (`idempotency_key`),
  KEY `idx_entitlement_transactions_user_created` (`user_id`, `created_at`),
  KEY `idx_entitlement_transactions_user_type_created` (`user_id`, `transaction_type`, `created_at`),
  KEY `idx_entitlement_transactions_user_expires` (`user_id`, `expires_at`),
  KEY `idx_entitlement_transactions_source` (`source`, `source_id`),
  KEY `idx_entitlement_transactions_root_object` (`root_learning_object_id`),
  KEY `idx_entitlement_transactions_grant_transaction` (`grant_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Append-only entitlement fact ledger for grants, consumption, membership changes, and operational adjustments.';

-- Rollback plan:
-- 1. Stop code paths that write or read entitlement_transactions.
-- 2. Export entitlement_transactions for audit if any environment has executed this migration.
-- 3. Confirm human approval for destructive rollback.
-- 4. Execute the statement below manually if rollback is approved.
--
-- DROP TABLE IF EXISTS `entitlement_transactions`;
