-- Book-benefit redemption foundation: stable campaign phone identity and five MVP tables.
-- This migration is for human review and controlled MySQL 8.0.46 execution only.
-- Verify a current backup and run the read-only preflight checks before execution.

-- Compatibility and relationship strategy:
-- - Existing user/entitlement migrations use BIGINT UNSIGNED service-layer user references.
-- - Production users.id is recorded as signed BIGINT, so no user foreign key is declared.
-- - membership_grants.id is BIGINT UNSIGNED and entitlement_transactions.transaction_id is VARCHAR(64).
-- - Administrator/operator identifiers use VARCHAR(191), matching existing entitlement audit fields.
-- - All relationships remain indexed service-layer references until production types and lifecycle rules align.

-- Repeat-execution boundary for the existing table alteration:
-- MySQL 8.0.46 does not provide ADD COLUMN IF NOT EXISTS in ALTER TABLE syntax.
-- Before running the ALTER at the end of this file, execute this read-only preflight query:
-- SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
--   FROM INFORMATION_SCHEMA.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME = 'user_phone_bindings'
--    AND COLUMN_NAME IN ('campaign_phone_identity_hash', 'campaign_phone_hash_version');
-- Also verify the index name with:
-- SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
--   FROM INFORMATION_SCHEMA.STATISTICS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME = 'user_phone_bindings'
--    AND INDEX_NAME = 'idx_user_phone_bindings_campaign_identity';
-- After migration, this index must report NON_UNIQUE=1. It is a lookup cache index, not a uniqueness boundary.
-- Execute the ALTER only when both columns and the index are absent. If all are already present with
-- the exact definitions below, skip the ALTER. If the result is partial or different, stop for review.
-- CREATE TABLE IF NOT EXISTS statements below are repeatable but do not repair a mismatched existing table.

CREATE TABLE IF NOT EXISTS `book_benefit_campaigns` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Campaign primary key.',
  `campaign_key` VARCHAR(64) NOT NULL COMMENT 'Stable globally unique campaign key.',
  `name` VARCHAR(191) NOT NULL COMMENT 'Human-readable campaign name.',
  `status` ENUM('draft', 'active', 'paused', 'ended') NOT NULL DEFAULT 'draft' COMMENT 'Campaign lifecycle.',
  `benefit_days` INT UNSIGNED NOT NULL DEFAULT 30 COMMENT 'Fixed membership duration for this campaign version.',
  `starts_at` DATETIME NULL DEFAULT NULL COMMENT 'Optional campaign start time in UTC.',
  `ends_at` DATETIME NULL DEFAULT NULL COMMENT 'Optional campaign end time in UTC.',
  `created_by` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Stable operator identifier; never an admin token.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_book_benefit_campaigns_key` (`campaign_key`),
  KEY `idx_book_benefit_campaigns_status_time` (`status`, `starts_at`, `ends_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Book-purchase benefit campaign definitions.';

CREATE TABLE IF NOT EXISTS `book_benefit_issuances` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Issuance primary key.',
  `issuance_no` VARCHAR(64) NOT NULL COMMENT 'Globally unique public-safe issuance identifier.',
  `campaign_id` BIGINT UNSIGNED NOT NULL COMMENT 'book_benefit_campaigns.id service-layer reference.',
  `order_claim_type` ENUM('standard', 'manual_exception') NOT NULL COMMENT 'Reviewed standard order or manual exception.',
  `approved_order_claim_hash` BINARY(32) NULL DEFAULT NULL COMMENT 'Approved order claim HMAC; temporarily null only while a manual-exception issuance is created in one transaction.',
  `order_claim_hash_version` VARCHAR(16) NULL DEFAULT NULL COMMENT 'Order claim hash version.',
  `order_channel` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Normalized non-secret channel identifier; no order number is stored.',
  `status` ENUM('approved', 'cancelled') NOT NULL DEFAULT 'approved' COMMENT 'Approved issuance lifecycle.',
  `reviewed_by` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Stable operator identifier; never an admin token.',
  `review_reason_code` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Non-sensitive structured review reason.',
  `reviewed_at` DATETIME NULL DEFAULT NULL,
  `create_idempotency_key` VARCHAR(191) NOT NULL COMMENT 'Globally unique unassigned-code issuance idempotency key.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_book_benefit_issuances_no` (`issuance_no`),
  UNIQUE KEY `uk_book_benefit_issuances_campaign_order` (`campaign_id`, `approved_order_claim_hash`),
  UNIQUE KEY `uk_book_benefit_issuances_idempotency` (`create_idempotency_key`),
  KEY `idx_book_benefit_issuances_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Administrator-reviewed issuance chains for unassigned book-benefit bearer codes.';

CREATE TABLE IF NOT EXISTS `book_benefit_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Redemption code record primary key.',
  `issuance_id` BIGINT UNSIGNED NOT NULL COMMENT 'book_benefit_issuances.id service-layer reference.',
  `generation_no` INT UNSIGNED NOT NULL COMMENT 'Monotonic generation number within one issuance.',
  `code_hash` BINARY(32) NOT NULL COMMENT 'One-way redemption-code HMAC; plaintext or recoverable code is never stored.',
  `code_hash_version` VARCHAR(16) NOT NULL COMMENT 'Future REDEMPTION_CODE_HASH_SECRET version marker.',
  `status` ENUM('issued', 'redeemed', 'voided', 'expired') NOT NULL DEFAULT 'issued' COMMENT 'Code lifecycle.',
  `active_issuance_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'issued' THEN `issuance_id` ELSE NULL END
  ) VIRTUAL COMMENT 'Unique only while issued; NULL lifecycle rows do not conflict in MySQL unique indexes.',
  `issue_idempotency_key` VARCHAR(191) NOT NULL COMMENT 'Globally unique issuance idempotency key.',
  `replacement_code_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Replacement code service-layer reference after this code is voided.',
  `issued_by` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Stable operator identifier; never an admin token.',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL DEFAULT NULL,
  `redeemed_at` DATETIME NULL DEFAULT NULL,
  `voided_at` DATETIME NULL DEFAULT NULL,
  `voided_by` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Stable operator identifier; never an admin token.',
  `void_reason_code` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Non-sensitive structured void reason.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_book_benefit_codes_hash` (`code_hash`),
  UNIQUE KEY `uk_book_benefit_codes_issuance_generation` (`issuance_id`, `generation_no`),
  UNIQUE KEY `uk_book_benefit_codes_issue_idempotency` (`issue_idempotency_key`),
  UNIQUE KEY `uk_book_benefit_codes_replacement` (`replacement_code_id`),
  UNIQUE KEY `uk_book_benefit_codes_active_issuance` (`active_issuance_id`),
  KEY `idx_book_benefit_codes_issuance_status` (`issuance_id`, `status`),
  KEY `idx_book_benefit_codes_status_expires` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Hashed book-benefit redemption codes without plaintext or recoverable code material.';

CREATE TABLE IF NOT EXISTS `book_benefit_redemptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Successful redemption record primary key.',
  `redemption_id` VARCHAR(64) NOT NULL COMMENT 'Globally unique redemption business identifier.',
  `code_id` BIGINT UNSIGNED NOT NULL COMMENT 'book_benefit_codes.id service-layer reference.',
  `campaign_id` BIGINT UNSIGNED NOT NULL COMMENT 'book_benefit_campaigns.id service-layer reference.',
  `issuance_id` BIGINT UNSIGNED NOT NULL COMMENT 'book_benefit_issuances.id service-layer reference.',
  `redeemer_user_id` BIGINT UNSIGNED NOT NULL COMMENT 'users.id service-layer reference; no foreign key until signedness aligns.',
  `redeemer_phone_identity_hash` BINARY(32) NOT NULL COMMENT 'Stable campaign phone identity HMAC; never phone plaintext.',
  `redeemer_phone_hash_version` VARCHAR(16) NOT NULL COMMENT 'Campaign phone identity hash version.',
  `idempotency_key` VARCHAR(191) NOT NULL COMMENT 'Globally unique redemption idempotency key.',
  `membership_grant_id` BIGINT UNSIGNED NOT NULL COMMENT 'membership_grants.id service-layer reference.',
  `entitlement_transaction_id` VARCHAR(64) NOT NULL COMMENT 'entitlement_transactions.transaction_id service-layer reference.',
  `redeemed_at` DATETIME NOT NULL COMMENT 'Successful redemption time in UTC.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_book_benefit_redemptions_redemption_id` (`redemption_id`),
  UNIQUE KEY `uk_book_benefit_redemptions_code` (`code_id`),
  UNIQUE KEY `uk_book_benefit_redemptions_campaign_user` (`campaign_id`, `redeemer_user_id`),
  UNIQUE KEY `uk_book_benefit_redemptions_campaign_phone` (`campaign_id`, `redeemer_phone_identity_hash`),
  UNIQUE KEY `uk_book_benefit_redemptions_idempotency` (`idempotency_key`),
  UNIQUE KEY `uk_book_benefit_redemptions_membership_grant` (`membership_grant_id`),
  UNIQUE KEY `uk_book_benefit_redemptions_entitlement_transaction` (`entitlement_transaction_id`),
  KEY `idx_book_benefit_redemptions_campaign_created` (`campaign_id`, `created_at`),
  KEY `idx_book_benefit_redemptions_issuance` (`issuance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='One row per successful book-benefit redemption and resulting entitlement references.';

CREATE TABLE IF NOT EXISTS `book_benefit_audit_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Audit event primary key.',
  `event_id` VARCHAR(64) NOT NULL COMMENT 'Globally unique audit event identifier.',
  `campaign_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Optional campaign service-layer reference.',
  `issuance_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Optional issuance service-layer reference.',
  `code_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Optional code record service-layer reference; never code hash or plaintext.',
  `redemption_record_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Optional successful redemption row service-layer reference.',
  `event_type` VARCHAR(64) NOT NULL COMMENT 'Stable event category.',
  `actor_type` VARCHAR(32) NOT NULL COMMENT 'Actor category such as system, admin, or customer_service.',
  `actor_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Stable operator identifier; never a token.',
  `result` VARCHAR(32) NOT NULL COMMENT 'Structured result such as succeeded, rejected, or failed.',
  `reason_code` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Non-sensitive structured reason only.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_book_benefit_audit_events_event_id` (`event_id`),
  KEY `idx_book_benefit_audit_events_campaign_created` (`campaign_id`, `created_at`),
  KEY `idx_book_benefit_audit_events_issuance_created` (`issuance_id`, `created_at`),
  KEY `idx_book_benefit_audit_events_code_created` (`code_id`, `created_at`),
  KEY `idx_book_benefit_audit_events_actor_created` (`actor_type`, `actor_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Non-sensitive audit trail; excludes phone/order/code hashes, full order numbers, evidence, chat, and tokens.';

ALTER TABLE `user_phone_bindings`
  ADD COLUMN `campaign_phone_identity_hash` BINARY(32) NULL DEFAULT NULL COMMENT 'Stable campaign phone identity HMAC; populated only after verified phone input.',
  ADD COLUMN `campaign_phone_hash_version` VARCHAR(16) NULL DEFAULT NULL COMMENT 'Campaign phone identity hash version, initially v1.',
  ADD KEY `idx_user_phone_bindings_campaign_identity` (`campaign_phone_identity_hash`);
