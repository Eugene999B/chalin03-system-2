-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- RUNTIME CONTRACT HARDENING
-- Controlled production migration; forward-only.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

-- Normalize legacy enum values before replacing the enum definitions.
UPDATE equipment_sale_payments
SET payment_stage = CASE
  WHEN CAST(payment_stage AS CHAR) IN ('legacy','opening_deposit','installment_collection','settlement','adjustment','refund')
    THEN payment_stage ELSE 'legacy' END;

UPDATE equipment_sale_payments
SET reservation_effect = CASE
  WHEN CAST(reservation_effect AS CHAR) IN ('none','reserved')
    THEN reservation_effect ELSE 'none' END;

ALTER TABLE equipment_sale_payments
  MODIFY COLUMN payment_stage ENUM('legacy','opening_deposit','installment_collection','settlement','adjustment','refund') NOT NULL DEFAULT 'legacy',
  MODIFY COLUMN reservation_effect ENUM('none','reserved') NOT NULL DEFAULT 'none',
  MODIFY COLUMN hire_location_id INT NULL;

ALTER TABLE equipment_asset_sale_locks
  MODIFY COLUMN hire_location_id INT NULL;

ALTER TABLE equipment_sale_agreements
  MODIFY COLUMN hire_location_id INT NULL;

-- Existing corrupted agreements/schedule rows may carry a date before the agreement itself.
-- Repair only impossible pre-agreement dates; legitimate overdue dates remain unchanged.
UPDATE equipment_sale_agreements agreement
LEFT JOIN equipment_credit_applications application
  ON application.id = agreement.credit_application_id
SET agreement.first_due_date = COALESCE(
      CASE
        WHEN application.proposed_first_due_date IS NOT NULL
         AND application.proposed_first_due_date >= DATE(agreement.created_at)
        THEN application.proposed_first_due_date
      END,
      DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
    )
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application'
  AND agreement.first_due_date < DATE(agreement.created_at);

UPDATE equipment_installment_schedule schedule
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = schedule.agreement_id
LEFT JOIN equipment_credit_applications application
  ON application.id = agreement.credit_application_id
SET schedule.due_date = CASE
  WHEN agreement.payment_frequency = 'weekly' THEN DATE_ADD(
    COALESCE(
      CASE
        WHEN application.proposed_first_due_date IS NOT NULL
         AND application.proposed_first_due_date >= DATE(agreement.created_at)
        THEN application.proposed_first_due_date
      END,
      DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
    ), INTERVAL (schedule.sequence_number - 1) * 7 DAY
  )
  WHEN agreement.payment_frequency = 'fortnightly' THEN DATE_ADD(
    COALESCE(
      CASE
        WHEN application.proposed_first_due_date IS NOT NULL
         AND application.proposed_first_due_date >= DATE(agreement.created_at)
        THEN application.proposed_first_due_date
      END,
      DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
    ), INTERVAL (schedule.sequence_number - 1) * 14 DAY
  )
  WHEN agreement.payment_frequency = 'custom' THEN DATE_ADD(
    COALESCE(
      CASE
        WHEN application.proposed_first_due_date IS NOT NULL
         AND application.proposed_first_due_date >= DATE(agreement.created_at)
        THEN application.proposed_first_due_date
      END,
      DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
    ), INTERVAL (schedule.sequence_number - 1) * COALESCE(agreement.payment_interval_days, 30) DAY
  )
  ELSE DATE_ADD(
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

UPDATE equipment_sale_agreements agreement
LEFT JOIN (
  SELECT
    schedule.agreement_id,
    MIN(schedule.due_date) AS min_due_date,
    MAX(schedule.due_date) AS max_due_date
  FROM equipment_installment_schedule schedule
  WHERE schedule.schedule_status <> 'rescheduled'
  GROUP BY schedule.agreement_id
) schedule_summary
  ON schedule_summary.agreement_id = agreement.id
SET agreement.next_due_date = COALESCE(schedule_summary.min_due_date, agreement.first_due_date),
    agreement.final_due_date = COALESCE(schedule_summary.max_due_date, agreement.final_due_date)
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application';

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260827_equipment_finance_runtime_contract',
  'Normalizes legacy Finance payment enums, company-wide Finance location nullability, and impossible pre-agreement installment dates.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
