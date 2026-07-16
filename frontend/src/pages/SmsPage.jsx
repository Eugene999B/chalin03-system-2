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


const SMS_TEMPLATES = [
  {
    title: "Goods Ready",
    message:
      "CHALIN03: Dear customer, your goods are ready for collection at Chalin 03. Thank you.",
  },
  {
    title: "Payment Reminder",
    message:
      "CHALIN03: Dear customer, kindly settle your outstanding balance at Chalin 03. Thank you.",
  },
  {
    title: "New Stock",
    message:
      "CHALIN03: New spare parts are available at Chalin 03. Kindly visit us for quality parts. Thank you.",
  },
  {
    title: "Shop Notice",
    message:
      "CHALIN03: Dear customer, thank you for doing business with Chalin 03 Company Limited.",
  },
  {
    title: "Thank You",
    message:
      "CHALIN03: Thank you for buying from Chalin 03 Company Limited. We appreciate your business.",
  },
];

export default function SmsPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();

  const currentBranchCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentBranchName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentBranchLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const isAdministrator = String(user?.role || "").toLowerCase() === "admin";

  const [smsStatus, setSmsStatus] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [logs, setLogs] = useState([]);

  const [targetType, setTargetType] = useState("single");
  const [manualPhone, setManualPhone] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
  const [message, setMessage] = useState("");

  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState(
    "CHALIN03 test SMS. Your SMS setup is working."
  );

  const [liveBulkConfirmed, setLiveBulkConfirmed] = useState(false);
  const [liveBulkConfirmText, setLiveBulkConfirmText] = useState("");

  const [logStatusFilter, setLogStatusFilter] = useState("all");
  const [logTypeFilter, setLogTypeFilter] = useState("all");
  const [logView, setLogView] = useState("active");

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingDailySummary, setSendingDailySummary] = useState(false);
  const [retryingLogId, setRetryingLogId] = useState(null);
  const [archivingHistory, setArchivingHistory] = useState(false);
  const [restoringHistory, setRestoringHistory] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const filteredCustomers = useMemo(() => {
    const searchText = customerSearch.trim().toLowerCase();

    if (!searchText) {
      return customers;
    }

    return customers.filter((customer) => {
      const text = [customer.name, customer.phone, customer.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(searchText);
    });
  }, [customers, customerSearch]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const status = String(log.status || "").toLowerCase();
      const type = String(log.sms_type || "").toLowerCase();

      const statusMatches =
        logStatusFilter === "all" || status === logStatusFilter;

      const typeMatches = logTypeFilter === "all" || type === logTypeFilter;

      return statusMatches && typeMatches;
    });
  }, [logs, logStatusFilter, logTypeFilter]);

  const smsDashboard = useMemo(() => {
    const normalizedLogs = logs.map((log) => ({
      ...log,
      normalizedStatus: String(log.status || "delivery_unknown").toLowerCase(),
    }));

    const acceptedCount = normalizedLogs.filter((log) =>
      ["accepted", "delivered"].includes(log.normalizedStatus)
    ).length;
    const deliveredCount = normalizedLogs.filter(
      (log) => log.normalizedStatus === "delivered"
    ).length;
    const failedCount = normalizedLogs.filter((log) =>
      ["failed", "undelivered", "expired"].includes(log.normalizedStatus)
    ).length;
    const unknownCount = normalizedLogs.filter((log) =>
      ["pending", "delivery_unknown"].includes(log.normalizedStatus)
    ).length;
    const estimatedCredits = normalizedLogs.reduce(
      (sum, log) => sum + Number(log.estimated_credits || 0),
      0
    );

    return {
      acceptedCount,
      deliveredCount,
      failedCount,
      unknownCount,
      estimatedCredits,
    };
  }, [logs]);

  const selectedCount = selectedCustomerIds.length;

  const liveBulkConfirmationText = String(
    smsStatus?.live_bulk_confirmation_text || "SEND LIVE BULK SMS"
  ).toUpperCase();

  const isLiveBulkSms =
    targetType === "all" && Boolean(smsStatus?.live_sending);

  const liveBulkSendLocked =
    isLiveBulkSms &&
    (!liveBulkConfirmed ||
      liveBulkConfirmText.trim().toUpperCase() !== liveBulkConfirmationText);

  const statusStyle = useMemo(() => {
    const safetyLevel = smsStatus?.safety_level || "safe";

    if (safetyLevel === "live") {
      return styles.statusLive;
    }

    if (safetyLevel === "warning") {
      return styles.statusWarning;
    }

    if (safetyLevel === "danger") {
      return styles.statusDanger;
    }

    if (safetyLevel === "disabled") {
      return styles.statusDisabled;
    }

    return styles.statusSafe;
  }, [smsStatus]);

  function formatProviderResponse(value) {
    if (!value) return "";

    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function buildSmsFailureMessage(data, fallback) {
    const baseMessage = data?.message || fallback || "SMS failed.";

    const rawResults = Array.isArray(data?.results)
      ? data.results
      : data?.result
      ? [data.result]
      : [];

    const failedResults = rawResults.filter(
      (result) => String(result?.status || "").toLowerCase() === "failed"
    );

    if (failedResults.length === 0) {
      return baseMessage;
    }

    const details = failedResults.map((result, index) => {
      const statusCode = result.status_code || result.statusCode || "";
      const providerResponse =
        result.provider_response || result.providerResponse || null;
      const providerText = formatProviderResponse(providerResponse);

      return [
        `Failed SMS ${index + 1}: ${result.message || "SMS failed."}`,
        statusCode ? `HTTP Status: ${statusCode}` : "",
        result.provider ? `Provider: ${result.provider}` : "",
        providerText ? `Provider Response: ${providerText}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return [baseMessage, ...details].join("\n\n");
  }

  function getFriendlyError(error, fallback) {
    return buildSmsFailureMessage(
      error?.response?.data,
      error?.message || fallback
    );
  }

  function escapeCsvValue(value) {
    const cleanValue = String(value ?? "").replace(/\r?\n|\r/g, " ");
    return `"${cleanValue.replace(/"/g, '""')}"`;
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  }

  function formatSmsStatus(value) {
    const labels = {
      pending: "Pending submission",
      accepted: "Accepted by provider",
      delivered: "Delivered",
      undelivered: "Undelivered",
      expired: "Expired",
      failed: "Failed",
      delivery_unknown: "Delivery unknown",
      sent: "Accepted (legacy)",
    };

    const status = String(value || "delivery_unknown").toLowerCase();
    return labels[status] || status.replace(/_/g, " ");
  }

  function getSmsStatusStyle(value) {
    const status = String(value || "delivery_unknown").toLowerCase();

    if (status === "delivered") return styles.logStatusDelivered;
    if (status === "accepted") return styles.logStatusAccepted;
    if (["failed", "undelivered", "expired"].includes(status)) {
      return styles.logStatusFailed;
    }

    return styles.logStatusUnknown;
  }

  function downloadSmsCsv() {
    if (filteredLogs.length === 0) {
      setError("No SMS records available to export with the selected filters.");
      setNotice("");
      return;
    }

    const headers = [
      "Date",
      "Branch Code",
      "Branch Name",
      "Phone",
      "Type",
      "Status",
      "Provider",
      "Sender ID",
      "Provider Message ID",
      "Provider Status",
      "Segments",
      "Estimated Credits",
      "Submitted At",
      "Delivery Confirmed At",
      "Status Reason",
      "Source Reference",
      "Message",
      "Sent By",
    ];

    const rows = filteredLogs.map((log) => [
      formatDateTime(log.created_at),
      log.branch_code || currentBranchCode,
      log.branch_name || currentBranchName,
      log.recipient_phone || "",
      log.sms_type || "",
      formatSmsStatus(log.status),
      log.provider || "",
      log.sender_id || "",
      log.provider_message_id || "",
      log.provider_status || "",
      log.segment_count || 1,
      log.estimated_credits || 0,
      formatDateTime(log.submitted_at),
      formatDateTime(log.delivery_confirmed_at),
      log.status_reason || "",
      log.source_reference || "",
      log.message || "",
      log.sent_by_name || log.sent_by_username || "",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCsvValue).join(","))
      .join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `chalin03-sms-history-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    setNotice("SMS history CSV exported successfully.");
    setError("");
  }

  async function loadSmsPageData(options = {}) {
    const silent = Boolean(options.silent);

    if (!silent) {
      setLoading(true);
      setError("");
      setNotice("");
    }

    try {
      const [statusResponse, customersResponse, logsResponse] =
        await Promise.all([
          axiosClient.get("/sms/status"),
          axiosClient.get("/sms/customers"),
          axiosClient.get(`/sms/logs?limit=50&view=${logView}`),
        ]);

      setSmsStatus(statusResponse.data.sms || null);
      setCustomers(customersResponse.data.customers || []);
      setLogs(logsResponse.data.logs || []);
    } catch (error) {
      setError(getFriendlyError(error, "Failed to load SMS page."));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadSmsPageData();

    const automaticRefresh = window.setInterval(() => {
      loadSmsPageData({ silent: true });
    }, 30000);

    return () => window.clearInterval(automaticRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, logView]);

  function toggleCustomer(customerId) {
    const cleanId = Number(customerId);

    setSelectedCustomerIds((currentIds) => {
      if (currentIds.includes(cleanId)) {
        return currentIds.filter((id) => id !== cleanId);
      }

      return [...currentIds, cleanId];
    });
  }

  function selectAllFilteredCustomers() {
    const ids = filteredCustomers.map((customer) => Number(customer.id));
    setSelectedCustomerIds(ids);
  }

  function clearSelectedCustomers() {
    setSelectedCustomerIds([]);
  }

  function resetLiveBulkConfirmation() {
    setLiveBulkConfirmed(false);
    setLiveBulkConfirmText("");
  }

  function resetLogFilters() {
    setLogStatusFilter("all");
    setLogTypeFilter("all");
  }

  function useTemplate(templateMessage) {
    setMessage(templateMessage);
    setError("");
    setNotice("");
  }

  async function clearSmsHistory() {
    const confirmation = window.prompt(
      'This clears all active SMS records from this store view while preserving them in Archived History. Type "CLEAR SMS HISTORY" to continue.'
    );

    if (confirmation === null) return;

    setArchivingHistory(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/logs/archive", {
        confirmation,
        reason: "Cleared by administrator from SMS Center",
      });

      setNotice(response.data.message || "SMS history cleared safely.");
      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to clear SMS history."));
    } finally {
      setArchivingHistory(false);
    }
  }

  async function restoreSmsHistory() {
    const confirmation = window.prompt(
      'Type "RESTORE SMS HISTORY" to restore every archived SMS record for this store.'
    );

    if (confirmation === null) return;

    setRestoringHistory(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/logs/restore", {
        confirmation,
      });

      setNotice(response.data.message || "Archived SMS history restored.");
      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to restore SMS history."));
    } finally {
      setRestoringHistory(false);
    }
  }

  async function retrySmsLog(logId) {
    const cleanLogId = Number(logId);

    if (!Number.isInteger(cleanLogId) || cleanLogId <= 0) {
      setError("Invalid SMS log selected for retry.");
      setNotice("");
      return;
    }

    setRetryingLogId(cleanLogId);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post(`/sms/retry/${cleanLogId}`);

      setNotice(response.data.message || "SMS retry submission completed. Check its delivery status.");

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to retry SMS."));
    } finally {
      setRetryingLogId(null);
    }
  }

  async function sendTestSms() {
    setSendingTest(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/test", {
        phone: testPhone,
        message: testMessage,
      });

      setNotice(
        response.data?.result?.message ||
          response.data?.message ||
          "Test SMS submission completed. Provider acceptance does not yet prove phone delivery."
      );

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to send test SMS."));
    } finally {
      setSendingTest(false);
    }
  }

  async function sendDailySummarySms() {
    setSendingDailySummary(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/daily-summary");

      setNotice(
        response.data.message ||
          "Daily Closing SMS submission completed. Check the history for provider acceptance and delivery evidence."
      );

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(
        getFriendlyError(
          error,
          "Complete Daily Closing first, then resend the official summary SMS."
        )
      );
    } finally {
      setSendingDailySummary(false);
    }
  }

  async function sendCustomSms(event) {
    event.preventDefault();

    setSending(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/custom", {
        target_type: targetType,
        phone: manualPhone,
        customer_ids: selectedCustomerIds,
        message,
        sms_type: "other",
        confirm_live_bulk: liveBulkConfirmed,
        confirm_text: liveBulkConfirmText,
      });

      const smsFeedback = buildSmsFailureMessage(
        response.data,
        "SMS sending completed."
      );

      const failedCount = Number(response.data?.failed_count || 0);
      const responseStatus = String(response.data?.status || "").toLowerCase();

      if (
        failedCount > 0 ||
        responseStatus === "partial" ||
        responseStatus === "error"
      ) {
        setError(smsFeedback);
        setNotice("");
      } else {
        setNotice(smsFeedback);
        setError("");
        setManualPhone("");
        setMessage("");
        setSelectedCustomerIds([]);
        resetLiveBulkConfirmation();
      }

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to send SMS."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="boss-mobile-fix" style={styles.page}>
      <MobilePageFix />
      <section style={styles.hero}>
        <div style={styles.signalOne} />
        <div style={styles.signalTwo} />

        <div style={styles.heroContent}>
          <div>
            <p style={styles.eyebrow}>SMS Operations Console • {currentBranchCode}</p>

            <h1 style={styles.heroTitle}>SMS Center</h1>

            <p style={styles.heroSubtitle}>
              Send customer notices, debt reminders, receipt messages, stock
              alerts and daily summaries for{" "}
              <strong>{currentBranchName}</strong>
              {currentBranchLocation ? ` - ${currentBranchLocation}` : ""}.
              This page uses a communications-control design for management.
            </p>
          </div>

          <div style={styles.signalCard}>
            <span>📡</span>
            <div>
              <strong>{smsStatus?.provider_label || "SMS Provider"}</strong>
              <small>{smsStatus?.live_sending ? "LIVE SMS" : "Mock / Safe Mode"}</small>
            </div>
          </div>
        </div>
      </section>

      {notice && (
        <div className="success-box" style={{ whiteSpace: "pre-wrap" }}>
          {notice}
        </div>
      )}

      {error && (
        <div className="error-box" style={{ whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      <div style={{ ...styles.statusPanel, ...statusStyle }}>
        <div>
          <p style={styles.eyebrowDark}>Provider Safety Mode</p>
          <h2>{smsStatus?.mode_title || "SMS MODE: CHECKING..."}</h2>
          <p>
            {smsStatus?.mode_message ||
              "Checking SMS provider mode. Mock mode means no real SMS credit is used while testing."}
          </p>
        </div>

        <div style={styles.statusFacts}>
          <span>Provider: {smsStatus?.provider_label || "Unknown"}</span>
          <span>Sender ID: {smsStatus?.sender_id || "-"}</span>
          <span>SMS Enabled: {smsStatus?.enabled ? "Yes" : "No"}</span>
          <span>Real SMS: {smsStatus?.live_sending ? "YES" : "NO"}</span>
          <span>
            Delivery Tracking:{" "}
            {smsStatus?.delivery_callback_ready &&
            smsStatus?.delivery_polling_ready
              ? "Automatic callback + status checks"
              : smsStatus?.delivery_polling_ready
                ? "Automatic provider status checks"
                : smsStatus?.delivery_callback_ready
                  ? "Automatic callback"
                  : "Not ready"}
          </span>
          <span>
            Status Check:{" "}
            {smsStatus?.delivery_polling_ready
              ? `Every ${smsStatus?.delivery_poll_interval_seconds || 60} seconds`
              : "Unavailable"}
          </span>
        </div>
      </div>

      <div className="warning-box">
        Provider acceptance can use SMS credit, but it does not prove that the
        recipient's phone received the message. Chalin 03 now checks Arkesel
        automatically and updates Delivered, Undelivered or Expired without
        staff calling customers or ticking a confirmation. Do not resend while
        a message is Awaiting Delivery.
      </div>

      <div style={styles.metricsGrid}>
        <MetricCard label="Customers With Phone" value={customers.length} icon="👥" />
        <MetricCard label="Accepted by Provider" value={smsDashboard.acceptedCount} icon="📤" />
        <MetricCard label="Delivered" value={smsDashboard.deliveredCount} icon="✅" />
        <MetricCard label="Unknown / Pending" value={smsDashboard.unknownCount} icon="⏳" />
        <MetricCard label="Failed / Undelivered" value={smsDashboard.failedCount} icon="⚠️" />
        <MetricCard label="Estimated Credits" value={smsDashboard.estimatedCredits} icon="💳" />
      </div>

      {loading ? (
        <div style={styles.loadingPanel}>Loading SMS page...</div>
      ) : (
        <div style={styles.controlGrid}>
          <main style={styles.composerPanel}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.eyebrowDark}>Message Composer</p>
                <h2 style={styles.panelTitle}>Send Customer SMS</h2>
                <p style={styles.panelSubtitle}>
                  Choose recipients, apply a template, write the message and
                  send. Live bulk messages require confirmation.
                </p>
              </div>

              <button type="button" style={styles.refreshButton} onClick={() => loadSmsPageData()}>
                Refresh
              </button>
            </div>

            <form onSubmit={sendCustomSms}>
              <div style={styles.targetTabs}>
                {[
                  ["single", "One Phone"],
                  ["selected", "Selected Customers"],
                  ["all", "All Customers"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    style={{
                      ...styles.targetTab,
                      ...(targetType === value ? styles.targetTabActive : {}),
                    }}
                    onClick={() => {
                      setTargetType(value);
                      setError("");
                      setNotice("");
                      resetLiveBulkConfirmation();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {targetType === "single" && (
                <div style={styles.fieldBlock}>
                  <label>Phone Number</label>
                  <input
                    value={manualPhone}
                    onChange={(event) => setManualPhone(event.target.value)}
                    placeholder="Example: 0240000000"
                  />
                </div>
              )}

              {targetType === "selected" && (
                <section style={styles.recipientBoard}>
                  <div style={styles.recipientHeader}>
                    <div>
                      <strong>Customer Recipients</strong>
                      <p>
                        Selected customers: <b>{selectedCount}</b>
                      </p>
                    </div>

                    <div style={styles.smallButtonGroup}>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={selectAllFilteredCustomers}
                      >
                        Select Filtered
                      </button>

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={clearSelectedCustomers}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <label>Search Customers</label>
                  <input
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Search by name, phone or location"
                  />

                  <div style={styles.customerList}>
                    {filteredCustomers.length === 0 ? (
                      <p>No customers with phone numbers found.</p>
                    ) : (
                      filteredCustomers.map((customer) => (
                        <label key={customer.id} style={styles.customerRow}>
                          <input
                            type="checkbox"
                            checked={selectedCustomerIds.includes(
                              Number(customer.id)
                            )}
                            onChange={() => toggleCustomer(customer.id)}
                          />

                          <span>
                            <strong>{customer.name}</strong>
                            <small>
                              {customer.phone}
                              {customer.location ? ` • ${customer.location}` : ""}
                            </small>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </section>
              )}

              {targetType === "all" && (
                <div style={styles.warningPanel}>
                  This will send the message to all customers with phone numbers
                  inside {currentBranchCode}. Current count: {customers.length}.
                  Use this carefully because live SMS will spend credit.
                </div>
              )}

              {isLiveBulkSms && (
                <div style={styles.liveLockPanel}>
                  <p>
                    Live bulk SMS safety lock is active. This will spend real
                    SMS credit.
                  </p>

                  <label style={styles.confirmLabel}>
                    <input
                      type="checkbox"
                      checked={liveBulkConfirmed}
                      onChange={(event) =>
                        setLiveBulkConfirmed(event.target.checked)
                      }
                    />
                    <span>
                      I understand this will send a real SMS to all customers in
                      this store.
                    </span>
                  </label>

                  <label>Type this confirmation text:</label>
                  <p>
                    <strong>{liveBulkConfirmationText}</strong>
                  </p>

                  <input
                    value={liveBulkConfirmText}
                    onChange={(event) =>
                      setLiveBulkConfirmText(event.target.value)
                    }
                    placeholder={liveBulkConfirmationText}
                  />
                </div>
              )}

              <div style={styles.templateBoard}>
                <div style={styles.templateHeader}>
                  <strong>Quick Templates</strong>
                  <span>{SMS_TEMPLATES.length}</span>
                </div>

                <div style={styles.templateGrid}>
                  {SMS_TEMPLATES.map((template) => (
                    <button
                      key={template.title}
                      type="button"
                      style={styles.templateCard}
                      onClick={() => useTemplate(template.message)}
                    >
                      <strong>{template.title}</strong>
                      <small>{template.message}</small>
                    </button>
                  ))}
                </div>
              </div>

              <label>Message</label>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows="7"
                placeholder="Type your SMS message here..."
                maxLength="480"
              />

              <div style={styles.characterRow}>
                <span>
                  Characters: <strong>{message.length}</strong> / 480
                </span>

                <span>
                  Target: <strong>{targetType}</strong>
                </span>
              </div>

              <button type="submit" disabled={sending || liveBulkSendLocked} style={styles.sendButton}>
                {sending
                  ? "Sending..."
                  : liveBulkSendLocked
                  ? "Confirm Live Bulk SMS First"
                  : "Send SMS"}
              </button>
            </form>
          </main>

          <aside style={styles.sideStack}>
            <section style={styles.testPanel}>
              <p style={styles.eyebrowDark}>Test Provider</p>
              <h2>Test SMS Setup</h2>
              <p>
                Use this before messaging customers. In mock mode, no real SMS
                credit is used.
              </p>

              <label>Test Phone Number</label>
              <input
                value={testPhone}
                onChange={(event) => setTestPhone(event.target.value)}
                placeholder="Example: 0240000000"
              />

              <label>Test Message</label>
              <textarea
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
                rows="4"
                maxLength="480"
              />

              <p>
                Characters: <strong>{testMessage.length}</strong> / 480
              </p>

              <button
                type="button"
                className="secondary-button"
                onClick={sendTestSms}
                disabled={sendingTest}
              >
                {sendingTest ? "Sending Test..." : "Send Test SMS"}
              </button>
            </section>

            <section style={styles.summaryPanel}>
              <p style={styles.eyebrowDark}>Owner Alert</p>
              <h2>Boss Daily Closing Summary</h2>
              <p>
                Daily Closing sends the official summary automatically to the
                owner phone saved in settings. Use this button only to resend
                the saved closing summary.
              </p>

              <button
                type="button"
                style={styles.summaryButton}
                onClick={sendDailySummarySms}
                disabled={sendingDailySummary}
              >
                {sendingDailySummary
                  ? "Sending Summary..."
                  : "Resend Today's Closing SMS"}
              </button>
            </section>

            <section style={styles.rulesPanel}>
              <p style={styles.eyebrowDark}>SMS Rules</p>
              <h2>Important</h2>
              <p>
                Do not send unnecessary messages. SMS credit costs money, and
                customers should only receive useful business messages.
              </p>

              <div style={styles.ruleList}>
                <span>Confirm customer phone numbers.</span>
                <span>Use mock mode before live SMS.</span>
                <span>Do not bulk send without approval.</span>
                <span>Retry failed SMS only after checking the number.</span>
              </div>
            </section>
          </aside>
        </div>
      )}

      <section style={styles.historyPanel}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrowDark}>Message History</p>
            <h2 style={styles.panelTitle}>Recent SMS History</h2>
            <p style={styles.panelSubtitle}>
              Delivery evidence updates automatically from Arkesel. Clear History safely archives records instead of deleting audit evidence.
            </p>
          </div>

          <div style={styles.historyActions}>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setLogView(logView === "active" ? "archived" : "active")}
              disabled={!isAdministrator}
              title={
                isAdministrator
                  ? "Switch between active and archived SMS history"
                  : "Only an administrator can view archived SMS history"
              }
            >
              {logView === "active" ? "View Archived" : "View Active"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={downloadSmsCsv}
            >
              Export CSV
            </button>

            {isAdministrator && logView === "active" && (
              <button
                type="button"
                className="danger-button"
                onClick={clearSmsHistory}
                disabled={archivingHistory || logs.length === 0}
              >
                {archivingHistory ? "Clearing..." : "Clear SMS History"}
              </button>
            )}

            {isAdministrator && logView === "archived" && (
              <button
                type="button"
                className="secondary-button"
                onClick={restoreSmsHistory}
                disabled={restoringHistory || logs.length === 0}
              >
                {restoringHistory ? "Restoring..." : "Restore Archived History"}
              </button>
            )}
          </div>
        </div>

        <div style={styles.logToolbar}>
          <div>
            <label>Status Filter</label>
            <select
              value={logStatusFilter}
              onChange={(event) => setLogStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending submission</option>
              <option value="accepted">Accepted by provider</option>
              <option value="delivered">Delivered</option>
              <option value="delivery_unknown">Delivery unknown</option>
              <option value="undelivered">Undelivered</option>
              <option value="expired">Expired</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div>
            <label>Type Filter</label>
            <select
              value={logTypeFilter}
              onChange={(event) => setLogTypeFilter(event.target.value)}
            >
              <option value="all">All types</option>
              <option value="other">Other / Custom</option>
              <option value="receipt">Receipt</option>
              <option value="debt_reminder">Debt Reminder</option>
              <option value="low_stock">Low Stock</option>
              <option value="daily_summary">Daily Summary</option>
              <option value="security_alert">Security Alert</option>
            </select>
          </div>

          <div>
            <label>&nbsp;</label>
            <button
              type="button"
              className="secondary-button"
              onClick={resetLogFilters}
            >
              Clear Filters
            </button>
          </div>
        </div>

        <p>
          Showing <strong>{filteredLogs.length}</strong> of{" "}
          <strong>{logs.length}</strong>{" "}
          {logView === "archived" ? "archived" : "active"} SMS records.
        </p>

        {logs.length === 0 ? (
          <div style={styles.emptyState}>
            {logView === "archived"
              ? "No archived SMS records."
              : "No active SMS records yet."}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={styles.emptyState}>
            No SMS records match the selected filters.
          </div>
        ) : (
          <div style={styles.logList}>
            {filteredLogs.map((log) => {
              const normalizedStatus = String(
                log.status || "delivery_unknown"
              ).toLowerCase();
              const isFailedSms = ["failed", "undelivered", "expired"].includes(
                normalizedStatus
              );
              const canRetrySms = isFailedSms;

              return (
                <article
                  key={log.id}
                  style={{
                    ...styles.logCard,
                    ...(isFailedSms ? styles.logCardFailed : {}),
                  }}
                >
                  <div>
                    <div style={styles.logTitleRow}>
                      <strong>{log.recipient_phone}</strong>
                      <span
                        style={{
                          ...styles.logStatus,
                          ...getSmsStatusStyle(normalizedStatus),
                        }}
                      >
                        {formatSmsStatus(normalizedStatus)}
                      </span>
                    </div>

                    <p>{log.message}</p>

                    <div style={styles.logEvidenceGrid}>
                      <small>
                        <strong>Submitted:</strong>{" "}
                        {formatDateTime(log.submitted_at || log.created_at)}
                      </small>
                      <small>
                        <strong>Delivery confirmed:</strong>{" "}
                        {formatDateTime(log.delivery_confirmed_at)}
                      </small>
                      <small>
                        <strong>Provider:</strong> {log.provider || "-"} • Sender:{" "}
                        {log.sender_id || "-"}
                      </small>
                      <small>
                        <strong>Provider reference:</strong>{" "}
                        {log.provider_message_id || "Not returned"}
                      </small>
                      <small>
                        <strong>Provider status:</strong>{" "}
                        {log.provider_status || "Not returned"}
                      </small>
                      <small>
                        <strong>Last automatic check:</strong>{" "}
                        {formatDateTime(log.last_status_at)}
                      </small>
                      {log.archived_at && (
                        <small>
                          <strong>Archived:</strong>{" "}
                          {formatDateTime(log.archived_at)} by{" "}
                          {log.archived_by_name ||
                            log.archived_by_username ||
                            "Administrator"}
                        </small>
                      )}
                      <small>
                        <strong>Segments / estimated credits:</strong>{" "}
                        {log.segment_count || 1} / {log.estimated_credits || 0}
                      </small>
                      <small>
                        <strong>Source:</strong> {log.sms_type} •{" "}
                        {log.source_reference || "No source reference"}
                      </small>
                      <small>
                        <strong>Submitted by:</strong>{" "}
                        {log.sent_by_name || log.sent_by_username || "-"}
                      </small>
                    </div>

                    {log.status_reason && (
                      <p style={styles.statusReason}>
                        <strong>Status reason:</strong> {log.status_reason}
                      </p>
                    )}
                  </div>

                  <div>
                    {canRetrySms ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => retrySmsLog(log.id)}
                        disabled={retryingLogId === Number(log.id)}
                      >
                        {retryingLogId === Number(log.id)
                          ? "Retrying..."
                          : "Retry"}
                      </button>
                    ) : (
                      <span style={styles.doneMark}>
                        {normalizedStatus === "delivered"
                          ? "Confirmed"
                          : normalizedStatus === "accepted"
                            ? "Updates automatically"
                            : "Do not retry yet"}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, icon }) {
  return (
    <div style={styles.metricCard}>
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1720px",
    margin: "0 auto",
    paddingBottom: "44px",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "30px",
    padding: "28px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #052e2b 0%, #0f766e 48%, #07182c 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 70px rgba(15, 118, 110, 0.22)",
  },

  signalOne: {
    position: "absolute",
    width: "280px",
    height: "280px",
    right: "-100px",
    top: "-100px",
    borderRadius: "50%",
    background: "rgba(20, 184, 166, 0.35)",
    filter: "blur(14px)",
  },

  signalTwo: {
    position: "absolute",
    width: "230px",
    height: "230px",
    left: "38%",
    bottom: "-135px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.30)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#fef3c7",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#0f766e",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "7px 0 0",
    fontSize: "clamp(30px, 4vw, 52px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "850px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  signalCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    minWidth: "230px",
    padding: "15px",
    borderRadius: "22px",
    background: "rgba(255, 255, 255, 0.12)",
    border: "1px solid rgba(255,255,255,0.18)",
  },

  statusPanel: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "18px",
    padding: "18px",
    borderRadius: "24px",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    fontWeight: "800",
  },

  statusSafe: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
  },

  statusLive: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
  },

  statusWarning: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
  },

  statusDanger: {
    background: "#fee2e2",
    border: "1px solid #fca5a5",
    color: "#7f1d1d",
  },

  statusDisabled: {
    background: "#f3f4f6",
    border: "1px solid #d1d5db",
    color: "#374151",
  },

  statusFacts: {
    display: "grid",
    gap: "7px",
    minWidth: "220px",
    fontSize: "13px",
  },

  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  metricCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "22px",
    padding: "16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    minWidth: 0,
  },

  loadingPanel: {
    padding: "20px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    color: "#475569",
    fontWeight: "850",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  controlGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.72fr)",
    gap: "18px",
    alignItems: "start",
    marginBottom: "18px",
  },

  composerPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "16px",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  refreshButton: {
    border: "1px solid #ccfbf1",
    borderRadius: "14px",
    padding: "10px 13px",
    background: "#f0fdfa",
    color: "#0f766e",
    fontWeight: "950",
    cursor: "pointer",
  },

  targetTabs: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginBottom: "16px",
  },

  targetTab: {
    border: "1px solid #dbe3ef",
    borderRadius: "16px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "12px",
    fontWeight: "950",
    cursor: "pointer",
  },

  targetTabActive: {
    background: "#0f766e",
    color: "#ffffff",
    borderColor: "#0f766e",
  },

  fieldBlock: {
    marginBottom: "14px",
  },

  recipientBoard: {
    padding: "14px",
    borderRadius: "20px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    marginBottom: "14px",
  },

  recipientHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: "12px",
  },

  smallButtonGroup: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },

  customerList: {
    maxHeight: "310px",
    overflowY: "auto",
    border: "1px solid #d8e0ea",
    borderRadius: "16px",
    padding: "8px",
    background: "#ffffff",
    marginTop: "10px",
  },

  customerRow: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "10px",
    alignItems: "start",
    padding: "10px",
    borderBottom: "1px solid #edf1f5",
    cursor: "pointer",
  },

  warningPanel: {
    marginBottom: "14px",
    padding: "14px",
    borderRadius: "16px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    fontWeight: "800",
  },

  liveLockPanel: {
    marginBottom: "14px",
    padding: "14px",
    borderRadius: "16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    fontWeight: "800",
  },

  confirmLabel: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "10px",
    alignItems: "start",
    cursor: "pointer",
  },

  templateBoard: {
    marginBottom: "14px",
  },

  templateHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
    marginBottom: "10px",
    fontWeight: "950",
  },

  templateGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "10px",
  },

  templateCard: {
    textAlign: "left",
    border: "1px solid #dbe3ef",
    borderRadius: "16px",
    padding: "12px",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
  },

  characterRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    color: "#64748b",
    fontWeight: "800",
    marginBottom: "12px",
  },

  sendButton: {
    width: "100%",
    border: "none",
    borderRadius: "16px",
    padding: "13px 16px",
    background: "#0f766e",
    color: "#ffffff",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(15, 118, 110, 0.22)",
  },

  sideStack: {
    display: "grid",
    gap: "18px",
    position: "sticky",
    top: "18px",
  },

  testPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  summaryPanel: {
    borderRadius: "26px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 58%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 20px 50px rgba(7, 24, 44, 0.25)",
  },

  summaryButton: {
    width: "100%",
    border: "none",
    borderRadius: "16px",
    padding: "13px 16px",
    background: "#e0ba28",
    color: "#07182c",
    fontWeight: "950",
    cursor: "pointer",
  },

  rulesPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  ruleList: {
    display: "grid",
    gap: "8px",
    marginTop: "12px",
    color: "#475569",
    fontWeight: "800",
  },

  historyPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  historyActions: {
    display: "flex",
    gap: "9px",
    flexWrap: "wrap",
    alignItems: "center",
  },

  logToolbar: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginBottom: "14px",
  },

  emptyState: {
    padding: "20px",
    color: "#64748b",
    fontWeight: "800",
    textAlign: "center",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
  },

  logList: {
    display: "grid",
    gap: "10px",
  },

  logCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "12px",
    alignItems: "center",
    padding: "14px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  logCardFailed: {
    background: "#fff7f7",
    borderColor: "#fecaca",
  },

  logTitleRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },

  logStatus: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "5px 8px",
    background: "#dcfce7",
    color: "#166534",
    fontSize: "11px",
    fontWeight: "950",
  },

  logStatusFailed: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  logStatusDelivered: {
    background: "#dcfce7",
    color: "#166534",
  },
  logStatusAccepted: {
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  logStatusUnknown: {
    background: "#fef3c7",
    color: "#92400e",
  },
  logEvidenceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "6px 18px",
    marginTop: "12px",
  },
  statusReason: {
    marginTop: "10px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "#fff7ed",
    color: "#9a3412",
  },

  doneMark: {
    fontWeight: "950",
    color: "#166534",
  },
};
