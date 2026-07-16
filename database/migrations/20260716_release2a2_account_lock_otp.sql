-- CHALIN 03 RELEASE 2A.2
-- Permanent ordinary-account lock and secure SMS OTP recovery.
-- ADDITIVE SECURITY MIGRATION ONLY.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DROP PROCEDURE IF EXISTS chalin03_release2a2_add_column;
DROP PROCEDURE IF EXISTS chalin03_release2a2_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_release2a2_add_column(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @release2a2_column_sql = CONCAT(
            'ALTER TABLE `',
            p_table_name,
            '` ADD COLUMN ',
            p_column_definition
        );

        PREPARE release2a2_column_statement
        FROM @release2a2_column_sql;

        EXECUTE release2a2_column_statement;
        DEALLOCATE PREPARE release2a2_column_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_release2a2_add_index(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_columns VARCHAR(255)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @release2a2_index_sql = CONCAT(
            'ALTER TABLE `',
            p_table_name,
            '` ADD INDEX `',
            p_index_name,
            '` (',
            p_index_columns,
            ')'
        );

        PREPARE release2a2_index_statement
        FROM @release2a2_index_sql;

        EXECUTE release2a2_index_statement;
        DEALLOCATE PREPARE release2a2_index_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_release2a2_add_column(
    'users',
    'is_login_locked',
    'is_login_locked BOOLEAN NOT NULL DEFAULT FALSE AFTER locked_until'
);

CALL chalin03_release2a2_add_column(
    'users',
    'login_locked_at',
    'login_locked_at DATETIME NULL AFTER is_login_locked'
);

CALL chalin03_release2a2_add_column(
    'users',
    'login_lock_reason',
    'login_lock_reason VARCHAR(120) NULL AFTER login_locked_at'
);

CALL chalin03_release2a2_add_column(
    'users',
    'last_failed_login_at',
    'last_failed_login_at DATETIME NULL AFTER login_lock_reason'
);

CALL chalin03_release2a2_add_column(
    'users',
    'last_failed_login_ip',
    'last_failed_login_ip VARCHAR(50) NULL AFTER last_failed_login_at'
);

CALL chalin03_release2a2_add_index(
    'users',
    'idx_users_login_locked',
    'is_login_locked, login_locked_at'
);

CALL chalin03_release2a2_add_index(
    'users',
    'idx_users_last_failed_login',
    'last_failed_login_at'
);

CREATE TABLE IF NOT EXISTS password_recovery_otps (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,

    otp_hash CHAR(64) NOT NULL,
    otp_salt CHAR(32) NOT NULL,

    request_ip VARCHAR(50) NULL,
    request_user_agent VARCHAR(255) NULL,

    attempts_used INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,

    consumed_at DATETIME NULL,
    invalidated_at DATETIME NULL,
    invalidation_reason VARCHAR(80) NULL,

    sms_log_id BIGINT NULL,

    CONSTRAINT fk_password_recovery_otp_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    INDEX idx_password_recovery_user_created (
        user_id,
        created_at
    ),

    INDEX idx_password_recovery_user_active (
        user_id,
        consumed_at,
        invalidated_at,
        expires_at
    ),

    INDEX idx_password_recovery_ip_created (
        request_ip,
        created_at
    ),

    INDEX idx_password_recovery_expiry (
        expires_at
    )
);

-- Old temporary counters are security state, not business records.
-- Resetting them prevents an old partial count from causing an early
-- permanent lock when Release 2A.2 becomes active.
UPDATE users
SET failed_login_attempts = 0,
    locked_until = NULL,
    is_login_locked = FALSE,
    login_locked_at = NULL,
    login_lock_reason = NULL,
    last_failed_login_at = NULL,
    last_failed_login_ip = NULL
WHERE id > 0;

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release2a2_account_lock_otp',
    'Adds permanent three-attempt ordinary-account locking and secure SMS OTP password recovery.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);

DROP PROCEDURE IF EXISTS chalin03_release2a2_add_column;
DROP PROCEDURE IF EXISTS chalin03_release2a2_add_index;