-- Local isolated validation only in this development phase; no production execution.
-- Same stable users.id as user_entitlements. No text copies or session/IP data.
CREATE TABLE IF NOT EXISTS content_read_words (
  user_id BIGINT UNSIGNED NOT NULL,
  word_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  first_read_ms BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, word_id),
  KEY idx_content_read_user_time (user_id, first_read_ms),
  KEY idx_content_read_expiry (first_read_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS content_read_cooldowns (
  user_id BIGINT UNSIGNED NOT NULL,
  until_ms BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id),
  KEY idx_content_cooldown_expiry (until_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
