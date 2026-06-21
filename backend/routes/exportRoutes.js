const express = require("express");
const ExcelJS = require("exceljs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function formatDateTime(value) {
  if (!value) return "";

  return new Date(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return "";

  return new Date(value).toLocaleDateString();
}

function buildDateFilter(alias, dateColumn, from, to, params) {
  let filter = "";

  if (from) {
    filter += ` AND DATE(${alias}.${dateColumn}) >= ?`;
    params.push(from);
  }

  if (to) {
    filter += ` AND DATE(${alias}.${dateColumn}) <= ?`;
    params.push(to);
  }

  return filter;
}

function isVoidedSale(sale) {
  return Number(sale.is_voided || 0) === 1 || sale.sale_status === "cancelled";
}

function styleWorksheet(worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  worksheet.getRow(1).font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };

  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF071529" },
  };

  worksheet.getRow(1).alignment = {
    vertical: "middle",
    horizontal: "center",
  };

  worksheet.columns.forEach((column) => {
    let maxLength = 12;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value ? String(cell.value) : "";
      maxLength = Math.max(maxLength, value.length + 2);
    });

    column.width = Math.min(maxLength, 45);
  });
}

async function sendWorkbook(res, workbook, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
}

// GET /api/exports/products
router.get(
  "/products",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const [products] = await pool.query(
        `SELECT
          id,
          name,
          size,
          category,
          cost_price,
          selling_price,
          quantity,
          low_stock_threshold,
          barcode,
          is_active,
          created_at
         FROM products
         ORDER BY name ASC`
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Products");

      worksheet.columns = [
        { header: "ID", key: "id" },
        { header: "Product Name", key: "name" },
        { header: "Size", key: "size" },
        { header: "Category", key: "category" },
        { header: "Cost Price", key: "cost_price" },
        { header: "Selling Price", key: "selling_price" },
        { header: "Quantity", key: "quantity" },
        { header: "Low Stock Level", key: "low_stock_threshold" },
        { header: "Barcode", key: "barcode" },
        { header: "Status", key: "status" },
        { header: "Created At", key: "created_at" },
      ];

      products.forEach((product) => {
        worksheet.addRow({
          id: product.id,
          name: product.name,
          size: product.size || "",
          category: product.category || "",
          cost_price: Number(product.cost_price || 0),
          selling_price: Number(product.selling_price || 0),
          quantity: Number(product.quantity || 0),
          low_stock_threshold: Number(product.low_stock_threshold || 0),
          barcode: product.barcode || "",
          status: product.is_active ? "Active" : "Inactive",
          created_at: formatDateTime(product.created_at),
        });
      });

      styleWorksheet(worksheet);

      return sendWorkbook(res, workbook, "chalin03-products.xlsx");
    } catch (error) {
      console.error("Export products error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting products.",
      });
    }
  }
);

// GET /api/exports/low-stock
router.get(
  "/low-stock",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const [products] = await pool.query(
        `SELECT
          id,
          name,
          size,
          category,
          cost_price,
          selling_price,
          quantity,
          low_stock_threshold,
          barcode,
          CASE
            WHEN quantity = 0 THEN 'out_of_stock'
            WHEN quantity <= low_stock_threshold THEN 'low_stock'
            ELSE 'ok'
          END AS stock_status,
          GREATEST((low_stock_threshold * 2) - quantity, 0) AS suggested_restock_quantity,
          GREATEST((low_stock_threshold * 2) - quantity, 0) * cost_price AS estimated_restock_cost
         FROM products
         WHERE is_active = TRUE
         AND quantity <= low_stock_threshold
         ORDER BY quantity ASC, name ASC`
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Low Stock / Restock List");

      worksheet.columns = [
        { header: "Product Name", key: "name" },
        { header: "Size", key: "size" },
        { header: "Category", key: "category" },
        { header: "Current Quantity", key: "quantity" },
        { header: "Low Stock Level", key: "low_stock_threshold" },
        { header: "Stock Status", key: "stock_status" },
        { header: "Suggested Buy Quantity", key: "suggested_restock_quantity" },
        { header: "Cost Price", key: "cost_price" },
        { header: "Selling Price", key: "selling_price" },
        { header: "Estimated Restock Cost", key: "estimated_restock_cost" },
        { header: "Barcode", key: "barcode" },
      ];

      products.forEach((product) => {
        worksheet.addRow({
          name: product.name || "",
          size: product.size || "",
          category: product.category || "",
          quantity: Number(product.quantity || 0),
          low_stock_threshold: Number(product.low_stock_threshold || 0),
          stock_status:
            product.stock_status === "out_of_stock"
              ? "Out of Stock"
              : product.stock_status === "low_stock"
              ? "Low Stock"
              : "OK",
          suggested_restock_quantity: Number(
            product.suggested_restock_quantity || 0
          ),
          cost_price: Number(product.cost_price || 0),
          selling_price: Number(product.selling_price || 0),
          estimated_restock_cost: Number(product.estimated_restock_cost || 0),
          barcode: product.barcode || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Restock Summary");

      const outOfStockItems = products.filter(
        (product) => Number(product.quantity || 0) === 0
      );

      const lowStockItems = products.filter(
        (product) => Number(product.quantity || 0) > 0
      );

      const totalSuggestedQuantity = products.reduce(
        (sum, product) =>
          sum + Number(product.suggested_restock_quantity || 0),
        0
      );

      const totalEstimatedRestockCost = products.reduce(
        (sum, product) => sum + Number(product.estimated_restock_cost || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Total low stock items",
        value: products.length,
      });

      summaryWorksheet.addRow({
        metric: "Out of stock items",
        value: outOfStockItems.length,
      });

      summaryWorksheet.addRow({
        metric: "Low stock items",
        value: lowStockItems.length,
      });

      summaryWorksheet.addRow({
        metric: "Total suggested buy quantity",
        value: totalSuggestedQuantity,
      });

      summaryWorksheet.addRow({
        metric: "Estimated restock cost",
        value: Number(totalEstimatedRestockCost.toFixed(2)),
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendWorkbook(res, workbook, "chalin03-low-stock-restock.xlsx");
    } catch (error) {
      console.error("Export low stock error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting low stock products.",
      });
    }
  }
);

// GET /api/exports/stock-adjustments
router.get(
  "/stock-adjustments",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const params = [];
      const dateFilter = buildDateFilter("sa", "adjusted_at", from, to, params);

      const [adjustments] = await pool.query(
        `SELECT
          sa.id,
          sa.adjustment_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.adjusted_at,
          p.name AS product_name,
          p.category AS product_category,
          p.size AS product_size,
          u.full_name AS adjusted_by_name
         FROM stock_adjustments sa
         INNER JOIN products p ON sa.product_id = p.id
         LEFT JOIN users u ON sa.adjusted_by = u.id
         WHERE 1 = 1
         ${dateFilter}
         ORDER BY sa.adjusted_at DESC, sa.id DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Stock Adjustments");

      worksheet.columns = [
        { header: "Date", key: "adjusted_at" },
        { header: "Product", key: "product_name" },
        { header: "Size", key: "product_size" },
        { header: "Category", key: "product_category" },
        { header: "Adjustment Type", key: "adjustment_type" },
        { header: "Adjustment Quantity", key: "quantity" },
        { header: "Old Quantity", key: "old_quantity" },
        { header: "New Quantity", key: "new_quantity" },
        { header: "Reason", key: "reason" },
        { header: "Adjusted By", key: "adjusted_by_name" },
      ];

      adjustments.forEach((adjustment) => {
        worksheet.addRow({
          adjusted_at: formatDateTime(adjustment.adjusted_at),
          product_name: adjustment.product_name || "",
          product_size: adjustment.product_size || "",
          product_category: adjustment.product_category || "",
          adjustment_type: adjustment.adjustment_type || "",
          quantity: Number(adjustment.quantity || 0),
          old_quantity: Number(adjustment.old_quantity || 0),
          new_quantity: Number(adjustment.new_quantity || 0),
          reason: adjustment.reason || "",
          adjusted_by_name: adjustment.adjusted_by_name || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Adjustment Summary");

      const increases = adjustments.filter(
        (item) => item.adjustment_type === "increase"
      );

      const decreases = adjustments.filter(
        (item) => item.adjustment_type === "decrease"
      );

      const setAdjustments = adjustments.filter(
        (item) => item.adjustment_type === "set"
      );

      const totalIncreaseQuantity = increases.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
      );

      const totalDecreaseQuantity = decreases.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Adjustments exported",
        value: adjustments.length,
      });

      summaryWorksheet.addRow({
        metric: "Increase adjustments",
        value: increases.length,
      });

      summaryWorksheet.addRow({
        metric: "Total quantity increased",
        value: totalIncreaseQuantity,
      });

      summaryWorksheet.addRow({
        metric: "Decrease adjustments",
        value: decreases.length,
      });

      summaryWorksheet.addRow({
        metric: "Total quantity decreased",
        value: totalDecreaseQuantity,
      });

      summaryWorksheet.addRow({
        metric: "Set stock adjustments",
        value: setAdjustments.length,
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendWorkbook(res, workbook, "chalin03-stock-adjustments.xlsx");
    } catch (error) {
      console.error("Export stock adjustments error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting stock adjustments.",
      });
    }
  }
);

// GET /api/exports/debt-payments
router.get(
  "/debt-payments",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const params = [];
      const dateFilter = buildDateFilter("dp", "paid_at", from, to, params);

      const [payments] = await pool.query(
        `SELECT
          dp.id,
          dp.debt_id,
          dp.amount,
          dp.payment_method,
          dp.paid_at,
          dp.notes,
          d.customer_name,
          d.customer_phone,
          d.amount_owed,
          d.amount_paid,
          d.balance,
          d.status,
          s.receipt_number,
          u.full_name AS received_by_name
         FROM debt_payments dp
         INNER JOIN debts d ON dp.debt_id = d.id
         LEFT JOIN sales s ON d.sale_id = s.id
         LEFT JOIN users u ON dp.received_by = u.id
         WHERE 1 = 1
         ${dateFilter}
         ORDER BY dp.paid_at DESC, dp.id DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Debt Payments");

      worksheet.columns = [
        { header: "Payment Date", key: "paid_at" },
        { header: "Payment ID", key: "id" },
        { header: "Debt ID", key: "debt_id" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount Paid", key: "amount" },
        { header: "Payment Method", key: "payment_method" },
        { header: "Received By", key: "received_by_name" },
        { header: "Total Debt", key: "amount_owed" },
        { header: "Debt Total Paid", key: "amount_paid" },
        { header: "Remaining Balance", key: "balance" },
        { header: "Debt Status", key: "status" },
        { header: "Notes", key: "notes" },
      ];

      payments.forEach((payment) => {
        worksheet.addRow({
          paid_at: formatDateTime(payment.paid_at),
          id: payment.id,
          debt_id: payment.debt_id,
          receipt_number: payment.receipt_number || "",
          customer_name: payment.customer_name || "",
          customer_phone: payment.customer_phone || "",
          amount: Number(payment.amount || 0),
          payment_method: payment.payment_method || "",
          received_by_name: payment.received_by_name || "",
          amount_owed: Number(payment.amount_owed || 0),
          amount_paid: Number(payment.amount_paid || 0),
          balance: Number(payment.balance || 0),
          status: payment.status || "",
          notes: payment.notes || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Debt Payment Summary");

      const totalPayments = payments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      const cashTotal = payments
        .filter((payment) => payment.payment_method === "cash")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      const momoTotal = payments
        .filter((payment) => payment.payment_method === "momo")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      const bankTotal = payments
        .filter((payment) => payment.payment_method === "bank")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Payments exported",
        value: payments.length,
      });

      summaryWorksheet.addRow({
        metric: "Total amount received",
        value: totalPayments,
      });

      summaryWorksheet.addRow({
        metric: "Cash total",
        value: cashTotal,
      });

      summaryWorksheet.addRow({
        metric: "MoMo total",
        value: momoTotal,
      });

      summaryWorksheet.addRow({
        metric: "Bank total",
        value: bankTotal,
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendWorkbook(res, workbook, "chalin03-debt-payments.xlsx");
    } catch (error) {
      console.error("Export debt payments error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting debt payments.",
      });
    }
  }
);



// GET /api/exports/daily-closings
router.get(
  "/daily-closings",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const params = [];
      const dateFilter = buildDateFilter("dc", "closing_date", from, to, params);

      const [closings] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         WHERE 1 = 1
         ${dateFilter}
         ORDER BY dc.closing_date DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Daily Closings");

      worksheet.columns = [
        { header: "Closing Date", key: "closing_date" },
        { header: "Sales Count", key: "sales_count" },
        { header: "Sales Total", key: "sales_total" },
        { header: "Sales Received", key: "sales_received" },

        { header: "Cash Sales", key: "cash_sales" },
        { header: "MoMo Sales", key: "momo_sales" },
        { header: "Bank Sales", key: "bank_sales" },
        { header: "Mixed Sales", key: "mixed_sales" },
        { header: "Credit Sales Total", key: "credit_sales_total" },
        { header: "Credit Sales Received", key: "credit_sales_received" },

        { header: "Debt Payment Count", key: "debt_payment_count" },
        { header: "Debt Payments Total", key: "debt_payments_total" },
        { header: "Debt Cash", key: "debt_cash" },
        { header: "Debt MoMo", key: "debt_momo" },
        { header: "Debt Bank", key: "debt_bank" },

        { header: "Expenses Count", key: "expenses_count" },
        { header: "Expenses Total", key: "expenses_total" },

        { header: "Expected Cash", key: "expected_cash" },
        { header: "Expected MoMo", key: "expected_momo" },
        { header: "Expected Bank", key: "expected_bank" },
        { header: "Expected Other", key: "expected_other" },
        { header: "Expected Total", key: "expected_total" },

        { header: "Cash Counted", key: "cash_counted" },
        { header: "MoMo Counted", key: "momo_counted" },
        { header: "Bank Counted", key: "bank_counted" },
        { header: "Other Counted", key: "other_counted" },
        { header: "Total Counted", key: "total_counted" },

        { header: "Difference Total", key: "difference_total" },
        { header: "Notes", key: "notes" },
        { header: "Closed By", key: "closed_by_name" },
        { header: "Closed At", key: "closed_at" },
      ];

      closings.forEach((closing) => {
        worksheet.addRow({
          closing_date: formatDate(closing.closing_date),
          sales_count: Number(closing.sales_count || 0),
          sales_total: Number(closing.sales_total || 0),
          sales_received: Number(closing.sales_received || 0),

          cash_sales: Number(closing.cash_sales || 0),
          momo_sales: Number(closing.momo_sales || 0),
          bank_sales: Number(closing.bank_sales || 0),
          mixed_sales: Number(closing.mixed_sales || 0),
          credit_sales_total: Number(closing.credit_sales_total || 0),
          credit_sales_received: Number(closing.credit_sales_received || 0),

          debt_payment_count: Number(closing.debt_payment_count || 0),
          debt_payments_total: Number(closing.debt_payments_total || 0),
          debt_cash: Number(closing.debt_cash || 0),
          debt_momo: Number(closing.debt_momo || 0),
          debt_bank: Number(closing.debt_bank || 0),

          expenses_count: Number(closing.expenses_count || 0),
          expenses_total: Number(closing.expenses_total || 0),

          expected_cash: Number(closing.expected_cash || 0),
          expected_momo: Number(closing.expected_momo || 0),
          expected_bank: Number(closing.expected_bank || 0),
          expected_other: Number(closing.expected_other || 0),
          expected_total: Number(closing.expected_total || 0),

          cash_counted: Number(closing.cash_counted || 0),
          momo_counted: Number(closing.momo_counted || 0),
          bank_counted: Number(closing.bank_counted || 0),
          other_counted: Number(closing.other_counted || 0),
          total_counted: Number(closing.total_counted || 0),

          difference_total: Number(closing.difference_total || 0),
          notes: closing.notes || "",
          closed_by_name: closing.closed_by_name || "",
          closed_at: formatDateTime(closing.closed_at),
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Daily Closing Summary");

      const totalExpected = closings.reduce(
        (sum, closing) => sum + Number(closing.expected_total || 0),
        0
      );

      const totalCounted = closings.reduce(
        (sum, closing) => sum + Number(closing.total_counted || 0),
        0
      );

      const totalDifference = closings.reduce(
        (sum, closing) => sum + Number(closing.difference_total || 0),
        0
      );

      const totalSales = closings.reduce(
        (sum, closing) => sum + Number(closing.sales_total || 0),
        0
      );

      const totalDebtPayments = closings.reduce(
        (sum, closing) => sum + Number(closing.debt_payments_total || 0),
        0
      );

      const totalExpenses = closings.reduce(
        (sum, closing) => sum + Number(closing.expenses_total || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Daily closing records exported",
        value: closings.length,
      });

      summaryWorksheet.addRow({
        metric: "Total sales",
        value: totalSales,
      });

      summaryWorksheet.addRow({
        metric: "Total debt payments",
        value: totalDebtPayments,
      });

      summaryWorksheet.addRow({
        metric: "Total expenses",
        value: totalExpenses,
      });

      summaryWorksheet.addRow({
        metric: "Total expected",
        value: totalExpected,
      });

      summaryWorksheet.addRow({
        metric: "Total counted",
        value: totalCounted,
      });

      summaryWorksheet.addRow({
        metric: "Total difference",
        value: totalDifference,
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendWorkbook(res, workbook, "chalin03-daily-closings.xlsx");
    } catch (error) {
      console.error("Export daily closings error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting daily closings.",
      });
    }
  }
);

// GET /api/exports/customer-statement?phone=0240000000&name=Customer
router.get(
  "/customer-statement",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const phone = String(req.query.phone || "").trim();
      const name = String(req.query.name || "").trim();

      if (!phone && !name) {
        return res.status(400).json({
          status: "error",
          message: "Customer phone or name is required.",
        });
      }

      const conditions = [];
      const params = [];

      if (phone) {
        conditions.push("s.customer_phone = ?");
        params.push(phone);
      }

      if (name) {
        conditions.push("s.customer_name = ?");
        params.push(name);
      }

      const whereCustomer = conditions.join(" OR ");

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          s.subtotal,
          s.discount_amount,
          s.tax_amount,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.sale_status,
          s.is_voided,
          s.created_at,
          u.full_name AS staff_name
         FROM sales s
         LEFT JOIN users u ON s.staff_id = u.id
         WHERE ${whereCustomer}
         ORDER BY s.created_at DESC`,
        params
      );

      const saleIds = sales.map((sale) => sale.id);

      let debts = [];
      let debtPayments = [];

      if (saleIds.length > 0) {
        const salePlaceholders = saleIds.map(() => "?").join(",");

        const [debtRows] = await pool.query(
          `SELECT
            d.id,
            d.sale_id,
            d.customer_name,
            d.customer_phone,
            d.amount_owed,
            d.amount_paid,
            d.balance,
            d.status,
            d.due_date,
            d.created_at,
            s.receipt_number
           FROM debts d
           INNER JOIN sales s ON d.sale_id = s.id
           WHERE d.sale_id IN (${salePlaceholders})
           ORDER BY d.created_at DESC`,
          saleIds
        );

        debts = debtRows;

        const debtIds = debts.map((debt) => debt.id);

        if (debtIds.length > 0) {
          const debtPlaceholders = debtIds.map(() => "?").join(",");

          const [paymentRows] = await pool.query(
            `SELECT
              dp.id,
              dp.debt_id,
              dp.amount,
              dp.payment_method,
              dp.paid_at,
              dp.notes,
              d.customer_name,
              d.customer_phone,
              s.receipt_number,
              u.full_name AS received_by_name
             FROM debt_payments dp
             INNER JOIN debts d ON dp.debt_id = d.id
             INNER JOIN sales s ON d.sale_id = s.id
             LEFT JOIN users u ON dp.received_by = u.id
             WHERE dp.debt_id IN (${debtPlaceholders})
             ORDER BY dp.paid_at DESC, dp.id DESC`,
            debtIds
          );

          debtPayments = paymentRows;
        }
      }

      const validSales = sales.filter(
        (sale) =>
          Number(sale.is_voided || 0) === 0 && sale.sale_status !== "cancelled"
      );

      const totalSales = validSales.reduce(
        (sum, sale) => sum + Number(sale.total || 0),
        0
      );

      const totalPaidOnSales = validSales.reduce(
        (sum, sale) => sum + Number(sale.amount_paid || 0),
        0
      );

      const totalDebtPayments = debtPayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      const totalOutstanding = debts.reduce(
        (sum, debt) => sum + Number(debt.balance || 0),
        0
      );

      const customerName = sales[0]?.customer_name || debts[0]?.customer_name || name;
      const customerPhone =
        sales[0]?.customer_phone || debts[0]?.customer_phone || phone;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const summaryWorksheet = workbook.addWorksheet("Customer Summary");

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Customer Name",
        value: customerName || "",
      });

      summaryWorksheet.addRow({
        metric: "Customer Phone",
        value: customerPhone || "",
      });

      summaryWorksheet.addRow({
        metric: "Sales Records",
        value: sales.length,
      });

      summaryWorksheet.addRow({
        metric: "Valid Sales Records",
        value: validSales.length,
      });

      summaryWorksheet.addRow({
        metric: "Debt Records",
        value: debts.length,
      });

      summaryWorksheet.addRow({
        metric: "Debt Payment Records",
        value: debtPayments.length,
      });

      summaryWorksheet.addRow({
        metric: "Total Sales",
        value: Number(totalSales.toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Total Paid on Sales",
        value: Number(totalPaidOnSales.toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Total Debt Payments",
        value: Number(totalDebtPayments.toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Total Received",
        value: Number((totalPaidOnSales + totalDebtPayments).toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Outstanding Balance",
        value: Number(totalOutstanding.toFixed(2)),
      });

      const salesWorksheet = workbook.addWorksheet("Sales History");

      salesWorksheet.columns = [
        { header: "Date", key: "created_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Subtotal", key: "subtotal" },
        { header: "Discount", key: "discount_amount" },
        { header: "VAT", key: "tax_amount" },
        { header: "Total", key: "total" },
        { header: "Payment Type", key: "payment_type" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Sale Status", key: "sale_status" },
        { header: "Voided?", key: "voided_text" },
        { header: "Staff", key: "staff_name" },
      ];

      sales.forEach((sale) => {
        const voided =
          Number(sale.is_voided || 0) === 1 || sale.sale_status === "cancelled";

        salesWorksheet.addRow({
          created_at: formatDateTime(sale.created_at),
          receipt_number: sale.receipt_number || "",
          customer_name: sale.customer_name || "",
          customer_phone: sale.customer_phone || "",
          subtotal: voided ? 0 : Number(sale.subtotal || 0),
          discount_amount: voided ? 0 : Number(sale.discount_amount || 0),
          tax_amount: voided ? 0 : Number(sale.tax_amount || 0),
          total: voided ? 0 : Number(sale.total || 0),
          payment_type: sale.payment_type || "",
          amount_paid: voided ? 0 : Number(sale.amount_paid || 0),
          balance: voided ? 0 : Number(sale.balance || 0),
          sale_status: sale.sale_status || "",
          voided_text: voided ? "Yes" : "No",
          staff_name: sale.staff_name || "",
        });
      });

      const debtsWorksheet = workbook.addWorksheet("Debt Records");

      debtsWorksheet.columns = [
        { header: "Date", key: "created_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount Owed", key: "amount_owed" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Status", key: "status" },
        { header: "Due Date", key: "due_date" },
      ];

      debts.forEach((debt) => {
        debtsWorksheet.addRow({
          created_at: formatDateTime(debt.created_at),
          receipt_number: debt.receipt_number || "",
          customer_name: debt.customer_name || "",
          customer_phone: debt.customer_phone || "",
          amount_owed: Number(debt.amount_owed || 0),
          amount_paid: Number(debt.amount_paid || 0),
          balance: Number(debt.balance || 0),
          status: debt.status || "",
          due_date: formatDate(debt.due_date),
        });
      });

      const paymentsWorksheet = workbook.addWorksheet("Debt Payments");

      paymentsWorksheet.columns = [
        { header: "Payment Date", key: "paid_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount", key: "amount" },
        { header: "Payment Method", key: "payment_method" },
        { header: "Received By", key: "received_by_name" },
        { header: "Notes", key: "notes" },
      ];

      debtPayments.forEach((payment) => {
        paymentsWorksheet.addRow({
          paid_at: formatDateTime(payment.paid_at),
          receipt_number: payment.receipt_number || "",
          customer_name: payment.customer_name || "",
          customer_phone: payment.customer_phone || "",
          amount: Number(payment.amount || 0),
          payment_method: payment.payment_method || "",
          received_by_name: payment.received_by_name || "",
          notes: payment.notes || "",
        });
      });

      styleWorksheet(summaryWorksheet);
      styleWorksheet(salesWorksheet);
      styleWorksheet(debtsWorksheet);
      styleWorksheet(paymentsWorksheet);

      const safeName = String(customerName || "customer")
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase();

      return sendWorkbook(
        res,
        workbook,
        `chalin03-customer-statement-${safeName}.xlsx`
      );
    } catch (error) {
      console.error("Export customer statement error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting customer statement.",
      });
    }
  }
);

// GET /api/exports/sales
router.get(
  "/sales",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const params = [];
      const dateFilter = buildDateFilter("s", "created_at", from, to, params);

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.receipt_number,
          s.subtotal,
          s.discount_amount,
          s.tax_amount,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.sale_status,
          s.is_voided,
          s.void_reason,
          s.voided_at,
          s.created_at,
          s.customer_name,
          s.customer_phone,
          u.full_name AS staff_name,
          vu.full_name AS voided_by_name
         FROM sales s
         LEFT JOIN users u ON s.staff_id = u.id
         LEFT JOIN users vu ON s.voided_by = vu.id
         WHERE 1 = 1
         ${dateFilter}
         ORDER BY s.created_at DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Sales");

      worksheet.columns = [
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Staff", key: "staff_name" },
        { header: "Subtotal / Before Discount", key: "subtotal" },
        { header: "Discount", key: "discount_amount" },
        { header: "VAT", key: "tax_amount" },
        { header: "Amount Due", key: "total" },
        { header: "Payment Type", key: "payment_type" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Sale Status", key: "sale_status" },
        { header: "Voided?", key: "voided_text" },
        { header: "Valid Sales Total", key: "valid_total" },
        { header: "Valid Discount", key: "valid_discount" },
        { header: "Valid Amount Paid", key: "valid_amount_paid" },
        { header: "Valid Balance", key: "valid_balance" },
        { header: "Void Reason", key: "void_reason" },
        { header: "Voided By", key: "voided_by_name" },
        { header: "Voided At", key: "voided_at" },
        { header: "Date", key: "created_at" },
      ];

      sales.forEach((sale) => {
        const voided = isVoidedSale(sale);

        worksheet.addRow({
          receipt_number: sale.receipt_number,
          customer_name: sale.customer_name || "Walk-in Customer",
          customer_phone: sale.customer_phone || "",
          staff_name: sale.staff_name || "",
          subtotal: Number(sale.subtotal || 0),
          discount_amount: Number(sale.discount_amount || 0),
          tax_amount: Number(sale.tax_amount || 0),
          total: Number(sale.total || 0),
          payment_type: sale.payment_type,
          amount_paid: Number(sale.amount_paid || 0),
          balance: Number(sale.balance || 0),
          sale_status: sale.sale_status,
          voided_text: voided ? "Yes" : "No",
          valid_total: voided ? 0 : Number(sale.total || 0),
          valid_discount: voided ? 0 : Number(sale.discount_amount || 0),
          valid_amount_paid: voided ? 0 : Number(sale.amount_paid || 0),
          valid_balance: voided ? 0 : Number(sale.balance || 0),
          void_reason: sale.void_reason || "",
          voided_by_name: sale.voided_by_name || "",
          voided_at: formatDateTime(sale.voided_at),
          created_at: formatDateTime(sale.created_at),
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Sales Summary");

      const validSales = sales.filter((sale) => !isVoidedSale(sale));
      const voidedSales = sales.filter((sale) => isVoidedSale(sale));

      const validBeforeDiscount = validSales.reduce(
        (sum, sale) => sum + Number(sale.subtotal || 0),
        0
      );

      const validDiscount = validSales.reduce(
        (sum, sale) => sum + Number(sale.discount_amount || 0),
        0
      );

      const validTax = validSales.reduce(
        (sum, sale) => sum + Number(sale.tax_amount || 0),
        0
      );

      const validTotal = validSales.reduce(
        (sum, sale) => sum + Number(sale.total || 0),
        0
      );

      const validAmountPaid = validSales.reduce(
        (sum, sale) => sum + Number(sale.amount_paid || 0),
        0
      );

      const validBalance = validSales.reduce(
        (sum, sale) => sum + Number(sale.balance || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Total sales exported",
        value: sales.length,
      });

      summaryWorksheet.addRow({
        metric: "Valid completed sales",
        value: validSales.length,
      });

      summaryWorksheet.addRow({
        metric: "Voided / Cancelled sales",
        value: voidedSales.length,
      });

      summaryWorksheet.addRow({
        metric: "Valid before discount",
        value: validBeforeDiscount,
      });

      summaryWorksheet.addRow({
        metric: "Valid discount",
        value: validDiscount,
      });

      summaryWorksheet.addRow({
        metric: "Valid VAT",
        value: validTax,
      });

      summaryWorksheet.addRow({
        metric: "Valid sales total",
        value: validTotal,
      });

      summaryWorksheet.addRow({
        metric: "Valid amount paid",
        value: validAmountPaid,
      });

      summaryWorksheet.addRow({
        metric: "Valid balance",
        value: validBalance,
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendWorkbook(res, workbook, "chalin03-sales.xlsx");
    } catch (error) {
      console.error("Export sales error:", error);

      return res.status(500).json({
        status: "error",
        message: error.message || "Something went wrong while exporting sales.",
      });
    }
  }
);

// GET /api/exports/debts
router.get(
  "/debts",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const [debts] = await pool.query(
        `SELECT
          d.id,
          d.amount_owed,
          d.amount_paid,
          d.balance,
          d.status,
          d.due_date,
          d.created_at,
          d.customer_name,
          d.customer_phone,
          s.receipt_number,
          s.sale_status,
          s.is_voided
         FROM debts d
         INNER JOIN sales s ON d.sale_id = s.id
         WHERE COALESCE(s.is_voided, 0) = 0
         AND s.sale_status != 'cancelled'
         ORDER BY d.created_at DESC`
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Debts");

      worksheet.columns = [
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount Owed", key: "amount_owed" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Status", key: "status" },
        { header: "Due Date", key: "due_date" },
        { header: "Created At", key: "created_at" },
      ];

      debts.forEach((debt) => {
        worksheet.addRow({
          receipt_number: debt.receipt_number || "",
          customer_name: debt.customer_name || "",
          customer_phone: debt.customer_phone || "",
          amount_owed: Number(debt.amount_owed || 0),
          amount_paid: Number(debt.amount_paid || 0),
          balance: Number(debt.balance || 0),
          status: debt.status,
          due_date: formatDate(debt.due_date),
          created_at: formatDateTime(debt.created_at),
        });
      });

      styleWorksheet(worksheet);

      return sendWorkbook(res, workbook, "chalin03-debts.xlsx");
    } catch (error) {
      console.error("Export debts error:", error);

      return res.status(500).json({
        status: "error",
        message: error.message || "Something went wrong while exporting debts.",
      });
    }
  }
);

// GET /api/exports/expenses
router.get(
  "/expenses",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const params = [];
      const dateFilter = buildDateFilter("e", "expense_date", from, to, params);

      const [expenses] = await pool.query(
        `SELECT
          e.id,
          e.category,
          e.description,
          e.amount,
          e.expense_date,
          e.created_at,
          u.full_name AS recorded_by_name
         FROM expenses e
         LEFT JOIN users u ON e.recorded_by = u.id
         WHERE 1 = 1
         ${dateFilter}
         ORDER BY e.expense_date DESC, e.created_at DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Expenses");

      worksheet.columns = [
        { header: "Date", key: "expense_date" },
        { header: "Category", key: "category" },
        { header: "Description", key: "description" },
        { header: "Amount", key: "amount" },
        { header: "Recorded By", key: "recorded_by_name" },
        { header: "Created At", key: "created_at" },
      ];

      expenses.forEach((expense) => {
        worksheet.addRow({
          expense_date: formatDate(expense.expense_date),
          category: expense.category,
          description: expense.description || "",
          amount: Number(expense.amount || 0),
          recorded_by_name: expense.recorded_by_name || "",
          created_at: formatDateTime(expense.created_at),
        });
      });

      styleWorksheet(worksheet);

      return sendWorkbook(res, workbook, "chalin03-expenses.xlsx");
    } catch (error) {
      console.error("Export expenses error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting expenses.",
      });
    }
  }
);

// GET /api/exports/purchases
router.get(
  "/purchases",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const params = [];
      const dateFilter = buildDateFilter("p", "purchase_date", from, to, params);

      const [purchases] = await pool.query(
        `SELECT
          p.id,
          p.supplier_id,
          p.invoice_number,
          p.purchase_date,
          p.total_cost,
          p.total_amount,
          p.amount_paid,
          p.balance,
          p.payment_status,
          p.notes,
          p.created_at,
          s.name AS supplier_name,
          u.full_name AS created_by_name
         FROM purchases p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         LEFT JOIN users u ON p.created_by = u.id
         WHERE 1 = 1
         ${dateFilter}
         ORDER BY p.purchase_date DESC, p.created_at DESC`,
        params
      );

      const purchaseIds = purchases.map((purchase) => purchase.id);

      let purchaseItems = [];
      let purchasePayments = [];

      if (purchaseIds.length > 0) {
        const placeholders = purchaseIds.map(() => "?").join(",");

        const [items] = await pool.query(
          `SELECT
            pi.id,
            pi.purchase_id,
            pi.product_id,
            pi.product_name,
            pi.quantity,
            pi.cost_price,
            pi.line_total,
            p.invoice_number,
            p.purchase_date,
            s.name AS supplier_name
           FROM purchase_items pi
           INNER JOIN purchases p ON pi.purchase_id = p.id
           LEFT JOIN suppliers s ON p.supplier_id = s.id
           WHERE pi.purchase_id IN (${placeholders})
           ORDER BY p.purchase_date DESC, pi.id ASC`,
          purchaseIds
        );

        purchaseItems = items;

        const [payments] = await pool.query(
          `SELECT
            pp.id,
            pp.purchase_id,
            pp.amount,
            pp.payment_method,
            pp.notes,
            pp.paid_at,
            p.invoice_number,
            p.purchase_date,
            s.name AS supplier_name,
            u.full_name AS paid_by_name
           FROM purchase_payments pp
           INNER JOIN purchases p ON pp.purchase_id = p.id
           LEFT JOIN suppliers s ON p.supplier_id = s.id
           LEFT JOIN users u ON pp.paid_by = u.id
           WHERE pp.purchase_id IN (${placeholders})
           ORDER BY p.purchase_date DESC, pp.paid_at ASC, pp.id ASC`,
          purchaseIds
        );

        purchasePayments = payments;
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Purchases");

      worksheet.columns = [
        { header: "Date", key: "purchase_date" },
        { header: "Supplier", key: "supplier_name" },
        { header: "Invoice Number", key: "invoice_number" },
        { header: "Total Cost", key: "total_cost" },
        { header: "Total Amount", key: "total_amount" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Payment Status", key: "payment_status" },
        { header: "Notes", key: "notes" },
        { header: "Recorded By", key: "created_by_name" },
        { header: "Created At", key: "created_at" },
      ];

      purchases.forEach((purchase) => {
        worksheet.addRow({
          purchase_date: formatDate(purchase.purchase_date),
          supplier_name: purchase.supplier_name || "",
          invoice_number: purchase.invoice_number || "",
          total_cost: Number(purchase.total_cost || 0),
          total_amount: Number(purchase.total_amount || 0),
          amount_paid: Number(purchase.amount_paid || 0),
          balance: Number(purchase.balance || 0),
          payment_status: purchase.payment_status || "",
          notes: purchase.notes || "",
          created_by_name: purchase.created_by_name || "",
          created_at: formatDateTime(purchase.created_at),
        });
      });

      const itemsWorksheet = workbook.addWorksheet("Purchase Items");

      itemsWorksheet.columns = [
        { header: "Purchase Date", key: "purchase_date" },
        { header: "Supplier", key: "supplier_name" },
        { header: "Invoice Number", key: "invoice_number" },
        { header: "Product", key: "product_name" },
        { header: "Quantity", key: "quantity" },
        { header: "Cost Price", key: "cost_price" },
        { header: "Line Total", key: "line_total" },
      ];

      purchaseItems.forEach((item) => {
        itemsWorksheet.addRow({
          purchase_date: formatDate(item.purchase_date),
          supplier_name: item.supplier_name || "",
          invoice_number: item.invoice_number || "",
          product_name: item.product_name || "",
          quantity: Number(item.quantity || 0),
          cost_price: Number(item.cost_price || 0),
          line_total: Number(item.line_total || 0),
        });
      });

      const paymentsWorksheet = workbook.addWorksheet("Purchase Payments");

      paymentsWorksheet.columns = [
        { header: "Purchase Date", key: "purchase_date" },
        { header: "Supplier", key: "supplier_name" },
        { header: "Invoice Number", key: "invoice_number" },
        { header: "Payment Date", key: "paid_at" },
        { header: "Amount", key: "amount" },
        { header: "Payment Method", key: "payment_method" },
        { header: "Paid By", key: "paid_by_name" },
        { header: "Notes", key: "notes" },
      ];

      purchasePayments.forEach((payment) => {
        paymentsWorksheet.addRow({
          purchase_date: formatDate(payment.purchase_date),
          supplier_name: payment.supplier_name || "",
          invoice_number: payment.invoice_number || "",
          paid_at: formatDateTime(payment.paid_at),
          amount: Number(payment.amount || 0),
          payment_method: payment.payment_method || "",
          paid_by_name: payment.paid_by_name || "",
          notes: payment.notes || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Purchase Summary");

      const totalAmount = purchases.reduce(
        (sum, purchase) => sum + Number(purchase.total_amount || 0),
        0
      );

      const totalPaid = purchases.reduce(
        (sum, purchase) => sum + Number(purchase.amount_paid || 0),
        0
      );

      const totalBalance = purchases.reduce(
        (sum, purchase) => sum + Number(purchase.balance || 0),
        0
      );

      const totalPaymentHistory = purchasePayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Purchases exported",
        value: purchases.length,
      });

      summaryWorksheet.addRow({
        metric: "Total amount",
        value: totalAmount,
      });

      summaryWorksheet.addRow({
        metric: "Total paid",
        value: totalPaid,
      });

      summaryWorksheet.addRow({
        metric: "Total balance",
        value: totalBalance,
      });

      summaryWorksheet.addRow({
        metric: "Payment history total",
        value: totalPaymentHistory,
      });

      styleWorksheet(worksheet);
      styleWorksheet(itemsWorksheet);
      styleWorksheet(paymentsWorksheet);
      styleWorksheet(summaryWorksheet);

      return sendWorkbook(res, workbook, "chalin03-purchases.xlsx");
    } catch (error) {
      console.error("Export purchases error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting purchases.",
      });
    }
  }
);

// GET /api/exports/returns
router.get(
  "/returns",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const params = [];
      const dateFilter = buildDateFilter("r", "returned_at", from, to, params);

      const [returns] = await pool.query(
        `SELECT
          r.id,
          r.quantity,
          r.reason,
          r.returned_at,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          p.name AS product_name
         FROM returns r
         LEFT JOIN sales s ON r.sale_id = s.id
         LEFT JOIN products p ON r.product_id = p.id
         WHERE 1 = 1
         ${dateFilter}
         ORDER BY r.returned_at DESC, r.id DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Returns");

      worksheet.columns = [
        { header: "Date", key: "returned_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Product", key: "product_name" },
        { header: "Quantity", key: "quantity" },
        { header: "Reason", key: "reason" },
      ];

      returns.forEach((returnItem) => {
        worksheet.addRow({
          returned_at: formatDateTime(returnItem.returned_at),
          receipt_number: returnItem.receipt_number || "",
          customer_name: returnItem.customer_name || "",
          customer_phone: returnItem.customer_phone || "",
          product_name: returnItem.product_name || "",
          quantity: Number(returnItem.quantity || 0),
          reason: returnItem.reason || "",
        });
      });

      styleWorksheet(worksheet);

      return sendWorkbook(res, workbook, "chalin03-returns.xlsx");
    } catch (error) {
      console.error("Export returns error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting returns.",
      });
    }
  }
);

module.exports = router;