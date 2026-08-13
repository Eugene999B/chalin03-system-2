const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
} = require("../services/backupSafetyService");
const {
  assertSchemaPreparationSql,
  discoverMigrationPlan,
} = require("../scripts/prepareStagingBackupRecoverySchema");

const PRODUCTION_BACKUP_MIGRATIONS = [
  "20260714_cash_control_security_migration",
  "20260718_release3d_notifications_group_alerts",
  "20260718_release3e_shared_reports_documents_roles_audit",
  "20260718_release3fb_professional_installment_sales",
  "20260718_release3fd2_worker_identity_cards",
  "20260719_standalone_employment_documents_signature",
  "20260719_worker_hr_letters",
  "20260722_bank_biometric_device_reset_v1",
  "20260722_equipment_sales_installments_foundation",
  "20260723_equipment_catalogue_core_compatibility_repair_v2",
  "20260723_equipment_sales_commercial_column_repair_v1",
  "20260723_release31_audit_schema_baseline",
  "20260723_release31_audit_schema_safety",
  "20260723_release31_database_safety_guards",
  "20260723_release31_runtime_schema_baseline",
  "20260725_phase1_financial_control_hardening",
  "20260725_post_phase1_audit_signoff_readiness",
  "20260726_mining_trial_data_cleanup",
  "20260729_equipment_credit_application_foundation",
  "20260729_equipment_finance_agreement_activation",
  "20260729_equipment_finance_deposit_reservation",
  "20260729_equipment_finance_final_lifecycle",
  "20260731_equipment_finance_operational_polish",
  "20260731_equipment_finance_professional_rebuild",
  "20260801_equipment_finance_phase1_schema_foundation",
  "20260802_boss_approved_product_quantity_correction",
  "20260803_equipment_finance_phase3_agreement_creation",
  "20260803_equipment_finance_phase4_deposit_reservation_integrity",
  "20260803_equipment_finance_phase5_unified_documents",
  "20260803_equipment_finance_phase6_performance",
  "20260804_boss_approved_product_quantity_correction",
  "20260804_equipment_finance_phase3_application_pipeline",
  "20260805_automatic_customer_merge_rollback",
  "20260805_equipment_finance_opening_deposit_foundation_repair",
  "20260805_exact_name_receipt_owner_recovery",
  "20260805_master_mickey_july31_exact_debt_repair",
  "20260805_missing_credit_debt_backfill",
  "20260805_post_rollback_debt_account_reconciliation",
  "20260805_unpaid_receipt_identity_isolation",
  "20260805_user_authorized_equipment_installment_restart_reset",
  "20260805_user_authorized_installment_finance_excavator_cleanup",
  "20260805_zero_payment_credit_debt_visibility_repair",
  "20260806_kwabena_main_store_quantity_correction",
  "20260806_master_mickey_merge_profile_visibility",
  "20260810_payroll_financial_foundation",
  "clean_master_database_reset",
  "equipment_finance_phase4_balance_guard",
  "equipment_finance_phase4_corrections_settlements",
  "equipment_finance_phase5a_private_documents",
  "equipment_finance_phase5b_document_review",
  "equipment_finance_phase5c_delivery_authorization",
  "equipment_finance_phase5d_delivery_confirmation",
  "equipment_finance_phase6_reporting_notifications",
  "equipment_hire_part4_5c",
  "release2_final_security_backup_workers_executive",
  "release2a1_one_active_session",
  "release2a2_account_lock_otp",
  "release2d_worker_profile_expansion",
  "release2f_worker_print_pack",
  "release3_group_command_configuration",
  "release3_owner_mfa_security",
  "release3b_mining_operations_control",
  "release3c_hire_commercial_completion",
  "release3fa_authentication_sessions_ux",
  "release3fc_user_permissions_security_messages",
  "release3fc2_category_isolation_guides_receipts_workers",
  "release3fc3_mobile_id_expense_funding",
  "shared_fleet_mining_baseline",
  "spare_parts_sales_hotfix",
  "stage6a_group_users_staff",
  "stage6b_permissions_audit_migration",
  "stage6c_reliability_migration",
  "stage6d_security_migration",
];

test("every executable migration in the exact production backup recovery plan is additive-safe", () => {
  assert.equal(PRODUCTION_BACKUP_MIGRATIONS.length, 73);

  const discovery = discoverMigrationPlan({
    backup_type: BACKUP_TYPE,
    version: BACKUP_MANIFEST_VERSION,
    schema_migrations: PRODUCTION_BACKUP_MIGRATIONS.map((migration_name) => ({
      migration_name,
    })),
    tables: {},
  });

  assert.deepEqual(discovery.unresolved, []);

  for (const item of discovery.plan) {
    const sql = fs.readFileSync(item.filePath, "utf8");
    assert.doesNotThrow(
      () => assertSchemaPreparationSql(sql, item.migrationName, item.filePath),
      `Recovery migration ${item.migrationName} must remain additive-safe`
    );
  }
});
