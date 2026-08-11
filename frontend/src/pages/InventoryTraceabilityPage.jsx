import { useState } from "react";
import InventoryTraceabilitySetupPage from "./InventoryTraceabilitySetupPage";
import InventorySerializedReceivingPage from "./InventorySerializedReceivingPage";
import InventoryLossControlPage from "./InventoryLossControlPage";
import "../styles/inventoryTraceabilityHub.css";

export default function InventoryTraceabilityPage() {
  const [section, setSection] = useState("setup");

  return (
    <div className="inventory-traceability-hub">
      <div className="inventory-traceability-hub__tabs" role="tablist" aria-label="Inventory traceability workspaces">
        <button
          type="button"
          role="tab"
          aria-selected={section === "setup"}
          className={section === "setup" ? "is-active" : ""}
          onClick={() => setSection("setup")}
        >
          <span>1</span>
          <div>
            <strong>Setup & Labels</strong>
            <small>Configure products, inspect identity coverage and complete label activation</small>
          </div>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "receiving"}
          className={section === "receiving" ? "is-active" : ""}
          onClick={() => setSection("receiving")}
        >
          <span>2</span>
          <div>
            <strong>Serialized Receiving</strong>
            <small>Create exact physical IDs directly from recorded supplier purchase lines</small>
          </div>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "loss"}
          className={section === "loss" ? "is-active" : ""}
          onClick={() => setSection("loss")}
        >
          <span>3</span>
          <div>
            <strong>Blind Counts & Investigations</strong>
            <small>Find shortages, exact missing IDs and custody/location discrepancies</small>
          </div>
        </button>
      </div>

      <div role="tabpanel">
        {section === "setup" ? <InventoryTraceabilitySetupPage /> : null}
        {section === "receiving" ? <InventorySerializedReceivingPage /> : null}
        {section === "loss" ? <InventoryLossControlPage /> : null}
      </div>
    </div>
  );
}
