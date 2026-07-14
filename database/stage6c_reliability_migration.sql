-- Stage 6C: reliability, readiness and diagnostics support.
-- Additive and idempotent. Does not alter business data.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(150) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description TEXT NULL,
  INDEX idx_schema_migration_name (migration_name),
  INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS application_error_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(100) NULL,
  user_id INT NULL,
  route VARCHAR(500) NULL,
  method VARCHAR(12) NULL,
  status_code INT NULL,
  error_code VARCHAR(120) NULL,
  safe_message VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_application_error_request (request_id),
  INDEX idx_application_error_user (user_id),
  INDEX idx_application_error_status (status_code),
  INDEX idx_application_error_created (created_at),

  CONSTRAINT fk_application_error_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  'stage6c_reliability_migration',
  'Adds safe application_error_log for diagnostics and readiness reporting.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
