-- Book-benefit issuance review structure extension for MySQL 8.0.46.
-- This migration contains two non-transactional DDL statements and must be run only after
-- a current backup and the read-only preflight below have confirmed an exact known state.

-- Read-only preflight: inspect every column whose definition determines whether 008 is safe.
-- SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
--   FROM INFORMATION_SCHEMA.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND (
--      (TABLE_NAME = 'book_benefit_campaigns'
--       AND COLUMN_NAME IN ('rules_version'))
--      OR
--      (TABLE_NAME = 'book_benefit_issuances'
--       AND COLUMN_NAME IN (
--         'qualification_rules_version', 'seller_verification_code',
--         'customer_service_channel', 'status', 'order_claim_type'
--       ))
--    )
--  ORDER BY TABLE_NAME, COLUMN_NAME;

-- Read-only incompatibility check: the retired table must not exist in this never-deployed model.
-- SELECT TABLE_NAME
--   FROM INFORMATION_SCHEMA.TABLES
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME = 'book_benefit_applications';
-- If this query returns a row, STOP. Do not execute 008 or create compatibility columns.

-- Read-only preflight: inspect the complete definition and order of the new lookup index.
-- SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
--   FROM INFORMATION_SCHEMA.STATISTICS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME = 'book_benefit_issuances'
--    AND INDEX_NAME = 'idx_book_benefit_issuances_campaign_status_created'
--  ORDER BY SEQ_IN_INDEX;

-- Preflight decisions (do not infer success from the migration command exit code alone):
-- EXACT_007 -> EXECUTE 008 only when rules_version and all three issuance review columns
-- are absent; the new index is absent; status is exactly
-- enum('approved','cancelled') NOT NULL DEFAULT 'approved'; and order_claim_type is exactly
-- enum('standard','manual_exception') NOT NULL with no default.
-- EXACT_008 -> SKIP 008 only when all four new columns, the two existing ENUM definitions,
-- NULL/default attributes, and the four-column NON_UNIQUE=1 index exactly match this file.
-- PARTIAL_OR_MISMATCH -> STOP when either ALTER appears complete without the other, only some
-- fields exist, an ENUM differs, an index name/column/order/uniqueness differs, or any field
-- type, NULL attribute, or default differs. Never rerun the full migration to repair that state.
-- If the campaigns ALTER succeeds and the issuances ALTER fails, report the resulting partial
-- state and stop. MySQL DDL has already committed and must not be presented as rolled back.

ALTER TABLE `book_benefit_campaigns`
  ADD COLUMN `rules_version` VARCHAR(32) NULL DEFAULT NULL COMMENT 'Published structured campaign rules version.';

ALTER TABLE `book_benefit_issuances`
  ADD COLUMN `qualification_rules_version` VARCHAR(32) NULL DEFAULT NULL COMMENT 'Rules version used when the administrator approved this issuance.',
  ADD COLUMN `seller_verification_code` VARCHAR(32) NULL DEFAULT NULL COMMENT 'Structured seller verification result code.',
  ADD COLUMN `customer_service_channel` VARCHAR(32) NULL DEFAULT NULL COMMENT 'Structured customer-service channel code.',
  ADD KEY `idx_book_benefit_issuances_campaign_status_created` (`campaign_id`, `status`, `created_at`, `id`);
