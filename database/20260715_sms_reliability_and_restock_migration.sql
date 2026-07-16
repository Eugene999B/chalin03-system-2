-- CHALIN 03 RELEASE 1
-- SMS delivery evidence and professional product restock workflow
-- Safe migration: preserves existing business records.

SET @db_name := DATABASE();

-- ---------------------------------------------------------------------------
-- SMS LOG RELIABILITY
-- ---------------------------------------------------------------------------

ALTER TABLE sms_log
  MODIFY COLUMN status ENUM(
    'pending',
    'sent',
    'accepted',
    'delivered',
    'undelivered',
    'expired',
    'failed',
    'delivery_unknown'
  ) NOT NULL DEFAULT 'pending';

UPDATE sms_log
SET status = 'accepted'
WHERE status = 'sent';

ALTER TABLE sms_log
  MODIFY COLUMN status ENUM(
    'pending',
    'accepted',
    'delivered',
    'undelivered',
    'expired',
    'failed',
    'delivery_unknown'
  ) NOT NULL DEFAULT 'pending';

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='provider'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN provider VARCHAR(30) NULL AFTER status'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='sender_id'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN sender_id VARCHAR(20) NULL AFTER provider'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='provider_message_id'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN provider_message_id VARCHAR(191) NULL AFTER sender_id'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='provider_status'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN provider_status VARCHAR(80) NULL AFTER provider_message_id'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='status_reason'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN status_reason TEXT NULL AFTER provider_status'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='segment_count'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN segment_count INT NOT NULL DEFAULT 1 AFTER status_reason'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='estimated_credits'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN estimated_credits INT NOT NULL DEFAULT 1 AFTER segment_count'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='retry_count'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN retry_count INT NOT NULL DEFAULT 0 AFTER estimated_credits'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='original_log_id'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN original_log_id INT NULL AFTER retry_count'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='source_reference'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN source_reference VARCHAR(191) NULL AFTER original_log_id'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='submitted_at'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN submitted_at DATETIME NULL AFTER source_reference'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='delivery_confirmed_at'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN delivery_confirmed_at DATETIME NULL AFTER submitted_at'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='last_status_at'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN last_status_at DATETIME NULL AFTER delivery_confirmed_at'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND COLUMN_NAME='delivery_report_response'),
  'SELECT 1',
  'ALTER TABLE sms_log ADD COLUMN delivery_report_response TEXT NULL AFTER provider_response'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE sms_log
SET submitted_at = COALESCE(submitted_at, sent_at, created_at),
    last_status_at = COALESCE(last_status_at, sent_at, created_at)
WHERE submitted_at IS NULL OR last_status_at IS NULL;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND INDEX_NAME='idx_sms_provider_message_id'),
  'SELECT 1',
  'CREATE INDEX idx_sms_provider_message_id ON sms_log(provider_message_id)'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='sms_log' AND INDEX_NAME='idx_sms_original_log'),
  'SELECT 1',
  'CREATE INDEX idx_sms_original_log ON sms_log(original_log_id)'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- STOCK MOVEMENT / RESTOCK EVIDENCE
-- ---------------------------------------------------------------------------

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='movement_type'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN movement_type VARCHAR(40) NULL AFTER adjustment_type'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='source_name'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN source_name VARCHAR(150) NULL AFTER reason'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='reference_number'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN reference_number VARCHAR(120) NULL AFTER source_name'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='unit_cost'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN unit_cost DECIMAL(12,2) NULL AFTER reference_number'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='cost_price_before'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN cost_price_before DECIMAL(12,2) NULL AFTER unit_cost'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='cost_price_after'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN cost_price_after DECIMAL(12,2) NULL AFTER cost_price_before'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='movement_date'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN movement_date DATE NULL AFTER cost_price_after'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='notes'),
  'SELECT 1',
  'ALTER TABLE stock_adjustments ADD COLUMN notes TEXT NULL AFTER movement_date'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE stock_adjustments
SET movement_type = CASE
  WHEN adjustment_type = 'increase' THEN 'correction_increase'
  WHEN adjustment_type = 'decrease' THEN 'correction_decrease'
  WHEN adjustment_type = 'set' THEN 'physical_count'
  ELSE 'other'
END
WHERE movement_type IS NULL OR movement_type = '';

ALTER TABLE stock_adjustments
  MODIFY COLUMN movement_type VARCHAR(40) NOT NULL DEFAULT 'other';

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND INDEX_NAME='idx_stock_movement_type'),
  'SELECT 1',
  'CREATE INDEX idx_stock_movement_type ON stock_adjustments(movement_type)'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='stock_adjustments' AND INDEX_NAME='idx_stock_movement_date'),
  'SELECT 1',
  'CREATE INDEX idx_stock_movement_date ON stock_adjustments(movement_date)'
); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
