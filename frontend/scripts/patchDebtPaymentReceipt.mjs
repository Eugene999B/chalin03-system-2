import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const targetPath = path.join(frontendRoot, "src", "pages", "DebtsPage.jsx");
const source = fs.readFileSync(targetPath, "utf8");

const startMarker = "  function printDebtPaymentReceipt(receiptData) {";
const endMarker = "  async function recordPayment(event) {";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);

if (start === -1 || end === -1 || end <= start) {
  throw new Error("Could not locate the debt payment receipt function.");
}

const replacement = `  function printDebtPaymentReceipt(receiptData) {
    if (!receiptData) return;

    const payment = receiptData.payment;
    const debt = receiptData.debt;

    const printWindow = window.open("", "_blank", "width=380,height=650");

    if (!printWindow) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }

    const receiptHtml = \`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Debt Payment Receipt</title>
          <style>
            @page { size: 80mm auto; margin: 3mm; }
            * { box-sizing: border-box; }
            body {
              width: 74mm;
              margin: 0 auto;
              padding: 0;
              color: #000;
              background: #fff;
              font-family: "Courier New", monospace;
              font-size: 11px;
              line-height: 1.35;
            }
            .receipt { width: 100%; }
            .center { text-align: center; }
            .business-name {
              margin: 0;
              font-size: 15px;
              font-weight: 700;
              text-transform: uppercase;
            }
            .receipt-title {
              margin: 7px 0;
              font-size: 13px;
              font-weight: 700;
              text-align: center;
            }
            .line { margin: 7px 0; border-top: 1px dashed #000; }
            .row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              margin: 4px 0;
            }
            .row .label { flex: 0 0 43%; font-weight: 700; }
            .row .value {
              flex: 1;
              text-align: right;
              overflow-wrap: anywhere;
            }
            .amount { margin: 8px 0; font-size: 15px; font-weight: 700; }
            .footer { margin-top: 10px; text-align: center; }
            .print-button { margin-top: 12px; text-align: center; }
            @media print {
              body { width: 74mm; }
              .print-button { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="receipt">
            <div class="center">
              <h1 class="business-name">Chalin 03 Company Limited</h1>
              <div>\${escapeHtml(
                getDebtStoreLocation(debt) || "Dunkwa Police Barrier"
              )}</div>
              <div>Tel: 0249469080 / 0249995510</div>
            </div>

            <div class="line"></div>
            <div class="receipt-title">DEBT PAYMENT RECEIPT</div>
            <div class="line"></div>

            <div class="row">
              <span class="label">Receipt No:</span>
              <span class="value">DP-\${escapeHtml(payment.id)}</span>
            </div>
            <div class="row">
              <span class="label">Customer:</span>
              <span class="value">\${escapeHtml(debt.customer_name || "Customer")}</span>
            </div>
            <div class="row">
              <span class="label">Date:</span>
              <span class="value">\${escapeHtml(formatDateTime(payment.paid_at))}</span>
            </div>
            <div class="row">
              <span class="label">Payment:</span>
              <span class="value">\${escapeHtml(
                formatPaymentMethod(payment.payment_method)
              )}</span>
            </div>

            <div class="line"></div>
            <div class="row">
              <span class="label">Previous Balance:</span>
              <span class="value">\${formatMoney(debt.previous_balance)}</span>
            </div>
            <div class="row amount">
              <span class="label">AMOUNT PAID:</span>
              <span class="value">\${formatMoney(payment.amount)}</span>
            </div>
            <div class="row">
              <span class="label">Balance Left:</span>
              <span class="value">\${formatMoney(debt.balance)}</span>
            </div>

            <div class="line"></div>
            <div class="row">
              <span class="label">Received By:</span>
              <span class="value">\${escapeHtml(payment.received_by_name || "-")}</span>
            </div>
            <div class="line"></div>

            <div class="footer">
              Thank you for your payment.<br />
              Please keep this receipt.
            </div>
            <div class="print-button">
              <button onclick="window.print()">Print</button>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    \`;

    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

`;

const updated = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(targetPath, updated, "utf8");
console.log("Debt payment receipt prepared for 80mm thermal printing.");
