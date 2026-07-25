import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

function MobilePageFix() {
  return (
    <style>{`
      @media (max-width: 820px) {
        .boss-mobile-fix {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: hidden !important;
          padding: 10px !important;
          margin: 0 !important;
        }

        .boss-mobile-fix,
        .boss-mobile-fix * {
          box-sizing: border-box !important;
        }

        .boss-mobile-fix * {
          max-width: 100% !important;
        }

        .boss-mobile-fix section,
        .boss-mobile-fix article,
        .boss-mobile-fix form,
        .boss-mobile-fix header,
        .boss-mobile-fix main,
        .boss-mobile-fix aside {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="display: grid"],
        .boss-mobile-fix [style*="grid-template-columns"] {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        .boss-mobile-fix [style*="display: flex"] {
          flex-wrap: wrap !important;
        }

        .boss-mobile-fix [style*="justify-content: space-between"] {
          justify-content: flex-start !important;
        }

        .boss-mobile-fix [style*="align-items: center"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width:"],
        .boss-mobile-fix [style*="min-width"],
        .boss-mobile-fix [style*="max-width"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width: 420"],
        .boss-mobile-fix [style*="width: 360"],
        .boss-mobile-fix [style*="width: 340"],
        .boss-mobile-fix [style*="width: 320"],
        .boss-mobile-fix [style*="width: 300"],
        .boss-mobile-fix [style*="width: 280"],
        .boss-mobile-fix [style*="width: 260"],
        .boss-mobile-fix [style*="width: 240"],
        .boss-mobile-fix [style*="min-width: 420"],
        .boss-mobile-fix [style*="min-width: 360"],
        .boss-mobile-fix [style*="min-width: 340"],
        .boss-mobile-fix [style*="min-width: 320"],
        .boss-mobile-fix [style*="min-width: 300"],
        .boss-mobile-fix [style*="min-width: 280"],
        .boss-mobile-fix [style*="min-width: 260"],
        .boss-mobile-fix [style*="min-width: 240"] {
          width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="padding: 34"],
        .boss-mobile-fix [style*="padding: 32"],
        .boss-mobile-fix [style*="padding: 30"],
        .boss-mobile-fix [style*="padding: 28"],
        .boss-mobile-fix [style*="padding: 26"],
        .boss-mobile-fix [style*="padding: 24"],
        .boss-mobile-fix [style*="padding: 22"],
        .boss-mobile-fix [style*="padding: 20"] {
          padding: 16px !important;
        }

        .boss-mobile-fix [style*="border-radius: 40"],
        .boss-mobile-fix [style*="border-radius: 36"],
        .boss-mobile-fix [style*="border-radius: 34"],
        .boss-mobile-fix [style*="border-radius: 32"],
        .boss-mobile-fix [style*="border-radius: 30"],
        .boss-mobile-fix [style*="border-radius: 28"] {
          border-radius: 22px !important;
        }

        .boss-mobile-fix h1,
        .boss-mobile-fix [style*="font-size: 56"],
        .boss-mobile-fix [style*="font-size: 54"],
        .boss-mobile-fix [style*="font-size: 52"],
        .boss-mobile-fix [style*="font-size: 50"],
        .boss-mobile-fix [style*="font-size: 48"],
        .boss-mobile-fix [style*="font-size: 46"],
        .boss-mobile-fix [style*="font-size: 44"],
        .boss-mobile-fix [style*="font-size: 42"],
        .boss-mobile-fix [style*="font-size: 40"] {
          font-size: 31px !important;
          line-height: 1.06 !important;
          letter-spacing: -0.04em !important;
        }

        .boss-mobile-fix h2,
        .boss-mobile-fix [style*="font-size: 32"],
        .boss-mobile-fix [style*="font-size: 30"],
        .boss-mobile-fix [style*="font-size: 28"] {
          font-size: 21px !important;
          line-height: 1.15 !important;
        }

        .boss-mobile-fix h3,
        .boss-mobile-fix [style*="font-size: 24"],
        .boss-mobile-fix [style*="font-size: 22"] {
          font-size: 18px !important;
          line-height: 1.2 !important;
        }

        .boss-mobile-fix p,
        .boss-mobile-fix span,
        .boss-mobile-fix small,
        .boss-mobile-fix strong,
        .boss-mobile-fix label,
        .boss-mobile-fix td,
        .boss-mobile-fix th {
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }

        .boss-mobile-fix input,
        .boss-mobile-fix select,
        .boss-mobile-fix textarea {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          font-size: 16px !important;
        }

        .boss-mobile-fix button {
          max-width: 100% !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }

        .boss-mobile-fix table {
          width: 100% !important;
          min-width: 760px !important;
        }

        .boss-mobile-fix [style*="overflow-x: auto"],
        .boss-mobile-fix [style*="overflow: auto"],
        .boss-mobile-fix [style*="overflowX"] {
          width: 100% !important;
          max-width: 100% !important;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }

        .boss-mobile-fix [style*="position: absolute"] {
          pointer-events: none !important;
        }
      }

      @media (max-width: 480px) {
        .boss-mobile-fix {
          padding: 8px !important;
        }

        .boss-mobile-fix [style*="gap: 24"],
        .boss-mobile-fix [style*="gap: 22"],
        .boss-mobile-fix [style*="gap: 20"],
        .boss-mobile-fix [style*="gap: 18"] {
          gap: 12px !important;
        }

        .boss-mobile-fix [style*="padding: 18"],
        .boss-mobile-fix [style*="padding: 16"] {
          padding: 13px !important;
        }

        .boss-mobile-fix h1 {
          font-size: 29px !important;
        }

        .boss-mobile-fix table {
          min-width: 720px !important;
        }
      }
    `}</style>
  );
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function readNestedValue(source, path) {
  if (!source || !path) return undefined;

  return String(path)
    .split(".")
    .reduce((current, key) => {
      if (current === undefined || current === null) return undefined;
      return current[key];
    }, source);
}

function readFirstValue(source, paths, fallback = 0) {
  for (const path of paths) {
    const value = readNestedValue(source, path);

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return fallback;
}

function readFirstNumber(source, paths, fallback = 0) {
  const value = readFirstValue(source, paths, fallback);
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}

function getReviewWarnings(reviewSummary) {
  const warnings =
    reviewSummary?.warnings ||
    reviewSummary?.audit_warnings ||
    reviewSummary?.review_warnings ||
    reviewSummary?.summary?.warnings ||
    [];

  return Array.isArray(warnings) ? warnings : [];
}

function buildReviewMetrics(reviewSummary) {
  const source = reviewSummary?.summary || reviewSummary || {};

  const totalSms = readFirstNumber(source, [
    "sms.total_sms",
    "sms.total_messages",
    "sms.total_logs",
    "sms_log.total_sms",
    "sms_log.total_messages",
  ]);

  const failedSms = readFirstNumber(source, [
    "sms.failed_sms",
    "sms.failed_messages",
    "sms.failed_count",
    "sms_log.failed_sms",
    "sms_log.failed_messages",
  ]);

  return [
    {
      title: "Sales",
      value: readFirstNumber(source, [
        "sales.total_sales",
        "sales.sales_count",
        "sales.count",
        "total_sales",
      ]),
      detail: "Sale records checked",
      icon: "🧾",
    },
    {
      title: "Debts",
      value: readFirstNumber(source, [
        "debts.total_debts",
        "debts.debt_count",
        "debts.count",
        "debt_count",
      ]),
      detail: "Debt records checked",
      icon: "💳",
    },
    {
      title: "Expenses",
      value: readFirstNumber(source, [
        "expenses.total_expenses",
        "expenses.expense_count",
        "expenses.count",
        "expense_count",
      ]),
      detail: "Expense records checked",
      icon: "📉",
    },
    {
      title: "Purchases",
      value: readFirstNumber(source, [
        "purchases.total_purchases",
        "purchases.purchase_count",
        "purchases.count",
        "purchase_count",
      ]),
      detail: "Supplier purchase records",
      icon: "📦",
    },
    {
      title: "Returns",
      value: readFirstNumber(source, [
        "returns.total_returns",
        "returns.return_count",
        "returns.count",
        "return_count",
      ]),
      detail: "Returned item records",
      icon: "↩️",
    },
    {
      title: "Stock Adjustments",
      value: readFirstNumber(source, [
        "stock_adjustments.total_adjustments",
        "stock_adjustments.adjustment_count",
        "stock_adjustments.count",
        "adjustment_count",
      ]),
      detail: "Manual stock corrections",
      icon: "🛠️",
    },
    {
      title: "Stock Transfers",
      value: readFirstNumber(source, [
        "stock_transfers.total_transfers",
        "stock_transfers.transfer_count",
        "stock_transfers.count",
        "transfer_count",
      ]),
      detail: "Store-to-store movements",
      icon: "🚚",
    },
    {
      title: "SMS Logs",
      value: `${formatNumber(failedSms)} / ${formatNumber(totalSms)}`,
      detail: "Failed / total messages",
      icon: "📩",
    },
    {
      title: "Daily Closings",
      value: readFirstNumber(source, [
        "daily_closings.total_closings",
        "daily_closings.closing_count",
        "daily_closings.count",
        "closing_count",
      ]),
      detail: "End-of-day records",
      icon: "🔒",
    },
    {
      title: "Backup / Restore",
      value: readFirstNumber(source, [
        "security.backup_restore_count",
        "activity.backup_restore_count",
        "backup_restore_count",
      ]),
      detail: "Security activity checks",
      icon: "🛡️",
    },
    {
      title: "Maintenance Clears",
      value: readFirstNumber(source, [
        "security.clear_data_count",
        "activity.clear_data_count",
        "clear_data_count",
      ]),
      detail: "Clear-data activity checks",
      icon: "🧹",
    },
    {
      title: "Unlock / Reapproval",
      value: readFirstNumber(source, [
        "audit_unlocks.total_unlock_requests",
        "unlock_requests.total_unlock_requests",
        "reapproval.total_reapprovals",
        "unlock_request_count",
      ]),
      detail: "Locked period corrections",
      icon: "🔓",
    },
  ];
}

function getStatusLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "reviewed") return "Reviewed";
  if (status === "rejected") return "Rejected";
  return "Draft";
}

function getStatusStyle(status) {
  if (status === "approved") return styles.statusApproved;
  if (status === "reviewed") return styles.statusReviewed;
  if (status === "rejected") return styles.statusRejected;
  return styles.statusDraft;
}

function getScoreStyle(score) {
  const number = Number(score || 0);

  if (number >= 85) return styles.scoreStrong;
  if (number >= 70) return styles.scoreGood;
  if (number >= 50) return styles.scoreWatch;

  return styles.scoreRisk;
}

function makeCsv(rows) {
  if (!rows || rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

  return `\uFEFF${[
    headers.map(escapeCsv).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsv(row[header])).join(",")
    ),
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

function makeSafeFileName(value) {
  return String(value || "store")
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

export default function AuditSignoffHistoryPage() {
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

  const [signoffs, setSignoffs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [periodType, setPeriodType] = useState("");
  const [periodStatus, setPeriodStatus] = useState("");
  const [reviewSummary, setReviewSummary] = useState(null);
  const [reviewSummaryLoading, setReviewSummaryLoading] = useState(false);

  function getSignoffStoreCode(signoff) {
    return signoff?.branch_code || signoff?.store_code || currentStoreCode;
  }

  function getSignoffStoreName(signoff) {
    return signoff?.branch_name || signoff?.store_name || currentStoreName;
  }

  function getSignoffStoreLocation(signoff) {
    return (
      signoff?.branch_location ||
      signoff?.store_location ||
      currentStoreLocation
    );
  }

  const filteredSignoffs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return signoffs.filter((item) => {
      const matchesSearch =
        !query ||
        [
          item.period_label,
          item.prepared_by_name,
          item.reviewed_by_name,
          item.approved_by_name,
          item.created_by_name,
          item.branch_code,
          item.branch_name,
          item.store_code,
          item.store_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);

      const matchesPeriod = !periodType || item.period_type === periodType;
      const matchesStatus = !periodStatus || item.period_status === periodStatus;

      return matchesSearch && matchesPeriod && matchesStatus;
    });
  }, [signoffs, search, periodType, periodStatus]);

  const summary = useMemo(() => {
    const total = filteredSignoffs.length;

    const approved = filteredSignoffs.filter(
      (item) => item.period_status === "approved"
    ).length;

    const reviewed = filteredSignoffs.filter(
      (item) => item.period_status === "reviewed"
    ).length;

    const draft = filteredSignoffs.filter(
      (item) => item.period_status === "draft"
    ).length;

    const rejected = filteredSignoffs.filter(
      (item) => item.period_status === "rejected"
    ).length;

    const averageScore =
      total > 0
        ? Math.round(
            filteredSignoffs.reduce(
              (sum, item) => sum + Number(item.audit_score || 0),
              0
            ) / total
          )
        : 0;

    return { total, approved, reviewed, draft, rejected, averageScore };
  }, [filteredSignoffs]);

  const reviewMetrics = useMemo(
    () => buildReviewMetrics(reviewSummary),
    [reviewSummary]
  );

  const reviewWarnings = useMemo(
    () => getReviewWarnings(reviewSummary),
    [reviewSummary]
  );

  useEffect(() => {
    loadPageData();
    // Reload audit sign-off history and audit review summary when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function loadPageData() {
    await Promise.all([loadSignoffs(), loadReviewSummary()]);
  }

  async function loadReviewSummary() {
    setReviewSummaryLoading(true);

    try {
      const response = await axiosClient.get("/audit-signoffs/review-summary");
      setReviewSummary(response.data || null);
    } catch (requestError) {
      setReviewSummary(null);
      setError(
        requestError.response?.data?.message ||
          "Audit review summary could not be loaded. Make sure the updated audit sign-off backend route is deployed."
      );
    } finally {
      setReviewSummaryLoading(false);
    }
  }

  async function loadSignoffs() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.get("/audit-signoffs");

      setSignoffs(response.data.signoffs || []);
      setMessage("Audit sign-off history loaded.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Something went wrong while fetching audit sign-offs."
      );
    } finally {
      setLoading(false);
    }
  }

  function exportHistoryCsv() {
    if (filteredSignoffs.length === 0) {
      setError("No sign-off history available to export.");
      return;
    }

    const rows = filteredSignoffs.map((item) => ({
      id: item.id,
      store_code: getSignoffStoreCode(item),
      store_name: getSignoffStoreName(item),
      period_type: item.period_type,
      period_label: item.period_label,
      period_start: formatDate(item.period_start),
      period_end: formatDate(item.period_end),
      audit_score: item.audit_score,
      audit_status: item.audit_status,
      period_status: item.period_status,
      prepared_by_name: item.prepared_by_name || "",
      reviewed_by_name: item.reviewed_by_name || "",
      approved_by_name: item.approved_by_name || "",
      review_date: formatDate(item.review_date),
      created_by_name: item.created_by_name || "",
      approved_by_user_name: item.approved_by_user_name || "",
      sales_checked: item.sales_checked ? "Yes" : "No",
      expenses_checked: item.expenses_checked ? "Yes" : "No",
      debts_checked: item.debts_checked ? "Yes" : "No",
      stock_checked: item.stock_checked ? "Yes" : "No",
      warnings_checked: item.warnings_checked ? "Yes" : "No",
      reports_checked: item.reports_checked ? "Yes" : "No",
      updated_at: formatDateTime(item.updated_at),
    }));

    downloadTextFile(
      `chalin03-${makeSafeFileName(currentStoreCode)}-audit-signoff-history.csv`,
      makeCsv(rows),
      "text/csv;charset=utf-8"
    );

    setMessage("Audit sign-off history CSV downloaded successfully.");
  }

  function buildCertificateHtml(signoff) {
    const certificateStoreCode = getSignoffStoreCode(signoff);
    const certificateStoreName = getSignoffStoreName(signoff);
    const certificateStoreLocation = getSignoffStoreLocation(signoff);

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Audit Sign-Off Certificate</title>
          <style>
            @page { size: A4; margin: 16mm; }

            body {
              font-family: Arial, sans-serif;
              color: #111827;
              line-height: 1.5;
              font-size: 12px;
              background: #ffffff;
            }

            .certificate {
              border: 4px solid #07182c;
              padding: 24px;
              min-height: 92vh;
              position: relative;
            }

            .certificate:before {
              content: "APPROVAL ARCHIVE";
              position: absolute;
              top: 44%;
              left: 50%;
              transform: translate(-50%, -50%) rotate(-25deg);
              color: rgba(224, 186, 40, 0.12);
              font-size: 52px;
              font-weight: 900;
              letter-spacing: 0.08em;
              z-index: 0;
              white-space: nowrap;
            }

            .content {
              position: relative;
              z-index: 1;
            }

            h1 {
              color: #07182c;
              text-align: center;
              margin: 0;
              font-size: 26px;
              text-transform: uppercase;
            }

            .subtitle {
              text-align: center;
              color: #64748b;
              margin-top: 8px;
            }

            .store {
              text-align: center;
              color: #07182c;
              margin-top: 8px;
              font-weight: 800;
            }

            .badge {
              margin: 22px auto;
              width: 150px;
              height: 150px;
              border-radius: 50%;
              border: 8px solid #e0ba28;
              display: grid;
              place-items: center;
              text-align: center;
              color: #07182c;
              background: #ffffff;
            }

            .badge strong {
              display: block;
              font-size: 30px;
            }

            .grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 10px;
              margin-top: 18px;
            }

            .box {
              border: 1px solid #dbe3ef;
              background: #f8fafc;
              border-radius: 10px;
              padding: 10px;
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
              margin-top: 20px;
            }

            th,
            td {
              border: 1px solid #dbe3ef;
              padding: 8px;
              text-align: left;
              vertical-align: top;
            }

            th {
              background: #07182c;
              color: #ffffff;
            }

            .signature-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 18px;
              margin-top: 60px;
            }

            .signature {
              border-top: 1px solid #111827;
              padding-top: 7px;
              text-align: center;
            }
          </style>
        </head>

        <body>
          <div class="certificate">
            <div class="content">
              <h1>Chalin 03 Company Limited</h1>

              <p class="subtitle">Audit Sign-Off & Accounting Approval Certificate</p>

              <p class="store">${escapeHtml(certificateStoreCode)} - ${escapeHtml(certificateStoreName)}${
      certificateStoreLocation ? ` | ${escapeHtml(certificateStoreLocation)}` : ""
    }</p>

              <div class="badge">
                <div>
                  <strong>${Number(signoff.audit_score || 0)}%</strong>
                  <span>${escapeHtml(signoff.audit_status || "-")}</span>
                </div>
              </div>

              <div class="grid">
                <div class="box"><span>Store</span><strong>${escapeHtml(certificateStoreCode)} - ${escapeHtml(certificateStoreName)}</strong></div>
                <div class="box"><span>Period</span><strong>${escapeHtml(signoff.period_label || "-")}</strong></div>
                <div class="box"><span>Status</span><strong>${escapeHtml(getStatusLabel(signoff.period_status))}</strong></div>
                <div class="box"><span>Review Date</span><strong>${escapeHtml(formatDate(signoff.review_date))}</strong></div>
                <div class="box"><span>Saved By</span><strong>${escapeHtml(signoff.created_by_name || "-")}</strong></div>
                <div class="box"><span>Last Updated</span><strong>${escapeHtml(formatDateTime(signoff.updated_at))}</strong></div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Prepared By</th>
                    <th>Reviewed By</th>
                    <th>Approved By</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td>${escapeHtml(signoff.prepared_by_name || "-")}</td>
                    <td>${escapeHtml(signoff.reviewed_by_name || "-")}</td>
                    <td>${escapeHtml(signoff.approved_by_name || "-")}</td>
                  </tr>
                </tbody>
              </table>

              <table>
                <thead>
                  <tr>
                    <th>Sales</th>
                    <th>Expenses</th>
                    <th>Debts</th>
                    <th>Stock / Transfers</th>
                    <th>SMS / Warnings</th>
                    <th>Reports</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td>${signoff.sales_checked ? "Checked" : "Pending"}</td>
                    <td>${signoff.expenses_checked ? "Checked" : "Pending"}</td>
                    <td>${signoff.debts_checked ? "Checked" : "Pending"}</td>
                    <td>${signoff.stock_checked ? "Checked" : "Pending"}</td>
                    <td>${signoff.warnings_checked ? "Checked" : "Pending"}</td>
                    <td>${signoff.reports_checked ? "Checked" : "Pending"}</td>
                  </tr>
                </tbody>
              </table>

              <table>
                <thead>
                  <tr>
                    <th>Audit Coverage Note</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td>This sign-off belongs to the selected store period. The current audit review process should include sales, debts, expenses, purchases, returns, stock adjustments, stock transfers, stock transfer items, SMS logs, failed SMS warnings, backup/restore activity, maintenance clear-data activity, audit unlock requests, re-approval logs and Stock Movement Ledger source records.</td>
                  </tr>
                </tbody>
              </table>

              <div class="signature-grid">
                <div class="signature">Prepared By</div>
                <div class="signature">Reviewed By</div>
                <div class="signature">Approved By</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  function printCertificate(signoff) {
    const printWindow = window.open("", "_blank", "width=1000,height=800");

    if (!printWindow) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildCertificateHtml(signoff));
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 350);
  }

  function downloadCertificateWord(signoff) {
    const wordDocument = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:w="urn:schemas-microsoft-com:office:word"
            xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="UTF-8" />
          <meta name="ProgId" content="Word.Document" />
        </head>

        <body>${buildCertificateHtml(signoff)}</body>
      </html>
    `;

    downloadTextFile(
      `chalin03-${makeSafeFileName(getSignoffStoreCode(signoff))}-signoff-certificate-${signoff.id}.doc`,
      wordDocument,
      "application/msword;charset=utf-8"
    );

    setMessage("Sign-off certificate Word document downloaded.");
  }

  return (
    <div className="boss-mobile-fix" style={styles.page}>
      <MobilePageFix />
      <section style={styles.hero}>
        <div style={styles.archiveStamp}>ARCHIVE</div>

        <div style={styles.heroContent}>
          <div>
            <p style={styles.eyebrow}>Digital Audit Archive • {currentStoreCode}</p>

            <h1 style={styles.title}>Audit Sign-Off History</h1>

            <p style={styles.subtitle}>
              View saved accounting approvals, approved periods, audit scores,
              certificates and sign-off records for{" "}
              <strong>
                {currentStoreCode} — {currentStoreName}
              </strong>
              . This page works like a compliance archive for management.
            </p>
          </div>

          <div style={styles.heroActions}>
            <button
              type="button"
              onClick={loadPageData}
              disabled={loading || reviewSummaryLoading}
              style={styles.heroButton}
            >
              {loading || reviewSummaryLoading ? "Loading..." : "Refresh Archive"}
            </button>

            <button
              type="button"
              onClick={exportHistoryCsv}
              style={styles.heroGhostButton}
            >
              Export History CSV
            </button>
          </div>
        </div>
      </section>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏛️</span>
        <div>
          <strong>
            Current selected store: {currentStoreCode} — {currentStoreName}
          </strong>

          {currentStoreLocation ? <p>{currentStoreLocation}</p> : null}

          <p>
            Audit sign-off history, approval certificates and CSV exports are
             filtered to this selected store. Sign-off records are permanent
             compliance evidence and cannot be deleted.
          </p>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <section style={styles.archiveDashboard}>
        <ArchiveMetric
          title={`${currentStoreCode} Records`}
          value={summary.total}
          note="Filtered sign-off records"
          icon="🗃️"
        />

        <ArchiveMetric
          title="Approved"
          value={summary.approved}
          note="Locked/approved periods"
          icon="✅"
        />

        <ArchiveMetric
          title="Reviewed"
          value={summary.reviewed}
          note="Accountant reviewed periods"
          icon="👁️"
        />

        <ArchiveMetric
          title="Draft"
          value={summary.draft}
          note="Pending completion"
          icon="✍️"
        />

        <ArchiveMetric
          title="Rejected"
          value={summary.rejected}
          note="Needs correction"
          icon="🚫"
        />

        <ArchiveMetric
          title="Average Score"
          value={`${summary.averageScore}%`}
          note="Average audit score"
          icon="📊"
        />
      </section>

      <section style={styles.coverageVault}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrowDark}>Live Review Coverage</p>

            <h2 style={styles.panelTitle}>Current Audit Coverage Vault</h2>

            <p style={styles.mutedText}>
              This live review summary helps management check the newest system
              areas before approving or trusting a period: SMS, stock transfers,
              stock adjustments, backup/restore, maintenance activity and Stock
              Movement Ledger source records.
            </p>
          </div>

          <button
            type="button"
            style={styles.secondaryInlineButton}
            onClick={loadReviewSummary}
            disabled={reviewSummaryLoading}
          >
            {reviewSummaryLoading ? "Loading..." : "Refresh Review"}
          </button>
        </div>

        <div style={styles.auditCoverageGrid}>
          {reviewMetrics.map((metric) => (
            <div key={metric.title} style={styles.auditCoverageCard}>
              <span style={styles.metricIcon}>{metric.icon}</span>

              <div>
                <p>{metric.title}</p>
                <strong>
                  {typeof metric.value === "number"
                    ? formatNumber(metric.value)
                    : metric.value}
                </strong>
                <small>{metric.detail}</small>
              </div>
            </div>
          ))}
        </div>

        <div style={styles.warningNote}>
          <strong>Stock Movement Ledger note:</strong> the ledger has no separate
          table. It is rebuilt from sales, purchases, returns, stock adjustments,
          stock transfers and stock transfer items, so those source records must
          be reviewed and protected during audit, backup, restore and
          maintenance.
        </div>

        {reviewWarnings.length > 0 && (
          <div className="warning-box">
            <strong>Audit warnings found:</strong>

            <ul style={{ marginBottom: 0 }}>
              {reviewWarnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{String(warning)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section style={styles.filterPanel}>
        <div>
          <p style={styles.eyebrowDark}>Archive Search</p>
          <h2 style={styles.panelTitle}>Find Approval Records</h2>
          <p style={styles.mutedText}>
            Search by period, staff name, reviewer, approver or store.
          </p>
        </div>

        <div style={styles.filterGrid}>
          <label>
            Search
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search period, names or store"
            />
          </label>

          <label>
            Period Type
            <select
              value={periodType}
              onChange={(event) => setPeriodType(event.target.value)}
            >
              <option value="">All Periods</option>
              <option value="all">All Records</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <label>
            Status
            <select
              value={periodStatus}
              onChange={(event) => setPeriodStatus(event.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="reviewed">Reviewed</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          <div style={styles.filterButtons}>
            <button
              type="button"
              style={styles.secondaryInlineButton}
              onClick={() => {
                setSearch("");
                setPeriodType("");
                setPeriodStatus("");
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </section>

      <section style={styles.recordsPanel}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrowDark}>Compliance Archive</p>

            <h2 style={styles.panelTitle}>
              Saved Sign-Off Records - {currentStoreCode}
            </h2>

            <p style={styles.mutedText}>
              Each record below can be printed or downloaded and remains permanent
               compliance evidence. Corrections must use the controlled review, unlock
               and re-approval process.
            </p>
          </div>

          <span style={styles.resultBadge}>
            {filteredSignoffs.length} record(s)
          </span>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Loading sign-off history...</div>
        ) : filteredSignoffs.length === 0 ? (
          <div style={styles.emptyState}>
            No audit sign-offs found for {currentStoreCode}.
          </div>
        ) : (
          <div style={styles.recordTimeline}>
            {filteredSignoffs.map((item) => (
              <article key={item.id} style={styles.recordCard}>
                <div style={styles.timelinePin} />

                <div style={styles.recordMain}>
                  <div style={styles.recordHeader}>
                    <div>
                      <div style={styles.recordTitleRow}>
                        <strong>#{item.id} • {item.period_label}</strong>

                        <span
                          style={{
                            ...styles.badge,
                            ...getStatusStyle(item.period_status),
                          }}
                        >
                          {getStatusLabel(item.period_status)}
                        </span>
                      </div>

                      <p>
                        {getSignoffStoreCode(item)} — {getSignoffStoreName(item)}
                      </p>

                      <small>
                        Period type: {item.period_type || "-"} • Review date:{" "}
                        {formatDate(item.review_date)}
                      </small>
                    </div>

                    <div style={styles.scoreSeal}>
                      <span
                        style={{
                          ...styles.badge,
                          ...getScoreStyle(item.audit_score),
                        }}
                      >
                        {Number(item.audit_score || 0)}%
                      </span>

                      <small>{item.audit_status || "Audit Score"}</small>
                    </div>
                  </div>

                  <div style={styles.approvalGrid}>
                    <ApprovalBox
                      label="Prepared"
                      value={item.prepared_by_name || "-"}
                    />

                    <ApprovalBox
                      label="Reviewed"
                      value={item.reviewed_by_name || "-"}
                    />

                    <ApprovalBox
                      label="Approved"
                      value={item.approved_by_name || "-"}
                    />

                    <ApprovalBox
                      label="Saved By"
                      value={item.created_by_name || "-"}
                    />

                    <ApprovalBox
                      label="Updated"
                      value={formatDateTime(item.updated_at)}
                    />
                  </div>

                  <div style={styles.checkGrid}>
                    <CheckPill label="Sales" checked={item.sales_checked} />
                    <CheckPill label="Expenses" checked={item.expenses_checked} />
                    <CheckPill label="Debts" checked={item.debts_checked} />
                    <CheckPill label="Stock" checked={item.stock_checked} />
                    <CheckPill label="Warnings" checked={item.warnings_checked} />
                    <CheckPill label="Reports" checked={item.reports_checked} />
                  </div>

                  <div style={styles.actionButtons}>
                    <button
                      type="button"
                      style={styles.secondaryInlineButton}
                      onClick={() => printCertificate(item)}
                    >
                      Print Certificate
                    </button>

                    <button
                      type="button"
                      style={styles.secondaryInlineButton}
                      onClick={() => downloadCertificateWord(item)}
                    >
                      Word Certificate
                    </button>

                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        borderRadius: "999px",
                        padding: "10px 13px",
                        background: "#ecfdf5",
                        border: "1px solid #86efac",
                        color: "#166534",
                        fontWeight: "900",
                        fontSize: "12px",
                      }}
                    >
                      Permanent evidence
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ArchiveMetric({ title, value, note, icon }) {
  return (
    <div style={styles.summaryCard}>
      <span style={styles.summaryIcon}>{icon}</span>

      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function ApprovalBox({ label, value }) {
  return (
    <div style={styles.approvalBox}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CheckPill({ label, checked }) {
  return (
    <span
      style={{
        ...styles.checkPill,
        ...(checked ? styles.checkPillDone : styles.checkPillPending),
      }}
    >
      {checked ? "✓" : "•"} {label}
    </span>
  );
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "44px",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    marginBottom: "18px",
    padding: "28px",
    borderRadius: "30px",
    background:
      "linear-gradient(135deg, #0f172a 0%, #334155 46%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 26px 70px rgba(15, 23, 42, 0.25)",
  },

  archiveStamp: {
    position: "absolute",
    right: "-18px",
    top: "18px",
    transform: "rotate(16deg)",
    border: "3px solid rgba(224, 186, 40, 0.32)",
    color: "rgba(224, 186, 40, 0.22)",
    borderRadius: "18px",
    padding: "12px 20px",
    fontSize: "34px",
    fontWeight: "950",
    letterSpacing: "0.10em",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    flexWrap: "wrap",
    alignItems: "flex-start",
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
    color: "#64748b",
    fontSize: "11px",
    fontWeight: "950",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },

  title: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 52px)",
    fontWeight: "950",
    lineHeight: 1.04,
  },

  subtitle: {
    margin: "10px 0 0",
    color: "rgba(255,255,255,0.76)",
    maxWidth: "860px",
    lineHeight: 1.65,
  },

  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },

  heroButton: {
    border: "none",
    borderRadius: "15px",
    padding: "11px 14px",
    background: "#e0ba28",
    color: "#07182c",
    fontWeight: "950",
    cursor: "pointer",
  },

  heroGhostButton: {
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "15px",
    padding: "11px 14px",
    background: "rgba(255,255,255,0.10)",
    color: "#ffffff",
    fontWeight: "950",
    cursor: "pointer",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #f8fafc, #ffffff)",
    border: "1px solid #cbd5e1",
    color: "#334155",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  archiveDashboard: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  summaryCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    padding: "16px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15,23,42,0.07)",
    minWidth: 0,
  },

  summaryIcon: {
    width: "44px",
    height: "44px",
    borderRadius: "15px",
    display: "grid",
    placeItems: "center",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    fontSize: "21px",
    flexShrink: 0,
  },

  coverageVault: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
    minWidth: 0,
    marginBottom: "18px",
  },

  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "14px",
    flexWrap: "wrap",
    marginBottom: "14px",
  },

  panelTitle: {
    margin: "5px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  mutedText: {
    margin: "6px 0 0",
    color: "#64748b",
    fontWeight: "700",
    lineHeight: 1.6,
  },

  secondaryInlineButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "13px",
    padding: "9px 11px",
    background: "#ffffff",
    color: "#334155",
    fontWeight: "950",
    cursor: "pointer",
  },

  auditCoverageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "12px",
    marginBottom: "14px",
  },

  auditCoverageCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    padding: "14px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #f8fafc, #ffffff)",
    border: "1px solid #e2e8f0",
  },

  metricIcon: {
    width: "40px",
    height: "40px",
    borderRadius: "14px",
    display: "grid",
    placeItems: "center",
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    flexShrink: 0,
  },

  warningNote: {
    padding: "13px",
    borderRadius: "16px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    fontWeight: "800",
    lineHeight: 1.6,
    marginBottom: "12px",
  },

  filterPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 0.5fr) minmax(0, 1fr)",
    gap: "16px",
    padding: "20px",
    borderRadius: "26px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
    marginBottom: "18px",
  },

  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "12px",
    alignItems: "end",
  },

  filterButtons: {
    display: "flex",
    alignItems: "end",
  },

  recordsPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
    minWidth: 0,
    marginBottom: "18px",
  },

  resultBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "7px 11px",
    background: "#f8fafc",
    color: "#475569",
    border: "1px solid #e2e8f0",
    fontWeight: "950",
    fontSize: "12px",
  },

  recordTimeline: {
    display: "grid",
    gap: "14px",
    position: "relative",
  },

  recordCard: {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr)",
    gap: "12px",
    borderRadius: "22px",
    border: "1px solid #e2e8f0",
    background: "linear-gradient(180deg, #ffffff, #f8fafc)",
    padding: "15px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  timelinePin: {
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    marginTop: "7px",
    background: "#e0ba28",
    boxShadow: "0 0 0 6px rgba(224,186,40,0.18)",
  },

  recordMain: {
    minWidth: 0,
  },

  recordHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  recordTitleRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },

  scoreSeal: {
    display: "grid",
    justifyItems: "end",
    gap: "5px",
  },

  approvalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },

  approvalBox: {
    padding: "10px",
    borderRadius: "15px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },

  checkGrid: {
    display: "flex",
    gap: "7px",
    flexWrap: "wrap",
    marginTop: "12px",
  },

  checkPill: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "11px",
    fontWeight: "950",
  },

  checkPillDone: {
    background: "#dcfce7",
    color: "#166534",
  },

  checkPillPending: {
    background: "#f1f5f9",
    color: "#64748b",
  },

  badge: {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: "999px",
    fontWeight: "950",
    fontSize: "12px",
  },

  statusApproved: {
    background: "#dcfce7",
    color: "#166534",
  },

  statusReviewed: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },

  statusRejected: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  statusDraft: {
    background: "#f8fafc",
    color: "#475569",
  },

  scoreStrong: {
    background: "#dcfce7",
    color: "#166534",
  },

  scoreGood: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },

  scoreWatch: {
    background: "#ffedd5",
    color: "#9a3412",
  },

  scoreRisk: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  actionButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "14px",
  },

  deleteButton: {
    background: "#dc2626",
    color: "#ffffff",
    border: "none",
    borderRadius: "13px",
    padding: "9px 11px",
    fontWeight: "950",
    cursor: "pointer",
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
