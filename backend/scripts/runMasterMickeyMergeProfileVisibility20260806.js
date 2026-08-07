const mysql = require("mysql2/promise");
require("dotenv").config();

const REPAIR_RECORD = "20260806_master_mickey_merge_profile_visibility";
const REPAIR_LOCK = "chalin03:master-mickey-merge-profile-visibility:20260806";
const REQUIRED_ISOLATION_REPAIR = "20260805_unpaid_receipt_identity_isolation";
const TARGET_RECEIPT = "CHL-MAIN-20260731-103020-7928";
const TARGET_NAME = "MASTER MICKEY";
const TARGET_TOTAL = 1900;
const TARGET_DATE = "2026-07-31";

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value || "").trim()) return value;
  }
  throw new Error(`Missing required database variable: ${names.join(" or ")}.`);
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
    ),
  };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST", "MYSQL_HOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER", "MYSQL_USER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD", "MYSQL_PASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE", "MYSQL_DATABASE"),
    ssl: getSslConfig(),
    charset: "utf8mb4",
    multipleStatements: false,
  };
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeName(value) {
  return cleanText(value, 150).replace(/\s+/g, " ").toUpperCase();
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function sameMoney(left, right) {
  return Math.abs(money(left) - money(right)) <= 0.01;
}

function dateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

async function tableHasColumns(connection, tableName, columns) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  return columns.every((column) => existing.has(column));
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = cleanText(row?.database_name, 255);
  const expected = cleanText(process.env.CHALIN03_EXPECTED_DATABASE, 255);
  if (!databaseName || !expected) {
    throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
  }
  if (databaseName !== expected) {
    throw new Error(`Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`);
  }
  return databaseName;
}

async function migrationRecordExists(connection, migrationName) {
  if (!(await tableHasColumns(connection, "schema_migrations", ["migration_name"]))) {
    throw new Error("The required schema_migrations table is missing.");
  }
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [migrationName]
  );
  return Number(row?.applied || 0) === 1;
}

async function snapshot(connection) {
  const hasDailyClosings = await tableHasColumns(connection, "daily_closings", ["id"]);
  const closingSql = hasDailyClosings ? "(SELECT COUNT(*) FROM daily_closings)" : "0";
  const [[row]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM customers) AS customer_count,
       (SELECT COUNT(*) FROM sales) AS sale_count,
       (SELECT COALESCE(SUM(total), 0) FROM sales) AS sale_total,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM sales) AS sale_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM sales) AS sale_balance,
       (SELECT COUNT(*) FROM sales WHERE customer_id IS NULL) AS unlinked_sale_count,
       (SELECT COUNT(*) FROM debts) AS debt_count,
       (SELECT COALESCE(SUM(amount_owed), 0) FROM debts) AS debt_owed,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM debts) AS debt_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM debts) AS debt_balance,
       (SELECT COUNT(*) FROM debts WHERE customer_id IS NULL) AS unlinked_debt_count,
       (SELECT COUNT(*) FROM debt_payments) AS payment_count,
       (SELECT COALESCE(SUM(amount), 0) FROM debt_payments) AS payment_total,
       (SELECT COUNT(*) FROM products) AS product_count,
       (SELECT COALESCE(SUM(quantity), 0) FROM products) AS stock_quantity,
       ${closingSql} AS daily_closing_count`
  );
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key.includes("count") || key === "stock_quantity" ? Number(value || 0) : money(value),
    ])
  );
}

function assertSnapshotChange(before, after) {
  if (after.customer_count !== before.customer_count + 1) {
    throw new Error("Exactly one merge-visible customer profile was not created.");
  }
  if (after.unlinked_sale_count !== before.unlinked_sale_count - 1) {
    throw new Error("Exactly one sale was not linked to the new customer profile.");
  }
  if (after.unlinked_debt_count !== before.unlinked_debt_count - 1) {
    throw new Error("Exactly one debt was not linked to the new customer profile.");
  }
  for (const field of [
    "sale_count",
    "debt_count",
    "payment_count",
    "product_count",
    "stock_quantity",
    "daily_closing_count",
  ]) {
    if (Number(before[field]) !== Number(after[field])) {
      throw new Error(`Protected count changed for ${field}.`);
    }
  }
  for (const field of [
    "sale_total",
    "sale_paid",
    "sale_balance",
    "debt_owed",
    "debt_paid",
    "debt_balance",
    "payment_total",
  ]) {
    if (!sameMoney(before[field], after[field])) {
      throw new Error(`Protected financial total changed for ${field}.`);
    }
  }
}

async function loadTarget(connection) {
  const [rows] = await connection.query(
    `SELECT
       s.id AS sale_id,
       s.branch_id,
       s.receipt_number,
       s.customer_id AS sale_customer_id,
       s.customer_name AS sale_customer_name,
       s.customer_phone AS sale_customer_phone,
       s.total AS sale_total,
       s.amount_paid AS sale_amount_paid,
       s.balance AS sale_balance,
       s.payment_type,
       s.sale_status,
       s.created_at AS sale_created_at,
       d.id AS debt_id,
       d.customer_id AS debt_customer_id,
       d.customer_name AS debt_customer_name,
       d.customer_phone AS debt_customer_phone,
       d.amount_owed,
       d.amount_paid AS debt_amount_paid,
       d.balance AS debt_balance,
       d.status AS debt_status,
       COUNT(dp.id) AS payment_count,
       COALESCE(SUM(dp.amount), 0) AS payment_total
     FROM sales s
     INNER JOIN debts d ON d.sale_id = s.id AND d.branch_id = s.branch_id
     LEFT JOIN debt_payments dp ON dp.debt_id = d.id AND dp.branch_id = d.branch_id
     WHERE s.receipt_number = ?
     GROUP BY
       s.id, s.branch_id, s.receipt_number, s.customer_id, s.customer_name,
       s.customer_phone, s.total, s.amount_paid, s.balance, s.payment_type,
       s.sale_status, s.created_at, d.id, d.customer_id, d.customer_name,
       d.customer_phone, d.amount_owed, d.amount_paid, d.balance, d.status
     FOR UPDATE`,
    [TARGET_RECEIPT]
  );
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one debt-linked sale for ${TARGET_RECEIPT}; found ${rows.length}.`);
  }
  return rows[0];
}

async function validateTarget(connection, target) {
  if (normalizeName(target.sale_customer_name) !== TARGET_NAME) {
    throw new Error("The target sale is not exactly MASTER MICKEY.");
  }
  if (normalizeName(target.debt_customer_name) !== TARGET_NAME) {
    throw new Error("The target debt is not exactly MASTER MICKEY.");
  }
  if (cleanText(target.sale_customer_phone, 100) || cleanText(target.debt_customer_phone, 100)) {
    throw new Error("The target receipt unexpectedly has a phone number.");
  }
  if (String(target.payment_type || "").toLowerCase() !== "credit") {
    throw new Error("The target receipt is not a credit sale.");
  }
  if (String(target.sale_status || "").toLowerCase() !== "completed") {
    throw new Error("The target receipt is not completed.");
  }
  if (dateOnly(target.sale_created_at) !== TARGET_DATE) {
    throw new Error("The target receipt is not dated July 31, 2026.");
  }
  if (
    !sameMoney(target.sale_total, TARGET_TOTAL) ||
    !sameMoney(target.sale_amount_paid, 0) ||
    !sameMoney(target.sale_balance, TARGET_TOTAL) ||
    !sameMoney(target.amount_owed, TARGET_TOTAL) ||
    !sameMoney(target.debt_amount_paid, 0) ||
    !sameMoney(target.debt_balance, TARGET_TOTAL)
  ) {
    throw new Error("The target receipt financial values are not the exact unpaid GHS 1,900 values.");
  }
  if (["paid", "partial"].includes(String(target.debt_status || "").trim().toLowerCase())) {
    throw new Error("The target debt has a protected paid or partial status.");
  }
  if (Number(target.payment_count || 0) !== 0 || money(target.payment_total) > 0.005) {
    throw new Error("The target debt has payment history and cannot be changed.");
  }
  if (target.sale_customer_id !== null || target.debt_customer_id !== null) {
    throw new Error("The target receipt is already linked to a saved customer profile.");
  }

  if (await tableHasColumns(connection, "returns", ["branch_id", "sale_id"])) {
    const [[row]] = await connection.query(
      "SELECT COUNT(*) AS return_count FROM returns WHERE branch_id = ? AND sale_id = ?",
      [target.branch_id, target.sale_id]
    );
    if (Number(row?.return_count || 0) !== 0) {
      throw new Error("The target receipt has a return and is protected from relinking.");
    }
  }

  const [[profiles]] = await connection.query(
    `SELECT COUNT(*) AS profile_count
     FROM customers
     WHERE branch_id = ? AND UPPER(TRIM(name)) = ?`,
    [target.branch_id, TARGET_NAME]
  );
  if (Number(profiles?.profile_count || 0) !== 1) {
    throw new Error("Expected exactly one existing saved MASTER MICKEY profile before creating the merge-visible duplicate.");
  }
}

async function loadSuggestedLocation(connection, branchId) {
  const [rows] = await connection.query(
    `SELECT location
     FROM customers
     WHERE branch_id = ? AND UPPER(TRIM(name)) = ?
     ORDER BY (phone IS NOT NULL AND TRIM(phone) <> '') DESC, id ASC
     LIMIT 1`,
    [branchId, TARGET_NAME]
  );
  return cleanText(rows[0]?.location, 150) || null;
}

async function verifyProfileLink(connection, target, customerId) {
  const [[row]] = await connection.query(
    `SELECT
       c.id AS customer_id,
       c.name,
       c.phone,
       s.customer_id AS sale_customer_id,
       d.customer_id AS debt_customer_id,
       s.total AS sale_total,
       s.amount_paid AS sale_amount_paid,
       s.balance AS sale_balance,
       d.amount_owed,
       d.amount_paid AS debt_amount_paid,
       d.balance AS debt_balance,
       d.status AS debt_status,
       COUNT(dp.id) AS payment_count
     FROM customers c
     INNER JOIN sales s ON s.customer_id = c.id AND s.id = ? AND s.branch_id = c.branch_id
     INNER JOIN debts d ON d.customer_id = c.id AND d.id = ? AND d.branch_id = c.branch_id
     LEFT JOIN debt_payments dp ON dp.debt_id = d.id AND dp.branch_id = d.branch_id
     WHERE c.id = ? AND c.branch_id = ?
     GROUP BY
       c.id, c.name, c.phone, s.customer_id, d.customer_id,
       s.total, s.amount_paid, s.balance,
       d.amount_owed, d.amount_paid, d.balance, d.status`,
    [target.sale_id, target.debt_id, customerId, target.branch_id]
  );
  if (!row || normalizeName(row.name) !== TARGET_NAME || row.phone !== null) {
    throw new Error("The mergeable no-phone Master Mickey profile was not created correctly.");
  }
  if (Number(row.sale_customer_id) !== customerId || Number(row.debt_customer_id) !== customerId) {
    throw new Error("The exact July 31 receipt was not linked to the new profile.");
  }
  if (
    !sameMoney(row.sale_total, target.sale_total) ||
    !sameMoney(row.sale_amount_paid, target.sale_amount_paid) ||
    !sameMoney(row.sale_balance, target.sale_balance) ||
    !sameMoney(row.amount_owed, target.amount_owed) ||
    !sameMoney(row.debt_amount_paid, target.debt_amount_paid) ||
    !sameMoney(row.debt_balance, target.debt_balance) ||
    String(row.debt_status || "") !== String(target.debt_status || "") ||
    Number(row.payment_count || 0) !== 0
  ) {
    throw new Error("The exact receipt changed financially while becoming mergeable.");
  }
}

async function runMasterMickeyMergeProfileVisibility20260806() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log(`${REPAIR_RECORD} skipped outside production.`);
    return { skipped: true, reason: "non-production" };
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [REPAIR_LOCK]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Mickey profile visibility lock.");

    if (!(await migrationRecordExists(connection, REQUIRED_ISOLATION_REPAIR))) {
      throw new Error("The unpaid receipt identity isolation must complete first.");
    }
    if (await migrationRecordExists(connection, REPAIR_RECORD)) {
      console.log(`${REPAIR_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const before = await snapshot(connection);
    const target = await loadTarget(connection);
    await validateTarget(connection, target);

    const location = await loadSuggestedLocation(connection, target.branch_id);
    const [insertResult] = await connection.query(
      `INSERT INTO customers (branch_id, name, phone, location, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, CURRENT_TIMESTAMP)`,
      [target.branch_id, TARGET_NAME, location, target.sale_created_at]
    );
    const customerId = Number(insertResult.insertId);
    if (!customerId) throw new Error("The mergeable Master Mickey profile was not created.");

    const [saleUpdate] = await connection.query(
      `UPDATE sales
       SET customer_id = ?
       WHERE id = ? AND branch_id = ? AND receipt_number = ? AND customer_id IS NULL`,
      [customerId, target.sale_id, target.branch_id, TARGET_RECEIPT]
    );
    const [debtUpdate] = await connection.query(
      `UPDATE debts
       SET customer_id = ?
       WHERE id = ? AND branch_id = ? AND sale_id = ? AND customer_id IS NULL`,
      [customerId, target.debt_id, target.branch_id, target.sale_id]
    );
    if (Number(saleUpdate.affectedRows || 0) !== 1 || Number(debtUpdate.affectedRows || 0) !== 1) {
      throw new Error("The exact July 31 receipt could not be linked uniquely.");
    }

    await verifyProfileLink(connection, target, customerId);
    const after = await snapshot(connection);
    assertSnapshotChange(before, after);

    const summary = {
      customer_id: customerId,
      receipt_number: TARGET_RECEIPT,
      customer_name: TARGET_NAME,
      phone: null,
      sale_id: Number(target.sale_id),
      debt_id: Number(target.debt_id),
      amount_owed: TARGET_TOTAL,
      amount_paid: 0,
      balance: TARGET_TOTAL,
      merge_tool_visible: true,
      payment_history_changed: false,
      financial_values_changed: false,
      stock_changed: false,
      daily_closing_changed: false,
      purpose: "make the exact detached July 31 Mickey receipt visible in the existing customer merge directory",
    };

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, NULL, 'MASTER_MICKEY_MERGE_PROFILE_VISIBILITY_20260806', ?)`,
      [target.branch_id, `Created customer #${customerId} for ${TARGET_RECEIPT} so the exact no-phone Master Mickey receipt can be merged manually.`]
    );
    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description) VALUES (?, ?)`,
      [REPAIR_RECORD, JSON.stringify(summary)]
    );

    await connection.commit();
    transactionStarted = false;
    console.log(`Applied ${REPAIR_RECORD} on ${databaseName}.`);
    console.log(JSON.stringify(summary));
    return { applied: true, database_name: databaseName, summary };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {}
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [REPAIR_LOCK]);
      } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  runMasterMickeyMergeProfileVisibility20260806().catch((error) => {
    console.error("Master Mickey merge profile visibility failed safely. No partial change was saved.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  REPAIR_RECORD,
  REQUIRED_ISOLATION_REPAIR,
  TARGET_DATE,
  TARGET_NAME,
  TARGET_RECEIPT,
  TARGET_TOTAL,
  assertSnapshotChange,
  normalizeName,
  runMasterMickeyMergeProfileVisibility20260806,
  validateTarget,
};