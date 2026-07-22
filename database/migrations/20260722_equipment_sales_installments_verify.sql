-- CHALIN 03 EQUIPMENT SALES & HIRE FOUNDATION
-- READ-ONLY VERIFICATION. This file does not modify data or schema.

SELECT DATABASE() AS selected_database;

SELECT
    migration_name,
    applied_at,
    description
FROM schema_migrations
WHERE migration_name = '20260722_equipment_sales_installments_foundation';

SELECT
    COUNT(*) AS expected_equipment_sales_tables_found
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
  AND TABLE_NAME IN (
    'equipment_media',
    'equipment_sales_enquiries',
    'equipment_sales_quotations',
    'equipment_sales_quotation_items',
    'equipment_sale_agreements',
    'equipment_asset_sale_locks',
    'equipment_installment_schedule',
    'equipment_sale_payments',
    'equipment_sale_payment_allocations',
    'equipment_deliveries',
    'equipment_ownership_transfers',
    'equipment_sales_reminder_log',
    'equipment_legacy_installment_migrations'
  );

SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'fleet_assets' AND COLUMN_NAME IN (
      'hire_location_id',
      'equipment_category',
      'model_year',
      'chassis_number',
      'engine_number',
      'condition_status',
      'operational_purpose',
      'sale_status',
      'acquisition_cost',
      'target_selling_price',
      'standard_hire_rate',
      'main_image_url'
    ))
    OR
    (TABLE_NAME = 'sms_log' AND COLUMN_NAME IN (
      'workspace_code',
      'business_unit_id',
      'hire_location_id',
      'entity_type',
      'entity_id',
      'template_code',
      'deduplication_key',
      'scheduled_for',
      'consent_basis'
    ))
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT
    TRIGGER_NAME,
    EVENT_MANIPULATION,
    EVENT_OBJECT_TABLE,
    ACTION_TIMING
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN (
    'trg_hire_contract_asset_sale_guard_before_insert',
    'trg_hire_contract_asset_sale_guard_before_update',
    'trg_equipment_sale_agreement_hire_guard_before_insert',
    'trg_equipment_sale_agreement_hire_guard_before_update'
  )
ORDER BY TRIGGER_NAME;

SELECT
    COUNT(*) AS orphan_equipment_media
FROM equipment_media em
LEFT JOIN fleet_assets fa ON fa.id = em.asset_id
WHERE fa.id IS NULL;

SELECT
    COUNT(*) AS orphan_equipment_sales_enquiries
FROM equipment_sales_enquiries ese
LEFT JOIN hire_customers hc ON hc.id = ese.customer_id
LEFT JOIN business_locations bl ON bl.id = ese.hire_location_id
WHERE hc.id IS NULL OR bl.id IS NULL;

SELECT
    COUNT(*) AS orphan_equipment_sales_quotes
FROM equipment_sales_quotations esq
LEFT JOIN hire_customers hc ON hc.id = esq.customer_id
LEFT JOIN business_locations bl ON bl.id = esq.hire_location_id
WHERE hc.id IS NULL OR bl.id IS NULL;

SELECT
    COUNT(*) AS orphan_equipment_sale_agreements
FROM equipment_sale_agreements esa
LEFT JOIN hire_customers hc ON hc.id = esa.customer_id
LEFT JOIN fleet_assets fa ON fa.id = esa.asset_id
LEFT JOIN business_locations bl ON bl.id = esa.hire_location_id
WHERE hc.id IS NULL OR fa.id IS NULL OR bl.id IS NULL;

SELECT
    COUNT(*) AS duplicate_equipment_document_numbers
FROM (
    SELECT quotation_number AS document_number
    FROM equipment_sales_quotations
    GROUP BY quotation_number
    HAVING COUNT(*) > 1

    UNION ALL

    SELECT agreement_number AS document_number
    FROM equipment_sale_agreements
    GROUP BY agreement_number
    HAVING COUNT(*) > 1

    UNION ALL

    SELECT receipt_number AS document_number
    FROM equipment_sale_payments
    GROUP BY receipt_number
    HAVING COUNT(*) > 1

    UNION ALL

    SELECT delivery_number AS document_number
    FROM equipment_deliveries
    GROUP BY delivery_number
    HAVING COUNT(*) > 1

    UNION ALL

    SELECT transfer_number AS document_number
    FROM equipment_ownership_transfers
    GROUP BY transfer_number
    HAVING COUNT(*) > 1
) duplicate_documents;

SELECT
    COUNT(*) AS active_hire_and_sale_conflicts
FROM hire_contract_assets hca
INNER JOIN equipment_asset_sale_locks easl
    ON easl.asset_id = hca.asset_id
   AND easl.released_at IS NULL
WHERE hca.status IN ('assigned', 'dispatched', 'active');

SELECT
    COUNT(*) AS inconsistent_asset_sale_states
FROM equipment_asset_sale_locks easl
INNER JOIN fleet_assets fa ON fa.id = easl.asset_id
WHERE easl.released_at IS NULL
  AND (
    (easl.lock_status = 'reserved' AND fa.sale_status <> 'reserved')
    OR (easl.lock_status = 'installment_active' AND fa.sale_status <> 'installment_active')
    OR (easl.lock_status = 'sold' AND fa.sale_status <> 'sold')
  );

SELECT
    COUNT(*) AS installment_schedule_total_mismatches
FROM equipment_sale_agreements esa
WHERE esa.sale_type = 'installment'
  AND ABS(
    esa.scheduled_total - COALESCE((
      SELECT SUM(eis.scheduled_amount + eis.late_charge_amount - eis.waived_charge_amount)
      FROM equipment_installment_schedule eis
      WHERE eis.agreement_id = esa.id
        AND eis.schedule_status <> 'cancelled'
    ), 0)
  ) > 0.01;

SELECT
    COUNT(*) AS installment_payment_allocation_mismatches
FROM equipment_sale_payments esp
WHERE esp.is_voided = FALSE
  AND esp.payment_category IN ('installment', 'settlement')
  AND ABS(
    esp.amount - COALESCE((
      SELECT SUM(espa.allocated_amount)
      FROM equipment_sale_payment_allocations espa
      WHERE espa.payment_id = esp.id
    ), 0)
  ) > 0.01;
