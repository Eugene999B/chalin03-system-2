-- READ-ONLY VERIFICATION
-- Expected result for every problem count: 0.

SELECT COUNT(*) AS missing_activation_columns
FROM (
    SELECT 'equipment_sale_agreements' AS table_name, 'credit_application_id' AS column_name
    UNION ALL SELECT 'equipment_sale_agreements', 'activation_source'
    UNION ALL SELECT 'equipment_sale_agreements', 'equipment_commitment_status'
    UNION ALL SELECT 'equipment_credit_applications', 'agreement_id'
    UNION ALL SELECT 'equipment_credit_applications', 'agreement_activated_by'
    UNION ALL SELECT 'equipment_credit_applications', 'agreement_activated_at'
    UNION ALL SELECT 'equipment_credit_applications', 'agreement_activation_notes'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_activation_indexes
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'uq_equipment_sale_agreement_credit_application' AS index_name
    UNION ALL SELECT 'equipment_credit_applications', 'uq_equipment_credit_application_agreement'
    UNION ALL SELECT 'equipment_credit_applications', 'idx_equipment_credit_activation'
) required
LEFT JOIN information_schema.STATISTICS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.INDEX_NAME = required.index_name
WHERE actual.INDEX_NAME IS NULL;

SELECT COUNT(*) AS missing_activation_foreign_keys
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'fk_equipment_sale_agreement_credit_application' AS constraint_name
    UNION ALL SELECT 'equipment_credit_applications', 'fk_equipment_credit_application_agreement'
    UNION ALL SELECT 'equipment_credit_applications', 'fk_equipment_credit_application_activated_by'
) required
LEFT JOIN information_schema.TABLE_CONSTRAINTS actual
  ON actual.CONSTRAINT_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.CONSTRAINT_NAME = required.constraint_name
 AND actual.CONSTRAINT_TYPE = 'FOREIGN KEY'
WHERE actual.CONSTRAINT_NAME IS NULL;

SELECT COUNT(*) AS missing_activation_triggers
FROM (
    SELECT 'trg_equipment_installment_credit_gate_before_insert' AS trigger_name
    UNION ALL SELECT 'trg_equipment_installment_credit_gate_before_update'
) required
LEFT JOIN information_schema.TRIGGERS actual
  ON actual.TRIGGER_SCHEMA = DATABASE()
 AND actual.TRIGGER_NAME = required.trigger_name
WHERE actual.TRIGGER_NAME IS NULL;

SELECT COUNT(*) AS duplicate_credit_application_agreement_links
FROM (
    SELECT credit_application_id
    FROM equipment_sale_agreements
    WHERE credit_application_id IS NOT NULL
    GROUP BY credit_application_id
    HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS invalid_activated_credit_applications
FROM equipment_credit_applications application
LEFT JOIN equipment_sale_agreements agreement
  ON agreement.id = application.agreement_id
WHERE application.agreement_id IS NOT NULL
  AND (
      application.application_status <> 'approved'
      OR application.kyc_status <> 'verified'
      OR application.affordability_status NOT IN ('eligible','manual_review')
      OR agreement.id IS NULL
      OR agreement.credit_application_id <> application.id
      OR agreement.sale_type <> 'installment'
      OR agreement.hire_location_id <> application.hire_location_id
      OR agreement.quotation_id <> application.quotation_id
      OR agreement.customer_id <> application.customer_id
      OR agreement.asset_id <> application.asset_id
  );

SELECT COUNT(*) AS invalid_linked_finance_agreements
FROM equipment_sale_agreements agreement
LEFT JOIN equipment_credit_applications application
  ON application.id = agreement.credit_application_id
WHERE agreement.credit_application_id IS NOT NULL
  AND (
      agreement.sale_type <> 'installment'
      OR agreement.activation_source <> 'approved_credit_application'
      OR agreement.equipment_commitment_status <> 'not_reserved'
      OR application.id IS NULL
      OR application.agreement_id <> agreement.id
  );

SELECT COUNT(*) AS forbidden_hire_link_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('equipment_credit_applications','equipment_sale_agreements')
  AND COLUMN_NAME IN ('hire_contract_id','hire_job_id','hire_dispatch_id','hire_invoice_id','hire_return_id');

SELECT COUNT(*) AS activation_migration_record_missing
FROM (
    SELECT 1 AS expected
) marker
LEFT JOIN schema_migrations migration
  ON migration.migration_name = '20260729_equipment_finance_agreement_activation'
WHERE migration.id IS NULL;