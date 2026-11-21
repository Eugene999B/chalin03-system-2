const PHASE_ONE_MIGRATION =
  "20260801_equipment_finance_phase1_schema_foundation";
const DEFAULT_QUERY_TIMEOUT_MS = 6000;

const REQUIRED_FINANCE_SCHEMA = Object.freeze({
  equipment_credit_applications: Object.freeze({
    workflow: "application_and_approval",
    columns: Object.freeze([
      "id",
      "application_number",
      "hire_location_id",
      "customer_id",
      "enquiry_id",
      "quotation_id",
      "asset_id",
      "application_date",
      "application_status",
      "kyc_status",
      "affordability_status",
      "risk_band",
      "risk_score",
      "quoted_total",
      "proposed_deposit",
      "financed_amount",
      "proposed_frequency",
      "proposed_interval_days",
      "proposed_non_working_day_rule",
      "proposed_installment_count",
      "proposed_installment_amount",
      "proposed_periodic_amount",
      "monthly_salary_income",
      "monthly_business_income",
      "monthly_other_income",
      "monthly_business_costs",
      "monthly_household_expenses",
      "existing_monthly_debt",
      "total_monthly_income",
      "total_monthly_commitments",
      "net_monthly_surplus",
      "debt_service_ratio_percent",
      "total_commitment_ratio_percent",
      "deposit_ratio_percent",
      "assessment_recommendation",
      "assessment_notes",
      "customer_consent_at",
      "submitted_by",
      "submitted_at",
      "reviewed_by",
      "reviewed_at",
      "decision_reason",
      "decision_version",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ]),
    nullable_columns: Object.freeze(["hire_location_id"]),
    enum_values: Object.freeze({
      application_status: Object.freeze([
        "draft",
        "submitted",
        "under_review",
        "changes_requested",
        "approved",
        "declined",
        "withdrawn",
      ]),
      kyc_status: Object.freeze([
        "not_started",
        "incomplete",
        "complete",
        "verified",
        "rejected",
      ]),
      affordability_status: Object.freeze([
        "not_assessed",
        "eligible",
        "manual_review",
        "ineligible",
      ]),
      risk_band: Object.freeze(["low", "medium", "high", "critical"]),
      proposed_frequency: Object.freeze([
        "weekly",
        "fortnightly",
        "monthly",
        "custom",
      ]),
      proposed_non_working_day_rule: Object.freeze([
        "exact",
        "next_weekday",
        "previous_weekday",
      ]),
    }),
  }),
  equipment_sales_quotations: Object.freeze({
    workflow: "installment_offer",
    columns: Object.freeze([
      "id",
      "quotation_number",
      "hire_location_id",
      "enquiry_id",
      "customer_id",
      "quotation_date",
      "validity_date",
      "status",
      "subtotal",
      "discount_amount",
      "tax_rate_percent",
      "tax_amount",
      "total_amount",
      "deposit_required",
      "proposed_frequency",
      "proposed_interval_days",
      "proposed_non_working_day_rule",
      "proposed_installment_count",
      "proposed_first_due_date",
      "delivery_policy",
      "delivery_threshold_percent",
      "terms",
      "notes",
      "approval_reason",
      "created_by",
      "approved_by",
      "approved_at",
      "created_at",
      "updated_at",
    ]),
    nullable_columns: Object.freeze(["hire_location_id"]),
    enum_values: Object.freeze({
      status: Object.freeze([
        "draft",
        "pending_approval",
        "approved",
        "accepted",
        "rejected",
        "expired",
        "converted",
        "cancelled",
      ]),
      proposed_frequency: Object.freeze([
        "weekly",
        "fortnightly",
        "monthly",
        "custom",
      ]),
      proposed_non_working_day_rule: Object.freeze([
        "exact",
        "next_weekday",
        "previous_weekday",
      ]),
    }),
  }),
  equipment_sales_quotation_items: Object.freeze({
    workflow: "installment_offer",
    columns: Object.freeze([
      "id",
      "quotation_id",
      "hire_location_id",
      "line_number",
      "asset_id",
      "asset_code_snapshot",
      "asset_name_snapshot",
      "asset_type_snapshot",
      "make_snapshot",
      "model_snapshot",
      "model_year_snapshot",
      "serial_number_snapshot",
      "main_image_url_snapshot",
      "description",
      "quantity",
      "unit_price",
      "discount_amount",
      "tax_amount",
      "line_total",
      "created_at",
      "updated_at",
    ]),
    nullable_columns: Object.freeze(["hire_location_id"]),
    enum_values: Object.freeze({}),
  }),
  equipment_credit_application_kyc: Object.freeze({
    workflow: "application_and_approval",
    columns: Object.freeze([
      "id",
      "application_id",
      "customer_name_snapshot",
      "customer_phone_snapshot",
      "customer_email_snapshot",
      "customer_address_snapshot",
      "id_type",
      "id_number",
      "date_of_birth",
      "nationality",
      "employment_type",
      "occupation",
      "employer_business_name",
      "business_registration_number",
      "residential_address",
      "work_address",
      "years_at_residence",
      "years_in_employment_business",
      "emergency_contact_name",
      "emergency_contact_phone",
      "emergency_contact_relationship",
      "guarantor_name",
      "guarantor_phone",
      "guarantor_address",
      "guarantor_id_type",
      "guarantor_id_number",
      "guarantor_relationship",
      "identity_document_url",
      "address_evidence_url",
      "income_evidence_url",
      "bank_statement_url",
      "business_registration_url",
      "guarantor_document_url",
      "identity_verified",
      "address_verified",
      "income_verified",
      "guarantor_verified",
      "customer_consent_confirmed",
      "credit_assessment_consent_confirmed",
      "verified_by",
      "verified_at",
      "verification_notes",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ]),
    nullable_columns: Object.freeze([]),
    enum_values: Object.freeze({}),
  }),
  equipment_credit_application_decisions: Object.freeze({
    workflow: "approval",
    columns: Object.freeze([
      "id",
      "application_id",
      "decision_version",
      "action_type",
      "from_status",
      "to_status",
      "affordability_status",
      "risk_band",
      "risk_score",
      "debt_service_ratio_percent",
      "net_monthly_surplus",
      "notes",
      "snapshot_json",
      "decided_by",
      "decided_at",
    ]),
    nullable_columns: Object.freeze([]),
    enum_values: Object.freeze({
      action_type: Object.freeze([
        "created",
        "updated",
        "assessed",
        "submitted",
        "review_started",
        "changes_requested",
        "approved",
        "declined",
        "withdrawn",
        "kyc_verified",
      ]),
    }),
  }),
  hire_customers: Object.freeze({
    workflow: "application_register",
    columns: Object.freeze([
      "id",
      "customer_code",
      "customer_name",
      "customer_type",
      "phone",
      "whatsapp_phone",
      "email",
      "address",
      "contact_person",
      "risk_notes",
      "is_active",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ]),
    nullable_columns: Object.freeze([]),
    enum_values: Object.freeze({}),
  }),
  fleet_assets: Object.freeze({
    workflow: "application_register",
    columns: Object.freeze([
      "id",
      "asset_code",
      "asset_name",
      "asset_type",
      "make",
      "model",
      "model_year",
      "serial_number",
      "chassis_number",
      "minimum_selling_price",
      "target_selling_price",
      "operational_purpose",
      "sale_status",
      "main_image_url",
      "is_active",
      "created_at",
      "updated_at",
    ]),
    nullable_columns: Object.freeze([]),
    enum_values: Object.freeze({}),
  }),
});

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function normalizeName(value) {
  return String(value || "").trim();
}

function publicDatabaseVersion(value) {
  return normalizeName(value).slice(0, 120) || null;
}

function query(connection, sql, params = [], timeoutMs = DEFAULT_QUERY_TIMEOUT_MS) {
  return connection.query({ sql, timeout: timeoutMs }, params);
}

function requiredTableNames() {
  return Object.keys(REQUIRED_FINANCE_SCHEMA);
}

function requirementCount() {
  return requiredTableNames().reduce(
    (total, tableName) =>
      total + REQUIRED_FINANCE_SCHEMA[tableName].columns.length,
    0
  );
}

function columnKey(tableName, columnName) {
  return `${tableName}.${columnName}`;
}

function readinessOperatorMessage(readiness) {
  if (readiness?.missing_tables?.length) {
    return `Finance is missing required table(s): ${readiness.missing_tables.join(", ")}.`;
  }
  if (readiness?.missing_columns?.length) {
    return `Finance is missing required column(s): ${readiness.missing_columns
      .map((item) => columnKey(item.table, item.column))
      .join(", ")}.`;
  }
  if (readiness?.invalid_nullability?.length) {
    return `Company-wide Finance requires nullable location field(s): ${readiness.invalid_nullability
      .map((item) => columnKey(item.table, item.column))
      .join(", ")}.`;
  }
  if (readiness?.invalid_enums?.length) {
    return `Finance database enum definitions are missing required workflow value(s): ${readiness.invalid_enums
      .map((item) => columnKey(item.table, item.column))
      .join(", ")}.`;
  }
  if (readiness?.capabilities?.window_functions_supported === false) {
    return "The production database cannot execute the current application-register window query.";
  }
  if (readiness?.capabilities?.register_query_compiles === false) {
    return "The production database cannot compile the current application-register query.";
  }
  if (readiness?.ready) {
    return "The Finance application, quotation and approval schema is ready.";
  }
  return "The Finance application schema check could not finish.";
}

async function inspectFinanceApplicationSchema(
  connection,
  { queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {}
) {
  const tableNames = requiredTableNames();
  const lookupNames = [...tableNames, "schema_migrations"];
  const [versionRows] = await query(
    connection,
    "SELECT VERSION() AS database_version",
    [],
    queryTimeoutMs
  );
  const [tableRows] = await query(
    connection,
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders(lookupNames)})`,
    lookupNames,
    queryTimeoutMs
  );

  const existingTables = new Set(
    tableRows.map((row) => normalizeName(row.table_name)).filter(Boolean)
  );
  const missingTables = tableNames.filter(
    (tableName) => !existingTables.has(tableName)
  );
  const inspectableTables = tableNames.filter((tableName) =>
    existingTables.has(tableName)
  );

  let columnRows = [];
  if (inspectableTables.length) {
    [columnRows] = await query(
      connection,
      `SELECT TABLE_NAME AS table_name,
              COLUMN_NAME AS column_name,
              IS_NULLABLE AS is_nullable,
              DATA_TYPE AS data_type,
              COLUMN_TYPE AS column_type
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${placeholders(inspectableTables)})`,
      inspectableTables,
      queryTimeoutMs
    );
  }

  const columnMap = new Map();
  for (const row of columnRows) {
    const tableName = normalizeName(row.table_name);
    const columnName = normalizeName(row.column_name);
    if (!tableName || !columnName) continue;
    columnMap.set(columnKey(tableName, columnName), {
      table: tableName,
      column: columnName,
      is_nullable: normalizeName(row.is_nullable).toUpperCase() === "YES",
      data_type: normalizeName(row.data_type).toLowerCase(),
      column_type: normalizeName(row.column_type).toLowerCase(),
    });
  }

  const missingColumns = [];
  const invalidNullability = [];
  const invalidEnums = [];
  for (const tableName of inspectableTables) {
    const requirement = REQUIRED_FINANCE_SCHEMA[tableName];
    for (const columnName of requirement.columns) {
      if (!columnMap.has(columnKey(tableName, columnName))) {
        missingColumns.push({ table: tableName, column: columnName });
      }
    }
    for (const columnName of requirement.nullable_columns) {
      const column = columnMap.get(columnKey(tableName, columnName));
      if (column && !column.is_nullable) {
        invalidNullability.push({
          table: tableName,
          column: columnName,
          expected: "NULL allowed",
          actual: "NOT NULL",
        });
      }
    }
    for (const [columnName, values] of Object.entries(
      requirement.enum_values || {}
    )) {
      const column = columnMap.get(columnKey(tableName, columnName));
      if (!column) continue;
      const missingValues = values.filter(
        (value) => !column.column_type.includes(`'${value}'`)
      );
      if (missingValues.length) {
        invalidEnums.push({
          table: tableName,
          column: columnName,
          missing_values: missingValues,
        });
      }
    }
  }

  let migrationRecorded = false;
  if (existingTables.has("schema_migrations")) {
    const [migrationRows] = await query(
      connection,
      `SELECT COUNT(*) AS applied
         FROM schema_migrations
        WHERE migration_name = ?`,
      [PHASE_ONE_MIGRATION],
      queryTimeoutMs
    );
    migrationRecorded = Number(migrationRows[0]?.applied || 0) === 1;
  }

  let windowFunctionsSupported = true;
  let windowFunctionErrorCode = null;
  try {
    await query(
      connection,
      "SELECT COUNT(*) OVER() AS total_count FROM (SELECT 1 AS id) finance_window_probe",
      [],
      queryTimeoutMs
    );
  } catch (error) {
    windowFunctionsSupported = false;
    windowFunctionErrorCode = normalizeName(error?.code) || "WINDOW_QUERY_FAILED";
  }

  let registerQueryCompiles = true;
  let registerQueryErrorCode = null;
  if (!missingTables.length && !missingColumns.length) {
    try {
      await query(
        connection,
        `SELECT application.id,
                application.proposed_interval_days,
                customer.customer_name,
                quotation.quotation_number,
                asset.asset_code,
                COUNT(*) OVER() AS total_count
           FROM equipment_credit_applications application
           INNER JOIN hire_customers customer
             ON customer.id = application.customer_id
           INNER JOIN equipment_sales_quotations quotation
             ON quotation.id = application.quotation_id
           INNER JOIN fleet_assets asset
             ON asset.id = application.asset_id
          WHERE 1 = 0`,
        [],
        queryTimeoutMs
      );
    } catch (error) {
      registerQueryCompiles = false;
      registerQueryErrorCode = normalizeName(error?.code) || "REGISTER_QUERY_FAILED";
    }
  } else {
    registerQueryCompiles = false;
    registerQueryErrorCode = "SCHEMA_REQUIREMENTS_MISSING";
  }

  const ready =
    missingTables.length === 0 &&
    missingColumns.length === 0 &&
    invalidNullability.length === 0 &&
    invalidEnums.length === 0 &&
    windowFunctionsSupported &&
    registerQueryCompiles;
  const readiness = {
    ready,
    checked_at: new Date().toISOString(),
    scope: "company_wide",
    hire_location_selection_required: false,
    critical_read_path: true,
    database: {
      engine: "mysql",
      version: publicDatabaseVersion(versionRows[0]?.database_version),
    },
    migration: {
      name: PHASE_ONE_MIGRATION,
      recorded: migrationRecorded,
    },
    checked_tables: tableNames.length,
    checked_columns: requirementCount(),
    missing_tables: missingTables,
    missing_columns: missingColumns,
    invalid_nullability: invalidNullability,
    invalid_enums: invalidEnums,
    capabilities: {
      window_functions_supported: windowFunctionsSupported,
      window_function_error_code: windowFunctionErrorCode,
      register_query_compiles: registerQueryCompiles,
      register_query_error_code: registerQueryErrorCode,
    },
  };
  readiness.operator_message = readinessOperatorMessage(readiness);
  return readiness;
}

function classifyFinanceDatabaseError(error, readiness = null) {
  if (readiness?.missing_tables?.length || error?.code === "ER_NO_SUCH_TABLE") {
    return {
      code: "FINANCE_APPLICATION_SCHEMA_TABLE_MISSING",
      operator_message:
        readinessOperatorMessage(readiness) ||
        "The Finance database is missing a required application table.",
    };
  }
  if (readiness?.missing_columns?.length || error?.code === "ER_BAD_FIELD_ERROR") {
    return {
      code: "FINANCE_APPLICATION_SCHEMA_COLUMN_MISSING",
      operator_message:
        readinessOperatorMessage(readiness) ||
        "The Finance database is missing a required application, quotation or approval column.",
    };
  }
  if (
    readiness?.invalid_nullability?.length ||
    error?.code === "ER_BAD_NULL_ERROR"
  ) {
    return {
      code: "FINANCE_LOCATION_NULLABILITY_REQUIRED",
      operator_message:
        readinessOperatorMessage(readiness) ||
        "Company-wide Finance location fields still reject empty Hire locations.",
    };
  }
  if (readiness?.invalid_enums?.length || error?.code === "WARN_DATA_TRUNCATED") {
    return {
      code: "FINANCE_APPLICATION_ENUM_MISMATCH",
      operator_message:
        readinessOperatorMessage(readiness) ||
        "The Finance database does not accept one of the required workflow statuses.",
    };
  }
  if (
    readiness?.capabilities?.window_functions_supported === false ||
    ["ER_NOT_SUPPORTED_YET", "ER_PARSE_ERROR"].includes(error?.code)
  ) {
    return {
      code: "FINANCE_APPLICATION_QUERY_UNSUPPORTED",
      operator_message:
        "The production database cannot execute the current application-register query.",
    };
  }
  if (
    [
      "ER_QUERY_TIMEOUT",
      "PROTOCOL_SEQUENCE_TIMEOUT",
      "ETIMEDOUT",
      "ECONNABORTED",
      "FINANCE_CRITICAL_CONNECTION_TIMEOUT",
    ].includes(error?.code)
  ) {
    return {
      code: "FINANCE_APPLICATION_QUERY_TIMEOUT",
      operator_message:
        "The Finance database did not answer before the protected deadline. Retry using the request reference shown below.",
    };
  }
  if (error?.code === "ER_NO_REFERENCED_ROW_2") {
    return {
      code: "FINANCE_APPLICATION_RELATION_MISSING",
      operator_message:
        "A Finance application refers to a missing customer, quotation or excavator record.",
    };
  }
  return {
    code: "FINANCE_APPLICATION_REGISTER_FAILED",
    operator_message:
      readiness?.operator_message ||
      "The Finance application register failed. No empty result has been substituted for this error.",
  };
}

module.exports = {
  DEFAULT_QUERY_TIMEOUT_MS,
  PHASE_ONE_MIGRATION,
  REQUIRED_FINANCE_SCHEMA,
  classifyFinanceDatabaseError,
  inspectFinanceApplicationSchema,
  readinessOperatorMessage,
  requiredTableNames,
};
