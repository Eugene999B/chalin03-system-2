-- READ-ONLY VERIFICATION: PHASE 4 OPENING DEPOSIT AND RESERVATION INTEGRITY

SELECT migration_name
FROM schema_migrations
WHERE migration_name =
    '20260803_equipment_finance_phase4_deposit_reservation_integrity';

SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN (
      'trg_equipment_finance_payment_gate_before_insert',
      'trg_equipment_finance_reservation_gate_before_insert',
      'trg_equipment_finance_commitment_gate_before_update'
  )
ORDER BY TRIGGER_NAME;

SELECT INDEX_NAME,
       NON_UNIQUE,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_sale_payments'
  AND INDEX_NAME = 'uq_equipment_finance_payment_idempotency'
GROUP BY INDEX_NAME, NON_UNIQUE;

SELECT COUNT(*) AS invalid_controlled_reservations
FROM equipment_sale_agreements agreement
LEFT JOIN equipment_credit_applications application
  ON application.id = agreement.credit_application_id
WHERE agreement.activation_source = 'approved_credit_application'
  AND agreement.equipment_commitment_status = 'reserved'
  AND (
      application.application_status IS NULL
      OR application.application_status <> 'approved'
      OR agreement.agreement_status NOT IN ('active','due_soon','payment_due','overdue')
      OR agreement.deposit_received < agreement.deposit_required
      OR NOT EXISTS (
          SELECT 1
          FROM equipment_asset_sale_locks sale_lock
          WHERE sale_lock.agreement_id = agreement.id
            AND sale_lock.asset_id = agreement.asset_id
            AND (sale_lock.hire_location_id <=> agreement.hire_location_id)
            AND sale_lock.lock_status = 'installment_active'
            AND sale_lock.released_at IS NULL
      )
      OR EXISTS (
          SELECT 1
          FROM hire_contract_assets hire_asset
          WHERE hire_asset.asset_id = agreement.asset_id
            AND hire_asset.status IN ('assigned','dispatched','active')
      )
  );
