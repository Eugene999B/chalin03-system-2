const { pool } = require("../config/db");

const WORKSPACE = "equipment_installment_finance";
const OWNERSHIP_TABLE = "installment_reset_ownership";
const INSTALLMENT_TABLES = [
  "equipment_finance_case_activity","equipment_finance_documents","equipment_finance_private_documents","equipment_finance_document_reviews","equipment_finance_delivery_authorizations","equipment_finance_delivery_confirmations","equipment_finance_correction_requests","equipment_finance_correction_ledger","equipment_installment_schedule","equipment_sale_payment_allocations","equipment_sale_payments","equipment_deliveries","equipment_ownership_transfers","equipment_asset_sale_locks","equipment_credit_application_kyc","equipment_credit_application_reviews","equipment_credit_application_affordability","equipment_credit_application_guarantors","equipment_credit_application_consents",
];
const CUSTOMER_COLUMNS = ["customer_id","customerId","client_id","clientId"];
const ASSET_COLUMNS = ["asset_id","assetId","equipment_id","equipmentId","excavator_id","excavatorId","fleet_asset_id","fleetAssetId"];
const APPLICATION_COLUMNS = ["application_id","applicationId","credit_application_id","creditApplicationId"];
const AGREEMENT_COLUMNS = ["agreement_id","agreementId","sale_agreement_id","installment_agreement_id"];
const PAYMENT_COLUMNS = ["payment_id","paymentId","sale_payment_id"];
const QUOTATION_COLUMNS = ["quotation_id","quotationId"];

const placeholders = (values) => values.map(() => "?").join(",");
const uniq = (values) => [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
const quote = (value) => { const text = String(value || ""); if (!/^[A-Za-z0-9_]+$/.test(text)) throw new Error("Unsafe database identifier."); return `\`${text}\``; };

async function exists(db, table) { const [[row]] = await db.query("SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]); return Number(row?.count || 0) === 1; }
async function getColumns(db, table) { if (!(await exists(db, table))) return new Set(); const [rows] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]); return new Set(rows.map((row) => String(row.COLUMN_NAME))); }
async function requireOwnershipTable(db) { if (!(await exists(db, OWNERSHIP_TABLE))) { const error = new Error("Installment reset ownership registry is not ready."); error.statusCode = 503; error.code = "INSTALLMENT_OWNERSHIP_REGISTRY_NOT_READY"; throw error; } }

async function syncLegacyOwnership(db) {
  await requireOwnershipTable(db);
  if (!(await exists(db, "activity_log"))) return;
  const [rows] = await db.query(`SELECT entity_type, entity_id, action_type, action, workspace_code FROM activity_log WHERE entity_id REGEXP '^[0-9]+$' AND (LOWER(COALESCE(workspace_code,''))=? OR LOWER(COALESCE(action_type,'')) LIKE '%installment%' OR LOWER(COALESCE(action_type,'')) LIKE '%finance%' OR LOWER(COALESCE(action,'')) LIKE '%installment%' OR LOWER(COALESCE(action,'')) LIKE '%finance%')`, [WORKSPACE]);
  const values = [];
  for (const row of rows) { const id = Number(row.entity_id); if (!id) continue; const type = String(row.entity_type || "").toLowerCase(); const entityType = type.includes("customer") ? "customer" : type.includes("fleet") || type.includes("asset") || type.includes("equipment") || type.includes("excavator") ? "fleet_asset" : null; if (entityType) values.push([WORKSPACE, entityType, id, "legacy_installment_activity"]); }
  if (!values.length) return;
  await db.query(`INSERT IGNORE INTO ${quote(OWNERSHIP_TABLE)} (workspace_code,entity_type,entity_id,ownership_source) VALUES ${values.map(() => "(?,?,?,?)").join(",")}`, values.flat());
}
async function ownedIds(db, type) { await syncLegacyOwnership(db); const [rows] = await db.query(`SELECT entity_id FROM ${quote(OWNERSHIP_TABLE)} WHERE workspace_code=? AND entity_type=?`, [WORKSPACE, type]); return uniq(rows.map((row) => row.entity_id)); }

function harvest(row, scope) { for (const c of CUSTOMER_COLUMNS) if (row[c] != null) scope.customers.push(row[c]); for (const c of ASSET_COLUMNS) if (row[c] != null) scope.assets.push(row[c]); for (const c of APPLICATION_COLUMNS) if (row[c] != null) scope.applications.push(row[c]); for (const c of AGREEMENT_COLUMNS) if (row[c] != null) scope.agreements.push(row[c]); for (const c of PAYMENT_COLUMNS) if (row[c] != null) scope.payments.push(row[c]); for (const c of QUOTATION_COLUMNS) if (row[c] != null) scope.quotations.push(row[c]); }

async function scanInstallmentTables(db, predicate) {
  const scope = { customers: [], assets: [], applications: [], agreements: [], payments: [], quotations: [] };
  for (const table of INSTALLMENT_TABLES) {
    if (!(await exists(db, table))) continue;
    const cols = await getColumns(db, table);
    const select = [...new Set([...CUSTOMER_COLUMNS, ...ASSET_COLUMNS, ...APPLICATION_COLUMNS, ...AGREEMENT_COLUMNS, ...PAYMENT_COLUMNS, ...QUOTATION_COLUMNS])].filter((column) => cols.has(column));
    if (!select.length) continue;
    const [rows] = await db.query(`SELECT ${select.map(quote).join(",")} FROM ${quote(table)}`);
    for (const row of rows) if (!predicate || predicate(row)) harvest(row, scope);
  }
  return scope;
}

async function scanAgreements(db, predicate) {
  if (!(await exists(db, "equipment_sale_agreements"))) return { customers: [], assets: [], applications: [], agreements: [], payments: [], quotations: [] };
  const cols = await getColumns(db, "equipment_sale_agreements");
  const typeColumn = ["sale_type","saleType","payment_type","paymentType","finance_type","financeType","sale_mode","saleMode"].find((column) => cols.has(column));
  const [rows] = await db.query("SELECT * FROM equipment_sale_agreements");
  const financeTypes = new Set(["installment","instalment","finance","financed","credit"]);
  const scope = { customers: [], assets: [], applications: [], agreements: [], payments: [], quotations: [] };
  for (const row of rows) { const type = typeColumn ? String(row[typeColumn] || "").toLowerCase() : ""; if (typeColumn && !financeTypes.has(type)) continue; if (!predicate || predicate(row)) { harvest(row, scope); if (row.id != null) scope.agreements.push(row.id); } }
  return scope;
}

function mergeScopes(...scopes) { const result = { customers: [], assets: [], applications: [], agreements: [], payments: [], quotations: [] }; for (const scope of scopes) for (const key of Object.keys(result)) result[key].push(...(scope[key] || [])); return Object.fromEntries(Object.entries(result).map(([key, values]) => [key, uniq(values)])); }
async function collectScope(db) { return mergeScopes({ customers: await ownedIds(db, "customer"), assets: await ownedIds(db, "fleet_asset"), applications: [], agreements: [], payments: [], quotations: [] }, await scanInstallmentTables(db), await scanAgreements(db)); }
async function collectEntityScope(db, entityType, entityId) { const id = Number(entityId); const ownershipType = entityType === "asset" ? "fleet_asset" : "customer"; const owned = (await ownedIds(db, ownershipType)).includes(id); const columns = entityType === "asset" ? ASSET_COLUMNS : CUSTOMER_COLUMNS; const direct = await scanInstallmentTables(db, (row) => columns.some((column) => row[column] != null && Number(row[column]) === id)); const directAgreements = await scanAgreements(db, (row) => columns.some((column) => row[column] != null && Number(row[column]) === id)); const scope = mergeScopes(direct, directAgreements); if (entityType === "customer") scope.customers = uniq([id, ...scope.customers]); else scope.assets = uniq([id, ...scope.assets]); return { owned, scope }; }

async function countRelation(db, table, candidateColumns, ids) { if (!ids.length || !(await exists(db, table))) return 0; const cols = await getColumns(db, table); const column = candidateColumns.find((name) => cols.has(name)); if (!column) return 0; const [[row]] = await db.query(`SELECT COUNT(*) AS count FROM ${quote(table)} WHERE ${quote(column)} IN (${placeholders(ids)})`, ids); return Number(row?.count || 0); }
async function collectImpact(db) { const scope = await collectScope(db); const impact = []; for (const table of INSTALLMENT_TABLES) { const count = Math.max(await countRelation(db, table, AGREEMENT_COLUMNS, scope.agreements), await countRelation(db, table, APPLICATION_COLUMNS, scope.applications), await countRelation(db, table, PAYMENT_COLUMNS, scope.payments), await countRelation(db, table, CUSTOMER_COLUMNS, scope.customers), await countRelation(db, table, ASSET_COLUMNS, scope.assets)); if (count) impact.push({ table, rows: count }); } for (const [table, cols, ids] of [["equipment_sale_agreements", ["id"], scope.agreements],["equipment_credit_applications", ["id"], scope.applications],["equipment_sales_quotations", ["id"], scope.quotations]]) { const count = await countRelation(db, table, cols, ids); if (count) impact.push({ table, rows: count }); } impact.push({ table: "installment_owned_customers", rows: scope.customers.length }); impact.push({ table: "installment_owned_excavators", rows: scope.assets.length }); return { scope, impact }; }

async function externalReferences(db, table, id) { if (!(await exists(db, table))) return []; const [refs] = await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?", [table, table]); const result = []; for (const ref of refs) { if (!(await exists(db, ref.TABLE_NAME))) continue; const cols = await getColumns(db, ref.TABLE_NAME); if (!cols.has(ref.COLUMN_NAME)) continue; const [[row]] = await db.query(`SELECT COUNT(*) AS count FROM ${quote(ref.TABLE_NAME)} WHERE ${quote(ref.COLUMN_NAME)}=?`, [id]); if (Number(row?.count || 0)) result.push({ table: ref.TABLE_NAME, column: ref.COLUMN_NAME, rows: Number(row.count) }); } return result; }
function protectedReference(ref) { return /hire|hiring|mining|spare|inventory|payroll|users|auth/i.test(String(ref.table)); }
async function getEntityImpactTx(db, entityType, entityId) { const ownershipType = entityType === "asset" ? "fleet_asset" : "customer"; const { owned, scope } = await collectEntityScope(db, entityType, entityId); const masterTable = entityType === "asset" ? "fleet_assets" : "customers"; const refs = await externalReferences(db, masterTable, Number(entityId)); const protectedRefs = refs.filter(protectedReference); return { entity_type: entityType, entity_id: Number(entityId), explicitly_installment_owned: owned, installment_scope: scope, external_references: refs, protected_external_references: protectedRefs, master_delete_eligible: owned && protectedRefs.length === 0 && refs.length === 0, preservation_reason: protectedRefs.length ? "Referenced by another business module." : refs.length ? "Still referenced by another database record." : null }; }

async function deleteRelation(db, table, candidateColumns, ids, deleted) { if (!ids.length || !(await exists(db, table))) return; const cols = await getColumns(db, table); const column = candidateColumns.find((name) => cols.has(name)); if (!column) return; const [result] = await db.query(`DELETE FROM ${quote(table)} WHERE ${quote(column)} IN (${placeholders(ids)})`, ids); if (result.affectedRows) deleted.push({ table, rows: Number(result.affectedRows), column }); }
async function deleteScopedRows(db, scope, deleted) { await deleteRelation(db, "equipment_sale_payment_allocations", PAYMENT_COLUMNS, scope.payments, deleted); await deleteRelation(db, "equipment_sale_payments", ["id", ...PAYMENT_COLUMNS], scope.payments, deleted); for (const table of [...INSTALLMENT_TABLES].reverse()) { await deleteRelation(db, table, AGREEMENT_COLUMNS, scope.agreements, deleted); await deleteRelation(db, table, APPLICATION_COLUMNS, scope.applications, deleted); await deleteRelation(db, table, PAYMENT_COLUMNS, scope.payments, deleted); await deleteRelation(db, table, CUSTOMER_COLUMNS, scope.customers, deleted); await deleteRelation(db, table, ASSET_COLUMNS, scope.assets, deleted); } await deleteRelation(db, "equipment_sale_agreements", ["id", ...AGREEMENT_COLUMNS], scope.agreements, deleted); await deleteRelation(db, "equipment_credit_applications", ["id", ...APPLICATION_COLUMNS], scope.applications, deleted); await deleteRelation(db, "equipment_sales_quotation_items", QUOTATION_COLUMNS, scope.quotations, deleted); await deleteRelation(db, "equipment_sales_quotations", ["id", ...QUOTATION_COLUMNS], scope.quotations, deleted); }

async function removeOwnedMaster(db, entityType, entityId, deleted) { const impact = await getEntityImpactTx(db, entityType, entityId); if (!impact.master_delete_eligible) return { entity_type: entityType, entity_id: entityId, deleted: false, reason: impact.preservation_reason || "remaining_reference", impact }; const table = entityType === "asset" ? "fleet_assets" : "customers"; if (entityType === "asset") { await deleteRelation(db, "equipment_media", ASSET_COLUMNS, [entityId], deleted); await deleteRelation(db, "equipment_machine_opening_meter", ASSET_COLUMNS, [entityId], deleted); } if (await exists(db, table)) { const [result] = await db.query(`DELETE FROM ${quote(table)} WHERE id=?`, [entityId]); if (result.affectedRows) deleted.push({ table, rows: Number(result.affectedRows) }); } await db.query(`DELETE FROM ${quote(OWNERSHIP_TABLE)} WHERE workspace_code=? AND entity_type=? AND entity_id=?`, [WORKSPACE, entityType === "asset" ? "fleet_asset" : "customer", entityId]); return { entity_type: entityType, entity_id: entityId, deleted: true, impact }; }

async function getEntityImpact(entityType, entityId) { const db = await pool.getConnection(); try { return await getEntityImpactTx(db, entityType, Number(entityId)); } finally { db.release(); } }
async function deleteEntityTransaction(entityType, entityId) { const db = await pool.getConnection(); const id = Number(entityId); try { await db.beginTransaction(); const impact = await getEntityImpactTx(db, entityType, id); if (!impact.explicitly_installment_owned) { const error = new Error("This record is not explicitly owned by Installment Finance, so the deletion was refused."); error.statusCode = 409; error.code = "INSTALLMENT_ENTITY_NOT_OWNED"; throw error; } const deleted = []; await deleteScopedRows(db, impact.installment_scope, deleted); const master = await removeOwnedMaster(db, entityType, id, deleted); await db.commit(); return { status: "success", entity_type: entityType, entity_id: id, deleted, master, message: master.deleted ? "Installment record and its owned master record were deleted." : "Installment-linked data was cleared; the master record remains because it is shared or still referenced." }; } catch (error) { try { await db.rollback(); } catch (_) {} throw error; } finally { db.release(); } }
async function resetInstallmentTransaction() { const db = await pool.getConnection(); try { await db.beginTransaction(); const { scope, impact } = await collectImpact(db); const deleted = []; await deleteScopedRows(db, scope, deleted); const masters = []; for (const assetId of scope.assets) masters.push(await removeOwnedMaster(db, "asset", assetId, deleted)); for (const customerId of scope.customers) masters.push(await removeOwnedMaster(db, "customer", customerId, deleted)); await db.commit(); return { status: "success", scope, impact, deleted, masters, message: "Installment Finance was cleared by the unified deletion engine." }; } catch (error) { try { await db.rollback(); } catch (_) {} throw error; } finally { db.release(); } }

module.exports = { WORKSPACE, collectScope, collectImpact, getEntityImpact, deleteEntityTransaction, resetInstallmentTransaction };
