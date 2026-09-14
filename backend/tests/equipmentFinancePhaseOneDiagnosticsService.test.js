const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PHASE_ONE_MIGRATION,
  REQUIRED_FINANCE_SCHEMA,
  classifyFinanceDatabaseError,
  inspectFinanceApplicationSchema,
} = require("../services/equipmentFinancePhaseOneDiagnosticsService");

function fakeConnection({
  omittedTables = [],
  omittedColumns = [],
  notNullable = [],
  missingEnumValues = {},
  windowError = null,
  registerError = null,
  migrationRecorded = true,
} = {}) {
  const omittedTableSet = new Set(omittedTables);
  const omittedColumnSet = new Set(omittedColumns);
  const notNullableSet = new Set(notNullable);

  return {
    async query(queryInput, params = []) {
      const sql = String(queryInput?.sql || queryInput || "");
      if (sql.includes("SELECT VERSION()")) {
        return [[{ database_version: "8.0.36-test" }]];
      }
      if (sql.includes("information_schema.TABLES")) {
        return [[
          ...Object.keys(REQUIRED_FINANCE_SCHEMA)
            .filter((tableName) => !omittedTableSet.has(tableName))
            .map((tableName) => ({ table_name: tableName })),
          { table_name: "schema_migrations" },
        ]];
      }
      if (sql.includes("information_schema.COLUMNS")) {
        const rows = [];
        for (const [tableName, requirement] of Object.entries(
          REQUIRED_FINANCE_SCHEMA
        )) {
          if (omittedTableSet.has(tableName)) continue;
          for (const columnName of requirement.columns) {
            const key = `${tableName}.${columnName}`;
            if (omittedColumnSet.has(key)) continue;
            const requiredEnumValues = requirement.enum_values?.[columnName] || [];
            const removedValues = new Set(missingEnumValues[key] || []);
            const enumValues = requiredEnumValues.filter(
              (value) => !removedValues.has(value)
            );
            rows.push({
              table_name: tableName,
              column_name: columnName,
              is_nullable:
                requirement.nullable_columns.includes(columnName) &&
                !notNullableSet.has(key)
                  ? "YES"
                  : "NO",
              data_type: enumValues.length ? "enum" : "varchar",
              column_type: enumValues.length
                ? `enum(${enumValues.map((value) => `'${value}'`).join(",")})`
                : "varchar(255)",
            });
          }
        }
        return [rows];
      }
      if (sql.includes("FROM schema_migrations")) {
        assert.deepEqual(params, [PHASE_ONE_MIGRATION]);
        return [[{ applied: migrationRecorded ? 1 : 0 }]];
      }
      if (sql.includes("finance_window_probe")) {
        if (windowError) throw windowError;
        return [[{ total_count: 1 }]];
      }
      if (sql.includes("FROM equipment_credit_applications application")) {
        if (registerError) throw registerError;
        return [[]];
      }
      throw new Error(`Unexpected diagnostic SQL: ${sql}`);
    },
  };
}

test("the Finance schema verifier confirms the complete application and approval shape", async () => {
  const readiness = await inspectFinanceApplicationSchema(fakeConnection());
  assert.equal(readiness.ready, true);
  assert.equal(readiness.database.version, "8.0.36-test");
  assert.equal(readiness.migration.recorded, true);
  assert.deepEqual(readiness.missing_tables, []);
  assert.deepEqual(readiness.missing_columns, []);
  assert.deepEqual(readiness.invalid_nullability, []);
  assert.deepEqual(readiness.invalid_enums, []);
  assert.equal(readiness.capabilities.window_functions_supported, true);
  assert.equal(readiness.capabilities.register_query_compiles, true);
  assert.match(readiness.operator_message, /schema is ready/i);
});

test("the verifier names missing schedule fields and non-null company-wide locations", async () => {
  const readiness = await inspectFinanceApplicationSchema(
    fakeConnection({
      omittedColumns: [
        "equipment_credit_applications.proposed_interval_days",
        "equipment_sales_quotations.proposed_non_working_day_rule",
      ],
      notNullable: [
        "equipment_credit_applications.hire_location_id",
        "equipment_sales_quotations.hire_location_id",
        "equipment_sales_quotation_items.hire_location_id",
      ],
    })
  );
  assert.equal(readiness.ready, false);
  assert.deepEqual(
    readiness.missing_columns.map((item) => `${item.table}.${item.column}`),
    [
      "equipment_credit_applications.proposed_interval_days",
      "equipment_sales_quotations.proposed_non_working_day_rule",
    ]
  );
  assert.equal(readiness.invalid_nullability.length, 3);
  assert.match(readiness.operator_message, /missing required column/i);
});

test("the verifier detects incompatible approval enums and window queries", async () => {
  const readiness = await inspectFinanceApplicationSchema(
    fakeConnection({
      missingEnumValues: {
        "equipment_credit_applications.application_status": ["approved"],
        "equipment_credit_application_decisions.action_type": ["approved"],
      },
      windowError: Object.assign(new Error("window unsupported"), {
        code: "ER_NOT_SUPPORTED_YET",
      }),
    })
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.invalid_enums.length, 2);
  assert.equal(readiness.capabilities.window_functions_supported, false);
  assert.equal(
    readiness.capabilities.window_function_error_code,
    "ER_NOT_SUPPORTED_YET"
  );
});

test("database failures receive stable operator-safe diagnostic codes", () => {
  assert.equal(
    classifyFinanceDatabaseError({ code: "ER_BAD_FIELD_ERROR" }).code,
    "FINANCE_APPLICATION_SCHEMA_COLUMN_MISSING"
  );
  assert.equal(
    classifyFinanceDatabaseError({ code: "ER_BAD_NULL_ERROR" }).code,
    "FINANCE_LOCATION_NULLABILITY_REQUIRED"
  );
  assert.equal(
    classifyFinanceDatabaseError({ code: "ETIMEDOUT" }).code,
    "FINANCE_APPLICATION_QUERY_TIMEOUT"
  );
  assert.equal(
    classifyFinanceDatabaseError({ code: "ER_PARSE_ERROR" }).code,
    "FINANCE_APPLICATION_QUERY_UNSUPPORTED"
  );
});
