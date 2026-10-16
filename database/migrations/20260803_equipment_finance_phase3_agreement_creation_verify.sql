-- CHALIN 03 PRODUCTION MIGRATION VERIFICATION
-- READ-ONLY. Do not add mutating statements.

SELECT
    CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END
        AS phase3_agreement_migration_record_missing
FROM schema_migrations
WHERE migration_name = '20260803_equipment_finance_phase3_agreement_creation';

SELECT
    GREATEST(2 - COUNT(*), 0) AS missing_phase3_agreement_triggers
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN (
      'trg_equipment_installment_credit_gate_before_insert',
      'trg_equipment_installment_credit_gate_before_update'
  );

SELECT
    COUNT(*) AS legacy_optional_activation_gate_fragments
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN (
      'trg_equipment_installment_credit_gate_before_insert',
      'trg_equipment_installment_credit_gate_before_update'
  )
  AND (
      LOWER(ACTION_STATEMENT) LIKE '%kyc_status%'
      OR LOWER(ACTION_STATEMENT) LIKE '%affordability_status%'
      OR LOWER(ACTION_STATEMENT) LIKE '%application.hire_location_id%'
  );

SELECT
    GREATEST(2 - COUNT(*), 0) AS missing_company_wide_approval_gate_fragments
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN (
      'trg_equipment_installment_credit_gate_before_insert',
      'trg_equipment_installment_credit_gate_before_update'
  )
  AND LOWER(ACTION_STATEMENT) LIKE '%application_status%approved%'
  AND LOWER(ACTION_STATEMENT) LIKE '%new.hire_location_id%is not null%'
  AND LOWER(ACTION_STATEMENT) LIKE '%credit_application_id%';

SELECT
    CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END
        AS missing_unique_credit_application_agreement_index
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_sale_agreements'
  AND INDEX_NAME = 'uq_equipment_sale_agreement_credit_application'
  AND NON_UNIQUE = 0;


