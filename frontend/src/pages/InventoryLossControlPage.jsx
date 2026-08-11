import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import InventoryBlindCountScanner from "../components/InventoryBlindCountScanner";
import { useAuth } from "../context/AuthContext";
import "../styles/inventoryLossControl.css";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function label(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function severityRank(value) {
  return { critical: 0, high: 1, review: 2, notice: 3 }[String(value || "review")] ?? 4;
}

export default function InventoryLossControlPage() {
  const { branchId, branchName, user } = useAuth();
  const [products, setProducts] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [reason, setReason] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [quantityInputs, setQuantityInputs] = useState({});
  const [resolutionDrafts, setResolutionDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const loadProducts = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/products");
    setProducts(response.data?.products || []);
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/loss-control/counts");
    setSessions(response.data?.sessions || []);
  }, []);

  const loadInvestigations = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/loss-control/investigations");
    setInvestigations(response.data?.investigations || []);
  }, []);

  const loadSession = useCallback(async (sessionId) => {
    const response = await axiosClient.get(`/inventory-traceability/loss-control/counts/${sessionId}`);
    setActiveSession(response.data?.session || null);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadProducts(), loadSessions(), loadInvestigations()]);
    } catch (loadError) {
      setError(apiMessage(loadError, "Unable to load Inventory Loss Control."));
    } finally {
      setLoading(false);
    }
  }, [loadInvestigations, loadProducts, loadSessions]);

  useEffect(() => {
    refreshAll();
  }, [branchId, refreshAll]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return [...products]
      .sort((a, b) => {
        const rank = { critical: 0, high: 1, elevated: 2, standard: 3 };
        const riskDifference = (rank[a.inventory_risk_tier] ?? 4) - (rank[b.inventory_risk_tier] ?? 4);
        if (riskDifference !== 0) return riskDifference;
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .filter((product) => {
        if (!query) return true;
        return [product.name, product.category, product.size, product.inventory_product_code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
  }, [products, productSearch]);

  const openSessions = sessions.filter((session) => session.status === "open");
  const openInvestigations = investigations.filter((item) => !["resolved", "closed"].includes(item.status));

  function toggleProduct(productId) {
    const id = Number(productId);
    setSelectedProductIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  async function createCount(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (selectedProductIds.length === 0) {
      setError("Choose at least one product for the blind count.");
      return;
    }
    setWorking(true);
    try {
      const response = await axiosClient.post("/inventory-traceability/loss-control/counts", {
        product_ids: selectedProductIds,
        count_type: "blind_cycle",
        selection_method: "manual",
        reason: reason.trim() || "Routine blind inventory verification",
        area_label: areaLabel.trim() || null,
      });
      const session = response.data?.session;
      setMessage(response.data?.message || "Blind count opened.");
      setSelectedProductIds([]);
      setReason("");
      setAreaLabel("");
      if (session?.id) await loadSession(session.id);
      await loadSessions();
    } catch (createError) {
      setError(apiMessage(createError, "Unable to create blind count."));
    } finally {
      setWorking(false);
    }
  }

  async function recordQuantity(productId) {
    const raw = quantityInputs[productId];
    if (raw === "" || raw === undefined) {
      setError("Enter the physical quantity. Zero is allowed when the shelf is empty.");
      return;
    }
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/loss-control/counts/${activeSession.id}/quantity-observations`,
        { product_id: productId, quantity: Number(raw) }
      );
      setMessage(response.data?.message || "Physical quantity recorded.");
      await loadSession(activeSession.id);
    } catch (recordError) {
      setError(apiMessage(recordError, "Unable to record physical quantity."));
    } finally {
      setWorking(false);
    }
  }

  async function submitCount() {
    if (!activeSession?.id) return;
    const confirmed = window.confirm(
      "Submit this blind count now? After submission CHALIN will reveal the frozen expected values and open investigations for every unexplained variance."
    );
    if (!confirmed) return;
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/loss-control/counts/${activeSession.id}/submit`
      );
      setMessage(response.data?.message || "Blind count submitted.");
      await Promise.all([loadSession(activeSession.id), loadSessions(), loadInvestigations()]);
    } catch (submitError) {
      setError(apiMessage(submitError, "Unable to submit blind count."));
    } finally {
      setWorking(false);
    }
  }

  function updateResolution(id, field, value) {
    setResolutionDrafts((current) => ({
      ...current,
      [id]: {
        category: current[id]?.category || "found",
        notes: current[id]?.notes || "",
        [field]: value,
      },
    }));
  }

  async function resolveInvestigation(investigation) {
    const draft = resolutionDrafts[investigation.id] || {};
    const category = draft.category || "found";
    const notes = String(draft.notes || "").trim();
    if (notes.length < 8) {
      setError("Add resolution notes explaining the evidence and outcome.");
      return;
    }
    if (category === "confirmed_loss" && !isAdmin) {
      setError("Only an administrator can classify an investigation as confirmed loss.");
      return;
    }
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/loss-control/investigations/${investigation.id}/resolve`,
        { resolution_category: category, resolution_notes: notes }
      );
      setMessage(response.data?.message || "Investigation resolved.");
      setResolutionDrafts((current) => {
        const next = { ...current };
        delete next[investigation.id];
        return next;
      });
      await Promise.all([loadInvestigations(), loadSessions()]);
      if (activeSession?.id) await loadSession(activeSession.id);
    } catch (resolveError) {
      setError(apiMessage(resolveError, "Unable to resolve investigation."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="inventory-loss-control">
      <header className="inventory-loss-control__hero">
        <div>
          <p className="inventory-loss-control__eyebrow">Loss prevention / physical verification</p>
          <h2>Blind Counts & Investigations</h2>
          <p>
            Count what is physically present before CHALIN reveals what the system expected. Exact serialized shortages retain the missing unit ID, last-known event and prior custody evidence.
          </p>
        </div>
        <div className="inventory-loss-control__hero-stats">
          <span><strong>{openSessions.length}</strong> open counts</span>
          <span><strong>{openInvestigations.length}</strong> open investigations</span>
          <span><strong>{branchName || "Selected store"}</strong></span>
        </div>
      </header>

      {message ? <div className="inventory-loss-control__notice is-success">{message}</div> : null}
      {error ? <div className="inventory-loss-control__notice is-error">{error}</div> : null}
      {loading ? <div className="inventory-loss-control__notice">Loading physical-control evidence…</div> : null}

      <div className="inventory-loss-control__policy">
        <strong>Evidence, not accusation.</strong>
        <span>A count variance never automatically adjusts stock, names a worker as responsible, or makes a disciplinary decision.</span>
      </div>

      <div className="inventory-loss-control__grid">
        <form className="inventory-loss-control__panel" onSubmit={createCount}>
          <div className="inventory-loss-control__panel-head">
            <div>
              <span>Start</span>
              <h3>New surprise blind count</h3>
            </div>
            <strong>{selectedProductIds.length} selected</strong>
          </div>

          <label className="inventory-loss-control__field">
            <span>Area / shelf (optional)</span>
            <input value={areaLabel} onChange={(event) => setAreaLabel(event.target.value)} placeholder="Example: Oil Rack A" />
          </label>
          <label className="inventory-loss-control__field">
            <span>Reason</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Routine blind inventory verification" />
          </label>
          <label className="inventory-loss-control__field">
            <span>Find products</span>
            <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search name, category, size or traceability code" />
          </label>

          <div className="inventory-loss-control__product-picker">
            {filteredProducts.slice(0, 80).map((product) => {
              const selected = selectedProductIds.includes(Number(product.id));
              return (
                <label key={product.id} className={selected ? "is-selected" : ""}>
                  <input type="checkbox" checked={selected} onChange={() => toggleProduct(product.id)} />
                  <span>
                    <strong>{product.name}</strong>
                    <small>
                      {label(product.inventory_tracking_mode)} · {label(product.inventory_risk_tier)} risk
                      {product.inventory_product_code ? ` · ${product.inventory_product_code}` : ""}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <button className="inventory-loss-control__primary" type="submit" disabled={working || selectedProductIds.length === 0}>
            {working ? "Opening count…" : "Open Blind Count"}
          </button>
        </form>

        <div className="inventory-loss-control__panel">
          <div className="inventory-loss-control__panel-head">
            <div>
              <span>Recent</span>
              <h3>Count sessions</h3>
            </div>
            <button type="button" className="inventory-loss-control__link-button" onClick={loadSessions}>Refresh</button>
          </div>
          <div className="inventory-loss-control__session-list">
            {sessions.length === 0 ? <p>No blind counts have been created yet.</p> : null}
            {sessions.map((session) => (
              <button
                type="button"
                key={session.id}
                className={Number(activeSession?.id) === Number(session.id) ? "is-active" : ""}
                onClick={() => loadSession(session.id).catch((loadError) => setError(apiMessage(loadError, "Unable to open count.")))}
              >
                <span>
                  <strong>{session.session_code}</strong>
                  <small>{label(session.status)} · {number(session.product_count)} products</small>
                </span>
                <em>{number(session.exception_product_count)} exception products</em>
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeSession ? (
        <div className="inventory-loss-control__panel inventory-loss-control__active-count">
          <div className="inventory-loss-control__panel-head">
            <div>
              <span>{activeSession.blind_expected_values_hidden ? "Blind / expected values hidden" : "Submitted / comparison revealed"}</span>
              <h3>{activeSession.session_code}</h3>
              <p>{activeSession.area_label || "No area label"} · {label(activeSession.status)}</p>
            </div>
            {activeSession.status === "open" ? (
              <button type="button" className="inventory-loss-control__primary" disabled={working} onClick={submitCount}>Submit Count</button>
            ) : null}
          </div>

          {activeSession.status === "open" ? (
            <InventoryBlindCountScanner
              sessionId={activeSession.id}
              disabled={working}
              onObserved={() => loadSession(activeSession.id)}
            />
          ) : null}

          <div className="inventory-loss-control__scope-grid">
            {(activeSession.scopes || []).map((scope) => (
              <article key={scope.id} className={`inventory-loss-control__scope is-${scope.risk_tier_snapshot}`}>
                <div className="inventory-loss-control__scope-head">
                  <div>
                    <strong>{scope.product_name}</strong>
                    <small>{label(scope.tracking_mode_snapshot)} · {label(scope.risk_tier_snapshot)} risk</small>
                  </div>
                  {activeSession.blind_expected_values_hidden ? <span>Expected hidden</span> : <span>{label(scope.review_status || "recorded")}</span>}
                </div>

                {activeSession.status === "open" && scope.tracking_mode_snapshot !== "serialized" ? (
                  <div className="inventory-loss-control__quantity-count">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={quantityInputs[scope.product_id] ?? ""}
                      onChange={(event) => setQuantityInputs((current) => ({ ...current, [scope.product_id]: event.target.value }))}
                      placeholder="Physical count (0 allowed)"
                    />
                    <button type="button" disabled={working} onClick={() => recordQuantity(scope.product_id)}>Record</button>
                  </div>
                ) : null}

                {activeSession.blind_expected_values_hidden ? (
                  <dl>
                    <div><dt>Accepted observations</dt><dd>{number(scope.progress?.accepted_observations)}</dd></div>
                    <div><dt>Duplicates</dt><dd>{number(scope.progress?.duplicate_observations)}</dd></div>
                    <div><dt>Exceptions seen</dt><dd>{number(scope.progress?.exception_observations)}</dd></div>
                  </dl>
                ) : (
                  <dl>
                    <div><dt>Expected</dt><dd>{number(scope.expected_system_quantity)}</dd></div>
                    <div><dt>Observed</dt><dd>{number(scope.observed_quantity)}</dd></div>
                    <div><dt>Variance</dt><dd className={number(scope.variance_quantity) === 0 ? "is-ok" : "is-variance"}>{number(scope.variance_quantity)}</dd></div>
                    <div><dt>Missing IDs</dt><dd className={number(scope.missing_identity_count) ? "is-variance" : "is-ok"}>{number(scope.missing_identity_count)}</dd></div>
                    <div><dt>Unexpected IDs</dt><dd className={number(scope.unexpected_identity_count) ? "is-variance" : "is-ok"}>{number(scope.unexpected_identity_count)}</dd></div>
                  </dl>
                )}
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="inventory-loss-control__panel">
        <div className="inventory-loss-control__panel-head">
          <div>
            <span>Evidence review</span>
            <h3>Investigations</h3>
          </div>
          <button type="button" className="inventory-loss-control__link-button" onClick={loadInvestigations}>Refresh</button>
        </div>
        <div className="inventory-loss-control__investigations">
          {[...investigations]
            .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
            .map((investigation) => {
              const resolved = ["resolved", "closed"].includes(investigation.status);
              const draft = resolutionDrafts[investigation.id] || { category: "found", notes: "" };
              return (
                <article key={investigation.id} className={`is-${investigation.severity} ${resolved ? "is-resolved" : ""}`}>
                  <div className="inventory-loss-control__investigation-head">
                    <div>
                      <span>{label(investigation.severity)} · {label(investigation.investigation_type)}</span>
                      <strong>{investigation.investigation_code}</strong>
                      <small>{investigation.product_name}{investigation.unit_code ? ` · ${investigation.unit_code}` : ""}</small>
                    </div>
                    <em>{label(investigation.status)}</em>
                  </div>
                  <dl>
                    <div><dt>Count</dt><dd>{investigation.session_code || "-"}</dd></div>
                    <div><dt>Variance</dt><dd>{investigation.variance_quantity ?? "-"}</dd></div>
                    <div><dt>Unit evidence</dt><dd>{label(investigation.variance_type || "quantity variance")}</dd></div>
                  </dl>

                  {!resolved ? (
                    <div className="inventory-loss-control__resolution">
                      <select value={draft.category} onChange={(event) => updateResolution(investigation.id, "category", event.target.value)}>
                        <option value="found">Found / physically located</option>
                        <option value="count_error">Count error</option>
                        <option value="transfer_issue">Transfer / location issue</option>
                        <option value="damage">Damage</option>
                        {isAdmin ? <option value="confirmed_loss">Confirmed loss</option> : null}
                        <option value="other">Other evidence-based outcome</option>
                      </select>
                      <textarea
                        value={draft.notes}
                        onChange={(event) => updateResolution(investigation.id, "notes", event.target.value)}
                        placeholder="Explain what was checked, what evidence was found, and why this outcome is correct."
                        rows={3}
                      />
                      <button type="button" disabled={working} onClick={() => resolveInvestigation(investigation)}>Resolve Evidence</button>
                    </div>
                  ) : (
                    <p className="inventory-loss-control__resolved-note">Resolved as {label(investigation.resolution_category)}. Stock and worker fault remain separate controlled decisions.</p>
                  )}
                </article>
              );
            })}
          {investigations.length === 0 ? <p>No inventory investigations yet.</p> : null}
        </div>
      </div>
    </section>
  );
}
