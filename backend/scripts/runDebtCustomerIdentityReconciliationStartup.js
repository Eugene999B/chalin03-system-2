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
    if (!("sales" && ["sales", "customers", "debts"].every((table) => tables.has(table)))) {
      await connection.rollback();
      console.log(
        "Debt customer identity reconciliation skipped: required tables are not present."
      );
      return;
    }

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
      const debtName = meaningfulSnapshot(row.debt_customer_name);
      const saleName = meaningfulSnapshot(row.sale_customer_name);
      const debtPhone = String(row.debt_customer_phone || "").trim();
      const salePhone = String(row.sale_customer_phone || "").trim();

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

      const debtPlaceholder =
        normalize(debtCustomer?.name) &&
        PLACEHOLDER_NAMES.has(normalize(debtCustomer.name));
      const salePlaceholder =
        normalize(saleCustomer?.name) &&
        PLACEHOLDER_NAMES.has(normalize(saleCustomer.name));
      const snapshotName = debtName || saleName;
      const snapshotPhone = debtPhone || salePhone;

      if (!snapshotName) continue;

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
        [row.branch_id, normalize(snapshotName)]
      );

      let canonical = null;
      if (matches.length === 1) {
        canonical = matches[0];
      } else if (snapshotPhone) {
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
          [row.branch_id, snapshotPhone]
        );
        if (phoneMatches.length === 1) canonical = phoneMatches[0];
      }

      if (!canonical) continue;

      const hasConflictingPlaceholderLink =
        (debtPlaceholder && Number(row.debt_customer_id) !== Number(canonical.id)) ||
        (salePlaceholder && Number(row.sale_customer_id) !== Number(canonical.id));
      const hasSplitIdentity =
        row.debt_customer_id &&
        row.sale_customer_id &&
        Number(row.debt_customer_id) !== Number(row.sale_customer_id);

      if (hasConflictingPlaceholderLink || hasSplitIdentity) {
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
      `Debt customer identity reconciliation completed: repaired ${repairedDebtLinks} debt link(s), synchronized ${synchronizedDebtSnapshots} debt snapshot(s), synchronized ${synchronizedSales} sale link/snapshot update(s).`
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
