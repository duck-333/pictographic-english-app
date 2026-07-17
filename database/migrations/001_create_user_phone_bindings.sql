-- Module 1.1 migration plan: create user_phone_bindings.
-- This file is for human review and controlled execution only.
-- Do not execute against production before backup verification and rollback approval.

-- MySQL compatibility:
-- - Uses InnoDB with utf8mb4 / utf8mb4_unicode_ci explicitly.
-- - Avoids CHECK constraints to stay compatible with older MySQL 5.7 style deployments.
-- - Uses CREATE TABLE IF NOT EXISTS for repeatable local review.
--
-- Foreign key strategy:
-- - No foreign key is declared in this migration.
-- - Reason: the current project has no unified documented foreign key policy, and the
--   exact production users.id column type is not captured in repository schema files.
-- - The service layer must still treat user_phone_bindings.user_id as users.id.
-- - A future migration may add a foreign key after production schema inspection.
--
-- IF EXISTS / IF NOT EXISTS strategy:
-- - Up uses CREATE TABLE IF NOT EXISTS to avoid accidental failure during local review.
-- - Rollback uses DROP TABLE IF EXISTS, but is intentionally left commented below.

CREATE TABLE IF NOT EXISTS `user_phone_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key for the phone binding row.',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Project user identity. References users.id at the service layer.',
  `phone_hash` CHAR(64) NOT NULL COMMENT 'HMAC-SHA256(normalized_phone, PHONE_HASH_SECRET). Never store phone plaintext.',
  `phone_masked` VARCHAR(32) NOT NULL COMMENT 'Display-only masked phone, for example 138****8000.',
  `hash_version` VARCHAR(32) NOT NULL DEFAULT 'v1' COMMENT 'Hash secret/version marker for future key rotation.',
  `country_code` VARCHAR(8) NOT NULL DEFAULT '86' COMMENT 'Normalized phone country code without plus sign.',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'Binding lifecycle status. MVP uses active; future may use unbound.',
  `bound_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'First time this phone binding became active.',
  `unbound_at` DATETIME NULL DEFAULT NULL COMMENT 'Set only by a future confirmed unbind flow.',
  `verified_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'First successful phone verification time.',
  `last_verified_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Latest successful phone verification time.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Row creation time.',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Row update time.',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_phone_bindings_phone_hash` (`phone_hash`),
  KEY `idx_user_phone_bindings_user_id` (`user_id`),
  KEY `idx_user_phone_bindings_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Phone identity bindings for users.id. Stores hash and masked value only.';

-- Rollback plan:
-- 1. Stop code paths that write or read user_phone_bindings.
-- 2. Export user_phone_bindings for audit if any environment has executed this migration.
-- 3. Confirm human approval for destructive rollback.
-- 4. Execute the statement below manually if rollback is approved.
--
-- DROP TABLE IF EXISTS `user_phone_bindings`;
