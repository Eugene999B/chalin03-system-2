import { useEffect, useState } from "react";

import axiosClient from "../api/axiosClient";
import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";
import CustomerDebtConsolidationPanel from "../components/CustomerDebtConsolidationPanel";
import { useAuth } from "../context/AuthContext";
import { formatBusinessDate, formatBusinessDateTime } from "../utils/businessDate";
import "../styles/debtDesk.css";

const FILTERS = [
  ["owing", "Customers owing"],
  ["overdue", "Overdue"],
  ["partial", "Partly paid"],
  ["paid", "Paid history"],
  ["all", "All accounts"],
];

const PAYMENT_METHODS = [
  ["cash", "Cash"],
  ["momo", "MoMo"],
  ["bank", "Bank"],
];

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  return value ? formatBusinessDate(value) : "No due date";
}

function dateTimeLabel(value) {
  return value ? formatBusinessDateTime(value) : "—";
}

function paymentMethodLabel(value) {
  return PAYMENT_METHODS.find(([key]) => key === String(value || "").toLowerCase())?.[1] || value || "—";
}

function displayPaymentNote(value) {
  return String(value || "")
    .replace(/^\[DebtDesk:[A-Za-z0-9_-]+\]\s*(?:—\s*)?/, "")
    .trim();
}

function isOverdueDate(value) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date < new Date().toISOString().slice(0, 10);
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function lockedPeriodFromError(error) {
  return error?.response?.data?.code === "AUDIT_PERIOD_LOCKED"
    ? error.response.data.locked_period || null
    : null;
}

function accountMatches(account, term) {
  const query = String(term || "").trim().toLowerCase();
  if (!query) return true;

  return [
    account.customer_name,
    account.customer_phone,
    account.customer_location,
    account.customer_id,
    account.customer_key,
  ]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLowerCase().includes(query));
}

function accountMatchesFilter(account, filter) {
  if (filter === "overdue") return Number(account.overdue_count || 0) > 0;
  if (filter === "partial") return Number(account.partial_debt_count || 0) > 0;
  if (filter === "paid") return Number(account.outstanding_balance || 0) <= 0;
  if (filter === "all") return true;
  return Number(account.outstanding_balance || 0) > 0;
}

function accountTone(account) {
  if (Number(account.outstanding_balance || 0) <= 0) return "paid";
  if (Number(account.overdue_count || 0) > 0) return "overdue";
  if (Number(account.partial_debt_count || 0) > 0) return "partial";
  return "owing";
}

function accountLabel(account) {
  const tone = accountTone(account);
  if (tone === "paid") return "Paid";
  if (tone === "overdue") return "Overdue";
  if (tone === "partial") return "Partly paid";
  return "Owing";
}

function makeRequestKey() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }

  return `debt${Date.now()}${Math.random().toString(36).slice(2, 12)}`;
}

function buildAllocationPreview(debts, amountValue) {
  let remaining = Math.max(Number(amountValue || 0), 0);
  const rows = [];

  for (const debt of debts || []) {
    const balance = Number(debt.balance || 0);
    if (balance <= 0 || remaining <= 0) continue;

    const allocation = Math.min(balance, remaining);
    rows.push({
      debt_id: debt.id,
      receipt_number: debt.receipt_number,
      due_date: debt.due_date,
      previous_balance: balance,
      amount: Number(allocation.toFixed(2)),
      new_balance: Number(Math.max(balance - allocation, 0).toFixed(2)),
    });
    remaining = Number(Math.max(remaining - allocation, 0).toFixed(2));
  }

  return rows;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function DebtsPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
  const storeCode = branchCode || user?.branch_code || "STORE";
  const storeName = branchName || user?.branch_name || "Selected Store";
  const storeLocation = branchLocation || user?.branch_location || "";

  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("owing");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [payFullBalance, setPayFullBalance] = useState(false);
  const [paymentRequestKey, setPaymentRequestKey] = useState(makeRequestKey);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [latestReceipt, setLatestReceipt] = useState(null);

  const [sendingReminder, setSendingReminder] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [lockedPeriod, setLockedPeriod] = useState(null);

  async function loadAccounts({ keepMessages = false } = {}) {
    setLoading(true);
    if (!keepMessages) {
      setError("");
      setMessage("");
    }

    try {
      const response = await axiosClient.get("/debts/customers", {
        params: { include_paid: true },
      });
      setAccounts(response.data.accounts || []);
      setSummary(response.data.summary || {});
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not load the Debt Desk."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
    // The selected branch is the complete Spare Parts debt boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    if (!selected || !window.matchMedia("(max-width: 980px)").matches) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selected]);

  async function openAccount(customerKey, { startPayment = false, fullPayment = false } = {}) {
    setDetailLoading(true);
    setError("");
    setLockedPeriod(null);

    try {
      const response = await axiosClient.get(
        `/debts/customers/${encodeURIComponent(customerKey)}`
      );
      const detail = response.data;
      setSelected(detail);
      setDetailTab("overview");

      if (startPayment) {
        beginPayment(detail, fullPayment);
      }

      return detail;
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not open this customer account."));
      return null;
    } finally {
      setDetailLoading(false);
    }
  }

  function closeAccount() {
    setSelected(null);
    setPaymentOpen(false);
    setPaymentAmount("");
    setPaymentNotes("");
    setPayFullBalance(false);
    setLockedPeriod(null);
  }

  function beginPayment(detail = selected, fullPayment = false) {
    const outstanding = Number(detail?.summary?.outstanding_balance || 0);
    if (!detail || outstanding <= 0) return;

    setPaymentOpen(true);
    setPayFullBalance(fullPayment);
    setPaymentAmount(fullPayment ? outstanding.toFixed(2) : "");
    setPaymentMethod("cash");
    setPaymentNotes("");
    setPaymentRequestKey(makeRequestKey());
    setLockedPeriod(null);
    setError("");
    setMessage("");
  }

  function selectFullPayment() {
    const outstanding = Number(selected?.summary?.outstanding_balance || 0);
    setPayFullBalance(true);
    setPaymentAmount(outstanding.toFixed(2));
  }

  function selectPartialPayment() {
    setPayFullBalance(false);
    setPaymentAmount("");
  }

  const cleanPaymentAmount = Number(paymentAmount || 0);
  const selectedOutstanding = Number(selected?.summary?.outstanding_balance || 0);
  const allocationPreview = buildAllocationPreview(selected?.debts || [], cleanPaymentAmount);
  const previewAllocated = allocationPreview.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );
  const paymentValid =
    cleanPaymentAmount > 0 &&
    cleanPaymentAmount <= selectedOutstanding &&
    Math.abs(previewAllocated - cleanPaymentAmount) < 0.01;

  async function submitCustomerPayment(event) {
    event.preventDefault();
    if (!selected?.customer?.customer_key || !paymentValid) return;

    setPaymentBusy(true);
    setError("");
    setMessage("");
    setLockedPeriod(null);

    try {
      const response = await axiosClient.post(
        `/debts/customers/${encodeURIComponent(
          selected.customer.customer_key
        )}/payments`,
        {
          amount: cleanPaymentAmount,
          pay_full_balance: payFullBalance,
          payment_method: paymentMethod,
          notes: paymentNotes,
          request_key: paymentRequestKey,
        }
      );

      setLatestReceipt(response.data.receipt || null);
      setMessage(response.data.message || "Customer debt payment recorded.");
      setPaymentOpen(false);
      setPaymentAmount("");
      setPaymentNotes("");
      setPayFullBalance(false);
      await loadAccounts({ keepMessages: true });
      await openAccount(selected.customer.customer_key);
    } catch (requestError) {
      const period = lockedPeriodFromError(requestError);
      if (period) setLockedPeriod(period);
      setError(errorMessage(requestError, "Could not record the customer payment."));
    } finally {
      setPaymentBusy(false);
    }
  }

  async function sendSmsReminder() {
    const customerId = selected?.customer?.customer_id;
    if (!customerId) {
      setError("This legacy debt is not linked to a saved customer, so customer SMS is unavailable.");
      return;
    }

    setSendingReminder(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/debt-reminders/customer/${customerId}/sms`
      );
      setMessage(response.data.message || "Debt reminder SMS submitted.");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not send the debt reminder SMS."));
    } finally {
      setSendingReminder(false);
    }
  }

  async function openWhatsAppReminder() {
    const customerId = selected?.customer?.customer_id;
    const phone = String(selected?.customer?.customer_phone || "").replace(/\D/g, "");
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;

    try {
      let recipient = phone;
      let reminderMessage = `Hello ${selected?.customer?.customer_name || "Customer"}, this is a friendly reminder from Chalin 03 Company Limited. Your outstanding balance is ${money(selectedOutstanding)}.`;

      if (customerId) {
        const response = await axiosClient.get(
          `/debt-reminders/customer/${customerId}/message`
        );
        if (!response.data.channels?.whatsapp_enabled) {
          throw new Error("WhatsApp reminders are disabled in Debt Reminder Settings.");
        }
        recipient = String(response.data.recipient_phone || "").replace(/\D/g, "");
        reminderMessage = response.data.message || reminderMessage;
      }

      if (!recipient) throw new Error("This customer does not have a valid phone number.");
      if (recipient.startsWith("0")) recipient = `233${recipient.slice(1)}`;
      if (recipient.length === 9) recipient = `233${recipient}`;

      const url = `https://wa.me/${recipient}?text=${encodeURIComponent(reminderMessage)}`;
      if (popup) popup.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (requestError) {
      if (popup && !popup.closed) popup.close();
      setError(errorMessage(requestError, "Could not prepare the WhatsApp reminder."));
    }
  }

  function printCustomerStatement() {
    if (!selected) return;
    const printWindow = window.open("", "_blank", "width=900,height=800");
    if (!printWindow) {
      setError("Popup blocked. Allow popups and try printing again.");
      return;
    }

    const receiptRows = (selected.debts || [])
      .map(
        (debt) => `<tr>
          <td>${escapeHtml(debt.receipt_number || `Debt #${debt.id}`)}</td>
          <td>${escapeHtml(dateLabel(debt.sale_date || debt.created_at))}</td>
          <td>${escapeHtml(dateLabel(debt.due_date))}</td>
          <td>${money(debt.amount_owed)}</td>
          <td>${money(debt.amount_paid)}</td>
          <td><strong>${money(debt.balance)}</strong></td>
        </tr>`
      )
      .join("");

    const paymentRows = (selected.payments || [])
      .map(
        (payment) => `<tr>
          <td>${escapeHtml(dateTimeLabel(payment.paid_at))}</td>
          <td>${money(payment.amount)}</td>
          <td>${escapeHtml(paymentMethodLabel(payment.payment_method))}</td>
          <td>${escapeHtml(payment.received_by_name || "—")}</td>
          <td>${escapeHtml(displayPaymentNote(payment.notes) || "—")}</td>
        </tr>`
      )
      .join("");

    printWindow.document.write(`<!doctype html>
      <html><head><title>Customer Debt Statement</title><style>
      body{font-family:Arial,sans-serif;color:#14213d;margin:32px;font-size:12px}h1,h2{margin:0 0 8px}header{border-bottom:3px solid #14213d;padding-bottom:18px;margin-bottom:20px}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px;margin:16px 0}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.summary div{border:1px solid #d7deea;padding:12px;border-radius:8px}.summary span{display:block;color:#667085;margin-bottom:5px}.summary strong{font-size:16px}table{width:100%;border-collapse:collapse;margin:12px 0 24px}th,td{border:1px solid #d7deea;padding:8px;text-align:left}th{background:#f3f6fb}.footer{border-top:1px solid #d7deea;padding-top:12px;color:#667085}@media print{body{margin:10mm}}
      </style></head><body>
      <header><h1>Chalin 03 Company Limited</h1><div>${escapeHtml(storeCode)} — ${escapeHtml(storeName)}${storeLocation ? ` — ${escapeHtml(storeLocation)}` : ""}</div><h2>Customer Debt Statement</h2></header>
      <section class="meta"><div><strong>Customer:</strong> ${escapeHtml(selected.customer.customer_name)}</div><div><strong>Phone:</strong> ${escapeHtml(selected.customer.customer_phone || "—")}</div><div><strong>Location:</strong> ${escapeHtml(selected.customer.customer_location || "—")}</div><div><strong>Printed:</strong> ${escapeHtml(dateTimeLabel(new Date()))}</div></section>
      <section class="summary"><div><span>Total credit</span><strong>${money(selected.summary.total_owed)}</strong></div><div><span>Total paid</span><strong>${money(selected.summary.total_paid)}</strong></div><div><span>Outstanding</span><strong>${money(selected.summary.outstanding_balance)}</strong></div></section>
      <h2>Credit receipts</h2><table><thead><tr><th>Receipt</th><th>Sale date</th><th>Due date</th><th>Credit</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${receiptRows || '<tr><td colspan="6">No debt receipts</td></tr>'}</tbody></table>
      <h2>Payment history</h2><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Received by</th><th>Reference / note</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="5">No payments recorded</td></tr>'}</tbody></table>
      <div class="footer">This statement is generated from preserved sale, debt and payment records. It does not replace the original receipts.</div><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  }

  function printPaymentReceipt(receipt = latestReceipt) {
    if (!receipt) return;
    const printWindow = window.open("", "_blank", "width=460,height=760");
    if (!printWindow) {
      setError("Popup blocked. Allow popups and try printing again.");
      return;
    }

    const allocationRows = (receipt.allocations || [])
      .map(
        (allocation) => `<tr><td>${escapeHtml(allocation.receipt_number || `Debt #${allocation.debt_id}`)}</td><td>${money(allocation.amount)}</td><td>${money(allocation.new_balance)}</td></tr>`
      )
      .join("");

    printWindow.document.write(`<!doctype html><html><head><title>Debt Payment Receipt</title><style>
      body{font-family:Arial,sans-serif;color:#111827;margin:0;padding:18px;font-size:12px}.receipt{max-width:360px;margin:auto}h1,h2{text-align:center;margin:0 0 8px}.line{border-top:1px dashed #111827;margin:12px 0}.row{display:flex;justify-content:space-between;gap:12px;margin:7px 0}.row strong:last-child{text-align:right}.total{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px dashed #9ca3af;padding:7px 2px;text-align:left}.footer{text-align:center;margin-top:18px}@media print{body{padding:0}}
      </style></head><body><div class="receipt"><h1>Chalin 03 Company Limited</h1><h2>Customer Debt Payment Receipt</h2><div style="text-align:center">${escapeHtml(storeCode)} — ${escapeHtml(storeName)}</div><div class="line"></div>
      <div class="row"><span>Reference</span><strong>${escapeHtml(receipt.reference)}</strong></div><div class="row"><span>Date</span><strong>${escapeHtml(dateTimeLabel(receipt.paid_at))}</strong></div><div class="row"><span>Customer</span><strong>${escapeHtml(receipt.customer?.customer_name)}</strong></div><div class="row"><span>Phone</span><strong>${escapeHtml(receipt.customer?.customer_phone || "—")}</strong></div><div class="row"><span>Method</span><strong>${escapeHtml(paymentMethodLabel(receipt.payment_method))}</strong></div><div class="line"></div>
      <div class="row total"><span>Amount received</span><strong>${money(receipt.amount)}</strong></div><div class="row"><span>Previous balance</span><strong>${money(receipt.previous_outstanding)}</strong></div><div class="row"><span>New balance</span><strong>${money(receipt.new_outstanding)}</strong></div><div class="line"></div><strong>Allocation</strong><table><thead><tr><th>Receipt</th><th>Paid</th><th>Left</th></tr></thead><tbody>${allocationRows}</tbody></table><div class="footer">Payment applied to the oldest outstanding receipts first.<br/>Thank you for your payment.</div><script>window.onload=()=>window.print()</script></div></body></html>`);
    printWindow.document.close();
  }

  async function paymentFromAdvancedDebt(debt) {
    const key = debt.customer_id ? `customer-${debt.customer_id}` : `legacy-${debt.id}`;
    await openAccount(key, { startPayment: true, fullPayment: false });
  }

  const visibleAccounts = accounts.filter(
    (account) => accountMatches(account, search) && accountMatchesFilter(account, filter)
  );

  return (
    <main className="debt-desk">
      <section className="debt-desk__hero">
        <div className="debt-desk__hero-copy">
          <span className="debt-desk__eyebrow">Spare Parts · {storeCode}</span>
          <h1>Customer Debt Desk</h1>
          <p>
            Find a customer, understand the balance, and record a full or partial payment without hunting through receipt numbers.
          </p>
          <div className="debt-desk__trust-line">
            <span>✓ Existing debts preserved</span>
            <span>✓ Payments append to history</span>
            <span>✓ Current customer names shown</span>
          </div>
        </div>
        <button type="button" className="debt-desk__refresh" onClick={() => loadAccounts()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      <section className="debt-desk__metrics" aria-label="Debt summary">
        <Metric label="Outstanding" value={money(summary.outstanding_balance)} detail={`${Number(summary.customers_owing || 0)} customer(s) owing`} tone="danger" />
        <Metric label="Overdue customers" value={Number(summary.overdue_customers || 0)} detail="Highest follow-up priority" tone="warning" />
        <Metric label="Collected today" value={money(summary.collected_today)} detail="Debt payments received today" tone="success" />
        <Metric label="Collected this month" value={money(summary.collected_this_month)} detail="Month-to-date debt collections" tone="primary" />
      </section>

      {message ? <div className="debt-desk__notice is-success">{message}</div> : null}
      {error ? <div className="debt-desk__notice is-error">{error}</div> : null}

      {lockedPeriod ? (
        <AuditUnlockRequestBox
          lockedPeriod={lockedPeriod}
          requestArea="debt_payment"
          requestedAction="Record customer debt payment inside locked period"
          onRequestSent={() => setMessage("Unlock request sent for management review.")}
        />
      ) : null}

      {latestReceipt ? (
        <section className="debt-desk__receipt-banner">
          <div>
            <span>Payment saved</span>
            <strong>{money(latestReceipt.amount)} received from {latestReceipt.customer?.customer_name}</strong>
            <small>New balance: {money(latestReceipt.new_outstanding)} · {latestReceipt.reference}</small>
          </div>
          <div>
            <button type="button" onClick={() => printPaymentReceipt(latestReceipt)}>Print receipt</button>
            <button type="button" className="is-quiet" onClick={() => setLatestReceipt(null)}>Dismiss</button>
          </div>
        </section>
      ) : null}

      <section className="debt-desk__workspace">
        <div className="debt-desk__accounts">
          <div className="debt-desk__toolbar">
            <label className="debt-desk__search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer name, phone or location"
                aria-label="Search debt customers"
              />
              {search ? <button type="button" onClick={() => setSearch("")}>Clear</button> : null}
            </label>

            <div className="debt-desk__filters" role="tablist" aria-label="Debt filters">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={filter === key ? "is-active" : ""}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="debt-desk__result-heading">
            <div>
              <strong>{visibleAccounts.length} account(s)</strong>
              <span>{storeName}{storeLocation ? ` · ${storeLocation}` : ""}</span>
            </div>
            <small>Payments are automatically applied to the oldest due receipts first, with a preview before confirmation.</small>
          </div>

          {loading ? (
            <div className="debt-desk__empty"><span>Loading customer debts…</span></div>
          ) : visibleAccounts.length === 0 ? (
            <div className="debt-desk__empty">
              <span aria-hidden="true">✓</span>
              <h2>No accounts match this view</h2>
              <p>Change the filter or search, or record a credit sale first.</p>
            </div>
          ) : (
            <div className="debt-desk__account-list">
              {visibleAccounts.map((account) => (
                <AccountCard
                  key={account.customer_key}
                  account={account}
                  onOpen={() => openAccount(account.customer_key)}
                  onPay={() => openAccount(account.customer_key, { startPayment: true, fullPayment: true })}
                />
              ))}
            </div>
          )}
        </div>

        <aside className={`debt-desk__detail ${selected ? "is-open" : ""}`} aria-live="polite">
          {detailLoading ? (
            <div className="debt-desk__detail-placeholder"><p>Loading account…</p></div>
          ) : !selected ? (
            <div className="debt-desk__detail-placeholder">
              <span aria-hidden="true">👤</span>
              <h2>Open a customer account</h2>
              <p>All credit receipts, payments, balances and actions will appear in one simple place.</p>
            </div>
          ) : (
            <>
              <header className="debt-desk__detail-header">
                <button type="button" className="debt-desk__mobile-back" onClick={closeAccount}>← Back</button>
                <div className="debt-desk__identity">
                  <div className="debt-desk__avatar">{String(selected.customer.customer_name || "C").slice(0, 1).toUpperCase()}</div>
                  <div>
                    <span>{selected.customer.legacy_record ? "Legacy debt record" : `Customer #${selected.customer.customer_id}`}</span>
                    <h2>{selected.customer.customer_name}</h2>
                    <p>{selected.customer.customer_phone || "No phone"}{selected.customer.customer_location ? ` · ${selected.customer.customer_location}` : ""}</p>
                  </div>
                </div>
                <button type="button" className="debt-desk__close" onClick={closeAccount} aria-label="Close customer account">×</button>
              </header>

              {selected.customer.legacy_record ? (
                <div className="debt-desk__legacy-note">This older debt is not linked to a saved customer profile. It remains fully visible and payable; no record has been removed.</div>
              ) : null}

              <section className="debt-desk__balance-card">
                <div>
                  <span>Outstanding balance</span>
                  <strong>{money(selected.summary.outstanding_balance)}</strong>
                  <small>{selected.summary.active_debt_count} open receipt(s) · {selected.summary.overdue_debt_count} overdue</small>
                </div>
                {Number(selected.summary.outstanding_balance || 0) > 0 ? (
                  <div className="debt-desk__quick-actions">
                    <button type="button" className="is-primary" onClick={() => beginPayment(selected, true)}>Pay full balance</button>
                    <button type="button" onClick={() => beginPayment(selected, false)}>Record partial payment</button>
                  </div>
                ) : (
                  <span className="debt-desk__paid-stamp">Paid in full</span>
                )}
              </section>

              <div className="debt-desk__secondary-actions">
                <button type="button" onClick={printCustomerStatement}>Print statement</button>
                {Number(selected.summary.outstanding_balance || 0) > 0 ? (
                  <>
                    <button type="button" onClick={sendSmsReminder} disabled={sendingReminder || !selected.customer.customer_id}>{sendingReminder ? "Sending…" : "SMS reminder"}</button>
                    <button type="button" onClick={openWhatsAppReminder}>WhatsApp</button>
                  </>
                ) : null}
              </div>

              {paymentOpen ? (
                <form className="debt-desk__payment" onSubmit={submitCustomerPayment}>
                  <header>
                    <div>
                      <span>Record customer payment</span>
                      <h3>{payFullBalance ? "Pay the complete balance" : "Enter a partial payment"}</h3>
                    </div>
                    <button type="button" onClick={() => setPaymentOpen(false)} aria-label="Close payment form">×</button>
                  </header>

                  <div className="debt-desk__payment-mode">
                    <button type="button" className={payFullBalance ? "is-active" : ""} onClick={selectFullPayment}>Full balance · {money(selectedOutstanding)}</button>
                    <button type="button" className={!payFullBalance ? "is-active" : ""} onClick={selectPartialPayment}>Partial payment</button>
                  </div>

                  <label>
                    <span>Amount received</span>
                    <div className="debt-desk__money-input"><b>GHS</b><input type="number" min="0.01" max={selectedOutstanding} step="0.01" value={paymentAmount} readOnly={payFullBalance} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" autoFocus={!payFullBalance} /></div>
                  </label>

                  <fieldset>
                    <legend>Payment method</legend>
                    <div className="debt-desk__methods">
                      {PAYMENT_METHODS.map(([key, label]) => (
                        <button key={key} type="button" className={paymentMethod === key ? "is-active" : ""} onClick={() => setPaymentMethod(key)}>{label}</button>
                      ))}
                    </div>
                  </fieldset>

                  <label>
                    <span>Reference or note <small>optional</small></span>
                    <textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Example: MoMo reference, cheque number, or collection note" maxLength={500} />
                  </label>

                  <section className="debt-desk__allocation">
                    <header><div><span>Payment allocation preview</span><strong>Oldest due first</strong></div><b>{money(previewAllocated)}</b></header>
                    {allocationPreview.length === 0 ? (
                      <p>Enter an amount to see exactly which receipts will be reduced.</p>
                    ) : (
                      <div>
                        {allocationPreview.map((row) => (
                          <article key={row.debt_id}>
                            <div><strong>{row.receipt_number || `Debt #${row.debt_id}`}</strong><span>Due {dateLabel(row.due_date)}</span></div>
                            <div><span>{money(row.previous_balance)} → {money(row.new_balance)}</span><strong>{money(row.amount)}</strong></div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  {cleanPaymentAmount > selectedOutstanding ? <div className="debt-desk__inline-error">Amount cannot exceed {money(selectedOutstanding)}.</div> : null}

                  <footer>
                    <button type="button" onClick={() => setPaymentOpen(false)}>Cancel</button>
                    <button type="submit" className="is-primary" disabled={!paymentValid || paymentBusy}>{paymentBusy ? "Saving payment…" : `Confirm ${money(cleanPaymentAmount)} payment`}</button>
                  </footer>
                </form>
              ) : null}

              <nav className="debt-desk__tabs" aria-label="Customer debt details">
                {[ ["overview", "Overview"], ["receipts", `Credit receipts (${selected.summary.debt_count})`], ["payments", `Payments (${selected.payments.length})`] ].map(([key, label]) => (
                  <button key={key} type="button" className={detailTab === key ? "is-active" : ""} onClick={() => setDetailTab(key)}>{label}</button>
                ))}
              </nav>

              <section className="debt-desk__tab-content">
                {detailTab === "overview" ? <AccountOverview detail={selected} /> : null}
                {detailTab === "receipts" ? <DebtReceipts debts={selected.debts} /> : null}
                {detailTab === "payments" ? <PaymentHistory payments={selected.payments} /> : null}
              </section>
            </>
          )}
        </aside>
      </section>

      <section className="debt-desk__advanced">
        <button type="button" onClick={() => setShowAdvancedTools((current) => !current)} aria-expanded={showAdvancedTools}>
          <span><strong>Advanced debt tools</strong><small>Duplicate-customer merge, reminder settings and receipt-level audit view</small></span>
          <b>{showAdvancedTools ? "Hide" : "Open"}</b>
        </button>
        {showAdvancedTools ? (
          <CustomerDebtConsolidationPanel
            currentStoreCode={storeCode}
            currentStoreName={storeName}
            userRole={user?.role}
            onRecordPayment={paymentFromAdvancedDebt}
            onRefresh={() => loadAccounts({ keepMessages: true })}
          />
        ) : null}
      </section>
    </main>
  );
}

function Metric({ label, value, detail, tone }) {
  return (
    <article className={`debt-desk__metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AccountCard({ account, onOpen, onPay }) {
  const total = Number(account.total_owed || 0);
  const paid = Number(account.total_paid || 0);
  const progress = total > 0 ? Math.min((paid / total) * 100, 100) : 100;
  const tone = accountTone(account);

  return (
    <article className={`debt-desk__account is-${tone}`}>
      <button type="button" className="debt-desk__account-main" onClick={onOpen}>
        <div className="debt-desk__avatar">{String(account.customer_name || "C").slice(0, 1).toUpperCase()}</div>
        <div className="debt-desk__account-copy">
          <div className="debt-desk__account-title"><strong>{account.customer_name}</strong><span>{accountLabel(account)}</span></div>
          <p>{account.customer_phone || "No phone"}{account.customer_location ? ` · ${account.customer_location}` : ""}</p>
          <div className="debt-desk__progress"><span style={{ width: `${progress}%` }} /></div>
          <small>{account.active_debt_count} open of {account.debt_count} receipt(s) · {money(account.total_paid)} paid</small>
        </div>
        <div className="debt-desk__account-balance"><span>Balance</span><strong>{money(account.outstanding_balance)}</strong><small>{account.overdue_count > 0 ? `${account.overdue_count} overdue` : account.next_due_date ? `Next due ${dateLabel(account.next_due_date)}` : "No overdue receipt"}</small></div>
      </button>
      <footer>
        {account.legacy_record ? <span className="debt-desk__legacy-pill">Legacy record</span> : <span>Customer #{account.customer_id}</span>}
        <div><button type="button" onClick={onOpen}>Open account</button>{Number(account.outstanding_balance || 0) > 0 ? <button type="button" className="is-primary" onClick={onPay}>Pay full</button> : null}</div>
      </footer>
    </article>
  );
}

function AccountOverview({ detail }) {
  const changedCount = (detail.debts || []).filter((debt) => debt.identity_changed).length;
  const nextOpenDebt = (detail.debts || []).find((debt) => Number(debt.balance || 0) > 0);

  return (
    <div className="debt-desk__overview">
      {changedCount > 0 ? (
        <div className="debt-desk__identity-update"><strong>Customer identity is up to date</strong><span>{changedCount} debt record(s) use the current name or phone from the edited sale/customer profile. Original snapshots remain preserved for audit.</span></div>
      ) : null}
      <div className="debt-desk__overview-grid">
        <div><span>Total credit</span><strong>{money(detail.summary.total_owed)}</strong></div>
        <div><span>Total collected</span><strong>{money(detail.summary.total_paid)}</strong></div>
        <div><span>Open receipts</span><strong>{detail.summary.active_debt_count}</strong></div>
        <div><span>Next due</span><strong>{nextOpenDebt ? dateLabel(nextOpenDebt.due_date) : "Nothing due"}</strong></div>
      </div>
      <section className="debt-desk__explanation"><h3>How payment works</h3><p>A full payment clears every open receipt in one transaction. A partial payment is allocated to the oldest due receipt first, then continues to the next receipt. The preview shows the exact result before saving.</p></section>
    </div>
  );
}

function DebtReceipts({ debts = [] }) {
  return (
    <div className="debt-desk__receipt-list">
      {debts.map((debt) => (
        <article key={debt.id} className={Number(debt.balance || 0) <= 0 ? "is-paid" : isOverdueDate(debt.due_date) ? "is-overdue" : ""}>
          <header><div><span>{debt.receipt_number || `Debt #${debt.id}`}</span><strong>{dateLabel(debt.sale_date || debt.created_at)}</strong></div><b>{Number(debt.balance || 0) <= 0 ? "Paid" : debt.status === "partial" ? "Partly paid" : "Owing"}</b></header>
          <div className="debt-desk__receipt-values"><div><span>Credit</span><strong>{money(debt.amount_owed)}</strong></div><div><span>Paid</span><strong>{money(debt.amount_paid)}</strong></div><div><span>Balance</span><strong>{money(debt.balance)}</strong></div><div><span>Due</span><strong>{dateLabel(debt.due_date)}</strong></div></div>
          {debt.items?.length ? <details><summary>Items bought ({debt.items.length})</summary><ul>{debt.items.map((item) => <li key={item.id}><span>{item.product_name} × {item.quantity}</span><strong>{money(item.line_total)}</strong></li>)}</ul></details> : null}
          {debt.identity_changed ? <small className="debt-desk__updated-name">Current customer name/contact is shown; original sale snapshot remains in the audit record.</small> : null}
        </article>
      ))}
    </div>
  );
}

function PaymentHistory({ payments = [] }) {
  if (!payments.length) {
    return <div className="debt-desk__empty is-compact"><p>No debt payments have been recorded for this customer.</p></div>;
  }

  return (
    <div className="debt-desk__payment-history">
      {payments.map((payment) => (
        <article key={payment.id}>
          <div className="debt-desk__payment-icon">↓</div>
          <div><strong>{money(payment.amount)}</strong><span>{dateTimeLabel(payment.paid_at)} · {paymentMethodLabel(payment.payment_method)}</span><small>{payment.received_by_name || "Staff"}{displayPaymentNote(payment.notes) ? ` · ${displayPaymentNote(payment.notes)}` : ""}</small></div>
        </article>
      ))}
    </div>
  );
}
