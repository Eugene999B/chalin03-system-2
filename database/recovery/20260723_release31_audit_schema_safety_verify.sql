-- CHALIN 03 STAGING RECOVERY VERIFIER
-- Read-only verification of the controlled Release 3.1 audit schema.

DROP PROCEDURE IF EXISTS chalin03_verify_recovery_audit_schema;
DELIMITER $$
CREATE PROCEDURE chalin03_verify_recovery_audit_schema()
BEGIN
  DECLARE missing_count INT DEFAULT 0;

  SELECT COUNT(*) INTO missing_count
  FROM (
    SELECT 'audit_signoffs' AS table_name, 'branch_id' AS column_name
    UNION ALL SELECT 'audit_signoffs', 'maintenance_checked'
    UNION ALL SELECT 'audit_signoffs', 'created_at'
    UNION ALL SELECT 'audit_unlock_requests', 'branch_id'
    UNION ALL SELECT 'audit_unlock_requests', 'request_area'
    UNION ALL SELECT 'audit_unlock_requests', 'status'
    UNION ALL SELECT 'audit_reapproval_log', 'branch_id'
    UNION ALL SELECT 'audit_reapproval_log', 'unlock_request_id'
    UNION ALL SELECT 'audit_reapproval_log', 'reapproved_at'
  ) required
  LEFT JOIN information_schema.COLUMNS current_column
    ON current_column.TABLE_SCHEMA = DATABASE()
   AND current_column.TABLE_NAME = required.table_name
   AND current_column.COLUMN_NAME = required.column_name
  WHERE current_column.COLUMN_NAME IS NULL;

  IF missing_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Release 3.1 audit recovery schema verification failed.';
  END IF;
END$$
DELIMITER ;
CALL chalin03_verify_recovery_audit_schema();
DROP PROCEDURE IF EXISTS chalin03_verify_recovery_audit_schema;
