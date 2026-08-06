-- CHALIN ONE scheduled intelligence governance.
-- This migration stores approved schedule definitions and review evidence only.
-- It does not create or start a scheduler and FEATURE_AI_SCHEDULED_JOBS remains false.

CREATE TABLE IF NOT EXISTS ai_scheduled_job_definitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_key CHAR(40) NOT NULL,
  job_key VARCHAR(140) NOT NULL,
  job_version VARCHAR(40) NOT NULL DEFAULT '1',
  persona ENUM('copilot','executive') NOT NULL,
  workspace_code VARCHAR(50) NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  mining_site_id BIGINT UNSIGNED NULL,
  hire_location_id BIGINT UNSIGNED NULL,
  schedule_status ENUM(
    'draft','pending_review','approved','rejected','cancelled','archived'
  ) NOT NULL DEFAULT 'draft',
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  schedule_json JSON NOT NULL,
  schedule_sha256 CHAR(64) NOT NULL,
  input_json JSON NOT NULL,
  input_sha256 CHAR(64) NOT NULL,
  evidence_json JSON NULL,
  evidence_count INT UNSIGNED NOT NULL DEFAULT 0,
  requested_by BIGINT UNSIGNED NOT NULL,
  assigned_to BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  request_note TEXT NULL,
  decision_note TEXT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_scheduled_job_definitions_key (schedule_key),
  KEY idx_ai_scheduled_job_definitions_workspace_status (
    workspace_code, schedule_status, created_at
  ),
  KEY idx_ai_scheduled_job_definitions_assigned_status (
    assigned_to, schedule_status, requested_at
  ),
  CONSTRAINT fk_ai_scheduled_job_definitions_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_scheduled_job_definitions_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_scheduled_job_definitions_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_ai_scheduled_job_definitions_schedule_sha
    CHECK (CHAR_LENGTH(schedule_sha256) = 64),
  CONSTRAINT chk_ai_scheduled_job_definitions_input_sha
    CHECK (CHAR_LENGTH(input_sha256) = 64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_scheduled_job_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_id BIGINT UNSIGNED NOT NULL,
  review_status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  assigned_to BIGINT UNSIGNED NOT NULL,
  decided_by BIGINT UNSIGNED NULL,
  request_note TEXT NULL,
  decision_note TEXT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_scheduled_job_reviews_status (schedule_id, review_status),
  KEY idx_ai_scheduled_job_reviews_assigned_status (
    assigned_to, review_status, requested_at
  ),
  CONSTRAINT fk_ai_scheduled_job_reviews_schedule
    FOREIGN KEY (schedule_id) REFERENCES ai_scheduled_job_definitions(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_scheduled_job_reviews_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_scheduled_job_reviews_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_scheduled_job_reviews_decided_by
    FOREIGN KEY (decided_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_scheduled_job_run_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_id BIGINT UNSIGNED NOT NULL,
  run_key CHAR(40) NOT NULL,
  run_status ENUM('blocked','cancelled','failed','succeeded') NOT NULL,
  scheduled_for DATETIME NOT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  output_summary TEXT NULL,
  evidence_json JSON NULL,
  evidence_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(120) NULL,
  request_id VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_scheduled_job_run_evidence_key (run_key),
  KEY idx_ai_scheduled_job_run_evidence_schedule_time (
    schedule_id, scheduled_for, id
  ),
  CONSTRAINT fk_ai_scheduled_job_run_evidence_schedule
    FOREIGN KEY (schedule_id) REFERENCES ai_scheduled_job_definitions(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration_name)
VALUES ('20260806_chalin_one_ai_scheduled_governance');
