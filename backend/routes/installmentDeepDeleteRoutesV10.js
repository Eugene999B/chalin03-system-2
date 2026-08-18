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
const ID_COLS = {
  customer: ["customer_id", "client_id"],
  asset: ["asset_id", "equipment_id", "fleet_asset_id", "excavator_id"],
  application: ["application_id", "credit_application_id"],
  agreement: ["agreement_id", "sale_agreement_id", "installment_agreement_id"],
  payment: ["payment_id", "sale_payment_id"],
  quotation: ["quotation_id"],
};
const FINANCE_CHILDREN = [
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
  "equipment_sales_quotation_items",
  "equipment_sales_quotations",
  "equipment_sales_enquiries",
  "equipment_media",
];

const idList = (values) => [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
const placeholders = (values) => values.map(() => "?").join(",");
function quote(identifier) { if (!/^[A-Za-z0-9_]+$/.test(String(identifier))) throw new Error("Unsafe database identifier."); return `\`${identifier}\``; }

async function exists(db, table) {
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  return Number(row?.n || 0) === 1;
}
async function cols(db, table) {
  if (!(await exists(db, table))) return new Set();
  const [rows] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
  return new Set(rows.map((row) => String(row.COLUMN_NAME)));
}
async function firstColumn(db, table, candidates) {
  const present = await cols(db, table);
  return candidates.find((candidate) => present.has(candidate)) || null;
}
async function registryEvidence(db, type, entityId) {
  if (!(await exists(db, "installment_reset_ownership"))) return false;
  const [rows] = await db.query("SELECT id FROM installment_reset_ownership WHERE workspace_code=? AND entity_type=? AND entity_id=? LIMIT 1", [WORKSPACE, type === "asset" ? "fleet_asset" : "customer", entityId]);
  return rows.length > 0;
}
async function auditEvidence(db, entityId) {
  if (!(await exists(db, "activity_log"))) return false;
  const [rows] = await db.query(`SELECT id FROM activity_log WHERE entity_id=? AND (workspace_code=? OR LOWER(COALESCE(action_type,'')) LIKE '%installment%' OR LOWER(COALESCE(action,'')) LIKE '%installment%' OR LOWER(COALESCE(action_type,'')) LIKE '%equipment.finance.machine.register%' OR LOWER(COALESCE(action,'')) LIKE '%equipment_finance_machine_registered%') LIMIT 1`, [String(entityId), WORKSPACE]);
  return rows.length > 0;
}
async function expandScope(db, type, entityId) {
  const scope = { customers: type === "customer" ? [entityId] : [], assets: type === "asset" ? [entityId] : [], applications: [], agreements: [], payments: [], quotations: [] };
  for (let pass = 0; pass < 5; pass += 1) {
    for (const table of ["equipment_credit_applications", "equipment_sale_agreements", "equipment_sale_payments", "equipment_sales_quotations", "equipment_sales_enquiries"]) {
      if (!(await exists(db, table))) continue;
      const customerCol = await firstColumn(db, table, ID_COLS.customer);
      const assetCol = await firstColumn(db, table, ID_COLS.asset);
      const filters = []; const params = [];
      if (customerCol && scope.customers.length) { filters.push(`${quote(customerCol)} IN (${placeholders(scope.customers)})`); params.push(...scope.customers); }
      if (assetCol && scope.assets.length) { filters.push(`${quote(assetCol)} IN (${placeholders(scope.assets)})`); params.push(...scope.assets); }
      if (!filters.length) continue;
      const [rows] = await db.query(`SELECT * FROM ${quote(table)} WHERE ${filters.join(" OR ")}`, params);
      for (const row of rows) {
        if (table === "equipment_credit_applications" && row.id != null) scope.applications.push(Number(row.id));
        if (table === "equipment_sale_agreements" && row.id != null) scope.agreements.push(Number(row.id));
        if (table === "equipment_sale_payments" && row.id != null) scope.payments.push(Number(row.id));
        if (table === "equipment_sales_quotations" && row.id != null) scope.quotations.push(Number(row.id));
        if (row.customer_id != null) scope.customers.push(Number(row.customer_id));
        if (row.asset_id != null) scope.assets.push(Number(row.asset_id));
        if (row.credit_application_id != null) scope.applications.push(Number(row.credit_application_id));
        if (row.agreement_id != null) scope.agreements.push(Number(row.agreement_id));
      }
    }
    scope.customers = idList(scope.customers); scope.assets = idList(scope.assets); scope.applications = idList(scope.applications); scope.agreements = idList(scope.agreements); scope.payments = idList(scope.payments); scope.quotations = idList(scope.quotations);
  }
  return scope;
}
function financeOwnedTable(table) {
  const name = String(table || "").toLowerCase();
  if (FINANCE_CHILDREN.includes(name)) return true;
  return name.startsWith("equipment_finance_") || name.startsWith("equipment_credit_") || name.startsWith("equipment_installment_") || name.startsWith("equipment_sales_") || name.startsWith("equipment_sale_") || name.startsWith("equipment_delivery") || name.startsWith("equipment_ownership") || name.startsWith("equipment_asset_sale") || name === "equipment_media";
}
function sharedModuleTable(table) {
  const name = String(table || "").toLowerCase();
  return /(^|_)(hire|hiring|mining|spare|payroll|stock|inventory)(_|$)/.test(name) || name.includes("hire_contract") || name.includes("mining_") || name.includes("spare_") || name.includes("stock_") || name.includes("inventory_");
}
async function masterReferences(db, type, entityId) {
  const table = MASTER[type];
  if (!(await exists(db, table))) return { all: [], internal: [], blocking: [] };
  const [refs] = await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' AND TABLE_NAME<>?", [table, table]);
  const all = [];
  for (const ref of refs) {
    const present = await cols(db, ref.TABLE_NAME);
    if (!present.has(ref.COLUMN_NAME)) continue;
    const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM ${quote(ref.TABLE_NAME)} WHERE ${quote(ref.COLUMN_NAME)}=?`, [entityId]);
    const rows = Number(row?.n || 0);
    if (!rows) continue;
    const classification = sharedModuleTable(ref.TABLE_NAME) ? "shared" : financeOwnedTable(ref.TABLE_NAME) ? "installment" : "external";
    all.push({ table: ref.TABLE_NAME, column: ref.COLUMN_NAME, rows, classification });
  }
  return { all, internal: all.filter((item) => item.classification === "installment"), blocking: all.filter((item) => item.classification !== "installment") };
}
async function buildImpact(db, type, entityId) {
  const scope = await expandScope(db, type, entityId);
  const owned = await registryEvidence(db, type, entityId);
  const legacy = await auditEvidence(db, entityId);
  const linked = Boolean(scope.applications.length || scope.agreements.length || scope.payments.length || scope.quotations.length);
  const refs = await masterReferences(db, type, entityId);
  const trial = Boolean(owned || legacy || linked);
  const masterDeleteEligible = trial && refs.blocking.length === 0;
  return {
    entity_type: type,
    entity_id: entityId,
    trial_record: trial,
    evidence: { explicitly_owned: owned, legacy_activity: legacy, installment_links: linked },
    scope,
    references: refs.all,
    internal_references: refs.internal,
    blocking_references: refs.blocking,
    master_delete_eligible: masterDeleteEligible,
    message: !trial ? "This record has no identifiable Installment trial provenance." : refs.blocking.length ? `Installment data can be cleared, but the master record is shared with ${refs.blocking.map((item) => item.table).join(", ")}.` : "This Installment trial record can be completely deleted."
  };
}
async function deleteWhereIds(db, table, candidates, values, deleted) {
  if (!values.length || !(await exists(db, table))) return;
  const column = await firstColumn(db, table, candidates);
  if (!column) return;
  const [result] = await db.query(`DELETE FROM ${quote(table)} WHERE ${quote(column)} IN (${placeholders(values)})`, values);
  if (result.affectedRows) deleted.push({ table, rows: Number(result.affectedRows) });
}
async function deleteGraph(db, scope, deleted) {
  await deleteWhereIds(db, "equipment_sale_payment_allocations", ID_COLS.payment, scope.payments, deleted);
  await deleteWhereIds(db, "equipment_installment_schedule", ID_COLS.agreement, scope.agreements, deleted);
  for (const table of FINANCE_CHILDREN) {
    await deleteWhereIds(db, table, ID_COLS.agreement, scope.agreements, deleted);
    await deleteWhereIds(db, table, ID_COLS.application, scope.applications, deleted);
    await deleteWhereIds(db, table, ID_COLS.payment, scope.payments, deleted);
    await deleteWhereIds(db, table, ID_COLS.quotation, scope.quotations, deleted);
    await deleteWhereIds(db, table, ID_COLS.customer, scope.customers, deleted);
    await deleteWhereIds(db, table, ID_COLS.asset, scope.assets, deleted);
  }
  await deleteWhereIds(db, "equipment_sale_payments", ["id", ...ID_COLS.payment], scope.payments, deleted);
  await deleteWhereIds(db, "equipment_sale_agreements", ["id", ...ID_COLS.agreement], scope.agreements, deleted);
  await deleteWhereIds(db, "equipment_credit_applications", ["id", ...ID_COLS.application], scope.applications, deleted);
  await deleteWhereIds(db, "equipment_sales_quotation_items", ID_COLS.quotation, scope.quotations, deleted);
  await deleteWhereIds(db, "equipment_sales_quotations", ["id", ...ID_COLS.quotation], scope.quotations, deleted);
  await deleteWhereIds(db, "equipment_sales_enquiries", ID_COLS.customer, scope.customers, deleted);
  await deleteWhereIds(db, "equipment_sales_enquiries", ID_COLS.asset, scope.assets, deleted);
}
async function deleteInternalMasterReferences(db, references, entityId, deleted) {
  for (const ref of references) {
    if (ref.classification !== "installment") continue;
    const [result] = await db.query(`DELETE FROM ${quote(ref.table)} WHERE ${quote(ref.column)}=?`, [entityId]);
    if (result.affectedRows) deleted.push({ table: ref.table, rows: Number(result.affectedRows), reason: "installment_master_reference" });
  }
}
async function deleteMaster(db, type, id, deleted, impact) {
  if (impact.blocking_references.length) {
    return { deleted: false, reason: "shared_record", blocking_references: impact.blocking_references };
  }
  await deleteInternalMasterReferences(db, impact.references, id, deleted);
  const remaining = await masterReferences(db, type, id);
  if (remaining.blocking.length) return { deleted: false, reason: "remaining_external_reference", blocking_references: remaining.blocking };
  if (remaining.internal.length) return { deleted: false, reason: "installment_reference_survived_cleanup", references: remaining.internal };
  const [result] = await db.query(`DELETE FROM ${quote(MASTER[type])} WHERE id=?`, [id]);
  if (result.affectedRows) deleted.push({ table: MASTER[type], rows: Number(result.affectedRows) });
  if (await exists(db, "installment_reset_ownership")) await db.query("DELETE FROM installment_reset_ownership WHERE workspace_code=? AND entity_type=? AND entity_id=?", [WORKSPACE, type === "asset" ? "fleet_asset" : "customer", id]);
  return { deleted: Boolean(result.affectedRows), reason: result.affectedRows ? "deleted" : "already_missing", blocking_references: [] };
}
function adminOnly(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();
  return res.status(403).json({ status: "error", code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED", message: "Only the original System Administrator can perform this destructive Installment action." });
}
function fail(res, error, fallback) {
  console.error("Installment deep delete v11:", error);
  return res.status(Number(error.statusCode || 500)).json({ status: "error", code: error.code || "INSTALLMENT_DEEP_DELETE_FAILED", message: error.message || fallback });
}
async function verifyPassword(userId, password) {
  if (!password) return false;
  const [rows] = await pool.query("SELECT password_hash FROM users WHERE id=? LIMIT 1", [userId]);
  const hash = rows[0]?.password_hash;
  return Boolean(hash && await bcrypt.compare(password, hash));
}
async function getImpactFromRequest(type, id) {
  const db = await pool.getConnection();
  try { return await buildImpact(db, type, id); } finally { db.release(); }
}

router.post("/completion-phase-four/entity/:entityType/:entityId/impact", requirePermission("fleet.assets.manage"), adminOnly, async (req, res) => {
  const type = String(req.params.entityType).toLowerCase() === "asset" ? "asset" : "customer";
  const id = Number(req.params.entityId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", message: "Invalid entity ID." });
  try { return res.json({ status: "success", impact: await getImpactFromRequest(type, id) }); }
  catch (error) { return fail(res, error, "Could not prepare the deletion impact."); }
});

router.post("/completion-phase-four/entity/:entityType/:entityId/delete", requirePermission("fleet.assets.manage"), adminOnly, async (req, res) => {
  const type = String(req.params.entityType).toLowerCase() === "asset" ? "asset" : "customer";
  const id = Number(req.params.entityId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ status: "error", message: "Invalid entity ID." });
  const expected = `DELETE INSTALLMENT ${type === "asset" ? "EXCAVATOR" : "CUSTOMER"} ${id}`;
  if (String(req.body?.confirmation || "").trim() !== expected) return res.status(400).json({ status: "error", code: "DELETE_CONFIRMATION_REQUIRED", message: `Type ${expected} exactly to confirm.` });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const impact = await buildImpact(db, type, id);
    if (!impact.trial_record) { const error = new Error("This record is not identified as an Installment trial record."); error.statusCode = 409; error.code = "INSTALLMENT_TRIAL_NOT_IDENTIFIED"; throw error; }
    if (impact.blocking_references.length) { const error = new Error(`Deletion blocked by shared reference(s): ${impact.blocking_references.map((item) => `${item.table}.${item.column} (${item.rows})`).join(", ")}.`); error.statusCode = 409; error.code = "INSTALLMENT_SHARED_REFERENCE"; throw error; }
    const deleted = [];
    await deleteGraph(db, impact.scope, deleted);
    const master = await deleteMaster(db, type, id, deleted, impact);
    if (!master.deleted) { const error = new Error(master.reason === "installment_reference_survived_cleanup" ? "Installment references remain after cleanup; the transaction was rolled back." : "The shared master record is still referenced outside Installment."); error.statusCode = 409; error.code = "INSTALLMENT_MASTER_DELETE_BLOCKED"; error.details = master; throw error; }
    await db.commit();
    return res.json({ status: "success", entity_type: type, entity_id: id, deleted, master, scope: impact.scope });
  } catch (error) { try { await db.rollback(); } catch (_) {} return fail(res, error, "The Installment trial record could not be deleted."); }
  finally { db.release(); }
});

async function resetCandidates(db) {
  const customers = new Set(); const assets = new Set();
  if (await exists(db, "installment_reset_ownership")) {
    const [rows] = await db.query("SELECT entity_type,entity_id FROM installment_reset_ownership WHERE workspace_code=?", [WORKSPACE]);
    for (const row of rows) (row.entity_type === "customer" ? customers : assets).add(Number(row.entity_id));
  }
  if (await exists(db, "activity_log")) {
    const [rows] = await db.query("SELECT entity_type,entity_id FROM activity_log WHERE (workspace_code=? OR LOWER(COALESCE(action_type,'')) LIKE '%installment%' OR LOWER(COALESCE(action,'')) LIKE '%installment%') AND entity_id REGEXP '^[0-9]+$' AND entity_type IN ('customer','customers','customer_profile','customer_identity','fleet_asset','asset','equipment','excavator')", [WORKSPACE]);
    for (const row of rows) (String(row.entity_type).includes("customer") ? customers : assets).add(Number(row.entity_id));
  }
  if (await exists(db, "equipment_credit_applications")) {
    const [rows] = await db.query("SELECT customer_id,asset_id FROM equipment_credit_applications WHERE customer_id IS NOT NULL OR asset_id IS NOT NULL");
    for (const row of rows) { if (row.customer_id) customers.add(Number(row.customer_id)); if (row.asset_id) assets.add(Number(row.asset_id)); }
  }
  if (await exists(db, "equipment_sale_agreements")) {
    const [rows] = await db.query("SELECT customer_id,asset_id FROM equipment_sale_agreements WHERE LOWER(COALESCE(sale_type,'')) IN ('installment','instalment','finance','financed','credit') OR LOWER(COALESCE(payment_type,'')) IN ('installment','instalment','finance','financed','credit') OR LOWER(COALESCE(activation_source,'')) LIKE '%credit%'");
    for (const row of rows) { if (row.customer_id) customers.add(Number(row.customer_id)); if (row.asset_id) assets.add(Number(row.asset_id)); }
  }
  return { customers: [...customers].filter(Boolean), assets: [...assets].filter(Boolean) };
}
async function collectResetSnapshot(db) {
  const candidates = await resetCandidates(db); const items = [];
  for (const id of candidates.customers) { const item = await buildImpact(db, "customer", id); if (item.trial_record) items.push(item); }
  for (const id of candidates.assets) { const item = await buildImpact(db, "asset", id); if (item.trial_record) items.push(item); }
  return items;
}

router.post("/completion-phase-four/reset/dry-run", requirePermission("fleet.assets.manage"), adminOnly, async (_req, res) => {
  const db = await pool.getConnection();
  try {
    const items = await collectResetSnapshot(db);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(items)).digest("hex");
    return res.json({ status: "success", dry_run: { fingerprint, customers: items.filter((i) => i.entity_type === "customer").length, excavators: items.filter((i) => i.entity_type === "asset").length, items, generated_at: new Date().toISOString() } });
  } catch (error) { return fail(res, error, "Could not prepare the Installment reset review."); }
  finally { db.release(); }
});

router.post("/completion-phase-four/reset/execute", requirePermission("fleet.assets.manage"), adminOnly, async (req, res) => {
  const confirmation = String(req.body?.confirmation || "").trim();
  if (confirmation !== RESET_PHRASE) return res.status(400).json({ status: "error", code: "RESET_CONFIRMATION_REQUIRED", message: `Type ${RESET_PHRASE} exactly.` });
  if (!(await verifyPassword(req.user?.id, req.body?.password))) return res.status(401).json({ status: "error", code: "RESET_PASSWORD_INVALID", message: "The current account password is required for the Installment reset." });
  const db = await pool.getConnection();
  try {
    const snapshot = await collectResetSnapshot(db);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    if (req.body?.dry_run_fingerprint && req.body.dry_run_fingerprint !== fingerprint) return res.status(409).json({ status: "error", code: "RESET_SCOPE_CHANGED", message: "The Installment reset scope changed. Prepare a new reset review before executing." });
    const blocked = snapshot.flatMap((item) => item.blocking_references.map((ref) => ({ entity_type: item.entity_type, entity_id: item.entity_id, ...ref })));
    if (blocked.length) return res.status(409).json({ status: "error", code: "INSTALLMENT_SHARED_REFERENCE", message: "Reset is blocked because one or more trial master records are still shared with another business module.", blocking_references: blocked });
    await db.beginTransaction();
    const deleted = []; const masters = [];
    for (const item of snapshot) {
      await deleteGraph(db, item.scope, deleted);
      const master = await deleteMaster(db, item.entity_type, item.entity_id, deleted, item);
      if (!master.deleted) { const error = new Error(`Reset could not remove ${item.entity_type} #${item.entity_id}: ${master.reason}.`); error.statusCode = 409; error.code = "INSTALLMENT_MASTER_DELETE_BLOCKED"; throw error; }
      masters.push(master);
    }
    await db.commit();
    return res.json({ status: "success", dry_run_fingerprint: fingerprint, deleted, masters, reset_customers: snapshot.filter((i) => i.entity_type === "customer").length, reset_excavators: snapshot.filter((i) => i.entity_type === "asset").length });
  } catch (error) { try { await db.rollback(); } catch (_) {} return fail(res, error, "Installment reset could not be completed."); }
  finally { db.release(); }
});

module.exports = router;
