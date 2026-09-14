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


async function getReturnSummary(branchId, window) {
  if (!(await tableExists("returns"))) {
    return {
      return_count: 0,
      total_return_quantity: 0,
      total_return_amount: 0,
      recent_returns: [],
    };
  }

  const columns = await getColumns("returns");
  const dateColumn = chooseColumn(columns, ["returned_at", "created_at", "return_date", "date"]);
  const quantityColumn = chooseColumn(columns, ["quantity", "return_quantity", "qty"]);
  const amountColumn = chooseColumn(columns, ["refund_amount", "total", "total_amount", "amount", "line_total"]);
  const reasonColumn = chooseColumn(columns, ["reason", "return_reason", "notes", "description"]);
  const productNameColumn = chooseColumn(columns, ["product_name", "item_name", "name"]);

  if (!dateColumn) {
    return {
      return_count: 0,
      total_return_quantity: 0,
      total_return_amount: 0,
      recent_returns: [],
    };
  }

  const branchFilter = buildBranchFilter(branchId, "r");
  const dateFilter = makeDateFilter(dateColumn, window, "r");
  const filters = combineFilters(branchFilter, dateFilter);

  const quantitySql = quantityColumn ? `COALESCE(SUM(r.\`${quantityColumn}\`), 0)` : "0";
  const amountSql = amountColumn ? `COALESCE(SUM(r.\`${amountColumn}\`), 0)` : "0";

  const [summaryRows] = await pool.query(
    `SELECT
       COUNT(*) AS return_count,
       ${quantitySql} AS total_return_quantity,
       ${amountSql} AS total_return_amount
     FROM returns r
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  const productSql = productNameColumn ? `r.\`${productNameColumn}\`` : "CONCAT('Return #', r.id)";
  const reasonSql = reasonColumn ? `r.\`${reasonColumn}\`` : "''";
  const amountSelect = amountColumn ? `r.\`${amountColumn}\`` : "0";
  const quantitySelect = quantityColumn ? `r.\`${quantityColumn}\`` : "0";

  const [recentRows] = await pool.query(
    `SELECT
       r.id,
       r.\`${dateColumn}\` AS return_date,
       ${productSql} AS product_name,
       ${quantitySelect} AS quantity,
       ${amountSelect} AS amount,
       ${reasonSql} AS reason
     FROM returns r
     WHERE 1=1 ${filters.sql}
     ORDER BY r.\`${dateColumn}\` DESC, r.id DESC
     LIMIT 10`,
    filters.params
  );

  return {
    return_count: Number(summaryRows[0]?.return_count || 0),
    total_return_quantity: money(summaryRows[0]?.total_return_quantity),
    total_return_amount: money(summaryRows[0]?.total_return_amount),
    recent_returns: recentRows.map((row) => ({
      id: row.id,
      return_date: row.return_date,
      product_name: row.product_name,
      quantity: money(row.quantity),
      amount: money(row.amount),
      reason: row.reason || "",
    })),
  };
}

async function getStockAdjustmentSummary(branchId, window) {
  if (!(await tableExists("stock_adjustments"))) {
    return emptyStockAdjustmentSummary();
  }

  const columns = await getColumns("stock_adjustments");
  const dateColumn = chooseColumn(columns, ["adjusted_at", "created_at", "updated_at"]);
  const quantityColumn = chooseColumn(columns, ["quantity", "adjustment_quantity", "qty"]);
  const typeColumn = chooseColumn(columns, ["adjustment_type", "type", "movement_type"]);
  const reasonColumn = chooseColumn(columns, ["reason", "notes", "description"]);
  const productIdColumn = chooseColumn(columns, ["product_id"]);

  if (!dateColumn) {
    return emptyStockAdjustmentSummary();
  }

  const branchFilter = buildBranchFilter(branchId, "sa");
  const dateFilter = makeDateFilter(dateColumn, window, "sa");
  const filters = combineFilters(branchFilter, dateFilter);
  const quantityExpr = quantityColumn ? `COALESCE(sa.\`${quantityColumn}\`, 0)` : "0";
  const typeExpr = typeColumn ? `LOWER(COALESCE(sa.\`${typeColumn}\`, 'unknown'))` : "'unknown'";

  const [summaryRows] = await pool.query(
    `SELECT
       COUNT(*) AS adjustment_count,
       COALESCE(SUM(${quantityExpr}), 0) AS total_adjustment_quantity,
       COALESCE(SUM(CASE WHEN ${typeExpr} = 'increase' THEN ${quantityExpr} ELSE 0 END), 0) AS increase_quantity,
       COALESCE(SUM(CASE WHEN ${typeExpr} = 'decrease' THEN ${quantityExpr} ELSE 0 END), 0) AS decrease_quantity,
       COUNT(CASE WHEN ${typeExpr} = 'increase' THEN 1 END) AS increase_count,
       COUNT(CASE WHEN ${typeExpr} = 'decrease' THEN 1 END) AS decrease_count,
       COUNT(CASE WHEN ${typeExpr} = 'set' THEN 1 END) AS set_count,
       COUNT(CASE WHEN LOWER(COALESCE(${reasonColumn ? `sa.\`${reasonColumn}\`` : "''"}, '')) LIKE '%damage%' THEN 1 END) AS damaged_count,
       COUNT(CASE WHEN LOWER(COALESCE(${reasonColumn ? `sa.\`${reasonColumn}\`` : "''"}, '')) LIKE '%lost%' THEN 1 END) AS lost_count,
       COUNT(CASE WHEN LOWER(COALESCE(${reasonColumn ? `sa.\`${reasonColumn}\`` : "''"}, '')) LIKE '%physical%' OR LOWER(COALESCE(${reasonColumn ? `sa.\`${reasonColumn}\`` : "''"}, '')) LIKE '%count%' THEN 1 END) AS physical_count_count
     FROM stock_adjustments sa
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  const joinProducts = productIdColumn && (await tableExists("products"));
  const productColumns = joinProducts ? await getColumns("products") : [];
  const productNameColumn = chooseColumn(productColumns, ["name", "product_name", "item_name"]);
  const productJoinSql = joinProducts ? "LEFT JOIN products p ON sa.product_id = p.id" : "";
  const productSelectSql = productNameColumn ? `p.\`${productNameColumn}\`` : "''";
  const reasonSelectSql = reasonColumn ? `sa.\`${reasonColumn}\`` : "''";
  const typeSelectSql = typeColumn ? `sa.\`${typeColumn}\`` : "'unknown'";
  const quantitySelectSql = quantityColumn ? `sa.\`${quantityColumn}\`` : "0";

  const [recentRows] = await pool.query(
    `SELECT
       sa.id,
       sa.\`${dateColumn}\` AS adjusted_at,
       ${productSelectSql} AS product_name,
       ${typeSelectSql} AS adjustment_type,
       ${quantitySelectSql} AS quantity,
       ${reasonSelectSql} AS reason
     FROM stock_adjustments sa
     ${productJoinSql}
     WHERE 1=1 ${filters.sql}
     ORDER BY sa.\`${dateColumn}\` DESC, sa.id DESC
     LIMIT 15`,
    filters.params
  );

  const row = summaryRows[0] || {};

  return {
    adjustment_count: Number(row.adjustment_count || 0),
    total_adjustment_quantity: money(row.total_adjustment_quantity),
    increase_count: Number(row.increase_count || 0),
    decrease_count: Number(row.decrease_count || 0),
    set_count: Number(row.set_count || 0),
    increase_quantity: money(row.increase_quantity),
    decrease_quantity: money(row.decrease_quantity),
    damaged_count: Number(row.damaged_count || 0),
    lost_count: Number(row.lost_count || 0),
    physical_count_count: Number(row.physical_count_count || 0),
    recent_adjustments: recentRows.map((recent) => ({
      id: recent.id,
      adjusted_at: recent.adjusted_at,
      product_name: recent.product_name || "",
      adjustment_type: recent.adjustment_type || "unknown",
      quantity: money(recent.quantity),
      reason: recent.reason || "",
    })),
  };
}

function emptyStockAdjustmentSummary() {
  return {
    adjustment_count: 0,
    total_adjustment_quantity: 0,
    increase_count: 0,
    decrease_count: 0,
    set_count: 0,
    increase_quantity: 0,
    decrease_quantity: 0,
    damaged_count: 0,
    lost_count: 0,
    physical_count_count: 0,
    recent_adjustments: [],
  };
}

async function getStockTransferSummary(branchId, window) {
  if (!(await tableExists("stock_transfers"))) {
    return emptyStockTransferSummary();
  }

  const columns = await getColumns("stock_transfers");
  const dateColumn = chooseColumn(columns, ["created_at", "requested_at", "updated_at"]);
  const statusColumn = chooseColumn(columns, ["status", "transfer_status"]);
  const fromBranchColumn = chooseColumn(columns, ["from_branch_id", "source_branch_id", "from_store_id"]);
  const toBranchColumn = chooseColumn(columns, ["to_branch_id", "destination_branch_id", "to_store_id"]);
  const transferNumberColumn = chooseColumn(columns, ["transfer_number", "reference", "reference_number"]);

  if (!dateColumn) {
    return emptyStockTransferSummary();
  }

  const dateFilter = makeDateFilter(dateColumn, window, "st");
  const branchSql = branchId && fromBranchColumn && toBranchColumn
    ? ` AND (st.\`${fromBranchColumn}\` = ? OR st.\`${toBranchColumn}\` = ?)`
    : branchId && fromBranchColumn
    ? ` AND st.\`${fromBranchColumn}\` = ?`
    : branchId && toBranchColumn
    ? ` AND st.\`${toBranchColumn}\` = ?`
    : "";
  const branchParams = branchId && fromBranchColumn && toBranchColumn
    ? [branchId, branchId]
    : branchId && (fromBranchColumn || toBranchColumn)
    ? [branchId]
    : [];
  const filters = combineFilters({ sql: branchSql, params: branchParams }, dateFilter);
  const statusExpr = statusColumn ? `LOWER(COALESCE(st.\`${statusColumn}\`, 'unknown'))` : "'unknown'";
  const outCase = branchId && fromBranchColumn ? `CASE WHEN st.\`${fromBranchColumn}\` = ? THEN 1 ELSE 0 END` : "0";
  const inCase = branchId && toBranchColumn ? `CASE WHEN st.\`${toBranchColumn}\` = ? THEN 1 ELSE 0 END` : "0";
  const directionParams = [
    ...(branchId && fromBranchColumn ? [branchId] : []),
    ...(branchId && toBranchColumn ? [branchId] : []),
  ];

  const [summaryRows] = await pool.query(
    `SELECT
       COUNT(*) AS transfer_count,
       COALESCE(SUM(${outCase}), 0) AS transfer_out_count,
       COALESCE(SUM(${inCase}), 0) AS transfer_in_count,
       COUNT(CASE WHEN ${statusExpr} IN ('requested', 'pending') THEN 1 END) AS requested_count,
       COUNT(CASE WHEN ${statusExpr} = 'approved' THEN 1 END) AS approved_count,
       COUNT(CASE WHEN ${statusExpr} = 'dispatched' THEN 1 END) AS dispatched_count,
       COUNT(CASE WHEN ${statusExpr} = 'received' THEN 1 END) AS received_count,
       COUNT(CASE WHEN ${statusExpr} = 'cancelled' THEN 1 END) AS cancelled_count,
       COUNT(CASE WHEN ${statusExpr} = 'rejected' THEN 1 END) AS rejected_count,
       COUNT(CASE WHEN ${statusExpr} = 'dispatched' THEN 1 END) AS dispatched_not_received_count
     FROM stock_transfers st
     WHERE 1=1 ${filters.sql}`,
    [...directionParams, ...filters.params]
  );

  const itemsSummary = await getStockTransferItemSummary({ branchId, window, transferColumns: columns, dateColumn, fromBranchColumn, toBranchColumn });
  const recentTransfers = await getRecentStockTransfers({ branchId, window, columns, dateColumn, fromBranchColumn, toBranchColumn, statusColumn, transferNumberColumn });
  const row = summaryRows[0] || {};

  return {
    transfer_count: Number(row.transfer_count || 0),
    transfer_out_count: Number(row.transfer_out_count || 0),
    transfer_in_count: Number(row.transfer_in_count || 0),
    requested_count: Number(row.requested_count || 0),
    approved_count: Number(row.approved_count || 0),
    dispatched_count: Number(row.dispatched_count || 0),
    received_count: Number(row.received_count || 0),
    cancelled_count: Number(row.cancelled_count || 0),
    rejected_count: Number(row.rejected_count || 0),
    dispatched_not_received_count: Number(row.dispatched_not_received_count || 0),
    ...itemsSummary,
    recent_transfers: recentTransfers,
  };
}

async function getStockTransferItemSummary({ branchId, window, transferColumns, dateColumn, fromBranchColumn, toBranchColumn }) {
  if (!(await tableExists("stock_transfer_items"))) {
    return {
      transfer_item_count: 0,
      total_requested_quantity: 0,
      total_dispatched_quantity: 0,
      total_received_quantity: 0,
      quantity_mismatch_count: 0,
    };
  }

  const itemColumns = await getColumns("stock_transfer_items");
  const transferIdColumn = chooseColumn(itemColumns, ["transfer_id", "stock_transfer_id"]);
  const requestedColumn = chooseColumn(itemColumns, ["requested_quantity", "quantity", "qty"]);
  const dispatchedColumn = chooseColumn(itemColumns, ["dispatched_quantity", "quantity_dispatched"]);
  const receivedColumn = chooseColumn(itemColumns, ["received_quantity", "quantity_received"]);

  if (!transferIdColumn) {
    return {
      transfer_item_count: 0,
      total_requested_quantity: 0,
      total_dispatched_quantity: 0,
      total_received_quantity: 0,
      quantity_mismatch_count: 0,
    };
  }

  const dateFilter = makeDateFilter(dateColumn, window, "st");
  const branchSql = branchId && fromBranchColumn && toBranchColumn
    ? ` AND (st.\`${fromBranchColumn}\` = ? OR st.\`${toBranchColumn}\` = ?)`
    : branchId && fromBranchColumn
    ? ` AND st.\`${fromBranchColumn}\` = ?`
    : branchId && toBranchColumn
    ? ` AND st.\`${toBranchColumn}\` = ?`
    : "";
  const branchParams = branchId && fromBranchColumn && toBranchColumn
    ? [branchId, branchId]
    : branchId && (fromBranchColumn || toBranchColumn)
    ? [branchId]
    : [];
  const filters = combineFilters({ sql: branchSql, params: branchParams }, dateFilter);
  const requestedSql = requestedColumn ? `COALESCE(SUM(sti.\`${requestedColumn}\`), 0)` : "0";
  const dispatchedSql = dispatchedColumn ? `COALESCE(SUM(sti.\`${dispatchedColumn}\`), 0)` : "0";
  const receivedSql = receivedColumn ? `COALESCE(SUM(sti.\`${receivedColumn}\`), 0)` : "0";
  const mismatchSql = dispatchedColumn && receivedColumn
    ? `COUNT(CASE WHEN COALESCE(sti.\`${dispatchedColumn}\`, 0) <> COALESCE(sti.\`${receivedColumn}\`, 0) THEN 1 END)`
    : "0";

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS transfer_item_count,
       ${requestedSql} AS total_requested_quantity,
       ${dispatchedSql} AS total_dispatched_quantity,
       ${receivedSql} AS total_received_quantity,
       ${mismatchSql} AS quantity_mismatch_count
     FROM stock_transfer_items sti
     INNER JOIN stock_transfers st ON sti.\`${transferIdColumn}\` = st.id
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  return {
    transfer_item_count: Number(rows[0]?.transfer_item_count || 0),
    total_requested_quantity: money(rows[0]?.total_requested_quantity),
    total_dispatched_quantity: money(rows[0]?.total_dispatched_quantity),
    total_received_quantity: money(rows[0]?.total_received_quantity),
    quantity_mismatch_count: Number(rows[0]?.quantity_mismatch_count || 0),
  };
}

async function getRecentStockTransfers({ branchId, window, columns, dateColumn, fromBranchColumn, toBranchColumn, statusColumn, transferNumberColumn }) {
  const dateFilter = makeDateFilter(dateColumn, window, "st");
  const branchSql = branchId && fromBranchColumn && toBranchColumn
    ? ` AND (st.\`${fromBranchColumn}\` = ? OR st.\`${toBranchColumn}\` = ?)`
    : branchId && fromBranchColumn
    ? ` AND st.\`${fromBranchColumn}\` = ?`
    : branchId && toBranchColumn
    ? ` AND st.\`${toBranchColumn}\` = ?`
    : "";
  const branchParams = branchId && fromBranchColumn && toBranchColumn
    ? [branchId, branchId]
    : branchId && (fromBranchColumn || toBranchColumn)
    ? [branchId]
    : [];
  const filters = combineFilters({ sql: branchSql, params: branchParams }, dateFilter);
  const referenceSql = transferNumberColumn ? `st.\`${transferNumberColumn}\`` : "CONCAT('Transfer #', st.id)";
  const statusSql = statusColumn ? `st.\`${statusColumn}\`` : "'unknown'";
  const fromSql = fromBranchColumn ? `st.\`${fromBranchColumn}\`` : "NULL";
  const toSql = toBranchColumn ? `st.\`${toBranchColumn}\`` : "NULL";

  const [rows] = await pool.query(
    `SELECT
       st.id,
       ${referenceSql} AS reference,
       ${statusSql} AS status,
       ${fromSql} AS from_branch_id,
       ${toSql} AS to_branch_id,
       st.\`${dateColumn}\` AS created_at
     FROM stock_transfers st
     WHERE 1=1 ${filters.sql}
     ORDER BY st.\`${dateColumn}\` DESC, st.id DESC
     LIMIT 15`,
    filters.params
  );

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    direction: branchId && Number(row.from_branch_id) === Number(branchId)
      ? "out"
      : branchId && Number(row.to_branch_id) === Number(branchId)
      ? "in"
      : "system",
    from_branch_id: row.from_branch_id,
    to_branch_id: row.to_branch_id,
    created_at: row.created_at,
  }));
}

function emptyStockTransferSummary() {
  return {
    transfer_count: 0,
    transfer_out_count: 0,
    transfer_in_count: 0,
    requested_count: 0,
    approved_count: 0,
    dispatched_count: 0,
    received_count: 0,
    cancelled_count: 0,
    rejected_count: 0,
    dispatched_not_received_count: 0,
    transfer_item_count: 0,
    total_requested_quantity: 0,
    total_dispatched_quantity: 0,
    total_received_quantity: 0,
    quantity_mismatch_count: 0,
    recent_transfers: [],
  };
}

async function getSmsSummary(branchId, window) {
  if (!(await tableExists("sms_log"))) {
    return {
      sms_count: 0,
      sent_count: 0,
      failed_count: 0,
      pending_count: 0,
      success_rate: 0,
      recent_failures: [],
    };
  }

  const columns = await getColumns("sms_log");
  const dateColumn = chooseColumn(columns, ["sent_at", "created_at", "updated_at"]);
  const statusColumn = chooseColumn(columns, ["status", "delivery_status"]);
  const typeColumn = chooseColumn(columns, ["sms_type", "type", "message_type"]);
  const phoneColumn = chooseColumn(columns, ["recipient_phone", "phone", "recipient", "to_phone"]);
  const errorColumn = chooseColumn(columns, ["error_message", "provider_response", "response_message", "details"]);

  if (!dateColumn) {
    return {
      sms_count: 0,
      sent_count: 0,
      failed_count: 0,
      pending_count: 0,
      success_rate: 0,
      recent_failures: [],
    };
  }

  const branchFilter = columns.includes("branch_id") ? buildBranchFilter(branchId, "sl") : { sql: "", params: [] };
  const dateFilter = makeDateFilter(dateColumn, window, "sl");
  const filters = combineFilters(branchFilter, dateFilter);
  const statusExpr = statusColumn ? `LOWER(COALESCE(sl.\`${statusColumn}\`, 'unknown'))` : "'unknown'";
  const typeExpr = typeColumn ? `COALESCE(sl.\`${typeColumn}\`, 'unknown')` : "'unknown'";

  const [summaryRows] = await pool.query(
    `SELECT
       COUNT(*) AS sms_count,
       COUNT(CASE WHEN ${statusExpr} IN ('sent', 'success', 'delivered') THEN 1 END) AS sent_count,
       COUNT(CASE WHEN ${statusExpr} IN ('failed', 'error', 'rejected') THEN 1 END) AS failed_count,
       COUNT(CASE WHEN ${statusExpr} IN ('pending', 'queued', 'processing') THEN 1 END) AS pending_count
     FROM sms_log sl
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  const [typeRows] = await pool.query(
    `SELECT ${typeExpr} AS sms_type, COUNT(*) AS count
     FROM sms_log sl
     WHERE 1=1 ${filters.sql}
     GROUP BY ${typeExpr}
     ORDER BY count DESC
     LIMIT 10`,
    filters.params
  );

  const phoneSql = phoneColumn ? `sl.\`${phoneColumn}\`` : "''";
  const errorSql = errorColumn ? `sl.\`${errorColumn}\`` : "''";
  const statusSql = statusColumn ? `sl.\`${statusColumn}\`` : "'unknown'";

  const [recentFailureRows] = await pool.query(
    `SELECT
       sl.id,
       ${phoneSql} AS recipient_phone,
       ${statusSql} AS status,
       ${typeExpr} AS sms_type,
       ${errorSql} AS error_message,
       sl.\`${dateColumn}\` AS sent_at
     FROM sms_log sl
     WHERE 1=1 ${filters.sql}
       AND ${statusExpr} IN ('failed', 'error', 'rejected')
     ORDER BY sl.\`${dateColumn}\` DESC, sl.id DESC
     LIMIT 10`,
    filters.params
  );

  const row = summaryRows[0] || {};
  const smsCount = Number(row.sms_count || 0);
  const sentCount = Number(row.sent_count || 0);

  return {
    sms_count: smsCount,
    sent_count: sentCount,
    failed_count: Number(row.failed_count || 0),
    pending_count: Number(row.pending_count || 0),
    success_rate: smsCount > 0 ? percent((sentCount / smsCount) * 100) : 0,
    by_type: typeRows.map((typeRow) => ({
      sms_type: typeRow.sms_type || "unknown",
      count: Number(typeRow.count || 0),
    })),
    recent_failures: recentFailureRows.map((failure) => ({
      id: failure.id,
      recipient_phone: failure.recipient_phone || "",
      status: failure.status || "unknown",
      sms_type: failure.sms_type || "unknown",
      error_message: failure.error_message || "",
      sent_at: failure.sent_at,
    })),
  };
}

async function getAuditControlSummary(branchId, window) {
  const unlockRequests = await getAuditUnlockSummary(branchId, window);
  const signoffs = await getAuditSignoffSummary(branchId, window);
  const reapprovals = await getAuditReapprovalSummary(branchId, window);

  return {
    unlock_requests: unlockRequests,
    signoffs,
    reapprovals,
  };
}

async function getAuditUnlockSummary(branchId, window) {
  if (!(await tableExists("audit_unlock_requests"))) {
    return {
      request_count: 0,
      pending_count: 0,
      approved_count: 0,
      rejected_count: 0,
      cancelled_count: 0,
    };
  }

  const columns = await getColumns("audit_unlock_requests");
  const dateColumn = chooseColumn(columns, ["created_at", "updated_at", "reviewed_at"]);

  if (!dateColumn) {
    return {
      request_count: 0,
      pending_count: 0,
      approved_count: 0,
      rejected_count: 0,
      cancelled_count: 0,
    };
  }

  const branchFilter = buildBranchFilter(branchId, "aur");
  const dateFilter = makeDateFilter(dateColumn, window, "aur");
  const filters = combineFilters(branchFilter, dateFilter);

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS request_count,
       COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count,
       COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved_count,
       COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected_count,
       COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_count
     FROM audit_unlock_requests aur
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  return {
    request_count: Number(rows[0]?.request_count || 0),
    pending_count: Number(rows[0]?.pending_count || 0),
    approved_count: Number(rows[0]?.approved_count || 0),
    rejected_count: Number(rows[0]?.rejected_count || 0),
    cancelled_count: Number(rows[0]?.cancelled_count || 0),
  };
}

async function getAuditSignoffSummary(branchId, window) {
  if (!(await tableExists("audit_signoffs"))) {
    return {
      signoff_count: 0,
      approved_count: 0,
      reviewed_count: 0,
      draft_count: 0,
      rejected_count: 0,
    };
  }

  const columns = await getColumns("audit_signoffs");
  const dateColumn = chooseColumn(columns, ["updated_at", "created_at", "review_date"]);

  if (!dateColumn) {
    return {
      signoff_count: 0,
      approved_count: 0,
      reviewed_count: 0,
      draft_count: 0,
      rejected_count: 0,
    };
  }

  const branchFilter = buildBranchFilter(branchId, "asf");
  const dateFilter = makeDateFilter(dateColumn, window, "asf");
  const filters = combineFilters(branchFilter, dateFilter);

  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS signoff_count,
       COUNT(CASE WHEN period_status = 'approved' THEN 1 END) AS approved_count,
       COUNT(CASE WHEN period_status = 'reviewed' THEN 1 END) AS reviewed_count,
       COUNT(CASE WHEN period_status = 'draft' THEN 1 END) AS draft_count,
       COUNT(CASE WHEN period_status = 'rejected' THEN 1 END) AS rejected_count
     FROM audit_signoffs asf
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  return {
    signoff_count: Number(rows[0]?.signoff_count || 0),
    approved_count: Number(rows[0]?.approved_count || 0),
    reviewed_count: Number(rows[0]?.reviewed_count || 0),
    draft_count: Number(rows[0]?.draft_count || 0),
    rejected_count: Number(rows[0]?.rejected_count || 0),
  };
}

async function getAuditReapprovalSummary(branchId, window) {
  if (!(await tableExists("audit_reapproval_log"))) {
    return {
      reapproval_count: 0,
    };
  }

  const columns = await getColumns("audit_reapproval_log");
  const dateColumn = chooseColumn(columns, ["reapproved_at", "created_at"]);

  if (!dateColumn) {
    return {
      reapproval_count: 0,
    };
  }

  const branchFilter = buildBranchFilter(branchId, "arl");
  const dateFilter = makeDateFilter(dateColumn, window, "arl");
  const filters = combineFilters(branchFilter, dateFilter);

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS reapproval_count
     FROM audit_reapproval_log arl
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  return {
    reapproval_count: Number(rows[0]?.reapproval_count || 0),
  };
}

async function getSystemControlSummary(branchId, window) {
  if (!(await tableExists("activity_log"))) {
    return {
      activity_count: 0,
      backup_download_count: 0,
      restore_count: 0,
      clear_business_data_count: 0,
      maintenance_count: 0,
      recent_sensitive_activity: [],
    };
  }

  const columns = await getColumns("activity_log");
  const dateColumn = chooseColumn(columns, ["created_at", "updated_at"]);
  const actionColumn = chooseColumn(columns, ["action", "activity_type", "type"]);
  const detailsColumn = chooseColumn(columns, ["details", "description", "message"]);

  if (!dateColumn || !actionColumn) {
    return {
      activity_count: 0,
      backup_download_count: 0,
      restore_count: 0,
      clear_business_data_count: 0,
      maintenance_count: 0,
      recent_sensitive_activity: [],
    };
  }

  const branchFilter = columns.includes("branch_id") ? buildBranchFilter(branchId, "al") : { sql: "", params: [] };
  const dateFilter = makeDateFilter(dateColumn, window, "al");
  const filters = combineFilters(branchFilter, dateFilter);
  const actionExpr = `UPPER(COALESCE(al.\`${actionColumn}\`, ''))`;
  const detailsSql = detailsColumn ? `al.\`${detailsColumn}\`` : "''";

  const [summaryRows] = await pool.query(
    `SELECT
       COUNT(*) AS activity_count,
       COUNT(CASE WHEN ${actionExpr} LIKE '%BACKUP%' OR ${actionExpr} = 'CREATE_BACKUP' THEN 1 END) AS backup_download_count,
       COUNT(CASE WHEN ${actionExpr} LIKE '%RESTORE%' THEN 1 END) AS restore_count,
       COUNT(CASE WHEN ${actionExpr} LIKE '%CLEAR_BUSINESS_DATA%' OR ${actionExpr} LIKE '%CLEAR%' THEN 1 END) AS clear_business_data_count,
       COUNT(CASE WHEN ${actionExpr} LIKE '%MAINTENANCE%' THEN 1 END) AS maintenance_count
     FROM activity_log al
     WHERE 1=1 ${filters.sql}`,
    filters.params
  );

  const [recentRows] = await pool.query(
    `SELECT
       al.id,
       al.\`${actionColumn}\` AS action,
       ${detailsSql} AS details,
       al.\`${dateColumn}\` AS created_at
     FROM activity_log al
     WHERE 1=1 ${filters.sql}
       AND (
        ${actionExpr} LIKE '%BACKUP%'
        OR ${actionExpr} LIKE '%RESTORE%'
        OR ${actionExpr} LIKE '%CLEAR%'
        OR ${actionExpr} LIKE '%AUDIT%'
        OR ${actionExpr} LIKE '%UNLOCK%'
       )
     ORDER BY al.\`${dateColumn}\` DESC, al.id DESC
     LIMIT 15`,
    filters.params
  );

  const row = summaryRows[0] || {};

  return {
    activity_count: Number(row.activity_count || 0),
    backup_download_count: Number(row.backup_download_count || 0),
    restore_count: Number(row.restore_count || 0),
    clear_business_data_count: Number(row.clear_business_data_count || 0),
    maintenance_count: Number(row.maintenance_count || 0),
    recent_sensitive_activity: recentRows.map((activity) => ({
      id: activity.id,
      action: activity.action,
      details: activity.details || "",
      created_at: activity.created_at,
    })),
  };
}

function buildReviewSummary({ sales, expenses, debts, stock, purchases, returns, stockAdjustments, stockTransfers, sms, auditControls, systemControls }) {
  const checklist = [
    {
      key: "sales",
      label: "Sales and receipt records",
      status: sales.transaction_count > 0 ? "review" : "empty",
      count: sales.transaction_count,
      note: `${sales.transaction_count} sale(s), total GHS ${sales.total_sales}.`,
    },
    {
      key: "debts",
      label: "Customer debt and payment records",
      status: debts.total_debt_balance > 0 ? "review" : "clean",
      count: debts.active_debt_count,
      note: `Outstanding debt GHS ${debts.total_debt_balance}. Payments this period GHS ${debts.debt_payments}.`,
    },
    {
      key: "expenses",
      label: "Expenses",
      status: expenses.expense_count > 0 ? "review" : "empty",
      count: expenses.expense_count,
      note: `Expenses total GHS ${expenses.total_expenses}.`,
    },
    {
      key: "purchases",
      label: "Purchases and suppliers",
      status: purchases.purchase_count > 0 ? "review" : "empty",
      count: purchases.purchase_count,
      note: `Purchase total GHS ${purchases.total_purchases}. Balance GHS ${purchases.balance}.`,
    },
    {
      key: "returns",
      label: "Returns",
      status: returns.return_count > 0 ? "review" : "clean",
      count: returns.return_count,
      note: `${returns.return_count} return(s), quantity ${returns.total_return_quantity}.`,
    },
    {
      key: "stock_adjustments",
      label: "Stock adjustments",
      status: stockAdjustments.adjustment_count > 0 ? "review" : "clean",
      count: stockAdjustments.adjustment_count,
      note: `${stockAdjustments.adjustment_count} adjustment(s), decreases ${stockAdjustments.decrease_count}, sets ${stockAdjustments.set_count}.`,
    },
    {
      key: "stock_transfers",
      label: "Stock transfers",
      status: stockTransfers.dispatched_not_received_count > 0 || stockTransfers.quantity_mismatch_count > 0 ? "warning" : "review",
      count: stockTransfers.transfer_count,
      note: `${stockTransfers.transfer_count} transfer(s), ${stockTransfers.dispatched_not_received_count} dispatched not received, ${stockTransfers.quantity_mismatch_count} mismatch item(s).`,
    },
    {
      key: "sms",
      label: "SMS records",
      status: sms.failed_count > 0 ? "warning" : "clean",
      count: sms.sms_count,
      note: `${sms.sent_count} sent, ${sms.failed_count} failed, success rate ${sms.success_rate}%.`,
    },
    {
      key: "audit_unlocks",
      label: "Audit unlock requests",
      status: auditControls.unlock_requests.pending_count > 0 ? "warning" : "clean",
      count: auditControls.unlock_requests.request_count,
      note: `${auditControls.unlock_requests.pending_count} pending unlock request(s).`,
    },
    {
      key: "system_controls",
      label: "Backup, restore and maintenance activity",
      status: systemControls.restore_count > 0 || systemControls.clear_business_data_count > 0 ? "danger" : "review",
      count: systemControls.activity_count,
      note: `${systemControls.backup_download_count} backup activity, ${systemControls.restore_count} restore, ${systemControls.clear_business_data_count} clear-data event(s).`,
    },
  ];

  return {
    checklist,
    stock_movement_ledger_note:
      "The Stock Movement Ledger has no separate table. It is rebuilt from sales, purchases, returns, stock adjustments and stock transfers. Reviewing those source records protects the ledger.",
    needs_attention_count: checklist.filter((item) => ["warning", "danger", "review"].includes(item.status)).length,
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

async function buildLedger({ sales, expenses, debts, purchases, returns, stockAdjustments, stockTransfers }) {
  const cashBankMomo = money(sales.total_paid + debts.debt_payments);
  const receivablesIncrease = money(sales.total_balance + debts.new_debt_amount);
  const receivablesDecrease = money(debts.debt_payments);
  const salesRevenue = money(sales.total_sales);
  const expensesTotal = money(expenses.total_expenses);
  const purchasesTotal = money(purchases.total_purchases);
  const returnsSignal = money(returns.total_return_amount || 0);
  const stockAdjustmentDecreaseSignal = money(stockAdjustments.decrease_quantity || 0);
  const transferOutQuantity = money(stockTransfers.total_dispatched_quantity || 0);
  const transferInQuantity = money(stockTransfers.total_received_quantity || 0);

  const ledgerRows = [
    {
      account_code: "1000",
      account_name: "Cash / MoMo / Bank",
      account_type: "Asset",
      debit: cashBankMomo,
      credit: money(expensesTotal + purchases.amount_paid + returnsSignal),
      explanation: "Money collected from sales and debt payments, reduced by expenses, paid purchases and return/refund signals.",
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
      credit: stockAdjustmentDecreaseSignal,
      explanation: "Purchases increase stock value. Decrease adjustments signal damaged/lost/shrinkage stock until exact COGS rules are finalized.",
    },
    {
      account_code: "1250",
      account_name: "Stock Transfers In / Out",
      account_type: "Inventory Control",
      debit: transferInQuantity,
      credit: transferOutQuantity,
      explanation: "Stock transfers move quantity between stores. They should normally balance at all-store level but must be reviewed per branch.",
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
      account_code: "4100",
      account_name: "Returns / Refund Signals",
      account_type: "Contra-Income / Review",
      debit: returnsSignal,
      credit: 0,
      explanation: "Returns should be reviewed against original sale and stock correction.",
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
      "This is a management ledger, not a certified statutory ledger. It now includes stock adjustments, returns and stock transfer quantity signals. True statutory accounting should later add cost history, COGS rules and accountant-reviewed journal rules.",
  };
}

function buildProfitAndLoss({ sales, expenses, purchases, returns }) {
  const grossSales = money(sales.total_sales);
  const discounts = money(sales.total_discount);
  const returnsAndRefunds = money(returns.total_return_amount || 0);
  const netSales = money(grossSales - discounts - returnsAndRefunds);
  const operatingExpenses = money(expenses.total_expenses);
  const purchasesAsCostSignal = money(purchases.total_purchases);
  const estimatedNetBeforeStockCost = money(netSales - operatingExpenses);
  const conservativeCashPosition = money(
    sales.total_paid - returnsAndRefunds - operatingExpenses - purchases.amount_paid
  );

  return {
    gross_sales: grossSales,
    discounts,
    returns_and_refunds: returnsAndRefunds,
    net_sales: netSales,
    operating_expenses: operatingExpenses,
    purchases_cost_signal: purchasesAsCostSignal,
    estimated_net_before_stock_cost: estimatedNetBeforeStockCost,
    conservative_cash_position: conservativeCashPosition,
    warning:
      "True profit requires reliable cost of goods sold. This report gives a strong management estimate and highlights what data must improve next.",
  };
}

async function buildAuditFlags({
  branchId,
  window,
  sales,
  expenses,
  debts,
  stock,
  purchases,
  returns,
  stockAdjustments,
  stockTransfers,
  sms,
  auditControls,
  systemControls,
}) {
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
      "Investigate wrong sales, stock adjustments, transfers or missing purchases immediately.",
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

  if (stockAdjustments.adjustment_count > 0) {
    addFlag(
      stockAdjustments.decrease_count > 0 || stockAdjustments.set_count > 0 ? "warning" : "info",
      "Stock Adjustments",
      "Manual stock adjustments recorded",
      `${stockAdjustments.adjustment_count} stock adjustment(s) were recorded. Decrease: ${stockAdjustments.decrease_count}, Set exact: ${stockAdjustments.set_count}.`,
      "Review reasons such as damaged, lost, physical count or wrong entry before approving the period.",
      stockAdjustments.decrease_count > 0 || stockAdjustments.set_count > 0 ? 7 : 3
    );
  }

  if (stockAdjustments.damaged_count > 0 || stockAdjustments.lost_count > 0) {
    addFlag(
      "danger",
      "Stock Loss",
      "Damaged or lost stock records detected",
      `${stockAdjustments.damaged_count} damaged and ${stockAdjustments.lost_count} lost stock adjustment record(s) were found.`,
      "Manager should investigate damaged/lost stock and compare with physical items.",
      10
    );
  }

  if (stockTransfers.dispatched_not_received_count > 0) {
    addFlag(
      "warning",
      "Stock Transfers",
      "Transfers dispatched but not received",
      `${stockTransfers.dispatched_not_received_count} stock transfer(s) were dispatched but not received in the selected period.`,
      "Follow up the destination store and complete receive action or cancel/reject properly.",
      8
    );
  }

  if (stockTransfers.quantity_mismatch_count > 0) {
    addFlag(
      "danger",
      "Stock Transfers",
      "Transfer quantity mismatch detected",
      `${stockTransfers.quantity_mismatch_count} stock transfer item(s) have dispatched and received quantity mismatch.`,
      "Compare transfer notes with physical stock before signoff.",
      12
    );
  }

  if (sms.failed_count > 0) {
    addFlag(
      sms.failed_count >= 5 ? "warning" : "info",
      "SMS",
      "Failed SMS records found",
      `${sms.failed_count} SMS message(s) failed in the selected period.`,
      "Open SMS Center, review provider response, fix phone/sender/provider issue and retry important messages.",
      sms.failed_count >= 5 ? 5 : 2
    );
  }

  if (auditControls.unlock_requests.pending_count > 0) {
    addFlag(
      "warning",
      "Audit Unlock",
      "Pending audit unlock request exists",
      `${auditControls.unlock_requests.pending_count} unlock request(s) are waiting for review.`,
      "Admin/manager must approve or reject before final accounting signoff.",
      8
    );
  }

  if (auditControls.reapprovals.reapproval_count > 0) {
    addFlag(
      "info",
      "Audit Reapproval",
      "Reapproval activity found",
      `${auditControls.reapprovals.reapproval_count} reapproval log record(s) exist in the selected period.`,
      "Review what changed after the period was unlocked and reapproved.",
      3
    );
  }

  if (systemControls.restore_count > 0) {
    addFlag(
      "danger",
      "Backup / Restore",
      "Restore activity detected",
      `${systemControls.restore_count} restore action(s) were logged in the selected period.`,
      "Confirm management approved the restore and that current data is correct.",
      15
    );
  }

  if (systemControls.clear_business_data_count > 0) {
    addFlag(
      "danger",
      "Maintenance",
      "Clear business data activity detected",
      `${systemControls.clear_business_data_count} clear-data event(s) were logged in the selected period.`,
      "Verify this happened only before real operation or with full management approval and backup.",
      20
    );
  }

  if (systemControls.backup_download_count === 0) {
    addFlag(
      "info",
      "Backup",
      "No backup activity found in selected period",
      "No backup download/activity was found in activity log for the selected period.",
      "Create a backup before major updates, before migrations and before month-end close.",
      2
    );
  }

  if (returns.return_count > 0) {
    addFlag(
      returns.return_count >= 3 ? "warning" : "info",
      "Returns",
      "Return records found",
      `${returns.return_count} return(s) were recorded in the selected period.`,
      "Review return reasons, original receipts and whether stock was corrected correctly.",
      returns.return_count >= 3 ? 5 : 2
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

function buildRecommendations({ sales, expenses, debts, stock, audit, sms, stockAdjustments, stockTransfers, auditControls, systemControls }) {
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

  if (stockTransfers.dispatched_not_received_count > 0 || stockTransfers.quantity_mismatch_count > 0) {
    add("high", "Complete stock transfer review", "Resolve dispatched-but-not-received transfers and quantity mismatches before approving the period.");
  }

  if (stockAdjustments.decrease_count > 0 || stockAdjustments.set_count > 0) {
    add("high", "Review manual stock corrections", "Check all stock decrease/set adjustments and confirm reasons such as damaged, lost, physical count or wrong entry.");
  }

  if (sms.failed_count > 0) {
    add("medium", "Review failed SMS", "Open SMS Center, read provider errors and retry important failed messages.");
  }

  if (auditControls.unlock_requests.pending_count > 0) {
    add("high", "Review pending audit unlock requests", "Approve or reject pending unlock requests before final signoff.");
  }

  if (systemControls.restore_count > 0 || systemControls.clear_business_data_count > 0) {
    add("high", "Verify sensitive system maintenance activity", "Confirm restore/clear-data events were authorized and backed up before trusting the period.");
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

  add("medium", "Protect backup files", "Downloaded backups contain users, password hashes and all store records. Keep them private.");
  add("medium", "Use Stock Movement Ledger for investigations", "The ledger is rebuilt from sales, purchases, returns, stock adjustments and stock transfers; investigate those source records when stock does not balance.");
  add("medium", "Improve true profit tracking", "Start capturing reliable cost price and purchase history for every product.");

  return recommendations;
}

async function buildAccountingIntelligence(req) {
  const branchId = getRequestedBranchId(req);
  const dateRange = normalizeDateRange(req.query);
  const window = createDateWindow(dateRange.startDate, dateRange.endDate);
  const days = daysBetween(dateRange.startDate, addDays(dateRange.endDate, 1));

  const [
    branchMeta,
    sales,
    expenses,
    debts,
    stockBase,
    purchases,
    returns,
    stockAdjustments,
    stockTransfers,
    sms,
    auditControls,
    systemControls,
    branchComparison,
  ] = await Promise.all([
    getBranchMeta(branchId),
    getSalesSummary(branchId, window),
    getExpenseSummary(branchId, window),
    getDebtSummary(branchId, window),
    getStockSummary(branchId),
    getPurchaseSummary(branchId, window),
    getReturnSummary(branchId, window),
    getStockAdjustmentSummary(branchId, window),
    getStockTransferSummary(branchId, window),
    getSmsSummary(branchId, window),
    getAuditControlSummary(branchId, window),
    getSystemControlSummary(branchId, window),
    isAllBranchRequest(req) ? getBranchComparison(window) : Promise.resolve([]),
  ]);

  const stock = {
    ...stockBase,
    stock_adjustments: stockAdjustments,
    stock_transfers: stockTransfers,
    stock_movement_ledger_note:
      "Stock Movement Ledger has no separate table. It is rebuilt from sales, purchases, returns, stock adjustments and stock transfers.",
  };

  const ledger = await buildLedger({
    sales,
    expenses,
    debts,
    purchases,
    returns,
    stockAdjustments,
    stockTransfers,
  });

  const profitAndLoss = buildProfitAndLoss({ sales, expenses, purchases, returns });

  const audit = await buildAuditFlags({
    branchId,
    window,
    sales,
    expenses,
    debts,
    stock,
    purchases,
    returns,
    stockAdjustments,
    stockTransfers,
    sms,
    auditControls,
    systemControls,
  });

  const reviewSummary = buildReviewSummary({
    sales,
    expenses,
    debts,
    stock,
    purchases,
    returns,
    stockAdjustments,
    stockTransfers,
    sms,
    auditControls,
    systemControls,
  });

  const recommendations = buildRecommendations({
    sales,
    expenses,
    debts,
    stock,
    audit,
    sms,
    stockAdjustments,
    stockTransfers,
    auditControls,
    systemControls,
  });

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
      total_refunds: returns.total_return_amount,
      net_sales_after_returns: profitAndLoss.net_sales,
      total_expenses: expenses.total_expenses,
      estimated_net_before_stock_cost: profitAndLoss.estimated_net_before_stock_cost,
      active_debt_count: debts.active_debt_count,
      total_debt_balance: debts.total_debt_balance,
      low_stock_count: stock.low_stock_count,
      negative_stock_count: stock.negative_stock_count,
      stock_adjustment_count: stockAdjustments.adjustment_count,
      stock_transfer_count: stockTransfers.transfer_count,
      failed_sms_count: sms.failed_count,
      pending_unlock_request_count: auditControls.unlock_requests.pending_count,
      sensitive_system_event_count: systemControls.restore_count + systemControls.clear_business_data_count,
    },
    sales,
    expenses,
    debts,
    stock,
    purchases,
    returns,
    stock_adjustments: stockAdjustments,
    stock_transfers: stockTransfers,
    sms,
    audit_controls: auditControls,
    system_controls: systemControls,
    review_summary: reviewSummary,
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
