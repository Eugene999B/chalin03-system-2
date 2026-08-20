require("dotenv").config();

const { pool } = require("../config/db");

async function repairDebtCustomerIdentity(connection) {
  const [debtResult] = await connection.query(`
    UPDATE debts d
    INNER JOIN customers c
      ON c.id = d.customer_id
     AND c.branch_id = d.branch_id
    SET
      d.customer_name = c.name,
      d.customer_phone = c.phone
    WHERE d.customer_id IS NOT NULL
      AND (
        COALESCE(d.customer_name, '') <> COALESCE(c.name, '')
        OR COALESCE(d.customer_phone, '') <> COALESCE(c.phone, '')
      )
  `);

  const [saleResult] = await connection.query(`
    UPDATE sales s
    INNER JOIN customers c
      ON c.id = s.customer_id
     AND c.branch_id = s.branch_id
    SET
      s.customer_name = c.name,
      s.customer_phone = c.phone
    WHERE s.customer_id IS NOT NULL
      AND (
        COALESCE(s.customer_name, '') <> COALESCE(c.name, '')
        OR COALESCE(s.customer_phone, '') <> COALESCE(c.phone, '')
      )
  `);

  return {
    debts_updated: Number(debtResult.affectedRows || 0),
    sales_updated: Number(saleResult.affectedRows || 0),
  };
}

async function main() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await repairDebtCustomerIdentity(connection);
    await connection.commit();
    console.log("Debt/customer identity repair completed:", result);
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    console.error("Debt/customer identity repair failed:", error);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
