const crypto = require("crypto");
const { pool } = require("../config/db");
const { collectInstallmentScope } = require("./installmentCompletePurgeServiceV3");

const FINANCE_WORKSPACE = "equipment_installment_finance";
const RESET_CONFIRMATION = "RESET INSTALLMENT FINANCE";

async function countTable(connection, table) {
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  if (Number(row?.count || 0) !== 1) return 0;
  const [[countRow]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
  return Number(countRow?.count || 0);
}

async function buildDryRun(connection = pool) {
  const scope = await collectInstallmentScope(connection);
  const impact = [
    { table: "equipment_credit_applications", rows: await countTable(connection, "equipment_credit_applications") },
    { table: "equipment_sale_agreements", rows: await countTable(connection, "equipment_sale_agreements") },
    { table: "equipment_sale_payments", rows: await countTable(connection, "equipment_sale_payments") },
    { table: "equipment_installment_schedule", rows: await countTable(connection, "equipment_installment_schedule") },
    { table: "equipment_deliveries", rows: await countTable(connection, "equipment_deliveries") },
    { table: "equipment_ownership_transfers", rows: await countTable(connection, "equipment_ownership_transfers") },
    { table: "installment_owned_customers", rows: scope.customers.length },
    { table: "installment_owned_excavators", rows: scope.assets.length },
  ];

  const payload = {
    workspace: FINANCE_WORKSPACE,
    mode: "installment_reset_dry_run_v2",
    impact,
    ownership_scope: {
      customers: scope.customers.length,
      excavators: scope.assets.length,
      applications: scope.applications.length,
      agreements: scope.agreements.length,
      payments: scope.payments.length,
      quotations: scope.quotations.length,
    },
    preserves: [
      "Hiring records and contracts",
      "Mining records",
      "Spare Parts records",
      "shared customers not explicitly owned by Installment",
      "shared excavators not explicitly owned by Installment",
      "users and permissions",
      "audit history",
      "Finance configuration and settings",
    ],
    confirmation_phrase: RESET_CONFIRMATION,
  };

  return {
    ...payload,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}

module.exports = {
  FINANCE_WORKSPACE,
  RESET_CONFIRMATION,
  buildDryRun,
};
