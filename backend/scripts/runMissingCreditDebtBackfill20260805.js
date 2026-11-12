const mysql = require("mysql2/promise");
require("dotenv").config();

const REPAIR_RECORD = "20260805_missing_credit_debt_backfill";
const REPAIR_LOCK = "chalin03:missing-credit-debt-backfill:20260805";
const REQUIRED_EXACT_NAME_RECOVERY = "20260805_exact_name_receipt_owner_recovery";

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

function debtStatus(balance, amountPaid) {
  if (money(balance) <= 0) return "paid";
  return money(amountPaid) > 0 ? "partial" : "unpaid";
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

function formatDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

async function financialSnapshot(connection) {
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
       (SELECT COALESCE(SUM(quantity), 0) FROM products) AS stock_quantity`
  );
  return {
    sale_count: Number(row.sale_count || 0),
    sale_total: money(row.sale_total),
    sale_paid: money(row.sale_paid),
    sale_balance: money(row.sale_balance),
    debt_count: Number(row.debt_count || 0),
    debt_owed: money(row.debt_owed),
    debt_paid: money(row.debt_paid),
    debt_balance: money(row.debt_balance),
    payment_count: Number(row.payment_count || 0),
    payment_total: money(row.payment_total),
    product_count: Number(row.product_count || 0),
    stock_quantity: Number(row.stock_quantity || 0),
  };
}

function assertUnchangedCore(before, after) {
  for (const field of ["sale_count", "product_count", "stock_quantity", "payment_count"]) {
    if (Number(before[field]) !== Number(after[field])) {
      throw new Error(`Protected record count or quantity changed for ${field}.`);
    }
  }
  for (const field of ["sale_total", "sale_paid", "sale_balance", "payment_total"]) {
    if (Math.abs(money(before[field]) - money(after[field])) > 0.01) {
      throw new Error(`Protected financial total changed for ${field}.`);
    }
  }
}

function assertExpectedDebtChange(before, after, expected) {
  if (Number(after.debt_count) !== Number(before.debt_count) + Number(expected.inserted_count)) {
    throw new Error("Debt count did not increase by exactly the number of inserted missing debts.");
  }
  for (const [field, expectedField] of [
    ["debt_owed", "inserted_owed"],
    ["debt_paid", "inserted_paid"],
    ["debt_balance", "inserted_balance"],
  ]) {
    const actualIncrease = money(after[field] - before[field]);
    if (Math.abs(actualIncrease - money(expected[expectedField])) > 0.01) {
      throw new Error(`Debt total increase was not exact for ${field}.`);
    }
  }
}

async function loadMissingDebtSales(connection) {
  const hasVoidedFlag = await tableHasColumns(connection, "sales", ["is_voided"]);
  const voidCondition = hasVoidedFlag ? "AND COALESCE(s.is_voided, 0) = 0" : "";
  const [rows] = await connection.query(
    `SELECT
       s.id,
       s.branch_id,
       s.receipt_number,
       s.customer_id,
       s.customer_name,
       s.customer_phone,
       s.total,
       s.amount_paid,
       s.balance,
       s.payment_type,
       s.created_at
     FROM sales s
     LEFT JOIN debts d
       ON d.branch_id = s.branch_id
      AND d.sale_id = s.id
     WHERE d.id IS NULL
       AND s.sale_status = 'completed'
       ${voidCondition}
       AND s.payment_type IN ('credit', 'mixed', 'installment')
       AND s.balance > 0.005
     ORDER BY s.branch_id, s.created_at, s.id
     FOR UPDATE`,
  );
  return rows;
}

async function findMatchingUnlinkedDebts(connection, sale) {
  const [rows] = await connection.query(
    `SELECT id, customer_id, customer_name, amount_owed, amount_paid, balance, created_at
     FROM debts
     WHERE branch_id = ?
       AND sale_id IS NULL
       AND DATE(created_at) = DATE(?)
       AND ABS(amount_owed - ?) <= 0.01
       AND ABS(amount_paid - ?) <= 0.01
       AND ABS(balance - ?) <= 0.01
       AND LOWER(TRIM(COALESCE(customer_name, ''))) = LOWER(TRIM(COALESCE(?, '')))
     ORDER BY id
     FOR UPDATE`,
    [
      sale.branch_id,
      sale.created_at,
      money(sale.total),
      money(sale.amount_paid),
      money(sale.balance),
      sale.customer_name,
    ]
  );
  return rows;
}

async function verifyOneDebtPerRepairedSale(connection, saleIds) {
  if (!saleIds.length) return;
  const placeholders = saleIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT s.id AS sale_id, COUNT(d.id) AS debt_count
     FROM sales s
     LEFT JOIN debts d
       ON d.branch_id = s.branch_id
      AND d.sale_id = s.id
     WHERE s.id IN (${placeholders})
     GROUP BY s.id
     HAVING COUNT(d.id) <> 1`,
    saleIds
  );
  if (rows.length) {
    throw new Error(`One or more repaired credit sales do not have exactly one debt: ${rows.map((row) => row.sale_id).join(", ")}`);
  }
}

async function runMissingCreditDebtBackfill20260805() {
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
    if (!lockAcquired) throw new Error("Could not acquire the missing-credit-debt repair lock.");

    if (!(await migrationRecordExists(connection, REQUIRED_EXACT_NAME_RECOVERY))) {
      throw new Error("The exact-name receipt ownership recovery must complete before debt backfill.");
    }
    if (await migrationRecordExists(connection, REPAIR_RECORD)) {
      console.log(`${REPAIR_RECORD} was already applied on ${databaseName}.`);
      return { applied: false, already_applied: true, database_name: databaseName };
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const before = await financialSnapshot(connection);
    const sales = await loadMissingDebtSales(connection);
    const repaired = [];
    const unresolved = [];
    const expected = {
      inserted_count: 0,
      inserted_owed: 0,
      inserted_paid: 0,
      inserted_balance: 0,
    };

    for (const sale of sales) {
      const matchingUnlinked = await findMatchingUnlinkedDebts(connection, sale);
      if (matchingUnlinked.length > 1) {
        unresolved.push({
          sale_id: Number(sale.id),
          branch_id: Number(sale.branch_id),
          receipt_number: sale.receipt_number,
          reason: "multiple_matching_unlinked_debts",
          matching_debt_ids: matchingUnlinked.map((row) => Number(row.id)),
        });
        continue;
      }

      if (matchingUnlinked.length === 1) {
        const debtId = Number(matchingUnlinked[0].id);
        await connection.query(
          `UPDATE debts
           SET sale_id = ?, customer_id = ?, customer_name = ?, customer_phone = ?
           WHERE id = ? AND branch_id = ? AND sale_id IS NULL`,
          [
            sale.id,
            sale.customer_id || null,
            sale.customer_name || "Unnamed Customer",
            sale.customer_phone || null,
            debtId,
            sale.branch_id,
          ]
        );
        repaired.push({
          sale_id: Number(sale.id),
          debt_id: debtId,
          receipt_number: sale.receipt_number,
          action: "linked_existing_unlinked_debt",
        });
        continue;
      }

      const reminderDays = await getReminderDays(connection, sale.branch_id);
      const dueDate = addUtcDays(formatDateOnly(sale.created_at), reminderDays);
      const [insert] = await connection.query(
        `INSERT INTO debts (
           branch_id, sale_id, customer_id, customer_name, customer_phone,
           amount_owed, amount_paid, balance, status, due_date, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.branch_id,
          sale.id,
          sale.customer_id || null,
          sale.customer_name || "Unnamed Customer",
          sale.customer_phone || null,
          money(sale.total),
          money(sale.amount_paid),
          money(sale.balance),
          debtStatus(sale.balance, sale.amount_paid),
          dueDate,
          sale.created_at,
          sale.created_at,
        ]
      );
      expected.inserted_count += 1;
      expected.inserted_owed = money(expected.inserted_owed + money(sale.total));
      expected.inserted_paid = money(expected.inserted_paid + money(sale.amount_paid));
      expected.inserted_balance = money(expected.inserted_balance + money(sale.balance));
      repaired.push({
        sale_id: Number(sale.id),
        debt_id: Number(insert.insertId),
        receipt_number: sale.receipt_number,
        action: "inserted_missing_debt",
        amount_owed: money(sale.total),
        amount_paid: money(sale.amount_paid),
        balance: money(sale.balance),
        due_date: dueDate,
      });
    }

    const repairedSaleIds = repaired.map((row) => row.sale_id);
    await verifyOneDebtPerRepairedSale(connection, repairedSaleIds);

    const after = await financialSnapshot(connection);
    assertUnchangedCore(before, after);
    assertExpectedDebtChange(before, after, expected);

    const summary = {
      missing_credit_sales_found: sales.length,
      repaired_sales: repaired.length,
      inserted_missing_debts: expected.inserted_count,
      linked_existing_unlinked_debts: repaired.filter(
        (row) => row.action === "linked_existing_unlinked_debt"
      ).length,
      unresolved_sales: unresolved.length,
      inserted_amount_owed: expected.inserted_owed,
      inserted_amount_paid: expected.inserted_paid,
      inserted_balance: expected.inserted_balance,
      sales_changed: false,
      stock_changed: false,
      debt_payments_changed: false,
      existing_debt_amounts_changed: false,
    };

    await connection.query(
      `INSERT INTO activity_log (
         branch_id, user_id, action, details, workspace_code, entity_type,
         entity_id, action_type, outcome, severity, metadata_json
       ) VALUES (NULL, NULL, 'BACKFILL_MISSING_CREDIT_DEBTS_20260805', ?, 'spare_parts',
         'credit_debt_integrity_repair', ?, 'BACKFILL_MISSING_CREDIT_DEBTS_20260805',
         'success', 'critical', ?)`,
      [
        `Backfilled or relinked ${repaired.length} outstanding credit sale debt record(s) without changing sales, stock or payments.`,
        REPAIR_RECORD,
        JSON.stringify({ summary, repaired, unresolved, before, after }),
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
    return { applied: true, database_name: databaseName, summary, repaired, unresolved };
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
  runMissingCreditDebtBackfill20260805().catch((error) => {
    console.error("Missing credit debt backfill failed safely. No partial repair was saved.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  REPAIR_LOCK,
  REPAIR_RECORD,
  REQUIRED_EXACT_NAME_RECOVERY,
  addUtcDays,
  assertExpectedDebtChange,
  assertUnchangedCore,
  debtStatus,
  money,
  runMissingCreditDebtBackfill20260805,
};
