import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

export default function NewSalePage() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocation, setCustomerLocation] = useState("");
  const [paymentType, setPaymentType] = useState("cash");
  const [discountAmount, setDiscountAmount] = useState("");
  const [amountPaid, setAmountPaid] = useState("");

  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const businessName = "CHALIN 03 COMPANY LIMITED";
  const businessAddress = "Dunkwa Police Barrier";
  const businessPhone = "0249469080 / 0249995510";
  const momoNumber = "0543421127";
  const receiptFooter = "Thank You For Coming";
  const policyText = "ITEMS SOLD ARE NOT RETURNABLE";

  function cleanText(value) {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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

  function getReceiptCustomerName(receiptData) {
    return (
      receiptData?.customer?.name ||
      receiptData?.customer_name ||
      "Walk-in Customer"
    );
  }

  function getReceiptCustomerPhone(receiptData) {
    return receiptData?.customer?.phone || receiptData?.customer_phone || "-";
  }

  async function loadProducts() {
    setError("");

    try {
      const response = await axiosClient.get("/products");
      setProducts(response.data.products || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load products.");
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  const selectedProduct = useMemo(() => {
    return products.find(
      (product) => Number(product.id) === Number(selectedProductId)
    );
  }, [products, selectedProductId]);

  const filteredProducts = useMemo(() => {
    const searchText = productSearch.trim().toLowerCase();

    if (!searchText) {
      return [];
    }

    return products
      .filter((product) => {
        const searchableText = [
          product.name,
          product.barcode,
          product.category,
          product.size,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchableText.includes(searchText);
      })
      .slice(0, 15);
  }, [products, productSearch]);

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      return sum + Number(item.selling_price) * Number(item.quantity);
    }, 0);
  }, [cart]);

  const cleanDiscountAmount = Math.max(Number(discountAmount || 0), 0);
  const estimatedAmountDue = Math.max(subtotal - cleanDiscountAmount, 0);
  const expectedBalance = Math.max(
    estimatedAmountDue - Number(amountPaid || 0),
    0
  );

  function selectProductForSale(product) {
    setError("");
    setMessage("");
    setSelectedProductId(String(product.id));
    setProductSearch(product.name || "");
  }

  function clearSelectedProduct() {
    setSelectedProductId("");
    setProductSearch("");
    setQuantity(1);
  }

  function addToCart() {
    setError("");
    setMessage("");

    const product = products.find(
      (product) => Number(product.id) === Number(selectedProductId)
    );

    if (!product) {
      setError("Search and select a product first.");
      return;
    }

    if (Number(product.quantity) <= 0) {
      setError("This product is out of stock.");
      return;
    }

    const requestedQuantity = Number(quantity);

    if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
      setError("Quantity must be a whole number greater than zero.");
      return;
    }

    const existingItem = cart.find((item) => item.id === product.id);
    const existingQuantity = existingItem ? Number(existingItem.quantity) : 0;
    const finalQuantity = existingQuantity + requestedQuantity;

    if (finalQuantity > Number(product.quantity)) {
      setError(
        `Only ${product.quantity} in stock. You already added ${existingQuantity}.`
      );
      return;
    }

    if (existingItem) {
      setCart(
        cart.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity: finalQuantity,
              }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          ...product,
          quantity: requestedQuantity,
        },
      ]);
    }

    setSelectedProductId("");
    setProductSearch("");
    setQuantity(1);
  }

  function removeFromCart(productId) {
    setCart(cart.filter((item) => item.id !== productId));
  }

  async function completeSale(event) {
    event.preventDefault();

    setError("");
    setMessage("");
    setReceipt(null);

    const cleanCustomerName = cleanText(customerName);
    const cleanCustomerPhone = cleanText(customerPhone);
    const cleanCustomerLocation = cleanText(customerLocation);

    if (cart.length === 0) {
      setError("Add at least one item to the sale.");
      return;
    }

    const discount = Number(discountAmount || 0);

    if (Number.isNaN(discount) || discount < 0) {
      setError("Discount must be a valid number and cannot be negative.");
      return;
    }

    if (discount > subtotal) {
      setError("Discount cannot be greater than subtotal.");
      return;
    }

    if (
      (paymentType === "credit" || paymentType === "mixed") &&
      !cleanCustomerName &&
      !cleanCustomerPhone
    ) {
      setError("Customer name or phone is required for credit/mixed sales.");
      return;
    }

    try {
      const response = await axiosClient.post("/sales", {
        customer_name: cleanCustomerName,
        customer_phone: cleanCustomerPhone,
        customer_location: cleanCustomerLocation,
        payment_type: paymentType,
        discount_amount: discount,
        amount_paid: Number(amountPaid || 0),
        items: cart.map((item) => ({
          product_id: item.id,
          quantity: item.quantity,
        })),
      });

      const savedReceipt = response.data.receipt || {};

      setReceipt({
        ...savedReceipt,
        customer: {
          ...(savedReceipt.customer || {}),
          name:
            savedReceipt.customer?.name ||
            cleanCustomerName ||
            "Walk-in Customer",
          phone: savedReceipt.customer?.phone || cleanCustomerPhone || "",
          location: savedReceipt.customer?.location || cleanCustomerLocation || "",
        },
      });

      setMessage("Sale recorded successfully.");

      setCart([]);
      setSelectedProductId("");
      setProductSearch("");
      setQuantity(1);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerLocation("");
      setPaymentType("cash");
      setDiscountAmount("");
      setAmountPaid("");

      await loadProducts();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to record sale.");
    }
  }

  async function downloadReceiptPdf() {
    if (!receipt?.sale_id) {
      setError("Receipt ID is missing. Cannot download PDF.");
      return;
    }

    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get(
        `/receipts/sales/${receipt.sale_id}/pdf`,
        {
          responseType: "blob",
        }
      );

      const pdfBlob = new Blob([response.data], {
        type: "application/pdf",
      });

      const fileUrl = window.URL.createObjectURL(pdfBlob);

      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `${receipt.receipt_number || "receipt"}.pdf`;
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(fileUrl);
      }, 100);

      setMessage("Receipt PDF downloaded successfully.");
    } catch (error) {
      console.error("PDF download frontend error:", error);
      setError("Failed to download receipt PDF.");
    }
  }

  function printReceipt() {
    if (!receipt) return;

    const receiptDiscount = Number(receipt.discount_amount || 0);
    const receiptCustomerName = getReceiptCustomerName(receipt);
    const receiptCustomerPhone = getReceiptCustomerPhone(receipt);

    const itemsHtml = receipt.items
      .map(
        (item) => `
          <tr>
            <td class="item-name">${escapeHtml(
              String(item.product_name || "").toUpperCase()
            )}</td>
            <td class="right">${formatMoney(item.unit_price)}</td>
            <td class="right">${escapeHtml(item.quantity)}</td>
            <td class="right">${formatMoney(item.line_total)}</td>
          </tr>
        `
      )
      .join("");

    const receiptHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Receipt ${escapeHtml(receipt.receipt_number)}</title>

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
          </style>
        </head>

        <body>
          <div class="receipt">
            <h1>${escapeHtml(businessName)}</h1>

            <div class="center">
              <p>${escapeHtml(businessAddress)}</p>
              <p>Tel: ${escapeHtml(businessPhone)}</p>
              <p>MOMO #: ${escapeHtml(momoNumber)}</p>
            </div>

            <div class="dash"></div>

            <div class="details-row">
              <span>Customer :</span>
              <span>${escapeHtml(receiptCustomerName)}</span>
            </div>

            <div class="details-row">
              <span>Phone :</span>
              <span>${escapeHtml(receiptCustomerPhone)}</span>
            </div>

            <div class="details-row">
              <span>Date :</span>
              <span>${escapeHtml(formatReceiptDate(receipt.created_at))}</span>
            </div>

            <div class="details-row">
              <span>Time :</span>
              <span>${escapeHtml(formatReceiptTime(receipt.created_at))}</span>
            </div>

            <div class="details-row">
              <span>Receipt No.:</span>
              <span>${escapeHtml(receipt.receipt_number)}</span>
            </div>

            <div class="details-row">
              <span>Payment :</span>
              <span>${escapeHtml(formatPaymentMethod(receipt.payment_type))}</span>
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
              <span>${formatMoney(receipt.subtotal)}</span>
            </div>

            <div class="totals-row">
              <span>Discount</span>
              <span>${formatMoney(receiptDiscount)}</span>
            </div>

            <div class="totals-row">
              <span>Vat</span>
              <span>${formatMoney(receipt.tax_amount)}</span>
            </div>

            <div class="dash"></div>

            <div class="totals-row big">
              <span>Amount Due</span>
              <span>${formatMoney(receipt.total)}</span>
            </div>

            <div class="totals-row">
              <span>Amount Paid</span>
              <span>${formatMoney(receipt.amount_paid)}</span>
            </div>

            <div class="totals-row">
              <span>Balance Outstanding</span>
              <span>${formatMoney(receipt.balance)}</span>
            </div>

            <div class="dash"></div>

            <p>Served by&nbsp;&nbsp; ${escapeHtml(
              receipt.staff?.full_name || "-"
            )}</p>

            <div class="footer">${escapeHtml(receiptFooter)}</div>

            <div class="policy">${escapeHtml(policyText)}</div>

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
      setError("Popup blocked. Please allow popups to print receipt.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>New Sale</h1>
          <p>Record cash, MoMo, bank, mixed or credit sales</p>
        </div>

        <button type="button" onClick={loadProducts}>
          Refresh Products
        </button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="two-column">
        <div className="section-card">
          <h2>Select Items</h2>

          <label>Search Product</label>
          <input
            type="text"
            value={productSearch}
            onChange={(event) => {
              setProductSearch(event.target.value);
              setSelectedProductId("");
            }}
            placeholder="Search by name, barcode, category or size"
          />

          {productSearch.trim() && !selectedProduct && (
            <div
              style={{
                marginTop: "10px",
                marginBottom: "14px",
                border: "1px solid #d8e0ea",
                borderRadius: "12px",
                overflow: "hidden",
                background: "#ffffff",
              }}
            >
              {filteredProducts.length === 0 ? (
                <p
                  style={{
                    margin: 0,
                    padding: "12px",
                    color: "#667085",
                  }}
                >
                  No matching product found.
                </p>
              ) : (
                filteredProducts.map((product) => {
                  const inStock = Number(product.quantity) > 0;

                  return (
                    <div
                      key={product.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: "10px",
                        alignItems: "center",
                        padding: "12px",
                        borderBottom: "1px solid #edf1f5",
                      }}
                    >
                      <div>
                        <strong>{product.name}</strong>

                        <p
                          style={{
                            margin: "4px 0 0",
                            fontSize: "13px",
                            color: "#667085",
                          }}
                        >
                          GHS {formatMoney(product.selling_price)} | Stock:{" "}
                          {product.quantity}
                          {product.barcode
                            ? ` | Barcode: ${product.barcode}`
                            : ""}
                          {product.size ? ` | Size: ${product.size}` : ""}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => selectProductForSale(product)}
                        disabled={!inStock}
                        style={{
                          border: "none",
                          borderRadius: "8px",
                          padding: "8px 10px",
                          fontWeight: "800",
                          cursor: inStock ? "pointer" : "not-allowed",
                          background: inStock ? "#2563eb" : "#cbd5e1",
                          color: "#ffffff",
                        }}
                      >
                        {inStock ? "Select" : "Out"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {selectedProduct && (
            <div
              style={{
                marginTop: "10px",
                marginBottom: "14px",
                padding: "12px",
                borderRadius: "12px",
                background: "#ecfdf3",
                border: "1px solid #bbf7d0",
                color: "#14532d",
              }}
            >
              <strong>Selected Product:</strong> {selectedProduct.name}
              <br />

              <span>
                Price: GHS {formatMoney(selectedProduct.selling_price)} | Stock:{" "}
                {selectedProduct.quantity}
                {selectedProduct.barcode
                  ? ` | Barcode: ${selectedProduct.barcode}`
                  : ""}
              </span>

              <div style={{ marginTop: "10px" }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={clearSelectedProduct}
                >
                  Change Product
                </button>
              </div>
            </div>
          )}

          <label>Quantity</label>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />

          <button type="button" onClick={addToCart}>
            Add to Sale
          </button>

          <h2>Sale Items</h2>

          {cart.length === 0 ? (
            <p>No items added yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {cart.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>GHS {formatMoney(item.selling_price)}</td>
                    <td>{item.quantity}</td>
                    <td>
                      GHS{" "}
                      {formatMoney(
                        Number(item.selling_price) * Number(item.quantity)
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="small-danger"
                        onClick={() => removeFromCart(item.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="sale-total">Subtotal: GHS {formatMoney(subtotal)}</div>
        </div>

        <form className="section-card" onSubmit={completeSale}>
          <h2>Payment Details</h2>

          <label>Customer Name</label>
          <input
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Enter customer name"
          />

          <label>Customer Phone</label>
          <input
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            placeholder="Enter customer phone"
          />

          <label>Customer Location</label>
          <input
            value={customerLocation}
            onChange={(event) => setCustomerLocation(event.target.value)}
            placeholder="Enter customer location"
          />

          <label>Payment Type</label>
          <select
            value={paymentType}
            onChange={(event) => setPaymentType(event.target.value)}
          >
            <option value="cash">Cash</option>
            <option value="momo">MoMo</option>
            <option value="bank">Bank</option>
            <option value="credit">Credit</option>
            <option value="mixed">Mixed</option>
          </select>

          <label>Discount Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={discountAmount}
            onChange={(event) => setDiscountAmount(event.target.value)}
            placeholder="Enter discount amount"
          />

          <label>Amount Paid</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amountPaid}
            onChange={(event) => setAmountPaid(event.target.value)}
            placeholder={`Amount due is GHS ${formatMoney(estimatedAmountDue)}`}
          />

          <div className="receipt-totals">
            <p>
              <span>Subtotal</span>
              <strong>GHS {formatMoney(subtotal)}</strong>
            </p>

            <p>
              <span>Discount</span>
              <strong>GHS {formatMoney(cleanDiscountAmount)}</strong>
            </p>

            <p className="receipt-grand-total">
              <span>Estimated Amount Due</span>
              <strong>GHS {formatMoney(estimatedAmountDue)}</strong>
            </p>

            <p>
              <span>Expected Balance</span>
              <strong>GHS {formatMoney(expectedBalance)}</strong>
            </p>
          </div>

          <button type="submit">Complete Sale</button>
        </form>
      </div>

      {receipt && (
        <div className="section-card receipt-card">
          <div className="receipt-preview">
            <div className="receipt-center">
              <h2>{businessName}</h2>
              <p>{businessAddress}</p>
              <p>Tel: {businessPhone}</p>
              <p>MOMO #: {momoNumber}</p>
            </div>

            <div className="receipt-info-grid">
              <p>
                <strong>Customer:</strong> {getReceiptCustomerName(receipt)}
              </p>

              <p>
                <strong>Phone:</strong> {getReceiptCustomerPhone(receipt)}
              </p>

              <p>
                <strong>Date:</strong> {formatReceiptDate(receipt.created_at)}
              </p>

              <p>
                <strong>Time:</strong> {formatReceiptTime(receipt.created_at)}
              </p>

              <p>
                <strong>Receipt No.:</strong> {receipt.receipt_number}
              </p>

              <p>
                <strong>Payment Method:</strong>{" "}
                {formatPaymentMethod(receipt.payment_type)}
              </p>

              <p>
                <strong>Served by:</strong> {receipt.staff?.full_name || "-"}
              </p>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Item Description</th>
                  <th>Px</th>
                  <th>Qty</th>
                  <th>Amt</th>
                </tr>
              </thead>

              <tbody>
                {receipt.items.map((item) => (
                  <tr key={item.product_id}>
                    <td>{item.product_name}</td>
                    <td>GHS {formatMoney(item.unit_price)}</td>
                    <td>{item.quantity}</td>
                    <td>GHS {formatMoney(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="receipt-totals">
              <p>
                <span>Sub Total</span>
                <strong>GHS {formatMoney(receipt.subtotal)}</strong>
              </p>

              <p>
                <span>Discount</span>
                <strong>GHS {formatMoney(receipt.discount_amount)}</strong>
              </p>

              <p>
                <span>VAT</span>
                <strong>GHS {formatMoney(receipt.tax_amount)}</strong>
              </p>

              <p className="receipt-grand-total">
                <span>Amount Due</span>
                <strong>GHS {formatMoney(receipt.total)}</strong>
              </p>

              <p>
                <span>Amount Paid</span>
                <strong>GHS {formatMoney(receipt.amount_paid)}</strong>
              </p>

              <p>
                <span>Balance Outstanding</span>
                <strong>GHS {formatMoney(receipt.balance)}</strong>
              </p>
            </div>

            {receipt.debt && (
              <div className="warning-box">
                Debt created: GHS {formatMoney(receipt.debt.balance)} —{" "}
                {receipt.debt.status}
              </div>
            )}

            <div className="receipt-center">
              <h3>{receiptFooter}</h3>
              <p>
                <strong>{policyText}</strong>
              </p>
            </div>

            <div className="modal-actions">
              <button type="button" onClick={printReceipt}>
                Print Receipt
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={downloadReceiptPdf}
              >
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}