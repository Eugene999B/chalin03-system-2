const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { RESET_CONFIRMATION, buildDryRun } = require("./installmentFinanceLiveResetService");

const AGREEMENT_TABLES = [
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
];
const APPLICATION_TABLES = [
  "equipment_credit_application_kyc",
  "equipment_credit_application_reviews",
  "equipment_credit_application_affordability",
  "equipment_credit_application_guarantors",
  "equipment_credit_application_consents",
];

const placeholders = (ids) => ids.map(() => "?").join(",");

async function exists(db, table) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS count FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row?.count || 0) === 1;
}

async function columns(db, table) {
  if (!(await exists(db, table))) return new Set();
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(rows.map((r) => String(r.COLUMN_NAME)));
}

async function verifyPassword(db, userId, password) {
  const [[user]] = await db.query(
    "SELECT id,password_hash,is_active FROM users WHERE id=? LIMIT 1",
    [userId]
  );
  if (!user || Number(user.is_active) !== 1 || !user.password_hash ||
      !(await bcrypt.compare(String(password || ""), String(user.password_hash)))) {
    const error = new Error("The current password is incorrect.");
    error.statusCode = 401;
    error.code = "RESET_PASSWORD_INVALID";
    throw error;
  }
}

async function deleteIds(db, table, column, ids, deleted) {
  if (!ids.length || !(await exists(db, table))) return;
  const cols = await columns(db, table);
  if (!cols.has(column)) return;
  const [result] = await db.query(
    `DELETE FROM \`${table}\` WHERE \`${column}\` IN (${placeholders(ids)})`,
    ids
  );
  deleted.push({ table, rows: Number(result.affectedRows || 0) });
}

async function deleteScoped(db, table, scopes, deleted) {
  if (!(await exists(db, table))) return;
  const cols = await columns(db, table);
  const candidates = [
    ["agreement_id", scopes.agreementIds],
    ["sale_agreement_id", scopes.agreementIds],
    ["installment_agreement_id", scopes.agreementIds],
    ["application_id", scopes.applicationIds],
    ["credit_application_id", scopes.applicationIds],
    ["payment_id", scopes.paymentIds],
    ["sale_payment_id", scopes.paymentIds],
  ];
  for (const [column, ids] of candidates) {
    if (ids.length && cols.has(column)) {
      await deleteIds(db, table, column, ids, deleted);
      return;
    }
  }
}

async function selectTargetAgreements(db) {
  if (!(await exists(db, "equipment_sale_agreements"))) return { rows: [], cols: new Set() };
  const cols = await columns(db, "equipment_sale_agreements");
  if (!cols.has("id")) return { rows: [], cols };
  const select = ["id"];
  if (cols.has("asset_id")) select.push("asset_id");
  if (cols.has("credit_application_id")) select.push("credit_application_id");
  const where = cols.has("sale_type") ? "WHERE sale_type = 'installment'" : "";
  const [rows] = await db.query(
    `SELECT ${select.join(",")} FROM equipment_sale_agreements ${where} FOR UPDATE`
  );
  return { rows, cols };
}

async function selectTargetApplications(db, ids) {
  if (!ids.length || !(await exists(db, "equipment_credit_applications"))) return [];
  const cols = await columns(db, "equipment_credit_applications");
  if (!cols.has("id")) return [];
  const select = ["id"];
  if (cols.has("quotation_id")) select.push("quotation_id");
  const [rows] = await db.query(
    `SELECT ${select.join(",")} FROM equipment_credit_applications
      WHERE id IN (${placeholders(ids)}) FOR UPDATE`,
    ids
  );
  return rows;
}

async function restoreAssets(db, assetIds, deleted) {
  if (!assetIds.length || !(await exists(db, "fleet_assets"))) return;
  const cols = await columns(db, "fleet_assets");
  const assignments = [];
  const params = [];
  const blocked = ["sold", "reserved", "installment", "rented", "hire"];

  for (const field of ["sale_status", "current_status"]) {
    if (!cols.has(field)) continue;
    const [rows] = await db.query(
      `SELECT \`${field}\` AS value, COUNT(*) AS n FROM fleet_assets
        WHERE \`${field}\` IS NOT NULL AND id NOT IN (${placeholders(assetIds)})
        GROUP BY \`${field}\` ORDER BY n DESC, \`${field}\` ASC LIMIT 20`,
      assetIds
    );
    const observed = rows.find((r) => !blocked.includes(String(r.value).toLowerCase()));
    if (observed) {
      assignments.push(`\`${field}\` = ?`);
      params.push(String(observed.value));
    }
  }
  if (cols.has("sold_at")) assignments.push("`sold_at` = NULL");
  if (!assignments.length) return;
  const [result] = await db.query(
    `UPDATE fleet_assets SET ${assignments.join(",")} WHERE id IN (${placeholders(assetIds)})`,
    [...params, ...assetIds]
  );
  deleted.push({ table: "fleet_assets", restored_rows: Number(result.affectedRows || 0) });
}

async function executeReset({ userId, password, confirmation, dryRunFingerprint, connection = null } = {}) {
  if (String(confirmation || "").trim() !== RESET_CONFIRMATION) {
    const error = new Error(`Type ${RESET_CONFIRMATION} exactly to confirm the Installment reset.`);
    error.statusCode = 400;
    error.code = "RESET_CONFIRMATION_REQUIRED";
    throw error;
  }

  const ownsConnection = !connection;
  const db = connection || await pool.getConnection();
  let foreignKeysDisabled = false;
  try {
    await verifyPassword(db, userId, password);
    const dryRun = await buildDryRun(db);
    if (!dryRunFingerprint || dryRunFingerprint !== dryRun.fingerprint) {
      const error = new Error("The reset scope changed. Prepare a new dry run before executing the reset.");
      error.statusCode = 409;
      error.code = "RESET_DRY_RUN_STALE";
      throw error;
    }

    await db.beginTransaction();
    // The production schema has evolved across Finance releases and may contain
    // additional FK children not present in the application table list. Disable
    // checks only for this connection and only for this transactional reset;
    // every DELETE remains explicitly scoped to the target installment IDs.
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    foreignKeysDisabled = true;

    const { rows: agreements, cols: agreementCols } = await selectTargetAgreements(db);
    const agreementIds = agreements.map((r) => Number(r.id)).filter(Number.isInteger);
    const assetIds = agreementCols.has("asset_id")
      ? agreements.map((r) => Number(r.asset_id)).filter(Number.isInteger)
      : [];
    const applicationIds = agreementCols.has("credit_application_id")
      ? [...new Set(agreements.map((r) => Number(r.credit_application_id)).filter(Number.isInteger))]
      : [];
    const applications = await selectTargetApplications(db, applicationIds);
    const quotationIds = applications.map((r) => Number(r.quotation_id)).filter(Number.isInteger);

    let paymentIds = [];
    if (agreementIds.length && await exists(db, "equipment_sale_payments")) {
      const paymentCols = await columns(db, "equipment_sale_payments");
      if (paymentCols.has("agreement_id")) {
        const [rows] = await db.query(
          `SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${placeholders(agreementIds)}) FOR UPDATE`,
          agreementIds
        );
        paymentIds = rows.map((r) => Number(r.id)).filter(Number.isInteger);
      }
    }

    const deleted = [];
    const scopes = { agreementIds, applicationIds, paymentIds };

    for (const table of AGREEMENT_TABLES) await deleteScoped(db, table, scopes, deleted);
    for (const table of APPLICATION_TABLES) await deleteScoped(db, table, scopes, deleted);
    await deleteIds(db, "equipment_sale_agreements", "id", agreementIds, deleted);
    await deleteIds(db, "equipment_credit_applications", "id", applicationIds, deleted);
    await deleteIds(db, "equipment_sales_quotation_items", "quotation_id", quotationIds, deleted);
    await deleteIds(db, "equipment_sales_quotations", "id", quotationIds, deleted);
    await restoreAssets(db, assetIds, deleted);

    await db.commit();
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    foreignKeysDisabled = false;

    return {
      status: "success",
      mode: "installment_reset",
      dry_run_fingerprint: dryRun.fingerprint,
      deleted,
      message: "Installment Finance data was reset successfully. Shared customers, excavator records, and other business data were preserved.",
    };
  } catch (error) {
    try { await db.rollback(); } catch (_) {}
    throw error;
  } finally {
    if (foreignKeysDisabled) {
      try { await db.query("SET FOREIGN_KEY_CHECKS = 1"); } catch (_) {}
    }
    if (ownsConnection) db.release();
  }
}

module.exports = { executeReset };
