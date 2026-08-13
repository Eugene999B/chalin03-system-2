-- CHALIN 03 STAGING RECOVERY VERIFIER — RELEASE 3F-C2
-- Read-only verification of the category-isolation schema contract.

DROP PROCEDURE IF EXISTS chalin03_verify_recovery_release3fc2;
DELIMITER $$
CREATE PROCEDURE chalin03_verify_recovery_release3fc2()
BEGIN
    DECLARE missing_columns INT DEFAULT 0;
    DECLARE missing_tables INT DEFAULT 0;

    SELECT COUNT(*) INTO missing_columns
    FROM (
        SELECT 'users' AS table_name, 'primary_workspace_code' AS column_name
        UNION ALL SELECT 'users', 'category_assignment_status'
        UNION ALL SELECT 'users', 'category_conflict_reason'
        UNION ALL SELECT 'users', 'category_assignment_reviewed_at'
        UNION ALL SELECT 'users', 'category_assignment_reviewed_by'
        UNION ALL SELECT 'worker_profiles', 'workspace_code'
        UNION ALL SELECT 'worker_profiles', 'business_unit_id'
    ) required
    LEFT JOIN information_schema.COLUMNS current_column
      ON current_column.TABLE_SCHEMA = DATABASE()
     AND current_column.TABLE_NAME = required.table_name
     AND current_column.COLUMN_NAME = required.column_name
    WHERE current_column.COLUMN_NAME IS NULL;

    SELECT COUNT(*) INTO missing_tables
    FROM (
        SELECT 'user_category_assignment_conflicts' AS table_name
        UNION ALL SELECT 'worker_category_assignment_conflicts'
    ) required
    LEFT JOIN information_schema.TABLES current_table
      ON current_table.TABLE_SCHEMA = DATABASE()
     AND current_table.TABLE_NAME = required.table_name
     AND current_table.TABLE_TYPE = 'BASE TABLE'
    WHERE current_table.TABLE_NAME IS NULL;

    IF missing_columns <> 0 OR missing_tables <> 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Release 3F-C2 recovery schema verification failed.';
    END IF;
END$$
DELIMITER ;
CALL chalin03_verify_recovery_release3fc2();
DROP PROCEDURE IF EXISTS chalin03_verify_recovery_release3fc2;
