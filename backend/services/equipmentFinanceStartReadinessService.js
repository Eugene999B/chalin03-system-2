"use strict";

// Read-only, permission-gated preflight for the exact fields used by the
// Start New Installment transaction. Never mutate schema or user data here.
const REQUIRED_START_SCHEMA = Object.freeze({
  equipment_sales_quotations: ["quotation_number","hire_location_id","enquiry_id","customer_id","quotation_date","validity_date","status","subtotal","discount_amount","tax_rate_percent","tax_amount","total_amount","deposit_required","proposed_frequency","proposed_interval_days","proposed_non_working_day_rule","proposed_installment_count","proposed_first_due_date","delivery_policy","delivery_threshold_percent","terms","notes","approval_reason","created_by","approved_by","approved_at"],
  equipment_sales_quotation_items: ["quotation_id","hire_location_id","line_number","asset_id","asset_code_snapshot","asset_name_snapshot","asset_type_snapshot","make_snapshot","model_snapshot","model_year_snapshot","serial_number_snapshot","main_image_url_snapshot","description","quantity","unit_price","discount_amount","tax_amount","line_total"],
  equipment_credit_applications: ["application_number","hire_location_id","customer_id","enquiry_id","quotation_id","asset_id","application_date","application_status","kyc_status","affordability_status","risk_band","risk_score","quoted_total","proposed_deposit","financed_amount","proposed_frequency","proposed_interval_days","proposed_non_working_day_rule","proposed_installment_count","proposed_installment_amount","proposed_periodic_amount","monthly_salary_income","monthly_business_income","monthly_other_income","monthly_business_costs","monthly_household_expenses","existing_monthly_debt","total_monthly_income","total_monthly_commitments","net_monthly_surplus","debt_service_ratio_percent","total_commitment_ratio_percent","deposit_ratio_percent","assessment_recommendation","assessment_notes","customer_consent_at","decision_version","created_by","updated_by"],
  equipment_credit_application_decisions: ["application_id","decision_version","action_type","from_status","to_status","affordability_status","risk_band","risk_score","debt_service_ratio_percent","net_monthly_surplus","notes","snapshot_json","decided_by"],
  equipment_credit_application_kyc: ["application_id","customer_name_snapshot","customer_phone_snapshot","customer_email_snapshot","customer_address_snapshot","id_type","id_number","date_of_birth","nationality","employment_type","occupation","employer_business_name","business_registration_number","residential_address","work_address","years_at_residence","years_in_employment_business","emergency_contact_name","emergency_contact_phone","emergency_contact_relationship","guarantor_name","guarantor_phone","guarantor_address","guarantor_id_type","guarantor_id_number","guarantor_relationship","identity_document_url","address_evidence_url","income_evidence_url","bank_statement_url","business_registration_url","guarantor_document_url","identity_verified","address_verified","income_verified","guarantor_verified","customer_consent_confirmed","credit_assessment_consent_confirmed","verification_notes","created_by","updated_by"],
  fleet_assets: ["id","asset_code","is_active","sale_status","operational_purpose","minimum_selling_price","target_selling_price"],
  hire_customers: ["id","is_active","customer_name","phone"],
  equipment_asset_sale_locks: ["asset_id","released_at","agreement_id"],
  hire_contract_assets: ["asset_id","status"],
  equipment_finance_settings: ["id"],
});
const NULLABLE_LOCATION_TABLES = Object.freeze([
  "equipment_sales_quotations",
  "equipment_sales_quotation_items",
  "equipment_credit_applications",
]);

class FinanceStartSchemaError extends Error {
  constructor(readiness) {
    super("The installment database is missing required Finance fields. Ask an administrator to apply and verify the approved additive migration before creating this application.");
    this.statusCode = 503;
    this.code = "FINANCE_START_SCHEMA_REQUIRED";
    this.readiness = readiness;
  }
}

async function inspectStartSchema(connection) {
  const tables = Object.keys(REQUIRED_START_SCHEMA);
  const placeholders = tables.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})`,
    tables
  );
  const found = new Map(tables.map((table) => [table, new Map()]));
  for (const row of rows) {
    const table = String(row.TABLE_NAME || "");
    if (found.has(table)) found.get(table).set(String(row.COLUMN_NAME || ""), String(row.IS_NULLABLE || ""));
  }
  const missing_tables = tables.filter((table) => found.get(table).size === 0);
  const missing_columns = [];
  for (const [table, columns] of Object.entries(REQUIRED_START_SCHEMA)) {
    if (missing_tables.includes(table)) continue;
    for (const column of columns) {
      if (!found.get(table).has(column)) missing_columns.push(`${table}.${column}`);
    }
  }
  const invalid_nullability = NULLABLE_LOCATION_TABLES.filter((table) =>
    found.get(table)?.get("hire_location_id") &&
      found.get(table).get("hire_location_id").toUpperCase() !== "YES"
  ).map((table) => `${table}.hire_location_id`);
  return {
    ready: !missing_tables.length && !missing_columns.length && !invalid_nullability.length,
    missing_tables,
    missing_columns,
    invalid_nullability,
    migration_hint: "Verify the existing 20260804 equipment Finance Phase 3 application pipeline and its approved additive successors.",
  };
}

async function assertStartSchema(connection) {
  const result = await inspectStartSchema(connection);
  if (!result.ready) throw new FinanceStartSchemaError(result);
  return result;
}

module.exports = { REQUIRED_START_SCHEMA, FinanceStartSchemaError, inspectStartSchema, assertStartSchema };
