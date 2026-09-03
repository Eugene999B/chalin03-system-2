import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePaymentHistory.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";

const API = "/equipment-catalogue/sales/phase6";
const COMPLETION_API = "/equipment-catalogue/sales/professional/completion-documents";
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const METHOD_OPTIONS = [["", "All methods"], ["cash", "Cash"], ["momo", "Mobile money"], ["bank", "Bank transfer"], ["cheque", "Cheque"], ["other", "Other"]];
const CATEGORY_OPTIONS = [["", "All categories"], ["deposit", "Deposit"], ["installment", "Installment"], ["settlement", "Settlement"], ["adjustment", "Adjustment"], ["refund", "Refund"]];
const STATUS_OPTIONS = [["active", "Active only"], ["all", "Active + voided"], ["voided", "Voided only"]];
const SORT_OPTIONS = [
  ["payment_date:desc", "Date — newest first"],
  ["payment_date:asc", "Date — oldest first"],
  ["amount:desc", "Amount — highest first"],
  ["amount:asc", "Amount — lowest first"],
  ["customer_name:asc", "Customer — A to Z"],
  ["customer_name:desc", "Customer — Z to A"],
  ["agreement_number:asc", "Agreement — A to Z"],
  ["agreement_number:desc", "Agreement — Z to A"],
  ["receipt_number:asc", "Receipt — A to Z"],
  ["receipt_number:desc", "Receipt — Z to A"],
];

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function label(value) { return String(value || "Not recorded").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
function dateTimeLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" });
}
function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}
function fileNameFromDisposition(disposition, fallback) {
  const match = String(disposition || "").match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}
function validReceiptPayment(payment) { return payment && !payment.is_voided && Number(payment.amount || 0) > 0 && Number(payment.id) > 0 && Number(payment.agreement_id) > 0; }

export default function EquipmentFinancePaymentHistoryPage() {
  const { effectivePermissions = [], user } = useAuth();
  const role = String(user?.role || user?.workspace_role || user?.access_role || "").trim().toLowerCase();
  const canManage = effectivePermissions.includes("fleet.assets.manage") || ["admin", "administrator", "system_administrator", "super_admin"].includes(role);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentCategory, setPaymentCategory] = useState("");
  const [status, setStatus] = useState("active");
  const [sortBy, setSortBy] = useState("payment_date");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ payments: [], pagination: { page: 1, total: 0, total_pages: 1 }, summary: {} });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const sortValue = `${sortBy}:${sortDir}`;

  useEffect(() => {
    setPage(1);
  }, [search, dateFrom, dateTo, paymentMethod, paymentCategory, status, sortBy, sortDir, pageSize]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setProblem("");
      try {
        const response = await axiosClient.get(`${API}/payment-history`, {
          params: {
            search: search.trim() || undefined,
            date_from: dateFrom || undefined,
            date_to: dateTo || undefined,
            payment_method: paymentMethod || undefined,
            payment_category: paymentCategory || undefined,
            status,
            sort_by: sortBy,
            sort_dir: sortDir,
            page,
            page_size: pageSize,
          },
        });
        if (active) setData(response.data || { payments: [], pagination: { page: 1, total: 0, total_pages: 1 }, summary: {} });
      } catch (error) {
        if (active) setProblem(errorMessage(error, "Could not load Finance payment history."));
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, dateFrom, dateTo, paymentMethod, paymentCategory, status, sortBy, sortDir, page, pageSize]);

  const payments = useMemo(() => Array.isArray(data.payments) ? data.payments : [], [data.payments]);
  const pagination = data.pagination || { page: 1, total: 0, total_pages: 1, has_previous_page: false, has_next_page: false };
  const summary = data.summary || {};

  function resetFilters() {
    setSearch(""); setDateFrom(""); setDateTo(""); setPaymentMethod(""); setPaymentCategory(""); setStatus("active"); setSortBy("payment_date"); setSortDir("desc"); setPage(1);
  }

  async function issueReceipt(payment, format) {
    if (!validReceiptPayment(payment)) {
      setProblem("This payment cannot produce an official receipt because its Finance record is voided or incomplete.");
      return;
    }
    if (!canManage) {
      setProblem("Your Finance role can view payment history but cannot issue official customer receipts.");
      return;
    }
    const key = `${payment.id}:${format}`;
    setWorking(key); setProblem(""); setNotice("");
    try {
      const response = await axiosClient.post(`${COMPLETION_API}/issue`, {
        agreement_id: Number(payment.agreement_id),
        document_type: "payment_receipt",
        format,
        payment_id: Number(payment.id),
        amendment_id: null,
      });
      const issued = response.data?.document;
      if (!issued?.id) throw new Error("The official receipt was not issued. No document ID was returned.");
      const fileResponse = await axiosClient.get(`${COMPLETION_API}/${issued.id}/download`, { params: { format }, responseType: "blob" });
      const url = URL.createObjectURL(fileResponse.data);
      const fallbackName = `Chalin03-payment-receipt-${payment.receipt_number || payment.payment_number || payment.id}.${format === "thermal" ? "pdf" : format}`;
      const fileName = fileNameFromDisposition(fileResponse.headers?.["content-disposition"], fallbackName);
      if (format === "print") {
        const printWindow = window.open(url, "_blank");
        if (!printWindow) throw new Error("The browser blocked the print document. Allow pop-ups and try again.");
        try { printWindow.focus(); } catch {}
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(`Official receipt ${payment.receipt_number || payment.payment_number || ""} prepared for ${dateTimeLabel(payment.payment_date)}.`);
    } catch (error) {
      setProblem(errorMessage(error, "Could not prepare the official payment receipt."));
    } finally { setWorking(""); }
  }

  return (
    <main className="finance-payment-history" data-testid="finance-payment-history">
      <header className="finance-payment-history__hero">
        <div>
          <p>Payments &amp; Receipts</p>
          <h1>Payment History</h1>
          <span>Search every recorded Equipment Installment Finance payment, verify the exact date and receipt, then download or print that payment only.</span>
        </div>
        <div className="finance-payment-history__hero-actions">
          <Link to="/equipment-installment-finance/applications?stage=collections">Record Payment</Link>
          <Link to="/equipment-installment-finance/applications?stage=generated-documents">Generated Documents</Link>
        </div>
      </header>

      {problem ? <div className="finance-payment-history__alert is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-payment-history__alert" role="status">{notice}</div> : null}

      <section className="finance-payment-history__summary" aria-label="Payment history summary">
        <article><span>Payments found</span><strong>{loading ? "…" : Number(summary.total_count || 0).toLocaleString("en-GH")}</strong><small>{status === "active" ? "Active records" : "Current filter"}</small></article>
        <article><span>Collected</span><strong>{money(summary.active_total)}</strong><small>{Number(summary.active_count || 0).toLocaleString("en-GH")} active payments</small></article>
        <article><span>Voided value</span><strong>{money(summary.voided_total)}</strong><small>{Number(summary.voided_count || 0).toLocaleString("en-GH")} voided records</small></article>
        <article><span>Latest payment</span><strong>{dateTimeLabel(summary.latest_payment_date)}</strong><small>Across the selected filters</small></article>
      </section>

      <section className="finance-payment-history__filters" aria-label="Payment history filters">
        <div className="finance-payment-history__filter-search"><label><span>Search payments</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt, payment, agreement, customer, phone, equipment or reference" autoComplete="off" /></label></div>
        <label><span>From</span><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label><span>To</span><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <label><span>Method</span><select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{METHOD_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label><span>Category</span><select value={paymentCategory} onChange={(e) => setPaymentCategory(e.target.value)}>{CATEGORY_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label className="is-sort"><span>Sort</span><select value={sortValue} onChange={(e) => { const [nextBy, nextDir] = e.target.value.split(":"); setSortBy(nextBy); setSortDir(nextDir); }}>{SORT_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <label><span>Rows</span><select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{PAGE_SIZE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="button" className="is-reset" onClick={resetFilters}>Reset</button>
      </section>

      <section className="finance-payment-history__table-card">
        <header className="finance-payment-history__section-header"><div><p className="finance-payment-history__eyebrow">Exact financial records</p><h2>{loading ? "Loading payments…" : `${Number(pagination.total || 0).toLocaleString("en-GH")} payment record(s)`}</h2></div><span>Every receipt action is tied to the selected payment ID.</span></header>
        {loading ? <div className="finance-payment-history__empty">Loading Finance payments…</div> : null}
        {!loading && !payments.length ? <div className="finance-payment-history__empty"><strong>No payments match these filters.</strong><p>Try a wider date range, another status or a broader search.</p></div> : null}
        {!loading && payments.length ? <div className="finance-payment-history__table-wrap"><table><thead><tr><th>Date &amp; time</th><th>Receipt</th><th>Customer / Agreement</th><th>Equipment</th><th>Method</th><th>Reference</th><th>Category</th><th className="is-number">Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>{payments.map((payment) => { const receiptKey = `${payment.id}:pdf`; const printKey = `${payment.id}:print`; return <tr key={payment.id} className={payment.is_voided ? "is-voided" : ""} data-testid="payment-history-record"><td><strong>{dateTimeLabel(payment.payment_date)}</strong></td><td><strong>{payment.receipt_number || payment.payment_number || `PAY-${payment.id}`}</strong><small>{payment.payment_number && payment.payment_number !== payment.receipt_number ? payment.payment_number : "Official receipt"}</small></td><td><strong>{payment.customer_name || "Customer not recorded"}</strong><small>{payment.agreement_number}</small></td><td><strong>{payment.asset_name || "Equipment"}</strong><small>{payment.asset_code || "Code not recorded"}</small></td><td>{label(payment.payment_method)}</td><td>{payment.reference_number || "—"}</td><td>{label(payment.payment_category)}</td><td className="is-number"><strong>{money(payment.amount)}</strong></td><td><span className={`finance-payment-history__status ${payment.is_voided ? "is-voided" : "is-active"}`}>{payment.is_voided ? "Voided" : "Active"}</span></td><td><div className="finance-payment-history__row-actions">{payment.is_voided ? <span className="finance-payment-history__disabled-action">Receipt unavailable</span> : <><button type="button" disabled={!canManage || Boolean(working)} title={!canManage ? "Your role can view payment history but cannot issue official receipts." : "Download official receipt PDF"} onClick={() => issueReceipt(payment, "pdf")}>{working === receiptKey ? "Preparing…" : "PDF"}</button><button type="button" disabled={!canManage || Boolean(working)} title={!canManage ? "Your role can view payment history but cannot issue official receipts." : "Open official receipt for printing"} onClick={() => issueReceipt(payment, "print")}>{working === printKey ? "Preparing…" : "Print"}</button></>}</div></td></tr>; })}</tbody></table></div> : null}
        <footer className="finance-payment-history__pager"><span>Page {pagination.page || 1} of {pagination.total_pages || 1}</span><div><button type="button" disabled={!pagination.has_previous_page || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button type="button" disabled={!pagination.has_next_page || loading} onClick={() => setPage((current) => current + 1)}>Next</button></div></footer>
      </section>
    </main>
  );
}
