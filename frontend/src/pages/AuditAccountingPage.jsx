import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const SIGN_OFF_CHECKLIST_ITEMS = [
  {
    key: "salesChecked",
    label: "Sales records checked",
    note: "Sales totals, receipts, voided sales and discounts have been reviewed.",
  },
  {
    key: "expensesChecked",
    label: "Expenses checked",
    note: "Expense categories, dates, descriptions and amounts have been reviewed.",
  },
  {
    key: "debtsChecked",
    label: "Customer debts checked",
    note: "Outstanding debts and sales balances have been reviewed.",
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
    key: "reportsChecked",
    label: "Reports/export pack prepared",
    note: "Audit pack exports or backup documents have been prepared for records.",
  },
];

const EMPTY_SIGN_OFF = {
  preparedBy: "",
  reviewedBy: "",
  approvedBy: "",
  reviewDate: new Date().toISOString().slice(0, 10),
  accountingStatus: "draft",
  accountantNotes: "",
  bossNotes: "",
  checklist: {
    salesChecked: false,
    expensesChecked: false,
    debtsChecked: false,
    stockChecked: false,
    warningsChecked: false,
    reportsChecked: false,
  },
};

export default function AuditAccountingPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

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

  const [savedSignOffId, setSavedSignOffId] = useState(null);
  const [signOff, setSignOff] = useState(EMPTY_SIGN_OFF);
  const [signOffSaving, setSignOffSaving] = useState(false);
  const [signOffLoading, setSignOffLoading] = useState(false);
  const [signOffHistory, setSignOffHistory] = useState([]);

  const businessName = "Chalin 03 Company Limited";

  function getCurrentStoreLabel() {
    return `${currentStoreCode} - ${currentStoreName}${
      currentStoreLocation ? ` - ${currentStoreLocation}` : ""
    }`;
  }

  function getRecordStoreCode(record) {
    return record?.branch_code || record?.store_code || currentStoreCode;
  }

  function getRecordStoreName(record) {
    return record?.branch_name || record?.store_name || currentStoreName;
  }

  function getRecordStoreLocation(record) {
    return (
      record?.branch_location ||
      record?.store_location ||
      currentStoreLocation
    );
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
    if (!date || Number.isNaN(date.getTime())) {
      return null;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function apiDate(value) {
    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return dateToInputValue(date);
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

  function fileName(base, extension) {
    const period = makeFilePrefix(auditData.period.shortLabel);
    const store = makeFilePrefix(currentStoreCode);
    return `${base}_${store}_${period}.${extension}`;
  }

  function getSignOffCompletion() {
    const checklist = signOff?.checklist || {};
    const totalItems = SIGN_OFF_CHECKLIST_ITEMS.length;
    const checkedItems = SIGN_OFF_CHECKLIST_ITEMS.filter(
      (item) => checklist[item.key]
    ).length;

    const percent =
      totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

    return {
      checkedItems,
      totalItems,
      percent,
      isComplete: totalItems > 0 && checkedItems === totalItems,
    };
  }

  function getSignOffStatusLabel(status) {
    const cleanStatus = String(status || "draft").toLowerCase();

    if (cleanStatus === "approved") {
      return "Approved by Management";
    }

    if (cleanStatus === "reviewed") {
      return "Reviewed by Accountant";
    }

    if (cleanStatus === "rejected") {
      return "Rejected / Needs Correction";
    }

    return "Draft / In Progress";
  }

  function getBackendPeriodStatus(status) {
    const cleanStatus = String(status || "draft").toLowerCase();

    if (cleanStatus === "reviewed") return "reviewed";
    if (cleanStatus === "approved") return "approved";
    if (cleanStatus === "rejected") return "rejected";

    return "draft";
  }

  function getFlagStyle(severity) {
    const value = String(severity || "blue").toLowerCase();

    if (value === "red") {
      return styles.redPill;
    }

    if (value === "orange") {
      return styles.orangePill;
    }

    if (value === "green") {
      return styles.greenPill;
    }

    return styles.bluePill;
  }

  function resetSignOffForm() {
    setSavedSignOffId(null);
    setSignOff({
      ...EMPTY_SIGN_OFF,
      reviewDate: new Date().toISOString().slice(0, 10),
      checklist: { ...EMPTY_SIGN_OFF.checklist },
    });
  }

  function mapDatabaseSignOff(row) {
    if (!row) {
      return null;
    }

    return {
      preparedBy: row.prepared_by_name || "",
      reviewedBy: row.reviewed_by_name || "",
      approvedBy: row.approved_by_name || "",
      reviewDate: row.review_date
        ? apiDate(row.review_date)
        : new Date().toISOString().slice(0, 10),
      accountingStatus: row.period_status || "draft",
      accountantNotes: row.accountant_notes || "",
      bossNotes: row.management_notes || "",
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

  async function loadLatestSignOffFromDatabase() {
    setSignOffLoading(true);

    try {
      const period = getPeriodRange();

      const response = await axiosClient.get("/audit-signoffs/latest", {
        params: {
          period_type: periodType,
          period_label: period.label,
          period_start: apiDate(period.start),
          period_end: apiDate(period.end),
        },
      });

      const savedSignOff = response.data.signoff;

      if (!savedSignOff) {
        resetSignOffForm();
        return;
      }

      const mapped = mapDatabaseSignOff(savedSignOff);

      setSavedSignOffId(savedSignOff.id || null);
      setSignOff(mapped || EMPTY_SIGN_OFF);
    } catch (error) {
      setSavedSignOffId(null);
      setSignOff((current) => ({ ...current }));
      setError(
        error.response?.data?.message ||
          "Audit sign-off database route is not ready yet. The page can still be used."
      );
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

  useEffect(() => {
    loadAuditData();
    // Reload audit/accounting data when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    loadLatestSignOffFromDatabase();
    loadSignOffHistory();
    // Reload sign-off records when selected store or period changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, periodType, customStartDate, customEndDate]);

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
    const operatingResult = totalSales - totalExpenses;
    const possibleDebtDifference = Math.abs(
      Number(outstandingDebts || 0) - salesBalances
    );

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
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const auditFlags = [];

    function addFlag(severity, title, detail, recommendation) {
      auditFlags.push({ severity, title, detail, recommendation });
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
        "Review who voided them, why they were voided, and whether cash was affected."
      );
    }

    if (Number(outstandingDebts || 0) > 0) {
      addFlag(
        overdueDebtCount > 0 ? "red" : "orange",
        "Outstanding customer debts",
        `${formatMoney(outstandingDebts)} is currently unpaid across customer debt records.`,
        "Follow up customers, reconcile with sales balances, and send WhatsApp reminders where necessary."
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

    completedSales.slice(0, 200).forEach((sale) => {
      const receiptNumber = sale.receipt_number || `Sale #${sale.id}`;
      const balance = Number(sale.balance || 0);
      const total = Number(sale.total || 0);
      const amountPaid = Number(sale.amount_paid || 0);
      const discount = Number(sale.discount_amount || 0);
      const paymentType = getPaymentType(sale);

      if (!sale.receipt_number) {
        addFlag(
          "orange",
          "Missing receipt number",
          `${receiptNumber} has no receipt number.`,
          "Review the sale record and correct it if necessary."
        );
      }

      if (discount > 0) {
        addFlag(
          "blue",
          "Discount recorded",
          `${receiptNumber} has discount ${formatMoney(discount)}.`,
          "Confirm discount approval."
        );
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
          "Check whether change, overpayment or wrong entry occurred."
        );
      }

      if (total <= 0) {
        addFlag(
          "red",
          "Zero or invalid sale total",
          `${receiptNumber} has invalid total ${formatMoney(total)}.`,
          "Review the sale immediately."
        );
      }
    });

    periodExpenses.forEach((expense) => {
      const description = cleanText(expense.description);
      const category = cleanText(expense.category) || "Uncategorized";
      const amount = Number(expense.amount || 0);

      if (amount <= 0) {
        addFlag(
          "red",
          "Invalid expense amount",
          `${category} expense has invalid amount ${formatMoney(amount)}.`,
          "Correct the expense record."
        );
      }

      if (!description) {
        addFlag(
          "orange",
          "Expense missing description",
          `${category} expense of ${formatMoney(amount)} has no description.`,
          "Add a clear expense description."
        );
      }
    });

    products.forEach((product) => {
      const name = product.name || `Product #${product.id}`;
      const quantity = Number(product.quantity || 0);
      const cost = Number(product.cost_price || 0);
      const selling = Number(product.selling_price || 0);
      const lowStockLevel = Number(product.low_stock_threshold || 0);

      if (quantity <= 0) {
        addFlag(
          "red",
          "Out of stock product",
          `${name} has ${quantity} quantity available.`,
          "Review urgent restock needs."
        );
      } else if (quantity <= lowStockLevel) {
        addFlag(
          "orange",
          "Low stock product",
          `${name} has ${quantity} left. Low stock level is ${lowStockLevel}.`,
          "Prepare restocking plan."
        );
      }

      if (selling <= 0) {
        addFlag(
          "red",
          "Invalid selling price",
          `${name} has invalid selling price ${formatMoney(selling)}.`,
          "Correct the product selling price."
        );
      }

      if (selling > 0 && cost > 0 && selling <= cost) {
        addFlag(
          "orange",
          "Possible low/no profit product",
          `${name} selling price ${formatMoney(selling)} is not above cost ${formatMoney(cost)}.`,
          "Review product pricing."
        );
      }
    });

    if (auditFlags.length === 0) {
      addFlag(
        "green",
        "No major audit issue detected",
        `The system currently shows no major warning for ${period.label}.`,
        "Continue daily closing, backup and regular stock checking."
      );
    }

    const redFlags = auditFlags.filter((flag) => flag.severity === "red").length;
    const orangeFlags = auditFlags.filter((flag) => flag.severity === "orange").length;
    const blueFlags = auditFlags.filter((flag) => flag.severity === "blue").length;

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
        title: "Debt reconciliation",
        status: Number(outstandingDebts || 0) <= 0 && salesBalances <= 0,
        note:
          Number(outstandingDebts || 0) > 0 || salesBalances > 0
            ? `${formatMoney(outstandingDebts)} current outstanding debt and ${formatMoney(salesBalances)} period sales balance detected.`
            : "No outstanding debt detected.",
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
      store_code: getRecordStoreCode(sale),
      store_name: getRecordStoreName(sale),
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
      store_code: getRecordStoreCode(expense),
      store_name: getRecordStoreName(expense),
      expense_id: expense.id,
      category: expense.category || "",
      description: expense.description || "",
      amount: plainMoney(expense.amount),
      expense_date: formatDate(expense.expense_date || expense.created_at),
      recorded_by: expense.recorded_by_name || "",
    }));

    const accessProductRows = products.map((product) => ({
      store_code: getRecordStoreCode(product),
      store_name: getRecordStoreName(product),
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
    currentStoreCode,
    currentStoreName,
  ]);

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

  function buildSignOffPayload() {
    return {
      period_type: periodType,
      period_label: auditData.period.label,
      period_start: apiDate(auditData.period.start),
      period_end: apiDate(auditData.period.end),
      audit_score: auditData.auditScore,
      audit_status: auditData.auditStatus,
      prepared_by_name: signOff.preparedBy,
      reviewed_by_name: signOff.reviewedBy,
      approved_by_name: signOff.approvedBy,
      review_date: signOff.reviewDate || new Date().toISOString().slice(0, 10),
      period_status: getBackendPeriodStatus(signOff.accountingStatus),
      sales_checked: Boolean(signOff.checklist.salesChecked),
      expenses_checked: Boolean(signOff.checklist.expensesChecked),
      debts_checked: Boolean(signOff.checklist.debtsChecked),
      stock_checked: Boolean(signOff.checklist.stockChecked),
      warnings_checked: Boolean(signOff.checklist.warningsChecked),
      reports_checked: Boolean(signOff.checklist.reportsChecked),
      accountant_notes: signOff.accountantNotes,
      management_notes: signOff.bossNotes,
    };
  }

  async function saveSignOffDetails() {
    setSignOffSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post("/audit-signoffs", buildSignOffPayload());
      const savedSignOff = response.data.signoff;

      if (savedSignOff) {
        const mapped = mapDatabaseSignOff(savedSignOff);
        setSavedSignOffId(savedSignOff.id || null);
        setSignOff(mapped || signOff);
      }

      await loadSignOffHistory();
      setMessage(response.data.message || "Audit sign-off saved into MySQL successfully.");
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Could not save audit sign-off into the database. Check backend route and audit_signoffs table."
      );
    } finally {
      setSignOffSaving(false);
    }
  }

  function clearSignOffDetails() {
    const confirmed = window.confirm(
      "Clear the sign-off form for this selected period? This will not delete saved MySQL records."
    );

    if (!confirmed) {
      return;
    }

    resetSignOffForm();
    setMessage("Audit sign-off form cleared. Saved database records were not deleted.");
  }

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
        <body>${htmlContent}</body>
      </html>
    `;

    downloadTextFile(filename, wordDocument, "application/msword;charset=utf-8");
  }

  function downloadAuditSummaryCsv() {
    const rows = auditData.accountantSummary.map((item) => ({
      store_code: currentStoreCode,
      store_name: currentStoreName,
      item: item.label,
      amount: item.isText ? item.value : plainMoney(item.value),
      meaning: item.meaning,
    }));

    rows.push(
      {
        store_code: currentStoreCode,
        store_name: currentStoreName,
        item: "Audit Score",
        amount: `${auditData.auditScore}%`,
        meaning: auditData.auditStatus,
      },
      {
        store_code: currentStoreCode,
        store_name: currentStoreName,
        item: "Red Flags",
        amount: auditData.redFlags,
        meaning: "High risk audit warnings.",
      },
      {
        store_code: currentStoreCode,
        store_name: currentStoreName,
        item: "Orange Flags",
        amount: auditData.orangeFlags,
        meaning: "Medium risk audit warnings.",
      },
      {
        store_code: currentStoreCode,
        store_name: currentStoreName,
        item: "Blue Flags",
        amount: auditData.blueFlags,
        meaning: "Information or review notes.",
      }
    );

    downloadCsv(fileName("chalin03_accounting_summary", "csv"), rows);
  }

  function downloadAuditWarningsCsv() {
    const rows = auditData.auditFlags.map((flag, index) => ({
      number: index + 1,
      store_code: currentStoreCode,
      store_name: currentStoreName,
      period: auditData.period.label,
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
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: auditData.period.label,
        section: "Accounting Summary",
        item: item.label,
        amount: item.isText ? item.value : plainMoney(item.value),
        note: item.meaning,
      })),
      ...auditData.auditFlags.map((flag) => ({
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: auditData.period.label,
        section: "Audit Warning",
        item: flag.title,
        amount: "",
        note: `${flag.detail} Recommendation: ${flag.recommendation}`,
      })),
      ...auditData.topExpenseCategories.map((expense) => ({
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: auditData.period.label,
        section: "Expense Category",
        item: expense.category,
        amount: plainMoney(expense.amount),
        note: "Expense category total",
      })),
    ];

    downloadCsv(fileName("chalin03_accounting_workbook", "csv"), rows);
  }

  function downloadAccessImportFiles() {
    downloadCsv(fileName("access_import_sales_table", "csv"), auditData.accessSalesRows);

    setTimeout(() => {
      downloadCsv(fileName("access_import_expenses_table", "csv"), auditData.accessExpenseRows);
    }, 300);

    setTimeout(() => {
      downloadCsv(fileName("access_import_products_table", "csv"), auditData.accessProductRows);
    }, 600);
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
            <td>${escapeHtml(String(flag.severity).toUpperCase())}</td>
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

    const signOffRows = SIGN_OFF_CHECKLIST_ITEMS.map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.label)}</td>
          <td>${signOff.checklist?.[item.key] ? "Checked" : "Pending"}</td>
          <td>${escapeHtml(item.note)}</td>
        </tr>
      `
    ).join("");

    const completion = getSignOffCompletion();

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>${escapeHtml(businessName)} Audit Report</title>
          <style>
            @page { size: A4; margin: 14mm; }
            body { font-family: Arial, sans-serif; color: #111827; line-height: 1.45; font-size: 12px; }
            h1 { margin: 0; color: #07182c; font-size: 24px; }
            h2 { margin-top: 24px; color: #07182c; border-bottom: 2px solid #e0ba28; padding-bottom: 6px; }
            .muted { color: #64748b; }
            .header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 3px solid #07182c; padding-bottom: 12px; margin-bottom: 16px; }
            .score { border: 2px solid #e0ba28; border-radius: 12px; padding: 10px; min-width: 150px; text-align: center; }
            .score strong { display: block; font-size: 24px; color: #07182c; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
            .box { border: 1px solid #dbe3ef; border-radius: 10px; padding: 8px; background: #f8fafc; }
            .box span { display: block; color: #64748b; font-size: 11px; }
            .box strong { display: block; margin-top: 4px; color: #07182c; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #dbe3ef; padding: 7px; text-align: left; vertical-align: top; font-size: 11px; }
            th { background: #07182c; color: #ffffff; }
            .notice { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 10px; margin-top: 14px; color: #9a3412; }
            .footer { margin-top: 28px; color: #64748b; font-size: 10px; border-top: 1px solid #dbe3ef; padding-top: 8px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1>${escapeHtml(businessName)}</h1>
              <p class="muted">Audit & Accounting Intelligence Pro Review</p>
              <p><strong>Store:</strong> ${escapeHtml(getCurrentStoreLabel())}</p>
              <p><strong>Period:</strong> ${escapeHtml(auditData.period.label)}</p>
              <p><strong>Generated:</strong> ${escapeHtml(formatDateTime(new Date()))}</p>
            </div>
            <div class="score">
              <span>Audit Score</span>
              <strong>${auditData.auditScore}%</strong>
              <span>${escapeHtml(auditData.auditStatus)}</span>
            </div>
          </div>

          <div class="grid">
            <div class="box"><span>Store</span><strong>${escapeHtml(currentStoreCode)} - ${escapeHtml(currentStoreName)}</strong></div>
            <div class="box"><span>Period Sales</span><strong>${formatMoney(auditData.totalSales)}</strong></div>
            <div class="box"><span>Cash Collected</span><strong>${formatMoney(auditData.cashCollected)}</strong></div>
            <div class="box"><span>Outstanding Debts</span><strong>${formatMoney(auditData.outstandingDebts)}</strong></div>
            <div class="box"><span>Period Expenses</span><strong>${formatMoney(auditData.totalExpenses)}</strong></div>
            <div class="box"><span>Fuel Expenses</span><strong>${formatMoney(auditData.fuelExpenses)}</strong></div>
            <div class="box"><span>Discounts</span><strong>${formatMoney(auditData.totalDiscounts)}</strong></div>
            <div class="box"><span>Stock Value</span><strong>${formatMoney(auditData.stockValue)}</strong></div>
            <div class="box"><span>Operating Result</span><strong>${formatMoney(auditData.operatingResult)}</strong></div>
          </div>

          <div class="notice">
            This report supports internal management and audit preparation. It does not replace a licensed accountant or external auditor.
          </div>

          <h2>1. Accounting Summary</h2>
          <table><thead><tr><th>Item</th><th>Amount / Detail</th><th>Meaning</th></tr></thead><tbody>${summaryRows}</tbody></table>

          <h2>2. Audit Risk Register</h2>
          <table><thead><tr><th>#</th><th>Risk</th><th>Finding</th><th>Details</th><th>Recommendation</th></tr></thead><tbody>${flagsRows}</tbody></table>

          <h2>3. Accountant Checklist</h2>
          <table><thead><tr><th>Check</th><th>Status</th><th>Note</th></tr></thead><tbody>${checklistRows}</tbody></table>

          <h2>4. Audit Sign-Off & Approval</h2>
          <div class="grid">
            <div class="box"><span>Prepared By</span><strong>${escapeHtml(signOff.preparedBy || "Not provided")}</strong></div>
            <div class="box"><span>Reviewed By</span><strong>${escapeHtml(signOff.reviewedBy || "Not provided")}</strong></div>
            <div class="box"><span>Approved By</span><strong>${escapeHtml(signOff.approvedBy || "Not provided")}</strong></div>
            <div class="box"><span>Status</span><strong>${escapeHtml(getSignOffStatusLabel(signOff.accountingStatus))}</strong></div>
            <div class="box"><span>Completion</span><strong>${completion.percent}%</strong></div>
            <div class="box"><span>Review Date</span><strong>${escapeHtml(formatDate(signOff.reviewDate))}</strong></div>
          </div>
          <table><thead><tr><th>Sign-Off Check</th><th>Status</th><th>Note</th></tr></thead><tbody>${signOffRows}</tbody></table>
          <p><strong>Accountant Notes:</strong> ${escapeHtml(signOff.accountantNotes || "-")}</p>
          <p><strong>Boss Notes:</strong> ${escapeHtml(signOff.bossNotes || "-")}</p>

          <div class="footer">Powered by Chalin 03 Sales & Inventory Management System.</div>
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

  function buildPowerPointOutline() {
    const lines = [
      "CHALIN 03 COMPANY LIMITED",
      "AUDIT & ACCOUNTING POWERPOINT BRIEFING OUTLINE",
      "",
      "Slide 1: Title",
      `${businessName} - Audit & Accounting Review`,
      `Store: ${getCurrentStoreLabel()}`,
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
      "Slide 4: Expense Analysis",
      `Total Expenses: ${formatMoney(auditData.totalExpenses)}`,
      `Fuel Expenses: ${formatMoney(auditData.fuelExpenses)}`,
      "",
      "Slide 5: Main Audit Warnings",
      ...auditData.auditFlags.slice(0, 8).map((flag) => `- ${flag.title}: ${flag.detail}`),
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
  function getSignOffCompletion() {
  const checklist = signOff?.checklist || {};
  const totalItems = SIGN_OFF_CHECKLIST_ITEMS.length;

  const checkedItems = SIGN_OFF_CHECKLIST_ITEMS.filter(
    (item) => checklist[item.key]
  ).length;

  const percent =
    totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  return {
    checkedItems,
    totalItems,
    percent,
    isComplete: totalItems > 0 && checkedItems === totalItems,
  };
}

function getSignOffStatusLabel(status) {
  const cleanStatus = String(status || "draft").toLowerCase();

  if (cleanStatus === "approved") {
    return "Approved by Management";
  }

  if (cleanStatus === "reviewed") {
    return "Reviewed by Accountant";
  }

  if (cleanStatus === "locked") {
    return "Locked / Final Approved";
  }

  if (cleanStatus === "rejected") {
    return "Rejected / Needs Correction";
  }

  return "Draft / In Progress";
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
        body { font-family: Arial, sans-serif; color: #111827; line-height: 1.6; font-size: 13px; }
        h1 { color: #07182c; text-align: center; margin-bottom: 4px; }
        h2 { color: #07182c; margin-top: 22px; border-bottom: 2px solid #e0ba28; padding-bottom: 6px; }
        .certificate { border: 4px solid #07182c; padding: 26px; }
        .muted { color: #64748b; text-align: center; }
        .status { background: #fef3c7; border: 1px solid #e0ba28; padding: 14px; border-radius: 10px; text-align: center; margin: 18px 0; font-weight: bold; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 16px 0; }
        .box { border: 1px solid #dbe3ef; background: #f8fafc; padding: 12px; border-radius: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #dbe3ef; padding: 8px; text-align: left; vertical-align: top; font-size: 12px; }
        th { background: #07182c; color: #ffffff; }
        .signature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 46px; }
        .signature-line { border-top: 1px solid #111827; padding-top: 8px; text-align: center; }
      </style>

      <div class="certificate">
        <h1>${escapeHtml(businessName)}</h1>
        <p class="muted">Audit Sign-Off & Accounting Approval Certificate</p>

        <div class="status">
          ${escapeHtml(getSignOffStatusLabel(signOff.accountingStatus))}<br />
          Completion: ${completion.percent}%
        </div>

        <div class="grid">
          <div class="box"><strong>Store:</strong><br />${escapeHtml(currentStoreCode)} - ${escapeHtml(currentStoreName)}</div>
          <div class="box"><strong>Accounting Period:</strong><br />${escapeHtml(auditData.period.label)}</div>
          <div class="box"><strong>Review Date:</strong><br />${escapeHtml(formatDate(signOff.reviewDate))}</div>
          <div class="box"><strong>Prepared By:</strong><br />${escapeHtml(signOff.preparedBy || "-")}</div>
          <div class="box"><strong>Reviewed By:</strong><br />${escapeHtml(signOff.reviewedBy || "-")}</div>
          <div class="box"><strong>Approved By:</strong><br />${escapeHtml(signOff.approvedBy || "-")}</div>
          <div class="box"><strong>Database Record:</strong><br />${savedSignOffId ? `#${savedSignOffId}` : "Not saved"}</div>
        </div>

        <h2>Checklist</h2>
        <table><thead><tr><th>Check</th><th>Status</th><th>Note</th></tr></thead><tbody>${checklistRows}</tbody></table>

        <h2>Notes</h2>
        <p><strong>Accountant / Auditor Notes:</strong> ${escapeHtml(signOff.accountantNotes || "-")}</p>
        <p><strong>Boss / Management Notes:</strong> ${escapeHtml(signOff.bossNotes || "-")}</p>

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

    setMessage("Audit sign-off certificate downloaded successfully.");
  }

  function downloadMonthEndAuditPack() {
    downloadAuditReportWord();

    setTimeout(() => {
      downloadAuditSummaryCsv();
    }, 300);

    setTimeout(() => {
      downloadAuditWarningsCsv();
    }, 600);

    setTimeout(() => {
      downloadAccountingWorkbookCsv();
    }, 900);

    setTimeout(() => {
      downloadPowerPointOutlineText();
    }, 1200);

    setTimeout(() => {
      downloadSignOffCertificateWord();
    }, 1500);

    setMessage("Month-End Audit Pack is downloading.");
  }

  async function copyAuditSummary() {
    const summary = `${businessName.toUpperCase()}\nPROFESSIONAL AUDIT & ACCOUNTING SUMMARY\n\nStore: ${getCurrentStoreLabel()}\nPeriod: ${auditData.period.label}\nGenerated: ${formatDateTime(new Date())}\n\nAudit Score: ${auditData.auditScore}% - ${auditData.auditStatus}\nRed Flags: ${auditData.redFlags}\nOrange Flags: ${auditData.orangeFlags}\nBlue Flags: ${auditData.blueFlags}\n\nPeriod Sales: ${formatMoney(auditData.totalSales)}\nCash Collected: ${formatMoney(auditData.cashCollected)}\nOutstanding Debts: ${formatMoney(auditData.outstandingDebts)}\nPeriod Expenses: ${formatMoney(auditData.totalExpenses)}\nOperating Result: ${formatMoney(auditData.operatingResult)}\n\nSign-Off Status: ${getSignOffStatusLabel(signOff.accountingStatus)}\nPrepared By: ${signOff.preparedBy || "-"}\nReviewed By: ${signOff.reviewedBy || "-"}\nApproved By: ${signOff.approvedBy || "-"}`;

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

  const signOffCompletion = getSignOffCompletion();

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Professional Audit Intelligence</p>
          <h1 style={styles.title}>Audit & Accounting Intelligence Pro</h1>
          <p style={styles.subtitle}>
            Review sales, cash, debts, expenses, fuel, stock, discounts, audit
            warnings and accounting sign-off approval for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
            .
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

      <div
        style={{
          marginBottom: "18px",
          padding: "14px",
          borderRadius: "14px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1e3a8a",
          fontWeight: "800",
        }}
      >
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Audit review, accounting figures, sign-off records, exports and
          certificates are filtered to this selected store only.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.periodPanel}>
        <div>
          <p style={styles.eyebrowDark}>Accounting Period Control</p>
          <h2 style={{ margin: "5px 0" }}>{auditData.period.label}</h2>
          <p style={styles.panelText}>
            Choose the period before printing, exporting or saving audit sign-off records for {currentStoreCode}.
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

      <div style={styles.scoreGrid}>
        <div style={styles.scoreCard}>
          <div
            style={{
              ...styles.scoreRing,
              background: `conic-gradient(#e0ba28 0deg ${auditData.auditScore * 3.6}deg, #e2e8f0 ${auditData.auditScore * 3.6}deg 360deg)`,
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
              The score is based on sales, expenses, debts, stock, discounts,
              voided sales and pricing warnings.
            </p>

            <div style={styles.flagMiniGrid}>
              <span style={styles.redPill}>{auditData.redFlags} Red</span>
              <span style={styles.orangePill}>{auditData.orangeFlags} Orange</span>
              <span style={styles.bluePill}>{auditData.blueFlags} Blue</span>
            </div>
          </div>
        </div>

        <div style={styles.exportPanel}>
          <h2>Export Center</h2>
          <p style={styles.panelText}>
            All exports use the selected accounting period and selected store.
          </p>

          <div style={styles.monthPack}>
            <h3>Month-End Audit Pack</h3>
            <p>
              Downloads Audit Word Report, accounting CSVs, PowerPoint outline
              and sign-off certificate for {currentStoreCode}.
            </p>
            <button type="button" onClick={downloadMonthEndAuditPack}>
              Generate Month-End Audit Pack
            </button>
          </div>

          <div style={styles.exportGrid}>
            <button type="button" onClick={printAuditReport}>PDF Report</button>
            <button type="button" onClick={downloadAuditReportWord}>Audit Report Word</button>
            <button type="button" onClick={downloadAuditSummaryCsv}>Accounting Summary CSV</button>
            <button type="button" onClick={downloadAuditWarningsCsv}>Audit Warnings CSV</button>
            <button type="button" onClick={downloadAccountingWorkbookCsv}>Accounting Workbook CSV</button>
            <button type="button" onClick={downloadAccessImportFiles}>Access Import CSVs</button>
            <button type="button" onClick={downloadPowerPointOutlineText}>PowerPoint Outline</button>
            <button type="button" onClick={downloadSignOffCertificateWord}>Sign-Off Certificate Word</button>
          </div>
        </div>
      </div>

      <div style={styles.cardsGrid}>
        <MetricCard title={`${currentStoreCode} Period Sales`} value={formatMoney(auditData.totalSales)} note={`${auditData.completedSales.length} completed sale(s)`} icon="📈" />
        <MetricCard title="Cash Collected" value={formatMoney(auditData.cashCollected)} note="Amount paid by customers" icon="💰" />
        <MetricCard title="Outstanding Debts" value={formatMoney(auditData.outstandingDebts)} note={`${auditData.unpaidDebtCount} unpaid, ${auditData.partialDebtCount} partial`} icon="📞" />
        <MetricCard title="Period Expenses" value={formatMoney(auditData.totalExpenses)} note={`${auditData.periodExpenses.length} expense record(s)`} icon="📉" />
        <MetricCard title="Fuel Expenses" value={formatMoney(auditData.fuelExpenses)} note="Fuel category total" icon="⛽" />
        <MetricCard title="Discounts Given" value={formatMoney(auditData.totalDiscounts)} note="Needs approval review" icon="🏷️" />
        <MetricCard title={`${currentStoreCode} Stock Value`} value={formatMoney(auditData.stockValue)} note={`${products.length} product(s) in inventory`} icon="📦" />
        <MetricCard title="Operating Result" value={formatMoney(auditData.operatingResult)} note="Period sales minus period expenses" icon="🧮" />
      </div>

      <div style={styles.twoColumn}>
        <div style={styles.panel}>
          <h2>Accounting Summary</h2>
          <p style={styles.panelText}>Main figures for the selected period.</p>

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
          <p style={styles.panelText}>Compare cash received, balances and customer receivables.</p>

          <AccountingRow label="Cash Collected" value={formatMoney(auditData.cashCollected)} />
          <AccountingRow label="Period Sales Balances" value={formatMoney(auditData.salesBalances)} />
          <AccountingRow label="Outstanding Debts" value={formatMoney(auditData.outstandingDebts)} />
          <AccountingRow label="Possible Difference" value={formatMoney(auditData.possibleDebtDifference)} />
        </div>
      </div>

      <div style={styles.twoColumn}>
        <div style={styles.panel}>
          <h2>Audit Risk Register</h2>
          <p style={styles.panelText}>Warnings that need management or accountant review.</p>

          <div style={styles.flagList}>
            {auditData.auditFlags.slice(0, 25).map((flag, index) => (
              <div key={`${flag.title}-${index}`} style={styles.flagItem}>
                <span style={getFlagStyle(flag.severity)}>{flag.severity}</span>
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
          <h2>Expense Category Review</h2>
          <p style={styles.panelText}>Top expenses for the selected period.</p>

          {auditData.topExpenseCategories.length === 0 ? (
            <div style={styles.emptyState}>No expense category found for this period.</div>
          ) : (
            <div style={styles.accountingRows}>
              {auditData.topExpenseCategories.map((item) => (
                <AccountingRow
                  key={item.category}
                  label={item.category}
                  value={formatMoney(item.amount)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.signOffPanel}>
        <div style={styles.signOffHeader}>
          <div>
            <p style={styles.eyebrowDark}>Audit Sign-Off & Accounting Approval</p>
            <h2 style={{ margin: "5px 0" }}>Period Approval Center</h2>
            <p style={styles.panelText}>
              Save the audit approval to MySQL after the accountant and boss review the period for {currentStoreCode}.
            </p>
          </div>

          <div style={styles.signOffBadge}>
            <strong>{signOffCompletion.percent}%</strong>
            <span>{getSignOffStatusLabel(signOff.accountingStatus)}</span>
            {savedSignOffId && <small>Database ID: #{savedSignOffId}</small>}
            {signOffLoading && <small>Loading saved record...</small>}
          </div>
        </div>

        <div style={styles.formGrid}>
          <label>
            Prepared By
            <input
              value={signOff.preparedBy}
              onChange={(event) => updateSignOffField("preparedBy", event.target.value)}
              placeholder="Name of person who prepared the review"
            />
          </label>

          <label>
            Reviewed By
            <input
              value={signOff.reviewedBy}
              onChange={(event) => updateSignOffField("reviewedBy", event.target.value)}
              placeholder="Accountant / reviewer name"
            />
          </label>

          <label>
            Approved By
            <input
              value={signOff.approvedBy}
              onChange={(event) => updateSignOffField("approvedBy", event.target.value)}
              placeholder="Boss / manager approval name"
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
              <option value="draft">Draft / In Progress</option>
              <option value="reviewed">Reviewed by Accountant</option>
              <option value="approved">Approved by Management</option>
              <option value="rejected">Rejected / Needs Correction</option>
            </select>
          </label>
        </div>

        <div style={styles.checklistGrid}>
          {SIGN_OFF_CHECKLIST_ITEMS.map((item) => (
            <label key={item.key} style={styles.checkItem}>
              <input
                type="checkbox"
                checked={Boolean(signOff.checklist?.[item.key])}
                onChange={(event) => updateSignOffChecklist(item.key, event.target.checked)}
              />
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
            <textarea
              value={signOff.accountantNotes}
              onChange={(event) => updateSignOffField("accountantNotes", event.target.value)}
              placeholder="Write accountant observations, corrections or review notes here"
            />
          </label>

          <label>
            Boss / Management Notes
            <textarea
              value={signOff.bossNotes}
              onChange={(event) => updateSignOffField("bossNotes", event.target.value)}
              placeholder="Write boss approval notes, decisions or follow-up instructions here"
            />
          </label>
        </div>

        <div style={styles.signOffActions}>
          <button type="button" onClick={saveSignOffDetails} disabled={signOffSaving}>
            {signOffSaving ? "Saving..." : "Save Sign-Off to MySQL"}
          </button>

          <button type="button" className="secondary-button" onClick={downloadSignOffCertificateWord}>
            Download Sign-Off Certificate
          </button>

          <button type="button" className="secondary-button" onClick={clearSignOffDetails}>
            Clear Form
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <h2>Recent Saved Sign-Off History - {currentStoreCode}</h2>
        <p style={styles.panelText}>Latest saved records from the audit_signoffs database table for the selected store.</p>

        {signOffHistory.length === 0 ? (
          <div style={styles.emptyState}>No saved sign-off history found yet.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Store</th>
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
                {signOffHistory.slice(0, 10).map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>
                    <td>{getRecordStoreCode(item)}</td>
                    <td>{item.period_label || "-"}</td>
                    <td>{Number(item.audit_score || 0)}%</td>
                    <td>{getSignOffStatusLabel(item.period_status)}</td>
                    <td>{item.prepared_by_name || "-"}</td>
                    <td>{item.reviewed_by_name || "-"}</td>
                    <td>{item.approved_by_name || "-"}</td>
                    <td>{formatDateTime(item.updated_at || item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={styles.disclaimer}>
        This page supports internal management and accounting review for {currentStoreCode} — {currentStoreName}. It does not replace a licensed accountant, tax consultant or external auditor.
      </div>
    </div>
  );
}

function MetricCard({ title, value, note, icon }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricIcon}>{icon}</div>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </div>
  );
}

function AccountingRow({ label, value }) {
  return (
    <div style={styles.accountingRow}>
      <strong>{label}</strong>
      <b>{value}</b>
    </div>
  );
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
    gap: "16px",
    padding: "20px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },
  panelText: {
    color: "#64748b",
    lineHeight: 1.6,
  },
  periodButtons: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  periodButton: {
    border: "1px solid #dbe3ef",
    background: "#ffffff",
    color: "#164777",
    borderRadius: "999px",
    padding: "9px 13px",
    cursor: "pointer",
    fontWeight: "900",
  },
  activePeriodButton: {
    border: "1px solid #164777",
    background: "#164777",
    color: "#ffffff",
    borderRadius: "999px",
    padding: "9px 13px",
    cursor: "pointer",
    fontWeight: "900",
  },
  dateGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
  },
  scoreGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1.1fr) minmax(280px, 0.9fr)",
    gap: "18px",
    marginBottom: "18px",
  },
  scoreCard: {
    display: "grid",
    gridTemplateColumns: "180px minmax(0, 1fr)",
    gap: "20px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "22px",
    padding: "22px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
  },
  scoreRing: {
    width: "150px",
    height: "150px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
  },
  scoreInner: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    boxShadow: "inset 0 0 0 1px #e2e8f0",
  },
  flagMiniGrid: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  redPill: {
    display: "inline-flex",
    padding: "5px 9px",
    borderRadius: "999px",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: "950",
    fontSize: "12px",
    textTransform: "uppercase",
  },
  orangePill: {
    display: "inline-flex",
    padding: "5px 9px",
    borderRadius: "999px",
    background: "#ffedd5",
    color: "#9a3412",
    fontWeight: "950",
    fontSize: "12px",
    textTransform: "uppercase",
  },
  bluePill: {
    display: "inline-flex",
    padding: "5px 9px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontWeight: "950",
    fontSize: "12px",
    textTransform: "uppercase",
  },
  greenPill: {
    display: "inline-flex",
    padding: "5px 9px",
    borderRadius: "999px",
    background: "#dcfce7",
    color: "#166534",
    fontWeight: "950",
    fontSize: "12px",
    textTransform: "uppercase",
  },
  exportPanel: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
  },
  monthPack: {
    padding: "14px",
    borderRadius: "18px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    marginBottom: "14px",
  },
  exportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "10px",
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },
  metricCard: {
    display: "grid",
    gridTemplateColumns: "46px minmax(0, 1fr)",
    gap: "12px",
    alignItems: "center",
    padding: "16px",
    borderRadius: "20px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 30px rgba(15,23,42,0.07)",
  },
  metricIcon: {
    width: "46px",
    height: "46px",
    borderRadius: "16px",
    display: "grid",
    placeItems: "center",
    background: "#f1f5f9",
    fontSize: "24px",
  },
  twoColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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
  accountingRows: {
    display: "grid",
    gap: "10px",
  },
  accountingRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },
  flagList: {
    display: "grid",
    gap: "12px",
  },
  flagItem: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "10px",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },
  signOffPanel: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "22px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },
  signOffHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    flexWrap: "wrap",
    marginBottom: "16px",
  },
  signOffBadge: {
    minWidth: "190px",
    padding: "14px",
    borderRadius: "18px",
    background: "#fef3c7",
    border: "1px solid #e0ba28",
    color: "#07182c",
    display: "grid",
    gap: "4px",
    textAlign: "center",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
    marginBottom: "16px",
  },
  checklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "10px",
    marginBottom: "16px",
  },
  checkItem: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "10px",
    padding: "12px",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  notesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "12px",
    marginBottom: "16px",
  },
  signOffActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    marginTop: "12px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "900px",
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
  disclaimer: {
    marginTop: "18px",
    padding: "14px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    fontWeight: "800",
    lineHeight: 1.5,
  },
};
