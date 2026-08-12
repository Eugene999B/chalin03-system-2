"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ADMIN_RUNTIME_COLUMNS,
  ADMIN_RUNTIME_TABLES,
  EXPECTED_COLUMNS,
  EXPECTED_TABLES,
  evaluateRuntimeSchema,
} = require("../services/systemReadinessContract");

test("live readiness includes the admin outage dependency families", () => {
  const requiredTables = [
    "user_permission_overrides",
    "activity_log",
    "auth_sessions",
    "protected_action_sessions",
    "privileged_action_ledger",
    "owner_break_glass_accounts",
    "backup_history",
    "worker_profiles",
    "worker_assignments",
    "worker_hr_letters",
    "payroll_compensation_profiles",
    "payroll_periods",
    "inventory_units",
    "inventory_loss_investigations",
  ];

  for (const tableName of requiredTables) {
    assert.ok(
      ADMIN_RUNTIME_TABLES.includes(tableName),
      `${tableName} must remain in the admin runtime contract`
    );
    assert.ok(
      EXPECTED_TABLES.includes(tableName),
      `${tableName} must be checked by live readiness`
    );
  }

  assert.equal(new Set(EXPECTED_TABLES).size, EXPECTED_TABLES.length);
  assert.ok(EXPECTED_COLUMNS.length >= ADMIN_RUNTIME_COLUMNS.length);
});

test("schema evaluator detects a missing admin table instead of reporting ready", () => {
  const tableRows = EXPECTED_TABLES
    .filter((tableName) => tableName !== "worker_profiles")
    .map((TABLE_NAME) => ({ TABLE_NAME }));
  const columnRows = EXPECTED_COLUMNS.map(([TABLE_NAME, COLUMN_NAME]) => ({
    TABLE_NAME,
    COLUMN_NAME,
  }));

  const result = evaluateRuntimeSchema({ tableRows, columnRows });

  assert.ok(result.missing_tables.includes("worker_profiles"));
  assert.equal(result.missing_columns.length, 0);
});

test("schema evaluator detects missing admin columns as readiness failures", () => {
  const tableRows = EXPECTED_TABLES.map((TABLE_NAME) => ({ TABLE_NAME }));
  const columnRows = EXPECTED_COLUMNS
    .filter(
      ([tableName, columnName]) =>
        !(tableName === "users" && columnName === "primary_workspace_code")
    )
    .map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));

  const result = evaluateRuntimeSchema({ tableRows, columnRows });

  assert.equal(result.missing_tables.length, 0);
  assert.deepEqual(result.missing_columns, ["users.primary_workspace_code"]);
});

test("complete runtime inventory satisfies the shared readiness contract", () => {
  const tableRows = EXPECTED_TABLES.map((TABLE_NAME) => ({ TABLE_NAME }));
  const columnRows = EXPECTED_COLUMNS.map(([TABLE_NAME, COLUMN_NAME]) => ({
    TABLE_NAME,
    COLUMN_NAME,
  }));

  const result = evaluateRuntimeSchema({ tableRows, columnRows });

  assert.equal(result.missing_tables.length, 0);
  assert.equal(result.missing_columns.length, 0);
  assert.equal(result.expected_table_count, EXPECTED_TABLES.length);
  assert.equal(result.expected_column_count, EXPECTED_COLUMNS.length);
});
