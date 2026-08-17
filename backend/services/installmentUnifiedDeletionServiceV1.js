const { pool } = require("../config/db");
const OWNERSHIP_TABLE = "installment_reset_ownership";
const WORKSPACE = "equipment_installment_finance";
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
const CUSTOMER_COLUMNS = ["customer_id", "customerId", "client_id", "clientId"];
const ASSET_COLUMNS = ["asset_id", "assetId", "equipment_id", "equipmentId", "excavator_id", "excavatorId", "fleet_asset_id", "fleetAssetId"];
const APPLICATION_COLUMNS = ["application_id", "applicationId", "credit_application_id", "creditApplicationId"];
const AGREEMENT_COLUMNS = ["agreement_id", "agreementId", "sale_agreement_id", "installment_agreement_id"];
const PAYMENT_COLUMNS = ["payment_id", "paymentId", "sale_payment_id"];
const QUOTATION_COLUMNS = ["quotation_id", "quotationId"];

function placeholders(values) { return values.map(() => "?").join(","); }
function uniqIds(values) { return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))]; }
function safeIdentifier(value) { if (!/^[A-Za-z0-9_]+$/.test(String(value))) throw new Error("Unsafe database identifier."); return `\`${value}\``; }

async function tableExists(db, table) {
  const [[row]] = await db.query("SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  return Number(row?.count || 0) === 1;
}
async function columns(db, table) {
  if (!(await tableExists(db, table))) return new Set();
  const [rows] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  return new Set(rows.map((row) => String(row.COLUMN_NAME)));
}
async function requireOwnershipTable(db) {
  if (!(await tableExists(db, OWNERSHIP_TABLE))) {
    const error = new Error("Installment reset ownership registry is not ready. Railway migration/startup must complete first.");
    error.statusCode = 503;
    error.code = "INSTALLMENT_OWNERSHIP_REGISTRY_NOT_READY";
    throw error;
  }
}

async function backfillLegacyOwnership(db) {
  await requireOwnershipTable(db);
  if (!(await tableExists(db, "activity_log"))) return;
  const [rows] = await db.query(
    `SELECT entity_type, entity_id, action_type, action, workspace_code
     FROM activity_log
     WHERE entity_id REGEXP '^[0-9]+$'
       AND (
         LOWER(COALESCE(workspace_code,'')) = ?
         OR LOWER(COALESCE(action_type,'')) LIKE '%installment%'
         OR LOWER(COALESCE(action_type,'')) LIKE '%finance%'
         OR LOWER(COALESCE(action,'')) LIKE '%installment%'
         OR LOWER(COALESCE(action,'')) LIKE '%finance%'
       )`,
    [WORKSPACE]
  );
  const customerIds = [];
  const assetIds = [];
  for (const row of rows) {
    const id = Number(row.entity_id);
    if (!id) continue;
    const type = String(row.entity_type || "").toLowerCase();
    if (type.includes("customer")) customerIds.push(id);
    if (type.includes("fleet") || type.includes("asset") || type.includes("equipment") || type.includes("excavator")) assetIds.push(id);
  }
  if (customerIds.length) {
    await db.query(`INSERT IGNORE INTO ${OWNERSHIP_TABLE} (workspace_code,entity_type,entity_id,ownership_source) VALUES ${customerIds.map(() => "(?,?,?,?)").join(",")}`, customerIds.flatMap((id) => [WORKSPACE, "customer", id, "legacy_installment_activity"]));
  }
  if (assetIds.length) {
    await db.query(`INSERT IGNORE INTO ${OWNERSHIP_TABLE} (workspace_code,entity_type,entity_id,ownership_source) VALUES ${assetIds.map(() => "(?,?,?,?)").join(",")}`, assetIds.flatMap((id) => [WORKSPACE, "fleet_asset", id, "legacy_installment_activity"]));
  }
}

async function ownershipIds(db, type) {
  await backfillLegacyOwnership(db);
  const [rows] = await db.query(`SELECT entity_id FROM ${OWNERSHIP_TABLE} WHERE workspace_code=? AND entity_type=?`, [WORKSPACE, type]);
  return uniqIds(rows.map((row) => row.entity_id));
}

async function collectInstallmentScope(db) {
  const scope = { customers: await ownershipIds(db, "customer"), assets: await ownershipIds(db, "fleet_asset"), applications: [], agreements: [], payments: [], quotations: [] };
  for (const table of INSTALLMENT_TABLES) {
    if (!(await tableExists(db, table))) continue;
    const cols = await columns(db, table);
    const select = [...new Set([...APPLICATION_COLUMNS, ...AGREEMENT_COLUMNS, ...PAYMENT_COLUMNS, ...QUOTATION_COLUMNS, ...CUSTOMER_COLUMNS, ...ASSET_COLUMNS])].filter((name) => cols.has(name));
    if (!select.length) continue;
    const [rows] = await db.query(`SELECT ${select.map(safeIdentifier).join(",")} FROM ${safeIdentifier(table)}`);
    for (const row of rows) {
      for (const c of APPLICATION_COLUMNS) if (row[c] != null) scope.applications.push(row[c]);
      for (const c of AGREEMENT_COLUMNS) if (row[c] != null) scope.agreements.push(row[c]);
      for (const c of PAYMENT_COLUMNS) if (row[c] != null) scope.payments.push(row[c]);
      for (const c of QUOTATION_COLUMNS) if (row[c] != null) scope.quotations.push(row[c]);
      for (const c of CUSTOMER_COLUMNS) if (row[c] != null) scope.customers.push(row[c]);
      for (const c of ASSET_COLUMNS) if (row[c] != null) scope.assets.push(row[c]);
    }
  }
  const agreementTable = "equipment_sale_agreements";
  if (await tableExists(db, agreementTable)) {
    const cols = await columns(db, agreementTable);
    const [rows] = await db.query(`SELECT * FROM ${safeIdentifier(agreementTable)}`);
    const financeTypes = ["installment", "instalment", "finance", "financed", "credit"];
    const typeColumn = ["sale_type", "saleType", "payment_type", "paymentType", "finance_type", "financeType", "sale_mode", "saleMode"].find((c) => cols.has(c));
    for (const row of rows) {
      const type = typeColumn ? String(row[typeColumn] || "").toLowerCase() : "";
      if (typeColumn && !financeTypes.includes(type)) continue;
      for (const c of AGREEMENT_COLUMNS) if (row[c] != null) scope.agreements.push(row[c]);
      for (const c of CUSTOMER_COLUMNS) if (row[c] != null) scope.customers.push(row[c]);
      for (const c of ASSET_COLUMNS) if (row[c] != null) scope.assets.push(row[c]);
      for (const c of APPLICATION_COLUMNS) if (row[c] != null) scope.applications.push(row[c]);
      if (row.id != null) scope.agreements.push(row.id);
    }
  }
  return Object.fromEntries(Object.entries(scope).map(([key, values]) => [key, uniqIds(values)]));
}

function relationColumns(cols, groups) {
  const result = [];
  for (const group of groups) for (const c of group) if (cols.has(c)) result.push(c);
  return [...new Set(result)];
}

async function childRowsForEntity(db, entityType, entityId) {
  const result = { applications: [], agreements: [], payments: [], quotations: [], customers: [], assets: [] };
  const groups = entityType === "customer" ? [CUSTOMER_COLUMNS] : [ASSET_COLUMNS];
  for (const table of INSTALLMENT_TABLES) {
    if (!(await tableExists(db, table))) continue;
    const cols = await columns(db, table);
    for (const column of relationColumns(cols, groups)) {
      const [rows] = await db.query(`SELECT * FROM ${safeIdentifier(table)} WHERE ${safeIdentifier(column)}=?`, [entityId]);
      if (rows.length) {
        result[entityType === "customer" ? "customers" : "assets"].push({ table, column, rows: rows.length });
        for (const row of rows) {
          for (const c of APPLICATION_COLUMNS) if (row[c] != null) result.applications.push(Number(row[c]));
          for (const c of AGREEMENT_COLUMNS) if (row[c] != null) result.agreements.push(Number(row[c]));
          for (const c of PAYMENT_COLUMNS) if (row[c] != null) result.payments.push(Number(row[c]));
          for (const c of QUOTATION_COLUMNS) if (row[c] != null) result.quotations.push(Number(row[c]));
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Array.isArray(value) && value.every((v) => typeof v === "number") ? uniqIds(value) : value]));
}

async function externalReferences(db, table, id) {
  if (!(await tableExists(db, table))) return [];
  const [refs] = await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?", [table, table]);
  const out = [];
  for (const ref of refs) {
    if (!(await tableExists(db, ref.TABLE_NAME))) continue;
    const cols = await columns(db, ref.TABLE_NAME);
    if (!cols.has(ref.COLUMN_NAME)) continue;
    const [[row]] = await db.query(`SELECT COUNT(*) AS count FROM ${safeIdentifier(ref.TABLE_NAME)} WHERE ${safeIdentifier(ref.COLUMN_NAME)}=?`, [id]);
    if (Number(row?.count || 0)) out.push({ table: ref.TABLE_NAME, column: ref.COLUMN_NAME, rows: Number(row.count) });
  }
  return out;
}

async function entityImpact(db, entityType, entityId) {
  const type = entityType === "asset" ? "fleet_asset" : "customer";
  const owned = (await ownershipIds(db, type)).includes(Number(entityId));
  const linked = await childRowsForEntity(db, entityType, Number(entityId));
  const masterTable = entityType === "asset" ? "fleet_assets" : "customers";
  const refs = await externalReferences(db, masterTable, Number(entityId));
  const protectedRefs = refs.filter((ref) => /hire|hiring|mining|spare|inventory/i.test(ref.table));
  return {
    entity_type: entityType,
    entity_id: Number(entityId),
    explicitly_installment_owned: owned,
    installment_child_links: linked,
    external_references: refs,
    protected_external_references: protectedRefs,
    master_delete_eligible: owned && protectedRefs.length === 0 && refs.every((ref) => /installment|finance|sale|customer|debt/i.test(ref.table)),
  };
}

async function deleteByRelation(db, table, columnsToTry, ids, deleted) {
  if (!ids.length || !(await tableExists(db, table))) return;
  const cols = await columns(db, table);
  for (const column of columnsToTry) {
    if (!cols.has(column)) continue;
    const [result] = await db.query(`DELETE FROM ${safeIdentifier(table)} WHERE ${safeIdentifier(column)} IN (${placeholders(ids)})`, ids);
    if (result.affectedRows) deleted.push({ table, rows: Number(result.affectedRows), column });
    return;
  }
}

async function deleteInstallmentEntity(db, entityType, entityId) {
  const impact = await entityImpact(db, entityType, entityId);
  if (!impact.explicitly_installment_owned) {
    const error = new Error("This master record is not explicitly owned by Installment Finance, so the delete was refused.");
    error.statusCode = 409;
    error.code = "INSTALLMENT_ENTITY_NOT_OWNED";
    throw error;
  }
  const ids = await collectInstallmentScope(db);
  const deleted = [];
  const linked = impact.installment_child_links;
  const applicationIds = uniqIds(linked.applications || []).concat(ids.applications);
  const agreementIds = uniqIds(linked.agreements || []).concat(ids.agreements);
  const paymentIds = uniqIds(linked.payments || []).concat(ids.payments);
  const quotationIds = uniqIds(linked.quotations || []).concat(ids.quotations);

  await deleteByRelation(db, "equipment_sale_payment_allocations", PAYMENT_COLUMNS, paymentIds, deleted);
  await deleteByRelation(db, "equipment_sale_payments", AGREEMENT_COLUMNS.concat(PAYMENT_COLUMNS), paymentIds, deleted);
  for (const table of INSTALLMENT_TABLES) {
    await deleteByRelation(db, table, AGREEMENT_COLUMNS.concat(APPLICATION_COLUMNS).concat(PAYMENT_COLUMNS), agreementIds.length ? agreementIds : applicationIds.length ? applicationIds : paymentIds);
  }
  await deleteByRelation(db, "equipment_sale_agreements", ["id", ...AGREEMENT_COLUMNS], agreementIds, deleted);
  await deleteByRelation(db, "equipment_credit_applications", ["id", ...APPLICATION_COLUMNS], applicationIds, deleted);
  await deleteByRelation(db, "equipment_sales_quotation_items", QUOTATION_COLUMNS, quotationIds, deleted);
  await deleteByRelation(db, "equipment_sales_quotations", ["id", ...QUOTATION_COLUMNS], quotationIds, deleted);

  const ownershipDelete = async () => {
    const [result] = await db.query(`DELETE FROM ${OWNERSHIP_TABLE} WHERE workspace_code=? AND entity_type=? AND entity_id=?`, [WORKSPACE, entityType === "asset" ? "fleet_asset" : "customer", entityId]);
    if (result.affectedRows) deleted.push({ table: OWNERSHIP_TABLE, rows: Number(result.affectedRows) });
  };

  if (impact.master_delete_eligible) {
    if (entityType === "asset") {
      await deleteByRelation(db, "equipment_media", ASSET_COLUMNS, [entityId], deleted);
      await deleteByRelation(db, "equipment_machine_opening_meter", ASSET_COLUMNS, [entityId], deleted);
      if (await tableExists(db, "fleet_assets")) {
        const [result] = await db.query("DELETE FROM fleet_assets WHERE id=?", [entityId]);
        if (result.affectedRows) deleted.push({ table: "fleet_assets", rows: Number(result.affectedRows) });
      }
    } else if (await tableExists(db, "customers")) {
      const [result] = await db.query("DELETE FROM customers WHERE id=?", [entityId]);
      if (result.affectedRows) deleted.push({ table: "customers", rows: Number(result.affectedRows) });
    }
    await ownershipDelete();
  }

  return { impact, deleted };
}

async function withTransaction(work) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await work(db);
    await db.commit();
    return result;
  } catch (error) {
    try { await db.rollback(); } catch (_) {}
    throw error;
  } finally {
    db.release();
  }
}

async function deleteInstallmentEntityTransaction(entityType, entityId) {
  return withTransaction((db) => deleteInstallmentEntity(db, entityType, Number(entityId)));
}

async function getInstallmentEntityImpact(entityType, entityId) {
  const db = await pool.getConnection();
  try { return await entityImpact(db, entityType, Number(entityId)); } finally { db.release(); }
}

module.exports = {
  WORKSPACE,
  collectInstallmentScope,
  getInstallmentEntityImpact,
  deleteInstallmentEntityTransaction,
};
