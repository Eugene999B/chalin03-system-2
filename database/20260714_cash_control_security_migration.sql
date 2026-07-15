-- CHALIN 03 CASH CONTROL, DAILY CLOSING SECURITY AND SALE CHANGE EVIDENCE
-- Additive and idempotent. Does not delete or rewrite existing business records.
-- Run only after a verified backup and after selecting the intended database.

SELECT DATABASE() AS migration_target_database;

DELIMITER $$

DROP PROCEDURE IF EXISTS chalin03_require_selected_database $$
CREATE PROCEDURE chalin03_require_selected_database()
BEGIN
  IF DATABASE() IS NULL OR DATABASE() = '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'No database is selected. Select the Chalin 03 database before running this migration.';
  END IF;
END $$

CALL chalin03_require_selected_database() $$
DROP PROCEDURE IF EXISTS chalin03_require_selected_database $$

DROP PROCEDURE IF EXISTS chalin03_add_column_if_missing $$
CREATE PROCEDURE chalin03_add_column_if_missing(
  IN p_table VARCHAR(128),
  IN p_column VARCHAR(128),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @sql_text = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql_text;
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
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @sql_text = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_columns, ')');
    PREPARE stmt FROM @sql_text;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$


DROP PROCEDURE IF EXISTS chalin03_add_fk_if_missing $$
CREATE PROCEDURE chalin03_add_fk_if_missing(
  IN p_table VARCHAR(128),
  IN p_constraint VARCHAR(128),
  IN p_column VARCHAR(128),
  IN p_reference_table VARCHAR(128),
  IN p_reference_column VARCHAR(128),
  IN p_delete_rule VARCHAR(32)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND CONSTRAINT_NAME = p_constraint
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    SET @sql_text = CONCAT(
      'ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_constraint,
      '` FOREIGN KEY (`', p_column, '`) REFERENCES `', p_reference_table,
      '` (`', p_reference_column, '`) ON DELETE ', p_delete_rule
    );
    PREPARE stmt FROM @sql_text;
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

CALL chalin03_add_column_if_missing('expenses', 'payment_method', "ENUM('cash','momo','bank','other') NOT NULL DEFAULT 'cash' AFTER amount");
CALL chalin03_add_index_if_missing('expenses', 'idx_expense_payment_method', '`payment_method`');

CALL chalin03_add_column_if_missing('returns', 'return_type', "ENUM('stock_only','refund','exchange','store_credit') NOT NULL DEFAULT 'stock_only' AFTER reason");
CALL chalin03_add_column_if_missing('returns', 'refund_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER return_type');
CALL chalin03_add_column_if_missing('returns', 'refund_method', "ENUM('none','cash','momo','bank','other') NOT NULL DEFAULT 'none' AFTER refund_amount");
CALL chalin03_add_column_if_missing('returns', 'refund_reference', 'VARCHAR(180) NULL AFTER refund_method');
CALL chalin03_add_column_if_missing('returns', 'approved_by', 'INT NULL AFTER returned_by');
CALL chalin03_add_column_if_missing('returns', 'approved_at', 'DATETIME NULL AFTER approved_by');
CALL chalin03_add_index_if_missing('returns', 'idx_return_refund_method', '`refund_method`');
CALL chalin03_add_index_if_missing('returns', 'idx_return_approved_by', '`approved_by`');
CALL chalin03_add_fk_if_missing('returns', 'fk_return_approved_by', 'approved_by', 'users', 'id', 'SET NULL');

CALL chalin03_add_column_if_missing('daily_closings', 'opening_cash_float', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER closing_date');
CALL chalin03_add_column_if_missing('daily_closings', 'cash_deposits', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER opening_cash_float');
CALL chalin03_add_column_if_missing('daily_closings', 'cash_withdrawals', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER cash_deposits');
CALL chalin03_add_column_if_missing('daily_closings', 'other_cash_in', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER cash_withdrawals');
CALL chalin03_add_column_if_missing('daily_closings', 'other_cash_out', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER other_cash_in');
CALL chalin03_add_column_if_missing('daily_closings', 'denomination_total', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER total_counted');
CALL chalin03_add_column_if_missing('daily_closings', 'denomination_json', 'LONGTEXT NULL AFTER denomination_total');
CALL chalin03_add_column_if_missing('daily_closings', 'counted_confirmed', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER denomination_json');
CALL chalin03_add_column_if_missing('daily_closings', 'stale_after_close', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER counted_confirmed');
CALL chalin03_add_column_if_missing('daily_closings', 'stale_detected_at', 'DATETIME NULL AFTER stale_after_close');
CALL chalin03_add_column_if_missing('daily_closings', 'latest_revision_number', 'INT NOT NULL DEFAULT 1 AFTER stale_detected_at');
CALL chalin03_add_column_if_missing('daily_closings', 'verified_by', 'INT NULL AFTER closed_by');
CALL chalin03_add_column_if_missing('daily_closings', 'verified_at', 'DATETIME NULL AFTER verified_by');
CALL chalin03_add_column_if_missing('daily_closings', 'verification_status', "ENUM('submitted','verified','variance_review','revised') NOT NULL DEFAULT 'submitted' AFTER verified_at");
CALL chalin03_add_index_if_missing('daily_closings', 'idx_daily_closing_stale', '`stale_after_close`');
CALL chalin03_add_index_if_missing('daily_closings', 'idx_daily_closing_verified_by', '`verified_by`');
CALL chalin03_add_fk_if_missing('daily_closings', 'fk_daily_closing_verified_by', 'verified_by', 'users', 'id', 'SET NULL');

CREATE TABLE IF NOT EXISTS sale_payment_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,
  sale_id INT NOT NULL,
  payment_channel ENUM('cash','momo','bank','other') NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  recorded_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_allocation_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_allocation_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_allocation_user FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY unique_sale_payment_channel (sale_id, payment_channel),
  INDEX idx_sale_allocation_branch (branch_id),
  INDEX idx_sale_allocation_sale (sale_id),
  INDEX idx_sale_allocation_channel (payment_channel)
);

INSERT INTO sale_payment_allocations (branch_id, sale_id, payment_channel, amount, recorded_by)
SELECT
  s.branch_id,
  s.id,
  CASE
    WHEN s.payment_type = 'cash' THEN 'cash'
    WHEN s.payment_type = 'momo' THEN 'momo'
    WHEN s.payment_type = 'bank' THEN 'bank'
    ELSE 'other'
  END,
  LEAST(GREATEST(COALESCE(s.amount_paid, 0), 0), GREATEST(COALESCE(s.total, 0), 0)),
  s.staff_id
FROM sales s
LEFT JOIN sale_payment_allocations spa ON spa.sale_id = s.id
WHERE spa.id IS NULL
  AND COALESCE(s.amount_paid, 0) > 0;

CREATE TABLE IF NOT EXISTS sale_change_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,
  sale_id INT NOT NULL,
  change_type ENUM('edit','void','restore','correction') NOT NULL DEFAULT 'edit',
  reason TEXT NOT NULL,
  before_snapshot_json LONGTEXT NOT NULL,
  after_snapshot_json LONGTEXT NULL,
  changed_by INT NOT NULL,
  approved_by INT NOT NULL,
  affected_closing_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_change_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_change_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_sale_change_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_change_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sale_change_closing FOREIGN KEY (affected_closing_id) REFERENCES daily_closings(id) ON DELETE SET NULL,
  INDEX idx_sale_change_branch (branch_id),
  INDEX idx_sale_change_sale (sale_id),
  INDEX idx_sale_change_created (created_at),
  INDEX idx_sale_change_closing (affected_closing_id)
);

CREATE TABLE IF NOT EXISTS daily_closing_revisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  daily_closing_id INT NOT NULL,
  branch_id INT NOT NULL,
  closing_date DATE NOT NULL,
  revision_number INT NOT NULL,
  revision_type ENUM('original','post_closing_change','manager_revision') NOT NULL DEFAULT 'original',
  reason TEXT NULL,
  expected_snapshot_json LONGTEXT NOT NULL,
  counted_snapshot_json LONGTEXT NOT NULL,
  difference_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  source_entity_type VARCHAR(80) NULL,
  source_entity_id VARCHAR(80) NULL,
  changed_by INT NULL,
  approved_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_closing_revision_closing FOREIGN KEY (daily_closing_id) REFERENCES daily_closings(id) ON DELETE CASCADE,
  CONSTRAINT fk_closing_revision_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_closing_revision_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_closing_revision_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY unique_closing_revision (daily_closing_id, revision_number),
  INDEX idx_closing_revision_branch_date (branch_id, closing_date),
  INDEX idx_closing_revision_source (source_entity_type, source_entity_id)
);

INSERT INTO daily_closing_revisions (
  daily_closing_id,
  branch_id,
  closing_date,
  revision_number,
  revision_type,
  reason,
  expected_snapshot_json,
  counted_snapshot_json,
  difference_total,
  changed_by,
  approved_by
)
SELECT
  dc.id,
  dc.branch_id,
  dc.closing_date,
  1,
  'original',
  'Historical closing snapshot created during cash-control migration.',
  JSON_OBJECT(
    'cash', dc.expected_cash,
    'momo', dc.expected_momo,
    'bank', dc.expected_bank,
    'other', dc.expected_other,
    'total', dc.expected_total
  ),
  JSON_OBJECT(
    'cash', dc.cash_counted,
    'momo', dc.momo_counted,
    'bank', dc.bank_counted,
    'other', dc.other_counted,
    'total', dc.total_counted
  ),
  dc.difference_total,
  dc.closed_by,
  dc.verified_by
FROM daily_closings dc
LEFT JOIN daily_closing_revisions dcr
  ON dcr.daily_closing_id = dc.id AND dcr.revision_number = 1
WHERE dcr.id IS NULL;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260714_cash_control_security_migration',
  'Adds payment-channel allocations, protected refunds, manual cash-count evidence, sale-change history and Daily Closing revision controls.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

DROP PROCEDURE IF EXISTS chalin03_add_column_if_missing;
DROP PROCEDURE IF EXISTS chalin03_add_index_if_missing;
DROP PROCEDURE IF EXISTS chalin03_add_fk_if_missing;
