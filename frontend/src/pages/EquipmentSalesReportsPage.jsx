import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";

const API = "/equipment-catalogue/sales";

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

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function EquipmentSalesReportsPage() {
  const { effectivePermissions = [] } = useAuth();
  const canManage = effectivePermissions.includes("fleet.assets.manage");
  const [filters, setFilters] = useState({ date_from: yearStart(), date_to: today() });
  const [report, setReport] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [retirement, setRetirement] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const [reportResponse, agreementResponse, retirementResponse] = await Promise.all([
        axiosClient.get(`${API}/reports/management`, { params: filters }),
        axiosClient.get(`${API}/agreements`),
        axiosClient.get(`${API}/retirement-status`),
      ]);
      setReport(reportResponse.data || null);
      setAgreements(agreementResponse.data?.agreements || []);
      setRetirement(retirementResponse.data || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not load Finance documents and reports."));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function openAgreement(value) {
    setSelectedId(value);
    setDetails(null);
    if (!value) return;
    setBusy(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/agreements/${value}`);
      setDetails(response.data || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not open the agreement file."));
    } finally {
      setBusy(false);
    }
  }

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

  async function runReminders() {
    if (!canManage) return;
    setBusy(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/reminders/run`);
      const result = response.data?.result || {};
      setNotice(
        result.disabled
          ? "SMS is disabled; no reminders were sent."
          : `Reminder check completed: ${result.sent || 0} sent, ${result.failed || 0} failed, ${result.skipped || 0} skipped.`
      );
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not run Finance reminders."));
    } finally {
      setBusy(false);
    }
  }

  const summary = report?.summary || {};
  const selected = useMemo(
    () => agreements.find((agreement) => String(agreement.id) === String(selectedId)),
    [agreements, selectedId]
  );
  const agingTotal = (report?.aging || []).reduce(
    (sum, row) => sum + Number(row.outstanding_amount || 0),
    0
  );

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Company-wide Finance evidence</p>
          <h1>Documents &amp; Reports</h1>
          <span>
            Agreements, receipts, statements, aging and management totals for the whole
            Installment Finance portfolio. No Hire-location selection is required.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Help</Link>
          <button type="button" onClick={() => download(`${API}/reports/export.csv`, `equipment-finance-${today()}.csv`)} disabled={busy}>Export CSV</button>
          {canManage ? <button type="button" onClick={runReminders} disabled={busy}>Run SMS Reminders</button> : null}
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice">{notice}</div> : null}
      {retirement ? <div className="finance-simple__notice is-info">{retirement.retired ? "Spare Parts installment creation is retired; historical records remain protected for audit." : "Historical installment retirement verification is pending."}</div> : null}

      <section className="finance-simple__section">
        <div className="finance-simple__toolbar">
          <div><p className="finance-simple__eyebrow">Report period</p><h2>Management summary</h2></div>
          <div className="finance-simple__actions">
            <label className="finance-simple__field"><span>From</span><input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} /></label>
            <label className="finance-simple__field"><span>To</span><input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} /></label>
            <button type="button" onClick={load} disabled={loading}>Refresh</button>
          </div>
        </div>
      </section>

      {loading ? <div className="finance-simple__empty">Loading company-wide Finance reports…</div> : null}

      {!loading ? (
        <>
          <section className="finance-simple__metrics">
            <article className="finance-simple__metric"><span>Sales value</span><strong>{money(summary.total_sales_value)}</strong></article>
            <article className="finance-simple__metric"><span>Collected</span><strong>{money(summary.collected_amount)}</strong></article>
            <article className="finance-simple__metric"><span>Outstanding</span><strong>{money(summary.outstanding_amount)}</strong></article>
            <article className="finance-simple__metric"><span>Overdue</span><strong>{money(summary.overdue_amount)}</strong></article>
            <article className="finance-simple__metric"><span>Estimated gross profit</span><strong>{money(summary.estimated_gross_profit)}</strong></article>
            <article className="finance-simple__metric"><span>Agreements</span><strong>{Number(summary.agreements || 0)}</strong></article>
          </section>

          <section className="finance-simple__guide-grid">
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Installment aging</p>
              <h3>{money(agingTotal)} outstanding</h3>
              <ul className="finance-simple__guide-list">
                {(report?.aging || []).map((row) => (
                  <li key={row.aging_bucket}>{label(row.aging_bucket)}: {row.agreements} agreement(s) · {money(row.outstanding_amount)}</li>
                ))}
                {!(report?.aging || []).length ? <li>No outstanding installment balances.</li> : null}
              </ul>
            </article>
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Next 30 days</p>
              <h3>Expected collections</h3>
              <ul className="finance-simple__guide-list">
                {(report?.expected_collections || []).map((row) => (
                  <li key={row.due_date}>{dateLabel(row.due_date)}: {row.agreements} agreement(s) · {money(row.expected_amount)}</li>
                ))}
                {!(report?.expected_collections || []).length ? <li>No scheduled collections.</li> : null}
              </ul>
            </article>
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Monthly cash flow</p>
              <h3>Collections</h3>
              <ul className="finance-simple__guide-list">
                {(report?.monthly_collections || []).map((row) => (
                  <li key={row.month_key}>{row.month_label}: {row.payments} payment(s) · {money(row.collected_amount)}</li>
                ))}
                {!(report?.monthly_collections || []).length ? <li>No payments in this period.</li> : null}
              </ul>
            </article>
            <article className="finance-simple__guide-card">
              <p className="finance-simple__eyebrow">Staff performance</p>
              <h3>Sales value</h3>
              <ul className="finance-simple__guide-list">
                {(report?.staff_performance || []).map((row) => (
                  <li key={`${row.staff_name}-${row.agreements}`}>{row.staff_name}: {row.agreements} agreement(s) · {money(row.sales_value)}</li>
                ))}
                {!(report?.staff_performance || []).length ? <li>No staff sales records in this period.</li> : null}
              </ul>
            </article>
          </section>

          <section className="finance-simple__section">
            <div className="finance-simple__section-header">
              <div><p className="finance-simple__eyebrow">Customer account files</p><h2>Professional Documents</h2><span className="finance-simple__muted">Choose one agreement to download its documents and receipts.</span></div>
              <select value={selectedId} onChange={(event) => openAgreement(event.target.value)}>
                <option value="">Choose agreement</option>
                {agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.agreement_number} — {agreement.customer_name} — {agreement.asset_code}</option>)}
              </select>
            </div>

            {busy && selectedId && !details ? <div className="finance-simple__empty">Loading account documents…</div> : null}
            {!selectedId ? <div className="finance-simple__empty">Choose an agreement to open its documents.</div> : null}

            {selected && details ? (
              <>
                <article className="finance-simple__machine">
                  <div className="finance-simple__machine-image">{selected.main_image_url ? <img src={selected.main_image_url} alt={selected.asset_name} /> : <span>🚜</span>}</div>
                  <div className="finance-simple__machine-body"><span className="finance-simple__pill">{selected.agreement_number}</span><h3>{selected.asset_code} — {selected.asset_name}</h3><p>{selected.customer_name} · {selected.customer_phone}</p><div className="finance-simple__facts"><div><span>Agreement</span><strong>{label(selected.agreement_status)}</strong></div><div><span>Balance</span><strong>{money(selected.outstanding_balance)}</strong></div></div></div>
                </article>

                <div className="finance-simple__actions">
                  {selected.quotation_id ? <button type="button" onClick={() => download(`${API}/quotations/${selected.quotation_id}/quotation.pdf`, `${selected.agreement_number}-installment-offer.pdf`)} disabled={busy}>Installment Offer</button> : null}
                  <button type="button" onClick={() => download(`${API}/agreements/${selected.id}/documents/agreement.pdf`, `${selected.agreement_number}-agreement.pdf`)} disabled={busy}>Agreement</button>
                  <button type="button" onClick={() => download(`${API}/agreements/${selected.id}/documents/statement.pdf`, `${selected.agreement_number}-statement.pdf`)} disabled={busy}>Statement</button>
                  {Number(selected.outstanding_balance || 0) > 0 ? <button type="button" onClick={() => download(`${API}/agreements/${selected.id}/documents/overdue.pdf`, `${selected.agreement_number}-overdue-notice.pdf`)} disabled={busy}>Overdue Notice</button> : null}
                  {details.delivery ? <button type="button" onClick={() => download(`${API}/agreements/${selected.id}/documents/delivery.pdf`, `${selected.agreement_number}-delivery-note.pdf`)} disabled={busy}>Delivery Note</button> : null}
                  {(details.ownership_transfers || []).length ? <button type="button" onClick={() => download(`${API}/agreements/${selected.id}/documents/ownership.pdf`, `${selected.agreement_number}-ownership.pdf`)} disabled={busy}>Ownership Certificate</button> : null}
                </div>

                {(details.payments || []).length ? (
                  <section className="finance-simple__section">
                    <p className="finance-simple__eyebrow">Payment receipts</p>
                    <div className="finance-simple__cards">
                      {details.payments.map((payment) => (
                        <article className="finance-simple__card" key={payment.id}>
                          <div className="finance-simple__card-body"><h3>{payment.receipt_number}</h3><p>{dateLabel(payment.payment_date)} · {label(payment.payment_method)}</p><strong className="finance-simple__money">{money(payment.amount)}</strong><button type="button" onClick={() => download(`${API}/payments/${payment.id}/receipt.pdf`, `${payment.receipt_number}.pdf`)} disabled={busy}>Download Receipt</button></div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
