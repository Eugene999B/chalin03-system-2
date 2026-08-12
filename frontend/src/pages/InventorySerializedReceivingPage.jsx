import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/inventorySerializedReceiving.css";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function label(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fileNameFromHeader(headerValue, fallback) {
  const match = String(headerValue || "").match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function downloadBlob(data, contentType, fileName) {
  const blob = new Blob([data], { type: contentType || "application/pdf" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }, 100);
}

export default function InventorySerializedReceivingPage() {
  const { branchId, branchName, user } = useAuth();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [printFormats, setPrintFormats] = useState({});
  const [reprintReasons, setReprintReasons] = useState({});
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/inventory-traceability/receiving/purchase-items");
      setItems(response.data?.items || []);
    } catch (loadError) {
      setError(apiMessage(loadError, "Unable to load serialized receiving work."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [branchId, loadQueue]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const statusRank = {
      needs_labels: 0,
      batch_in_progress: 1,
      quantity_exception: 2,
      complete: 3,
    };
    return [...items]
      .filter((item) => {
        if (statusFilter === "open" && item.identity_work_status === "complete") return false;
        if (statusFilter !== "all" && statusFilter !== "open" && item.identity_work_status !== statusFilter) return false;
        if (!query) return true;
        return [
          item.product_name,
          item.inventory_product_code,
          item.invoice_number,
          item.supplier_name,
          item.batch_code,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        const statusDifference =
          (statusRank[a.identity_work_status] ?? 9) -
          (statusRank[b.identity_work_status] ?? 9);
        if (statusDifference !== 0) return statusDifference;
        return new Date(b.purchase_date || b.purchase_created_at || 0) - new Date(a.purchase_date || a.purchase_created_at || 0);
      });
  }, [items, search, statusFilter]);

  const summary = useMemo(() => {
    return items.reduce(
      (result, item) => {
        result.total += 1;
        result[item.identity_work_status] = (result[item.identity_work_status] || 0) + 1;
        return result;
      },
      { total: 0, needs_labels: 0, batch_in_progress: 0, complete: 0, quantity_exception: 0 }
    );
  }, [items]);

  async function prepareBatch(item) {
    setWorkingId(item.purchase_item_id);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/receiving/purchase-items/${item.purchase_item_id}/label-batch`,
        {
          notes: `Serialized receiving from purchase ${item.invoice_number || `#${item.purchase_id}`}. Exact quantity taken from the recorded supplier purchase line.`,
        }
      );
      const batch = response.data?.batch;
      setMessage(
        `${response.data?.message || "Exact identities prepared."}${batch?.batch_code ? ` Batch ${batch.batch_code}.` : ""}`
      );
      await loadQueue();
    } catch (prepareError) {
      setError(apiMessage(prepareError, "Unable to prepare exact purchase identities."));
    } finally {
      setWorkingId(null);
    }
  }

  async function printBatch(item) {
    const batchId = Number(item.label_batch_id);
    if (!batchId) return;
    const format = printFormats[batchId] || "a4";
    const isReprint = Number(item.print_event_count || 0) > 0 || Boolean(item.label_batch_status === "printed");
    const reason = String(reprintReasons[batchId] || "").trim();
    if (isReprint && !isAdmin) {
      setError("Only an administrator can reprint a controlled inventory identity batch.");
      return;
    }
    if (isReprint && reason.length < 8) {
      setError("Enter a clear reprint reason of at least 8 characters.");
      return;
    }

    setWorkingId(item.purchase_item_id);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/label-batches/${batchId}/print`,
        {
          print_format: format,
          reason: isReprint ? reason : "Initial controlled receiving-label print",
        },
        { responseType: "blob" }
      );
      const fallback = `${item.batch_code || `inventory-labels-${batchId}`}.pdf`;
      const fileName = fileNameFromHeader(response.headers?.["content-disposition"], fallback);
      downloadBlob(response.data, response.headers?.["content-type"], fileName);
      setMessage(
        isReprint
          ? "Controlled label reprint downloaded and audit evidence recorded."
          : "Controlled inventory labels downloaded and the print event was recorded in CHALIN."
      );
      setReprintReasons((current) => ({ ...current, [batchId]: "" }));
      await loadQueue();
    } catch (printError) {
      let fallbackMessage = "Unable to generate controlled receiving labels.";
      if (printError?.response?.data instanceof Blob) {
        try {
          const text = await printError.response.data.text();
          const parsed = JSON.parse(text);
          fallbackMessage = parsed.message || fallbackMessage;
        } catch {
          // Keep the safe fallback for non-JSON blobs.
        }
      }
      setError(apiMessage(printError, fallbackMessage));
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <section className="serialized-receiving">
      <header className="serialized-receiving__hero">
        <div>
          <p className="serialized-receiving__eyebrow">Supplier receiving / identity control</p>
          <h2>Serialized Receiving</h2>
          <p>
            CHALIN takes the physical-ID quantity from the exact recorded supplier purchase line. Staff do not type a second stock quantity, and the same purchase item cannot mint another identity batch.
          </p>
        </div>
        <div className="serialized-receiving__stats">
          <span><strong>{summary.needs_labels}</strong> need labels</span>
          <span><strong>{summary.batch_in_progress}</strong> in progress</span>
          <span><strong>{summary.quantity_exception}</strong> exceptions</span>
          <span><strong>{branchName || "Selected store"}</strong></span>
        </div>
      </header>

      {message ? <div className="serialized-receiving__notice is-success">{message}</div> : null}
      {error ? <div className="serialized-receiving__notice is-error">{error}</div> : null}
      {loading ? <div className="serialized-receiving__notice">Loading serialized supplier purchases…</div> : null}

      <div className="serialized-receiving__flow">
        <div><strong>1</strong><span>Purchase is recorded normally</span></div>
        <div><strong>2</strong><span>Prepare exact IDs from that purchase line</span></div>
        <div><strong>3</strong><span>Print and physically attach controlled labels</span></div>
        <div><strong>4</strong><span>Another authorized person verifies/activates in Setup & Labels</span></div>
      </div>

      <div className="serialized-receiving__filters">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search product, supplier, invoice, code or batch"
          aria-label="Search serialized receiving"
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="open">Open work</option>
          <option value="needs_labels">Needs labels</option>
          <option value="batch_in_progress">Batch in progress</option>
          <option value="quantity_exception">Quantity exceptions</option>
          <option value="complete">Complete</option>
          <option value="all">All receiving history</option>
        </select>
        <button type="button" onClick={loadQueue} disabled={loading}>Refresh</button>
      </div>

      <div className="serialized-receiving__list">
        {visibleItems.length === 0 && !loading ? (
          <div className="serialized-receiving__empty">No serialized purchase lines match this view.</div>
        ) : null}

        {visibleItems.map((item) => {
          const batchId = Number(item.label_batch_id || 0);
          const working = Number(workingId) === Number(item.purchase_item_id);
          const status = item.identity_work_status || "needs_labels";
          const canPrint = batchId > 0 && ["generated", "printed", "verification"].includes(String(item.label_batch_status || ""));
          const likelyReprint = String(item.label_batch_status || "") === "printed";
          return (
            <article key={item.purchase_item_id} className={`serialized-receiving__card is-${status}`}>
              <div className="serialized-receiving__card-head">
                <div>
                  <span>{item.inventory_product_code || "SERIALIZED"} · {label(item.inventory_risk_tier)} risk</span>
                  <h3>{item.product_name}</h3>
                  <p>
                    {item.supplier_name || "Supplier not named"} · Invoice {item.invoice_number || `#${item.purchase_id}`} · {formatDate(item.purchase_date)}
                  </p>
                </div>
                <strong>{label(status)}</strong>
              </div>

              <dl>
                <div><dt>Recorded purchase qty</dt><dd>{Number(item.purchased_quantity || 0)}</dd></div>
                <div><dt>Unit cost</dt><dd>GHS {money(item.cost_price)}</dd></div>
                <div><dt>Generated IDs</dt><dd>{Number(item.generated_quantity || 0)}</dd></div>
                <div><dt>Activated IDs</dt><dd>{Number(item.activated_quantity || 0)}</dd></div>
                <div><dt>Voided labels</dt><dd>{Number(item.voided_quantity || 0)}</dd></div>
                <div><dt>Batch</dt><dd>{item.batch_code || "Not prepared"}</dd></div>
              </dl>

              {status === "needs_labels" ? (
                <div className="serialized-receiving__action-box">
                  <p>
                    This will generate exactly <strong>{Number(item.purchased_quantity || 0)}</strong> physical IDs from purchase item #{item.purchase_item_id}. The quantity cannot be changed here.
                  </p>
                  <button type="button" disabled={working} onClick={() => prepareBatch(item)}>
                    {working ? "Preparing…" : `Prepare ${Number(item.purchased_quantity || 0)} Exact IDs`}
                  </button>
                </div>
              ) : null}

              {canPrint ? (
                <div className="serialized-receiving__print-box">
                  <label>
                    <span>Label format</span>
                    <select
                      value={printFormats[batchId] || "a4"}
                      onChange={(event) => setPrintFormats((current) => ({ ...current, [batchId]: event.target.value }))}
                    >
                      <option value="a4">A4 sheet — many labels</option>
                      <option value="thermal">58mm thermal</option>
                      <option value="sticker">50×30mm sticker</option>
                    </select>
                  </label>
                  {likelyReprint && isAdmin ? (
                    <label className="serialized-receiving__reprint-reason">
                      <span>Admin reprint reason</span>
                      <input
                        value={reprintReasons[batchId] || ""}
                        onChange={(event) => setReprintReasons((current) => ({ ...current, [batchId]: event.target.value }))}
                        placeholder="Why are these labels being printed again?"
                      />
                    </label>
                  ) : null}
                  <button type="button" disabled={working || (likelyReprint && !isAdmin)} onClick={() => printBatch(item)}>
                    {working ? "Generating PDF…" : likelyReprint ? "Admin Reprint Labels" : "Print Controlled Labels"}
                  </button>
                </div>
              ) : null}

              {status === "batch_in_progress" ? (
                <p className="serialized-receiving__next-step">
                  After printing and attaching every label, complete the independent physical verification in <strong>Setup & Labels</strong>. Unused labels must be explicitly voided; they cannot quietly disappear.
                </p>
              ) : null}

              {status === "quantity_exception" ? (
                <p className="serialized-receiving__exception">
                  Activated identities do not equal this purchase line quantity. Do not generate another batch to hide the difference; reconcile the existing batch and physical labels.
                </p>
              ) : null}

              {status === "complete" ? (
                <p className="serialized-receiving__complete">
                  This supplier purchase line has a completed controlled identity batch.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
