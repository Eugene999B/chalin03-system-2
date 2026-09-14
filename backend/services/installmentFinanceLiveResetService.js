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

const DEDICATED_INSTALLMENT_TABLES = new Set([
  ...AGREEMENT_TABLES,
  ...APPLICATION_TABLES,
]);

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

async function tableColumns(connection, tableName) {
  if (!(await tableExists(connection, tableName))) return new Set();
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => String(row.COLUMN_NAME)));
}

async function getColumnType(connection, tableName, columnName) {
  const [[row]] = await connection.query(
    `SELECT COLUMN_TYPE, DATA_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return row || null;
}

function parseEnumValues(columnType) {
  const text = String(columnType || "");
  if (!/^enum\(/i.test(text)) return [];
  return [...text.matchAll(/'((?:\\'|[^'])*)'/g)].map((match) => match[1].replace(/\\'/g, "'"));
}

async function chooseSafeStatusValue(connection, tableName, columnName, assetIds, blockedValues) {
  if (!(await tableExists(connection, tableName))) return null;
  const columns = await tableColumns(connection, tableName);
  if (!columns.has(columnName) || !columns.has("id")) return null;

  const definition = await getColumnType(connection, tableName, columnName);
  const blocked = new Set((blockedValues || []).map((value) => String(value).toLowerCase()));
  const idFilter = assetIds.length ? `AND id NOT IN (${assetIds.map(() => "?").join(",")})` : "";
  const params = assetIds.length ? assetIds : [];

  const [rows] = await connection.query(
    `SELECT ${safeIdentifier(columnName)} AS value, COUNT(*) AS count
       FROM ${safeIdentifier(tableName)}
      WHERE ${safeIdentifier(columnName)} IS NOT NULL
        ${idFilter}
      GROUP BY ${safeIdentifier(columnName)}
      ORDER BY count DESC, value ASC
      LIMIT 20`,
    params
  );

  const observed = rows.find((row) => !blocked.has(String(row.value).toLowerCase()));
  if (observed && observed.value !== null && observed.value !== undefined) {
    return String(observed.value);
  }

  const enumValues = parseEnumValues(definition?.COLUMN_TYPE);
  const preferred = [
    "available",
    "active",
    "in_stock",
    "instock",
    "idle",
    "ready",
    "free",
    "unsold",
    "stock",
    "open",
  ];

  const normalized = new Map(enumValues.map((value) => [value.toLowerCase(), value]));
  for (const candidate of preferred) {
    if (normalized.has(candidate) && !blocked.has(candidate)) return normalized.get(candidate);
  }

  const firstAllowed = enumValues.find((value) => !blocked.has(value.toLowerCase()));
  return firstAllowed || null;
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

function placeholders(values) {
  return values.map(() => "?").join(",");
}

async function deleteByIds(connection, table, column, ids, deleted) {
  if (!ids.length || !(await tableExists(connection, table))) return;
  const columns = await tableColumns(connection, table);
  if (!columns.has(column)) return;

  const [result] = await connection.query(
    `DELETE FROM ${safeIdentifier(table)} WHERE ${safeIdentifier(column)} IN (${placeholders(ids)})`,
    ids
  );
  deleted.push({ table, rows: Number(result.affectedRows || 0) });
}

async function deleteScopedInstallmentTable(
  connection,
  table,
  { agreementIds = [], applicationIds = [], paymentIds = [] } = {},
  deleted
) {
  if (!(await tableExists(connection, table))) return;

  const columns = await tableColumns(connection, table);
  const candidates = [
    ["agreement_id", agreementIds],
    ["application_id", applicationIds],
    ["credit_application_id", applicationIds],
    ["payment_id", paymentIds],
  ];

  for (const [column, ids] of candidates) {
    if (columns.has(column) && ids.length) {
      await deleteByIds(connection, table, column, ids, deleted);
      return;
    }
  }

  if (DEDICATED_INSTALLMENT_TABLES.has(table)) {
    const [result] = await connection.query(`DELETE FROM ${safeIdentifier(table)}`);
    deleted.push({ table, rows: Number(result.affectedRows || 0), scope: "dedicated_installment_table" });
  }
}

async function restoreFinanceAssets(connection, assetIds, deleted) {
  if (!assetIds.length || !(await tableExists(connection, "fleet_assets"))) return;

  const columns = await tableColumns(connection, "fleet_assets");
  const assignments = [];
  const params = [];

  if (columns.has("sale_status")) {
    const saleStatus = await chooseSafeStatusValue(
      connection,
      "fleet_assets",
      "sale_status",
      assetIds,
      ["sold", "reserved", "installment", "rented", "hire"]
    );
    if (saleStatus !== null) {
      assignments.push("`sale_status` = ?");
      params.push(saleStatus);
    }
  }

  if (columns.has("current_status")) {
    const currentStatus = await chooseSafeStatusValue(
      connection,
      "fleet_assets",
      "current_status",
      assetIds,
      ["sold", "reserved", "installment", "rented", "hire"]
    );
    if (currentStatus !== null) {
      assignments.push("`current_status` = ?");
      params.push(currentStatus);
    }
  }

  if (columns.has("sold_at")) assignments.push("`sold_at` = NULL");
  if (!assignments.length || !columns.has("id")) return;

  const [result] = await connection.query(
    `UPDATE fleet_assets
        SET ${assignments.join(", ")}
      WHERE id IN (${placeholders(assetIds)})`,
    [...params, ...assetIds]
  );
  deleted.push({ table: "fleet_assets", restored_rows: Number(result.affectedRows || 0) });
}

async function selectInstallmentAgreements(connection) {
  if (!(await tableExists(connection, "equipment_sale_agreements"))) return [];

  const columns = await tableColumns(connection, "equipment_sale_agreements");
  if (!columns.has("id")) return [];

  const select = ["id"];
  for (const column of ["asset_id", "credit_application_id"]) {
    if (columns.has(column)) select.push(column);
  }

  const where = columns.has("sale_type") ? "WHERE sale_type = 'installment'" : "";
  const [rows] = await connection.query(
    `SELECT ${select.join(", ")}
       FROM equipment_sale_agreements
       ${where}
      FOR UPDATE`
  );
  return rows;
}

async function selectCreditApplications(connection) {
  if (!(await tableExists(connection, "equipment_credit_applications"))) {
    return { rows: [], columns: new Set() };
  }

  const columns = await tableColumns(connection, "equipment_credit_applications");
  if (!columns.has("id")) return { rows: [], columns };

  const select = ["id"];
  if (columns.has("quotation_id")) select.push("quotation_id");

  const [rows] = await connection.query(
    `SELECT ${select.join(", ")}
       FROM equipment_credit_applications
      FOR UPDATE`
  );
  return { rows, columns };
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

    const agreements = await selectInstallmentAgreements(db);
    const agreementColumns = await tableColumns(db, "equipment_sale_agreements");
    const agreementIds = agreements.map((row) => Number(row.id)).filter(Number.isInteger);
    const assetIds = agreementColumns.has("asset_id")
      ? agreements.map((row) => Number(row.asset_id)).filter(Number.isInteger)
      : [];
    const applicationIds = agreementColumns.has("credit_application_id")
      ? agreements.map((row) => Number(row.credit_application_id)).filter(Number.isInteger)
      : [];

    const { rows: applications } = await selectCreditApplications(db);
    const allApplicationIds = [...new Set([
      ...applicationIds,
      ...applications.map((row) => Number(row.id)).filter(Number.isInteger),
    ])];
    const quotationIds = applications
      .map((row) => Number(row.quotation_id))
      .filter(Number.isInteger);

    const [paymentRows] = agreementIds.length && (await tableExists(db, "equipment_sale_payments"))
      ? await db.query(
          `SELECT id
             FROM equipment_sale_payments
            WHERE agreement_id IN (${placeholders(agreementIds)})
            FOR UPDATE`,
          agreementIds
        )
      : [[]];
    const paymentIds = paymentRows.map((row) => Number(row.id)).filter(Number.isInteger);
    const deleted = [];

    if (agreementIds.length) {
      await deleteScopedInstallmentTable(db, "equipment_sale_payment_allocations", { agreementIds, paymentIds }, deleted);
      for (const table of AGREEMENT_TABLES) {
        await deleteScopedInstallmentTable(db, table, { agreementIds, applicationIds: allApplicationIds, paymentIds }, deleted);
      }
      await deleteByIds(db, "equipment_sale_agreements", "id", agreementIds, deleted);
    }

    if (allApplicationIds.length) {
      for (const table of APPLICATION_TABLES) {
        await deleteScopedInstallmentTable(db, table, { applicationIds: allApplicationIds }, deleted);
      }
      await deleteByIds(db, "equipment_credit_applications", "id", allApplicationIds, deleted);
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

module.exports = {
  FINANCE_WORKSPACE,
  RESET_CONFIRMATION,
  FinanceResetError,
  buildDryRun,
  executeReset,
};