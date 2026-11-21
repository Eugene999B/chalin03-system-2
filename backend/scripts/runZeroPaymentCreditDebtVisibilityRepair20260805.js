const mysql = require("mysql2/promise");
require("dotenv").config();

const REPAIR_RECORD = "20260805_zero_payment_credit_debt_visibility_repair";
const REPAIR_LOCK = "chalin03:zero-payment-credit-debt-visibility:20260805";
const REQUIRED_BACKFILL_RECORD = "20260805_missing_credit_debt_backfill";

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

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(2));
}

function computedOutstanding(total, amountPaid) {
  return money(Math.max(money(total) - money(amountPaid), 0));
}

function formatDateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function addUtcDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function normalizeProtectedDebt(row) {
  return {
    id: Number(row.id),
    branch_id: Number(row.branch_id),
    sale_id: row.sale_id == null ? null : Number(row.sale_id),
    customer_id: row.customer_id == null ? null : Number(row.customer_id),
    customer_name: row.customer_name == null ? null : String(row.customer_name),
    customer_phone: row.customer_phone == null ? null : String(row.customer_phone),
    amount_owed: money(row.amount_owed),
    amount_paid: money(row.amount_paid),
    balance: money(row.balance),
    status: String(row.status || ""),
    due_date: row.due_date == null ? null : String(row.due_date),
    payment_count: Number(row.payment_count || 0),
    payment_total: money(row.payment_total),
  };
}

function assertProtectedDebtsUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      "A paid, partially paid, or payment-linked debt changed. The transaction was rolled back."
    );
  }
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
    if (Math.abs(money(before[field]) - money(after[field])) > 0.01) {
      throw new Error(`Protected financial total changed for ${field}.`);
    }
  }
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
       (SELECT COUNT(*) FROM debt_payments) AS payment_count,
       (SELECT COALESCE(SUM(amount), 0) FROM debt_payments) AS payment_total,
       (SELECT COUNT(*) FROM products) AS product_count,
       (SELECT COALESCE(SUM(quantity), 0) FROM products) AS stock_quantity,
       ${dailyClosingCountSql} AS daily_closing_count`
  );

  return {
    sale_count: Number(row.sale_count || 0),
    sale_total: money(row.sale_total),
    sale_paid: money(row.sale_paid),
    sale_balance: money(row.sale_balance),
    payment_count: Number(row.payment_count || 0),
    payment_total: money(row.payment_total),
    product_count: Number(row.product_count || 0),
    stock_quantity: Number(row.stock_quantity || 0),
    daily_closing_count: Number(row.daily_closing_count || 0),
  };
}

async function protectedDebtSnapshot(connection) {
  const [rows] = await connection.query(
    `SELECT
       d.id,
       d.branch_id,
       d.sale_id,
       d.customer_id,
       d.customer_name,
       d.customer_phone,
       d.amount_owed,
       d.amount_paid,
       d.balance,
       d.status,
       DATE_FORMAT(d.due_date, '%Y-%m-%d') AS due_date,
       COUNT(dp.id) AS payment_count,
       COALESCE(SUM(dp.amount), 0) AS payment_total
     FROM debts d
     LEFT JOIN debt_payments dp
       ON dp.branch_id = d.branch_id
      AND dp.debt_id = d.id
     GROUP BY
       d.id, d.branch_id, d.sale_id, d.customer_id, d.customer_name,
       d.customer_phone, d.amount_owed, d.amount_paid, d.balance,
       d.status, d.due_date
     HAVING
       d.status IN ('paid', 'partial')
       OR d.amount_paid > 0.005
       OR COUNT(dp.id) > 0
     ORDER BY d.id`
  );
  return rows.map(normalizeProtectedDebt);
}

async function loadZeroPaymentCreditSales(connection) {
  const hasVoidedFlag = await tableHasColumns(connection, "sales", ["is_voided"]);
  const voidCondition = hasVoidedFlag ? "AND COALESCE(is_voided, 0) = 0" : "";
  const [rows] = await connection.query(
    `SELECT
       id,
       branch_id,
       receipt_number,
       customer_id,
       customer_name,
       customer_phone,
       total,
       amount_paid,
       balance,
       payment_type,
       created_at
     FROM sales
     WHERE sale_status = 'completed'
       ${voidCondition}
       AND payment_type IN ('credit', 'mixed', 'installment')
       AND amount_paid <= 0.005
       AND (total - amount_paid) > 0.005
     ORDER BY branch_id, created_at, id
     FOR UPDATE`
  );
  return rows;
}

async function loadLinkedDebts(connection, sale) {
  const [debts] = await connection.query(
    `SELECT
       id,
       customer_id,
       customer_name,
       customer_phone,
       amount_owed,
       amount_paid,
       balance,
       status,
       due_date
     FROM debts
     WHERE branch_id = ?
       AND sale_id = ?
     ORDER BY id
     FOR UPDATE`,
    [sale.branch_id, sale.id]
  );

  for (const debt of debts) {
    const [[payment]] = await connection.query(
      `SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS payment_total
       FROM debt_payments
       WHERE branch_id = ?
         AND debt_id = ?`,
      [sale.branch_id, debt.id]
    );
    debt.payment_count = Number(payment?.payment_count || 0);
    debt.payment_total = money(payment?.payment_total);
  }

  return debts;
}

function isProtectedDebt(debt) {
  const status = String(debt?.status || "").toLowerCase();
  return (
    status === "paid" ||
    status === "partial" ||
    money(debt?.amount_paid) > 0.005 ||
    Number(debt?.payment_count || 0) > 0 ||
    money(debt?.payment_total) > 0.005
  );
}

async function verifyVisibleOpenDebt(connection, repairedSaleIds) {
  for (const saleId of repairedSaleIds) {
    const [[row]] = await connection.query(
      `SELECT
         COUNT(d.id) AS debt_count,
         COALESCE(SUM(CASE
           WHEN d.balance > 0.005 AND d.status = 'unpaid' THEN 1 ELSE 0
         END), 0) AS visible_open_count,
         COALESCE(SUM(payment_summary.payment_count), 0) AS payment_count
       FROM debts d
       LEFT JOIN (
         SELECT branch_id, debt_id, COUNT(*) AS payment_count
         FROM debt_payments
         GROUP BY branch_id, debt_id
       ) payment_summary
         ON payment_summary.branch_id = d.branch_id
        AND payment_summary.debt_id = d.id
       WHERE d.sale_id = ?`,
      [saleId]
    );

    if (Number(row?.debt_count || 0) !== 1) {
      throw new Error(`Repaired sale ${saleId} does not have exactly one linked debt.`);
    }
    if (Number(row?.visible_open_count || 0) !== 1) {
      throw new Error(`Repaired sale ${saleId} is still not one visible unpaid debt.`);
    }
    if (Number(row?.payment_count || 0) !== 0) {
      throw new Error(`Repaired sale ${saleId} unexpectedly has debt-payment rows.`);
    }
  }
}

async function runZeroPaymentCreditDebtVisibilityRepair20260805() {
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
    if (!lockAcquired) {
      throw new Error("Could not acquire the zero-payment credit debt repair lock.");
    }

    if (!(await migrationRecordExists(connection, REQUIRED_BACKFILL_RECORD))) {
      throw new Error("The missing-credit-debt backfill must complete before this repair.");
    }
    if (await migrationRecordExists(connection, REPAIR_RECORD)) {
      console.log(`${REPAIR_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const beforeCore = await coreSnapshot(connection);
    const protectedBefore = await protectedDebtSnapshot(connection);
    const sales = await loadZeroPaymentCreditSales(connection);
    const repaired = [];
    const protectedSkipped = [];
    const unresolved = [];

    for (const sale of sales) {
      const debts = await loadLinkedDebts(connection, sale);

      if (debts.some(isProtectedDebt)) {
        protectedSkipped.push({
          sale_id: Number(sale.id),
          receipt_number: sale.receipt_number,
          debt_ids: debts.map((debt) => Number(debt.id)),
          reason: "paid_partial_or_payment_linked_debt_protected",
        });
        continue;
      }

      if (debts.length > 1) {
        unresolved.push({
          sale_id: Number(sale.id),
          receipt_number: sale.receipt_number,
          debt_ids: debts.map((debt) => Number(debt.id)),
          reason: "multiple_zero_payment_debts_not_guessed",
        });
        continue;
      }

      const outstanding = computedOutstanding(sale.total, sale.amount_paid);
      const reminderDays = await getReminderDays(connection, sale.branch_id);
      const dueDate = addUtcDays(formatDateOnly(sale.created_at), reminderDays);
      const customerName = cleanText(sale.customer_name, 150) || "Unnamed Customer";
      const customerPhone = cleanText(sale.customer_phone, 30) || null;

      if (debts.length === 0) {
        const [insert] = await connection.query(
          `INSERT INTO debts (
             branch_id,
             sale_id,
             customer_id,
             customer_name,
             customer_phone,
             amount_owed,
             amount_paid,
             balance,
             status,
             due_date,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?)`,
          [
            sale.branch_id,
            sale.id,
            sale.customer_id || null,
            customerName,
            customerPhone,
            money(sale.total),
            outstanding,
            dueDate,
            sale.created_at,
            sale.created_at,
          ]
        );

        repaired.push({
          sale_id: Number(sale.id),
          debt_id: Number(insert.insertId),
          receipt_number: sale.receipt_number,
          action: "inserted_zero_payment_open_debt",
          amount_owed: money(sale.total),
          balance: outstanding,
          phone_present: Boolean(customerPhone),
        });
        continue;
      }

      const debt = debts[0];
      const [update] = await connection.query(
        `UPDATE debts
         SET customer_id = ?,
             customer_name = ?,
             customer_phone = ?,
             amount_owed = ?,
             amount_paid = 0,
             balance = ?,
             status = 'unpaid',
             due_date = COALESCE(due_date, ?)
         WHERE id = ?
           AND branch_id = ?
           AND sale_id = ?
           AND amount_paid <= 0.005
           AND status = 'unpaid'
           AND NOT EXISTS (
             SELECT 1
             FROM debt_payments dp
             WHERE dp.branch_id = ?
               AND dp.debt_id = ?
           )`,
        [
          sale.customer_id || null,
          customerName,
          customerPhone,
          money(sale.total),
          outstanding,
          dueDate,
          debt.id,
          sale.branch_id,
          sale.id,
          sale.branch_id,
          debt.id,
        ]
      );

      if (Number(update.affectedRows || 0) !== 1) {
        throw new Error(
          `Zero-payment debt ${debt.id} changed protection state while being repaired.`
        );
      }

      repaired.push({
        sale_id: Number(sale.id),
        debt_id: Number(debt.id),
        receipt_number: sale.receipt_number,
        action: "restored_existing_zero_payment_open_debt",
        amount_owed: money(sale.total),
        balance: outstanding,
        phone_present: Boolean(customerPhone),
      });
    }

    await verifyVisibleOpenDebt(
      connection,
      repaired.map((row) => row.sale_id)
    );

    const afterCore = await coreSnapshot(connection);
    const protectedAfter = await protectedDebtSnapshot(connection);
    assertCoreUnchanged(beforeCore, afterCore);
    assertProtectedDebtsUnchanged(protectedBefore, protectedAfter);

    const summary = {
      zero_payment_credit_sales_scanned: sales.length,
      repaired_open_debts: repaired.length,
      inserted_open_debts: repaired.filter(
        (row) => row.action === "inserted_zero_payment_open_debt"
      ).length,
      restored_existing_open_debts: repaired.filter(
        (row) => row.action === "restored_existing_zero_payment_open_debt"
      ).length,
      paid_or_partial_debts_protected: protectedSkipped.length,
      unresolved_multiple_debts: unresolved.length,
      phone_required: false,
      sales_changed: false,
      stock_changed: false,
      debt_payments_changed: false,
      daily_closing_changed: false,
      paid_or_partial_debts_changed: false,
    };

    await connection.query(
      `INSERT INTO activity_log (
         branch_id,
         user_id,
         action,
         details,
         workspace_code,
         entity_type,
         entity_id,
         action_type,
         outcome,
         severity,
         metadata_json
       ) VALUES (
         NULL,
         NULL,
         'RESTORE_ZERO_PAYMENT_CREDIT_DEBT_VISIBILITY_20260805',
         ?,
         'spare_parts',
         'credit_debt_visibility_repair',
         ?,
         'RESTORE_ZERO_PAYMENT_CREDIT_DEBT_VISIBILITY_20260805',
         'success',
         'critical',
         ?
       )`,
      [
        `Restored ${repaired.length} zero-payment credit receipt(s) to Debt Desk without changing paid debts, payments, sales, stock or daily closings.`,
        REPAIR_RECORD,
        JSON.stringify({
          summary,
          repaired,
          protected_skipped: protectedSkipped,
          unresolved,
          before_core: beforeCore,
          after_core: afterCore,
        }),
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

    return {
      applied: true,
      database_name: databaseName,
      summary,
      repaired,
      protected_skipped: protectedSkipped,
      unresolved,
    };
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
  runZeroPaymentCreditDebtVisibilityRepair20260805().catch((error) => {
    console.error(
      "Zero-payment credit debt visibility repair failed safely. No partial repair was saved."
    );
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  REPAIR_LOCK,
  REPAIR_RECORD,
  REQUIRED_BACKFILL_RECORD,
  addUtcDays,
  assertCoreUnchanged,
  assertProtectedDebtsUnchanged,
  computedOutstanding,
  isProtectedDebt,
  money,
  normalizeProtectedDebt,
  runZeroPaymentCreditDebtVisibilityRepair20260805,
};
