-- READ-ONLY VERIFIER: PROFESSIONAL EQUIPMENT INSTALLMENT FINANCE
-- Every problem count must be exactly 0 before production is accepted.

SELECT COUNT(*) AS missing_professional_finance_tables
FROM (
    SELECT 'equipment_finance_settings' AS table_name
    UNION ALL SELECT 'equipment_finance_settings_history'
    UNION ALL SELECT 'equipment_finance_document_signatures'
    UNION ALL SELECT 'equipment_finance_issued_documents'
    UNION ALL SELECT 'equipment_finance_payment_alerts'
) required
LEFT JOIN information_schema.TABLES actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
WHERE actual.TABLE_NAME IS NULL;

SELECT COUNT(*) AS missing_professional_finance_columns
FROM (
    SELECT 'fleet_assets' AS table_name, 'registration_number' AS column_name
    UNION ALL SELECT 'fleet_assets', 'customs_reference'
    UNION ALL SELECT 'fleet_assets', 'title_document_reference'
    UNION ALL SELECT 'fleet_assets', 'insurance_reference'
    UNION ALL SELECT 'fleet_assets', 'minimum_selling_price'
    UNION ALL SELECT 'equipment_sale_agreements', 'terms_version'
    UNION ALL SELECT 'equipment_sale_agreements', 'agreement_document_number'
    UNION ALL SELECT 'equipment_sale_agreements', 'agreement_issued_at'
    UNION ALL SELECT 'equipment_sale_agreements', 'agreement_signed_at'
    UNION ALL SELECT 'equipment_finance_settings', 'boss_payment_alert_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'boss_payment_alert_phone'
    UNION ALL SELECT 'equipment_finance_settings', 'automatic_reminders_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'payment_allocation_policy'
    UNION ALL SELECT 'equipment_finance_settings', 'advance_excess_to_future'
    UNION ALL SELECT 'equipment_finance_settings', 'legal_review_status'
    UNION ALL SELECT 'equipment_finance_settings', 'agreement_terms'
    UNION ALL SELECT 'equipment_finance_issued_documents', 'snapshot_json'
    UNION ALL SELECT 'equipment_finance_issued_documents', 'snapshot_checksum'
    UNION ALL SELECT 'equipment_finance_payment_alerts', 'alert_status'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_professional_finance_indexes
FROM (
    SELECT 'fleet_assets' AS table_name, 'idx_finance_machine_registration' AS index_name
    UNION ALL SELECT 'equipment_sale_agreements', 'idx_finance_agreement_document'
    UNION ALL SELECT 'equipment_finance_document_signatures', 'uq_finance_signature_agreement_role'
    UNION ALL SELECT 'equipment_finance_issued_documents', 'idx_finance_document_agreement'
    UNION ALL SELECT 'equipment_finance_payment_alerts', 'uq_finance_payment_boss_alert'
) required
LEFT JOIN information_schema.STATISTICS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.INDEX_NAME = required.index_name
WHERE actual.INDEX_NAME IS NULL;

SELECT COUNT(*) AS missing_professional_finance_foreign_keys
FROM (
    SELECT 'equipment_finance_settings' AS table_name, 'fk_equipment_finance_settings_updated_by' AS constraint_name
    UNION ALL SELECT 'equipment_finance_settings_history', 'fk_finance_settings_history_settings'
    UNION ALL SELECT 'equipment_finance_document_signatures', 'fk_finance_signature_agreement'
    UNION ALL SELECT 'equipment_finance_issued_documents', 'fk_finance_document_agreement'
    UNION ALL SELECT 'equipment_finance_payment_alerts', 'fk_finance_payment_alert_payment'
    UNION ALL SELECT 'equipment_finance_payment_alerts', 'fk_finance_payment_alert_agreement'
) required
LEFT JOIN information_schema.TABLE_CONSTRAINTS actual
  ON actual.CONSTRAINT_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.CONSTRAINT_NAME = required.constraint_name
 AND actual.CONSTRAINT_TYPE = 'FOREIGN KEY'
WHERE actual.CONSTRAINT_NAME IS NULL;

SELECT COUNT(*) AS invalid_professional_finance_settings
FROM equipment_finance_settings
WHERE id <> 1
   OR currency NOT REGEXP '^[A-Z]{3}$'
   OR minimum_deposit_percent < 0
   OR minimum_deposit_percent > 100
   OR maximum_term_months < 1
   OR maximum_installment_count < 1
   OR default_grace_days < 0
   OR delivery_threshold_percent < 0
   OR delivery_threshold_percent > 100
   OR default_review_missed_installments < 1
   OR notice_cure_days < 1
   OR CHAR_LENGTH(TRIM(agreement_terms)) < 500
   OR CHAR_LENGTH(TRIM(terms_version)) < 3;

SELECT COUNT(*) AS duplicate_professional_finance_settings
FROM (
    SELECT id, COUNT(*) AS row_count
    FROM equipment_finance_settings
    GROUP BY id
    HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS invalid_professional_finance_documents
FROM equipment_finance_issued_documents document
LEFT JOIN equipment_sale_agreements agreement ON agreement.id = document.agreement_id
WHERE agreement.id IS NULL
   OR CHAR_LENGTH(document.snapshot_checksum) <> 64
   OR CHAR_LENGTH(TRIM(document.snapshot_json)) < 20
   OR document.document_number IS NULL
   OR document.template_version IS NULL;

SELECT COUNT(*) AS invalid_professional_finance_signatures
FROM equipment_finance_document_signatures signature_row
LEFT JOIN equipment_sale_agreements agreement ON agreement.id = signature_row.agreement_id
WHERE agreement.id IS NULL
   OR CHAR_LENGTH(TRIM(signature_row.signer_name)) < 2
   OR signature_row.signature_data_url NOT LIKE 'data:image/%'
   OR signature_row.signed_at IS NULL;

SELECT COUNT(*) AS invalid_professional_finance_payment_alerts
FROM equipment_finance_payment_alerts alert
LEFT JOIN equipment_sale_payments payment ON payment.id = alert.payment_id
LEFT JOIN equipment_sale_agreements agreement ON agreement.id = alert.agreement_id
WHERE payment.id IS NULL
   OR agreement.id IS NULL
   OR payment.agreement_id <> alert.agreement_id
   OR alert.attempt_count < 0
   OR CHAR_LENGTH(TRIM(alert.alert_message)) < 10;

SELECT COUNT(*) AS professional_finance_migration_record_missing
FROM (
    SELECT 1 AS expected
) required
LEFT JOIN schema_migrations migration
  ON migration.migration_name = '20260731_equipment_finance_professional_rebuild'
WHERE migration.id IS NULL;
