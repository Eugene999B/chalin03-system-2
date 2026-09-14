import "../styles/debtPaymentHistory.css";

const numberValue = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const money = (value) =>
  `GHS ${numberValue(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const dateTimeLabel = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Accra",
  });
};

const paymentMethodLabel = (value) => {
  const method = String(value || "cash").toLowerCase();
  if (method === "momo") return "Mobile money";
  if (method === "bank") return "Bank transfer";
  return method === "cash" ? "Cash" : value || "Cash";
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function paymentEvidence(notes, paymentId) {
  const cleaned = String(notes || "")
    .replace(/^\[DebtDesk:[A-Za-z0-9_-]+\]\s*(?:—\s*)?/, "")
    .trim();
  const parts = cleaned
    .split(/\s+—\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const reference =
    parts.find((part) => /^DEBT-/i.test(part)) || `DEBT-PAY-${paymentId}`;
  const note = parts
    .filter((part) => part !== reference)
    .join(" — ");

  return { reference, note };
}

function printThermalReceipt({
  payment,
  customer,
  storeCode,
  storeName,
  storeLocation,
  receiptNumber,
  onError,
}) {
  const printWindow = window.open("", "_blank", "width=420,height=720");
  if (!printWindow) {
    onError?.("Popup blocked. Allow popups and try printing the payment again.");
    return;
  }

  const evidence = paymentEvidence(payment.notes, payment.id);
  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <title>Debt Payment Receipt</title>
        <style>
          @page{size:80mm auto;margin:3mm}
          *{box-sizing:border-box}
          body{width:72mm;margin:0 auto;padding:0;font-family:Arial,sans-serif;color:#111;font-size:11px;line-height:1.35}
          h1,h2,p{margin:0;text-align:center}
          h1{font-size:15px;letter-spacing:.02em}
          h2{margin-top:3px;font-size:12px;text-transform:uppercase}
          .store{margin-top:3px;color:#333;text-align:center}
          .rule{margin:9px 0;border-top:1px dashed #111}
          .row{display:flex;justify-content:space-between;gap:8px;margin:5px 0}
          .row span{color:#333}
          .row strong{max-width:44mm;text-align:right;overflow-wrap:anywhere}
          .amount{align-items:end;margin:8px 0}
          .amount strong{font-size:18px}
          .note{margin-top:7px;padding:6px;border:1px dashed #777;overflow-wrap:anywhere}
          .footer{margin-top:10px;text-align:center;font-size:10px}
          @media print{body{width:72mm}}
        </style>
      </head>
      <body>
        <h1>CHALIN 03 COMPANY LIMITED</h1>
        <h2>Debt Payment Receipt</h2>
        <div class="store">${escapeHtml(storeCode || "STORE")} · ${escapeHtml(
    storeName || "Selected Store"
  )}${storeLocation ? ` · ${escapeHtml(storeLocation)}` : ""}</div>
        <div class="rule"></div>
        <div class="row"><span>Reference</span><strong>${escapeHtml(
          evidence.reference
        )}</strong></div>
        <div class="row"><span>Payment ID</span><strong>#${escapeHtml(
          payment.id
        )}</strong></div>
        <div class="row"><span>Date</span><strong>${escapeHtml(
          dateTimeLabel(payment.paid_at)
        )}</strong></div>
        <div class="row"><span>Customer</span><strong>${escapeHtml(
          customer?.customer_name || "Customer"
        )}</strong></div>
        <div class="row"><span>Phone</span><strong>${escapeHtml(
          customer?.customer_phone || "—"
        )}</strong></div>
        <div class="row"><span>Sale receipt</span><strong>${escapeHtml(
          receiptNumber || `Debt #${payment.debt_id}`
        )}</strong></div>
        <div class="rule"></div>
        <div class="row amount"><span>Amount received</span><strong>${money(
          payment.amount
        )}</strong></div>
        <div class="row"><span>Method</span><strong>${escapeHtml(
          paymentMethodLabel(payment.payment_method)
        )}</strong></div>
        <div class="row"><span>Received by</span><strong>${escapeHtml(
          payment.received_by_name || "Staff"
        )}</strong></div>
        ${
          evidence.note
            ? `<div class="note"><strong>Note:</strong> ${escapeHtml(
                evidence.note
              )}</div>`
            : ""
        }
        <div class="rule"></div>
        <div class="footer">Computer-generated payment evidence.<br/>Thank you for your payment.</div>
        <script>window.onload=()=>window.print()</script>
      </body>
    </html>`);
  printWindow.document.close();
}

export default function DebtPaymentHistory({
  payments = [],
  debts = [],
  customer,
  storeCode,
  storeName,
  storeLocation,
  onError,
}) {
  if (!payments.length) {
    return (
      <div className="debt-desk__empty is-compact">
        <p>No debt payments have been recorded for this customer.</p>
      </div>
    );
  }

  const receiptByDebtId = new Map(
    debts.map((debt) => [Number(debt.id), debt.receipt_number || null])
  );

  return (
    <div className="debt-desk__payment-history debt-payment-history">
      {payments.map((payment) => {
        const evidence = paymentEvidence(payment.notes, payment.id);
        const receiptNumber = receiptByDebtId.get(Number(payment.debt_id));

        return (
          <article key={payment.id}>
            <div className="debt-desk__payment-icon">↓</div>
            <div className="debt-payment-history__copy">
              <strong>{money(payment.amount)}</strong>
              <span>
                {dateTimeLabel(payment.paid_at)} ·{" "}
                {paymentMethodLabel(payment.payment_method)}
              </span>
              <small>
                {payment.received_by_name || "Staff"} · {evidence.reference}
                {evidence.note ? ` · ${evidence.note}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="debt-payment-history__print"
              onClick={() =>
                printThermalReceipt({
                  payment,
                  customer,
                  storeCode,
                  storeName,
                  storeLocation,
                  receiptNumber,
                  onError,
                })
              }
            >
              Print thermal receipt
            </button>
          </article>
        );
      })}
    </div>
  );
}
