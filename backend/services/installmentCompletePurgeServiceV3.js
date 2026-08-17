const { pool } = require("../config/db");

const OWNERSHIP_TABLE = "installment_reset_ownership";
const INSTALLMENT_WORKSPACE = "equipment_installment_finance";

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

async function requireOwnershipTable(db) {
  if (!(await exists(db, OWNERSHIP_TABLE))) {
    const error = new Error("Installment reset ownership migration is not deployed yet.");
    error.code = "INSTALLMENT_RESET_OWNERSHIP_MIGRATION_REQUIRED";
    error.statusCode = 503;
    throw error;
  }
}

async function syncActivityOwnership(db) {
  await db.query(
    `INSERT IGNORE INTO ${OWNERSHIP_TABLE}
      (workspace_code, entity_type, entity_id, ownership_source)
     SELECT DISTINCT ?, 'fleet_asset', CAST(registration.entity_id AS UNSIGNED), ?
       FROM activity_log registration
      WHERE registration.entity_type = 'fleet_asset'
        AND registration.entity_id REGEXP '^[0-9]+$'
        AND (registration.action_type = 'equipment.finance.machine.register'
             OR registration.action = 'EQUIPMENT_FINANCE_MACHINE_REGISTERED')
        AND (registration.workspace_code = ? OR registration.workspace_code IS NULL)`,
    [INSTALLMENT_WORKSPACE, "activity_log_installment_machine_registration", INSTALLMENT_WORKSPACE]
  );

  await db.query(
    `INSERT IGNORE INTO ${OWNERSHIP_TABLE}
      (workspace_code, entity_type, entity_id, ownership_source)
     SELECT DISTINCT ?, 'customer', CAST(registration.entity_id AS UNSIGNED), ?
       FROM activity_log registration
      WHERE registration.entity_id REGEXP '^[0-9]+$'
        AND registration.entity_type IN ('customer','customers','customer_profile','customer_identity')
        AND (LOWER(COALESCE(registration.action_type,'')) LIKE '%customer%register%'
          OR LOWER(COALESCE(registration.action_type,'')) LIKE '%customer%create%'
          OR LOWER(COALESCE(registration.action,'')) LIKE '%customer%register%'
          OR LOWER(COALESCE(registration.action,'')) LIKE '%customer%create%')
        AND (registration.workspace_code = ? OR registration.workspace_code IS NULL)`,
    [INSTALLMENT_WORKSPACE, "activity_log_installment_customer_registration", INSTALLMENT_WORKSPACE]
  );
}

async function registerDiscoveredOwnership(db, ids) {
  await requireOwnershipTable(db);
  const rows = [];
  for (const id of ids.customers) rows.push([INSTALLMENT_WORKSPACE, "customer", id, "installment_scope_discovered"]);
  for (const id of ids.assets) rows.push([INSTALLMENT_WORKSPACE, "fleet_asset", id, "installment_scope_discovered"]);
  if (!rows.length) return;
  await db.query(
    `INSERT IGNORE INTO ${OWNERSHIP_TABLE}
      (workspace_code, entity_type, entity_id, ownership_source)
     VALUES ${rows.map(() => "(?,?,?,?)").join(",")}`,
    rows.flat()
  );
}

async function ownershipIds(db, entityType) {
  await requireOwnershipTable(db);
  const [rows] = await db.query(
    `SELECT entity_id FROM ${OWNERSHIP_TABLE}
      WHERE workspace_code = ? AND entity_type = ?`,
    [INSTALLMENT_WORKSPACE, entityType]
  );
  return uniq(rows.map((row) => row.entity_id));
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
    const [rows] = await db.query(`SELECT ${select.map((column) => `\`${column}\``).join(",")} FROM \`${table}\``);
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
      const [rows] = await db.query(`SELECT ${select.map((column) => `\`${column}\``).join(",")} FROM equipment_sale_agreements ${where}`);
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
    const [rows] = await db.query(`SELECT ${select.map((column) => `\`${column}\``).join(",")} FROM equipment_credit_applications WHERE id IN (${ph(ids.applications)})`, ids.applications);
    for (const row of rows) {
      for (const column of ["customer_id", "customerId"]) if (row[column] != null) ids.customers.push(row[column]);
      for (const column of ["asset_id", "assetId", "equipment_id", "excavator_id"]) if (row[column] != null) ids.assets.push(row[column]);
      if (row.quotation_id != null) ids.quotations.push(row.quotation_id);
    }
  }

  await syncActivityOwnership(db);
  ids.customers = uniq([...ids.customers, ...(await ownershipIds(db, "customer"))]);
  ids.assets = uniq([...ids.assets, ...(await ownershipIds(db, "fleet_asset"))]);
  await registerDiscoveredOwnership(db, { customers: uniq(ids.customers), assets: uniq(ids.assets) });

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

function protectedModuleReference(tableName) {
  const name = String(tableName || "").toLowerCase();
  return /(^|_)(hire|hiring|rental|mining|spare|inventory|payroll|user|auth|audit|activity|migration|branch)(_|$)/.test(name);
}

async function hasProtectedReference(db, table, ids) {
  if (!ids.length || !(await exists(db, table))) return false;
  const refs = await db.query(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?",
    [table, table]
  );
  for (const ref of refs[0]) {
    if (protectedModuleReference(ref.TABLE_NAME)) {
      const refColumns = await cols(db, ref.TABLE_NAME);
      if (!refColumns.has(ref.COLUMN_NAME)) continue;
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS count FROM \`${ref.TABLE_NAME}\` WHERE \`${ref.COLUMN_NAME}\` IN (${ph(ids)})`,
        ids
      );
      if (Number(row?.count || 0) > 0) return true;
    }
  }
  return false;
}

async function removeOwnedMasters(db, ids, deleted) {
  await requireOwnershipTable(db);
  const customerIds = await ownershipIds(db, "customer");
  const assetIds = await ownershipIds(db, "fleet_asset");

  if (await exists(db, "equipment_media")) {
    await deleteBy(db, "equipment_media", "asset_id", assetIds, deleted);
  }

  if (customerIds.length && await exists(db, "customers") && !(await hasProtectedReference(db, "customers", customerIds))) {
    await deleteBy(db, "customers", "id", customerIds, deleted);
  }

  if (assetIds.length && await exists(db, "fleet_assets") && !(await hasProtectedReference(db, "fleet_assets", assetIds))) {
    await deleteBy(db, "fleet_assets", "id", assetIds, deleted);
  }

  if (customerIds.length && await exists(db, "installment_reset_ownership")) {
    await deleteBy(db, "installment_reset_ownership", "entity_id", customerIds, deleted);
  }
  if (assetIds.length && await exists(db, "installment_reset_ownership")) {
    const tableColumns = await cols(db, "installment_reset_ownership");
    if (tableColumns.has("entity_type")) {
      const [result] = await db.query(
        `DELETE FROM installment_reset_ownership WHERE entity_type='fleet_asset' AND entity_id IN (${ph(assetIds)})`,
        assetIds
      );
      if (result.affectedRows) deleted.push({ table: "installment_reset_ownership", rows: Number(result.affectedRows), entity_type: "fleet_asset" });
    }
  }
}

async function clearEverythingInInstallment(db, deleted = []) {
  await requireOwnershipTable(db);
  const ids = await collect(db);

  if (ids.agreements.length && await exists(db, "equipment_sale_payments")) {
    const paymentColumns = await cols(db, "equipment_sale_payments");
    if (paymentColumns.has("agreement_id")) {
      const [rows] = await db.query(`SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${ph(ids.agreements)})`, ids.agreements);
      ids.payments = uniq([...ids.payments, ...rows.map((row) => row.id)]);
    }
  }

  await deleteBy(db, "equipment_sale_payment_allocations", "payment_id", ids.payments, deleted);
  for (const table of INSTALLMENT_TABLES) await deleteScoped(db, table, ids, deleted);
  await deleteBy(db, "equipment_sale_agreements", "id", ids.agreements, deleted);
  await deleteBy(db, "equipment_credit_applications", "id", ids.applications, deleted);
  await deleteBy(db, "equipment_sales_quotation_items", "quotation_id", ids.quotations, deleted);
  await deleteBy(db, "equipment_sales_quotations", "id", ids.quotations, deleted);
  await removeOwnedMasters(db, ids, deleted);

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
