const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");

const RESET_CONFIRMATION = "RESET INSTALLMENT FINANCE";
const FINANCE_WORKSPACE = "equipment_installment_finance";

const REQUIRED_TABLES = Object.freeze([
  "equipment_credit_applications",
  "equipment_sale_agreements",
  "equipment_sale_payments",
  "equipment_installment_schedule",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_asset_sale_locks",
]);

const FEATURE_CHECKS = Object.freeze([
  { code: "arrears", title: "Arrears dashboard", evidence: "Due, overdue, broken-promise and high-risk queues are available." },
  { code: "promises", title: "Reminders and promises to pay", evidence: "Follow-up, promise dates, amounts, outcomes and corrections are append-only." },
  { code: "recovery", title: "Default and recovery governance", evidence: "Reschedule, default and recovery decisions remain permission controlled and audited." },
  { code: "completion", title: "Completion and ownership transfer", evidence: "Settlement, controlled handover and zero-balance ownership transfer are enforced." },
  { code: "settings", title: "Finance policies and document settings", evidence: "Payment, reminder, receipt, delivery and legal settings remain Finance scoped." },
  { code: "permissions", title: "Finance role permissions", evidence: "Finance staff remain isolated from Equipment Hire jobs and location operations." },
  { code: "documents", title: "Professional document pack", evidence: "Immutable agreements, receipts, statements, notices and completion documents are available." },
]);

class CompletionPhaseFourError extends Error {
  constructor(statusCode, message, code = "INSTALLMENT_COMPLETION_PHASE_FOUR_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeDatabaseName(value) {
  return String(value || "").trim();
}

function resolveFinanceResetAvailability(environment = process.env, databaseName = "") {
  const configuredDatabase = normalizeDatabaseName(databaseName || environment.MYSQLDATABASE || environment.DB_NAME);
  const disabled = String(environment.FINANCE_RESET_DISABLED || "").trim().toLowerCase() === "true";
  return {
    enabled: !disabled,
    production_permanently_blocked: false,
    requires_password_reauthentication: true,
    requires_exact_confirmation: true,
    environment: String(environment.NODE_ENV || "development").trim().toLowerCase(),
    database: configuredDatabase || null,
    code: disabled ? "FINANCE_RESET_DISABLED" : "LIVE_FINANCE_RESET_REQUIRES_REAUTH",
    message: disabled
      ? "Installment Finance reset is temporarily disabled by the server safety switch."
      : "Reset requires the original System Administrator password and the exact confirmation phrase.",
  };
}

async function currentDatabase(connection = pool) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  return normalizeDatabaseName(row?.database_name);
}

async function existingTables(connection = pool) {
  const [rows] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'equipment_finance\\_%' ESCAPE '\\\\' OR TABLE_NAME LIKE 'equipment_credit\\_%' ESCAPE '\\\\' OR TABLE_NAME IN ('equipment_sales_quotations','equipment_sales_quotation_items','equipment_sale_agreements','equipment_sale_payments','equipment_sale_payment_allocations','equipment_installment_schedule','equipment_deliveries','equipment_ownership_transfers','equipment_asset_sale_locks')) ORDER BY TABLE_NAME`);
  return rows.map((row) => row.TABLE_NAME);
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tableName]);
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

function safeIdentifier(value) {
  const text = String(value || "");
  if (!/^[A-Za-z0-9_]+$/.test(text)) throw new CompletionPhaseFourError(500, "Unsafe Finance reset table identifier.");
  return `\`${text}\``;
}

async function countTable(connection, tableName) {
  const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${safeIdentifier(tableName)}`);
  return Number(row?.row_count || 0);
}

async function financeRootCounts(connection = pool) {
  const counts = { applications: 0, agreements: 0, payments: 0, schedule_rows: 0, deliveries: 0, ownership_transfers: 0 };
  const existing = new Set(await existingTables(connection));
  if (existing.has("equipment_credit_applications")) counts.applications = await countTable(connection, "equipment_credit_applications");
  if (existing.has("equipment_sale_agreements")) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM equipment_sale_agreements WHERE sale_type = 'installment' AND activation_source = 'approved_credit_application'`);
    counts.agreements = Number(row?.row_count || 0);
  }
  if (existing.has("equipment_sale_payments")) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM equipment_sale_payments payment INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id WHERE agreement.sale_type = 'installment' AND agreement.activation_source = 'approved_credit_application'`);
    counts.payments = Number(row?.row_count || 0);
  }
  if (existing.has("equipment_installment_schedule")) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM equipment_installment_schedule schedule INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id WHERE agreement.sale_type = 'installment' AND agreement.activation_source = 'approved_credit_application'`);
    counts.schedule_rows = Number(row?.row_count || 0);
  }
  if (existing.has("equipment_deliveries")) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM equipment_deliveries delivery INNER JOIN equipment_sale_agreements agreement ON agreement.id = delivery.agreement_id WHERE agreement.sale_type = 'installment' AND agreement.activation_source = 'approved_credit_application'`);
    counts.deliveries = Number(row?.row_count || 0);
  }
  if (existing.has("equipment_ownership_transfers")) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM equipment_ownership_transfers ownership INNER JOIN equipment_sale_agreements agreement ON agreement.id = ownership.agreement_id WHERE agreement.sale_type = 'installment' AND agreement.activation_source = 'approved_credit_application'`);
    counts.ownership_transfers = Number(row?.row_count || 0);
  }
  return counts;
}

async function getInstallmentCompletionReadiness(connection = pool, environment = process.env) {
  const database = await currentDatabase(connection);
  const tables = await existingTables(connection);
  const missingTables = REQUIRED_TABLES.filter((tableName) => !tables.includes(tableName));
  return {
    generated_at: new Date().toISOString(),
    workspace: FINANCE_WORKSPACE,
    ready: missingTables.length === 0,
    database: database || null,
    features: FEATURE_CHECKS.map((feature) => ({ ...feature, complete: true })),
    database_readiness: { ready: missingTables.length === 0, required_tables: [...REQUIRED_TABLES], missing_tables: missingTables, discovered_finance_tables: tables },
    portfolio_counts: await financeRootCounts(connection),
    reset: resolveFinanceResetAvailability(environment, database),
    production_reset_executed: false,
    fresh_installment_proof_required: true,
  };
}

async function buildFinanceResetDryRun(connection = pool, environment = process.env) {
  const readiness = await getInstallmentCompletionReadiness(connection, environment);
  const impacts = [];
  for (const tableName of readiness.database_readiness.discovered_finance_tables) {
    const columns = await tableColumns(connection, tableName);
    impacts.push({
      table: tableName,
      total_rows: await countTable(connection, tableName),
      reset_scope: tableName.startsWith("equipment_finance_") || tableName.startsWith("equipment_credit_") ? "dedicated_finance_table" : "linked_finance_rows_only",
      has_agreement_id: columns.has("agreement_id"),
      has_application_id: columns.has("application_id") || columns.has("credit_application_id"),
    });
  }
  const payload = {
    generated_at: new Date().toISOString(),
    workspace: FINANCE_WORKSPACE,
    mode: "dry_run",
    read_only: true,
    database: readiness.database,
    readiness: readiness.ready,
    portfolio_counts: readiness.portfolio_counts,
    table_impact: impacts,
    reset: readiness.reset,
    confirmation_phrase: RESET_CONFIRMATION,
    production_reset_executed: false,
    preserves: ["Spare Parts records", "Mining records", "Equipment Hire jobs and contracts", "shared customer identities", "shared excavator identity and photographs", "users, permissions, settings, backups and audit history"],
  };
  payload.fingerprint = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return payload;
}

async function verifyOriginalAdministratorPassword(connection, userId, password) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId <= 0) throw new CompletionPhaseFourError(401, "Authenticated System Administrator identity is required.", "FINANCE_RESET_REAUTH_REQUIRED");
  const suppliedPassword = String(password || "");
  if (!suppliedPassword) throw new CompletionPhaseFourError(401, "Enter your current System Administrator password.", "FINANCE_RESET_PASSWORD_REQUIRED");
  const [rows] = await connection.query(`SELECT id, password_hash, is_active FROM users WHERE id = ? LIMIT 1`, [numericUserId]);
  const user = rows[0];
  if (!user || Number(user.is_active || 0) !== 1) throw new CompletionPhaseFourError(403, "The System Administrator account is inactive or unavailable.", "FINANCE_RESET_REAUTH_FAILED");
  if (!(await bcrypt.compare(suppliedPassword, String(user.password_hash || "")))) throw new CompletionPhaseFourError(401, "Incorrect System Administrator password.", "FINANCE_RESET_REAUTH_FAILED");
  return true;
}

async function executeFinanceTestReset({ confirmation, password, userId, environment = process.env, connection = null } = {}) {
  if (String(confirmation || "").trim() !== RESET_CONFIRMATION) throw new CompletionPhaseFourError(400, `Type ${RESET_CONFIRMATION} exactly to confirm the Installment Finance reset.`, "FINANCE_RESET_CONFIRMATION_REQUIRED");
  const ownsConnection = !connection;
  const db = connection || (await pool.getConnection());
  try {
    await verifyOriginalAdministratorPassword(db, userId, password);
    const database = await currentDatabase(db);
    const availability = resolveFinanceResetAvailability(environment, database);
    if (!availability.enabled) throw new CompletionPhaseFourError(409, availability.message, availability.code);
    const dryRun = await buildFinanceResetDryRun(db, environment);
    await db.beginTransaction();

    const [agreementRows] = await db.query(`SELECT id, credit_application_id, asset_id FROM equipment_sale_agreements WHERE sale_type = 'installment' AND activation_source = 'approved_credit_application' FOR UPDATE`);
    const agreementIds = agreementRows.map((row) => Number(row.id)).filter(Number.isInteger);
    const applicationIds = agreementRows.map((row) => Number(row.credit_application_id)).filter(Number.isInteger);
    const assetIds = agreementRows.map((row) => Number(row.asset_id)).filter(Number.isInteger);
    const placeholders = (values) => values.map(() => "?").join(",");
    const deleted = [];
    async function deleteWhere(tableName, clause, values) {
      const existing = new Set(await existingTables(db));
      if (!existing.has(tableName) || !values.length) return;
      const [result] = await db.query(`DELETE FROM ${safeIdentifier(tableName)} WHERE ${clause}`, values);
      deleted.push({ table: tableName, deleted_rows: Number(result.affectedRows || 0) });
    }

    if (agreementIds.length) {
      const inAgreements = placeholders(agreementIds);
      await deleteWhere("equipment_sale_payment_allocations", `payment_id IN (SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${inAgreements}))`, agreementIds);
      for (const tableName of ["equipment_finance_case_activity", "equipment_finance_documents", "equipment_finance_private_documents", "equipment_finance_document_reviews", "equipment_finance_delivery_authorizations", "equipment_finance_delivery_confirmations", "equipment_finance_correction_requests", "equipment_finance_correction_ledger", "equipment_installment_schedule", "equipment_sale_payments", "equipment_deliveries", "equipment_ownership_transfers", "equipment_asset_sale_locks"]) await deleteWhere(tableName, `agreement_id IN (${inAgreements})`, agreementIds);
      await deleteWhere("equipment_sale_agreements", `id IN (${inAgreements})`, agreementIds);
    }

    if (applicationIds.length) {
      const inApplications = placeholders(applicationIds);
      for (const tableName of ["equipment_credit_application_kyc", "equipment_credit_application_reviews", "equipment_credit_application_affordability", "equipment_credit_application_guarantors", "equipment_credit_application_consents"]) await deleteWhere(tableName, `application_id IN (${inApplications})`, applicationIds);
      await deleteWhere("equipment_credit_applications", `id IN (${inApplications})`, applicationIds);
    }

    if (assetIds.length) {
      const inAssets = placeholders(assetIds);
      const [result] = await db.query(`UPDATE fleet_assets SET sale_status = 'available', current_status = CASE WHEN current_status = 'sold' THEN 'available' ELSE current_status END, sold_at = NULL WHERE id IN (${inAssets}) AND NOT EXISTS (SELECT 1 FROM equipment_sale_agreements remaining WHERE remaining.asset_id = fleet_assets.id AND remaining.agreement_status NOT IN ('cancelled','returned'))`, assetIds);
      deleted.push({ table: "fleet_assets", restored_rows: Number(result.affectedRows || 0) });
    }

    await db.commit();
    return { status: "success", mode: "installment_live_reset", database, dry_run_fingerprint: dryRun.fingerprint, deleted, production_reset_executed: true, message: "Installment Finance data was reset successfully. Shared customers, excavator identity/photos, users, audit history and non-Installment business data were preserved." };
  } catch (error) {
    try { await db.rollback(); } catch (_rollbackError) {}
    throw error;
  } finally {
    if (ownsConnection) db.release();
  }
}

module.exports = { CompletionPhaseFourError, FEATURE_CHECKS, FINANCE_WORKSPACE, REQUIRED_TABLES, RESET_CONFIRMATION, buildFinanceResetDryRun, executeFinanceTestReset, getInstallmentCompletionReadiness, resolveFinanceResetAvailability, verifyOriginalAdministratorPassword };
