-- READ-ONLY VERIFICATION FOR
-- 20260729_equipment_credit_application_foundation

SELECT migration_name, applied_at
FROM schema_migrations
WHERE migration_name = '20260729_equipment_credit_application_foundation';

SELECT COUNT(*) AS missing_credit_tables
FROM (
    SELECT 'equipment_credit_applications' AS table_name
    UNION ALL SELECT 'equipment_credit_application_kyc'
    UNION ALL SELECT 'equipment_credit_application_decisions'
) required
LEFT JOIN information_schema.TABLES actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_TYPE = 'BASE TABLE'
 AND actual.TABLE_NAME = required.table_name
WHERE actual.TABLE_NAME IS NULL;

SELECT COUNT(*) AS missing_credit_columns
FROM (
    SELECT 'equipment_credit_applications' AS table_name, 'application_number' AS column_name
    UNION ALL SELECT 'equipment_credit_applications', 'hire_location_id'
    UNION ALL SELECT 'equipment_credit_applications', 'customer_id'
    UNION ALL SELECT 'equipment_credit_applications', 'quotation_id'
    UNION ALL SELECT 'equipment_credit_applications', 'asset_id'
    UNION ALL SELECT 'equipment_credit_applications', 'application_status'
    UNION ALL SELECT 'equipment_credit_applications', 'kyc_status'
    UNION ALL SELECT 'equipment_credit_applications', 'affordability_status'
    UNION ALL SELECT 'equipment_credit_applications', 'risk_band'
    UNION ALL SELECT 'equipment_credit_applications', 'risk_score'
    UNION ALL SELECT 'equipment_credit_applications', 'financed_amount'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_installment_amount'
    UNION ALL SELECT 'equipment_credit_applications', 'total_monthly_income'
    UNION ALL SELECT 'equipment_credit_applications', 'net_monthly_surplus'
    UNION ALL SELECT 'equipment_credit_applications', 'debt_service_ratio_percent'
    UNION ALL SELECT 'equipment_credit_applications', 'decision_version'
    UNION ALL SELECT 'equipment_credit_application_kyc', 'application_id'
    UNION ALL SELECT 'equipment_credit_application_kyc', 'id_type'
    UNION ALL SELECT 'equipment_credit_application_kyc', 'id_number'
    UNION ALL SELECT 'equipment_credit_application_kyc', 'identity_verified'
    UNION ALL SELECT 'equipment_credit_application_kyc', 'income_verified'
    UNION ALL SELECT 'equipment_credit_application_kyc', 'customer_consent_confirmed'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'application_id'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'decision_version'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'action_type'
    UNION ALL SELECT 'equipment_credit_application_decisions', 'snapshot_json'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS invalid_credit_application_rows
FROM equipment_credit_applications
WHERE quoted_total < 0
   OR proposed_deposit < 0
   OR financed_amount < 0
   OR proposed_installment_amount < 0
   OR monthly_salary_income < 0
   OR monthly_business_income < 0
   OR monthly_other_income < 0
   OR monthly_business_costs < 0
   OR monthly_household_expenses < 0
   OR existing_monthly_debt < 0
   OR risk_score > 100
   OR decision_version < 0;

SELECT
    (SELECT COUNT(*)
     FROM equipment_credit_application_kyc kyc
     LEFT JOIN equipment_credit_applications application
       ON application.id = kyc.application_id
     WHERE application.id IS NULL)
    +
    (SELECT COUNT(*)
     FROM equipment_credit_application_decisions decision_log
     LEFT JOIN equipment_credit_applications application
       ON application.id = decision_log.application_id
     WHERE application.id IS NULL) AS orphan_credit_evidence_rows;
