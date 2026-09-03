import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinancePaymentHistory.css";

const API = "/equipment-catalogue/sales/phase6/arrears";
const COMPLETION_API = "/equipment-catalogue/sales/professional/completion-documents";

function money(value) { return `GHS ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function dateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}
function errorMessage(error, fallback) { return error?.response?.data?.message || error?.message || fallback; }
function rowAgreementId(row) { return Number(row?.agreement_id || row?.id || 0); }

export default function EquipmentFinanceArrearsControlPage() {
  const [asOf, setAsOf] = useState("");
  const [search, setSearch] = useState("");
  const [report, setReport] = useState({ rows: [], summary: { overdue_accounts: 0, overdue_installments: 0, overdue_amount: 0, max_days_overdue: 0 } });
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState("");

  async function loadReport(nextAsOf = asOf) {
    setLoading(true); setProblem("");
    try {
      const response = await axiosClient.get(API, { params: nextAsOf ? { as_of: nextAsOf } : undefined });
      setReport(response.data || { rows: [], summary: {} });
    } catch (error) { setProblem(errorMessage(error, "Could not load the official Finance arrears report.")); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadReport(""); }, []);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const source = Array.isArray(report.rows) ? report.rows : [];
    if (!term) return source;
    return source.filter((row) => [row.agreement_number, row.customer_name, row.asset_code, row.sequence_number, row.due_date].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [report.rows, search]);

  async function download(agreementId, documentType, buttonKey) {
    if (!agreementId) { setProblem("This arrears record has no agreement reference, so the official document cannot be issued safely."); return; }
    setWorking(buttonKey); setProblem("");
    try {
      const issue = await axiosClient.post(`${COMPLETION_API}/issue`, { agreement_id: agreementId, document_type: documentType, format: "pdf", payment_id: null, amendment_id: null });
      const document = issue.data?.document;
      if (!document?.id) throw new Error("The official Finance document was not issued. Refresh the arrears report and try again.");
      const file = await axiosClient.get(`${COMPLETION_API}/${document.id}/download`, { params: { format: "pdf" }, responseType: "blob" });
      const contentType = String(file.headers?.["content-type"] || "application/pdf").toLowerCase();
      if (!contentType.includes("pdf")) throw new Error("The Finance document service returned an invalid file format.");
      const url = URL.createObjectURL(file.data);
      const disposition = String(file.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = match?.[1] || `Chalin03-${documentType}-${agreementId}.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setProblem(errorMessage(error, documentType === "arrears_notice" ? "Could not prepare the official arrears notice. Only accounts with genuine overdue installment balance can receive one." : "Could not prepare the Finance customer statement."));
    } finally { setWorking(""); }
  }

  return (
    <main className="finance-payment-history">
      <header className="finance-payment-history__hero">
        <div><p>Collections control</p><h1>Arrears &amp; Follow-up</h1><span>Only genuine overdue installment balances appear here. Official arrears notices and statements are issued from the same controlled Finance document service used by the Document Centre.</span></div>
        <div className="finance-payment-history__hero-actions"><Link to="/equipment-installment-finance/applications?stage=collections">Payments &amp; Collections</Link><Link to="/equipment-installment-finance/applications?stage=payment-history">Payment History</Link></div>
      </header>
      {problem ? <div className="finance-payment-history__alert is-error" role="alert">{problem}</div> : null}
      <section className="finance-payment-history__summary"><article><span>Overdue accounts</span><strong>{Number(report.summary?.overdue_accounts || 0).toLocaleString("en-GH")}</strong><small>Accounts requiring follow-up</small></article><article><span>Overdue installments</span><strong>{Number(report.summary?.overdue_installments || 0).toLocaleString("en-GH")}</strong><small>Open schedule rows past due</small></article><article><span>Overdue amount</span><strong>{money(report.summary?.overdue_amount)}</strong><small>Current overdue schedule balance</small></article><article><span>Oldest overdue</span><strong>{Number(report.summary?.max_days_overdue || 0)} days</strong><small>As of {dateLabel(report.as_of)}</small></article></section>
      <section className="finance-payment-history__filters"><label className="finance-payment-history__filter-search"><span>Search arrears</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Agreement, customer, excavator, due date or installment" autoComplete="off" /></label><label><span>As of</span><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label><button type="button" className="is-reset" onClick={() => { setAsOf(""); setSearch(""); loadReport(""); }}>Reset</button><button type="button" className="is-reset" onClick={() => loadReport(asOf)} disabled={loading}>Refresh</button></section>
      <section className="finance-payment-history__table-card"><header className="finance-payment-history__section-header"><div><p className="finance-payment-history__eyebrow">Controlled arrears records</p><h2>{loading ? "Loading…" : `${rows.length} overdue schedule row(s)`}</h2></div><span>Current accounts do not produce arrears notices.</span></header>{!loading && !rows.length ? <div className="finance-payment-history__empty"><strong>Account book is current</strong><p>No overdue installment schedule balance was returned for the selected date.</p></div> : null}{!loading && rows.length ? <div className="finance-payment-history__table-wrap"><table><thead><tr><th>Agreement</th><th>Customer</th><th>Excavator</th><th>Installment</th><th>Due date</th><th>Days overdue</th><th>Balance</th><th>Documents</th></tr></thead><tbody>{rows.map((row) => { const agreementId = rowAgreementId(row); return <tr key={`${agreementId}-${row.sequence_number}-${row.due_date}`}><td><strong>{row.agreement_number || `Agreement ${agreementId}`}</strong></td><td><strong>{row.customer_name || "Customer not recorded"}</strong></td><td><strong>{row.asset_code || "Equipment"}</strong></td><td>#{row.sequence_number || "—"}</td><td>{dateLabel(row.due_date)}</td><td><strong>{Number(row.days_overdue || 0)} days</strong></td><td className="is-number"><strong>{money(row.balance)}</strong></td><td><div className="finance-payment-history__row-actions"><button type="button" disabled={!agreementId || Number(row.balance || 0) <= 0.01 || Boolean(working)} onClick={() => download(agreementId, "arrears_notice", `${agreementId}:overdue`)}>{working === `${agreementId}:overdue` ? "Preparing…" : "Arrears PDF"}</button><button type="button" disabled={!agreementId || Boolean(working)} onClick={() => download(agreementId, "customer_statement", `${agreementId}:statement`)}>{working === `${agreementId}:statement` ? "Preparing…" : "Statement"}</button></div></td></tr>; })}</tbody></table></div> : null}</section>
    </main>
  );
}
