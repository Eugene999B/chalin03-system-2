import { useState } from "react";
import InventoryAutomaticLabelsPage from "./InventoryAutomaticLabelsPage";
import InventorySerializedReceivingPage from "./InventorySerializedReceivingPage";
import InventoryReturnQuarantinePage from "./InventoryReturnQuarantinePage";
import InventoryLossControlPage from "./InventoryLossControlPage";
import "../styles/inventoryTraceabilityHub.css";
import "../styles/inventoryBeginnerLabels.css";

export default function InventoryTraceabilityPage() {
  const [section, setSection] = useState("labels");

  return (
    <div className="inventory-traceability-hub">
      <div className="inventory-traceability-hub__tabs" role="tablist" aria-label="Inventory workspaces">
        <button type="button" role="tab" aria-selected={section === "labels"} className={section === "labels" ? "is-active" : ""} onClick={() => setSection("labels")}>
          <span>🏷️</span><div><strong>Labels</strong><small>Automatic IDs & Labels — print new stock and confirm attachment</small></div>
        </button>
        <button type="button" role="tab" aria-selected={section === "returns"} className={section === "returns" ? "is-active" : ""} onClick={() => setSection("returns")}>
          <span>↩</span><div><strong>Returns</strong><small>Return Quarantine — inspect a returned item before restocking</small></div>
        </button>
        <button type="button" role="tab" aria-selected={section === "checks"} className={section === "checks" ? "is-active" : ""} onClick={() => setSection("checks")}>
          <span>✓</span><div><strong>Stock Checks</strong><small>Blind Counts & Investigations — shortages and missing items</small></div>
        </button>
        <button type="button" role="tab" aria-selected={section === "receiving"} className={section === "receiving" ? "is-active" : ""} onClick={() => setSection("receiving")}>
          <span>⚙</span><div><strong>Receiving Detail</strong><small>Supplier Receiving Detail — advanced exact-ID evidence</small></div>
        </button>
      </div>

      <div role="tabpanel">
        {section === "labels" ? <InventoryAutomaticLabelsPage /> : null}
        {section === "returns" ? <InventoryReturnQuarantinePage /> : null}
        {section === "checks" ? <InventoryLossControlPage /> : null}
        {section === "receiving" ? <InventorySerializedReceivingPage /> : null}
      </div>
    </div>
  );
}
