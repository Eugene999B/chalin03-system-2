import { useState } from "react";
import AutonomousSaleScanner from "../components/AutonomousSaleScanner";
import AutonomousSaleCheckoutForm from "../components/AutonomousSaleCheckoutForm";

function clean(value) {
  return String(value ?? "").trim();
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

export default function AutonomousSalePage() {
  const [cart, setCart] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);

  async function addResolvedScan(data) {
    const product = data.product;
    const exactCode = clean(data.unit?.unit_code).toUpperCase();
    if (!product?.id) throw new Error("The scan did not identify a valid product.");

    if (exactCode && cart.some((item) => (item.unit_ids || []).includes(exactCode))) {
      throw new Error(`${exactCode} is already in this sale.`);
    }

    const existing = cart.find((item) => Number(item.id) === Number(product.id));
    const nextQuantity = Number(existing?.quantity || 0) + 1;
    if (nextQuantity > Number(product.quantity || 0)) {
      throw new Error(`${product.name} has only ${product.quantity} available in this store.`);
    }

    if (existing) {
      setCart((current) =>
        current.map((item) =>
          Number(item.id) === Number(product.id)
            ? {
                ...item,
                quantity: Number(item.quantity || 0) + 1,
                unit_ids: exactCode
                  ? [...(item.unit_ids || []), exactCode]
                  : item.unit_ids || [],
              }
            : item
        )
      );
    } else {
      setCart((current) => [
        ...current,
        {
          ...product,
          quantity: 1,
          unit_ids: exactCode ? [exactCode] : [],
        },
      ]);
    }

    setReceipt(null);
    setError("");
    setMessage(`${product.name} added at GHS ${money(product.selling_price)}.`);
  }

  function removeLine(productId) {
    setCart((current) => current.filter((item) => Number(item.id) !== Number(productId)));
  }

  function clearSale() {
    setCart([]);
    setReceipt(null);
    setMessage("");
    setError("");
  }

  function saleCompleted(savedReceipt) {
    setReceipt(savedReceipt || {});
    setCart([]);
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section className="card" style={{ padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <p className="traceability-eyebrow">Recommended Checkout</p>
            <h2 style={{ marginTop: 0 }}>Autonomous Scan Sale</h2>
            <p style={{ marginBottom: 0 }}>
              Scan each item. Chalin One identifies the product, exact physical ID when
              present, current selling price and availability, then adds it to the cart.
            </p>
          </div>
          <strong>{cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} item(s)</strong>
        </div>
      </section>

      {error ? <div className="error-box">{error}</div> : null}
      {message ? <div className="success-box">{message}</div> : null}

      <AutonomousSaleScanner onResolvedScan={addResolvedScan} />

      <section className="card" style={{ padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0 }}>Cart</h3>
            <small>Scan each physical item once. Exact IDs stay attached to the correct line.</small>
          </div>
          {cart.length ? (
            <button type="button" className="secondary-button" onClick={clearSale}>Clear Sale</button>
          ) : null}
        </div>

        {!cart.length ? (
          <p style={{ opacity: 0.72 }}>Scan the first item to start the sale.</p>
        ) : (
          <div style={{ display: "grid", gap: ".65rem", marginTop: "1rem" }}>
            {cart.map((item) => (
              <div
                key={item.id}
                style={{
                  border: "1px solid var(--border-color, #d9dde7)",
                  borderRadius: ".8rem",
                  padding: ".8rem",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: ".8rem",
                }}
              >
                <div>
                  <strong>{item.name}{item.size ? ` · ${item.size}` : ""}</strong>
                  <div>
                    GHS {money(item.selling_price)} × {item.quantity} ={" "}
                    <b>GHS {money(Number(item.selling_price) * Number(item.quantity))}</b>
                  </div>
                  {(item.unit_ids || []).length ? (
                    <small>Exact IDs: {(item.unit_ids || []).join(", ")}</small>
                  ) : (
                    <small>General barcode scan — internal unprinted ID assigned safely at checkout</small>
                  )}
                </div>
                <button type="button" className="secondary-button" onClick={() => removeLine(item.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <AutonomousSaleCheckoutForm
        cart={cart}
        onCompleted={saleCompleted}
        onError={setError}
        onMessage={setMessage}
      />

      {receipt ? (
        <section className="success-box">
          <h3 style={{ marginTop: 0 }}>Sale completed</h3>
          <div>Receipt: <strong>{receipt.receipt_number || receipt.sale_id || "Saved"}</strong></div>
          <div>Total: <strong>GHS {money(receipt.total)}</strong></div>
          <div>Customer: <strong>{receipt.customer?.name || receipt.customer_name || "Walk-in Customer"}</strong></div>
        </section>
      ) : null}
    </div>
  );
}
