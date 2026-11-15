import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import ProtectedFinanceImage, { financeMachineImagePath } from "../components/ProtectedFinanceImage";
import "./../styles/equipmentFinanceReadyCash.css";

const API = "/equipment-catalogue/sales";
const CONDITIONS = ["new", "excellent", "good", "fair", "poor", "damaged"];

function money(value) {
  return "GHS " + Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
function messageFromError(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}
function newCheckoutKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Do not use Math.random for payment idempotency identifiers.
  throw new Error("This browser cannot create secure checkout references. Use an updated browser.");
}
function isAvailable(machine) {
  return Boolean(machine) && machine.sale_status === "available" &&
    ["sale_only", "sale_or_hire"].includes(machine.operational_purpose) &&
    machine.readiness?.ready !== false &&
    Number(machine.active_hire_count || 0) === 0 &&
    Number(machine.active_application_count || 0) === 0 &&
    Number(machine.active_sale_lock_count || 0) === 0;
}
function CheckoutStatus({ sale }) {
  if (!sale) return null;
  const sold = sale.ownership_status === "transferred";
  return <div className="rc-result" role="status">
    <span>{sold ? "Machine sold · ownership transferred" : "Paid in full · awaiting handover"}</span>
    <strong>{sale.agreement_number}</strong>
    <p>Receipt: <b>{sale.receipt_number}</b></p>
    <p>{money(sale.total_amount)} collected · outstanding {money(sale.outstanding_balance)}</p>
    {!sold && <p className="rc-handover-warning">
      A different authorized finance manager must verify the signed handover before
      the asset is marked sold. Payment is already recorded; do not charge again.
    </p>}
  </div>;
}

export default function EquipmentFinanceReadyCashPage() {
  const { effectivePermissions = [], user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const maySell = effectivePermissions.includes("fleet.assets.manage") ||
    ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(role);
  const [customers, setCustomers] = useState([]);
  const [machines, setMachines] = useState([]);
  const [sales, setSales] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [fullPaymentConfirmed, setFullPaymentConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");
  const [checkoutKey, setCheckoutKey] = useState("");
  const [created, setCreated] = useState(null);
  const [handOverId, setHandOverId] = useState("");
  const [receiver, setReceiver] = useState("");
  const [handoverReference, setHandoverReference] = useState("");
  const [condition, setCondition] = useState("");
  const [destination, setDestination] = useState("");
  const [signedConfirmed, setSignedConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const [bootstrapResponse, recentResponse] = await Promise.all([
        axiosClient.get(API + "/phase-one/bootstrap"),
        axiosClient.get(API + "/ready-cash/recent"),
      ]);
      setCustomers(bootstrapResponse.data?.customers || []);
      setMachines(bootstrapResponse.data?.machines || []);
      setSales(recentResponse.data?.sales || []);
      setProblem("");
    } catch (error) {
      setProblem(messageFromError(error, "Could not load Ready Cash customers or machines."));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  const machine = useMemo(() =>
    machines.find((item) => String(item.id) === assetId), [machines, assetId]);
  const customer = useMemo(() =>
    customers.find((item) => String(item.id) === customerId), [customers, customerId]);
  const eligibleMachines = useMemo(() => machines.filter(isAvailable).filter((item) =>
    !assetSearch.trim() || [
      item.asset_code, item.asset_name, item.make, item.model, item.serial_number,
    ].some((value) => String(value || "").toLowerCase().includes(assetSearch.toLowerCase()))
  ), [machines, assetSearch]);
  const eligibleCustomers = useMemo(() => customers.filter((item) =>
    !buyerSearch.trim() || [item.customer_name, item.phone, item.customer_code].some(
      (value) => String(value || "").toLowerCase().includes(buyerSearch.toLowerCase())
    )), [customers, buyerSearch]);
  const finalPrice = Number(machine?.target_selling_price || 0);
  const awaitingHandover = sales.filter((sale) => sale.ownership_status !== "transferred");
  const completed = sales.filter((sale) => sale.ownership_status === "transferred");
  const delayedHandovers = awaitingHandover.filter((sale) =>
    sale.created_at && Date.now() - new Date(sale.created_at).getTime() > 48 * 60 * 60 * 1000
  );
  const selectedHandoverSale = sales.find((sale) => String(sale.id) === String(handOverId));

  function resetCheckout() {
    setCheckoutKey("");
    setFullPaymentConfirmed(false);
    setTermsAccepted(false);
    setCreated(null);
    setProblem("");
    setNotice("");
  }
  function changeCustomer(id) {
    setCustomerId(id);
    resetCheckout();
  }
  function changeMachine(id) {
    setAssetId(id);
    resetCheckout();
  }
  async function recordPayment(event) {
    event.preventDefault();
    setProblem("");
    setNotice("");
    if (!maySell || !customer || !machine || !isAvailable(machine)) {
      setProblem("Choose an eligible machine and active customer with sales permission.");
      return;
    }
    if (!fullPaymentConfirmed || !termsAccepted || !paymentReference.trim() ||
        !Number.isFinite(finalPrice) || finalPrice <= 0) {
      setProblem("Confirm the full amount has already been received, the internal reference, and the customer's terms.");
      return;
    }
    let key = checkoutKey;
    if (!key) {
      try { key = newCheckoutKey(); } catch (error) { setProblem(error.message); return; }
      setCheckoutKey(key);
    }
    setProcessing(true);
    try {
      const { data } = await axiosClient.post(API + "/ready-cash/checkout", {
        customer_id: Number(customerId),
        asset_id: Number(assetId),
        sale_option: "ready_cash",
        amount: finalPrice.toFixed(2),
        full_payment_confirmed: true,
        customer_terms_accepted: true,
        full_payment_reference: paymentReference.trim(),
        idempotency_key: key,
      });
      setCreated({
        agreement_number: data.agreement_number, receipt_number: data.receipt_number,
        total_amount: finalPrice, outstanding_balance: 0, ownership_status: "retained",
      });
      setNotice(data.message);
      await refresh();
    } catch (error) {
      setProblem(messageFromError(error, "Checkout could not be confirmed. Check recent sales before retrying."));
    } finally {
      setProcessing(false);
    }
  }
  async function completeHandover(event) {
    event.preventDefault();
    setProblem("");
    setNotice("");
    if (!handOverId || !receiver.trim() || !handoverReference.trim() ||
        !CONDITIONS.includes(condition) || !signedConfirmed) {
      setProblem("Choose the paid sale and provide the signed handover reference, receiver and actual condition.");
      return;
    }
    setProcessing(true);
    try {
      const { data } = await axiosClient.post(
        API + "/ready-cash/" + handOverId + "/handover",
        {
          receiving_person: receiver.trim(),
          handover_reference: handoverReference.trim(),
          condition_status: condition,
          destination: destination.trim(),
          signed_handover_confirmed: true,
        }
      );
      setNotice(data.message);
      setHandOverId("");
      setReceiver("");
      setHandoverReference("");
      setCondition("");
      setSignedConfirmed(false);
      setDestination("");
      await refresh();
    } catch (error) {
      setProblem(messageFromError(error, "The authorized manager could not complete this handover."));
    } finally {
      setProcessing(false);
    }
  }

  return <main className="ready-cash" data-testid="equipment-ready-cash-workspace">
    <header className="rc-hero">
      <div>
        <span className="rc-eyebrow">CHALIN03 · Equipment Finance</span>
        <h1>Ready Cash</h1>
        <p>One customer. One available machine. One confirmed payment in full.
          No credit application, interest, arrears or installment schedule.</p>
      </div>
      <button type="button" onClick={refresh} disabled={loading || processing}>
        {loading ? "Refreshing…" : "Refresh records"}
      </button>
    </header>
    <section className="rc-stats" aria-label="Ready Cash status">
      <article><span>Available in loaded register</span><strong>{eligibleMachines.length}</strong></article>
      <article><span>Recent paid · awaiting handover</span><strong>{awaitingHandover.length}</strong></article>
      <article><span>Recent sold and transferred</span><strong>{completed.length}</strong></article>
      <article><span>Recent full payments recorded</span><strong>{money(sales.reduce((sum, sale) => sum + Number(sale.amount_paid || 0), 0))}</strong></article>
    </section>

    {delayedHandovers.length > 0 && (
      <div className="rc-intelligence-alert" role="alert">
        <strong>{delayedHandovers.length} paid machine(s) still awaiting handover after 48 hours.</strong>
        <span>Finance management should review signed delivery evidence before marking these assets sold.</span>
      </div>
    )}
    {problem && <div className="rc-error" role="alert">{problem}</div>}
    {notice && <div className="rc-notice" role="status">{notice}</div>}

    <div className="rc-columns">
      <section className="rc-card">
        <header><span>01 · Pay in full</span><h2>Ready Cash — Full Payment</h2>
          <p>Ready Cash means the buyer pays the complete price instead of using installments.
            It does not initiate payments or connect any external provider. Record only a payment
            already confirmed by the business.</p>
        </header>
        <form onSubmit={recordPayment}>
          <label>Find customer
            <input value={buyerSearch} onChange={(e) => setBuyerSearch(e.target.value)} placeholder="Search name, customer code or phone" />
          </label>
          <label>Customer
            <select value={customerId} onChange={(e) => changeCustomer(e.target.value)} required>
              <option value="">Choose an active Finance customer</option>
              {eligibleCustomers.map((item) => <option key={item.id} value={item.id}>{item.customer_name} · {item.phone || "No phone"}</option>)}
            </select>
          </label>
          <label>Find excavator
            <input value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} placeholder="Search model, serial or asset code" />
          </label>
          <label>Available excavator
            <select value={assetId} onChange={(e) => changeMachine(e.target.value)} required>
              <option value="">Choose an available machine</option>
              {eligibleMachines.map((item) => <option key={item.id} value={item.id}>
                {item.asset_code} · {item.asset_name} · {money(item.target_selling_price)}
              </option>)}
            </select>
          </label>
          {machine && <div className="rc-machine-preview">
            <ProtectedFinanceImage
              src={financeMachineImagePath(machine)}
              alt={machine.asset_name || "Selected excavator"}
              className="rc-machine-photo"
            />
            <div>
              <span>Exact machine identity</span>
              <strong>{machine.asset_code} · {machine.asset_name}</strong>
              <small>{machine.make || "Make unrecorded"} {machine.model || ""} · Serial: {machine.serial_number || "Check asset register"}</small>
            </div>
          </div>}
          {machine && <div className="rc-price" aria-live="polite">
            <span>Configured full selling price</span>
            <strong>{money(finalPrice)}</strong>
            <small>No discounts and no financing. The official server price must still match at checkout.</small>
          </div>}
          <label>Internal full-payment confirmation reference
            <input required value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Receipt or approved reconciliation reference" maxLength={150} />
          </label>
          <label className="rc-checkbox">
            <input type="checkbox" checked={fullPaymentConfirmed} onChange={(e) => setFullPaymentConfirmed(e.target.checked)} />
            <span>I confirm that the customer has already paid the entire {money(finalPrice)} and the payment is verified in our existing records.</span>
          </label>
          <label className="rc-checkbox">
            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
            <span>The customer has reviewed and accepted the full-payment sale terms.</span>
          </label>
          <button className="rc-primary" type="submit" disabled={!maySell || processing || loading || !customer || !isAvailable(machine) || !fullPaymentConfirmed || !termsAccepted || !paymentReference.trim()}>
            {processing ? "Recording…" : "Record full payment & reserve machine"}
          </button>
          <p className="rc-muted">The full-payment record is created without an installment schedule. The machine is only marked sold after independent signed handover.</p>
        </form>
        <CheckoutStatus sale={created} />
      </section>

      <section className="rc-card">
        <header><span>02 · Independent confirmation</span><h2>Handover & mark sold</h2>
          <p>A different authorized manager confirms the physical delivery and signed transfer.
            The staff member who recorded the full payment cannot approve their own handover.</p></header>
        <form onSubmit={completeHandover}>
          <label>Fully paid sale awaiting handover
            <select value={handOverId} onChange={(e) => setHandOverId(e.target.value)} required>
              <option value="">Choose a paid Ready Cash sale</option>
              {awaitingHandover.map((sale) =>
                <option value={sale.id} key={sale.id}>{sale.agreement_number} · {sale.customer_name_snapshot} · {sale.asset_code_snapshot}</option>)}
            </select>
          </label>
          {selectedHandoverSale && <CheckoutStatus sale={selectedHandoverSale} />}
          <label>Person physically receiving the machine
            <input required maxLength={150} value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Full name" />
          </label>
          <label>Actual machine condition
            <select required value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Select after inspection</option>
              {CONDITIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>Delivery destination
            <input value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={255} placeholder="Where was the machine handed over?" />
          </label>
          <label>Signed delivery / ownership document reference
            <input required value={handoverReference} onChange={(e) => setHandoverReference(e.target.value)} maxLength={150} placeholder="Signed handover reference" />
          </label>
          <label className="rc-checkbox">
            <input type="checkbox" checked={signedConfirmed} onChange={(e) => setSignedConfirmed(e.target.checked)} />
            <span>I independently verified the physical handover, customer identity and signed document.</span>
          </label>
          <button className="rc-primary" type="submit" disabled={processing || loading || !handOverId || !signedConfirmed}>
            {processing ? "Finalizing…" : "Confirm handover & mark machine sold"}
          </button>
        </form>
      </section>
    </div>

    <section className="rc-card rc-register">
      <header><span>03 · Audit trail</span><h2>Recent Ready Cash sales</h2>
        <p>Paid sales remain visible even before handover. Do not create a second sale to retry an uncertain payment.</p>
      </header>
      <div className="rc-table-scroller">
        <table>
          <thead><tr><th>Agreement</th><th>Machine</th><th>Customer</th><th>Receipt</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>
            {sales.map((sale) => <tr key={sale.id}>
              <td>{sale.agreement_number}</td><td>{sale.asset_code_snapshot} · {sale.asset_name_snapshot}</td>
              <td>{sale.customer_name_snapshot}</td><td>{sale.receipt_number}</td>
              <td>{money(sale.amount_paid)}</td>
              <td>{sale.ownership_status === "transferred" ? "Sold & transferred" : "Fully paid · handover pending"}</td>
            </tr>)}
            {!sales.length && <tr><td colSpan={6}>No Ready Cash transactions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
