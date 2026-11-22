-- CHALIN03 Passwordless staff sign-in foundation
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified before migration.
-- Do NOT run at server startup. No existing auth table or user record is altered.
CREATE TABLE IF NOT EXISTS staff_passwordless_identities (
 user_id INT NOT NULL PRIMARY KEY,
 secret_ciphertext TEXT NOT NULL,
 secret_iv VARCHAR(80) NOT NULL,
 secret_tag VARCHAR(80) NOT NULL,
 verified_at DATETIME NOT NULL,
 last_totp_counter BIGINT NOT NULL DEFAULT -1,
 google_sub VARCHAR(255) NULL,
 google_email VARCHAR(255) NULL,
 google_linked_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_staff_passwordless_google_sub (google_sub),
 CONSTRAINT fk_staff_passwordless_identity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS staff_passwordless_challenges (
 token_digest CHAR(64) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 purpose ENUM('sms_enroll','totp_login','admin_setup','setup','google_link') NOT NULL,
 workspace_code VARCHAR(32) NOT NULL DEFAULT 'spare_parts',
 branch_id INT NULL,
 sms_pin_digest CHAR(64) NULL,
 pending_ciphertext TEXT NULL,
 pending_iv VARCHAR(80) NULL,
 pending_tag VARCHAR(80) NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sms_sent_at DATETIME NULL,
 verified_at DATETIME NULL,
 expires_at DATETIME NOT NULL,
 consumed_at DATETIME NULL,
 INDEX idx_staff_passwordless_challenge_user (user_id,purpose,created_at),
 INDEX idx_staff_passwordless_challenge_expiry (expires_at),
 CONSTRAINT fk_staff_passwordless_challenge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS staff_passwordless_backup_codes (
 user_id INT NOT NULL,
 code_digest CHAR(64) NOT NULL,
 used_at DATETIME NULL,
 PRIMARY KEY (user_id,code_digest),
 CONSTRAINT fk_staff_passwordless_backup_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS staff_passwordless_sms_campaign (
 user_id INT NOT NULL PRIMARY KEY,
 phone_e164 VARCHAR(20) NOT NULL,
 last_sent_at DATETIME NULL,
 delivery_state VARCHAR(30) NOT NULL DEFAULT 'pending',
 sms_log_id BIGINT NULL,
 CONSTRAINT fk_staff_passwordless_campaign_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff_passwordless_google_links (
 state_digest CHAR(64) NOT NULL PRIMARY KEY,
 user_id INT NOT NULL,
 session_id VARCHAR(128) NOT NULL,
 nonce VARCHAR(90) NOT NULL,
 pkce_ciphertext TEXT NOT NULL,
 pkce_iv VARCHAR(80) NOT NULL,
 pkce_tag VARCHAR(80) NOT NULL,
 expires_at DATETIME NOT NULL,
 consumed_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_google_link_user_time (user_id,created_at),
 CONSTRAINT fk_staff_google_link_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO schema_migrations (migration_name,description)
VALUES ('20261122_staff_passwordless_foundation','Adds isolated staff TOTP, SMS challenges, recovery codes, and controlled announcement evidence.')
ON DUPLICATE KEY UPDATE description=VALUES(description);
