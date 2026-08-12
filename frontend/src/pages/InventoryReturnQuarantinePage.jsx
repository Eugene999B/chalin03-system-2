import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/inventoryReturnQuarantine.css";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function label(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

export default function InventoryReturnQuarantinePage() {
  const { branchId, branchName, user } = useAuth();
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [workingCode, setWorkingCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

  const loadQuarantine = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/inventory-traceability/return-quarantine");
      setUnits(response.data?.units || []);
    } catch (loadError) {
      setError(apiMessage(loadError, "Unable to load returned serialized inventory quarantine."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuarantine();
  }, [branchId, loadQuarantine]);

  const visibleUnits = useMemo(() => {
    const query = search.trim().toLowerCase();
    return units.filter((unit) => {
      if (!query) return true;
      return [
        unit.unit_code,
        unit.product_name,
        unit.inventory_product_code,
        unit.receipt_number,
        unit.customer_name,
        unit.customer_phone,
        unit.return_reason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [search, units]);

  function updateDraft(unitCode, field, value) {
    setDrafts((current) => ({
      ...current,
      [unitCode]: {
        outcome: current[unitCode]?.outcome || "restock",
        notes: current[unitCode]?.notes || "",
        [field]: value,
      },
    }));
  }

  async function inspect(unit) {
    const draft = drafts[unit.unit_code] || { outcome: "restock", notes: "" };
    const notes = String(draft.notes || "").trim();
    if (notes.length < 8) {
      setError("Inspection notes must explain what was checked and why the outcome is correct.");
      return;
    }
    if (draft.outcome === "written_off" && !isAdmin) {
      setError("Only an administrator can write off a returned physical inventory unit.");
      return;
    }
    const action = draft.outcome === "restock" ? "make this exact unit sellable again" :
      draft.outcome === "damaged" ? "keep this exact unit as damaged, non-sellable inventory" :
      "write off this exact unit and reduce physical inventory by one";
    if (!window.confirm(`Confirm inspection outcome for ${unit.unit_code}: ${action}?`)) return;

    setWorkingCode(unit.unit_code);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/return-quarantine/${encodeURIComponent(unit.unit_code)}/inspect`,
        { outcome: draft.outcome, notes }
      );
      setMessage(response.data?.message || "Return quarantine inspection completed.");
      setDrafts((current) => {
        const next = { ...current };
        delete next[unit.unit_code];
        return next;
      });
      await loadQuarantine();
    } catch (inspectionError) {
      setError(apiMessage(inspectionError, "Unable to complete return quarantine inspection."));
    } finally {
      setWorkingCode("");
    }
  }

  return (
    <section className="return-quarantine">
      <header className="return-quarantine__hero">
        <div>
          <p className="return-quarantine__eyebrow">Returned serialized stock / controlled release</p>
          <h2>Return Quarantine</h2>
          <p>
            Every enforced serialized item coming back from a customer stays non-sellable here until management inspects that exact physical ID. Restock returns it to active stock; Damaged keeps it non-sellable; Write Off removes one from physical inventory.
          </p>
        </div>
        <div className="return-quarantine__stats">
          <span><strong>{units.length}</strong> awaiting inspection</span>
          <span><strong>{branchName || "Selected store"}</strong></span>
        </div>
      </header>

      {message ? <div className="return-quarantine__notice is-success">{message}</div> : null}
      {error ? <div className="return-quarantine__notice is-error">{error}</div> : null}
      {loading ? <div className="return-quarantine__notice">Loading returned physical IDs…</div> : null}

      <div className="return-quarantine__policy">
        <strong>Quarantine is inventory, not sellable stock.</strong>
        <span>Only a Restock inspection changes the exact ID back to active. Write Off is administrator-only and reduces aggregate physical quantity by exactly one.</span>
      </div>

      <div className="return-quarantine__toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search unit ID, product, receipt, customer or return reason"
        />
        <button type="button" onClick={loadQuarantine} disabled={loading}>Refresh</button>
      </div>

      <div className="return-quarantine__list">
        {visibleUnits.length === 0 && !loading ? (
          <div className="return-quarantine__empty">No returned serialized units are awaiting inspection in this store.</div>
        ) : null}
        {visibleUnits.map((unit) => {
          const draft = drafts[unit.unit_code] || { outcome: "restock", notes: "" };
          const working = workingCode === unit.unit_code;
          return (
            <article key={unit.unit_code} className={`return-quarantine__card is-${unit.inventory_risk_tier || "standard"}`}>
              <div className="return-quarantine__card-head">
                <div>
                  <span>{label(unit.inventory_risk_tier)} risk · {unit.inventory_product_code || "SERIALIZED"}</span>
                  <h3>{unit.product_name}</h3>
                  <strong>{unit.unit_code}</strong>
                </div>
                <em>Returned quarantine</em>
              </div>

              <dl>
                <div><dt>Receipt</dt><dd>{unit.receipt_number || `Sale #${unit.sale_id || "-"}`}</dd></div>
                <div><dt>Customer</dt><dd>{unit.customer_name || "Walk-in Customer"}</dd></div>
                <div><dt>Returned</dt><dd>{dateTime(unit.returned_at || unit.status_changed_at)}</dd></div>
                <div><dt>Return type</dt><dd>{label(unit.return_type)}</dd></div>
                <div><dt>Refund</dt><dd>GHS {Number(unit.refund_amount || 0).toFixed(2)}</dd></div>
                <div><dt>Reason</dt><dd>{unit.return_reason || "-"}</dd></div>
              </dl>

              <div className="return-quarantine__inspection">
                <label>
                  <span>Inspection outcome</span>
                  <select
                    value={draft.outcome}
                    onChange={(event) => updateDraft(unit.unit_code, "outcome", event.target.value)}
                  >
                    <option value="restock">Restock — inspected OK / sellable</option>
                    <option value="damaged">Damaged — keep non-sellable inventory</option>
                    {isAdmin ? <option value="written_off">Write Off — remove from physical inventory</option> : null}
                  </select>
                </label>
                <label className="return-quarantine__notes">
                  <span>Inspection evidence / notes</span>
                  <textarea
                    rows={3}
                    value={draft.notes}
                    onChange={(event) => updateDraft(unit.unit_code, "notes", event.target.value)}
                    placeholder="Example: Seal intact, correct item and size, no leakage; safe to return to shelf."
                  />
                </label>
                <button type="button" disabled={working} onClick={() => inspect(unit)}>
                  {working ? "Saving inspection…" : "Complete Inspection"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
