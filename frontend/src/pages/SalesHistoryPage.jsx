import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function SalesHistoryPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const [sales, setSales] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedDebt, setSelectedDebt] = useState(null);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [loading, setLoading] = useState(false);

  const businessName = "CHALIN 03 COMPANY LIMITED";
  const businessAddress = "Dunkwa Police Barrier";
  const businessPhone = "0249469080 / 0249995510";
  const momoNumber = "0543421127";
  const receiptFooter = "Thank You For Coming";
  const policyText = "ITEMS SOLD ARE NOT RETURNABLE";

  function getReceiptBusinessName(receiptData) {
    return receiptData?.business_name || businessName;
  }

  function getReceiptBusinessAddress(receiptData) {
    return (
      receiptData?.business_address ||
      receiptData?.branch_location ||
      currentStoreLocation ||
      businessAddress
    );
  }

  function getReceiptBusinessPhone(receiptData) {
    return receiptData?.business_phone || businessPhone;
  }

  function getReceiptMomoNumber(receiptData) {
    return receiptData?.owner_phone || momoNumber;
  }

  function getReceiptStoreCode(receiptData) {
    return receiptData?.branch_code || receiptData?.store_code || currentStoreCode;
  }

  function getReceiptStoreName(receiptData) {
    return receiptData?.branch_name || receiptData?.store_name || currentStoreName;
  }

  function formatMoney(value) {
    return Number(value || 0).toFixed(2);
  }

  function formatCompactMoney(value) {
    const number = Number(value || 0);

    if (number >= 1000000) {
      return `GHS ${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
      return `GHS ${(number / 1000).toFixed(1)}K`;
    }

    return `GHS ${formatMoney(number)}`;
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

  function formatDateTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
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
    const status = String(sale?.sale_status || "").toLowerCase();

    return (
      Number(sale?.is_voided || 0) === 1 ||
      status === "cancelled" ||
      status === "voided"
    );
  }

  async function loadSales(customFilters = null) {
    setError("");
    setMessage("");
    setLoading(true);

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
    } finally {
      setLoading(false);
    }
  }

  async function viewReceipt(saleId) {
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.get(`/sales/${saleId}`);

      setSelectedReceipt({
        ...(response.data.sale || {}),
        branch_code:
          response.data.sale?.branch_code ||
          response.data.sale?.store_code ||
          currentStoreCode,
        branch_name:
          response.data.sale?.branch_name ||
          response.data.sale?.store_name ||
          currentStoreName,
        branch_location:
          response.data.sale?.branch_location ||
          response.data.sale?.business_address ||
          currentStoreLocation,
      });
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
    const receiptBusinessName = getReceiptBusinessName(selectedReceipt);
    const receiptBusinessAddress = getReceiptBusinessAddress(selectedReceipt);
    const receiptBusinessPhone = getReceiptBusinessPhone(selectedReceipt);
    const receiptMomoNumber = getReceiptMomoNumber(selectedReceipt);
    const receiptStoreCode = getReceiptStoreCode(selectedReceipt);
    const receiptStoreName = getReceiptStoreName(selectedReceipt);

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
            <h1>${escapeHtml(receiptBusinessName)}</h1>

            <div class="center">
              <p>${escapeHtml(receiptBusinessAddress)}</p>
              <p>Tel: ${escapeHtml(receiptBusinessPhone)}</p>
              <p>MOMO #: ${escapeHtml(receiptMomoNumber)}</p>
              <p>Store: ${escapeHtml(receiptStoreCode)} - ${escapeHtml(receiptStoreName)}</p>
            </div>

            ${voidedHtml}

            <div class="dash"></div>

            <div class="details-row">
              <span>Store :</span>
              <span>${escapeHtml(receiptStoreCode)} - ${escapeHtml(receiptStoreName)}</span>
            </div>

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
    // Reload sales when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    function checkScreenSize() {
      setIsMobile(window.innerWidth <= 760);
    }

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => {
      window.removeEventListener("resize", checkScreenSize);
    };
  }, []);

  const summary = useMemo(() => {
    const activeSales = sales.filter((sale) => !isSaleVoided(sale));
    const voidedSales = sales.filter(isSaleVoided);

    const totalSales = activeSales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const totalPaid = activeSales.reduce(
      (sum, sale) => sum + Number(sale.amount_paid || 0),
      0
    );

    const totalBalance = activeSales.reduce(
      (sum, sale) => sum + Number(sale.balance || 0),
      0
    );

    const totalDiscount = activeSales.reduce(
      (sum, sale) => sum + Number(sale.discount_amount || 0),
      0
    );

    return {
      activeCount: activeSales.length,
      voidedCount: voidedSales.length,
      totalSales,
      totalPaid,
      totalBalance,
      totalDiscount,
    };
  }, [sales]);

  const oneColumn = isMobile ? styles.oneColumn : {};
  const compactHero = isMobile ? styles.heroMobile : {};
  const compactHeroTitle = isMobile ? styles.heroTitleMobile : {};
  const compactFilterGrid = isMobile ? styles.filterGridMobile : {};
  const compactModalActions = isMobile ? styles.modalActionsMobile : {};

  return (
    <div style={styles.page}>
      <div style={{ ...styles.hero, ...compactHero }}>
        <div style={styles.heroGlowOne} />
        <div style={styles.heroGlowTwo} />

        <div style={styles.heroContent}>
          <div style={styles.heroTop}>
            <div>
              <p style={styles.eyebrow}>Receipt Control Center • {currentStoreCode}</p>

              <h1 style={{ ...styles.heroTitle, ...compactHeroTitle }}>
                Sales History
              </h1>

              <p style={styles.heroSubtitle}>
                View past sales, reprint receipts, download PDF receipts and
                void wrong sales for <strong>{currentStoreName}</strong>
                {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}.
                Every record shown here belongs to the selected store.
              </p>
            </div>

            <button type="button" style={styles.heroButton} onClick={() => loadSales()}>
              {loading ? "Refreshing..." : "Refresh Sales"}
            </button>
          </div>

          <div style={{ ...styles.heroMetrics, ...oneColumn }}>
            <HeroMetric label="Valid Sales : " value={summary.activeCount} />
            <HeroMetric label="Sales Value : " value={formatCompactMoney(summary.totalSales)} />
            <HeroMetric label="Paid : " value={formatCompactMoney(summary.totalPaid)} />
            <HeroMetric label="Balance : " value={formatCompactMoney(summary.totalBalance)} />
          </div>
        </div>
      </div>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏬</span>
        <div>
          <strong>
            {currentStoreCode} — {currentStoreName}
          </strong>
          <p>
            Sales history, receipt preview, PDF download and void actions are
            filtered to this selected store only.
          </p>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={{ ...styles.summaryGrid, ...oneColumn }}>
        <SummaryCard
          icon="🧾"
          title="Valid Receipts"
          value={summary.activeCount}
          note="Completed sales counted as income"
          tone="blue"
        />

        <SummaryCard
          icon="💰"
          title="Total Sales"
          value={`GHS ${formatMoney(summary.totalSales)}`}
          note="Voided sales excluded"
          tone="gold"
        />

        <SummaryCard
          icon="✅"
          title="Money Paid"
          value={`GHS ${formatMoney(summary.totalPaid)}`}
          note="Cash and other payments received"
          tone="green"
        />

        <SummaryCard
          icon="⚠️"
          title="Outstanding"
          value={`GHS ${formatMoney(summary.totalBalance)}`}
          note={`${summary.voidedCount} voided receipt(s) in list`}
          tone="red"
        />
      </div>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrowDark}>Search & Audit</p>
            <h2 style={styles.panelTitle}>Filter Sales - {currentStoreCode}</h2>
            <p style={styles.panelSubtitle}>
              Search by receipt number, customer name or phone number.
            </p>
          </div>
        </div>

        <div style={{ ...styles.filterGrid, ...compactFilterGrid }}>
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

          <div style={styles.filterActions}>
            <button type="button" onClick={() => loadSales()}>
              Apply Filter
            </button>

            <button type="button" className="secondary-button" onClick={clearFilters}>
              Clear
            </button>
          </div>
        </div>
      </section>

      <section style={styles.panelLarge}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrowDark}>Receipt List</p>
            <h2 style={styles.panelTitle}>Sales List - {currentStoreCode}</h2>
            <p style={styles.panelSubtitle}>
              Open a receipt to reprint, download PDF or void the sale.
            </p>
          </div>

          <span style={styles.goldBadge}>{sales.length} record(s)</span>
        </div>

        {sales.length === 0 ? (
          <div style={styles.emptyState}>
            No sales found for {currentStoreCode} — {currentStoreName}.
          </div>
        ) : (
          <div style={styles.salesList}>
            {sales.map((sale) => {
              const voided = isSaleVoided(sale);

              return (
                <article
                  key={sale.id}
                  style={{
                    ...styles.saleCard,
                    ...(voided ? styles.saleCardVoided : {}),
                  }}
                >
                  <div style={styles.saleCardMain}>
                    <div>
                      <div style={styles.receiptRow}>
                        <strong>{sale.receipt_number}</strong>

                        {voided ? (
                          <span style={styles.voidBadge}>Voided</span>
                        ) : (
                          <span style={styles.successBadge}>
                            {sale.sale_status || "completed"}
                          </span>
                        )}
                      </div>

                      <p>
                        {sale.customer_name || "Walk-in Customer"} •{" "}
                        {sale.customer_phone || "-"}
                      </p>

                      <small>
                        Staff: {sale.staff_name || "-"} • Payment:{" "}
                        {formatPaymentMethod(sale.payment_type)} •{" "}
                        {formatDateTime(sale.created_at)}
                      </small>
                    </div>

                    <div style={styles.saleAmountBox}>
                      <span>Total</span>
                      <strong>GHS {formatMoney(sale.total)}</strong>
                      <small>
                        Paid: GHS {formatMoney(sale.amount_paid)} • Bal: GHS{" "}
                        {formatMoney(sale.balance)}
                      </small>
                    </div>
                  </div>

                  <div style={styles.saleMiniGrid}>
                    <MiniStat label="Subtotal" value={`GHS ${formatMoney(sale.subtotal)}`} />
                    <MiniStat
                      label="Discount"
                      value={`GHS ${formatMoney(sale.discount_amount)}`}
                    />
                    <MiniStat label="Payment" value={formatPaymentMethod(sale.payment_type)} />
                    <MiniStat label="Date" value={formatReceiptDate(sale.created_at)} />
                  </div>

                  <div style={styles.cardActions}>
                    <button type="button" onClick={() => viewReceipt(sale.id)}>
                      View Receipt
                    </button>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => downloadReceiptPdf(sale.id, sale.receipt_number)}
                    >
                      Download PDF
                    </button>

                    {isAdmin && !voided && (
                      <button
                        type="button"
                        className="small-danger"
                        onClick={() => voidSale(sale.id, sale.receipt_number)}
                      >
                        Void Sale
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedReceipt && (
        <div className="modal-backdrop">
          <div className="receipt-modal" style={styles.receiptModal}>
            <div className="modal-header">
              <div>
                <h2>Receipt Preview - {getReceiptStoreCode(selectedReceipt)}</h2>
                <p>
                  {selectedReceipt.receipt_number} •{" "}
                  {getReceiptStoreName(selectedReceipt)}
                </p>
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
                <h2>{getReceiptBusinessName(selectedReceipt)}</h2>
                <p>{getReceiptBusinessAddress(selectedReceipt)}</p>
                <p>Tel: {getReceiptBusinessPhone(selectedReceipt)}</p>
                <p>MOMO #: {getReceiptMomoNumber(selectedReceipt)}</p>
                <p>
                  Store: {getReceiptStoreCode(selectedReceipt)} —{" "}
                  {getReceiptStoreName(selectedReceipt)}
                </p>
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
                  <strong>Store:</strong> {getReceiptStoreCode(selectedReceipt)}{" "}
                  — {getReceiptStoreName(selectedReceipt)}
                </p>

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

              <div style={styles.tableWrap}>
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
              </div>

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

            <div style={{ ...styles.modalActions, ...compactModalActions }}>
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
                    voidSale(selectedReceipt.id, selectedReceipt.receipt_number)
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

function HeroMetric({ label, value }) {
  return (
    <div style={styles.heroMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({ icon, title, value, note, tone }) {
  return (
    <div style={styles.summaryCard}>
      <div style={{ ...styles.summaryIcon, ...summaryTones[tone] }}>{icon}</div>

      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={styles.miniStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const summaryTones = {
  gold: { background: "#fef3c7", color: "#92400e" },
  blue: { background: "#dbeafe", color: "#1d4ed8" },
  green: { background: "#dcfce7", color: "#166534" },
  red: { background: "#fee2e2", color: "#991b1b" },
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "42px",
  },

  oneColumn: {
    gridTemplateColumns: "1fr",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "28px",
    padding: "26px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 48%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 60px rgba(7, 24, 44, 0.26)",
  },

  heroMobile: {
    padding: "18px 14px",
    borderRadius: "20px",
  },

  heroGlowOne: {
    position: "absolute",
    width: "260px",
    height: "260px",
    right: "-90px",
    top: "-90px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.30)",
    filter: "blur(18px)",
  },

  heroGlowTwo: {
    position: "absolute",
    width: "180px",
    height: "180px",
    left: "35%",
    bottom: "-110px",
    borderRadius: "50%",
    background: "rgba(37, 99, 235, 0.34)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
  },

  heroTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#b45309",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 50px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroTitleMobile: {
    fontSize: "30px",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "820px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.6,
  },

  heroButton: {
    border: "1px solid rgba(224, 186, 40, 0.62)",
    background: "rgba(224, 186, 40, 0.16)",
    color: "#ffffff",
    borderRadius: "14px",
    padding: "11px 14px",
    fontWeight: "950",
    cursor: "pointer",
  },

  heroMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "12px",
    marginTop: "22px",
  },

  heroMetric: {
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.15)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  summaryCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "20px",
    padding: "16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    minWidth: 0,
  },

  summaryIcon: {
    width: "46px",
    height: "46px",
    borderRadius: "16px",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
    flexShrink: 0,
  },

  panel: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
    marginBottom: "18px",
  },

  panelLarge: {
    background: "#ffffff",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "16px",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  filterGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) 1fr 1fr auto",
    gap: "12px",
    alignItems: "end",
  },

  filterGridMobile: {
    gridTemplateColumns: "1fr",
  },

  filterActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },

  goldBadge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "7px 11px",
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: "950",
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  emptyState: {
    padding: "20px",
    color: "#64748b",
    fontWeight: "800",
    textAlign: "center",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
  },

  salesList: {
    display: "grid",
    gap: "12px",
  },

  saleCard: {
    borderRadius: "20px",
    border: "1px solid #e2e8f0",
    background: "linear-gradient(180deg, #ffffff, #f8fafc)",
    padding: "16px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  saleCardVoided: {
    background: "linear-gradient(180deg, #fff7f7, #ffffff)",
    borderColor: "#fecaca",
  },

  saleCardMain: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "14px",
    alignItems: "start",
  },

  receiptRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },

  saleAmountBox: {
    minWidth: "190px",
    textAlign: "right",
    color: "#0f172a",
  },

  saleMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },

  miniStat: {
    padding: "10px",
    borderRadius: "14px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
  },

  successBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "5px 8px",
    background: "#dcfce7",
    color: "#166534",
    fontSize: "11px",
    fontWeight: "950",
    textTransform: "capitalize",
  },

  voidBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "5px 8px",
    background: "#fee2e2",
    color: "#991b1b",
    fontSize: "11px",
    fontWeight: "950",
  },

  cardActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "14px",
  },

  receiptModal: {
    maxWidth: "920px",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  modalActions: {
    marginTop: "18px",
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
  },

  modalActionsMobile: {
    display: "grid",
    gridTemplateColumns: "1fr",
  },
};
