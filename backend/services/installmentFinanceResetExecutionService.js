const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const {
  RESET_CONFIRMATION,
  buildDryRun,
} = require("./installmentFinanceLiveResetService");

function placeholders(values) {
  return values.map(() => "?").join(",");
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

async function getColumns(connection, tableName) {
  if (!(await tableExists(connection, tableName))) return new Map();
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Map(rows.map((row) => [String(row.COLUMN_NAME), row]));
}

async function verifyPassword(connection, userId, password) {
  const [[user]] = await connection.query(
    "SELECT id, password_hash, is_active FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (!user || Number(user.is_active) !== 1 || !user.password_hash) {
    const error = new Error("Current password could not be verified.");
    error.statusCode = 401;
    error.code = "RESET_PASSWORD_INVALID";
    throw error;
  }
  if (!(await bcrypt.compare(String(password || ""), String(user.password_hash)))) {
    const error = new Error("The current password is incorrect.");
    error.statusCode = 401;
    error.code = "RESET_PASSWORD_INVALID";
    throw error;
  }
}

async function deleteByIds(connection, tableName, columnName, ids, deleted) {
  if (!ids.length) return;
  const columns = await getColumns(connection, tableName);
  if (!columns.has(columnName)) return;
  const [result] = await connection.query(
    `DELETE FROM \`${tableName}\` WHERE \`${columnName}\` IN (${placeholders(ids)})`,
    ids
  );
  deleted.push({ table: tableName, rows: Number(result.affectedRows || 0) });
}

async function clearInstallmentChildTable(connection, tableName, { agreementIds, applicationIds, paymentIds }, deleted) {
  if (!(await tableExists(connection, tableName))) return;
  const columns = await getColumns(connection, tableName);
  const candidates = [
    ["agreement_id", agreementIds],
    ["application_id", applicationIds],
    ["credit_application_id", applicationIds],
    ["payment_id", paymentIds],
  ];
  for (const [column, ids] of candidates) {
    if (columns.has(column) && ids.length) {
      await deleteByIds(connection, tableName, column, ids, deleted);
      return;
    }
  }
  const dedicated =
    tableName.startsWith("equipment_finance_") ||
    tableName.startsWith("equipment_credit_application_") ||
    tableName.startsWith("equipment_installment_") ||
    tableName === "equipment_sale_payment_allocations" ||
    tableName === "equipment_sale_payments" ||
    tableName === "equipment_deliveries" ||
    tableName === "equipment_ownership_transfers" ||
    tableName === "equipment_asset_sale_locks";
  if (dedicated) {
    const [result] = await connection.query(`DELETE FROM \`${tableName}\``);
    deleted.push({ table: tableName, rows: Number(result.affectedRows || 0), scope: "dedicated_installment_table" });
  }
}

async function findRestorableValue(connection, tableName, columnName, excludedValues) {
  const columns = await getColumns(connection, tableName);
  const meta = columns.get(columnName);
  if (!meta) return null;

  const type = String(meta.COLUMN_TYPE || "");
  if (type.startsWith("enum(")) {
    const values = [...type.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1].replace(/\\'/g, "'"));
    const candidate = values.find((value) => !excludedValues.includes(value));
    if (candidate) return candidate;
  }

  if (meta.COLUMN_DEFAULT !== null && meta.COLUMN_DEFAULT !== undefined) {
    const candidate = String(meta.COLUMN_DEFAULT);
    if (candidate && !excludedValues.includes(candidate)) return candidate;
  }

  const [[existing]] = await connection.query(
    `SELECT \`${columnName}\` AS value
       FROM \`${tableName}\`
      WHERE \`${columnName}\` IS NOT NULL
        AND \`${columnName}\` NOT IN (${placeholders(excludedValues)})
      LIMIT 1`,
    excludedValues
  );
  if (existing?.value !== undefined && existing?.value !== null) return String(existing.value);

  return null;
}

async function restoreFinanceAssets(connection, assetIds, deleted) {
  if (!assetIds.length || !(await tableExists(connection, "fleet_assets"))) return;
  const columns = await getColumns(connection, "fleet_assets");
  const updates = [];
  const params = [];
  const excludedStatuses = ["sold", "reserved", "installment"];

  if (columns.has("sale_status")) {
    const saleStatus = await findRestorableValue(connection, "fleet_assets", "sale_status", excludedStatuses);
    if (saleStatus !== null) {
      updates.push("`sale_status` = ?");
      params.push(saleStatus);
    }
  }

  if (columns.has("current_status")) {
    const currentStatus = await findRestorableValue(connection, "fleet_assets", "current_status", excludedStatuses);
    if (currentStatus !== null) {
      updates.push("`current_status` = CASE WHEN `current_status` IN (?, ?, ?) THEN ? ELSE `current_status` END");
      params.push(...excludedStatuses, currentStatus);
    }
  }

  if (columns.has("sold_at") && String(columns.get("sold_at").IS_NULLABLE).toUpperCase() === "YES") {
    updates.push("`sold_at` = NULL");
  }

  if (!updates.length || !columns.has("id")) return;
  const [result] = await connection.query(
    `UPDATE fleet_assets SET ${updates.join(", ")} WHERE id IN (${placeholders(assetIds)})`,
    [...params, ...assetIds]
  );
  deleted.push({ table: "fleet_assets", restored_rows: Number(result.affectedRows || 0) });
}

async function selectAgreements(connection) {
  if (!(await tableExists(connection, "equipment_sale_agreements"))) return { rows: [], columns: new Map() };
  const columns = await getColumns(connection, "equipment_sale_agreements");
  if (!columns.has("id")) return { rows: [], columns };
  const select = ["id"];
  if (columns.has("asset_id")) select.push("asset_id");
  if (columns.has("credit_application_id")) select.push("credit_application_id");
  const where = columns.has("sale_type") ? "WHERE sale_type = 'installment'" : "";
  const [rows] = await connection.query(
    `SELECT ${select.join(", ")} FROM equipment_sale_agreements ${where} FOR UPDATE`
  );
  return { rows, columns };
}

async function selectApplications(connection) {
  if (!(await tableExists(connection, "equipment_credit_applications"))) return { rows: [], columns: new Map() };
  const columns = await getColumns(connection, "equipment_credit_applications");
  if (!columns.has("id")) return { rows: [], columns };
  const select = ["id"];
  if (columns.has("quotation_id")) select.push("quotation_id");
  const [rows] = await connection.query(
    `SELECT ${select.join(", ")} FROM equipment_credit_applications FOR UPDATE`
  );
  return { rows, columns };
}

async function executeReset({ userId, password, confirmation, dryRunFingerprint, connection = null } = {}) {
  if (String(confirmation || "").trim() !== RESET_CONFIRMATION) {
    const error = new Error(`Type ${RESET_CONFIRMATION} exactly to confirm the Installment reset.`);
    error.statusCode = 400;
    error.code = "RESET_CONFIRMATION_REQUIRED";
    throw error;
  }

  const ownsConnection = !connection;
  const db = connection || (await pool.getConnection());

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

    const { rows: agreements, columns: agreementColumns } = await selectAgreements(db);
    const agreementIds = agreements.map((row) => Number(row.id)).filter(Number.isInteger);
    const assetIds = agreementColumns.has("asset_id")
      ? agreements.map((row) => Number(row.asset_id)).filter(Number.isInteger)
      : [];
    const agreementApplicationIds = agreementColumns.has("credit_application_id")
      ? agreements.map((row) => Number(row.credit_application_id)).filter(Number.isInteger)
      : [];

    const { rows: applications } = await selectApplications(db);
    const applicationIds = [...new Set([
      ...agreementApplicationIds,
      ...applications.map((row) => Number(row.id)).filter(Number.isInteger),
    ])];
    const quotationIds = applications
      .map((row) => Number(row.quotation_id))
      .filter(Number.isInteger);

    const [paymentRows] = agreementIds.length && (await tableExists(db, "equipment_sale_payments"))
      ? await db.query(
          `SELECT id FROM equipment_sale_payments WHERE agreement_id IN (${placeholders(agreementIds)}) FOR UPDATE`,
          agreementIds
        )
      : [[]];
    const paymentIds = paymentRows.map((row) => Number(row.id)).filter(Number.isInteger);
    const deleted = [];

    const childTables = [
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

    if (agreementIds.length) {
      for (const table of childTables) {
        await clearInstallmentChildTable(db, table, { agreementIds, applicationIds, paymentIds }, deleted);
      }
      await deleteByIds(db, "equipment_sale_agreements", "id", agreementIds, deleted);
    }

    if (applicationIds.length) {
      const applicationChildTables = [
        "equipment_credit_application_kyc",
        "equipment_credit_application_reviews",
        "equipment_credit_application_affordability",
        "equipment_credit_application_guarantors",
        "equipment_credit_application_consents",
      ];
      for (const table of applicationChildTables) {
        await clearInstallmentChildTable(db, table, { agreementIds, applicationIds, paymentIds }, deleted);
      }
      await deleteByIds(db, "equipment_credit_applications", "id", applicationIds, deleted);
    }

    if (quotationIds.length) {
      await deleteByIds(db, "equipment_sales_quotation_items", "quotation_id", quotationIds, deleted);
      await deleteByIds(db, "equipment_sales_quotations", "id", quotationIds, deleted);
    }

    await restoreFinanceAssets(db, assetIds, deleted);
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

module.exports = { executeReset };
