const { pool } = require("../config/db");

const DEFAULT_WARNING_THRESHOLD = 70;
const DEFAULT_DANGER_THRESHOLD = 45;

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return Number(asNumber(value).toFixed(2));
}

function percent(value) {
  return Number(asNumber(value).toFixed(2));
}

function cleanDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const diff = end.getTime() - start.getTime();
  return Math.max(Math.ceil(diff / 86400000), 1);
}

function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 29);

  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: end,
  };
}

function normalizeDateRange(query = {}) {
  const defaults = getDefaultDateRange();
  const startDate = cleanDate(query.start_date || query.startDate) || defaults.startDate;
  const endDate = cleanDate(query.end_date || query.endDate) || defaults.endDate;

  if (startDate > endDate) {
    return {
      startDate: endDate,
      endDate: startDate,
    };
  }

  return {
    startDate,
    endDate,
  };
}

function createDateWindow(startDate, endDate) {
  return {
    startDateTime: `${startDate} 00:00:00`,
    endDateTime: `${addDays(endDate, 1)} 00:00:00`,
    startDate,
    endDate,
    nextEndDate: addDays(endDate, 1),
  };
}

function buildBranchFilter(branchId, tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";

  if (!branchId) {
    return {
      sql: "",
      params: [],
    };
  }

  return {
    sql: ` AND ${prefix}branch_id = ?`,
    params: [branchId],
  };
}

function getUserBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function isAllBranchRequest(req) {
  const role = String(req.user?.role || "").toLowerCase();
  const requested = String(req.query?.branch_id || req.query?.branchId || "").toLowerCase();

  return ["admin", "manager"].includes(role) && ["all", "0"].includes(requested);
}

function getRequestedBranchId(req) {
  if (isAllBranchRequest(req)) {
    return null;
  }

  const role = String(req.user?.role || "").toLowerCase();
  const queryBranchId = Number(req.query?.branch_id || req.query?.branchId || 0);

  if (["admin", "manager"].includes(role) && Number.isInteger(queryBranchId) && queryBranchId > 0) {
    return queryBranchId;
  }

  return getUserBranchId(req);
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return rows.length > 0;
}

async function getColumns(tableName) {
  try {
    const [columns] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
    return columns.map((column) => column.Field);
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_TABLE_ERROR") {
      return [];
    }

    throw error;
  }
}

function chooseColumn(columns, candidates) {
  return candidates.find((column) => columns.includes(column)) || null;
}

function makeDateFilter(column, window, alias = "") {
  const prefix = alias ? `${alias}.` : "";

  return {
    sql: ` AND ${prefix}\`${column}\` >= ? AND ${prefix}\`${column}\` < ?`,
    params: [window.startDateTime, window.endDateTime],
  };
}

function combineFilters(...filters) {
  return {
    sql: filters.map((filter) => filter.sql).join(""),
    params: filters.flatMap((filter) => filter.params),
  };
}

function saleNotVoidedSql(columns, alias = "s") {
  const prefix = alias ? `${alias}.` : "";
  const conditions = [];

  if (columns.includes("is_void")) {
    conditions.push(`COALESCE(${prefix}is_void, 0) = 0`);
  }

  if (columns.includes("voided_at")) {
    conditions.push(`${prefix}voided_at IS NULL`);
  }

  if (columns.includes("sale_status")) {
    conditions.push(`LOWER(COALESCE(${prefix}sale_status, '')) NOT IN ('void', 'voided', 'cancelled', 'canceled')`);
  }

  if (columns.includes("status")) {
    conditions.push(`LOWER(COALESCE(${prefix}status, '')) NOT IN ('void', 'voided', 'cancelled', 'canceled')`);
  }

  return conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "";
}

async function getBranchMeta(branchId) {
  if (!(await tableExists("branches"))) {
    return {
      selected_branch_id: branchId || null,
      selected_branch_code: branchId ? `BR-${branchId}` : "ALL",
      selected_branch_name: branchId ? `Branch ${branchId}` : "All Stores",
    };
  }

  if (!branchId) {
    return {
      selected_branch_id: null,
      selected_branch_code: "ALL",
      selected_branch_name: "All Stores",
    };
  }

  const columns = await getColumns("branches");
  const codeSql = columns.includes("code")
    ? "code"
    : columns.includes("branch_code")
    ? "branch_code AS code"
    : "CONCAT('BR-', id) AS code";
  const nameSql = columns.includes("name")
    ? "name"
    : columns.includes("branch_name")
    ? "branch_name AS name"
    : "CONCAT('Branch ', id) AS name";

  const [rows] = await pool.query(
    `SELECT id, ${codeSql}, ${nameSql}
     FROM branches
     WHERE id = ?
     LIMIT 1`,
    [branchId]
  );

  const branch = rows[0] || {};

  return {
    selected_branch_id: branchId,
    selected_branch_code: branch.code || `BR-${branchId}`,
    selected_branch_name: branch.name || `Branch ${branchId}`,
  };
}

async function getSalesSummary(branchId, window) {
  if (!(await tableExists("sales"))) {
    return emptySalesSummary();
  }

  const columns = await getColumns("sales");
  const dateColumn = chooseColumn(columns, ["created_at", "sale_date", "date"]);

  if (!dateColumn) {
    return emptySalesSummary();
  }

  const branchFilter = buildBranchFilter(branchId, "s");
  const dateFilter = makeDateFilter(dateColumn, window, "s");
  const filters = combineFilters(branchFilter, dateFilter);
  const notVoided = saleNotVoidedSql(columns, "s");
  const totalColumn = columns.includes("total") ? "total" : columns.includes("grand_total") ? "grand_total" : null;
  const paidColumn = columns.includes("amount_paid") ? "amount_paid" : columns.includes("paid_amount") ? "paid_amount" : null;
  const balanceColumn = columns.includes("balance") ? "balance" : null;
  const discountColumn = chooseColumn(columns, ["discount", "discount_amount"]);
  const paymentColumn = chooseColumn(columns, ["payment_type", "payment_method"]);

  const totalSql = totalColumn ? `COALESCE(SUM(s.\`${totalColumn}\`), 0)` : "0";
  const paidSql = paidColumn ? `COALESCE(SUM(s.\`${paidColumn}\`), 0)` : "0";
  const balanceSql = balanceColumn ? `COALESCE(SUM(s.\`${balanceColumn}\`), 0)` : "0";
  const discountSql = discountColumn ? `COALESCE(SUM(s.\`${discountColumn}\`), 0)` : "0";
  const paymentExpr = paymentColumn ? `LOWER(COALESCE(s.\`${paymentColumn}\`, 'unknown'))` : "'unknown'";

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS transaction_count,
       ${totalSql} AS total_sales,
       ${paidSql} AS total_paid,
       ${balanceSql} AS total_balance,
       ${discountSql} AS total_discount,
       COALESCE(AVG(${totalColumn ? `s.\`${totalColumn}\`` : "0"}), 0) AS average_sale,
       COALESCE(SUM(CASE WHEN ${paymentExpr} = 'cash' THEN ${totalColumn ? `s.\`${totalColumn}\`` : "0"} ELSE 0 END), 0) AS cash_total,
       COALESCE(SUM(CASE WHEN ${paymentExpr} = 'momo' THEN ${totalColumn ? `s.\`${totalColumn}\`` : "0"} ELSE 0 END), 0) AS momo_total,
       COALESCE(SUM(CASE WHEN ${paymentExpr} = 'bank' THEN ${totalColumn ? `s.\`${totalColumn}\`` : "0"} ELSE 0 END), 0) AS bank_total,
       COALESCE(SUM(CASE WHEN ${paymentExpr} = 'credit' THEN ${totalColumn ? `s.\`${totalColumn}\`` : "0"} ELSE 0 END), 0) AS credit_total,
       COALESCE(SUM(CASE WHEN ${paymentExpr} = 'mixed' THEN ${totalColumn ? `s.\`${totalColumn}\`` : "0"} ELSE 0 END), 0) AS mixed_total
     FROM sales s
     WHERE 1=1
       ${filters.sql}
       ${notVoided}`,
    filters.params
  );

  const row = rows[0] || {};
  const totalSales = money(row.total_sales);
  const totalPaid = money(row.total_paid);

  return {
    transaction_count: Number(row.transaction_count || 0),
    total_sales: totalSales,
    total_paid: totalPaid,
    total_balance: money(row.total_balance),
    total_discount: money(row.total_discount),
    average_sale: money(row.average_sale),
    cash_total: money(row.cash_total),
    momo_total: money(row.momo_total),
    bank_total: money(row.bank_total),
    credit_total: money(row.credit_total),
    mixed_total: money(row.mixed_total),
    collection_rate: totalSales > 0 ? percent((totalPaid / totalSales) * 100) : 0,
  };
}

function emptySalesSummary() {
  return {
    transaction_count: 0,
    total_sales: 0,
    total_paid: 0,
    total_balance: 0,
    total_discount: 0,
    average_sale: 0,
    cash_total: 0,
    momo_total: 0,
    bank_total: 0,
    credit_total: 0,
    mixed_total: 0,
    collection_rate: 0,
  };
}

async function getExpenseSummary(branchId, window) {
  if (!(await tableExists("expenses"))) {
    return {
      expense_count: 0,
      total_expenses: 0,
      categories: [],
    };
  }

  const columns = await getColumns("expenses");
  const amountColumn = chooseColumn(columns, ["amount", "expense_amount"]);
  const dateColumn = chooseColumn(columns, ["expense_date", "date", "created_at"]);
  const categoryColumn = chooseColumn(columns, ["category", "expense_category", "type"]);

  if (!amountColumn || !dateColumn) {
    return {
      expense_count: 0,
      total_expenses: 0,
      categories: [],
    };
  }

  const branchFilter = buildBranchFilter(branchId, "e");
  const dateFilter =
    dateColumn === "created_at"
      ? makeDateFilter(dateColumn, window, "e")
      : {
          sql: " AND e.`" + dateColumn + "` >= ? AND e.`" + dateColumn + "` < ?",
          params: [window.startDate, window.nextEndDate],
        };
  const filters = combineFilters(branchFilter, dateFilter);
  const categorySql = categoryColumn ? `COALESCE(e.\`${categoryColumn}\`, 'Uncategorized')` : "'Uncategorized'";

  const [summaryRows] = await pool.query(
    `SELECT COUNT(*) AS expense_count, COALESCE(SUM(e.\`${amountColumn}\`), 0) AS total_expenses
     FROM expenses e
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  const [categoryRows] = await pool.query(
    `SELECT ${categorySql} AS category, COUNT(*) AS count, COALESCE(SUM(e.\`${amountColumn}\`), 0) AS total
     FROM expenses e
     WHERE 1=1 ${filters.sql}
     GROUP BY ${categorySql}
     ORDER BY total DESC
     LIMIT 10`,
    filters.params
  );

  return {
    expense_count: Number(summaryRows[0]?.expense_count || 0),
    total_expenses: money(summaryRows[0]?.total_expenses),
    categories: categoryRows.map((row) => ({
      category: row.category || "Uncategorized",
      count: Number(row.count || 0),
      total: money(row.total),
    })),
  };
}

async function getDebtSummary(branchId, window) {
  if (!(await tableExists("debts"))) {
    return {
      total_debt_balance: 0,
      active_debt_count: 0,
      new_debt_amount: 0,
      debt_payments: 0,
      aging: [],
    };
  }

  const columns = await getColumns("debts");
  const amountColumn = chooseColumn(columns, ["amount_owed", "total_amount", "amount"]);
  const balanceColumn = chooseColumn(columns, ["balance", "amount_balance"]);
  const dateColumn = chooseColumn(columns, ["created_at", "debt_date", "date"]);

  if (!balanceColumn) {
    return {
      total_debt_balance: 0,
      active_debt_count: 0,
      new_debt_amount: 0,
      debt_payments: 0,
      aging: [],
    };
  }

  const branchFilter = buildBranchFilter(branchId, "d");
  const baseParams = branchFilter.params;
  const [balanceRows] = await pool.query(
    `SELECT
       COUNT(*) AS active_debt_count,
       COALESCE(SUM(d.\`${balanceColumn}\`), 0) AS total_debt_balance
     FROM debts d
     WHERE d.\`${balanceColumn}\` > 0
       ${branchFilter.sql}`,
    baseParams
  );

  let newDebtAmount = 0;

  if (amountColumn && dateColumn) {
    const dateFilter = makeDateFilter(dateColumn, window, "d");
    const filters = combineFilters(branchFilter, dateFilter);
    const [newDebtRows] = await pool.query(
      `SELECT COALESCE(SUM(d.\`${amountColumn}\`), 0) AS new_debt_amount
       FROM debts d
       WHERE 1=1 ${filters.sql}`,
      filters.params
    );
    newDebtAmount = money(newDebtRows[0]?.new_debt_amount);
  }

  const aging = [];

  if (dateColumn) {
    const [agingRows] = await pool.query(
      `SELECT
         CASE
          WHEN DATEDIFF(CURDATE(), DATE(d.\`${dateColumn}\`)) <= 7 THEN '0-7 days'
          WHEN DATEDIFF(CURDATE(), DATE(d.\`${dateColumn}\`)) <= 14 THEN '8-14 days'
          WHEN DATEDIFF(CURDATE(), DATE(d.\`${dateColumn}\`)) <= 30 THEN '15-30 days'
          WHEN DATEDIFF(CURDATE(), DATE(d.\`${dateColumn}\`)) <= 60 THEN '31-60 days'
          ELSE '60+ days'
         END AS bucket,
         COUNT(*) AS count,
         COALESCE(SUM(d.\`${balanceColumn}\`), 0) AS total
       FROM debts d
       WHERE d.\`${balanceColumn}\` > 0
         ${branchFilter.sql}
       GROUP BY bucket
       ORDER BY MIN(DATEDIFF(CURDATE(), DATE(d.\`${dateColumn}\`)))`,
      baseParams
    );

    aging.push(
      ...agingRows.map((row) => ({
        bucket: row.bucket,
        count: Number(row.count || 0),
        total: money(row.total),
      }))
    );
  }

  const debtPayments = await getDebtPaymentTotal(branchId, window);

  return {
    total_debt_balance: money(balanceRows[0]?.total_debt_balance),
    active_debt_count: Number(balanceRows[0]?.active_debt_count || 0),
    new_debt_amount: newDebtAmount,
    debt_payments: debtPayments,
    aging,
  };
}

async function getDebtPaymentTotal(branchId, window) {
  if (!(await tableExists("debt_payments")) || !(await tableExists("debts"))) {
    return 0;
  }

  const paymentColumns = await getColumns("debt_payments");
  const amountColumn = chooseColumn(paymentColumns, ["amount", "payment_amount"]);
  const dateColumn = chooseColumn(paymentColumns, ["paid_at", "created_at", "payment_date"]);

  if (!amountColumn || !dateColumn) {
    return 0;
  }

  const dateFilter = makeDateFilter(dateColumn, window, "dp");
  const branchFilter = buildBranchFilter(branchId, "d");
  const filters = combineFilters(branchFilter, dateFilter);

  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(dp.\`${amountColumn}\`), 0) AS total
     FROM debt_payments dp
     INNER JOIN debts d ON dp.debt_id = d.id
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  return money(rows[0]?.total);
}

async function getStockSummary(branchId) {
  if (!(await tableExists("products"))) {
    return {
      product_count: 0,
      low_stock_count: 0,
      negative_stock_count: 0,
      total_quantity: 0,
      estimated_stock_cost_value: 0,
      estimated_stock_retail_value: 0,
      low_stock_items: [],
    };
  }

  const columns = await getColumns("products");
  const quantityColumn = chooseColumn(columns, ["quantity", "stock", "qty"]);
  const thresholdColumn = chooseColumn(columns, ["low_stock_threshold", "reorder_level", "minimum_stock"]);
  const costColumn = chooseColumn(columns, ["cost_price", "buying_price", "purchase_price", "unit_cost"]);
  const priceColumn = chooseColumn(columns, ["selling_price", "price", "unit_price"]);
  const nameColumn = chooseColumn(columns, ["name", "product_name", "item_name"]);

  if (!quantityColumn) {
    return {
      product_count: 0,
      low_stock_count: 0,
      negative_stock_count: 0,
      total_quantity: 0,
      estimated_stock_cost_value: 0,
      estimated_stock_retail_value: 0,
      low_stock_items: [],
    };
  }

  const branchFilter = buildBranchFilter(branchId, "p");
  const costExpr = costColumn ? `COALESCE(p.\`${costColumn}\`, 0)` : "0";
  const priceExpr = priceColumn ? `COALESCE(p.\`${priceColumn}\`, 0)` : "0";
  const lowStockExpr = thresholdColumn
    ? `CASE WHEN p.\`${thresholdColumn}\` IS NOT NULL AND p.\`${quantityColumn}\` <= p.\`${thresholdColumn}\` THEN 1 ELSE 0 END`
    : "0";

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS product_count,
       COALESCE(SUM(p.\`${quantityColumn}\`), 0) AS total_quantity,
       COALESCE(SUM(CASE WHEN p.\`${quantityColumn}\` < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_count,
       COALESCE(SUM(${lowStockExpr}), 0) AS low_stock_count,
       COALESCE(SUM(p.\`${quantityColumn}\` * ${costExpr}), 0) AS estimated_stock_cost_value,
       COALESCE(SUM(p.\`${quantityColumn}\` * ${priceExpr}), 0) AS estimated_stock_retail_value
     FROM products p
     WHERE 1=1 ${branchFilter.sql}`,
    branchFilter.params
  );

  let lowStockItems = [];

  if (thresholdColumn && nameColumn) {
    const [lowRows] = await pool.query(
      `SELECT
         p.id,
         p.\`${nameColumn}\` AS name,
         p.\`${quantityColumn}\` AS quantity,
         p.\`${thresholdColumn}\` AS low_stock_threshold
       FROM products p
       WHERE p.\`${thresholdColumn}\` IS NOT NULL
         AND p.\`${quantityColumn}\` <= p.\`${thresholdColumn}\`
         ${branchFilter.sql}
       ORDER BY p.\`${quantityColumn}\` ASC, p.\`${nameColumn}\` ASC
       LIMIT 20`,
      branchFilter.params
    );

    lowStockItems = lowRows.map((row) => ({
      id: row.id,
      name: row.name,
      quantity: money(row.quantity),
      low_stock_threshold: money(row.low_stock_threshold),
    }));
  }

  const row = rows[0] || {};

  return {
    product_count: Number(row.product_count || 0),
    low_stock_count: Number(row.low_stock_count || 0),
    negative_stock_count: Number(row.negative_stock_count || 0),
    total_quantity: money(row.total_quantity),
    estimated_stock_cost_value: money(row.estimated_stock_cost_value),
    estimated_stock_retail_value: money(row.estimated_stock_retail_value),
    low_stock_items: lowStockItems,
  };
}

async function getPurchaseSummary(branchId, window) {
  if (!(await tableExists("purchases"))) {
    return {
      purchase_count: 0,
      total_purchases: 0,
      amount_paid: 0,
      balance: 0,
    };
  }

  const columns = await getColumns("purchases");
  const dateColumn = chooseColumn(columns, ["purchase_date", "created_at", "date"]);
  const totalColumn = chooseColumn(columns, ["total", "total_amount", "grand_total"]);
  const paidColumn = chooseColumn(columns, ["amount_paid", "paid_amount"]);
  const balanceColumn = chooseColumn(columns, ["balance", "amount_balance"]);

  if (!dateColumn || !totalColumn) {
    return {
      purchase_count: 0,
      total_purchases: 0,
      amount_paid: 0,
      balance: 0,
    };
  }

  const branchFilter = buildBranchFilter(branchId, "p");
  const dateFilter =
    dateColumn === "created_at"
      ? makeDateFilter(dateColumn, window, "p")
      : {
          sql: " AND p.`" + dateColumn + "` >= ? AND p.`" + dateColumn + "` < ?",
          params: [window.startDate, window.nextEndDate],
        };
  const filters = combineFilters(branchFilter, dateFilter);

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS purchase_count,
       COALESCE(SUM(p.\`${totalColumn}\`), 0) AS total_purchases,
       ${paidColumn ? `COALESCE(SUM(p.\`${paidColumn}\`), 0)` : "0"} AS amount_paid,
       ${balanceColumn ? `COALESCE(SUM(p.\`${balanceColumn}\`), 0)` : "0"} AS balance
     FROM purchases p
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  return {
    purchase_count: Number(rows[0]?.purchase_count || 0),
    total_purchases: money(rows[0]?.total_purchases),
    amount_paid: money(rows[0]?.amount_paid),
    balance: money(rows[0]?.balance),
  };
}

async function getBranchComparison(window) {
  if (!(await tableExists("branches")) || !(await tableExists("sales"))) {
    return [];
  }

  const saleColumns = await getColumns("sales");
  const branchColumns = await getColumns("branches");
  const dateColumn = chooseColumn(saleColumns, ["created_at", "sale_date", "date"]);
  const totalColumn = chooseColumn(saleColumns, ["total", "grand_total"]);
  const paidColumn = chooseColumn(saleColumns, ["amount_paid", "paid_amount"]);
  const balanceColumn = chooseColumn(saleColumns, ["balance"]);

  if (!dateColumn || !totalColumn) {
    return [];
  }

  const codeSql = branchColumns.includes("code")
    ? "b.code"
    : branchColumns.includes("branch_code")
    ? "b.branch_code"
    : "CONCAT('BR-', b.id)";
  const nameSql = branchColumns.includes("name")
    ? "b.name"
    : branchColumns.includes("branch_name")
    ? "b.branch_name"
    : "CONCAT('Branch ', b.id)";
  const dateFilter = makeDateFilter(dateColumn, window, "s");
  const notVoided = saleNotVoidedSql(saleColumns, "s");

  const [rows] = await pool.query(
    `SELECT
       b.id,
       ${codeSql} AS branch_code,
       ${nameSql} AS branch_name,
       COUNT(s.id) AS transaction_count,
       COALESCE(SUM(s.\`${totalColumn}\`), 0) AS total_sales,
       ${paidColumn ? `COALESCE(SUM(s.\`${paidColumn}\`), 0)` : "0"} AS total_paid,
       ${balanceColumn ? `COALESCE(SUM(s.\`${balanceColumn}\`), 0)` : "0"} AS total_balance
     FROM branches b
     LEFT JOIN sales s ON s.branch_id = b.id
       ${dateFilter.sql}
       ${notVoided}
     GROUP BY b.id, branch_code, branch_name
     ORDER BY total_sales DESC`,
    dateFilter.params
  );

  return rows.map((row) => ({
    branch_id: row.id,
    branch_code: row.branch_code,
    branch_name: row.branch_name,
    transaction_count: Number(row.transaction_count || 0),
    total_sales: money(row.total_sales),
    total_paid: money(row.total_paid),
    total_balance: money(row.total_balance),
    collection_rate: asNumber(row.total_sales) > 0 ? percent((asNumber(row.total_paid) / asNumber(row.total_sales)) * 100) : 0,
  }));
}

async function buildLedger({ sales, expenses, debts, purchases }) {
  const cashBankMomo = money(sales.total_paid + debts.debt_payments);
  const receivablesIncrease = money(sales.total_balance + debts.new_debt_amount);
  const receivablesDecrease = money(debts.debt_payments);
  const salesRevenue = money(sales.total_sales);
  const expensesTotal = money(expenses.total_expenses);
  const purchasesTotal = money(purchases.total_purchases);

  const ledgerRows = [
    {
      account_code: "1000",
      account_name: "Cash / MoMo / Bank",
      account_type: "Asset",
      debit: cashBankMomo,
      credit: money(expensesTotal + purchases.amount_paid),
      explanation: "Money collected from sales and debt payments, reduced by expenses and paid purchases.",
    },
    {
      account_code: "1100",
      account_name: "Accounts Receivable / Customer Debts",
      account_type: "Asset",
      debit: receivablesIncrease,
      credit: receivablesDecrease,
      explanation: "Credit/mixed sales increase receivables; debt payments reduce receivables.",
    },
    {
      account_code: "1200",
      account_name: "Inventory / Stock Asset",
      account_type: "Asset",
      debit: purchasesTotal,
      credit: 0,
      explanation: "Purchases increase stock value. Future COGS should reduce this using cost history.",
    },
    {
      account_code: "4000",
      account_name: "Sales Revenue",
      account_type: "Income",
      debit: 0,
      credit: salesRevenue,
      explanation: "Total sales for the selected period.",
    },
    {
      account_code: "5000",
      account_name: "Operating Expenses",
      account_type: "Expense",
      debit: expensesTotal,
      credit: 0,
      explanation: "Expenses recorded in the selected period.",
    },
    {
      account_code: "5100",
      account_name: "Purchases / Stock Bought",
      account_type: "Cost/Asset Movement",
      debit: purchasesTotal,
      credit: 0,
      explanation: "Supplier purchases. Future accounting can split inventory and cost of goods sold.",
    },
  ];

  const totalDebit = money(ledgerRows.reduce((sum, row) => sum + row.debit, 0));
  const totalCredit = money(ledgerRows.reduce((sum, row) => sum + row.credit, 0));

  return {
    rows: ledgerRows,
    totals: {
      debit: totalDebit,
      credit: totalCredit,
      difference: money(totalDebit - totalCredit),
    },
    note:
      "This is a management ledger, not a certified statutory ledger. It gives business intelligence now and can become stricter after cost history, stock transfers, and accounting rules are finalized.",
  };
}

function buildProfitAndLoss({ sales, expenses, purchases }) {
  const grossSales = money(sales.total_sales);
  const discounts = money(sales.total_discount);
  const netSales = money(grossSales - discounts);
  const operatingExpenses = money(expenses.total_expenses);
  const purchasesAsCostSignal = money(purchases.total_purchases);
  const estimatedNetBeforeStockCost = money(netSales - operatingExpenses);
  const conservativeCashPosition = money(sales.total_paid - operatingExpenses - purchases.amount_paid);

  return {
    gross_sales: grossSales,
    discounts,
    net_sales: netSales,
    operating_expenses: operatingExpenses,
    purchases_cost_signal: purchasesAsCostSignal,
    estimated_net_before_stock_cost: estimatedNetBeforeStockCost,
    conservative_cash_position: conservativeCashPosition,
    warning:
      "True profit requires reliable cost of goods sold. This report gives a strong management estimate and highlights what data must improve next.",
  };
}

async function buildAuditFlags({ branchId, window, sales, expenses, debts, stock, purchases }) {
  const flags = [];

  function addFlag(severity, category, title, detail, action, scoreImpact) {
    flags.push({
      severity,
      category,
      title,
      detail,
      recommended_action: action,
      score_impact: scoreImpact,
    });
  }

  if (sales.total_sales > 0 && sales.collection_rate < 70) {
    addFlag(
      "warning",
      "Collections",
      "Low sales collection rate",
      `Only ${sales.collection_rate}% of sales value was paid in the selected period.`,
      "Review credit and mixed sales, then follow up unpaid balances.",
      8
    );
  }

  if (debts.total_debt_balance > 0 && sales.total_sales > 0 && debts.total_debt_balance > sales.total_sales * 0.5) {
    addFlag(
      "danger",
      "Debt",
      "Debt balance is high compared with period sales",
      `Outstanding debt is GHS ${debts.total_debt_balance}, which is more than 50% of selected-period sales.`,
      "Create a debt follow-up list and stop risky credit sales until old debts reduce.",
      12
    );
  }

  const oldDebt = debts.aging.find((row) => row.bucket === "60+ days");
  if (oldDebt && oldDebt.total > 0) {
    addFlag(
      "danger",
      "Debt Aging",
      "Old customer debt exists",
      `60+ day debt total is GHS ${oldDebt.total}.`,
      "Owner or manager should call these customers and decide collection action.",
      10
    );
  }

  if (stock.negative_stock_count > 0) {
    addFlag(
      "danger",
      "Stock",
      "Negative stock detected",
      `${stock.negative_stock_count} products have negative quantity.`,
      "Investigate wrong sales, stock adjustments, or missing purchases immediately.",
      15
    );
  }

  if (stock.low_stock_count > 0) {
    addFlag(
      "warning",
      "Stock",
      "Low-stock items need attention",
      `${stock.low_stock_count} products are at or below low-stock threshold.`,
      "Prepare branch-specific reorder list.",
      5
    );
  }

  if (sales.total_discount > 0 && sales.total_sales > 0) {
    const discountRate = (sales.total_discount / sales.total_sales) * 100;

    if (discountRate >= 5) {
      addFlag(
        "warning",
        "Discounts",
        "Discount level needs review",
        `Discounts are ${percent(discountRate)}% of sales.`,
        "Review discount reasons and staff permissions.",
        6
      );
    }
  }

  if (expenses.total_expenses > 0 && sales.total_sales > 0) {
    const expenseRatio = (expenses.total_expenses / sales.total_sales) * 100;

    if (expenseRatio >= 35) {
      addFlag(
        "warning",
        "Expenses",
        "Expenses are high compared with sales",
        `Expenses are ${percent(expenseRatio)}% of sales for the selected period.`,
        "Review expense categories and remove avoidable costs.",
        7
      );
    }
  }

  if (purchases.balance > 0) {
    addFlag(
      "info",
      "Supplier Payables",
      "Supplier purchase balance exists",
      `Purchase balance is GHS ${purchases.balance}.`,
      "Track supplier payment commitments before spending cash.",
      3
    );
  }

  await addVoidingFlags(flags, { branchId, window });
  await addSalesAnomalyFlags(flags, { branchId, window });

  const totalImpact = flags.reduce((sum, flag) => sum + Number(flag.score_impact || 0), 0);
  const score = Math.max(100 - totalImpact, 0);
  const status =
    score >= DEFAULT_WARNING_THRESHOLD
      ? "healthy"
      : score >= DEFAULT_DANGER_THRESHOLD
      ? "needs_review"
      : "high_risk";

  return {
    audit_score: score,
    audit_status: status,
    flags,
  };
}

async function addVoidingFlags(flags, { branchId, window }) {
  if (!(await tableExists("sales"))) {
    return;
  }

  const columns = await getColumns("sales");
  const dateColumn = chooseColumn(columns, ["voided_at", "updated_at", "created_at", "sale_date"]);

  if (!dateColumn) {
    return;
  }

  const voidConditions = [];

  if (columns.includes("is_void")) {
    voidConditions.push("COALESCE(s.is_void, 0) = 1");
  }

  if (columns.includes("voided_at")) {
    voidConditions.push("s.voided_at IS NOT NULL");
  }

  if (columns.includes("sale_status")) {
    voidConditions.push("LOWER(COALESCE(s.sale_status, '')) IN ('void', 'voided', 'cancelled', 'canceled')");
  }

  if (columns.includes("status")) {
    voidConditions.push("LOWER(COALESCE(s.status, '')) IN ('void', 'voided', 'cancelled', 'canceled')");
  }

  if (voidConditions.length === 0) {
    return;
  }

  const branchFilter = buildBranchFilter(branchId, "s");
  const dateFilter = makeDateFilter(dateColumn, window, "s");
  const filters = combineFilters(branchFilter, dateFilter);

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS void_count
     FROM sales s
     WHERE (${voidConditions.join(" OR ")})
       ${filters.sql}`,
    filters.params
  );

  const voidCount = Number(rows[0]?.void_count || 0);

  if (voidCount > 0) {
    flags.push({
      severity: voidCount >= 3 ? "danger" : "warning",
      category: "Voids",
      title: "Voided/cancelled sales found",
      detail: `${voidCount} voided or cancelled sales were found in the selected period.`,
      recommended_action: "Manager should review who voided each sale, the reason, and whether stock/cash was corrected.",
      score_impact: voidCount >= 3 ? 12 : 6,
    });
  }
}

async function addSalesAnomalyFlags(flags, { branchId, window }) {
  if (!(await tableExists("sales"))) {
    return;
  }

  const columns = await getColumns("sales");
  const totalColumn = chooseColumn(columns, ["total", "grand_total"]);
  const paidColumn = chooseColumn(columns, ["amount_paid", "paid_amount"]);
  const balanceColumn = chooseColumn(columns, ["balance"]);
  const dateColumn = chooseColumn(columns, ["created_at", "sale_date", "date"]);

  if (!totalColumn || !paidColumn || !balanceColumn || !dateColumn) {
    return;
  }

  const branchFilter = buildBranchFilter(branchId, "s");
  const dateFilter = makeDateFilter(dateColumn, window, "s");
  const filters = combineFilters(branchFilter, dateFilter);
  const notVoided = saleNotVoidedSql(columns, "s");

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS mismatch_count
     FROM sales s
     WHERE ABS(COALESCE(s.\`${paidColumn}\`, 0) + COALESCE(s.\`${balanceColumn}\`, 0) - COALESCE(s.\`${totalColumn}\`, 0)) > 0.05
       ${filters.sql}
       ${notVoided}`,
    filters.params
  );

  const mismatchCount = Number(rows[0]?.mismatch_count || 0);

  if (mismatchCount > 0) {
    flags.push({
      severity: "danger",
      category: "Sales Data",
      title: "Sale payment math mismatch",
      detail: `${mismatchCount} sales have paid + balance that does not equal total.`,
      recommended_action: "Review sale records and fix data calculation before approving accounting period.",
      score_impact: 15,
    });
  }
}

function buildRecommendations({ sales, expenses, debts, stock, audit }) {
  const recommendations = [];

  function add(priority, title, action) {
    recommendations.push({ priority, title, action });
  }

  if (stock.low_stock_count > 0) {
    add("high", "Restock low-stock products", "Use the low-stock list per branch and contact suppliers before sales are lost.");
  }

  if (debts.total_debt_balance > 0) {
    add("high", "Create debt follow-up list", "Call customers with old balances first and record payments immediately.");
  }

  if (sales.transaction_count === 0) {
    add("medium", "No sales in selected period", "Confirm the selected branch and date range are correct.");
  }

  if (expenses.total_expenses > sales.total_sales && sales.total_sales > 0) {
    add("high", "Expenses exceed sales", "Review expenses, categories, and any exceptional payments.");
  }

  if (audit.audit_score < DEFAULT_WARNING_THRESHOLD) {
    add("high", "Do not approve period yet", "Resolve danger/warning audit flags before month-end signoff.");
  } else {
    add("medium", "Period can be reviewed", "Export reports and let manager/accountant review before approval.");
  }

  add("medium", "Improve true profit tracking", "Start capturing reliable cost price and purchase history for every product.");
  add("medium", "Build stock transfer control", "For two stores, stock movement should be requested, approved, dispatched, and received.");

  return recommendations;
}

async function buildAccountingIntelligence(req) {
  const branchId = getRequestedBranchId(req);
  const dateRange = normalizeDateRange(req.query);
  const window = createDateWindow(dateRange.startDate, dateRange.endDate);
  const days = daysBetween(dateRange.startDate, addDays(dateRange.endDate, 1));

  const [branchMeta, sales, expenses, debts, stock, purchases, branchComparison] =
    await Promise.all([
      getBranchMeta(branchId),
      getSalesSummary(branchId, window),
      getExpenseSummary(branchId, window),
      getDebtSummary(branchId, window),
      getStockSummary(branchId),
      getPurchaseSummary(branchId, window),
      isAllBranchRequest(req) ? getBranchComparison(window) : Promise.resolve([]),
    ]);

  const ledger = await buildLedger({ sales, expenses, debts, purchases });
  const profitAndLoss = buildProfitAndLoss({ sales, expenses, purchases });
  const audit = await buildAuditFlags({ branchId, window, sales, expenses, debts, stock, purchases });
  const recommendations = buildRecommendations({ sales, expenses, debts, stock, audit });

  return {
    scope: {
      ...branchMeta,
      mode: branchId ? "selected_branch" : "all_branches",
      start_date: dateRange.startDate,
      end_date: dateRange.endDate,
      days,
    },
    executive_summary: {
      audit_score: audit.audit_score,
      audit_status: audit.audit_status,
      total_sales: sales.total_sales,
      total_paid: sales.total_paid,
      total_balance: sales.total_balance,
      total_expenses: expenses.total_expenses,
      estimated_net_before_stock_cost: profitAndLoss.estimated_net_before_stock_cost,
      active_debt_count: debts.active_debt_count,
      total_debt_balance: debts.total_debt_balance,
      low_stock_count: stock.low_stock_count,
      negative_stock_count: stock.negative_stock_count,
    },
    sales,
    expenses,
    debts,
    stock,
    purchases,
    profit_and_loss: profitAndLoss,
    management_ledger: ledger,
    audit,
    branch_comparison: branchComparison,
    recommendations,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  buildAccountingIntelligence,
};
