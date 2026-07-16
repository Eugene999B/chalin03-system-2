-- CHALIN 03 RELEASE 3
-- Owner Break-Glass MFA, hashed recovery codes and login evidence.
-- ADDITIVE MIGRATION ONLY.
-- Do not run database/schema.sql against production.

DROP PROCEDURE IF EXISTS chalin03_release3_add_owner_column;

DELIMITER $$

CREATE PROCEDURE chalin03_release3_add_owner_column(
    IN p_column_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'owner_break_glass_accounts'
          AND column_name = p_column_name
    ) THEN
        SET @sql_statement = CONCAT(
            'ALTER TABLE owner_break_glass_accounts ADD COLUMN `',
            p_column_name,
            '` ',
            p_definition
        );

        PREPARE chalin03_statement FROM @sql_statement;
        EXECUTE chalin03_statement;
        DEALLOCATE PREPARE chalin03_statement;
    END IF;
END $$

DELIMITER ;

CALL chalin03_release3_add_owner_column(
    'mfa_enabled',
    'BOOLEAN NOT NULL DEFAULT FALSE AFTER phone'
);

CALL chalin03_release3_add_owner_column(
    'mfa_secret_ciphertext',
    'TEXT NULL AFTER mfa_enabled'
);

CALL chalin03_release3_add_owner_column(
    'mfa_secret_iv',
    'VARCHAR(64) NULL AFTER mfa_secret_ciphertext'
);

CALL chalin03_release3_add_owner_column(
    'mfa_secret_tag',
    'VARCHAR(64) NULL AFTER mfa_secret_iv'
);

CALL chalin03_release3_add_owner_column(
    'mfa_secret_version',
    'INT NOT NULL DEFAULT 1 AFTER mfa_secret_tag'
);

CALL chalin03_release3_add_owner_column(
    'mfa_confirmed_at',
    'DATETIME NULL AFTER mfa_secret_version'
);

CALL chalin03_release3_add_owner_column(
    'mfa_last_verified_at',
    'DATETIME NULL AFTER mfa_confirmed_at'
);

CALL chalin03_release3_add_owner_column(
    'recovery_codes_generated_at',
    'DATETIME NULL AFTER mfa_last_verified_at'
);

DROP PROCEDURE IF EXISTS chalin03_release3_add_owner_column;

CREATE TABLE IF NOT EXISTS owner_break_glass_mfa_enrollments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_account_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    secret_ciphertext TEXT NOT NULL,
    secret_iv VARCHAR(64) NOT NULL,
    secret_tag VARCHAR(64) NOT NULL,
    secret_version INT NOT NULL DEFAULT 1,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    confirmed_at DATETIME NULL,
    revoked_at DATETIME NULL,

    CONSTRAINT fk_owner_mfa_enrollment_account
        FOREIGN KEY (owner_account_id)
        REFERENCES owner_break_glass_accounts(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_owner_mfa_enrollment_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_owner_mfa_enrollment_active (
        owner_account_id,
        confirmed_at,
        revoked_at,
        expires_at
    )
);

CREATE TABLE IF NOT EXISTS owner_break_glass_recovery_codes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_account_id INT NOT NULL,
    code_hash CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME NULL,
    used_ip VARCHAR(50) NULL,

    CONSTRAINT fk_owner_recovery_code_account
        FOREIGN KEY (owner_account_id)
        REFERENCES owner_break_glass_accounts(id)
        ON DELETE CASCADE,

    UNIQUE KEY uq_owner_recovery_code (
        owner_account_id,
        code_hash
    ),

    INDEX idx_owner_recovery_code_available (
        owner_account_id,
        used_at
    )
);

CREATE TABLE IF NOT EXISTS owner_break_glass_login_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_account_id INT NULL,
    username_attempted VARCHAR(100) NULL,
    outcome VARCHAR(40) NOT NULL,
    failure_reason VARCHAR(120) NULL,
    mfa_method VARCHAR(40) NULL,
    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_owner_login_history_account
        FOREIGN KEY (owner_account_id)
        REFERENCES owner_break_glass_accounts(id)
        ON DELETE SET NULL,

    INDEX idx_owner_login_history_account (
        owner_account_id,
        created_at
    ),

    INDEX idx_owner_login_history_outcome (
        outcome,
        created_at
    )
);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release3_owner_mfa_security',
    'Adds staged encrypted Owner Break-Glass MFA, one-time hashed recovery codes and owner login-history evidence.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
