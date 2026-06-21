import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function SalesHistoryPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const [sales, setSales] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedDebt, setSelectedDebt] = useState(null);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const businessName = "CHALIN 03 COMPANY LIMITED";
  const businessAddress = "Dunkwa Police Barrier";
  const businessPhone = "0249469080 / 0249995510";
  const momoNumber = "0543421127";
  const receiptFooter = "Thank You For Coming";
  const policyText = "ITEMS SOLD ARE NOT RETURNABLE";

  function formatMoney(value) {
    return Number(value || 0).toFixed(2);
  }

  function formatReceiptDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatReceiptTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  }


  function formatPaymentMethod(value) {
  const paymentMethods = {
     cash: "Cash",
     momo: "MoMo",
     bank: "Bank",
     credit: "Credit",
     mixed: "Mixed",
  };

    return paymentMethods[String(value || "").toLowerCase()] || value || "-";
}

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function isSaleVoided(sale) {
    return (
      Number(sale?.is_voided || 0) === 1 || sale?.sale_status === "cancelled"
    );
  }

  async function loadSales(customFilters = null) {
    setError("");
    setMessage("");

    const filters = customFilters || {
      search,
      from,
      to,
    };

    try {
      const response = await axiosClient.get("/sales", {
        params: filters,
      });

      setSales(response.data.sales || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load sales.");
    }
  }

  async function viewReceipt(saleId) {
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.get(`/sales/${saleId}`);

      setSelectedReceipt(response.data.sale);
      setSelectedItems(response.data.items || []);
      setSelectedDebt(response.data.debt || null);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load receipt.");
    }
  }

  function closeReceipt() {
    setSelectedReceipt(null);
    setSelectedItems([]);
    setSelectedDebt(null);
  }

  async function voidSale(saleId, receiptNumber) {
    setMessage("");
    setError("");

    const reason = window.prompt(
      `Why are you voiding receipt ${receiptNumber}? Example: Wrong item entered, customer cancelled, wrong price.`
    );

    if (reason === null) return;

    if (!reason.trim()) {
      setError("Void reason is required.");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to void receipt ${receiptNumber}? Stock will be restored and any debt for this sale will be closed.`
    );

    if (!confirmed) return;

    try {
      const response = await axiosClient.patch(`/sales/${saleId}/void`, {
        reason: reason.trim(),
      });

      setMessage(response.data.message || "Sale voided successfully.");
      closeReceipt();
      await loadSales();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to void sale.");
    }
  }

  async function downloadReceiptPdf(saleId, receiptNumber) {
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get(`/receipts/sales/${saleId}/pdf`, {
        responseType: "blob",
      });

      const pdfBlob = new Blob([response.data], {
        type: "application/pdf",
      });

      const fileUrl = window.URL.createObjectURL(pdfBlob);

      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `${receiptNumber || "receipt"}.pdf`;
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(fileUrl);
      }, 100);

      setError("");
      setMessage("Receipt PDF downloaded successfully.");
    } catch (error) {
      console.error("PDF download frontend error:", error);

      setMessage("");
      setError("Failed to download receipt PDF.");
    }
  }

  function printReceipt() {
    if (!selectedReceipt) return;

    const receiptDiscount = Number(selectedReceipt.discount_amount || 0);

    const itemsHtml = selectedItems
      .map(
        (item) => `
          <tr>
            <td class="item-name">${escapeHtml(
              String(item.product_name || "").toUpperCase()
            )}</td>
            <td class="right">${formatMoney(item.unit_price)}</td>
            <td class="right">${item.quantity}</td>
            <td class="right">${formatMoney(item.line_total)}</td>
          </tr>
        `
      )
      .join("");

    const voidedHtml = isSaleVoided(selectedReceipt)
      ? `
        <div class="voided">
          VOIDED / CANCELLED SALE
          <br />
          This receipt is not counted as valid income.
          <br />
          Reason: ${escapeHtml(selectedReceipt.void_reason || "-")}
        </div>
      `
      : "";

    const receiptHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt ${escapeHtml(selectedReceipt.receipt_number)}</title>

          <style>
            @page {
              size: 80mm auto;
              margin: 4mm;
            }

            html,
            body {
              font-family: "Courier New", monospace;
              margin: 0;
              padding: 0;
              color: #000;
              background: #fff;
            }

            .receipt {
              width: 72mm;
              margin: 0 auto;
              font-size: 12px;
              font-weight: 700;
            }

            .center {
              text-align: center;
            }

            h1 {
              font-size: 15px;
              margin: 0 0 6px;
              text-align: center;
              font-weight: 900;
            }

            p {
              margin: 4px 0;
            }

            .dash {
              border-top: 1px dashed #000;
              margin: 8px 0;
            }

            .details-row {
              display: grid;
              grid-template-columns: 32mm 1fr;
              gap: 4px;
              margin: 4px 0;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 12px;
            }

            th,
            td {
              padding: 3px 0;
              vertical-align: top;
            }

            th {
              text-align: left;
            }

            .item-name {
              width: 34mm;
              word-break: break-word;
            }

            .right {
              text-align: right;
            }

            .totals-row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              margin: 6px 0;
            }

            .big {
              font-size: 13px;
              font-weight: 900;
            }

            .footer {
              text-align: center;
              margin-top: 18px;
              font-weight: 900;
            }

            .policy {
              text-align: center;
              font-style: italic;
              margin-top: 10px;
              font-weight: 900;
            }

            .powered {
              margin-top: 12px;
              text-align: center;
              font-size: 9px;
              font-weight: 500;
            }

            .voided {
              border: 2px solid #000;
              padding: 8px;
              margin: 10px 0;
              text-align: center;
              font-size: 13px;
              font-weight: 900;
            }
          </style>
        </head>

        <body>
          <div class="receipt">
            <h1>${businessName}</h1>

            <div class="center">
              <p>${businessAddress}</p>
              <p>Tel: ${businessPhone}</p>
              <p>MOMO #: ${momoNumber}</p>
            </div>

            ${voidedHtml}

            <div class="dash"></div>

            <div class="details-row">
              <span>Customer :</span>
              <span>${escapeHtml(
                selectedReceipt.customer_name || "Walk-in Customer"
              )}</span>
            </div>

            <div class="details-row">
              <span>Date :</span>
              <span>${formatReceiptDate(selectedReceipt.created_at)}</span>
            </div>

            <div class="details-row">
              <span>Time :</span>
              <span>${formatReceiptTime(selectedReceipt.created_at)}</span>
            </div>


            <div class="details-row">
              <span>Receipt No.:</span>
              <span>${escapeHtml(selectedReceipt.receipt_number)}</span>
            </div>

            <div class="details-row">
              <span>Payment :</span>
              <span>${escapeHtml(formatPaymentMethod(selectedReceipt.payment_type))}</span>
            </div>

            <div class="dash"></div>

            
        
            <table>
              <thead>
                <tr>
                  <th>Item Description</th>
                  <th class="right">Px</th>
                  <th class="right">Qty</th>
                  <th class="right">Amt</th>
                </tr>
              </thead>

              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div class="dash"></div>

            <div class="totals-row">
              <span>Sub Total</span>
              <span>${formatMoney(selectedReceipt.subtotal)}</span>
            </div>

            <div class="totals-row">
              <span>Discount</span>
              <span>${formatMoney(receiptDiscount)}</span>
            </div>

            <div class="totals-row">
              <span>Vat</span>
              <span>${formatMoney(selectedReceipt.tax_amount)}</span>
            </div>

            <div class="dash"></div>

            <div class="totals-row big">
              <span>Amount Due</span>
              <span>${formatMoney(selectedReceipt.total)}</span>
            </div>

            <div class="totals-row">
              <span>Amount Paid</span>
              <span>${formatMoney(selectedReceipt.amount_paid)}</span>
            </div>

            <div class="totals-row">
              <span>Balance Outstanding</span>
              <span>${formatMoney(selectedReceipt.balance)}</span>
            </div>

            <div class="dash"></div>

            <p>Served by&nbsp;&nbsp; ${escapeHtml(
              selectedReceipt.staff_name || "-"
            )}</p>

            <div class="footer">${receiptFooter}</div>

            <div class="policy">${policyText}</div>

            <div class="powered">Powered by Chalin 03 System</div>
          </div>

          <script>
            window.onload = function () {
              window.focus();
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=420,height=700");

    if (!printWindow) {
      setError("Popup blocked. Please allow popups and try printing again.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

  function clearFilters() {
    setSearch("");
    setFrom("");
    setTo("");

    loadSales({
      search: "",
      from: "",
      to: "",
    });
  }

  useEffect(() => {
    loadSales({
      search: "",
      from: "",
      to: "",
    });
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Sales History</h1>
          <p>
            View past sales, reprint receipts, download PDF and void wrong sales
          </p>
        </div>

        <button type="button" onClick={() => loadSales()}>
          Refresh
        </button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="section-card">
        <h2>Filter Sales</h2>

        <div className="filter-grid">
          <div>
            <label>Search receipt/customer/phone</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Example: Kwame or CHL-"
            />
          </div>

          <div>
            <label>From Date</label>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div>
            <label>To Date</label>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          <div className="filter-actions">
            <button type="button" onClick={() => loadSales()}>
              Apply Filter
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={clearFilters}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Sales List</h2>

        {sales.length === 0 ? (
          <p>No sales found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Staff</th>
                <th>Payment Method</th>
                <th>Subtotal</th>
                <th>Discount</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {sales.map((sale) => {
                const voided = isSaleVoided(sale);

                return (
                  <tr key={sale.id}>
                    <td>
                      <strong>{sale.receipt_number}</strong>
                      {voided && (
                        <>
                          <br />
                          <small>Voided</small>
                        </>
                      )}
                    </td>

                    <td>
                      {sale.customer_name || "Walk-in Customer"}
                      <br />
                      <small>{sale.customer_phone || "-"}</small>
                    </td>

                    <td>{sale.staff_name || "-"}</td>
                    <td>{formatPaymentMethod(sale.payment_type)}</td>
                    <td>GHS {formatMoney(sale.subtotal)}</td>
                    <td>GHS {formatMoney(sale.discount_amount)}</td>
                    <td>GHS {formatMoney(sale.total)}</td>
                    <td>GHS {formatMoney(sale.amount_paid)}</td>
                    <td>GHS {formatMoney(sale.balance)}</td>

                    <td>
                      {voided ? (
                        <span className="danger-text">Voided</span>
                      ) : (
                        sale.sale_status || "completed"
                      )}
                    </td>

                    <td>{new Date(sale.created_at).toLocaleString()}</td>

                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          onClick={() => viewReceipt(sale.id)}
                        >
                          View
                        </button>

                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            downloadReceiptPdf(sale.id, sale.receipt_number)
                          }
                        >
                          PDF
                        </button>

                        {isAdmin && !voided && (
                          <button
                            type="button"
                            className="small-danger"
                            onClick={() =>
                              voidSale(sale.id, sale.receipt_number)
                            }
                          >
                            Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedReceipt && (
        <div className="modal-backdrop">
          <div className="receipt-modal">
            <div className="modal-header">
              <div>
                <h2>Receipt Preview</h2>
                <p>{selectedReceipt.receipt_number}</p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeReceipt}
              >
                Close
              </button>
            </div>

            <div className="receipt-preview">
              <div className="receipt-center">
                <h2>{businessName}</h2>
                <p>{businessAddress}</p>
                <p>Tel: {businessPhone}</p>
                <p>MOMO #: {momoNumber}</p>
                <strong>Sales Receipt</strong>
              </div>

              {isSaleVoided(selectedReceipt) && (
                <div className="warning-box">
                  This sale has been voided/cancelled and is not counted as
                  valid income.
                  <br />
                  <strong>Reason:</strong> {selectedReceipt.void_reason || "-"}
                  <br />
                  <strong>Voided by:</strong>{" "}
                  {selectedReceipt.voided_by_name || "-"}
                  <br />
                  <strong>Voided at:</strong>{" "}
                  {selectedReceipt.voided_at
                    ? new Date(selectedReceipt.voided_at).toLocaleString()
                    : "-"}
                </div>
              )}

              <div className="receipt-info-grid">
                <p>
                  <strong>Receipt:</strong> {selectedReceipt.receipt_number}
                </p>

                <p>
                  <strong>Date:</strong>{" "}
                  {new Date(selectedReceipt.created_at).toLocaleString()}
                </p>

                <p>
                  <strong>Customer:</strong>{" "}
                  {selectedReceipt.customer_name || "Walk-in Customer"}
                </p>

                <p>
                  <strong>Phone:</strong>{" "}
                  {selectedReceipt.customer_phone || "-"}
                </p>

                <p>
                  <strong>Staff:</strong> {selectedReceipt.staff_name || "-"}
                </p>

                <p>
                  <strong>Payment Method:</strong>{" "}
                  {formatPaymentMethod(selectedReceipt.payment_type)}
                </p>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Total</th>
                  </tr>
                </thead>

                <tbody>
                  {selectedItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.product_name}</td>
                      <td>{item.quantity}</td>
                      <td>GHS {formatMoney(item.unit_price)}</td>
                      <td>GHS {formatMoney(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="receipt-totals">
                <p>
                  <span>Subtotal</span>
                  <strong>GHS {formatMoney(selectedReceipt.subtotal)}</strong>
                </p>

                <p>
                  <span>Discount</span>
                  <strong>
                    GHS {formatMoney(selectedReceipt.discount_amount)}
                  </strong>
                </p>

                <p>
                  <span>VAT</span>
                  <strong>GHS {formatMoney(selectedReceipt.tax_amount)}</strong>
                </p>

                <p className="receipt-grand-total">
                  <span>Amount Due</span>
                  <strong>GHS {formatMoney(selectedReceipt.total)}</strong>
                </p>

                <p>
                  <span>Amount Paid</span>
                  <strong>
                    GHS {formatMoney(selectedReceipt.amount_paid)}
                  </strong>
                </p>

                <p>
                  <span>Balance Outstanding</span>
                  <strong>GHS {formatMoney(selectedReceipt.balance)}</strong>
                </p>
              </div>

              {selectedDebt && (
                <div className="warning-box">
                  Debt balance: GHS {formatMoney(selectedDebt.balance)} —{" "}
                  {selectedDebt.status}
                </div>
              )}

              <div className="receipt-center">
                <h3>{receiptFooter}</h3>
                <p>
                  <strong>{policyText}</strong>
                </p>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" onClick={printReceipt}>
                Print / Reprint Receipt
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  downloadReceiptPdf(
                    selectedReceipt.id,
                    selectedReceipt.receipt_number
                  )
                }
              >
                Download PDF
              </button>

              {isAdmin && !isSaleVoided(selectedReceipt) && (
                <button
                  type="button"
                  className="small-danger"
                  onClick={() =>
                    voidSale(
                      selectedReceipt.id,
                      selectedReceipt.receipt_number
                    )
                  }
                >
                  Void Sale
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}