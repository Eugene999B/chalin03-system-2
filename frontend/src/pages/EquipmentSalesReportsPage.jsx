import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";

const LEGACY_API = "/equipment-catalogue/sales";
const API = `${LEGACY_API}/phase6`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function dateTimeLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function StatusPill({ value }) {
  return <span className="finance-simple__pill">{label(value || "not sent")}</span>;
}

export default function EquipmentSalesReportsPage() {
  const { effectivePermissions = [] } = useAuth();
  const canManage = effectivePermissions.includes("fleet.assets.manage");
  const [filters, setFilters] = useState({ date_from: yearStart(), date_to: today() });
  const [portfolio, setPortfolio] = useState(null);
  const [arrears, setArrears] = useState(null);
  const [cashFlow, setCashFlow] = useState(null);
  const [messages, setMessages] = useState(null);
  const [legacyManagement, setLegacyManagement] = useState(null);
  const [selectedAgreementId, setSelectedAgreementId] = useState("");
  const [statement, setStatement] = useState(null);
  const [legacyDetails, setLegacyDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const results = await Promise.allSettled([
        axiosClient.get(`${API}/portfolio`, { params: filters }),
        axiosClient.get(`${API}/arrears`, { params: { as_of: filters.date_to } }),
        axiosClient.get(`${API}/cash-flow`, { params: filters }),
        axiosClient.get(`${API}/messages`, { params: { limit: 80 } }),
        axiosClient.get(`${LEGACY_API}/reports/management`, { params: filters }),
      ]);
      const requiredFailure = results.slice(0, 4).find((result) => result.status === "rejected");
      if (requiredFailure) throw requiredFailure.reason;
      setPortfolio(results[0].value.data || null);
      setArrears(results[1].value.data || null);
      setCashFlow(results[2].value.data || null);
      setMessages(results[3].value.data?.history || null);
      setLegacyManagement(
        results[4].status === "fulfilled" ? results[4].value.data || null : null
      );
    } catch (error) {
      setProblem(errorMessage(error, "Could not load Equipment Finance Phase 6."));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function download(url, filename) {
    setBusy(true);
    setProblem("");
    try {
      const response = await axiosClient.get(url, { responseType: "blob" });
      const objectUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 2000);
      setNotice(`${filename} downloaded.`);
    } catch (error) {
      setProblem(errorMessage(error, `Could not download ${filename}.`));
    } finally {
      setBusy(false);
    }
  }

  async function openStatement(agreementId) {
    setSelectedAgreementId(agreementId);
    setStatement(null);
    setLegacyDetails(null);
    if (!agreementId) return;
    setBusy(true);
    setProblem("");
    try {
      const [statementResult, legacyResult] = await Promise.allSettled([
        axiosClient.get(`${API}/accounts/${agreementId}/statement`),
        axiosClient.get(`${LEGACY_API}/agreements/${agreementId}`),
      ]);
      if (statementResult.status === "rejected") throw statementResult.reason;
      setStatement(statementResult.value.data?.statement || null);
      setLegacyDetails(
        legacyResult.status === "fulfilled" ? legacyResult.value.data || null : null
      );
    } catch (error) {
      setProblem(errorMessage(error, "Could not open the customer statement."));
    } finally {
      setBusy(false);
    }
  }

  async function syncPaymentSms() {
    if (!canManage) return;
    setBusy(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/messages/sync`, { limit: 100 });
      setNotice(response.data?.message || "Payment receipt SMS synchronization completed.");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not synchronize payment receipt SMS alerts."));
    } finally {
      setBusy(false);
    }
  }

  async function runReminders() {
    if (!canManage) return;
    const confirmed = window.confirm(
      "Send eligible upcoming-payment and overdue reminders now? Duplicate and frequency controls remain active."
    );
    if (!confirmed) return;
    setBusy(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/reminders/run`, {
        confirmation: "RUN INSTALLMENT REMINDERS",
      });
      setNotice(response.data?.message || "Reminder run completed.");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not run Finance reminders."));
    } finally {
      setBusy(false);
    }
  }

  async function resendReceipt(paymentId) {
    if (!canManage) return;
    setBusy(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/payments/${paymentId}/send-receipt`);
      setNotice(response.data?.message || "Customer receipt SMS submitted.");
      await load();
      if (selectedAgreementId) await openStatement(selectedAgreementId);
    } catch (error) {
      setProblem(errorMessage(error, "Could not send the customer payment receipt SMS."));
    } finally {
      setBusy(false);
    }
  }

  const summary = portfolio?.summary || {};
  const legacySummary = legacyManagement?.summary || {};
  const accounts = portfolio?.accounts || [];
  const selectedAccount = useMemo(
    () => accounts.find((account) => String(account.id) === String(selectedAgreementId)),
    [accounts, selectedAgreementId]
  );
  const messageRows = useMemo(() => {
    if (!messages) return [];
    return [
      ...(messages.customer_payment_receipts || []),
      ...(messages.boss_payment_alerts || []),
      ...(messages.reminders || []),
    ]
      .sort(
        (left, right) =>
          new Date(right.created_at || 0).getTime() -
          new Date(left.created_at || 0).getTime()
      )
      .slice(0, 50);
  }, [messages]);

  return (
    <main className="finance-simple" data-testid="phase6-finance-reports">
      <header className="finance-simple__hero">
        <div>
          <p>Equipment Finance Phase 6 — Portfolio, SMS, Reports &amp; Accounting</p>
          <h1>Documents &amp; Reports</h1>
          <span>
            Payment alerts, reminders, statements, portfolio health, arrears, cash flow,
            accounting exports, professional documents and 80 mm thermal receipts.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link
            className="finance-simple__button"
            to="/equipment-installment-finance/applications?stage=settings"
          >
            SMS Settings
          </Link>
          <button type="button" onClick={load} disabled={loading || busy}>Refresh</button>
          {canManage ? (
            <button type="button" onClick={syncPaymentSms} disabled={busy}>Sync Payment SMS</button>
          ) : null}
          {canManage ? (
            <button type="button" onClick={runReminders} disabled={busy}>Run Reminders</button>
          ) : null}
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}

      <section className="finance-simple__section">
        <div className="finance-simple__toolbar">
          <div>
            <p className="finance-simple__eyebrow">Controlled reporting period</p>
            <h2>Filters, Management Report &amp; Accounting Export</h2>
          </div>
          <div className="finance-simple__actions">
            <label className="finance-simple__field">
              <span>From</span>
              <input
                type="date"
                value={filters.date_from}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, date_from: event.target.value }))
                }
              />
            </label>
            <label className="finance-simple__field">
              <span>To</span>
              <input
                type="date"
                value={filters.date_to}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, date_to: event.target.value }))
                }
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                download(
                  `${LEGACY_API}/reports/export.csv?date_from=${filters.date_from}&date_to=${filters.date_to}`,
                  `equipment-finance-management-${filters.date_from}-${filters.date_to}.csv`
                )
              }
            >
              Management CSV
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                download(
                  `${API}/accounting-export.csv?date_from=${filters.date_from}&date_to=${filters.date_to}`,
                  `equipment-finance-accounting-${filters.date_from}-${filters.date_to}.csv`
                )
              }
            >
              Accounting CSV
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                download(
                  `${API}/accounting-export.xlsx?date_from=${filters.date_from}&date_to=${filters.date_to}`,
                  `equipment-finance-accounting-${filters.date_from}-${filters.date_to}.xlsx`
                )
              }
            >
              Accounting Excel
            </button>
          </div>
        </div>
      </section>

      {loading ? <div className="finance-simple__empty">Loading Finance controls…</div> : null}

      {!loading ? (
        <>
          <section className="finance-simple__metrics" data-testid="phase6-portfolio-summary">
            <article className="finance-simple__metric"><span>Portfolio value</span><strong>{money(summary.portfolio_value)}</strong></article>
            <article className="finance-simple__metric"><span>Lifetime collected</span><strong>{money(summary.lifetime_collections)}</strong></article>
            <article className="finance-simple__metric"><span>Period collected</span><strong>{money(summary.period_collections)}</strong></article>
            <article className="finance-simple__metric"><span>Outstanding</span><strong>{money(summary.outstanding_balance)}</strong></article>
            <article className="finance-simple__metric"><span>Overdue</span><strong>{money(summary.overdue_balance)}</strong></article>
            <article className="finance-simple__metric"><span>Active accounts</span><strong>{Number(summary.active_count || 0)}</strong></article>
          </section>
          {Number(summary.reconciliation_attention_count || 0) > 0 ? (
            <div className="finance-simple__alert is-warning" data-testid="portfolio-reconciliation-warning">
              {Number(summary.reconciliation_attention_count || 0)} Finance account(s) have receipt, allocation, schedule or ledger evidence requiring review. Dashboard totals use the evidence-based values and controlled financial actions remain blocked for critical conflicts.
            </div>
          ) : null}

          {legacyManagement ? (
            <section className="finance-simple__section">
              <p className="finance-simple__eyebrow">Existing management report compatibility</p>
              <div className="finance-simple__facts">
                <div><span>Sales value</span><strong>{money(legacySummary.total_sales_value)}</strong></div>
                <div><span>Estimated gross profit</span><strong>{money(legacySummary.estimated_gross_profit)}</strong></div>
                <div><span>Agreements</span><strong>{Number(legacySummary.agreements || 0)}</strong></div>
              </div>
            </section>
          ) : null}

          <section className="finance-simple__guide-grid">
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Account status</p>
              <h3>{Number(summary.agreement_count || 0)} agreements</h3>
              <ul className="finance-simple__guide-list">
                {(portfolio?.statuses || []).map((row) => (
                  <li key={row.agreement_status}>
                    {label(row.agreement_status)}: {row.agreements} · {money(row.outstanding_amount)}
                  </li>
                ))}
                {!(portfolio?.statuses || []).length ? <li>No agreements.</li> : null}
              </ul>
            </article>
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Arrears aging</p>
              <h3>{money(arrears?.summary?.arrears)} in arrears</h3>
              <ul className="finance-simple__guide-list">
                {(portfolio?.aging || []).map((row) => (
                  <li key={row.aging_bucket}>
                    {label(row.aging_bucket)}: {row.agreements} · {money(row.overdue_amount)}
                  </li>
                ))}
                {!(portfolio?.aging || []).length ? <li>No overdue aging balances.</li> : null}
              </ul>
            </article>
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Next 30 days</p>
              <h3>Expected collections</h3>
              <ul className="finance-simple__guide-list">
                {(portfolio?.upcoming || []).slice(0, 8).map((row) => (
                  <li key={String(row.due_date)}>
                    {dateLabel(row.due_date)}: {row.agreements} · {money(row.expected_amount)}
                  </li>
                ))}
                {!(portfolio?.upcoming || []).length ? <li>No upcoming balances.</li> : null}
              </ul>
            </article>
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Payment channels</p>
              <h3>Actual cash flow</h3>
              <ul className="finance-simple__guide-list">
                {(cashFlow?.payment_methods || []).map((row) => (
                  <li key={row.payment_method}>
                    {label(row.payment_method)}: {row.payments} · {money(row.collected_amount)}
                  </li>
                ))}
                {!(cashFlow?.payment_methods || []).length ? <li>No collections in period.</li> : null}
              </ul>
            </article>
          </section>

          <section className="finance-simple__section" data-testid="phase6-arrears-report">
            <div className="finance-simple__section-header">
              <div>
                <p className="finance-simple__eyebrow">Server-calculated schedule balances</p>
                <h2>Arrears Report</h2>
                <span className="finance-simple__muted">
                  {Number(arrears?.summary?.accounts || 0)} overdue accounts as of {dateLabel(arrears?.as_of)}.
                </span>
              </div>
            </div>
            <div className="finance-simple__table-wrap">
              <table className="finance-simple__table">
                <thead>
                  <tr>
                    <th>Agreement / Customer</th>
                    <th>Machine</th>
                    <th>Oldest Due</th>
                    <th>Days</th>
                    <th>Arrears</th>
                    <th>Outstanding</th>
                    <th>Reminder Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {(arrears?.arrears || []).map((row) => (
                    <tr key={row.agreement_id}>
                      <td><strong>{row.agreement_number}</strong><br />{row.customer_name} · {row.customer_phone || "No phone"}</td>
                      <td>{row.asset_code} — {row.asset_name}</td>
                      <td>{dateLabel(row.oldest_due_date)}</td>
                      <td>{row.days_overdue}</td>
                      <td>{money(row.calculated_arrears)}</td>
                      <td>{money(row.outstanding_balance)}</td>
                      <td>{row.successful_reminders} sent<br />{row.last_reminder_at ? dateTimeLabel(row.last_reminder_at) : "No reminder"}</td>
                    </tr>
                  ))}
                  {!(arrears?.arrears || []).length ? (
                    <tr><td colSpan="7">No overdue installment schedule lines.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="finance-simple__section" data-testid="phase6-cash-flow-report">
            <div className="finance-simple__section-header">
              <div>
                <p className="finance-simple__eyebrow">Actual versus scheduled</p>
                <h2>Cash-flow Report</h2>
              </div>
            </div>
            <div className="finance-simple__guide-grid">
              <article className="finance-simple__guide-card">
                <h3>Actual collections</h3>
                <ul className="finance-simple__guide-list">
                  {(cashFlow?.actual || []).map((row) => (
                    <li key={row.month_key}>{row.month_label}: {row.payments} · {money(row.collected_amount)}</li>
                  ))}
                  {!(cashFlow?.actual || []).length ? <li>No actual collections.</li> : null}
                </ul>
              </article>
              <article className="finance-simple__guide-card">
                <h3>Expected schedule</h3>
                <ul className="finance-simple__guide-list">
                  {(cashFlow?.expected || []).map((row) => (
                    <li key={row.month_key}>{row.month_label}: {row.schedule_lines} · {money(row.expected_amount)}</li>
                  ))}
                  {!(cashFlow?.expected || []).length ? <li>No expected schedule balances.</li> : null}
                </ul>
              </article>
            </div>
          </section>

          <section className="finance-simple__section" data-testid="phase6-customer-statement">
            <div className="finance-simple__section-header">
              <div>
                <p className="finance-simple__eyebrow">Official customer ledger and professional documents</p>
                <h2>Customer Statement, Documents &amp; Thermal Receipts</h2>
                <span className="finance-simple__muted">
                  Existing agreement, statement, delivery, ownership and receipt downloads remain available beside Phase 6 documents.
                </span>
              </div>
              <select
                aria-label="Finance agreement"
                value={selectedAgreementId}
                onChange={(event) => openStatement(event.target.value)}
              >
                <option value="">Choose agreement</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.agreement_number} — {account.customer_name} — {account.asset_code}
                  </option>
                ))}
              </select>
            </div>

            {!selectedAgreementId ? <div className="finance-simple__empty">Choose a Finance agreement.</div> : null}
            {busy && selectedAgreementId && !statement ? <div className="finance-simple__empty">Loading official statement…</div> : null}

            {statement?.reconciliation?.consistent === false ? (
              <div className="finance-simple__alert is-warning" data-testid="statement-reconciliation-warning">
                This statement uses the receipt-and-ledger calculation, but the stored account must be reconciled before another official document is issued.
              </div>
            ) : null}

            {statement && selectedAccount ? (
              <>
                <article className="finance-simple__machine">
                  <div className="finance-simple__machine-image"><span>🏦</span></div>
                  <div className="finance-simple__machine-body">
                    <span className="finance-simple__pill">{selectedAccount.agreement_number}</span>
                    <h3>{selectedAccount.asset_code} — {selectedAccount.asset_name}</h3>
                    <p>{selectedAccount.customer_name} · {selectedAccount.customer_phone || "No phone"}</p>
                    <div className="finance-simple__facts">
                      <div><span>Paid</span><strong>{money(selectedAccount.amount_paid)}</strong></div>
                      <div><span>Outstanding</span><strong>{money(selectedAccount.outstanding_balance)}</strong></div>
                      <div><span>Arrears</span><strong>{money(selectedAccount.overdue_amount)}</strong></div>
                    </div>
                  </div>
                </article>
                <div className="finance-simple__actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => download(
                      `${API}/accounts/${selectedAgreementId}/statement.pdf`,
                      `${selectedAccount.agreement_number}-phase6-statement.pdf`
                    )}
                  >
                    Customer Statement PDF
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => download(
                      `${LEGACY_API}/agreements/${selectedAgreementId}/documents/agreement.pdf`,
                      `${selectedAccount.agreement_number}-agreement.pdf`
                    )}
                  >
                    Agreement
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => download(
                      `${LEGACY_API}/agreements/${selectedAgreementId}/documents/statement.pdf`,
                      `${selectedAccount.agreement_number}-statement.pdf`
                    )}
                  >
                    Existing Statement
                  </button>
                  {legacyDetails?.delivery ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => download(
                        `${LEGACY_API}/agreements/${selectedAgreementId}/documents/delivery.pdf`,
                        `${selectedAccount.agreement_number}-delivery-note.pdf`
                      )}
                    >
                      Delivery Note
                    </button>
                  ) : null}
                  {(legacyDetails?.ownership_transfers || []).length ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => download(
                        `${LEGACY_API}/agreements/${selectedAgreementId}/documents/ownership.pdf`,
                        `${selectedAccount.agreement_number}-ownership.pdf`
                      )}
                    >
                      Ownership Certificate
                    </button>
                  ) : null}
                </div>
                <div className="finance-simple__cards">
                  {(statement.payments || []).map((payment) => (
                    <article className="finance-simple__card" key={payment.id}>
                      <div className="finance-simple__card-body">
                        <h3>{payment.receipt_number}</h3>
                        <p>{dateTimeLabel(payment.payment_date)} · {label(payment.payment_method)}</p>
                        <strong className="finance-simple__money">{money(payment.amount)}</strong>
                        <p>Customer SMS <StatusPill value={payment.customer_sms_status} /> Boss SMS <StatusPill value={payment.boss_sms_status} /></p>
                        <div className="finance-simple__actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => download(
                              `${API}/payments/${payment.id}/thermal-receipt.pdf`,
                              `${payment.receipt_number}-thermal.pdf`
                            )}
                          >
                            Thermal Receipt
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => download(
                              `${LEGACY_API}/payments/${payment.id}/receipt.pdf`,
                              `${payment.receipt_number}.pdf`
                            )}
                          >
                            Existing Receipt
                          </button>
                          {canManage ? (
                            <button type="button" disabled={busy} onClick={() => resendReceipt(payment.id)}>
                              Send Receipt SMS
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                  {!(statement.payments || []).length ? <div className="finance-simple__empty">No payments recorded.</div> : null}
                </div>
              </>
            ) : null}
          </section>

          <section className="finance-simple__section" data-testid="phase6-message-history">
            <div className="finance-simple__section-header">
              <div>
                <p className="finance-simple__eyebrow">Notification evidence</p>
                <h2>SMS History</h2>
                <span className="finance-simple__muted">
                  Customer payment receipts, boss alerts, upcoming-payment reminders and overdue reminders.
                </span>
              </div>
            </div>
            <div className="finance-simple__table-wrap">
              <table className="finance-simple__table">
                <thead>
                  <tr><th>Created</th><th>Type</th><th>Agreement / Receipt</th><th>Recipient</th><th>Status</th><th>Message</th><th>Delivery note</th></tr>
                </thead>
                <tbody>
                  {messageRows.map((row) => (
                    <tr key={`${row.message_type}-${row.id}-${row.recipient_type}`}>
                      <td>{dateTimeLabel(row.created_at)}</td>
                      <td>{label(row.message_type)}</td>
                      <td>{row.agreement_number}<br />{row.receipt_number || row.customer_name}</td>
                      <td>{label(row.recipient_type)} · {row.recipient_phone || "No phone"}</td>
                      <td><StatusPill value={row.delivery_status} /></td>
                      <td>{row.message_preview || "Message not available"}</td>
                      <td>{row.last_error || "—"}</td>
                    </tr>
                  ))}
                  {!messageRows.length ? <tr><td colSpan="7">No Finance SMS evidence yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
