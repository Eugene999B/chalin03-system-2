const { pool } = require("../config/db");

const POLICY_COLUMNS = Object.freeze([
  "default_week_interval_weeks",
  "late_fee_trigger_mode",
  "late_fee_decision_mode",
]);

async function verifyEquipmentFinanceLateFeePolicySchema(connection = pool) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_settings'
        AND COLUMN_NAME IN (?, ?, ?)`,
    POLICY_COLUMNS
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  const missingColumns = POLICY_COLUMNS.filter((column) => !existing.has(column));

  const [tables] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_late_fee_decisions'`
  );

  if (missingColumns.length || tables.length !== 1) {
    const error = new Error(
      `Finance installment policy schema is not ready. Missing columns: ${missingColumns.join(", ") || "none"}. Decision table present: ${tables.length === 1}. Run the approved production migration.`
    );
    error.statusCode = 503;
    error.code = "EQUIPMENT_FINANCE_POLICY_SCHEMA_NOT_READY";
    throw error;
  }

  return {
    ready: true,
    missing_columns: [],
    decision_table_present: true,
  };
}

module.exports = {
  verifyEquipmentFinanceLateFeePolicySchema,
  ensureEquipmentFinanceLateFeePolicySchema: verifyEquipmentFinanceLateFeePolicySchema,
};
