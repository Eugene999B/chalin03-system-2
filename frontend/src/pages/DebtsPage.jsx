import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";

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

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString();
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleString();
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

    try {
      const [debtsResponse, summaryResponse] = await Promise.all([
        axiosClient.get("/debts"),
        axiosClient.get("/debts/summary"),
      ]);

      setDebts(debtsResponse.data.debts || []);
      setSummary(summaryResponse.data.summary || null);
    } catch (error) {
      setError(getFriendlyApiError(error, "Failed to load debts."));
    }
  }

  useEffect(() => {
    loadDebts();
    // Reload debts when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

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
            <div class="center">${
              getDebtStoreLocation(debt) || "Dunkwa Police Barrier"
            }</div>
            <div class="center">Tel: 0249469080 / 0249995510</div>
            <div class="center">Store: ${getDebtStoreCode(
              debt
            )} - ${getDebtStoreName(debt)}</div>

            <div class="line"></div>

            <h2>Debt Payment Receipt</h2>

            <div class="row">
              <span>Store:</span>
              <span>${getDebtStoreCode(debt)} - ${getDebtStoreName(debt)}</span>
            </div>

            <div class="row">
              <span>Payment ID:</span>
              <span>${payment.id}</span>
            </div>

            <div class="row">
              <span>Sale Receipt:</span>
              <span>${debt.receipt_number || "-"}</span>
            </div>

            <div class="row">
              <span>Customer:</span>
              <span>${debt.customer_name || "-"}</span>
            </div>

            <div class="row">
              <span>Phone:</span>
              <span>${debt.customer_phone || "-"}</span>
            </div>

            <div class="row">
              <span>Date:</span>
              <span>${formatDateTime(payment.paid_at)}</span>
            </div>

            <div class="row">
              <span>Method:</span>
              <span>${formatPaymentMethod(payment.payment_method)}</span>
            </div>

            <div class="row">
              <span>Received By:</span>
              <span>${payment.received_by_name || "-"}</span>
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
              <span>${formatDebtStatus(debt.status)}</span>
            </div>

            ${
              payment.notes
                ? `<div class="line"></div><div><strong>Notes:</strong> ${payment.notes}</div>`
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Debts</h1>
          <p>
            Track credit customers, debt balances and payment history for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>

        <button type="button" onClick={loadDebts}>
          Refresh
        </button>
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
          Debt list, debt payments, payment receipts, SMS reminders and WhatsApp
          reminders are filtered to this selected store only.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

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

      {summary && (
        <div className="cards-grid">
          <div className="stat-card">
            <span>{currentStoreCode} Outstanding Balance</span>
            <strong>{formatMoney(summary.outstanding_balance)}</strong>
          </div>

          <div className="stat-card">
            <span>Unpaid</span>
            <strong>{summary.unpaid_count || 0}</strong>
          </div>

          <div className="stat-card">
            <span>Partial</span>
            <strong>{summary.partial_count || 0}</strong>
          </div>

          <div className="stat-card">
            <span>Overdue</span>
            <strong>{summary.overdue_count || 0}</strong>
          </div>
        </div>
      )}

      {latestReceipt && (
        <div className="section-card">
          <h2>Latest Debt Payment Receipt - {currentStoreCode}</h2>
          <p>
            Payment of{" "}
            <strong>{formatMoney(latestReceipt.payment.amount)}</strong> from{" "}
            <strong>{latestReceipt.debt.customer_name}</strong> recorded
            successfully.
          </p>

          <div className="modal-actions">
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
        </div>
      )}

      <div className="two-column">
        <div className="section-card">
          <h2>Debt List - {currentStoreCode}</h2>

          {detailsLoading && (
            <div className="success-box">Loading details...</div>
          )}

          {debts.length === 0 ? (
            <p>
              No debts found for {currentStoreCode}. Record a credit sale first.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Receipt</th>
                  <th>Owed</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {debts.map((debt) => (
                  <tr key={debt.id}>
                    <td>
                      <strong>{debt.customer_name}</strong>
                      <br />
                      <small>{debt.customer_phone || "-"}</small>
                    </td>

                    <td>{debt.receipt_number || "-"}</td>
                    <td>{formatMoney(debt.amount_owed)}</td>
                    <td>{formatMoney(debt.amount_paid)}</td>
                    <td>{formatMoney(debt.balance)}</td>
                    <td>{formatDebtStatus(debt.status)}</td>
                    <td>{formatDate(debt.due_date)}</td>

                    <td>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <button type="button" onClick={() => viewDebt(debt.id)}>
                          View
                        </button>

                        {String(debt.status || "").toLowerCase() !== "paid" && (
                          <>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form className="section-card" onSubmit={recordPayment}>
          <h2>Record Payment - {currentStoreCode}</h2>

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
          <select
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
          >
            <option value="cash">Cash</option>
            <option value="momo">MoMo</option>
            <option value="bank">Bank</option>
          </select>

          <label>Notes</label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional note about this payment"
          />

          <button type="submit">Save Payment</button>
        </form>
      </div>

      {selectedDebt && (
        <div className="modal-backdrop">
          <div className="receipt-modal">
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
                  <strong>Sale Date:</strong>{" "}
                  {formatDateTime(selectedDebt.sale_date)}
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  marginTop: "14px",
                  marginBottom: "14px",
                }}
              >
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
              </div>

              <h3>Payment History</h3>

              {selectedPayments.length === 0 ? (
                <p>No payment history found for this debt.</p>
              ) : (
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
              )}
            </div>

            <div className="modal-actions">
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