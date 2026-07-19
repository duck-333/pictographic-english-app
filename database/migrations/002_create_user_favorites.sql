-- Phase 1 user data migration plan: create user_favorites.
-- This file is for human review and controlled execution only.
-- Do not execute against production before backup verification and rollback approval.

-- MySQL compatibility:
-- - Uses InnoDB with utf8mb4 / utf8mb4_unicode_ci explicitly.
-- - Avoids CHECK constraints to stay compatible with older MySQL 5.7 style deployments.
-- - Uses CREATE TABLE IF NOT EXISTS for repeatable local review.
--
-- Foreign key strategy:
-- - No foreign key is declared in this migration.
-- - Reason: current user binding migrations also keep users.id relations at the service layer.
-- - The service layer must treat user_favorites.user_id as users.id.
--
-- IF EXISTS / IF NOT EXISTS strategy:
-- - Up uses CREATE TABLE IF NOT EXISTS to avoid accidental failure during local review.
-- - Rollback uses DROP TABLE IF EXISTS, but is intentionally left commented below.

CREATE TABLE IF NOT EXISTS `user_favorites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key for the favorite row.',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Project user identity. References users.id at the service layer.',
  `word_id` VARCHAR(191) NOT NULL COMMENT 'Word identifier from the existing word repository.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Favorite creation time.',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_favorites_user_word` (`user_id`, `word_id`),
  KEY `idx_user_favorites_user_created` (`user_id`, `created_at`),
  KEY `idx_user_favorites_word_id` (`word_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Cloud favorites for users.id. Stores word identifiers only.';

-- Rollback plan:
-- 1. Stop code paths that write or read user_favorites.
-- 2. Export user_favorites for audit if any environment has executed this migration.
-- 3. Confirm human approval for destructive rollback.
-- 4. Execute the statement below manually if rollback is approved.
--
-- DROP TABLE IF EXISTS `user_favorites`;
