import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentSalesReports.css";

const API = "/equipment-catalogue/sales";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString(undefined, {
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
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function apiError(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function percentage(value, total) {
  const cleanTotal = Number(total || 0);
  if (cleanTotal <= 0) return 0;
  return Math.min(100, Math.max(0, (Number(value || 0) / cleanTotal) * 100));
}

export default function EquipmentSalesReportsPage() {
  const { effectivePermissions = [] } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const canManage = effectivePermissions.includes("fleet.assets.manage");
  const [filters, setFilters] = useState({
    date_from: yearStart(),
    date_to: today(),
  });
  const [report, setReport] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [retirement, setRetirement] = useState(null);
  const [selectedAgreementId, setSelectedAgreementId] = useState(null);
  const [agreementDetails, setAgreementDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const locationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId
      ? "All Equipment Sales & Hire locations"
      : "Choose an Equipment Hire location");

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [reportResponse, agreementResponse, retirementResponse] =
        await Promise.all([
          axiosClient.get(`${API}/reports/management`, { params: filters }),
          axiosClient.get(`${API}/agreements`),
          axiosClient.get(`${API}/retirement-status`),
        ]);

      setReport(reportResponse.data || null);
      setAgreements(agreementResponse.data?.agreements || []);
      setRetirement(retirementResponse.data || null);
    } catch (requestError) {
      setError(
        apiError(requestError, "Could not load Equipment Sales reports and documents.")
      );
    } finally {
      setLoading(false);
    }
  }, [filters, selectedContextId]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function selectAgreement(agreementId) {
    setSelectedAgreementId(agreementId);
    setAgreementDetails(null);
    setBusy(true);
    setError("");

    try {
      const response = await axiosClient.get(`${API}/agreements/${agreementId}`);
      setAgreementDetails(response.data || null);
    } catch (requestError) {
      setError(apiError(requestError, "Could not load the agreement documents."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadDocument(url, filename) {
    setBusy(true);
    setError("");

    try {
      const response = await axiosClient.get(url, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 2000);
      setMessage(`${filename} downloaded successfully.`);
    } catch (requestError) {
      setError(apiError(requestError, `Could not download ${filename}.`));
    } finally {
      setBusy(false);
    }
  }

  async function runReminders() {
    if (!canManage) return;
    setBusy(true);
    setError("");

    try {
      const response = await axiosClient.post(`${API}/reminders/run`);
      const result = response.data?.result || {};
      setMessage(
        result.disabled
          ? "SMS is disabled; no reminders were sent."
          : `Reminder check completed: ${result.sent || 0} sent, ${
              result.failed || 0
            } failed, ${result.skipped || 0} skipped.`
      );
      await loadReports();
    } catch (requestError) {
      setError(apiError(requestError, "Could not run Equipment Sales reminders."));
    } finally {
      setBusy(false);
    }
  }

  const summary = report?.summary || {};
  const collectionRate = percentage(
    summary.collected_amount,
    summary.total_sales_value
  );
  const selectedAgreement = useMemo(
    () => agreements.find((agreement) => agreement.id === selectedAgreementId),
    [agreements, selectedAgreementId]
  );
  const agingTotal = useMemo(
    () =>
      (report?.aging || []).reduce(
        (sum, row) => sum + Number(row.outstanding_amount || 0),
        0
      ),
    [report]
  );

  const metrics = [
    ["Sales value", money(summary.total_sales_value), "🏷️"],
    ["Collected", money(summary.collected_amount), "💰"],
    ["Outstanding", money(summary.outstanding_amount), "📌"],
    ["Overdue", money(summary.overdue_amount), "⚠️"],
    ["Estimated profit", money(summary.estimated_gross_profit), "📈"],
    ["Agreements", Number(summary.agreements || 0), "📄"],
  ];

  return (
    <div className="equipment-sales-reports">
      <header className="equipment-sales-reports__hero">
        <div>
          <p>Equipment Sales &amp; Hire</p>
          <h1>Documents &amp; Management Reports</h1>
          <span>
            {locationName}. Collections, aging, profit, expected payments and
            professional customer documents.
          </span>
        </div>
        <div className="equipment-sales-reports__hero-actions">
          <button type="button" onClick={loadReports} disabled={loading || busy}>
            Refresh
          </button>
          <button
            type="button"
            onClick={() =>
              downloadDocument(
                `${API}/reports/export.csv`,
                `equipment-sales-${today()}.csv`
              )
            }
            disabled={busy}
          >
            Export CSV
          </button>
          {canManage ? (
            <button type="button" onClick={runReminders} disabled={busy}>
              Run SMS Reminders
            </button>
          ) : null}
        </div>
      </header>

      {message ? <div className="success-box">{message}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      <section className="equipment-sales-reports__retirement">
        <div>
          <strong>
            {retirement?.retired ? "✓ Spare Parts installments retired" : "Retirement verification pending"}
          </strong>
          <span>
            New installment agreements belong only to Equipment Sales &amp; Hire.
            Historical Spare Parts tables remain protected for audit.
          </span>
        </div>
        <div>
          <small>Historical agreements</small>
          <b>{retirement?.historical_records?.agreements ?? "-"}</b>
        </div>
        <div>
          <small>Historical payments</small>
          <b>{retirement?.historical_records?.payments ?? "-"}</b>
        </div>
      </section>

      <section className="equipment-sales-reports__filters">
        <label>
          From
          <input
            type="date"
            value={filters.date_from}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                date_from: event.target.value,
              }))
            }
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.date_to}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                date_to: event.target.value,
              }))
            }
          />
        </label>
      </section>

      {loading ? (
        <div className="equipment-sales-reports__empty">Loading reports…</div>
      ) : (
        <>
          <section className="equipment-sales-reports__metrics">
            {metrics.map(([metricLabel, value, icon]) => (
              <article key={metricLabel}>
                <span>{icon}</span>
                <div>
                  <small>{metricLabel}</small>
                  <strong>{value}</strong>
                </div>
              </article>
            ))}
          </section>

          <section className="equipment-sales-reports__collection-rate">
            <div>
              <strong>{collectionRate.toFixed(1)}%</strong>
              <span>of recorded sales value collected</span>
            </div>
            <div className="equipment-sales-reports__progress">
              <i style={{ width: `${collectionRate}%` }} />
            </div>
          </section>

          <div className="equipment-sales-reports__grid">
            <section className="equipment-sales-reports__panel">
              <header>
                <div>
                  <p>Receivables</p>
                  <h2>Installment Aging</h2>
                </div>
                <strong>{money(agingTotal)}</strong>
              </header>
              <div className="equipment-sales-reports__aging">
                {(report?.aging || []).length ? (
                  report.aging.map((row) => (
                    <article key={row.aging_bucket}>
                      <div>
                        <strong>{label(row.aging_bucket)}</strong>
                        <span>{row.agreements} agreement(s)</span>
                      </div>
                      <b>{money(row.outstanding_amount)}</b>
                      <div className="equipment-sales-reports__bar">
                        <i
                          style={{
                            width: `${percentage(
                              row.outstanding_amount,
                              agingTotal
                            )}%`,
                          }}
                        />
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="equipment-sales-reports__muted">
                    No outstanding installment balances.
                  </p>
                )}
              </div>
            </section>

            <section className="equipment-sales-reports__panel">
              <header>
                <div>
                  <p>Next 30 days</p>
                  <h2>Expected Collections</h2>
                </div>
              </header>
              <div className="equipment-sales-reports__list">
                {(report?.expected_collections || []).length ? (
                  report.expected_collections.map((row) => (
                    <article key={row.due_date}>
                      <div>
                        <strong>{dateLabel(row.due_date)}</strong>
                        <span>{row.agreements} agreement(s)</span>
                      </div>
                      <b>{money(row.expected_amount)}</b>
                    </article>
                  ))
                ) : (
                  <p className="equipment-sales-reports__muted">
                    No scheduled collections in the next 30 days.
                  </p>
                )}
              </div>
            </section>

            <section className="equipment-sales-reports__panel">
              <header>
                <div>
                  <p>Cash flow</p>
                  <h2>Monthly Collections</h2>
                </div>
              </header>
              <div className="equipment-sales-reports__list">
                {(report?.monthly_collections || []).length ? (
                  report.monthly_collections.map((row) => (
                    <article key={row.month_key}>
                      <div>
                        <strong>{row.month_label}</strong>
                        <span>{row.payments} payment(s)</span>
                      </div>
                      <b>{money(row.collected_amount)}</b>
                    </article>
                  ))
                ) : (
                  <p className="equipment-sales-reports__muted">
                    No payments recorded in this period.
                  </p>
                )}
              </div>
            </section>

            <section className="equipment-sales-reports__panel">
              <header>
                <div>
                  <p>Performance</p>
                  <h2>Sales by Staff</h2>
                </div>
              </header>
              <div className="equipment-sales-reports__list">
                {(report?.staff_performance || []).length ? (
                  report.staff_performance.map((row) => (
                    <article key={`${row.staff_name}-${row.agreements}`}>
                      <div>
                        <strong>{row.staff_name}</strong>
                        <span>{row.agreements} agreement(s)</span>
                      </div>
                      <b>{money(row.sales_value)}</b>
                    </article>
                  ))
                ) : (
                  <p className="equipment-sales-reports__muted">
                    No staff sales records in this period.
                  </p>
                )}
              </div>
            </section>
          </div>

          <section className="equipment-sales-reports__documents">
            <header>
              <div>
                <p>Customer files</p>
                <h2>Professional Documents</h2>
                <span>
                  Select an agreement, then download its quotation, agreement,
                  statement, receipts, delivery note, overdue notice or ownership
                  certificate.
                </span>
              </div>
              <select
                value={selectedAgreementId || ""}
                onChange={(event) =>
                  event.target.value
                    ? selectAgreement(Number(event.target.value))
                    : setSelectedAgreementId(null)
                }
              >
                <option value="">Choose agreement</option>
                {agreements.map((agreement) => (
                  <option key={agreement.id} value={agreement.id}>
                    {agreement.agreement_number} — {agreement.customer_name} — {agreement.asset_code}
                  </option>
                ))}
              </select>
            </header>

            {busy && selectedAgreementId && !agreementDetails ? (
              <div className="equipment-sales-reports__empty">Loading documents…</div>
            ) : null}

            {selectedAgreement && agreementDetails ? (
              <div className="equipment-sales-reports__document-body">
                <article className="equipment-sales-reports__agreement-card">
                  {selectedAgreement.main_image_url ? (
                    <img
                      src={selectedAgreement.main_image_url}
                      alt={selectedAgreement.asset_name}
                    />
                  ) : (
                    <div className="equipment-sales-reports__image-placeholder">🚜</div>
                  )}
                  <div>
                    <small>{selectedAgreement.agreement_number}</small>
                    <h3>{selectedAgreement.asset_code} — {selectedAgreement.asset_name}</h3>
                    <p>{selectedAgreement.customer_name} • {selectedAgreement.customer_phone}</p>
                    <div>
                      <span>{label(selectedAgreement.sale_type)}</span>
                      <span>{label(selectedAgreement.agreement_status)}</span>
                      <span>Balance {money(selectedAgreement.outstanding_balance)}</span>
                    </div>
                  </div>
                </article>

                <div className="equipment-sales-reports__document-actions">
                  {selectedAgreement.quotation_id ? (
                    <button
                      type="button"
                      onClick={() =>
                        downloadDocument(
                          `${API}/quotations/${selectedAgreement.quotation_id}/quotation.pdf`,
                          `${selectedAgreement.agreement_number}-quotation.pdf`
                        )
                      }
                      disabled={busy}
                    >
                      Quotation
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      downloadDocument(
                        `${API}/agreements/${selectedAgreement.id}/documents/agreement.pdf`,
                        `${selectedAgreement.agreement_number}-agreement.pdf`
                      )
                    }
                    disabled={busy}
                  >
                    Agreement
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadDocument(
                        `${API}/agreements/${selectedAgreement.id}/documents/statement.pdf`,
                        `${selectedAgreement.agreement_number}-statement.pdf`
                      )
                    }
                    disabled={busy}
                  >
                    Statement
                  </button>
                  {Number(selectedAgreement.outstanding_balance || 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        downloadDocument(
                          `${API}/agreements/${selectedAgreement.id}/documents/overdue.pdf`,
                          `${selectedAgreement.agreement_number}-overdue-notice.pdf`
                        )
                      }
                      disabled={busy}
                    >
                      Overdue Notice
                    </button>
                  ) : null}
                  {agreementDetails.delivery ? (
                    <button
                      type="button"
                      onClick={() =>
                        downloadDocument(
                          `${API}/agreements/${selectedAgreement.id}/documents/delivery.pdf`,
                          `${selectedAgreement.agreement_number}-delivery-note.pdf`
                        )
                      }
                      disabled={busy}
                    >
                      Delivery Note
                    </button>
                  ) : null}
                  {(agreementDetails.ownership_transfers || []).length ? (
                    <button
                      type="button"
                      onClick={() =>
                        downloadDocument(
                          `${API}/agreements/${selectedAgreement.id}/documents/ownership.pdf`,
                          `${selectedAgreement.agreement_number}-ownership.pdf`
                        )
                      }
                      disabled={busy}
                    >
                      Ownership Certificate
                    </button>
                  ) : null}
                </div>

                {(agreementDetails.payments || []).length ? (
                  <div className="equipment-sales-reports__receipts">
                    <h3>Payment Receipts</h3>
                    {agreementDetails.payments.map((payment) => (
                      <button
                        type="button"
                        key={payment.id}
                        onClick={() =>
                          downloadDocument(
                            `${API}/payments/${payment.id}/receipt.pdf`,
                            `${payment.receipt_number}.pdf`
                          )
                        }
                        disabled={busy}
                      >
                        <span>
                          <strong>{payment.receipt_number}</strong>
                          <small>{dateLabel(payment.payment_date)} • {label(payment.payment_method)}</small>
                        </span>
                        <b>{money(payment.amount)}</b>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : selectedAgreementId ? null : (
              <div className="equipment-sales-reports__empty">
                Choose an agreement to open its documents.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
