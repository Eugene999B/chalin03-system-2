const mysql = require("mysql2/promise");
require("dotenv").config();

const REPAIR_RECORD = "20260805_unpaid_receipt_identity_isolation";
const REPAIR_LOCK = "chalin03:unpaid-receipt-identity-isolation:20260805";
const REQUIRED_EXACT_REPAIR = "20260805_master_mickey_july31_exact_debt_repair";

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

function normalizeProtectedRow(row) {
  return {
    debt_id: Number(row.debt_id),
    sale_id: row.sale_id == null ? null : Number(row.sale_id),
    branch_id: Number(row.branch_id),
    debt_customer_id: row.debt_customer_id == null ? null : Number(row.debt_customer_id),
    sale_customer_id: row.sale_customer_id == null ? null : Number(row.sale_customer_id),
    amount_owed: money(row.amount_owed),
    debt_amount_paid: money(row.debt_amount_paid),
    debt_balance: money(row.debt_balance),
    debt_status: String(row.debt_status || ""),
    sale_amount_paid: money(row.sale_amount_paid),
    sale_balance: money(row.sale_balance),
    payment_count: Number(row.payment_count || 0),
    payment_total: money(row.payment_total),
  };
}

function assertProtectedRowsUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("A paid, partially paid, or payment-linked receipt changed. Transaction rolled back.");
  }
}

function assertCoreUnchanged(before, after) {
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
    if (Math.abs(money(before[field]) - money(after[field])) > 0.01) {
      throw new Error(`Protected financial total changed for ${field}.`);
    }
  }
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

async function coreSnapshot(connection) {
  const hasDailyClosings = await tableHasColumns(connection, "daily_closings", ["id"]);
  const closingSql = hasDailyClosings ? "(SELECT COUNT(*) FROM daily_closings)" : "0";
  const [[row]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM sales) AS sale_count,
       (SELECT COALESCE(SUM(total), 0) FROM sales) AS sale_total,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM sales) AS sale_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM sales) AS sale_balance,
       (SELECT COUNT(*) FROM debts) AS debt_count,
       (SELECT COALESCE(SUM(amount_owed), 0) FROM debts) AS debt_owed,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM debts) AS debt_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM debts) AS debt_balance,
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

async function protectedSnapshot(connection) {
  const [rows] = await connection.query(
    `SELECT protected.*
     FROM (
       SELECT
         d.id AS debt_id,
         d.sale_id,
         d.branch_id,
         d.customer_id AS debt_customer_id,
         s.customer_id AS sale_customer_id,
         d.amount_owed,
         d.amount_paid AS debt_amount_paid,
         d.balance AS debt_balance,
         d.status AS debt_status,
         COALESCE(s.amount_paid, 0) AS sale_amount_paid,
         COALESCE(s.balance, 0) AS sale_balance,
         COUNT(dp.id) AS payment_count,
         COALESCE(SUM(dp.amount), 0) AS payment_total
       FROM debts d
       LEFT JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
       LEFT JOIN debt_payments dp ON dp.debt_id = d.id AND dp.branch_id = d.branch_id
       GROUP BY
         d.id, d.sale_id, d.branch_id, d.customer_id, s.customer_id,
         d.amount_owed, d.amount_paid, d.balance, d.status,
         s.amount_paid, s.balance
     ) AS protected
     WHERE protected.debt_amount_paid > 0.005
       OR protected.sale_amount_paid > 0.005
       OR protected.debt_status IN ('paid', 'partial')
       OR protected.payment_count > 0
     ORDER BY protected.debt_id`
  );
  return rows.map(normalizeProtectedRow);
}

async function loadCandidates(connection) {
  const [rows] = await connection.query(
    `SELECT
       d.id AS debt_id,
       d.sale_id,
       d.branch_id,
       d.customer_id AS debt_customer_id,
       s.customer_id AS sale_customer_id,
       s.receipt_number,
       COALESCE(NULLIF(TRIM(s.customer_name), ''), NULLIF(TRIM(d.customer_name), '')) AS receipt_customer_name,
       c.name AS profile_customer_name,
       d.amount_owed,
       d.amount_paid,
       d.balance,
       d.status
     FROM debts d
     INNER JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
     INNER JOIN customers c
       ON c.id = COALESCE(s.customer_id, d.customer_id)
      AND c.branch_id = d.branch_id
     WHERE d.balance > 0.005
       AND d.amount_paid <= 0.005
       AND COALESCE(s.amount_paid, 0) <= 0.005
       AND LOWER(COALESCE(d.status, '')) NOT IN ('paid', 'partial')
       AND COALESCE(s.customer_id, d.customer_id) IS NOT NULL
       AND COALESCE(NULLIF(TRIM(s.customer_name), ''), NULLIF(TRIM(d.customer_name), '')) IS NOT NULL
       AND NULLIF(TRIM(c.name), '') IS NOT NULL
       AND UPPER(COALESCE(NULLIF(TRIM(s.customer_name), ''), NULLIF(TRIM(d.customer_name), ''))) <> UPPER(TRIM(c.name))
       AND NOT EXISTS (
         SELECT 1
         FROM debt_payments dp
         WHERE dp.branch_id = d.branch_id AND dp.debt_id = d.id
       )
     ORDER BY d.branch_id, d.id
     FOR UPDATE`
  );
  return rows;
}

function validateCandidate(candidate) {
  if (!candidate.sale_id || !candidate.receipt_number) {
    throw new Error("A candidate debt has no exact linked sale receipt.");
  }
  const normalizedStatus = cleanText(candidate.status, 20).toLowerCase();
  if (["paid", "partial"].includes(normalizedStatus)) {
    throw new Error(`Candidate ${candidate.receipt_number} has a protected paid or partial status.`);
  }
  if (money(candidate.amount_paid) > 0.005 || money(candidate.balance) <= 0.005) {
    throw new Error(`Candidate ${candidate.receipt_number} is not an unpaid open debt.`);
  }
  if (
    !normalizeName(candidate.receipt_customer_name) ||
    normalizeName(candidate.receipt_customer_name) === normalizeName(candidate.profile_customer_name)
  ) {
    throw new Error(`Candidate ${candidate.receipt_number} does not have a proven name conflict.`);
  }
}

async function verifyDetached(connection, candidate) {
  const [[row]] = await connection.query(
    `SELECT
       s.customer_id AS sale_customer_id,
       d.customer_id AS debt_customer_id,
       s.customer_name AS sale_customer_name,
       d.customer_name AS debt_customer_name,
       d.amount_owed,
       d.amount_paid,
       d.balance,
       d.status,
       COUNT(dp.id) AS payment_count
     FROM debts d
     INNER JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
     LEFT JOIN debt_payments dp ON dp.debt_id = d.id AND dp.branch_id = d.branch_id
     WHERE d.id = ? AND d.branch_id = ? AND d.sale_id = ?
     GROUP BY
       s.customer_id, d.customer_id, s.customer_name, d.customer_name,
       d.amount_owed, d.amount_paid, d.balance, d.status`,
    [candidate.debt_id, candidate.branch_id, candidate.sale_id]
  );
  if (!row || row.sale_customer_id !== null || row.debt_customer_id !== null) {
    throw new Error(`Receipt ${candidate.receipt_number} was not fully detached from the wrong customer ID.`);
  }
  if (Number(row.payment_count || 0) !== 0) {
    throw new Error(`Receipt ${candidate.receipt_number} unexpectedly has payment rows.`);
  }
  if (
    normalizeName(row.sale_customer_name || row.debt_customer_name) !==
      normalizeName(candidate.receipt_customer_name) ||
    Math.abs(money(row.amount_owed) - money(candidate.amount_owed)) > 0.01 ||
    Math.abs(money(row.amount_paid) - money(candidate.amount_paid)) > 0.01 ||
    Math.abs(money(row.balance) - money(candidate.balance)) > 0.01 ||
    String(row.status || "") !== String(candidate.status || "")
  ) {
    throw new Error(`Receipt ${candidate.receipt_number} changed financially or lost its receipt identity.`);
  }
}

async function runUnpaidReceiptIdentityIsolation20260805() {
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
    if (!lockAcquired) throw new Error("Could not acquire the unpaid receipt identity isolation lock.");

    if (!(await migrationRecordExists(connection, REQUIRED_EXACT_REPAIR))) {
      throw new Error("The exact July 31 receipt repair must complete before identity isolation.");
    }
    if (await migrationRecordExists(connection, REPAIR_RECORD)) {
      console.log(`${REPAIR_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const beforeCore = await coreSnapshot(connection);
    const protectedBefore = await protectedSnapshot(connection);
    const candidates = await loadCandidates(connection);
    const detached = [];

    for (const candidate of candidates) {
      validateCandidate(candidate);

      await connection.query(
        `UPDATE sales
         SET customer_id = NULL
         WHERE id = ? AND branch_id = ?`,
        [candidate.sale_id, candidate.branch_id]
      );
      await connection.query(
        `UPDATE debts
         SET customer_id = NULL
         WHERE id = ? AND branch_id = ? AND sale_id = ?`,
        [candidate.debt_id, candidate.branch_id, candidate.sale_id]
      );

      await verifyDetached(connection, candidate);
      detached.push({
        receipt_number: candidate.receipt_number,
        debt_id: Number(candidate.debt_id),
        sale_id: Number(candidate.sale_id),
        branch_id: Number(candidate.branch_id),
        receipt_customer_name: candidate.receipt_customer_name,
        wrong_profile_name: candidate.profile_customer_name,
        previous_sale_customer_id:
          candidate.sale_customer_id == null ? null : Number(candidate.sale_customer_id),
        previous_debt_customer_id:
          candidate.debt_customer_id == null ? null : Number(candidate.debt_customer_id),
        amount_owed: money(candidate.amount_owed),
        amount_paid: money(candidate.amount_paid),
        balance: money(candidate.balance),
        status: candidate.status,
      });
    }

    const protectedAfter = await protectedSnapshot(connection);
    assertProtectedRowsUnchanged(protectedBefore, protectedAfter);
    const afterCore = await coreSnapshot(connection);
    assertCoreUnchanged(beforeCore, afterCore);

    const summary = {
      detached_count: detached.length,
      detached,
      matching_rule: "exact normalized receipt name differs from customer profile name",
      phone_required: false,
      paid_or_partial_debts_changed: false,
      debt_payments_changed: false,
      financial_values_changed: false,
      stock_changed: false,
      daily_closing_changed: false,
    };

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (NULL, NULL, 'UNPAID_RECEIPT_IDENTITY_ISOLATION_20260805', ?)`,
      [`Detached ${detached.length} unpaid zero-payment receipt(s) from conflicting customer IDs without changing money, payments, stock or closing records.`]
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
  runUnpaidReceiptIdentityIsolation20260805().catch((error) => {
    console.error("Unpaid receipt identity isolation failed safely. No partial correction was saved.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  REPAIR_LOCK,
  REPAIR_RECORD,
  REQUIRED_EXACT_REPAIR,
  assertCoreUnchanged,
  assertProtectedRowsUnchanged,
  normalizeName,
  runUnpaidReceiptIdentityIsolation20260805,
  validateCandidate,
};