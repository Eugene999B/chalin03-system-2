import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/hireCommercialControl.css";

const TABS = [
  ["dashboard", "Commercial Desk", "📊", ["hire.commercial.view"]],
  ["rate-cards", "Rate Cards", "💹", ["hire.commercial.view"]],
  ["quotations", "Multi-item Quotes", "🧾", ["hire.commercial.view"]],
  ["contracts", "Contracts & Amendments", "🤝", ["hire.commercial.view"]],
  ["deposits", "Deposits & Refunds", "💰", ["hire.commercial.view"]],
  ["evidence", "Evidence Register", "📎", ["hire.commercial.view"]],
  ["damage", "Damage Settlement", "🛠️", ["hire.commercial.view"]],
];

function localDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86400000);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function localDateTime() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function label(value) {
  return String(value || "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function number(value, digits = 2) {
  return new Intl.NumberFormat("en-GH", { maximumFractionDigits: digits }).format(Number(value || 0));
}

function money(value) {
  return `GHS ${number(value, 2)}`;
}

function dateText(value) {
  if (!value) return "—";
  const text = String(value);
  const parsed = new Date(text.length <= 10 ? `${text}T00:00:00` : text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(text.length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Status({ value }) {
  return <span className={`hcc-status hcc-status--${String(value || "neutral").toLowerCase()}`}>{label(value)}</span>;
}

function Field({ title, children, wide = false }) {
  return <label className={wide ? "hcc-field hcc-field--wide" : "hcc-field"}><span>{title}</span>{children}</label>;
}

function Empty({ title, text }) {
  return <div className="hcc-empty"><span>📭</span><strong>{title}</strong><p>{text}</p></div>;
}

const blankRateCard = {
  asset_type: "",
  asset_id: "",
  charging_method: "hourly",
  standard_rate: "",
  minimum_quantity: "0",
  mobilization_amount: "0",
  demobilization_amount: "0",
  operator_amount: "0",
  fuel_responsibility: "customer",
  effective_from: localDate(),
  effective_to: "",
  notes: "",
};

function blankQuoteItem() {
  return {
    rate_card_id: "",
    asset_type: "",
    preferred_asset_id: "",
    description: "",
    charging_method: "hourly",
    rate: "",
    estimated_quantity: "1",
    minimum_quantity: "0",
    mobilization_amount: "0",
    demobilization_amount: "0",
    operator_amount: "0",
    fuel_responsibility: "customer",
    discount_amount: "0",
    tax_rate_percent: "0",
    notes: "",
  };
}

const blankQuotation = {
  customer_id: "",
  work_location: "",
  requested_start_date: localDate(),
  expected_end_date: localDate(7),
  validity_date: localDate(14),
  terms: "",
  notes: "",
  items: [blankQuoteItem()],
};

const blankAmendment = {
  contract_id: "",
  amendment_type: "extension",
  effective_date: localDate(),
  proposed_end_date: "",
  proposed_rate: "",
  amount_adjustment: "0",
  reason: "",
  terms: "",
};

const blankDeposit = {
  contract_id: "",
  invoice_id: "",
  transaction_type: "receipt",
  transaction_date: localDateTime(),
  amount: "",
  payment_method: "cash",
  reference_number: "",
  reason: "",
};

const blankEvidence = {
  entity_type: "contract",
  entity_id: "",
  evidence_type: "photo",
  file_name: "",
  mime_type: "",
  size_bytes: "",
  storage_reference: "",
  checksum_sha256: "",
  captured_at: localDateTime(),
  notes: "",
};

const blankDamage = {
  return_inspection_id: "",
  assessed_amount: "0",
  customer_liability_amount: "0",
  damage_summary: "",
  assessment_notes: "",
};

const blankSettlement = {
  assessment_id: "",
  settlement_method: "deposit_deduction",
  deposit_applied_amount: "0",
  invoiced_amount: "0",
  waived_amount: "0",
  settled_amount: "0",
  settlement_notes: "",
};

function SummaryCard({ title, value, note }) {
  return <article className="hcc-summary-card"><span>{title}</span><strong>{value}</strong><small>{note}</small></article>;
}

export default function HireCommercialControlPage() {
  const { hasPermission, hasAnyPermission } = useAuth();
  const { selectedContextId, options, loading: contextLoading } = useWorkspaceContext();
  const selectedLocation = options.find((option) => Number(option.id) === Number(selectedContextId));
  const visibleTabs = useMemo(() => TABS.filter(([, , , permissions]) => hasAnyPermission(permissions)), [hasAnyPermission]);

  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState({ summary: {}, pending_approvals: [] });
  const [rateCards, setRateCards] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [damage, setDamage] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [assets, setAssets] = useState([]);
  const [returns, setReturns] = useState([]);
  const [rateCardForm, setRateCardForm] = useState(blankRateCard);
  const [quotationForm, setQuotationForm] = useState(blankQuotation);
  const [amendmentForm, setAmendmentForm] = useState(blankAmendment);
  const [depositForm, setDepositForm] = useState(blankDeposit);
  const [evidenceForm, setEvidenceForm] = useState(blankEvidence);
  const [damageForm, setDamageForm] = useState(blankDamage);
  const [settlementForm, setSettlementForm] = useState(blankSettlement);

  const canManage = hasPermission("hire.commercial.manage");
  const canApprove = hasPermission("hire.commercial.approve");
  const canEvidence = hasPermission("hire.commercial.evidence");
  const canDamage = hasPermission("hire.commercial.damage");

  const refresh = useCallback(async () => {
    if (!selectedContextId) return;
    setLoading(true);
    setError("");
    try {
      const requests = [
        axiosClient.get("/hire-commercial/dashboard"),
        axiosClient.get("/hire-commercial/rate-cards"),
        axiosClient.get("/hire-commercial/quotations"),
        axiosClient.get("/hire-commercial/contracts"),
        axiosClient.get("/hire-commercial/deposits"),
        axiosClient.get("/hire-commercial/evidence"),
        axiosClient.get("/hire-commercial/damage-assessments"),
        axiosClient.get("/equipment-hire/customers"),
        axiosClient.get(`/equipment-hire/availability?from=${localDate()}&to=${localDate(60)}`),
        axiosClient.get("/equipment-hire/returns"),
      ];
      const [dash, rates, quotes, contractResponse, depositResponse, evidenceResponse, damageResponse, customerResponse, assetResponse, returnResponse] = await Promise.all(requests);
      setDashboard(dash.data || {});
      setRateCards(rates.data?.rate_cards || []);
      setQuotations(quotes.data?.quotations || []);
      setContracts(contractResponse.data?.contracts || []);
      setDeposits(depositResponse.data?.deposit_transactions || []);
      setEvidence(evidenceResponse.data?.evidence || []);
      setDamage(damageResponse.data?.damage_assessments || []);
      setCustomers(customerResponse.data?.customers || []);
      setAssets(assetResponse.data?.assets || []);
      setReturns(returnResponse.data?.returns || []);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not load Equipment Hire Commercial Control."));
    } finally {
      setLoading(false);
    }
  }, [selectedContextId]);

  useEffect(() => { refresh(); }, [refresh]);

  function notify(text) {
    setMessage(text);
    setError("");
    window.setTimeout(() => setMessage(""), 5000);
  }

  async function run(action, successText) {
    setSaving(true);
    setError("");
    try {
      const response = await action();
      notify(response?.data?.message || successText);
      await refresh();
      return response;
    } catch (requestError) {
      setError(apiMessage(requestError, "The commercial operation could not be completed."));
      return null;
    } finally {
      setSaving(false);
    }
  }

  function updateQuoteItem(index, field, value) {
    setQuotationForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
  }

  function applyRateCard(index, rateCardId) {
    const rate = rateCards.find((row) => Number(row.id) === Number(rateCardId));
    if (!rate) return updateQuoteItem(index, "rate_card_id", rateCardId);
    setQuotationForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        rate_card_id: rateCardId,
        asset_type: rate.asset_type,
        preferred_asset_id: rate.asset_id || "",
        description: `${rate.asset_type} hire`,
        charging_method: rate.charging_method,
        rate: rate.standard_rate,
        minimum_quantity: rate.minimum_quantity,
        mobilization_amount: rate.mobilization_amount,
        demobilization_amount: rate.demobilization_amount,
        operator_amount: rate.operator_amount,
        fuel_responsibility: rate.fuel_responsibility,
      } : item),
    }));
  }

  async function downloadPdf(type, id, numberValue) {
    setError("");
    try {
      const response = await axiosClient.get(`/hire-commercial/documents/${type}/${id}.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${numberValue || `${type}-${id}`}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not download the commercial PDF."));
    }
  }

  if (contextLoading) return <div className="hcc-loading">Loading Equipment Hire location…</div>;
  if (!selectedContextId) return <div className="hcc-empty hcc-empty--large"><span>📍</span><strong>Choose a Hire location</strong><p>Select an administrator-created Equipment Hire base or yard before opening Commercial Control.</p></div>;

  const summary = dashboard.summary || {};

  return (
    <div className="hcc-page">
      <header className="hcc-hero">
        <div><small>Release 3C · Equipment Hire</small><h1>Commercial Control Centre</h1><p>Multi-equipment quotations, controlled rates, contract amendments, deposits, evidence and damage settlement for <strong>{selectedLocation?.name || "selected location"}</strong>.</p></div>
        <button type="button" onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </header>

      {message ? <div className="hcc-alert hcc-alert--success">✅ {message}</div> : null}
      {error ? <div className="hcc-alert hcc-alert--error">⚠️ {error}</div> : null}

      <nav className="hcc-tabs" aria-label="Commercial Control sections">
        {visibleTabs.map(([code, title, icon]) => <button key={code} type="button" className={tab === code ? "active" : ""} onClick={() => setTab(code)}><span>{icon}</span>{title}</button>)}
      </nav>

      {tab === "dashboard" ? (
        <section className="hcc-stack">
          <div className="hcc-summary-grid">
            <SummaryCard title="Approved rate cards" value={number(summary.active_rate_cards, 0)} note="Current controlled rates" />
            <SummaryCard title="Open quotations" value={number(summary.open_quotes, 0)} note="Draft or approval queue" />
            <SummaryCard title="Pending approvals" value={number(summary.pending_approvals, 0)} note="Independent decision required" />
            <SummaryCard title="Pending amendments" value={number(summary.pending_amendments, 0)} note="Contract changes awaiting approval" />
            <SummaryCard title="Outstanding invoices" value={money(summary.outstanding_invoices)} note="Unpaid Hire balances" />
            <SummaryCard title="Deposit balance" value={money(summary.deposit_balance)} note="Approved deposit ledger" />
            <SummaryCard title="Open damage cases" value={number(summary.open_damage_cases, 0)} note="Not fully settled" />
          </div>
          <section className="hcc-panel"><div className="hcc-panel-head"><div><small>Independent control</small><h2>Pending commercial approvals</h2></div></div>
            {!dashboard.pending_approvals?.length ? <Empty title="No pending approvals" text="Discount, credit, amendment, refund and damage approvals will appear here." /> : (
              <div className="hcc-table-wrap"><table><thead><tr><th>Number</th><th>Type</th><th>Customer</th><th>Amount</th><th>Reason</th><th>Requested by</th></tr></thead><tbody>{dashboard.pending_approvals.map((row) => <tr key={row.id}><td>{row.approval_number}</td><td><Status value={row.approval_type} /></td><td>{row.customer_name || "—"}</td><td>{money(row.requested_amount)}</td><td>{row.reason}</td><td>{row.requested_by_username || "—"}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </section>
      ) : null}

      {tab === "rate-cards" ? (
        <section className="hcc-stack">
          {canManage ? <form className="hcc-panel" onSubmit={(event) => { event.preventDefault(); run(() => axiosClient.post("/hire-commercial/rate-cards", rateCardForm), "Rate card saved.").then((response) => response && setRateCardForm(blankRateCard)); }}>
            <div className="hcc-panel-head"><div><small>Controlled pricing</small><h2>Create rate card</h2><p>Draft cards require approval from another authorized user.</p></div></div>
            <div className="hcc-form-grid">
              <Field title="Asset type"><input required value={rateCardForm.asset_type} onChange={(event) => setRateCardForm({ ...rateCardForm, asset_type: event.target.value })} /></Field>
              <Field title="Specific fleet asset"><select value={rateCardForm.asset_id} onChange={(event) => setRateCardForm({ ...rateCardForm, asset_id: event.target.value })}><option value="">Any matching asset</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.asset_name}</option>)}</select></Field>
              <Field title="Charging method"><select value={rateCardForm.charging_method} onChange={(event) => setRateCardForm({ ...rateCardForm, charging_method: event.target.value })}>{["hourly", "daily", "shift", "weekly", "monthly", "fixed"].map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field title="Standard rate"><input required type="number" min="0.01" step="0.01" value={rateCardForm.standard_rate} onChange={(event) => setRateCardForm({ ...rateCardForm, standard_rate: event.target.value })} /></Field>
              <Field title="Minimum quantity"><input type="number" min="0" step="0.01" value={rateCardForm.minimum_quantity} onChange={(event) => setRateCardForm({ ...rateCardForm, minimum_quantity: event.target.value })} /></Field>
              <Field title="Mobilization"><input type="number" min="0" step="0.01" value={rateCardForm.mobilization_amount} onChange={(event) => setRateCardForm({ ...rateCardForm, mobilization_amount: event.target.value })} /></Field>
              <Field title="Demobilization"><input type="number" min="0" step="0.01" value={rateCardForm.demobilization_amount} onChange={(event) => setRateCardForm({ ...rateCardForm, demobilization_amount: event.target.value })} /></Field>
              <Field title="Operator amount"><input type="number" min="0" step="0.01" value={rateCardForm.operator_amount} onChange={(event) => setRateCardForm({ ...rateCardForm, operator_amount: event.target.value })} /></Field>
              <Field title="Fuel responsibility"><select value={rateCardForm.fuel_responsibility} onChange={(event) => setRateCardForm({ ...rateCardForm, fuel_responsibility: event.target.value })}><option value="customer">Customer</option><option value="owner">Owner</option><option value="mixed">Mixed</option></select></Field>
              <Field title="Effective from"><input type="date" required value={rateCardForm.effective_from} onChange={(event) => setRateCardForm({ ...rateCardForm, effective_from: event.target.value })} /></Field>
              <Field title="Effective to"><input type="date" value={rateCardForm.effective_to} onChange={(event) => setRateCardForm({ ...rateCardForm, effective_to: event.target.value })} /></Field>
              <Field title="Notes" wide><textarea value={rateCardForm.notes} onChange={(event) => setRateCardForm({ ...rateCardForm, notes: event.target.value })} /></Field>
            </div><div className="hcc-actions"><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save Draft Rate Card"}</button></div>
          </form> : null}
          <section className="hcc-panel"><div className="hcc-panel-head"><div><small>Pricing register</small><h2>Rate cards</h2></div></div>
            {!rateCards.length ? <Empty title="No rate cards" text="Create the first controlled rate card for this Hire location." /> : <div className="hcc-table-wrap"><table><thead><tr><th>Number</th><th>Equipment</th><th>Method</th><th>Rate</th><th>Effective</th><th>Status</th><th>Action</th></tr></thead><tbody>{rateCards.map((row) => <tr key={row.id}><td>{row.rate_card_number}</td><td>{row.asset_code ? `${row.asset_code} — ${row.asset_name}` : row.asset_type}</td><td>{label(row.charging_method)}</td><td>{money(row.standard_rate)}</td><td>{dateText(row.effective_from)}{row.effective_to ? ` – ${dateText(row.effective_to)}` : ""}</td><td><Status value={row.status} /></td><td>{canApprove && row.status === "draft" ? <button className="small" disabled={saving} onClick={() => run(() => axiosClient.patch(`/hire-commercial/rate-cards/${row.id}/approve`), "Rate card approved.")}>Approve</button> : "—"}</td></tr>)}</tbody></table></div>}
          </section>
        </section>
      ) : null}

      {tab === "quotations" ? (
        <section className="hcc-stack">
          {canManage ? <form className="hcc-panel" onSubmit={(event) => { event.preventDefault(); run(() => axiosClient.post("/hire-commercial/quotations", quotationForm), "Quotation saved.").then((response) => response && setQuotationForm(blankQuotation)); }}>
            <div className="hcc-panel-head"><div><small>Multi-equipment commercial offer</small><h2>Create quotation</h2><p>Discount and customer-credit exceptions are automatically routed for approval.</p></div></div>
            <div className="hcc-form-grid">
              <Field title="Customer"><select required value={quotationForm.customer_id} onChange={(event) => setQuotationForm({ ...quotationForm, customer_id: event.target.value })}><option value="">Choose customer</option>{customers.filter((row) => Number(row.is_active) !== 0).map((row) => <option key={row.id} value={row.id}>{row.customer_code} — {row.customer_name}</option>)}</select></Field>
              <Field title="Work location"><input required value={quotationForm.work_location} onChange={(event) => setQuotationForm({ ...quotationForm, work_location: event.target.value })} /></Field>
              <Field title="Requested start"><input type="date" value={quotationForm.requested_start_date} onChange={(event) => setQuotationForm({ ...quotationForm, requested_start_date: event.target.value })} /></Field>
              <Field title="Expected end"><input type="date" value={quotationForm.expected_end_date} onChange={(event) => setQuotationForm({ ...quotationForm, expected_end_date: event.target.value })} /></Field>
              <Field title="Validity date"><input type="date" value={quotationForm.validity_date} onChange={(event) => setQuotationForm({ ...quotationForm, validity_date: event.target.value })} /></Field>
              <Field title="Terms" wide><textarea value={quotationForm.terms} onChange={(event) => setQuotationForm({ ...quotationForm, terms: event.target.value })} /></Field>
            </div>
            <div className="hcc-line-stack">{quotationForm.items.map((item, index) => <article className="hcc-line-card" key={index}><div className="hcc-line-head"><strong>Equipment line {index + 1}</strong>{quotationForm.items.length > 1 ? <button type="button" onClick={() => setQuotationForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button> : null}</div><div className="hcc-form-grid">
              <Field title="Approved rate card"><select value={item.rate_card_id} onChange={(event) => applyRateCard(index, event.target.value)}><option value="">Manual line</option>{rateCards.filter((row) => row.status === "approved").map((row) => <option key={row.id} value={row.id}>{row.rate_card_number} — {row.asset_type} — {money(row.standard_rate)}</option>)}</select></Field>
              <Field title="Asset type"><input required value={item.asset_type} onChange={(event) => updateQuoteItem(index, "asset_type", event.target.value)} /></Field>
              <Field title="Preferred asset"><select value={item.preferred_asset_id} onChange={(event) => updateQuoteItem(index, "preferred_asset_id", event.target.value)}><option value="">No specific asset</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.asset_name} ({label(asset.availability_status)})</option>)}</select></Field>
              <Field title="Description"><input required value={item.description} onChange={(event) => updateQuoteItem(index, "description", event.target.value)} /></Field>
              <Field title="Method"><select value={item.charging_method} onChange={(event) => updateQuoteItem(index, "charging_method", event.target.value)}>{["hourly", "daily", "shift", "weekly", "monthly", "fixed"].map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field title="Rate"><input required type="number" min="0" step="0.01" value={item.rate} onChange={(event) => updateQuoteItem(index, "rate", event.target.value)} /></Field>
              <Field title="Estimated quantity"><input type="number" min="0" step="0.01" value={item.estimated_quantity} onChange={(event) => updateQuoteItem(index, "estimated_quantity", event.target.value)} /></Field>
              <Field title="Minimum quantity"><input type="number" min="0" step="0.01" value={item.minimum_quantity} onChange={(event) => updateQuoteItem(index, "minimum_quantity", event.target.value)} /></Field>
              <Field title="Mobilization"><input type="number" min="0" step="0.01" value={item.mobilization_amount} onChange={(event) => updateQuoteItem(index, "mobilization_amount", event.target.value)} /></Field>
              <Field title="Demobilization"><input type="number" min="0" step="0.01" value={item.demobilization_amount} onChange={(event) => updateQuoteItem(index, "demobilization_amount", event.target.value)} /></Field>
              <Field title="Operator"><input type="number" min="0" step="0.01" value={item.operator_amount} onChange={(event) => updateQuoteItem(index, "operator_amount", event.target.value)} /></Field>
              <Field title="Discount"><input type="number" min="0" step="0.01" value={item.discount_amount} onChange={(event) => updateQuoteItem(index, "discount_amount", event.target.value)} /></Field>
              <Field title="Tax %"><input type="number" min="0" max="100" step="0.01" value={item.tax_rate_percent} onChange={(event) => updateQuoteItem(index, "tax_rate_percent", event.target.value)} /></Field>
              <Field title="Fuel responsibility"><select value={item.fuel_responsibility} onChange={(event) => updateQuoteItem(index, "fuel_responsibility", event.target.value)}><option value="customer">Customer</option><option value="owner">Owner</option><option value="mixed">Mixed</option></select></Field>
            </div></article>)}</div>
            <div className="hcc-actions"><button type="button" onClick={() => setQuotationForm((current) => ({ ...current, items: [...current.items, blankQuoteItem()] }))}>Add Equipment Line</button><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save Multi-item Quotation"}</button></div>
          </form> : null}
          <section className="hcc-panel"><div className="hcc-panel-head"><div><small>Commercial documents</small><h2>Quotations</h2></div></div>
            {!quotations.length ? <Empty title="No quotations" text="Create a quotation with one or more equipment lines." /> : <div className="hcc-card-list">{quotations.map((row) => <article className="hcc-record" key={row.id}><div className="hcc-record-head"><div><small>{row.quotation_number}</small><h3>{row.customer_name}</h3><p>{row.work_location} · {row.items?.length || 0} line(s)</p></div><div><Status value={row.status} /><strong>{money(row.total_amount)}</strong></div></div><div className="hcc-record-lines">{row.items?.map((item) => <span key={item.id}>{item.line_number}. {item.description} — {money(item.line_total)}</span>)}</div><div className="hcc-actions"><button type="button" onClick={() => downloadPdf("quotation", row.id, row.quotation_number)}>PDF</button>{canApprove && ["draft", "pending_approval"].includes(row.status) ? <button type="button" onClick={() => run(() => axiosClient.patch(`/hire-commercial/quotations/${row.id}/approve`, { decision_notes: "Reviewed and approved in Commercial Control." }), "Quotation approved.")}>Approve</button> : null}{canManage && ["approved", "accepted"].includes(row.status) ? <button className="primary" type="button" onClick={() => { const start = window.prompt("Contract start date (YYYY-MM-DD)", row.requested_start_date || localDate()); if (start) run(() => axiosClient.post(`/hire-commercial/quotations/${row.id}/convert-to-contract`, { start_date: start, expected_end_date: row.expected_end_date, deposit_required: 0 }), "Contract created."); }}>Convert to Contract</button> : null}</div></article>)}</div>}
          </section>
        </section>
      ) : null}

      {tab === "contracts" ? (
        <section className="hcc-stack">
          {canManage ? <form className="hcc-panel" onSubmit={(event) => { event.preventDefault(); const id = amendmentForm.contract_id; run(() => axiosClient.post(`/hire-commercial/contracts/${id}/amendments`, amendmentForm), "Amendment submitted.").then((response) => response && setAmendmentForm(blankAmendment)); }}><div className="hcc-panel-head"><div><small>Version-controlled agreement</small><h2>Request contract amendment</h2><p>Extensions, rate changes and material scope changes require independent approval.</p></div></div><div className="hcc-form-grid">
            <Field title="Contract"><select required value={amendmentForm.contract_id} onChange={(event) => setAmendmentForm({ ...amendmentForm, contract_id: event.target.value })}><option value="">Choose contract</option>{contracts.filter((row) => !["completed", "cancelled"].includes(row.status)).map((row) => <option key={row.id} value={row.id}>{row.contract_number} — {row.customer_name}</option>)}</select></Field>
            <Field title="Amendment type"><select value={amendmentForm.amendment_type} onChange={(event) => setAmendmentForm({ ...amendmentForm, amendment_type: event.target.value })}>{["extension", "rate_change", "scope_change", "suspension", "reactivation", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field title="Effective date"><input type="date" required value={amendmentForm.effective_date} onChange={(event) => setAmendmentForm({ ...amendmentForm, effective_date: event.target.value })} /></Field>
            <Field title="Proposed end date"><input type="date" value={amendmentForm.proposed_end_date} onChange={(event) => setAmendmentForm({ ...amendmentForm, proposed_end_date: event.target.value })} /></Field>
            <Field title="Proposed rate"><input type="number" min="0" step="0.01" value={amendmentForm.proposed_rate} onChange={(event) => setAmendmentForm({ ...amendmentForm, proposed_rate: event.target.value })} /></Field>
            <Field title="Amount adjustment"><input type="number" min="0" step="0.01" value={amendmentForm.amount_adjustment} onChange={(event) => setAmendmentForm({ ...amendmentForm, amount_adjustment: event.target.value })} /></Field>
            <Field title="Reason" wide><textarea required value={amendmentForm.reason} onChange={(event) => setAmendmentForm({ ...amendmentForm, reason: event.target.value })} /></Field>
          </div><div className="hcc-actions"><button className="primary" disabled={saving}>Submit Amendment</button></div></form> : null}
          <section className="hcc-panel"><div className="hcc-panel-head"><div><small>Commercial agreements</small><h2>Contracts and amendments</h2></div></div>{!contracts.length ? <Empty title="No commercial contracts" text="Convert an approved multi-item quotation to create one." /> : <div className="hcc-card-list">{contracts.map((row) => <article className="hcc-record" key={row.id}><div className="hcc-record-head"><div><small>{row.contract_number} · Version {row.commercial_version || 1}</small><h3>{row.customer_name}</h3><p>{dateText(row.start_date)} – {dateText(row.expected_end_date)} · {row.items?.length || 0} line(s)</p></div><div><Status value={row.status} /><strong>Deposit {money(row.deposit_ledger_balance)}</strong></div></div><div className="hcc-record-lines">{row.items?.map((item) => <span key={item.id}>{item.line_number}. {item.description} — {money(item.agreed_line_total)}</span>)}</div>{row.amendments?.length ? <div className="hcc-sublist">{row.amendments.map((item) => <div key={item.id}><span>{item.amendment_number} · {label(item.amendment_type)}</span><Status value={item.status} />{canApprove && item.status === "pending_approval" ? <button type="button" onClick={() => run(() => axiosClient.patch(`/hire-commercial/amendments/${item.id}/approve`, { decision_notes: "Commercial amendment reviewed." }), "Amendment approved.")}>Approve</button> : null}</div>)}</div> : null}<div className="hcc-actions"><button type="button" onClick={() => downloadPdf("contract", row.id, row.contract_number)}>Contract PDF</button></div></article>)}</div>}</section>
        </section>
      ) : null}

      {tab === "deposits" ? (
        <section className="hcc-stack">
          {canManage ? <form className="hcc-panel" onSubmit={(event) => { event.preventDefault(); run(() => axiosClient.post("/hire-commercial/deposits", depositForm), "Deposit transaction saved.").then((response) => response && setDepositForm(blankDeposit)); }}><div className="hcc-panel-head"><div><small>Controlled customer funds</small><h2>Record deposit transaction</h2><p>Refunds and forfeitures require a different authorized approver.</p></div></div><div className="hcc-form-grid">
            <Field title="Contract"><select required value={depositForm.contract_id} onChange={(event) => setDepositForm({ ...depositForm, contract_id: event.target.value })}><option value="">Choose contract</option>{contracts.map((row) => <option key={row.id} value={row.id}>{row.contract_number} — {row.customer_name}</option>)}</select></Field>
            <Field title="Transaction type"><select value={depositForm.transaction_type} onChange={(event) => setDepositForm({ ...depositForm, transaction_type: event.target.value })}>{["receipt", "allocation", "refund", "forfeit", "adjustment"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field title="Date and time"><input type="datetime-local" value={depositForm.transaction_date} onChange={(event) => setDepositForm({ ...depositForm, transaction_date: event.target.value })} /></Field>
            <Field title="Amount"><input required type="number" min="0.01" step="0.01" value={depositForm.amount} onChange={(event) => setDepositForm({ ...depositForm, amount: event.target.value })} /></Field>
            <Field title="Payment method"><select value={depositForm.payment_method} onChange={(event) => setDepositForm({ ...depositForm, payment_method: event.target.value })}>{["cash", "momo", "bank", "cheque", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field title="Reference"><input value={depositForm.reference_number} onChange={(event) => setDepositForm({ ...depositForm, reference_number: event.target.value })} /></Field>
            <Field title="Reason / notes" wide><textarea value={depositForm.reason} onChange={(event) => setDepositForm({ ...depositForm, reason: event.target.value })} /></Field>
          </div><div className="hcc-actions"><button className="primary" disabled={saving}>Save Deposit Transaction</button></div></form> : null}
          <section className="hcc-panel"><div className="hcc-panel-head"><div><small>Deposit ledger</small><h2>Receipts, allocations and refunds</h2></div></div>{!deposits.length ? <Empty title="No deposit transactions" text="Contract deposit activity will appear here." /> : <div className="hcc-table-wrap"><table><thead><tr><th>Number</th><th>Contract</th><th>Type</th><th>Amount</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>{deposits.map((row) => <tr key={row.id}><td>{row.transaction_number}</td><td>{row.contract_number}<br /><small>{row.customer_name}</small></td><td>{label(row.transaction_type)}</td><td>{money(row.amount)}</td><td>{dateText(row.transaction_date)}</td><td><Status value={row.status} /></td><td>{canApprove && row.status === "pending_approval" ? <button className="small" onClick={() => run(() => axiosClient.patch(`/hire-commercial/deposits/${row.id}/approve`, { decision_notes: "Deposit transaction reviewed." }), "Deposit transaction approved.")}>Approve</button> : "—"}</td></tr>)}</tbody></table></div>}</section>
        </section>
      ) : null}

      {tab === "evidence" ? (
        <section className="hcc-stack">
          {canEvidence ? <form className="hcc-panel" onSubmit={(event) => { event.preventDefault(); run(() => axiosClient.post("/hire-commercial/evidence", evidenceForm), "Evidence registered.").then((response) => response && setEvidenceForm(blankEvidence)); }}><div className="hcc-panel-head"><div><small>Evidence chain</small><h2>Register supporting evidence</h2><p>Record the secure storage reference and optional SHA-256 checksum without placing private files in database text fields.</p></div></div><div className="hcc-form-grid">
            <Field title="Entity type"><select value={evidenceForm.entity_type} onChange={(event) => setEvidenceForm({ ...evidenceForm, entity_type: event.target.value })}>{["quotation", "contract", "dispatch", "work_log", "invoice", "return", "damage"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field title="Entity record ID"><input required type="number" min="1" value={evidenceForm.entity_id} onChange={(event) => setEvidenceForm({ ...evidenceForm, entity_id: event.target.value })} /></Field>
            <Field title="Evidence type"><select value={evidenceForm.evidence_type} onChange={(event) => setEvidenceForm({ ...evidenceForm, evidence_type: event.target.value })}>{["photo", "video", "signed_document", "delivery_note", "job_card", "invoice", "receipt", "damage", "other"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field title="File name"><input required value={evidenceForm.file_name} onChange={(event) => setEvidenceForm({ ...evidenceForm, file_name: event.target.value })} /></Field>
            <Field title="Storage reference" wide><input required placeholder="Approved Drive path, document ID or secure storage reference" value={evidenceForm.storage_reference} onChange={(event) => setEvidenceForm({ ...evidenceForm, storage_reference: event.target.value })} /></Field>
            <Field title="SHA-256 checksum" wide><input maxLength="64" value={evidenceForm.checksum_sha256} onChange={(event) => setEvidenceForm({ ...evidenceForm, checksum_sha256: event.target.value })} /></Field>
            <Field title="Captured at"><input type="datetime-local" value={evidenceForm.captured_at} onChange={(event) => setEvidenceForm({ ...evidenceForm, captured_at: event.target.value })} /></Field>
            <Field title="Notes"><textarea value={evidenceForm.notes} onChange={(event) => setEvidenceForm({ ...evidenceForm, notes: event.target.value })} /></Field>
          </div><div className="hcc-actions"><button className="primary" disabled={saving}>Register Evidence</button></div></form> : null}
          <section className="hcc-panel"><div className="hcc-panel-head"><div><small>Audit evidence</small><h2>Evidence register</h2></div></div>{!evidence.length ? <Empty title="No evidence records" text="Dispatch photos, signed job cards and return evidence can be registered here." /> : <div className="hcc-table-wrap"><table><thead><tr><th>Number</th><th>Entity</th><th>Type</th><th>File</th><th>Storage reference</th><th>Captured</th></tr></thead><tbody>{evidence.map((row) => <tr key={row.id}><td>{row.evidence_number}</td><td>{label(row.entity_type)} #{row.entity_id}</td><td>{label(row.evidence_type)}</td><td>{row.file_name}</td><td className="hcc-break">{row.storage_reference}</td><td>{dateText(row.captured_at || row.created_at)}</td></tr>)}</tbody></table></div>}</section>
        </section>
      ) : null}

      {tab === "damage" ? (
        <section className="hcc-stack">
          {canDamage ? <form className="hcc-panel" onSubmit={(event) => { event.preventDefault(); run(() => axiosClient.post("/hire-commercial/damage-assessments", damageForm), "Damage assessment saved.").then((response) => response && setDamageForm(blankDamage)); }}><div className="hcc-panel-head"><div><small>Return liability</small><h2>Create damage assessment</h2><p>Start from a completed return inspection and record the customer-liability amount.</p></div></div><div className="hcc-form-grid">
            <Field title="Return inspection"><select required value={damageForm.return_inspection_id} onChange={(event) => setDamageForm({ ...damageForm, return_inspection_id: event.target.value })}><option value="">Choose return</option>{returns.map((row) => <option key={row.id} value={row.id}>{row.return_number || `Return #${row.id}`} — {row.asset_code} — {row.contract_number}</option>)}</select></Field>
            <Field title="Assessed amount"><input required type="number" min="0" step="0.01" value={damageForm.assessed_amount} onChange={(event) => setDamageForm({ ...damageForm, assessed_amount: event.target.value })} /></Field>
            <Field title="Customer liability"><input required type="number" min="0" step="0.01" value={damageForm.customer_liability_amount} onChange={(event) => setDamageForm({ ...damageForm, customer_liability_amount: event.target.value })} /></Field>
            <Field title="Damage summary" wide><textarea required value={damageForm.damage_summary} onChange={(event) => setDamageForm({ ...damageForm, damage_summary: event.target.value })} /></Field>
            <Field title="Assessment notes" wide><textarea value={damageForm.assessment_notes} onChange={(event) => setDamageForm({ ...damageForm, assessment_notes: event.target.value })} /></Field>
          </div><div className="hcc-actions"><button className="primary" disabled={saving}>Save Damage Assessment</button></div></form> : null}
          {canApprove ? <form className="hcc-panel" onSubmit={(event) => { event.preventDefault(); const id = settlementForm.assessment_id; run(() => axiosClient.patch(`/hire-commercial/damage-assessments/${id}/settle`, settlementForm), "Damage case settled.").then((response) => response && setSettlementForm(blankSettlement)); }}><div className="hcc-panel-head"><div><small>Balanced settlement</small><h2>Approve damage settlement</h2><p>The four allocations must equal the approved customer-liability amount.</p></div></div><div className="hcc-form-grid">
            <Field title="Assessment"><select required value={settlementForm.assessment_id} onChange={(event) => setSettlementForm({ ...settlementForm, assessment_id: event.target.value })}><option value="">Choose open assessment</option>{damage.filter((row) => row.status !== "settled").map((row) => <option key={row.id} value={row.id}>{row.assessment_number} — {row.asset_code} — {money(row.customer_liability_amount)}</option>)}</select></Field>
            <Field title="Settlement method"><select value={settlementForm.settlement_method} onChange={(event) => setSettlementForm({ ...settlementForm, settlement_method: event.target.value })}>{["deposit_deduction", "invoice", "direct_payment", "insurance", "waiver", "mixed"].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field title="Deposit applied"><input type="number" min="0" step="0.01" value={settlementForm.deposit_applied_amount} onChange={(event) => setSettlementForm({ ...settlementForm, deposit_applied_amount: event.target.value })} /></Field>
            <Field title="Invoiced"><input type="number" min="0" step="0.01" value={settlementForm.invoiced_amount} onChange={(event) => setSettlementForm({ ...settlementForm, invoiced_amount: event.target.value })} /></Field>
            <Field title="Waived"><input type="number" min="0" step="0.01" value={settlementForm.waived_amount} onChange={(event) => setSettlementForm({ ...settlementForm, waived_amount: event.target.value })} /></Field>
            <Field title="Directly settled"><input type="number" min="0" step="0.01" value={settlementForm.settled_amount} onChange={(event) => setSettlementForm({ ...settlementForm, settled_amount: event.target.value })} /></Field>
            <Field title="Settlement notes" wide><textarea value={settlementForm.settlement_notes} onChange={(event) => setSettlementForm({ ...settlementForm, settlement_notes: event.target.value })} /></Field>
          </div><div className="hcc-actions"><button className="primary" disabled={saving}>Approve Settlement</button></div></form> : null}
          <section className="hcc-panel"><div className="hcc-panel-head"><div><small>Damage register</small><h2>Assessments and settlement</h2></div></div>{!damage.length ? <Empty title="No damage assessments" text="Equipment return damage cases will appear here." /> : <div className="hcc-card-list">{damage.map((row) => <article className="hcc-record" key={row.id}><div className="hcc-record-head"><div><small>{row.assessment_number}</small><h3>{row.asset_code} — {row.asset_name}</h3><p>{row.contract_number} · {row.customer_name}</p></div><div><Status value={row.status} /><strong>{money(row.customer_liability_amount)}</strong></div></div><p>{row.damage_summary}</p><div className="hcc-record-lines"><span>Assessed {money(row.assessed_amount)}</span><span>Deposit {money(row.deposit_applied_amount)}</span><span>Invoiced {money(row.invoiced_amount)}</span><span>Waived {money(row.waived_amount)}</span><span>Settled {money(row.settled_amount)}</span></div><div className="hcc-actions"><button type="button" onClick={() => downloadPdf("damage", row.id, row.assessment_number)}>Assessment PDF</button></div></article>)}</div>}</section>
        </section>
      ) : null}
    </div>
  );
}
