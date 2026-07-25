import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const emptyForm = {
  void_reason: "",
  approver_username: "",
  approver_password: "",
};

export default function ExpenseVoidApprovalPanel({
  expense,
  storeCode,
  onClose,
  onSuccess,
  onError,
}) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm(emptyForm);
    setSubmitting(false);
  }, [expense?.id]);

  if (!expense) return null;

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submitVoid(event) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const response = await axiosClient.delete(`/expenses/${expense.id}`, {
        data: form,
      });
      onSuccess?.(
        response.data.message ||
          "Expense voided successfully with independent approval."
      );
    } catch (error) {
      onError?.(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "18px",
        background: "rgba(15, 23, 42, 0.72)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose?.();
      }}
    >
      <form
        className="section-card"
        onSubmit={submitVoid}
        style={{
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          margin: 0,
        }}
      >
        <div className="page-header" style={{ marginBottom: "12px" }}>
          <div>
            <h2 style={{ marginBottom: "4px" }}>Void Expense</h2>
            <p style={{ margin: 0 }}>
              {storeCode} · {expense.category} · GHS {Number(expense.amount || 0).toFixed(2)}
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={submitting}
          >
            Close
          </button>
        </div>

        <div className="warning-box">
          The original expense will remain in the financial ledger. A different
          authorised admin or manager must approve this correction.
        </div>

        <label htmlFor="expense-void-reason">Reason for voiding</label>
        <textarea
          id="expense-void-reason"
          name="void_reason"
          value={form.void_reason}
          onChange={handleChange}
          minLength={8}
          maxLength={1000}
          required
          autoFocus
          placeholder="Explain the error and the correction required"
        />

        <label htmlFor="expense-void-approver">Independent approver username</label>
        <input
          id="expense-void-approver"
          name="approver_username"
          value={form.approver_username}
          onChange={handleChange}
          autoComplete="username"
          required
          placeholder="Another admin or manager username"
        />

        <label htmlFor="expense-void-password">Independent approver password</label>
        <input
          id="expense-void-password"
          name="approver_password"
          type="password"
          value={form.approver_password}
          onChange={handleChange}
          autoComplete="current-password"
          required
          placeholder="Approver enters password privately"
        />

        <button type="submit" className="small-danger" disabled={submitting}>
          {submitting ? "Voiding expense..." : "Approve and Void Expense"}
        </button>
      </form>
    </div>
  );
}
