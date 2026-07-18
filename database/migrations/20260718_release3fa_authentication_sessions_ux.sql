-- CHALIN 03 RELEASE 3F-A
-- Authentication clarity, phone login, professional device/session evidence and UI hardening.
-- ADDITIVE / IDEMPOTENT MIGRATION ONLY.
-- Existing business records are preserved.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS chalin03_release3fa_add_column $$
CREATE PROCEDURE chalin03_release3fa_add_column(
    IN p_table_name VARCHAR(128),
    IN p_column_name VARCHAR(128),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @release3fa_sql = CONCAT(
            'ALTER TABLE `', p_table_name,
            '` ADD COLUMN `', p_column_name, '` ', p_definition
        );
        PREPARE release3fa_stmt FROM @release3fa_sql;
        EXECUTE release3fa_stmt;
        DEALLOCATE PREPARE release3fa_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS chalin03_release3fa_add_index $$
CREATE PROCEDURE chalin03_release3fa_add_index(
    IN p_table_name VARCHAR(128),
    IN p_index_name VARCHAR(128),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @release3fa_sql = CONCAT(
            'ALTER TABLE `', p_table_name,
            '` ADD ', p_index_definition
        );
        PREPARE release3fa_stmt FROM @release3fa_sql;
        EXECUTE release3fa_stmt;
        DEALLOCATE PREPARE release3fa_stmt;
    END IF;
END $$

DELIMITER ;

CALL chalin03_release3fa_add_column(
    'users',
    'login_phone_normalized',
    'VARCHAR(20) NULL AFTER phone'
);

UPDATE users
SET login_phone_normalized =
    CASE
        WHEN phone IS NULL OR TRIM(phone) = '' THEN NULL
        WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') REGEXP '^0[0-9]{9}$'
            THEN CONCAT('+233', SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 2))
        WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') REGEXP '^233[0-9]{9}$'
            THEN CONCAT('+', REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''))
        WHEN REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') REGEXP '^[0-9]{9}$'
            THEN CONCAT('+233', REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''))
        ELSE NULL
    END
WHERE login_phone_normalized IS NULL;

-- Duplicate visible phone numbers remain untouched, but phone login is disabled
-- for duplicates until an administrator assigns a unique number to each account.
UPDATE users u
INNER JOIN (
    SELECT login_phone_normalized
    FROM users
    WHERE login_phone_normalized IS NOT NULL
    GROUP BY login_phone_normalized
    HAVING COUNT(*) > 1
) duplicate_phone
    ON duplicate_phone.login_phone_normalized = u.login_phone_normalized
SET u.login_phone_normalized = NULL;

CALL chalin03_release3fa_add_index(
    'users',
    'uq_users_login_phone_normalized',
    'UNIQUE KEY `uq_users_login_phone_normalized` (`login_phone_normalized`)'
);

DROP TRIGGER IF EXISTS trg_users_release3fa_phone_insert;
DELIMITER $$
CREATE TRIGGER trg_users_release3fa_phone_insert
BEFORE INSERT ON users
FOR EACH ROW
BEGIN
    DECLARE clean_phone VARCHAR(40);
    SET clean_phone = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(NEW.phone, '')), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '');
    SET NEW.login_phone_normalized =
        CASE
            WHEN clean_phone REGEXP '^0[0-9]{9}$' THEN CONCAT('+233', SUBSTRING(clean_phone, 2))
            WHEN clean_phone REGEXP '^233[0-9]{9}$' THEN CONCAT('+', clean_phone)
            WHEN clean_phone REGEXP '^[0-9]{9}$' THEN CONCAT('+233', clean_phone)
            ELSE NULL
        END;
END $$
DELIMITER ;

DROP TRIGGER IF EXISTS trg_users_release3fa_phone_update;
DELIMITER $$
CREATE TRIGGER trg_users_release3fa_phone_update
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
    DECLARE clean_phone VARCHAR(40);
    SET clean_phone = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(NEW.phone, '')), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '');
    SET NEW.login_phone_normalized =
        CASE
            WHEN clean_phone REGEXP '^0[0-9]{9}$' THEN CONCAT('+233', SUBSTRING(clean_phone, 2))
            WHEN clean_phone REGEXP '^233[0-9]{9}$' THEN CONCAT('+', clean_phone)
            WHEN clean_phone REGEXP '^[0-9]{9}$' THEN CONCAT('+233', clean_phone)
            ELSE NULL
        END;
END $$
DELIMITER ;

CALL chalin03_release3fa_add_column('auth_sessions', 'login_method', 'VARCHAR(20) NULL AFTER workspace_code');
CALL chalin03_release3fa_add_column('auth_sessions', 'device_type', 'VARCHAR(30) NULL AFTER user_agent');
CALL chalin03_release3fa_add_column('auth_sessions', 'device_label', 'VARCHAR(180) NULL AFTER device_type');
CALL chalin03_release3fa_add_column('auth_sessions', 'device_model', 'VARCHAR(100) NULL AFTER device_label');
CALL chalin03_release3fa_add_column('auth_sessions', 'device_platform', 'VARCHAR(80) NULL AFTER device_model');
CALL chalin03_release3fa_add_column('auth_sessions', 'architecture', 'VARCHAR(40) NULL AFTER device_platform');
CALL chalin03_release3fa_add_column('auth_sessions', 'os_name', 'VARCHAR(80) NULL AFTER architecture');
CALL chalin03_release3fa_add_column('auth_sessions', 'os_version', 'VARCHAR(40) NULL AFTER os_name');
CALL chalin03_release3fa_add_column('auth_sessions', 'browser_name', 'VARCHAR(80) NULL AFTER os_version');
CALL chalin03_release3fa_add_column('auth_sessions', 'browser_version', 'VARCHAR(40) NULL AFTER browser_name');
CALL chalin03_release3fa_add_column('auth_sessions', 'client_timezone', 'VARCHAR(80) NULL AFTER browser_version');
CALL chalin03_release3fa_add_column('auth_sessions', 'client_language', 'VARCHAR(30) NULL AFTER client_timezone');
CALL chalin03_release3fa_add_column('auth_sessions', 'screen_width', 'INT NULL AFTER client_language');
CALL chalin03_release3fa_add_column('auth_sessions', 'screen_height', 'INT NULL AFTER screen_width');
CALL chalin03_release3fa_add_column('auth_sessions', 'pixel_ratio', 'DECIMAL(6,2) NULL AFTER screen_height');
CALL chalin03_release3fa_add_column('auth_sessions', 'touch_points', 'INT NULL AFTER pixel_ratio');
CALL chalin03_release3fa_add_column('auth_sessions', 'pwa_mode', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER touch_points');
CALL chalin03_release3fa_add_column('auth_sessions', 'location_permission', 'VARCHAR(30) NULL AFTER pwa_mode');
CALL chalin03_release3fa_add_column('auth_sessions', 'location_source', 'VARCHAR(40) NULL AFTER location_permission');
CALL chalin03_release3fa_add_column('auth_sessions', 'latitude', 'DECIMAL(10,7) NULL AFTER location_source');
CALL chalin03_release3fa_add_column('auth_sessions', 'longitude', 'DECIMAL(10,7) NULL AFTER latitude');
CALL chalin03_release3fa_add_column('auth_sessions', 'location_accuracy_m', 'DECIMAL(12,2) NULL AFTER longitude');
CALL chalin03_release3fa_add_column('auth_sessions', 'location_recorded_at', 'DATETIME NULL AFTER location_accuracy_m');
CALL chalin03_release3fa_add_column('auth_sessions', 'network_country', 'VARCHAR(8) NULL AFTER location_recorded_at');

CALL chalin03_release3fa_add_index(
    'auth_sessions',
    'idx_auth_sessions_device_created',
    'INDEX `idx_auth_sessions_device_created` (`device_type`, `created_at`)'
);
CALL chalin03_release3fa_add_index(
    'auth_sessions',
    'idx_auth_sessions_location_created',
    'INDEX `idx_auth_sessions_location_created` (`location_source`, `created_at`)'
);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release3fa_authentication_sessions_ux',
    'Adds unique phone login identity and professional device/location evidence for secure sessions.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);

DROP PROCEDURE IF EXISTS chalin03_release3fa_add_index;
DROP PROCEDURE IF EXISTS chalin03_release3fa_add_column;
