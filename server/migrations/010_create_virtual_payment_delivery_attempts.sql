-- WeChat virtual payment delivery confirmation attempts.
-- Review and isolated-MySQL execution only; do not run against production automatically.

CREATE TABLE IF NOT EXISTS `virtual_payment_delivery_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operation_id` CHAR(64) NOT NULL COMMENT 'Server-generated cryptographically random operation identity.',
  `order_id` BIGINT UNSIGNED NOT NULL COMMENT 'virtual_payment_orders.id service-layer reference.',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Owning project user identity copied for strict ownership checks.',
  `attempt_no` INT UNSIGNED NOT NULL COMMENT 'Monotonic per-order outbound notification attempt number.',
  `claimed_order_version` BIGINT UNSIGNED NOT NULL COMMENT 'Order version observed before the claim advanced delivery state.',
  `attempt_status` ENUM('claimed', 'dispatching', 'explicit_failed', 'uncertain', 'confirming', 'succeeded', 'manual_review', 'superseded') NOT NULL,
  `result_kind` ENUM('not_started', 'success', 'explicit_failure', 'uncertain') NOT NULL DEFAULT 'not_started',
  `completion_source` ENUM('none', 'direct_notify', 'query_confirmation') NOT NULL DEFAULT 'none',
  `claimed_at` DATETIME NOT NULL,
  `finished_at` DATETIME NULL DEFAULT NULL,
  `lease_owner` CHAR(64) NULL DEFAULT NULL COMMENT 'Server-generated active notify lease identity; cleared at terminal transition.',
  `lease_expires_at` DATETIME NULL DEFAULT NULL,
  `request_started_at` DATETIME NULL DEFAULT NULL,
  `response_received_at` DATETIME NULL DEFAULT NULL,
  `next_action_at` DATETIME NULL DEFAULT NULL,
  `query_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Accepted query operations derived from delivery query history.',
  `provider_event_id` BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'Trusted virtual_payment_events evidence used for completion.',
  `last_error_code` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Stable non-sensitive category only.',
  `active_order_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `attempt_status` IN ('claimed', 'dispatching', 'uncertain', 'confirming') THEN `order_id` ELSE NULL END
  ) STORED,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_virtual_payment_delivery_operation` (`operation_id`),
  UNIQUE KEY `uk_virtual_payment_delivery_lease_owner` (`lease_owner`),
  UNIQUE KEY `uk_virtual_payment_delivery_order_attempt` (`order_id`, `attempt_no`),
  UNIQUE KEY `uk_virtual_payment_delivery_active_order` (`active_order_id`),
  KEY `idx_virtual_payment_delivery_user_order` (`user_id`, `order_id`),
  KEY `idx_virtual_payment_delivery_lease` (`attempt_status`, `lease_expires_at`),
  KEY `idx_virtual_payment_delivery_next_action` (`attempt_status`, `next_action_at`),
  KEY `idx_virtual_payment_delivery_provider_event` (`provider_event_id`),
  CONSTRAINT `fk_virtual_payment_delivery_attempt_order`
    FOREIGN KEY (`order_id`) REFERENCES `virtual_payment_orders` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_virtual_payment_delivery_attempt_event`
    FOREIGN KEY (`provider_event_id`) REFERENCES `virtual_payment_events` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Durable delivery-confirmation attempts without credentials, URLs, request bodies, or provider responses.';

CREATE TABLE IF NOT EXISTS `virtual_payment_delivery_queries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operation_id` CHAR(64) NOT NULL COMMENT 'Cryptographically random persistent query claim identity.',
  `order_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `attempt_id` BIGINT UNSIGNED NOT NULL,
  `query_sequence` INT UNSIGNED NOT NULL COMMENT 'Strictly increasing per delivery attempt, including lease takeovers.',
  `claimed_order_version` BIGINT UNSIGNED NOT NULL COMMENT 'Order version bound when the claim is persisted.',
  `query_status` ENUM('claimed', 'applied', 'stale', 'failed') NOT NULL DEFAULT 'claimed',
  `claimed_at` DATETIME NOT NULL,
  `lease_expires_at` DATETIME NULL DEFAULT NULL,
  `completed_at` DATETIME NULL DEFAULT NULL,
  `provider_event_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `observation_id` CHAR(64) NULL DEFAULT NULL,
  `observed_environment` VARCHAR(32) NULL DEFAULT NULL,
  `request_env` TINYINT UNSIGNED NULL DEFAULT NULL,
  `response_env_type` TINYINT UNSIGNED NULL DEFAULT NULL,
  `observed_order_no` VARCHAR(64) NULL DEFAULT NULL,
  `observed_provider_order_id` VARCHAR(191) NULL DEFAULT NULL,
  `observed_provider_transaction_id` VARCHAR(191) NULL DEFAULT NULL,
  `observed_currency` CHAR(3) NULL DEFAULT NULL,
  `wechat_status` TINYINT UNSIGNED NULL DEFAULT NULL,
  `order_type` TINYINT UNSIGNED NULL DEFAULT NULL,
  `order_amount_fen` INT UNSIGNED NULL DEFAULT NULL,
  `paid_amount_fen` INT UNSIGNED NULL DEFAULT NULL,
  `paid_at_seconds` BIGINT UNSIGNED NULL DEFAULT NULL,
  `provided_at_seconds` BIGINT UNSIGNED NULL DEFAULT NULL,
  `queried_at_seconds` BIGINT UNSIGNED NULL DEFAULT NULL,
  `active_order_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `query_status` = 'claimed' THEN `order_id` ELSE NULL END
  ) STORED,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_virtual_payment_delivery_query_operation` (`operation_id`),
  UNIQUE KEY `uk_virtual_payment_delivery_query_sequence` (`attempt_id`, `query_sequence`),
  UNIQUE KEY `uk_virtual_payment_delivery_active_query` (`active_order_id`),
  UNIQUE KEY `uk_virtual_payment_delivery_query_event` (`provider_event_id`),
  KEY `idx_virtual_payment_delivery_query_order_history` (`order_id`, `attempt_id`, `query_sequence`),
  KEY `idx_virtual_payment_delivery_query_lease` (`query_status`, `lease_expires_at`),
  KEY `idx_virtual_payment_delivery_query_user_order` (`user_id`, `order_id`),
  CONSTRAINT `fk_virtual_payment_delivery_query_order`
    FOREIGN KEY (`order_id`) REFERENCES `virtual_payment_orders` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_virtual_payment_delivery_query_attempt`
    FOREIGN KEY (`attempt_id`) REFERENCES `virtual_payment_delivery_attempts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_virtual_payment_delivery_query_event`
    FOREIGN KEY (`provider_event_id`) REFERENCES `virtual_payment_events` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Serialized delivery query claims and independently rebuildable applied query facts.';

-- Rollback is intentionally omitted. Preserve delivery evidence for audit and use a separately reviewed procedure.
