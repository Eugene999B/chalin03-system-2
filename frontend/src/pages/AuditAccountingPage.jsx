import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const BUSINESS_NAME = "Chalin 03 Company Limited";

const SIGN_OFF_CHECKLIST_ITEMS = [
  {
    key: "salesChecked",
    label: "Sales records checked",
    backendKey: "sales_checked",
    note: "Sales totals, receipts, voided sales and discounts have been reviewed.",
  },
  {
    key: "expensesChecked",
    label: "Expenses checked",
    backendKey: "expenses_checked",
    note: "Expense categories, dates, descriptions and amounts have been reviewed.",
  },
  {
    key: "debtsChecked",
    label: "Customer debts checked",
    backendKey: "debts_checked",
    note: "Outstanding debts and sales balances have been reviewed.",
  },
  {
    key: "stockChecked",
    label: "Stock and pricing checked",
    backendKey: "stock_checked",
    note: "Low stock, out-of-stock items and pricing warnings have been reviewed.",
  },
  {
    key: "warningsChecked",
    label: "Audit warnings reviewed",
    backendKey: "warnings_checked",
    note: "Red, orange and blue audit warnings have been read and considered.",
  },
  {
    key: "reportsChecked",
    label: "Reports / exports prepared",
    backendKey: "reports_checked",
    note: "Audit documents, CSV files, Word reports or print reports have been prepared.",
  },
];

const EMPTY_SIGN_OFF = {
  preparedBy: "",
  reviewedBy: "",
  approvedBy: "",
  reviewDate: getTodayInputDate(),
  periodStatus: "draft",
  accountantNotes: "",
  managementNotes: "",
  checklist: {
    salesChecked: false,
    expensesChecked: false,
    debtsChecked: false,
    stockChecked: false,
    warningsChecked: false,
    reportsChecked: false,
  },
};

function getTodayInputDate() {
  const today = new Date();
  return dateToInputValue(today);
}

function cloneEmptySignOff() {
  return {
    ...EMPTY_SIGN_OFF,
    reviewDate: getTodayInputDate(),
    checklist: { ...EMPTY_SIGN_OFF.checklist },
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function plainMoney(value) {
  return Number(value || 0).toFixed(2);
}

function dateToInputValue(date) {
  const safeDate = new Date(date);

  if (Number.isNaN(safeDate.getTime())) {
    return "";
  }

  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function apiDate(value) {
  if (!value) return null;
  return dateToInputValue(value) || null;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB");
}

function getStartOfDay(date) {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
}

function getEndOfDay(date) {
  const newDate = new Date(date);
  newDate.setHours(23, 59, 59, 999);
  return newDate;
}

function getStartOfWeek(date) {
  const newDate = getStartOfDay(date);
  const day = newDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  newDate.setDate(newDate.getDate() + mondayOffset);
  return newDate;
}

function getPeriodRange(periodType, customStartDate, customEndDate) {
  const today = new Date();

  if (periodType === "today") {
    return {
      start: getStartOfDay(today),
      end: getEndOfDay(today),
      label: "Today",
      shortLabel: "today",
    };
  }

  if (periodType === "week") {
    const start = getStartOfWeek(today);
    return {
      start,
      end: getEndOfDay(today),
      label: `This Week (${formatDate(start)} - ${formatDate(today)})`,
      shortLabel: "this-week",
    };
  }

  if (periodType === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      start: getStartOfDay(start),
      end: getEndOfDay(today),
      label: `This Month (${formatDate(start)} - ${formatDate(today)})`,
      shortLabel: "this-month",
    };
  }

  if (periodType === "year") {
    const start = new Date(today.getFullYear(), 0, 1);
    return {
      start: getStartOfDay(start),
      end: getEndOfDay(today),
      label: `This Year (${formatDate(start)} - ${formatDate(today)})`,
      shortLabel: "this-year",
    };
  }

  if (periodType === "custom") {
    const start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
    const end = customEndDate ? new Date(`${customEndDate}T23:59:59`) : null;

    return {
      start: start ? getStartOfDay(start) : null,
      end: end ? getEndOfDay(end) : null,
      label:
        start && end
          ? `Custom Period (${formatDate(start)} - ${formatDate(end)})`
          : "Custom Period",
      shortLabel:
        start && end
          ? `${dateToInputValue(start)}-to-${dateToInputValue(end)}`
          : "custom-period",
    };
  }

  return {
    start: null,
    end: null,
    label: "All Records",
    shortLabel: "all-records",
  };
}

function isDateInsidePeriod(date, period) {
  if (!date || Number.isNaN(date.getTime())) return false;
  if (!period.start && !period.end) return true;
  if (period.start && date < period.start) return false;
  if (period.end && date > period.end) return false;
  return true;
}

function getSaleDate(sale) {
  return new Date(sale?.created_at || sale?.sale_date || sale?.date);
}

function getExpenseDate(expense) {
  return new Date(expense?.expense_date || expense?.created_at || expense?.date);
}

function isSaleVoided(sale) {
  const status = String(sale?.sale_status || "").toLowerCase();
  return Number(sale?.is_voided || 0) === 1 || status === "cancelled" || status === "voided";
}

function isCompletedSale(sale) {
  const status = String(sale?.sale_status || "completed").toLowerCase();
  return !isSaleVoided(sale) && status === "completed";
}

function getPaymentType(sale) {
  return String(sale?.payment_type || "cash").toLowerCase();
}

function makeFilePrefix(name) {
  return String(name || "audit-report")
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll("/", "-")
    .replaceAll("(", "")
    .replaceAll(")", "")
    .replaceAll(",", "")
    .replaceAll(":", "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
}

function getSignOffStatusLabel(status) {
  if (status === "approved") return "Approved by Management";
  if (status === "reviewed") return "Reviewed by Accountant";
  if (status === "rejected") return "Rejected / Needs Correction";
  return "Draft / Not Approved";
}

function getStatusStyle(status) {
  if (status === "approved") return { background: "#dcfce7", color: "#166534" };
  if (status === "reviewed") return { background: "#dbeafe", color: "#1d4ed8" };
  if (status === "rejected") return { background: "#fee2e2", color: "#991b1b" };
  return { background: "#f8fafc", color: "#475569" };
}

function mapDatabaseSignOff(row) {
  if (!row) return null;

  return {
    preparedBy: row.prepared_by_name || "",
    reviewedBy: row.reviewed_by_name || "",
    approvedBy: row.approved_by_name || "",
    reviewDate: row.review_date ? apiDate(row.review_date) : getTodayInputDate(),
    periodStatus: row.period_status || "draft",
    accountantNotes: row.accountant_notes || "",
    managementNotes: row.management_notes || "",
    checklist: {
      salesChecked: Boolean(row.sales_checked),
      expensesChecked: Boolean(row.expenses_checked),
      debtsChecked: Boolean(row.debts_checked),
      stockChecked: Boolean(row.stock_checked),
      warningsChecked: Boolean(row.warnings_checked),
      reportsChecked: Boolean(row.reports_checked),
    },
  };
}

function makeCsv(rows) {
  if (!rows || rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

  return `\uFEFF${[
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")),
  ].join("\n")}`;
}

function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const fileUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = fileUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    document.body.removeChild(link);
    window.URL.revokeObjectURL(fileUrl);
  }, 150);
}

function downloadWordFile(filename, htmlContent) {
  const wordDocument = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <meta name="ProgId" content="Word.Document" />
        <meta name="Generator" content="Chalin 03 System" />
      </head>
      <body>${htmlContent}</body>
    </html>
  `;

  downloadTextFile(filename, wordDocument, "application/msword;charset=utf-8");
}

export default function AuditAccountingPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [debtSummary, setDebtSummary] = useState(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [periodType, setPeriodType] = useState("month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [signOff, setSignOff] = useState(cloneEmptySignOff);
  const [savedSignOffId, setSavedSignOffId] = useState(null);
  const [signOffSaving, setSignOffSaving] = useState(false);
  const [signOffLoading, setSignOffLoading] = useState(false);
  const [signOffHistory, setSignOffHistory] = useState([]);

  const period = useMemo(
    () => getPeriodRange(periodType, customStartDate, customEndDate),
    [periodType, customStartDate, customEndDate]
  );

  const auditData = useMemo(() => {
    const completedSales = sales.filter(isCompletedSale).filter((sale) =>
      isDateInsidePeriod(getSaleDate(sale), period)
    );

    const voidedSales = sales.filter(isSaleVoided).filter((sale) =>
      isDateInsidePeriod(getSaleDate(sale), period)
    );

    const periodExpenses = expenses.filter((expense) =>
      isDateInsidePeriod(getExpenseDate(expense), period)
    );

    const totalSales = completedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const cashCollected = completedSales.reduce((sum, sale) => sum + Number(sale.amount_paid || 0), 0);
    const salesBalances = completedSales.reduce((sum, sale) => sum + Number(sale.balance || 0), 0);
    const totalDiscounts = completedSales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0);
    const totalExpenses = periodExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const fuelExpenses = periodExpenses
      .filter((expense) => String(expense.category || "").toLowerCase().includes("fuel"))
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const transportExpenses = periodExpenses
      .filter((expense) => String(expense.category || "").toLowerCase().includes("transport"))
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const salaryExpenses = periodExpenses
      .filter((expense) => String(expense.category || "").toLowerCase().includes("salary"))
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const outstandingDebts =
      debtSummary?.outstanding_balance ??
      debtSummary?.outstanding_debts ??
      debtSummary?.total_outstanding_balance ??
      debtSummary?.total_balance ??
      0;

    const unpaidDebtCount = debtSummary?.unpaid_count ?? debtSummary?.active_debt_count ?? debtSummary?.count ?? 0;
    const partialDebtCount = debtSummary?.partial_count ?? 0;
    const overdueDebtCount = debtSummary?.overdue_count ?? 0;

    const lowStockProducts = products.filter(
      (product) => Number(product.quantity || 0) <= Number(product.low_stock_threshold || 0)
    );
    const zeroStockProducts = products.filter((product) => Number(product.quantity || 0) <= 0);

    const stockValue = products.reduce(
      (sum, product) => sum + Number(product.quantity || 0) * Number(product.selling_price || 0),
      0
    );

    const stockCostValue = products.reduce(
      (sum, product) => sum + Number(product.quantity || 0) * Number(product.cost_price || 0),
      0
    );

    const stockExpectedProfit = Math.max(stockValue - stockCostValue, 0);
    const operatingResult = totalSales - totalExpenses;
    const possibleDebtDifference = Math.abs(Number(outstandingDebts || 0) - salesBalances);

    const paymentBreakdown = { cash: 0, momo: 0, bank: 0, credit: 0, other: 0 };
    completedSales.forEach((sale) => {
      const paymentType = getPaymentType(sale);
      const amount = Number(sale.total || 0);

      if (paymentType.includes("cash")) paymentBreakdown.cash += amount;
      else if (paymentType.includes("momo") || paymentType.includes("mobile")) paymentBreakdown.momo += amount;
      else if (paymentType.includes("bank")) paymentBreakdown.bank += amount;
      else if (paymentType.includes("credit") || Number(sale.balance || 0) > 0) paymentBreakdown.credit += amount;
      else paymentBreakdown.other += amount;
    });

    const categoryTotals = periodExpenses.reduce((result, expense) => {
      const category = cleanText(expense.category) || "Other";
      result[category] = Number(result[category] || 0) + Number(expense.amount || 0);
      return result;
    }, {});

    const topExpenseCategories = Object.entries(categoryTotals)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const auditFlags = [];
    const addFlag = (severity, title, detail, recommendation) => {
      auditFlags.push({ severity, title, detail, recommendation });
    };

    if (completedSales.length === 0) {
      addFlag(
        "orange",
        "No completed sales found for selected period",
        `There are no completed sales in ${period.label}.`,
        "Confirm whether business activity happened in this period or whether sales were entered correctly."
      );
    }

    if (voidedSales.length > 0) {
      addFlag(
        "red",
        "Voided or cancelled sales detected",
        `${voidedSales.length} voided/cancelled sale(s) exist in the selected period.`,
        "Review who voided them, why they were voided, and whether cash was affected."
      );
    }

    if (Number(outstandingDebts || 0) > 0) {
      addFlag(
        overdueDebtCount > 0 ? "red" : "orange",
        "Outstanding customer debts",
        `${formatMoney(outstandingDebts)} is currently unpaid across customer debt records.`,
        "Follow up customers, reconcile debts and send WhatsApp reminders where necessary."
      );
    }

    if (possibleDebtDifference > 1) {
      addFlag(
        "orange",
        "Debt reconciliation difference",
        `Debt summary differs from period sales balances by about ${formatMoney(possibleDebtDifference)}.`,
        "Compare debt records with sales balances and payment records."
      );
    }

    if (totalExpenses > cashCollected && totalExpenses > 0) {
      addFlag(
        "red",
        "Period expenses exceed cash collected",
        `Selected period expenses ${formatMoney(totalExpenses)} are higher than cash collected ${formatMoney(cashCollected)}.`,
        "Review expense records, supporting receipts and daily closing records."
      );
    }

    if (totalDiscounts > 0) {
      addFlag(
        "blue",
        "Discount activity detected",
        `${formatMoney(totalDiscounts)} total discount was recorded in the selected period.`,
        "Confirm discounts were approved by management."
      );
    }

    if (lowStockProducts.length > 0) {
      addFlag(
        "orange",
        "Low stock risk",
        `${lowStockProducts.length} product(s) are currently at or below low stock level.`,
        "Prepare restocking plan to prevent lost sales."
      );
    }

    if (zeroStockProducts.length > 0) {
      addFlag(
        "red",
        "Out of stock products",
        `${zeroStockProducts.length} product(s) currently have zero or negative quantity.`,
        "Review urgent restock needs and confirm stock entries."
      );
    }

    if (fuelExpenses > 0) {
      addFlag(
        "blue",
        "Fuel expense category active",
        `${formatMoney(fuelExpenses)} has been recorded as fuel expense in the selected period.`,
        "Fuel expenses should be supported with receipts where possible."
      );
    }

    completedSales.slice(0, 40).forEach((sale) => {
      const receiptNumber = sale.receipt_number || `Sale #${sale.id}`;
      const balance = Number(sale.balance || 0);
      const total = Number(sale.total || 0);
      const amountPaid = Number(sale.amount_paid || 0);
      const paymentType = getPaymentType(sale);

      if (!sale.receipt_number) {
        addFlag("orange", "Missing receipt number", `${receiptNumber} has no receipt number.`, "Review the sale record.");
      }

      if (balance > 0 && !paymentType.includes("credit")) {
        addFlag(
          "orange",
          "Balance on non-credit sale",
          `${receiptNumber} has balance ${formatMoney(balance)} but payment type is ${sale.payment_type || "cash"}.`,
          "Review the payment type and debt record."
        );
      }

      if (amountPaid > total && total > 0) {
        addFlag(
          "red",
          "Amount paid is higher than total",
          `${receiptNumber} paid ${formatMoney(amountPaid)} but total is ${formatMoney(total)}.`,
          "Correct the sale record if necessary."
        );
      }
    });

    periodExpenses.slice(0, 40).forEach((expense) => {
      const category = cleanText(expense.category) || "Uncategorized";
      const amount = Number(expense.amount || 0);

      if (amount <= 0) {
        addFlag("red", "Invalid expense amount", `${category} expense has invalid amount ${formatMoney(amount)}.`, "Correct the expense record.");
      }

      if (!cleanText(expense.description)) {
        addFlag("orange", "Expense missing description", `${category} expense of ${formatMoney(amount)} has no description.`, "Add a clear expense description.");
      }
    });

    products.slice(0, 80).forEach((product) => {
      const name = product.name || `Product #${product.id}`;
      const quantity = Number(product.quantity || 0);
      const cost = Number(product.cost_price || 0);
      const selling = Number(product.selling_price || 0);
      const lowStockLevel = Number(product.low_stock_threshold || 0);

      if (quantity <= 0) {
        addFlag("red", "Out of stock product", `${name} has ${quantity} quantity available.`, "Review restocking and stock entries.");
      } else if (quantity <= lowStockLevel) {
        addFlag("orange", "Low stock product", `${name} has ${quantity} left. Low stock level is ${lowStockLevel}.`, "Prepare restock plan.");
      }

      if (selling > 0 && cost > 0 && selling <= cost) {
        addFlag("orange", "Possible low/no profit product", `${name} selling price ${formatMoney(selling)} is not above cost ${formatMoney(cost)}.`, "Review product pricing.");
      }
    });

    if (auditFlags.length === 0) {
      addFlag("green", "No major audit issue detected", `No major warning was detected for ${period.label}.`, "Continue daily closing and regular checking.");
    }

    const redFlags = auditFlags.filter((flag) => flag.severity === "red").length;
    const orangeFlags = auditFlags.filter((flag) => flag.severity === "orange").length;
    const blueFlags = auditFlags.filter((flag) => flag.severity === "blue").length;
    const riskScore = Math.min(100, redFlags * 20 + orangeFlags * 10 + blueFlags * 4);
    const auditScore = Math.max(0, 100 - riskScore);

    let auditStatus = "Needs Review";
    if (auditScore >= 85) auditStatus = "Clean";
    else if (auditScore >= 70) auditStatus = "Acceptable";
    else if (auditScore >= 50) auditStatus = "Watch Closely";

    const accountingChecklist = [
      { title: "Period selected", status: Boolean(period.label), note: `Review period: ${period.label}.` },
      { title: "Sales completeness", status: completedSales.length > 0, note: `${completedSales.length} completed sale(s) found.` },
      { title: "Cash collection review", status: cashCollected >= 0, note: `${formatMoney(cashCollected)} recorded as amount paid.` },
      {
        title: "Debt reconciliation",
        status: Number(outstandingDebts || 0) <= 0 && salesBalances <= 0,
        note: Number(outstandingDebts || 0) > 0 || salesBalances > 0 ? `${formatMoney(outstandingDebts)} outstanding debts and ${formatMoney(salesBalances)} sales balances detected.` : "No outstanding debt detected.",
      },
      { title: "Voided sales review", status: voidedSales.length === 0, note: voidedSales.length > 0 ? `${voidedSales.length} voided/cancelled sale(s) need review.` : "No voided/cancelled sales detected." },
      { title: "Discount approval review", status: totalDiscounts <= 0, note: totalDiscounts > 0 ? `${formatMoney(totalDiscounts)} discounts should be approved.` : "No discount recorded." },
    ];

    const managementLetterPoints = auditFlags
      .filter((flag) => flag.severity !== "green")
      .slice(0, 10)
      .map((flag, index) => ({
        number: index + 1,
        finding: flag.title,
        implication: flag.detail,
        recommendation: flag.recommendation,
      }));

    if (managementLetterPoints.length === 0) {
      managementLetterPoints.push({
        number: 1,
        finding: "No major weakness detected",
        implication: "The reviewed information did not produce a major audit warning.",
        recommendation: "Continue using daily closing, backups, debt follow-up and stock checks.",
      });
    }

    const accountantSummary = [
      { label: "Selected Period", value: period.label, meaning: "Accounting/audit period currently being reviewed.", isText: true },
      { label: "Total Sales Revenue", value: totalSales, meaning: "Completed sales value recorded within the selected period." },
      { label: "Cash Collected", value: cashCollected, meaning: "Amount recorded as paid by customers within the selected period." },
      { label: "Customer Receivables", value: outstandingDebts, meaning: "Current unpaid customer debts requiring follow-up." },
      { label: "Total Expenses", value: totalExpenses, meaning: "Business costs recorded within the selected period." },
      { label: "Operating Result", value: operatingResult, meaning: "Period sales minus period expenses. This is not final tax profit." },
      { label: "Inventory Selling Value", value: stockValue, meaning: "Estimated selling value of stock on hand." },
      { label: "Inventory Cost Value", value: stockCostValue, meaning: "Estimated cost value of stock on hand." },
      { label: "Expected Stock Margin", value: stockExpectedProfit, meaning: "Estimated stock selling value minus cost value." },
    ];

    const accessSalesRows = completedSales.map((sale) => ({
      sale_id: sale.id,
      receipt_number: sale.receipt_number || "",
      customer_name: sale.customer_name || "Walk-in Customer",
      payment_type: sale.payment_type || "",
      subtotal: plainMoney(sale.subtotal),
      discount_amount: plainMoney(sale.discount_amount),
      tax_amount: plainMoney(sale.tax_amount),
      total: plainMoney(sale.total),
      amount_paid: plainMoney(sale.amount_paid),
      balance: plainMoney(sale.balance),
      sale_status: sale.sale_status || "completed",
      created_at: formatDateTime(sale.created_at),
    }));

    const accessExpenseRows = periodExpenses.map((expense) => ({
      expense_id: expense.id,
      category: expense.category || "",
      description: expense.description || "",
      amount: plainMoney(expense.amount),
      expense_date: formatDate(expense.expense_date || expense.created_at),
      recorded_by: expense.recorded_by_name || "",
    }));

    const accessProductRows = products.map((product) => ({
      product_id: product.id,
      name: product.name || "",
      excavator_type: product.size || "",
      category: product.category || "",
      quantity: product.quantity || 0,
      low_stock_threshold: product.low_stock_threshold || 0,
      cost_price: plainMoney(product.cost_price),
      selling_price: plainMoney(product.selling_price),
      barcode: product.barcode || "",
      stock_value: plainMoney(Number(product.quantity || 0) * Number(product.selling_price || 0)),
    }));

    return {
      completedSales,
      voidedSales,
      periodExpenses,
      totalSales,
      cashCollected,
      salesBalances,
      totalDiscounts,
      totalExpenses,
      fuelExpenses,
      transportExpenses,
      salaryExpenses,
      outstandingDebts,
      unpaidDebtCount,
      partialDebtCount,
      overdueDebtCount,
      lowStockProducts,
      zeroStockProducts,
      stockValue,
      stockCostValue,
      stockExpectedProfit,
      operatingResult,
      possibleDebtDifference,
      paymentBreakdown,
      topExpenseCategories,
      auditFlags,
      accountingChecklist,
      redFlags,
      orangeFlags,
      blueFlags,
      auditScore,
      auditStatus,
      managementLetterPoints,
      accountantSummary,
      accessSalesRows,
      accessExpenseRows,
      accessProductRows,
    };
  }, [products, sales, expenses, debtSummary, period]);

  const signOffCompletion = useMemo(() => {
    const total = SIGN_OFF_CHECKLIST_ITEMS.length;
    const checked = SIGN_OFF_CHECKLIST_ITEMS.filter((item) => Boolean(signOff.checklist?.[item.key])).length;
    return {
      total,
      checked,
      percent: total > 0 ? Math.round((checked / total) * 100) : 0,
    };
  }, [signOff.checklist]);

  useEffect(() => {
    loadAuditData();
  }, []);

  useEffect(() => {
    loadLatestSignOff();
    loadSignOffHistory();
  }, [periodType, customStartDate, customEndDate]);

  async function loadAuditData() {
    setLoading(true);
    setError("");

    const requests = await Promise.allSettled([
      axiosClient.get("/products"),
      axiosClient.get("/sales"),
      axiosClient.get("/debts/summary"),
      axiosClient.get("/expenses"),
    ]);

    const [productsResult, salesResult, debtsResult, expensesResult] = requests;

    if (productsResult.status === "fulfilled") setProducts(productsResult.value.data.products || []);
    if (salesResult.status === "fulfilled") setSales(salesResult.value.data.sales || []);
    if (debtsResult.status === "fulfilled") setDebtSummary(debtsResult.value.data.summary || debtsResult.value.data || null);
    if (expensesResult.status === "fulfilled") setExpenses(expensesResult.value.data.expenses || []);

    const failed = requests.filter((item) => item.status === "rejected");
    if (failed.length > 0) {
      setError("Some audit data could not load. The page is still open so you can see what is available.");
    } else {
      setMessage("Audit and accounting review refreshed.");
    }

    setLoading(false);
  }

  async function loadLatestSignOff() {
    setSignOffLoading(true);

    try {
      const response = await axiosClient.get("/audit-signoffs/latest", {
        params: {
          period_type: periodType,
          period_label: period.label,
          period_start: apiDate(period.start),
          period_end: apiDate(period.end),
        },
      });

      const saved = response.data.signoff;

      if (!saved) {
        setSavedSignOffId(null);
        setSignOff(cloneEmptySignOff());
        return;
      }

      const mapped = mapDatabaseSignOff(saved);
      setSavedSignOffId(saved.id);
      setSignOff(mapped || cloneEmptySignOff());
    } catch (requestError) {
      setSavedSignOffId(null);
    } finally {
      setSignOffLoading(false);
    }
  }

  async function loadSignOffHistory() {
    try {
      const response = await axiosClient.get("/audit-signoffs");
      setSignOffHistory(response.data.signoffs || []);
    } catch {
      setSignOffHistory([]);
    }
  }

  function updateSignOffField(field, value) {
    setSignOff((current) => ({ ...current, [field]: value }));
  }

  function updateChecklist(field, value) {
    setSignOff((current) => ({
      ...current,
      checklist: {
        ...current.checklist,
        [field]: value,
      },
    }));
  }

  function buildSignOffPayload() {
    return {
      period_type: periodType,
      period_label: period.label,
      period_start: apiDate(period.start),
      period_end: apiDate(period.end),
      audit_score: auditData.auditScore,
      audit_status: auditData.auditStatus,
      prepared_by_name: signOff.preparedBy,
      reviewed_by_name: signOff.reviewedBy,
      approved_by_name: signOff.approvedBy,
      review_date: signOff.reviewDate || getTodayInputDate(),
      period_status: signOff.periodStatus,
      sales_checked: Boolean(signOff.checklist.salesChecked),
      expenses_checked: Boolean(signOff.checklist.expensesChecked),
      debts_checked: Boolean(signOff.checklist.debtsChecked),
      stock_checked: Boolean(signOff.checklist.stockChecked),
      warnings_checked: Boolean(signOff.checklist.warningsChecked),
      reports_checked: Boolean(signOff.checklist.reportsChecked),
      accountant_notes: signOff.accountantNotes,
      management_notes: signOff.managementNotes,
    };
  }

  async function saveSignOff() {
    setSignOffSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post("/audit-signoffs", buildSignOffPayload());
      const saved = response.data.signoff;

      if (saved) {
        setSavedSignOffId(saved.id);
        const mapped = mapDatabaseSignOff(saved);
        setSignOff(mapped || signOff);
      }

      await loadSignOffHistory();
      setMessage(response.data.message || "Audit sign-off saved into MySQL successfully.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not save audit sign-off. Check backend route and database table.");
    } finally {
      setSignOffSaving(false);
    }
  }

  function clearSignOffForm() {
    setSavedSignOffId(null);
    setSignOff(cloneEmptySignOff());
    setMessage("Sign-off form cleared. Existing database records were not deleted.");
  }

  function fileName(base, extension) {
    return `${base}_${makeFilePrefix(period.shortLabel)}.${extension}`;
  }

  function downloadCsv(filename, rows) {
    const csv = makeCsv(rows);
    if (!csv) {
      setError("No data available for this export.");
      return;
    }
    downloadTextFile(filename, csv, "text/csv;charset=utf-8");
    setMessage(`${filename} downloaded successfully.`);
  }

  function downloadAuditSummaryCsv() {
    const rows = [
      ...auditData.accountantSummary.map((item) => ({
        item: item.label,
        amount: item.isText ? item.value : plainMoney(item.value),
        meaning: item.meaning,
      })),
      { item: "Audit Score", amount: `${auditData.auditScore}%`, meaning: auditData.auditStatus },
      { item: "Red Flags", amount: auditData.redFlags, meaning: "High risk warnings." },
      { item: "Orange Flags", amount: auditData.orangeFlags, meaning: "Medium risk warnings." },
      { item: "Blue Flags", amount: auditData.blueFlags, meaning: "Information notes." },
    ];

    downloadCsv(fileName("chalin03_accounting_summary", "csv"), rows);
  }

  function downloadAuditWarningsCsv() {
    const rows = auditData.auditFlags.map((flag, index) => ({
      number: index + 1,
      period: period.label,
      severity: flag.severity,
      title: flag.title,
      detail: flag.detail,
      recommendation: flag.recommendation,
    }));

    downloadCsv(fileName("chalin03_audit_warnings", "csv"), rows);
  }

  function downloadAccountingWorkbookCsv() {
    const rows = [
      ...auditData.accountantSummary.map((item) => ({
        period: period.label,
        section: "Accounting Summary",
        item: item.label,
        amount: item.isText ? item.value : plainMoney(item.value),
        note: item.meaning,
      })),
      ...auditData.auditFlags.map((flag) => ({
        period: period.label,
        section: "Audit Warning",
        item: flag.title,
        amount: "",
        note: `${flag.detail} Recommendation: ${flag.recommendation}`,
      })),
      ...auditData.topExpenseCategories.map((expense) => ({
        period: period.label,
        section: "Expense Category",
        item: expense.category,
        amount: plainMoney(expense.amount),
        note: "Expense category total",
      })),
    ];

    downloadCsv(fileName("chalin03_accounting_workbook", "csv"), rows);
  }

  function downloadAccessImportPack() {
    downloadCsv(fileName("access_import_sales_table", "csv"), auditData.accessSalesRows);
    setTimeout(() => downloadCsv(fileName("access_import_expenses_table", "csv"), auditData.accessExpenseRows), 300);
    setTimeout(() => downloadCsv(fileName("access_import_products_table", "csv"), auditData.accessProductRows), 600);
    setMessage("Access CSV files are downloading. Import them from inside Microsoft Access.");
  }

  function buildPrintableReport() {
    const summaryRows = auditData.accountantSummary
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td>${escapeHtml(item.isText ? item.value : formatMoney(item.value))}</td>
            <td>${escapeHtml(item.meaning)}</td>
          </tr>
        `
      )
      .join("");

    const flagsRows = auditData.auditFlags
      .map(
        (flag, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(flag.severity.toUpperCase())}</td>
            <td>${escapeHtml(flag.title)}</td>
            <td>${escapeHtml(flag.detail)}</td>
            <td>${escapeHtml(flag.recommendation)}</td>
          </tr>
        `
      )
      .join("");

    const checklistRows = SIGN_OFF_CHECKLIST_ITEMS.map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.label)}</td>
          <td>${signOff.checklist[item.key] ? "Checked" : "Pending"}</td>
          <td>${escapeHtml(item.note)}</td>
        </tr>
      `
    ).join("");

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>${escapeHtml(BUSINESS_NAME)} Audit Report</title>
          <style>
            @page { size: A4; margin: 14mm; }
            body { font-family: Arial, sans-serif; color: #111827; font-size: 12px; line-height: 1.45; }
            h1 { color: #07182c; margin: 0; }
            h2 { color: #07182c; border-bottom: 2px solid #e0ba28; padding-bottom: 6px; margin-top: 24px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #dbe3ef; padding: 7px; text-align: left; vertical-align: top; }
            th { background: #07182c; color: #ffffff; }
            .header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 3px solid #07182c; padding-bottom: 12px; }
            .score { border: 2px solid #e0ba28; border-radius: 12px; padding: 10px; min-width: 150px; text-align: center; }
            .score strong { display: block; font-size: 24px; color: #07182c; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
            .box { border: 1px solid #dbe3ef; border-radius: 10px; padding: 8px; background: #f8fafc; }
            .box span { display: block; color: #64748b; font-size: 11px; }
            .box strong { display: block; color: #07182c; margin-top: 4px; }
            .notice { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 10px; margin-top: 14px; color: #9a3412; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1>${escapeHtml(BUSINESS_NAME)}</h1>
              <p>Audit & Accounting Intelligence Pro Review</p>
              <p><strong>Period:</strong> ${escapeHtml(period.label)}</p>
              <p><strong>Generated:</strong> ${escapeHtml(formatDateTime(new Date()))}</p>
            </div>
            <div class="score">
              <span>Audit Score</span>
              <strong>${auditData.auditScore}%</strong>
              <span>${escapeHtml(auditData.auditStatus)}</span>
            </div>
          </div>

          <div class="grid">
            <div class="box"><span>Period Sales</span><strong>${formatMoney(auditData.totalSales)}</strong></div>
            <div class="box"><span>Cash Collected</span><strong>${formatMoney(auditData.cashCollected)}</strong></div>
            <div class="box"><span>Outstanding Debts</span><strong>${formatMoney(auditData.outstandingDebts)}</strong></div>
            <div class="box"><span>Period Expenses</span><strong>${formatMoney(auditData.totalExpenses)}</strong></div>
            <div class="box"><span>Fuel Expenses</span><strong>${formatMoney(auditData.fuelExpenses)}</strong></div>
            <div class="box"><span>Discounts</span><strong>${formatMoney(auditData.totalDiscounts)}</strong></div>
            <div class="box"><span>Stock Value</span><strong>${formatMoney(auditData.stockValue)}</strong></div>
            <div class="box"><span>Operating Result</span><strong>${formatMoney(auditData.operatingResult)}</strong></div>
          </div>

          <div class="notice">This report supports internal management review and does not replace a licensed accountant or external auditor.</div>

          <h2>1. Accounting Summary</h2>
          <table>
            <thead><tr><th>Item</th><th>Amount / Detail</th><th>Meaning</th></tr></thead>
            <tbody>${summaryRows}</tbody>
          </table>

          <h2>2. Audit Risk Register</h2>
          <table>
            <thead><tr><th>#</th><th>Risk</th><th>Finding</th><th>Details</th><th>Recommendation</th></tr></thead>
            <tbody>${flagsRows}</tbody>
          </table>

          <h2>3. Sign-Off Details</h2>
          <table>
            <tbody>
              <tr><td><strong>Prepared By</strong></td><td>${escapeHtml(signOff.preparedBy || "-")}</td></tr>
              <tr><td><strong>Reviewed By</strong></td><td>${escapeHtml(signOff.reviewedBy || "-")}</td></tr>
              <tr><td><strong>Approved By</strong></td><td>${escapeHtml(signOff.approvedBy || "-")}</td></tr>
              <tr><td><strong>Status</strong></td><td>${escapeHtml(getSignOffStatusLabel(signOff.periodStatus))}</td></tr>
              <tr><td><strong>Review Date</strong></td><td>${escapeHtml(formatDate(signOff.reviewDate))}</td></tr>
              <tr><td><strong>Accountant Notes</strong></td><td>${escapeHtml(signOff.accountantNotes || "-")}</td></tr>
              <tr><td><strong>Management Notes</strong></td><td>${escapeHtml(signOff.managementNotes || "-")}</td></tr>
            </tbody>
          </table>

          <h2>4. Sign-Off Checklist</h2>
          <table>
            <thead><tr><th>Check</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>${checklistRows}</tbody>
          </table>
        </body>
      </html>
    `;
  }

  function printAuditReport() {
    const printWindow = window.open("", "_blank", "width=1000,height=800");
    if (!printWindow) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildPrintableReport());
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 350);
  }

  function downloadAuditReportWord() {
    downloadWordFile(fileName("chalin03_professional_audit_report", "doc"), buildPrintableReport());
    setMessage("Audit Report Word document downloaded successfully.");
  }

  function downloadPowerPointOutlineText() {
    const lines = [
      "CHALIN 03 COMPANY LIMITED",
      "AUDIT & ACCOUNTING POWERPOINT BRIEFING OUTLINE",
      "",
      `Period: ${period.label}`,
      `Generated: ${formatDateTime(new Date())}`,
      `Audit Score: ${auditData.auditScore}% - ${auditData.auditStatus}`,
      "",
      "Accounting Summary",
      ...auditData.accountantSummary.map((item) =>
        item.isText ? `- ${item.label}: ${item.value}` : `- ${item.label}: ${formatMoney(item.value)}`
      ),
      "",
      "Main Audit Warnings",
      ...auditData.auditFlags.slice(0, 10).map((flag) => `- ${flag.title}: ${flag.detail}`),
      "",
      "Recommendations",
      ...auditData.managementLetterPoints.slice(0, 10).map((point) => `- ${point.recommendation}`),
    ];

    downloadTextFile(fileName("chalin03_powerpoint_audit_outline", "txt"), lines.join("\n"));
    setMessage("PowerPoint outline text downloaded successfully.");
  }

  function downloadMonthEndAuditPack() {
    downloadAuditReportWord();
    setTimeout(downloadAuditSummaryCsv, 300);
    setTimeout(downloadAuditWarningsCsv, 600);
    setTimeout(downloadAccountingWorkbookCsv, 900);
    setTimeout(downloadPowerPointOutlineText, 1200);
    setMessage("Month-End Audit Pack is downloading.");
  }

  async function copyAuditSummary() {
    const summary = `${BUSINESS_NAME.toUpperCase()}\nAUDIT & ACCOUNTING SUMMARY\n\nPeriod: ${period.label}\nGenerated: ${formatDateTime(new Date())}\n\nAudit Score: ${auditData.auditScore}% - ${auditData.auditStatus}\nRed Flags: ${auditData.redFlags}\nOrange Flags: ${auditData.orangeFlags}\nBlue Flags: ${auditData.blueFlags}\n\nPeriod Sales: ${formatMoney(auditData.totalSales)}\nCash Collected: ${formatMoney(auditData.cashCollected)}\nOutstanding Debts: ${formatMoney(auditData.outstandingDebts)}\nPeriod Expenses: ${formatMoney(auditData.totalExpenses)}\nOperating Result: ${formatMoney(auditData.operatingResult)}`;

    try {
      await navigator.clipboard.writeText(summary);
      setMessage("Audit summary copied successfully.");
    } catch {
      setError("Could not copy summary. Browser may have blocked clipboard access.");
    }
  }

  function applyCustomThisMonthDates() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    setCustomStartDate(dateToInputValue(start));
    setCustomEndDate(dateToInputValue(now));
    setPeriodType("custom");
  }

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Professional Audit Intelligence</p>
          <h1 style={styles.title}>Audit & Accounting Intelligence Pro</h1>
          <p style={styles.subtitle}>
            Stable audit page for sales, cash, debts, expenses, stock, period review,
            exports and MySQL audit sign-off approval.
          </p>
        </div>

        <div style={styles.heroActions}>
          <button type="button" onClick={loadAuditData} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Review"}
          </button>
          <button type="button" className="secondary-button" onClick={printAuditReport}>
            Print / Save PDF
          </button>
          <button type="button" className="secondary-button" onClick={copyAuditSummary}>
            Copy Summary
          </button>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.periodPanel}>
        <div>
          <p style={styles.eyebrowDark}>Accounting Period Control</p>
          <h2 style={{ margin: "5px 0" }}>{period.label}</h2>
          <p style={styles.panelText}>Choose the accounting period before saving or exporting reports.</p>
        </div>

        <div style={styles.periodButtons}>
          {[
            ["all", "All"],
            ["today", "Today"],
            ["week", "This Week"],
            ["month", "This Month"],
            ["year", "This Year"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriodType(value)}
              style={periodType === value ? styles.activePeriodButton : styles.periodButton}
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={applyCustomThisMonthDates}
            style={periodType === "custom" ? styles.activePeriodButton : styles.periodButton}
          >
            Custom
          </button>
        </div>

        {periodType === "custom" && (
          <div style={styles.dateGrid}>
            <label>
              Start Date
              <input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} />
            </label>
            <label>
              End Date
              <input type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} />
            </label>
          </div>
        )}
      </div>

      <div style={styles.topGrid}>
        <div style={styles.scoreCard}>
          <div style={styles.scoreCircle}>
            <strong>{auditData.auditScore}%</strong>
            <span>{auditData.auditStatus}</span>
          </div>
          <div>
            <h2>Professional Audit Score</h2>
            <p style={styles.panelText}>Score is calculated from sales, debts, expenses, stock, discounts and warnings.</p>
            <div style={styles.pillRow}>
              <span style={styles.redPill}>{auditData.redFlags} Red</span>
              <span style={styles.orangePill}>{auditData.orangeFlags} Orange</span>
              <span style={styles.bluePill}>{auditData.blueFlags} Blue</span>
            </div>
          </div>
        </div>

        <div style={styles.exportPanel}>
          <h2>Export Center</h2>
          <p style={styles.panelText}>Exports use the selected accounting period.</p>
          <div style={styles.buttonGrid}>
            <button type="button" onClick={downloadMonthEndAuditPack}>Month-End Audit Pack</button>
            <button type="button" onClick={downloadAuditReportWord}>Audit Report Word</button>
            <button type="button" onClick={downloadAuditSummaryCsv}>Accounting Summary CSV</button>
            <button type="button" onClick={downloadAuditWarningsCsv}>Audit Warnings CSV</button>
            <button type="button" onClick={downloadAccountingWorkbookCsv}>Accounting Workbook CSV</button>
            <button type="button" onClick={downloadPowerPointOutlineText}>PowerPoint Outline</button>
            <button type="button" onClick={downloadAccessImportPack}>Access Import Pack</button>
          </div>
        </div>
      </div>

      <div style={styles.cardsGrid}>
        <MetricCard title="Period Sales" value={formatMoney(auditData.totalSales)} note={`${auditData.completedSales.length} completed sale(s)`} />
        <MetricCard title="Cash Collected" value={formatMoney(auditData.cashCollected)} note="Amount paid by customers" />
        <MetricCard title="Outstanding Debts" value={formatMoney(auditData.outstandingDebts)} note={`${auditData.unpaidDebtCount} unpaid, ${auditData.partialDebtCount} partial`} />
        <MetricCard title="Period Expenses" value={formatMoney(auditData.totalExpenses)} note={`${auditData.periodExpenses.length} expense record(s)`} />
        <MetricCard title="Fuel Expenses" value={formatMoney(auditData.fuelExpenses)} note="Fuel category total" />
        <MetricCard title="Discounts Given" value={formatMoney(auditData.totalDiscounts)} note="Needs approval review" />
        <MetricCard title="Stock Value" value={formatMoney(auditData.stockValue)} note={`${products.length} product(s) in inventory`} />
        <MetricCard title="Operating Result" value={formatMoney(auditData.operatingResult)} note="Period sales minus expenses" />
      </div>

      <div style={styles.twoColumn}>
        <div style={styles.panel}>
          <h2>Accounting Summary</h2>
          <div style={styles.accountingRows}>
            {auditData.accountantSummary.map((item) => (
              <div key={item.label} style={styles.accountingRow}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.meaning}</span>
                </div>
                <b>{item.isText ? item.value : formatMoney(item.value)}</b>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <h2>Cash & Debt Reconciliation</h2>
          <AccountingLine label="Cash Collected" value={formatMoney(auditData.cashCollected)} />
          <AccountingLine label="Sales Balances" value={formatMoney(auditData.salesBalances)} />
          <AccountingLine label="Outstanding Debts" value={formatMoney(auditData.outstandingDebts)} />
          <AccountingLine label="Possible Difference" value={formatMoney(auditData.possibleDebtDifference)} />
        </div>
      </div>

      <div style={styles.twoColumn}>
        <div style={styles.panel}>
          <h2>Audit Risk Register</h2>
          <div style={styles.listStack}>
            {auditData.auditFlags.slice(0, 20).map((flag, index) => (
              <div key={`${flag.title}-${index}`} style={styles.flagItem}>
                <span style={getFlagPillStyle(flag.severity)}>{flag.severity.toUpperCase()}</span>
                <div>
                  <strong>{flag.title}</strong>
                  <p>{flag.detail}</p>
                  <small>{flag.recommendation}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <h2>Top Expense Categories</h2>
          {auditData.topExpenseCategories.length === 0 ? (
            <div style={styles.emptyBox}>No expense category found for this period.</div>
          ) : (
            <div style={styles.listStack}>
              {auditData.topExpenseCategories.map((expense) => (
                <AccountingLine key={expense.category} label={expense.category} value={formatMoney(expense.amount)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.signoffHeader}>
          <div>
            <p style={styles.eyebrowDark}>Audit Approval</p>
            <h2>Audit Sign-Off & Accounting Approval Center</h2>
            <p style={styles.panelText}>Save the selected period approval into MySQL for future proof.</p>
          </div>
          <div style={styles.signoffBadge}>
            <strong>{signOffCompletion.percent}%</strong>
            <span>{signOffCompletion.checked} / {signOffCompletion.total} checks</span>
          </div>
        </div>

        <div style={styles.signoffStatusRow}>
          <span style={{ ...styles.statusBadge, ...getStatusStyle(signOff.periodStatus) }}>
            {getSignOffStatusLabel(signOff.periodStatus)}
          </span>
          {savedSignOffId ? <span style={styles.savedId}>Saved MySQL ID: #{savedSignOffId}</span> : <span style={styles.savedId}>Not saved for this period yet</span>}
          {signOffLoading && <span style={styles.savedId}>Loading saved sign-off...</span>}
        </div>

        <div style={styles.formGrid}>
          <label>
            Prepared By
            <input value={signOff.preparedBy} onChange={(event) => updateSignOffField("preparedBy", event.target.value)} placeholder="Name of person preparing" />
          </label>
          <label>
            Reviewed By
            <input value={signOff.reviewedBy} onChange={(event) => updateSignOffField("reviewedBy", event.target.value)} placeholder="Name of accountant/reviewer" />
          </label>
          <label>
            Approved By
            <input value={signOff.approvedBy} onChange={(event) => updateSignOffField("approvedBy", event.target.value)} placeholder="Boss/manager name" />
          </label>
          <label>
            Review Date
            <input type="date" value={signOff.reviewDate} onChange={(event) => updateSignOffField("reviewDate", event.target.value)} />
          </label>
          <label>
            Period Status
            <select value={signOff.periodStatus} onChange={(event) => updateSignOffField("periodStatus", event.target.value)}>
              <option value="draft">Draft / Not Approved</option>
              <option value="reviewed">Reviewed by Accountant</option>
              <option value="approved">Approved by Management</option>
              <option value="rejected">Rejected / Needs Correction</option>
            </select>
          </label>
        </div>

        <div style={styles.checklistGrid}>
          {SIGN_OFF_CHECKLIST_ITEMS.map((item) => (
            <label key={item.key} style={styles.checkItem}>
              <input type="checkbox" checked={Boolean(signOff.checklist[item.key])} onChange={(event) => updateChecklist(item.key, event.target.checked)} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </span>
            </label>
          ))}
        </div>

        <div style={styles.notesGrid}>
          <label>
            Accountant / Auditor Notes
            <textarea value={signOff.accountantNotes} onChange={(event) => updateSignOffField("accountantNotes", event.target.value)} rows={5} placeholder="Write accountant notes here" />
          </label>
          <label>
            Boss / Management Notes
            <textarea value={signOff.managementNotes} onChange={(event) => updateSignOffField("managementNotes", event.target.value)} rows={5} placeholder="Write boss approval notes here" />
          </label>
        </div>

        <div style={styles.heroActions}>
          <button type="button" onClick={saveSignOff} disabled={signOffSaving}>
            {signOffSaving ? "Saving..." : "Save Sign-Off to MySQL"}
          </button>
          <button type="button" className="secondary-button" onClick={clearSignOffForm}>
            Clear Form
          </button>
          <button type="button" className="secondary-button" onClick={downloadAuditReportWord}>
            Download Signed Report Word
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <h2>Recent Saved Sign-Offs</h2>
        {signOffHistory.length === 0 ? (
          <div style={styles.emptyBox}>No saved sign-off history found yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Period</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>Prepared</th>
                  <th>Reviewed</th>
                  <th>Approved</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {signOffHistory.slice(0, 8).map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>
                    <td>{item.period_label}</td>
                    <td>{Number(item.audit_score || 0)}%</td>
                    <td>{getSignOffStatusLabel(item.period_status)}</td>
                    <td>{item.prepared_by_name || "-"}</td>
                    <td>{item.reviewed_by_name || "-"}</td>
                    <td>{item.approved_by_name || "-"}</td>
                    <td>{formatDateTime(item.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, value, note }) {
  return (
    <div style={styles.metricCard}>
      <p>{title}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </div>
  );
}

function AccountingLine({ label, value }) {
  return (
    <div style={styles.accountingLine}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getFlagPillStyle(severity) {
  if (severity === "red") return styles.redPill;
  if (severity === "orange") return styles.orangePill;
  if (severity === "blue") return styles.bluePill;
  return styles.greenPill;
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "40px",
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    flexWrap: "wrap",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "24px",
    borderRadius: "26px",
    background: "linear-gradient(135deg, #07182c 0%, #0d2f55 55%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 22px 55px rgba(7, 24, 44, 0.24)",
  },
  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontSize: "12px",
    fontWeight: "950",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  eyebrowDark: {
    margin: 0,
    color: "#164777",
    fontSize: "12px",
    fontWeight: "950",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "6px 0 0",
    fontSize: "clamp(28px, 4vw, 44px)",
    fontWeight: "950",
    lineHeight: 1.05,
  },
  subtitle: {
    margin: "10px 0 0",
    color: "rgba(255,255,255,0.76)",
    maxWidth: "850px",
    lineHeight: 1.6,
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },
  periodPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) minmax(260px, auto)",
    gap: "16px",
    padding: "18px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },
  periodButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    alignItems: "center",
  },
  periodButton: {
    border: "1px solid #dbe3ef",
    background: "#ffffff",
    color: "#164777",
    borderRadius: "999px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: "900",
  },
  activePeriodButton: {
    border: "1px solid #07182c",
    background: "#07182c",
    color: "#ffffff",
    borderRadius: "999px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: "900",
  },
  dateGrid: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
  },
  topGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)",
    gap: "18px",
    marginBottom: "18px",
  },
  scoreCard: {
    display: "grid",
    gridTemplateColumns: "140px minmax(0, 1fr)",
    gap: "18px",
    alignItems: "center",
    padding: "22px",
    borderRadius: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
  },
  scoreCircle: {
    width: "130px",
    height: "130px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    background: "#fef3c7",
    border: "8px solid #e0ba28",
    color: "#07182c",
  },
  exportPanel: {
    padding: "22px",
    borderRadius: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
  },
  buttonGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },
  metricCard: {
    padding: "16px",
    borderRadius: "20px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 30px rgba(15,23,42,0.07)",
  },
  twoColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
    marginBottom: "18px",
  },
  panel: {
    padding: "22px",
    borderRadius: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },
  panelText: {
    color: "#64748b",
    lineHeight: 1.6,
  },
  accountingRows: {
    display: "grid",
    gap: "10px",
  },
  accountingRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  accountingLine: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "11px 0",
    borderBottom: "1px solid #e2e8f0",
  },
  listStack: {
    display: "grid",
    gap: "10px",
  },
  flagItem: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  redPill: {
    display: "inline-flex",
    alignSelf: "start",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: "950",
    fontSize: "12px",
  },
  orangePill: {
    display: "inline-flex",
    alignSelf: "start",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "#ffedd5",
    color: "#9a3412",
    fontWeight: "950",
    fontSize: "12px",
  },
  bluePill: {
    display: "inline-flex",
    alignSelf: "start",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontWeight: "950",
    fontSize: "12px",
  },
  greenPill: {
    display: "inline-flex",
    alignSelf: "start",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "#dcfce7",
    color: "#166534",
    fontWeight: "950",
    fontSize: "12px",
  },
  pillRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  emptyBox: {
    padding: "16px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    fontWeight: "800",
  },
  signoffHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
  },
  signoffBadge: {
    minWidth: "140px",
    borderRadius: "18px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    padding: "14px",
    textAlign: "center",
  },
  signoffStatusRow: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    alignItems: "center",
    margin: "12px 0",
  },
  statusBadge: {
    display: "inline-flex",
    padding: "7px 11px",
    borderRadius: "999px",
    fontWeight: "950",
  },
  savedId: {
    color: "#64748b",
    fontWeight: "850",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
    marginTop: "14px",
  },
  checklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },
  checkItem: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "10px",
    alignItems: "start",
    padding: "12px",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    background: "#f8fafc",
  },
  notesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "12px",
    margin: "14px 0",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: "900px",
    borderCollapse: "collapse",
  },
};
