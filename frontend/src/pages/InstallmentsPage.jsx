import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/installments.css";

function money(value) {
  return Number(value || 0).toFixed(2);
}

function shortDate(value) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-GB");
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function label(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusPill({ value }) {
  const key = String(value || "unknown").toLowerCase();
  return <span className={`installment-status installment-status--${key}`}>{label(key)}</span>;
}

export default function InstallmentsPage() {
  const { user } = useAuth();
  const permissions = new Set(user?.effective_permissions || []);
  const canCollect = permissions.has("installments.collect") || user?.role === "admin";
  const canManage = permissions.has("installments.manage") || user?.role === "admin";
  const canRemind = permissions.has("installments.remind") || user?.role === "admin";
  const canExport = permissions.has("installments.export") || user?.role === "admin";
  const canSettings = permissions.has("installments.settings") || user?.role === "admin";

  const [dashboard, setDashboard] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [payment, setPayment] = useState({
    amount: "",
    payment_method: "cash",
    payment_reference: "",
    notes: "",
    send_sms: true,
  });
  const [settings, setSettings] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadDashboard = useCallback(async () => {
    const response = await axiosClient.get("/installments/dashboard");
    setDashboard(response.data);
  }, []);

  const loadAgreements = useCallback(async () => {
    const response = await axiosClient.get("/installments/agreements", {
      params: {
        search: filters.search || undefined,
        status: filters.status || undefined,
      },
    });
    setAgreements(response.data.agreements || []);
  }, [filters.search, filters.status]);

  const loadSettings = useCallback(async () => {
    const response = await axiosClient.get("/installments/settings");
    const value = response.data.settings || null;
    setSettings(value);
    setSettingsDraft(value);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadDashboard(), loadAgreements(), loadSettings()]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not load the installment-sales workspace."
      );
    } finally {
      setLoading(false);
    }
  }, [loadAgreements, loadDashboard, loadSettings]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function openAgreement(id) {
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.get(`/installments/agreements/${id}`);
      setSelected(response.data);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not load the installment agreement."
      );
    } finally {
      setBusy(false);
    }
  }

  async function decideAgreement(decision) {
    if (!selected?.agreement?.id) return;
    const reason =
      decision === "reject"
        ? window.prompt("Enter the reason for rejecting this installment agreement:")
        : "";
    if (decision === "reject" && !reason) return;

    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/approval`,
        { decision, reason }
      );
      setMessage(response.data.message);
      await Promise.all([
        openAgreement(selected.agreement.id),
        loadDashboard(),
        loadAgreements(),
      ]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not complete the installment approval."
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelAgreement() {
    if (!selected?.agreement?.id) return;
    const reason = window.prompt(
      "Enter the cancellation reason. Only undelivered agreements with no deposit or payment can be cancelled here:"
    );
    if (!reason) return;

    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/cancel`,
        { reason }
      );
      setMessage(response.data.message);
      await Promise.all([
        openAgreement(selected.agreement.id),
        loadDashboard(),
        loadAgreements(),
      ]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not cancel the installment agreement."
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeDefaultStatus(action) {
    if (!selected?.agreement?.id) return;
    const reason = window.prompt(
      action === "mark_defaulted"
        ? "Enter the reason for marking this agreement as defaulted:"
        : "Enter the reason for reactivating this defaulted agreement:"
    );
    if (!reason) return;

    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/default-status`,
        { action, reason }
      );
      setMessage(response.data.message);
      await Promise.all([
        openAgreement(selected.agreement.id),
        loadDashboard(),
        loadAgreements(),
      ]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not update the agreement default status."
      );
    } finally {
      setBusy(false);
    }
  }

  async function rescheduleAgreement() {
    if (!selected?.agreement?.id) return;
    const firstDueDate = window.prompt(
      "Enter the new first due date in YYYY-MM-DD format:",
      selected.agreement.next_due_date || ""
    );
    if (!firstDueDate) return;
    const count = window.prompt(
      "Enter the number of future payments:",
      String(selected.agreement.installment_count || 3)
    );
    if (!count) return;
    const frequency = window.prompt(
      "Enter weekly, fortnightly, monthly or custom:",
      selected.agreement.payment_frequency || "monthly"
    );
    if (!frequency) return;

    let customDueDates = [];
    if (String(frequency).toLowerCase() === "custom") {
      const customDatesText = window.prompt(
        "Enter one YYYY-MM-DD date per future payment, separated by commas:"
      );
      if (!customDatesText) return;
      customDueDates = customDatesText
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (customDueDates.length !== Number(count)) {
        setError("Custom rescheduling requires one date for every future payment.");
        return;
      }
    }

    const reason = window.prompt("Enter the rescheduling reason:");
    if (!reason) return;

    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/reschedule`,
        {
          first_due_date: firstDueDate,
          installment_count: Number(count),
          frequency: String(frequency).toLowerCase(),
          custom_due_dates: customDueDates,
          reason,
        }
      );
      setMessage(response.data.message);
      await Promise.all([
        openAgreement(selected.agreement.id),
        loadDashboard(),
        loadAgreements(),
      ]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not reschedule the installment agreement."
      );
    } finally {
      setBusy(false);
    }
  }

  async function voidPayment(paymentRow) {
    if (!selected?.agreement?.id || !paymentRow?.id) return;
    const reason = window.prompt(
      `Enter the correction reason for voiding ${paymentRow.receipt_number}:`
    );
    if (!reason) return;

    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/payments/${paymentRow.id}/void`,
        { reason }
      );
      setMessage(response.data.message);
      await Promise.all([
        openAgreement(selected.agreement.id),
        loadDashboard(),
        loadAgreements(),
      ]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not correct the installment payment."
      );
    } finally {
      setBusy(false);
    }
  }

  async function waiveCharge(scheduleRow) {
    if (!selected?.agreement?.id || !scheduleRow?.id) return;
    const reason = window.prompt("Enter the approved late-charge waiver reason:");
    if (!reason) return;

    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/schedules/${scheduleRow.id}/waive-charge`,
        { reason }
      );
      setMessage(response.data.message);
      await Promise.all([
        openAgreement(selected.agreement.id),
        loadDashboard(),
        loadAgreements(),
      ]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not waive the installment charge."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!selected?.agreement?.id) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/payments`,
        payment
      );
      setMessage(
        `Payment ${response.data.payment?.receipt_number || ""} recorded successfully.`
      );
      setPayment({
        amount: "",
        payment_method: "cash",
        payment_reference: "",
        notes: "",
        send_sms: true,
      });
      await Promise.all([
        openAgreement(selected.agreement.id),
        loadDashboard(),
        loadAgreements(),
      ]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not record the installment payment."
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendReminder() {
    if (!selected?.agreement?.id) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/reminders`,
        { reminder_type: "manual" }
      );
      setMessage(
        `${response.data.message} Status: ${label(response.data.sms_status)}.`
      );
      await openAgreement(selected.agreement.id);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not submit the installment reminder."
      );
    } finally {
      setBusy(false);
    }
  }

  async function markDelivered() {
    if (!selected?.agreement?.id) return;
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `/installments/agreements/${selected.agreement.id}/deliver`
      );
      setMessage(response.data.message);
      await openAgreement(selected.agreement.id);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not record delivery."
      );
    } finally {
      setBusy(false);
    }
  }

  async function runReminderSync() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post("/installments/reminders/sync");
      const result = response.data.result || {};
      setMessage(
        `Reminder sync checked ${result.checked || 0}, sent ${
          result.sent || 0
        }, failed ${result.failed || 0}, skipped ${result.skipped || 0}.`
      );
      await Promise.all([loadDashboard(), loadAgreements()]);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not run installment reminders."
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!settingsDraft) return;
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.put("/installments/settings", {
        ...settingsDraft,
        default_installment_count: Number(
          settingsDraft.default_installment_count || 3
        ),
        default_grace_days: Number(settingsDraft.default_grace_days || 0),
        reminder_days_before: Number(settingsDraft.reminder_days_before || 0),
        late_charge_value: Number(settingsDraft.late_charge_value || 0),
      });
      setMessage(response.data.message);
      await loadSettings();
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          "Could not save installment settings."
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadFile(url, filename, mimeType) {
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.get(url, { responseType: "blob" });
      const blob = new Blob([response.data], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message || "Could not download the file."
      );
    } finally {
      setBusy(false);
    }
  }

  function downloadWorkbook() {
    return downloadFile(
      "/installments/reports/workbook.xlsx",
      `Chalin03-Installment-Workbook-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  }

  function downloadStatement() {
    if (!selected?.agreement?.id) return;
    return downloadFile(
      `/installments/agreements/${selected.agreement.id}/statement.csv`,
      `${selected.agreement.agreement_number}-statement.csv`,
      "text/csv"
    );
  }

  function downloadAgreementPdf() {
    if (!selected?.agreement?.id) return;
    return downloadFile(
      `/installments/agreements/${selected.agreement.id}/agreement.pdf`,
      `${selected.agreement.agreement_number}-agreement.pdf`,
      "application/pdf"
    );
  }

  function downloadPaymentReceipt(paymentRow) {
    if (!selected?.agreement?.id || !paymentRow?.id) return;
    return downloadFile(
      `/installments/agreements/${selected.agreement.id}/payments/${paymentRow.id}/receipt.pdf`,
      `${paymentRow.receipt_number}.pdf`,
      "application/pdf"
    );
  }

  const summary = dashboard?.summary || {};
  const activeRows = useMemo(
    () =>
      agreements.filter((item) =>
        ["active", "due_soon", "payment_due", "overdue"].includes(
          item.agreement_status
        )
      ),
    [agreements]
  );

  return (
    <main className="installment-page">
      <header className="installment-hero">
        <div>
          <p className="installment-eyebrow">CHALIN 03 SPARE PARTS</p>
          <h1>Professional Installment Sales</h1>
          <p>
            Agreements, scheduled collections, overdue follow-up, receipts,
            delivery evidence and customer reminders in one controlled workspace.
          </p>
        </div>
        <div className="installment-hero-actions">
          <a className="installment-primary-link" href="/new-sale">
            + Create Installment Sale
          </a>
          {canExport ? (
            <button type="button" onClick={downloadWorkbook}>
              Export Workbook
            </button>
          ) : null}
          {canRemind ? (
            <button type="button" onClick={runReminderSync} disabled={busy}>
              Run Due Reminders
            </button>
          ) : null}
          <button type="button" onClick={refresh} disabled={loading || busy}>
            Refresh
          </button>
        </div>
      </header>

      {message ? <div className="installment-message">{message}</div> : null}
      {error ? <div className="installment-error">{error}</div> : null}

      <section className="installment-cards" aria-label="Installment summary">
        {[
          ["Active Agreements", summary.active_count, "Agreements under collection"],
          ["Due Today", summary.due_today_count, "Payments requiring action today"],
          ["Overdue", summary.overdue_count, `GHS ${money(summary.overdue_total)}`],
          ["Outstanding", `GHS ${money(summary.outstanding_total)}`, "Total customer balance"],
          ["Collected", `GHS ${money(summary.collections_total)}`, "Deposits and later payments"],
          ["Completed", summary.completed_count, "Fully settled agreements"],
        ].map(([title, value, detail]) => (
          <article className="installment-card" key={title}>
            <span>{title}</span>
            <strong>{loading ? "…" : value || 0}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      <section className="installment-panel">
        <div className="installment-panel-heading">
          <div>
            <h2>Agreement Register</h2>
            <p>{activeRows.length} active collection account(s) in this store.</p>
          </div>
          <div className="installment-filters">
            <input
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Agreement, customer, phone or receipt"
            />
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value,
                }))
              }
            >
              <option value="">All statuses</option>
              {[
                "active",
                "payment_due",
                "overdue",
                "completed",
                "cancelled",
                "defaulted",
              ].map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </select>
            <button type="button" onClick={loadAgreements}>
              Search
            </button>
          </div>
        </div>

        <div className="installment-table-wrap">
          <table className="installment-table installment-table--agreements">
            <thead>
              <tr>
                <th>Agreement</th>
                <th>Customer</th>
                <th>Schedule</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Next Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agreements.length === 0 ? (
                <tr>
                  <td colSpan="8" className="installment-empty">
                    No installment agreements match the selected filters.
                  </td>
                </tr>
              ) : (
                agreements.map((agreement) => (
                  <tr key={agreement.id}>
                    <td data-label="Agreement">
                      <strong>{agreement.agreement_number}</strong>
                      <small>{agreement.receipt_number}</small>
                    </td>
                    <td data-label="Customer">
                      <strong>{agreement.customer_name}</strong>
                      <small>{agreement.customer_phone}</small>
                    </td>
                    <td data-label="Schedule">
                      {label(agreement.payment_frequency)}
                      <small>{agreement.installment_count} payment(s)</small>
                    </td>
                    <td data-label="Paid">GHS {money(agreement.amount_paid)}</td>
                    <td data-label="Outstanding">
                      <strong>GHS {money(agreement.outstanding_balance)}</strong>
                      {Number(agreement.overdue_amount || 0) > 0 ? (
                        <small className="installment-overdue-text">
                          GHS {money(agreement.overdue_amount)} overdue
                        </small>
                      ) : null}
                    </td>
                    <td data-label="Next Due">{shortDate(agreement.next_due_date)}</td>
                    <td data-label="Status">
                      <StatusPill value={agreement.agreement_status} />
                    </td>
                    <td data-label="Action">
                      <button
                        type="button"
                        className="installment-small-button"
                        onClick={() => openAgreement(agreement.id)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected?.agreement ? (
        <section className="installment-panel installment-detail">
          <div className="installment-panel-heading">
            <div>
              <p className="installment-eyebrow">AGREEMENT DETAIL</p>
              <h2>{selected.agreement.agreement_number}</h2>
              <p>
                {selected.agreement.customer_name} ·{" "}
                {selected.agreement.customer_phone}
              </p>
            </div>
            <div className="installment-hero-actions">
              {canRemind ? (
                <button type="button" onClick={sendReminder} disabled={busy}>
                  Send SMS Reminder
                </button>
              ) : null}
              {canExport ? (
                <>
                  <button type="button" onClick={downloadAgreementPdf}>
                    Agreement PDF
                  </button>
                  <button type="button" onClick={downloadStatement}>
                    Statement CSV
                  </button>
                </>
              ) : null}
              {canManage && selected.agreement.approval_status === "pending" ? (
                <>
                  <button
                    type="button"
                    onClick={() => decideAgreement("approve")}
                    disabled={busy}
                  >
                    Approve Agreement
                  </button>
                  <button
                    type="button"
                    onClick={() => decideAgreement("reject")}
                    disabled={busy}
                  >
                    Reject
                  </button>
                </>
              ) : null}
              {canManage &&
              selected.agreement.delivery_status === "reserved" &&
              Number(selected.agreement.outstanding_balance || 0) <= 0.005 ? (
                <button type="button" onClick={markDelivered} disabled={busy}>
                  Record Delivery
                </button>
              ) : null}
              {canManage &&
              !["pending_approval", "completed", "cancelled", "defaulted"].includes(
                selected.agreement.agreement_status
              ) ? (
                <>
                  <button type="button" onClick={rescheduleAgreement} disabled={busy}>
                    Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => changeDefaultStatus("mark_defaulted")}
                    disabled={busy}
                  >
                    Mark Defaulted
                  </button>
                  {selected.agreement.delivery_status === "reserved" &&
                  Number(selected.agreement.amount_paid || 0) <= 0.005 ? (
                    <button type="button" onClick={cancelAgreement} disabled={busy}>
                      Cancel Agreement
                    </button>
                  ) : null}
                </>
              ) : null}
              {canManage && selected.agreement.agreement_status === "defaulted" ? (
                <button
                  type="button"
                  onClick={() => changeDefaultStatus("reactivate")}
                  disabled={busy}
                >
                  Reactivate Agreement
                </button>
              ) : null}
              <button type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>

          <div className="installment-detail-grid">
            {[
              ["Status", <StatusPill value={selected.agreement.agreement_status} />],
              ["Sale Total", `GHS ${money(selected.agreement.sale_total)}`],
              ["Deposit", `GHS ${money(selected.agreement.deposit_amount)}`],
              ["Amount Paid", `GHS ${money(selected.agreement.amount_paid)}`],
              ["Outstanding", `GHS ${money(selected.agreement.outstanding_balance)}`],
              ["Next Due", shortDate(selected.agreement.next_due_date)],
              ["Delivery", label(selected.agreement.delivery_status)],
              ["Created", dateTime(selected.agreement.created_at)],
            ].map(([title, value]) => (
              <div key={title}>
                <span>{title}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          {canCollect &&
          !["pending_approval", "completed", "cancelled", "defaulted"].includes(
            selected.agreement.agreement_status
          ) ? (
            <form className="installment-payment-form" onSubmit={submitPayment}>
              <h3>Record Payment</h3>
              <label>
                Amount
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={payment.amount}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Payment method
                <select
                  value={payment.payment_method}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      payment_method: event.target.value,
                    }))
                  }
                >
                  {["cash", "momo", "bank", "other"].map((method) => (
                    <option key={method} value={method}>
                      {label(method)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reference
                <input
                  value={payment.payment_reference}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      payment_reference: event.target.value,
                    }))
                  }
                  placeholder="MoMo, bank or receipt reference"
                />
              </label>
              <label>
                Notes
                <input
                  value={payment.notes}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="installment-checkbox-label">
                <input
                  type="checkbox"
                  checked={payment.send_sms !== false}
                  onChange={(event) =>
                    setPayment((current) => ({
                      ...current,
                      send_sms: event.target.checked,
                    }))
                  }
                />
                Send payment receipt SMS
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save Installment Payment"}
              </button>
            </form>
          ) : null}

          <div className="installment-two-column">
            <div>
              <h3>Payment Schedule</h3>
              <div className="installment-table-wrap">
                <table className="installment-table installment-table--schedule">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Due</th>
                      <th>Scheduled</th>
                      <th>Paid</th>
                      <th>Charges</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.schedule || []).map((row) => (
                      <tr key={row.id}>
                        <td data-label="Payment #">{row.sequence_number}</td>
                        <td data-label="Due">{shortDate(row.due_date)}</td>
                        <td data-label="Scheduled">GHS {money(row.scheduled_amount)}</td>
                        <td data-label="Paid">GHS {money(row.amount_paid)}</td>
                        <td data-label="Charges">
                          GHS{" "}
                          {money(
                            Number(row.late_charge_amount || 0) -
                              Number(row.waived_charge_amount || 0)
                          )}
                          {canManage &&
                          Number(row.late_charge_amount || 0) >
                            Number(row.waived_charge_amount || 0) ? (
                            <button
                              type="button"
                              className="installment-small-button"
                              onClick={() => waiveCharge(row)}
                            >
                              Waive
                            </button>
                          ) : null}
                        </td>
                        <td data-label="Status">
                          <StatusPill value={row.schedule_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3>Collection History</h3>
              <div className="installment-history">
                {(selected.payments || []).length === 0 ? (
                  <p>No later installment payments recorded yet.</p>
                ) : (
                  selected.payments.map((row) => (
                    <article key={row.id}>
                      <strong>
                        GHS {money(row.amount)} · {label(row.payment_method)}
                      </strong>
                      <span>{row.receipt_number}</span>
                      <small>
                        {dateTime(row.paid_at)} ·{" "}
                        {row.received_by_name || "System"}
                      </small>
                      <div className="installment-history-actions">
                        <button
                          type="button"
                          className="installment-small-button"
                          onClick={() => downloadPaymentReceipt(row)}
                        >
                          Receipt PDF
                        </button>
                        {canManage && !row.is_voided ? (
                          <button
                            type="button"
                            className="installment-small-button"
                            onClick={() => voidPayment(row)}
                          >
                            Correct / Void
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {canSettings && settingsDraft ? (
        <section className="installment-panel">
          <div className="installment-panel-heading">
            <div>
              <h2>Installment Settings</h2>
              <p>Store defaults for new agreements and reminder controls.</p>
            </div>
          </div>
          <form className="installment-settings-grid" onSubmit={saveSettings}>
            <label>
              Default frequency
              <select
                value={settingsDraft.default_frequency || "monthly"}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    default_frequency: event.target.value,
                  }))
                }
              >
                {["weekly", "fortnightly", "monthly", "custom"].map((item) => (
                  <option value={item} key={item}>
                    {label(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default number of payments
              <input
                type="number"
                min="1"
                max="120"
                value={settingsDraft.default_installment_count || 3}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    default_installment_count: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Grace days
              <input
                type="number"
                min="0"
                max="60"
                value={settingsDraft.default_grace_days || 0}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    default_grace_days: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Reminder days before due
              <input
                type="number"
                min="0"
                max="30"
                value={settingsDraft.reminder_days_before || 3}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    reminder_days_before: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Overdue reminder days
              <input
                value={settingsDraft.overdue_reminder_days || "1,3,7"}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    overdue_reminder_days: event.target.value,
                  }))
                }
                placeholder="1,3,7"
              />
              <small>Comma-separated days after the due date.</small>
            </label>
            <label>
              Default delivery
              <select
                value={settingsDraft.default_delivery_policy || "immediate"}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    default_delivery_policy: event.target.value,
                  }))
                }
              >
                <option value="immediate">Immediate delivery</option>
                <option value="after_full_payment">
                  Deliver after full payment
                </option>
              </select>
            </label>
            <label>
              Late charge type
              <select
                value={settingsDraft.late_charge_type || "none"}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    late_charge_type: event.target.value,
                  }))
                }
              >
                <option value="none">No late charge</option>
                <option value="fixed">Fixed amount</option>
                <option value="percentage">Percentage</option>
              </select>
            </label>
            <label>
              Late charge value
              <input
                type="number"
                min="0"
                step="0.01"
                value={settingsDraft.late_charge_value || 0}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    late_charge_value: event.target.value,
                  }))
                }
              />
            </label>
            <label className="installment-check-row">
              <input
                type="checkbox"
                checked={Boolean(settingsDraft.require_manager_approval)}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    require_manager_approval: event.target.checked,
                  }))
                }
              />
              Require manager approval before collecting a deposit
            </label>
            <label className="installment-check-row">
              <input
                type="checkbox"
                checked={Boolean(settingsDraft.sms_reminders_enabled)}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    sms_reminders_enabled: event.target.checked,
                  }))
                }
              />
              Enable installment reminder eligibility for this store
            </label>
            <button type="submit" disabled={busy}>
              Save Installment Settings
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
