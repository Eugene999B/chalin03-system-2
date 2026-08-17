import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/installmentDeleteDialog.css";

const API = "/equipment-catalogue/sales/completion-phase-four/entity";
function errorMessage(error, fallback) { return error?.response?.data?.message || error?.message || fallback; }

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
      setLoading(true); setError("");
      try {
        const response = await axiosClient.post(`${API}/${entityType}/${entityId}/impact`);
        if (active) setImpact(response.data?.impact || null);
      } catch (requestError) {
        if (active) setError(errorMessage(requestError, `Could not prepare the ${label.toLowerCase()} deletion impact.`));
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [entityType, entityId, label]);

  async function execute() {
    if (!impact?.trial_record) { setError("This record is not identified as an Installment trial record."); return; }
    if (confirmation.trim() !== expected) { setError(`Type ${expected} exactly to confirm.`); return; }
    setDeleting(true); setError("");
    try {
      const response = await axiosClient.post(`${API}/${entityType}/${entityId}/delete`, { confirmation });
      onDeleted?.(response.data);
    } catch (requestError) { setError(errorMessage(requestError, `The ${label.toLowerCase()} could not be deleted.`)); }
    finally { setDeleting(false); }
  }

  const scope = impact?.scope || {};
  const protectedRefs = impact?.protected_references || [];
  return (
    <div className="installment-delete-dialog__backdrop" role="presentation" onMouseDown={() => !deleting && onClose?.()}>
      <section className="installment-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="installment-delete-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="installment-delete-dialog__header">
          <div><div className="finance-simple__eyebrow">Installment trial cleanup</div><h2 id="installment-delete-title">Delete {name || label}</h2><div className="installment-delete-dialog__muted">{label} #{entityId}</div></div>
          <button type="button" disabled={deleting} onClick={onClose}>Close</button>
        </header>
        {error ? <div className="installment-delete-dialog__error" role="alert">{error}</div> : null}
        {loading ? <div className="installment-delete-dialog__body"><p>Tracing the complete Installment integration…</p></div> : null}
        {!loading && impact ? <>
          <div className="installment-delete-dialog__body">
            <div className="installment-delete-dialog__warning"><strong>{impact.trial_record ? "Installment trial detected." : "Delete blocked."}</strong><p>{impact.message}</p></div>
            <div className="installment-delete-dialog__grid">
              <div className="installment-delete-dialog__stat"><span>Ownership</span><strong>{impact.evidence?.explicitly_owned ? "Explicit" : impact.evidence?.legacy_activity ? "Legacy evidence" : "Linked"}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Applications</span><strong>{scope.applications?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Agreements</span><strong>{scope.agreements?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Payments</span><strong>{scope.payments?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Customers</span><strong>{scope.customers?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Excavators</span><strong>{scope.assets?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Other references</span><strong>{impact.external_references?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Master deletion</span><strong>{impact.master_delete_eligible ? "Allowed" : "Preserved"}</strong></div>
            </div>
            {protectedRefs.length ? <div><strong>Protected integrations</strong><ul className="installment-delete-dialog__refs">{protectedRefs.map((item) => <li key={`${item.table}-${item.column}`}>{item.table}: {item.rows} reference(s)</li>)}</ul></div> : null}
            <label className="installment-delete-dialog__confirm"><span>Type exactly: <code>{expected}</code></span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={deleting || !impact.trial_record} /></label>
          </div>
          <footer className="installment-delete-dialog__actions"><span className="installment-delete-dialog__muted">Transactional deletion. A failure rolls the whole operation back.</span><div><button type="button" disabled={deleting} onClick={onClose}>Cancel</button><button className="is-danger" type="button" disabled={deleting || !impact.trial_record || confirmation.trim() !== expected} onClick={execute}>{deleting ? "Deleting…" : `Delete ${label}`}</button></div></footer>
        </> : null}
      </section>
    </div>
  );
}
