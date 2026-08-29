-- WeChat virtual payment stage 1 foundation: sandbox order and event facts.
-- This migration is for human review and controlled isolated-MySQL execution only.
-- Do not execute against production before read-only schema verification and backup approval.

-- Compatibility and relationship strategy:
-- - The first implementation stage supports sandbox only; service configuration must enforce env=1.
-- - user_id follows the existing entitlement convention as BIGINT UNSIGNED.
-- - The complete production users DDL is not stored in this repository, so no users foreign key is declared.
-- - membership_grant_id and entitlement_transaction_id remain indexed service-layer references.
-- - MySQL unique indexes allow multiple NULL values for provider and membership references.
-- - No payment secret, session credential, signature, phone number, or full notification payload belongs here.

CREATE TABLE IF NOT EXISTS `virtual_payment_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal order primary key.',
  `order_no` VARCHAR(64) NOT NULL COMMENT 'Globally unique public-safe payment business order number.',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Project user identity; references users.id at the service layer.',
  `client_request_id` VARCHAR(191) NOT NULL COMMENT 'User-scoped create-order idempotency identifier.',
  `internal_sku` VARCHAR(64) NOT NULL COMMENT 'Server-owned stable product identifier.',
  `product_id` VARCHAR(191) NOT NULL COMMENT 'Environment-specific WeChat product identifier snapshot.',
  `product_name` VARCHAR(191) NOT NULL COMMENT 'Human-readable product name snapshot.',
  `quantity` INT UNSIGNED NOT NULL COMMENT 'Server-owned purchased quantity.',
  `unit_price_fen` INT UNSIGNED NOT NULL COMMENT 'Server-owned unit price in the smallest currency unit.',
  `order_amount_fen` INT UNSIGNED NOT NULL COMMENT 'Server-owned expected order amount in the smallest currency unit.',
  `paid_amount_fen` INT UNSIGNED NULL DEFAULT NULL COMMENT 'Amount confirmed by a verified provider fact.',
  `currency` CHAR(3) NOT NULL COMMENT 'ISO-style currency code; stage 1 uses CNY.',
  `environment` VARCHAR(32) NOT NULL COMMENT 'Payment environment; stage 1 service permits sandbox only.',
  `wechat_env` TINYINT UNSIGNED NOT NULL COMMENT 'WeChat virtual payment environment number; stage 1 requires 1.',
  `payment_channel` VARCHAR(64) NOT NULL COMMENT 'Stable payment channel identifier.',
  `client_platform` VARCHAR(32) NOT NULL COMMENT 'Observed client platform; never the sole security boundary.',
  `provider_order_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Verified provider order identifier when available.',
  `provider_transaction_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Verified provider transaction identifier when available.',
  `payment_status` ENUM('initializing', 'pending', 'confirming', 'paid', 'closed', 'failed') NOT NULL DEFAULT 'initializing' COMMENT 'Payment confirmation lifecycle only.',
  `entitlement_status` ENUM('not_ready', 'pending', 'granting', 'granted', 'retryable_failed', 'failed') NOT NULL DEFAULT 'not_ready' COMMENT 'Membership entitlement lifecycle only.',
  `delivery_status` ENUM('not_ready', 'pending', 'confirming', 'delivered', 'retryable_failed', 'manual_review') NOT NULL DEFAULT 'not_ready' COMMENT 'Provider delivery-confirmation lifecycle only.',
  `client_result` ENUM('success', 'cancelled', 'failed') NULL DEFAULT NULL COMMENT 'Untrusted client callback observation; never confirms payment.',
  `membership_grant_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'membership_grants.id service-layer reference after idempotent grant.',
  `entitlement_transaction_id` VARCHAR(64) NULL DEFAULT NULL COMMENT 'entitlement_transactions.transaction_id service-layer reference.',
  `paid_at` DATETIME NULL DEFAULT NULL COMMENT 'Verified provider payment time in UTC.',
  `entitlement_granted_at` DATETIME NULL DEFAULT NULL COMMENT 'Local membership grant completion time in UTC.',
  `delivered_at` DATETIME NULL DEFAULT NULL COMMENT 'Provider delivery confirmation completion time in UTC.',
  `last_queried_at` DATETIME NULL DEFAULT NULL COMMENT 'Latest active provider-order query time in UTC.',
  `next_retry_at` DATETIME NULL DEFAULT NULL COMMENT 'Next eligible compensation attempt time in UTC.',
  `retry_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Persistent compensation attempt count.',
  `last_error_code` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Non-sensitive normalized error category only.',
  `version` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Optimistic concurrency version for future service updates.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_virtual_payment_orders_order_no` (`order_no`),
  UNIQUE KEY `uk_virtual_payment_orders_user_request` (`user_id`, `client_request_id`),
  UNIQUE KEY `uk_virtual_payment_orders_provider_order` (`environment`, `provider_order_id`),
  UNIQUE KEY `uk_virtual_payment_orders_provider_transaction` (`environment`, `provider_transaction_id`),
  UNIQUE KEY `uk_virtual_payment_orders_membership_grant` (`membership_grant_id`),
  KEY `idx_virtual_payment_orders_user_created` (`user_id`, `created_at`),
  KEY `idx_virtual_payment_orders_payment_retry` (`payment_status`, `next_retry_at`),
  KEY `idx_virtual_payment_orders_entitlement_retry` (`entitlement_status`, `next_retry_at`),
  KEY `idx_virtual_payment_orders_delivery_retry` (`delivery_status`, `next_retry_at`),
  KEY `idx_virtual_payment_orders_entitlement_transaction` (`entitlement_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Sandbox-first WeChat virtual payment order facts with independent payment, entitlement, and delivery lifecycles.';

CREATE TABLE IF NOT EXISTS `virtual_payment_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal event primary key.',
  `event_key` VARCHAR(191) NOT NULL COMMENT 'Stable event idempotency key derived from verified provider facts.',
  `event_type` VARCHAR(64) NOT NULL COMMENT 'Whitelisted provider or reconciliation event category.',
  `order_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'virtual_payment_orders.id service-layer reference when resolved.',
  `order_no` VARCHAR(64) NOT NULL COMMENT 'Payment business order number used for event reconciliation.',
  `provider_order_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Verified provider order identifier when available.',
  `provider_transaction_id` VARCHAR(191) NULL DEFAULT NULL COMMENT 'Verified provider transaction identifier when available.',
  `payload_hash` BINARY(32) NOT NULL COMMENT 'SHA-256 digest of the received payload; full payload is never stored.',
  `processing_status` ENUM('received', 'processing', 'processed', 'retryable_failed', 'rejected', 'manual_review') NOT NULL DEFAULT 'received' COMMENT 'Local event-processing lifecycle.',
  `received_count` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Number of equivalent provider deliveries observed.',
  `processed_at` DATETIME NULL DEFAULT NULL COMMENT 'Successful terminal processing time in UTC.',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Local processing attempt count.',
  `last_error_code` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Non-sensitive normalized error category only.',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_virtual_payment_events_event_key` (`event_key`),
  KEY `idx_virtual_payment_events_order_no` (`order_no`),
  KEY `idx_virtual_payment_events_order_id` (`order_id`),
  KEY `idx_virtual_payment_events_provider_order` (`provider_order_id`),
  KEY `idx_virtual_payment_events_provider_transaction` (`provider_transaction_id`),
  KEY `idx_virtual_payment_events_processing_updated` (`processing_status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Non-sensitive idempotent virtual payment event facts; stores a digest rather than full notification content.';

-- Rollback is intentionally not executable in this reviewed migration file.
-- If rollback is ever approved, stop all payment writers, preserve both fact tables for audit,
-- and follow the project policy for removing one explicitly confirmed table at a time.
