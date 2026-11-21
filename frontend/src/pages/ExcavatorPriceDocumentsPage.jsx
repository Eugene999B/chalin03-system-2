import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import useSaleDiscountPermission from "../hooks/useSaleDiscountPermission";
import "../styles/excavatorPriceDocuments.css";

const ROOT = "/equipment-catalogue/sales/professional/price-documents";
const money = (value) => Number(value || 0).toLocaleString("en-GH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function saveFile(data, filename, format = "pdf") {
  const url = URL.createObjectURL(new Blob([data], { type: format === "word" ? "application/msword" : "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function errorMessage(error, fallback) {
  if (error?.response?.data instanceof Blob) {
    return error.response.data.text()
      .then((text) => {
        try { return JSON.parse(text)?.message || fallback; }
        catch { return fallback; }
      });
  }
  return Promise.resolve(error?.response?.data?.message || fallback);
}

export default function ExcavatorPriceDocumentsPage() {
  const { user } = useAuth();
  const allowed = useSaleDiscountPermission(user?.id, user?.branch_id);
  const [search, setSearch] = useState("");
  const [agreements, setAgreements] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [original, setOriginal] = useState(null);
  const [price, setPrice] = useState("");
  const [projection, setProjection] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const fetchAgreements = useCallback(async (term = "") => {
    setBusy("list");
    setError("");
    try {
      const response = await axiosClient.get(`${ROOT}/agreements`, {
        params: { search: term, limit: 150 },
      });
      setAgreements(response.data?.agreements || []);
    } catch (err) {
      setError(await errorMessage(err, "Could not load excavators."));
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    fetchAgreements("");
    axiosClient.get(`${ROOT}/options`)
      .then((response) => setDocuments(response.data?.documents || []))
      .catch(() => setError("Could not load the document options."));
  }, [allowed, fetchAgreements]);

  async function chooseAgreement(id) {
    if (!allowed) return;
    setBusy("detail");
    setError("");
    setSelectedId(id);
    setAgreement(null);
    setOriginal(null);
    setProjection(null);
    try {
      const [detail, documents] = await Promise.all([
        axiosClient.get(`${ROOT}/${id}`),
        axiosClient.get("/equipment-catalogue/sales/professional/documents", {
          params: { agreement_id: id, limit: 120 },
        }).catch(() => ({ data: { documents: [] } })),
      ]);
      const loaded = detail.data?.agreement;
      if (!loaded) throw new Error("Agreement details are unavailable.");
      setAgreement(loaded);
      setPrice(String(loaded.total_amount || ""));
      const issued = (documents.data?.documents || [])
        .filter((d) => d.document_type === "installment_agreement")
        .sort((a, b) => Number(b.id) - Number(a.id));
      setOriginal(issued[0] || null);
    } catch (err) {
      setError(await errorMessage(err, "Could not load this excavator."));
    } finally {
      setBusy("");
    }
  }

  function proposed() {
    const priceNumber = Number(price);
    if (!Number.isFinite(priceNumber) || priceNumber <= 0 ||
        priceNumber < Number(agreement?.deposit_required || 0)) {
      setError("Enter a valid selling price above the original deposit.");
      return null;
    }
    return { price: priceNumber };
  }

  async function preview() {
    const input = proposed();
    if (!input || !selectedId) return;
    setBusy("preview");
    setError("");
    try {
      const response = await axiosClient.post(`${ROOT}/${selectedId}/preview`, input);
      setProjection(response.data?.scenario || null);
    } catch (err) {
      setProjection(null);
      setError(await errorMessage(err, "Could not preview the price."));
    } finally {
      setBusy("");
    }
  }

  async function downloadVersion(type, format = "pdf") {
    const input = proposed();
    if (!input || !selectedId) return;
    setBusy(`${type}:${format}`);
    setError("");
    // Open synchronously on the user's click, before awaiting the download.
    // Mobile browsers may otherwise block a PDF print preview as a popup.
    const printWindow = format === "print" ? window.open("", "_blank") : null;
    try {
      const response = await axiosClient.post(
        `${ROOT}/${selectedId}/download`,
        { ...input, document_type: type, format },
        { responseType: "blob" }
      );
      const extension = format === "word" ? "doc" : "pdf";
      const filename = `Excavator-${selectedId}-${type.replaceAll("_", "-")}-Selling-Price.${extension}`;
      if (format === "print" && printWindow && !printWindow.closed) {
        const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
        printWindow.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        saveFile(response.data, filename, format);
      }
    } catch (err) {
      if (printWindow && !printWindow.closed) printWindow.close();
      setError(await errorMessage(err, "Could not prepare the selected document."));
    } finally {
      setBusy("");
    }
  }

  async function downloadOriginal() {
    if (!selectedId) return;
    setBusy("original");
    setError("");
    try {
      const path = original?.id
        ? `/equipment-catalogue/sales/professional/documents/${original.id}/download`
        : `${ROOT}/${selectedId}/source-pdf`;
      const response = await axiosClient.get(path, {
        ...(original?.id ? { params: { format: "pdf" } } : {}),
        responseType: "blob",
      });
      saveFile(response.data, original?.id
        ? `Original-${original.document_number || selectedId}.pdf`
        : `Excavator-${selectedId}-Original-Reference.pdf`);
    } catch (err) {
      setError(await errorMessage(err, "Could not download the original agreement copy."));
    } finally {
      setBusy("");
    }
  }

  if (!allowed) {
    return (
      <main className="price-documents">
        <div className="price-documents__shell">
          <h1>Excavator Price Documents</h1>
          <p className="price-documents__muted">Restricted to Boss and System Administrator.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="price-documents">
      <div className="price-documents__shell">
        <header className="price-documents__head">
          <div>
            <span className="price-documents__eyebrow">FINANCE · DOCUMENTS</span>
            <h1>Excavator Price Documents</h1>
          </div>
          <span className="price-documents__read-only">Boss documents</span>
        </header>

        {error && <div role="alert" className="price-documents__alert">{error}</div>}

        <div className="price-documents__layout">
          <section className="price-documents__panel">
            <div className="price-documents__panel-heading">
              <h2>Agreed excavators</h2>
              <span>{agreements.length}</span>
            </div>
            <form className="price-documents__search" onSubmit={(event) => {
              event.preventDefault(); fetchAgreements(search);
            }}>
              <input aria-label="Find excavator" value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Excavator, customer or agreement" />
              <button type="submit" disabled={busy === "list"}>Find</button>
            </form>
            <div className="price-documents__list">
              {agreements.length === 0 && (
                <p className="price-documents__empty">
                  {busy === "list" ? "Loading…" : "No agreements found."}
                </p>
              )}
              {agreements.map((row) => (
                <button key={row.id} type="button"
                  className={`price-documents__machine ${Number(row.id) === Number(selectedId) ? "is-selected" : ""}`}
                  onClick={() => chooseAgreement(row.id)}>
                  <span className="price-documents__machine-title">
                    {row.asset_name_snapshot || row.asset_code || "Excavator"}
                  </span>
                  <span className="price-documents__machine-sub">
                    {row.agreement_number} · {row.customer_name_snapshot || "Customer"}
                  </span>
                  <span className="price-documents__machine-price">GHS {money(row.total_amount)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="price-documents__panel price-documents__editor">
            {!agreement ? (
              <div className="price-documents__empty price-documents__empty--large">
                {busy === "detail" ? "Loading excavator…" : "Select an excavator"}
              </div>
            ) : (
              <>
                <div className="price-documents__panel-heading">
                  <div>
                    <h2>{agreement.asset_name}</h2>
                    <span>{agreement.asset_code} · {agreement.agreement_number}</span>
                  </div>
                </div>
                <p className="price-documents__buyer">{agreement.customer_name}</p>

                <div className="price-documents__amounts">
                  <div><span>Original price</span><strong>GHS {money(agreement.total_amount)}</strong></div>
                  <div><span>Already received</span><strong>GHS {money(agreement.amount_paid)}</strong></div>
                  <div><span>Original deposit</span><strong>GHS {money(agreement.deposit_required)}</strong></div>
                </div>

                <div className="price-documents__fields">
                  <label>Price for this document
                    <span className="price-documents__input">
                      <span>GHS</span>
                      <input type="number" min="0.01" step="0.01" inputMode="decimal"
                        value={price} onChange={(event) => { setPrice(event.target.value); setProjection(null); }} />
                    </span>
                  </label>

                </div>

                <div className="price-documents__actions">
                  <button type="button" className="price-documents__secondary"
                    disabled={Boolean(busy)} onClick={preview}>
                    Preview payments
                  </button>
                  <button type="button" className="price-documents__secondary"
                    disabled={Boolean(busy)} onClick={downloadOriginal}>
                    {busy === "original" ? "Downloading…" : original ? "Original agreement" : "Original reference PDF"}
                  </button>
                </div>
                <div className="price-documents__document-head">
                  <h3>Documents</h3>
                  <Link to={`/equipment-installment-finance/applications?stage=generated-documents&agreement=${selectedId}`}>
                    Original documents
                  </Link>
                </div>
                <div className="price-documents__document-list">
                  {documents.map((document) => (
                    <div key={document.code} className="price-documents__document-row">
                      <span>{document.label}</span>
                      <div className="price-documents__document-buttons">
                        <button type="button" disabled={Boolean(busy)}
                          onClick={() => downloadVersion(document.code, "pdf")}>
                          {busy === `${document.code}:pdf` ? "Preparing…" : "PDF"}
                        </button>
                        <button type="button" disabled={Boolean(busy)}
                          onClick={() => downloadVersion(document.code, "word")}>
                          {busy === `${document.code}:word` ? "Preparing…" : "Word"}
                        </button>
                        <button type="button" disabled={Boolean(busy)}
                          onClick={() => downloadVersion(document.code, "print")}>
                          {busy === `${document.code}:print` ? "Preparing…" : "Print"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {projection && (
                  <div className="price-documents__projection">
                    <div className="price-documents__amounts">
                      <div><span>Proposed price</span><strong>GHS {money(projection.scenario_price)}</strong></div>
                      <div><span>Financed</span><strong>GHS {money(projection.financed)}</strong></div>
                      <div><span>Scenario outstanding</span><strong>GHS {money(projection.projected_outstanding)}</strong></div>
                    </div>
                    <h3>Installments</h3>
                    <div className="price-documents__schedule">
                      {projection.schedule.map((payment) => (
                        <div key={payment.number}>
                          <span>#{payment.number} · {String(payment.due_date || "").slice(0, 10)}</span>
                          <strong>GHS {money(payment.amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
