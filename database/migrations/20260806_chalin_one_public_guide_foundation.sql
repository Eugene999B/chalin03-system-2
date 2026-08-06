-- CHALIN ONE public Guide foundation.
-- Additive and manual only. This migration is intentionally separate from the
-- staff AI foundation so public anonymous sessions can be released independently.

CREATE TABLE IF NOT EXISTS ai_public_guide_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_key CHAR(40) NOT NULL,
  token_sha256 CHAR(64) NOT NULL,
  ip_hash CHAR(64) NULL,
  session_status ENUM('active','expired','blocked','closed') NOT NULL DEFAULT 'active',
  message_count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  last_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_public_guide_sessions_key (session_key),
  UNIQUE KEY uq_ai_public_guide_sessions_token (token_sha256),
  KEY idx_ai_public_guide_sessions_status_expiry (session_status, expires_at),
  KEY idx_ai_public_guide_sessions_ip_created (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_public_guide_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_key CHAR(40) NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  message_role ENUM('user','assistant') NOT NULL,
  content_text TEXT NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  safety_status ENUM('allowed','redacted','blocked','error') NOT NULL DEFAULT 'allowed',
  evidence_json JSON NULL,
  provider_key VARCHAR(80) NULL,
  model_key VARCHAR(160) NULL,
  input_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  latency_ms INT UNSIGNED NULL,
  error_code VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_public_guide_messages_key (message_key),
  KEY idx_ai_public_guide_messages_session_id (session_id, id),
  CONSTRAINT fk_ai_public_guide_messages_session
    FOREIGN KEY (session_id) REFERENCES ai_public_guide_sessions(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration_name)
VALUES ('20260806_chalin_one_public_guide_foundation');
