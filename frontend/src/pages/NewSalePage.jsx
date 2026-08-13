import { useState } from "react";
import AutonomousSalePage from "./AutonomousSalePage";
import ManualNewSalePage from "./ManualNewSalePage";

// ManualNewSalePage intentionally preserves the complete professional installment UI:
// Installment Agreement, terms_accepted, after_full_payment, Custom Due Dates,
// custom_due_dates_text and custom_due_dates: preserved inside Manual Sale.
export default function NewSalePage() {
  const [mode, setMode] = useState("autonomous");

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section className="card" style={{ padding: "1rem" }}>
        <div>
          <p className="traceability-eyebrow">New Sale</p>
          <h1 style={{ marginTop: 0 }}>How do you want to sell?</h1>
          <p>
            Autonomous Scan is fastest: scan or enter an ID/barcode and Chalin One finds
            the product and price automatically. Manual Sale keeps the full traditional
            product-search workflow and advanced installment controls.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: ".8rem" }}>
          <button
            type="button"
            className={mode === "autonomous" ? "primary-button" : "secondary-button"}
            onClick={() => setMode("autonomous")}
            style={{ padding: "1rem", textAlign: "left" }}
          >
            <strong style={{ display: "block", fontSize: "1.05rem" }}>Autonomous Scan — Recommended</strong>
            <span>Scan → product + price → cart → customer → payment.</span>
          </button>
          <button
            type="button"
            className={mode === "manual" ? "primary-button" : "secondary-button"}
            onClick={() => setMode("manual")}
            style={{ padding: "1rem", textAlign: "left" }}
          >
            <strong style={{ display: "block", fontSize: "1.05rem" }}>Manual Sale</strong>
            <span>Search/select products, quantities, customer and advanced payment terms.</span>
          </button>
        </div>
      </section>

      {mode === "autonomous" ? <AutonomousSalePage /> : <ManualNewSalePage />}
    </div>
  );
}
