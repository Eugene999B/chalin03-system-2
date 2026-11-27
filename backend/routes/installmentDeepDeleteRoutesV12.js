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
const EXCLUDED_AUDIT_TABLES = new Set(["activity_log", "audit_log", "schema_migrations"]);

function q(identifier) {
  if (!/^[A-Za-z0-9_]+$/.test(String(identifier))) throw new Error("Unsafe database identifier.");
  return `\`${identifier}\``;
}
const ids = (values) => [...new Set(values.map(Number).filter((v) => Number.isInteger(v) && v > 0))];
const ph = (values) => values.map(() => "?").join(",");

async function tableInfo(db) {
  const [rows] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (COLUMN_NAME IN ('workspace_code','customer_id','client_id','asset_id','equipment_id','fleet_asset_id','excavator_id','application_id','credit_application_id','agreement_id','sale_agreement_id','installment_agreement_id','payment_id','sale_payment_id','quotation_id')
             OR TABLE_NAME IN ('hire_customers','fleet_assets','activity_log','installment_reset_ownership'))`
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.TABLE_NAME)) map.set(row.TABLE_NAME, new Set());
    map.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  return map;
}
async function tableExists(db, table) {
  const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
  return Number(row?.n || 0) === 1;
}
async function ensureOwnership(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS installment_reset_ownership (
    id INT AUTO_INCREMENT PRIMARY KEY,
    workspace_code VARCHAR(100) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_installment_reset_owner (workspace_code, entity_type, entity_id),
    INDEX idx_installment_reset_owner_entity (entity_type, entity_id)
  )`);
}
function financeTable(table, columns = new Set()) {
  const name = String(table || "").toLowerCase();
  if (EXCLUDED_AUDIT_TABLES.has(name)) return false;
  if (name.startsWith("equipment_finance_")) return true;
  if (name.startsWith("equipment_credit_")) return true;
  if (name.startsWith("equipment_installment_")) return true;
  if (name.startsWith("equipment_sales_")) return true;
  if (name.startsWith("equipment_sale_")) return true;
  if (name.startsWith("equipment_delivery")) return true;
  if (name.startsWith("equipment_ownership")) return true;
  if (name.startsWith("equipment_asset_sale")) return true;
  if (name === "equipment_media") return true;
  return columns.has("workspace_code");
}
function sharedTable(table) {
  const name = String(table).toLowerCase();
  return /(^|_)(hire|hiring|mining|spare|payroll|stock|inventory)(_|$)/.test(name);
}
async function references(db, table, id) {
  if (!(await tableExists(db, table))) return [];
  const [rows] = await db.query(
    `SELECT TABLE_NAME,COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE REFERENCED_TABLE_SCHEMA=DATABASE()
        AND REFERENCED_TABLE_NAME=?
        AND REFERENCED_COLUMN_NAME='id'
        AND TABLE_NAME<>?`,
    [table, table]
  );
  const out = [];
  for (const row of rows) {
    const [[countRow]] = await db.query(`SELECT COUNT(*) AS n FROM ${q(row.TABLE_NAME)} WHERE ${q(row.COLUMN_NAME)}=?`, [id]);
    const count = Number(countRow?.n || 0);
    if (!count) continue;
    const classification = sharedTable(row.TABLE_NAME) ? "shared" : financeTable(row.TABLE_NAME) ? "installment" : "external";
    out.push({ table: row.TABLE_NAME, column: row.COLUMN_NAME, rows: count, classification });
  }
  return out;
}
async function candidateEntities(db, info) {
  const customers = new Set();
  const assets = new Set();
  if (await tableExists(db, "installment_reset_ownership")) {
    const [rows] = await db.query(`SELECT entity_type,entity_id FROM installment_reset_ownership WHERE workspace_code=?`, [WORKSPACE]);
    for (const row of rows) (row.entity_type === "customer" ? customers : assets).add(Number(row.entity_id));
  }
  if (await tableExists(db, "activity_log")) {
    const [rows] = await db.query(`SELECT entity_type,entity_id FROM activity_log WHERE workspace_code=? AND entity_id REGEXP '^[0-9]+$'`, [WORKSPACE]);
    for (const row of rows) {
      if (String(row.entity_type).toLowerCase().includes("customer")) customers.add(Number(row.entity_id));
      if (["fleet_asset","asset","equipment","excavator"].includes(String(row.entity_type).toLowerCase())) assets.add(Number(row.entity_id));
    }
  }
  for (const [table, columns] of info.entries()) {
    if (!financeTable(table, columns) || !columns.has("workspace_code")) continue;
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE workspace_code=?`, [WORKSPACE]);
    if (!Number(row?.n || 0)) continue;
    for (const col of ["customer_id","client_id"]) if (columns.has(col)) {
      const [rows] = await db.query(`SELECT DISTINCT ${q(col)} AS id FROM ${q(table)} WHERE workspace_code=? AND ${q(col)} IS NOT NULL`, [WORKSPACE]);
      rows.forEach((r) => customers.add(Number(r.id)));
    }
    for (const col of ["asset_id","equipment_id","fleet_asset_id","excavator_id"]) if (columns.has(col)) {
      const [rows] = await db.query(`SELECT DISTINCT ${q(col)} AS id FROM ${q(table)} WHERE workspace_code=? AND ${q(col)} IS NOT NULL`, [WORKSPACE]);
      rows.forEach((r) => assets.add(Number(r.id)));
    }
  }
  return { customers: ids([...customers]), assets: ids([...assets]) };
}
async function workspaceTables(db, info) {
  return [...info.entries()]
    .filter(([table, columns]) => columns.has("workspace_code") && !EXCLUDED_AUDIT_TABLES.has(String(table).toLowerCase()))
    .map(([table]) => table);
}
async function buildImpact(db, type, id) {
  const refs = await references(db, MASTER[type], id);
  const owned = await tableExists(db, "installment_reset_ownership")
    ? (await db.query(`SELECT id FROM installment_reset_ownership WHERE workspace_code=? AND entity_type=? AND entity_id=? LIMIT 1`, [WORKSPACE, type === "asset" ? "fleet_asset" : "customer", id]))[0].length > 0
    : false;
  const legacy = await tableExists(db, "activity_log")
    ? (await db.query(`SELECT id FROM activity_log WHERE workspace_code=? AND entity_id=? LIMIT 1`, [WORKSPACE, String(id)]))[0].length > 0
    : false;
  const trial = owned || legacy || refs.some((r) => r.classification === "installment");
  const blocking = refs.filter((r) => r.classification !== "installment");
  return {
    entity_type: type,
    entity_id: id,
    trial_record: trial,
    references: refs,
    internal_references: refs.filter((r) => r.classification === "installment"),
    blocking_references: blocking,
    master_delete_eligible: trial && blocking.length === 0,
    message: !trial
      ? "This record is not identified as an Installment trial record."
      : blocking.length
        ? `Shared reference prevents deletion: ${blocking.map((r) => `${r.table}.${r.column}`).join(", ")}.`
        : "This Installment trial record is deletable.",
  };
}
async function deleteMatchingWorkspaceRows(db, tables, deleted) {
  for (const table of tables) {
    const [result] = await db.query(`DELETE FROM ${q(table)} WHERE workspace_code=?`, [WORKSPACE]);
    if (result.affectedRows) deleted.push({ table, rows: Number(result.affectedRows), reason: "workspace_scope" });
  }
}
async function deleteEntityRowsFromFinanceTables(db, info, type, idsList, deleted) {
  if (!idsList.length) return;
  const columnsToCheck = type === "customer" ? ["customer_id", "client_id"] : ["asset_id", "equipment_id", "fleet_asset_id", "excavator_id"];
  for (const [table, columns] of info.entries()) {
    if (!financeTable(table, columns) || EXCLUDED_AUDIT_TABLES.has(table) || table === MASTER[type]) continue;
    const column = columnsToCheck.find((candidate) => columns.has(candidate));
    if (!column) continue;
    const [result] = await db.query(`DELETE FROM ${q(table)} WHERE ${q(column)} IN (${ph(idsList)})`, idsList);
    if (result.affectedRows) deleted.push({ table, rows: Number(result.affectedRows), reason: `installment_${type}_graph` });
  }
}
async function verifyDeleted(db, type, id) {
  const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${q(MASTER[type])} WHERE id=?`, [id]);
  return Number(row?.n || 0) === 0;
}
async function verifyWorkspaceEmpty(db, info) {
  for (const table of await workspaceTables(db, info)) {
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE workspace_code=?`, [WORKSPACE]);
    if (Number(row?.n || 0)) return { empty: false, table, rows: Number(row.n) };
  }
  return { empty: true };
}
function adminOnly(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();
  return res.status(403).json({ status: "error", code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED", message: "Only the original System Administrator can perform this destructive Installment action." });
}
function fail(res, error, fallback) {
  console.error("Installment deep purge v12:", error);
  return res.status(Number(error.statusCode || 500)).json({ status: "error", code: error.code || "INSTALLMENT_DEEP_PURGE_FAILED", message: error.message || fallback, details: error.details || undefined });
}
async function verifyPassword(userId, password) {
  if (!password) return false;
  const [rows] = await pool.query("SELECT password_hash FROM users WHERE id=? LIMIT 1", [userId]);
  const hash = rows[0]?.password_hash;
  return Boolean(hash && await bcrypt.compare(password, hash));
}

router.post("/completion-phase-four/entity/:entityType/:entityId/impact", requirePermission("fleet.assets.manage"), adminOnly, async (req, res) => {
  const type = String(req.params.entityType).toLowerCase() === "asset" ? "asset" : "customer";
  const id = Number(req.params.entityId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", message: "Invalid entity ID." });
  const db = await pool.getConnection();
  try { return res.json({ status: "success", impact: await buildImpact(db, type, id) }); }
  catch (error) { return fail(res, error, "Could not prepare deletion impact."); }
  finally { db.release(); }
});

router.post("/completion-phase-four/entity/:entityType/:entityId/delete", requirePermission("fleet.assets.manage"), adminOnly, async (req, res) => {
  const type = String(req.params.entityType).toLowerCase() === "asset" ? "asset" : "customer";
  const id = Number(req.params.entityId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", message: "Invalid entity ID." });
  const expected = `DELETE INSTALLMENT ${type === "asset" ? "EXCAVATOR" : "CUSTOMER"} ${id}`;
  if (String(req.body?.confirmation || "").trim() !== expected) return res.status(400).json({ status: "error", code: "DELETE_CONFIRMATION_REQUIRED", message: `Type ${expected} exactly to confirm.` });
  const db = await pool.getConnection();
  let fkDisabled = false;
  try {
    await db.beginTransaction();
    const info = await tableInfo(db);
    const impact = await buildImpact(db, type, id);
    if (!impact.trial_record) { const e = new Error("This record is not identified as an Installment trial record."); e.statusCode = 409; e.code = "INSTALLMENT_TRIAL_NOT_IDENTIFIED"; throw e; }
    if (impact.blocking_references.length) { const e = new Error(`Deletion blocked by shared reference(s): ${impact.blocking_references.map((r) => `${r.table}.${r.column} (${r.rows})`).join(", ")}.`); e.statusCode = 409; e.code = "INSTALLMENT_SHARED_REFERENCE"; throw e; }
    await db.query("SET FOREIGN_KEY_CHECKS=0"); fkDisabled = true;
    const deleted = [];
    await deleteEntityRowsFromFinanceTables(db, info, type, [id], deleted);
    await deleteMatchingWorkspaceRows(db, await workspaceTables(db, info), deleted);
    const [masterResult] = await db.query(`DELETE FROM ${q(MASTER[type])} WHERE id=?`, [id]);
    if (masterResult.affectedRows !== 1) { const e = new Error(`${type === "asset" ? "Excavator" : "Customer"} #${id} was not deleted.`); e.statusCode = 409; e.code = "INSTALLMENT_MASTER_DELETE_NOT_VERIFIED"; throw e; }
    await db.query("SET FOREIGN_KEY_CHECKS=1"); fkDisabled = false;
    if (!(await verifyDeleted(db, type, id))) { const e = new Error(`${type === "asset" ? "Excavator" : "Customer"} #${id} still exists after deletion.`); e.statusCode = 409; e.code = "INSTALLMENT_DELETE_NOT_VERIFIED"; throw e; }
    await db.commit();
    return res.json({ status: "success", message: `${type === "asset" ? "Excavator" : "Customer"} #${id} deleted from Installment.`, entity_type: type, entity_id: id, deleted });
  } catch (error) { try { if (fkDisabled) await db.query("SET FOREIGN_KEY_CHECKS=1"); } catch (_) {} try { await db.rollback(); } catch (_) {} return fail(res, error, "The Installment trial record could not be deleted."); }
  finally { db.release(); }
});

router.post("/completion-phase-four/reset/dry-run", requirePermission("fleet.assets.manage"), adminOnly, async (_req, res) => {
  const db = await pool.getConnection();
  try {
    await ensureOwnership(db);
    const info = await tableInfo(db);
    const candidates = await candidateEntities(db, info);
    const items = [...candidates.customers.map((id) => ({ entity_type: "customer", entity_id: id })), ...candidates.assets.map((id) => ({ entity_type: "asset", entity_id: id }))];
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(items)).digest("hex");
    return res.json({ status: "success", dry_run: { fingerprint, customers: candidates.customers.length, excavators: candidates.assets.length, items, generated_at: new Date().toISOString() } });
  } catch (error) { return fail(res, error, "Could not prepare the Installment reset review."); }
  finally { db.release(); }
});

router.post("/completion-phase-four/reset/execute", requirePermission("fleet.assets.manage"), adminOnly, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "").trim();
  if (confirmation !== RESET_PHRASE) return res.status(400).json({ status: "error", code: "RESET_CONFIRMATION_REQUIRED", message: `Type ${RESET_PHRASE} exactly.` });
  if (!(await verifyPassword(req.user?.id, req.body?.password))) return res.status(401).json({ status: "error", code: "RESET_PASSWORD_INVALID", message: "The current account password is required for the Installment reset." });
  const db = await pool.getConnection();
  let fkDisabled = false;
  try {
    await ensureOwnership(db);
    const info = await tableInfo(db);
    const candidates = await candidateEntities(db, info);
    const items = [...candidates.customers.map((id) => ({ entity_type: "customer", entity_id: id })), ...candidates.assets.map((id) => ({ entity_type: "asset", entity_id: id }))];
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(items)).digest("hex");
    if (req.body?.dry_run_fingerprint && req.body.dry_run_fingerprint !== fingerprint) return res.status(409).json({ status: "error", code: "RESET_SCOPE_CHANGED", message: "The Installment reset scope changed. Prepare a new reset review before executing." });
    await db.beginTransaction();
    await db.query("SET FOREIGN_KEY_CHECKS=0"); fkDisabled = true;
    const deleted = [];
    await deleteEntityRowsFromFinanceTables(db, info, "customer", candidates.customers, deleted);
    await deleteEntityRowsFromFinanceTables(db, info, "asset", candidates.assets, deleted);
    await deleteMatchingWorkspaceRows(db, await workspaceTables(db, info), deleted);
    if (candidates.customers.length) { const [r] = await db.query(`DELETE FROM ${q(MASTER.customer)} WHERE id IN (${ph(candidates.customers)})`, candidates.customers); deleted.push({ table: MASTER.customer, rows: Number(r.affectedRows), reason: "installment_reset_masters" }); }
    if (candidates.assets.length) { const [r] = await db.query(`DELETE FROM ${q(MASTER.asset)} WHERE id IN (${ph(candidates.assets)})`, candidates.assets); deleted.push({ table: MASTER.asset, rows: Number(r.affectedRows), reason: "installment_reset_masters" }); }
    await db.query("SET FOREIGN_KEY_CHECKS=1"); fkDisabled = false;
    for (const id of candidates.customers) if (!(await verifyDeleted(db, "customer", id))) { const e = new Error(`Customer #${id} survived the reset verification.`); e.statusCode = 409; e.code = "INSTALLMENT_RESET_NOT_VERIFIED"; throw e; }
    for (const id of candidates.assets) if (!(await verifyDeleted(db, "asset", id))) { const e = new Error(`Excavator #${id} survived the reset verification.`); e.statusCode = 409; e.code = "INSTALLMENT_RESET_NOT_VERIFIED"; throw e; }
    const workspaceCheck = await verifyWorkspaceEmpty(db, info);
    if (!workspaceCheck.empty) { const e = new Error(`Installment workspace data remains in ${workspaceCheck.table}: ${workspaceCheck.rows} row(s).`); e.statusCode = 409; e.code = "INSTALLMENT_RESET_WORKSPACE_NOT_EMPTY"; e.details = workspaceCheck; throw e; }
    await db.commit();
    return res.json({ status: "success", message: "Installment Finance trial data has been completely cleared.", dry_run_fingerprint: fingerprint, reset_customers: candidates.customers.length, reset_excavators: candidates.assets.length, deleted });
  } catch (error) { try { if (fkDisabled) await db.query("SET FOREIGN_KEY_CHECKS=1"); } catch (_) {} try { await db.rollback(); } catch (_) {} return fail(res, error, "Installment reset could not be completed."); }
  finally { db.release(); }
});

module.exports = router;
