import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentSales.css";

const API = "/equipment-catalogue/sales";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function afterDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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

function apiError(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Field({ title, children, wide = false, hint = "" }) {
  return (
    <label className={`equipment-sales__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Sheet({ title, subtitle, onClose, children }) {
  return (
    <div className="equipment-sales__sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="equipment-sales__sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p>Equipment Sales &amp; Hire</p>
            <h2>{title}</h2>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="equipment-sales__sheet-body">{children}</div>
      </section>
    </div>
  );
}

function Status({ value }) {
  return <span className={`equipment-sales__status is-${String(value || "unknown")}`}>{label(value)}</span>;
}

function emptyEnquiry() {
  return {
    customer_id: "",
    enquiry_date: today(),
    asset_type: "Excavator",
    preferred_make: "",
    preferred_model: "",
    condition_preference: "either",
    budget_amount: "",
    purchase_method: "undecided",
    expected_purchase_date: "",
    source_channel: "Walk-in",
    notes: "",
  };
}

function emptyQuote() {
  return {
    enquiry_id: "",
    customer_id: "",
    asset_id: "",
    quotation_date: today(),
    validity_date: afterDays(14),
    unit_price: "",
    discount_amount: "0",
    tax_rate_percent: "0",
    deposit_required: "",
    proposed_frequency: "monthly",
    proposed_installment_count: "12",
    proposed_first_due_date: afterDays(30),
    delivery_policy: "after_deposit",
    delivery_threshold_percent: "0",
    terms: "Equipment remains the property of Chalin 03 until all required payments and ownership-transfer conditions are completed.",
    notes: "",
  };
}

function emptyAgreement() {
  return {
    quotation_id: "",
    sale_type: "installment",
    deposit_received: "",
    payment_method: "momo",
    reference_number: "",
    payment_frequency: "monthly",
    installment_count: "12",
    first_due_date: afterDays(30),
    grace_days: "3",
    guarantor_name: "",
    guarantor_phone: "",
    guarantor_location: "",
    guarantor_id_type: "Ghana Card",
    guarantor_id_number: "",
    terms_accepted: false,
    agreement_notes: "",
  };
}

function emptyPayment() {
  return {
    amount: "",
    payment_method: "momo",
    payment_category: "installment",
    reference_number: "",
    notes: "",
  };
}

function emptyDelivery() {
  return {
    delivery_datetime: new Date().toISOString().slice(0, 16),
    destination: "",
    meter_reading: "",
    fuel_level_percent: "",
    condition_status: "good",
    attachments_tools: "",
    receiving_person: "",
    receiving_phone: "",
    notes: "",
  };
}

function emptyTransfer() {
  return {
    transfer_date: today(),
    registration_transfer_reference: "",
    notes: "",
  };
}

export default function EquipmentSalesPage() {
  const { effectivePermissions = [] } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const canManage = effectivePermissions.includes("fleet.assets.manage");
  const [activeTab, setActiveTab] = useState("overview");
  const [summary, setSummary] = useState({});
  const [reference, setReference] = useState({ customers: [], assets: [] });
  const [enquiries, setEnquiries] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [selectedAgreement, setSelectedAgreement] = useState(null);
  const [agreementDetail, setAgreementDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sheet, setSheet] = useState("");
  const [enquiryForm, setEnquiryForm] = useState(emptyEnquiry);
  const [quoteForm, setQuoteForm] = useState(emptyQuote);
  const [agreementForm, setAgreementForm] = useState(emptyAgreement);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [deliveryForm, setDeliveryForm] = useState(emptyDelivery);
  const [transferForm, setTransferForm] = useState(emptyTransfer);
  const [smsForm, setSmsForm] = useState({ reminder_type: "due_soon", message: "" });

  const locationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId
      ? "All Equipment Hire locations"
      : "Choose a Hire location");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryResponse, referenceResponse, enquiriesResponse, quotationsResponse, agreementsResponse] =
        await Promise.all([
          axiosClient.get(`${API}/summary`),
          axiosClient.get(`${API}/reference`),
          axiosClient.get(`${API}/enquiries`),
          axiosClient.get(`${API}/quotations`),
          axiosClient.get(`${API}/agreements`),
        ]);
      setSummary(summaryResponse.data?.summary || {});
      setReference(referenceResponse.data || { customers: [], assets: [] });
      setEnquiries(enquiriesResponse.data?.enquiries || []);
      setQuotations(quotationsResponse.data?.quotations || []);
      setAgreements(agreementsResponse.data?.agreements || []);
    } catch (requestError) {
      setError(apiError(requestError, "Could not load Equipment Sales."));
    } finally {
      setLoading(false);
    }
  }, [selectedContextId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = window.setTimeout(() => setSuccess(""), 5000);
    return () => window.clearTimeout(timer);
  }, [success]);

  const metrics = useMemo(
    () => [
      ["Sales value", money(summary.total_sales_value), "💼"],
      ["Collected", money(summary.collected_amount), "✅"],
      ["Outstanding", money(summary.outstanding_amount), "📅"],
      ["Overdue", money(summary.overdue_amount), "⚠️"],
      ["Active enquiries", summary.active_enquiries || 0, "✉️"],
      ["Active agreements", summary.active_agreements || 0, "🤝"],
    ],
    [summary]
  );

  const approvedQuotes = quotations.filter((quote) => ["approved", "accepted"].includes(quote.status));

  async function submit(action, successMessage) {
    if (!selectedContextId) {
      setError("Choose an Equipment Hire location before recording Equipment Sales work.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await action();
      setSuccess(successMessage);
      setSheet("");
      await loadData();
    } catch (requestError) {
      setError(apiError(requestError, "The Equipment Sales action could not be completed."));
    } finally {
      setSaving(false);
    }
  }

  async function openAgreement(agreement) {
    setSelectedAgreement(agreement);
    setAgreementDetail(null);
    setSheet("detail");
    try {
      const response = await axiosClient.get(`${API}/agreements/${agreement.id}`);
      setAgreementDetail(response.data || null);
    } catch (requestError) {
      setError(apiError(requestError, "Could not load agreement details."));
    }
  }

  function openQuoteFromEnquiry(enquiry) {
    setQuoteForm({
      ...emptyQuote(),
      enquiry_id: String(enquiry.id),
      customer_id: String(enquiry.customer_id),
      proposed_frequency: enquiry.purchase_method === "installment" ? "monthly" : "",
    });
    setSheet("quote");
  }

  function handleQuoteAsset(assetId) {
    const asset = reference.assets?.find((item) => String(item.id) === String(assetId));
    setQuoteForm((current) => ({
      ...current,
      asset_id: assetId,
      unit_price: asset?.target_selling_price || current.unit_price,
      deposit_required:
        current.deposit_required ||
        (asset?.target_selling_price
          ? String(Math.round(Number(asset.target_selling_price) * 0.2 * 100) / 100)
          : ""),
    }));
  }

  function openAgreementFromQuote(quote) {
    setAgreementForm({
      ...emptyAgreement(),
      quotation_id: String(quote.id),
      deposit_received: String(quote.deposit_required || ""),
      payment_frequency: quote.proposed_frequency || "monthly",
      installment_count: String(quote.proposed_installment_count || 12),
      first_due_date: quote.proposed_first_due_date
        ? String(quote.proposed_first_due_date).slice(0, 10)
        : afterDays(30),
      sale_type: quote.proposed_installment_count ? "installment" : "cash",
    });
    setSheet("agreement");
  }

  function agreementActions(agreement) {
    setSelectedAgreement(agreement);
    return {
      payment() {
        setPaymentForm({
          ...emptyPayment(),
          payment_category: agreement.sale_type === "cash" ? "settlement" : "installment",
        });
        setSheet("payment");
      },
      delivery() {
        setDeliveryForm(emptyDelivery());
        setSheet("delivery");
      },
      transfer() {
        setTransferForm(emptyTransfer());
        setSheet("transfer");
      },
      sms() {
        setSmsForm({ reminder_type: "due_soon", message: "" });
        setSheet("sms");
      },
    };
  }

  return (
    <main className="equipment-sales">
      <section className="equipment-sales__hero">
        <div>
          <p>Equipment Sales &amp; Installments</p>
          <h1>Sell excavators with complete payment control</h1>
          <span>{locationName}</span>
        </div>
        <div className="equipment-sales__hero-actions">
          <a href="/equipment-hire-operations/fleet">Equipment Catalogue</a>
          {canManage ? (
            <button type="button" onClick={() => { setEnquiryForm(emptyEnquiry()); setSheet("enquiry"); }}>
              + New enquiry
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="equipment-sales__alert is-error">{error}</div> : null}
      {success ? <div className="equipment-sales__alert is-success">{success}</div> : null}
      {!selectedContextId ? (
        <div className="equipment-sales__alert is-warning">
          Choose a specific Equipment Hire location to create or update sales records.
        </div>
      ) : null}

      <nav className="equipment-sales__tabs" aria-label="Equipment Sales sections">
        {[
          ["overview", "Overview"],
          ["enquiries", `Enquiries ${enquiries.length}`],
          ["quotations", `Quotations ${quotations.length}`],
          ["agreements", `Agreements ${agreements.length}`],
        ].map(([value, title]) => (
          <button
            type="button"
            key={value}
            className={activeTab === value ? "is-active" : ""}
            onClick={() => setActiveTab(value)}
          >
            {title}
          </button>
        ))}
      </nav>

      {loading ? <div className="equipment-sales__loading">Loading Equipment Sales…</div> : null}

      {!loading && activeTab === "overview" ? (
        <>
          <section className="equipment-sales__metrics">
            {metrics.map(([title, value, icon]) => (
              <article key={title}>
                <span>{icon}</span>
                <div><small>{title}</small><strong>{value}</strong></div>
              </article>
            ))}
          </section>
          <section className="equipment-sales__quick-grid">
            <button type="button" onClick={() => { setEnquiryForm(emptyEnquiry()); setSheet("enquiry"); }} disabled={!canManage || !selectedContextId}>
              <span>✉️</span><strong>Record enquiry</strong><small>Customer request and preferred excavator</small>
            </button>
            <button type="button" onClick={() => { setQuoteForm(emptyQuote()); setSheet("quote"); }} disabled={!canManage || !selectedContextId}>
              <span>🧾</span><strong>Create quotation</strong><small>Exact unit, price, deposit and terms</small>
            </button>
            <button type="button" onClick={() => { setAgreementForm(emptyAgreement()); setSheet("agreement"); }} disabled={!canManage || !selectedContextId || approvedQuotes.length === 0}>
              <span>🤝</span><strong>Create agreement</strong><small>Cash sale or installment schedule</small>
            </button>
            <button type="button" onClick={() => setActiveTab("agreements")}>
              <span>💰</span><strong>Collect payment</strong><small>Receipts, balances and SMS confirmation</small>
            </button>
          </section>
          <section className="equipment-sales__section">
            <header><div><p>Attention required</p><h2>Outstanding and overdue agreements</h2></div></header>
            <div className="equipment-sales__cards">
              {agreements.filter((item) => Number(item.outstanding_balance || 0) > 0).slice(0, 6).map((agreement) => (
                <AgreementCard key={agreement.id} agreement={agreement} onOpen={openAgreement} actions={agreementActions(agreement)} canManage={canManage} />
              ))}
              {!agreements.some((item) => Number(item.outstanding_balance || 0) > 0) ? <Empty text="No outstanding equipment agreements." /> : null}
            </div>
          </section>
        </>
      ) : null}

      {!loading && activeTab === "enquiries" ? (
        <section className="equipment-sales__section">
          <header><div><p>Sales pipeline</p><h2>Equipment enquiries</h2></div>{canManage ? <button type="button" onClick={() => { setEnquiryForm(emptyEnquiry()); setSheet("enquiry"); }}>+ Enquiry</button> : null}</header>
          <div className="equipment-sales__cards">
            {enquiries.map((enquiry) => (
              <article className="equipment-sales__card" key={enquiry.id}>
                <div className="equipment-sales__card-top"><div><small>{enquiry.enquiry_number}</small><h3>{enquiry.customer_name}</h3></div><Status value={enquiry.status} /></div>
                <p>{enquiry.asset_type} · {enquiry.preferred_make || "Any make"} {enquiry.preferred_model || ""}</p>
                <dl><div><dt>Purchase</dt><dd>{label(enquiry.purchase_method)}</dd></div><div><dt>Budget</dt><dd>{money(enquiry.budget_amount)}</dd></div><div><dt>Phone</dt><dd>{enquiry.customer_phone || "—"}</dd></div></dl>
                {canManage && ["open", "quoted"].includes(enquiry.status) ? <button type="button" className="equipment-sales__primary" onClick={() => openQuoteFromEnquiry(enquiry)}>Prepare quotation</button> : null}
              </article>
            ))}
            {!enquiries.length ? <Empty text="No Equipment Sales enquiries yet." /> : null}
          </div>
        </section>
      ) : null}

      {!loading && activeTab === "quotations" ? (
        <section className="equipment-sales__section">
          <header><div><p>Commercial offers</p><h2>Equipment quotations</h2></div>{canManage ? <button type="button" onClick={() => { setQuoteForm(emptyQuote()); setSheet("quote"); }}>+ Quotation</button> : null}</header>
          <div className="equipment-sales__cards">
            {quotations.map((quote) => (
              <article className="equipment-sales__card" key={quote.id}>
                {quote.main_image_url_snapshot ? <img className="equipment-sales__thumb" src={quote.main_image_url_snapshot} alt={quote.asset_name_snapshot} /> : null}
                <div className="equipment-sales__card-top"><div><small>{quote.quotation_number}</small><h3>{quote.asset_name_snapshot}</h3></div><Status value={quote.status} /></div>
                <p>{quote.customer_name} · {quote.make_snapshot || ""} {quote.model_snapshot || ""}</p>
                <dl><div><dt>Total</dt><dd>{money(quote.total_amount)}</dd></div><div><dt>Deposit</dt><dd>{money(quote.deposit_required)}</dd></div><div><dt>Valid until</dt><dd>{String(quote.validity_date || "—").slice(0, 10)}</dd></div></dl>
                <div className="equipment-sales__card-actions">
                  {canManage && quote.status === "pending_approval" ? <button type="button" onClick={() => submit(() => axiosClient.patch(`${API}/quotations/${quote.id}/status`, { status: "approved", reason: "Approved by authorised Equipment Sales user." }), "Quotation approved.")}>Approve</button> : null}
                  {canManage && ["approved", "accepted"].includes(quote.status) ? <button type="button" className="equipment-sales__primary" onClick={() => openAgreementFromQuote(quote)}>Create agreement</button> : null}
                </div>
              </article>
            ))}
            {!quotations.length ? <Empty text="No Equipment Sales quotations yet." /> : null}
          </div>
        </section>
      ) : null}

      {!loading && activeTab === "agreements" ? (
        <section className="equipment-sales__section">
          <header><div><p>Sales and collections</p><h2>Cash and installment agreements</h2></div>{canManage && approvedQuotes.length ? <button type="button" onClick={() => { setAgreementForm(emptyAgreement()); setSheet("agreement"); }}>+ Agreement</button> : null}</header>
          <div className="equipment-sales__cards">
            {agreements.map((agreement) => (
              <AgreementCard key={agreement.id} agreement={agreement} onOpen={openAgreement} actions={agreementActions(agreement)} canManage={canManage} />
            ))}
            {!agreements.length ? <Empty text="No Equipment Sales agreements yet." /> : null}
          </div>
        </section>
      ) : null}

      {sheet === "enquiry" ? (
        <Sheet title="New sales enquiry" subtitle="Capture what the customer wants to buy." onClose={() => setSheet("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); submit(() => axiosClient.post(`${API}/enquiries`, enquiryForm), "Sales enquiry created."); }}>
            <Field title="Customer" wide><select required value={enquiryForm.customer_id} onChange={(event) => setEnquiryForm({ ...enquiryForm, customer_id: event.target.value })}><option value="">Choose customer</option>{reference.customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_name} · {customer.phone}</option>)}</select></Field>
            <Field title="Enquiry date"><input type="date" value={enquiryForm.enquiry_date} onChange={(event) => setEnquiryForm({ ...enquiryForm, enquiry_date: event.target.value })} /></Field>
            <Field title="Equipment type"><input required value={enquiryForm.asset_type} onChange={(event) => setEnquiryForm({ ...enquiryForm, asset_type: event.target.value })} /></Field>
            <Field title="Preferred make"><input value={enquiryForm.preferred_make} onChange={(event) => setEnquiryForm({ ...enquiryForm, preferred_make: event.target.value })} /></Field>
            <Field title="Preferred model"><input value={enquiryForm.preferred_model} onChange={(event) => setEnquiryForm({ ...enquiryForm, preferred_model: event.target.value })} /></Field>
            <Field title="Condition"><select value={enquiryForm.condition_preference} onChange={(event) => setEnquiryForm({ ...enquiryForm, condition_preference: event.target.value })}><option value="new">New</option><option value="used">Used</option><option value="either">Either</option></select></Field>
            <Field title="Purchase method"><select value={enquiryForm.purchase_method} onChange={(event) => setEnquiryForm({ ...enquiryForm, purchase_method: event.target.value })}><option value="undecided">Undecided</option><option value="cash">Cash</option><option value="installment">Installment</option></select></Field>
            <Field title="Budget"><input type="number" min="0" step="0.01" value={enquiryForm.budget_amount} onChange={(event) => setEnquiryForm({ ...enquiryForm, budget_amount: event.target.value })} /></Field>
            <Field title="Expected purchase"><input type="date" value={enquiryForm.expected_purchase_date} onChange={(event) => setEnquiryForm({ ...enquiryForm, expected_purchase_date: event.target.value })} /></Field>
            <Field title="Source"><input value={enquiryForm.source_channel} onChange={(event) => setEnquiryForm({ ...enquiryForm, source_channel: event.target.value })} /></Field>
            <Field title="Notes" wide><textarea rows="3" value={enquiryForm.notes} onChange={(event) => setEnquiryForm({ ...enquiryForm, notes: event.target.value })} /></Field>
            <FormActions saving={saving} onCancel={() => setSheet("")} title="Save enquiry" />
          </form>
        </Sheet>
      ) : null}

      {sheet === "quote" ? (
        <Sheet title="Equipment quotation" subtitle="Select the exact excavator and commercial terms." onClose={() => setSheet("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); submit(() => axiosClient.post(`${API}/quotations`, quoteForm), "Quotation created."); }}>
            <Field title="Linked enquiry"><select value={quoteForm.enquiry_id} onChange={(event) => { const enquiry = enquiries.find((item) => String(item.id) === event.target.value); setQuoteForm({ ...quoteForm, enquiry_id: event.target.value, customer_id: enquiry ? String(enquiry.customer_id) : quoteForm.customer_id }); }}><option value="">Direct quotation</option>{enquiries.filter((item) => ["open", "quoted"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.enquiry_number} · {item.customer_name}</option>)}</select></Field>
            <Field title="Customer"><select required value={quoteForm.customer_id} onChange={(event) => setQuoteForm({ ...quoteForm, customer_id: event.target.value })}><option value="">Choose customer</option>{reference.customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_name}</option>)}</select></Field>
            <Field title="Exact equipment" wide><select required value={quoteForm.asset_id} onChange={(event) => handleQuoteAsset(event.target.value)}><option value="">Choose available equipment</option>{reference.assets?.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} · {asset.asset_name} · {asset.make || ""} {asset.model || ""}</option>)}</select></Field>
            <Field title="Quotation date"><input type="date" value={quoteForm.quotation_date} onChange={(event) => setQuoteForm({ ...quoteForm, quotation_date: event.target.value })} /></Field>
            <Field title="Valid until"><input type="date" value={quoteForm.validity_date} onChange={(event) => setQuoteForm({ ...quoteForm, validity_date: event.target.value })} /></Field>
            <Field title="Selling price"><input required type="number" min="0" step="0.01" value={quoteForm.unit_price} onChange={(event) => setQuoteForm({ ...quoteForm, unit_price: event.target.value })} /></Field>
            <Field title="Discount"><input type="number" min="0" step="0.01" value={quoteForm.discount_amount} onChange={(event) => setQuoteForm({ ...quoteForm, discount_amount: event.target.value })} /></Field>
            <Field title="Tax %"><input type="number" min="0" max="100" step="0.01" value={quoteForm.tax_rate_percent} onChange={(event) => setQuoteForm({ ...quoteForm, tax_rate_percent: event.target.value })} /></Field>
            <Field title="Deposit required"><input type="number" min="0" step="0.01" value={quoteForm.deposit_required} onChange={(event) => setQuoteForm({ ...quoteForm, deposit_required: event.target.value })} /></Field>
            <Field title="Proposed frequency"><select value={quoteForm.proposed_frequency} onChange={(event) => setQuoteForm({ ...quoteForm, proposed_frequency: event.target.value })}><option value="">Cash quotation</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></Field>
            <Field title="Installment count"><input type="number" min="1" max="120" value={quoteForm.proposed_installment_count} onChange={(event) => setQuoteForm({ ...quoteForm, proposed_installment_count: event.target.value })} /></Field>
            <Field title="First due date"><input type="date" value={quoteForm.proposed_first_due_date} onChange={(event) => setQuoteForm({ ...quoteForm, proposed_first_due_date: event.target.value })} /></Field>
            <Field title="Delivery rule"><select value={quoteForm.delivery_policy} onChange={(event) => setQuoteForm({ ...quoteForm, delivery_policy: event.target.value })}><option value="immediate">Immediate</option><option value="after_deposit">After deposit</option><option value="after_percentage">After percentage paid</option><option value="after_full_payment">After full payment</option></select></Field>
            {quoteForm.delivery_policy === "after_percentage" ? <Field title="Delivery threshold %"><input type="number" min="0" max="100" value={quoteForm.delivery_threshold_percent} onChange={(event) => setQuoteForm({ ...quoteForm, delivery_threshold_percent: event.target.value })} /></Field> : null}
            <Field title="Terms" wide><textarea rows="4" value={quoteForm.terms} onChange={(event) => setQuoteForm({ ...quoteForm, terms: event.target.value })} /></Field>
            <FormActions saving={saving} onCancel={() => setSheet("")} title="Create quotation" />
          </form>
        </Sheet>
      ) : null}

      {sheet === "agreement" ? (
        <Sheet title="Cash or installment agreement" subtitle="Reserves the selected excavator against another sale or hire." onClose={() => setSheet("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); submit(() => axiosClient.post(`${API}/agreements`, agreementForm), "Agreement created and equipment reserved."); }}>
            <Field title="Approved quotation" wide><select required value={agreementForm.quotation_id} onChange={(event) => { const quote = approvedQuotes.find((item) => String(item.id) === event.target.value); setAgreementForm({ ...agreementForm, quotation_id: event.target.value, deposit_received: quote?.deposit_required ?? agreementForm.deposit_received, payment_frequency: quote?.proposed_frequency || agreementForm.payment_frequency, installment_count: quote?.proposed_installment_count || agreementForm.installment_count, first_due_date: quote?.proposed_first_due_date ? String(quote.proposed_first_due_date).slice(0, 10) : agreementForm.first_due_date }); }}><option value="">Choose quotation</option>{approvedQuotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.quotation_number} · {quote.customer_name} · {money(quote.total_amount)}</option>)}</select></Field>
            <Field title="Sale type"><select value={agreementForm.sale_type} onChange={(event) => setAgreementForm({ ...agreementForm, sale_type: event.target.value })}><option value="cash">Cash sale</option><option value="installment">Installment sale</option></select></Field>
            <Field title="Deposit received"><input type="number" min="0" step="0.01" value={agreementForm.deposit_received} onChange={(event) => setAgreementForm({ ...agreementForm, deposit_received: event.target.value })} /></Field>
            <Field title="Deposit method"><select value={agreementForm.payment_method} onChange={(event) => setAgreementForm({ ...agreementForm, payment_method: event.target.value })}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="other">Other</option></select></Field>
            <Field title="Reference"><input value={agreementForm.reference_number} onChange={(event) => setAgreementForm({ ...agreementForm, reference_number: event.target.value })} /></Field>
            {agreementForm.sale_type === "installment" ? <><Field title="Payment frequency"><select value={agreementForm.payment_frequency} onChange={(event) => setAgreementForm({ ...agreementForm, payment_frequency: event.target.value })}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></Field><Field title="Number of installments"><input type="number" min="1" max="120" value={agreementForm.installment_count} onChange={(event) => setAgreementForm({ ...agreementForm, installment_count: event.target.value })} /></Field><Field title="First due date"><input type="date" value={agreementForm.first_due_date} onChange={(event) => setAgreementForm({ ...agreementForm, first_due_date: event.target.value })} /></Field><Field title="Grace days"><input type="number" min="0" max="90" value={agreementForm.grace_days} onChange={(event) => setAgreementForm({ ...agreementForm, grace_days: event.target.value })} /></Field><Field title="Guarantor name"><input value={agreementForm.guarantor_name} onChange={(event) => setAgreementForm({ ...agreementForm, guarantor_name: event.target.value })} /></Field><Field title="Guarantor phone"><input value={agreementForm.guarantor_phone} onChange={(event) => setAgreementForm({ ...agreementForm, guarantor_phone: event.target.value })} /></Field><Field title="Guarantor location"><input value={agreementForm.guarantor_location} onChange={(event) => setAgreementForm({ ...agreementForm, guarantor_location: event.target.value })} /></Field><Field title="Guarantor ID number"><input value={agreementForm.guarantor_id_number} onChange={(event) => setAgreementForm({ ...agreementForm, guarantor_id_number: event.target.value })} /></Field></> : null}
            <label className="equipment-sales__check is-wide"><input type="checkbox" checked={agreementForm.terms_accepted} onChange={(event) => setAgreementForm({ ...agreementForm, terms_accepted: event.target.checked })} /><span>Customer has reviewed and accepted the agreement terms.</span></label>
            <Field title="Agreement notes" wide><textarea rows="3" value={agreementForm.agreement_notes} onChange={(event) => setAgreementForm({ ...agreementForm, agreement_notes: event.target.value })} /></Field>
            <FormActions saving={saving} onCancel={() => setSheet("")} title="Create agreement" />
          </form>
        </Sheet>
      ) : null}

      {sheet === "detail" && selectedAgreement ? (
        <Sheet title={selectedAgreement.agreement_number} subtitle={`${selectedAgreement.customer_name} · ${selectedAgreement.asset_name}`} onClose={() => setSheet("")}>
          {!agreementDetail ? <div className="equipment-sales__loading">Loading agreement…</div> : <AgreementDetail detail={agreementDetail} />}
        </Sheet>
      ) : null}

      {sheet === "payment" && selectedAgreement ? (
        <Sheet title="Record payment" subtitle={`${selectedAgreement.agreement_number} · ${money(selectedAgreement.outstanding_balance)} outstanding`} onClose={() => setSheet("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); submit(() => axiosClient.post(`${API}/agreements/${selectedAgreement.id}/payments`, paymentForm), "Payment and SMS receipt completed."); }}>
            <Field title="Amount"><input required type="number" min="0.01" max={selectedAgreement.outstanding_balance} step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></Field>
            <Field title="Method"><select value={paymentForm.payment_method} onChange={(event) => setPaymentForm({ ...paymentForm, payment_method: event.target.value })}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="other">Other</option></select></Field>
            <Field title="Reference"><input value={paymentForm.reference_number} onChange={(event) => setPaymentForm({ ...paymentForm, reference_number: event.target.value })} /></Field>
            <Field title="Notes" wide><textarea rows="3" value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></Field>
            <FormActions saving={saving} onCancel={() => setSheet("")} title="Save payment" />
          </form>
        </Sheet>
      ) : null}

      {sheet === "delivery" && selectedAgreement ? (
        <Sheet title="Record equipment delivery" subtitle={selectedAgreement.agreement_number} onClose={() => setSheet("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); submit(() => axiosClient.post(`${API}/agreements/${selectedAgreement.id}/delivery`, deliveryForm), "Delivery recorded and customer notified."); }}>
            <Field title="Delivery date and time"><input type="datetime-local" value={deliveryForm.delivery_datetime} onChange={(event) => setDeliveryForm({ ...deliveryForm, delivery_datetime: event.target.value })} /></Field>
            <Field title="Destination"><input value={deliveryForm.destination} onChange={(event) => setDeliveryForm({ ...deliveryForm, destination: event.target.value })} /></Field>
            <Field title="Meter reading"><input type="number" min="0" step="0.01" value={deliveryForm.meter_reading} onChange={(event) => setDeliveryForm({ ...deliveryForm, meter_reading: event.target.value })} /></Field>
            <Field title="Fuel level %"><input type="number" min="0" max="100" value={deliveryForm.fuel_level_percent} onChange={(event) => setDeliveryForm({ ...deliveryForm, fuel_level_percent: event.target.value })} /></Field>
            <Field title="Condition"><select value={deliveryForm.condition_status} onChange={(event) => setDeliveryForm({ ...deliveryForm, condition_status: event.target.value })}><option value="new">New</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="damaged">Damaged</option></select></Field>
            <Field title="Receiving person"><input required value={deliveryForm.receiving_person} onChange={(event) => setDeliveryForm({ ...deliveryForm, receiving_person: event.target.value })} /></Field>
            <Field title="Receiving phone"><input value={deliveryForm.receiving_phone} onChange={(event) => setDeliveryForm({ ...deliveryForm, receiving_phone: event.target.value })} /></Field>
            <Field title="Attachments and tools" wide><textarea rows="3" value={deliveryForm.attachments_tools} onChange={(event) => setDeliveryForm({ ...deliveryForm, attachments_tools: event.target.value })} /></Field>
            <Field title="Notes" wide><textarea rows="3" value={deliveryForm.notes} onChange={(event) => setDeliveryForm({ ...deliveryForm, notes: event.target.value })} /></Field>
            <FormActions saving={saving} onCancel={() => setSheet("")} title="Confirm delivery" />
          </form>
        </Sheet>
      ) : null}

      {sheet === "transfer" && selectedAgreement ? (
        <Sheet title="Transfer ownership" subtitle="Only available after full payment and delivery." onClose={() => setSheet("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); submit(() => axiosClient.post(`${API}/agreements/${selectedAgreement.id}/ownership-transfer`, transferForm), "Ownership transferred and customer notified."); }}>
            <Field title="Transfer date"><input type="date" value={transferForm.transfer_date} onChange={(event) => setTransferForm({ ...transferForm, transfer_date: event.target.value })} /></Field>
            <Field title="Registration reference"><input value={transferForm.registration_transfer_reference} onChange={(event) => setTransferForm({ ...transferForm, registration_transfer_reference: event.target.value })} /></Field>
            <Field title="Notes" wide><textarea rows="4" value={transferForm.notes} onChange={(event) => setTransferForm({ ...transferForm, notes: event.target.value })} /></Field>
            <FormActions saving={saving} onCancel={() => setSheet("")} title="Complete transfer" />
          </form>
        </Sheet>
      ) : null}

      {sheet === "sms" && selectedAgreement ? (
        <Sheet title="Send customer SMS" subtitle={`${selectedAgreement.customer_name} · ${selectedAgreement.customer_phone || "No phone"}`} onClose={() => setSheet("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); submit(() => axiosClient.post(`${API}/agreements/${selectedAgreement.id}/sms`, smsForm), "SMS submitted."); }}>
            <Field title="Message type" wide><select value={smsForm.reminder_type} onChange={(event) => setSmsForm({ ...smsForm, reminder_type: event.target.value })}><option value="due_soon">Payment due soon</option><option value="due_today">Payment due today</option><option value="overdue">Overdue payment</option><option value="payment_receipt">Payment receipt</option><option value="delivery_scheduled">Delivery scheduled</option><option value="completed">Agreement completed</option><option value="manual">Custom message</option></select></Field>
            {smsForm.reminder_type === "manual" ? <Field title="Custom message" wide><textarea required rows="5" maxLength="480" value={smsForm.message} onChange={(event) => setSmsForm({ ...smsForm, message: event.target.value })} /></Field> : null}
            <FormActions saving={saving} onCancel={() => setSheet("")} title="Send SMS" />
          </form>
        </Sheet>
      ) : null}
    </main>
  );
}

function AgreementCard({ agreement, onOpen, actions, canManage }) {
  const paidPercent = Number(agreement.total_amount || 0) > 0
    ? Math.min(100, (Number(agreement.amount_paid || 0) / Number(agreement.total_amount)) * 100)
    : 0;
  return (
    <article className="equipment-sales__card">
      {agreement.main_image_url ? <img className="equipment-sales__thumb" src={agreement.main_image_url} alt={agreement.asset_name} /> : null}
      <div className="equipment-sales__card-top"><div><small>{agreement.agreement_number}</small><h3>{agreement.asset_name}</h3></div><Status value={agreement.agreement_status} /></div>
      <p>{agreement.customer_name} · {label(agreement.sale_type)}</p>
      <div className="equipment-sales__progress"><span style={{ width: `${paidPercent}%` }} /></div>
      <dl><div><dt>Paid</dt><dd>{money(agreement.amount_paid)}</dd></div><div><dt>Balance</dt><dd>{money(agreement.outstanding_balance)}</dd></div><div><dt>Next due</dt><dd>{agreement.next_due_date ? String(agreement.next_due_date).slice(0, 10) : "—"}</dd></div></dl>
      <div className="equipment-sales__card-actions">
        <button type="button" onClick={() => onOpen(agreement)}>View</button>
        {canManage && Number(agreement.outstanding_balance || 0) > 0 ? <button type="button" className="equipment-sales__primary" onClick={actions.payment}>Payment</button> : null}
        {canManage && agreement.delivery_status !== "delivered" ? <button type="button" onClick={actions.delivery}>Delivery</button> : null}
        {canManage && Number(agreement.outstanding_balance || 0) <= 0.01 && agreement.delivery_status === "delivered" && agreement.ownership_status !== "transferred" ? <button type="button" onClick={actions.transfer}>Ownership</button> : null}
        {canManage ? <button type="button" onClick={actions.sms}>SMS</button> : null}
      </div>
    </article>
  );
}

function AgreementDetail({ detail }) {
  const agreement = detail.agreement || {};
  return (
    <div className="equipment-sales__detail">
      <section><h3>Agreement summary</h3><dl><div><dt>Customer</dt><dd>{agreement.customer_name}</dd></div><div><dt>Equipment</dt><dd>{agreement.asset_code} · {agreement.asset_name}</dd></div><div><dt>Total</dt><dd>{money(agreement.total_amount)}</dd></div><div><dt>Paid</dt><dd>{money(agreement.amount_paid)}</dd></div><div><dt>Outstanding</dt><dd>{money(agreement.outstanding_balance)}</dd></div><div><dt>Delivery</dt><dd>{label(agreement.delivery_status)}</dd></div><div><dt>Ownership</dt><dd>{label(agreement.ownership_status)}</dd></div></dl></section>
      {detail.schedule?.length ? <section><h3>Installment schedule</h3><div className="equipment-sales__schedule">{detail.schedule.map((row) => <article key={row.id}><div><strong>#{row.sequence_number}</strong><span>{String(row.due_date).slice(0, 10)}</span></div><div><b>{money(row.scheduled_amount)}</b><Status value={row.schedule_status} /></div></article>)}</div></section> : null}
      <section><h3>Payments</h3>{detail.payments?.length ? <div className="equipment-sales__schedule">{detail.payments.map((row) => <article key={row.id}><div><strong>{row.receipt_number}</strong><span>{String(row.payment_date).slice(0, 10)}</span></div><div><b>{money(row.amount)}</b><span>{label(row.payment_method)}</span></div></article>)}</div> : <p>No payments recorded.</p>}</section>
    </div>
  );
}

function FormActions({ saving, onCancel, title }) {
  return (
    <div className="equipment-sales__form-actions is-wide">
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="submit" className="equipment-sales__primary" disabled={saving}>{saving ? "Saving…" : title}</button>
    </div>
  );
}

function Empty({ text }) {
  return <div className="equipment-sales__empty"><span>🏗️</span><p>{text}</p></div>;
}
