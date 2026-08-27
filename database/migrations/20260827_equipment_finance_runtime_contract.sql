-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- RUNTIME CONTRACT HARDENING: payment ENUMs, company-wide Finance location nullability,
-- and impossible pre-agreement installment dates.
-- Controlled production migration; forward-only and additive.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

SET @finance_contract_sql = 'ALTER TABLE `equipment_sale_payments` MODIFY COLUMN `payment_stage` ENUM(\'legacy\',\'opening_deposit\',\'installment_collection\',\'settlement\',\'adjustment\',\'refund\') NOT NULL DEFAULT \'legacy\'';
PREPARE finance_contract_stmt FROM @finance_contract_sql;
EXECUTE finance_contract_stmt;
DEALLOCATE PREPARE finance_contract_stmt;

SET @finance_contract_sql = 'ALTER TABLE `equipment_sale_payments` MODIFY COLUMN `reservation_effect` ENUM(\'none\',\'reserved\') NOT NULL DEFAULT \'none\'';
PREPARE finance_contract_stmt FROM @finance_contract_sql;
EXECUTE finance_contract_stmt;
DEALLOCATE PREPARE finance_contract_stmt;

SET @finance_contract_sql = 'ALTER TABLE `equipment_sale_payments` MODIFY COLUMN `hire_location_id` INT NULL';
PREPARE finance_contract_stmt FROM @finance_contract_sql;
EXECUTE finance_contract_stmt;
DEALLOCATE PREPARE finance_contract_stmt;

SET @finance_contract_sql = 'ALTER TABLE `equipment_asset_sale_locks` MODIFY COLUMN `hire_location_id` INT NULL';
PREPARE finance_contract_stmt FROM @finance_contract_sql;
EXECUTE finance_contract_stmt;
DEALLOCATE PREPARE finance_contract_stmt;

UPDATE equipment_sale_agreements agreement
LEFT JOIN equipment_credit_applications application
  ON application.id = agreement.credit_application_id
SET
  agreement.first_due_date = CASE
      WHEN agreement.first_due_date IS NULL OR agreement.first_due_date < DATE(agreement.created_at)
      THEN COALESCE(
        CASE
          WHEN application.proposed_first_due_date IS NOT NULL
           AND application.proposed_first_due_date >= DATE(agreement.created_at)
          THEN application.proposed_first_due_date
        END,
        DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
      )
      ELSE agreement.first_due_date
  END,
  agreement.next_due_date = CASE
      WHEN agreement.next_due_date IS NULL OR agreement.next_due_date < DATE(agreement.created_at)
      THEN COALESCE(
        CASE
          WHEN application.proposed_first_due_date IS NOT NULL
           AND application.proposed_first_due_date >= DATE(agreement.created_at)
          THEN application.proposed_first_due_date
        END,
        DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
      )
      ELSE agreement.next_due_date
  END,
  agreement.final_due_date = CASE
      WHEN agreement.final_due_date IS NULL OR agreement.final_due_date < DATE(agreement.created_at)
      THEN CASE
        WHEN agreement.installment_count IS NULL OR agreement.installment_count <= 1 THEN
          COALESCE(
            CASE
              WHEN application.proposed_first_due_date IS NOT NULL
               AND application.proposed_first_due_date >= DATE(agreement.created_at)
              THEN application.proposed_first_due_date
            END,
            DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
          )
        WHEN agreement.payment_frequency = 'weekly' THEN
          DATE_ADD(
            COALESCE(
              CASE
                WHEN application.proposed_first_due_date IS NOT NULL
                 AND application.proposed_first_due_date >= DATE(agreement.created_at)
                THEN application.proposed_first_due_date
              END,
              DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
            ), INTERVAL (agreement.installment_count - 1) * 7 DAY
          )
        WHEN agreement.payment_frequency = 'fortnightly' THEN
          DATE_ADD(
            COALESCE(
              CASE
                WHEN application.proposed_first_due_date IS NOT NULL
                 AND application.proposed_first_due_date >= DATE(agreement.created_at)
                THEN application.proposed_first_due_date
              END,
              DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
            ), INTERVAL (agreement.installment_count - 1) * 14 DAY
          )
        WHEN agreement.payment_frequency = 'custom' THEN
          DATE_ADD(
            COALESCE(
              CASE
                WHEN application.proposed_first_due_date IS NOT NULL
                 AND application.proposed_first_due_date >= DATE(agreement.created_at)
                THEN application.proposed_first_due_date
              END,
              DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
            ), INTERVAL (agreement.installment_count - 1) * COALESCE(agreement.payment_interval_days, 30) DAY
          )
        ELSE
          DATE_ADD(
            COALESCE(
              CASE
                WHEN application.proposed_first_due_date IS NOT NULL
                 AND application.proposed_first_due_date >= DATE(agreement.created_at)
                THEN application.proposed_first_due_date
              END,
              DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
            ), INTERVAL (agreement.installment_count - 1) MONTH
          )
      END
      ELSE agreement.final_due_date
  END
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application';

UPDATE equipment_installment_schedule schedule
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = schedule.agreement_id
LEFT JOIN equipment_credit_applications application
  ON application.id = agreement.credit_application_id
SET schedule.due_date = CASE
    WHEN agreement.payment_frequency = 'weekly' THEN
      DATE_ADD(
        COALESCE(
          CASE
            WHEN application.proposed_first_due_date IS NOT NULL
             AND application.proposed_first_due_date >= DATE(agreement.created_at)
            THEN application.proposed_first_due_date
          END,
          DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
        ), INTERVAL (schedule.sequence_number - 1) * 7 DAY
      )
    WHEN agreement.payment_frequency = 'fortnightly' THEN
      DATE_ADD(
        COALESCE(
          CASE
            WHEN application.proposed_first_due_date IS NOT NULL
             AND application.proposed_first_due_date >= DATE(agreement.created_at)
            THEN application.proposed_first_due_date
          END,
          DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
        ), INTERVAL (schedule.sequence_number - 1) * 14 DAY
      )
    WHEN agreement.payment_frequency = 'custom' THEN
      DATE_ADD(
        COALESCE(
          CASE
            WHEN application.proposed_first_due_date IS NOT NULL
             AND application.proposed_first_due_date >= DATE(agreement.created_at)
          THEN application.proposed_first_due_date
          END,
          DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
        ), INTERVAL (schedule.sequence_number - 1) * COALESCE(agreement.payment_interval_days, 30) DAY
      )
    ELSE
      DATE_ADD(
        COALESCE(
          CASE
            WHEN application.proposed_first_due_date IS NOT NULL
             AND application.proposed_first_due_date >= DATE(agreement.created_at)
            THEN application.proposed_first_due_date
          END,
          DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
        ), INTERVAL (schedule.sequence_number - 1) MONTH
      )
  END
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application'
  AND schedule.due_date < DATE(agreement.created_at);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260827_equipment_finance_runtime_contract',
  'Normalizes Finance payment ENUMs and company-wide location nullability and repairs impossible pre-agreement installment dates.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
