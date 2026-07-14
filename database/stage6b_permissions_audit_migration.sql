-- Stage 6B: centralized permissions support and structured audit fields.
-- Additive and idempotent. Does not delete or rewrite existing business rows.

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

CALL chalin03_add_column_if_missing('activity_log', 'workspace_code', 'VARCHAR(50) NULL AFTER created_at');
CALL chalin03_add_column_if_missing('activity_log', 'business_unit_id', 'INT NULL AFTER workspace_code');
CALL chalin03_add_column_if_missing('activity_log', 'mining_site_id', 'INT NULL AFTER business_unit_id');
CALL chalin03_add_column_if_missing('activity_log', 'hire_location_id', 'INT NULL AFTER mining_site_id');
CALL chalin03_add_column_if_missing('activity_log', 'entity_type', 'VARCHAR(80) NULL AFTER hire_location_id');
CALL chalin03_add_column_if_missing('activity_log', 'entity_id', 'VARCHAR(80) NULL AFTER entity_type');
CALL chalin03_add_column_if_missing('activity_log', 'action_type', 'VARCHAR(100) NULL AFTER entity_id');
CALL chalin03_add_column_if_missing('activity_log', 'outcome', 'VARCHAR(40) NOT NULL DEFAULT ''success'' AFTER action_type');
CALL chalin03_add_column_if_missing('activity_log', 'severity', 'VARCHAR(40) NOT NULL DEFAULT ''info'' AFTER outcome');
CALL chalin03_add_column_if_missing('activity_log', 'request_id', 'VARCHAR(100) NULL AFTER severity');
CALL chalin03_add_column_if_missing('activity_log', 'user_agent', 'VARCHAR(500) NULL AFTER request_id');
CALL chalin03_add_column_if_missing('activity_log', 'metadata_json', 'LONGTEXT NULL AFTER user_agent');

CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_workspace', 'workspace_code');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_business_unit', 'business_unit_id');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_mining_site', 'mining_site_id');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_hire_location', 'hire_location_id');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_action_type', 'action_type');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_entity', 'entity_type, entity_id');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_outcome', 'outcome');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_severity', 'severity');
CALL chalin03_add_index_if_missing('activity_log', 'idx_activity_request', 'request_id');

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  'stage6b_permissions_audit_migration',
  'Adds structured searchable audit fields and indexes to activity_log.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

DROP PROCEDURE IF EXISTS chalin03_add_column_if_missing;
DROP PROCEDURE IF EXISTS chalin03_add_index_if_missing;
