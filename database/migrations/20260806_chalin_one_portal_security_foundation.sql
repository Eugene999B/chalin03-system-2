-- CHALIN ONE external portal security foundation.
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and separate SQL backup must be verified before production execution.
-- Additive and invitation-only. No portal business-record API is created here.

CREATE TABLE IF NOT EXISTS portal_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_key CHAR(40) NOT NULL,
  portal_type ENUM('customer','supplier','applicant') NOT NULL,
  entity_reference_type VARCHAR(80) NOT NULL,
  entity_reference_id BIGINT UNSIGNED NULL,
  entity_reference_key VARCHAR(160) NULL,
  email_normalized VARCHAR(254) NOT NULL,
  phone_e164 VARCHAR(32) NULL,
  password_hash VARCHAR(255) NULL,
  account_status ENUM(
    'invited','active','locked','suspended','closed'
  ) NOT NULL DEFAULT 'invited',
  failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  email_verified_at DATETIME NULL,
  password_changed_at DATETIME NULL,
  last_login_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_accounts_key (account_key),
  UNIQUE KEY uq_portal_accounts_type_email (portal_type, email_normalized),
  UNIQUE KEY uq_portal_accounts_entity (
    portal_type, entity_reference_type, entity_reference_id
  ),
  KEY idx_portal_accounts_status (portal_type, account_status, updated_at),
  CONSTRAINT fk_portal_accounts_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_portal_accounts_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invitation_key CHAR(40) NOT NULL,
  portal_account_id BIGINT UNSIGNED NOT NULL,
  token_sha256 CHAR(64) NOT NULL,
  invitation_status ENUM(
    'pending','accepted','expired','revoked'
  ) NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  request_note TEXT NULL,
  request_id VARCHAR(120) NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_invitations_key (invitation_key),
  UNIQUE KEY uq_portal_invitations_token (token_sha256),
  KEY idx_portal_invitations_account_status (
    portal_account_id, invitation_status, created_at
  ),
  KEY idx_portal_invitations_status_expiry (
    invitation_status, expires_at
  ),
  CONSTRAINT fk_portal_invitations_account
    FOREIGN KEY (portal_account_id) REFERENCES portal_accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_portal_invitations_requested_by
    FOREIGN KEY (requested_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_key CHAR(40) NOT NULL,
  portal_account_id BIGINT UNSIGNED NOT NULL,
  token_sha256 CHAR(64) NOT NULL,
  session_status ENUM('active','expired','revoked') NOT NULL DEFAULT 'active',
  ip_hash CHAR(64) NULL,
  user_agent_sha256 CHAR(64) NULL,
  expires_at DATETIME NOT NULL,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_sessions_key (session_key),
  UNIQUE KEY uq_portal_sessions_token (token_sha256),
  KEY idx_portal_sessions_account_status (
    portal_account_id, session_status, expires_at
  ),
  KEY idx_portal_sessions_status_expiry (session_status, expires_at),
  CONSTRAINT fk_portal_sessions_account
    FOREIGN KEY (portal_account_id) REFERENCES portal_accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_access_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portal_account_id BIGINT UNSIGNED NOT NULL,
  resource_key VARCHAR(140) NOT NULL,
  permission_key VARCHAR(140) NOT NULL,
  entity_reference_type VARCHAR(80) NULL,
  entity_reference_id BIGINT UNSIGNED NULL,
  grant_status ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  granted_by BIGINT UNSIGNED NOT NULL,
  revoked_by BIGINT UNSIGNED NULL,
  grant_note TEXT NULL,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_portal_access_grants_scope (
    portal_account_id, resource_key, permission_key,
    entity_reference_type, entity_reference_id
  ),
  KEY idx_portal_access_grants_account_status (
    portal_account_id, grant_status, expires_at
  ),
  CONSTRAINT fk_portal_access_grants_account
    FOREIGN KEY (portal_account_id) REFERENCES portal_accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_portal_access_grants_granted_by
    FOREIGN KEY (granted_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_portal_access_grants_revoked_by
    FOREIGN KEY (revoked_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_consent_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portal_account_id BIGINT UNSIGNED NOT NULL,
  privacy_notice_version VARCHAR(100) NOT NULL,
  terms_version VARCHAR(100) NOT NULL,
  consent_status ENUM('accepted','withdrawn') NOT NULL DEFAULT 'accepted',
  request_id VARCHAR(120) NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_portal_consent_records_account (
    portal_account_id, accepted_at, id
  ),
  CONSTRAINT fk_portal_consent_records_account
    FOREIGN KEY (portal_account_id) REFERENCES portal_accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portal_account_id BIGINT UNSIGNED NULL,
  portal_type ENUM('customer','supplier','applicant') NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  outcome ENUM('success','denied','failure','blocked') NOT NULL,
  severity ENUM('info','warning','high','critical') NOT NULL DEFAULT 'info',
  actor_staff_user_id BIGINT UNSIGNED NULL,
  session_key CHAR(40) NULL,
  request_id VARCHAR(120) NULL,
  ip_hash CHAR(64) NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_portal_audit_events_account_time (
    portal_account_id, created_at, id
  ),
  KEY idx_portal_audit_events_type_time (
    portal_type, event_type, created_at
  ),
  CONSTRAINT fk_portal_audit_events_account
    FOREIGN KEY (portal_account_id) REFERENCES portal_accounts(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_portal_audit_events_staff_user
    FOREIGN KEY (actor_staff_user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (migration_name)
VALUES ('20260806_chalin_one_portal_security_foundation');
