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
    if (impact?.blocking_references?.length) { setError("Deletion is blocked by a shared business record shown below."); return; }
    if (confirmation.trim() !== expected) { setError(`Type ${expected} exactly to confirm.`); return; }
    setDeleting(true); setError("");
    try {
      const response = await axiosClient.post(`${API}/${entityType}/${entityId}/delete`, { confirmation });
      onDeleted?.(response.data);
    } catch (requestError) { setError(errorMessage(requestError, `The ${label.toLowerCase()} could not be deleted.`)); }
    finally { setDeleting(false); }
  }

  const scope = impact?.scope || {};
  const blockingRefs = impact?.blocking_references || [];
  const internalRefs = impact?.internal_references || [];
  const canDelete = Boolean(impact?.trial_record && !blockingRefs.length);
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
            <div className={`installment-delete-dialog__warning ${canDelete ? "is-safe" : ""}`}><strong>{!impact.trial_record ? "Delete blocked." : canDelete ? "Ready to delete this Installment trial." : "Shared record protection is active."}</strong><p>{impact.message}</p></div>
            <div className="installment-delete-dialog__grid">
              <div className="installment-delete-dialog__stat"><span>Installment provenance</span><strong>{impact.evidence?.explicitly_owned ? "Explicit" : impact.evidence?.legacy_activity ? "Legacy evidence" : impact.evidence?.installment_links ? "Linked finance" : "None"}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Applications</span><strong>{scope.applications?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Agreements</span><strong>{scope.agreements?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Payments</span><strong>{scope.payments?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Customers</span><strong>{scope.customers?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Excavators</span><strong>{scope.assets?.length || 0}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Installment references</span><strong>{internalRefs.length}</strong></div>
              <div className="installment-delete-dialog__stat"><span>Shared blockers</span><strong>{blockingRefs.length}</strong></div>
            </div>
            {blockingRefs.length ? <div className="installment-delete-dialog__reference-box"><strong>Deletion blocked by shared integration</strong><ul className="installment-delete-dialog__refs">{blockingRefs.map((item) => <li key={`${item.table}-${item.column}`}>{item.table}.{item.column} — {item.rows} row(s)</li>)}</ul></div> : null}
            {internalRefs.length ? <div className="installment-delete-dialog__reference-box is-internal"><strong>Will be deleted as part of Installment cleanup</strong><ul className="installment-delete-dialog__refs">{internalRefs.map((item) => <li key={`${item.table}-${item.column}`}>{item.table}.{item.column} — {item.rows} row(s)</li>)}</ul></div> : null}
            <label className="installment-delete-dialog__confirm"><span>Type exactly: <code>{expected}</code></span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={deleting || !canDelete} /></label>
          </div>
          <footer className="installment-delete-dialog__actions"><span className="installment-delete-dialog__muted">Transactional deletion. A failure rolls the whole operation back.</span><div><button type="button" disabled={deleting} onClick={onClose}>Cancel</button><button className="is-danger" type="button" disabled={deleting || !canDelete || confirmation.trim() !== expected} onClick={execute}>{deleting ? "Deleting…" : `Delete ${label}`}</button></div></footer>
        </> : null}
      </section>
    </div>
  );
}
