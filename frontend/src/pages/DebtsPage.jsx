import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

export default function DebtsPage() {
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

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const businessName = "Chalin 03 Company Limited";
  const momoNumber = "0543421127";

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

  function formatPhoneForWhatsApp(phone) {
    const rawPhone = String(phone || "").trim();

    if (!rawPhone || rawPhone === "-") {
      return "";
    }

    let digits = rawPhone.replace(/\D/g, "");

    // Ghana format: 0240000000 becomes 233240000000
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
      setError(error.response?.data?.message || "Failed to load debts.");
    }
  }

  useEffect(() => {
    loadDebts();
  }, []);

  async function viewDebt(debtId) {
    setMessage("");
    setError("");
    setDetailsLoading(true);

    try {
      const response = await axiosClient.get(`/debts/${debtId}`);

      setSelectedDebt(response.data.debt);
      setSelectedPayments(response.data.payments || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load debt details.");
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
            <div class="center">Dunkwa Police Barrier</div>
            <div class="center">Tel: 0249469080 / 0249995510</div>

            <div class="line"></div>

            <h2>Debt Payment Receipt</h2>

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
      const response = await axiosClient.post(`/debts/${selectedDebtId}/payments`, {
        amount: cleanAmount,
        payment_method: paymentMethod,
        notes,
      });

      setMessage("Debt payment recorded successfully.");
      setLatestReceipt(response.data.receipt || null);

      setSelectedDebtId("");
      setAmount("");
      setNotes("");
      setPaymentMethod("cash");

      await loadDebts();
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to record debt payment."
      );
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Debts</h1>
          <p>Track credit customers, debt balances and payment history</p>
        </div>

        <button type="button" onClick={loadDebts}>
          Refresh
        </button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      {summary && (
        <div className="cards-grid">
          <div className="stat-card">
            <span>Outstanding Balance</span>
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
          <h2>Latest Debt Payment Receipt</h2>
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
          <h2>Debt List</h2>

          {detailsLoading && <div className="success-box">Loading details...</div>}

          {debts.length === 0 ? (
            <p>No debts found. Record a credit sale first.</p>
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
          <h2>Record Payment</h2>

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
                <h2>Debt Details</h2>
                <p>
                  Customer: <strong>{selectedDebt.customer_name}</strong>
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
                  <strong>Status:</strong> {formatDebtStatus(selectedDebt.status)}
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