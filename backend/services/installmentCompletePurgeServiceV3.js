const { pool } = require("../config/db");

const INSTALLMENT_TABLES = [
  "equipment_finance_case_activity",
  "equipment_finance_documents",
  "equipment_finance_private_documents",
  "equipment_finance_document_reviews",
  "equipment_finance_delivery_authorizations",
  "equipment_finance_delivery_confirmations",
  "equipment_finance_correction_requests",
  "equipment_finance_correction_ledger",
  "equipment_installment_schedule",
  "equipment_sale_payment_allocations",
  "equipment_sale_payments",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_asset_sale_locks",
  "equipment_credit_application_kyc",
  "equipment_credit_application_reviews",
  "equipment_credit_application_affordability",
  "equipment_credit_application_guarantors",
  "equipment_credit_application_consents",
];

const MASTER_TABLES = [
  "customers",
  "equipment_customers",
  "customer_profiles",
  "equipment_customer_profiles",
  "excavators",
  "equipment_excavators",
  "equipment",
  "equipment_assets",
  "fleet_assets",
];

const CUSTOMER_COLUMNS = ["customer_id", "customerId", "customerID", "client_id", "clientId"];
const ASSET_COLUMNS = ["asset_id", "assetId", "equipment_id", "equipmentId", "excavator_id", "excavatorId", "fleet_asset_id", "fleetAssetId"];
const APP_COLUMNS = ["application_id", "applicationId", "credit_application_id", "creditApplicationId"];
const AGREEMENT_COLUMNS = ["agreement_id", "agreementId", "sale_agreement_id", "installment_agreement_id"];
const uniq = (values) => [...new Set(values.map(Number).filter(Number.isInteger))];
const ph = (values) => values.map(() => "?").join(",");

async function exists(db, table) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  return Number(row?.count || 0) === 1;
}

async function cols(db, table) {
  if (!(await exists(db, table))) return new Set();
  const [rows] = await db.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  return new Set(rows.map((row) => String(row.COLUMN_NAME)));
}

async function deleteBy(db, table, column, ids, deleted) {
  if (!ids.length || !(await exists(db, table))) return;
  const tableColumns = await cols(db, table);
  if (!tableColumns.has(column)) return;
  const [result] = await db.query(
    `DELETE FROM \`${table}\` WHERE \`${column}\` IN (${ph(ids)})`,
    ids
  );
  if (result.affectedRows) deleted.push({ table, rows: Number(result.affectedRows), column });
}

async function collect(db) {
  const ids = { customers: [], assets: [], applications: [], agreements: [], payments: [], quotations: [] };

  for (const table of INSTALLMENT_TABLES) {
    if (!(await exists(db, table))) continue;
    const tableColumns = await cols(db, table);
    const select = [...new Set([
      ...CUSTOMER_COLUMNS,
      ...ASSET_COLUMNS,
      ...APP_COLUMNS,
      ...AGREEMENT_COLUMNS,
      "payment_id",
      "sale_payment_id",
      "quotation_id",
    ])].filter((column) => tableColumns.has(column));
    if (!select.length) continue;

    const [rows] = await db.query(
      `SELECT ${select.map((column) => `\`${column}\``).join(",")} FROM \`${table}\``
    );
    for (const row of rows) {
      for (const column of CUSTOMER_COLUMNS) if (row[column] != null) ids.customers.push(row[column]);
      for (const column of ASSET_COLUMNS) if (row[column] != null) ids.assets.push(row[column]);
      for (const column of APP_COLUMNS) if (row[column] != null) ids.applications.push(row[column]);
      for (const column of AGREEMENT_COLUMNS) if (row[column] != null) ids.agreements.push(row[column]);
      for (const column of ["payment_id", "sale_payment_id"]) if (row[column] != null) ids.payments.push(row[column]);
      if (row.quotation_id != null) ids.quotations.push(row.quotation_id);
    }
  }

  if (await exists(db, "equipment_sale_agreements")) {
    const tableColumns = await cols(db, "equipment_sale_agreements");
    if (tableColumns.has("id")) {
      const select = [
        "id",
        ...["customer_id", "customerId", "asset_id", "assetId", "equipment_id", "excavator_id", "credit_application_id", "application_id"].filter((column) => tableColumns.has(column)),
      ];
      const typeColumn = ["sale_type", "saleType", "sale_mode", "saleMode", "payment_type", "paymentType", "finance_type", "financeType"].find((column) => tableColumns.has(column));
      const where = typeColumn
        ? `WHERE LOWER(CAST(\`${typeColumn}\` AS CHAR)) IN ('installment','instalment','finance','financed','credit')`
        : "";
      const [rows] = await db.query(
        `SELECT ${select.map((column) => `\`${column}\``).join(",")} FROM equipment_sale_agreements ${where}`
      );
      for (const row of rows) {
        ids.agreements.push(row.id);
        for (const column of ["customer_id", "customerId"]) if (row[column] != null) ids.customers.push(row[column]);
        for (const column of ["asset_id", "assetId", "equipment_id", "excavator_id"]) if (row[column] != null) ids.assets.push(row[column]);
        for (const column of ["credit_application_id", "application_id"]) if (row[column] != null) ids.applications.push(row[column]);
      }
    }
  }

  ids.customers = uniq(ids.customers);
  ids.assets = uniq(ids.assets);
  ids.applications = uniq(ids.applications);
  ids.agreements = uniq(ids.agreements);
  ids.payments = uniq(ids.payments);
  ids.quotations = uniq(ids.quotations);

  if (ids.applications.length && await exists(db, "equipment_credit_applications")) {
    const tableColumns = await cols(db, "equipment_credit_applications");
    const select = [
      "id",
      ...["customer_id", "customerId", "asset_id", "assetId", "equipment_id", "excavator_id", "quotation_id"].filter((column) => tableColumns.has(column)),
    ];
    const [rows] = await db.query(
      `SELECT ${select.map((column) => `\`${column}\``).join(",")} FROM equipment_credit_applications WHERE id IN (${ph(ids.applications)})`,
      ids.applications
    );
    for (const row of rows) {
      for (const column of ["customer_id", "customerId"]) if (row[column] != null) ids.customers.push(row[column]);
      for (const column of ["asset_id", "assetId", "equipment_id", "excavator_id"]) if (row[column] != null) ids.assets.push(row[column]);
      if (row.quotation_id != null) ids.quotations.push(row.quotation_id);
    }
  }

  ids.customers = uniq(ids.customers);
  ids.assets = uniq(ids.assets);
  ids.applications = uniq(ids.applications);
  ids.agreements = uniq(ids.agreements);
  ids.payments = uniq(ids.payments);
  ids.quotations = uniq(ids.quotations);
  return ids;
}

async function deleteScoped(db, table, ids, deleted) {
  if (!(await exists(db, table))) return;
  const tableColumns = await cols(db, table);
  const scopes = [
    ["agreement_id", ids.agreements],
    ["sale_agreement_id", ids.agreements],
    ["installment_agreement_id", ids.agreements],
    ["application_id", ids.applications],
    ["credit_application_id", ids.applications],
    ["payment_id", ids.payments],
    ["sale_payment_id", ids.payments],
  ];
  for (const [column, values] of scopes) {
    if (tableColumns.has(column) && values.length) {
      await deleteBy(db, table, column, values, deleted);
      return;
    }
  }
}

async function orphanIds(db, table) {
  if (!(await exists(db, table))) return [];
  const tableColumns = await cols(db, table);
  if (!tableColumns.has("id")) return [];

  const [refs] = await db.query(
    "SELECT DISTINCT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?",
    [table, table]
  );

  const predicates = [];
  const parameters = [];
  for (const ref of refs) {
    if (!(await exists(db, ref.TABLE_NAME))) continue;
    const refColumns = await cols(db, ref.TABLE_NAME);
    if (!refColumns.has(ref.COLUMN_NAME)) continue;
    predicates.push(
      `NOT EXISTS (SELECT 1 FROM \`${ref.TABLE_NAME}\` child WHERE child.\`${ref.COLUMN_NAME}\` = parent.id)`
    );
  }

  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  const [rows] = await db.query(`SELECT parent.id FROM \`${table}\` parent ${where}`);
  return rows.map((row) => Number(row.id)).filter(Number.isInteger);
}

async function removeUnreferencedMasters(db, deleted) {
  for (const table of MASTER_TABLES) {
    const ids = await orphanIds(db, table);
    if (!ids.length) continue;
    await deleteBy(db, table, "id", ids, deleted);
  }
}

async function clearEverythingInInstallment(db, deleted = []) {
  const ids = await collect(db);

  if (ids.agreements.length && await exists(db, "equipment_sale_payments")) {
    const paymentColumns = await cols(db, "equipment_sale_payments");
    if (paymentColumns.has("agreement_id")) {
      const [rows] = await db.query(
        `SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${ph(ids.agreements)})`,
        ids.agreements
      );
      ids.payments = uniq([...ids.payments, ...rows.map((row) => row.id)]);
    }
  }

  await deleteBy(db, "equipment_sale_payment_allocations", "payment_id", ids.payments, deleted);
  for (const table of INSTALLMENT_TABLES) await deleteScoped(db, table, ids, deleted);
  await deleteBy(db, "equipment_sale_agreements", "id", ids.agreements, deleted);
  await deleteBy(db, "equipment_credit_applications", "id", ids.applications, deleted);
  await deleteBy(db, "equipment_sales_quotation_items", "quotation_id", ids.quotations, deleted);
  await deleteBy(db, "equipment_sales_quotations", "id", ids.quotations, deleted);

  // Child rows are gone; now determine orphaned master rows with set-based SQL.
  // This avoids the previous per-row/per-reference query explosion that caused 30s request timeouts.
  await removeUnreferencedMasters(db, deleted);

  return { ids, deleted };
}

async function clearEverythingInInstallmentTransaction(connection = null) {
  const owns = !connection;
  const db = connection || await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await clearEverythingInInstallment(db);
    await db.commit();
    return result;
  } catch (error) {
    try { await db.rollback(); } catch (_) {}
    throw error;
  } finally {
    if (owns) db.release();
  }
}

module.exports = {
  clearEverythingInInstallment,
  clearEverythingInInstallmentTransaction,
  collectInstallmentScope: collect,
};
