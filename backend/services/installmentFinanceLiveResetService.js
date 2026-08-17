const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const { pool } = require("../config/db");

const FINANCE_WORKSPACE = "equipment_installment_finance";
const RESET_CONFIRMATION = "RESET INSTALLMENT FINANCE";

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

class FinanceResetError extends Error {
  constructor(statusCode, message, code = "INSTALLMENT_FINANCE_RESET_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function safeIdentifier(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(text)) {
    throw new FinanceResetError(500, "Unsafe Installment reset table identifier.");
  }
  return `\`${text}\``;
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.count || 0) === 1;
}

async function countRows(connection, tableName) {
  if (!(await tableExists(connection, tableName))) return 0;
  const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM ${safeIdentifier(tableName)}`);
  return Number(row?.count || 0);
}

async function getDatabaseName(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  return String(row?.database_name || "").trim();
}

async function getUserPasswordHash(connection, userId) {
  const [[row]] = await connection.query(
    "SELECT id, password_hash, is_active FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!row || Number(row.is_active) !== 1 || !row.password_hash) {
    throw new FinanceResetError(401, "Current password could not be verified.", "RESET_PASSWORD_INVALID");
  }
  return String(row.password_hash);
}

async function verifyCurrentPassword(connection, userId, password) {
  const provided = String(password || "");
  if (!provided) {
    throw new FinanceResetError(400, "Enter your current password to continue.", "RESET_PASSWORD_REQUIRED");
  }
  const passwordHash = await getUserPasswordHash(connection, userId);
  const valid = await bcrypt.compare(provided, passwordHash);
  if (!valid) {
    throw new FinanceResetError(401, "The current password is incorrect.", "RESET_PASSWORD_INVALID");
  }
}

async function getImpact(connection) {
  const impact = [];

  for (const table of [
    "equipment_credit_applications",
    "equipment_sale_agreements",
    "equipment_sale_payments",
    "equipment_installment_schedule",
    "equipment_deliveries",
    "equipment_ownership_transfers",
  ]) {
    impact.push({ table, rows: await countRows(connection, table) });
  }

  for (const table of [...AGREEMENT_TABLES, ...APPLICATION_TABLES]) {
    const rows = await countRows(connection, table);
    if (rows) impact.push({ table, rows });
  }

  return impact;
}

async function buildDryRun(connection = pool) {
  const database = await getDatabaseName(connection);
  const impact = await getImpact(connection);
  const payload = {
    workspace: FINANCE_WORKSPACE,
    mode: "installment_reset_dry_run",
    database,
    impact,
    preserves: [
      "shared customer identities",
      "excavator master records and photographs",
      "Spare Parts records",
      "Mining records",
      "Equipment Hire jobs and contracts",
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

async function executeReset({
  userId,
  password,
  confirmation,
  dryRunFingerprint,
  connection = null,
} = {}) {
  if (String(confirmation || "").trim() !== RESET_CONFIRMATION) {
    throw new FinanceResetError(
      400,
      `Type ${RESET_CONFIRMATION} exactly to confirm the Installment reset.`,
      "RESET_CONFIRMATION_REQUIRED"
    );
  }

  const ownsConnection = !connection;
  const db = connection || (await pool.getConnection());

  try {
    await verifyCurrentPassword(db, userId, password);
    const dryRun = await buildDryRun(db);
    if (!dryRunFingerprint || dryRunFingerprint !== dryRun.fingerprint) {
      throw new FinanceResetError(
        409,
        "The reset scope changed. Prepare a new dry run before executing the reset.",
        "RESET_DRY_RUN_STALE"
      );
    }

    await db.beginTransaction();

    const [agreements] = await db.query(
      `SELECT id, asset_id, credit_application_id
         FROM equipment_sale_agreements
        WHERE sale_type = 'installment'
        FOR UPDATE`
    );
    const agreementIds = agreements.map((row) => Number(row.id)).filter(Number.isInteger);
    const assetIds = agreements.map((row) => Number(row.asset_id)).filter(Number.isInteger);
    const applicationIds = agreements
      .map((row) => Number(row.credit_application_id))
      .filter(Number.isInteger);

    const [applications] = await db.query(
      `SELECT id, quotation_id
         FROM equipment_credit_applications
        FOR UPDATE`
    );
    const allApplicationIds = [...new Set([
      ...applicationIds,
      ...applications.map((row) => Number(row.id)).filter(Number.isInteger),
    ])];
    const quotationIds = applications.map((row) => Number(row.quotation_id)).filter(Number.isInteger);
    const placeholders = (values) => values.map(() => "?").join(",");
    const deleted = [];

    async function deleteByIds(table, column, ids) {
      if (!ids.length || !(await tableExists(db, table))) return;
      const [result] = await db.query(
        `DELETE FROM ${safeIdentifier(table)} WHERE ${safeIdentifier(column)} IN (${placeholders(ids)})`,
        ids
      );
      deleted.push({ table, rows: Number(result.affectedRows || 0) });
    }

    if (agreementIds.length) {
      for (const table of AGREEMENT_TABLES) {
        await deleteByIds(table, "agreement_id", agreementIds);
      }
      await deleteByIds("equipment_sale_agreements", "id", agreementIds);
    }

    if (allApplicationIds.length) {
      for (const table of APPLICATION_TABLES) {
        await deleteByIds(table, "application_id", allApplicationIds);
      }
      await deleteByIds("equipment_credit_applications", "id", allApplicationIds);
    }

    if (quotationIds.length) {
      await deleteByIds("equipment_sales_quotation_items", "quotation_id", quotationIds);
      await deleteByIds("equipment_sales_quotations", "id", quotationIds);
    }

    if (assetIds.length && (await tableExists(db, "fleet_assets"))) {
      const [result] = await db.query(
        `UPDATE fleet_assets
            SET sale_status = 'available',
                current_status = CASE
                  WHEN current_status IN ('sold', 'reserved', 'installment') THEN 'available'
                  ELSE current_status
                END,
                sold_at = NULL
          WHERE id IN (${placeholders(assetIds)})`,
        assetIds
      );
      deleted.push({ table: "fleet_assets", restored_rows: Number(result.affectedRows || 0) });
    }

    await db.commit();

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
    if (ownsConnection) db.release();
  }
}

module.exports = {
  FINANCE_WORKSPACE,
  RESET_CONFIRMATION,
  FinanceResetError,
  buildDryRun,
  executeReset,
};
