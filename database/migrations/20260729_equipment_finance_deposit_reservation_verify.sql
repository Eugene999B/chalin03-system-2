-- READ-ONLY VERIFICATION
-- Expected result for every problem count: 0.

SELECT COUNT(*) AS missing_deposit_reservation_columns
FROM (
    SELECT 'equipment_sale_agreements' AS table_name, 'deposit_completed_at' AS column_name
    UNION ALL SELECT 'equipment_sale_agreements', 'deposit_completed_by'
    UNION ALL SELECT 'equipment_sale_agreements', 'reservation_activated_at'
    UNION ALL SELECT 'equipment_sale_agreements', 'reservation_activated_by'
    UNION ALL SELECT 'equipment_sale_payments', 'idempotency_key'
    UNION ALL SELECT 'equipment_sale_payments', 'credit_application_id'
    UNION ALL SELECT 'equipment_sale_payments', 'payment_stage'
    UNION ALL SELECT 'equipment_sale_payments', 'reservation_effect'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_deposit_reservation_indexes
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'idx_equipment_finance_deposit_reservation' AS index_name
    UNION ALL SELECT 'equipment_sale_payments', 'uq_equipment_finance_payment_idempotency'
    UNION ALL SELECT 'equipment_sale_payments', 'idx_equipment_finance_payment_stage'
    UNION ALL SELECT 'equipment_sale_payments', 'idx_equipment_finance_payment_application'
) required
LEFT JOIN information_schema.STATISTICS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.INDEX_NAME = required.index_name
WHERE actual.INDEX_NAME IS NULL;

SELECT COUNT(*) AS missing_deposit_reservation_foreign_keys
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'fk_equipment_finance_deposit_completed_by' AS constraint_name
    UNION ALL SELECT 'equipment_sale_agreements', 'fk_equipment_finance_reservation_activated_by'
    UNION ALL SELECT 'equipment_sale_payments', 'fk_equipment_finance_payment_credit_application'
) required
LEFT JOIN information_schema.TABLE_CONSTRAINTS actual
  ON actual.CONSTRAINT_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.CONSTRAINT_NAME = required.constraint_name
 AND actual.CONSTRAINT_TYPE = 'FOREIGN KEY'
WHERE actual.CONSTRAINT_NAME IS NULL;

SELECT COUNT(*) AS missing_deposit_reservation_triggers
FROM (
    SELECT 'trg_equipment_finance_payment_gate_before_insert' AS trigger_name
    UNION ALL SELECT 'trg_equipment_finance_reservation_gate_before_insert'
    UNION ALL SELECT 'trg_equipment_finance_commitment_gate_before_update'
) required
LEFT JOIN information_schema.TRIGGERS actual
  ON actual.TRIGGER_SCHEMA = DATABASE()
 AND actual.TRIGGER_NAME = required.trigger_name
WHERE actual.TRIGGER_NAME IS NULL;

SELECT COUNT(*) AS bypassed_controlled_finance_payments
FROM equipment_sale_payments payment
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = payment.agreement_id
WHERE agreement.activation_source = 'approved_credit_application'
  AND payment.payment_stage = 'legacy';

SELECT COUNT(*) AS invalid_opening_deposit_payments
FROM equipment_sale_payments payment
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = payment.agreement_id
WHERE payment.payment_stage = 'opening_deposit'
  AND (
      agreement.activation_source <> 'approved_credit_application'
      OR payment.payment_category <> 'deposit'
      OR payment.credit_application_id IS NULL
      OR payment.credit_application_id <> agreement.credit_application_id
      OR payment.hire_location_id <> agreement.hire_location_id
      OR payment.customer_id <> agreement.customer_id
      OR payment.amount <= 0
      OR payment.is_voided <> FALSE
  );

SELECT COUNT(*) AS invalid_controlled_deposit_balances
FROM equipment_sale_agreements agreement
LEFT JOIN (
    SELECT payment.agreement_id,
           COALESCE(SUM(payment.amount), 0) AS opening_deposit_total
    FROM equipment_sale_payments payment
    WHERE payment.payment_stage = 'opening_deposit'
      AND payment.payment_category = 'deposit'
      AND payment.is_voided = FALSE
    GROUP BY payment.agreement_id
) deposit_total
  ON deposit_total.agreement_id = agreement.id
WHERE agreement.activation_source = 'approved_credit_application'
  AND (
      ABS(agreement.deposit_received - COALESCE(deposit_total.opening_deposit_total, 0)) > 0.01
      OR agreement.deposit_received > agreement.deposit_required + 0.01
      OR agreement.amount_paid + 0.01 < agreement.deposit_received
  );

SELECT COUNT(*) AS invalid_reserved_finance_agreements
FROM equipment_sale_agreements agreement
LEFT JOIN equipment_asset_sale_locks sale_lock
  ON sale_lock.agreement_id = agreement.id
 AND sale_lock.asset_id = agreement.asset_id
 AND sale_lock.hire_location_id = agreement.hire_location_id
 AND sale_lock.lock_status = 'installment_active'
 AND sale_lock.released_at IS NULL
WHERE agreement.activation_source = 'approved_credit_application'
  AND (
      (
          agreement.equipment_commitment_status = 'reserved'
          AND (
              agreement.deposit_received + 0.01 < agreement.deposit_required
              OR sale_lock.agreement_id IS NULL
              OR agreement.reservation_activated_at IS NULL
              OR agreement.reservation_activated_by IS NULL
          )
      )
      OR (
          agreement.agreement_status IN ('active','due_soon','payment_due','overdue')
          AND agreement.equipment_commitment_status <> 'reserved'
      )
  );

SELECT COUNT(*) AS invalid_controlled_finance_sale_locks
FROM equipment_asset_sale_locks sale_lock
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = sale_lock.agreement_id
WHERE agreement.activation_source = 'approved_credit_application'
  AND sale_lock.released_at IS NULL
  AND (
      sale_lock.asset_id <> agreement.asset_id
      OR sale_lock.hire_location_id <> agreement.hire_location_id
      OR sale_lock.lock_status <> 'installment_active'
      OR agreement.deposit_received + 0.01 < agreement.deposit_required
      OR agreement.equipment_commitment_status <> 'reserved'
  );

SELECT COUNT(*) AS reserved_finance_assets_active_on_hire
FROM equipment_sale_agreements agreement
INNER JOIN hire_contract_assets hire_asset
  ON hire_asset.asset_id = agreement.asset_id
 AND hire_asset.status IN ('assigned','dispatched','active')
WHERE agreement.activation_source = 'approved_credit_application'
  AND agreement.equipment_commitment_status = 'reserved';

SELECT COUNT(*) AS forbidden_deposit_hire_link_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('equipment_sale_agreements','equipment_sale_payments')
  AND COLUMN_NAME IN (
      'hire_contract_id','hire_job_id','hire_dispatch_id','hire_invoice_id',
      'hire_payment_id','hire_return_id','hire_worker_assignment_id'
  );

SELECT COUNT(*) AS deposit_reservation_migration_record_missing
FROM (
    SELECT 1 AS expected
) marker
LEFT JOIN schema_migrations migration
  ON migration.migration_name = '20260729_equipment_finance_deposit_reservation'
WHERE migration.id IS NULL;
