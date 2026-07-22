import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentSales.css";

const API = "/equipment-catalogue/sales";
const date = () => new Date().toISOString().slice(0, 10);
const future = (days) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
};
const cash = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const text = (value) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
const errorText = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const enquiryStart = () => ({
  customer_id: "",
  enquiry_date: date(),
  asset_type: "Excavator",
  preferred_make: "",
  preferred_model: "",
  condition_preference: "either",
  budget_amount: "",
  purchase_method: "installment",
  expected_purchase_date: "",
  source_channel: "Walk-in",
  notes: "",
});
const quoteStart = () => ({
  enquiry_id: "",
  customer_id: "",
  asset_id: "",
  quotation_date: date(),
  validity_date: future(14),
  unit_price: "",
  discount_amount: "0",
  tax_rate_percent: "0",
  deposit_required: "",
  proposed_frequency: "monthly",
  proposed_installment_count: "12",
  proposed_first_due_date: future(30),
  delivery_policy: "after_deposit",
  delivery_threshold_percent: "0",
  terms:
    "Equipment remains under Chalin 03 ownership until payment and ownership-transfer conditions are completed.",
  notes: "",
});
const agreementStart = () => ({
  quotation_id: "",
  sale_type: "installment",
  deposit_received: "",
  payment_method: "momo",
  reference_number: "",
  payment_frequency: "monthly",
  installment_count: "12",
  first_due_date: future(30),
  grace_days: "3",
  guarantor_name: "",
  guarantor_phone: "",
  guarantor_location: "",
  guarantor_id_type: "Ghana Card",
  guarantor_id_number: "",
  terms_accepted: false,
  agreement_notes: "",
});

function Field({ title, children, wide = false }) {
  return (
    <label className={`equipment-sales__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
    </label>
  );
}

function Drawer({ title, subtitle, close, children }) {
  return (
    <div className="equipment-sales__sheet-backdrop" onMouseDown={close} role="presentation">
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
            <span>{subtitle}</span>
          </div>
          <button type="button" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <div className="equipment-sales__sheet-body">{children}</div>
      </section>
    </div>
  );
}

function Status({ value }) {
  return (
    <span className={`equipment-sales__status is-${String(value || "unknown")}`}>
      {text(value)}
    </span>
  );
}

function Buttons({ saving, close, title }) {
  return (
    <div className="equipment-sales__form-actions is-wide">
      <button type="button" onClick={close}>
        Cancel
      </button>
      <button type="submit" className="equipment-sales__primary" disabled={saving}>
        {saving ? "Saving…" : title}
      </button>
    </div>
  );
}

export default function EquipmentSalesWorkspacePage() {
  const { effectivePermissions = [], user } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const role = String(user?.role || "").toLowerCase();
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") ||
    ["admin", "manager", "administrator", "system_administrator"].includes(role);

  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState({});
  const [reference, setReference] = useState({ customers: [], assets: [] });
  const [enquiries, setEnquiries] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(null);
  const [drawer, setDrawer] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [enquiry, setEnquiry] = useState(enquiryStart);
  const [quote, setQuote] = useState(quoteStart);
  const [agreement, setAgreement] = useState(agreementStart);
  const [payment, setPayment] = useState({
    amount: "",
    payment_method: "momo",
    payment_category: "installment",
    reference_number: "",
    notes: "",
  });
  const [delivery, setDelivery] = useState({
    delivery_datetime: new Date().toISOString().slice(0, 16),
    destination: "",
    meter_reading: "",
    fuel_level_percent: "",
    condition_status: "good",
    attachments_tools: "",
    receiving_person: "",
    receiving_phone: "",
    notes: "",
  });
  const [transfer, setTransfer] = useState({
    transfer_date: date(),
    registration_transfer_reference: "",
    notes: "",
  });
  const [sms, setSms] = useState({ reminder_type: "due_soon", message: "" });

  const locationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId
      ? "All Equipment Hire locations"
      : "Choose a Hire location");

  const reload = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const responses = await Promise.all([
        axiosClient.get(`${API}/summary`),
        axiosClient.get(`${API}/reference`),
        axiosClient.get(`${API}/enquiries`),
        axiosClient.get(`${API}/quotations`),
        axiosClient.get(`${API}/agreements`),
      ]);
      setSummary(responses[0].data?.summary || {});
      setReference(responses[1].data || { customers: [], assets: [] });
      setEnquiries(responses[2].data?.enquiries || []);
      setQuotes(responses[3].data?.quotations || []);
      setAgreements(responses[4].data?.agreements || []);
    } catch (error) {
      setProblem(errorText(error, "Could not load Equipment Sales."));
    } finally {
      setLoading(false);
    }
  }, [selectedContextId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function save(request, message) {
    if (!selectedContextId) {
      setProblem("Choose a specific Equipment Hire location before recording sales work.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      await request();
      setDrawer("");
      setNotice(message);
      await reload();
    } catch (error) {
      setProblem(errorText(error, "The action could not be completed."));
    } finally {
      setSaving(false);
    }
  }

  function newEnquiry() {
    setEnquiry(enquiryStart());
    setDrawer("enquiry");
  }

  function newQuote(source = null) {
    const form = quoteStart();
    if (source) {
      form.enquiry_id = String(source.id);
      form.customer_id = String(source.customer_id);
    }
    setQuote(form);
    setDrawer("quote");
  }

  function chooseAsset(assetId) {
    const asset = reference.assets?.find((item) => String(item.id) === String(assetId));
    setQuote((current) => ({
      ...current,
      asset_id: assetId,
      unit_price: asset?.target_selling_price || current.unit_price,
      deposit_required:
        current.deposit_required ||
        (asset?.target_selling_price
          ? String(Number(asset.target_selling_price) * 0.2)
          : ""),
    }));
  }

  function newAgreement(source = null) {
    const form = agreementStart();
    if (source) {
      form.quotation_id = String(source.id);
      form.deposit_received = String(source.deposit_required || "");
      form.payment_frequency = source.proposed_frequency || "monthly";
      form.installment_count = String(source.proposed_installment_count || 12);
      form.first_due_date = source.proposed_first_due_date
        ? String(source.proposed_first_due_date).slice(0, 10)
        : future(30);
      form.sale_type = source.proposed_installment_count ? "installment" : "cash";
    }
    setAgreement(form);
    setDrawer("agreement");
  }

  function openAction(name, item) {
    setSelected(item);
    if (name === "payment") {
      setPayment({
        amount: "",
        payment_method: "momo",
        payment_category: item.sale_type === "cash" ? "settlement" : "installment",
        reference_number: "",
        notes: "",
      });
    }
    if (name === "delivery") {
      setDelivery({
        delivery_datetime: new Date().toISOString().slice(0, 16),
        destination: "",
        meter_reading: "",
        fuel_level_percent: "",
        condition_status: "good",
        attachments_tools: "",
        receiving_person: "",
        receiving_phone: "",
        notes: "",
      });
    }
    if (name === "transfer") {
      setTransfer({ transfer_date: date(), registration_transfer_reference: "", notes: "" });
    }
    if (name === "sms") setSms({ reminder_type: "due_soon", message: "" });
    setDrawer(name);
  }

  async function openDetail(item) {
    setSelected(item);
    setDetail(null);
    setDrawer("detail");
    try {
      const response = await axiosClient.get(`${API}/agreements/${item.id}`);
      setDetail(response.data || null);
    } catch (error) {
      setProblem(errorText(error, "Could not load agreement details."));
    }
  }

  const approvedQuotes = quotes.filter((item) => ["approved", "accepted"].includes(item.status));
  const metrics = useMemo(
    () => [
      ["Sales value", cash(summary.total_sales_value), "💼"],
      ["Collected", cash(summary.collected_amount), "✅"],
      ["Outstanding", cash(summary.outstanding_amount), "📅"],
      ["Overdue", cash(summary.overdue_amount), "⚠️"],
      ["Enquiries", summary.active_enquiries || 0, "✉️"],
      ["Agreements", summary.active_agreements || 0, "🤝"],
    ],
    [summary]
  );

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
          {canManage ? <button type="button" onClick={newEnquiry}>+ New enquiry</button> : null}
        </div>
      </section>

      {problem ? <div className="equipment-sales__alert is-error">{problem}</div> : null}
      {notice ? <div className="equipment-sales__alert is-success">{notice}</div> : null}
      {!selectedContextId ? (
        <div className="equipment-sales__alert is-warning">
          Select a Hire location before creating or changing sales records.
        </div>
      ) : null}

      <nav className="equipment-sales__tabs">
        {[
          ["overview", "Overview"],
          ["enquiries", `Enquiries ${enquiries.length}`],
          ["quotes", `Quotations ${quotes.length}`],
          ["agreements", `Agreements ${agreements.length}`],
        ].map(([value, title]) => (
          <button
            type="button"
            key={value}
            className={tab === value ? "is-active" : ""}
            onClick={() => setTab(value)}
          >
            {title}
          </button>
        ))}
      </nav>

      {loading ? <div className="equipment-sales__loading">Loading Equipment Sales…</div> : null}

      {!loading && tab === "overview" ? (
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
            <Quick icon="✉️" title="Record enquiry" subtitle="Customer and preferred machine" disabled={!canManage || !selectedContextId} action={newEnquiry} />
            <Quick icon="🧾" title="Create quotation" subtitle="Exact unit, deposit and terms" disabled={!canManage || !selectedContextId} action={() => newQuote()} />
            <Quick icon="🤝" title="Create agreement" subtitle="Cash or installment schedule" disabled={!canManage || !selectedContextId || !approvedQuotes.length} action={() => newAgreement()} />
            <Quick icon="💰" title="Collect payment" subtitle="Receipt, balance and SMS" action={() => setTab("agreements")} />
          </section>
          <List title="Outstanding accounts">
            {agreements.filter((item) => Number(item.outstanding_balance || 0) > 0).slice(0, 6).map((item) => (
              <Agreement key={item.id} item={item} canManage={canManage} detail={() => openDetail(item)} act={(name) => openAction(name, item)} />
            ))}
          </List>
        </>
      ) : null}

      {!loading && tab === "enquiries" ? (
        <List title="Equipment enquiries" action={canManage ? newEnquiry : null} actionTitle="+ Enquiry">
          {enquiries.map((item) => (
            <article className="equipment-sales__card" key={item.id}>
              <Top number={item.enquiry_number} title={item.customer_name} status={item.status} />
              <p>{item.asset_type} · {item.preferred_make || "Any make"} {item.preferred_model || ""}</p>
              <Facts values={[["Purchase", text(item.purchase_method)], ["Budget", cash(item.budget_amount)], ["Phone", item.customer_phone || "—"]]} />
              {canManage && ["open", "quoted"].includes(item.status) ? <div className="equipment-sales__card-actions"><button type="button" className="equipment-sales__primary" onClick={() => newQuote(item)}>Prepare quotation</button></div> : null}
            </article>
          ))}
        </List>
      ) : null}

      {!loading && tab === "quotes" ? (
        <List title="Equipment quotations" action={canManage ? () => newQuote() : null} actionTitle="+ Quotation">
          {quotes.map((item) => (
            <article className="equipment-sales__card" key={item.id}>
              {item.main_image_url_snapshot ? <img className="equipment-sales__thumb" src={item.main_image_url_snapshot} alt={item.asset_name_snapshot} /> : null}
              <Top number={item.quotation_number} title={item.asset_name_snapshot} status={item.status} />
              <p>{item.customer_name} · {item.make_snapshot || ""} {item.model_snapshot || ""}</p>
              <Facts values={[["Total", cash(item.total_amount)], ["Deposit", cash(item.deposit_required)], ["Valid until", String(item.validity_date || "—").slice(0, 10)]]} />
              <div className="equipment-sales__card-actions">
                {canManage && item.status === "pending_approval" ? <button type="button" onClick={() => save(() => axiosClient.patch(`${API}/quotations/${item.id}/status`, { status: "approved", reason: "Approved by authorised Equipment Sales user." }), "Quotation approved.")}>Approve</button> : null}
                {canManage && ["approved", "accepted"].includes(item.status) ? <button type="button" className="equipment-sales__primary" onClick={() => newAgreement(item)}>Create agreement</button> : null}
              </div>
            </article>
          ))}
        </List>
      ) : null}

      {!loading && tab === "agreements" ? (
        <List title="Cash and installment agreements" action={canManage && approvedQuotes.length ? () => newAgreement() : null} actionTitle="+ Agreement">
          {agreements.map((item) => <Agreement key={item.id} item={item} canManage={canManage} detail={() => openDetail(item)} act={(name) => openAction(name, item)} />)}
        </List>
      ) : null}

      {drawer === "enquiry" ? (
        <Drawer title="New sales enquiry" subtitle="Record what the customer wants to buy." close={() => setDrawer("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); save(() => axiosClient.post(`${API}/enquiries`, enquiry), "Sales enquiry created."); }}>
            <Customer value={enquiry.customer_id} set={(value) => setEnquiry({ ...enquiry, customer_id: value })} customers={reference.customers} />
            <Field title="Enquiry date"><input type="date" value={enquiry.enquiry_date} onChange={(event) => setEnquiry({ ...enquiry, enquiry_date: event.target.value })} /></Field>
            <Field title="Equipment type"><input required value={enquiry.asset_type} onChange={(event) => setEnquiry({ ...enquiry, asset_type: event.target.value })} /></Field>
            <Field title="Preferred make"><input value={enquiry.preferred_make} onChange={(event) => setEnquiry({ ...enquiry, preferred_make: event.target.value })} /></Field>
            <Field title="Preferred model"><input value={enquiry.preferred_model} onChange={(event) => setEnquiry({ ...enquiry, preferred_model: event.target.value })} /></Field>
            <Field title="Purchase method"><select value={enquiry.purchase_method} onChange={(event) => setEnquiry({ ...enquiry, purchase_method: event.target.value })}><option value="cash">Cash</option><option value="installment">Installment</option><option value="undecided">Undecided</option></select></Field>
            <Field title="Budget"><input type="number" min="0" step="0.01" value={enquiry.budget_amount} onChange={(event) => setEnquiry({ ...enquiry, budget_amount: event.target.value })} /></Field>
            <Field title="Expected purchase"><input type="date" value={enquiry.expected_purchase_date} onChange={(event) => setEnquiry({ ...enquiry, expected_purchase_date: event.target.value })} /></Field>
            <Field title="Notes" wide><textarea rows="3" value={enquiry.notes} onChange={(event) => setEnquiry({ ...enquiry, notes: event.target.value })} /></Field>
            <Buttons saving={saving} close={() => setDrawer("")} title="Save enquiry" />
          </form>
        </Drawer>
      ) : null}

      {drawer === "quote" ? (
        <Drawer title="Equipment quotation" subtitle="Choose the exact excavator and terms." close={() => setDrawer("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); save(() => axiosClient.post(`${API}/quotations`, quote), "Quotation created."); }}>
            <Field title="Linked enquiry"><select value={quote.enquiry_id} onChange={(event) => { const source = enquiries.find((item) => String(item.id) === event.target.value); setQuote({ ...quote, enquiry_id: event.target.value, customer_id: source ? String(source.customer_id) : quote.customer_id }); }}><option value="">Direct quotation</option>{enquiries.filter((item) => ["open", "quoted"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.enquiry_number} · {item.customer_name}</option>)}</select></Field>
            <Customer value={quote.customer_id} set={(value) => setQuote({ ...quote, customer_id: value })} customers={reference.customers} />
            <Field title="Exact equipment" wide><select required value={quote.asset_id} onChange={(event) => chooseAsset(event.target.value)}><option value="">Choose available equipment</option>{reference.assets?.map((item) => <option key={item.id} value={item.id}>{item.asset_code} · {item.asset_name} · {item.make || ""} {item.model || ""}</option>)}</select></Field>
            <Field title="Selling price"><input required type="number" min="0" step="0.01" value={quote.unit_price} onChange={(event) => setQuote({ ...quote, unit_price: event.target.value })} /></Field>
            <Field title="Discount"><input type="number" min="0" step="0.01" value={quote.discount_amount} onChange={(event) => setQuote({ ...quote, discount_amount: event.target.value })} /></Field>
            <Field title="Deposit required"><input type="number" min="0" step="0.01" value={quote.deposit_required} onChange={(event) => setQuote({ ...quote, deposit_required: event.target.value })} /></Field>
            <Field title="Frequency"><select value={quote.proposed_frequency} onChange={(event) => setQuote({ ...quote, proposed_frequency: event.target.value })}><option value="">Cash</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select></Field>
            <Field title="Installment count"><input type="number" min="1" max="120" value={quote.proposed_installment_count} onChange={(event) => setQuote({ ...quote, proposed_installment_count: event.target.value })} /></Field>
            <Field title="First due date"><input type="date" value={quote.proposed_first_due_date} onChange={(event) => setQuote({ ...quote, proposed_first_due_date: event.target.value })} /></Field>
            <Field title="Delivery rule"><select value={quote.delivery_policy} onChange={(event) => setQuote({ ...quote, delivery_policy: event.target.value })}><option value="immediate">Immediate</option><option value="after_deposit">After deposit</option><option value="after_percentage">After percentage</option><option value="after_full_payment">After full payment</option></select></Field>
            <Field title="Terms" wide><textarea rows="4" value={quote.terms} onChange={(event) => setQuote({ ...quote, terms: event.target.value })} /></Field>
            <Buttons saving={saving} close={() => setDrawer("")} title="Create quotation" />
          </form>
        </Drawer>
      ) : null}

      {drawer === "agreement" ? (
        <Drawer title="Cash or installment agreement" subtitle="Reserves the equipment from another sale or hire." close={() => setDrawer("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); save(() => axiosClient.post(`${API}/agreements`, agreement), "Agreement created and equipment reserved."); }}>
            <Field title="Approved quotation" wide><select required value={agreement.quotation_id} onChange={(event) => { const source = approvedQuotes.find((item) => String(item.id) === event.target.value); setAgreement({ ...agreement, quotation_id: event.target.value, deposit_received: String(source?.deposit_required || ""), payment_frequency: source?.proposed_frequency || agreement.payment_frequency, installment_count: String(source?.proposed_installment_count || agreement.installment_count), first_due_date: source?.proposed_first_due_date ? String(source.proposed_first_due_date).slice(0, 10) : agreement.first_due_date }); }}><option value="">Choose quotation</option>{approvedQuotes.map((item) => <option key={item.id} value={item.id}>{item.quotation_number} · {item.customer_name} · {cash(item.total_amount)}</option>)}</select></Field>
            <Field title="Sale type"><select value={agreement.sale_type} onChange={(event) => setAgreement({ ...agreement, sale_type: event.target.value })}><option value="cash">Cash sale</option><option value="installment">Installment sale</option></select></Field>
            <Field title="Deposit received"><input type="number" min="0" step="0.01" value={agreement.deposit_received} onChange={(event) => setAgreement({ ...agreement, deposit_received: event.target.value })} /></Field>
            <Field title="Payment method"><select value={agreement.payment_method} onChange={(event) => setAgreement({ ...agreement, payment_method: event.target.value })}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select></Field>
            {agreement.sale_type === "installment" ? <><Field title="Frequency"><select value={agreement.payment_frequency} onChange={(event) => setAgreement({ ...agreement, payment_frequency: event.target.value })}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select></Field><Field title="Installments"><input type="number" min="1" max="120" value={agreement.installment_count} onChange={(event) => setAgreement({ ...agreement, installment_count: event.target.value })} /></Field><Field title="First due date"><input type="date" value={agreement.first_due_date} onChange={(event) => setAgreement({ ...agreement, first_due_date: event.target.value })} /></Field><Field title="Grace days"><input type="number" min="0" max="90" value={agreement.grace_days} onChange={(event) => setAgreement({ ...agreement, grace_days: event.target.value })} /></Field><Field title="Guarantor name"><input value={agreement.guarantor_name} onChange={(event) => setAgreement({ ...agreement, guarantor_name: event.target.value })} /></Field><Field title="Guarantor phone"><input value={agreement.guarantor_phone} onChange={(event) => setAgreement({ ...agreement, guarantor_phone: event.target.value })} /></Field><Field title="Guarantor ID"><input value={agreement.guarantor_id_number} onChange={(event) => setAgreement({ ...agreement, guarantor_id_number: event.target.value })} /></Field></> : null}
            <label className="equipment-sales__check is-wide"><input required type="checkbox" checked={agreement.terms_accepted} onChange={(event) => setAgreement({ ...agreement, terms_accepted: event.target.checked })} /><span>Customer has accepted the agreement terms.</span></label>
            <Buttons saving={saving} close={() => setDrawer("")} title="Create agreement" />
          </form>
        </Drawer>
      ) : null}

      {drawer === "payment" && selected ? (
        <Drawer title="Record payment" subtitle={`${selected.agreement_number} · ${cash(selected.outstanding_balance)} outstanding`} close={() => setDrawer("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); save(() => axiosClient.post(`${API}/agreements/${selected.id}/payments`, payment), "Payment recorded and SMS receipt submitted."); }}>
            <Field title="Amount"><input required type="number" min="0.01" max={selected.outstanding_balance} step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></Field>
            <Field title="Method"><select value={payment.payment_method} onChange={(event) => setPayment({ ...payment, payment_method: event.target.value })}><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select></Field>
            <Field title="Reference"><input value={payment.reference_number} onChange={(event) => setPayment({ ...payment, reference_number: event.target.value })} /></Field>
            <Field title="Notes" wide><textarea rows="3" value={payment.notes} onChange={(event) => setPayment({ ...payment, notes: event.target.value })} /></Field>
            <Buttons saving={saving} close={() => setDrawer("")} title="Save payment" />
          </form>
        </Drawer>
      ) : null}

      {drawer === "delivery" && selected ? (
        <Drawer title="Record delivery" subtitle={selected.agreement_number} close={() => setDrawer("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); save(() => axiosClient.post(`${API}/agreements/${selected.id}/delivery`, delivery), "Delivery recorded and customer notified."); }}>
            <Field title="Date and time"><input type="datetime-local" value={delivery.delivery_datetime} onChange={(event) => setDelivery({ ...delivery, delivery_datetime: event.target.value })} /></Field>
            <Field title="Destination"><input value={delivery.destination} onChange={(event) => setDelivery({ ...delivery, destination: event.target.value })} /></Field>
            <Field title="Meter"><input type="number" min="0" step="0.01" value={delivery.meter_reading} onChange={(event) => setDelivery({ ...delivery, meter_reading: event.target.value })} /></Field>
            <Field title="Fuel %"><input type="number" min="0" max="100" value={delivery.fuel_level_percent} onChange={(event) => setDelivery({ ...delivery, fuel_level_percent: event.target.value })} /></Field>
            <Field title="Condition"><select value={delivery.condition_status} onChange={(event) => setDelivery({ ...delivery, condition_status: event.target.value })}><option value="new">New</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option></select></Field>
            <Field title="Receiving person"><input required value={delivery.receiving_person} onChange={(event) => setDelivery({ ...delivery, receiving_person: event.target.value })} /></Field>
            <Field title="Receiving phone"><input value={delivery.receiving_phone} onChange={(event) => setDelivery({ ...delivery, receiving_phone: event.target.value })} /></Field>
            <Field title="Attachments/tools" wide><textarea rows="3" value={delivery.attachments_tools} onChange={(event) => setDelivery({ ...delivery, attachments_tools: event.target.value })} /></Field>
            <Buttons saving={saving} close={() => setDrawer("")} title="Confirm delivery" />
          </form>
        </Drawer>
      ) : null}

      {drawer === "transfer" && selected ? (
        <Drawer title="Transfer ownership" subtitle="Full payment and delivery are required." close={() => setDrawer("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); save(() => axiosClient.post(`${API}/agreements/${selected.id}/ownership-transfer`, transfer), "Ownership transferred and equipment marked sold."); }}>
            <Field title="Transfer date"><input type="date" value={transfer.transfer_date} onChange={(event) => setTransfer({ ...transfer, transfer_date: event.target.value })} /></Field>
            <Field title="Registration reference"><input value={transfer.registration_transfer_reference} onChange={(event) => setTransfer({ ...transfer, registration_transfer_reference: event.target.value })} /></Field>
            <Field title="Notes" wide><textarea rows="4" value={transfer.notes} onChange={(event) => setTransfer({ ...transfer, notes: event.target.value })} /></Field>
            <Buttons saving={saving} close={() => setDrawer("")} title="Complete transfer" />
          </form>
        </Drawer>
      ) : null}

      {drawer === "sms" && selected ? (
        <Drawer title="Send customer SMS" subtitle={`${selected.customer_name} · ${selected.customer_phone || "No phone"}`} close={() => setDrawer("")}>
          <form className="equipment-sales__form" onSubmit={(event) => { event.preventDefault(); save(() => axiosClient.post(`${API}/agreements/${selected.id}/sms`, sms), "SMS submitted."); }}>
            <Field title="Message type" wide><select value={sms.reminder_type} onChange={(event) => setSms({ ...sms, reminder_type: event.target.value })}><option value="due_soon">Due soon</option><option value="due_today">Due today</option><option value="overdue">Overdue</option><option value="payment_receipt">Payment receipt</option><option value="delivery_scheduled">Delivery scheduled</option><option value="completed">Completed</option><option value="manual">Custom</option></select></Field>
            {sms.reminder_type === "manual" ? <Field title="Message" wide><textarea required maxLength="480" rows="5" value={sms.message} onChange={(event) => setSms({ ...sms, message: event.target.value })} /></Field> : null}
            <Buttons saving={saving} close={() => setDrawer("")} title="Send SMS" />
          </form>
        </Drawer>
      ) : null}

      {drawer === "detail" && selected ? (
        <Drawer title={selected.agreement_number} subtitle={`${selected.customer_name} · ${selected.asset_name}`} close={() => setDrawer("")}>
          {!detail ? <div className="equipment-sales__loading">Loading agreement…</div> : <Detail data={detail} />}
        </Drawer>
      ) : null}
    </main>
  );
}

function Quick({ icon, title, subtitle, action, disabled = false }) {
  return <button type="button" disabled={disabled} onClick={action}><span>{icon}</span><strong>{title}</strong><small>{subtitle}</small></button>;
}

function List({ title, action, actionTitle, children }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="equipment-sales__section">
      <header><div><p>Equipment Sales</p><h2>{title}</h2></div>{action ? <button type="button" onClick={action}>{actionTitle}</button> : null}</header>
      <div className="equipment-sales__cards">{hasItems ? children : <div className="equipment-sales__empty"><span>🏗️</span><p>No records yet.</p></div>}</div>
    </section>
  );
}

function Top({ number, title, status }) {
  return <div className="equipment-sales__card-top"><div><small>{number}</small><h3>{title}</h3></div><Status value={status} /></div>;
}

function Facts({ values }) {
  return <dl>{values.map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl>;
}

function Customer({ value, set, customers = [] }) {
  return <Field title="Customer" wide><select required value={value} onChange={(event) => set(event.target.value)}><option value="">Choose customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.customer_name} · {item.phone}</option>)}</select></Field>;
}

function Agreement({ item, canManage, detail, act }) {
  const percent = Number(item.total_amount || 0) > 0 ? Math.min(100, (Number(item.amount_paid || 0) / Number(item.total_amount)) * 100) : 0;
  return (
    <article className="equipment-sales__card">
      {item.main_image_url ? <img className="equipment-sales__thumb" src={item.main_image_url} alt={item.asset_name} /> : null}
      <Top number={item.agreement_number} title={item.asset_name} status={item.agreement_status} />
      <p>{item.customer_name} · {text(item.sale_type)}</p>
      <div className="equipment-sales__progress"><span style={{ width: `${percent}%` }} /></div>
      <Facts values={[["Paid", cash(item.amount_paid)], ["Balance", cash(item.outstanding_balance)], ["Next due", item.next_due_date ? String(item.next_due_date).slice(0, 10) : "—"]]} />
      <div className="equipment-sales__card-actions">
        <button type="button" onClick={detail}>View</button>
        {canManage && Number(item.outstanding_balance || 0) > 0 ? <button type="button" className="equipment-sales__primary" onClick={() => act("payment")}>Payment</button> : null}
        {canManage && item.delivery_status !== "delivered" ? <button type="button" onClick={() => act("delivery")}>Delivery</button> : null}
        {canManage && Number(item.outstanding_balance || 0) <= 0.01 && item.delivery_status === "delivered" && item.ownership_status !== "transferred" ? <button type="button" onClick={() => act("transfer")}>Ownership</button> : null}
        {canManage ? <button type="button" onClick={() => act("sms")}>SMS</button> : null}
      </div>
    </article>
  );
}

function Detail({ data }) {
  const item = data.agreement || {};
  return <div className="equipment-sales__detail"><section><h3>Agreement summary</h3><Facts values={[["Customer", item.customer_name], ["Equipment", `${item.asset_code} · ${item.asset_name}`], ["Total", cash(item.total_amount)], ["Paid", cash(item.amount_paid)], ["Outstanding", cash(item.outstanding_balance)], ["Ownership", text(item.ownership_status)]]} /></section>{data.schedule?.length ? <section><h3>Installment schedule</h3><div className="equipment-sales__schedule">{data.schedule.map((row) => <article key={row.id}><div><strong>#{row.sequence_number}</strong><span>{String(row.due_date).slice(0, 10)}</span></div><div><b>{cash(row.scheduled_amount)}</b><Status value={row.schedule_status} /></div></article>)}</div></section> : null}<section><h3>Payments</h3><div className="equipment-sales__schedule">{data.payments?.length ? data.payments.map((row) => <article key={row.id}><div><strong>{row.receipt_number}</strong><span>{String(row.payment_date).slice(0, 10)}</span></div><div><b>{cash(row.amount)}</b><span>{text(row.payment_method)}</span></div></article>) : <p>No payments recorded.</p>}</div></section></div>;
}
