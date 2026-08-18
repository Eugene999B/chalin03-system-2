const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");

const router = express.Router();
const WORKSPACE = "equipment_installment_finance";
const RESET_PHRASE = "RESET INSTALLMENT FINANCE";
const MASTER = { customer: "hire_customers", asset: "fleet_assets" };
const FINANCE_PREFIXES = [
  "equipment_finance_", "equipment_credit_", "equipment_installment_",
  "equipment_sales_", "equipment_sale_", "equipment_delivery",
  "equipment_ownership", "equipment_asset_sale"
];
const EXCLUDED = new Set(["activity_log", "audit_log", "schema_migrations"]);

const q = (id) => {
  if (!/^[A-Za-z0-9_]+$/.test(String(id))) throw new Error("Unsafe database identifier.");
  return `\`${id}\``;
};
const ids = (values) => [...new Set(values.map(Number).filter((v) => Number.isInteger(v) && v > 0))];
const ph = (values) => values.map(() => "?").join(",");
const isFinanceTable = (table, cols) => {
  const name = String(table || "").toLowerCase();
  return !EXCLUDED.has(name) &&
    (FINANCE_PREFIXES.some((prefix) => name.startsWith(prefix)) || cols.has("workspace_code") || name === "equipment_media");
};
const isSharedTable = (table) => /(^|_)(hire|hiring|mining|spare|payroll|stock|inventory)(_|$)/i.test(String(table));

async function tableExists(db, table) {
  const [[r]] = await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  return Number(r?.n || 0) === 1;
}

async function schemaMap(db) {
  const [rows] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND (COLUMN_NAME IN ('workspace_code','customer_id','client_id','asset_id','equipment_id','fleet_asset_id','excavator_id')
            OR TABLE_NAME IN ('hire_customers','fleet_assets','activity_log'))`
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.TABLE_NAME)) map.set(row.TABLE_NAME, new Set());
    map.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  return map;
}

async function legacyCustomers(db) {
  if (!(await tableExists(db, "hire_customers"))) return [];
  const [rows] = await db.query("SELECT id FROM hire_customers WHERE UPPER(COALESCE(customer_code,'')) LIKE 'FCUS-%'");
  return ids(rows.map((r) => r.id));
}

async function legacyAssets(db) {
  if (!(await tableExists(db, "activity_log"))) return [];
  const [rows] = await db.query(
    `SELECT DISTINCT entity_id FROM activity_log
     WHERE entity_id REGEXP '^[0-9]+$'
       AND (workspace_code=?
         OR action_type IN ('equipment.finance.machine.register','EQUIPMENT_FINANCE_MACHINE_REGISTERED','equipment.finance.machine.registered')
         OR action IN ('equipment.finance.machine.register','EQUIPMENT_FINANCE_MACHINE_REGISTERED','equipment.finance.machine.registered'))`,
    [WORKSPACE]
  );
  return ids(rows.map((r) => r.entity_id));
}

async function ownershipRows(db) {
  if (!(await tableExists(db, "installment_reset_ownership"))) return { customers: [], assets: [] };
  const [rows] = await db.query("SELECT entity_type,entity_id FROM installment_reset_ownership WHERE workspace_code=?", [WORKSPACE]);
  return {
    customers: ids(rows.filter((r) => r.entity_type === "customer").map((r) => r.entity_id)),
    assets: ids(rows.filter((r) => r.entity_type === "fleet_asset").map((r) => r.entity_id)),
  };
}

async function workspaceCandidates(db, info) {
  const customers = new Set();
  const assets = new Set();
  for (const [table, cols] of info.entries()) {
    if (!isFinanceTable(table, cols) || !cols.has("workspace_code")) continue;
    for (const col of ["customer_id", "client_id"]) if (cols.has(col)) {
      const [rows] = await db.query(`SELECT DISTINCT ${q(col)} AS id FROM ${q(table)} WHERE workspace_code=? AND ${q(col)} IS NOT NULL`, [WORKSPACE]);
      rows.forEach((r) => customers.add(Number(r.id)));
    }
    for (const col of ["asset_id", "equipment_id", "fleet_asset_id", "excavator_id"]) if (cols.has(col)) {
      const [rows] = await db.query(`SELECT DISTINCT ${q(col)} AS id FROM ${q(table)} WHERE workspace_code=? AND ${q(col)} IS NOT NULL`, [WORKSPACE]);
      rows.forEach((r) => assets.add(Number(r.id)));
    }
  }
  return { customers: ids([...customers]), assets: ids([...assets]) };
}

async function candidateEntities(db, info) {
  const owned = await ownershipRows(db);
  const linked = await workspaceCandidates(db, info);
  return {
    customers: ids([...(owned.customers || []), ...(linked.customers || []), ...(await legacyCustomers(db))]),
    assets: ids([...(owned.assets || []), ...(linked.assets || []), ...(await legacyAssets(db))]),
  };
}

async function references(db, master, id, info) {
  if (!(await tableExists(db, master))) return [];
  const [refs] = await db.query(
    `SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=?
       AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?`,
    [master, master]
  );
  const result = [];
  for (const ref of refs) {
    const cols = info.get(ref.TABLE_NAME) || new Set();
    if (!cols.has(ref.COLUMN_NAME)) continue;
    const [[r]] = await db.query(`SELECT COUNT(*) AS n FROM ${q(ref.TABLE_NAME)} WHERE ${q(ref.COLUMN_NAME)}=?`, [id]);
    if (!Number(r?.n || 0)) continue;
    const classification = isSharedTable(ref.TABLE_NAME) ? "shared" : isFinanceTable(ref.TABLE_NAME, cols) ? "installment" : "external";
    result.push({ table: ref.TABLE_NAME, column: ref.COLUMN_NAME, rows: Number(r.n), classification });
  }
  return result;
}

async function impact(db, type, id, info) {
  const refs = await references(db, MASTER[type], id, info);
  const customerCode = type === "customer" && await tableExists(db, "hire_customers")
    ? (await db.query("SELECT customer_code FROM hire_customers WHERE id=? LIMIT 1", [id]))[0][0]?.customer_code || ""
    : "";
  const registry = await ownershipRows(db);
  const owned = type === "customer" ? registry.customers.includes(id) : registry.assets.includes(id);
  const legacyAsset = type === "asset" ? (await legacyAssets(db)).includes(id) : false;
  const legacyCustomer = type === "customer" && /^FCUS-/i.test(String(customerCode));
  const trial = owned || legacyAsset || legacyCustomer || refs.some((r) => r.classification === "installment");
  const blockers = refs.filter((r) => r.classification !== "installment");
  return {
    entity_type: type,
    entity_id: id,
    trial_record: trial,
    provenance: { registry: owned, finance_customer_code: legacyCustomer, finance_machine_audit: legacyAsset },
    applications: 0,
    agreements: 0,
    payments: 0,
    customers: type === "customer" ? 1 : 0,
    excavators: type === "asset" ? 1 : 0,
    references: refs,
    installment_references: refs.filter((r) => r.classification === "installment"),
    shared_blockers: blockers,
    master_delete_eligible: trial && blockers.length === 0,
    message: !trial ? "This record is not identified as an Installment trial record." : blockers.length ? `Shared reference prevents deletion: ${blockers.map((r) => `${r.table}.${r.column}`).join(", ")}.` : "This Installment trial record is deletable.",
  };
}

async function deleteFinanceGraph(db, info, type, entityIds, deleted) {
  if (!entityIds.length) return;
  const columns = type === "customer" ? ["customer_id", "client_id"] : ["asset_id", "equipment_id", "fleet_asset_id", "excavator_id"];
  for (const [table, cols] of info.entries()) {
    if (!isFinanceTable(table, cols) || table === MASTER[type]) continue;
    const column = columns.find((c) => cols.has(c));
    if (!column) continue;
    const [r] = await db.query(`DELETE FROM ${q(table)} WHERE ${q(column)} IN (${ph(entityIds)})`, entityIds);
    if (r.affectedRows) deleted.push({ table, rows: Number(r.affectedRows), reason: `installment_${type}_graph` });
  }
}

async function deleteWorkspace(db, info, deleted) {
  for (const [table, cols] of info.entries()) {
    if (!cols.has("workspace_code") || EXCLUDED.has(String(table).toLowerCase())) continue;
    const [r] = await db.query(`DELETE FROM ${q(table)} WHERE workspace_code=?`, [WORKSPACE]);
    if (r.affectedRows) deleted.push({ table, rows: Number(r.affectedRows), reason: "installment_workspace" });
  }
}

async function verifyMasterGone(db, type, idsToVerify) {
  if (!idsToVerify.length) return true;
  const [rows] = await db.query(`SELECT id FROM ${q(MASTER[type])} WHERE id IN (${ph(idsToVerify)})`, idsToVerify);
  return rows.length === 0;
}

function admin(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();
  return res.status(403).json({ status: "error", code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED", message: "Only the original System Administrator can perform this destructive Installment action." });
}
function error(res, e, fallback) {
  console.error("Installment authoritative purge v13:", e);
  return res.status(Number(e.statusCode || 500)).json({ status: "error", code: e.code || "INSTALLMENT_PURGE_FAILED", message: e.message || fallback, details: e.details || undefined });
}
async function verifyPassword(userId, password) {
  if (!password) return false;
  const [rows] = await pool.query("SELECT password_hash FROM users WHERE id=? LIMIT 1", [userId]);
  const hash = rows[0]?.password_hash;
  return Boolean(hash && await bcrypt.compare(password, hash));
}

router.post("/completion-phase-four/entity/:entityType/:entityId/impact", requirePermission("fleet.assets.manage"), admin, async (req, res) => {
  const type = String(req.params.entityType).toLowerCase() === "asset" ? "asset" : "customer";
  const id = Number(req.params.entityId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", message: "Invalid entity ID." });
  const db = await pool.getConnection();
  try { const info = await schemaMap(db); return res.json({ status: "success", impact: await impact(db, type, id, info) }); }
  catch (e) { return error(res, e, "Could not prepare deletion impact."); }
  finally { db.release(); }
});

router.post("/completion-phase-four/entity/:entityType/:entityId/delete", requirePermission("fleet.assets.manage"), admin, async (req, res) => {
  const type = String(req.params.entityType).toLowerCase() === "asset" ? "asset" : "customer";
  const id = Number(req.params.entityId);
  const expected = `DELETE INSTALLMENT ${type === "asset" ? "EXCAVATOR" : "CUSTOMER"} ${id}`;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", message: "Invalid entity ID." });
  if (String(req.body?.confirmation || "").trim() !== expected) return res.status(400).json({ status: "error", code: "DELETE_CONFIRMATION_REQUIRED", message: `Type ${expected} exactly to confirm.` });
  const db = await pool.getConnection();
  let fkDisabled = false;
  try {
    const info = await schemaMap(db);
    const preview = await impact(db, type, id, info);
    if (!preview.trial_record) { const e = new Error("This record is not identified as an Installment trial record."); e.statusCode = 409; e.code = "INSTALLMENT_TRIAL_NOT_IDENTIFIED"; throw e; }
    if (preview.shared_blockers.length) { const e = new Error(`Deletion blocked by shared reference(s): ${preview.shared_blockers.map((r) => `${r.table}.${r.column} (${r.rows})`).join(", ")}.`); e.statusCode = 409; e.code = "INSTALLMENT_SHARED_REFERENCE"; throw e; }
    await db.beginTransaction();
    await db.query("SET FOREIGN_KEY_CHECKS=0"); fkDisabled = true;
    const deleted = [];
    await deleteFinanceGraph(db, info, type, [id], deleted);
    await deleteWorkspace(db, info, deleted);
    const [r] = await db.query(`DELETE FROM ${q(MASTER[type])} WHERE id=?`, [id]);
    if (Number(r.affectedRows) !== 1) { const e = new Error(`The ${type === "asset" ? "excavator" : "customer"} #${id} was not deleted.`); e.statusCode = 409; e.code = "INSTALLMENT_MASTER_DELETE_NOT_VERIFIED"; throw e; }
    await db.query("SET FOREIGN_KEY_CHECKS=1"); fkDisabled = false;
    if (!(await verifyMasterGone(db, type, [id]))) { const e = new Error(`The ${type === "asset" ? "excavator" : "customer"} #${id} still exists after deletion.`); e.statusCode = 409; e.code = "INSTALLMENT_DELETE_NOT_VERIFIED"; throw e; }
    await db.commit();
    return res.json({ status: "success", message: `${type === "asset" ? "Excavator" : "Customer"} #${id} deleted.`, entity_type: type, entity_id: id, deleted });
  } catch (e) { try { if (fkDisabled) await db.query("SET FOREIGN_KEY_CHECKS=1"); } catch {} try { await db.rollback(); } catch {} return error(res, e, "The Installment trial record could not be deleted."); }
  finally { db.release(); }
});

router.post("/completion-phase-four/reset/dry-run", requirePermission("fleet.assets.manage"), admin, async (_req, res) => {
  const db = await pool.getConnection();
  try {
    const info = await schemaMap(db);
    const candidates = await candidateEntities(db, info);
    const items = [...candidates.customers.map((id) => ({ entity_type: "customer", entity_id: id })), ...candidates.assets.map((id) => ({ entity_type: "asset", entity_id: id }))];
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(items)).digest("hex");
    return res.json({ status: "success", dry_run: { fingerprint, customers: candidates.customers.length, excavators: candidates.assets.length, items, generated_at: new Date().toISOString() } });
  } catch (e) { return error(res, e, "Could not prepare the Installment reset review."); }
  finally { db.release(); }
});

router.post("/completion-phase-four/reset/execute", requirePermission("fleet.assets.manage"), admin, async (req, res) => {
  if (String(req.body?.confirmation || "").trim() !== RESET_PHRASE) return res.status(400).json({ status: "error", code: "RESET_CONFIRMATION_REQUIRED", message: `Type ${RESET_PHRASE} exactly.` });
  if (!(await verifyPassword(req.user?.id, req.body?.password))) return res.status(401).json({ status: "error", code: "RESET_PASSWORD_INVALID", message: "The current account password is required for the Installment reset." });
  const db = await pool.getConnection();
  let fkDisabled = false;
  try {
    const info = await schemaMap(db);
    const candidates = await candidateEntities(db, info);
    const items = [...candidates.customers.map((id) => ({ entity_type: "customer", entity_id: id })), ...candidates.assets.map((id) => ({ entity_type: "asset", entity_id: id }))];
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(items)).digest("hex");
    if (req.body?.dry_run_fingerprint && req.body.dry_run_fingerprint !== fingerprint) return res.status(409).json({ status: "error", code: "RESET_SCOPE_CHANGED", message: "The Installment reset scope changed. Prepare a new reset review before executing." });
    await db.beginTransaction();
    await db.query("SET FOREIGN_KEY_CHECKS=0"); fkDisabled = true;
    const deleted = [];
    await deleteFinanceGraph(db, info, "customer", candidates.customers, deleted);
    await deleteFinanceGraph(db, info, "asset", candidates.assets, deleted);
    await deleteWorkspace(db, info, deleted);
    if (candidates.customers.length) { const [r] = await db.query(`DELETE FROM ${q(MASTER.customer)} WHERE id IN (${ph(candidates.customers)})`, candidates.customers); deleted.push({ table: MASTER.customer, rows: Number(r.affectedRows), reason: "installment_reset_masters" }); }
    if (candidates.assets.length) { const [r] = await db.query(`DELETE FROM ${q(MASTER.asset)} WHERE id IN (${ph(candidates.assets)})`, candidates.assets); deleted.push({ table: MASTER.asset, rows: Number(r.affectedRows), reason: "installment_reset_masters" }); }
    await db.query("SET FOREIGN_KEY_CHECKS=1"); fkDisabled = false;
    if (!(await verifyMasterGone(db, "customer", candidates.customers))) { const e = new Error("One or more Installment customers survived reset verification."); e.statusCode = 409; e.code = "INSTALLMENT_RESET_NOT_VERIFIED"; throw e; }
    if (!(await verifyMasterGone(db, "asset", candidates.assets))) { const e = new Error("One or more Installment excavators survived reset verification."); e.statusCode = 409; e.code = "INSTALLMENT_RESET_NOT_VERIFIED"; throw e; }
    await db.commit();
    return res.json({ status: "success", message: "Installment Finance trial data has been completely cleared.", dry_run_fingerprint: fingerprint, reset_customers: candidates.customers.length, reset_excavators: candidates.assets.length, deleted });
  } catch (e) { try { if (fkDisabled) await db.query("SET FOREIGN_KEY_CHECKS=1"); } catch {} try { await db.rollback(); } catch {} return error(res, e, "Installment reset could not be completed."); }
  finally { db.release(); }
});

module.exports = router;
