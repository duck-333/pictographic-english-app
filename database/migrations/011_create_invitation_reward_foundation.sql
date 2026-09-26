-- Invitation reward batch 1 foundation. Isolated-MySQL review only; never auto-run in production.
-- This migration intentionally does not alter existing entitlement tables.
-- REGISTER_BONUS keeps migration 005's DATETIME (second precision); invitation tables use DATETIME(3).

CREATE TABLE IF NOT EXISTS `invitation_share_credentials` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `credential_id` CHAR(36) NOT NULL,
  `inviter_user_id` BIGINT UNSIGNED NOT NULL,
  `token_digest` BINARY(32) NOT NULL COMMENT 'HMAC-SHA-256 only; plaintext token is never stored.',
  `token_key_version` VARCHAR(16) NOT NULL,
  `credential_status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitation_share_credential_id` (`credential_id`),
  UNIQUE KEY `uk_invitation_share_token_digest` (`token_digest`),
  KEY `idx_invitation_share_inviter_status` (`inviter_user_id`, `credential_status`, `expires_at`),
  KEY `idx_invitation_share_expiry` (`credential_status`, `expires_at`),
  CONSTRAINT `chk_invitation_share_expiry` CHECK (`expires_at` = DATE_ADD(`created_at`, INTERVAL 7 DAY)),
  CONSTRAINT `chk_invitation_share_revocation` CHECK (
    (`credential_status` = 'ACTIVE' AND `revoked_at` IS NULL) OR
    (`credential_status` = 'REVOKED' AND `revoked_at` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invitation_registration_relations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invitation_id` CHAR(36) NOT NULL COMMENT 'Stable reward idempotency source.',
  `share_credential_id` BIGINT UNSIGNED NOT NULL,
  `inviter_user_id` BIGINT UNSIGNED NOT NULL,
  `invitee_user_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `candidate_subject_digest` BINARY(32) NOT NULL COMMENT 'HMAC of a server-trusted subject.',
  `candidate_receipt_digest` BINARY(32) NOT NULL COMMENT 'HMAC only; plaintext receipt is never stored.',
  `candidate_key_version` VARCHAR(16) NOT NULL,
  `relation_status` ENUM('CANDIDATE', 'SUPERSEDED', 'FINAL') NOT NULL DEFAULT 'CANDIDATE',
  `qualification_status` ENUM('UNRESOLVED', 'ELIGIBLE', 'INELIGIBLE') NOT NULL DEFAULT 'UNRESOLVED',
  `reward_status` ENUM('NOT_RESERVED', 'REWARD_PENDING', 'REWARD_GRANTED', 'NO_REWARD', 'MANUAL_REVIEW') NOT NULL DEFAULT 'NOT_RESERVED',
  `no_reward_reason` ENUM('SELF_INVITE', 'INVITATION_EXPIRED', 'INVITATION_REVOKED', 'NOT_FIRST_PHONE_REGISTRATION', 'INVITER_REWARD_LIMIT_REACHED', 'INVITER_NOT_FOUND') NULL DEFAULT NULL,
  `reward_slot` TINYINT UNSIGNED NULL DEFAULT NULL,
  `reward_amount` INT UNSIGNED NULL DEFAULT NULL,
  `reward_reserved_at` DATETIME(3) NULL DEFAULT NULL,
  `reward_granted_at` DATETIME(3) NULL DEFAULT NULL,
  `reward_expires_at` DATETIME(3) NULL DEFAULT NULL,
  `entitlement_transaction_id` VARCHAR(64) NULL DEFAULT NULL,
  `candidate_captured_at` DATETIME(3) NOT NULL,
  `candidate_superseded_at` DATETIME(3) NULL DEFAULT NULL,
  `superseded_by_invitation_id` CHAR(36) NULL DEFAULT NULL,
  `relation_locked_at` DATETIME(3) NULL DEFAULT NULL,
  `last_error_code` VARCHAR(64) NULL DEFAULT NULL,
  `retry_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `next_retry_at` DATETIME(3) NULL DEFAULT NULL,
  `active_candidate_subject_digest` BINARY(32) GENERATED ALWAYS AS (
    CASE WHEN `relation_status` IN ('CANDIDATE', 'FINAL') THEN `candidate_subject_digest` ELSE NULL END
  ) STORED,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitation_relation_invitation_id` (`invitation_id`),
  UNIQUE KEY `uk_invitation_relation_candidate_digest` (`candidate_receipt_digest`),
  UNIQUE KEY `uk_invitation_relation_active_subject` (`active_candidate_subject_digest`),
  UNIQUE KEY `uk_invitation_relation_invitee` (`invitee_user_id`),
  UNIQUE KEY `uk_invitation_relation_reward_slot` (`inviter_user_id`, `reward_slot`),
  UNIQUE KEY `uk_invitation_relation_entitlement_tx` (`entitlement_transaction_id`),
  KEY `idx_invitation_relation_subject_history` (`candidate_subject_digest`, `candidate_captured_at`),
  KEY `idx_invitation_relation_inviter_reward` (`inviter_user_id`, `reward_status`, `relation_locked_at`),
  KEY `idx_invitation_relation_compensation` (`reward_status`, `next_retry_at`),
  CONSTRAINT `fk_invitation_relation_share_credential` FOREIGN KEY (`share_credential_id`)
    REFERENCES `invitation_share_credentials` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_invitation_relation_lifecycle` CHECK (
    (`relation_status` = 'CANDIDATE' AND `invitee_user_id` IS NULL AND `relation_locked_at` IS NULL AND
      `candidate_superseded_at` IS NULL AND `superseded_by_invitation_id` IS NULL AND
      `qualification_status` = 'UNRESOLVED' AND `reward_status` = 'NOT_RESERVED' AND `no_reward_reason` IS NULL) OR
    (`relation_status` = 'SUPERSEDED' AND `invitee_user_id` IS NULL AND `relation_locked_at` IS NULL AND
      `candidate_superseded_at` IS NOT NULL AND `superseded_by_invitation_id` IS NOT NULL AND
      `qualification_status` = 'UNRESOLVED' AND `reward_status` = 'NOT_RESERVED' AND `no_reward_reason` IS NULL) OR
    (`relation_status` = 'FINAL' AND `invitee_user_id` IS NOT NULL AND `relation_locked_at` IS NOT NULL AND
      `candidate_superseded_at` IS NULL AND `superseded_by_invitation_id` IS NULL AND
      `qualification_status` IN ('ELIGIBLE', 'INELIGIBLE'))
  ),
  CONSTRAINT `chk_invitation_relation_reward_state` CHECK (
    (`reward_status` = 'NOT_RESERVED' AND `relation_status` IN ('CANDIDATE', 'SUPERSEDED') AND
      `reward_slot` IS NULL AND `reward_amount` IS NULL AND `reward_reserved_at` IS NULL AND
      `reward_granted_at` IS NULL AND `reward_expires_at` IS NULL AND `entitlement_transaction_id` IS NULL) OR
    (`reward_status` = 'REWARD_PENDING' AND `relation_status` = 'FINAL' AND `qualification_status` = 'ELIGIBLE' AND `no_reward_reason` IS NULL AND
      `reward_slot` IS NOT NULL AND `reward_slot` BETWEEN 1 AND 5 AND `reward_amount` IS NOT NULL AND `reward_amount` = 30 AND `reward_reserved_at` IS NOT NULL AND
      `reward_granted_at` IS NULL AND `reward_expires_at` IS NULL AND `entitlement_transaction_id` IS NULL) OR
    (`reward_status` = 'REWARD_GRANTED' AND `relation_status` = 'FINAL' AND `qualification_status` = 'ELIGIBLE' AND `no_reward_reason` IS NULL AND
      `reward_slot` IS NOT NULL AND `reward_slot` BETWEEN 1 AND 5 AND `reward_amount` IS NOT NULL AND `reward_amount` = 30 AND `reward_reserved_at` IS NOT NULL AND
      `reward_granted_at` IS NOT NULL AND `reward_expires_at` IS NOT NULL AND `reward_expires_at` = DATE_ADD(`reward_granted_at`, INTERVAL 1 YEAR) AND `entitlement_transaction_id` IS NOT NULL) OR
    (`reward_status` = 'NO_REWARD' AND `relation_status` = 'FINAL' AND `qualification_status` = 'INELIGIBLE' AND `no_reward_reason` IS NOT NULL AND
      `reward_slot` IS NULL AND `reward_amount` IS NULL AND `reward_reserved_at` IS NULL AND
      `reward_granted_at` IS NULL AND `reward_expires_at` IS NULL AND `entitlement_transaction_id` IS NULL) OR
    (`reward_status` = 'MANUAL_REVIEW' AND `relation_status` = 'FINAL' AND `qualification_status` = 'ELIGIBLE' AND `no_reward_reason` IS NULL AND
      `reward_slot` IS NOT NULL AND `reward_slot` BETWEEN 1 AND 5 AND `reward_amount` IS NOT NULL AND `reward_amount` = 30 AND `reward_reserved_at` IS NOT NULL AND
      `reward_granted_at` IS NULL AND `reward_expires_at` IS NULL AND `entitlement_transaction_id` IS NULL)
  ),
  CONSTRAINT `chk_invitation_relation_compensation` CHECK (
    (`reward_status` IN ('NOT_RESERVED', 'NO_REWARD', 'REWARD_GRANTED') AND `retry_count` = 0 AND `last_error_code` IS NULL AND `next_retry_at` IS NULL) OR
    (`reward_status` = 'REWARD_PENDING' AND (
      (`retry_count` = 0 AND `last_error_code` IS NULL AND `next_retry_at` IS NULL) OR
      (`retry_count` > 0 AND `last_error_code` IS NOT NULL AND `next_retry_at` IS NOT NULL)
    )) OR
    (`reward_status` = 'MANUAL_REVIEW' AND `retry_count` > 0 AND `last_error_code` IS NOT NULL AND `next_retry_at` IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback intentionally omitted; preserve invitation audit facts.
