import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const SIGN_OFF_CHECKLIST_ITEMS = [
  {
    key: "salesChecked",
    label: "Sales records checked",
    note: "Sales totals, receipts, voided sales and discounts have been reviewed.",
  },
  {
    key: "cashChecked",
    label: "Cash collection checked",
    note: "Cash collected and amount paid have been reviewed against records.",
  },
  {
    key: "debtsChecked",
    label: "Customer debts checked",
    note: "Outstanding debts and sales balances have been reviewed.",
  },
  {
    key: "expensesChecked",
    label: "Expenses checked",
    note: "Expense categories, dates, descriptions and amounts have been reviewed.",
  },
  {
    key: "stockChecked",
    label: "Stock and pricing checked",
    note: "Low stock, out-of-stock items and pricing warnings have been reviewed.",
  },
  {
    key: "warningsChecked",
    label: "Audit warnings reviewed",
    note: "Red, orange and blue audit warnings have been read and considered.",
  },
  {
    key: "backupChecked",
    label: "Backup/export pack prepared",
    note: "Audit pack exports or backup documents have been prepared for records.",
  },
];

export default function AuditAccountingPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [debtSummary, setDebtSummary] = useState(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [isMobile, setIsMobile] = useState(false);

  const [periodType, setPeriodType] = useState("month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [signOff, setSignOff] = useState({
    preparedBy: "",
    reviewedBy: "",
    approvedBy: "",
    reviewDate: new Date().toISOString().slice(0, 10),
    accountingStatus: "draft",
    accountantNotes: "",
    bossNotes: "",
    checklist: {
      salesChecked: false,
      cashChecked: false,
      debtsChecked: false,
      expensesChecked: false,
      stockChecked: false,
      warningsChecked: false,
      backupChecked: false,
    },
  });

  const businessName = "Chalin 03 Company Limited";
  const reportName = "Audit & Accounting Intelligence Pro Review";

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

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("en-GB");
  }

  function dateToInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
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

  function getPeriodRange() {
    const today = new Date();

    if (periodType === "all") {
      return {
        start: null,
        end: null,
        label: "All Records",
        shortLabel: "all-records",
      };
    }

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
      const start = customStartDate ? new Date(customStartDate) : null;
      const end = customEndDate ? new Date(customEndDate) : null;

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
    if (!date || Number.isNaN(date.getTime())) {
      return false;
    }

    if (!period.start && !period.end) {
      return true;
    }

    if (period.start && date < period.start) {
      return false;
    }

    if (period.end && date > period.end) {
      return false;
    }

    return true;
  }

  function getSaleDate(sale) {
    return new Date(sale?.created_at || sale?.sale_date || sale?.date);
  }

  function getExpenseDate(expense) {
    return new Date(expense?.expense_date || expense?.created_at || expense?.date);
  }

  function isSaleVoided(sale) {
    return (
      Number(sale?.is_voided || 0) === 1 ||
      String(sale?.sale_status || "").toLowerCase() === "cancelled" ||
      String(sale?.sale_status || "").toLowerCase() === "voided"
    );
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

  async function loadAuditData() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const [productsResponse, salesResponse, debtsResponse, expensesResponse] =
        await Promise.all([
          axiosClient.get("/products"),
          axiosClient.get("/sales"),
          axiosClient.get("/debts/summary"),
          axiosClient.get("/expenses"),
        ]);

      setProducts(productsResponse.data.products || []);
      setSales(salesResponse.data.sales || []);
      setDebtSummary(debtsResponse.data.summary || debtsResponse.data || null);
      setExpenses(expensesResponse.data.expenses || []);

      setMessage("Professional audit and accounting review refreshed.");
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load audit and accounting data."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuditData();
  }, []);

  useEffect(() => {
    function checkScreenSize() {
      setIsMobile(window.innerWidth <= 760);
    }

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => {
      window.removeEventListener("resize", checkScreenSize);
    };
  }, []);

  useEffect(() => {
    try {
      const period = getPeriodRange();
      const key = `chalin03_audit_signoff_${makeFilePrefix(period.shortLabel)}`;
      const saved = window.localStorage.getItem(key);

      if (!saved) {
        setSignOff((current) => ({
          ...current,
          reviewDate: new Date().toISOString().slice(0, 10),
        }));
        return;
      }

      const parsed = JSON.parse(saved);

      setSignOff((current) => ({
        ...current,
        ...parsed,
        checklist: {
          ...current.checklist,
          ...(parsed.checklist || {}),
        },
      }));
    } catch {
      setError("Saved sign-off details could not be loaded for this period.");
    }
  }, [periodType, customStartDate, customEndDate]);

  const auditData = useMemo(() => {
    const period = getPeriodRange();

    const allCompletedSales = sales.filter(isCompletedSale);
    const allVoidedSales = sales.filter(isSaleVoided);

    const completedSales = allCompletedSales.filter((sale) =>
      isDateInsidePeriod(getSaleDate(sale), period)
    );

    const voidedSales = allVoidedSales.filter((sale) =>
      isDateInsidePeriod(getSaleDate(sale), period)
    );

    const periodExpenses = expenses.filter((expense) =>
      isDateInsidePeriod(getExpenseDate(expense), period)
    );

    const totalSales = completedSales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const cashCollected = completedSales.reduce(
      (sum, sale) => sum + Number(sale.amount_paid || 0),
      0
    );

    const salesBalances = completedSales.reduce(
      (sum, sale) => sum + Number(sale.balance || 0),
      0
    );

    const totalDiscounts = completedSales.reduce(
      (sum, sale) => sum + Number(sale.discount_amount || 0),
      0
    );

    const totalExpenses = periodExpenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );

    const fuelExpenses = periodExpenses
      .filter((expense) =>
        String(expense.category || "").toLowerCase().includes("fuel")
      )
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const transportExpenses = periodExpenses
      .filter((expense) =>
        String(expense.category || "").toLowerCase().includes("transport")
      )
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const salaryExpenses = periodExpenses
      .filter((expense) =>
        String(expense.category || "").toLowerCase().includes("salary")
      )
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const outstandingDebts =
      debtSummary?.outstanding_balance ??
      debtSummary?.outstanding_debts ??
      debtSummary?.total_outstanding_balance ??
      debtSummary?.total_balance ??
      0;

    const unpaidDebtCount =
      debtSummary?.unpaid_count ??
      debtSummary?.active_debt_count ??
      debtSummary?.count ??
      0;

    const partialDebtCount = debtSummary?.partial_count ?? 0;
    const overdueDebtCount = debtSummary?.overdue_count ?? 0;

    const lowStockProducts = products.filter(
      (product) =>
        Number(product.quantity || 0) <=
        Number(product.low_stock_threshold || 0)
    );

    const zeroStockProducts = products.filter(
      (product) => Number(product.quantity || 0) <= 0
    );

    const stockValue = products.reduce((sum, product) => {
      return (
        sum +
        Number(product.quantity || 0) * Number(product.selling_price || 0)
      );
    }, 0);

    const stockCostValue = products.reduce((sum, product) => {
      return (
        sum + Number(product.quantity || 0) * Number(product.cost_price || 0)
      );
    }, 0);

    const stockExpectedProfit = Math.max(stockValue - stockCostValue, 0);
    const netCashPosition = cashCollected - totalExpenses;
    const operatingResult = totalSales - totalExpenses;
    const receivablesExposure = Number(outstandingDebts || 0);
    const possibleDebtDifference = Math.abs(receivablesExposure - salesBalances);

    const paymentBreakdown = {
      cash: 0,
      momo: 0,
      bank: 0,
      credit: 0,
      other: 0,
    };

    completedSales.forEach((sale) => {
      const paymentType = getPaymentType(sale);
      const amount = Number(sale.total || 0);

      if (paymentType.includes("cash")) {
        paymentBreakdown.cash += amount;
      } else if (
        paymentType.includes("momo") ||
        paymentType.includes("mobile")
      ) {
        paymentBreakdown.momo += amount;
      } else if (paymentType.includes("bank")) {
        paymentBreakdown.bank += amount;
      } else if (
        paymentType.includes("credit") ||
        Number(sale.balance || 0) > 0
      ) {
        paymentBreakdown.credit += amount;
      } else {
        paymentBreakdown.other += amount;
      }
    });

    const categoryTotals = periodExpenses.reduce((result, expense) => {
      const category = cleanText(expense.category) || "Other";
      result[category] =
        Number(result[category] || 0) + Number(expense.amount || 0);
      return result;
    }, {});

    const topExpenseCategories = Object.entries(categoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const salesExceptions = [];

    completedSales.forEach((sale) => {
      const receiptNumber = sale.receipt_number || `Sale #${sale.id}`;
      const balance = Number(sale.balance || 0);
      const total = Number(sale.total || 0);
      const amountPaid = Number(sale.amount_paid || 0);
      const discount = Number(sale.discount_amount || 0);
      const paymentType = getPaymentType(sale);

      if (!sale.receipt_number) {
        salesExceptions.push({
          severity: "orange",
          title: "Missing receipt number",
          detail: `${receiptNumber} has no receipt number. Confirm the sale record.`,
        });
      }

      if (discount > 0) {
        salesExceptions.push({
          severity: "blue",
          title: "Discount recorded",
          detail: `${receiptNumber} has discount ${formatMoney(
            discount
          )}. Confirm approval.`,
        });
      }

      if (balance > 0 && !paymentType.includes("credit")) {
        salesExceptions.push({
          severity: "orange",
          title: "Balance on non-credit sale",
          detail: `${receiptNumber} has balance ${formatMoney(
            balance
          )} but payment type is ${sale.payment_type || "cash"}.`,
        });
      }

      if (amountPaid > total && total > 0) {
        salesExceptions.push({
          severity: "red",
          title: "Amount paid is higher than total",
          detail: `${receiptNumber} paid ${formatMoney(
            amountPaid
          )} but total is ${formatMoney(total)}.`,
        });
      }

      if (total <= 0) {
        salesExceptions.push({
          severity: "red",
          title: "Zero or invalid sale total",
          detail: `${receiptNumber} has invalid total ${formatMoney(total)}.`,
        });
      }
    });

    const expenseExceptions = [];

    periodExpenses.forEach((expense) => {
      const description = cleanText(expense.description);
      const category = cleanText(expense.category) || "Uncategorized";
      const amount = Number(expense.amount || 0);

      if (amount <= 0) {
        expenseExceptions.push({
          severity: "red",
          title: "Invalid expense amount",
          detail: `${category} expense has invalid amount ${formatMoney(
            amount
          )}.`,
        });
      }

      if (!description) {
        expenseExceptions.push({
          severity: "orange",
          title: "Expense missing description",
          detail: `${category} expense of ${formatMoney(
            amount
          )} has no description.`,
        });
      }

      if (!expense.expense_date && !expense.created_at) {
        expenseExceptions.push({
          severity: "orange",
          title: "Expense missing date",
          detail: `${category} expense of ${formatMoney(amount)} has no date.`,
        });
      }
    });

    const inventoryExceptions = [];

    products.forEach((product) => {
      const name = product.name || `Product #${product.id}`;
      const quantity = Number(product.quantity || 0);
      const cost = Number(product.cost_price || 0);
      const selling = Number(product.selling_price || 0);
      const lowStockLevel = Number(product.low_stock_threshold || 0);

      if (quantity <= 0) {
        inventoryExceptions.push({
          severity: "red",
          title: "Out of stock product",
          detail: `${name} has ${quantity} quantity available.`,
        });
      } else if (quantity <= lowStockLevel) {
        inventoryExceptions.push({
          severity: "orange",
          title: "Low stock product",
          detail: `${name} has ${quantity} left. Low stock level is ${lowStockLevel}.`,
        });
      }

      if (selling <= 0) {
        inventoryExceptions.push({
          severity: "red",
          title: "Invalid selling price",
          detail: `${name} has invalid selling price ${formatMoney(selling)}.`,
        });
      }

      if (cost < 0) {
        inventoryExceptions.push({
          severity: "red",
          title: "Invalid cost price",
          detail: `${name} has invalid cost price ${formatMoney(cost)}.`,
        });
      }

      if (selling > 0 && cost > 0 && selling <= cost) {
        inventoryExceptions.push({
          severity: "orange",
          title: "Possible low/no profit product",
          detail: `${name} selling price ${formatMoney(
            selling
          )} is not above cost ${formatMoney(cost)}.`,
        });
      }

      if (!cleanText(product.barcode)) {
        inventoryExceptions.push({
          severity: "blue",
          title: "Product without barcode",
          detail: `${name} has no barcode. This may slow down stock control.`,
        });
      }
    });

    const auditFlags = [];

    function addFlag(severity, title, detail, recommendation) {
      auditFlags.push({
        severity,
        title,
        detail,
        recommendation,
      });
    }

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
        "Auditor or boss should review who voided them, why they were voided, and whether cash was affected."
      );
    }

    if (Number(outstandingDebts || 0) > 0) {
      addFlag(
        overdueDebtCount > 0 ? "red" : "orange",
        "Outstanding customer debts",
        `${formatMoney(
          outstandingDebts
        )} is currently unpaid across customer debt records.`,
        "Follow up customers, reconcile with sales balances, and send WhatsApp reminders where necessary."
      );
    }

    if (possibleDebtDifference > 1) {
      addFlag(
        "orange",
        "Debt reconciliation difference",
        `Debt summary differs from period sales balances by about ${formatMoney(
          possibleDebtDifference
        )}.`,
        "Compare debt records with sales balances and payment records."
      );
    }

    if (totalExpenses > cashCollected && totalExpenses > 0) {
      addFlag(
        "red",
        "Period expenses exceed cash collected",
        `Selected period expenses ${formatMoney(
          totalExpenses
        )} are higher than cash collected ${formatMoney(cashCollected)}.`,
        "Review expense records, confirm supporting receipts, and compare with daily closing."
      );
    }

    if (totalDiscounts > 0) {
      addFlag(
        "blue",
        "Discount activity detected",
        `${formatMoney(totalDiscounts)} total discount was recorded in the selected period.`,
        "Confirm discounts were approved by management and not used to hide pricing errors."
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
        "Review urgent restock needs and check whether stock entries are correct."
      );
    }

    if (fuelExpenses > 0) {
      addFlag(
        "blue",
        "Fuel expense category active",
        `${formatMoney(fuelExpenses)} has been recorded as fuel expense in the selected period.`,
        "Fuel expenses should be reviewed separately and supported with receipts where possible."
      );
    }

    salesExceptions.slice(0, 8).forEach((item) => {
      addFlag(
        item.severity,
        item.title,
        item.detail,
        "Review the sale record and correct it if necessary."
      );
    });

    expenseExceptions.slice(0, 8).forEach((item) => {
      addFlag(
        item.severity,
        item.title,
        item.detail,
        "Add missing details or correct the expense record."
      );
    });

    inventoryExceptions.slice(0, 8).forEach((item) => {
      addFlag(
        item.severity,
        item.title,
        item.detail,
        "Review product setup, stock count and pricing."
      );
    });

    if (auditFlags.length === 0) {
      addFlag(
        "green",
        "No major audit issue detected",
        `The system currently shows no major warning for ${period.label}.`,
        "Continue daily closing, backup and regular stock checking."
      );
    }

    const accountingChecklist = [
      {
        title: "Period selected",
        status: Boolean(period.label),
        note: `Review period: ${period.label}.`,
      },
      {
        title: "Sales completeness",
        status: completedSales.length > 0,
        note: `${completedSales.length} completed sale(s) found in the selected period.`,
      },
      {
        title: "Cash collection review",
        status: cashCollected >= 0,
        note: `${formatMoney(cashCollected)} recorded as amount paid in the selected period.`,
      },
      {
        title: "Debt reconciliation",
        status: Number(outstandingDebts || 0) <= 0 && salesBalances <= 0,
        note:
          Number(outstandingDebts || 0) > 0 || salesBalances > 0
            ? `${formatMoney(
                outstandingDebts
              )} current outstanding debt and ${formatMoney(
                salesBalances
              )} period sales balance detected.`
            : "No outstanding debt detected.",
      },
      {
        title: "Expense documentation",
        status: expenseExceptions.length === 0,
        note:
          expenseExceptions.length > 0
            ? `${expenseExceptions.length} expense issue(s) need attention in the selected period.`
            : "No expense documentation issue detected in the selected period.",
      },
      {
        title: "Inventory pricing review",
        status:
          inventoryExceptions.filter((item) => item.severity === "red")
            .length === 0,
        note:
          inventoryExceptions.length > 0
            ? `${inventoryExceptions.length} inventory issue(s) detected.`
            : "No inventory warning detected.",
      },
      {
        title: "Voided sales review",
        status: voidedSales.length === 0,
        note:
          voidedSales.length > 0
            ? `${voidedSales.length} voided/cancelled sale(s) need review.`
            : "No voided/cancelled sales detected in the selected period.",
      },
      {
        title: "Discount approval review",
        status: totalDiscounts <= 0,
        note:
          totalDiscounts > 0
            ? `${formatMoney(totalDiscounts)} discounts should be approved.`
            : "No discount recorded in the selected period.",
      },
    ];

    const redFlags = auditFlags.filter((flag) => flag.severity === "red").length;
    const orangeFlags = auditFlags.filter(
      (flag) => flag.severity === "orange"
    ).length;
    const blueFlags = auditFlags.filter(
      (flag) => flag.severity === "blue"
    ).length;

    const riskScore = Math.min(
      100,
      redFlags * 20 + orangeFlags * 10 + blueFlags * 4
    );

    const auditScore = Math.max(0, 100 - riskScore);

    let auditStatus = "Needs Review";
    let auditTone = "red";

    if (auditScore >= 85) {
      auditStatus = "Clean";
      auditTone = "green";
    } else if (auditScore >= 70) {
      auditStatus = "Acceptable";
      auditTone = "blue";
    } else if (auditScore >= 50) {
      auditStatus = "Watch Closely";
      auditTone = "orange";
    }

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
        implication:
          "The reviewed information did not produce a major audit warning.",
        recommendation:
          "Continue using daily closing, backups, debt follow-up and stock checks.",
      });
    }

    const accountantSummary = [
      {
        label: "Selected Period",
        value: period.label,
        meaning: "Accounting/audit period currently being reviewed.",
        isText: true,
      },
      {
        label: "Total Sales Revenue",
        value: totalSales,
        meaning: "Completed sales value recorded within the selected period.",
      },
      {
        label: "Cash Collected",
        value: cashCollected,
        meaning: "Amount recorded as paid by customers within the selected period.",
      },
      {
        label: "Customer Receivables",
        value: outstandingDebts,
        meaning: "Current unpaid customer debts requiring follow-up.",
      },
      {
        label: "Total Expenses",
        value: totalExpenses,
        meaning: "Business costs recorded within the selected period.",
      },
      {
        label: "Operating Result",
        value: operatingResult,
        meaning: "Period sales minus period expenses. This is not final tax profit.",
      },
      {
        label: "Inventory Selling Value",
        value: stockValue,
        meaning: "Current estimated selling value of stock on hand.",
      },
      {
        label: "Inventory Cost Value",
        value: stockCostValue,
        meaning: "Current estimated cost value of stock on hand.",
      },
      {
        label: "Expected Stock Margin",
        value: stockExpectedProfit,
        meaning: "Current estimated stock selling value minus cost value.",
      },
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
      stock_value: plainMoney(
        Number(product.quantity || 0) * Number(product.selling_price || 0)
      ),
    }));

    return {
      period,
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
      netCashPosition,
      operatingResult,
      receivablesExposure,
      possibleDebtDifference,
      paymentBreakdown,
      topExpenseCategories,
      salesExceptions,
      expenseExceptions,
      inventoryExceptions,
      auditFlags,
      accountingChecklist,
      redFlags,
      orangeFlags,
      blueFlags,
      auditScore,
      auditStatus,
      auditTone,
      managementLetterPoints,
      accountantSummary,
      accessSalesRows,
      accessExpenseRows,
      accessProductRows,
    };
  }, [
    products,
    sales,
    expenses,
    debtSummary,
    periodType,
    customStartDate,
    customEndDate,
  ]);

  function makeCsv(rows) {
    if (!rows || rows.length === 0) {
      return "";
    }

    const headers = Object.keys(rows[0]);

    const escapeCsv = (value) => {
      const text = String(value ?? "");
      const escaped = text.replaceAll('"', '""');
      return `"${escaped}"`;
    };

    const lines = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) =>
        headers.map((header) => escapeCsv(row[header])).join(",")
      ),
    ];

    return `\uFEFF${lines.join("\n")}`;
  }

  function downloadTextFile(filename, content, type = "text/plain") {
    const blob = new Blob([content], {
      type,
    });

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

  function downloadCsv(filename, rows) {
    const csv = makeCsv(rows);

    if (!csv) {
      setError("No data available for this export.");
      return;
    }

    downloadTextFile(filename, csv, "text/csv;charset=utf-8");
    setMessage(`${filename} downloaded successfully.`);
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
        <body>
          ${htmlContent}
        </body>
      </html>
    `;

    downloadTextFile(
      filename,
      wordDocument,
      "application/msword;charset=utf-8"
    );
  }

  function downloadPowerPointFile(filename, htmlContent) {
    const pptDocument = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:p="urn:schemas-microsoft-com:office:powerpoint"
            xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="UTF-8" />
          <meta name="ProgId" content="PowerPoint.Show" />
          <meta name="Generator" content="Chalin 03 System" />
        </head>
        <body>
          ${htmlContent}
        </body>
      </html>
    `;

    downloadTextFile(
      filename,
      pptDocument,
      "application/vnd.ms-powerpoint;charset=utf-8"
    );
  }

  function fileName(base, extension) {
    const period = makeFilePrefix(auditData.period.shortLabel);
    return `${base}_${period}.${extension}`;
  }

  function getSignOffStorageKey() {
    return `chalin03_audit_signoff_${makeFilePrefix(auditData.period.shortLabel)}`;
  }

  function updateSignOffField(field, value) {
    setSignOff((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateSignOffChecklist(field, value) {
    setSignOff((current) => ({
      ...current,
      checklist: {
        ...current.checklist,
        [field]: value,
      },
    }));
  }

  function saveSignOffDetails() {
    try {
      const payload = {
        ...signOff,
        periodLabel: auditData.period.label,
        periodShortLabel: auditData.period.shortLabel,
        auditScore: auditData.auditScore,
        auditStatus: auditData.auditStatus,
        savedAt: new Date().toISOString(),
      };

      window.localStorage.setItem(getSignOffStorageKey(), JSON.stringify(payload));
      setMessage("Audit sign-off details saved for the selected period.");
    } catch {
      setError("Could not save audit sign-off details on this browser.");
    }
  }

  function clearSignOffDetails() {
    const confirmed = window.confirm(
      "Clear the sign-off details for this selected period?"
    );

    if (!confirmed) {
      return;
    }

    try {
      window.localStorage.removeItem(getSignOffStorageKey());
      setSignOff({
        preparedBy: "",
        reviewedBy: "",
        approvedBy: "",
        reviewDate: new Date().toISOString().slice(0, 10),
        accountingStatus: "draft",
        accountantNotes: "",
        bossNotes: "",
        checklist: {
          salesChecked: false,
          cashChecked: false,
          debtsChecked: false,
          expensesChecked: false,
          stockChecked: false,
          warningsChecked: false,
          backupChecked: false,
        },
      });
      setMessage("Audit sign-off details cleared for this period.");
    } catch {
      setError("Could not clear sign-off details.");
    }
  }

  function getSignOffStatusLabel(status) {
    if (status === "reviewed") return "Reviewed by Accountant";
    if (status === "approved") return "Approved by Management";
    if (status === "locked") return "Final / Locked for Filing";
    return "Draft / Not Yet Approved";
  }

  function getSignOffCompletion() {
    const checkedCount = SIGN_OFF_CHECKLIST_ITEMS.filter(
      (item) => signOff.checklist?.[item.key]
    ).length;

    const requiredNames = [signOff.preparedBy, signOff.reviewedBy, signOff.approvedBy].filter(
      (value) => cleanText(value)
    ).length;

    const totalItems = SIGN_OFF_CHECKLIST_ITEMS.length + 3;
    const completedItems = checkedCount + requiredNames;
    const percent = Math.round((completedItems / totalItems) * 100);

    return {
      checkedCount,
      totalChecks: SIGN_OFF_CHECKLIST_ITEMS.length,
      requiredNames,
      completedItems,
      totalItems,
      percent,
      ready:
        checkedCount === SIGN_OFF_CHECKLIST_ITEMS.length &&
        requiredNames === 3 &&
        cleanText(signOff.reviewDate),
    };
  }

  function downloadAuditSummaryCsv() {
    const rows = auditData.accountantSummary.map((item) => ({
      item: item.label,
      amount: item.isText ? item.value : plainMoney(item.value),
      meaning: item.meaning,
    }));

    rows.push(
      {
        item: "Audit Score",
        amount: `${auditData.auditScore}%`,
        meaning: auditData.auditStatus,
      },
      {
        item: "Red Flags",
        amount: auditData.redFlags,
        meaning: "High risk audit warnings.",
      },
      {
        item: "Orange Flags",
        amount: auditData.orangeFlags,
        meaning: "Medium risk audit warnings.",
      },
      {
        item: "Blue Flags",
        amount: auditData.blueFlags,
        meaning: "Information or review notes.",
      }
    );

    downloadCsv(fileName("chalin03_accounting_summary_excel", "csv"), rows);
  }

  function downloadAuditWarningsCsv() {
    const rows = auditData.auditFlags.map((flag, index) => ({
      number: index + 1,
      period: auditData.period.label,
      severity: flag.severity,
      title: flag.title,
      detail: flag.detail,
      recommendation: flag.recommendation,
    }));

    downloadCsv(fileName("chalin03_audit_warnings_excel", "csv"), rows);
  }

  function downloadManagementLetterCsv() {
    const rows = auditData.managementLetterPoints.map((point) => ({
      number: point.number,
      period: auditData.period.label,
      finding: point.finding,
      implication: point.implication,
      recommendation: point.recommendation,
    }));

    downloadCsv(fileName("chalin03_management_letter_excel", "csv"), rows);
  }

  function downloadExcelWorkbookCsv() {
    const rows = [
      ...auditData.accountantSummary.map((item) => ({
        period: auditData.period.label,
        section: "Accounting Summary",
        item: item.label,
        amount: item.isText ? item.value : plainMoney(item.value),
        note: item.meaning,
      })),
      ...auditData.auditFlags.map((flag) => ({
        period: auditData.period.label,
        section: "Audit Warning",
        item: flag.title,
        amount: "",
        note: `${flag.detail} Recommendation: ${flag.recommendation}`,
      })),
      ...auditData.topExpenseCategories.map((expense) => ({
        period: auditData.period.label,
        section: "Expense Category",
        item: expense.category,
        amount: plainMoney(expense.amount),
        note: "Expense category total",
      })),
    ];

    downloadCsv(fileName("chalin03_accounting_workbook_excel", "csv"), rows);
  }

  function downloadAccessImportFiles() {
    downloadCsv(fileName("access_import_sales_table", "csv"), auditData.accessSalesRows);

    setTimeout(() => {
      downloadCsv(
        fileName("access_import_expenses_table", "csv"),
        auditData.accessExpenseRows
      );
    }, 300);

    setTimeout(() => {
      downloadCsv(
        fileName("access_import_products_table", "csv"),
        auditData.accessProductRows
      );
    }, 600);

    setTimeout(() => {
      downloadAccessGuideWord();
    }, 900);

    setMessage(
      "Access import files are downloading. Import the CSV files into Microsoft Access as tables."
    );
  }

  function buildPowerPointOutline() {
    const lines = [
      "CHALIN 03 COMPANY LIMITED",
      "AUDIT & ACCOUNTING POWERPOINT BRIEFING OUTLINE",
      "",
      "Slide 1: Title",
      `${businessName} - Audit & Accounting Review`,
      `Period: ${auditData.period.label}`,
      `Generated: ${formatDateTime(new Date())}`,
      "",
      "Slide 2: Audit Health Score",
      `Audit Score: ${auditData.auditScore}%`,
      `Status: ${auditData.auditStatus}`,
      `Red Flags: ${auditData.redFlags}`,
      `Orange Flags: ${auditData.orangeFlags}`,
      `Blue Flags: ${auditData.blueFlags}`,
      "",
      "Slide 3: Accounting Summary",
      ...auditData.accountantSummary.map((item) =>
        item.isText
          ? `- ${item.label}: ${item.value}`
          : `- ${item.label}: ${formatMoney(item.value)}`
      ),
      "",
      "Slide 4: Cash & Debt Reconciliation",
      `Cash Collected: ${formatMoney(auditData.cashCollected)}`,
      `Outstanding Debts: ${formatMoney(auditData.outstandingDebts)}`,
      `Sales Balances: ${formatMoney(auditData.salesBalances)}`,
      `Possible Difference: ${formatMoney(auditData.possibleDebtDifference)}`,
      "",
      "Slide 5: Expense Analysis",
      `Total Expenses: ${formatMoney(auditData.totalExpenses)}`,
      `Fuel Expenses: ${formatMoney(auditData.fuelExpenses)}`,
      `Transport Expenses: ${formatMoney(auditData.transportExpenses)}`,
      `Salary Expenses: ${formatMoney(auditData.salaryExpenses)}`,
      "",
      "Slide 6: Inventory Audit",
      `Stock Value: ${formatMoney(auditData.stockValue)}`,
      `Stock Cost Value: ${formatMoney(auditData.stockCostValue)}`,
      `Low Stock Products: ${auditData.lowStockProducts.length}`,
      `Out of Stock Products: ${auditData.zeroStockProducts.length}`,
      "",
      "Slide 7: Main Audit Warnings",
      ...auditData.auditFlags
        .slice(0, 8)
        .map((flag) => `- ${flag.title}: ${flag.detail}`),
      "",
      "Slide 8: Management Recommendations",
      ...auditData.managementLetterPoints
        .slice(0, 8)
        .map((point) => `- ${point.recommendation}`),
      "",
      "Note: This is a PowerPoint-ready outline. Copy it into PowerPoint slides.",
    ];

    return lines.join("\n");
  }

  function downloadPowerPointOutlineText() {
    downloadTextFile(
      fileName("chalin03_powerpoint_audit_briefing_outline", "txt"),
      buildPowerPointOutline(),
      "text/plain;charset=utf-8"
    );

    setMessage("PowerPoint outline text file downloaded successfully.");
  }

  function buildPowerPointDocument() {
    const warnings = auditData.auditFlags
      .slice(0, 7)
      .map(
        (flag) =>
          `<li><strong>${escapeHtml(flag.title)}:</strong> ${escapeHtml(
            flag.detail
          )}</li>`
      )
      .join("");

    const recommendations = auditData.managementLetterPoints
      .slice(0, 7)
      .map((point) => `<li>${escapeHtml(point.recommendation)}</li>`)
      .join("");

    return `
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f1f5f9;
          color: #111827;
        }

        .slide {
          width: 960px;
          min-height: 540px;
          background: #ffffff;
          margin: 20px auto;
          padding: 46px;
          border-radius: 18px;
          box-sizing: border-box;
          page-break-after: always;
          border: 1px solid #dbe3ef;
        }

        .cover {
          background: #07182c;
          color: #ffffff;
        }

        h1 {
          color: #07182c;
          font-size: 42px;
          margin: 0 0 16px;
        }

        .cover h1 {
          color: #ffffff;
        }

        h2 {
          color: #07182c;
          font-size: 34px;
          margin: 0 0 20px;
        }

        .cover h2 {
          color: #e0ba28;
        }

        p,
        li {
          font-size: 22px;
          line-height: 1.4;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 18px;
        }

        .box {
          border: 1px solid #dbe3ef;
          border-radius: 14px;
          padding: 18px;
          background: #f8fafc;
        }

        .box span {
          display: block;
          color: #64748b;
          font-size: 18px;
        }

        .box strong {
          display: block;
          margin-top: 8px;
          font-size: 28px;
          color: #07182c;
        }
      </style>

      <div class="slide cover">
        <h1>${escapeHtml(businessName)}</h1>
        <h2>Audit & Accounting Briefing</h2>
        <p>Period: ${escapeHtml(auditData.period.label)}</p>
        <p>Generated: ${escapeHtml(formatDateTime(new Date()))}</p>
        <p>Audit Score: ${auditData.auditScore}% - ${escapeHtml(
          auditData.auditStatus
        )}</p>
      </div>

      <div class="slide">
        <h1>Audit Health Score</h1>
        <div class="grid">
          <div class="box"><span>Audit Score</span><strong>${auditData.auditScore}%</strong></div>
          <div class="box"><span>Status</span><strong>${escapeHtml(
            auditData.auditStatus
          )}</strong></div>
          <div class="box"><span>Red Flags</span><strong>${auditData.redFlags}</strong></div>
          <div class="box"><span>Orange Flags</span><strong>${auditData.orangeFlags}</strong></div>
        </div>
      </div>

      <div class="slide">
        <h1>Accounting Summary</h1>
        <div class="grid">
          <div class="box"><span>Period Sales</span><strong>${formatMoney(
            auditData.totalSales
          )}</strong></div>
          <div class="box"><span>Cash Collected</span><strong>${formatMoney(
            auditData.cashCollected
          )}</strong></div>
          <div class="box"><span>Outstanding Debts</span><strong>${formatMoney(
            auditData.outstandingDebts
          )}</strong></div>
          <div class="box"><span>Period Expenses</span><strong>${formatMoney(
            auditData.totalExpenses
          )}</strong></div>
        </div>
      </div>

      <div class="slide">
        <h1>Expense & Stock Review</h1>
        <div class="grid">
          <div class="box"><span>Fuel Expenses</span><strong>${formatMoney(
            auditData.fuelExpenses
          )}</strong></div>
          <div class="box"><span>Stock Value</span><strong>${formatMoney(
            auditData.stockValue
          )}</strong></div>
          <div class="box"><span>Low Stock Items</span><strong>${
            auditData.lowStockProducts.length
          }</strong></div>
          <div class="box"><span>Out of Stock Items</span><strong>${
            auditData.zeroStockProducts.length
          }</strong></div>
        </div>
      </div>

      <div class="slide">
        <h1>Main Audit Warnings</h1>
        <ul>${warnings || "<li>No major audit warning detected.</li>"}</ul>
      </div>

      <div class="slide">
        <h1>Management Recommendations</h1>
        <ul>${recommendations}</ul>
      </div>
    `;
  }

  function downloadPowerPointPresentation() {
    downloadPowerPointFile(
      fileName("chalin03_audit_accounting_briefing", "ppt"),
      buildPowerPointDocument()
    );

    setMessage(
      "PowerPoint briefing downloaded. Microsoft PowerPoint may show a file format warning; choose Yes/Open."
    );
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

    const checklistRows = auditData.accountingChecklist
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.title)}</td>
            <td>${item.status ? "Passed" : "Needs Review"}</td>
            <td>${escapeHtml(item.note)}</td>
          </tr>
        `
      )
      .join("");

    const managementRows = auditData.managementLetterPoints
      .map(
        (point) => `
          <tr>
            <td>${point.number}</td>
            <td>${escapeHtml(point.finding)}</td>
            <td>${escapeHtml(point.implication)}</td>
            <td>${escapeHtml(point.recommendation)}</td>
          </tr>
        `
      )
      .join("");

    const signOffRows = SIGN_OFF_CHECKLIST_ITEMS.map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.label)}</td>
          <td>${signOff.checklist?.[item.key] ? "Checked" : "Pending"}</td>
          <td>${escapeHtml(item.note)}</td>
        </tr>
      `
    ).join("");

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>${escapeHtml(reportName)}</title>
          <style>
            @page {
              size: A4;
              margin: 14mm;
            }

            body {
              font-family: Arial, sans-serif;
              color: #111827;
              line-height: 1.45;
              font-size: 12px;
            }

            h1 {
              margin: 0;
              color: #07182c;
              font-size: 24px;
            }

            h2 {
              margin-top: 24px;
              color: #07182c;
              border-bottom: 2px solid #e0ba28;
              padding-bottom: 6px;
            }

            .muted {
              color: #64748b;
            }

            .header {
              display: flex;
              justify-content: space-between;
              gap: 20px;
              border-bottom: 3px solid #07182c;
              padding-bottom: 12px;
              margin-bottom: 16px;
            }

            .score {
              border: 2px solid #e0ba28;
              border-radius: 12px;
              padding: 10px;
              min-width: 150px;
              text-align: center;
            }

            .score strong {
              display: block;
              font-size: 24px;
              color: #07182c;
            }

            .grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 8px;
              margin: 14px 0;
            }

            .box {
              border: 1px solid #dbe3ef;
              border-radius: 10px;
              padding: 8px;
              background: #f8fafc;
            }

            .box span {
              display: block;
              color: #64748b;
              font-size: 11px;
            }

            .box strong {
              display: block;
              margin-top: 4px;
              color: #07182c;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              page-break-inside: auto;
            }

            th,
            td {
              border: 1px solid #dbe3ef;
              padding: 7px;
              text-align: left;
              vertical-align: top;
              font-size: 11px;
            }

            th {
              background: #07182c;
              color: #ffffff;
            }

            tr {
              page-break-inside: avoid;
            }

            .notice {
              background: #fff7ed;
              border: 1px solid #fed7aa;
              border-radius: 10px;
              padding: 10px;
              margin-top: 14px;
              color: #9a3412;
            }

            .footer {
              margin-top: 28px;
              color: #64748b;
              font-size: 10px;
              border-top: 1px solid #dbe3ef;
              padding-top: 8px;
            }
          </style>
        </head>

        <body>
          <div class="header">
            <div>
              <h1>${escapeHtml(businessName)}</h1>
              <p class="muted">${escapeHtml(reportName)}</p>
              <p><strong>Period:</strong> ${escapeHtml(auditData.period.label)}</p>
              <p><strong>Generated:</strong> ${escapeHtml(
                formatDateTime(new Date())
              )}</p>
            </div>

            <div class="score">
              <span>Audit Score</span>
              <strong>${auditData.auditScore}%</strong>
              <span>${escapeHtml(auditData.auditStatus)}</span>
            </div>
          </div>

          <div class="grid">
            <div class="box"><span>Period Sales</span><strong>${formatMoney(
              auditData.totalSales
            )}</strong></div>
            <div class="box"><span>Cash Collected</span><strong>${formatMoney(
              auditData.cashCollected
            )}</strong></div>
            <div class="box"><span>Outstanding Debts</span><strong>${formatMoney(
              auditData.outstandingDebts
            )}</strong></div>
            <div class="box"><span>Period Expenses</span><strong>${formatMoney(
              auditData.totalExpenses
            )}</strong></div>
            <div class="box"><span>Fuel Expenses</span><strong>${formatMoney(
              auditData.fuelExpenses
            )}</strong></div>
            <div class="box"><span>Discounts</span><strong>${formatMoney(
              auditData.totalDiscounts
            )}</strong></div>
            <div class="box"><span>Stock Value</span><strong>${formatMoney(
              auditData.stockValue
            )}</strong></div>
            <div class="box"><span>Operating Result</span><strong>${formatMoney(
              auditData.operatingResult
            )}</strong></div>
          </div>

          <div class="notice">
            This report is a system-generated internal review. It supports management,
            accounting and audit preparation, but it does not replace a licensed
            accountant or external auditor.
          </div>

          <h2>1. Accounting Summary</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Amount / Detail</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>${summaryRows}</tbody>
          </table>

          <h2>2. Audit Risk Register</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Risk</th>
                <th>Finding</th>
                <th>Details</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>${flagsRows}</tbody>
          </table>

          <h2>3. Accountant Checklist</h2>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>${checklistRows}</tbody>
          </table>

          <h2>4. Management Letter Points</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Finding</th>
                <th>Implication</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>${managementRows}</tbody>
          </table>

          <h2>5. Audit Sign-Off & Approval</h2>
          <div class="grid">
            <div class="box"><span>Prepared By</span><strong>${escapeHtml(
              signOff.preparedBy || "Not provided"
            )}</strong></div>
            <div class="box"><span>Reviewed By</span><strong>${escapeHtml(
              signOff.reviewedBy || "Not provided"
            )}</strong></div>
            <div class="box"><span>Approved By</span><strong>${escapeHtml(
              signOff.approvedBy || "Not provided"
            )}</strong></div>
            <div class="box"><span>Status</span><strong>${escapeHtml(
              getSignOffStatusLabel(signOff.accountingStatus)
            )}</strong></div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Sign-Off Check</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>${signOffRows}</tbody>
          </table>

          <p><strong>Review Date:</strong> ${escapeHtml(
            formatDate(signOff.reviewDate)
          )}</p>
          <p><strong>Accountant Notes:</strong> ${escapeHtml(
            signOff.accountantNotes || "-"
          )}</p>
          <p><strong>Boss Approval Notes:</strong> ${escapeHtml(
            signOff.bossNotes || "-"
          )}</p>

          <div class="footer">
            Powered by Chalin 03 Sales & Inventory Management System.
          </div>
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

  function downloadHtmlAuditReport() {
    downloadTextFile(
      fileName("chalin03_professional_audit_report", "html"),
      buildPrintableReport(),
      "text/html;charset=utf-8"
    );

    setMessage("HTML audit report downloaded successfully.");
  }

  function downloadAuditReportWord() {
    downloadWordFile(
      fileName("chalin03_professional_audit_report", "doc"),
      buildPrintableReport()
    );

    setMessage("Audit Report Word document downloaded successfully.");
  }

  function buildManagementLetterDocument() {
    const managementRows = auditData.managementLetterPoints
      .map(
        (point) => `
          <tr>
            <td>${point.number}</td>
            <td>${escapeHtml(point.finding)}</td>
            <td>${escapeHtml(point.implication)}</td>
            <td>${escapeHtml(point.recommendation)}</td>
          </tr>
        `
      )
      .join("");

    const warningRows = auditData.auditFlags
      .filter((flag) => flag.severity !== "green")
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

    return `
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #111827;
          line-height: 1.55;
          font-size: 13px;
        }

        h1 {
          color: #07182c;
          margin-bottom: 4px;
        }

        h2 {
          color: #07182c;
          margin-top: 24px;
          border-bottom: 2px solid #e0ba28;
          padding-bottom: 6px;
        }

        .muted {
          color: #64748b;
        }

        .box {
          border: 1px solid #dbe3ef;
          background: #f8fafc;
          padding: 14px;
          border-radius: 10px;
          margin: 16px 0;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }

        th,
        td {
          border: 1px solid #dbe3ef;
          padding: 8px;
          text-align: left;
          vertical-align: top;
          font-size: 12px;
        }

        th {
          background: #07182c;
          color: #ffffff;
        }

        .signature {
          margin-top: 40px;
        }

        .line {
          margin-top: 36px;
          border-top: 1px solid #111827;
          width: 280px;
          padding-top: 6px;
        }
      </style>

      <h1>${escapeHtml(businessName)}</h1>
      <p class="muted">Management Letter - Audit & Accounting Review</p>
      <p><strong>Period:</strong> ${escapeHtml(auditData.period.label)}</p>
      <p><strong>Generated:</strong> ${escapeHtml(formatDateTime(new Date()))}</p>

      <div class="box">
        <strong>Audit Score:</strong> ${auditData.auditScore}% - ${escapeHtml(
          auditData.auditStatus
        )}<br />
        <strong>Red Flags:</strong> ${auditData.redFlags}<br />
        <strong>Orange Flags:</strong> ${auditData.orangeFlags}<br />
        <strong>Blue Flags:</strong> ${auditData.blueFlags}
      </div>

      <h2>Introduction</h2>
      <p>
        This management letter summarizes key observations generated from the
        Chalin 03 Sales & Inventory Management System for the selected accounting
        period. It highlights issues relating to sales, cash collection, customer
        debts, expenses, stock, discounts, inventory pricing and operational controls.
      </p>

      <h2>Main Management Letter Points</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Finding</th>
            <th>Implication</th>
            <th>Recommendation</th>
          </tr>
        </thead>

        <tbody>
          ${managementRows}
        </tbody>
      </table>

      <h2>Detailed Audit Warnings</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Risk Level</th>
            <th>Finding</th>
            <th>Details</th>
            <th>Recommendation</th>
          </tr>
        </thead>

        <tbody>
          ${
            warningRows ||
            `<tr><td colspan="5">No major audit warning detected.</td></tr>`
          }
        </tbody>
      </table>

      <h2>Management Responsibility</h2>
      <p>
        Management should review the issues above, correct wrong entries where
        necessary, support expenses with receipts, reconcile customer debts,
        review stock levels and confirm that discounts and voided sales were
        properly approved.
      </p>

      <h2>Important Note</h2>
      <p>
        This document is generated by the system to support internal review.
        It does not replace a licensed accountant, tax consultant or external
        auditor.
      </p>

      <div class="signature">
        <div class="line">Prepared / Reviewed By</div>
        <div class="line">Management Approval</div>
      </div>
    `;
  }

  function downloadManagementLetterWord() {
    downloadWordFile(
      fileName("chalin03_management_letter", "doc"),
      buildManagementLetterDocument()
    );

    setMessage("Management Letter Word document downloaded successfully.");
  }

  function buildAccessGuideDocument() {
    return `
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #111827;
          line-height: 1.6;
          font-size: 13px;
        }

        h1 {
          color: #07182c;
        }

        h2 {
          color: #07182c;
          margin-top: 22px;
        }

        li {
          margin-bottom: 8px;
        }

        .box {
          background: #f8fafc;
          border: 1px solid #dbe3ef;
          padding: 14px;
          border-radius: 10px;
        }
      </style>

      <h1>${escapeHtml(businessName)}</h1>
      <p>Microsoft Access Import Guide</p>
      <p><strong>Period:</strong> ${escapeHtml(auditData.period.label)}</p>
      <p><strong>Generated:</strong> ${escapeHtml(formatDateTime(new Date()))}</p>

      <div class="box">
        <strong>Files Generated:</strong>
        <ul>
          <li>access_import_sales_table CSV</li>
          <li>access_import_expenses_table CSV</li>
          <li>access_import_products_table CSV</li>
        </ul>
      </div>

      <h2>How To Use In Microsoft Access</h2>
      <ol>
        <li>Open Microsoft Access.</li>
        <li>Create a blank database.</li>
        <li>Go to External Data.</li>
        <li>Choose New Data Source or Text File.</li>
        <li>Select one CSV file at a time.</li>
        <li>Import each CSV as a new table.</li>
        <li>Name the tables Sales, Expenses and Products.</li>
      </ol>

      <h2>Important Note</h2>
      <p>
        CSV files may open in Excel when double-clicked on Windows. That is normal.
        For Access, do not just double-click the file. Import the CSV files from
        inside Microsoft Access.
      </p>
    `;
  }

  function downloadAccessGuideWord() {
    downloadWordFile(
      fileName("chalin03_access_import_guide", "doc"),
      buildAccessGuideDocument()
    );
  }

  function buildSignOffCertificateDocument() {
    const completion = getSignOffCompletion();

    const checklistRows = SIGN_OFF_CHECKLIST_ITEMS.map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.label)}</td>
          <td>${signOff.checklist?.[item.key] ? "Checked" : "Pending"}</td>
          <td>${escapeHtml(item.note)}</td>
        </tr>
      `
    ).join("");

    return `
      <style>
        body {
          font-family: Arial, sans-serif;
          color: #111827;
          line-height: 1.6;
          font-size: 13px;
        }

        h1 {
          color: #07182c;
          text-align: center;
          margin-bottom: 4px;
        }

        h2 {
          color: #07182c;
          margin-top: 22px;
          border-bottom: 2px solid #e0ba28;
          padding-bottom: 6px;
        }

        .certificate {
          border: 4px solid #07182c;
          padding: 26px;
        }

        .muted {
          color: #64748b;
          text-align: center;
        }

        .status {
          background: #fef3c7;
          border: 1px solid #e0ba28;
          padding: 14px;
          border-radius: 10px;
          text-align: center;
          margin: 18px 0;
          font-weight: bold;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin: 16px 0;
        }

        .box {
          border: 1px solid #dbe3ef;
          background: #f8fafc;
          padding: 12px;
          border-radius: 10px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }

        th,
        td {
          border: 1px solid #dbe3ef;
          padding: 8px;
          text-align: left;
          vertical-align: top;
          font-size: 12px;
        }

        th {
          background: #07182c;
          color: #ffffff;
        }

        .signature-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-top: 46px;
        }

        .signature-line {
          border-top: 1px solid #111827;
          padding-top: 8px;
          text-align: center;
        }
      </style>

      <div class="certificate">
        <h1>${escapeHtml(businessName)}</h1>
        <p class="muted">Audit Sign-Off & Accounting Approval Certificate</p>

        <div class="status">
          ${escapeHtml(getSignOffStatusLabel(signOff.accountingStatus))}<br />
          Completion: ${completion.percent}%
        </div>

        <div class="grid">
          <div class="box"><strong>Accounting Period:</strong><br />${escapeHtml(
            auditData.period.label
          )}</div>
          <div class="box"><strong>Review Date:</strong><br />${escapeHtml(
            formatDate(signOff.reviewDate)
          )}</div>
          <div class="box"><strong>Audit Score:</strong><br />${auditData.auditScore}% - ${escapeHtml(
            auditData.auditStatus
          )}</div>
          <div class="box"><strong>Generated:</strong><br />${escapeHtml(
            formatDateTime(new Date())
          )}</div>
        </div>

        <h2>Approval Names</h2>
        <div class="grid">
          <div class="box"><strong>Prepared By:</strong><br />${escapeHtml(
            signOff.preparedBy || "Not provided"
          )}</div>
          <div class="box"><strong>Reviewed By:</strong><br />${escapeHtml(
            signOff.reviewedBy || "Not provided"
          )}</div>
          <div class="box"><strong>Approved By:</strong><br />${escapeHtml(
            signOff.approvedBy || "Not provided"
          )}</div>
          <div class="box"><strong>Status:</strong><br />${escapeHtml(
            getSignOffStatusLabel(signOff.accountingStatus)
          )}</div>
        </div>

        <h2>Month-End Approval Checklist</h2>
        <table>
          <thead>
            <tr>
              <th>Checklist Item</th>
              <th>Status</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>${checklistRows}</tbody>
        </table>

        <h2>Notes</h2>
        <p><strong>Accountant / Auditor Notes:</strong> ${escapeHtml(
          signOff.accountantNotes || "-"
        )}</p>
        <p><strong>Boss / Management Notes:</strong> ${escapeHtml(
          signOff.bossNotes || "-"
        )}</p>

        <p>
          This certificate confirms that the selected accounting period has been
          reviewed internally using the Chalin 03 Sales & Inventory Management
          System. It supports accounting and audit preparation but does not replace
          a licensed accountant, tax consultant or external auditor.
        </p>

        <div class="signature-grid">
          <div class="signature-line">Prepared By</div>
          <div class="signature-line">Reviewed By</div>
          <div class="signature-line">Approved By</div>
        </div>
      </div>
    `;
  }

  function downloadSignOffCertificateWord() {
    downloadWordFile(
      fileName("chalin03_audit_signoff_certificate", "doc"),
      buildSignOffCertificateDocument()
    );

    setMessage("Audit Sign-Off Certificate Word document downloaded successfully.");
  }

  function downloadMonthEndAuditPack() {
    if (periodType !== "month" && periodType !== "custom") {
      setMessage(
        "Month-End Pack is best for This Month or Custom Period. Downloads will still be generated for the selected period."
      );
    }

    downloadAuditReportWord();

    setTimeout(() => {
      downloadManagementLetterWord();
    }, 300);

    setTimeout(() => {
      downloadAuditSummaryCsv();
    }, 600);

    setTimeout(() => {
      downloadAuditWarningsCsv();
    }, 900);

    setTimeout(() => {
      downloadExcelWorkbookCsv();
    }, 1200);

    setTimeout(() => {
      downloadPowerPointOutlineText();
    }, 1500);

    setTimeout(() => {
      downloadAccessGuideWord();
    }, 1800);

    setTimeout(() => {
      downloadSignOffCertificateWord();
    }, 2100);

    setMessage(
      "Month-End Audit Pack is downloading: Word report, management letter, sign-off certificate, CSV files, PowerPoint outline and Access guide."
    );
  }

  async function copyAuditSummary() {
    const summary = `${businessName.toUpperCase()}
PROFESSIONAL AUDIT & ACCOUNTING SUMMARY

Period: ${auditData.period.label}
Generated: ${formatDateTime(new Date())}

AUDIT RESULT
Audit Score: ${auditData.auditScore}% - ${auditData.auditStatus}
Red Flags: ${auditData.redFlags}
Orange Flags: ${auditData.orangeFlags}
Blue Flags: ${auditData.blueFlags}

ACCOUNTING SUMMARY
Period Sales: ${formatMoney(auditData.totalSales)}
Cash Collected: ${formatMoney(auditData.cashCollected)}
Outstanding Debts: ${formatMoney(auditData.outstandingDebts)}
Sales Balances: ${formatMoney(auditData.salesBalances)}
Period Expenses: ${formatMoney(auditData.totalExpenses)}
Fuel Expenses: ${formatMoney(auditData.fuelExpenses)}
Transport Expenses: ${formatMoney(auditData.transportExpenses)}
Salary Expenses: ${formatMoney(auditData.salaryExpenses)}
Discounts Given: ${formatMoney(auditData.totalDiscounts)}
Stock Selling Value: ${formatMoney(auditData.stockValue)}
Stock Cost Value: ${formatMoney(auditData.stockCostValue)}
Operating Result: ${formatMoney(auditData.operatingResult)}

MAIN AUDIT WARNINGS
${auditData.auditFlags
  .map(
    (flag, index) =>
      `${index + 1}. [${flag.severity.toUpperCase()}] ${flag.title}: ${
        flag.detail
      } Recommendation: ${flag.recommendation}`
  )
  .join("\n")}`;

    try {
      await navigator.clipboard.writeText(summary);
      setMessage("Professional audit summary copied successfully.");
    } catch {
      setError("Could not copy summary. Your browser may have blocked it.");
    }
  }


  function applyCustomThisMonthDates() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);

    setCustomStartDate(dateToInputValue(start));
    setCustomEndDate(dateToInputValue(now));
    setPeriodType("custom");
  }

  const oneColumn = isMobile ? styles.oneColumn : {};
  const mobileStack = isMobile ? styles.mobileStack : {};
  const scoreCardMobile = isMobile ? styles.scoreCardMobile : {};
  const scoreRingMobile = isMobile ? styles.scoreRingMobile : {};
  const signOffCompletion = getSignOffCompletion();

  return (
    <div style={styles.page}>
      <div style={{ ...styles.hero, ...mobileStack }}>
        <div>
          <p style={styles.eyebrow}>Professional Audit Intelligence</p>
          <h1 style={styles.title}>Audit & Accounting Intelligence Pro</h1>
          <p style={styles.subtitle}>
            Built-in business review for accounting periods, sales, cash,
            debts, expenses, fuel, stock, pricing, discounts, audit risks,
            accountant checks and month-end audit packs.
          </p>
        </div>

        <div style={styles.heroActions}>
          <button type="button" onClick={loadAuditData} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Review"}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={printAuditReport}
          >
            Print / Save PDF
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={copyAuditSummary}
          >
            Copy Summary
          </button>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.periodPanel}>
        <div>
          <p style={styles.eyebrowDark}>Accounting Period Control</p>
          <h2 style={{ margin: "5px 0" }}>{auditData.period.label}</h2>
          <p style={styles.panelText}>
            Accountants and auditors normally review by period. Choose the
            period before printing or exporting reports.
          </p>
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
              style={
                periodType === value
                  ? styles.activePeriodButton
                  : styles.periodButton
              }
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
              <input
                type="date"
                value={customStartDate}
                onChange={(event) => setCustomStartDate(event.target.value)}
              />
            </label>

            <label>
              End Date
              <input
                type="date"
                value={customEndDate}
                onChange={(event) => setCustomEndDate(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <div style={styles.approvalPanel}>
        <div style={{ ...styles.approvalHeader, ...mobileStack }}>
          <div>
            <p style={styles.eyebrowDark}>Audit Sign-Off & Accounting Approval</p>
            <h2 style={{ margin: "5px 0" }}>Period Approval Center</h2>
            <p style={styles.panelText}>
              Fill this after the accountant, auditor or boss reviews the period.
              It creates a professional sign-off certificate for the selected period.
            </p>
          </div>

          <div style={styles.approvalStatusCard}>
            <strong>{signOffCompletion.percent}%</strong>
            <span>{signOffCompletion.ready ? "Ready for filing" : "Needs completion"}</span>
            <small>{getSignOffStatusLabel(signOff.accountingStatus)}</small>
          </div>
        </div>

        <div style={{ ...styles.formGrid, ...oneColumn }}>
          <label>
            Prepared By
            <input
              type="text"
              value={signOff.preparedBy}
              onChange={(event) => updateSignOffField("preparedBy", event.target.value)}
              placeholder="Example: Cashier / Accounts Assistant"
            />
          </label>

          <label>
            Reviewed By
            <input
              type="text"
              value={signOff.reviewedBy}
              onChange={(event) => updateSignOffField("reviewedBy", event.target.value)}
              placeholder="Example: Accountant / Auditor"
            />
          </label>

          <label>
            Approved By
            <input
              type="text"
              value={signOff.approvedBy}
              onChange={(event) => updateSignOffField("approvedBy", event.target.value)}
              placeholder="Example: Boss / Manager"
            />
          </label>

          <label>
            Review Date
            <input
              type="date"
              value={signOff.reviewDate}
              onChange={(event) => updateSignOffField("reviewDate", event.target.value)}
            />
          </label>

          <label>
            Period Status
            <select
              value={signOff.accountingStatus}
              onChange={(event) => updateSignOffField("accountingStatus", event.target.value)}
            >
              <option value="draft">Draft / Not Yet Approved</option>
              <option value="reviewed">Reviewed by Accountant</option>
              <option value="approved">Approved by Management</option>
              <option value="locked">Final / Locked for Filing</option>
            </select>
          </label>
        </div>

        <div style={styles.signOffChecklistGrid}>
          {SIGN_OFF_CHECKLIST_ITEMS.map((item) => {
            const checked = Boolean(signOff.checklist?.[item.key]);

            return (
              <label
                key={item.key}
                style={checked ? styles.signOffItemChecked : styles.signOffItem}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    updateSignOffChecklist(item.key, event.target.checked)
                  }
                />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.note}</small>
                </span>
              </label>
            );
          })}
        </div>

        <div style={{ ...styles.formGrid, ...oneColumn }}>
          <label>
            Accountant / Auditor Notes
            <textarea
              value={signOff.accountantNotes}
              onChange={(event) => updateSignOffField("accountantNotes", event.target.value)}
              placeholder="Write notes from accounting or audit review..."
              rows="4"
            />
          </label>

          <label>
            Boss / Management Approval Notes
            <textarea
              value={signOff.bossNotes}
              onChange={(event) => updateSignOffField("bossNotes", event.target.value)}
              placeholder="Write boss approval notes or management comments..."
              rows="4"
            />
          </label>
        </div>

        <div style={styles.approvalActions}>
          <button type="button" onClick={saveSignOffDetails}>
            Save Sign-Off
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={downloadSignOffCertificateWord}
          >
            Download Sign-Off Certificate
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={clearSignOffDetails}
          >
            Clear Sign-Off
          </button>
        </div>
      </div>

      <div style={{ ...styles.scoreGrid, ...oneColumn }}>
        <div style={{ ...styles.scoreCard, ...scoreCardMobile }}>
          <div
            style={{
              ...styles.scoreRing,
              ...scoreRingMobile,
              background: `conic-gradient(#e0ba28 0deg ${
                auditData.auditScore * 3.6
              }deg, #e2e8f0 ${auditData.auditScore * 3.6}deg 360deg)`,
            }}
          >
            <div style={styles.scoreInner}>
              <strong>{auditData.auditScore}%</strong>
              <span>{auditData.auditStatus}</span>
            </div>
          </div>

          <div>
            <h2>Professional Audit Score</h2>
            <p>
              The score is based on risk flags from selected-period sales,
              selected-period expenses, debts, discounts, stock levels,
              inventory pricing and voided sales.
            </p>

            <div style={styles.flagMiniGrid}>
              <span style={styles.redPill}>{auditData.redFlags} Red</span>
              <span style={styles.orangePill}>
                {auditData.orangeFlags} Orange
              </span>
              <span style={styles.bluePill}>{auditData.blueFlags} Blue</span>
            </div>
          </div>
        </div>

        <div style={styles.exportPanel}>
          <h2>Export Center</h2>
          <p style={styles.panelText}>
            All exports use the selected accounting period. Word documents open
            in Microsoft Word, CSV files open in Excel, and Access files must be
            imported inside Microsoft Access.
          </p>

          <div style={styles.monthPack}>
            <h3>Month-End Audit Pack</h3>
            <p>
              One-click pack for accountants: Audit Word Report, Management
              Letter, Excel CSVs, PowerPoint outline and Access guide.
            </p>

            <button type="button" onClick={downloadMonthEndAuditPack}>
              Generate Month-End Audit Pack
            </button>
          </div>

          <div style={styles.exportSection}>
            <h3 style={styles.exportSectionTitle}>Professional Documents</h3>
            <p style={styles.exportHelp}>
              These are document-style files for auditors, accountants, bosses
              and management review.
            </p>

            <div style={styles.exportGrid}>
              <button type="button" onClick={printAuditReport}>
                PDF Report
              </button>

              <button type="button" onClick={downloadAuditReportWord}>
                Audit Report Word
              </button>

              <button type="button" onClick={downloadManagementLetterWord}>
                Management Letter Word
              </button>

              <button type="button" onClick={downloadSignOffCertificateWord}>
                Sign-Off Certificate
              </button>

              <button type="button" onClick={downloadPowerPointPresentation}>
                PowerPoint Briefing
              </button>

              <button type="button" onClick={downloadPowerPointOutlineText}>
                PowerPoint Outline Text
              </button>

              <button type="button" onClick={downloadHtmlAuditReport}>
                HTML Audit Report
              </button>
            </div>
          </div>

          <div style={styles.exportSection}>
            <h3 style={styles.exportSectionTitle}>
              Excel / Spreadsheet Files
            </h3>
            <p style={styles.exportHelp}>
              These CSV files open in Excel. They are good for sorting,
              filtering and calculations.
            </p>

            <div style={styles.exportGrid}>
              <button type="button" onClick={downloadAuditSummaryCsv}>
                Accounting Summary CSV
              </button>

              <button type="button" onClick={downloadAuditWarningsCsv}>
                Audit Warnings CSV
              </button>

              <button type="button" onClick={downloadManagementLetterCsv}>
                Management Letter CSV
              </button>

              <button type="button" onClick={downloadExcelWorkbookCsv}>
                Accounting Workbook CSV
              </button>
            </div>
          </div>

          <div style={styles.exportSection}>
            <h3 style={styles.exportSectionTitle}>Microsoft Access Import</h3>
            <p style={styles.exportHelp}>
              These CSV files may open in Excel when double-clicked. For Access,
              import them from inside Microsoft Access.
            </p>

            <div style={styles.exportGrid}>
              <button type="button" onClick={downloadAccessImportFiles}>
                Download Access Import Pack
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...styles.cardsGrid, ...oneColumn }}>
        <MetricCard
          title="Period Sales"
          value={formatMoney(auditData.totalSales)}
          note={`${auditData.completedSales.length} completed sale(s)`}
          icon="📈"
        />

        <MetricCard
          title="Cash Collected"
          value={formatMoney(auditData.cashCollected)}
          note="Amount paid by customers"
          icon="💰"
        />

        <MetricCard
          title="Outstanding Debts"
          value={formatMoney(auditData.outstandingDebts)}
          note={`${auditData.unpaidDebtCount} unpaid, ${auditData.partialDebtCount} partial`}
          icon="📞"
        />

        <MetricCard
          title="Period Expenses"
          value={formatMoney(auditData.totalExpenses)}
          note={`${auditData.periodExpenses.length} expense record(s)`}
          icon="📉"
        />

        <MetricCard
          title="Fuel Expenses"
          value={formatMoney(auditData.fuelExpenses)}
          note="Fuel category total"
          icon="⛽"
        />

        <MetricCard
          title="Discounts Given"
          value={formatMoney(auditData.totalDiscounts)}
          note="Needs approval review"
          icon="🏷️"
        />

        <MetricCard
          title="Stock Value"
          value={formatMoney(auditData.stockValue)}
          note={`${products.length} product(s) in inventory`}
          icon="📦"
        />

        <MetricCard
          title="Operating Result"
          value={formatMoney(auditData.operatingResult)}
          note="Period sales minus period expenses"
          icon="🧮"
        />
      </div>

      <div style={{ ...styles.twoColumn, ...oneColumn }}>
        <div style={styles.panel}>
          <h2>Accounting Summary</h2>
          <p style={styles.panelText}>
            This shows the accountant the main business figures for the selected
            period.
          </p>

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
          <p style={styles.panelText}>
            This helps compare cash received, balances and customer receivables.
          </p>

          <div style={styles.reconciliationBox}>
            <AccountingRow
              label="Cash Collected"
              value={formatMoney(auditData.cashCollected)}
            />
            <AccountingRow
              label="Sales Balances"
              value={formatMoney(auditData.salesBalances)}
            />
            <AccountingRow
              label="Debt Summary Balance"
              value={formatMoney(auditData.outstandingDebts)}
            />
            <AccountingRow
              label="Possible Difference"
              value={formatMoney(auditData.possibleDebtDifference)}
            />
            <AccountingRow
              label="Net Cash Position"
              value={formatMoney(auditData.netCashPosition)}
            />
          </div>
        </div>
      </div>

      <div style={{ ...styles.twoColumn, ...oneColumn }}>
        <div style={styles.panel}>
          <h2>Audit Risk Register</h2>
          <p style={styles.panelText}>
            Issues below should be reviewed by the boss, accountant or auditor.
          </p>

          <div style={styles.warningList}>
            {auditData.auditFlags.map((flag, index) => (
              <div
                key={`${flag.title}-${index}`}
                style={{
                  ...styles.warningItem,
                  ...warningTones[flag.severity],
                }}
              >
                <div style={styles.warningHeader}>
                  <strong>{flag.title}</strong>
                  <span>{flag.severity.toUpperCase()}</span>
                </div>

                <p>{flag.detail}</p>
                <small>Recommendation: {flag.recommendation}</small>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <h2>Accountant Checklist</h2>
          <p style={styles.panelText}>
            Quick checklist before presenting records for review.
          </p>

          <div style={styles.checkList}>
            {auditData.accountingChecklist.map((item) => (
              <div key={item.title} style={styles.checkItem}>
                <span
                  style={{
                    ...styles.checkIcon,
                    background: item.status ? "#dcfce7" : "#ffedd5",
                    color: item.status ? "#166534" : "#9a3412",
                  }}
                >
                  {item.status ? "✓" : "!"}
                </span>

                <div>
                  <strong>{item.title}</strong>
                  <p>{item.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ ...styles.twoColumn, ...oneColumn }}>
        <div style={styles.panel}>
          <h2>Management Letter Points</h2>
          <p style={styles.panelText}>
            These are professional-style points an auditor/accountant can
            discuss with management.
          </p>

          <div style={styles.managementList}>
            {auditData.managementLetterPoints.map((point) => (
              <div key={point.number} style={styles.managementItem}>
                <span>{point.number}</span>

                <div>
                  <strong>{point.finding}</strong>
                  <p>{point.implication}</p>
                  <small>Recommendation: {point.recommendation}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <h2>Top Expense Categories</h2>
          <p style={styles.panelText}>
            This helps the accountant see where money is going in the selected
            period.
          </p>

          {auditData.topExpenseCategories.length === 0 ? (
            <div style={styles.emptyState}>
              No expenses recorded for this period.
            </div>
          ) : (
            <div style={styles.expenseList}>
              {auditData.topExpenseCategories.map((item) => (
                <div key={item.category} style={styles.expenseItem}>
                  <strong>{item.category}</strong>
                  <span>{formatMoney(item.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ ...styles.threeColumn, ...oneColumn }}>
        <div style={styles.panelDark}>
          <h2>Sales Integrity</h2>
          <div style={styles.darkRows}>
            <div>
              <span>Completed Sales</span>
              <strong>{auditData.completedSales.length}</strong>
            </div>

            <div>
              <span>Voided Sales</span>
              <strong>{auditData.voidedSales.length}</strong>
            </div>

            <div>
              <span>Sales Exceptions</span>
              <strong>{auditData.salesExceptions.length}</strong>
            </div>
          </div>
        </div>

        <div style={styles.panelDark}>
          <h2>Expense Control</h2>
          <div style={styles.darkRows}>
            <div>
              <span>Period Expenses</span>
              <strong>{formatMoney(auditData.totalExpenses)}</strong>
            </div>

            <div>
              <span>Fuel</span>
              <strong>{formatMoney(auditData.fuelExpenses)}</strong>
            </div>

            <div>
              <span>Expense Issues</span>
              <strong>{auditData.expenseExceptions.length}</strong>
            </div>
          </div>
        </div>

        <div style={styles.panelDark}>
          <h2>Inventory Audit</h2>
          <div style={styles.darkRows}>
            <div>
              <span>Low Stock</span>
              <strong>{auditData.lowStockProducts.length}</strong>
            </div>

            <div>
              <span>Out of Stock</span>
              <strong>{auditData.zeroStockProducts.length}</strong>
            </div>

            <div>
              <span>Inventory Issues</span>
              <strong>{auditData.inventoryExceptions.length}</strong>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.disclaimer}>
        This page is a business audit and accounting assistant. It organizes
        records and highlights risk areas, but it does not replace a licensed
        accountant, tax consultant or external auditor.
      </div>
    </div>
  );
}

function MetricCard({ title, value, note, icon }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTop}>
        <span>{icon}</span>
      </div>

      <p>{title}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function AccountingRow({ label, value }) {
  return (
    <div style={styles.simpleRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const warningTones = {
  green: {
    background: "#ecfdf3",
    borderColor: "#bbf7d0",
    color: "#14532d",
  },
  blue: {
    background: "#eff6ff",
    borderColor: "#bfdbfe",
    color: "#1e3a8a",
  },
  orange: {
    background: "#fff7ed",
    borderColor: "#fed7aa",
    color: "#9a3412",
  },
  red: {
    background: "#fef2f2",
    borderColor: "#fecaca",
    color: "#991b1b",
  },
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "40px",
  },

  oneColumn: {
    gridTemplateColumns: "1fr",
  },

  mobileStack: {
    display: "grid",
    gridTemplateColumns: "1fr",
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
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 55%, #111827 100%)",
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
    gap: "16px",
    padding: "20px",
    borderRadius: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },

  periodButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },

  periodButton: {
    border: "1px solid #dbe3ef",
    borderRadius: "999px",
    padding: "10px 14px",
    background: "#f8fafc",
    color: "#07182c",
    fontWeight: "900",
    cursor: "pointer",
  },

  activePeriodButton: {
    border: "1px solid #e0ba28",
    borderRadius: "999px",
    padding: "10px 14px",
    background: "#07182c",
    color: "#ffffff",
    fontWeight: "900",
    cursor: "pointer",
  },

  dateGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
  },

  scoreGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 0.9fr)",
    gap: "18px",
    marginBottom: "18px",
  },

  scoreCard: {
    display: "grid",
    gridTemplateColumns: "180px minmax(0, 1fr)",
    gap: "18px",
    alignItems: "center",
    padding: "20px",
    borderRadius: "24px",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,251,235,0.96))",
    border: "1px solid rgba(224, 186, 40, 0.38)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.09)",
    minWidth: 0,
  },

  scoreCardMobile: {
    gridTemplateColumns: "1fr",
    justifyItems: "center",
    textAlign: "center",
  },

  scoreRing: {
    width: "170px",
    height: "170px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
  },

  scoreRingMobile: {
    width: "150px",
    height: "150px",
  },

  scoreInner: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
  },

  flagMiniGrid: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "12px",
    justifyContent: "center",
  },

  redPill: {
    background: "#fee2e2",
    color: "#991b1b",
    borderRadius: "999px",
    padding: "6px 10px",
    fontWeight: "950",
    fontSize: "12px",
  },

  orangePill: {
    background: "#ffedd5",
    color: "#9a3412",
    borderRadius: "999px",
    padding: "6px 10px",
    fontWeight: "950",
    fontSize: "12px",
  },

  bluePill: {
    background: "#dbeafe",
    color: "#1d4ed8",
    borderRadius: "999px",
    padding: "6px 10px",
    fontWeight: "950",
    fontSize: "12px",
  },

  exportPanel: {
    padding: "20px",
    borderRadius: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
  },

  monthPack: {
    marginTop: "14px",
    padding: "14px",
    borderRadius: "18px",
    background:
      "linear-gradient(135deg, rgba(224,186,40,0.18), rgba(255,255,255,0.96))",
    border: "1px solid rgba(224,186,40,0.45)",
  },

  exportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginTop: "10px",
  },

  exportSection: {
    marginTop: "16px",
    paddingTop: "14px",
    borderTop: "1px solid #e2e8f0",
  },

  exportSectionTitle: {
    margin: "0 0 5px",
    color: "#07182c",
    fontSize: "15px",
    fontWeight: "950",
  },

  exportHelp: {
    margin: "0 0 10px",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
    marginBottom: "18px",
  },

  metricCard: {
    padding: "18px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 16px 36px rgba(15,23,42,0.07)",
  },

  metricTop: {
    width: "44px",
    height: "44px",
    borderRadius: "14px",
    background: "#fef3c7",
    display: "grid",
    placeItems: "center",
    fontSize: "23px",
  },

  twoColumn: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 1fr)",
    gap: "18px",
    marginBottom: "18px",
  },

  threeColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "18px",
    marginBottom: "18px",
  },

  panel: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    minWidth: 0,
  },

  panelText: {
    color: "#64748b",
    lineHeight: 1.6,
  },

  accountingRows: {
    display: "grid",
    gap: "10px",
    marginTop: "12px",
  },

  accountingRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  simpleRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  reconciliationBox: {
    display: "grid",
    gap: "10px",
    marginTop: "12px",
  },

  warningList: {
    display: "grid",
    gap: "10px",
  },

  warningItem: {
    display: "grid",
    gap: "6px",
    padding: "13px",
    borderRadius: "16px",
    border: "1px solid",
  },

  warningHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
  },

  checkList: {
    display: "grid",
    gap: "11px",
  },

  checkItem: {
    display: "flex",
    gap: "11px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  checkIcon: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontWeight: "950",
    flexShrink: 0,
  },

  managementList: {
    display: "grid",
    gap: "10px",
  },

  managementItem: {
    display: "grid",
    gridTemplateColumns: "34px minmax(0, 1fr)",
    gap: "12px",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  expenseList: {
    display: "grid",
    gap: "10px",
  },

  expenseItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  panelDark: {
    borderRadius: "22px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 60%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 18px 40px rgba(7, 24, 44, 0.22)",
  },

  darkRows: {
    display: "grid",
    gap: "10px",
    marginTop: "14px",
  },

  emptyState: {
    padding: "18px",
    borderRadius: "16px",
    background: "#f8fafc",
    color: "#64748b",
    border: "1px dashed #cbd5e1",
    textAlign: "center",
    fontWeight: "800",
  },

  approvalPanel: {
    display: "grid",
    gap: "16px",
    padding: "20px",
    borderRadius: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },

  approvalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "flex-start",
  },

  approvalStatusCard: {
    minWidth: "180px",
    padding: "16px",
    borderRadius: "18px",
    background:
      "linear-gradient(135deg, rgba(7,24,44,0.96), rgba(13,47,85,0.96))",
    color: "#ffffff",
    display: "grid",
    gap: "4px",
    textAlign: "center",
    boxShadow: "0 16px 35px rgba(7,24,44,0.18)",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "12px",
  },

  signOffChecklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "10px",
  },

  signOffItem: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    cursor: "pointer",
  },

  signOffItemChecked: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "16px",
    background: "#ecfdf3",
    border: "1px solid #bbf7d0",
    cursor: "pointer",
  },

  approvalActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },

  disclaimer: {
    padding: "14px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    fontWeight: "800",
    lineHeight: 1.5,
  },
};