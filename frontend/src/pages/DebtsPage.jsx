import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";
import CustomerDebtPrintPanel from "../components/CustomerDebtPrintPanel";
import CustomerDebtConsolidationPanel from "../components/CustomerDebtConsolidationPanel";
import { formatBusinessDate, formatBusinessDateTime } from "../utils/businessDate";

export default function DebtsPage() {
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

  const [debts, setDebts] = useState([]);
  const [summary, setSummary] = useState(null);

  const [selectedDebtId, setSelectedDebtId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");

  const [selectedDebt, setSelectedDebt] = useState(null);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [latestReceipt, setLatestReceipt] = useState(null);

  const [lockedPeriod, setLockedPeriod] = useState(null);
  const [unlockRequestAction, setUnlockRequestAction] = useState(
    "Record debt payment inside locked period"
  );

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sendingDebtSmsId, setSendingDebtSmsId] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showIndividualDebts, setShowIndividualDebts] = useState(false);

  const businessName = "Chalin 03 Company Limited";
  const momoNumber = "0543421127";

  function getDebtStoreCode(debt) {
    return debt?.branch_code || debt?.store_code || currentStoreCode;
  }

  function getDebtStoreName(debt) {
    return debt?.branch_name || debt?.store_name || currentStoreName;
  }

  function getDebtStoreLocation(debt) {
    return debt?.branch_location || debt?.store_location || currentStoreLocation;
  }

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatCompactMoney(value) {
    const number = Number(value || 0);

    if (number >= 1000000) {
      return `GHS ${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
      return `GHS ${(number / 1000).toFixed(1)}K`;
    }

    return formatMoney(number);
  }

  function formatDate(value) {
    return formatBusinessDate(value);
  }

  function formatDateTime(value) {
    return formatBusinessDateTime(value);
  }

  function formatPaymentMethod(value) {
    const methods = {
      cash: "Cash",
      momo: "MoMo",
      bank: "Bank",
    };

    return methods[String(value || "").toLowerCase()] || value || "-";
  }

  function formatDebtStatus(value) {
    const statuses = {
      unpaid: "Unpaid",
      partial: "Partial",
      paid: "Paid",
    };

    return statuses[String(value || "").toLowerCase()] || value || "-";
  }

  function getStatusStyle(value) {
    const status = String(value || "").toLowerCase();

    if (status === "paid") {
      return styles.statusPaid;
    }

    if (status === "partial") {
      return styles.statusPartial;
    }

    return styles.statusUnpaid;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getLockedPeriodFromError(error) {
    const responseData = error?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      return responseData.locked_period || null;
    }

    return null;
  }

  function getFriendlyApiError(error, fallbackMessage) {
    const responseData = error?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      const lockedPeriodData = responseData.locked_period || {};
      const periodLabel =
        lockedPeriodData.period_label || "Approved accounting period";
      const approvedBy = lockedPeriodData.approved_by_name || "management";
      const reviewDate = lockedPeriodData.review_date || "";

      return [
        "This debt payment cannot be recorded because the accounting period is locked.",
        `Locked Period: ${periodLabel}.`,
        `Reason: This period has already been approved by ${approvedBy}.`,
        reviewDate ? `Approval Date: ${reviewDate}.` : "",
        "Use the unlock request form below if a correction is needed.",
      ]
        .filter(Boolean)
        .join(" ");
    }

    return responseData?.message || fallbackMessage;
  }

  function formatPhoneForWhatsApp(phone) {
    const rawPhone = String(phone || "").trim();

    if (!rawPhone || rawPhone === "-") {
      return "";
    }

    let digits = rawPhone.replace(/\D/g, "");

    if (digits.startsWith("0")) {
      digits = `233${digits.slice(1)}`;
    }

    if (digits.startsWith("233")) {
      return digits;
    }

    if (digits.length === 9) {
      return `233${digits}`;
    }

    return digits;
  }

  function buildDebtReminderMessage(debt) {
    return `Hello ${debt.customer_name || "Customer"},

This is a friendly debt reminder from ${businessName}.

DEBT DETAILS
Store: ${getDebtStoreCode(debt)} - ${getDebtStoreName(debt)}
Receipt No: ${debt.receipt_number || "-"}
Total Debt: ${formatMoney(debt.amount_owed)}
Amount Paid: ${formatMoney(debt.amount_paid)}
Outstanding Balance: ${formatMoney(debt.balance)}
Status: ${formatDebtStatus(debt.status)}
Due Date: ${formatDate(debt.due_date)}

Please make payment as soon as possible.

MoMo Number: ${momoNumber}

Thank you.`;
  }

  async function sendDebtReminderSms(debt) {
    setMessage("");
    setError("");

    if (!debt?.id) {
      setError("Debt information is missing.");
      return;
    }

    if (String(debt.status || "").toLowerCase() === "paid") {
      setError("This debt is already paid. No SMS reminder is needed.");
      return;
    }

    if (!debt.customer_phone) {
      setError("Customer phone number is missing. Add customer phone first.");
      return;
    }

    setSendingDebtSmsId(debt.id);

    try {
      const response = await axiosClient.post(`/sms/debt/${debt.id}`);

      setMessage(response.data.message || "Debt reminder SMS sent successfully.");
    } catch (error) {
      setError(getFriendlyApiError(error, "Failed to send debt reminder SMS."));
    } finally {
      setSendingDebtSmsId(null);
    }
  }

  function sendDebtReminderWhatsApp(debt) {
    setMessage("");
    setError("");

    if (!debt) {
      setError("Debt information is missing.");
      return;
    }

    if (String(debt.status || "").toLowerCase() === "paid") {
      setError("This debt is already paid. No reminder is needed.");
      return;
    }

    const whatsappPhone = formatPhoneForWhatsApp(debt.customer_phone);

    if (!whatsappPhone) {
      setError("Customer phone number is missing. Add customer phone first.");
      return;
    }

    const messageText = buildDebtReminderMessage(debt);

    const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(
      messageText
    )}`;

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  }

  async function loadDebts() {
    setError("");
    setLoading(true);

    try {
      const [debtsResponse, summaryResponse] = await Promise.all([
        axiosClient.get("/debts"),
        axiosClient.get("/debts/summary"),
      ]);

      setDebts(debtsResponse.data.debts || []);
      setSummary(summaryResponse.data.summary || null);
    } catch (error) {
      setError(getFriendlyApiError(error, "Failed to load debts."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDebts();
    // Reload debts when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

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

  async function viewDebt(debtId) {
    setMessage("");
    setError("");
    setDetailsLoading(true);

    try {
      const response = await axiosClient.get(`/debts/${debtId}`);

      setSelectedDebt({
        ...(response.data.debt || {}),
        branch_code:
          response.data.debt?.branch_code ||
          response.data.debt?.store_code ||
          currentStoreCode,
        branch_name:
          response.data.debt?.branch_name ||
          response.data.debt?.store_name ||
          currentStoreName,
        branch_location:
          response.data.debt?.branch_location ||
          response.data.debt?.store_location ||
          currentStoreLocation,
      });
      setSelectedPayments(response.data.payments || []);
    } catch (error) {
      setError(getFriendlyApiError(error, "Failed to load debt details."));
    } finally {
      setDetailsLoading(false);
    }
  }

  function closeDebtDetails() {
    setSelectedDebt(null);
    setSelectedPayments([]);
  }

  function closeLatestReceipt() {
    setLatestReceipt(null);
  }

  function preparePayment(debt) {
    setSelectedDebtId(String(debt.id));
    setAmount("");
    setPaymentMethod("cash");
    setNotes("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function printDebtPaymentReceipt(receiptData) {
    if (!receiptData) return;

    const payment = receiptData.payment;
    const debt = receiptData.debt;

    const printWindow = window.open("", "_blank", "width=420,height=700");

    if (!printWindow) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }

    const receiptHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Debt Payment Receipt</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 14px;
              color: #111827;
              font-size: 12px;
            }

            .receipt {
              max-width: 320px;
              margin: 0 auto;
            }

            h1 {
              font-size: 16px;
              margin: 0;
              text-align: center;
              text-transform: uppercase;
            }

            h2 {
              font-size: 13px;
              text-align: center;
              margin: 8px 0;
            }

            .center {
              text-align: center;
            }

            .line {
              border-top: 1px dashed #111827;
              margin: 10px 0;
            }

            .row {
              display: flex;
              justify-content: space-between;
              gap: 10px;
              margin: 5px 0;
            }

            .row span:first-child {
              font-weight: bold;
            }

            .big {
              font-size: 15px;
              font-weight: bold;
            }

            .footer {
              margin-top: 14px;
              text-align: center;
              font-size: 11px;
            }

            @media print {
              button {
                display: none;
              }

              body {
                padding: 0;
              }
            }
          </style>
        </head>

        <body>
          <div class="receipt">
            <h1>Chalin 03 Company Limited</h1>
            <div class="center">${escapeHtml(
              getDebtStoreLocation(debt) || "Dunkwa Police Barrier"
            )}</div>
            <div class="center">Tel: 0249469080 / 0249995510</div>
            <div class="center">Store: ${escapeHtml(
              getDebtStoreCode(debt)
            )} - ${escapeHtml(getDebtStoreName(debt))}</div>

            <div class="line"></div>

            <h2>Debt Payment Receipt</h2>

            <div class="row">
              <span>Store:</span>
              <span>${escapeHtml(getDebtStoreCode(debt))} - ${escapeHtml(
      getDebtStoreName(debt)
    )}</span>
            </div>

            <div class="row">
              <span>Payment ID:</span>
              <span>${escapeHtml(payment.id)}</span>
            </div>

            <div class="row">
              <span>Sale Receipt:</span>
              <span>${escapeHtml(debt.receipt_number || "-")}</span>
            </div>

            <div class="row">
              <span>Customer:</span>
              <span>${escapeHtml(debt.customer_name || "-")}</span>
            </div>

            <div class="row">
              <span>Phone:</span>
              <span>${escapeHtml(debt.customer_phone || "-")}</span>
            </div>

            <div class="row">
              <span>Date:</span>
              <span>${escapeHtml(formatDateTime(payment.paid_at))}</span>
            </div>

            <div class="row">
              <span>Method:</span>
              <span>${escapeHtml(formatPaymentMethod(payment.payment_method))}</span>
            </div>

            <div class="row">
              <span>Received By:</span>
              <span>${escapeHtml(payment.received_by_name || "-")}</span>
            </div>

            <div class="line"></div>

            <div class="row">
              <span>Total Debt:</span>
              <span>${formatMoney(debt.amount_owed)}</span>
            </div>

            <div class="row">
              <span>Previous Balance:</span>
              <span>${formatMoney(debt.previous_balance)}</span>
            </div>

            <div class="row big">
              <span>Amount Paid:</span>
              <span>${formatMoney(payment.amount)}</span>
            </div>

            <div class="row">
              <span>New Balance:</span>
              <span>${formatMoney(debt.balance)}</span>
            </div>

            <div class="row">
              <span>Status:</span>
              <span>${escapeHtml(formatDebtStatus(debt.status))}</span>
            </div>

            ${
              payment.notes
                ? `<div class="line"></div><div><strong>Notes:</strong> ${escapeHtml(payment.notes)}</div>`
                : ""
            }

            <div class="line"></div>

            <div class="footer">
              Thank you for your payment.<br />
              Keep this receipt for your records.
            </div>

            <br />
            <div class="center">
              <button onclick="window.print()">Print</button>
            </div>
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

  async function recordPayment(event) {
    event.preventDefault();

    setMessage("");
    setError("");
    setLatestReceipt(null);
    setLockedPeriod(null);
    setUnlockRequestAction("Record debt payment inside locked period");

    if (!selectedDebtId) {
      setError("Select a debt first.");
      return;
    }

    const cleanAmount = Number(amount || 0);

    if (Number.isNaN(cleanAmount) || cleanAmount <= 0) {
      setError("Amount paid must be greater than zero.");
      return;
    }

    try {
      const response = await axiosClient.post(
        `/debts/${selectedDebtId}/payments`,
        {
          amount: cleanAmount,
          payment_method: paymentMethod,
          notes,
        }
      );

      setMessage("Debt payment recorded successfully.");
      setLatestReceipt(
        response.data.receipt
          ? {
              ...response.data.receipt,
              debt: {
                ...(response.data.receipt.debt || {}),
                branch_code:
                  response.data.receipt.debt?.branch_code || currentStoreCode,
                branch_name:
                  response.data.receipt.debt?.branch_name || currentStoreName,
                branch_location:
                  response.data.receipt.debt?.branch_location ||
                  currentStoreLocation,
              },
            }
          : null
      );

      setSelectedDebtId("");
      setAmount("");
      setNotes("");
      setPaymentMethod("cash");

      await loadDebts();
    } catch (error) {
      const period = getLockedPeriodFromError(error);

      if (period) {
        setLockedPeriod(period);
        setUnlockRequestAction("Record debt payment inside locked period");
      }

      setError(getFriendlyApiError(error, "Failed to record debt payment."));
    }
  }

  const dashboardSummary = useMemo(() => {
    const unpaidDebts = debts.filter(
      (debt) => String(debt.status || "").toLowerCase() === "unpaid"
    );
    const partialDebts = debts.filter(
      (debt) => String(debt.status || "").toLowerCase() === "partial"
    );
    const paidDebts = debts.filter(
      (debt) => String(debt.status || "").toLowerCase() === "paid"
    );

    const outstandingBalance =
      summary?.outstanding_balance ??
      debts
        .filter((debt) => String(debt.status || "").toLowerCase() !== "paid")
        .reduce((sum, debt) => sum + Number(debt.balance || 0), 0);

    const totalOwed = debts.reduce(
      (sum, debt) => sum + Number(debt.amount_owed || 0),
      0
    );

    const totalPaid = debts.reduce(
      (sum, debt) => sum + Number(debt.amount_paid || 0),
      0
    );

    const overdueCount = summary?.overdue_count ?? 0;

    return {
      outstandingBalance,
      totalOwed,
      totalPaid,
      unpaidCount: summary?.unpaid_count ?? unpaidDebts.length,
      partialCount: summary?.partial_count ?? partialDebts.length,
      paidCount: paidDebts.length,
      overdueCount,
      activeCount: unpaidDebts.length + partialDebts.length,
    };
  }, [debts, summary]);

  const selectedDebtForPayment = debts.find(
    (debt) => Number(debt.id) === Number(selectedDebtId)
  );

  const paymentPreviewBalance = selectedDebtForPayment
    ? Math.max(
        Number(selectedDebtForPayment.balance || 0) - Number(amount || 0),
        0
      )
    : 0;

  const oneColumn = isMobile ? styles.oneColumn : {};
  const compactHero = isMobile ? styles.heroMobile : {};
  const compactHeroTitle = isMobile ? styles.heroTitleMobile : {};
  const compactMainGrid = isMobile ? styles.mainGridMobile : {};
  const compactModalActions = isMobile ? styles.modalActionsMobile : {};

  return (
    <div style={styles.page}>
      <div style={{ ...styles.hero, ...compactHero }}>
        <div style={styles.heroGlowOne} />
        <div style={styles.heroGlowTwo} />

        <div style={styles.heroContent}>
          <div style={styles.heroTop}>
            <div>
              <p style={styles.eyebrow}>Debt Control Center • {currentStoreCode}</p>

              <h1 style={{ ...styles.heroTitle, ...compactHeroTitle }}>
                Debts
              </h1>

              <p style={styles.heroSubtitle}>
                Track credit customers, collect payments, print payment receipts,
                and send SMS or WhatsApp reminders for{" "}
                <strong>{currentStoreName}</strong>
                {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}.
              </p>
            </div>

            <button type="button" style={styles.heroButton} onClick={loadDebts}>
              {loading ? "Refreshing..." : "Refresh Debts"}
            </button>
          </div>

          <div style={{ ...styles.heroMetrics, ...oneColumn }}>
            <HeroMetric
              label="Outstanding : "
              value={formatCompactMoney(dashboardSummary.outstandingBalance)}
            />
            <HeroMetric label="Active Debts : " value={dashboardSummary.activeCount} />
            <HeroMetric label="Partial : " value={dashboardSummary.partialCount} />
            <HeroMetric label="Overdue : " value={dashboardSummary.overdueCount} />
          </div>
        </div>
      </div>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏬</span>
        <div>
          <strong>
            {currentStoreCode} — {currentStoreName}
          </strong>
          <p>
            Debt list, debt payments, payment receipts, SMS reminders and
            WhatsApp reminders are filtered to this selected store only.
          </p>
        </div>
      </div>

      <CustomerDebtConsolidationPanel
        currentStoreCode={currentStoreCode}
        currentStoreName={currentStoreName}
        userRole={user?.role}
        onRecordPayment={preparePayment}
        onRefresh={loadDebts}
      />

      <div className="debt-record-view-toggle">
        <span>
          The consolidated view keeps one card per customer. Open the individual
          receipt-level records only when you need audit detail or a direct payment action.
        </span>
        <button
          type="button"
          onClick={() => setShowIndividualDebts((current) => !current)}
        >
          {showIndividualDebts ? "Hide Individual Debt Records" : "Show Individual Debt Records"}
        </button>
      </div>

      <CustomerDebtPrintPanel
        currentStoreCode={currentStoreCode}
        preferredCustomer={selectedDebt}
        reportType="debt"
      />

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      {lockedPeriod && (
        <AuditUnlockRequestBox
          lockedPeriod={lockedPeriod}
          requestArea="debt_payment"
          requestedAction={unlockRequestAction}
          onRequestSent={() => {
            setMessage(
              "Unlock request sent successfully. Admin or manager must review it."
            );
          }}
        />
      )}

      <div style={{ ...styles.summaryGrid, ...oneColumn }}>
        <SummaryCard
          icon="💳"
          title="Outstanding Balance"
          value={formatMoney(dashboardSummary.outstandingBalance)}
          note="Money still owed by customers"
          tone="red"
        />

        <SummaryCard
          icon="🧾"
          title="Total Debt Value"
          value={formatMoney(dashboardSummary.totalOwed)}
          note="All debt records in this store"
          tone="gold"
        />

        <SummaryCard
          icon="✅"
          title="Amount Collected"
          value={formatMoney(dashboardSummary.totalPaid)}
          note="Payments already received"
          tone="green"
        />

        <SummaryCard
          icon="⏰"
          title="Overdue"
          value={dashboardSummary.overdueCount}
          note="Follow-up priority"
          tone="blue"
        />
      </div>

      {latestReceipt && (
        <section style={styles.receiptSuccessPanel}>
          <div>
            <p style={styles.eyebrowDark}>Latest Payment Receipt</p>
            <h2>
              {formatMoney(latestReceipt.payment.amount)} collected from{" "}
              {latestReceipt.debt.customer_name}
            </h2>
            <p>
              Print this receipt for the customer and keep it for business
              records.
            </p>
          </div>

          <div style={styles.receiptActions}>
            <button
              type="button"
              onClick={() => printDebtPaymentReceipt(latestReceipt)}
            >
              Print Receipt
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={closeLatestReceipt}
            >
              Close
            </button>
          </div>
        </section>
      )}

      <div style={{ ...styles.mainGrid, ...compactMainGrid }}>
        <section style={{ ...styles.panelLarge, display: showIndividualDebts ? "block" : "none" }}>
          <div style={styles.panelHeader}>
            <div>
              <p style={styles.eyebrowDark}>Customer Debt List</p>
              <h2 style={styles.panelTitle}>Debt List - {currentStoreCode}</h2>
              <p style={styles.panelSubtitle}>
                View customer balances, payment history and reminder actions.
              </p>
            </div>

            <span style={styles.goldBadge}>{debts.length} debt record(s)</span>
          </div>

          {detailsLoading && (
            <div className="success-box">Loading details...</div>
          )}

          {debts.length === 0 ? (
            <div style={styles.emptyState}>
              No debts found for {currentStoreCode}. Record a credit sale first.
            </div>
          ) : (
            <div style={styles.debtList}>
              {debts.map((debt) => {
                const paid = String(debt.status || "").toLowerCase() === "paid";

                return (
                  <article key={debt.id} style={styles.debtCard}>
                    <div style={styles.debtCardTop}>
                      <div>
                        <div style={styles.debtNameRow}>
                          <strong>{debt.customer_name}</strong>
                          <span style={{ ...styles.statusBadge, ...getStatusStyle(debt.status) }}>
                            {formatDebtStatus(debt.status)}
                          </span>
                        </div>

                        <p>
                          {debt.customer_phone || "-"} • Receipt:{" "}
                          {debt.receipt_number || "-"}
                        </p>

                        <small>
                          Debt Date: {formatDate(debt.created_at || debt.sale_date)} • Due:{" "}
                          {formatDate(debt.due_date)} • Store: {getDebtStoreCode(debt)}
                        </small>
                      </div>

                      <div style={styles.balanceBox}>
                        <span>Balance</span>
                        <strong>{formatMoney(debt.balance)}</strong>
                        <small>
                          Paid {formatMoney(debt.amount_paid)} of{" "}
                          {formatMoney(debt.amount_owed)}
                        </small>
                      </div>
                    </div>

                    <div style={styles.debtMiniGrid}>
                      <MiniStat label="Owed" value={formatMoney(debt.amount_owed)} />
                      <MiniStat label="Paid" value={formatMoney(debt.amount_paid)} />
                      <MiniStat label="Balance" value={formatMoney(debt.balance)} />
                      <MiniStat
                        label="Debt Date"
                        value={formatDate(debt.created_at || debt.sale_date)}
                      />
                      <MiniStat label="Due Date" value={formatDate(debt.due_date)} />
                    </div>

                    <div style={styles.cardActions}>
                      <button type="button" onClick={() => viewDebt(debt.id)}>
                        View Details
                      </button>

                      {!paid && (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => preparePayment(debt)}
                          >
                            Record Payment
                          </button>

                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => sendDebtReminderSms(debt)}
                            disabled={sendingDebtSmsId === debt.id}
                          >
                            {sendingDebtSmsId === debt.id
                              ? "Sending SMS..."
                              : "SMS Reminder"}
                          </button>

                          <button
                            type="button"
                            onClick={() => sendDebtReminderWhatsApp(debt)}
                            style={{
                              background: "#16a34a",
                              color: "#ffffff",
                              border: "none",
                            }}
                          >
                            WhatsApp Reminder
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside style={styles.sideStack}>
          <form style={styles.panel} onSubmit={recordPayment}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.eyebrowDark}>Collect Payment</p>
                <h2 style={styles.panelTitle}>Record Payment</h2>
                <p style={styles.panelSubtitle}>
                  Select a customer debt and enter the amount received.
                </p>
              </div>
            </div>

            <label>Select Debt</label>
            <select
              value={selectedDebtId}
              onChange={(event) => setSelectedDebtId(event.target.value)}
            >
              <option value="">Choose debt</option>

              {debts
                .filter((debt) => debt.status !== "paid")
                .map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {debt.customer_name} — Balance {formatMoney(debt.balance)}
                  </option>
                ))}
            </select>

            {selectedDebtForPayment && (
              <div style={styles.paymentPreview}>
                <strong>{selectedDebtForPayment.customer_name}</strong>
                <span>
                  Current Balance: {formatMoney(selectedDebtForPayment.balance)}
                </span>
                <span>After Payment: {formatMoney(paymentPreviewBalance)}</span>
              </div>
            )}

            <label>Amount Paid</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Example: 200"
            />

            <label>Payment Method</label>
            <div style={styles.paymentMethodGrid}>
              {["cash", "momo", "bank"].map((method) => (
                <button
                  key={method}
                  type="button"
                  style={{
                    ...styles.methodButton,
                    ...(paymentMethod === method ? styles.methodButtonActive : {}),
                  }}
                  onClick={() => setPaymentMethod(method)}
                >
                  {formatPaymentMethod(method)}
                </button>
              ))}
            </div>

            <label>Notes</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional note about this payment"
            />

            <button type="submit" style={styles.saveButton}>
              Save Payment & Print Receipt
            </button>
          </form>

          <div style={styles.darkPanel}>
            <h2>Boss Debt View</h2>
            <p>
              Unpaid and partial debts need regular follow-up. Use SMS and
              WhatsApp reminders to reduce customer balances faster.
            </p>

            <div style={{ ...styles.darkMiniGrid, ...oneColumn }}>
              <div>
                <span>Unpaid</span>
                <strong>{dashboardSummary.unpaidCount}</strong>
              </div>

              <div>
                <span>Partial</span>
                <strong>{dashboardSummary.partialCount}</strong>
              </div>

              <div>
                <span>Paid Records</span>
                <strong>{dashboardSummary.paidCount}</strong>
              </div>

              <div>
                <span>Outstanding</span>
                <strong>{formatCompactMoney(dashboardSummary.outstandingBalance)}</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {selectedDebt && (
        <div className="modal-backdrop">
          <div className="receipt-modal" style={styles.receiptModal}>
            <div className="modal-header">
              <div>
                <h2>Debt Details - {getDebtStoreCode(selectedDebt)}</h2>
                <p>
                  Customer: <strong>{selectedDebt.customer_name}</strong>
                  <br />
                  Store: <strong>{getDebtStoreName(selectedDebt)}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeDebtDetails}
              >
                Close
              </button>
            </div>

            <div className="receipt-preview">
              <div className="receipt-info-grid">
                <p>
                  <strong>Store:</strong> {getDebtStoreCode(selectedDebt)} —{" "}
                  {getDebtStoreName(selectedDebt)}
                </p>

                <p>
                  <strong>Receipt Number:</strong>{" "}
                  {selectedDebt.receipt_number || "-"}
                </p>

                <p>
                  <strong>Customer Phone:</strong>{" "}
                  {selectedDebt.customer_phone || "-"}
                </p>

                <p>
                  <strong>Total Debt:</strong>{" "}
                  {formatMoney(selectedDebt.amount_owed)}
                </p>

                <p>
                  <strong>Amount Paid:</strong>{" "}
                  {formatMoney(selectedDebt.amount_paid)}
                </p>

                <p>
                  <strong>Balance:</strong> {formatMoney(selectedDebt.balance)}
                </p>

                <p>
                  <strong>Status:</strong>{" "}
                  {formatDebtStatus(selectedDebt.status)}
                </p>

                <p>
                  <strong>Due Date:</strong> {formatDate(selectedDebt.due_date)}
                </p>

                <p>
                  <strong>Debt Date:</strong>{" "}
                  {formatDateTime(selectedDebt.created_at || selectedDebt.sale_date)}
                </p>
              </div>

              <div style={styles.detailActions}>
                {String(selectedDebt.status || "").toLowerCase() !== "paid" && (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => sendDebtReminderSms(selectedDebt)}
                      disabled={sendingDebtSmsId === selectedDebt.id}
                    >
                      {sendingDebtSmsId === selectedDebt.id
                        ? "Sending SMS..."
                        : "Send SMS Reminder"}
                    </button>

                    <button
                      type="button"
                      onClick={() => sendDebtReminderWhatsApp(selectedDebt)}
                      style={{
                        background: "#16a34a",
                        color: "#ffffff",
                        border: "none",
                      }}
                    >
                      Send WhatsApp Reminder
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        preparePayment(selectedDebt);
                        closeDebtDetails();
                      }}
                    >
                      Record Payment
                    </button>
                  </>
                )}
              </div>

              <h3>Payment History</h3>

              {selectedPayments.length === 0 ? (
                <p>No payment history found for this debt.</p>
              ) : (
                <div style={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Received By</th>
                        <th>Notes</th>
                        <th></th>
                      </tr>
                    </thead>

                    <tbody>
                      {selectedPayments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{formatDateTime(payment.paid_at)}</td>
                          <td>{formatMoney(payment.amount)}</td>
                          <td>{formatPaymentMethod(payment.payment_method)}</td>
                          <td>{payment.received_by_name || "-"}</td>
                          <td>{payment.notes || "-"}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() =>
                                printDebtPaymentReceipt({
                                  payment,
                                  debt: {
                                    ...selectedDebt,
                                    branch_code: getDebtStoreCode(selectedDebt),
                                    branch_name: getDebtStoreName(selectedDebt),
                                    branch_location:
                                      getDebtStoreLocation(selectedDebt),
                                    previous_balance:
                                      Number(selectedDebt.balance || 0) +
                                      Number(payment.amount || 0),
                                  },
                                })
                              }
                            >
                              Print
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ ...styles.modalActions, ...compactModalActions }}>
              {String(selectedDebt.status || "").toLowerCase() !== "paid" && (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => sendDebtReminderSms(selectedDebt)}
                    disabled={sendingDebtSmsId === selectedDebt.id}
                  >
                    {sendingDebtSmsId === selectedDebt.id
                      ? "Sending SMS..."
                      : "Send SMS Reminder"}
                  </button>

                  <button
                    type="button"
                    onClick={() => sendDebtReminderWhatsApp(selectedDebt)}
                    style={{
                      background: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                    }}
                  >
                    Send WhatsApp Reminder
                  </button>
                </>
              )}

              <button
                type="button"
                className="secondary-button"
                onClick={closeDebtDetails}
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroMetric({ label, value }) {
  return (
    <div style={styles.heroMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({ icon, title, value, note, tone }) {
  return (
    <div style={styles.summaryCard}>
      <div style={{ ...styles.summaryIcon, ...summaryTones[tone] }}>{icon}</div>

      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={styles.miniStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const summaryTones = {
  gold: { background: "#fef3c7", color: "#92400e" },
  blue: { background: "#dbeafe", color: "#1d4ed8" },
  green: { background: "#dcfce7", color: "#166534" },
  red: { background: "#fee2e2", color: "#991b1b" },
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "42px",
  },

  oneColumn: {
    gridTemplateColumns: "1fr",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "28px",
    padding: "26px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 48%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 60px rgba(7, 24, 44, 0.26)",
  },

  heroMobile: {
    padding: "18px 14px",
    borderRadius: "20px",
  },

  heroGlowOne: {
    position: "absolute",
    width: "260px",
    height: "260px",
    right: "-90px",
    top: "-90px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.30)",
    filter: "blur(18px)",
  },

  heroGlowTwo: {
    position: "absolute",
    width: "180px",
    height: "180px",
    left: "35%",
    bottom: "-110px",
    borderRadius: "50%",
    background: "rgba(37, 99, 235, 0.34)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
  },

  heroTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#b45309",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 50px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroTitleMobile: {
    fontSize: "30px",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "820px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.6,
  },

  heroButton: {
    border: "1px solid rgba(224, 186, 40, 0.62)",
    background: "rgba(224, 186, 40, 0.16)",
    color: "#ffffff",
    borderRadius: "14px",
    padding: "11px 14px",
    fontWeight: "950",
    cursor: "pointer",
  },

  heroMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "12px",
    marginTop: "22px",
  },

  heroMetric: {
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.15)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  summaryCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "20px",
    padding: "16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    minWidth: 0,
  },

  summaryIcon: {
    width: "46px",
    height: "46px",
    borderRadius: "16px",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
    flexShrink: 0,
  },

  receiptSuccessPanel: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "center",
    flexWrap: "wrap",
    background: "linear-gradient(135deg, #ecfdf3, #ffffff)",
    borderRadius: "22px",
    padding: "18px",
    border: "1px solid #bbf7d0",
    color: "#14532d",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    marginBottom: "18px",
  },

  receiptActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(340px, 0.8fr)",
    gap: "18px",
    alignItems: "start",
  },

  mainGridMobile: {
    gridTemplateColumns: "1fr",
  },

  panelLarge: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panel: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  sideStack: {
    display: "grid",
    gap: "18px",
    position: "sticky",
    top: "18px",
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

  goldBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "7px 11px",
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: "950",
    fontSize: "12px",
    whiteSpace: "nowrap",
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

  debtList: {
    display: "grid",
    gap: "12px",
  },

  debtCard: {
    borderRadius: "20px",
    border: "1px solid #e2e8f0",
    background: "linear-gradient(180deg, #ffffff, #f8fafc)",
    padding: "16px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  debtCardTop: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "14px",
    alignItems: "start",
  },

  debtNameRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },

  statusBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "5px 8px",
    fontSize: "11px",
    fontWeight: "950",
  },

  statusPaid: {
    background: "#dcfce7",
    color: "#166534",
  },

  statusPartial: {
    background: "#ffedd5",
    color: "#9a3412",
  },

  statusUnpaid: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  balanceBox: {
    minWidth: "180px",
    textAlign: "right",
    color: "#0f172a",
  },

  debtMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },

  miniStat: {
    padding: "10px",
    borderRadius: "14px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },

  cardActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "14px",
  },

  paymentPreview: {
    display: "grid",
    gap: "5px",
    padding: "12px",
    borderRadius: "16px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    marginBottom: "12px",
  },

  paymentMethodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    marginBottom: "12px",
  },

  methodButton: {
    border: "1px solid #dbe3ef",
    borderRadius: "13px",
    background: "#ffffff",
    color: "#0f172a",
    padding: "10px",
    fontWeight: "900",
    cursor: "pointer",
  },

  methodButtonActive: {
    background: "#07182c",
    color: "#e0ba28",
    borderColor: "#07182c",
  },

  saveButton: {
    width: "100%",
    border: "none",
    borderRadius: "16px",
    padding: "13px 16px",
    background: "#e0ba28",
    color: "#07182c",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(224, 186, 40, 0.22)",
  },

  darkPanel: {
    borderRadius: "24px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 58%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 20px 50px rgba(7, 24, 44, 0.25)",
  },

  darkMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },

  receiptModal: {
    maxWidth: "980px",
  },

  detailActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "14px",
    marginBottom: "14px",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  modalActions: {
    marginTop: "18px",
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
  },

  modalActionsMobile: {
    display: "grid",
    gridTemplateColumns: "1fr",
  },
};
