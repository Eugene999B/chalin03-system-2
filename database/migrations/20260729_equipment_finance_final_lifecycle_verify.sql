-- READ-ONLY VERIFICATION
-- Expected result for every problem count: 0.

SELECT COUNT(*) AS missing_final_lifecycle_columns
FROM (
    SELECT 'equipment_sale_agreements' AS table_name, 'controlled_delivery_completed_at' AS column_name
    UNION ALL SELECT 'equipment_sale_agreements', 'controlled_delivery_completed_by'
    UNION ALL SELECT 'equipment_sale_agreements', 'controlled_ownership_completed_at'
    UNION ALL SELECT 'equipment_sale_agreements', 'controlled_ownership_completed_by'
    UNION ALL SELECT 'equipment_deliveries', 'idempotency_key'
    UNION ALL SELECT 'equipment_deliveries', 'credit_application_id'
    UNION ALL SELECT 'equipment_deliveries', 'handover_stage'
    UNION ALL SELECT 'equipment_ownership_transfers', 'idempotency_key'
    UNION ALL SELECT 'equipment_ownership_transfers', 'credit_application_id'
    UNION ALL SELECT 'equipment_ownership_transfers', 'transfer_stage'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_final_lifecycle_indexes
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'idx_equipment_finance_final_lifecycle' AS index_name
    UNION ALL SELECT 'equipment_deliveries', 'uq_equipment_finance_delivery_idempotency'
    UNION ALL SELECT 'equipment_deliveries', 'idx_equipment_finance_delivery_application'
    UNION ALL SELECT 'equipment_ownership_transfers', 'uq_equipment_finance_ownership_idempotency'
    UNION ALL SELECT 'equipment_ownership_transfers', 'idx_equipment_finance_ownership_application'
) required
LEFT JOIN information_schema.STATISTICS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.INDEX_NAME = required.index_name
WHERE actual.INDEX_NAME IS NULL;

SELECT COUNT(*) AS missing_final_lifecycle_foreign_keys
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'fk_equipment_finance_delivery_completed_by' AS constraint_name
    UNION ALL SELECT 'equipment_sale_agreements', 'fk_equipment_finance_ownership_completed_by'
    UNION ALL SELECT 'equipment_deliveries', 'fk_equipment_finance_delivery_application'
    UNION ALL SELECT 'equipment_ownership_transfers', 'fk_equipment_finance_ownership_application'
) required
LEFT JOIN information_schema.TABLE_CONSTRAINTS actual
  ON actual.CONSTRAINT_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.CONSTRAINT_NAME = required.constraint_name
 AND actual.CONSTRAINT_TYPE = 'FOREIGN KEY'
WHERE actual.CONSTRAINT_NAME IS NULL;

SELECT COUNT(*) AS missing_final_lifecycle_triggers
FROM (
    SELECT 'trg_equipment_finance_payment_gate_before_insert' AS trigger_name
    UNION ALL SELECT 'trg_equipment_finance_delivery_gate_before_insert'
    UNION ALL SELECT 'trg_equipment_finance_ownership_gate_before_insert'
    UNION ALL SELECT 'trg_equipment_finance_lifecycle_agreement_before_update'
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
  AND payment.payment_stage NOT IN (
      'opening_deposit',
      'installment_collection',
      'settlement'
  );

SELECT COUNT(*) AS invalid_controlled_finance_collections
FROM equipment_sale_payments payment
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = payment.agreement_id
WHERE agreement.activation_source = 'approved_credit_application'
  AND payment.payment_stage IN ('installment_collection','settlement')
  AND (
      payment.credit_application_id IS NULL
      OR payment.credit_application_id <> agreement.credit_application_id
      OR payment.hire_location_id <> agreement.hire_location_id
      OR payment.customer_id <> agreement.customer_id
      OR payment.idempotency_key IS NULL
      OR CHAR_LENGTH(TRIM(payment.idempotency_key)) < 20
      OR payment.reservation_effect <> 'none'
      OR payment.amount <= 0
      OR (payment.payment_stage = 'installment_collection'
          AND payment.payment_category <> 'installment')
      OR (payment.payment_stage = 'settlement'
          AND payment.payment_category <> 'settlement')
  );

SELECT COUNT(*) AS invalid_controlled_finance_deliveries
FROM equipment_deliveries delivery
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = delivery.agreement_id
WHERE agreement.activation_source = 'approved_credit_application'
  AND (
      delivery.handover_stage <> 'finance_controlled'
      OR delivery.credit_application_id IS NULL
      OR delivery.credit_application_id <> agreement.credit_application_id
      OR delivery.hire_location_id <> agreement.hire_location_id
      OR delivery.customer_id <> agreement.customer_id
      OR delivery.asset_id <> agreement.asset_id
      OR delivery.idempotency_key IS NULL
      OR CHAR_LENGTH(TRIM(delivery.idempotency_key)) < 20
      OR delivery.status <> 'delivered'
  );

SELECT COUNT(*) AS invalid_controlled_finance_ownership_transfers
FROM equipment_ownership_transfers ownership
INNER JOIN equipment_sale_agreements agreement
  ON agreement.id = ownership.agreement_id
WHERE agreement.activation_source = 'approved_credit_application'
  AND (
      ownership.transfer_stage <> 'finance_controlled'
      OR ownership.credit_application_id IS NULL
      OR ownership.credit_application_id <> agreement.credit_application_id
      OR ownership.hire_location_id <> agreement.hire_location_id
      OR ownership.customer_id <> agreement.customer_id
      OR ownership.asset_id <> agreement.asset_id
      OR ownership.idempotency_key IS NULL
      OR CHAR_LENGTH(TRIM(ownership.idempotency_key)) < 20
      OR ownership.status <> 'issued'
      OR agreement.outstanding_balance > 0.01
      OR agreement.delivery_status <> 'delivered'
  );

SELECT COUNT(*) AS uncontrolled_finance_delivery_statuses
FROM equipment_sale_agreements agreement
LEFT JOIN equipment_deliveries delivery
  ON delivery.agreement_id = agreement.id
 AND delivery.handover_stage = 'finance_controlled'
 AND delivery.status = 'delivered'
WHERE agreement.activation_source = 'approved_credit_application'
  AND agreement.delivery_status = 'delivered'
  AND (
      agreement.controlled_delivery_completed_at IS NULL
      OR agreement.controlled_delivery_completed_by IS NULL
      OR delivery.id IS NULL
  );

SELECT COUNT(*) AS uncontrolled_finance_ownership_statuses
FROM equipment_sale_agreements agreement
LEFT JOIN equipment_ownership_transfers ownership
  ON ownership.agreement_id = agreement.id
 AND ownership.transfer_stage = 'finance_controlled'
 AND ownership.status = 'issued'
WHERE agreement.activation_source = 'approved_credit_application'
  AND agreement.ownership_status = 'transferred'
  AND (
      agreement.controlled_ownership_completed_at IS NULL
      OR agreement.controlled_ownership_completed_by IS NULL
      OR agreement.outstanding_balance > 0.01
      OR agreement.delivery_status <> 'delivered'
      OR ownership.id IS NULL
  );

SELECT COUNT(*) AS controlled_finance_assets_active_on_hire
FROM equipment_sale_agreements agreement
INNER JOIN hire_contract_assets hire_asset
  ON hire_asset.asset_id = agreement.asset_id
 AND hire_asset.status IN ('assigned','dispatched','active')
WHERE agreement.activation_source = 'approved_credit_application'
  AND agreement.equipment_commitment_status = 'reserved';
