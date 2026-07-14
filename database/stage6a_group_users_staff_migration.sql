-- Stage 6A - Central Users & Staff administration migration
-- Safe to run more than once. Does not reset, delete, or overwrite records.
-- Run against the database already selected by the connection.
-- This script never switches databases.

SELECT DATABASE() AS stage6a_target_database;

-- Add the global "staff" account class when users.role is still an ENUM
-- without it. Existing admin, manager, cashier and auditor values are preserved.
SET @stage6a_role_type := (
  SELECT COLUMN_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'role'
  LIMIT 1
);

SET @stage6a_sql := IF(
  @stage6a_role_type LIKE 'enum(%'
    AND @stage6a_role_type NOT LIKE '%''staff''%',
  'ALTER TABLE users MODIFY role ENUM(''admin'', ''manager'', ''staff'', ''cashier'', ''auditor'') NOT NULL DEFAULT ''cashier''',
  'SELECT ''users.role already supports staff or is not an ENUM'' AS stage6a_status'
);
PREPARE stage6a_stmt FROM @stage6a_sql;
EXECUTE stage6a_stmt;
DEALLOCATE PREPARE stage6a_stmt;

-- Add password-change-required support.
SET @stage6a_sql := IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'must_change_password'
  ) = 0,
  'ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active',
  'SELECT ''users.must_change_password already exists'' AS stage6a_status'
);
PREPARE stage6a_stmt FROM @stage6a_sql;
EXECUTE stage6a_stmt;
DEALLOCATE PREPARE stage6a_stmt;

SET @stage6a_sql := IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'password_changed_at'
  ) = 0,
  'ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL AFTER must_change_password',
  'SELECT ''users.password_changed_at already exists'' AS stage6a_status'
);
PREPARE stage6a_stmt FROM @stage6a_sql;
EXECUTE stage6a_stmt;
DEALLOCATE PREPARE stage6a_stmt;

-- Track which central administrator created a new account.
SET @stage6a_sql := IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'created_by'
  ) = 0,
  'ALTER TABLE users ADD COLUMN created_by INT NULL AFTER password_changed_at',
  'SELECT ''users.created_by already exists'' AS stage6a_status'
);
PREPARE stage6a_stmt FROM @stage6a_sql;
EXECUTE stage6a_stmt;
DEALLOCATE PREPARE stage6a_stmt;

SET @stage6a_sql := IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'idx_user_must_change_password'
  ) = 0,
  'ALTER TABLE users ADD INDEX idx_user_must_change_password (must_change_password)',
  'SELECT ''idx_user_must_change_password already exists'' AS stage6a_status'
);
PREPARE stage6a_stmt FROM @stage6a_sql;
EXECUTE stage6a_stmt;
DEALLOCATE PREPARE stage6a_stmt;

SET @stage6a_sql := IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'idx_user_created_by'
  ) = 0,
  'ALTER TABLE users ADD INDEX idx_user_created_by (created_by)',
  'SELECT ''idx_user_created_by already exists'' AS stage6a_status'
);
PREPARE stage6a_stmt FROM @stage6a_sql;
EXECUTE stage6a_stmt;
DEALLOCATE PREPARE stage6a_stmt;

SET @stage6a_orphan_created_by := (
  SELECT COUNT(*)
  FROM users u
  LEFT JOIN users creator ON creator.id = u.created_by
  WHERE u.created_by IS NOT NULL
    AND creator.id IS NULL
);

SET @stage6a_sql := IF(
  (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'created_by'
      AND REFERENCED_TABLE_NAME = 'users'
      AND REFERENCED_COLUMN_NAME = 'id'
  ) = 0
    AND @stage6a_orphan_created_by = 0,
  'ALTER TABLE users ADD CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT ''users.created_by foreign key already exists or has incompatible values'' AS stage6a_status'
);
PREPARE stage6a_stmt FROM @stage6a_sql;
EXECUTE stage6a_stmt;
DEALLOCATE PREPARE stage6a_stmt;
