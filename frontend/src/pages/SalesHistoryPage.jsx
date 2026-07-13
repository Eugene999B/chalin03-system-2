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
  const [editingSale, setEditingSale] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [editProducts, setEditProducts] = useState([]);
  const [editForm, setEditForm] = useState({
    customer_name: "",
    customer_phone: "",
    payment_type: "cash",
    discount_amount: "0",
    amount_tendered: "0",
    edit_reason: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
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
      product_search: productSearch,
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
      `Why are you deleting receipt ${receiptNumber}? This uses the safe void process and keeps the accounting record.`
    );

    if (reason === null) return;

    if (!reason.trim()) {
      setError("Delete reason is required.");
      return;
    }

    const confirmed = window.confirm(
      `Delete sale ${receiptNumber}? Stock will be restored, any debt for this sale will be closed, and the accounting record will remain as Deleted/Voided.`
    );

    if (!confirmed) return;

    try {
      const response = await axiosClient.patch(`/sales/${saleId}/void`, {
        reason: reason.trim(),
      });

      setMessage(response.data.message || "Sale deleted safely.");
      closeReceipt();
      await loadSales();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to delete sale.");
    }
  }

  async function startEditSale(saleId) {
    setMessage("");
    setError("");

    try {
      const [saleResponse, productsResponse] = await Promise.all([
        axiosClient.get(`/sales/${saleId}`),
        axiosClient.get("/products"),
      ]);
      const sale = saleResponse.data.sale || {};

      if (isSaleVoided(sale)) {
        setError("Deleted or voided sales cannot be edited.");
        return;
      }

      const availableProducts = productsResponse.data.products || [];

      setEditProducts(availableProducts);
      setEditingSale(sale);
      setEditItems(
        (saleResponse.data.items || []).map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name || "",
          quantity: item.quantity,
          unit_price: item.unit_price,
        }))
      );
      setEditForm({
        customer_name: sale.customer_name || "",
        customer_phone: sale.customer_phone || "",
        payment_type: sale.payment_type || "cash",
        discount_amount: String(sale.discount_amount || 0),
        amount_tendered: String(
          sale.amount_tendered ?? sale.amount_paid ?? sale.total ?? 0
        ),
        edit_reason: "",
      });
      closeReceipt();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load sale for editing.");
    }
  }

  function updateEditItem(index, field, value) {
    setEditItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  function selectEditProduct(index, productIdValue) {
    const productId = Number(productIdValue);
    const product = editProducts.find(
      (entry) => Number(entry.id) === productId
    );

    setEditItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        return {
          ...item,
          product_id: productIdValue,
          product_name: product?.name || "",
          unit_price:
            productIdValue && product
              ? String(product.selling_price ?? item.unit_price ?? "")
              : "",
        };
      })
    );
  }

  function removeEditItem(index) {
    setEditItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function addEditItem() {
    setEditItems((current) => [
      ...current,
      { product_id: "", product_name: "", quantity: 1, unit_price: "" },
    ]);
  }

  function closeEditSale() {
    setEditingSale(null);
    setEditItems([]);
    setEditProducts([]);
    setEditForm({
      customer_name: "",
      customer_phone: "",
      payment_type: "cash",
      discount_amount: "0",
      amount_tendered: "0",
      edit_reason: "",
    });
  }

  async function saveEditSale(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!editingSale) return;

    if (!editForm.edit_reason.trim()) {
      setError("Edit reason is required.");
      return;
    }

    if (editItems.length === 0) {
      setError("Edited sale must contain at least one item.");
      return;
    }

    setSavingEdit(true);

    try {
      const response = await axiosClient.put(`/sales/${editingSale.id}`, {
        customer_name: editForm.customer_name,
        customer_phone: editForm.customer_phone,
        payment_type: editForm.payment_type,
        discount_amount: Number(editForm.discount_amount || 0),
        amount_tendered: Number(editForm.amount_tendered || 0),
        amount_paid: Number(editForm.amount_tendered || 0),
        edit_reason: editForm.edit_reason,
        items: editItems.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
          unit_price:
            item.unit_price === "" || item.unit_price === null
              ? undefined
              : Number(item.unit_price),
        })),
      });

      setMessage(response.data.message || "Sale edited successfully.");
      closeEditSale();
      await loadSales();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to edit sale.");
    } finally {
      setSavingEdit(false);
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
              <span>Amount Tendered</span>
              <span>${formatMoney(selectedReceipt.amount_tendered)}</span>
            </div>

            <div class="totals-row">
              <span>Amount Paid</span>
              <span>${formatMoney(selectedReceipt.amount_paid)}</span>
            </div>

            <div class="totals-row ${Number(selectedReceipt.change_due || 0) > 0 ? "big" : ""}">
              <span>Change Due</span>
              <span>${formatMoney(selectedReceipt.change_due)}</span>
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
    setProductSearch("");
    setFrom("");
    setTo("");

    loadSales({
      search: "",
      product_search: "",
      from: "",
      to: "",
    });
  }

  useEffect(() => {
    loadSales({
      search: "",
      product_search: "",
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

    const productFilterActive = productSearch.trim().length > 0;

    const productQuantity = activeSales.reduce(
      (sum, sale) =>
        sum +
        Number(
          productFilterActive
            ? sale.matched_product_quantity || 0
            : sale.total_items_sold || 0
        ),
      0
    );

    const productValue = activeSales.reduce(
      (sum, sale) =>
        sum +
        Number(
          productFilterActive
            ? sale.matched_product_total || 0
            : sale.total_items_value || 0
        ),
      0
    );

    return {
      activeCount: activeSales.length,
      voidedCount: voidedSales.length,
      totalSales,
      totalPaid,
      totalBalance,
      totalDiscount,
      productFilterActive,
      productQuantity,
      productValue,
    };
  }, [sales, productSearch]);

  const oneColumn = isMobile ? styles.oneColumn : {};
  const compactHero = isMobile ? styles.heroMobile : {};
  const compactHeroTitle = isMobile ? styles.heroTitleMobile : {};
  const compactFilterGrid = isMobile ? styles.filterGridMobile : {};
  const compactModalActions = isMobile ? styles.modalActionsMobile : {};
  const compactStoreNotice = isMobile ? styles.storeNoticeMobile : {};
  const compactPanel = isMobile ? styles.panelMobile : {};
  const compactSaleCardMain = isMobile ? styles.saleCardMainMobile : {};
  const compactSaleAmountBox = isMobile ? styles.saleAmountBoxMobile : {};
  const compactCardActions = isMobile ? styles.cardActionsMobile : {};

  return (
    <div className="sales-history-mobile-safe" style={styles.page}>
      <style>{`
        @media (max-width: 760px) {
          .sales-history-mobile-safe {
            width: 100% !important;
            max-width: 100% !important;
            overflow-x: hidden !important;
            box-sizing: border-box !important;
          }

          .sales-history-mobile-safe *,
          .sales-history-mobile-safe *::before,
          .sales-history-mobile-safe *::after {
            box-sizing: border-box !important;
          }

          .sales-history-mobile-safe section,
          .sales-history-mobile-safe article,
          .sales-history-mobile-safe div {
            max-width: 100% !important;
          }

          .sales-history-mobile-safe input,
          .sales-history-mobile-safe button,
          .sales-history-mobile-safe select {
            width: 100% !important;
            max-width: 100% !important;
            min-height: 44px !important;
            font-size: 16px !important;
          }

          .sales-history-mobile-safe button {
            white-space: normal !important;
          }

          .sales-history-mobile-safe h1,
          .sales-history-mobile-safe h2,
          .sales-history-mobile-safe h3,
          .sales-history-mobile-safe p,
          .sales-history-mobile-safe span,
          .sales-history-mobile-safe strong,
          .sales-history-mobile-safe small {
            overflow-wrap: anywhere !important;
          }

          .sales-history-mobile-safe table {
            min-width: 680px !important;
            font-size: 12px !important;
          }

          .sales-history-mobile-safe th,
          .sales-history-mobile-safe td {
            white-space: nowrap !important;
            padding: 10px 9px !important;
          }

          .sales-history-mobile-safe label {
            display: block !important;
            margin-bottom: 6px !important;
          }
        }
      `}</style>
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

      <div style={{ ...styles.storeNotice, ...compactStoreNotice }}>
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

        {summary.productFilterActive && (
          <SummaryCard
            icon="🔎"
            title="Product Found"
            value={`${summary.productQuantity} unit(s)`}
            note={`Matched value: GHS ${formatMoney(summary.productValue)}`}
            tone="blue"
          />
        )}

        <SummaryCard
          icon="⚠️"
          title="Outstanding"
          value={`GHS ${formatMoney(summary.totalBalance)}`}
          note={`${summary.voidedCount} voided receipt(s) in list`}
          tone="red"
        />
      </div>

      <section style={{ ...styles.panel, ...compactPanel }}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrowDark}>Search & Audit</p>
            <h2 style={styles.panelTitle}>Filter Sales - {currentStoreCode}</h2>
            <p style={styles.panelSubtitle}>
              Search by receipt number, customer name, phone number, or a
              particular product name. Add a date range to pull that product's
              sales history for the selected store.
            </p>
          </div>
        </div>

        <div style={{ ...styles.filterGrid, ...compactFilterGrid }}>
          <div>
            <label>Product name / product ID</label>
            <input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Example: Brake Pad or 12"
            />
          </div>

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

      <section style={{ ...styles.panelLarge, ...compactPanel }}>
        <div style={styles.panelHeader}>
          <div>
            <p style={styles.eyebrowDark}>Receipt List</p>
            <h2 style={styles.panelTitle}>Sales List - {currentStoreCode}</h2>
            <p style={styles.panelSubtitle}>
              Open a receipt to reprint, download PDF or void the sale.
              {summary.productFilterActive
                ? ` Product filter active: ${productSearch}.`
                : ""}
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
                  <div style={{ ...styles.saleCardMain, ...compactSaleCardMain }}>
                    <div>
                      <div style={styles.receiptRow}>
                        <strong>{sale.receipt_number}</strong>

                        {voided ? (
                          <span style={styles.voidBadge}>Deleted/Voided</span>
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

                      {sale.sold_products && (
                        <p style={styles.productLine}>
                          <strong>Items sold:</strong> {sale.sold_products}
                        </p>
                      )}

                      {productSearch.trim() && sale.matched_products && (
                        <div style={styles.productMatchBox}>
                          <strong>Product match:</strong>{" "}
                          {sale.matched_products}
                          <br />
                          <span>
                            Qty: {Number(sale.matched_product_quantity || 0)} •
                            Value: GHS {formatMoney(sale.matched_product_total)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div style={{ ...styles.saleAmountBox, ...compactSaleAmountBox }}>
                      <span>Total</span>
                      <strong>GHS {formatMoney(sale.total)}</strong>
                      <small>
                        Tendered: GHS {formatMoney(sale.amount_tendered)} • Paid:
                        GHS {formatMoney(sale.amount_paid)} • Change: GHS{" "}
                        {formatMoney(sale.change_due)} • Bal: GHS {formatMoney(sale.balance)}
                      </small>
                    </div>
                  </div>

                  <div style={styles.saleMiniGrid}>
                    <MiniStat label="Subtotal" value={`GHS ${formatMoney(sale.subtotal)}`} />
                    <MiniStat
                      label="Tendered"
                      value={`GHS ${formatMoney(sale.amount_tendered)}`}
                    />
                    <MiniStat
                      label="Change"
                      value={`GHS ${formatMoney(sale.change_due)}`}
                    />
                    <MiniStat
                      label="Discount"
                      value={`GHS ${formatMoney(sale.discount_amount)}`}
                    />
                    <MiniStat label="Payment" value={formatPaymentMethod(sale.payment_type)} />
                    <MiniStat label="Date" value={formatReceiptDate(sale.created_at)} />
                  </div>

                  <div style={{ ...styles.cardActions, ...compactCardActions }}>
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
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => startEditSale(sale.id)}
                        >
                          Edit Sale
                        </button>
                        <button
                          type="button"
                          className="small-danger"
                          onClick={() => voidSale(sale.id, sale.receipt_number)}
                        >
                          Delete Sale
                        </button>
                      </>
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
                  <span>Amount Tendered</span>
                  <strong>
                    GHS {formatMoney(selectedReceipt.amount_tendered)}
                  </strong>
                </p>

                <p>
                  <span>Amount Paid</span>
                  <strong>
                    GHS {formatMoney(selectedReceipt.amount_paid)}
                  </strong>
                </p>

                <p>
                  <span>Change Due</span>
                  <strong>GHS {formatMoney(selectedReceipt.change_due)}</strong>
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
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => startEditSale(selectedReceipt.id)}
                  >
                    Edit Sale
                  </button>
                  <button
                    type="button"
                    className="small-danger"
                    onClick={() =>
                      voidSale(selectedReceipt.id, selectedReceipt.receipt_number)
                    }
                  >
                    Delete Sale
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editingSale && (
        <div className="modal-backdrop">
          <div className="receipt-modal" style={styles.receiptModal}>
            <div className="modal-header">
              <div>
                <h2>Edit Sale - {editingSale.receipt_number}</h2>
                <p>Admin-only correction. Receipt number and original creation record stay intact.</p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeEditSale}
                disabled={savingEdit}
              >
                Close
              </button>
            </div>

            <form onSubmit={saveEditSale} style={styles.editForm}>
              <div style={styles.editGrid}>
                <label>
                  Customer name
                  <input
                    value={editForm.customer_name}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        customer_name: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  Customer phone
                  <input
                    value={editForm.customer_phone}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        customer_phone: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  Payment type
                  <select
                    value={editForm.payment_type}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        payment_type: event.target.value,
                      }))
                    }
                  >
                    {["cash", "momo", "bank", "credit", "mixed"].map((method) => (
                      <option key={method} value={method}>
                        {formatPaymentMethod(method)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Discount
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.discount_amount}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        discount_amount: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  {["cash", "momo", "bank"].includes(editForm.payment_type)
                    ? "Amount tendered"
                    : "Amount paid now"}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.amount_tendered}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        amount_tendered: event.target.value,
                      }))
                    }
                  />
                </label>

                <label>
                  Edit reason
                  <input
                    value={editForm.edit_reason}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        edit_reason: event.target.value,
                      }))
                    }
                    required
                    placeholder="Required"
                  />
                </label>
              </div>

              <div style={styles.editItemsBox}>
                <strong>Items</strong>
                {editItems.map((item, index) => (
                  <div key={`${item.product_id}-${index}`} style={styles.editItemRow}>
                    <label>
                      Product
                      <select
                        value={item.product_id}
                        onChange={(event) =>
                          selectEditProduct(index, event.target.value)
                        }
                        required
                      >
                        <option value="">Select product</option>
                        {item.product_id &&
                          !editProducts.some(
                            (product) =>
                              Number(product.id) === Number(item.product_id)
                          ) && (
                            <option value={item.product_id}>
                              {item.product_name || `Product #${item.product_id}`}
                            </option>
                          )}
                        {editProducts
                          .filter(
                            (product) =>
                              Number(product.is_active ?? 1) === 1 &&
                              !editItems.some(
                                (otherItem, otherIndex) =>
                                  otherIndex !== index &&
                                  Number(otherItem.product_id) ===
                                    Number(product.id)
                              )
                          )
                          .map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} — Stock {Number(product.quantity || 0)}
                            </option>
                          ))}
                      </select>
                    </label>

                    <label>
                      Qty
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(event) =>
                          updateEditItem(index, "quantity", event.target.value)
                        }
                        required
                      />
                    </label>

                    <label>
                      Unit price
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(event) =>
                          updateEditItem(index, "unit_price", event.target.value)
                        }
                      />
                    </label>

                    <button
                      type="button"
                      className="small-danger"
                      onClick={() => removeEditItem(index)}
                      disabled={editItems.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <button type="button" className="secondary-button" onClick={addEditItem}>
                  Add Item
                </button>
              </div>

              <div style={{ ...styles.modalActions, ...compactModalActions }}>
                <button type="submit" disabled={savingEdit}>
                  {savingEdit ? "Saving..." : "Save Sale Edit"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeEditSale}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
              </div>
            </form>
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
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1.4fr) 1fr 1fr auto",
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


  panelMobile: {
    padding: "15px",
    borderRadius: "18px",
  },

  storeNoticeMobile: {
    display: "grid",
    gridTemplateColumns: "1fr",
    padding: "13px",
    borderRadius: "16px",
  },

  saleCardMainMobile: {
    gridTemplateColumns: "1fr",
  },

  saleAmountBoxMobile: {
    minWidth: 0,
    textAlign: "left",
    width: "100%",
    paddingTop: "10px",
    borderTop: "1px solid #e2e8f0",
  },

  cardActionsMobile: {
    display: "grid",
    gridTemplateColumns: "1fr",
  },

  productLine: {
    margin: "10px 0 0",
    padding: "10px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: "13px",
    lineHeight: 1.45,
  },

  productMatchBox: {
    marginTop: "10px",
    padding: "10px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #ecfeff, #f0fdf4)",
    border: "1px solid #99f6e4",
    color: "#0f766e",
    fontSize: "13px",
    lineHeight: 1.45,
    fontWeight: "800",
  },

  receiptModal: {
    maxWidth: "920px",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  editForm: {
    display: "grid",
    gap: "18px",
  },

  editGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "14px",
  },

  editItemsBox: {
    display: "grid",
    gap: "12px",
    padding: "14px",
    borderRadius: "16px",
    border: "1px solid #dbe6ef",
    background: "#f8fafc",
  },

  editItemRow: {
    display: "grid",
    gridTemplateColumns: "minmax(120px, 1fr) minmax(90px, 0.5fr) minmax(120px, 0.8fr) auto",
    gap: "10px",
    alignItems: "end",
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
