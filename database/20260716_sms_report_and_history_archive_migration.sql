-- CHALIN 03 RELEASE 1.2
-- Automatic Arkesel report mapping support and safe SMS-history archiving.
-- Additive only: preserves every existing SMS and audit record.

SET @db_name := DATABASE();

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='archived_at'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN archived_at DATETIME NULL AFTER last_status_at'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='archived_by'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN archived_by INT NULL AFTER archived_at'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='archive_reason'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN archive_reason VARCHAR(255) NULL AFTER archived_by'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND INDEX_NAME='idx_sms_branch_archived'),
  'SELECT 1',
  'CREATE INDEX idx_sms_branch_archived ON sms_log(branch_id, archived_at)'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
