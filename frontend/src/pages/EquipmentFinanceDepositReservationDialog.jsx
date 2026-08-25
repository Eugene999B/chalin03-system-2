import { useEffect } from "react";

export default function EquipmentFinanceDepositReservationDialog({
  selected,
  form,
  saving,
  onChange,
  onClose,
  onSubmit,
  money,
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  if (!selected || !form) return null;

  return (
    <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="finance-deposit-dialog" role="dialog" aria-modal="true" aria-labelledby="opening-deposit-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="finance-deposit-dialog__head">
          <div className="finance-deposit-dialog__identity">
            <p className="finance-simple__eyebrow">Opening Deposit</p>
            <h2 id="opening-deposit-dialog-title">{selected.agreement_number}</h2>
            <p>{selected.customer_name} · {selected.asset_code} · {selected.asset_name}</p>
          </div>
          <button className="finance-deposit-dialog__close" type="button" aria-label="Close" disabled={saving} onClick={onClose}>✕</button>
        </header>

        <div className="finance-deposit-dialog__summary">
          <article className="finance-deposit-dialog__stat"><span>Sale total</span><strong>{money(selected.total_amount)}</strong></article>
          <article className="finance-deposit-dialog__stat"><span>Deposit required</span><strong>{money(selected.deposit_required)}</strong></article>
          <article className="finance-deposit-dialog__stat"><span>Already received</span><strong>{money(selected.deposit_received)}</strong></article>
          <article className="finance-deposit-dialog__stat"><span>Remaining</span><strong>{money(selected.deposit_remaining)}</strong></article>
        </div>

        <form className="finance-deposit-dialog__form" onSubmit={onSubmit}>
          <h3 className="finance-deposit-dialog__section-title">Record buyer payment</h3>
          <div className="finance-deposit-dialog__grid">
            <label className="finance-deposit-dialog__field">
              <span>Amount paid</span>
              <div className="finance-deposit-dialog__amount-wrap">
                <span className="finance-deposit-dialog__currency">GHS</span>
                <input className="finance-deposit-dialog__amount-input" inputMode="decimal" autoFocus value={form.amount} onChange={(event) => onChange("amount", event.target.value.replace(/[^0-9.]/g, ""))} required />
              </div>
              <small className="finance-deposit-dialog__hint">Up to {money(selected.deposit_remaining)}</small>
            </label>

            <label className="finance-deposit-dialog__field">
              <span>Payment method</span>
              <select value={form.payment_method} onChange={(event) => onChange("payment_method", event.target.value)}>
                <option value="cash">Cash</option>
                <option value="momo">Mobile money</option>
                <option value="bank">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="finance-deposit-dialog__field">
              <span>Reference number <em>(optional)</em></span>
              <input value={form.reference_number} onChange={(event) => onChange("reference_number", event.target.value)} />
            </label>

            <label className="finance-deposit-dialog__field">
              <span>Notes <em>(optional)</em></span>
              <input value={form.notes} onChange={(event) => onChange("notes", event.target.value)} />
            </label>
          </div>

          <label className="finance-deposit-dialog__reserve">
            <input type="checkbox" checked={form.confirm_reservation} onChange={(event) => onChange("confirm_reservation", event.target.checked)} />
            <span><strong>Reserve this exact excavator after the deposit is fully paid</strong><small>Partial deposits do not reserve equipment. This confirmation is required only when this payment completes the deposit.</small></span>
          </label>

          <div className="finance-deposit-dialog__footer">
            <span className="finance-deposit-dialog__footer-copy">Receipt first. Reservation only after the required deposit is complete.</span>
            <div className="finance-deposit-dialog__footer-actions">
              <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
              <button className="is-primary" type="submit" disabled={saving}>{saving ? "Recording…" : "Record Payment"}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
