require("dotenv").config();

const { pool } = require("../config/db");

const PLACEHOLDER_NAMES = new Set([
  "CASH CUSTOMER",
  "CASH SALE",
  "WALK-IN CUSTOMER",
  "WALK IN CUSTOMER",
  "WALKIN CUSTOMER",
  "CUSTOMER",
  "UNNAMED CUSTOMER",
]);

function normalize(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function meaningfulSnapshot(value) {
  const normalized = normalize(value);
  return normalized && !PLACEHOLDER_NAMES.has(normalized)
    ? String(value).trim()
    : null;
}

function isPlaceholderCustomer(customer) {
  return !customer || PLACEHOLDER_NAMES.has(normalize(customer.name));
}

async function findUniqueCustomerBySnapshot(connection, branchId, name, phone) {
  const snapshotName = meaningfulSnapshot(name);
  const snapshotPhone = String(phone || "").trim();
  if (!snapshotName && !snapshotPhone) return null;

  if (snapshotName) {
    const [matches] = await connection.query(
      `SELECT id, name, phone
       FROM customers
       WHERE branch_id = ?
         AND UPPER(TRIM(name)) = ?
         AND UPPER(TRIM(name)) NOT IN (
           'CASH CUSTOMER',
           'CASH SALE',
           'WALK-IN CUSTOMER',
           'WALK IN CUSTOMER',
           'WALKIN CUSTOMER',
           'CUSTOMER',
           'UNNAMED CUSTOMER'
         )
       ORDER BY id ASC`,
      [branchId, normalize(snapshotName)]
    );

    if (matches.length === 1) return matches[0];
  }

  if (snapshotPhone) {
    const [phoneMatches] = await connection.query(
      `SELECT id, name, phone
       FROM customers
       WHERE branch_id = ?
         AND UPPER(TRIM(phone)) = UPPER(TRIM(?))
         AND UPPER(TRIM(name)) NOT IN (
           'CASH CUSTOMER',
           'CASH SALE',
           'WALK-IN CUSTOMER',
           'WALK IN CUSTOMER',
           'WALKIN CUSTOMER',
           'CUSTOMER',
           'UNNAMED CUSTOMER'
         )
       ORDER BY id ASC`,
      [branchId, snapshotPhone]
    );

    if (phoneMatches.length === 1) return phoneMatches[0];
  }

  return null;
}

async function repairFalseCashDebts(connection) {
  const [rows] = await connection.query(
    `SELECT
       d.id,
       d.branch_id,
       d.amount_owed,
       d.amount_paid,
       d.balance,
       d.status,
       s.payment_type,
       s.total AS sale_total,
       s.amount_paid AS sale_amount_paid,
       s.balance AS sale_balance
     FROM debts d
     INNER JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     WHERE d.balance > 0
       AND s.payment_type IN ('cash', 'momo', 'bank')
       AND s.balance <= 0
       AND s.amount_paid >= s.total
     FOR UPDATE`
  );

  let repaired = 0;
  for (const row of rows) {
    await connection.query(
      `UPDATE debts
       SET amount_paid = amount_owed,
           balance = 0,
           status = 'paid'
       WHERE id = ?
         AND branch_id = ?
         AND balance > 0`,
      [row.id, row.branch_id]
    );
    repaired += 1;
  }

  return repaired;
}

async function main() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('sales', 'customers', 'debts')`
    );

    const tables = new Set(tableRows.map((row) => row.TABLE_NAME));
    if (!["sales", "customers", "debts"].every((table) => tables.has(table))) {
      await connection.rollback();
      console.log(
        "Debt customer identity reconciliation skipped: required tables are not present."
      );
      return;
    }

    const repairedFalseCashDebts = await repairFalseCashDebts(connection);

    const [candidateRows] = await connection.query(
      `SELECT
         d.id AS debt_id,
         d.branch_id,
         d.sale_id,
         d.customer_id AS debt_customer_id,
         s.customer_id AS sale_customer_id,
         d.customer_name AS debt_customer_name,
         d.customer_phone AS debt_customer_phone,
         s.customer_name AS sale_customer_name,
         s.customer_phone AS sale_customer_phone
       FROM debts d
       LEFT JOIN sales s
         ON s.id = d.sale_id
        AND s.branch_id = d.branch_id
       WHERE COALESCE(d.customer_id, s.customer_id) IS NOT NULL
       FOR UPDATE`
    );

    let repairedDebtLinks = 0;
    let synchronizedSales = 0;
    let synchronizedDebtSnapshots = 0;

    for (const row of candidateRows) {
      const [[debtCustomer]] = row.debt_customer_id
        ? await connection.query(
            `SELECT id, name, phone
             FROM customers
             WHERE id = ? AND branch_id = ?
             LIMIT 1`,
            [row.debt_customer_id, row.branch_id]
          )
        : [[null]];
      const [[saleCustomer]] = row.sale_customer_id
        ? await connection.query(
            `SELECT id, name, phone
             FROM customers
             WHERE id = ? AND branch_id = ?
             LIMIT 1`,
            [row.sale_customer_id, row.branch_id]
          )
        : [[null]];

      const debtIsPlaceholder = isPlaceholderCustomer(debtCustomer);
      const saleIsPlaceholder = isPlaceholderCustomer(saleCustomer);
      const splitIdentity =
        row.debt_customer_id &&
        row.sale_customer_id &&
        Number(row.debt_customer_id) !== Number(row.sale_customer_id);

      let canonical = null;

      if (!debtIsPlaceholder && !splitIdentity) {
        canonical = debtCustomer;
      } else if (!saleIsPlaceholder && !splitIdentity) {
        canonical = saleCustomer;
      } else {
        canonical = await findUniqueCustomerBySnapshot(
          connection,
          row.branch_id,
          row.debt_customer_name,
          row.debt_customer_phone
        );
        if (!canonical) {
          canonical = await findUniqueCustomerBySnapshot(
            connection,
            row.branch_id,
            row.sale_customer_name,
            row.sale_customer_phone
          );
        }
      }

      if (!canonical) {
        // Never guess when the database cannot identify one unique real customer.
        continue;
      }

      if (Number(row.debt_customer_id || 0) !== Number(canonical.id)) {
        await connection.query(
          `UPDATE debts
           SET customer_id = ?
           WHERE id = ? AND branch_id = ?`,
          [canonical.id, row.debt_id, row.branch_id]
        );
        repairedDebtLinks += 1;
      }

      if (row.sale_id && Number(row.sale_customer_id || 0) !== Number(canonical.id)) {
        await connection.query(
          `UPDATE sales
           SET customer_id = ?
           WHERE id = ? AND branch_id = ?`,
          [canonical.id, row.sale_id, row.branch_id]
        );
        synchronizedSales += 1;
      }

      await connection.query(
        `UPDATE debts
         SET customer_name = ?, customer_phone = ?
         WHERE id = ? AND branch_id = ?`,
        [canonical.name, canonical.phone || null, row.debt_id, row.branch_id]
      );
      synchronizedDebtSnapshots += 1;

      if (row.sale_id) {
        await connection.query(
          `UPDATE sales
           SET customer_name = ?, customer_phone = ?
           WHERE id = ? AND branch_id = ?`,
          [canonical.name, canonical.phone || null, row.sale_id, row.branch_id]
        );
        synchronizedSales += 1;
      }
    }

    await connection.commit();
    console.log(
      `Debt customer identity reconciliation completed: repaired ${repairedDebtLinks} debt link(s), synchronized ${synchronizedDebtSnapshots} debt snapshot(s), synchronized ${synchronizedSales} sale link/snapshot update(s), closed ${repairedFalseCashDebts} false open cash/retail debt row(s).`
    );
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error(
        "Debt customer identity reconciliation rollback failed:",
        rollbackError
      );
    }
    console.error("Debt customer identity reconciliation failed:", error);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
