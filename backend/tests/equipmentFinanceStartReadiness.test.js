const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REQUIRED_START_SCHEMA,
  FinanceStartSchemaError,
  inspectStartSchema,
  assertStartSchema,
} = require("../services/equipmentFinanceStartReadinessService");

function connectionFromSchema(schema) {
  const calls = [];
  return {
    calls,
    async query(sql, args) {
      calls.push({ sql, args });
      const rows = Object.entries(schema).flatMap(([table, columns]) =>
        Object.entries(columns).map(([column, nullable]) => ({
          TABLE_NAME: table,
          COLUMN_NAME: column,
          IS_NULLABLE: nullable,
        }))
      );
      return [rows];
    },
  };
}

function fullSchema() {
  return Object.fromEntries(
    Object.entries(REQUIRED_START_SCHEMA).map(([table, columns]) => [
      table,
      Object.fromEntries(columns.map((column) => [column,
        column === "hire_location_id" ? "YES" : "NO"])),
    ])
  );
}

test("read-only preflight accepts the full Finance application creation contract", async () => {
  const connection = connectionFromSchema(fullSchema());
  const readiness = await assertStartSchema(connection);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing_tables, []);
  assert.deepEqual(readiness.missing_columns, []);
  assert.deepEqual(readiness.invalid_nullability, []);
  assert.equal(connection.calls.length, 1);
  assert.match(connection.calls[0].sql, /FROM information_schema.COLUMNS/);
  assert.doesNotMatch(connection.calls[0].sql, /INSERT INTO|UPDATE [a-z]|DELETE FROM|ALTER TABLE/i);
});

test("preflight pinpoints missing Finance columns and table without a transaction", async () => {
  const schema = fullSchema();
  delete schema.equipment_credit_applications.proposed_non_working_day_rule;
  delete schema.equipment_credit_applications.proposed_first_due_date;
  delete schema.equipment_credit_application_decisions;
  const connection = connectionFromSchema(schema);
  const readiness = await inspectStartSchema(connection);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing_tables.includes("equipment_credit_application_decisions"));
  assert.ok(readiness.missing_columns.includes("equipment_credit_applications.proposed_non_working_day_rule"));
  assert.ok(readiness.missing_columns.includes("equipment_credit_applications.proposed_first_due_date"));
  await assert.rejects(assertStartSchema(connection), (error) => {
    assert.ok(error instanceof FinanceStartSchemaError);
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, "FINANCE_START_SCHEMA_REQUIRED");
    assert.equal(error.readiness.ready, false);
    return true;
  });
});

test("preflight blocks nonnullable hire locations for company-wide Finance", async () => {
  const schema = fullSchema();
  schema.equipment_sales_quotations.hire_location_id = "NO";
  const readiness = await inspectStartSchema(connectionFromSchema(schema));
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.invalid_nullability, [
    "equipment_sales_quotations.hire_location_id",
  ]);
});

test("route checks Finance schema before generating numbers or creating a quotation", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../routes/equipmentFinancePhaseOneRoutes.js"), "utf8");
  const start = source.indexOf('"/phase-one/start-installment",');
  const guard = source.indexOf("await assertStartSchema(pool);", start);
  const number = source.indexOf('documentNumber(', start);
  assert.ok(start > 0 && guard > start && number > guard);
  assert.match(source, /"\/phase-one\/start-installment-readiness"/);
});

test("the image-safe Finance handler mounted first also checks schema before document numbers", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(
    path.join(__dirname, "../routes/equipmentFinanceImageSafeStartRoutes.js"),
    "utf8"
  );
  const start = source.indexOf('"/phase-one/start-installment",');
  const preflight = source.indexOf("await assertStartSchema(pool);", start);
  const documentNumbers = source.indexOf('documentNumber("EQUIPMENT_CREDIT_APPLICATION"', start);
  assert.ok(start > 0 && preflight > start && documentNumbers > preflight);
  assert.match(source, /error instanceof FinanceStartSchemaError/);
  const mainRouter = fs.readFileSync(
    path.join(__dirname, "../routes/equipmentFinanceIndependentRoutes.js"),
    "utf8"
  );
  assert.ok(
    mainRouter.indexOf("router.use(equipmentFinanceImageSafeStartRoutes);") <
    mainRouter.indexOf("router.use(equipmentFinancePhaseOneRoutes);")
  );
});
