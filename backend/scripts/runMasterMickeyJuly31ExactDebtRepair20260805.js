const mysql = require("mysql2/promise");
require("dotenv").config();

const REPAIR_RECORD = "20260805_master_mickey_july31_exact_debt_repair";
const REPAIR_LOCK = "chalin03:master-mickey-july31-exact-debt-repair:20260805";
const REQUIRED_VISIBILITY_REPAIR =
  "20260805_zero_payment_credit_debt_visibility_repair";
const TARGET_RECEIPT = "CHL-MAIN-20260731-103020-7928";
const TARGET_NAME = "MASTER MICKEY";
const TARGET_DATE = "2026-07-31";
const TARGET_TOTAL = 1900;

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (String(value || "").trim()) return value;
  }
  throw new Error(`Missing required database variable: ${names.join(" or ")}.`);
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") {
    return undefined;
  }
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
    port: Number(
      process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || 3306
    ),
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
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(2));
}

function sameMoney(left, right) {
  return Math.abs(money(left) - money(right)) <= 0.01;
}

function formatDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

async function tableHasColumns(connection, tableName, columns) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
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
    throw new Error(
      "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
    );
  }
  if (databaseName !== expected) {
    throw new Error(
      `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
    );
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

async function getReminderDays(connection, branchId) {
  if (!(await tableHasColumns(connection, "settings", ["branch_id", "debt_reminder_days"]))) {
    return 7;
  }
  const [[row]] = await connection.query(
    `SELECT debt_reminder_days
     FROM settings
     WHERE branch_id = ?
     LIMIT 1`,
    [branchId]
  );
  const days = Number(row?.debt_reminder_days);
  return Number.isInteger(days) && days >= 0 && days <= 3650 ? days : 7;
}

async function coreSnapshot(connection) {
  const hasDailyClosings = await tableHasColumns(connection, "daily_closings", ["id"]);
  const dailyClosingCountSql = hasDailyClosings
    ? "(SELECT COUNT(*) FROM daily_closings)"
    : "0";

  const [[row]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM sales) AS sale_count,
       (SELECT COALESCE(SUM(total), 0) FROM sales) AS sale_total,
       (SELECT COALESCE(SUM(amount_paid), 0) FROM sales) AS sale_paid,
       (SELECT COALESCE(SUM(balance), 0) FROM sales) AS sale_balance,
       (SELECT COUNT(*) FROM products) AS product_count,
       (SELECT COALESCE(SUM(quantity), 0) FROM products) AS stock_quantity,
       (SELECT COUNT(*) FROM debt_payments) AS payment_count,
       (SELECT COALESCE(SUM(amount), 0) FROM debt_payments) AS payment_total,
       ${dailyClosingCountSql} AS daily_closing_count`
  );

  return {
    sale_count: Number(row.sale_count || 0),
    sale_total: money(row.sale_total),
    sale_paid: money(row.sale_paid),
    sale_balance: money(row.sale_balance),
    product_count: Number(row.product_count || 0),
    stock_quantity: Number(row.stock_quantity || 0),
    payment_count: Number(row.payment_count || 0),
    payment_total: money(row.payment_total),
    daily_closing_count: Number(row.daily_closing_count || 0),
  };
}

function assertCoreUnchanged(before, after) {
  for (const field of [
    "sale_count",
    "product_count",
    "stock_quantity",
    "payment_count",
    "daily_closing_count",
  ]) {
    if (Number(before[field]) !== Number(after[field])) {
      throw new Error(`Protected count or quantity changed for ${field}.`);
    }
  }
  for (const field of ["sale_total", "sale_paid", "sale_balance", "payment_total"]) {
    if (!sameMoney(before[field], after[field])) {
      throw new Error(`Protected financial total changed for ${field}.`);
    }
  }
}

async function otherDebtsSnapshot(connection, branchId, saleId) {
  const [rows] = await connection.query(
    `SELECT
       id, branch_id, sale_id, customer_id, customer_name, customer_phone,
       amount_owed, amount_paid, balance, status,
       DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
       DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
     FROM debts
     WHERE NOT (branch_id = ? AND sale_id = ?)
     ORDER BY id`,
    [branchId, saleId]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    branch_id: Number(row.branch_id),
    sale_id: row.sale_id == null ? null : Number(row.sale_id),
    customer_id: row.customer_id == null ? null : Number(row.customer_id),
    amount_owed: money(row.amount_owed),
    amount_paid: money(row.amount_paid),
    balance: money(row.balance),
  }));
}

function assertOtherDebtsUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("A non-target debt changed. The exact repair was rolled back.");
  }
}

async function loadTargetSale(connection) {
  const hasVoidedFlag = await tableHasColumns(connection, "sales", ["is_voided"]);
  const voidSelect = hasVoidedFlag ? "is_voided" : "0 AS is_voided";
  const [rows] = await connection.query(
    `SELECT
       id, branch_id, receipt_number, customer_id, customer_name, customer_phone,
       total, amount_paid, balance, payment_type, sale_status, ${voidSelect}, created_at
     FROM sales
     WHERE receipt_number = ?
     LIMIT 2
     FOR UPDATE`,
    [TARGET_RECEIPT]
  );
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one sale for ${TARGET_RECEIPT}; found ${rows.length}.`);
  }
  return rows[0];
}

function validateTargetSale(sale) {
  if (String(sale.sale_status || "").toLowerCase() !== "completed") {
    throw new Error("The target receipt is not a completed sale.");
  }
  if (Number(sale.is_voided || 0) !== 0) {
    throw new Error("The target receipt is voided and cannot be repaired.");
  }
  if (String(sale.payment_type || "").toLowerCase() !== "credit") {
    throw new Error("The target receipt is not a credit sale.");
  }
  if (!sameMoney(sale.total, TARGET_TOTAL)) {
    throw new Error(`The target receipt total is not GHS ${TARGET_TOTAL.toFixed(2)}.`);
  }
  if (!sameMoney(sale.amount_paid, 0)) {
    throw new Error("The target receipt has a non-zero paid amount and is protected.");
  }
  if (normalizeName(sale.customer_name) !== TARGET_NAME) {
    throw new Error("The target receipt customer name is not exactly MASTER MICKEY.");
  }
  if (formatDateOnly(sale.created_at) !== TARGET_DATE) {
    throw new Error("The target receipt date is not July 31, 2026.");
  }
}

async function assertNoReturns(connection, sale) {
  if (!(await tableHasColumns(connection, "returns", ["branch_id", "sale_id"]))) {
    return;
  }
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS return_count FROM returns WHERE branch_id = ? AND sale_id = ?",
    [sale.branch_id, sale.id]
  );
  if (Number(row?.return_count || 0) > 0) {
    throw new Error("The target receipt has a return record and is protected from this repair.");
  }
}

async function loadTargetDebts(connection, sale) {
  const [debts] = await connection.query(
    `SELECT
       id, branch_id, sale_id, customer_id, customer_name, customer_phone,
       amount_owed, amount_paid, balance, status, due_date, created_at, updated_at
     FROM debts
     WHERE branch_id = ? AND sale_id = ?
     ORDER BY id
     FOR UPDATE`,
    [sale.branch_id, sale.id]
  );

  for (const debt of debts) {
    const [[payment]] = await connection.query(
      `SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS payment_total
       FROM debt_payments
       WHERE branch_id = ? AND debt_id = ?`,
      [sale.branch_id, debt.id]
    );
    debt.payment_count = Number(payment?.payment_count || 0);
    debt.payment_total = money(payment?.payment_total);
  }
  return debts;
}

function assertTargetHasNoPaymentEvidence(debts) {
  for (const debt of debts) {
    if (
      money(debt.amount_paid) > 0.005 ||
      Number(debt.payment_count || 0) > 0 ||
      money(debt.payment_total) > 0.005
    ) {
      throw new Error(
        "The target debt contains real payment evidence and is protected from repair."
      );
    }
  }
}

async function verifyTargetDebt(connection, sale) {
  const [[row]] = await connection.query(
    `SELECT
       COUNT(d.id) AS debt_count,
       COALESCE(SUM(CASE
         WHEN d.amount_owed = ?
          AND d.amount_paid = 0
          AND d.balance = ?
          AND d.status = 'unpaid'
         THEN 1 ELSE 0 END), 0) AS correct_open_count,
       COALESCE(SUM(payment_summary.payment_count), 0) AS payment_count
     FROM debts d
     LEFT JOIN (
       SELECT branch_id, debt_id, COUNT(*) AS payment_count
       FROM debt_payments
       GROUP BY branch_id, debt_id
     ) payment_summary
       ON payment_summary.branch_id = d.branch_id
      AND payment_summary.debt_id = d.id
     WHERE d.branch_id = ? AND d.sale_id = ?`,
    [TARGET_TOTAL, TARGET_TOTAL, sale.branch_id, sale.id]
  );

  if (Number(row?.debt_count || 0) !== 1) {
    throw new Error("The July 31 receipt does not have exactly one debt after repair.");
  }
  if (Number(row?.correct_open_count || 0) !== 1) {
    throw new Error("The July 31 receipt is not one open unpaid GHS 1,900 debt.");
  }
  if (Number(row?.payment_count || 0) !== 0) {
    throw new Error("The July 31 receipt unexpectedly has payment rows.");
  }
}

async function runMasterMickeyJuly31ExactDebtRepair20260805() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    console.log(`${REPAIR_RECORD} skipped outside production.`);
    return { skipped: true, reason: "non-production" };
  }

  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [
      REPAIR_LOCK,
    ]);
    lockAcquired = Number(lock?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the exact July 31 debt repair lock.");
    }

    if (!(await migrationRecordExists(connection, REQUIRED_VISIBILITY_REPAIR))) {
      throw new Error("The prior zero-payment visibility repair must complete first.");
    }
    if (await migrationRecordExists(connection, REPAIR_RECORD)) {
      console.log(`${REPAIR_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const sale = await loadTargetSale(connection);
    validateTargetSale(sale);
    await assertNoReturns(connection, sale);

    const beforeCore = await coreSnapshot(connection);
    const otherDebtsBefore = await otherDebtsSnapshot(
      connection,
      sale.branch_id,
      sale.id
    );
    const debts = await loadTargetDebts(connection, sale);

    if (debts.length > 1) {
      throw new Error("Multiple debts are linked to the July 31 receipt; no guess was made.");
    }
    assertTargetHasNoPaymentEvidence(debts);

    const reminderDays = await getReminderDays(connection, sale.branch_id);
    const dueDate = addUtcDays(TARGET_DATE, reminderDays);
    let action;
    let debtId;

    if (debts.length === 0) {
      const [insert] = await connection.query(
        `INSERT INTO debts (
           branch_id, sale_id, customer_id, customer_name, customer_phone,
           amount_owed, amount_paid, balance, status, due_date, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?)`,
        [
          sale.branch_id,
          sale.id,
          sale.customer_id || null,
          cleanText(sale.customer_name, 150) || TARGET_NAME,
          cleanText(sale.customer_phone, 30) || null,
          TARGET_TOTAL,
          TARGET_TOTAL,
          dueDate,
          sale.created_at,
          sale.created_at,
        ]
      );
      debtId = Number(insert.insertId);
      action = "inserted_exact_missing_debt";
    } else {
      debtId = Number(debts[0].id);
      await connection.query(
        `UPDATE debts
         SET customer_id = ?,
             customer_name = ?,
             customer_phone = ?,
             amount_owed = ?,
             amount_paid = 0,
             balance = ?,
             status = 'unpaid',
             due_date = ?
         WHERE id = ? AND branch_id = ? AND sale_id = ?`,
        [
          sale.customer_id || null,
          cleanText(sale.customer_name, 150) || TARGET_NAME,
          cleanText(sale.customer_phone, 30) || null,
          TARGET_TOTAL,
          TARGET_TOTAL,
          dueDate,
          debtId,
          sale.branch_id,
          sale.id,
        ]
      );
      action = "restored_status_only_hidden_debt";
    }

    await verifyTargetDebt(connection, sale);

    const otherDebtsAfter = await otherDebtsSnapshot(
      connection,
      sale.branch_id,
      sale.id
    );
    assertOtherDebtsUnchanged(otherDebtsBefore, otherDebtsAfter);

    const afterCore = await coreSnapshot(connection);
    assertCoreUnchanged(beforeCore, afterCore);

    const summary = {
      receipt_number: TARGET_RECEIPT,
      sale_id: Number(sale.id),
      branch_id: Number(sale.branch_id),
      debt_id: debtId,
      customer_name: TARGET_NAME,
      phone_required: false,
      amount_owed: TARGET_TOTAL,
      amount_paid: 0,
      balance: TARGET_TOTAL,
      status: "unpaid",
      due_date: dueDate,
      action,
      other_debts_changed: false,
      paid_debts_changed: false,
      debt_payments_changed: false,
      sales_changed: false,
      stock_changed: false,
      daily_closing_changed: false,
    };

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, NULL, 'MASTER_MICKEY_JULY31_EXACT_DEBT_REPAIR_20260805', ?)`,
      [
        sale.branch_id,
        `Restored receipt ${TARGET_RECEIPT} as one unpaid GHS 1,900 debt without changing any other debt, payment, sale, stock or closing record.`,
      ]
    );
    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)`,
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
  runMasterMickeyJuly31ExactDebtRepair20260805().catch((error) => {
    console.error(
      "Exact July 31 Master Mickey debt repair failed safely. No partial repair was saved."
    );
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  REPAIR_LOCK,
  REPAIR_RECORD,
  REQUIRED_VISIBILITY_REPAIR,
  TARGET_DATE,
  TARGET_NAME,
  TARGET_RECEIPT,
  TARGET_TOTAL,
  assertCoreUnchanged,
  assertOtherDebtsUnchanged,
  assertTargetHasNoPaymentEvidence,
  normalizeName,
  runMasterMickeyJuly31ExactDebtRepair20260805,
  sameMoney,
  validateTargetSale,
};
