-- CHALIN 03 STAGING RECOVERY VERIFIER
-- Verifies only schema restored by spare_parts_sales_hotfix.sql.

DROP PROCEDURE IF EXISTS chalin03_verify_recovery_spare_parts_hotfix;
DELIMITER $$
CREATE PROCEDURE chalin03_verify_recovery_spare_parts_hotfix()
BEGIN
  DECLARE missing_count INT DEFAULT 0;
  SELECT COUNT(*) INTO missing_count
  FROM (
    SELECT 'amount_tendered' AS column_name
    UNION ALL SELECT 'change_due'
    UNION ALL SELECT 'edited_by'
    UNION ALL SELECT 'edited_at'
    UNION ALL SELECT 'edit_reason'
  ) required
  LEFT JOIN information_schema.COLUMNS current_column
    ON current_column.TABLE_SCHEMA = DATABASE()
   AND current_column.TABLE_NAME = 'sales'
   AND current_column.COLUMN_NAME = required.column_name
  WHERE current_column.COLUMN_NAME IS NULL;

  IF missing_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Spare Parts recovery schema verification failed.';
  END IF;
END$$
DELIMITER ;
CALL chalin03_verify_recovery_spare_parts_hotfix();
DROP PROCEDURE IF EXISTS chalin03_verify_recovery_spare_parts_hotfix;
