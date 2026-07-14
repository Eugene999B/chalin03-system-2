-- Stage 6D: login lockout and token revocation fields.
-- Additive and idempotent. Does not reset passwords or deactivate accounts.

DELIMITER $$

DROP PROCEDURE IF EXISTS chalin03_add_column_if_missing $$
CREATE PROCEDURE chalin03_add_column_if_missing(
  IN p_table VARCHAR(128),
  IN p_column VARCHAR(128),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS chalin03_add_index_if_missing $$
CREATE PROCEDURE chalin03_add_index_if_missing(
  IN p_table VARCHAR(128),
  IN p_index VARCHAR(128),
  IN p_columns TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_columns, ')');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$

DELIMITER ;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(150) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description TEXT NULL,
  INDEX idx_schema_migration_name (migration_name),
  INDEX idx_schema_migration_applied_at (applied_at)
);

CALL chalin03_add_column_if_missing('users', 'failed_login_attempts', 'INT NOT NULL DEFAULT 0 AFTER password_changed_at');
CALL chalin03_add_column_if_missing('users', 'locked_until', 'DATETIME NULL AFTER failed_login_attempts');
CALL chalin03_add_column_if_missing('users', 'last_login_at', 'DATETIME NULL AFTER locked_until');
CALL chalin03_add_column_if_missing('users', 'last_login_ip', 'VARCHAR(50) NULL AFTER last_login_at');
CALL chalin03_add_column_if_missing('users', 'token_version', 'INT NOT NULL DEFAULT 0 AFTER last_login_ip');

CALL chalin03_add_index_if_missing('users', 'idx_user_locked_until', 'locked_until');
CALL chalin03_add_index_if_missing('users', 'idx_user_last_login_at', 'last_login_at');
CALL chalin03_add_index_if_missing('users', 'idx_user_token_version', 'token_version');

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  'stage6d_security_migration',
  'Adds failed-login lockout, last-login tracking and token revocation support.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

DROP PROCEDURE IF EXISTS chalin03_add_column_if_missing;
DROP PROCEDURE IF EXISTS chalin03_add_index_if_missing;
