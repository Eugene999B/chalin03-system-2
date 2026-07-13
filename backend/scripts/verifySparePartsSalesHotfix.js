const { pool } = require("../config/db");

const checks = [
  {
    name: "negative payment values",
    sql: `SELECT COUNT(*) AS problem_count
          FROM sales
          WHERE amount_tendered < 0
             OR amount_paid < 0
             OR change_due < 0
             OR balance < 0`,
  },
  {
    name: "underpaid immediate-payment sales",
    sql: `SELECT COUNT(*) AS problem_count
          FROM sales
          WHERE is_voided = 0
            AND sale_status = 'completed'
            AND payment_type IN ('cash', 'momo', 'bank')
            AND amount_tendered + 0.004 < total`,
  },
  {
    name: "change-due mismatch",
    sql: `SELECT COUNT(*) AS problem_count
          FROM sales
          WHERE is_voided = 0
            AND sale_status = 'completed'
            AND payment_type IN ('cash', 'momo', 'bank')
            AND ABS(change_due - GREATEST(amount_tendered - total, 0)) > 0.004`,
  },
  {
    name: "immediate amount paid exceeds total",
    sql: `SELECT COUNT(*) AS problem_count
          FROM sales
          WHERE is_voided = 0
            AND sale_status = 'completed'
            AND payment_type IN ('cash', 'momo', 'bank')
            AND amount_paid > total + 0.004`,
  },
  {
    name: "balance mismatch",
    sql: `SELECT COUNT(*) AS problem_count
          FROM sales
          WHERE is_voided = 0
            AND sale_status = 'completed'
            AND ABS(balance - GREATEST(total - amount_paid, 0)) > 0.004`,
  },
  {
    name: "edited sales with recorded debt payments",
    sql: `SELECT COUNT(DISTINCT s.id) AS problem_count
          FROM sales s
          INNER JOIN debts d
            ON d.sale_id = s.id
           AND d.branch_id = s.branch_id
          INNER JOIN debt_payments dp
            ON dp.debt_id = d.id
           AND dp.branch_id = d.branch_id
          WHERE s.edited_at IS NOT NULL`,
  },
  {
    name: "duplicate receipt numbers",
    sql: `SELECT COUNT(*) AS problem_count
          FROM (
            SELECT receipt_number
            FROM sales
            GROUP BY receipt_number
            HAVING COUNT(*) > 1
          ) duplicates`,
  },
];

async function run() {
  const [databaseRows] = await pool.query("SELECT DATABASE() AS database_name");
  const databaseName = databaseRows[0]?.database_name;

  if (!databaseName) {
    throw new Error("No database is selected by the current environment.");
  }

  console.log(`Verifying Spare Parts sales hotfix on: ${databaseName}`);

  const requiredColumns = [
    "amount_tendered",
    "change_due",
    "edited_by",
    "edited_at",
    "edit_reason",
  ];

  const [columnRows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sales'
       AND COLUMN_NAME IN (?, ?, ?, ?, ?)`,
    requiredColumns
  );

  const foundColumns = new Set(columnRows.map((row) => row.COLUMN_NAME));
  const missingColumns = requiredColumns.filter(
    (columnName) => !foundColumns.has(columnName)
  );

  if (missingColumns.length > 0) {
    throw new Error(`Missing columns: ${missingColumns.join(", ")}`);
  }

  console.log("✓ Required sales columns are present");

  let failed = false;

  for (const check of checks) {
    const [rows] = await pool.query(check.sql);
    const count = Number(rows[0]?.problem_count || 0);
    const mark = count === 0 ? "✓" : "✗";
    console.log(`${mark} ${check.name}: ${count}`);

    if (count !== 0) {
      failed = true;
    }
  }

  const [voidRows] = await pool.query(
    `SELECT COUNT(*) AS voided_sale_count
     FROM sales
     WHERE is_voided = 1
        OR sale_status IN ('cancelled', 'voided')`
  );

  console.log(
    `ℹ preserved deleted/voided sales: ${Number(
      voidRows[0]?.voided_sale_count || 0
    )}`
  );

  if (failed) {
    throw new Error(
      "One or more data-integrity checks reported problems. Review them before deployment."
    );
  }

  console.log("✅ Spare Parts sales hotfix verification passed.");
}

run()
  .catch((error) => {
    console.error("❌ Hotfix verification failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
