-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- COMPANY-WIDE STABILIZATION
-- ADDITIVE / FORWARD-ONLY MIGRATION.
-- Removes the legacy Hire-location dependency from Finance records,
-- adds one authoritative payment-interval model and preserves all case,
-- agreement, schedule, payment, document and audit rows.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS finance_stabilization_add_column_if_missing $$
CREATE PROCEDURE finance_stabilization_add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
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
        SET @finance_stabilization_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE finance_stabilization_stmt FROM @finance_stabilization_sql;
        EXECUTE finance_stabilization_stmt;
        DEALLOCATE PREPARE finance_stabilization_stmt;
    END IF;
END $$

DELIMITER ;

-- Finance is company-wide. Legacy location columns remain only for backwards
-- compatibility with the shared equipment tables and are nullable.
ALTER TABLE equipment_credit_applications
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_sales_quotations
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_sales_quotation_items
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_sale_agreements
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_asset_sale_locks
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_sale_payments
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_deliveries
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_ownership_transfers
    MODIFY COLUMN hire_location_id INT NULL;
ALTER TABLE equipment_sales_reminder_log
    MODIFY COLUMN hire_location_id INT NULL;

CALL finance_stabilization_add_column_if_missing(
    'equipment_sales_quotations',
    'proposed_interval_days',
    'SMALLINT UNSIGNED NULL AFTER proposed_frequency'
);
CALL finance_stabilization_add_column_if_missing(
    'equipment_sales_quotations',
    'proposed_non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER proposed_interval_days"
);
CALL finance_stabilization_add_column_if_missing(
    'equipment_credit_applications',
    'proposed_interval_days',
    'SMALLINT UNSIGNED NULL AFTER proposed_frequency'
);
CALL finance_stabilization_add_column_if_missing(
    'equipment_credit_applications',
    'proposed_non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER proposed_interval_days"
);
CALL finance_stabilization_add_column_if_missing(
    'equipment_credit_applications',
    'proposed_periodic_amount',
    'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER proposed_installment_amount'
);
CALL finance_stabilization_add_column_if_missing(
    'equipment_sale_agreements',
    'payment_interval_days',
    'SMALLINT UNSIGNED NULL AFTER payment_frequency'
);
CALL finance_stabilization_add_column_if_missing(
    'equipment_sale_agreements',
    'non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER payment_interval_days"
);

UPDATE equipment_sales_quotations
SET proposed_interval_days = CASE proposed_frequency
    WHEN 'weekly' THEN 7
    WHEN 'fortnightly' THEN 14
    WHEN 'monthly' THEN NULL
    ELSE COALESCE(NULLIF(proposed_interval_days, 0), 30)
END
WHERE proposed_frequency IS NOT NULL;

UPDATE equipment_credit_applications
SET proposed_interval_days = CASE proposed_frequency
        WHEN 'weekly' THEN 7
        WHEN 'fortnightly' THEN 14
        WHEN 'monthly' THEN NULL
        ELSE COALESCE(NULLIF(proposed_interval_days, 0), 30)
    END,
    proposed_periodic_amount = CASE
        WHEN proposed_installment_count > 0
            THEN ROUND(financed_amount / proposed_installment_count, 2)
        ELSE 0.00
    END;

UPDATE equipment_sale_agreements
SET payment_interval_days = CASE payment_frequency
    WHEN 'weekly' THEN 7
    WHEN 'fortnightly' THEN 14
    WHEN 'monthly' THEN NULL
    ELSE COALESCE(NULLIF(payment_interval_days, 0), 30)
END
WHERE sale_type = 'installment';

-- Remove the legacy Hire-location value only from Installment Finance cases.
-- Hire enquiries, contracts, jobs, invoices and ordinary Hire records are not
-- selected by these statements and keep their existing location values.
UPDATE equipment_sales_quotation_items item
INNER JOIN equipment_credit_applications application
    ON application.quotation_id = item.quotation_id
SET item.hire_location_id = NULL;

UPDATE equipment_sales_quotations quotation
INNER JOIN equipment_credit_applications application
    ON application.quotation_id = quotation.id
SET quotation.hire_location_id = NULL;

UPDATE equipment_asset_sale_locks sale_lock
INNER JOIN equipment_sale_agreements agreement
    ON agreement.id = sale_lock.agreement_id
SET sale_lock.hire_location_id = NULL
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application';

UPDATE equipment_sale_payments payment
INNER JOIN equipment_sale_agreements agreement
    ON agreement.id = payment.agreement_id
SET payment.hire_location_id = NULL
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application';

UPDATE equipment_deliveries delivery
INNER JOIN equipment_sale_agreements agreement
    ON agreement.id = delivery.agreement_id
SET delivery.hire_location_id = NULL
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application';

UPDATE equipment_ownership_transfers ownership_transfer
INNER JOIN equipment_sale_agreements agreement
    ON agreement.id = ownership_transfer.agreement_id
SET ownership_transfer.hire_location_id = NULL
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application';

UPDATE equipment_sales_reminder_log reminder
INNER JOIN equipment_sale_agreements agreement
    ON agreement.id = reminder.agreement_id
SET reminder.hire_location_id = NULL
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application';

UPDATE equipment_sale_agreements
SET hire_location_id = NULL
WHERE sale_type = 'installment'
  AND activation_source = 'approved_credit_application';

UPDATE equipment_credit_applications
SET hire_location_id = NULL;

DROP PROCEDURE IF EXISTS finance_stabilization_add_column_if_missing;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260801_equipment_finance_company_wide_stabilization',
    'Make Equipment Installment Finance company-wide, remove Finance Hire-location dependencies and add exact interval/date-rule fields.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
