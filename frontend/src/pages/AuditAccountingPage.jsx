import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const SIGN_OFF_CHECKLIST_ITEMS = [
  {
    key: "salesChecked",
    label: "Sales, receipts and payments checked",
    note: "Sales totals, sale items, receipts, cash, MoMo, bank, credit balances, voided sales and discounts have been reviewed.",
  },
  {
    key: "expensesChecked",
    label: "Expenses, purchases and returns checked",
    note: "Expenses, supplier purchases, purchase balances, returns and refund records have been reviewed.",
  },
  {
    key: "debtsChecked",
    label: "Customer debts and debt payments checked",
    note: "Outstanding debts, paid debts, debt payments and debt reconciliation differences have been reviewed.",
  },
  {
    key: "stockChecked",
    label: "Stock, adjustments, transfers and ledger sources checked",
    note: "Products, low stock, out-of-stock items, stock adjustments, stock transfers and Stock Movement Ledger source records have been reviewed.",
  },
  {
    key: "warningsChecked",
    label: "SMS, security and audit warnings reviewed",
    note: "Failed SMS, security SMS alerts, backup/restore activity, maintenance clear-data events, unlock requests and audit warnings have been reviewed.",
  },
  {
    key: "reportsChecked",
    label: "Reports, exports and backup pack prepared",
    note: "Reports, exports, audit pack, backup status, sign-off certificate and management notes have been prepared for records.",
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

const EMPTY_REVIEW_SUMMARY = {
  branch_id: null,
  branch: {},
  period: {},
  table_status: {},
  missing_tables: [],
  warnings: [],
  open_issues: [],
  summaries: {},
  recent_records: {},
  stock_ledger_note: "The Stock Movement Ledger has no separate table. It is rebuilt from sales, purchases, returns, stock adjustments and stock transfers.",
  sms_note: "SMS audit includes sent SMS, failed SMS, daily summary SMS and security alert SMS where sms_log is available.",
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
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

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return numberValue(value).toLocaleString("en-GH");
}

function formatMoney(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function plainMoney(value) {
  return numberValue(value).toFixed(2);
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

function dateToInputValue(date) {
  if (!date || Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function apiDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

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

function makeSafeFileName(value) {
  return String(value || "audit-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

function downloadCsv(filename, rows) {
  const csv = makeCsv(rows);

  if (!csv) {
    throw new Error("No data available for this CSV export.");
  }

  downloadTextFile(filename, csv, "text/csv;charset=utf-8");
}

function getIssueLevelStyle(level) {
  const cleanLevel = String(level || "info").toLowerCase();

  if (cleanLevel === "danger" || cleanLevel === "red") {
    return styles.redPill;
  }

  if (cleanLevel === "warning" || cleanLevel === "orange") {
    return styles.orangePill;
  }

  if (cleanLevel === "success" || cleanLevel === "green") {
    return styles.greenPill;
  }

  return styles.bluePill;
}

function formatStatus(value) {
  const cleanValue = String(value || "").toLowerCase();

  const labels = {
    draft: "Draft / In Progress",
    reviewed: "Reviewed by Accountant",
    approved: "Approved by Management",
    rejected: "Rejected / Needs Correction",
  };

  return labels[cleanValue] || value || "-";
}

function getBackendPeriodStatus(value) {
  const cleanValue = String(value || "draft").toLowerCase();

  if (["reviewed", "approved", "rejected"].includes(cleanValue)) {
    return cleanValue;
  }

  return "draft";
}

function getObjectValue(object, path, fallback = 0) {
  const parts = String(path).split(".");
  let current = object;

  for (const part of parts) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }

  return current ?? fallback;
}

export default function AuditAccountingPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canReview = role === "admin" || role === "manager" || role === "auditor";

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

  const [reviewSummary, setReviewSummary] = useState(EMPTY_REVIEW_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [periodType, setPeriodType] = useState("month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [savedSignOffId, setSavedSignOffId] = useState(null);
  const [signOff, setSignOff] = useState({
    ...EMPTY_SIGN_OFF,
    checklist: { ...EMPTY_SIGN_OFF.checklist },
  });
  const [signOffSaving, setSignOffSaving] = useState(false);
  const [signOffLoading, setSignOffLoading] = useState(false);
  const [signOffHistory, setSignOffHistory] = useState([]);

  const businessName = "Chalin 03 Company Limited";

  function getCurrentStoreLabel() {
    return `${currentStoreCode} - ${currentStoreName}${
      currentStoreLocation ? ` - ${currentStoreLocation}` : ""
    }`;
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

  const period = getPeriodRange();

  function fileName(base, extension) {
    const periodPart = makeSafeFileName(period.shortLabel);
    const storePart = makeSafeFileName(currentStoreCode);
    return `${base}_${storePart}_${periodPart}.${extension}`;
  }

  function getSignOffCompletion() {
    const checklist = signOff?.checklist || {};
    const checkedItems = SIGN_OFF_CHECKLIST_ITEMS.filter(
      (item) => checklist[item.key]
    ).length;

    const totalItems = SIGN_OFF_CHECKLIST_ITEMS.length;
    const percent =
      totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

    return {
      checkedItems,
      totalItems,
      percent,
      isComplete: checkedItems === totalItems,
    };
  }

  function resetSignOffForm() {
    setSavedSignOffId(null);
    setSignOff({
      ...EMPTY_SIGN_OFF,
      reviewDate: todayInput(),
      checklist: { ...EMPTY_SIGN_OFF.checklist },
    });
  }

  function mapDatabaseSignOff(row) {
    if (!row) return null;

    return {
      preparedBy: row.prepared_by_name || "",
      reviewedBy: row.reviewed_by_name || "",
      approvedBy: row.approved_by_name || "",
      reviewDate: row.review_date ? apiDate(row.review_date) : todayInput(),
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

  async function loadAuditReviewSummary() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.get("/audit-signoffs/review-summary", {
        params: {
          period_type: periodType,
          period_label: period.label,
          period_start: apiDate(period.start),
          period_end: apiDate(period.end),
        },
      });

      setReviewSummary({ ...EMPTY_REVIEW_SUMMARY, ...response.data });
      setMessage("Full audit and accounting review refreshed.");
    } catch (requestError) {
      setReviewSummary(EMPTY_REVIEW_SUMMARY);
      setError(
        requestError.response?.data?.message ||
          "Failed to load full audit review summary. Make sure the updated auditSignoffRoutes.js is installed and deployed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadLatestSignOffFromDatabase() {
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

      const savedSignOff = response.data.signoff;

      if (!savedSignOff) {
        resetSignOffForm();
        return;
      }

      setSavedSignOffId(savedSignOff.id || null);
      setSignOff(mapDatabaseSignOff(savedSignOff) || EMPTY_SIGN_OFF);
    } catch (requestError) {
      setSavedSignOffId(null);
      setError(
        requestError.response?.data?.message ||
          "Could not load the latest saved sign-off for this period."
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

  async function refreshEverything() {
    await loadAuditReviewSummary();
    await loadLatestSignOffFromDatabase();
    await loadSignOffHistory();
  }

  useEffect(() => {
    if (canReview) {
      refreshEverything();
    }
    // Reload audit/accounting review when store or period changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReview, branchId, periodType, customStartDate, customEndDate]);

  const auditData = useMemo(() => {
    const summaries = reviewSummary?.summaries || {};
    const openIssues = reviewSummary?.open_issues || [];
    const warnings = reviewSummary?.warnings || [];
    const missingTables = reviewSummary?.missing_tables || [];

    const dangerIssues = openIssues.filter((issue) =>
      ["danger", "red"].includes(String(issue.level || "").toLowerCase())
    ).length;

    const warningIssues = openIssues.filter((issue) =>
      ["warning", "orange"].includes(String(issue.level || "").toLowerCase())
    ).length;

    const infoIssues = openIssues.filter((issue) =>
      ["info", "blue"].includes(String(issue.level || "").toLowerCase())
    ).length;

    const riskScore = Math.min(
      100,
      dangerIssues * 20 + warningIssues * 10 + infoIssues * 4 + missingTables.length * 5
    );

    const auditScore = Math.max(0, 100 - riskScore);

    let auditStatus = "Needs Review";

    if (auditScore >= 85) {
      auditStatus = "Clean";
    } else if (auditScore >= 70) {
      auditStatus = "Acceptable";
    } else if (auditScore >= 50) {
      auditStatus = "Watch Closely";
    }

    const systemAuditFlags = [
      ...openIssues.map((issue) => ({
        severity: issue.level || "info",
        title: issue.area || "Audit Issue",
        detail: issue.message || "Review this record.",
        recommendation: "Check the related module before approving the period.",
      })),
      ...warnings.map((warning) => ({
        severity: "warning",
        title: "Backend audit warning",
        detail: warning,
        recommendation: "Check database table names, columns and migrations before approval.",
      })),
    ];

    if (systemAuditFlags.length === 0) {
      systemAuditFlags.push({
        severity: "green",
        title: "No major audit issue detected",
        detail:
          "The backend audit review summary did not find a major warning for this period.",
        recommendation:
          "Continue daily closing, regular backups, SMS monitoring and stock movement review.",
      });
    }

    const accountantSummary = [
      {
        section: "Period",
        label: "Selected Period",
        value: period.label,
        meaning: "Accounting/audit period currently being reviewed.",
        isText: true,
      },
      {
        section: "Sales",
        label: "Total Sales",
        value: getObjectValue(summaries, "sales.total_sales_amount"),
        meaning: "Completed sales amount recorded for this selected store and period.",
      },
      {
        section: "Sales",
        label: "Amount Paid",
        value: getObjectValue(summaries, "sales.total_amount_paid"),
        meaning: "Cash/MoMo/bank/customer amounts received from sales.",
      },
      {
        section: "Sales",
        label: "Sales Balance",
        value: getObjectValue(summaries, "sales.total_balance"),
        meaning: "Balance left on period sales records.",
      },
      {
        section: "Debts",
        label: "Outstanding Debts",
        value: getObjectValue(summaries, "debts.total_debt_balance"),
        meaning: "Unpaid customer debt balance that needs reconciliation and follow-up.",
      },
      {
        section: "Expenses",
        label: "Total Expenses",
        value: getObjectValue(summaries, "expenses.total_expense_amount"),
        meaning: "Expenses recorded in the selected period.",
      },
      {
        section: "Purchases",
        label: "Total Purchases",
        value: getObjectValue(summaries, "purchases.total_purchase_amount"),
        meaning: "Supplier purchases recorded in the selected period.",
      },
      {
        section: "Returns",
        label: "Refund / Return Amount",
        value: getObjectValue(summaries, "returns.total_refund_amount"),
        meaning: "Refund/return amount recorded in the selected period.",
      },
      {
        section: "Stock",
        label: "Stock Selling Value",
        value: getObjectValue(summaries, "stock.stock_value_at_selling"),
        meaning: "Estimated selling value of available stock in selected store.",
      },
      {
        section: "Stock",
        label: "Stock Cost Value",
        value: getObjectValue(summaries, "stock.stock_value_at_cost"),
        meaning: "Estimated cost value of available stock in selected store.",
      },
      {
        section: "SMS",
        label: "Failed SMS Count",
        value: getObjectValue(summaries, "sms.failed_count"),
        meaning: "Failed SMS records that should be reviewed before sign-off.",
        isCount: true,
      },
      {
        section: "Maintenance",
        label: "Restore Activity Count",
        value: getObjectValue(
          summaries,
          "security_and_maintenance.restore_activity_count"
        ),
        meaning: "Restore actions in the selected period. These must be approved by management.",
        isCount: true,
      },
    ];

    return {
      summaries,
      openIssues,
      warnings,
      missingTables,
      auditScore,
      auditStatus,
      dangerIssues,
      warningIssues,
      infoIssues,
      systemAuditFlags,
      accountantSummary,
      recentStockAdjustments:
        reviewSummary?.recent_records?.stock_adjustments || [],
      recentStockTransfers: reviewSummary?.recent_records?.stock_transfers || [],
      recentSmsFailures: reviewSummary?.recent_records?.sms_failures || [],
      tableStatus: reviewSummary?.table_status || {},
    };
  }, [reviewSummary, period.label]);

  const signOffCompletion = getSignOffCompletion();

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
      period_label: period.label,
      period_start: apiDate(period.start),
      period_end: apiDate(period.end),
      audit_score: auditData.auditScore,
      audit_status: auditData.auditStatus,
      prepared_by_name: signOff.preparedBy,
      reviewed_by_name: signOff.reviewedBy,
      approved_by_name: signOff.approvedBy,
      review_date: signOff.reviewDate || todayInput(),
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
      const response = await axiosClient.post(
        "/audit-signoffs",
        buildSignOffPayload()
      );

      const savedSignOff = response.data.signoff;

      if (savedSignOff) {
        setSavedSignOffId(savedSignOff.id || null);
        setSignOff(mapDatabaseSignOff(savedSignOff) || signOff);
      }

      await loadSignOffHistory();
      setMessage(
        response.data.message || "Audit sign-off saved into MySQL successfully."
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not save audit sign-off into the database."
      );
    } finally {
      setSignOffSaving(false);
    }
  }

  function clearSignOffDetails() {
    const confirmed = window.confirm(
      "Clear the sign-off form for this selected period? This will not delete saved MySQL records."
    );

    if (!confirmed) return;

    resetSignOffForm();
    setMessage("Audit sign-off form cleared. Saved database records were not deleted.");
  }

  function buildSummaryRows() {
    return [
      ...auditData.accountantSummary.map((item) => ({
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: period.label,
        section: item.section,
        item: item.label,
        value: item.isText
          ? item.value
          : item.isCount
          ? formatNumber(item.value)
          : plainMoney(item.value),
        meaning: item.meaning,
      })),
      {
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: period.label,
        section: "Audit Score",
        item: "Audit Score",
        value: `${auditData.auditScore}%`,
        meaning: auditData.auditStatus,
      },
      {
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: period.label,
        section: "Audit Score",
        item: "Danger Issues",
        value: auditData.dangerIssues,
        meaning: "High risk issues.",
      },
      {
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: period.label,
        section: "Audit Score",
        item: "Warning Issues",
        value: auditData.warningIssues,
        meaning: "Medium risk issues.",
      },
    ];
  }

  function buildWarningRows() {
    return auditData.systemAuditFlags.map((flag, index) => ({
      number: index + 1,
      store_code: currentStoreCode,
      store_name: currentStoreName,
      period: period.label,
      severity: flag.severity,
      title: flag.title,
      detail: flag.detail,
      recommendation: flag.recommendation,
    }));
  }

  function buildTableStatusRows() {
    return Object.entries(auditData.tableStatus || {}).map(
      ([tableName, exists]) => ({
        table_name: tableName,
        available: exists ? "Yes" : "No",
        note: exists
          ? "Included in audit review where relevant."
          : "Missing or skipped by backend audit review.",
      })
    );
  }

  function downloadAccountingSummaryCsv() {
    try {
      downloadCsv(fileName("chalin03_accounting_summary", "csv"), buildSummaryRows());
      setMessage("Accounting summary CSV downloaded.");
    } catch (csvError) {
      setError(csvError.message);
    }
  }

  function downloadAuditWarningsCsv() {
    try {
      downloadCsv(fileName("chalin03_audit_warnings", "csv"), buildWarningRows());
      setMessage("Audit warnings CSV downloaded.");
    } catch (csvError) {
      setError(csvError.message);
    }
  }

  function downloadFullAuditWorkbookCsv() {
    const rows = [
      ...buildSummaryRows(),
      ...buildWarningRows().map((row) => ({
        store_code: row.store_code,
        store_name: row.store_name,
        period: row.period,
        section: "Audit Warning",
        item: row.title,
        value: row.severity,
        meaning: `${row.detail} Recommendation: ${row.recommendation}`,
      })),
      ...buildTableStatusRows().map((row) => ({
        store_code: currentStoreCode,
        store_name: currentStoreName,
        period: period.label,
        section: "Table Status",
        item: row.table_name,
        value: row.available,
        meaning: row.note,
      })),
    ];

    try {
      downloadCsv(fileName("chalin03_full_audit_workbook", "csv"), rows);
      setMessage("Full audit workbook CSV downloaded.");
    } catch (csvError) {
      setError(csvError.message);
    }
  }

  function downloadRecentStockAdjustmentsCsv() {
    const rows = auditData.recentStockAdjustments.map((item) => ({
      id: item.id,
      product_name: item.product_name || "",
      adjustment_type: item.adjustment_type || "",
      quantity: item.quantity || 0,
      old_quantity: item.old_quantity || 0,
      new_quantity: item.new_quantity || 0,
      reason: item.reason || "",
      adjusted_by: item.adjusted_by_name || "",
      adjusted_at: formatDateTime(item.adjusted_at),
    }));

    try {
      downloadCsv(fileName("chalin03_recent_stock_adjustments", "csv"), rows);
      setMessage("Recent stock adjustments CSV downloaded.");
    } catch (csvError) {
      setError(csvError.message);
    }
  }

  function downloadRecentStockTransfersCsv() {
    const rows = auditData.recentStockTransfers.map((item) => ({
      id: item.id,
      transfer_number: item.transfer_number || "",
      status: item.status || "",
      from_branch: item.from_branch_name || "",
      to_branch: item.to_branch_name || "",
      requested_by: item.requested_by_name || "",
      created_at: formatDateTime(item.created_at),
    }));

    try {
      downloadCsv(fileName("chalin03_recent_stock_transfers", "csv"), rows);
      setMessage("Recent stock transfers CSV downloaded.");
    } catch (csvError) {
      setError(csvError.message);
    }
  }

  function downloadFailedSmsCsv() {
    const rows = auditData.recentSmsFailures.map((item) => ({
      id: item.id,
      recipient_phone: item.recipient_phone || "",
      sms_type: item.sms_type || "",
      status: item.status || "",
      error_message: item.error_message || "",
      sent_at: formatDateTime(item.sent_at || item.created_at),
    }));

    try {
      downloadCsv(fileName("chalin03_failed_sms_audit", "csv"), rows);
      setMessage("Failed SMS audit CSV downloaded.");
    } catch (csvError) {
      setError(csvError.message);
    }
  }

  function buildPrintableReport() {
    const summaryRows = auditData.accountantSummary
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.section)}</td>
            <td>${escapeHtml(item.label)}</td>
            <td>${escapeHtml(
              item.isText
                ? item.value
                : item.isCount
                ? formatNumber(item.value)
                : formatMoney(item.value)
            )}</td>
            <td>${escapeHtml(item.meaning)}</td>
          </tr>
        `
      )
      .join("");

    const warningRows = auditData.systemAuditFlags
      .map(
        (flag, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(String(flag.severity || "").toUpperCase())}</td>
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
          <td>${signOff.checklist?.[item.key] ? "Checked" : "Pending"}</td>
          <td>${escapeHtml(item.note)}</td>
        </tr>
      `
    ).join("");

    const stockAdjustmentRows = auditData.recentStockAdjustments
      .slice(0, 12)
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(formatDateTime(item.adjusted_at))}</td>
            <td>${escapeHtml(item.product_name || "-")}</td>
            <td>${escapeHtml(item.adjustment_type || "-")}</td>
            <td>${escapeHtml(item.quantity || 0)}</td>
            <td>${escapeHtml(item.reason || "-")}</td>
          </tr>
        `
      )
      .join("");

    const stockTransferRows = auditData.recentStockTransfers
      .slice(0, 12)
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(formatDateTime(item.created_at))}</td>
            <td>${escapeHtml(item.transfer_number || `Transfer #${item.id}`)}</td>
            <td>${escapeHtml(item.status || "-")}</td>
            <td>${escapeHtml(item.from_branch_name || "-")}</td>
            <td>${escapeHtml(item.to_branch_name || "-")}</td>
          </tr>
        `
      )
      .join("");

    const failedSmsRows = auditData.recentSmsFailures
      .slice(0, 12)
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(formatDateTime(item.sent_at || item.created_at))}</td>
            <td>${escapeHtml(item.recipient_phone || "-")}</td>
            <td>${escapeHtml(item.sms_type || "-")}</td>
            <td>${escapeHtml(item.status || "-")}</td>
            <td>${escapeHtml(item.error_message || "-")}</td>
          </tr>
        `
      )
      .join("");

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
            .header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 3px solid #07182c; padding-bottom: 12px; margin-bottom: 16px; }
            .muted { color: #64748b; }
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
              <p class="muted">Full Audit & Accounting Intelligence Review</p>
              <p><strong>Store:</strong> ${escapeHtml(getCurrentStoreLabel())}</p>
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
            <div class="box"><span>Total Sales</span><strong>${formatMoney(getObjectValue(auditData.summaries, "sales.total_sales_amount"))}</strong></div>
            <div class="box"><span>Outstanding Debts</span><strong>${formatMoney(getObjectValue(auditData.summaries, "debts.total_debt_balance"))}</strong></div>
            <div class="box"><span>Expenses</span><strong>${formatMoney(getObjectValue(auditData.summaries, "expenses.total_expense_amount"))}</strong></div>
            <div class="box"><span>Purchases</span><strong>${formatMoney(getObjectValue(auditData.summaries, "purchases.total_purchase_amount"))}</strong></div>
            <div class="box"><span>Low Stock</span><strong>${formatNumber(getObjectValue(auditData.summaries, "stock.low_stock_count"))}</strong></div>
            <div class="box"><span>Stock Adjustments</span><strong>${formatNumber(getObjectValue(auditData.summaries, "stock_adjustments.total_adjustments"))}</strong></div>
            <div class="box"><span>Stock Transfers</span><strong>${formatNumber(getObjectValue(auditData.summaries, "stock_transfers.total_transfers"))}</strong></div>
            <div class="box"><span>Failed SMS</span><strong>${formatNumber(getObjectValue(auditData.summaries, "sms.failed_count"))}</strong></div>
          </div>

          <div class="notice">
            ${escapeHtml(reviewSummary.stock_ledger_note)}<br />
            ${escapeHtml(reviewSummary.sms_note)}
          </div>

          <h2>1. Accounting Summary</h2>
          <table><thead><tr><th>Section</th><th>Item</th><th>Amount / Count</th><th>Meaning</th></tr></thead><tbody>${summaryRows}</tbody></table>

          <h2>2. Risk Command Register</h2>
          <table><thead><tr><th>#</th><th>Risk</th><th>Finding</th><th>Details</th><th>Recommendation</th></tr></thead><tbody>${warningRows}</tbody></table>

          <h2>3. Stock Adjustment Review</h2>
          <table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Reason</th></tr></thead><tbody>${stockAdjustmentRows || "<tr><td colspan='5'>No recent stock adjustments.</td></tr>"}</tbody></table>

          <h2>4. Stock Transfer Review</h2>
          <table><thead><tr><th>Date</th><th>Transfer</th><th>Status</th><th>From</th><th>To</th></tr></thead><tbody>${stockTransferRows || "<tr><td colspan='5'>No recent stock transfers.</td></tr>"}</tbody></table>

          <h2>5. Failed SMS Review</h2>
          <table><thead><tr><th>Date</th><th>Phone</th><th>SMS Type</th><th>Status</th><th>Error</th></tr></thead><tbody>${failedSmsRows || "<tr><td colspan='5'>No failed SMS records.</td></tr>"}</tbody></table>

          <h2>6. Audit Sign-Off & Approval</h2>
          <div class="grid">
            <div class="box"><span>Prepared By</span><strong>${escapeHtml(signOff.preparedBy || "Not provided")}</strong></div>
            <div class="box"><span>Reviewed By</span><strong>${escapeHtml(signOff.reviewedBy || "Not provided")}</strong></div>
            <div class="box"><span>Approved By</span><strong>${escapeHtml(signOff.approvedBy || "Not provided")}</strong></div>
            <div class="box"><span>Status</span><strong>${escapeHtml(formatStatus(signOff.accountingStatus))}</strong></div>
            <div class="box"><span>Completion</span><strong>${signOffCompletion.percent}%</strong></div>
            <div class="box"><span>Review Date</span><strong>${escapeHtml(formatDate(signOff.reviewDate))}</strong></div>
          </div>
          <table><thead><tr><th>Check</th><th>Status</th><th>Note</th></tr></thead><tbody>${checklistRows}</tbody></table>
          <p><strong>Accountant Notes:</strong> ${escapeHtml(signOff.accountantNotes || "-")}</p>
          <p><strong>Boss / Management Notes:</strong> ${escapeHtml(signOff.bossNotes || "-")}</p>

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

  function downloadAuditReportWord() {
    downloadWordFile(
      fileName("chalin03_full_audit_accounting_report", "doc"),
      buildPrintableReport()
    );
    setMessage("Full audit Word report downloaded.");
  }

  function buildPowerPointOutline() {
    const lines = [
      "CHALIN 03 COMPANY LIMITED",
      "FULL AUDIT & ACCOUNTING INTELLIGENCE BRIEFING OUTLINE",
      "",
      "Slide 1: Title",
      `${businessName} - Full Audit & Accounting Review`,
      `Store: ${getCurrentStoreLabel()}`,
      `Period: ${period.label}`,
      `Generated: ${formatDateTime(new Date())}`,
      "",
      "Slide 2: Audit Health Score",
      `Audit Score: ${auditData.auditScore}%`,
      `Status: ${auditData.auditStatus}`,
      `Danger Issues: ${auditData.dangerIssues}`,
      `Warning Issues: ${auditData.warningIssues}`,
      "",
      "Slide 3: Sales, Cash and Debts",
      `Sales: ${formatMoney(getObjectValue(auditData.summaries, "sales.total_sales_amount"))}`,
      `Amount Paid: ${formatMoney(getObjectValue(auditData.summaries, "sales.total_amount_paid"))}`,
      `Outstanding Debts: ${formatMoney(getObjectValue(auditData.summaries, "debts.total_debt_balance"))}`,
      "",
      "Slide 4: Expenses, Purchases and Returns",
      `Expenses: ${formatMoney(getObjectValue(auditData.summaries, "expenses.total_expense_amount"))}`,
      `Purchases: ${formatMoney(getObjectValue(auditData.summaries, "purchases.total_purchase_amount"))}`,
      `Returns: ${formatMoney(getObjectValue(auditData.summaries, "returns.total_refund_amount"))}`,
      "",
      "Slide 5: Stock Controls",
      `Low Stock: ${formatNumber(getObjectValue(auditData.summaries, "stock.low_stock_count"))}`,
      `Stock Adjustments: ${formatNumber(getObjectValue(auditData.summaries, "stock_adjustments.total_adjustments"))}`,
      `Stock Transfers: ${formatNumber(getObjectValue(auditData.summaries, "stock_transfers.total_transfers"))}`,
      `Transfer Quantity Mismatches: ${formatNumber(getObjectValue(auditData.summaries, "stock_transfers.quantity_mismatch_count"))}`,
      "",
      "Slide 6: SMS, Backup and Maintenance",
      `Total SMS: ${formatNumber(getObjectValue(auditData.summaries, "sms.total_sms"))}`,
      `Failed SMS: ${formatNumber(getObjectValue(auditData.summaries, "sms.failed_count"))}`,
      `Backup Activities: ${formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.backup_activity_count"))}`,
      `Restore Activities: ${formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.restore_activity_count"))}`,
      "",
      "Slide 7: Top Audit Issues",
      ...auditData.systemAuditFlags
        .slice(0, 10)
        .map((flag) => `- ${flag.title}: ${flag.detail}`),
    ];

    return lines.join("\n");
  }

  function downloadPowerPointOutlineText() {
    downloadTextFile(
      fileName("chalin03_powerpoint_audit_briefing_outline", "txt"),
      buildPowerPointOutline(),
      "text/plain;charset=utf-8"
    );

    setMessage("PowerPoint outline text file downloaded.");
  }

  function buildSignOffCertificateDocument() {
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
        <p class="muted">Full Audit Sign-Off & Accounting Approval Certificate</p>

        <div class="status">
          ${escapeHtml(formatStatus(signOff.accountingStatus))}<br />
          Completion: ${signOffCompletion.percent}% | Audit Score: ${auditData.auditScore}% ${escapeHtml(auditData.auditStatus)}
        </div>

        <div class="grid">
          <div class="box"><strong>Store:</strong><br />${escapeHtml(currentStoreCode)} - ${escapeHtml(currentStoreName)}</div>
          <div class="box"><strong>Accounting Period:</strong><br />${escapeHtml(period.label)}</div>
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
      fileName("chalin03_full_audit_signoff_certificate", "doc"),
      buildSignOffCertificateDocument()
    );

    setMessage("Audit sign-off certificate downloaded.");
  }

  function downloadMonthEndAuditPack() {
    downloadAuditReportWord();

    setTimeout(() => downloadAccountingSummaryCsv(), 300);
    setTimeout(() => downloadAuditWarningsCsv(), 600);
    setTimeout(() => downloadFullAuditWorkbookCsv(), 900);
    setTimeout(() => downloadPowerPointOutlineText(), 1200);
    setTimeout(() => downloadSignOffCertificateWord(), 1500);

    setMessage("Month-End Audit Pack is downloading.");
  }

  async function copyAuditSummary() {
    const summary = `${businessName.toUpperCase()}\nFULL AUDIT & ACCOUNTING SUMMARY\n\nStore: ${getCurrentStoreLabel()}\nPeriod: ${period.label}\nGenerated: ${formatDateTime(new Date())}\n\nAudit Score: ${auditData.auditScore}% - ${auditData.auditStatus}\nDanger Issues: ${auditData.dangerIssues}\nWarning Issues: ${auditData.warningIssues}\n\nSales: ${formatMoney(getObjectValue(auditData.summaries, "sales.total_sales_amount"))}\nAmount Paid: ${formatMoney(getObjectValue(auditData.summaries, "sales.total_amount_paid"))}\nOutstanding Debts: ${formatMoney(getObjectValue(auditData.summaries, "debts.total_debt_balance"))}\nExpenses: ${formatMoney(getObjectValue(auditData.summaries, "expenses.total_expense_amount"))}\nPurchases: ${formatMoney(getObjectValue(auditData.summaries, "purchases.total_purchase_amount"))}\nStock Adjustments: ${formatNumber(getObjectValue(auditData.summaries, "stock_adjustments.total_adjustments"))}\nStock Transfers: ${formatNumber(getObjectValue(auditData.summaries, "stock_transfers.total_transfers"))}\nFailed SMS: ${formatNumber(getObjectValue(auditData.summaries, "sms.failed_count"))}\nRestore Activity: ${formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.restore_activity_count"))}\n\nSign-Off Status: ${formatStatus(signOff.accountingStatus)}\nPrepared By: ${signOff.preparedBy || "-"}\nReviewed By: ${signOff.reviewedBy || "-"}\nApproved By: ${signOff.approvedBy || "-"}`;

    try {
      await navigator.clipboard.writeText(summary);
      setMessage("Audit summary copied successfully.");
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

  if (!canReview) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open Audit & Accounting Intelligence for{" "}
              {currentStoreCode} — {currentStoreName}.
            </p>
          </div>
        </div>

        <div className="error-box">
          Only admin, manager and auditor accounts can open audit/accounting review.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Audit Command Board</p>
          <h1 style={styles.title}>Audit Command Board & Accounting Lock Room</h1>
          <p style={styles.subtitle}>
            Control sales, cash, debts, expenses, purchases, returns, stock
            adjustments, stock transfers, SMS, backup/restore activity,
            maintenance events and period sign-off approval for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
            . This layout is styled as an audit command room for management review.
          </p>
        </div>

        <div style={styles.heroActions}>
          <button type="button" onClick={refreshEverything} disabled={loading}>
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

      <div style={styles.storeNotice}>
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Audit review, accounting figures, stock transfer review, SMS checks,
          backup/restore checks, sign-off records, exports and certificates are
          filtered to this selected store only.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.periodPanel}>
        <div>
          <p style={styles.eyebrowDark}>Period Lock Selector</p>
          <h2 style={{ margin: "5px 0" }}>{period.label}</h2>
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
            <h2>Command Audit Score</h2>
            <p>
              The score is based on sales, debts, expenses, purchases, returns,
              low stock, stock adjustments, transfers, failed SMS,
              backup/restore, maintenance and audit unlock warnings.
            </p>

            <div style={styles.flagMiniGrid}>
              <span style={styles.redPill}>{auditData.dangerIssues} Danger</span>
              <span style={styles.orangePill}>{auditData.warningIssues} Warning</span>
              <span style={styles.bluePill}>{auditData.infoIssues} Info</span>
            </div>
          </div>
        </div>

        <div style={styles.exportPanel}>
          <h2>Audit Pack Vault</h2>
          <p style={styles.panelText}>
            Exports use the selected accounting period and selected store.
          </p>

          <div style={styles.monthPack}>
            <h3>Month-End Audit Pack</h3>
            <p>
              Downloads Word report, accounting CSVs, full audit workbook,
              PowerPoint outline and sign-off certificate for {currentStoreCode}.
            </p>
            <button type="button" onClick={downloadMonthEndAuditPack}>
              Generate Month-End Audit Pack
            </button>
          </div>

          <div style={styles.exportGrid}>
            <button type="button" onClick={printAuditReport}>PDF Report</button>
            <button type="button" onClick={downloadAuditReportWord}>Audit Report Word</button>
            <button type="button" onClick={downloadAccountingSummaryCsv}>Accounting Summary CSV</button>
            <button type="button" onClick={downloadAuditWarningsCsv}>Audit Warnings CSV</button>
            <button type="button" onClick={downloadFullAuditWorkbookCsv}>Full Audit Workbook CSV</button>
            <button type="button" onClick={downloadRecentStockAdjustmentsCsv}>Stock Adjustments CSV</button>
            <button type="button" onClick={downloadRecentStockTransfersCsv}>Stock Transfers CSV</button>
            <button type="button" onClick={downloadFailedSmsCsv}>Failed SMS CSV</button>
            <button type="button" onClick={downloadPowerPointOutlineText}>PowerPoint Outline</button>
            <button type="button" onClick={downloadSignOffCertificateWord}>Sign-Off Certificate Word</button>
          </div>
        </div>
      </div>

      <div style={styles.cardsGrid}>
        <MetricCard title={`${currentStoreCode} Sales`} value={formatMoney(getObjectValue(auditData.summaries, "sales.total_sales_amount"))} note={`${formatNumber(getObjectValue(auditData.summaries, "sales.total_sales"))} sale(s)`} icon="📈" />
        <MetricCard title="Amount Paid" value={formatMoney(getObjectValue(auditData.summaries, "sales.total_amount_paid"))} note="Cash, MoMo, bank and paid portions" icon="💰" />
        <MetricCard title="Outstanding Debts" value={formatMoney(getObjectValue(auditData.summaries, "debts.total_debt_balance"))} note={`${formatNumber(getObjectValue(auditData.summaries, "debts.unpaid_debt_count"))} unpaid debt(s)`} icon="📞" />
        <MetricCard title="Expenses" value={formatMoney(getObjectValue(auditData.summaries, "expenses.total_expense_amount"))} note={`${formatNumber(getObjectValue(auditData.summaries, "expenses.total_expenses"))} expense record(s)`} icon="📉" />
        <MetricCard title="Purchases" value={formatMoney(getObjectValue(auditData.summaries, "purchases.total_purchase_amount"))} note={`${formatNumber(getObjectValue(auditData.summaries, "purchases.total_purchases"))} purchase(s)`} icon="🧾" />
        <MetricCard title="Returns" value={formatMoney(getObjectValue(auditData.summaries, "returns.total_refund_amount"))} note={`${formatNumber(getObjectValue(auditData.summaries, "returns.total_returns"))} return record(s)`} icon="↩️" />
        <MetricCard title="Stock Value" value={formatMoney(getObjectValue(auditData.summaries, "stock.stock_value_at_selling"))} note={`${formatNumber(getObjectValue(auditData.summaries, "stock.low_stock_count"))} low stock item(s)`} icon="📦" />
        <MetricCard title="Stock Adjustments" value={formatNumber(getObjectValue(auditData.summaries, "stock_adjustments.total_adjustments"))} note={`${formatNumber(getObjectValue(auditData.summaries, "stock_adjustments.lost_count"))} lost, ${formatNumber(getObjectValue(auditData.summaries, "stock_adjustments.damaged_count"))} damaged`} icon="🛠️" />
        <MetricCard title="Stock Transfers" value={formatNumber(getObjectValue(auditData.summaries, "stock_transfers.total_transfers"))} note={`${formatNumber(getObjectValue(auditData.summaries, "stock_transfers.dispatched_count"))} dispatched, ${formatNumber(getObjectValue(auditData.summaries, "stock_transfers.received_count"))} received`} icon="🚚" />
        <MetricCard title="SMS Records" value={formatNumber(getObjectValue(auditData.summaries, "sms.total_sms"))} note={`${formatNumber(getObjectValue(auditData.summaries, "sms.failed_count"))} failed SMS`} icon="📩" />
        <MetricCard title="Backup / Restore" value={formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.backup_activity_count"))} note={`${formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.restore_activity_count"))} restore activity`} icon="🛡️" />
        <MetricCard title="Unlock Requests" value={formatNumber(getObjectValue(auditData.summaries, "audit.total_unlock_requests"))} note={`${formatNumber(getObjectValue(auditData.summaries, "audit.pending_unlock_count"))} pending`} icon="🔓" />
      </div>

      <div style={styles.noticeGrid}>
        <div style={styles.warningNotice}>
          <strong>Stock Movement Ledger:</strong> {reviewSummary.stock_ledger_note}
        </div>
        <div style={styles.warningNotice}>
          <strong>SMS Audit:</strong> {reviewSummary.sms_note}
        </div>
      </div>

      <div style={styles.twoColumn}>
        <div style={styles.panel}>
          <h2>Accounting Summary</h2>
          <p style={styles.panelText}>Main figures for the selected period.</p>

          <div style={styles.accountingRows}>
            {auditData.accountantSummary.map((item) => (
              <div key={`${item.section}-${item.label}`} style={styles.accountingRow}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.meaning}</span>
                </div>
                <b>
                  {item.isText
                    ? item.value
                    : item.isCount
                    ? formatNumber(item.value)
                    : formatMoney(item.value)}
                </b>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <h2>System Control Watch</h2>
          <p style={styles.panelText}>Backup, restore, clear-data and audit unlock activity.</p>

          <AccountingRow label="Backup Activity" value={formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.backup_activity_count"))} />
          <AccountingRow label="Restore Activity" value={formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.restore_activity_count"))} />
          <AccountingRow label="Clear Business Data Activity" value={formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.clear_business_data_count"))} />
          <AccountingRow label="Audit Activity" value={formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.audit_activity_count"))} />
          <AccountingRow label="Delete Activity" value={formatNumber(getObjectValue(auditData.summaries, "security_and_maintenance.delete_activity_count"))} />
          <AccountingRow label="Pending Unlock Requests" value={formatNumber(getObjectValue(auditData.summaries, "audit.pending_unlock_count"))} />
        </div>
      </div>

      <div style={styles.twoColumn}>
        <div style={styles.panel}>
          <h2>Risk Command Register</h2>
          <p style={styles.panelText}>Warnings that need management or accountant review.</p>

          <div style={styles.flagList}>
            {auditData.systemAuditFlags.slice(0, 30).map((flag, index) => (
              <div key={`${flag.title}-${index}`} style={styles.flagItem}>
                <span style={getIssueLevelStyle(flag.severity)}>{flag.severity}</span>
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
          <h2>Backend Source Coverage</h2>
          <p style={styles.panelText}>Backend audit source tables included in the review.</p>

          {buildTableStatusRows().length === 0 ? (
            <div style={styles.emptyState}>No table status loaded yet.</div>
          ) : (
            <div style={styles.tableStatusGrid}>
              {buildTableStatusRows().map((row) => (
                <div key={row.table_name} style={styles.tableStatusItem}>
                  <strong>{row.table_name}</strong>
                  <span>{row.available === "Yes" ? "Available" : "Missing"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.threeColumn}>
        <RecentRecordsPanel
          title="Recent Stock Adjustments"
          emptyText="No recent stock adjustments found."
          records={auditData.recentStockAdjustments}
          renderRecord={(item) => (
            <div style={styles.recentRecord}>
              <strong>{item.product_name || "Unknown product"}</strong>
              <span>
                {item.adjustment_type || "Adjustment"} • Qty {formatNumber(item.quantity)} • {formatDateTime(item.adjusted_at)}
              </span>
              <small>{item.reason || "No reason provided"}</small>
            </div>
          )}
        />

        <RecentRecordsPanel
          title="Recent Stock Transfers"
          emptyText="No recent stock transfers found."
          records={auditData.recentStockTransfers}
          renderRecord={(item) => (
            <div style={styles.recentRecord}>
              <strong>{item.transfer_number || `Transfer #${item.id}`}</strong>
              <span>
                {item.status || "-"} • {item.from_branch_name || "-"} → {item.to_branch_name || "-"}
              </span>
              <small>{formatDateTime(item.created_at)}</small>
            </div>
          )}
        />

        <RecentRecordsPanel
          title="Recent Failed SMS"
          emptyText="No failed SMS records found."
          records={auditData.recentSmsFailures}
          renderRecord={(item) => (
            <div style={styles.recentRecord}>
              <strong>{item.recipient_phone || "No phone"}</strong>
              <span>
                {item.sms_type || "SMS"} • {item.status || "failed"} • {formatDateTime(item.sent_at || item.created_at)}
              </span>
              <small>{item.error_message || "No provider error saved"}</small>
            </div>
          )}
        />
      </div>

      <div style={styles.signOffPanel}>
        <div style={styles.signOffHeader}>
          <div>
            <p style={styles.eyebrowDark}>Audit Sign-Off & Accounting Approval</p>
            <h2 style={{ margin: "5px 0" }}>Sign-Off Control Room</h2>
            <p style={styles.panelText}>
              Save the audit approval to MySQL after the accountant and boss review the period for {currentStoreCode}.
            </p>
          </div>

          <div style={styles.signOffBadge}>
            <strong>{signOffCompletion.percent}%</strong>
            <span>{formatStatus(signOff.accountingStatus)}</span>
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
              placeholder="Write accountant review notes, corrections needed, reconciliation notes or approval comments."
              rows={6}
            />
          </label>

          <label>
            Boss / Management Notes
            <textarea
              value={signOff.bossNotes}
              onChange={(event) => updateSignOffField("bossNotes", event.target.value)}
              placeholder="Write management decision, approval note, follow-up instruction or risk comment."
              rows={6}
            />
          </label>
        </div>

        <div style={styles.signOffActions}>
          <button type="button" onClick={saveSignOffDetails} disabled={signOffSaving}>
            {signOffSaving ? "Saving..." : "Save Sign-Off to MySQL"}
          </button>

          <button type="button" className="secondary-button" onClick={clearSignOffDetails}>
            Clear Form
          </button>

          <button type="button" className="secondary-button" onClick={downloadSignOffCertificateWord}>
            Download Certificate
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <h2>Recent Approval History - {currentStoreCode}</h2>
        {signOffHistory.length === 0 ? (
          <div style={styles.emptyState}>No sign-off history found for this selected store.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table>
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
                {signOffHistory.slice(0, 10).map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>
                    <td>
                      <strong>{item.period_label}</strong>
                      <br />
                      <small>{item.period_type}</small>
                    </td>
                    <td>{formatNumber(item.audit_score)}%</td>
                    <td>{formatStatus(item.period_status)}</td>
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

function MetricCard({ title, value, note, icon }) {
  return (
    <div style={styles.metricCard}>
      <span style={styles.metricIcon}>{icon}</span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function AccountingRow({ label, value }) {
  return (
    <div style={styles.accountingRow}>
      <div>
        <strong>{label}</strong>
      </div>
      <b>{value}</b>
    </div>
  );
}

function RecentRecordsPanel({ title, records, emptyText, renderRecord }) {
  return (
    <div style={styles.panel}>
      <h2>{title}</h2>
      {records.length === 0 ? (
        <div style={styles.emptyState}>{emptyText}</div>
      ) : (
        <div style={styles.recentList}>
          {records.slice(0, 8).map((item, index) => (
            <div key={`${title}-${item.id || index}`}>{renderRecord(item)}</div>
          ))}
        </div>
      )}
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
    position: "relative",
    overflow: "hidden",
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    flexWrap: "wrap",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "24px",
    borderRadius: "26px",
    background:
      "linear-gradient(135deg, #111827 0%, #451a03 44%, #0f172a 100%)",
    color: "#ffffff",
    boxShadow: "0 26px 70px rgba(69, 26, 3, 0.26)",
  },
  eyebrow: {
    margin: 0,
    color: "#fbbf24",
    fontSize: "12px",
    fontWeight: "950",
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  eyebrowDark: {
    margin: 0,
    color: "#92400e",
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
    maxWidth: "920px",
    lineHeight: 1.6,
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },
  storeNotice: {
    marginBottom: "18px",
    padding: "14px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #fff7ed, #ffffff)",
    border: "1px solid #fed7aa",
    color: "#92400e",
    fontWeight: "800",
  },
  periodPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, auto)",
    gap: "16px",
    alignItems: "center",
    padding: "18px",
    borderRadius: "22px",
    background: "linear-gradient(180deg, #ffffff, #fffbeb)",
    border: "1px solid #fed7aa",
    boxShadow: "0 18px 44px rgba(146, 64, 14, 0.09)",
    marginBottom: "18px",
  },
  periodButtons: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  periodButton: {
    background: "#f8fafc",
    color: "#07182c",
    border: "1px solid #dbe3ef",
  },
  activePeriodButton: {
    background: "#451a03",
    color: "#ffffff",
    border: "1px solid #451a03",
  },
  dateGrid: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
  },
  panelText: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.6,
  },
  scoreGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 0.95fr) minmax(300px, 1.05fr)",
    gap: "18px",
    marginBottom: "18px",
  },
  scoreCard: {
    display: "flex",
    gap: "18px",
    alignItems: "center",
    padding: "22px",
    borderRadius: "24px",
    background: "linear-gradient(180deg, #ffffff, #fffbeb)",
    border: "1px solid #fed7aa",
    boxShadow: "0 18px 44px rgba(146, 64, 14, 0.09)",
  },
  scoreRing: {
    width: "150px",
    height: "150px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  scoreInner: {
    width: "108px",
    height: "108px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    color: "#07182c",
    fontWeight: "950",
  },
  flagMiniGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "10px",
  },
  redPill: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: "950",
    fontSize: "12px",
  },
  orangePill: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#ffedd5",
    color: "#9a3412",
    fontWeight: "950",
    fontSize: "12px",
  },
  bluePill: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontWeight: "950",
    fontSize: "12px",
  },
  greenPill: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#dcfce7",
    color: "#166534",
    fontWeight: "950",
    fontSize: "12px",
  },
  exportPanel: {
    padding: "22px",
    borderRadius: "24px",
    background: "linear-gradient(180deg, #ffffff, #fffbeb)",
    border: "1px solid #fed7aa",
    boxShadow: "0 18px 44px rgba(146, 64, 14, 0.09)",
  },
  monthPack: {
    padding: "14px",
    borderRadius: "16px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    margin: "14px 0",
  },
  exportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "10px",
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },
  metricCard: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "16px",
    borderRadius: "20px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 30px rgba(15,23,42,0.07)",
  },
  metricIcon: {
    width: "42px",
    height: "42px",
    borderRadius: "14px",
    display: "grid",
    placeItems: "center",
    background: "#f8fafc",
    fontSize: "22px",
  },
  noticeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },
  warningNotice: {
    padding: "14px",
    borderRadius: "16px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    lineHeight: 1.6,
  },
  twoColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
    marginBottom: "18px",
  },
  threeColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
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
    marginTop: "14px",
  },
  accountingRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },
  flagList: {
    display: "grid",
    gap: "12px",
    marginTop: "14px",
  },
  flagItem: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },
  tableStatusGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },
  tableStatusItem: {
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    display: "grid",
    gap: "4px",
  },
  recentList: {
    display: "grid",
    gap: "10px",
    marginTop: "14px",
  },
  recentRecord: {
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    display: "grid",
    gap: "4px",
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
    alignItems: "center",
    marginBottom: "16px",
  },
  signOffBadge: {
    minWidth: "180px",
    padding: "14px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #fef3c7, #ffffff)",
    border: "1px solid #f59e0b",
    display: "grid",
    gap: "4px",
    textAlign: "center",
    color: "#07182c",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
    marginBottom: "16px",
  },
  checklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "12px",
    marginBottom: "16px",
  },
  checkItem: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
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
  emptyState: {
    padding: "18px",
    borderRadius: "16px",
    background: "#f8fafc",
    color: "#64748b",
    border: "1px dashed #cbd5e1",
    textAlign: "center",
    fontWeight: "800",
  },
};
