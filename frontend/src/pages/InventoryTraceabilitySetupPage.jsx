import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import InventoryLabelStudio from "../components/InventoryLabelStudio";
import "../styles/inventoryTraceability.css";
import "../styles/inventoryLabelStudioSimple.css";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function InventoryTraceabilitySetupPage() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDetail, setProductDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [studioVersion, setStudioVersion] = useState(0);
  const [advanced, setAdvanced] = useState({
    risk_tier: "standard",
    traceability_state: "setup",
  });
  const [unitLookup, setUnitLookup] = useState("");
  const [unitResult, setUnitResult] = useState(null);

  const loadProducts = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/products");
    setProducts(response.data?.products || []);
  }, []);

  const loadProduct = useCallback(async (productId) => {
    if (!productId) {
      setProductDetail(null);
      return null;
    }
    const response = await axiosClient.get(
      `/inventory-traceability/products/${productId}`
    );
    setProductDetail(response.data);
    setAdvanced({
      risk_tier: response.data?.product?.inventory_risk_tier || "standard",
      traceability_state:
        response.data?.product?.inventory_traceability_state === "enforced"
          ? "enforced"
          : "setup",
    });
    return response.data;
  }, []);

  const refresh = useCallback(
    async (productId = selectedProductId) => {
      await loadProducts();
      if (productId) await loadProduct(productId);
      setStudioVersion((value) => value + 1);
    },
    [loadProduct, loadProducts, selectedProductId]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const sync = await axiosClient.post(
          "/inventory-traceability/sale-scan/sync-automatic-identities"
        );
        if (!active) return;
        if (Number(sync.data?.automatic_ids_created || 0) > 0) {
          setNotice(sync.data.message);
        }
        await loadProducts();
      } catch (loadError) {
        if (active) {
          setError(
            apiMessage(
              loadError,
              "Unable to reconcile and load automatic product IDs."
            )
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadProducts]);

  useEffect(() => {
    if (!selectedProductId) {
      setProductDetail(null);
      return;
    }
    loadProduct(selectedProductId).catch((loadError) =>
      setError(apiMessage(loadError, "Unable to load this product."))
    );
  }, [loadProduct, selectedProductId]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.name, product.size, product.category, product.barcode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [products, search]);

  const product = productDetail?.product || null;
  const pending = number(product?.pending_identity_count);
  const active = number(product?.active_identity_count);
  const totalIds = number(product?.inventory_identity_count);
  const ready = Boolean(product?.ready_for_serialized_enforcement);

  async function saveAdvanced(event) {
    event.preventDefault();
    if (!product || !isAdmin) return;
    setBusy("advanced");
    setError("");
    try {
      const response = await axiosClient.put(
        `/inventory-traceability/products/${product.id}/config`,
        {
          tracking_mode: "serialized",
          traceability_state: advanced.traceability_state,
          product_code: product.inventory_product_code,
          risk_tier: advanced.risk_tier,
        }
      );
      setNotice(response.data?.message || "Advanced settings saved.");
      await refresh(product.id);
    } catch (saveError) {
      setError(
        apiMessage(saveError, "Unable to save advanced traceability settings.")
      );
    } finally {
      setBusy("");
    }
  }

  async function findUnit(event) {
    event.preventDefault();
    if (!unitLookup.trim()) return;
    setBusy("lookup");
    setError("");
    setUnitResult(null);
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/scan/verify",
        { value: unitLookup.trim() }
      );
      setUnitResult(response.data);
    } catch (lookupError) {
      setError(apiMessage(lookupError, "That exact stock ID was not found."));
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <div className="traceability-loading">
        Checking automatic IDs for your current stock…
      </div>
    );
  }

  return (
    <div className="traceability-page">
      <section className="simple-traceability-start">
        <header className="simple-traceability-start__intro">
          <p className="traceability-eyebrow">Automatic Product IDs & Labels</p>
          <h1>Your stock IDs are created automatically.</h1>
          <p>
            You no longer prepare IDs here. Creating a product creates IDs for its
            opening quantity. Restocking or recording a supplier purchase creates new
            IDs for the added quantity automatically. This workspace is mainly for
            printing labels, reprints and exact-ID lookup.
          </p>
        </header>

        <div className="traceability-safety-banner">
          <strong>One physical item keeps one identity.</strong>{" "}
          New stock always receives a new ID. A sold ID is reused only when that same
          physical item is genuinely returned through the controlled return workflow.
        </div>

        {error ? (
          <div className="traceability-message traceability-message--error">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="traceability-message traceability-message--success">
            {notice}
          </div>
        ) : null}

        <section className="simple-traceability-start__product">
          <h2>Choose a product to print</h2>
          <p>
            Product selection only focuses the printing workspace. It does not create
            or activate IDs; those already follow stock automatically.
          </p>
          <div className="simple-traceability-start__selector">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product name, size, category or barcode…"
            />
            <select
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
            >
              <option value="">All products / select one…</option>
              {filteredProducts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.size ? ` — ${item.size}` : ""} · Qty {number(item.quantity)}
                </option>
              ))}
            </select>
          </div>

          {product ? (
            <>
              <div className="simple-traceability-start__stats">
                <div>
                  <span>Current stock</span>
                  <strong>{number(product.quantity)}</strong>
                </div>
                <div>
                  <span>Stock IDs</span>
                  <strong>{totalIds}</strong>
                </div>
                <div>
                  <span>Unattached / unprinted-ready</span>
                  <strong>{pending}</strong>
                </div>
                <div>
                  <span>Active labeled IDs</span>
                  <strong>{active}</strong>
                </div>
              </div>
              <p style={{ marginTop: ".6rem" }}>
                Automatic prefix: <b>{product.inventory_product_code || "—"}</b> ·
                Individual IDs are generated by Chalin One and cannot be manually invented.
              </p>
            </>
          ) : null}
        </section>
      </section>

      <InventoryLabelStudio
        key={studioVersion}
        preferredProductId={selectedProductId || null}
        onChanged={() => refresh(selectedProductId)}
      />

      <details className="simple-traceability-advanced">
        <summary>Advanced settings & exact-ID lookup</summary>
        <p>Most daily label work does not need these controls.</p>

        {product ? (
          <form
            onSubmit={saveAdvanced}
            className="simple-traceability-advanced__grid"
          >
            <label>
              Tracking
              <input readOnly value="Automatic exact physical IDs" />
            </label>
            <label>
              Automatic product prefix
              <input readOnly value={product.inventory_product_code || "—"} />
            </label>
            <label>
              Risk tier
              <select
                disabled={!isAdmin}
                value={advanced.risk_tier}
                onChange={(event) =>
                  setAdvanced((current) => ({
                    ...current,
                    risk_tier: event.target.value,
                  }))
                }
              >
                <option value="standard">Standard</option>
                <option value="elevated">Elevated</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Sales enforcement
              <select
                disabled={!isAdmin}
                value={advanced.traceability_state}
                onChange={(event) =>
                  setAdvanced((current) => ({
                    ...current,
                    traceability_state: event.target.value,
                  }))
                }
              >
                <option value="setup">
                  Automatic — Manual sale can use unprinted internal IDs
                </option>
                <option
                  value="enforced"
                  disabled={!ready && advanced.traceability_state !== "enforced"}
                >
                  Enforced — exact physical ID required at sale
                </option>
              </select>
            </label>
            {isAdmin ? (
              <button
                type="submit"
                className="simple-label-studio__primary"
                disabled={busy === "advanced"}
              >
                {busy === "advanced" ? "Saving…" : "Save Advanced Settings"}
              </button>
            ) : null}
          </form>
        ) : null}

        <form
          onSubmit={findUnit}
          className="simple-traceability-start__selector"
          style={{ marginTop: "1rem" }}
        >
          <input
            value={unitLookup}
            onChange={(event) => setUnitLookup(event.target.value)}
            placeholder="Scan or enter an exact ID to see its history…"
          />
          <button
            type="submit"
            className="simple-label-studio__primary"
            disabled={!unitLookup.trim() || busy === "lookup"}
          >
            {busy === "lookup" ? "Looking up…" : "Find ID"}
          </button>
        </form>

        {unitResult?.unit ? (
          <div
            className="traceability-message traceability-message--success"
            style={{ marginTop: ".7rem" }}
          >
            <strong>{unitResult.unit.unit_code}</strong> ·{" "}
            {unitResult.unit.product_name} · {unitResult.unit.status}
          </div>
        ) : null}
      </details>
    </div>
  );
}
