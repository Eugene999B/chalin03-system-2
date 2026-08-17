import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const API = "/equipment-catalogue/sales/completion-phase-four/entity";

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function InstallmentEntityDeleteDialog({ entityType, entityId, name, onClose, onDeleted }) {
  const [impact, setImpact] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const label = entityType === "asset" ? "Excavator" : "Customer";
  const expected = `DELETE INSTALLMENT ${entityType === "asset" ? "EXCAVATOR" : "CUSTOMER"} ${entityId}`;

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const response = await axiosClient.post(`${API}/${entityType}/${entityId}/impact`);
        if (active) setImpact(response.data?.impact || null);
      } catch (requestError) {
        if (active) setError(errorMessage(requestError, `Could not prepare the ${label.toLowerCase()} deletion impact.`));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [entityType, entityId, label]);

  async function execute() {
    if (confirmation.trim() !== expected) {
      setError(`Type ${expected} exactly to confirm.`);
      return;
    }
    setDeleting(true);
    setError("");
    try {
      const response = await axiosClient.post(`${API}/${entityType}/${entityId}/delete`, { confirmation });
      onDeleted?.(response.data);
    } catch (requestError) {
      setError(errorMessage(requestError, `The ${label.toLowerCase()} could not be deleted.`));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => !deleting && onClose?.()}>
      <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label={`Delete Installment ${label.toLowerCase()}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="finance-simple__section-header">
          <div><p className="finance-simple__eyebrow">Permanent Installment deletion</p><h2>Delete {name || label}</h2><span className="finance-simple__muted">{label} #{entityId}</span></div>
          <button type="button" disabled={deleting} onClick={onClose}>Close</button>
        </div>
        {error ? <div className="finance-simple__notice is-error" role="alert">{error}</div> : null}
        {loading ? <div className="finance-simple__empty">Calculating every linked Installment record…</div> : null}
        {!loading && impact ? (
          <>
            <div className="finance-simple__section">
              <p>This deletes the complete Installment integration in one transaction. A shared customer/excavator master is removed only when Installment explicitly owns it and no external reference remains.</p>
              <div className="finance-simple__summary">
                <article><span>Installment owned</span><strong>{impact.explicitly_installment_owned ? "Yes" : "No"}</strong></article>
                <article><span>External references</span><strong>{(impact.external_references || []).reduce((sum, item) => sum + Number(item.rows || 0), 0)}</strong></article>
                <article><span>Protected references</span><strong>{(impact.protected_external_references || []).reduce((sum, item) => sum + Number(item.rows || 0), 0)}</strong></article>
                <article><span>Master deletion</span><strong>{impact.master_delete_eligible ? "Allowed" : "Preserved"}</strong></article>
              </div>
            </div>
            <div className="finance-simple__section">
              <label className="finance-simple__field"><span>Type exactly: <code>{expected}</code></span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={deleting} /></label>
            </div>
            <div className="finance-simple__sticky-actions"><span>Transaction rolls back completely if any linked deletion fails.</span><div><button type="button" disabled={deleting} onClick={onClose}>Cancel</button><button className="is-danger" type="button" disabled={deleting || confirmation.trim() !== expected} onClick={execute}>{deleting ? "Deleting…" : `Delete ${label}`}</button></div></div>
          </>
        ) : null}
      </section>
    </div>
  );
}
