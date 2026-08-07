-- CHALIN ONE AI action proposal governance.
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and separate SQL backup must be verified before production execution.
-- This migration creates proposal and human-review evidence only.
-- It does not create an executor and does not enable FEATURE_AI_ACTIONS.

CREATE TABLE IF NOT EXISTS ai_action_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_key CHAR(40) NOT NULL,
  action_key VARCHAR(140) NOT NULL,
  action_version VARCHAR(40) NOT NULL DEFAULT '1',
  persona ENUM('copilot','executive') NOT NULL,
  risk_level TINYINT UNSIGNED NOT NULL,
  workspace_code VARCHAR(50) NOT NULL,
  branch_id BIGINT UNSIGNED NULL,
  mining_site_id BIGINT UNSIGNED NULL,
  hire_location_id BIGINT UNSIGNED NULL,
  proposal_status ENUM(
    'draft','pending_review','approved','rejected','cancelled','expired','executed','failed'
  ) NOT NULL DEFAULT 'draft',
  title VARCHAR(255) NOT NULL,
  summary_text TEXT NOT NULL,
  payload_json JSON NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  evidence_json JSON NULL,
  evidence_count INT UNSIGNED NOT NULL DEFAULT 0,
  requested_by INT NOT NULL,
  assigned_to INT NULL,
  approved_by INT NULL,
  request_note TEXT NULL,
  decision_note TEXT NULL,
  request_id VARCHAR(120) NULL,
  expires_at DATETIME NOT NULL,
  decided_at DATETIME NULL,
  executed_at DATETIME NULL,
  result_summary TEXT NULL,
  error_code VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_action_proposals_key (proposal_key),
  KEY idx_ai_action_proposals_status_expiry (proposal_status, expires_at),
  KEY idx_ai_action_proposals_workspace_status (workspace_code, proposal_status, created_at),
  KEY idx_ai_action_proposals_assigned_status (assigned_to, proposal_status, created_at),
  KEY idx_ai_action_proposals_requested (requested_by, created_at),
  CONSTRAINT fk_ai_action_proposals_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_action_proposals_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_action_proposals_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_ai_action_proposals_risk
    CHECK (risk_level BETWEEN 1 AND 5),
  CONSTRAINT chk_ai_action_proposals_payload_sha
    CHECK (CHAR_LENGTH(payload_sha256) = 64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_action_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_id BIGINT UNSIGNED NOT NULL,
  review_status ENUM('pending','approved','rejected','cancelled','expired') NOT NULL DEFAULT 'pending',
  requested_by INT NOT NULL,
  assigned_to INT NOT NULL,
  decided_by INT NULL,
  request_note TEXT NULL,
  decision_note TEXT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_action_reviews_pending_version (proposal_id, review_status),
  KEY idx_ai_action_reviews_assigned_status (assigned_to, review_status, requested_at),
  CONSTRAINT fk_ai_action_reviews_proposal
    FOREIGN KEY (proposal_id) REFERENCES ai_action_proposals(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_action_reviews_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_action_reviews_assigned_to
    FOREIGN KEY (assigned_to) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ai_action_reviews_decided_by
    FOREIGN KEY (decided_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration_name)
VALUES ('20260806_chalin_one_ai_action_governance');
