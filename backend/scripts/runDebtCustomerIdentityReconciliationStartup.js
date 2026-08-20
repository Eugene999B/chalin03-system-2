require("dotenv").config();

const { pool } = require("../config/db");

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
      console.log("Debt customer identity reconciliation skipped: required tables are not present.");
      return;
    }

    const [saleMismatchRows] = await connection.query(
      `SELECT COUNT(*) AS affected_sales
       FROM sales s
       INNER JOIN customers c
         ON c.id = s.customer_id
        AND c.branch_id = s.branch_id
       WHERE s.customer_id IS NOT NULL
         AND (
           COALESCE(NULLIF(TRIM(s.customer_name), ''), '') <> COALESCE(NULLIF(TRIM(c.name), ''), '')
           OR COALESCE(NULLIF(TRIM(s.customer_phone), ''), '') <> COALESCE(NULLIF(TRIM(c.phone), ''), '')
         )`
    );

    const [debtMismatchRows] = await connection.query(
      `SELECT COUNT(*) AS affected_debts
       FROM debts d
       INNER JOIN customers c
         ON c.id = d.customer_id
        AND c.branch_id = d.branch_id
       WHERE d.customer_id IS NOT NULL
         AND (
           COALESCE(NULLIF(TRIM(d.customer_name), ''), '') <> COALESCE(NULLIF(TRIM(c.name), ''), '')
           OR COALESCE(NULLIF(TRIM(d.customer_phone), ''), '') <> COALESCE(NULLIF(TRIM(c.phone), ''), '')
         )`
    );

    const affectedSales = Number(saleMismatchRows[0]?.affected_sales || 0);
    const affectedDebts = Number(debtMismatchRows[0]?.affected_debts || 0);

    if (affectedSales > 0) {
      await connection.query(
        `UPDATE sales s
         INNER JOIN customers c
           ON c.id = s.customer_id
          AND c.branch_id = s.branch_id
         SET
           s.customer_name = c.name,
           s.customer_phone = c.phone
         WHERE s.customer_id IS NOT NULL
           AND (
             COALESCE(NULLIF(TRIM(s.customer_name), ''), '') <> COALESCE(NULLIF(TRIM(c.name), ''), '')
             OR COALESCE(NULLIF(TRIM(s.customer_phone), ''), '') <> COALESCE(NULLIF(TRIM(c.phone), ''), '')
           )`
      );
    }

    if (affectedDebts > 0) {
      await connection.query(
        `UPDATE debts d
         INNER JOIN customers c
           ON c.id = d.customer_id
          AND c.branch_id = d.branch_id
         SET
           d.customer_name = c.name,
           d.customer_phone = c.phone
         WHERE d.customer_id IS NOT NULL
           AND (
             COALESCE(NULLIF(TRIM(d.customer_name), ''), '') <> COALESCE(NULLIF(TRIM(c.name), ''), '')
             OR COALESCE(NULLIF(TRIM(d.customer_phone), ''), '') <> COALESCE(NULLIF(TRIM(c.phone), ''), '')
           )`
      );
    }

    await connection.commit();
    console.log(
      `Debt customer identity reconciliation completed: ${affectedSales} sale(s), ${affectedDebts} debt(s).`
    );
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Debt customer identity reconciliation rollback failed:", rollbackError);
    }
    console.error("Debt customer identity reconciliation failed:", error);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(() => process.exit(1));
