-- CHALIN 03 RELEASE 3.1 RUNTIME-SCHEMA BASELINE VERIFICATION
-- READ-ONLY VERIFICATION ONLY.
-- This file is executed by backend/scripts/runControlledMigrations.js.

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(required.required_table ORDER BY required.required_table SEPARATOR ', ') AS missing_tables
FROM (
  SELECT 'branches' AS required_table
  UNION ALL SELECT 'schema_migrations'
  UNION ALL SELECT 'users'
  UNION ALL SELECT 'auth_sessions'
  UNION ALL SELECT 'protected_action_sessions'
  UNION ALL SELECT 'password_recovery_otps'
  UNION ALL SELECT 'user_passkeys'
  UNION ALL SELECT 'passkey_challenges'
  UNION ALL SELECT 'passkey_security_state'
  UNION ALL SELECT 'passkey_security_events'
  UNION ALL SELECT 'group_configuration'
  UNION ALL SELECT 'group_configuration_history'
  UNION ALL SELECT 'document_sequences'
  UNION ALL SELECT 'document_sequence_history'
  UNION ALL SELECT 'worker_profiles'
  UNION ALL SELECT 'worker_hr_letters'
  UNION ALL SELECT 'standalone_hr_documents'
  UNION ALL SELECT 'document_signature_settings'
  UNION ALL SELECT 'fleet_assets'
  UNION ALL SELECT 'business_units'
  UNION ALL SELECT 'business_locations'
  UNION ALL SELECT 'hire_customers'
  UNION ALL SELECT 'hire_contract_assets'
  UNION ALL SELECT 'equipment_media'
  UNION ALL SELECT 'equipment_sales_enquiries'
  UNION ALL SELECT 'equipment_sales_quotations'
  UNION ALL SELECT 'equipment_sales_quotation_items'
  UNION ALL SELECT 'equipment_sale_agreements'
  UNION ALL SELECT 'equipment_asset_sale_locks'
  UNION ALL SELECT 'equipment_installment_schedule'
  UNION ALL SELECT 'equipment_sale_payments'
  UNION ALL SELECT 'equipment_sale_payment_allocations'
  UNION ALL SELECT 'equipment_deliveries'
  UNION ALL SELECT 'equipment_ownership_transfers'
  UNION ALL SELECT 'equipment_sales_reminder_log'
  UNION ALL SELECT 'backup_history'
  UNION ALL SELECT 'privileged_action_ledger'
) required
LEFT JOIN information_schema.TABLES current_table
  ON current_table.TABLE_SCHEMA = DATABASE()
 AND current_table.TABLE_TYPE = 'BASE TABLE'
 AND current_table.TABLE_NAME = required.required_table
WHERE current_table.TABLE_NAME IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(
    CONCAT(required.table_name, '.', required.column_name)
    ORDER BY required.table_name, required.column_name
    SEPARATOR ', '
  ) AS missing_columns
FROM (
  SELECT 'branches' AS table_name, 'branch_code' AS column_name
  UNION ALL SELECT 'branches', 'is_active'
  UNION ALL SELECT 'users', 'token_version'
  UNION ALL SELECT 'auth_sessions', 'expires_at'
  UNION ALL SELECT 'auth_sessions', 'revoked_at'
  UNION ALL SELECT 'auth_sessions', 'login_method'
  UNION ALL SELECT 'user_passkeys', 'device_binding_hash'
  UNION ALL SELECT 'user_passkeys', 'binding_generation'
  UNION ALL SELECT 'user_passkeys', 'authenticator_attachment'
  UNION ALL SELECT 'user_passkeys', 'revoked_reason'
  UNION ALL SELECT 'worker_hr_letters', 'approval_signature_data_url'
  UNION ALL SELECT 'worker_hr_letters', 'signature_captured_at'
  UNION ALL SELECT 'fleet_assets', 'operational_purpose'
  UNION ALL SELECT 'fleet_assets', 'sale_status'
  UNION ALL SELECT 'fleet_assets', 'main_image_url'
  UNION ALL SELECT 'equipment_sale_agreements', 'outstanding_balance'
  UNION ALL SELECT 'equipment_sale_agreements', 'approval_status'
  UNION ALL SELECT 'equipment_installment_schedule', 'schedule_status'
  UNION ALL SELECT 'equipment_sale_payments', 'receipt_number'
  UNION ALL SELECT 'equipment_deliveries', 'delivery_number'
  UNION ALL SELECT 'equipment_ownership_transfers', 'transfer_number'
) required
LEFT JOIN information_schema.COLUMNS current_column
  ON current_column.TABLE_SCHEMA = DATABASE()
 AND current_column.TABLE_NAME = required.table_name
 AND current_column.COLUMN_NAME = required.column_name
WHERE current_column.COLUMN_NAME IS NULL;

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(required.trigger_name ORDER BY required.trigger_name SEPARATOR ', ') AS missing_triggers
FROM (
  SELECT 'trg_user_password_change_revoke_biometrics' AS trigger_name
  UNION ALL SELECT 'trg_hire_contract_asset_sale_guard_before_insert'
  UNION ALL SELECT 'trg_hire_contract_asset_sale_guard_before_update'
  UNION ALL SELECT 'trg_equipment_sale_agreement_hire_guard_before_insert'
  UNION ALL SELECT 'trg_equipment_sale_agreement_hire_guard_before_update'
  UNION ALL SELECT 'trg_spare_parts_installment_retired_sales_insert'
  UNION ALL SELECT 'trg_spare_parts_installment_retired_agreement_insert'
) required
LEFT JOIN information_schema.TRIGGERS current_trigger
  ON current_trigger.TRIGGER_SCHEMA = DATABASE()
 AND current_trigger.TRIGGER_NAME = required.trigger_name
WHERE current_trigger.TRIGGER_NAME IS NULL;
