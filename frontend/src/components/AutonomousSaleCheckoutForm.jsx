import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

function clean(value) {
  return String(value ?? "").trim();
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function AutonomousSaleCheckoutForm({ cart, onCompleted, onError, onMessage }) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [matches, setMatches] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocation, setCustomerLocation] = useState("");
  const [paymentType, setPaymentType] = useState("cash");
  const [discountAmount, setDiscountAmount] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [allocations, setAllocations] = useState({ cash: "", momo: "", bank: "", other: "" });
  const [submitting, setSubmitting] = useState(false);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.selling_price || 0) * Number(item.quantity || 0), 0),
    [cart]
  );
  const discount = Math.max(Number(discountAmount || 0), 0);
  const total = Math.max(subtotal - discount, 0);
  const allocationTotal = Object.values(allocations).reduce(
    (sum, value) => sum + Math.max(Number(value || 0), 0),
    0
  );
  const tendered = paymentType === "mixed" ? allocationTotal : Math.max(Number(amountPaid || 0), 0);

  useEffect(() => {
    const query = customerSearch.trim();
    if (query.length < 2 || customerId) {
      setMatches([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await axiosClient.get("/sales/customers", { params: { search: query } });
        if (active) setMatches(response.data?.customers || []);
      } catch {
        if (active) setMatches([]);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerSearch, customerId]);

  function selectCustomer(customer) {
    setCustomerId(String(customer.id));
    setCustomerName(customer.name || "");
    setCustomerPhone(customer.phone || "");
    setCustomerLocation(customer.location || "");
    setCustomerSearch(customer.phone || customer.name || "");
    setMatches([]);
  }

  function clearCustomer() {
    setCustomerId("");
    setCustomerSearch("");
    setMatches([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerLocation("");
  }

  async function completeSale(event) {
    event.preventDefault();
    onError?.("");
    onMessage?.("");

    if (!cart.length) {
      onError?.("Scan at least one item before completing the sale.");
      return;
    }
    if (discount > subtotal) {
      onError?.("Discount cannot be greater than the subtotal.");
      return;
    }
    if (["credit", "mixed"].includes(paymentType) && !clean(customerName) && !clean(customerPhone)) {
      onError?.("Customer name or phone is required for credit or mixed sales.");
      return;
    }
    if (["cash", "momo", "bank"].includes(paymentType) && tendered < total) {
      onError?.(`Amount received must cover GHS ${money(total)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await axiosClient.post("/sales", {
        customer_id: customerId ? Number(customerId) : null,
        customer_name: clean(customerName),
        customer_phone: clean(customerPhone),
        customer_location: clean(customerLocation),
        payment_type: paymentType,
        discount_amount: discount,
        amount_tendered: tendered,
        amount_paid: tendered,
        payment_allocations:
          paymentType === "mixed"
            ? Object.fromEntries(
                Object.entries(allocations).map(([key, value]) => [key, Math.max(Number(value || 0), 0)])
              )
            : { cash: "", momo: "", bank: "", other: "" },
        installment_plan: null,
        items: cart.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
          unit_ids: Array.isArray(item.unit_ids) ? item.unit_ids : [],
        })),
      });
      onCompleted?.(response.data?.receipt || {});
      onMessage?.(
        `Sale completed${response.data?.receipt?.receipt_number ? ` · Receipt ${response.data.receipt.receipt_number}` : ""}.`
      );
      setDiscountAmount("");
      setAmountPaid("");
      setAllocations({ cash: "", momo: "", bank: "", other: "" });
    } catch (saleError) {
      onError?.(apiMessage(saleError, "Unable to complete the autonomous sale."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={completeSale} className="card" style={{ padding: "1rem", display: "grid", gap: "1rem" }}>
      <div>
        <h3 style={{ margin: 0 }}>Customer</h3>
        <p style={{ margin: ".3rem 0 0" }}>
          Leave blank for a walk-in cash/MoMo/bank sale, or find/enter the customer.
        </p>
      </div>

      <div style={{ position: "relative" }}>
        <input
          value={customerSearch}
          onChange={(event) => {
            setCustomerSearch(event.target.value);
            if (customerId) setCustomerId("");
          }}
          placeholder="Search saved customer by name or phone…"
          style={{ width: "100%" }}
        />
        {matches.length ? (
          <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "var(--card-bg, #fff)", border: "1px solid var(--border-color, #d9dde7)", borderRadius: ".7rem", padding: ".4rem", display: "grid" }}>
            {matches.slice(0, 8).map((customer) => (
              <button key={customer.id} type="button" onClick={() => selectCustomer(customer)} style={{ textAlign: "left", padding: ".6rem" }}>
                <strong>{customer.name}</strong> · {customer.phone || "No phone"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: ".7rem" }}>
        <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name (optional for walk-in)" />
        <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Customer phone" />
        <input value={customerLocation} onChange={(event) => setCustomerLocation(event.target.value)} placeholder="Customer location" />
      </div>
      {(customerId || customerName || customerPhone) ? (
        <button type="button" className="secondary-button" onClick={clearCustomer}>Clear customer / Use walk-in</button>
      ) : null}

      <div>
        <h3 style={{ margin: 0 }}>Payment</h3>
        <p style={{ margin: ".3rem 0 0" }}>
          Installment agreements and other complex terms remain available in Manual Sale.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: ".7rem" }}>
        <label>
          Payment type
          <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
            <option value="cash">Cash</option>
            <option value="momo">MoMo</option>
            <option value="bank">Bank</option>
            <option value="credit">Credit</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        <label>
          Discount
          <input type="number" min="0" step="0.01" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} placeholder="0.00" />
        </label>
        {paymentType !== "mixed" ? (
          <label>
            {paymentType === "credit" ? "Amount paid now" : "Amount received"}
            <input type="number" min="0" step="0.01" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} placeholder={money(total)} />
          </label>
        ) : null}
      </div>

      {paymentType === "mixed" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: ".7rem" }}>
          {Object.keys(allocations).map((channel) => (
            <label key={channel}>
              {channel.toUpperCase()}
              <input
                type="number"
                min="0"
                step="0.01"
                value={allocations[channel]}
                onChange={(event) => setAllocations((current) => ({ ...current, [channel]: event.target.value }))}
                placeholder="0.00"
              />
            </label>
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: ".6rem" }}>
        <div><small>Subtotal</small><strong style={{ display: "block" }}>GHS {money(subtotal)}</strong></div>
        <div><small>Discount</small><strong style={{ display: "block" }}>GHS {money(discount)}</strong></div>
        <div><small>Total</small><strong style={{ display: "block" }}>GHS {money(total)}</strong></div>
        <div><small>Received / applied</small><strong style={{ display: "block" }}>GHS {money(tendered)}</strong></div>
      </div>

      <button type="submit" className="primary-button" disabled={submitting || !cart.length}>
        {submitting ? "Completing Sale…" : `Complete Sale · GHS ${money(total)}`}
      </button>
    </form>
  );
}
